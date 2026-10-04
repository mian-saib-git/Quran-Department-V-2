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
    "achievement_points": "Achievement Points",
    "source_records": "Full Student Source Records",
    "calculation_audit": "Full Salary Calculation Audit",
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

def _override_count(overrides, key, calculated):
    raw = (overrides or {}).get(key)
    if raw in (None, ""):
        return max(0, int(calculated or 0)), False
    try:
        value = Decimal(str(raw))
        if value < 0 or value != value.to_integral_value():
            raise ValueError
        return int(value), True
    except (InvalidOperation, TypeError, ValueError):
        return max(0, int(calculated or 0)), False


def _audit_step(
    step_id,
    group,
    label,
    formula,
    automatic_value,
    effective_value,
    *,
    metric=None,
    automatic_inputs=None,
    effective_inputs=None,
    overridden=False,
    note="",
    value_kind="money",
):
    automatic_display = str(int(automatic_value)) if value_kind == "count" else decimal_text(automatic_value)
    effective_display = str(int(effective_value)) if value_kind == "count" else decimal_text(effective_value)
    return {
        "id": step_id,
        "group": group,
        "label": label,
        "formula": formula,
        "automatic_value": automatic_display,
        "effective_value": effective_display,
        "value_kind": value_kind,
        "automatic_inputs": automatic_inputs or {},
        "effective_inputs": effective_inputs or {},
        "overridden": bool(overridden),
        "metric": metric,
        "note": note,
    }


METRIC_AUDIT_STEPS = {
    "active_classes": ["active_classes"],
    "standard_classes": ["standard_salary", "base_salary"],
    "three_day_classes": ["three_day_salary", "base_salary"],
    "half_classes": ["half_month_salary", "base_salary"],
    "manual_review_classes": ["manual_review_salary", "base_salary"],
    "english_classes": ["english_bonus"],
    "night_classes": ["night_bonus"],
    "lesson_filled": ["lesson_bonus"],
    "reference_students": ["reference_bonus"],
    "attendance": ["achievement_points", "achievement_bonus"],
    "monthly_drops": ["achievement_points", "achievement_bonus"],
    "students_on_leave": ["achievement_points", "achievement_bonus"],
    "achievement_points": ["achievement_points", "achievement_bonus"],
    "calculation_audit": [
        "active_classes", "standard_salary", "three_day_salary",
        "half_month_salary", "manual_review_salary", "base_salary",
        "english_bonus", "lesson_bonus", "night_bonus",
        "reference_bonus", "achievement_points", "achievement_bonus",
        "other_bonuses", "gross_salary", "deductions", "net_salary",
    ],
}


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
    record_by_student = {row["student_id"]: row for row in records}

    type_breakdown = Counter(row["type_bucket"] for row in records)
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

    # A class can appear in the monthly history but is salary-counted only when
    # it had active assigned days in the requested month and is not Not Counted.
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

    overrides = getattr(slip, "override_values", None) or {}

    auto_standard_count = len(standard_records)
    auto_three_day_count = len(three_day_records)
    effective_standard_count, standard_count_overridden = _override_count(
        overrides, "standard_class_count", auto_standard_count
    )
    effective_three_day_count, three_day_count_overridden = _override_count(
        overrides, "three_day_class_count", auto_three_day_count
    )

    # The original salary rule selects the tier from the teacher's total final
    # active class load, not only from the subset that happens to be 3 or 4+ days.
    automatic_tier_basis = len(active_records)
    effective_tier_basis, tier_basis_overridden = _override_count(
        overrides, "tier_basis_class_count", automatic_tier_basis
    )
    auto_standard_rate = resolve_rate(config.standard_tiers, automatic_tier_basis)
    auto_three_day_rate = resolve_rate(config.three_day_tiers, automatic_tier_basis)
    selected_standard_rate = resolve_rate(config.standard_tiers, effective_tier_basis)
    selected_three_day_rate = resolve_rate(config.three_day_tiers, effective_tier_basis)
    effective_standard_rate, standard_rate_overridden = _override_component(
        overrides, "standard_rate", selected_standard_rate
    )
    effective_three_day_rate, three_day_rate_overridden = _override_component(
        overrides, "three_day_rate", selected_three_day_rate
    )

    automatic_standard_salary = auto_standard_rate * auto_standard_count
    automatic_three_day_salary = auto_three_day_rate * auto_three_day_count
    adjusted_standard_salary = effective_standard_rate * effective_standard_count
    adjusted_three_day_salary = effective_three_day_rate * effective_three_day_count

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

    manual_review_salary, manual_review_salary_overridden = _override_component(
        overrides, "manual_review_salary", Decimal("0.00")
    )

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
        actual = {
            row_date for student_id, row_date in lesson_report_dates
            if student_id == record["student_id"]
        }
        if expected and expected.issubset(actual):
            lesson_filled_records.append(record)
        else:
            lesson_missing_records.append(record)

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

    bonus_rates = config.bonus_rates or {}
    automatic_bonus_counts = {
        "english": len(english_records),
        "lesson": len(lesson_filled_records),
        "night": len(night_records),
        "reference": len(reference_students),
    }
    effective_english_count, english_count_overridden = _override_count(
        overrides, "english_class_count", automatic_bonus_counts["english"]
    )
    effective_lesson_count, lesson_count_overridden = _override_count(
        overrides, "lesson_filled_count", automatic_bonus_counts["lesson"]
    )
    effective_night_count, night_count_overridden = _override_count(
        overrides, "night_class_count", automatic_bonus_counts["night"]
    )
    effective_reference_count, reference_count_overridden = _override_count(
        overrides, "reference_student_count", automatic_bonus_counts["reference"]
    )

    auto_english_rate = money(bonus_rates.get("english"))
    auto_lesson_rate = money(bonus_rates.get("lesson_filled"))
    auto_night_rate = money(bonus_rates.get("night"))
    auto_reference_rate = money(bonus_rates.get("reference"))
    effective_english_rate, english_rate_overridden = _override_component(overrides, "english_rate", auto_english_rate)
    effective_lesson_rate, lesson_rate_overridden = _override_component(overrides, "lesson_rate", auto_lesson_rate)
    effective_night_rate, night_rate_overridden = _override_component(overrides, "night_rate", auto_night_rate)
    effective_reference_rate, reference_rate_overridden = _override_component(overrides, "reference_rate", auto_reference_rate)

    automatic_english_bonus = auto_english_rate * automatic_bonus_counts["english"]
    automatic_lesson_bonus = auto_lesson_rate * automatic_bonus_counts["lesson"]
    automatic_night_bonus = auto_night_rate * automatic_bonus_counts["night"]
    automatic_reference_bonus = auto_reference_rate * automatic_bonus_counts["reference"]
    adjusted_english_bonus = effective_english_rate * effective_english_count
    adjusted_lesson_bonus = effective_lesson_rate * effective_lesson_count
    adjusted_night_bonus = effective_night_rate * effective_night_count
    adjusted_reference_bonus = effective_reference_rate * effective_reference_count

    # Keep only the latest attendance mark per student/date and only while the
    # student was assigned to this teacher. This avoids duplicate or transferred
    # attendance inflating the percentage.
    attendance_rows = []
    seen_attendance = set()
    attendance_query = Attendance.objects.filter(
        entity_type=Attendance.EntityType.STUDENT,
        student_id__in=relevant_student_ids,
        date__range=(start, end),
    ).order_by("student_id", "date", "-updated_at", "-id").values(
        "student_id", "date", "status"
    )
    for row in attendance_query:
        key = (row["student_id"], row["date"])
        if key in seen_attendance:
            continue
        seen_attendance.add(key)
        record = record_by_student.get(row["student_id"])
        if not record or row["date"] not in record["assigned_dates"]:
            continue
        attendance_rows.append(row)

    total_student_attendance = len(attendance_rows)
    present_student_attendance = sum(
        1 for row in attendance_rows if row["status"] == Attendance.Status.PRESENT
    )
    attendance_rate = (
        (Decimal(present_student_attendance) * Decimal("100") / Decimal(total_student_attendance)).quantize(Decimal("0.1"))
        if total_student_attendance else Decimal("0.0")
    )

    monthly_drop_ids = set(
        StudentClassHistory.objects.filter(
            effective_date__range=(start, end),
            new_teacher=teacher,
            new_class_status__in=DROPPED_STATUSES,
        ).values_list("student_id", flat=True).distinct()
    )
    teacher_leave_count = Attendance.objects.filter(
        entity_type=Attendance.EntityType.TEACHER,
        teacher=teacher,
        date__range=(start, end),
        status=Attendance.Status.LEAVE,
    ).values("date", "class_key").distinct().count()
    on_leave_records = [
        row for row in records
        if row["class_status"] == StudentProfile.ClassStatus.ON_LEAVE
    ]

    criteria = {
        "attendance_70": attendance_rate >= Decimal("70"),
        "zero_drops": len(monthly_drop_ids) == 0,
        "teacher_leave_max_one": teacher_leave_count <= 1,
        "all_lessons_filled": bool(salary_records) and len(lesson_filled_records) == len(salary_records),
        "good_behavior": bool(getattr(slip, "behavior_good", False)),
        "zero_students_on_leave": len(on_leave_records) == 0,
        "active_reference_student": len(reference_students) >= 1,
    }
    point_proofs = [
        {"key": "attendance_70", "label": "Student monthly attendance is 70% or higher", "points": 1, "awarded": criteria["attendance_70"], "actual": f"{attendance_rate}%", "rule": ">= 70%", "proof_metric": "attendance"},
        {"key": "zero_drops", "label": "Zero student drops during the month", "points": 3, "awarded": criteria["zero_drops"], "actual": len(monthly_drop_ids), "rule": "0 drops", "proof_metric": "monthly_drops"},
        {"key": "teacher_leave_max_one", "label": "Teacher took no more than one leave", "points": 1, "awarded": criteria["teacher_leave_max_one"], "actual": teacher_leave_count, "rule": "<= 1 leave", "proof_metric": None},
        {"key": "all_lessons_filled", "label": "Daily lessons logged for all salary-counted students", "points": 1, "awarded": criteria["all_lessons_filled"], "actual": f"{len(lesson_filled_records)}/{len(salary_records)} complete", "rule": "All complete", "proof_metric": "lesson_filled"},
        {"key": "good_behavior", "label": "Good behavior approved by administrator", "points": 1, "awarded": criteria["good_behavior"], "actual": "Approved" if criteria["good_behavior"] else "Not approved", "rule": "Admin approval", "proof_metric": None},
        {"key": "zero_students_on_leave", "label": "Zero students currently on leave", "points": 1, "awarded": criteria["zero_students_on_leave"], "actual": len(on_leave_records), "rule": "0 students", "proof_metric": "students_on_leave"},
        {"key": "active_reference_student", "label": "At least one active reference student joined", "points": 2, "awarded": criteria["active_reference_student"], "actual": len(reference_students), "rule": ">= 1 student", "proof_metric": "reference_students"},
    ]
    automatic_points = sum(row["points"] for row in point_proofs if row["awarded"])
    effective_points, points_overridden = _override_count(overrides, "achievement_points", automatic_points)
    effective_points = min(10, effective_points)
    automatic_achievement = achievement_payout(automatic_points, config.achievement_payouts)
    adjusted_achievement = achievement_payout(effective_points, config.achievement_payouts)

    other_rows = []
    other_total = Decimal("0.00")
    for row in (getattr(slip, "other_bonuses", None) or []):
        reason = str(row.get("reason", "") or "").strip()
        amount = money(row.get("amount"))
        if not reason or amount == 0:
            continue
        other_rows.append({"reason": reason, "amount": decimal_text(amount)})
        other_total += amount

    automatic_base = automatic_standard_salary + automatic_three_day_salary + half_salary
    adjusted_base = adjusted_standard_salary + adjusted_three_day_salary + half_salary + manual_review_salary

    # Component-level amount overrides were retired in favor of transparent
    # count/rate calculators. Existing legacy values are intentionally ignored.
    base_salary, base_overridden = adjusted_base, False
    english_final, english_overridden = adjusted_english_bonus, False
    lesson_final, lesson_overridden = adjusted_lesson_bonus, False
    night_final, night_overridden = adjusted_night_bonus, False
    reference_final, reference_overridden = adjusted_reference_bonus, False
    achievement_final, achievement_overridden = adjusted_achievement, False

    automatic_gross = (
        automatic_base + automatic_english_bonus + automatic_lesson_bonus
        + automatic_night_bonus + automatic_reference_bonus
        + automatic_achievement + other_total
    )
    adjusted_gross = (
        adjusted_base + adjusted_english_bonus + adjusted_lesson_bonus
        + adjusted_night_bonus + adjusted_reference_bonus
        + adjusted_achievement + other_total
    )
    component_gross = (
        base_salary + english_final + lesson_final + night_final
        + reference_final + achievement_final + other_total
    )
    gross_total, gross_overridden = component_gross, False

    deduction_payload, deduction_total = normalize_deductions(getattr(slip, "deductions", None))
    calculated_net = max(Decimal("0.00"), gross_total - deduction_total)
    final_total, final_overridden = calculated_net, False
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
        "attendance": sorted({row["student_id"] for row in attendance_rows}),
        "monthly_drops": sorted(monthly_drop_ids),
        "students_on_leave": sorted(row["student_id"] for row in on_leave_records),
        "source_records": sorted(row["student_id"] for row in records),
    }

    calculation_inputs = {
        "tier_basis_class_count": {"label": "Total active classes used to select salary tier", "automatic": automatic_tier_basis, "effective": effective_tier_basis, "overridden": tier_basis_overridden, "kind": "count"},
        "standard_class_count": {"label": "3+ day class count", "automatic": auto_standard_count, "effective": effective_standard_count, "overridden": standard_count_overridden, "kind": "count"},
        "standard_rate": {"label": "3+ day per-class rate", "automatic": decimal_text(auto_standard_rate), "effective": decimal_text(effective_standard_rate), "overridden": standard_rate_overridden, "kind": "money"},
        "three_day_class_count": {"label": "Exactly 3-day class count", "automatic": auto_three_day_count, "effective": effective_three_day_count, "overridden": three_day_count_overridden, "kind": "count"},
        "three_day_rate": {"label": "Exactly 3-day per-class rate", "automatic": decimal_text(auto_three_day_rate), "effective": decimal_text(effective_three_day_rate), "overridden": three_day_rate_overridden, "kind": "money"},
        "manual_review_salary": {"label": "Manual salary for 1-2 day classes", "automatic": "0.00", "effective": decimal_text(manual_review_salary), "overridden": manual_review_salary_overridden, "kind": "money"},
        "english_class_count": {"label": "English class count", "automatic": automatic_bonus_counts["english"], "effective": effective_english_count, "overridden": english_count_overridden, "kind": "count"},
        "english_rate": {"label": "English bonus rate", "automatic": decimal_text(auto_english_rate), "effective": decimal_text(effective_english_rate), "overridden": english_rate_overridden, "kind": "money"},
        "lesson_filled_count": {"label": "Lesson-filled class count", "automatic": automatic_bonus_counts["lesson"], "effective": effective_lesson_count, "overridden": lesson_count_overridden, "kind": "count"},
        "lesson_rate": {"label": "Lesson bonus rate", "automatic": decimal_text(auto_lesson_rate), "effective": decimal_text(effective_lesson_rate), "overridden": lesson_rate_overridden, "kind": "money"},
        "night_class_count": {"label": "Night class count", "automatic": automatic_bonus_counts["night"], "effective": effective_night_count, "overridden": night_count_overridden, "kind": "count"},
        "night_rate": {"label": "Night bonus rate", "automatic": decimal_text(auto_night_rate), "effective": decimal_text(effective_night_rate), "overridden": night_rate_overridden, "kind": "money"},
        "reference_student_count": {"label": "Reference student count", "automatic": automatic_bonus_counts["reference"], "effective": effective_reference_count, "overridden": reference_count_overridden, "kind": "count"},
        "reference_rate": {"label": "Reference bonus rate", "automatic": decimal_text(auto_reference_rate), "effective": decimal_text(effective_reference_rate), "overridden": reference_rate_overridden, "kind": "money"},
        "achievement_points": {"label": "Achievement points", "automatic": automatic_points, "effective": effective_points, "overridden": points_overridden, "kind": "count"},
    }

    calculation_audit = [
        _audit_step("active_classes", "Class counts", "Final active classes", "Running or On Leave under this teacher on the final day of the selected month", len(active_records), len(active_records), metric="active_classes", automatic_inputs={"student_records": len(records)}, effective_inputs={"student_records": len(records)}, note="Dropped, transferred-out and Not Counted classes are excluded from final active classes.", value_kind="count"),
        _audit_step("standard_salary", "Base salary", "3+ day class salary", "class count × selected tier rate", automatic_standard_salary, adjusted_standard_salary, metric="standard_classes", automatic_inputs={"class_count": auto_standard_count, "tier_basis": automatic_tier_basis, "rate": decimal_text(auto_standard_rate)}, effective_inputs={"class_count": effective_standard_count, "tier_basis": effective_tier_basis, "rate": decimal_text(effective_standard_rate)}, overridden=tier_basis_overridden or standard_count_overridden or standard_rate_overridden),
        _audit_step("three_day_salary", "Base salary", "Exactly 3-day class salary", "class count × selected tier rate", automatic_three_day_salary, adjusted_three_day_salary, metric="three_day_classes", automatic_inputs={"class_count": auto_three_day_count, "tier_basis": automatic_tier_basis, "rate": decimal_text(auto_three_day_rate)}, effective_inputs={"class_count": effective_three_day_count, "tier_basis": effective_tier_basis, "rate": decimal_text(effective_three_day_rate)}, overridden=tier_basis_overridden or three_day_count_overridden or three_day_rate_overridden),
        _audit_step("half_month_salary", "Base salary", "Half-month class salary", "sum of administrator-entered amounts for auto-detected half-month classes", half_salary, half_salary, metric="half_classes", automatic_inputs={"class_count": len(half_records)}, effective_inputs={"class_count": len(half_records)}, overridden=bool(half_override_map), note="The count is automatic. Each class amount is entered manually."),
        _audit_step("manual_review_salary", "Base salary", "1-2 day manual-review salary", "administrator-entered total for classes without an automatic rate rule", Decimal("0.00"), manual_review_salary, metric="manual_review_classes", automatic_inputs={"class_count": len(review_records)}, effective_inputs={"class_count": len(review_records)}, overridden=manual_review_salary_overridden, note="No automatic rate was provided for 1-2 day schedules."),
        _audit_step("base_salary", "Base salary", "Total base class salary", "3+ day salary + 3-day salary + half-month salary + manual-review salary", automatic_base, base_salary, automatic_inputs={"standard": decimal_text(automatic_standard_salary), "three_day": decimal_text(automatic_three_day_salary), "half_month": decimal_text(half_salary), "manual_review": "0.00"}, effective_inputs={"standard": decimal_text(adjusted_standard_salary), "three_day": decimal_text(adjusted_three_day_salary), "half_month": decimal_text(half_salary), "manual_review": decimal_text(manual_review_salary)}, overridden=base_overridden or tier_basis_overridden or standard_count_overridden or standard_rate_overridden or three_day_count_overridden or three_day_rate_overridden or manual_review_salary_overridden),
        _audit_step("english_bonus", "Bonuses", "English language bonus", "English class count × English bonus rate", automatic_english_bonus, english_final, metric="english_classes", automatic_inputs={"count": automatic_bonus_counts["english"], "rate": decimal_text(auto_english_rate)}, effective_inputs={"count": effective_english_count, "rate": decimal_text(effective_english_rate)}, overridden=english_count_overridden or english_rate_overridden or english_overridden),
        _audit_step("lesson_bonus", "Bonuses", "Lesson-filled bonus", "fully logged class count × lesson bonus rate", automatic_lesson_bonus, lesson_final, metric="lesson_filled", automatic_inputs={"count": automatic_bonus_counts["lesson"], "rate": decimal_text(auto_lesson_rate)}, effective_inputs={"count": effective_lesson_count, "rate": decimal_text(effective_lesson_rate)}, overridden=lesson_count_overridden or lesson_rate_overridden or lesson_overridden),
        _audit_step("night_bonus", "Bonuses", "Night class bonus", "night class count × night bonus rate", automatic_night_bonus, night_final, metric="night_classes", automatic_inputs={"count": automatic_bonus_counts["night"], "rate": decimal_text(auto_night_rate)}, effective_inputs={"count": effective_night_count, "rate": decimal_text(effective_night_rate)}, overridden=night_count_overridden or night_rate_overridden or night_overridden),
        _audit_step("reference_bonus", "Bonuses", "Reference bonus", "active reference student count × reference bonus rate", automatic_reference_bonus, reference_final, metric="reference_students", automatic_inputs={"count": automatic_bonus_counts["reference"], "rate": decimal_text(auto_reference_rate)}, effective_inputs={"count": effective_reference_count, "rate": decimal_text(effective_reference_rate)}, overridden=reference_count_overridden or reference_rate_overridden or reference_overridden),
        _audit_step("achievement_points", "Achievement", "Achievement points", "sum of awarded criteria points, maximum 10", Decimal(automatic_points), Decimal(effective_points), metric="achievement_points", automatic_inputs={"points": automatic_points}, effective_inputs={"points": effective_points}, overridden=points_overridden, note="Open Points Proof to see every awarded and missed criterion.", value_kind="count"),
        _audit_step("achievement_bonus", "Achievement", "Achievement payout", "configured payout for the effective achievement point range", automatic_achievement, achievement_final, metric="achievement_points", automatic_inputs={"points": automatic_points}, effective_inputs={"points": effective_points}, overridden=points_overridden or achievement_overridden),
        _audit_step("other_bonuses", "Bonuses", "Other bonuses", "sum of administrator-entered bonuses with reasons", other_total, other_total, automatic_inputs={"entries": len(other_rows)}, effective_inputs={"entries": len(other_rows)}, overridden=bool(other_rows)),
        _audit_step("gross_salary", "Totals", "Gross salary", "base salary + all bonuses", automatic_gross, gross_total, automatic_inputs={"system_calculated": decimal_text(automatic_gross)}, effective_inputs={"adjusted_before_component_overrides": decimal_text(adjusted_gross), "component_total": decimal_text(component_gross)}, overridden=gross_overridden or any([base_overridden, english_overridden, lesson_overridden, night_overridden, reference_overridden, achievement_overridden])),
        _audit_step("deductions", "Totals", "Total cuttings", "food + drop/leave + fine + Imam Hadya + advance + manual cuttings", deduction_total, deduction_total, automatic_inputs=deduction_payload, effective_inputs=deduction_payload, overridden=deduction_total > 0),
        _audit_step("net_salary", "Totals", "Net salary", "gross salary − total cuttings", max(Decimal("0.00"), automatic_gross - deduction_total), final_total, automatic_inputs={"gross": decimal_text(automatic_gross), "cuttings": decimal_text(deduction_total)}, effective_inputs={"gross": decimal_text(gross_total), "cuttings": decimal_text(deduction_total)}, overridden=final_overridden or gross_overridden),
    ]

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
        "standard_rate": decimal_text(effective_standard_rate),
        "three_day_rate": decimal_text(effective_three_day_rate),
        "standard_salary": decimal_text(adjusted_standard_salary),
        "three_day_salary": decimal_text(adjusted_three_day_salary),
        "half_class_salary": decimal_text(half_salary),
        "half_class_rows": half_rows,
        "manual_review_salary": decimal_text(manual_review_salary),
        "english_class_count": len(english_records),
        "lesson_filled_count": len(lesson_filled_records),
        "lesson_missing_count": len(lesson_missing_records),
        "night_class_count": len(night_records),
        "reference_student_count": len(reference_students),
        "attendance_rate": float(attendance_rate),
        "attendance_marked_count": total_student_attendance,
        "attendance_present_count": present_student_attendance,
        "monthly_drop_count": len(monthly_drop_ids),
        "teacher_leave_count": teacher_leave_count,
        "students_on_leave": len(on_leave_records),
        "achievement_criteria": criteria,
        "achievement_point_proofs": point_proofs,
        "achievement_points": effective_points,
        "automatic_achievement_points": automatic_points,
        "metric_student_ids": metric_student_ids,
        "calculation_inputs": calculation_inputs,
        "calculation_audit": calculation_audit,
        "calculated_components": {
            "base_salary": decimal_text(automatic_base),
            "english_bonus": decimal_text(automatic_english_bonus),
            "lesson_bonus": decimal_text(automatic_lesson_bonus),
            "night_bonus": decimal_text(automatic_night_bonus),
            "reference_bonus": decimal_text(automatic_reference_bonus),
            "achievement_bonus": decimal_text(automatic_achievement),
            "other_bonuses": decimal_text(other_total),
            "gross_total": decimal_text(automatic_gross),
        },
        "adjusted_components": {
            "base_salary": decimal_text(adjusted_base),
            "english_bonus": decimal_text(adjusted_english_bonus),
            "lesson_bonus": decimal_text(adjusted_lesson_bonus),
            "night_bonus": decimal_text(adjusted_night_bonus),
            "reference_bonus": decimal_text(adjusted_reference_bonus),
            "achievement_bonus": decimal_text(adjusted_achievement),
            "other_bonuses": decimal_text(other_total),
            "gross_total": decimal_text(adjusted_gross),
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
        "pdf_generated_at": slip.pdf_generated_at.isoformat() if getattr(slip, "pdf_generated_at", None) else None,
        "pdf_download_count": int(getattr(slip, "pdf_download_count", 0) or 0),
        "pdf_last_downloaded_at": slip.pdf_last_downloaded_at.isoformat() if getattr(slip, "pdf_last_downloaded_at", None) else None,
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

    # Recalculate so proofs, point criteria and formula steps always match the
    # exact selected month and the current saved overrides.
    snapshot, *_ = calculate_teacher_salary(teacher, year, month, config, slip)
    ids = snapshot.get("metric_student_ids", {}).get(metric, [])
    ids = [int(value) for value in ids or []]

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
                "assigned_dates": set(),
                "student_type": student.student_type,
                "class_status": effective_class_status(student, year, month),
                "class_days": [],
                "time_slots": [],
                "full_expected_dates": set(),
                "active_expected_dates": set(),
            }

    attendance_by_student: dict[int, dict[date, str]] = defaultdict(dict)
    seen = set()
    attendance_query = Attendance.objects.filter(
        entity_type=Attendance.EntityType.STUDENT,
        student_id__in=ids,
        date__range=(start, end),
    ).order_by("student_id", "date", "-updated_at", "-id").values("student_id", "date", "status")
    for row in attendance_query:
        key = (row["student_id"], row["date"])
        if key in seen:
            continue
        seen.add(key)
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
        assigned_dates = set(record.get("assigned_dates", set()))
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
                "assigned": not assigned_dates or current in assigned_dates,
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

    if metric == "achievement_points":
        count = int(snapshot.get("achievement_points", 0) or 0)
        point_proofs = snapshot.get("achievement_point_proofs", [])
    elif metric == "calculation_audit":
        # Kept only for backward API compatibility. The current interface no
        # longer exposes the full audit as a proof option.
        count = 0
        point_proofs = []
    else:
        count = len(rows)
        point_proofs = []

    return {
        "metric": metric,
        "label": METRIC_LABELS[metric],
        "count": count,
        "month": month,
        "year": year,
        "teacher": {
            "id": teacher.id,
            "name": str(teacher),
            "username": teacher.user.username,
        },
        "rows": rows,
        "calculation_audit": [],
        "achievement_point_proofs": point_proofs,
        "achievement_points": snapshot.get("achievement_points", 0) if metric == "achievement_points" else 0,
        "automatic_achievement_points": snapshot.get("automatic_achievement_points", 0) if metric == "achievement_points" else 0,
        "calculation_inputs": {},
    }

