from __future__ import annotations

from datetime import date

from django.db import transaction

from .models import (
    StudentClassHistory,
    StudentProfile,
)
from .payroll_source_locks import (
    ensure_student_state_change_payroll_editable,
)


def _choice_values(
    model,
    field_name,
):
    field = model._meta.get_field(
        field_name
    )

    return {
        value
        for value, _label
        in field.choices
    }


def _salary_active_class_status(
    status,
):
    """
    Quran Salary V2 financial class-status rule.

    Running and On Leave remain financially active.

    Dropped and Not Counted states are inactive.
    """

    return status in {
        StudentProfile.ClassStatus.RUNNING,
        StudentProfile.ClassStatus.ON_LEAVE,
    }


def _state_before_effective_date(
    *,
    student,
    effective_date,
):
    """
    Reconstruct state immediately before effective_date.

    StudentProfile stores current/latest state. Existing
    history on or after effective_date is reversed so a
    backdated change records the correct previous state.
    """

    state = {
        "student_type": (
            student.student_type
        ),
        "class_status": (
            student.class_status
        ),
    }

    histories = list(
        StudentClassHistory.objects
        .filter(
            student=student,
            effective_date__gte=effective_date,
        )
        .order_by(
            "effective_date",
            "created_at",
            "id",
        )
    )

    for row in reversed(
        histories
    ):

        if (
            row.new_student_type
            and row.previous_student_type
        ):
            state[
                "student_type"
            ] = (
                row.previous_student_type
            )

        if (
            row.new_class_status
            and row.previous_class_status
        ):
            state[
                "class_status"
            ] = (
                row.previous_class_status
            )

    return state


@transaction.atomic
def sync_student_state_history(
    *,
    student,
    effective_date: date,
    desired_class_status=None,
    desired_student_type=None,
    actor=None,
    note="Student state change.",
):
    """
    Controlled effective-dated student-state mutation.

    class_status:
        Payroll protection applies only when the change
        crosses between financially active and inactive
        status groups.

    student_type:
        Recorded historically for workflow/reporting.
        Quran Salary V2 currently does not use it to
        calculate money.

    salary_class_mode and half_month_salary_amount are
    deliberately excluded because Quran Salary V2 does
    not consume either field.
    """

    if not isinstance(
        effective_date,
        date,
    ):
        raise ValueError(
            "effective_date must be a valid date."
        )

    # institution is nullable, so select_related() creates an
    # outer join. PostgreSQL must lock only StudentProfile.
    student = (
        StudentProfile.objects
        .select_for_update(
            of=("self",)
        )
        .select_related(
            "teacher",
            "department",
            "institution",
        )
        .get(
            id=student.id
        )
    )

    allowed_statuses = _choice_values(
        StudentProfile,
        "class_status",
    )

    allowed_types = _choice_values(
        StudentProfile,
        "student_type",
    )

    desired_class_status = str(
        desired_class_status
        if desired_class_status is not None
        else student.class_status
    ).strip()

    desired_student_type = str(
        desired_student_type
        if desired_student_type is not None
        else student.student_type
    ).strip()

    if (
        desired_class_status
        not in allowed_statuses
    ):
        raise ValueError(
            "Invalid class_status."
        )

    if (
        desired_student_type
        not in allowed_types
    ):
        raise ValueError(
            "Invalid student_type."
        )

    previous = (
        _state_before_effective_date(
            student=student,
            effective_date=effective_date,
        )
    )

    previous_status = (
        previous[
            "class_status"
        ]
    )

    previous_type = (
        previous[
            "student_type"
        ]
    )

    status_changed = (
        desired_class_status
        != previous_status
    )

    type_changed = (
        desired_student_type
        != previous_type
    )

    financial_status_change = (
        status_changed
        and (
            _salary_active_class_status(
                previous_status
            )
            !=
            _salary_active_class_status(
                desired_class_status
            )
        )
    )

    # Important: payroll lock runs before history/profile
    # mutation.
    if financial_status_change:
        ensure_student_state_change_payroll_editable(
            student=student,
            effective_date=effective_date,
        )

    institution = (
        student.institution
        or getattr(
            student.department,
            "institution",
            None,
        )
    )

    created_ids = []

    if status_changed:

        row = (
            StudentClassHistory.objects
            .create(
                institution=institution,
                department=(
                    student.department
                ),
                student=student,
                event_type=(
                    StudentClassHistory
                    .EventType
                    .STATUS_CHANGED
                ),
                effective_date=(
                    effective_date
                ),
                previous_class_status=(
                    previous_status
                ),
                new_class_status=(
                    desired_class_status
                ),
                notes=note,
                created_by=actor,
            )
        )

        created_ids.append(
            row.id
        )

    if type_changed:

        row = (
            StudentClassHistory.objects
            .create(
                institution=institution,
                department=(
                    student.department
                ),
                student=student,
                event_type=(
                    StudentClassHistory
                    .EventType
                    .STUDENT_TYPE_CHANGED
                ),
                effective_date=(
                    effective_date
                ),
                previous_student_type=(
                    previous_type
                ),
                new_student_type=(
                    desired_student_type
                ),
                notes=note,
                created_by=actor,
            )
        )

        created_ids.append(
            row.id
        )

    update_fields = []

    # A backdated status event must not replace a newer current
    # StudentProfile state.
    current_status_date = (
        student.status_effective_date
    )

    if (
        status_changed
        and (
            current_status_date is None
            or effective_date
            >= current_status_date
        )
    ):
        student.class_status = (
            desired_class_status
        )

        student.status_effective_date = (
            effective_date
        )

        update_fields.extend(
            [
                "class_status",
                "status_effective_date",
            ]
        )

    # student_type has no dedicated effective-date column.
    # Do not overwrite the current value if a later historical
    # student-type event already exists.
    later_type_exists = (
        StudentClassHistory.objects
        .filter(
            student=student,
            effective_date__gt=effective_date,
        )
        .exclude(
            new_student_type="",
        )
        .exists()
    )

    if (
        type_changed
        and not later_type_exists
    ):
        student.student_type = (
            desired_student_type
        )

        update_fields.append(
            "student_type"
        )

    if update_fields:
        student.save(
            update_fields=sorted(
                set(
                    update_fields
                )
            )
        )

    student.refresh_from_db()

    return {
        "student_id": (
            student.id
        ),
        "status_changed": (
            status_changed
        ),
        "student_type_changed": (
            type_changed
        ),
        "financial_status_change": (
            financial_status_change
        ),
        "class_status": (
            student.class_status
        ),
        "student_type": (
            student.student_type
        ),
        "status_effective_date": str(
            student.status_effective_date
        ),
        "history_ids": (
            created_ids
        ),
    }
