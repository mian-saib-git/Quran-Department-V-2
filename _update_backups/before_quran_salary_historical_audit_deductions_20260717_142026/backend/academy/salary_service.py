from __future__ import annotations

import calendar
from collections import Counter
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation

from django.db.models import Prefetch, Q
from django.utils import timezone

from .models import (
    Attendance,
    ClassSchedule,
    DailyLessonReport,
    SalaryConfiguration,
    StudentClassHistory,
    StudentProfile,
    TeacherProfile,
    TeacherSalarySlip,
)


DROPPED_STATUSES = {
    StudentProfile.ClassStatus.OLD_DROPPED,
    StudentProfile.ClassStatus.TRIAL_DROPPED,
    StudentProfile.ClassStatus.OLD_DROPPED_OTHER,
}


def money(value) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0.00")


def month_bounds(year: int, month: int):
    start = date(year, month, 1)
    end = date(year, month, calendar.monthrange(year, month)[1])
    return start, end


def resolve_rate(tiers, total_classes: int) -> Decimal:
    for tier in tiers or []:
        minimum = int(tier.get("min", 0) or 0)
        maximum = tier.get("max")
        if total_classes < minimum:
            continue
        if maximum is not None and total_classes > int(maximum):
            continue
        return money(tier.get("rate", 0))
    return Decimal("0.00")


def is_night_time(value: time, start: time, end: time) -> bool:
    if start <= end:
        return start <= value <= end
    return value >= start or value <= end


def effective_class_status(student: StudentProfile, year: int, month: int) -> str:
    # A Not Counted class is excluded only in the month it was marked. It
    # automatically rolls into Running for later salary months.
    if student.class_status == StudentProfile.ClassStatus.NOT_COUNTED:
        effective = student.status_effective_date
        if effective and (effective.year, effective.month) < (year, month):
            return StudentProfile.ClassStatus.RUNNING
    return student.class_status


def expected_lesson_dates(student, year: int, month: int, cutoff: date):
    schedules = getattr(student, "active_salary_schedules", None)
    if schedules is None:
        schedules = list(student.schedules.filter(is_active=True))
    if not schedules:
        return set()

    weekday_numbers = {
        ClassSchedule.WeekDay.MONDAY: 0,
        ClassSchedule.WeekDay.TUESDAY: 1,
        ClassSchedule.WeekDay.WEDNESDAY: 2,
        ClassSchedule.WeekDay.THURSDAY: 3,
        ClassSchedule.WeekDay.FRIDAY: 4,
        ClassSchedule.WeekDay.SATURDAY: 5,
        ClassSchedule.WeekDay.SUNDAY: 6,
    }
    wanted = {weekday_numbers[item.weekday] for item in schedules if item.weekday in weekday_numbers}
    start, end = month_bounds(year, month)
    end = min(end, cutoff)
    current = start
    result = set()
    while current <= end:
        if current.weekday() in wanted:
            result.add(current)
        current += timedelta(days=1)
    return result


def salary_configuration_for_department(department, actor=None):
    config, _ = SalaryConfiguration.objects.get_or_create(
        department=department,
        defaults={"updated_by": actor},
    )
    return config


def configuration_payload(config):
    return {
        "id": config.id,
        "department_id": config.department_id,
        "standard_tiers": config.standard_tiers,
        "three_day_tiers": config.three_day_tiers,
        "bonus_rates": config.bonus_rates,
        "achievement_payouts": config.achievement_payouts,
        "night_start": config.night_start.strftime("%H:%M"),
        "night_end": config.night_end.strftime("%H:%M"),
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
    }


def _student_type_breakdown(students, teacher, start, end):
    counts = Counter(student.student_type for student in students)
    history = StudentClassHistory.objects.filter(
        effective_date__range=(start, end),
    ).filter(Q(previous_teacher=teacher) | Q(new_teacher=teacher))

    transferred_in = history.filter(
        event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
        new_teacher=teacher,
    ).count()
    transferred_out = history.filter(
        event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
        previous_teacher=teacher,
    ).exclude(new_teacher=teacher).count()
    returns = history.filter(
        event_type=StudentClassHistory.EventType.RETURNED_FROM_LEAVE,
        new_teacher=teacher,
    ).count()

    return {
        "old_students": counts.get(StudentProfile.StudentType.OLD_STUDENT, 0),
        "transferred_from_teacher": transferred_in or counts.get(StudentProfile.StudentType.TRANSFERRED_FROM_TEACHER, 0),
        # Trial remains the student's active classification until the first fee
        # is received, even when the trial started in a previous month.
        "new_trials": counts.get(StudentProfile.StudentType.TRIAL_STUDENT, 0),
        "returns_from_leave": returns or counts.get(StudentProfile.StudentType.RETURNED_FROM_LEAVE, 0),
        "transferred_to_other_teachers": transferred_out,
        "grand_total": len(students) + transferred_out,
    }


def _class_status_breakdown(students, teacher, start, end, year, month):
    counts = Counter(effective_class_status(student, year, month) for student in students)
    history = StudentClassHistory.objects.filter(
        effective_date__range=(start, end),
        new_teacher=teacher,
        event_type=StudentClassHistory.EventType.STATUS_CHANGED,
    )
    drop_counts = Counter(history.values_list("new_class_status", flat=True))

    return {
        "running": counts.get(StudentProfile.ClassStatus.RUNNING, 0),
        "on_leave": counts.get(StudentProfile.ClassStatus.ON_LEAVE, 0),
        "old_dropped": max(counts.get(StudentProfile.ClassStatus.OLD_DROPPED, 0), drop_counts.get(StudentProfile.ClassStatus.OLD_DROPPED, 0)),
        "trial_dropped": max(counts.get(StudentProfile.ClassStatus.TRIAL_DROPPED, 0), drop_counts.get(StudentProfile.ClassStatus.TRIAL_DROPPED, 0)),
        "old_dropped_other": max(counts.get(StudentProfile.ClassStatus.OLD_DROPPED_OTHER, 0), drop_counts.get(StudentProfile.ClassStatus.OLD_DROPPED_OTHER, 0)),
        "not_counted": counts.get(StudentProfile.ClassStatus.NOT_COUNTED, 0),
        "grand_total": len(students),
    }


def _override_component(overrides, key, calculated):
    raw = (overrides or {}).get(key)
    if raw in (None, ""):
        return money(calculated), False
    return money(raw), True


def achievement_payout(points: int, payouts) -> Decimal:
    for row in payouts or []:
        minimum = int(row.get("min_points", 0) or 0)
        maximum = int(row.get("max_points", minimum) or minimum)
        if minimum <= points <= maximum:
            return money(row.get("amount", 0))
    return Decimal("0.00")


def calculate_teacher_salary(teacher, year: int, month: int, config, slip=None):
    start, end = month_bounds(year, month)
    today = timezone.localdate()
    lesson_cutoff = min(end, today) if (year, month) >= (today.year, today.month) else end

    students = list(
        StudentProfile.objects.select_related("user", "teacher__user", "referral_teacher__user")
        .prefetch_related(
            Prefetch(
                "schedules",
                queryset=ClassSchedule.objects.filter(is_active=True).order_by("weekday", "time_slot", "id"),
                to_attr="active_salary_schedules",
            )
        )
        .filter(teacher=teacher)
        .order_by("user__first_name", "user__username", "id")
    )

    type_breakdown = _student_type_breakdown(students, teacher, start, end)
    status_breakdown = _class_status_breakdown(students, teacher, start, end, year, month)

    eligible = []
    not_counted = []
    dropped = []
    for student in students:
        status = effective_class_status(student, year, month)
        if status in DROPPED_STATUSES:
            dropped.append(student)
        elif status == StudentProfile.ClassStatus.NOT_COUNTED:
            not_counted.append(student)
        else:
            eligible.append(student)

    standard_students = []
    three_day_students = []
    half_students = []
    review_students = []
    night_students = []

    for student in eligible:
        schedules = list(getattr(student, "active_salary_schedules", []))
        days_count = len({item.weekday for item in schedules})
        if student.salary_class_mode == StudentProfile.SalaryClassMode.HALF_MONTH:
            half_students.append(student)
        elif days_count == 3:
            three_day_students.append(student)
        elif days_count >= 4:
            standard_students.append(student)
        else:
            review_students.append(student)

        if any(is_night_time(item.time_slot, config.night_start, config.night_end) for item in schedules):
            night_students.append(student)

    total_tier_classes = len(standard_students) + len(three_day_students)
    standard_rate = resolve_rate(config.standard_tiers, total_tier_classes)
    three_day_rate = resolve_rate(config.three_day_tiers, total_tier_classes)
    standard_salary = standard_rate * len(standard_students)
    three_day_salary = three_day_rate * len(three_day_students)

    half_override_map = {}
    if slip:
        for row in slip.half_class_overrides or []:
            try:
                half_override_map[int(row.get("student_id"))] = money(row.get("amount"))
            except (TypeError, ValueError):
                continue
    half_rows = []
    half_salary = Decimal("0.00")
    for student in half_students:
        amount = half_override_map.get(student.id, money(student.half_month_salary_amount))
        half_salary += amount
        half_rows.append({
            "student_id": student.id,
            "student_name": str(student),
            "amount": float(amount),
        })

    lesson_report_dates = set(
        DailyLessonReport.objects.filter(
            teacher=teacher,
            date__range=(start, lesson_cutoff),
        ).values_list("student_id", "date")
    )
    lesson_filled_students = []
    lesson_missing_students = []
    for student in eligible:
        expected = expected_lesson_dates(student, year, month, lesson_cutoff)
        if not expected:
            lesson_missing_students.append(student)
            continue
        actual = {row_date for student_id, row_date in lesson_report_dates if student_id == student.id}
        if expected.issubset(actual):
            lesson_filled_students.append(student)
        else:
            lesson_missing_students.append(student)

    bonus_rates = config.bonus_rates or {}
    english_students = [student for student in eligible if student.speaking_language == StudentProfile.SpeakingLanguage.ENGLISH]
    reference_students = [
        student
        for student in StudentProfile.objects.select_related("user").filter(
            referral_teacher=teacher,
            user__is_active=True,
            user__date_joined__date__range=(start, end),
        )
        if effective_class_status(student, year, month) not in DROPPED_STATUSES
    ]

    english_bonus = money(bonus_rates.get("english")) * len(english_students)
    lesson_bonus = money(bonus_rates.get("lesson_filled")) * len(lesson_filled_students)
    night_bonus = money(bonus_rates.get("night")) * len(night_students)
    reference_bonus = money(bonus_rates.get("reference")) * len(reference_students)

    student_attendance = Attendance.objects.filter(
        entity_type=Attendance.EntityType.STUDENT,
        student__teacher=teacher,
        date__range=(start, end),
    )
    total_student_attendance = student_attendance.count()
    present_student_attendance = student_attendance.filter(status=Attendance.Status.PRESENT).count()
    attendance_rate = round((present_student_attendance / total_student_attendance * 100), 1) if total_student_attendance else 0

    # Old Dropped (Other) is an administrative/fee-related drop and must not
    # penalize the teacher's achievement score.
    monthly_drop_count = StudentClassHistory.objects.filter(
        effective_date__range=(start, end),
        new_teacher=teacher,
        new_class_status__in={
            StudentProfile.ClassStatus.OLD_DROPPED,
            StudentProfile.ClassStatus.TRIAL_DROPPED,
        },
    ).count()
    teacher_leave_count = Attendance.objects.filter(
        entity_type=Attendance.EntityType.TEACHER,
        teacher=teacher,
        date__range=(start, end),
        status=Attendance.Status.LEAVE,
    ).count()
    on_leave_count = sum(1 for student in students if effective_class_status(student, year, month) == StudentProfile.ClassStatus.ON_LEAVE)

    criteria = {
        "attendance_70": attendance_rate >= 70,
        "zero_drops": monthly_drop_count == 0,
        "teacher_leave_max_one": teacher_leave_count <= 1,
        "all_lessons_filled": bool(eligible) and len(lesson_filled_students) == len(eligible),
        "good_behavior": bool(getattr(slip, "behavior_good", False)),
        "zero_students_on_leave": on_leave_count == 0,
        "active_reference_student": len(reference_students) >= 1,
    }
    points = (
        (1 if criteria["attendance_70"] else 0)
        + (3 if criteria["zero_drops"] else 0)
        + (1 if criteria["teacher_leave_max_one"] else 0)
        + (1 if criteria["all_lessons_filled"] else 0)
        + (1 if criteria["good_behavior"] else 0)
        + (1 if criteria["zero_students_on_leave"] else 0)
        + (2 if criteria["active_reference_student"] else 0)
    )
    calculated_achievement = achievement_payout(points, config.achievement_payouts)

    other_rows = []
    other_total = Decimal("0.00")
    for row in (getattr(slip, "other_bonuses", None) or []):
        reason = str(row.get("reason", "") or "").strip()
        amount = money(row.get("amount"))
        if not reason or amount == 0:
            continue
        other_rows.append({"reason": reason, "amount": float(amount)})
        other_total += amount

    base_salary_calculated = standard_salary + three_day_salary + half_salary
    overrides = getattr(slip, "override_values", None) or {}
    base_salary, base_overridden = _override_component(overrides, "base_salary", base_salary_calculated)
    english_final, english_overridden = _override_component(overrides, "english_bonus", english_bonus)
    lesson_final, lesson_overridden = _override_component(overrides, "lesson_bonus", lesson_bonus)
    night_final, night_overridden = _override_component(overrides, "night_bonus", night_bonus)
    reference_final, reference_overridden = _override_component(overrides, "reference_bonus", reference_bonus)
    achievement_final, achievement_overridden = _override_component(overrides, "achievement_bonus", calculated_achievement)

    calculated_total = base_salary_calculated + english_bonus + lesson_bonus + night_bonus + reference_bonus + calculated_achievement + other_total
    component_final = base_salary + english_final + lesson_final + night_final + reference_final + achievement_final + other_total
    final_total, final_overridden = _override_component(overrides, "final_total", component_final)

    snapshot = {
        "teacher_id": teacher.id,
        "teacher_name": str(teacher),
        "month": month,
        "year": year,
        "student_type_breakdown": type_breakdown,
        "class_status_breakdown": status_breakdown,
        "final_active_classes": len(eligible),
        "standard_classes": len(standard_students),
        "three_day_classes": len(three_day_students),
        "half_classes": len(half_students),
        "manual_review_classes": len(review_students),
        "not_counted_classes": len(not_counted),
        "dropped_classes": len(dropped),
        "standard_rate": float(standard_rate),
        "three_day_rate": float(three_day_rate),
        "standard_salary": float(standard_salary),
        "three_day_salary": float(three_day_salary),
        "half_class_salary": float(half_salary),
        "half_class_rows": half_rows,
        "english_class_count": len(english_students),
        "lesson_filled_count": len(lesson_filled_students),
        "lesson_missing_count": len(lesson_missing_students),
        "night_class_count": len(night_students),
        "reference_student_count": len(reference_students),
        "attendance_rate": attendance_rate,
        "monthly_drop_count": monthly_drop_count,
        "teacher_leave_count": teacher_leave_count,
        "students_on_leave": on_leave_count,
        "achievement_criteria": criteria,
        "achievement_points": points,
        "calculated_components": {
            "base_salary": float(base_salary_calculated),
            "english_bonus": float(english_bonus),
            "lesson_bonus": float(lesson_bonus),
            "night_bonus": float(night_bonus),
            "reference_bonus": float(reference_bonus),
            "achievement_bonus": float(calculated_achievement),
            "other_bonuses": float(other_total),
        },
        "final_components": {
            "base_salary": float(base_salary),
            "english_bonus": float(english_final),
            "lesson_bonus": float(lesson_final),
            "night_bonus": float(night_final),
            "reference_bonus": float(reference_final),
            "achievement_bonus": float(achievement_final),
            "other_bonuses": float(other_total),
        },
        "override_flags": {
            "base_salary": base_overridden,
            "english_bonus": english_overridden,
            "lesson_bonus": lesson_overridden,
            "night_bonus": night_overridden,
            "reference_bonus": reference_overridden,
            "achievement_bonus": achievement_overridden,
            "final_total": final_overridden,
        },
        "other_bonuses": other_rows,
        "calculated_total": float(calculated_total),
        "final_total": float(final_total),
    }
    return snapshot, calculated_total, final_total


def refresh_salary_slip(slip, actor=None, force=False):
    if slip.status == TeacherSalarySlip.Status.PROCESSED and not force:
        return slip
    config = salary_configuration_for_department(slip.department, actor)
    snapshot, calculated_total, final_total = calculate_teacher_salary(
        slip.teacher,
        slip.year,
        slip.month,
        config,
        slip,
    )
    slip.calculated_snapshot = snapshot
    slip.calculated_total = calculated_total
    slip.final_total = final_total
    slip.updated_by = actor
    slip.save(update_fields=[
        "calculated_snapshot",
        "calculated_total",
        "final_total",
        "updated_by",
        "updated_at",
    ])
    return slip


def salary_slip_payload(slip):
    snapshot = slip.calculated_snapshot or {}
    return {
        "id": slip.id,
        "teacher_id": slip.teacher_id,
        "teacher_name": str(slip.teacher),
        "teacher_username": slip.teacher.user.username,
        "month": slip.month,
        "year": slip.year,
        "behavior_good": slip.behavior_good,
        "half_class_overrides": slip.half_class_overrides or [],
        "other_bonuses": slip.other_bonuses or [],
        "override_values": slip.override_values or {},
        "calculated_snapshot": snapshot,
        "calculated_total": float(slip.calculated_total or 0),
        "final_total": float(slip.final_total or 0),
        "status": slip.status,
        "admin_note": slip.admin_note,
        "processed_at": slip.processed_at.isoformat() if slip.processed_at else None,
        "updated_at": slip.updated_at.isoformat() if slip.updated_at else None,
    }
