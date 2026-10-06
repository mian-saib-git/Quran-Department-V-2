from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from .salary_v2_models import (
    QuranSalaryAdjustment,
    QuranSalaryLedgerEntry,
    QuranStudentDropEvent,
    QuranTeacherMonthlyPayroll,
)
from .salary_v2_service import (
    calculate_teacher_payroll,
    money,
)


class StudentRejoinError(Exception):
    """
    Controlled domain error for Quran Salary V2 rejoin operations.

    payload is safe for a future API layer to return as HTTP 409.
    """

    def __init__(
        self,
        *,
        code: str,
        detail: str,
        payload: dict | None = None,
    ):
        body = {
            "detail": detail,
            "code": code,
        }

        if payload:
            body.update(payload)

        self.code = code
        self.payload = body

        super().__init__(detail)


LOCKED_UNPAID_SOURCE_STATUSES = {
    QuranTeacherMonthlyPayroll.Status.PENDING_SUPER_ADMIN,
    QuranTeacherMonthlyPayroll.Status.APPROVED,
}

LOCKED_REJOIN_MONTH_STATUSES = {
    QuranTeacherMonthlyPayroll.Status.PENDING_SUPER_ADMIN,
    QuranTeacherMonthlyPayroll.Status.APPROVED,
    QuranTeacherMonthlyPayroll.Status.PAID,
}


def _month_key(
    year: int,
    month: int,
):
    return (
        int(year),
        int(month),
    )


def _next_month(
    year: int,
    month: int,
):
    year = int(year)
    month = int(month)

    if month == 12:
        return (
            year + 1,
            1,
        )

    return (
        year,
        month + 1,
    )


def _locked_payroll_payload(
    payroll,
    *,
    code: str,
    detail: str,
):
    return StudentRejoinError(
        code=code,
        detail=detail,
        payload={
            "payroll_id": payroll.id,
            "teacher_id": payroll.teacher_id,
            "status": payroll.status,
            "month": payroll.month,
            "year": payroll.year,
        },
    )


def _source_payroll_for_drop(
    drop_event,
):
    return (
        QuranTeacherMonthlyPayroll.objects
        .select_for_update(of=("self",))
        .filter(
            department=drop_event.department,
            teacher=drop_event.teacher,
            year=drop_event.drop_effective_date.year,
            month=drop_event.drop_effective_date.month,
        )
        .first()
    )


def _rejoin_month_locked_payroll(
    *,
    student,
    drop_event,
    rejoin_date,
):
    teacher_ids = {
        drop_event.teacher_id,
    }

    current_teacher_id = getattr(
        student,
        "teacher_id",
        None,
    )

    if current_teacher_id:
        teacher_ids.add(
            current_teacher_id
        )

    teacher_ids.discard(None)

    if not teacher_ids:
        return None

    rows = (
        QuranTeacherMonthlyPayroll.objects
        .select_for_update(of=("self",))
        .filter(
            department=drop_event.department,
            teacher_id__in=teacher_ids,
            year=rejoin_date.year,
            month=rejoin_date.month,
            status__in=(
                LOCKED_REJOIN_MONTH_STATUSES
            ),
        )
        .order_by(
            "teacher_id",
            "id",
        )
    )

    return rows.first()


def _paid_source_restoration_amount(
    *,
    source_payroll,
    student,
):
    rows = (
        QuranSalaryLedgerEntry.objects
        .filter(
            payroll=source_payroll,
            student=student,
            entry_type=(
                QuranSalaryLedgerEntry
                .EntryType
                .DROPPED_CLASS_REVERSAL
            ),
        )
        .values_list(
            "amount",
            flat=True,
        )
    )

    total = Decimal("0.00")

    for value in rows:
        total += money(value)

    return money(
        abs(total)
    )


def _target_payroll_for_restoration(
    *,
    drop_event,
    rejoin_date,
    actor,
):
    source_key = _month_key(
        drop_event.drop_effective_date.year,
        drop_event.drop_effective_date.month,
    )

    target_year = (
        rejoin_date.year
    )
    target_month = (
        rejoin_date.month
    )

    # A paid source month must never receive its own restoration.
    if (
        _month_key(
            target_year,
            target_month,
        )
        <= source_key
    ):
        (
            target_year,
            target_month,
        ) = _next_month(
            *source_key
        )

    # If an already-paid later payroll exists, move forward until the
    # first not-paid month. This keeps all paid payrolls immutable.
    for _attempt in range(24):
        payroll = (
            QuranTeacherMonthlyPayroll.objects
            .select_for_update(of=("self",))
            .filter(
                department=(
                    drop_event.department
                ),
                teacher=(
                    drop_event.teacher
                ),
                year=target_year,
                month=target_month,
            )
            .first()
        )

        if (
            payroll is not None
            and payroll.status
            == QuranTeacherMonthlyPayroll
            .Status
            .PAID
        ):
            (
                target_year,
                target_month,
            ) = _next_month(
                target_year,
                target_month,
            )

            continue

        if payroll is None:
            calculate_teacher_payroll(
                drop_event.teacher,
                target_year,
                target_month,
                actor,
            )

            payroll = (
                QuranTeacherMonthlyPayroll.objects
                .select_for_update(of=("self",))
                .filter(
                    department=(
                        drop_event.department
                    ),
                    teacher=(
                        drop_event.teacher
                    ),
                    year=target_year,
                    month=target_month,
                )
                .first()
            )

        if payroll is None:
            raise StudentRejoinError(
                code=(
                    "restoration_target_payroll_missing"
                ),
                detail=(
                    "A payable target payroll could not "
                    "be created for the rejoin restoration."
                ),
                payload={
                    "target_month": target_month,
                    "target_year": target_year,
                },
            )

        if (
            payroll.status
            == QuranTeacherMonthlyPayroll
            .Status
            .PAID
        ):
            (
                target_year,
                target_month,
            ) = _next_month(
                target_year,
                target_month,
            )

            continue

        return payroll

    raise StudentRejoinError(
        code="restoration_target_not_found",
        detail=(
            "No non-paid payroll month was found for "
            "the rejoin restoration."
        ),
    )


def _existing_restoration_adjustment(
    *,
    drop_event,
    student,
):
    return (
        QuranSalaryAdjustment.objects
        .select_for_update(of=("self",))
        .filter(
            department=drop_event.department,
            teacher=drop_event.teacher,
            adjustment_type=(
                QuranSalaryAdjustment
                .AdjustmentType
                .REJOIN_RESTORATION
            ),
            source_month=(
                drop_event
                .drop_effective_date
                .month
            ),
            source_year=(
                drop_event
                .drop_effective_date
                .year
            ),
            student=student,
        )
        .exclude(
            status__in={
                QuranSalaryAdjustment
                .Status
                .REJECTED,
                QuranSalaryAdjustment
                .Status
                .CANCELLED,
            }
        )
        .order_by(
            "-created_at",
            "-id",
        )
        .first()
    )


def _create_paid_restoration_adjustment(
    *,
    drop_event,
    student,
    rejoin_date,
    actor,
    source_payroll,
):
    amount = (
        _paid_source_restoration_amount(
            source_payroll=source_payroll,
            student=student,
        )
    )

    if amount <= 0:
        return (
            None,
            amount,
        )

    existing = (
        _existing_restoration_adjustment(
            drop_event=drop_event,
            student=student,
        )
    )

    if existing is not None:
        return (
            existing,
            money(
                existing.amount
            ),
        )

    target_payroll = (
        _target_payroll_for_restoration(
            drop_event=drop_event,
            rejoin_date=rejoin_date,
            actor=actor,
        )
    )

    adjustment = (
        QuranSalaryAdjustment(
            department=(
                drop_event.department
            ),
            teacher=(
                drop_event.teacher
            ),
            payroll=target_payroll,
            salary_month=(
                target_payroll.month
            ),
            salary_year=(
                target_payroll.year
            ),
            adjustment_type=(
                QuranSalaryAdjustment
                .AdjustmentType
                .REJOIN_RESTORATION
            ),
            effect=(
                QuranSalaryAdjustment
                .Effect
                .CREDIT
            ),
            amount=amount,
            reason=(
                "Controlled Quran Salary V2 rejoin "
                "restoration for paid historical "
                f"payroll {source_payroll.month}/"
                f"{source_payroll.year}; "
                f"drop event {drop_event.id}."
            ),
            source_month=(
                source_payroll.month
            ),
            source_year=(
                source_payroll.year
            ),
            student=student,
            status=(
                QuranSalaryAdjustment
                .Status
                .PENDING
            ),
            requested_by=actor,
        )
    )

    adjustment.full_clean()
    adjustment.save()

    return (
        adjustment,
        amount,
    )


@transaction.atomic
def rejoin_student_drop(
    *,
    student,
    rejoin_date: date,
    actor,
):
    """
    Controlled Quran Salary V2 rejoin workflow.

    Rules:
      - only an active QuranStudentDropEvent can be rejoined;
      - no StudentProfile.class_status mutation occurs here;
      - rejoin date cannot precede the drop or be in the future;
      - Pending Super Admin / Approved source payrolls block rejoin
        until returned to an editable lifecycle state;
      - editable/unpaid source payroll is recalculated after the
        rejoin is recorded;
      - Paid source payroll is never modified;
      - Paid source restoration becomes a Pending controlled
        REJOIN_RESTORATION adjustment in a non-paid payroll month.
    """

    if not isinstance(
        rejoin_date,
        date,
    ):
        raise StudentRejoinError(
            code="invalid_rejoin_date",
            detail=(
                "rejoin_date must be a date."
            ),
        )

    if rejoin_date > timezone.localdate():
        raise StudentRejoinError(
            code="future_rejoin_date",
            detail=(
                "A rejoin date cannot be in the future."
            ),
            payload={
                "rejoin_date": str(
                    rejoin_date
                ),
            },
        )

    student_model = (
        student.__class__
    )

    student = (
        student_model.objects
        .select_for_update(of=("self",))
        .get(pk=student.pk)
    )

    drop_event = (
        QuranStudentDropEvent.objects
        .select_for_update(of=("self",))
        .select_related(
            "department",
            "teacher__user",
            "student__user",
        )
        .filter(
            student=student,
            status=(
                QuranStudentDropEvent
                .Status
                .DROPPED
            ),
            rejoined_date__isnull=True,
        )
        .order_by(
            "-drop_effective_date",
            "-id",
        )
        .first()
    )

    if drop_event is None:
        latest = (
            QuranStudentDropEvent.objects
            .select_for_update(of=("self",))
            .filter(
                student=student,
            )
            .order_by(
                "-drop_effective_date",
                "-id",
            )
            .first()
        )

        if (
            latest is not None
            and latest.status
            == QuranStudentDropEvent
            .Status
            .REJOINED
            and latest.rejoined_date
            == rejoin_date
        ):
            return {
                "changed": False,
                "reason": "already_rejoined",
                "drop_event_id": latest.id,
                "rejoined_date": str(
                    latest.rejoined_date
                ),
                "restoration_required": bool(
                    latest
                    .previous_month_restoration_required
                ),
            }

        raise StudentRejoinError(
            code="no_active_drop",
            detail=(
                "This student has no active Quran "
                "Salary V2 drop event to rejoin."
            ),
            payload={
                "student_id": (
                    student.id
                ),
            },
        )

    if (
        rejoin_date
        < drop_event.drop_effective_date
    ):
        raise StudentRejoinError(
            code="rejoin_before_drop",
            detail=(
                "The rejoin date cannot be earlier "
                "than the drop effective date."
            ),
            payload={
                "drop_effective_date": str(
                    drop_event
                    .drop_effective_date
                ),
                "rejoin_date": str(
                    rejoin_date
                ),
            },
        )

    if actor is None:
        raise StudentRejoinError(
            code="rejoin_actor_required",
            detail=(
                "A user actor is required for a "
                "controlled rejoin."
            ),
        )

    source_payroll = (
        _source_payroll_for_drop(
            drop_event
        )
    )

    if (
        source_payroll is not None
        and source_payroll.status
        in LOCKED_UNPAID_SOURCE_STATUSES
    ):
        raise _locked_payroll_payload(
            source_payroll,
            code="source_payroll_locked_unpaid",
            detail=(
                "The historical source payroll is "
                "locked but not paid. Return it to "
                "an editable lifecycle state before "
                "rejoining this student."
            ),
        )

    rejoin_month_locked = (
        _rejoin_month_locked_payroll(
            student=student,
            drop_event=drop_event,
            rejoin_date=rejoin_date,
        )
    )

    if (
        rejoin_month_locked is not None
        and (
            source_payroll is None
            or rejoin_month_locked.id
            != source_payroll.id
            or source_payroll.status
            != QuranTeacherMonthlyPayroll
            .Status
            .PAID
        )
    ):
        raise _locked_payroll_payload(
            rejoin_month_locked,
            code="rejoin_month_payroll_locked",
            detail=(
                "The rejoin effective month has a "
                "locked payroll source. Reopen or "
                "return that payroll to an editable "
                "state before recording the rejoin."
            ),
        )

    source_is_paid = (
        source_payroll is not None
        and source_payroll.status
        == QuranTeacherMonthlyPayroll
        .Status
        .PAID
    )

    # If the paid source month is also the requested rejoin month,
    # recording the rejoin would rewrite an already-paid month.
    if (
        source_is_paid
        and _month_key(
            rejoin_date.year,
            rejoin_date.month,
        )
        == _month_key(
            source_payroll.year,
            source_payroll.month,
        )
    ):
        raise _locked_payroll_payload(
            source_payroll,
            code="paid_rejoin_month_locked",
            detail=(
                "The requested rejoin date falls in "
                "an already-paid payroll month. Use "
                "an effective rejoin date in an open "
                "payroll month."
            ),
        )

    drop_event.status = (
        QuranStudentDropEvent
        .Status
        .REJOINED
    )

    drop_event.rejoined_date = (
        rejoin_date
    )

    drop_event.previous_month_restoration_required = (
        source_is_paid
    )

    drop_event.save(
        update_fields=[
            "status",
            "rejoined_date",
            (
                "previous_month_"
                "restoration_required"
            ),
            "updated_at",
        ]
    )

    if source_is_paid:
        (
            adjustment,
            restoration_amount,
        ) = (
            _create_paid_restoration_adjustment(
                drop_event=drop_event,
                student=student,
                rejoin_date=rejoin_date,
                actor=actor,
                source_payroll=source_payroll,
            )
        )

        if adjustment is None:
            drop_event.previous_month_restoration_required = False

            drop_event.save(
                update_fields=[
                    (
                        "previous_month_"
                        "restoration_required"
                    ),
                    "updated_at",
                ]
            )

        return {
            "changed": True,
            "reason": (
                "rejoined_paid_source"
            ),
            "drop_event_id": (
                drop_event.id
            ),
            "rejoined_date": str(
                rejoin_date
            ),
            "source_payroll_id": (
                source_payroll.id
            ),
            "source_month": (
                source_payroll.month
            ),
            "source_year": (
                source_payroll.year
            ),
            "source_payroll_status": (
                source_payroll.status
            ),
            "restoration_required": bool(
                adjustment is not None
            ),
            "restoration_amount": (
                str(
                    money(
                        restoration_amount
                    )
                )
            ),
            "restoration_adjustment_id": (
                adjustment.id
                if adjustment is not None
                else None
            ),
            "target_payroll_id": (
                adjustment.payroll_id
                if adjustment is not None
                else None
            ),
            "target_month": (
                adjustment.salary_month
                if adjustment is not None
                else None
            ),
            "target_year": (
                adjustment.salary_year
                if adjustment is not None
                else None
            ),
            "adjustment_status": (
                adjustment.status
                if adjustment is not None
                else None
            ),
        }

    # Editable/unpaid history is restored through ordinary V2
    # recalculation. The rejoined_date is already visible to the
    # salary engine inside this same atomic transaction.
    recalculated = (
        calculate_teacher_payroll(
            drop_event.teacher,
            drop_event.drop_effective_date.year,
            drop_event.drop_effective_date.month,
            actor,
        )
    )

    return {
        "changed": True,
        "reason": (
            "rejoined_editable_source"
        ),
        "drop_event_id": (
            drop_event.id
        ),
        "rejoined_date": str(
            rejoin_date
        ),
        "source_payroll_id": (
            source_payroll.id
            if source_payroll is not None
            else None
        ),
        "source_month": (
            drop_event
            .drop_effective_date
            .month
        ),
        "source_year": (
            drop_event
            .drop_effective_date
            .year
        ),
        "source_payroll_status": (
            source_payroll.status
            if source_payroll is not None
            else None
        ),
        "restoration_required": False,
        "restoration_adjustment_id": None,
        "historical_recalculated": True,
        "calculation_result_type": (
            type(recalculated).__name__
        ),
    }
