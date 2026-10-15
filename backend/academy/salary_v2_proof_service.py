"""Read-only student evidence for the Salary V2 proof endpoint.

This module intentionally does not use the salary calculator.  A proof for a
saved payroll must describe the evidence that exists now without rewriting a
payroll, policy, coverage, or ledger entry.
"""

from collections import defaultdict

from django.db.models import Prefetch, Q

from .models import (
    Attendance,
    ClassSchedule,
    QuranClassCoverage,
    QuranSalaryLedgerEntry,
    StudentClassHistory,
    StudentProfile,
)
from .salary_v2_service import (
    _base_status_is_salary_active,
    _drop_active_on_date,
    _schedule_row_applies,
    build_student_daily_states,
    decimal_text,
    month_bounds,
)


def _empty_attendance_summary():
    return {
        "present": 0,
        "leave": 0,
        "absent": 0,
        "not_marked": 0,
        "status": "complete",
        "unavailable_reasons": [],
    }


def _add_status(summary, value):
    if value in {
        Attendance.Status.PRESENT,
        Attendance.Status.LEAVE,
        Attendance.Status.ABSENT,
    }:
        summary[value] += 1


def _mark_incomplete(summary, reason, *, not_marked=False):
    summary["status"] = "incomplete"
    if not_marked:
        summary["not_marked"] += 1
    if reason not in summary["unavailable_reasons"]:
        summary["unavailable_reasons"].append(reason)


def _student_proof_queryset(student_ids):
    return (
        StudentProfile.objects.select_related("user")
        .filter(id__in=student_ids)
        .prefetch_related(
            Prefetch(
                "class_history",
                queryset=StudentClassHistory.objects.order_by(
                    "effective_date", "created_at", "id"
                ),
                to_attr="salary_v2_history",
            ),
            Prefetch(
                "schedules",
                queryset=ClassSchedule.objects.order_by(
                    "effective_from", "weekday", "time_slot", "id"
                ),
                to_attr="salary_v2_schedules",
            ),
            Prefetch(
                "drop_events_v2",
                to_attr="salary_v2_drop_events",
            ),
        )
        .order_by("id")
    )


def _schedule_sessions_for_teacher(student, daily_states, teacher_id):
    """Return reliably scheduled sessions for this teacher, keyed by date.

    Student attendance has one row per date, so overlapping historical
    schedule rows on one date are reported as incomplete rather than guessed.
    """
    sessions = defaultdict(list)
    schedules = getattr(student, "salary_v2_schedules", [])
    drop_events = getattr(student, "salary_v2_drop_events", [])

    for current, state in daily_states.items():
        if (
            not state.get("enrolled")
            or state.get("teacher_id") != teacher_id
            or not _base_status_is_salary_active(state.get("class_status"))
            or _drop_active_on_date(drop_events, current)
        ):
            continue

        for schedule in schedules:
            if (
                schedule.teacher_id == teacher_id
                and _schedule_row_applies(schedule, current)
                and schedule.weekday == current.strftime("%A").lower()
            ):
                sessions[current].append(schedule.time_slot.strftime("%H:%M"))

    return sessions


def _rate_payload(normal_entries):
    if not normal_entries:
        return {
            "status": "unavailable",
            "rates": [],
            "entries": [],
        }

    entries = [
        {
            "date": str(entry.effective_date) if entry.effective_date else None,
            "rate": decimal_text(entry.rate),
            "amount": decimal_text(entry.amount),
            "class_count_at_time": entry.class_count_at_time,
        }
        for entry in normal_entries
    ]
    rates = sorted({entry["rate"] for entry in entries}, key=lambda value: (float(value), value))
    return {
        "status": "single" if len(rates) == 1 else "multiple",
        "rates": rates,
        "entries": entries,
    }


def _teacher_status_for_session(
    *,
    target_teacher_id,
    student_row,
    coverage,
    teacher_sessions,
):
    """Get a recorded teacher status without treating a missing row as absent."""
    if coverage and coverage.original_teacher_id == target_teacher_id:
        # Coverage is created from the original teacher's recorded absence or
        # leave.  It is more precise than a current schedule after transfers.
        return coverage.teacher_status, None

    class_key = ""
    if coverage:
        class_key = coverage.class_key or ""
    elif student_row:
        class_key = student_row.class_key or ""

    if not class_key:
        return None, "The teacher session has no class time for reliable mapping."

    session = teacher_sessions.get((target_teacher_id, student_row.date, class_key))
    if not session:
        return None, "No recorded teacher attendance matches this student session."
    return session.status, None


def student_attendance_summaries(payroll):
    """Build student proof rows from immutable ledger evidence and attendance.

    One bounded query is used for each relation.  The returned data contains
    counts only for known recorded statuses; a missing or ambiguous record is
    explicitly incomplete and is never converted to an absence.
    """
    start, end = month_bounds(payroll.year, payroll.month)
    ledger_entries = list(
        QuranSalaryLedgerEntry.objects.filter(
            payroll=payroll,
            student_id__isnull=False,
        )
        .select_related("student__user")
        .order_by("student_id", "effective_date", "id")
    )
    student_ids = sorted({row.student_id for row in ledger_entries})
    if not student_ids:
        return []

    entries_by_student = defaultdict(list)
    normal_entries_by_student = defaultdict(list)
    for entry in ledger_entries:
        entries_by_student[entry.student_id].append(entry)
        if entry.entry_type == QuranSalaryLedgerEntry.EntryType.NORMAL_EARNING:
            normal_entries_by_student[entry.student_id].append(entry)

    students = list(_student_proof_queryset(student_ids))
    students_by_id = {student.id: student for student in students}

    student_rows = list(
        Attendance.objects.filter(
            entity_type=Attendance.EntityType.STUDENT,
            student_id__in=student_ids,
            date__range=(start, end),
        ).only("student_id", "teacher_id", "date", "class_key", "status")
    )
    student_rows_by_id_date = {
        (row.student_id, row.date): row for row in student_rows
    }

    coverages = list(
        QuranClassCoverage.objects.filter(
            department=payroll.department,
            student_id__in=student_ids,
            date__range=(start, end),
        )
        .filter(
            Q(original_teacher=payroll.teacher)
            | Q(substitute_teacher=payroll.teacher)
        )
        .exclude(coverage_status=QuranClassCoverage.CoverageStatus.CANCELLED)
        .only(
            "student_id",
            "date",
            "class_key",
            "original_teacher_id",
            "substitute_teacher_id",
            "teacher_status",
        )
        .order_by("id")
    )
    coverage_by_student_date = {}
    ambiguous_coverage_dates = set()
    for coverage in coverages:
        key = (coverage.student_id, coverage.date)
        if key in coverage_by_student_date:
            ambiguous_coverage_dates.add(key)
        else:
            coverage_by_student_date[key] = coverage

    teacher_rows = Attendance.objects.filter(
        entity_type=Attendance.EntityType.TEACHER,
        teacher=payroll.teacher,
        date__range=(start, end),
    ).only("teacher_id", "date", "class_key", "status")
    teacher_sessions = {
        (row.teacher_id, row.date, row.class_key or ""): row
        for row in teacher_rows
    }

    results = []
    for student_id in student_ids:
        student = students_by_id.get(student_id)
        if not student:
            # Protected ledger foreign keys normally make this impossible, but
            # a proof must remain safe if a legacy row cannot be joined.
            results.append(
                {
                    "student_id": student_id,
                    "student_name": "",
                    "student_attendance": {
                        **_empty_attendance_summary(),
                        "status": "unavailable",
                        "unavailable_reasons": ["Student record is unavailable."],
                    },
                    "teacher_attendance": {
                        **_empty_attendance_summary(),
                        "status": "unavailable",
                        "unavailable_reasons": ["Student record is unavailable."],
                    },
                    "applied_per_class_rates": _rate_payload(
                        normal_entries_by_student[student_id]
                    ),
                }
            )
            continue

        daily_states = build_student_daily_states(student, start, end)
        schedule_sessions = _schedule_sessions_for_teacher(
            student, daily_states, payroll.teacher_id
        )
        student_summary = _empty_attendance_summary()
        teacher_summary = _empty_attendance_summary()

        relevant_dates = set(schedule_sessions)
        ledger_dates = {
            entry.effective_date
            for entry in entries_by_student[student_id]
            if entry.effective_date
        }
        relevant_dates.update(ledger_dates)
        relevant_dates.update(
            coverage.date
            for coverage in coverages
            if coverage.student_id == student_id
        )

        for current in sorted(relevant_dates):
            row = student_rows_by_id_date.get((student_id, current))
            coverage = coverage_by_student_date.get((student_id, current))
            scheduled_keys = schedule_sessions.get(current, [])
            has_ambiguous_schedule = len(scheduled_keys) > 1

            if (student_id, current) in ambiguous_coverage_dates:
                _mark_incomplete(
                    student_summary,
                    "More than one coverage record applies to this student date.",
                )
                _mark_incomplete(
                    teacher_summary,
                    "More than one coverage record applies to this student date.",
                )
                continue

            if has_ambiguous_schedule:
                _mark_incomplete(
                    student_summary,
                    "More than one scheduled session applies on this date.",
                    not_marked=row is None,
                )
                _mark_incomplete(
                    teacher_summary,
                    "More than one scheduled session applies on this date.",
                    not_marked=row is None,
                )
                continue

            mapped_by_coverage = coverage is not None
            mapped_by_record = bool(row and row.teacher_id == payroll.teacher_id)
            mapped_by_schedule = bool(
                row
                and row.teacher_id is None
                and len(scheduled_keys) == 1
                and row.class_key == scheduled_keys[0]
            )

            if row is None:
                if scheduled_keys or coverage or current in ledger_dates:
                    _mark_incomplete(
                        student_summary,
                        "No recorded student attendance exists for this scheduled session.",
                        not_marked=True,
                    )
                    _mark_incomplete(
                        teacher_summary,
                        "No recorded student attendance exists for this scheduled session.",
                        not_marked=True,
                    )
                continue

            if not (mapped_by_coverage or mapped_by_record or mapped_by_schedule):
                _mark_incomplete(
                    student_summary,
                    "Student attendance cannot be reliably mapped to this teacher.",
                )
                _mark_incomplete(
                    teacher_summary,
                    "Student attendance cannot be reliably mapped to this teacher session.",
                )
                continue

            _add_status(student_summary, row.status)
            teacher_status, reason = _teacher_status_for_session(
                target_teacher_id=payroll.teacher_id,
                student_row=row,
                coverage=coverage,
                teacher_sessions=teacher_sessions,
            )
            if teacher_status is None:
                _mark_incomplete(teacher_summary, reason)
            else:
                _add_status(teacher_summary, teacher_status)

        results.append(
            {
                "student_id": student.id,
                "student_name": str(student),
                "student_attendance": student_summary,
                "teacher_attendance": teacher_summary,
                "applied_per_class_rates": _rate_payload(
                    normal_entries_by_student[student.id]
                ),
            }
        )

    return results
