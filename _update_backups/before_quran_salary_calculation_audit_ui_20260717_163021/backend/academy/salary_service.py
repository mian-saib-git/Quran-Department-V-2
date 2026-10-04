from __future__ import annotations

import calendar
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

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
ACTIVE_STATUSES = {
    StudentProfile.ClassStatus.RUNNING,
    StudentProfile.ClassStatus.ON_LEAVE,
}
FIXED_DEDUCTION_KEYS = ("food", "drop_leave", "fine", "imam_hadya", "advance")

WEEKDAY_NUMBERS = {
    ClassSchedule.WeekDay.MONDAY: 0,
    ClassSchedule.WeekDay.TUESDAY: 1,
    ClassSchedule.WeekDay.WEDNESDAY: 2,
    ClassSchedule.WeekDay.THURSDAY: 3,
    ClassSchedule.WeekDay.FRIDAY: 4,
    ClassSchedule.WeekDay.SATURDAY: 5,
    ClassSchedule.WeekDay.SUNDAY: 6,
}

METRIC_LABELS = {
    "old_students": "Old Students",
    "new_trials": "New Trials",
    "transferred_from_teacher": "Transferred from another teacher",
    "returns_from_leave": "Returned from leave",
    "transferred_to_other_teachers": "Transferred to another teacher",
    "running": "Running Classes",
    "on_leave": "On Leave Classes",
    "old_dropped": "Old Dropped Classes",
    "trial_dropped": "Trial Dropped Classes",
    "old_dropped_other": "Old Dropped (Other)",
    "not_counted": "Not Counted Classes",
    "active_classes": "Final Active Classes",
    "standard_classes": "3+ Day Classes",
    "three_day_classes": "Exactly 3-Day Classes",
    "half_classes": "Half-Month Classes",
    "manual_review_classes": "Manual Review Classes",
    "english_classes": "English-Language Classes",
    "night_classes": "Night Classes",
    "lesson_filled": "Lesson-Filled Classes",
    "reference_students": "Reference Students",
    "attendance": "Student Attendance",
    "monthly_drops": "Monthly Student Drops",
    "students_on_leave": "Students On Leave",
}


def money(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0.00")


def decimal_text(value: Any) -> str:
    return format(money(value), ".2f")


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
    if student.class_status == StudentProfile.ClassStatus.NOT_COUNTED:
        effective = student.status_effective_date
        if effective and (effective.year, effective.month) < (year, month):
            return StudentProfile.ClassStatus.RUNNING
    return student.class_status


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


def _history_queryset():
    return StudentClassHistory.objects.select_related(
        "previous_teacher__user", "new_teacher__user"
    ).order_by("effective_date", "created_at", "id")


def _schedule_queryset():
    return ClassSchedule.objects.order_by("weekday", "time_slot", "id")


def _teacher_students(teacher: TeacherProfile):
    history_ids = StudentClassHistory.objects.filter(
        Q(previous_teacher=teacher) | Q(new_teacher=teacher)
    ).values_list("student_id", flat=True)
    return list(
        StudentProfile.objects.select_related(
            "user", "teacher__user", "referral_teacher__user"
        )
        .prefetch_related(
            Prefetch("class_history", queryset=_history_queryset(), to_attr="salary_history"),
            Prefetch("schedules", queryset=_schedule_queryset(), to_attr="salary_schedules"),
        )
        .filter(Q(teacher=teacher) | Q(id__in=history_ids))
        .distinct()
        .order_by("user__first_name", "user__username", "id")
    )


def _initial_enrollment_date(student: StudentProfile, histories) -> date:
    enrolled = next(
        (row.effective_date for row in histories if row.event_type == StudentClassHistory.EventType.ENROLLED),
        None,
    )
    if enrolled:
        return enrolled
    joined = getattr(student.user, "date_joined", None)
    if joined:
        return timezone.localtime(joined).date() if timezone.is_aware(joined) else joined.date()
    return student.status_effective_date or timezone.localdate()


def _apply_history_event(state: dict[str, Any], row: StudentClassHistory):
    if row.event_type == StudentClassHistory.EventType.ENROLLED:
        if row.new_teacher_id:
            state["teacher_id"] = row.new_teacher_id
        if row.new_student_type:
            state["student_type"] = row.new_student_type
        if row.new_class_status:
            state["class_status"] = row.new_class_status
            state["status_date"] = row.effective_date
        state["enrolled"] = True
        return

    if row.event_type == StudentClassHistory.EventType.TEACHER_TRANSFER and row.new_teacher_id:
        state["teacher_id"] = row.new_teacher_id
    if row.new_student_type:
        state["student_type"] = row.new_student_type
    if row.new_class_status:
        state["class_status"] = row.new_class_status
        state["status_date"] = row.effective_date


def _effective_status_for_day(raw_status: str, status_date: date | None, day: date) -> str:
    if raw_status == StudentProfile.ClassStatus.NOT_COUNTED and status_date:
        if (status_date.year, status_date.month) < (day.year, day.month):
            return StudentProfile.ClassStatus.RUNNING
    return raw_status


def _dates_for_weekdays(start: date, end: date, weekdays: set[int]):
    result = set()
    current = start
    while current <= end:
        if current.weekday() in weekdays:
            result.add(current)
        current += timedelta(days=1)
    return result


def _student_month_record(student: StudentProfile, teacher: TeacherProfile, year: int, month: int):
    start, end = month_bounds(year, month)
    histories = list(getattr(student, "salary_history", []))
    enrollment_date = _initial_enrollment_date(student, histories)

    state = {
        "enrolled": False,
        "teacher_id": None,
        "student_type": student.student_type,
        "class_status": student.class_status,
        "status_date": student.status_effective_date or enrollment_date,
    }

    synthetic_enrollment = not any(
        row.event_type == StudentClassHistory.EventType.ENROLLED for row in histories
    )
    events_by_date: dict[date, list[StudentClassHistory]] = defaultdict(list)
    for row in histories:
        events_by_date[row.effective_date].append(row)

    if synthetic_enrollment:
        state.update({
            "enrolled": enrollment_date <= start,
            "teacher_id": student.teacher_id if enrollment_date <= start else None,
        })

    for row in histories:
        if row.effective_date < start:
            _apply_history_event(state, row)

    daily_states = []
    current = start
    while current <= end:
        if synthetic_enrollment and current == enrollment_date:
            state["enrolled"] = True
            state["teacher_id"] = student.teacher_id
            state["student_type"] = student.student_type
            state["class_status"] = student.class_status
            state["status_date"] = student.status_effective_date or enrollment_date

        for row in events_by_date.get(current, []):
            _apply_history_event(state, row)

        if state["enrolled"] and current >= enrollment_date:
            effective_status = _effective_status_for_day(
                state["class_status"], state.get("status_date"), current
            )
            daily_states.append({
                "date": current,
                "teacher_id": state["teacher_id"],
                "student_type": state["student_type"],
                "class_status": effective_status,
            })
        current += timedelta(days=1)

    assigned_states = [row for row in daily_states if row["teacher_id"] == teacher.id]
    if not assigned_states:
        return None

    assigned_dates = {row["date"] for row in assigned_states}
    salary_active_dates = {
        row["date"]
        for row in assigned_states
        if row["class_status"] not in DROPPED_STATUSES
        and row["class_status"] != StudentProfile.ClassStatus.NOT_COUNTED
    }
    final_row = assigned_states[-1]
    end_state = next((row for row in reversed(daily_states) if row["date"] == end), None)
    active_at_end = bool(
        end_state
        and end_state["teacher_id"] == teacher.id
        and end_state["class_status"] in ACTIVE_STATUSES
    )

    month_events = [row for row in histories if start <= row.effective_date <= end]
    transferred_in = any(
        row.event_type == StudentClassHistory.EventType.TEACHER_TRANSFER
        and row.new_teacher_id == teacher.id
        and row.previous_teacher_id != teacher.id
        for row in month_events
    )
    transferred_out = any(
        row.event_type == StudentClassHistory.EventType.TEACHER_TRANSFER
        and row.previous_teacher_id == teacher.id
        and row.new_teacher_id != teacher.id
        for row in month_events
    )
    returned_from_leave = any(
        row.event_type == StudentClassHistory.EventType.RETURNED_FROM_LEAVE
        and row.new_teacher_id == teacher.id
        for row in month_events
    )

    all_schedules = list(getattr(student, "salary_schedules", []))
    schedules = [row for row in all_schedules if row.teacher_id == teacher.id]
    if not schedules:
        schedules = all_schedules
    weekdays = {WEEKDAY_NUMBERS[row.weekday] for row in schedules if row.weekday in WEEKDAY_NUMBERS}
    full_expected_dates = _dates_for_weekdays(start, end, weekdays) if weekdays else set()
    active_expected_dates = full_expected_dates & salary_active_dates

    if full_expected_dates:
        is_half_month = bool(active_expected_dates) and (
            len(active_expected_dates) * 2 <= len(full_expected_dates)
        )
    else:
        is_half_month = bool(salary_active_dates) and (
            len(salary_active_dates) * 2 <= (end - start).days + 1
        )

    days_count = len({row.weekday for row in schedules})
    primary_type = final_row["student_type"] or student.student_type
    # Student-type breakdowns are deliberately mutually exclusive. A class
    # transferred away during the selected month must not also inflate the
    # teacher's Old Student count.
    if transferred_out:
        type_bucket = "transferred_to_other_teachers"
    elif transferred_in:
        type_bucket = "transferred_from_teacher"
    elif returned_from_leave:
        type_bucket = "returns_from_leave"
    elif primary_type == StudentProfile.StudentType.TRIAL_STUDENT:
        type_bucket = "new_trials"
    else:
        type_bucket = "old_students"

    final_status = final_row["class_status"]
    if final_status not in {
        StudentProfile.ClassStatus.RUNNING,
        StudentProfile.ClassStatus.ON_LEAVE,
        StudentProfile.ClassStatus.OLD_DROPPED,
        StudentProfile.ClassStatus.TRIAL_DROPPED,
        StudentProfile.ClassStatus.OLD_DROPPED_OTHER,
        StudentProfile.ClassStatus.NOT_COUNTED,
    }:
        final_status = StudentProfile.ClassStatus.RUNNING

    return {
        "student": student,
        "student_id": student.id,
        "student_name": str(student),
        "username": student.user.username,
        "enrollment_date": enrollment_date,
        "assignment_start": min(assigned_dates),
        "assignment_end": max(assigned_dates),
        "assigned_dates": assigned_dates,
        "salary_active_dates": salary_active_dates,
        "student_type": primary_type,
        "type_bucket": type_bucket,
        "class_status": final_status,
        "transferred_in": transferred_in,
        "transferred_out": transferred_out,
        "returned_from_leave": returned_from_leave,
        "active_at_end": active_at_end,
        "is_half_month": is_half_month,
        "days_count": days_count,
        "class_days": sorted({row.get_weekday_display() for row in schedules}),
        "time_slots": sorted({row.time_slot.strftime("%H:%M") for row in schedules}),
        "full_expected_dates": full_expected_dates,
        "active_expected_dates": active_expected_dates,
        "is_night": any(is_night_time(row.time_slot, time(22, 0), time(8, 30)) for row in schedules),
    }


def build_teacher_month_records(teacher: TeacherProfile, year: int, month: int, config=None):
    config = config or salary_configuration_for_department(teacher.department)
    records = []
    for student in _teacher_students(teacher):
        row = _student_month_record(student, teacher, year, month)
        if not row:
            continue
        schedules = list(getattr(student, "salary_schedules", []))
        teacher_schedules = [item for item in schedules if item.teacher_id == teacher.id] or schedules
        row["is_night"] = any(
            is_night_time(item.time_slot, config.night_start, config.night_end)
            for item in teacher_schedules
        )
        records.append(row)
    return records


def expected_lesson_dates_for_record(record, cutoff: date):
    return {day for day in record["active_expected_dates"] if day <= cutoff}


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


def normalize_deductions(value):
    value = value if isinstance(value, dict) else {}
    fixed = {key: money(value.get(key, 0)) for key in FIXED_DEDUCTION_KEYS}
    manual = []
    for row in value.get("manual", []) if isinstance(value.get("manual", []), list) else []:
        reason = str((row or {}).get("reason", "") or "").strip()
        amount = money((row or {}).get("amount", 0))
        if amount and reason:
            manual.append({"reason": reason, "amount": decimal_text(amount)})
    total = sum(fixed.values(), Decimal("0.00")) + sum(
        (money(row["amount"]) for row in manual), Decimal("0.00")
    )
    payload = {key: decimal_text(amount) for key, amount in fixed.items()}
    payload["manual"] = manual
    return payload, total


def _metric_ids(records, predicate):
    return sorted({row["student_id"] for row in records if predicate(row)})


def calculate_teacher_salary(teacher, year: int, month: int, config, slip=None):
    start, end = month_bounds(year, month)
    today = timezone.localdate()
    lesson_cutoff = min(end, today) if (year, month) >= (today.year, today.month) else end
    records = build_teacher_month_records(teacher, year, month, config)

    type_breakdown = Counter(row["type_bucket"] for row in records)
    transferred_out_ids = {row["student_id"] for row in records if row["transferred_out"]}
    type_payload = {
        "old_students": type_breakdown.get("old_students", 0),
        "transferred_from_teacher": type_breakdown.get("transferred_from_teacher", 0),
        "new_trials": type_breakdown.get("new_trials", 0),
        "returns_from_leave": type_breakdown.get("returns_from_leave", 0),
        "transferred_to_other_teachers": type_breakdown.get("transferred_to_other_teachers", 0),
        "grand_total": len({row["student_id"] for row in records}),
    }

    status_breakdown = Counter(row["class_status"] for row in records)
    status_payload = {
        "running": status_breakdown.get(StudentProfile.ClassStatus.RUNNING, 0),
        "on_leave": status_breakdown.get(StudentProfile.ClassStatus.ON_LEAVE, 0),
        "old_dropped": status_breakdown.get(StudentProfile.ClassStatus.OLD_DROPPED, 0),
        "trial_dropped": status_breakdown.get(StudentProfile.ClassStatus.TRIAL_DROPPED, 0),
        "old_dropped_other": status_breakdown.get(StudentProfile.ClassStatus.OLD_DROPPED_OTHER, 0),
        "not_counted": status_breakdown.get(StudentProfile.ClassStatus.NOT_COUNTED, 0),
        "grand_total": len({row["student_id"] for row in records}),
    }

    salary_records = [
        row for row in records
        if row["salary_active_dates"]
        and row["class_status"] != StudentProfile.ClassStatus.NOT_COUNTED
    ]
    half_records = [row for row in salary_records if row["is_half_month"]]
    full_records = [row for row in salary_records if not row["is_half_month"]]
    standard_records = [row for row in full_records if row["days_count"] >= 4]
    three_day_records = [row for row in full_records if row["days_count"] == 3]
    review_records = [row for row in full_records if row["days_count"] < 3]
    active_records = [row for row in records if row["active_at_end"]]

    total_tier_classes = len(standard_records) + len(three_day_records)
    standard_rate = resolve_rate(config.standard_tiers, total_tier_classes)
    three_day_rate = resolve_rate(config.three_day_tiers, total_tier_classes)
    standard_salary = standard_rate * len(standard_records)
    three_day_salary = three_day_rate * len(three_day_records)

    half_override_map = {}
    if slip:
        for row in slip.half_class_overrides or []:
            try:
                half_override_map[int(row.get("student_id"))] = money(row.get("amount"))
            except (TypeError, ValueError):
                continue
    half_rows = []
    half_salary = Decimal("0.00")
    for record in half_records:
        amount = half_override_map.get(record["student_id"], Decimal("0.00"))
        half_salary += amount
        half_rows.append({
            "student_id": record["student_id"],
            "student_name": record["student_name"],
            "amount": decimal_text(amount),
            "active_sessions": len(record["active_expected_dates"]),
            "full_month_sessions": len(record["full_expected_dates"]),
            "assignment_start": str(record["assignment_start"]),
            "assignment_end": str(record["assignment_end"]),
        })

    relevant_student_ids = [row["student_id"] for row in records]
    lesson_report_dates = set(
        DailyLessonReport.objects.filter(
            teacher=teacher,
            student_id__in=relevant_student_ids,
            date__range=(start, lesson_cutoff),
        ).values_list("student_id", "date").distinct()
    )
    lesson_filled_records = []
    lesson_missing_records = []
    for record in salary_records:
        expected = expected_lesson_dates_for_record(record, lesson_cutoff)
        actual = {row_date for student_id, row_date in lesson_report_dates if student_id == record["student_id"]}
        if expected and expected.issubset(actual):
            lesson_filled_records.append(record)
        else:
            lesson_missing_records.append(record)

    bonus_rates = config.bonus_rates or {}
    english_records = [
        row for row in salary_records
        if row["student"].speaking_language == StudentProfile.SpeakingLanguage.ENGLISH
    ]
    night_records = [row for row in salary_records if row["is_night"]]

    reference_students = list(
        StudentProfile.objects.select_related("user", "teacher__user")
        .filter(
            referral_teacher=teacher,
            user__is_active=True,
            user__date_joined__date__range=(start, end),
        )
        .distinct()
    )
    reference_students = [
        student for student in reference_students
        if effective_class_status(student, year, month) not in DROPPED_STATUSES
    ]

    english_bonus = money(bonus_rates.get("english")) * len(english_records)
    lesson_bonus = money(bonus_rates.get("lesson_filled")) * len(lesson_filled_records)
    night_bonus = money(bonus_rates.get("night")) * len(night_records)
    reference_bonus = money(bonus_rates.get("reference")) * len(reference_students)

    attendance_rows = list(
        Attendance.objects.filter(
            entity_type=Attendance.EntityType.STUDENT,
            student_id__in=relevant_student_ids,
            date__range=(start, end),
        )
        .values("student_id", "date", "status")
        .distinct()
    )
    total_student_attendance = len(attendance_rows)
    present_student_attendance = sum(1 for row in attendance_rows if row["status"] == Attendance.Status.PRESENT)
    attendance_rate = (
        (Decimal(present_student_attendance) * Decimal("100") / Decimal(total_student_attendance)).quantize(Decimal("0.1"))
        if total_student_attendance else Decimal("0.0")
    )

    monthly_drop_ids = set(
        StudentClassHistory.objects.filter(
            effective_date__range=(start, end),
            new_teacher=teacher,
            new_class_status__in={
                StudentProfile.ClassStatus.OLD_DROPPED,
                StudentProfile.ClassStatus.TRIAL_DROPPED,
            },
        ).values_list("student_id", flat=True).distinct()
    )
    teacher_leave_count = Attendance.objects.filter(
        entity_type=Attendance.EntityType.TEACHER,
        teacher=teacher,
        date__range=(start, end),
        status=Attendance.Status.LEAVE,
    ).values("date", "class_key").distinct().count()
    on_leave_records = [row for row in records if row["class_status"] == StudentProfile.ClassStatus.ON_LEAVE]

    criteria = {
        "attendance_70": attendance_rate >= Decimal("70"),
        "zero_drops": len(monthly_drop_ids) == 0,
        "teacher_leave_max_one": teacher_leave_count <= 1,
        "all_lessons_filled": bool(salary_records) and len(lesson_filled_records) == len(salary_records),
        "good_behavior": bool(getattr(slip, "behavior_good", False)),
        "zero_students_on_leave": len(on_leave_records) == 0,
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
        other_rows.append({"reason": reason, "amount": decimal_text(amount)})
        other_total += amount

    base_salary_calculated = standard_salary + three_day_salary + half_salary
    overrides = getattr(slip, "override_values", None) or {}
    base_salary, base_overridden = _override_component(overrides, "base_salary", base_salary_calculated)
    english_final, english_overridden = _override_component(overrides, "english_bonus", english_bonus)
    lesson_final, lesson_overridden = _override_component(overrides, "lesson_bonus", lesson_bonus)
    night_final, night_overridden = _override_component(overrides, "night_bonus", night_bonus)
    reference_final, reference_overridden = _override_component(overrides, "reference_bonus", reference_bonus)
    achievement_final, achievement_overridden = _override_component(overrides, "achievement_bonus", calculated_achievement)

    automatic_gross = (
        base_salary_calculated + english_bonus + lesson_bonus + night_bonus
        + reference_bonus + calculated_achievement + other_total
    )
    component_gross = (
        base_salary + english_final + lesson_final + night_final
        + reference_final + achievement_final + other_total
    )
    gross_total, gross_overridden = _override_component(overrides, "gross_total", component_gross)

    deduction_payload, deduction_total = normalize_deductions(getattr(slip, "deductions", None))
    calculated_net = max(Decimal("0.00"), gross_total - deduction_total)
    final_total, final_overridden = _override_component(overrides, "final_total", calculated_net)
    final_total = max(Decimal("0.00"), final_total)

    metric_student_ids = {
        "old_students": _metric_ids(records, lambda row: row["type_bucket"] == "old_students"),
        "new_trials": _metric_ids(records, lambda row: row["type_bucket"] == "new_trials"),
        "transferred_from_teacher": _metric_ids(records, lambda row: row["type_bucket"] == "transferred_from_teacher"),
        "returns_from_leave": _metric_ids(records, lambda row: row["type_bucket"] == "returns_from_leave"),
        "transferred_to_other_teachers": _metric_ids(records, lambda row: row["type_bucket"] == "transferred_to_other_teachers"),
        "running": _metric_ids(records, lambda row: row["class_status"] == StudentProfile.ClassStatus.RUNNING),
        "on_leave": _metric_ids(records, lambda row: row["class_status"] == StudentProfile.ClassStatus.ON_LEAVE),
        "old_dropped": _metric_ids(records, lambda row: row["class_status"] == StudentProfile.ClassStatus.OLD_DROPPED),
        "trial_dropped": _metric_ids(records, lambda row: row["class_status"] == StudentProfile.ClassStatus.TRIAL_DROPPED),
        "old_dropped_other": _metric_ids(records, lambda row: row["class_status"] == StudentProfile.ClassStatus.OLD_DROPPED_OTHER),
        "not_counted": _metric_ids(records, lambda row: row["class_status"] == StudentProfile.ClassStatus.NOT_COUNTED),
        "active_classes": _metric_ids(records, lambda row: row["active_at_end"]),
        "standard_classes": sorted(row["student_id"] for row in standard_records),
        "three_day_classes": sorted(row["student_id"] for row in three_day_records),
        "half_classes": sorted(row["student_id"] for row in half_records),
        "manual_review_classes": sorted(row["student_id"] for row in review_records),
        "english_classes": sorted(row["student_id"] for row in english_records),
        "night_classes": sorted(row["student_id"] for row in night_records),
        "lesson_filled": sorted(row["student_id"] for row in lesson_filled_records),
        "reference_students": sorted(student.id for student in reference_students),
        "attendance": sorted({row["student_id"] for row in records}),
        "monthly_drops": sorted(monthly_drop_ids),
        "students_on_leave": sorted(row["student_id"] for row in on_leave_records),
    }

    snapshot = {
        "teacher_id": teacher.id,
        "teacher_name": str(teacher),
        "month": month,
        "year": year,
        "student_type_breakdown": type_payload,
        "class_status_breakdown": status_payload,
        "final_active_classes": len(active_records),
        "salary_counted_classes": len(standard_records) + len(three_day_records) + len(half_records),
        "standard_classes": len(standard_records),
        "three_day_classes": len(three_day_records),
        "half_classes": len(half_records),
        "manual_review_classes": len(review_records),
        "not_counted_classes": status_payload["not_counted"],
        "dropped_classes": status_payload["old_dropped"] + status_payload["trial_dropped"] + status_payload["old_dropped_other"],
        "standard_rate": decimal_text(standard_rate),
        "three_day_rate": decimal_text(three_day_rate),
        "standard_salary": decimal_text(standard_salary),
        "three_day_salary": decimal_text(three_day_salary),
        "half_class_salary": decimal_text(half_salary),
        "half_class_rows": half_rows,
        "english_class_count": len(english_records),
        "lesson_filled_count": len(lesson_filled_records),
        "lesson_missing_count": len(lesson_missing_records),
        "night_class_count": len(night_records),
        "reference_student_count": len(reference_students),
        "attendance_rate": float(attendance_rate),
        "monthly_drop_count": len(monthly_drop_ids),
        "teacher_leave_count": teacher_leave_count,
        "students_on_leave": len(on_leave_records),
        "achievement_criteria": criteria,
        "achievement_points": points,
        "metric_student_ids": metric_student_ids,
        "calculated_components": {
            "base_salary": decimal_text(base_salary_calculated),
            "english_bonus": decimal_text(english_bonus),
            "lesson_bonus": decimal_text(lesson_bonus),
            "night_bonus": decimal_text(night_bonus),
            "reference_bonus": decimal_text(reference_bonus),
            "achievement_bonus": decimal_text(calculated_achievement),
            "other_bonuses": decimal_text(other_total),
            "gross_total": decimal_text(automatic_gross),
        },
        "final_components": {
            "base_salary": decimal_text(base_salary),
            "english_bonus": decimal_text(english_final),
            "lesson_bonus": decimal_text(lesson_final),
            "night_bonus": decimal_text(night_final),
            "reference_bonus": decimal_text(reference_final),
            "achievement_bonus": decimal_text(achievement_final),
            "other_bonuses": decimal_text(other_total),
            "gross_total": decimal_text(gross_total),
        },
        "deductions": deduction_payload,
        "deduction_total": decimal_text(deduction_total),
        "gross_total": decimal_text(gross_total),
        "net_total": decimal_text(final_total),
        "override_flags": {
            "base_salary": base_overridden,
            "english_bonus": english_overridden,
            "lesson_bonus": lesson_overridden,
            "night_bonus": night_overridden,
            "reference_bonus": reference_overridden,
            "achievement_bonus": achievement_overridden,
            "gross_total": gross_overridden,
            "final_total": final_overridden,
        },
        "other_bonuses": other_rows,
        "calculated_total": decimal_text(automatic_gross),
        "final_total": decimal_text(final_total),
    }
    return snapshot, automatic_gross, gross_total, deduction_total, final_total


def refresh_salary_slip(slip, actor=None, force=False):
    if slip.status == TeacherSalarySlip.Status.PROCESSED and not force:
        return slip
    config = salary_configuration_for_department(slip.department, actor)
    snapshot, calculated_total, gross_total, deduction_total, final_total = calculate_teacher_salary(
        slip.teacher,
        slip.year,
        slip.month,
        config,
        slip,
    )
    slip.calculated_snapshot = snapshot
    slip.calculated_total = calculated_total
    slip.gross_total = gross_total
    slip.deduction_total = deduction_total
    slip.final_total = final_total
    slip.updated_by = actor
    slip.save(update_fields=[
        "calculated_snapshot",
        "calculated_total",
        "gross_total",
        "deduction_total",
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
        "deductions": slip.deductions or {},
        "override_values": slip.override_values or {},
        "calculated_snapshot": snapshot,
        "calculated_total": decimal_text(slip.calculated_total),
        "gross_total": decimal_text(slip.gross_total),
        "deduction_total": decimal_text(slip.deduction_total),
        "final_total": decimal_text(slip.final_total),
        "net_total": decimal_text(slip.final_total),
        "status": slip.status,
        "admin_note": slip.admin_note,
        "processed_at": slip.processed_at.isoformat() if slip.processed_at else None,
        "updated_at": slip.updated_at.isoformat() if slip.updated_at else None,
    }


def _record_status_label(value):
    return dict(StudentProfile.ClassStatus.choices).get(value, value)


def _record_type_label(value):
    return dict(StudentProfile.StudentType.choices).get(value, value)


def salary_audit_payload(teacher, year: int, month: int, metric: str, slip=None, department=None):
    if metric not in METRIC_LABELS:
        raise ValueError("Unsupported salary proof metric.")
    start, end = month_bounds(year, month)
    resolved_department = department or teacher.department or getattr(teacher.user, "department", None)
    if not resolved_department:
        raise ValueError("Teacher department is required for salary proof.")
    config = salary_configuration_for_department(resolved_department)
    records = build_teacher_month_records(teacher, year, month, config)
    record_map = {row["student_id"]: row for row in records}

    ids = None
    if slip:
        ids = (slip.calculated_snapshot or {}).get("metric_student_ids", {}).get(metric)
    if ids is None:
        # Calculate a temporary snapshot to guarantee the proof set matches the salary engine.
        temp_snapshot, *_ = calculate_teacher_salary(teacher, year, month, config, slip)
        ids = temp_snapshot.get("metric_student_ids", {}).get(metric, [])
    ids = [int(value) for value in ids or []]

    # Reference students may not currently be assigned to the referring teacher.
    missing_ids = [student_id for student_id in ids if student_id not in record_map]
    if missing_ids:
        extra_students = StudentProfile.objects.select_related("user", "teacher__user").filter(id__in=missing_ids)
        for student in extra_students:
            record_map[student.id] = {
                "student": student,
                "student_id": student.id,
                "student_name": str(student),
                "username": student.user.username,
                "enrollment_date": timezone.localtime(student.user.date_joined).date() if timezone.is_aware(student.user.date_joined) else student.user.date_joined.date(),
                "assignment_start": start,
                "assignment_end": end,
                "student_type": student.student_type,
                "class_status": effective_class_status(student, year, month),
                "class_days": [],
                "time_slots": [],
                "full_expected_dates": set(),
                "active_expected_dates": set(),
            }

    attendance_by_student: dict[int, dict[date, str]] = defaultdict(dict)
    for row in Attendance.objects.filter(
        entity_type=Attendance.EntityType.STUDENT,
        student_id__in=ids,
        date__range=(start, end),
    ).values("student_id", "date", "status").distinct():
        attendance_by_student[row["student_id"]][row["date"]] = row["status"]

    lesson_dates = set(
        DailyLessonReport.objects.filter(
            teacher=teacher,
            student_id__in=ids,
            date__range=(start, end),
        ).values_list("student_id", "date").distinct()
    )

    rows = []
    for student_id in ids:
        record = record_map.get(student_id)
        if not record:
            continue
        attendance = []
        present = absent = leave = 0
        current = start
        scheduled_dates = set(record.get("full_expected_dates", set()))
        while current <= end:
            status_value = attendance_by_student.get(student_id, {}).get(current, "not_marked")
            if status_value == Attendance.Status.PRESENT:
                present += 1
            elif status_value == Attendance.Status.ABSENT:
                absent += 1
            elif status_value == Attendance.Status.LEAVE:
                leave += 1
            attendance.append({
                "date": str(current),
                "status": status_value,
                "scheduled": current in scheduled_dates,
                "lesson_logged": (student_id, current) in lesson_dates,
            })
            current += timedelta(days=1)

        rows.append({
            "student_id": student_id,
            "student_name": record["student_name"],
            "username": record["username"],
            "enrollment_date": str(record["enrollment_date"]),
            "student_type": record["student_type"],
            "student_type_label": _record_type_label(record["student_type"]),
            "class_status": record["class_status"],
            "class_status_label": _record_status_label(record["class_status"]),
            "assignment_start": str(record["assignment_start"]),
            "assignment_end": str(record["assignment_end"]),
            "class_days": record.get("class_days", []),
            "time_slots": record.get("time_slots", []),
            "active_sessions": len(record.get("active_expected_dates", set())),
            "full_month_sessions": len(record.get("full_expected_dates", set())),
            "attendance_summary": {
                "present": present,
                "absent": absent,
                "leave": leave,
                "marked": present + absent + leave,
            },
            "attendance": attendance,
        })

    return {
        "metric": metric,
        "label": METRIC_LABELS[metric],
        "count": len(rows),
        "month": month,
        "year": year,
        "teacher": {
            "id": teacher.id,
            "name": str(teacher),
            "username": teacher.user.username,
        },
        "rows": rows,
    }
