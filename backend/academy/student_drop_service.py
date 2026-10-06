from __future__ import annotations

from datetime import (
    date,
    timedelta,
)

from django.db import transaction
from django.db.models import Q

from .models import (
    Attendance,
    ClassSchedule,
    QuranStudentDropEvent,
    StudentProfile,
)
from .payroll_source_locks import (
    ensure_student_state_change_payroll_editable,
)
from .salary_v2_service import (
    WEEKDAY_NUMBERS,
)


DROP_STREAK_LENGTH = 3

DROP_ATTENDANCE_STATUSES = {
    Attendance.Status.ABSENT,
    Attendance.Status.LEAVE,
}


class StudentDropDetectionError(Exception):
    """
    Raised when automatic drop detection cannot safely decide
    the financially responsible teacher or state.
    """

    def __init__(
        self,
        detail,
        *,
        code="student_drop_detection_error",
    ):
        super().__init__(
            detail
        )

        self.payload = {
            "detail": detail,
            "code": code,
        }


def _schedule_row_applies(
    row,
    target_date: date,
):
    """
    Match Quran Salary V2 effective-schedule semantics.
    """

    start = row.effective_from
    end = row.effective_to

    if (
        start
        and target_date < start
    ):
        return False

    if (
        end
        and target_date > end
    ):
        return False

    # Historical rows that were explicitly closed remain
    # valid inside their effective range even if is_active
    # is now False.
    if (
        not row.is_active
        and end is None
    ):
        return False

    return True


def _is_real_scheduled_date(
    schedule_rows,
    target_date: date,
):
    weekday = (
        target_date.weekday()
    )

    for row in schedule_rows:

        if not _schedule_row_applies(
            row,
            target_date,
        ):
            continue

        row_weekday = (
            WEEKDAY_NUMBERS.get(
                row.weekday
            )
        )

        if (
            row_weekday
            == weekday
        ):
            return True

    return False


def _effective_teacher_ids(
    schedule_rows,
    target_date: date,
):
    weekday = (
        target_date.weekday()
    )

    teacher_ids = set()

    for row in schedule_rows:

        if not _schedule_row_applies(
            row,
            target_date,
        ):
            continue

        if (
            WEEKDAY_NUMBERS.get(
                row.weekday
            )
            != weekday
        ):
            continue

        if row.teacher_id:
            teacher_ids.add(
                row.teacher_id
            )

    return teacher_ids


def _schedule_rows_for_student(
    student,
    target_date: date,
):
    """
    Load all schedule versions which may be needed while
    walking backward from target_date.
    """

    return list(
        ClassSchedule.objects
        .filter(
            student=student,
            effective_from__lte=target_date,
        )
        .order_by(
            "effective_from",
            "id",
        )
    )


def _scheduled_dates_backwards(
    *,
    schedule_rows,
    target_date: date,
    limit=DROP_STREAK_LENGTH,
):
    """
    Return the most recent real scheduled dates ending at or
    before target_date, newest first.

    The search stops at the earliest known schedule start.
    """

    if not schedule_rows:
        return []

    starts = [
        row.effective_from
        for row in schedule_rows
        if row.effective_from
    ]

    if not starts:
        return []

    earliest = min(
        starts
    )

    result = []

    cursor = target_date

    while (
        cursor >= earliest
        and len(result) < limit
    ):

        if _is_real_scheduled_date(
            schedule_rows,
            cursor,
        ):
            result.append(
                cursor
            )

        cursor -= timedelta(
            days=1
        )

    return result


def _attendance_map(
    *,
    student,
    scheduled_dates,
):
    """
    Missing row means Not Marked.

    Student attendance is already uniquely constrained to
    one student/day by the Attendance model.
    """

    rows = (
        Attendance.objects
        .select_for_update(
            of=("self",)
        )
        .filter(
            entity_type=(
                Attendance
                .EntityType
                .STUDENT
            ),
            student=student,
            date__in=scheduled_dates,
        )
        .order_by(
            "date",
            "id",
        )
    )

    return {
        row.date: row
        for row in rows
    }


def _drop_proof_payload(
    rows_chronological,
):
    return [
        {
            "attendance_id": (
                row.id
            ),
            "date": str(
                row.date
            ),
            "status": (
                row.status
            ),
            "marked_by_id": (
                row.marked_by_id
            ),
        }
        for row
        in rows_chronological
    ]


@transaction.atomic
def reconcile_student_drop_from_attendance(
    *,
    student,
    target_date: date,
    actor=None,
):
    """
    Detect the Quran Salary V2 three-absence drop rule.

    Rule:
      - only real scheduled dates count;
      - Absent and Leave both count toward the streak;
      - mixed A/L is allowed;
      - Present resets/breaks the streak;
      - missing attendance is Not Marked and blocks detection;
      - exactly the latest three consecutive scheduled
        attendance rows must all be Absent/Leave;
      - duplicate active drops are not created;
      - the drop is financially effective on the third
        scheduled A/L date.

    This service intentionally does NOT change
    StudentProfile.class_status yet. QuranStudentDropEvent
    is the V2 salary source of truth for automatic drops.
    """

    if not isinstance(
        target_date,
        date,
    ):
        raise ValueError(
            "target_date must be a valid date."
        )

    # Serialize drop decisions per student.
    #
    # Lock only StudentProfile because nullable related joins
    # must not participate in PostgreSQL FOR UPDATE.
    student = (
        StudentProfile.objects
        .select_for_update(
            of=("self",)
        )
        .select_related(
            "department",
            "teacher",
            "institution",
        )
        .get(
            id=student.id
        )
    )

    department = (
        student.department
    )

    if department is None:
        raise StudentDropDetectionError(
            "Student has no department; "
            "automatic drop cannot be safely recorded.",
            code="student_department_missing",
        )

    schedule_rows = (
        _schedule_rows_for_student(
            student,
            target_date,
        )
    )

    if not schedule_rows:
        return {
            "created": False,
            "reason": "no_schedule",
            "student_id": student.id,
        }

    # Attendance marked on a non-scheduled day must never
    # create a salary drop.
    if not _is_real_scheduled_date(
        schedule_rows,
        target_date,
    ):
        return {
            "created": False,
            "reason": "target_not_scheduled",
            "student_id": student.id,
        }

    scheduled_dates = (
        _scheduled_dates_backwards(
            schedule_rows=schedule_rows,
            target_date=target_date,
            limit=DROP_STREAK_LENGTH,
        )
    )

    if (
        len(scheduled_dates)
        < DROP_STREAK_LENGTH
    ):
        return {
            "created": False,
            "reason": "insufficient_schedule_history",
            "student_id": student.id,
            "scheduled_dates": [
                str(item)
                for item in scheduled_dates
            ],
        }

    attendance_by_date = (
        _attendance_map(
            student=student,
            scheduled_dates=scheduled_dates,
        )
    )

    rows_newest_first = []

    for scheduled_date in scheduled_dates:

        attendance = (
            attendance_by_date.get(
                scheduled_date
            )
        )

        # No Attendance row means Not Marked.
        if attendance is None:
            return {
                "created": False,
                "reason": "not_marked",
                "student_id": student.id,
                "not_marked_date": str(
                    scheduled_date
                ),
            }

        if (
            attendance.status
            == Attendance.Status.PRESENT
        ):
            return {
                "created": False,
                "reason": "streak_broken_present",
                "student_id": student.id,
                "present_date": str(
                    scheduled_date
                ),
            }

        if (
            attendance.status
            not in DROP_ATTENDANCE_STATUSES
        ):
            return {
                "created": False,
                "reason": "unsupported_attendance_status",
                "student_id": student.id,
                "date": str(
                    scheduled_date
                ),
                "status": (
                    attendance.status
                ),
            }

        rows_newest_first.append(
            attendance
        )

    # Oldest -> newest proof.
    proof_rows = list(
        reversed(
            rows_newest_first
        )
    )

    streak_start = (
        proof_rows[0].date
    )

    streak_end = (
        proof_rows[-1].date
    )

    assert (
        streak_end
        == target_date
    )

    # Serialize against any existing drop rows as well.
    existing_rows = (
        QuranStudentDropEvent.objects
        .select_for_update(
            of=("self",)
        )
        .filter(
            student=student,
        )
        .order_by(
            "drop_effective_date",
            "id",
        )
    )

    existing_rows = list(
        existing_rows
    )

    # Exact-date idempotency.
    exact_existing = next(
        (
            row
            for row in existing_rows
            if (
                row.drop_effective_date
                == streak_end
            )
        ),
        None,
    )

    if exact_existing is not None:
        return {
            "created": False,
            "reason": "drop_already_recorded",
            "student_id": student.id,
            "drop_event_id": (
                exact_existing.id
            ),
            "drop_effective_date": str(
                exact_existing
                .drop_effective_date
            ),
        }

    # Do not create another drop while a prior drop remains
    # unrejoined.
    active_existing = next(
        (
            row
            for row in reversed(
                existing_rows
            )
            if (
                row.drop_effective_date
                <= streak_end
                and row.rejoined_date
                is None
            )
        ),
        None,
    )

    if active_existing is not None:
        return {
            "created": False,
            "reason": "already_dropped",
            "student_id": student.id,
            "drop_event_id": (
                active_existing.id
            ),
            "drop_effective_date": str(
                active_existing
                .drop_effective_date
            ),
        }

    teacher_ids = (
        _effective_teacher_ids(
            schedule_rows,
            streak_end,
        )
    )

    if not teacher_ids:
        raise StudentDropDetectionError(
            "No effective teacher exists for the "
            "third scheduled absence/leave date.",
            code="drop_teacher_missing",
        )

    if len(teacher_ids) != 1:
        raise StudentDropDetectionError(
            "Multiple effective teachers exist for the "
            "student on the drop date. Automatic drop "
            "requires an unambiguous teacher.",
            code="drop_teacher_ambiguous",
        )

    teacher_id = next(
        iter(
            teacher_ids
        )
    )

    # Creating a drop changes salary source data from the
    # drop month forward. Pending/Approved/Paid payrolls must
    # therefore block the mutation.
    ensure_student_state_change_payroll_editable(
        student=student,
        effective_date=streak_end,
    )

    drop_event = (
        QuranStudentDropEvent.objects
        .create(
            department=department,
            student=student,
            teacher_id=teacher_id,
            status=(
                QuranStudentDropEvent
                .Status
                .DROPPED
            ),
            drop_effective_date=(
                streak_end
            ),
            streak_start_date=(
                streak_start
            ),
            streak_end_date=(
                streak_end
            ),
            streak_attendance=(
                _drop_proof_payload(
                    proof_rows
                )
            ),
            rejoined_date=None,
            previous_month_restoration_required=False,
            detected_by_system=True,
            created_by=actor,
        )
    )

    return {
        "created": True,
        "reason": "three_consecutive_scheduled_absence_leave",
        "student_id": student.id,
        "teacher_id": teacher_id,
        "drop_event_id": (
            drop_event.id
        ),
        "drop_effective_date": str(
            streak_end
        ),
        "streak_start_date": str(
            streak_start
        ),
        "streak_end_date": str(
            streak_end
        ),
        "streak_attendance": (
            drop_event
            .streak_attendance
        ),
    }
