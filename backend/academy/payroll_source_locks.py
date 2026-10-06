from __future__ import annotations

from django.db import transaction
from django.db.models import Q

from .models import (
    ClassSchedule,
    QuranClassCoverage,
    QuranTeacherMonthlyPayroll,
)


LOCKED_PAYROLL_SOURCE_STATUSES = {
    QuranTeacherMonthlyPayroll.Status.PENDING_SUPER_ADMIN,
    QuranTeacherMonthlyPayroll.Status.APPROVED,
    QuranTeacherMonthlyPayroll.Status.PAID,
}


def _clean_teacher_ids(values):
    cleaned = set()

    for value in values or []:
        try:
            teacher_id = int(value)
        except (TypeError, ValueError):
            continue

        if teacher_id > 0:
            cleaned.add(teacher_id)

    return cleaned


def _requested_substitute_teacher_ids(value):
    """
    Extract substitute teacher IDs defensively from
    nested request payloads.
    """
    found = set()

    def walk(item):
        if isinstance(item, dict):
            for key, child in item.items():
                normalized = str(
                    key or ""
                ).strip().lower()

                if normalized in {
                    "substitute_teacher_id",
                    "substituteteacherid",
                    "substitute_id",
                    "substituteid",
                }:
                    found.update(
                        _clean_teacher_ids(
                            [child]
                        )
                    )

                walk(child)

        elif isinstance(
            item,
            (list, tuple),
        ):
            for child in item:
                walk(child)

    walk(value)

    return found


def _effective_schedule_teacher_ids(
    student,
    target_date,
):
    """
    Resolve the teacher whose real schedule was
    effective for the student on target_date.
    """
    weekday = (
        target_date
        .strftime("%A")
        .lower()
    )

    rows = (
        ClassSchedule.objects
        .filter(
            student=student,
            weekday=weekday,
        )
        .filter(
            Q(effective_from__isnull=True)
            | Q(effective_from__lte=target_date)
        )
        .filter(
            Q(effective_to__isnull=True)
            | Q(effective_to__gte=target_date)
        )
        .filter(
            Q(effective_to__isnull=False)
            | Q(is_active=True)
        )
        .values_list(
            "teacher_id",
            flat=True,
        )
    )

    teacher_ids = (
        _clean_teacher_ids(rows)
    )

    # Defensive fallback for legacy data.
    if not teacher_ids:
        teacher_ids.update(
            _clean_teacher_ids(
                [
                    getattr(
                        student,
                        "teacher_id",
                        None,
                    )
                ]
            )
        )

    return teacher_ids


def _coverage_teacher_ids(
    *,
    target_date,
    student=None,
    department=None,
    original_teacher=None,
    class_key=None,
):
    """
    Include original/substitute teachers whose
    payroll can change through active coverage.
    """
    rows = (
        QuranClassCoverage.objects
        .filter(
            date=target_date
        )
    )

    if department is not None:
        rows = rows.filter(
            department=department
        )

    if student is not None:
        rows = rows.filter(
            student=student
        )

    if original_teacher is not None:
        rows = rows.filter(
            original_teacher=(
                original_teacher
            )
        )

    if class_key is not None:
        rows = rows.filter(
            class_key=class_key
        )

    rows = rows.exclude(
        coverage_status=(
            QuranClassCoverage
            .CoverageStatus
            .CANCELLED
        )
    )

    teacher_ids = set()

    for (
        original_id,
        substitute_id,
    ) in rows.values_list(
        "original_teacher_id",
        "substitute_teacher_id",
    ):
        teacher_ids.update(
            _clean_teacher_ids(
                [
                    original_id,
                    substitute_id,
                ]
            )
        )

    return teacher_ids


def _locked_payroll_payload(
    *,
    department,
    target_date,
    teacher_ids,
):
    teacher_ids = (
        _clean_teacher_ids(
            teacher_ids
        )
    )

    if (
        department is None
        or not teacher_ids
    ):
        return None

    payrolls = (
        QuranTeacherMonthlyPayroll
        .objects
        .select_related(
            "teacher__user",
        )
        .filter(
            department=department,
            year=target_date.year,
            month=target_date.month,
            teacher_id__in=teacher_ids,
        )
        .order_by("id")
    )

    # Lock every existing affected payroll row
    # before inspecting its status.
    #
    # The attendance POST/DELETE entry points are
    # transaction.atomic, so this serializes them
    # against submit/approve/paid lifecycle changes.
    if (
        transaction
        .get_connection()
        .in_atomic_block
    ):
        payrolls = (
            payrolls
            .select_for_update()
        )

    payrolls = list(
        payrolls
    )

    locked = [
        payroll
        for payroll in payrolls
        if (
            payroll.status
            in LOCKED_PAYROLL_SOURCE_STATUSES
        )
    ]

    if not locked:
        return None

    has_paid = any(
        payroll.status
        == QuranTeacherMonthlyPayroll.Status.PAID
        for payroll in locked
    )

    if has_paid:
        detail = (
            "Attendance cannot be changed because "
            "an affected payroll is Paid and "
            "historically immutable. Any later "
            "correction must use the future "
            "restoration or adjustment workflow."
        )
    else:
        detail = (
            "Attendance cannot be changed because "
            "an affected payroll is Pending Super "
            "Admin or Approved. Reopen or return "
            "the payroll to an editable state first."
        )

    return {
        "detail": detail,
        "code": "payroll_source_locked",
        "date": str(target_date),
        "locked_payrolls": [
            {
                "payroll_id": payroll.id,
                "teacher_id": (
                    payroll.teacher_id
                ),
                "teacher_name": str(
                    payroll.teacher
                ),
                "status": payroll.status,
                "month": payroll.month,
                "year": payroll.year,
            }
            for payroll in locked
        ],
    }


def teacher_session_payroll_lock_payload(
    *,
    department,
    teacher,
    target_date,
    class_key,
    request_data=None,
):
    """
    Protect:
      - original teacher payroll
      - existing substitute payrolls
      - newly requested substitute payrolls
    """
    teacher_ids = (
        _clean_teacher_ids(
            [
                getattr(
                    teacher,
                    "id",
                    None,
                )
            ]
        )
    )

    teacher_ids.update(
        _coverage_teacher_ids(
            department=department,
            target_date=target_date,
            original_teacher=teacher,
            class_key=class_key,
        )
    )

    teacher_ids.update(
        _requested_substitute_teacher_ids(
            request_data
        )
    )

    return _locked_payroll_payload(
        department=department,
        target_date=target_date,
        teacher_ids=teacher_ids,
    )


def student_attendance_payroll_lock_payload(
    *,
    student,
    target_date,
    department=None,
):
    """
    Student attendance can affect:
      - normal teacher salary
      - drop reversal
      - substitute coverage salary
    """
    department = (
        department
        or getattr(
            student,
            "department",
            None,
        )
        or getattr(
            getattr(
                student,
                "user",
                None,
            ),
            "department",
            None,
        )
    )

    teacher_ids = (
        _effective_schedule_teacher_ids(
            student,
            target_date,
        )
    )

    teacher_ids.update(
        _coverage_teacher_ids(
            student=student,
            department=department,
            target_date=target_date,
        )
    )

    return _locked_payroll_payload(
        department=department,
        target_date=target_date,
        teacher_ids=teacher_ids,
    )

class PayrollSourceLockedError(Exception):
    """
    Domain error raised when a schedule/transfer
    would mutate salary source data belonging to a
    locked payroll.
    """

    def __init__(self, payload):
        super().__init__(
            payload.get(
                "detail",
                "Payroll source data is locked.",
            )
        )

        self.payload = payload


def _schedule_change_teacher_ids(
    *,
    student,
    desired_teacher,
    effective_date,
):
    teacher_ids = _clean_teacher_ids(
        [
            getattr(
                student,
                "teacher_id",
                None,
            ),
            getattr(
                desired_teacher,
                "id",
                None,
            ),
        ]
    )

    # All currently open schedule teachers are
    # salary-sensitive because this sync may close,
    # delete, retain, or replace those rows.
    current_schedule_ids = (
        ClassSchedule.objects
        .filter(
            student=student,
            is_active=True,
            effective_to__isnull=True,
        )
        .values_list(
            "teacher_id",
            flat=True,
        )
    )

    teacher_ids.update(
        _clean_teacher_ids(
            current_schedule_ids
        )
    )

    # Existing coverage on/after the effective date
    # can carry substitute earnings and therefore is
    # part of the affected payroll source surface.
    coverage_rows = (
        QuranClassCoverage.objects
        .filter(
            student=student,
            date__gte=effective_date,
        )
        .exclude(
            coverage_status=(
                QuranClassCoverage
                .CoverageStatus
                .CANCELLED
            )
        )
        .values_list(
            "original_teacher_id",
            "substitute_teacher_id",
        )
    )

    for (
        original_id,
        substitute_id,
    ) in coverage_rows:
        teacher_ids.update(
            _clean_teacher_ids(
                [
                    original_id,
                    substitute_id,
                ]
            )
        )

    return teacher_ids


def schedule_change_payroll_lock_payload(
    *,
    student,
    desired_teacher,
    effective_date,
):
    """
    Schedule and transfer changes are open-ended.

    Therefore they must protect locked payrolls from
    the effective month forward, rather than checking
    only one target date.
    """
    department = (
        getattr(
            student,
            "department",
            None,
        )
        or getattr(
            desired_teacher,
            "department",
            None,
        )
    )

    teacher_ids = (
        _schedule_change_teacher_ids(
            student=student,
            desired_teacher=desired_teacher,
            effective_date=effective_date,
        )
    )

    if (
        department is None
        or not teacher_ids
    ):
        return None

    payrolls = (
        QuranTeacherMonthlyPayroll
        .objects
        .select_related(
            "teacher__user",
        )
        .filter(
            department=department,
            teacher_id__in=teacher_ids,
        )
        .filter(
            Q(
                year__gt=effective_date.year
            )
            | Q(
                year=effective_date.year,
                month__gte=(
                    effective_date.month
                ),
            )
        )
        .order_by(
            "year",
            "month",
            "id",
        )
    )

    # sync_student_schedule_history() is atomic.
    #
    # Lock all existing affected payroll rows,
    # including currently editable ones, so this
    # source mutation serializes with lifecycle
    # transitions on those payrolls.
    if (
        transaction
        .get_connection()
        .in_atomic_block
    ):
        payrolls = (
            payrolls
            .select_for_update()
        )

    payrolls = list(
        payrolls
    )

    locked = [
        payroll
        for payroll in payrolls
        if (
            payroll.status
            in LOCKED_PAYROLL_SOURCE_STATUSES
        )
    ]

    if not locked:
        return None

    has_paid = any(
        payroll.status
        == QuranTeacherMonthlyPayroll.Status.PAID
        for payroll in locked
    )

    if has_paid:
        detail = (
            "Teacher or schedule assignment cannot "
            "be changed because an affected payroll "
            "is Paid and historically immutable. "
            "A paid historical month must not be "
            "rewritten."
        )
    else:
        detail = (
            "Teacher or schedule assignment cannot "
            "be changed because an affected payroll "
            "is Pending Super Admin or Approved. "
            "Return the affected payroll to an "
            "editable state first."
        )

    return {
        "detail": detail,
        "code": (
            "payroll_source_locked"
        ),
        "effective_date": str(
            effective_date
        ),
        "student_id": (
            student.id
        ),
        "affected_teacher_ids": (
            sorted(
                teacher_ids
            )
        ),
        "locked_payrolls": [
            {
                "payroll_id": (
                    payroll.id
                ),
                "teacher_id": (
                    payroll.teacher_id
                ),
                "teacher_name": str(
                    payroll.teacher
                ),
                "status": (
                    payroll.status
                ),
                "month": (
                    payroll.month
                ),
                "year": (
                    payroll.year
                ),
            }
            for payroll in locked
        ],
    }


def ensure_schedule_change_payroll_editable(
    *,
    student,
    desired_teacher,
    effective_date,
):
    payload = (
        schedule_change_payroll_lock_payload(
            student=student,
            desired_teacher=desired_teacher,
            effective_date=effective_date,
        )
    )

    if payload:
        raise PayrollSourceLockedError(
            payload
        )


def _student_state_change_teacher_ids(
    *,
    student,
    effective_date,
):
    """
    Return every teacher whose payroll source may be affected
    by a financially active/inactive class-status change from
    effective_date forward.
    """

    from .models import StudentClassHistory

    teacher_ids = _clean_teacher_ids(
        [
            getattr(
                student,
                "teacher_id",
                None,
            ),
        ]
    )

    # Any schedule that is still financially relevant on or
    # after the effective date may belong to an affected
    # teacher.
    schedule_teacher_ids = (
        ClassSchedule.objects
        .filter(
            student=student,
        )
        .filter(
            Q(
                effective_to__isnull=True
            )
            | Q(
                effective_to__gte=effective_date
            )
        )
        .values_list(
            "teacher_id",
            flat=True,
        )
    )

    teacher_ids.update(
        _clean_teacher_ids(
            schedule_teacher_ids
        )
    )

    # Future transfer events may move the same class between
    # teachers after this status change becomes effective.
    transfer_rows = (
        StudentClassHistory.objects
        .filter(
            student=student,
            effective_date__gte=effective_date,
        )
        .values_list(
            "previous_teacher_id",
            "new_teacher_id",
        )
    )

    for (
        previous_teacher_id,
        new_teacher_id,
    ) in transfer_rows:

        teacher_ids.update(
            _clean_teacher_ids(
                [
                    previous_teacher_id,
                    new_teacher_id,
                ]
            )
        )

    # Substitute/original teacher earnings can also depend on
    # this student's financially active state.
    coverage_rows = (
        QuranClassCoverage.objects
        .filter(
            student=student,
            date__gte=effective_date,
        )
        .exclude(
            coverage_status=(
                QuranClassCoverage
                .CoverageStatus
                .CANCELLED
            )
        )
        .values_list(
            "original_teacher_id",
            "substitute_teacher_id",
        )
    )

    for (
        original_teacher_id,
        substitute_teacher_id,
    ) in coverage_rows:

        teacher_ids.update(
            _clean_teacher_ids(
                [
                    original_teacher_id,
                    substitute_teacher_id,
                ]
            )
        )

    return teacher_ids


def student_state_change_payroll_lock_payload(
    *,
    student,
    effective_date,
):
    """
    Protect financially material student class-status changes.

    Running and On Leave are salary-active.

    Dropped and Not Counted states are salary-inactive.

    Crossing between those groups may change active class
    counts and therefore the dynamic teacher salary tier.
    """

    department = getattr(
        student,
        "department",
        None,
    )

    teacher_ids = (
        _student_state_change_teacher_ids(
            student=student,
            effective_date=effective_date,
        )
    )

    if (
        department is None
        or not teacher_ids
    ):
        return None

    payrolls = (
        QuranTeacherMonthlyPayroll
        .objects
        .select_related(
            "teacher__user",
        )
        .filter(
            department=department,
            teacher_id__in=teacher_ids,
        )
        .filter(
            Q(
                year__gt=effective_date.year
            )
            | Q(
                year=effective_date.year,
                month__gte=effective_date.month,
            )
        )
        .order_by(
            "year",
            "month",
            "id",
        )
    )

    # Serialize against payroll lifecycle transitions.
    #
    # Lock ONLY payroll rows. Related objects are reference
    # data and must not be pulled into PostgreSQL FOR UPDATE.
    if (
        transaction
        .get_connection()
        .in_atomic_block
    ):
        payrolls = (
            payrolls
            .select_for_update(
                of=("self",)
            )
        )

    payrolls = list(
        payrolls
    )

    locked = [
        payroll
        for payroll in payrolls
        if (
            payroll.status
            in LOCKED_PAYROLL_SOURCE_STATUSES
        )
    ]

    if not locked:
        return None

    has_paid = any(
        payroll.status
        == QuranTeacherMonthlyPayroll.Status.PAID
        for payroll in locked
    )

    if has_paid:
        detail = (
            "Student class status cannot be changed "
            "because an affected payroll is Paid and "
            "historically immutable. A paid historical "
            "month must not be rewritten."
        )
    else:
        detail = (
            "Student class status cannot be changed "
            "because an affected payroll is Pending "
            "Super Admin or Approved. Return the "
            "affected payroll to an editable state first."
        )

    return {
        "detail": detail,
        "code": "payroll_source_locked",
        "source": "student_class_status",
        "effective_date": str(
            effective_date
        ),
        "student_id": student.id,
        "affected_teacher_ids": sorted(
            teacher_ids
        ),
        "locked_payrolls": [
            {
                "payroll_id": (
                    payroll.id
                ),
                "teacher_id": (
                    payroll.teacher_id
                ),
                "teacher_name": str(
                    payroll.teacher
                ),
                "status": (
                    payroll.status
                ),
                "month": (
                    payroll.month
                ),
                "year": (
                    payroll.year
                ),
            }
            for payroll in locked
        ],
    }


def ensure_student_state_change_payroll_editable(
    *,
    student,
    effective_date,
):
    payload = (
        student_state_change_payroll_lock_payload(
            student=student,
            effective_date=effective_date,
        )
    )

    if payload:
        raise PayrollSourceLockedError(
            payload
        )
