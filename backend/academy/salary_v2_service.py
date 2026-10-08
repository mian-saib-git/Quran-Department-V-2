from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any
import re

from django.db import transaction
from django.db.models import Prefetch, Q
from django.utils import timezone

from .models import (
    Attendance,
    ClassSchedule,
    QuranClassCoverage,
    QuranSalaryAdjustment,
    QuranSalaryLedgerEntry,
    QuranSalaryPolicy,
    QuranStudentDropEvent,
    QuranTeacherMonthlyPayroll,
    StudentClassHistory,
    StudentProfile,
    TeacherProfile,
)


DEFAULT_POLICY_START = date(2020, 1, 1)

DEFAULT_RATE_1_TO_15 = Decimal("80.00")
DEFAULT_RATE_16_TO_19 = Decimal("90.00")
DEFAULT_RATE_20_PLUS = Decimal("100.00")
DEFAULT_MONTHLY_CAP = 20

PAYROLL_UNITS_PER_WEEK = 5

WEEKDAY_NUMBERS = {
    ClassSchedule.WeekDay.MONDAY: 0,
    ClassSchedule.WeekDay.TUESDAY: 1,
    ClassSchedule.WeekDay.WEDNESDAY: 2,
    ClassSchedule.WeekDay.THURSDAY: 3,
    ClassSchedule.WeekDay.FRIDAY: 4,
    ClassSchedule.WeekDay.SATURDAY: 5,
    ClassSchedule.WeekDay.SUNDAY: 6,
}

BASE_SALARY_ACTIVE_STATUSES = {
    StudentProfile.ClassStatus.RUNNING,
    StudentProfile.ClassStatus.ON_LEAVE,
}

LOCKED_PAYROLL_STATUSES = {
    QuranTeacherMonthlyPayroll.Status.PENDING_SUPER_ADMIN,
    QuranTeacherMonthlyPayroll.Status.APPROVED,
    QuranTeacherMonthlyPayroll.Status.PAID,
}


def money(value: Any) -> Decimal:
    try:
        return Decimal(str(value or 0)).quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP,
        )
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0.00")


def decimal_text(value: Any) -> str:
    return format(money(value), ".2f")


def month_bounds(year: int, month: int):
    if month < 1 or month > 12:
        raise ValueError("Month must be between 1 and 12.")

    start = date(year, month, 1)

    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)

    return start, next_month - timedelta(days=1)


def iter_dates(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def ensure_default_policy(department, actor=None):
    """
    Ensure the department has a baseline policy covering historical periods.

    Future rate changes must be added as new effective-dated policy rows.
    """
    existing = (
        QuranSalaryPolicy.objects
        .filter(
            department=department,
            effective_from__lte=DEFAULT_POLICY_START,
        )
        .order_by("-effective_from", "-id")
        .first()
    )

    if existing:
        return existing

    policy, _ = QuranSalaryPolicy.objects.get_or_create(
        department=department,
        effective_from=DEFAULT_POLICY_START,
        defaults={
            "rate_1_to_15": DEFAULT_RATE_1_TO_15,
            "rate_16_to_19": DEFAULT_RATE_16_TO_19,
            "rate_20_plus": DEFAULT_RATE_20_PLUS,
            "monthly_salary_day_cap": DEFAULT_MONTHLY_CAP,
            "is_active": True,
            "created_by": actor,
            "updated_by": actor,
        },
    )

    return policy


def policy_for_date(department, target_date: date, actor=None):
    ensure_default_policy(department, actor)

    policy = (
        QuranSalaryPolicy.objects
        .filter(
            department=department,
            is_active=True,
            effective_from__lte=target_date,
        )
        .order_by("-effective_from", "-id")
        .first()
    )

    if not policy:
        raise ValueError(
            f"No active salary policy covers {target_date}."
        )

    return policy


def _history_queryset():
    return (
        StudentClassHistory.objects
        .select_related(
            "previous_teacher__user",
            "new_teacher__user",
        )
        .order_by("effective_date", "created_at", "id")
    )


def _schedule_queryset():
    # Do not filter only current schedules here.
    # Historical closed rows are required for past salary/drop calculations.
    return (
        ClassSchedule.objects
        .select_related("teacher__user")
        .order_by(
            "effective_from",
            "weekday",
            "time_slot",
            "id",
        )
    )


def _drop_queryset():
    return (
        QuranStudentDropEvent.objects
        .select_related("teacher__user")
        .order_by("drop_effective_date", "created_at", "id")
    )


def _department_students(department):
    return list(
        StudentProfile.objects
        .select_related(
            "user",
            "teacher__user",
            "department",
            "institution",
        )
        .prefetch_related(
            Prefetch(
                "class_history",
                queryset=_history_queryset(),
                to_attr="salary_v2_history",
            ),
            Prefetch(
                "schedules",
                queryset=_schedule_queryset(),
                to_attr="salary_v2_schedules",
            ),
            Prefetch(
                "drop_events_v2",
                queryset=_drop_queryset(),
                to_attr="salary_v2_drop_events",
            ),
        )
        .filter(
            Q(department=department)
            | Q(user__department=department)
        )
        .distinct()
        .order_by("id")
    )


def _student_enrollment_date(student, histories):
    enrollment_dates = [
        row.effective_date
        for row in histories
        if row.event_type == StudentClassHistory.EventType.ENROLLED
    ]

    if enrollment_dates:
        return min(enrollment_dates)

    joined = getattr(student.user, "date_joined", None)

    if joined:
        if timezone.is_aware(joined):
            joined = timezone.localtime(joined)
        return joined.date()

    return (
        student.status_effective_date
        or timezone.localdate()
    )


def _reverse_history_event(state, row):
    """
    Reconstruct the state before a historical event.

    This fixes an important legacy weakness: if a student was transferred
    during the selected month, using only StudentProfile.teacher would make
    the new teacher appear to own the class before the transfer date.
    """

    if (
        row.event_type == StudentClassHistory.EventType.TEACHER_TRANSFER
        and row.previous_teacher_id is not None
    ):
        state["teacher_id"] = row.previous_teacher_id

    if row.new_student_type and row.previous_student_type:
        state["student_type"] = row.previous_student_type

    if row.new_class_status and row.previous_class_status:
        state["class_status"] = row.previous_class_status


def _apply_history_event(state, row):
    if (
        row.event_type == StudentClassHistory.EventType.TEACHER_TRANSFER
        and row.new_teacher_id
    ):
        state["teacher_id"] = row.new_teacher_id

    if row.new_student_type:
        state["student_type"] = row.new_student_type

    if row.new_class_status:
        state["class_status"] = row.new_class_status

    if row.event_type == StudentClassHistory.EventType.ENROLLED:
        if row.new_teacher_id:
            state["teacher_id"] = row.new_teacher_id

        if row.new_student_type:
            state["student_type"] = row.new_student_type

        if row.new_class_status:
            state["class_status"] = row.new_class_status


def build_student_daily_states(student, start: date, end: date):
    histories = list(
        getattr(student, "salary_v2_history", [])
    )

    enrollment_date = _student_enrollment_date(
        student,
        histories,
    )

    state = {
        "teacher_id": student.teacher_id,
        "student_type": student.student_type,
        "class_status": student.class_status,
    }

    # StudentProfile contains the latest/current state.
    # Walk future/current-month events backwards to reconstruct the
    # exact state immediately before the selected month starts.
    for row in reversed(histories):
        if row.effective_date < start:
            break
        _reverse_history_event(state, row)

    events_by_date = defaultdict(list)

    for row in histories:
        if start <= row.effective_date <= end:
            events_by_date[row.effective_date].append(row)

    daily = {}

    for current in iter_dates(start, end):
        for row in events_by_date.get(current, []):
            _apply_history_event(state, row)

        daily[current] = {
            "date": current,
            "enrolled": current >= enrollment_date,
            "teacher_id": state.get("teacher_id"),
            "student_type": state.get("student_type"),
            "class_status": state.get("class_status"),
        }

    return daily


def _schedule_rows(student):
    return list(
        getattr(student, "salary_v2_schedules", [])
    )


def _schedule_row_applies(row, target_date: date):
    """
    Return True when this schedule row was effective on target_date.

    Current rows normally have:
      is_active=True
      effective_to=None

    Historical rows normally have:
      is_active=False
      effective_to=<last effective date>

    Legacy inactive/open-ended rows are ignored.
    """
    start = row.effective_from
    end = row.effective_to

    if start and target_date < start:
        return False

    if end and target_date > end:
        return False

    if not row.is_active and end is None:
        return False

    return True


def _is_real_scheduled_date(schedule_rows, target_date: date):
    weekday = target_date.weekday()

    for row in schedule_rows:
        if not _schedule_row_applies(row, target_date):
            continue

        row_weekday = WEEKDAY_NUMBERS.get(row.weekday)

        if row_weekday == weekday:
            return True

    return False


def _base_status_is_salary_active(status):
    return status in BASE_SALARY_ACTIVE_STATUSES


def _drop_active_on_date(drop_events, target_date: date):
    """
    A V2 drop removes the class from active class-count tiers from the
    drop date until its rejoin date.

    The monthly base package is calculated separately and then completely
    reversed if the class remains dropped.
    """
    for event in drop_events:
        if event.drop_effective_date > target_date:
            continue

        if (
            event.rejoined_date is None
            or target_date < event.rejoined_date
        ):
            return True

    return False


def _has_unrestored_drop(drop_events, month_end: date):
    """
    If a drop still has no rejoin date, the class contribution for the
    selected salary month is zeroed.

    Once a rejoin date is recorded, recalculation of an unpaid historical
    month can restore that month's salary.

    Paid historical payrolls are locked and handled through a separate
    rejoin-restoration adjustment in the payment month.
    """
    eligible = [
        event
        for event in drop_events
        if event.drop_effective_date <= month_end
    ]

    if not eligible:
        return False

    latest = max(
        eligible,
        key=lambda item: (
            item.drop_effective_date,
            item.id or 0,
        ),
    )

    return latest.rejoined_date is None


def _payroll_dates_for_student(
    daily_states,
    schedule_rows,
    month_start: date,
    month_end: date,
    confirmed_session_dates=None,
):
    """
    Build candidate salary dates from every day of the calendar month.

    Seven-day payroll blocks start on the 1st, 8th, 15th, 22nd and,
    when present, 29th. Each block supplies at most five candidates.
    Real scheduled/corroborated sessions are preferred over virtual
    payroll filler dates. No fake Attendance records are created.

    This function does NOT apply the monthly 20-unit cap: virtual dates
    and unmarked attendance must first be removed so eligible sessions
    on days 29-31 can fill an earlier shortfall.
    """
    selected = []
    confirmed_session_dates = set(confirmed_session_dates or ())

    for week_index in range(((month_end - month_start).days // 7) + 1):
        block_start = month_start + timedelta(days=week_index * 7)
        block_end = min(
            block_start + timedelta(days=6),
            month_end,
        )

        candidates = []

        for current in iter_dates(block_start, block_end):
            state = daily_states.get(current)

            if not state:
                continue

            if not state["enrolled"] and current not in confirmed_session_dates:
                continue

            if not state["teacher_id"] and current not in confirmed_session_dates:
                continue

            if not _base_status_is_salary_active(
                state["class_status"]
            ):
                continue

            candidates.append(current)

        if not candidates:
            continue

        actual = [
            current
            for current in candidates
            if (_is_real_scheduled_date(
                schedule_rows,
                current,
            ) or current in confirmed_session_dates)
        ]

        # A class may technically contain more than five schedule rows
        # inside a seven-day block, but salary has a five-unit weekly cap.
        chosen = actual[:PAYROLL_UNITS_PER_WEEK]

        if len(chosen) < PAYROLL_UNITS_PER_WEEK:
            # Financial filler days prefer Monday-Friday.
            # They are payroll-only units and never attendance records.
            weekday_fillers = [
                current
                for current in candidates
                if current not in chosen
                and current.weekday() < 5
            ]

            for current in weekday_fillers:
                if len(chosen) >= PAYROLL_UNITS_PER_WEEK:
                    break

                chosen.append(current)

        if len(chosen) < PAYROLL_UNITS_PER_WEEK:
            remaining = [
                current
                for current in candidates
                if current not in chosen
            ]

            for current in remaining:
                if len(chosen) >= PAYROLL_UNITS_PER_WEEK:
                    break

                chosen.append(current)

        chosen = sorted(set(chosen))

        selected.extend(chosen)

    return selected


def _earned_payroll_dates_for_student(
    payroll_dates,
    schedule_rows,
    corroborated_dates,
    attendance_status_by_date,
    as_of_date,
):
    """Enforce the monthly cap *after* eligibility has been verified.

    A weekly candidate with no marked attendance never uses up one of
    the 20 paid units. The input has already been limited to at most five
    candidate dates for each seven-day block. This function is shared
    by payroll and the diagnostic to avoid inconsistent unit counts.
    """
    earning_statuses = {
        Attendance.Status.PRESENT,
        Attendance.Status.ABSENT,
        Attendance.Status.LEAVE,
    }
    confirmed = set(corroborated_dates or ())
    earned = []
    for current in payroll_dates:
        if current > as_of_date:
            continue
        if not (
            _is_real_scheduled_date(schedule_rows, current)
            or current in confirmed
        ):
            continue
        if attendance_status_by_date.get(current) not in earning_statuses:
            continue
        earned.append(current)
        if len(earned) >= DEFAULT_MONTHLY_CAP:
            break
    return earned


def build_department_month_context(
    department,
    year: int,
    month: int,
    actor=None,
):
    start, end = month_bounds(year, month)

    ensure_default_policy(department, actor)

    students = _department_students(department)

    states_by_student = {}
    schedule_rows_by_student = {}
    drop_events_by_student = {}

    for student in students:
        states_by_student[student.id] = (
            build_student_daily_states(
                student,
                start,
                end,
            )
        )

        schedule_rows_by_student[student.id] = (
            _schedule_rows(student)
        )

        drop_events_by_student[student.id] = list(
            getattr(
                student,
                "salary_v2_drop_events",
                [],
            )
        )

    class_counts = defaultdict(int)

    # Active class count is a true date-based count.
    # It controls 80/90/100 and changes on transfer/drop/rejoin dates.
    for student in students:
        daily_states = states_by_student[student.id]
        drop_events = drop_events_by_student[student.id]

        for current, state in daily_states.items():
            if not state["enrolled"]:
                continue

            teacher_id = state.get("teacher_id")

            if not teacher_id:
                continue

            if not _base_status_is_salary_active(
                state.get("class_status")
            ):
                continue

            if _drop_active_on_date(
                drop_events,
                current,
            ):
                continue

            class_counts[(teacher_id, current)] += 1

    policies = list(
        QuranSalaryPolicy.objects
        .filter(
            department=department,
            is_active=True,
            effective_from__lte=end,
        )
        .order_by("effective_from", "id")
    )

    if not policies:
        policies = [
            ensure_default_policy(
                department,
                actor,
            )
        ]

    return {
        "department": department,
        "start": start,
        "end": end,
        "students": students,
        "states_by_student": states_by_student,
        "schedule_rows_by_student": (
            schedule_rows_by_student
        ),
        "drop_events_by_student": drop_events_by_student,
        "class_counts": class_counts,
        "policies": policies,
    }


def _context_policy_for_date(context, target_date):
    selected = None

    for policy in context["policies"]:
        if policy.effective_from <= target_date:
            selected = policy
        else:
            break

    if selected is None:
        selected = context["policies"][0]

    return selected


def _rate_for_teacher_date(
    context,
    teacher_id: int,
    target_date: date,
):
    class_count = int(
        context["class_counts"].get(
            (teacher_id, target_date),
            0,
        )
    )

    policy = _context_policy_for_date(
        context,
        target_date,
    )

    return (
        money(policy.rate_for_class_count(class_count)),
        class_count,
        policy,
    )



def teacher_rate_for_date(
    context,
    teacher_id: int,
    target_date: date,
):
    """
    Public Salary V2 rate lookup.

    Returns:
        rate,
        active_class_count,
        effective_salary_policy
    """
    return _rate_for_teacher_date(
        context,
        teacher_id,
        target_date,
    )



def _entry(
    *,
    teacher_id,
    student_id,
    entry_type,
    effective_date,
    salary_unit_number=None,
    class_count_at_time=0,
    rate=0,
    amount=0,
    description="",
    source_month=None,
    source_year=None,
    metadata=None,
):
    return {
        "teacher_id": int(teacher_id),
        "student_id": (
            int(student_id)
            if student_id is not None
            else None
        ),
        "entry_type": entry_type,
        "effective_date": effective_date,
        "salary_unit_number": salary_unit_number,
        "class_count_at_time": int(
            class_count_at_time or 0
        ),
        "rate": money(rate),
        "quantity": Decimal("1.00"),
        "amount": money(amount),
        "description": str(description or ""),
        "source_month": source_month,
        "source_year": source_year,
        "metadata": metadata or {},
    }


def _approved_adjustments_for_month(
    department,
    year,
    month,
):
    return list(
        QuranSalaryAdjustment.objects
        .select_related(
            "teacher__user",
            "student__user",
        )
        .filter(
            department=department,
            salary_year=year,
            salary_month=month,
            status=QuranSalaryAdjustment.Status.APPROVED,
        )
        .order_by("teacher_id", "created_at", "id")
    )


def _all_adjustments_for_month(
    department,
    year,
    month,
):
    return list(
        QuranSalaryAdjustment.objects
        .select_related("teacher__user")
        .filter(
            department=department,
            salary_year=year,
            salary_month=month,
        )
        .order_by("teacher_id", "created_at", "id")
    )


def _department_teachers(department):
    return list(
        TeacherProfile.objects
        .select_related("user")
        .filter(
            Q(department=department)
            | Q(user__department=department)
        )
        .distinct()
        .order_by(
            "user__first_name",
            "user__last_name",
            "user__username",
            "id",
        )
    )


def _rate_timeline_for_teacher(
    context,
    teacher_id,
):
    rows = []

    for current in iter_dates(
        context["start"],
        context["end"],
    ):
        count = int(
            context["class_counts"].get(
                (teacher_id, current),
                0,
            )
        )

        policy = _context_policy_for_date(
            context,
            current,
        )

        rate = money(
            policy.rate_for_class_count(count)
        )

        rows.append({
            "date": str(current),
            "active_classes": count,
            "rate": decimal_text(rate),
            "policy_id": policy.id,
            "policy_effective_from": str(
                policy.effective_from
            ),
        })

    return rows


def _student_breakdown(entries):
    grouped = {}

    for row in entries:
        student_id = row.get("student_id")

        if student_id is None:
            continue

        item = grouped.setdefault(
            student_id,
            {
                "student_id": student_id,
                "normal_earnings": Decimal("0.00"),
                "absence_deductions": Decimal("0.00"),
                "drop_reversals": Decimal("0.00"),
                "substitute_earnings": Decimal("0.00"),
                "salary_units": 0,
            },
        )

        amount = money(row["amount"])

        if (
            row["entry_type"]
            == QuranSalaryLedgerEntry.EntryType.NORMAL_EARNING
        ):
            item["normal_earnings"] += amount
            item["salary_units"] += 1

        elif (
            row["entry_type"]
            == QuranSalaryLedgerEntry.EntryType.TEACHER_ABSENCE_DEDUCTION
        ):
            item["absence_deductions"] += abs(amount)

        elif (
            row["entry_type"]
            == QuranSalaryLedgerEntry.EntryType.DROPPED_CLASS_REVERSAL
        ):
            item["drop_reversals"] += abs(amount)

        elif (
            row["entry_type"]
            == QuranSalaryLedgerEntry.EntryType.SUBSTITUTE_EARNING
        ):
            item["substitute_earnings"] += amount

    result = []

    for item in grouped.values():
        result.append({
            "student_id": item["student_id"],
            "salary_units": item["salary_units"],
            "normal_earnings": decimal_text(
                item["normal_earnings"]
            ),
            "absence_deductions": decimal_text(
                item["absence_deductions"]
            ),
            "drop_reversals": decimal_text(
                item["drop_reversals"]
            ),
            "substitute_earnings": decimal_text(
                item["substitute_earnings"]
            ),
        })

    return sorted(
        result,
        key=lambda item: item["student_id"],
    )


@transaction.atomic
def calculate_department_payrolls(
    department,
    year: int,
    month: int,
    actor=None,
    target_teacher_ids=None,
):
    """
    Recalculate Quran payrolls using the complete department/month
    calculation context.

    When target_teacher_ids is provided, the full department context is
    still calculated so dynamic class-count rates remain correct, but only
    the selected teacher payroll rows and ledgers are persisted.

    Locked states:
      Pending Super Admin
      Approved
      Paid

    To change an approved/paid payroll later, the API must first perform
    an explicit reopen workflow with a mandatory reason.
    """

    context = build_department_month_context(
        department,
        year,
        month,
        actor,
    )

    start = context["start"]
    end = context["end"]

    coverages = list(
        QuranClassCoverage.objects
        .select_related(
            "original_teacher__user",
            "substitute_teacher__user",
            "student__user",
        )
        .filter(
            department=department,
            date__range=(start, end),
        )
        .exclude(
            coverage_status=(
                QuranClassCoverage.CoverageStatus.CANCELLED
            )
        )
        .order_by("date", "student_id", "id")
    )

    coverage_map = {
        (
            row.student_id,
            row.date,
            row.original_teacher_id,
        ): row
        for row in coverages
    }

    # Salary accrues only through the local calculation date.
    #
    # Historical months use month-end. Current months use today.
    # Future months therefore have no earned salary yet.
    as_of_date = min(
        end,
        timezone.localdate(),
    )

    student_ids = [
        student.id
        for student in context["students"]
    ]

    # Imported historical student rows may predate schedule history.  Only a
    # matching teacher-session row (same teacher/date/HH:MM) corroborates a
    # real class when there is no effective ClassSchedule for that date.
    # This is deliberately NOT a blanket "any student attendance = salary"
    # fallback; unmatched, blank-time and teacher-only imports cannot earn.
    student_attendance_rows = list(
        Attendance.objects.filter(
            entity_type=Attendance.EntityType.STUDENT,
            student_id__in=student_ids,
            date__range=(start, as_of_date),
        ).only("student_id", "teacher_id", "date", "class_key", "status")
    )
    student_attendance_map = {
        (row.student_id, row.date): row.status
        for row in student_attendance_rows
    }
    scoped_teacher_ids = set(
        TeacherProfile.objects.filter(
            Q(department=department) | Q(user__department=department)
        ).values_list("id", flat=True)
    )
    session_keys = {
        (row.teacher_id, row.date, row.class_key)
        for row in student_attendance_rows
        if row.teacher_id in scoped_teacher_ids
        and re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", row.class_key or "")
    }
    teacher_sessions = {
        (row.teacher_id, row.date, row.class_key): row
        for row in Attendance.objects.filter(
            entity_type=Attendance.EntityType.TEACHER,
            teacher_id__in={key[0] for key in session_keys},
            date__range=(start, as_of_date),
        ).only("teacher_id", "date", "class_key", "status")
        if (row.teacher_id, row.date, row.class_key) in session_keys
    } if session_keys else {}
    verified_sessions = {
        (row.student_id, row.date): row
        for row in student_attendance_rows
        if (
            (row.teacher_id, row.date, row.class_key) in teacher_sessions
            and row.status in {
                Attendance.Status.PRESENT,
                Attendance.Status.ABSENT,
                Attendance.Status.LEAVE,
            }
        )
    }

    # The date-based class-count tier must also reflect a confirmed
    # historical transfer/enrollment. Otherwise the fallback earning would
    # be credited to the historical teacher at an incorrect rate tier.
    for (student_id, session_date), attendance in verified_sessions.items():
        if student_id not in context["states_by_student"]:
            continue
        state = context["states_by_student"][student_id].get(session_date)
        schedules = context["schedule_rows_by_student"][student_id]
        if not state or _is_real_scheduled_date(schedules, session_date):
            continue
        if not _base_status_is_salary_active(state.get("class_status")):
            continue
        if _drop_active_on_date(context["drop_events_by_student"][student_id], session_date):
            continue
        current_teacher_id = state.get("teacher_id")
        originally_counted = bool(state.get("enrolled") and current_teacher_id)
        if originally_counted and current_teacher_id != attendance.teacher_id:
            key = (current_teacher_id, session_date)
            context["class_counts"][key] = max(0, context["class_counts"][key] - 1)
        if not originally_counted or current_teacher_id != attendance.teacher_id:
            context["class_counts"][(attendance.teacher_id, session_date)] += 1

    entries = []

    # --------------------------------------------------------------
    # Base salary + absence deductions + substitute earnings
    # --------------------------------------------------------------
    for student in context["students"]:
        daily_states = context[
            "states_by_student"
        ][student.id]

        schedule_rows = context[
            "schedule_rows_by_student"
        ][student.id]

        corroborated_dates = {
            session_date
            for (student_id, session_date) in verified_sessions
            if student_id == student.id
        }
        payroll_dates = _payroll_dates_for_student(
            daily_states,
            schedule_rows,
            start,
            end,
            confirmed_session_dates=corroborated_dates,
        )

        student_status_by_date = {
            current: student_attendance_map.get((student.id, current))
            for current in payroll_dates
        }
        earned_payroll_dates = _earned_payroll_dates_for_student(
            payroll_dates,
            schedule_rows,
            corroborated_dates,
            student_status_by_date,
            as_of_date,
        )

        for unit_number, current in enumerate(
            earned_payroll_dates,
            start=1,
        ):
            state = daily_states.get(current)

            if not state:
                continue

            historical_session = verified_sessions.get((student.id, current))
            effective_schedule = _is_real_scheduled_date(schedule_rows, current)
            # A corroborated historical session may predate imported schedule
            # history, including a transfer not recorded in profile history.
            teacher_id = (
                historical_session.teacher_id
                if historical_session and not effective_schedule
                else state.get("teacher_id")
            )

            if not teacher_id:
                continue

            rate, class_count, policy = (
                _rate_for_teacher_date(
                    context,
                    teacher_id,
                    current,
                )
            )

            is_real_scheduled_date = (
                effective_schedule or historical_session is not None
            )

            entries.append(
                _entry(
                    teacher_id=teacher_id,
                    student_id=student.id,
                    entry_type=(
                        QuranSalaryLedgerEntry
                        .EntryType
                        .NORMAL_EARNING
                    ),
                    effective_date=current,
                    salary_unit_number=unit_number,
                    class_count_at_time=class_count,
                    rate=rate,
                    amount=rate,
                    description=(
                        "Normal Quran class salary unit."
                    ),
                    metadata={
                        "virtual_payroll_date": (
                            not is_real_scheduled_date
                        ),
                        "real_scheduled_date": (
                            is_real_scheduled_date
                        ),
                        "student_attendance_status": (
                            student_attendance_map.get(
                                (
                                    student.id,
                                    current,
                                )
                            )
                        ),
                        "attendance_backed_earning": True,
                        "verified_historical_session": bool(
                            historical_session and not effective_schedule
                        ),
                        "salary_as_of_date": str(
                            as_of_date
                        ),
                        "policy_id": policy.id,
                        "policy_effective_from": str(
                            policy.effective_from
                        ),
                    },
                )
            )

            # Teacher absence/leave only affects a REAL scheduled
            # session. Virtual salary units never create attendance.
            if not is_real_scheduled_date:
                continue

            coverage = coverage_map.get(
                (
                    student.id,
                    current,
                    teacher_id,
                )
            )

            if not coverage:
                # Historical CSVs do not automatically create coverage rows.
                # A matched teacher absence still deducts the original class
                # rate, but cannot invent an unrecorded substitute payment.
                teacher_attendance = teacher_sessions.get((
                    teacher_id,
                    current,
                    historical_session.class_key if historical_session else "",
                )) if historical_session else None
                if teacher_attendance and teacher_attendance.status in {
                    Attendance.Status.ABSENT, Attendance.Status.LEAVE,
                }:
                    entries.append(_entry(
                        teacher_id=teacher_id,
                        student_id=student.id,
                        entry_type=QuranSalaryLedgerEntry.EntryType.TEACHER_ABSENCE_DEDUCTION,
                        effective_date=current,
                        salary_unit_number=unit_number,
                        class_count_at_time=class_count,
                        rate=rate,
                        amount=-rate,
                        description="Teacher absent/leave in corroborated historical attendance (no substitute inferred).",
                        metadata={
                            "teacher_status": teacher_attendance.status,
                            "verified_historical_session": True,
                            "coverage_missing": True,
                        },
                    ))
                continue

            if coverage.teacher_status not in {
                QuranClassCoverage.TeacherStatus.ABSENT,
                QuranClassCoverage.TeacherStatus.LEAVE,
            }:
                continue

            entries.append(
                _entry(
                    teacher_id=teacher_id,
                    student_id=student.id,
                    entry_type=(
                        QuranSalaryLedgerEntry
                        .EntryType
                        .TEACHER_ABSENCE_DEDUCTION
                    ),
                    effective_date=current,
                    salary_unit_number=unit_number,
                    class_count_at_time=class_count,
                    rate=rate,
                    amount=-rate,
                    description=(
                        "Teacher was absent/leave for "
                        "the scheduled class."
                    ),
                    metadata={
                        "teacher_status": (
                            coverage.teacher_status
                        ),
                        "student_status": (
                            coverage.student_status
                        ),
                        "coverage_status": (
                            coverage.coverage_status
                        ),
                        "coverage_id": coverage.id,
                    },
                )
            )

            # Substitute earning is allowed only when the
            # student's attendance is explicitly Present.
            #
            # Absent, Leave, and Not Marked must never generate
            # substitute salary, even if stale coverage data says
            # a substitute was assigned.
            if (
                coverage.student_status
                != QuranClassCoverage
                .StudentStatus
                .PRESENT
            ):
                continue

            if (
                coverage.coverage_status
                != QuranClassCoverage.CoverageStatus.ASSIGNED
            ):
                continue

            if not coverage.substitute_teacher_id:
                continue

            substitute_rate, substitute_count, sub_policy = (
                _rate_for_teacher_date(
                    context,
                    coverage.substitute_teacher_id,
                    current,
                )
            )

            entries.append(
                _entry(
                    teacher_id=(
                        coverage.substitute_teacher_id
                    ),
                    student_id=student.id,
                    entry_type=(
                        QuranSalaryLedgerEntry
                        .EntryType
                        .SUBSTITUTE_EARNING
                    ),
                    effective_date=current,
                    salary_unit_number=None,
                    class_count_at_time=(
                        substitute_count
                    ),
                    rate=substitute_rate,
                    amount=substitute_rate,
                    description=(
                        "Substitute Quran class earning."
                    ),
                    metadata={
                        "coverage_id": coverage.id,
                        "original_teacher_id": (
                            teacher_id
                        ),
                        "substitute_policy_id": (
                            sub_policy.id
                        ),
                        "student_status": (
                            coverage.student_status
                        ),
                    },
                )
            )

    # --------------------------------------------------------------
    # Dropped class reversal
    #
    # If the student remains dropped, their normal contribution for
    # the entire month becomes zero.
    #
    # We reverse NORMAL - ABSENCE rather than simply reversing normal
    # salary. This prevents a dropped class from leaving the original
    # teacher with a negative balance.
    #
    # Substitute earnings are NOT reversed because another teacher
    # actually provided that class coverage.
    # --------------------------------------------------------------
    contribution = defaultdict(
        lambda: Decimal("0.00")
    )

    for row in entries:
        if row["student_id"] is None:
            continue

        if row["entry_type"] not in {
            QuranSalaryLedgerEntry
            .EntryType
            .NORMAL_EARNING,
            QuranSalaryLedgerEntry
            .EntryType
            .TEACHER_ABSENCE_DEDUCTION,
        }:
            continue

        contribution[
            (
                row["student_id"],
                row["teacher_id"],
            )
        ] += money(row["amount"])

    for student in context["students"]:
        drop_events = context[
            "drop_events_by_student"
        ][student.id]

        if not _has_unrestored_drop(
            drop_events,
            end,
        ):
            continue

        relevant = [
            (
                teacher_id,
                amount,
            )
            for (
                student_id,
                teacher_id,
            ), amount in contribution.items()
            if student_id == student.id
        ]

        for teacher_id, net_contribution in relevant:
            net_contribution = money(
                net_contribution
            )

            if net_contribution <= 0:
                continue

            entries.append(
                _entry(
                    teacher_id=teacher_id,
                    student_id=student.id,
                    entry_type=(
                        QuranSalaryLedgerEntry
                        .EntryType
                        .DROPPED_CLASS_REVERSAL
                    ),
                    effective_date=end,
                    salary_unit_number=None,
                    class_count_at_time=0,
                    rate=0,
                    amount=-net_contribution,
                    description=(
                        "Full monthly class salary reversed "
                        "because the student remains dropped."
                    ),
                    metadata={
                        "reversal_of_net_class_contribution": (
                            decimal_text(
                                net_contribution
                            )
                        ),
                    },
                )
            )

    approved_adjustments = (
        _approved_adjustments_for_month(
            department,
            year,
            month,
        )
    )

    all_adjustments = (
        _all_adjustments_for_month(
            department,
            year,
            month,
        )
    )

    # Include teachers even when they currently have no class salary,
    # so the dashboard can display a zero-value payroll or an approved
    # adjustment/substitute earning.
    teacher_ids = {
        teacher.id
        for teacher in _department_teachers(
            department
        )
    }

    teacher_ids.update(
        row["teacher_id"]
        for row in entries
    )

    teacher_ids.update(
        row.teacher_id
        for row in all_adjustments
    )

    if target_teacher_ids is not None:
        normalized_target_teacher_ids = set()

        for value in target_teacher_ids:
            try:
                teacher_id = int(value)
            except (
                TypeError,
                ValueError,
            ):
                continue

            if teacher_id > 0:
                normalized_target_teacher_ids.add(
                    teacher_id
                )

        teacher_ids.intersection_update(
            normalized_target_teacher_ids
        )

    teachers = {
        teacher.id: teacher
        for teacher in (
            TeacherProfile.objects
            .select_related("user")
            .filter(id__in=teacher_ids)
        )
    }

    payrolls = {}

    for teacher_id in sorted(teacher_ids):
        teacher = teachers.get(teacher_id)

        if not teacher:
            continue

        payroll, _ = (
            QuranTeacherMonthlyPayroll.objects
            .get_or_create(
                department=department,
                teacher=teacher,
                year=year,
                month=month,
                defaults={
                    "institution": (
                        department.institution
                    ),
                },
            )
        )

        payrolls[teacher_id] = payroll

    # Link every adjustment request to its payroll record for easier
    # review even before it has been approved.
    adjustment_links_to_update = []

    for adjustment in all_adjustments:
        payroll = payrolls.get(
            adjustment.teacher_id
        )

        if (
            payroll
            and adjustment.payroll_id != payroll.id
        ):
            adjustment.payroll = payroll
            adjustment_links_to_update.append(
                adjustment
            )

    if adjustment_links_to_update:
        QuranSalaryAdjustment.objects.bulk_update(
            adjustment_links_to_update,
            ["payroll"],
        )

    entries_by_teacher = defaultdict(list)

    for row in entries:
        entries_by_teacher[
            row["teacher_id"]
        ].append(row)

    adjustments_by_teacher = defaultdict(list)

    for adjustment in approved_adjustments:
        adjustments_by_teacher[
            adjustment.teacher_id
        ].append(adjustment)

    saved_payrolls = []

    for teacher_id, payroll in payrolls.items():
        if payroll.status in LOCKED_PAYROLL_STATUSES:
            saved_payrolls.append(payroll)
            continue

        teacher_entries = entries_by_teacher.get(
            teacher_id,
            [],
        )

        payroll.ledger_entries.all().delete()

        ledger_objects = [
            QuranSalaryLedgerEntry(
                payroll=payroll,
                department=department,
                teacher_id=teacher_id,
                student_id=row["student_id"],
                entry_type=row["entry_type"],
                effective_date=row[
                    "effective_date"
                ],
                salary_unit_number=row[
                    "salary_unit_number"
                ],
                class_count_at_time=row[
                    "class_count_at_time"
                ],
                rate=row["rate"],
                quantity=row["quantity"],
                amount=row["amount"],
                description=row["description"],
                source_month=row["source_month"],
                source_year=row["source_year"],
                metadata=row["metadata"],
            )
            for row in teacher_entries
        ]

        if ledger_objects:
            QuranSalaryLedgerEntry.objects.bulk_create(
                ledger_objects
            )

        normal_earnings = sum(
            (
                money(row["amount"])
                for row in teacher_entries
                if (
                    row["entry_type"]
                    == QuranSalaryLedgerEntry
                    .EntryType
                    .NORMAL_EARNING
                )
            ),
            Decimal("0.00"),
        )

        substitute_earnings = sum(
            (
                money(row["amount"])
                for row in teacher_entries
                if (
                    row["entry_type"]
                    == QuranSalaryLedgerEntry
                    .EntryType
                    .SUBSTITUTE_EARNING
                )
            ),
            Decimal("0.00"),
        )

        automatic_absence_deductions = sum(
            (
                abs(money(row["amount"]))
                for row in teacher_entries
                if (
                    row["entry_type"]
                    == QuranSalaryLedgerEntry
                    .EntryType
                    .TEACHER_ABSENCE_DEDUCTION
                )
            ),
            Decimal("0.00"),
        )

        dropped_reversals = sum(
            (
                abs(money(row["amount"]))
                for row in teacher_entries
                if (
                    row["entry_type"]
                    == QuranSalaryLedgerEntry
                    .EntryType
                    .DROPPED_CLASS_REVERSAL
                )
            ),
            Decimal("0.00"),
        )

        approved_bonus_total = Decimal("0.00")
        approved_manual_deduction_total = (
            Decimal("0.00")
        )
        previous_month_restoration_total = (
            Decimal("0.00")
        )

        approved_rows_payload = []

        for adjustment in adjustments_by_teacher.get(
            teacher_id,
            [],
        ):
            amount = money(adjustment.amount)

            if (
                adjustment.adjustment_type
                == QuranSalaryAdjustment
                .AdjustmentType
                .REJOIN_RESTORATION
            ):
                previous_month_restoration_total += (
                    amount
                )

            elif (
                adjustment.effect
                == QuranSalaryAdjustment
                .Effect
                .CREDIT
            ):
                approved_bonus_total += amount

            else:
                approved_manual_deduction_total += (
                    amount
                )

            approved_rows_payload.append({
                "id": adjustment.id,
                "type": adjustment.adjustment_type,
                "effect": adjustment.effect,
                "amount": decimal_text(amount),
                "reason": adjustment.reason,
                "source_month": (
                    adjustment.source_month
                ),
                "source_year": (
                    adjustment.source_year
                ),
                "student_id": (
                    adjustment.student_id
                ),
            })

        gross_total = (
            normal_earnings
            + substitute_earnings
            + approved_bonus_total
            + previous_month_restoration_total
        )

        deduction_total = (
            automatic_absence_deductions
            + approved_manual_deduction_total
            + dropped_reversals
        )

        final_total = max(
            Decimal("0.00"),
            gross_total - deduction_total,
        )

        unresolved_coverages = (
            QuranClassCoverage.objects
            .filter(
                department=department,
                original_teacher_id=teacher_id,
                date__range=(start, end),
                coverage_status=(
                    QuranClassCoverage
                    .CoverageStatus
                    .UNRESOLVED
                ),
            )
            .count()
        )

        pending_adjustments = (
            QuranSalaryAdjustment.objects
            .filter(
                department=department,
                teacher_id=teacher_id,
                salary_year=year,
                salary_month=month,
                status=(
                    QuranSalaryAdjustment
                    .Status
                    .PENDING
                ),
            )
            .count()
        )

        payroll.normal_earnings = money(
            normal_earnings
        )

        payroll.substitute_earnings = money(
            substitute_earnings
        )

        payroll.approved_bonus_total = money(
            approved_bonus_total
        )

        payroll.automatic_absence_deduction_total = (
            money(
                automatic_absence_deductions
            )
        )

        payroll.approved_manual_deduction_total = (
            money(
                approved_manual_deduction_total
            )
        )

        payroll.dropped_class_reversal_total = (
            money(dropped_reversals)
        )

        payroll.previous_month_restoration_total = (
            money(
                previous_month_restoration_total
            )
        )

        payroll.gross_total = money(gross_total)
        payroll.deduction_total = money(
            deduction_total
        )
        payroll.final_total = money(final_total)

        payroll.calculation_snapshot = {
            "version": 2,
            "salary_rule": (
                "Full calendar month in consecutive seven-day payroll "
                "blocks (including days 29-31): maximum 5 eligible "
                "units per block and maximum 20 earned units per student"
            ),
            "month_start": str(start),
            "month_end": str(end),
            "monthly_salary_day_cap": (
                DEFAULT_MONTHLY_CAP
            ),
            "weekly_salary_unit_cap": (
                PAYROLL_UNITS_PER_WEEK
            ),
            "normal_earnings": decimal_text(
                normal_earnings
            ),
            "substitute_earnings": decimal_text(
                substitute_earnings
            ),
            "approved_bonus_total": decimal_text(
                approved_bonus_total
            ),
            "previous_month_restoration_total": (
                decimal_text(
                    previous_month_restoration_total
                )
            ),
            "automatic_absence_deductions": (
                decimal_text(
                    automatic_absence_deductions
                )
            ),
            "approved_manual_deductions": (
                decimal_text(
                    approved_manual_deduction_total
                )
            ),
            "dropped_class_reversals": (
                decimal_text(
                    dropped_reversals
                )
            ),
            "gross_total": decimal_text(
                gross_total
            ),
            "deduction_total": decimal_text(
                deduction_total
            ),
            "final_total": decimal_text(
                final_total
            ),
            "unresolved_coverages": (
                unresolved_coverages
            ),
            "pending_adjustments": (
                pending_adjustments
            ),
            "rate_timeline": (
                _rate_timeline_for_teacher(
                    context,
                    teacher_id,
                )
            ),
            "student_breakdown": (
                _student_breakdown(
                    teacher_entries
                )
            ),
            "approved_adjustments": (
                approved_rows_payload
            ),
        }

        payroll.calculated_at = timezone.now()

        payroll.save(
            update_fields=[
                "normal_earnings",
                "substitute_earnings",
                "approved_bonus_total",
                "automatic_absence_deduction_total",
                "approved_manual_deduction_total",
                "dropped_class_reversal_total",
                "previous_month_restoration_total",
                "gross_total",
                "deduction_total",
                "final_total",
                "calculation_snapshot",
                "calculated_at",
                "updated_at",
            ]
        )

        saved_payrolls.append(payroll)

    return saved_payrolls


def calculate_teacher_payroll(
    teacher,
    year: int,
    month: int,
    actor=None,
):
    department = (
        teacher.department
        or getattr(
            teacher.user,
            "department",
            None,
        )
    )

    if not department:
        raise ValueError(
            "Teacher must belong to a department."
        )

    calculate_department_payrolls(
        department,
        year,
        month,
        actor,
        target_teacher_ids={
            teacher.id,
        },
    )

    return QuranTeacherMonthlyPayroll.objects.get(
        department=department,
        teacher=teacher,
        year=year,
        month=month,
    )



def payroll_readiness(payroll):
    # Live readiness checks for Quran payroll lifecycle transitions.
    start, end = month_bounds(
        payroll.year,
        payroll.month,
    )

    coverage_rows = (
        QuranClassCoverage.objects
        .filter(
            department=payroll.department,
            original_teacher=payroll.teacher,
            date__range=(start, end),
        )
    )

    unresolved_coverages = (
        coverage_rows
        .filter(
            coverage_status=(
                QuranClassCoverage
                .CoverageStatus
                .UNRESOLVED
            ),
        )
        .count()
    )

    # CSV historical teacher absences can predate V2 coverage tracking.
    # Never permit approval when a real matched absence session has no
    # coverage record: the original teacher is deducted, but a substitute
    # still needs an explicit, auditable assignment (never inferred).
    absent_sessions = {
        (row.date, row.class_key)
        for row in Attendance.objects.filter(
            entity_type=Attendance.EntityType.TEACHER,
            teacher=payroll.teacher,
            date__range=(start, end),
            status__in=[Attendance.Status.ABSENT, Attendance.Status.LEAVE],
        ).only("date", "class_key")
        if row.class_key
    }
    known_coverage_pairs = set(
        coverage_rows.exclude(
            coverage_status=QuranClassCoverage.CoverageStatus.CANCELLED
        ).values_list("student_id", "date")
    )
    missing_absence_coverages = (
        sum(
            1 for row in Attendance.objects.filter(
                entity_type=Attendance.EntityType.STUDENT,
                teacher=payroll.teacher,
                date__range=(start, end),
            ).only("student_id", "date", "class_key")
            if row.student_id
            and (row.date, row.class_key) in absent_sessions
            and (row.student_id, row.date) not in known_coverage_pairs
        ) if absent_sessions else 0
    )

    not_marked_coverages = (
        coverage_rows
        .filter(
            teacher_status__in=[
                QuranClassCoverage
                .TeacherStatus
                .ABSENT,
                QuranClassCoverage
                .TeacherStatus
                .LEAVE,
            ],
            student_status=(
                QuranClassCoverage
                .StudentStatus
                .NOT_MARKED
            ),
        )
        .count()
    )

    present_without_substitute = (
        coverage_rows
        .filter(
            teacher_status__in=[
                QuranClassCoverage
                .TeacherStatus
                .ABSENT,
                QuranClassCoverage
                .TeacherStatus
                .LEAVE,
            ],
            student_status=(
                QuranClassCoverage
                .StudentStatus
                .PRESENT
            ),
        )
        .filter(
            Q(
                substitute_teacher__isnull=True
            )
            | ~Q(
                coverage_status=(
                    QuranClassCoverage
                    .CoverageStatus
                    .ASSIGNED
                )
            )
        )
        .count()
    )

    invalid_nonpresent_assignments = (
        coverage_rows
        .filter(
            teacher_status__in=[
                QuranClassCoverage
                .TeacherStatus
                .ABSENT,
                QuranClassCoverage
                .TeacherStatus
                .LEAVE,
            ],
            student_status__in=[
                QuranClassCoverage
                .StudentStatus
                .ABSENT,
                QuranClassCoverage
                .StudentStatus
                .LEAVE,
                QuranClassCoverage
                .StudentStatus
                .NOT_MARKED,
            ],
            coverage_status=(
                QuranClassCoverage
                .CoverageStatus
                .ASSIGNED
            ),
            substitute_teacher__isnull=False,
        )
        .count()
    )

    pending_adjustments = (
        QuranSalaryAdjustment.objects
        .filter(
            department=payroll.department,
            teacher=payroll.teacher,
            salary_year=payroll.year,
            salary_month=payroll.month,
            status=(
                QuranSalaryAdjustment
                .Status
                .PENDING
            ),
        )
        .count()
    )

    operational_blockers = []

    if not payroll.calculated_at:
        operational_blockers.append({
            "code": "not_calculated",
            "count": 1,
            "message": (
                "Payroll must be calculated before "
                "it can be submitted."
            ),
        })

    if missing_absence_coverages:
        operational_blockers.append({
            "code": "historical_absence_missing_coverage",
            "count": missing_absence_coverages,
            "message": (
                "Imported teacher absence/leave sessions require an explicit "
                "coverage decision before this payroll can be submitted."
            ),
        })

    if unresolved_coverages:
        operational_blockers.append({
            "code": "unresolved_coverages",
            "count": unresolved_coverages,
            "message": (
                "Teacher absence/leave sessions still "
                "have unresolved substitute coverage."
            ),
        })

    if not_marked_coverages:
        operational_blockers.append({
            "code": "not_marked_student_attendance",
            "count": not_marked_coverages,
            "message": (
                "Student attendance is still Not Marked "
                "for teacher absence/leave sessions."
            ),
        })

    if present_without_substitute:
        operational_blockers.append({
            "code": "present_without_substitute",
            "count": present_without_substitute,
            "message": (
                "Present students under teacher "
                "absence/leave are missing a valid "
                "substitute assignment."
            ),
        })

    if invalid_nonpresent_assignments:
        operational_blockers.append({
            "code": "invalid_substitute_assignment",
            "count": invalid_nonpresent_assignments,
            "message": (
                "A substitute is assigned to a student "
                "who is Absent, Leave, or Not Marked."
            ),
        })

    approval_blockers = list(
        operational_blockers
    )

    if pending_adjustments:
        approval_blockers.append({
            "code": "pending_adjustments",
            "count": pending_adjustments,
            "message": (
                "Pending salary adjustments must be "
                "approved or rejected before payroll "
                "approval."
            ),
        })

    return {
        "department_submission_ready": (
            len(operational_blockers) == 0
        ),
        "super_admin_approval_ready": (
            len(approval_blockers) == 0
        ),
        "operational_blockers": (
            operational_blockers
        ),
        "approval_blockers": (
            approval_blockers
        ),
        "counts": {
            "historical_absence_missing_coverage": missing_absence_coverages,
            "unresolved_coverages": (
                unresolved_coverages
            ),
            "not_marked_student_attendance": (
                not_marked_coverages
            ),
            "present_without_substitute": (
                present_without_substitute
            ),
            "invalid_substitute_assignments": (
                invalid_nonpresent_assignments
            ),
            "pending_adjustments": (
                pending_adjustments
            ),
        },
    }


def adjustment_payload(adjustment):
    return {
        "id": adjustment.id,
        "payroll_id": adjustment.payroll_id,
        "teacher_id": adjustment.teacher_id,
        "teacher_name": str(
            adjustment.teacher
        ),
        "salary_month": (
            adjustment.salary_month
        ),
        "salary_year": (
            adjustment.salary_year
        ),
        "adjustment_type": (
            adjustment.adjustment_type
        ),
        "effect": adjustment.effect,
        "amount": decimal_text(
            adjustment.amount
        ),
        "reason": adjustment.reason,
        "source_month": (
            adjustment.source_month
        ),
        "source_year": (
            adjustment.source_year
        ),
        "student_id": (
            adjustment.student_id
        ),
        "status": adjustment.status,
        "requested_by_id": (
            adjustment.requested_by_id
        ),
        "requested_at": (
            adjustment.requested_at.isoformat()
            if adjustment.requested_at
            else None
        ),
        "reviewed_by_id": (
            adjustment.reviewed_by_id
        ),
        "reviewed_at": (
            adjustment.reviewed_at.isoformat()
            if adjustment.reviewed_at
            else None
        ),
        "review_note": (
            adjustment.review_note
        ),
    }


def payroll_payload(payroll):
    return {
        "id": payroll.id,
        "adjustments": [
            adjustment_payload(
                adjustment
            )
            for adjustment
            in payroll.adjustments.all()
        ],
        "teacher_id": payroll.teacher_id,
        "teacher_name": str(payroll.teacher),
        "teacher_username": (
            payroll.teacher.user.username
        ),
        "month": payroll.month,
        "year": payroll.year,
        "status": payroll.status,
        "normal_earnings": decimal_text(
            payroll.normal_earnings
        ),
        "substitute_earnings": decimal_text(
            payroll.substitute_earnings
        ),
        "approved_bonus_total": decimal_text(
            payroll.approved_bonus_total
        ),
        "automatic_absence_deduction_total": (
            decimal_text(
                payroll
                .automatic_absence_deduction_total
            )
        ),
        "approved_manual_deduction_total": (
            decimal_text(
                payroll
                .approved_manual_deduction_total
            )
        ),
        "dropped_class_reversal_total": (
            decimal_text(
                payroll
                .dropped_class_reversal_total
            )
        ),
        "previous_month_restoration_total": (
            decimal_text(
                payroll
                .previous_month_restoration_total
            )
        ),
        "gross_total": decimal_text(
            payroll.gross_total
        ),
        "deduction_total": decimal_text(
            payroll.deduction_total
        ),
        "final_total": decimal_text(
            payroll.final_total
        ),
        "department_note": (
            payroll.department_note
        ),
        "super_admin_note": (
            payroll.super_admin_note
        ),
        "submitted_at": (
            payroll.submitted_at.isoformat()
            if payroll.submitted_at
            else None
        ),
        "approved_at": (
            payroll.approved_at.isoformat()
            if payroll.approved_at
            else None
        ),
        "paid_at": (
            payroll.paid_at.isoformat()
            if payroll.paid_at
            else None
        ),
        "calculated_at": (
            payroll.calculated_at.isoformat()
            if payroll.calculated_at
            else None
        ),
        "calculation_snapshot": (
            payroll.calculation_snapshot or {}
        ),
        "readiness": payroll_readiness(
            payroll
        ),
    }


def ledger_payload(payroll):
    rows = (
        payroll.ledger_entries
        .select_related(
            "teacher__user",
            "student__user",
        )
        .order_by(
            "effective_date",
            "entry_type",
            "id",
        )
    )

    return [
        {
            "id": row.id,
            "entry_type": row.entry_type,
            "entry_type_label": (
                row.get_entry_type_display()
            ),
            "date": (
                str(row.effective_date)
                if row.effective_date
                else None
            ),
            "teacher_id": row.teacher_id,
            "teacher_name": str(row.teacher),
            "student_id": row.student_id,
            "student_name": (
                str(row.student)
                if row.student
                else ""
            ),
            "salary_unit_number": (
                row.salary_unit_number
            ),
            "class_count_at_time": (
                row.class_count_at_time
            ),
            "rate": decimal_text(row.rate),
            "amount": decimal_text(row.amount),
            "description": row.description,
            "source_month": row.source_month,
            "source_year": row.source_year,
            "metadata": row.metadata or {},
        }
        for row in rows
    ]
