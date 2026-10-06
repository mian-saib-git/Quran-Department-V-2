from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Department

from .models import (
    QuranSalaryAdjustment,
    QuranTeacherMonthlyPayroll,
)
from .salary_v2_service import (
    adjustment_payload,
    calculate_department_payrolls,
    calculate_teacher_payroll,
    ledger_payload,
    payroll_payload,
    payroll_readiness,
)

from datetime import date
from .models import StudentProfile
from .student_rejoin_service import (
    StudentRejoinError,
    rejoin_student_drop,
)


DEPARTMENT_SALARY_ROLES = {
    "department_admin",
}


def _role(user):
    return str(
        getattr(user, "role", "") or ""
    ).strip().lower()


def _is_super_admin(user):
    return bool(
        getattr(
            user,
            "is_superuser",
            False,
        )
        or _role(user) == "platform_admin"
    )


def _assigned_quran_department(user):
    department = getattr(
        user,
        "department",
        None,
    )

    if not department:
        return None

    department_type = str(
        getattr(
            department,
            "department_type",
            "",
        )
        or ""
    ).lower()

    if department_type != "quran":
        return None

    return department


def _request_value(
    request,
    key,
    default=None,
):
    if key in request.data:
        return request.data.get(
            key,
            default,
        )

    return request.query_params.get(
        key,
        default,
    )


def _positive_int(
    value,
    label,
):
    try:
        parsed = int(value)
    except (
        TypeError,
        ValueError,
    ):
        raise ValueError(
            f"{label} must be a valid integer."
        )

    if parsed <= 0:
        raise ValueError(
            f"{label} must be greater than zero."
        )

    return parsed


def _month_year(request):
    today = timezone.localdate()

    try:
        month = int(
            _request_value(
                request,
                "month",
                today.month,
            )
        )

        year = int(
            _request_value(
                request,
                "year",
                today.year,
            )
        )

    except (
        TypeError,
        ValueError,
    ):
        raise ValueError(
            "A valid month and year are required."
        )

    if month < 1 or month > 12:
        raise ValueError(
            "Month must be between 1 and 12."
        )

    if year < 2020 or year > 2200:
        raise ValueError(
            "Year must be between 2020 and 2200."
        )

    return month, year


def _department_from_id(
    department_id,
):
    try:
        department = (
            Department.objects
            .select_related(
                "institution"
            )
            .get(
                id=department_id
            )
        )

    except Department.DoesNotExist:
        return None

    department_type = str(
        getattr(
            department,
            "department_type",
            "",
        )
        or ""
    ).lower()

    if department_type != "quran":
        return None

    return department


def _resolve_department(request):
    # Teacher self-service: resolve only the teacher's assigned department.
    if _role(request.user) == "teacher":
        teacher_department = getattr(request.user, "department", None)
        if teacher_department is None:
            return (
                None,
                Response(
                    {"detail": "Teacher is not assigned to a department."},
                    status=status.HTTP_403_FORBIDDEN,
                ),
            )

        raw_teacher_department_id = request.query_params.get("department_id")
        if raw_teacher_department_id not in (None, ""):
            try:
                requested_teacher_department_id = int(
                    str(raw_teacher_department_id).strip()
                )
            except (TypeError, ValueError):
                return (
                    None,
                    Response(
                        {"detail": "department_id must be a positive integer."},
                        status=status.HTTP_400_BAD_REQUEST,
                    ),
                )

            if requested_teacher_department_id <= 0:
                return (
                    None,
                    Response(
                        {"detail": "department_id must be a positive integer."},
                        status=status.HTTP_400_BAD_REQUEST,
                    ),
                )

            if requested_teacher_department_id != int(teacher_department.id):
                return (
                    None,
                    Response(
                        {"detail": "Teachers may only access their assigned department."},
                        status=status.HTTP_403_FORBIDDEN,
                    ),
                )

        return teacher_department, None

    user = request.user

    assigned = (
        _assigned_quran_department(
            user
        )
    )

    raw_department_id = (
        _request_value(
            request,
            "department_id",
        )
    )

    # --------------------------------------------------------
    # Super Admin
    # --------------------------------------------------------

    if _is_super_admin(user):

        if raw_department_id not in (
            None,
            "",
        ):
            try:
                department_id = (
                    _positive_int(
                        raw_department_id,
                        "department_id",
                    )
                )

            except ValueError as exc:
                return (
                    None,
                    Response(
                        {
                            "detail": str(
                                exc
                            )
                        },
                        status=(
                            status
                            .HTTP_400_BAD_REQUEST
                        ),
                    ),
                )

            department = (
                _department_from_id(
                    department_id
                )
            )

            if not department:
                return (
                    None,
                    Response(
                        {
                            "detail": (
                                "A valid Quran "
                                "department is "
                                "required."
                            )
                        },
                        status=(
                            status
                            .HTTP_404_NOT_FOUND
                        ),
                    ),
                )

            return (
                department,
                None,
            )

        if assigned:
            return (
                assigned,
                None,
            )

        return (
            None,
            Response(
                {
                    "detail": (
                        "department_id is required "
                        "for Super Admin salary "
                        "access when no Quran "
                        "department is assigned."
                    )
                },
                status=(
                    status
                    .HTTP_400_BAD_REQUEST
                ),
            ),
        )

    # --------------------------------------------------------
    # Department Admin
    # --------------------------------------------------------

    if (
        _role(user)
        not in DEPARTMENT_SALARY_ROLES
    ):
        return (
            None,
            Response(
                {
                    "detail": (
                        "Salary V2 management is "
                        "restricted to Department "
                        "Admin and Super Admin."
                    )
                },
                status=(
                    status
                    .HTTP_403_FORBIDDEN
                ),
            ),
        )

    if not assigned:
        return (
            None,
            Response(
                {
                    "detail": (
                        "A Quran department "
                        "assignment is required."
                    )
                },
                status=(
                    status
                    .HTTP_403_FORBIDDEN
                ),
            ),
        )

    if raw_department_id not in (
        None,
        "",
    ):
        try:
            requested_id = (
                _positive_int(
                    raw_department_id,
                    "department_id",
                )
            )

        except ValueError as exc:
            return (
                None,
                Response(
                    {
                        "detail": str(exc)
                    },
                    status=(
                        status
                        .HTTP_400_BAD_REQUEST
                    ),
                ),
            )

        if requested_id != assigned.id:
            return (
                None,
                Response(
                    {
                        "detail": (
                            "Department Admin can "
                            "manage only their "
                            "assigned Quran "
                            "department."
                        )
                    },
                    status=(
                        status
                        .HTTP_403_FORBIDDEN
                    ),
                ),
            )

    return (
        assigned,
        None,
    )


def _positive_money(value):
    try:
        amount = Decimal(
            str(value)
        )
    except (
        InvalidOperation,
        TypeError,
        ValueError,
    ):
        raise ValueError(
            "amount must be a valid number."
        )

    if (
        not amount.is_finite()
        or amount <= 0
    ):
        raise ValueError(
            "amount must be greater than zero."
        )

    return amount


class QuranSalaryV2PayrollView(
    APIView
):
    permission_classes = [
        IsAuthenticated
    ]

    def get(self, request):
        department, error = (
            _resolve_department(
                request
            )
        )

        if error:
            return error

        try:
            month, year = (
                _month_year(
                    request
                )
            )

        except ValueError as exc:
            return Response(
                {
                    "detail": str(exc)
                },
                status=(
                    status
                    .HTTP_400_BAD_REQUEST
                ),
            )

        payrolls = (
            QuranTeacherMonthlyPayroll
            .objects
            .select_related(
                "teacher__user",
                "department",
                "institution",
            )
            .filter(
                department=department,
                month=month,
                year=year,
            )
        )

        # Teachers must only ever receive their own payroll rows.
        # Department Admin and Super Admin retain department-wide visibility.
        if _role(request.user) == "teacher":
            payrolls = payrolls.filter(
                teacher__user=request.user,
            )

        payrolls = (
            payrolls
            .order_by(
                (
                    "teacher__user__"
                    "first_name"
                ),
                (
                    "teacher__user__"
                    "last_name"
                ),
                (
                    "teacher__user__"
                    "username"
                ),
                "teacher_id",
            )
        )

        rows = [
            payroll_payload(
                payroll
            )
            for payroll in payrolls
        ]

        return Response({
            "department": {
                "id": department.id,
                "name": (
                    department.name
                ),
            },
            "month": month,
            "year": year,
            "payrolls": rows,
            "count": len(rows),
        })

    @transaction.atomic
    def post(self, request):
        action = str(
            request.data.get(
                "action",
                "",
            )
            or ""
        ).strip().lower()

        allowed_actions = {
            "calculate",
            "submit",
            "approve",
            "reject",
            "mark_paid",
            "reopen",
            "propose_adjustment",
            "approve_adjustment",
            "reject_adjustment",
                              "rejoin_student",
        }

        if action not in allowed_actions:
            return Response(
                {
                    "detail": (
                        "Supported actions are "
                        "'calculate', 'submit', "
                        "'approve', 'reject', "
                        "'mark_paid', 'reopen', "
                        "'propose_adjustment', "
                        "'approve_adjustment', "
                        "'reject_adjustment', and "
                        "'rejoin_student'."
                    )
                },
                status=(
                    status
                    .HTTP_400_BAD_REQUEST
                ),
            )

        department, error = (
            _resolve_department(
                request
            )
        )

        if error:
            return error

        # ----------------------------------------------------
        # Department Admin -> Pending Super Admin
        # ----------------------------------------------------

        # ----------------------------------------------------
        # Department Admin -> Controlled Student Rejoin
        # ----------------------------------------------------

        if action == "rejoin_student":

            if (
                _is_super_admin(
                    request.user
                )
                or _role(
                    request.user
                )
                != "department_admin"
            ):
                return Response(
                    {
                        "detail": (
                            "Only Department Admin "
                            "can record a controlled "
                            "student rejoin."
                        )
                    },
                    status=(
                        status
                        .HTTP_403_FORBIDDEN
                    ),
                )

            try:
                student_id = _positive_int(
                    request.data.get(
                        "student_id"
                    ),
                    "student_id",
                )

            except ValueError as exc:
                return Response(
                    {
                        "detail": str(exc)
                    },
                    status=(
                        status
                        .HTTP_400_BAD_REQUEST
                    ),
                )

            raw_rejoin_date = str(
                request.data.get(
                    "rejoin_date",
                    "",
                )
                or ""
            ).strip()

            try:
                rejoin_date = (
                    date.fromisoformat(
                        raw_rejoin_date
                    )
                )

            except ValueError:
                return Response(
                    {
                        "detail": (
                            "rejoin_date must use "
                            "YYYY-MM-DD format."
                        )
                    },
                    status=(
                        status
                        .HTTP_400_BAD_REQUEST
                    ),
                )

            student = (
                StudentProfile.objects
                .select_related(
                    "user",
                )
                .filter(
                    id=student_id,
                )
                .first()
            )

            if student is None:
                return Response(
                    {
                        "detail": (
                            "Student was not found "
                            "in this Quran department."
                        )
                    },
                    status=(
                        status
                        .HTTP_404_NOT_FOUND
                    ),
                )

            student_department_id = (
                getattr(
                    student,
                    "department_id",
                    None,
                )
                or getattr(
                    getattr(
                        student,
                        "user",
                        None,
                    ),
                    "department_id",
                    None,
                )
            )

            if (
                student_department_id
                != department.id
            ):
                return Response(
                    {
                        "detail": (
                            "Student was not found "
                            "in this Quran department."
                        )
                    },
                    status=(
                        status
                        .HTTP_404_NOT_FOUND
                    ),
                )

            try:
                result = rejoin_student_drop(
                    student=student,
                    rejoin_date=rejoin_date,
                    actor=request.user,
                )

            except StudentRejoinError as exc:
                transaction.set_rollback(
                    True
                )

                return Response(
                    exc.payload,
                    status=(
                        status
                        .HTTP_409_CONFLICT
                    ),
                )

            return Response(
                {
                    "detail": (
                        "Student rejoin recorded "
                        "successfully."
                    ),
                    "rejoin": result,
                },
                status=(
                    status
                    .HTTP_200_OK
                ),
            )

        # ----------------------------------------------------
        # Department Admin -> Proposed Salary Adjustment
        # ----------------------------------------------------

        if action == "propose_adjustment":

            if (
                _is_super_admin(
                    request.user
                )
                or _role(
                    request.user
                )
                != "department_admin"
            ):
                return Response(
                    {
                        "detail": (
                            "Only Department Admin "
                            "can propose a salary "
                            "adjustment."
                        )
                    },
                    status=(
                        status
                        .HTTP_403_FORBIDDEN
                    ),
                )

            try:
                payroll_id = _positive_int(
                    request.data.get(
                        "payroll_id"
                    ),
                    "payroll_id",
                )

                amount = _positive_money(
                    request.data.get(
                        "amount"
                    )
                )

            except ValueError as exc:
                return Response(
                    {
                        "detail": str(exc)
                    },
                    status=(
                        status
                        .HTTP_400_BAD_REQUEST
                    ),
                )

            payroll = (
                QuranTeacherMonthlyPayroll
                .objects
                .select_for_update(of=("self",))
                .select_related(
                    "teacher__user",
                    "department",
                    "institution",
                )
                .filter(
                    id=payroll_id,
                    department=department,
                )
                .first()
            )

            if not payroll:
                return Response(
                    {
                        "detail": (
                            "Payroll was not found "
                            "in this Quran department."
                        )
                    },
                    status=(
                        status
                        .HTTP_404_NOT_FOUND
                    ),
                )

            proposal_statuses = {
                (
                    QuranTeacherMonthlyPayroll
                    .Status
                    .DEPARTMENT_REVIEW
                ),
                (
                    QuranTeacherMonthlyPayroll
                    .Status
                    .PENDING_SUPER_ADMIN
                ),
                (
                    QuranTeacherMonthlyPayroll
                    .Status
                    .REJECTED
                ),
                (
                    QuranTeacherMonthlyPayroll
                    .Status
                    .REOPENED
                ),
            }

            if (
                payroll.status
                not in proposal_statuses
            ):
                return Response(
                    {
                        "detail": (
                            "An adjustment cannot "
                            "be proposed in the "
                            "current payroll state. "
                            "Approved payroll must "
                            "be reopened first. "
                            "Paid payroll is "
                            "immutable."
                        ),
                        "payroll_id": (
                            payroll.id
                        ),
                        "current_status": (
                            payroll.status
                        ),
                    },
                    status=(
                        status
                        .HTTP_409_CONFLICT
                    ),
                )

            adjustment_type = str(
                request.data.get(
                    "adjustment_type",
                    "",
                )
                or ""
            ).strip().lower()

            allowed_types = {
                (
                    QuranSalaryAdjustment
                    .AdjustmentType
                    .BONUS
                ),
                (
                    QuranSalaryAdjustment
                    .AdjustmentType
                    .FINE
                ),
                (
                    QuranSalaryAdjustment
                    .AdjustmentType
                    .DEDUCTION
                ),
                (
                    QuranSalaryAdjustment
                    .AdjustmentType
                    .CORRECTION
                ),
            }

            if (
                adjustment_type
                not in allowed_types
            ):
                return Response(
                    {
                        "detail": (
                            "adjustment_type must "
                            "be bonus, fine, "
                            "deduction, or "
                            "correction. Rejoin "
                            "restoration uses its "
                            "separate controlled "
                            "workflow."
                        )
                    },
                    status=(
                        status
                        .HTTP_400_BAD_REQUEST
                    ),
                )

            reason = str(
                request.data.get(
                    "reason",
                    "",
                )
                or ""
            ).strip()

            if not reason:
                return Response(
                    {
                        "detail": (
                            "A reason is required "
                            "for every adjustment."
                        )
                    },
                    status=(
                        status
                        .HTTP_400_BAD_REQUEST
                    ),
                )

            if (
                adjustment_type
                == QuranSalaryAdjustment
                .AdjustmentType
                .BONUS
            ):
                effect = (
                    QuranSalaryAdjustment
                    .Effect
                    .CREDIT
                )

            elif adjustment_type in {
                (
                    QuranSalaryAdjustment
                    .AdjustmentType
                    .FINE
                ),
                (
                    QuranSalaryAdjustment
                    .AdjustmentType
                    .DEDUCTION
                ),
            }:
                effect = (
                    QuranSalaryAdjustment
                    .Effect
                    .DEBIT
                )

            else:
                effect = str(
                    request.data.get(
                        "effect",
                        "",
                    )
                    or ""
                ).strip().lower()

                if effect not in {
                    (
                        QuranSalaryAdjustment
                        .Effect
                        .CREDIT
                    ),
                    (
                        QuranSalaryAdjustment
                        .Effect
                        .DEBIT
                    ),
                }:
                    return Response(
                        {
                            "detail": (
                                "A correction must "
                                "specify effect as "
                                "credit or debit."
                            )
                        },
                        status=(
                            status
                            .HTTP_400_BAD_REQUEST
                        ),
                    )

            adjustment = (
                QuranSalaryAdjustment(
                    department=department,
                    teacher=payroll.teacher,
                    payroll=payroll,
                    salary_month=(
                        payroll.month
                    ),
                    salary_year=(
                        payroll.year
                    ),
                    adjustment_type=(
                        adjustment_type
                    ),
                    effect=effect,
                    amount=amount,
                    reason=reason,
                    status=(
                        QuranSalaryAdjustment
                        .Status
                        .PENDING
                    ),
                    requested_by=(
                        request.user
                    ),
                )
            )

            try:
                adjustment.full_clean()

            except ValidationError as exc:
                errors = getattr(
                    exc,
                    "message_dict",
                    None,
                )

                if errors is None:
                    errors = {
                        "__all__": (
                            exc.messages
                        )
                    }

                return Response(
                    {
                        "detail": (
                            "Invalid salary "
                            "adjustment."
                        ),
                        "errors": errors,
                    },
                    status=(
                        status
                        .HTTP_400_BAD_REQUEST
                    ),
                )

            adjustment.save()

            return Response(
                {
                    "detail": (
                        "Salary adjustment "
                        "submitted for Super "
                        "Admin review."
                    ),
                    "adjustment": (
                        adjustment_payload(
                            adjustment
                        )
                    ),
                    "payroll": (
                        payroll_payload(
                            payroll
                        )
                    ),
                },
                status=(
                    status
                    .HTTP_201_CREATED
                ),
            )

        # ----------------------------------------------------
        # Super Admin -> Adjustment Review
        # ----------------------------------------------------

        if action in {
            "approve_adjustment",
            "reject_adjustment",
        }:

            if not _is_super_admin(
                request.user
            ):
                return Response(
                    {
                        "detail": (
                            "Only Super Admin can "
                            "approve or reject "
                            "salary adjustments."
                        )
                    },
                    status=(
                        status
                        .HTTP_403_FORBIDDEN
                    ),
                )

            try:
                adjustment_id = _positive_int(
                    request.data.get(
                        "adjustment_id"
                    ),
                    "adjustment_id",
                )

            except ValueError as exc:
                return Response(
                    {
                        "detail": str(exc)
                    },
                    status=(
                        status
                        .HTTP_400_BAD_REQUEST
                    ),
                )

            adjustment = (
                QuranSalaryAdjustment
                .objects
                .select_for_update(of=("self",))
                .select_related(
                    "teacher__user",
                    "payroll",
                    "department",
                )
                .filter(
                    id=adjustment_id,
                    department=department,
                )
                .first()
            )

            if not adjustment:
                return Response(
                    {
                        "detail": (
                            "Salary adjustment "
                            "was not found in this "
                            "Quran department."
                        )
                    },
                    status=(
                        status
                        .HTTP_404_NOT_FOUND
                    ),
                )

            if (
                adjustment.status
                != QuranSalaryAdjustment
                .Status
                .PENDING
            ):
                return Response(
                    {
                        "detail": (
                            "Only a Pending salary "
                            "adjustment can be "
                            "reviewed."
                        ),
                        "adjustment_id": (
                            adjustment.id
                        ),
                        "current_status": (
                            adjustment.status
                        ),
                    },
                    status=(
                        status
                        .HTTP_409_CONFLICT
                    ),
                )

            payroll = (
                QuranTeacherMonthlyPayroll
                .objects
                .select_for_update(of=("self",))
                .select_related(
                    "teacher__user",
                    "department",
                    "institution",
                )
                .filter(
                    department=department,
                    teacher=(
                        adjustment.teacher
                    ),
                    year=(
                        adjustment.salary_year
                    ),
                    month=(
                        adjustment.salary_month
                    ),
                )
                .first()
            )

            if not payroll:
                return Response(
                    {
                        "detail": (
                            "The adjustment has no "
                            "matching V2 payroll."
                        )
                    },
                    status=(
                        status
                        .HTTP_409_CONFLICT
                    ),
                )

            review_note = str(
                request.data.get(
                    "review_note",
                    request.data.get(
                        "reason",
                        "",
                    ),
                )
                or ""
            ).strip()

            now = timezone.now()

            if (
                action
                == "reject_adjustment"
            ):
                if not review_note:
                    return Response(
                        {
                            "detail": (
                                "A rejection note "
                                "is required."
                            )
                        },
                        status=(
                            status
                            .HTTP_400_BAD_REQUEST
                        ),
                    )

                adjustment.status = (
                    QuranSalaryAdjustment
                    .Status
                    .REJECTED
                )

                adjustment.reviewed_by = (
                    request.user
                )
                adjustment.reviewed_at = now
                adjustment.review_note = (
                    review_note
                )

                adjustment.save(
                    update_fields=[
                        "status",
                        "reviewed_by",
                        "reviewed_at",
                        "review_note",
                        "updated_at",
                    ]
                )

                return Response(
                    {
                        "detail": (
                            "Salary adjustment "
                            "rejected."
                        ),
                        "adjustment": (
                            adjustment_payload(
                                adjustment
                            )
                        ),
                        "payroll": (
                            payroll_payload(
                                payroll
                            )
                        ),
                    },
                    status=(
                        status
                        .HTTP_200_OK
                    ),
                )

            if (
                payroll.status
                == QuranTeacherMonthlyPayroll
                .Status
                .PAID
            ):
                return Response(
                    {
                        "detail": (
                            "Paid payroll is "
                            "historically immutable. "
                            "This adjustment cannot "
                            "be approved against "
                            "the paid month."
                        )
                    },
                    status=(
                        status
                        .HTTP_409_CONFLICT
                    ),
                )

            if (
                payroll.status
                == QuranTeacherMonthlyPayroll
                .Status
                .APPROVED
            ):
                return Response(
                    {
                        "detail": (
                            "Approved payroll must "
                            "be explicitly reopened "
                            "before a monetary "
                            "adjustment can be "
                            "approved."
                        )
                    },
                    status=(
                        status
                        .HTTP_409_CONFLICT
                    ),
                )

            approvable_statuses = {
                (
                    QuranTeacherMonthlyPayroll
                    .Status
                    .DEPARTMENT_REVIEW
                ),
                (
                    QuranTeacherMonthlyPayroll
                    .Status
                    .PENDING_SUPER_ADMIN
                ),
                (
                    QuranTeacherMonthlyPayroll
                    .Status
                    .REJECTED
                ),
                (
                    QuranTeacherMonthlyPayroll
                    .Status
                    .REOPENED
                ),
            }

            if (
                payroll.status
                not in approvable_statuses
            ):
                return Response(
                    {
                        "detail": (
                            "The payroll is not in "
                            "a state where this "
                            "adjustment can be "
                            "approved."
                        ),
                        "current_status": (
                            payroll.status
                        ),
                    },
                    status=(
                        status
                        .HTTP_409_CONFLICT
                    ),
                )

            adjustment.status = (
                QuranSalaryAdjustment
                .Status
                .APPROVED
            )

            adjustment.reviewed_by = (
                request.user
            )
            adjustment.reviewed_at = now
            adjustment.review_note = (
                review_note
            )

            adjustment.save(
                update_fields=[
                    "status",
                    "reviewed_by",
                    "reviewed_at",
                    "review_note",
                    "updated_at",
                ]
            )

            # Approved monetary source requires fresh payroll.
            payroll.status = (
                QuranTeacherMonthlyPayroll
                .Status
                .DEPARTMENT_REVIEW
            )
            payroll.submitted_by = None
            payroll.submitted_at = None

            payroll.save(
                update_fields=[
                    "status",
                    "submitted_by",
                    "submitted_at",
                    "updated_at",
                ]
            )

            calculate_teacher_payroll(
                payroll.teacher,
                payroll.year,
                payroll.month,
                request.user,
            )

            payroll.refresh_from_db()

            return Response(
                {
                    "detail": (
                        "Salary adjustment "
                        "approved. The affected "
                        "payroll was recalculated "
                        "and returned to Department "
                        "Review. Department Admin "
                        "must resubmit it."
                    ),
                    "adjustment": (
                        adjustment_payload(
                            adjustment
                        )
                    ),
                    "payroll": (
                        payroll_payload(
                            payroll
                        )
                    ),
                },
                status=(
                    status
                    .HTTP_200_OK
                ),
            )

        if action == "submit":

            if (
                _is_super_admin(request.user)
                or _role(request.user)
                != "department_admin"
            ):
                return Response(
                    {
                        "detail": (
                            "Only Department Admin "
                            "can submit payroll for "
                            "Super Admin review."
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

            try:
                payroll_id = _positive_int(
                    request.data.get(
                        "payroll_id"
                    ),
                    "payroll_id",
                )

            except ValueError as exc:
                return Response(
                    {
                        "detail": str(exc)
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            payroll = (
                QuranTeacherMonthlyPayroll
                .objects
                .select_for_update(of=("self",))
                .select_related(
                    "teacher__user",
                    "department",
                    "institution",
                )
                .filter(
                    id=payroll_id,
                    department=department,
                )
                .first()
            )

            if not payroll:
                return Response(
                    {
                        "detail": (
                            "Payroll was not found "
                            "in this Quran department."
                        )
                    },
                    status=status.HTTP_404_NOT_FOUND,
                )

            submission_status = payroll.status
            submittable_statuses = {
                QuranTeacherMonthlyPayroll.Status.DEPARTMENT_REVIEW,
                QuranTeacherMonthlyPayroll.Status.REOPENED,
                QuranTeacherMonthlyPayroll.Status.REJECTED,
            }

            if submission_status not in submittable_statuses:
                return Response(
                    {
                        "detail": (
                            "Only an editable salary review or a salary "
                            "returned for correction can be sent to "
                            "Super Admin."
                        ),
                        "payroll_id": payroll.id,
                        "current_status": payroll.status,
                        "allowed_statuses": sorted(submittable_statuses),
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            # Fresh calculation immediately before submission.
            #
            # The target payroll row is already locked with
            # select_for_update(). Attendance, coverage, and
            # schedule/transfer mutations also acquire affected
            # payroll row locks before changing salary source data.
            #
            # Therefore source data cannot change underneath this
            # calculation before the payroll becomes Pending Super Admin.
            calculate_teacher_payroll(
                payroll.teacher,
                payroll.year,
                payroll.month,
                request.user,
            )

            payroll.refresh_from_db()

            # Defensive invariant: recalculation must never move
            # the lifecycle state on its own.
            if payroll.status != submission_status:
                return Response(
                    {
                        "detail": (
                            "Payroll lifecycle changed "
                            "during recalculation. "
                            "Submission was cancelled."
                        ),
                        "payroll_id": payroll.id,
                        "current_status": (
                            payroll.status
                        ),
                        "required_status": (
                            submission_status
                        ),
                    },
                    status=(
                        status
                        .HTTP_409_CONFLICT
                    ),
                )

            readiness = payroll_readiness(
                payroll
            )

            if not readiness.get(
                "department_submission_ready",
                False,
            ):
                return Response(
                    {
                        "detail": (
                            "Payroll cannot be "
                            "submitted until all "
                            "attendance and coverage "
                            "blockers are resolved."
                        ),
                        "payroll_id": payroll.id,
                        "readiness": readiness,
                        "blockers": readiness.get(
                            "operational_blockers",
                            [],
                        ),
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            department_note = str(
                request.data.get(
                    "department_note",
                    payroll.department_note
                    or "",
                )
                or ""
            ).strip()

            now = timezone.now()

            payroll.status = (
                QuranTeacherMonthlyPayroll
                .Status
                .PENDING_SUPER_ADMIN
            )

            payroll.department_note = (
                department_note
            )

            payroll.submitted_by = (
                request.user
            )

            payroll.submitted_at = now

            payroll.save(
                update_fields=[
                    "status",
                    "department_note",
                    "submitted_by",
                    "submitted_at",
                    "updated_at",
                ]
            )

            return Response(
                {
                    "detail": (
                        (
                            "Corrected salary sent back for Super Admin review."
                            if submission_status
                            in {
                                QuranTeacherMonthlyPayroll.Status.REOPENED,
                                QuranTeacherMonthlyPayroll.Status.REJECTED,
                            }
                            else "Payroll submitted for Super Admin review."
                        )
                    ),
                    "payroll": payroll_payload(
                        payroll
                    ),
                },
                status=status.HTTP_200_OK,
            )

        # ----------------------------------------------------
        # Super Admin -> Approved / Rejected
        # ----------------------------------------------------

        if action in {
            "approve",
            "reject",
        }:

            if not _is_super_admin(
                request.user
            ):
                return Response(
                    {
                        "detail": (
                            "Only Super Admin can "
                            "approve or reject payroll."
                        )
                    },
                    status=(
                        status
                        .HTTP_403_FORBIDDEN
                    ),
                )

            try:
                payroll_id = (
                    _positive_int(
                        request.data.get(
                            "payroll_id"
                        ),
                        "payroll_id",
                    )
                )

            except ValueError as exc:
                return Response(
                    {
                        "detail": str(exc)
                    },
                    status=(
                        status
                        .HTTP_400_BAD_REQUEST
                    ),
                )

            payroll = (
                QuranTeacherMonthlyPayroll
                .objects
                .select_for_update(of=("self",))
                .select_related(
                    "teacher__user",
                    "department",
                    "institution",
                )
                .filter(
                    id=payroll_id,
                    department=department,
                )
                .first()
            )

            if not payroll:
                return Response(
                    {
                        "detail": (
                            "Payroll was not found "
                            "in this Quran department."
                        )
                    },
                    status=(
                        status
                        .HTTP_404_NOT_FOUND
                    ),
                )

            approvable_statuses = {
                QuranTeacherMonthlyPayroll.Status.DEPARTMENT_REVIEW,
                QuranTeacherMonthlyPayroll.Status.PENDING_SUPER_ADMIN,
            }

            if payroll.status not in approvable_statuses:
                return Response(
                    {
                        "detail": (
                            "Only payroll pending "
                            "Super Admin review can "
                            "be approved or rejected."
                        ),
                        "payroll_id": payroll.id,
                        "current_status": (
                            payroll.status
                        ),
                        "required_status": (
                            required_status
                        ),
                    },
                    status=(
                        status
                        .HTTP_409_CONFLICT
                    ),
                )

            raw_note = request.data.get(
                "super_admin_note",
                request.data.get(
                    "reason",
                    payroll.super_admin_note
                    or "",
                ),
            )

            super_admin_note = str(
                raw_note or ""
            ).strip()

            now = timezone.now()

            # ------------------------------------------------
            # APPROVE
            # ------------------------------------------------

            if action == "approve":

                readiness = (
                    payroll_readiness(
                        payroll
                    )
                )

                if not readiness.get(
                    "super_admin_approval_ready",
                    False,
                ):
                    return Response(
                        {
                            "detail": (
                                "Payroll cannot be "
                                "approved until all "
                                "approval blockers "
                                "are resolved."
                            ),
                            "payroll_id": (
                                payroll.id
                            ),
                            "readiness": (
                                readiness
                            ),
                            "blockers": (
                                readiness.get(
                                    "approval_blockers",
                                    [],
                                )
                            ),
                        },
                        status=(
                            status
                            .HTTP_409_CONFLICT
                        ),
                    )

                payroll.status = (
                    QuranTeacherMonthlyPayroll
                    .Status
                    .APPROVED
                )

                payroll.super_admin_note = (
                    super_admin_note
                )

                payroll.approved_by = (
                    request.user
                )

                payroll.approved_at = now

                payroll.rejected_by = None
                payroll.rejected_at = None

                payroll.save(
                    update_fields=[
                        "status",
                        "super_admin_note",
                        "approved_by",
                        "approved_at",
                        "rejected_by",
                        "rejected_at",
                        "updated_at",
                    ]
                )

                return Response(
                    {
                        "detail": (
                            "Payroll approved."
                        ),
                        "payroll": (
                            payroll_payload(
                                payroll
                            )
                        ),
                    },
                    status=(
                        status
                        .HTTP_200_OK
                    ),
                )

            # ------------------------------------------------
            # REJECT
            # ------------------------------------------------

            if not super_admin_note:
                return Response(
                    {
                        "detail": (
                            "A rejection reason is "
                            "required."
                        )
                    },
                    status=(
                        status
                        .HTTP_400_BAD_REQUEST
                    ),
                )

            payroll.status = (
                QuranTeacherMonthlyPayroll
                .Status
                .REJECTED
            )

            payroll.super_admin_note = (
                super_admin_note
            )

            payroll.rejected_by = (
                request.user
            )

            payroll.rejected_at = now

            payroll.approved_by = None
            payroll.approved_at = None

            payroll.save(
                update_fields=[
                    "status",
                    "super_admin_note",
                    "rejected_by",
                    "rejected_at",
                    "approved_by",
                    "approved_at",
                    "updated_at",
                ]
            )

            return Response(
                {
                    "detail": (
                        "Payroll rejected and "
                        "returned for correction."
                    ),
                    "payroll": (
                        payroll_payload(
                            payroll
                        )
                    ),
                },
                status=(
                    status
                    .HTTP_200_OK
                ),
            )

        # ----------------------------------------------------
        # Super Admin -> Paid / Reopened
        # ----------------------------------------------------

        if action in {
            "mark_paid",
            "reopen",
        }:

            if not _is_super_admin(
                request.user
            ):
                return Response(
                    {
                        "detail": (
                            "Only Super Admin can "
                            "mark payroll as paid "
                            "or reopen payroll."
                        )
                    },
                    status=(
                        status
                        .HTTP_403_FORBIDDEN
                    ),
                )

            try:
                payroll_id = (
                    _positive_int(
                        request.data.get(
                            "payroll_id"
                        ),
                        "payroll_id",
                    )
                )

            except ValueError as exc:
                return Response(
                    {
                        "detail": str(exc)
                    },
                    status=(
                        status
                        .HTTP_400_BAD_REQUEST
                    ),
                )

            payroll = (
                QuranTeacherMonthlyPayroll
                .objects
                .select_for_update(of=("self",))
                .select_related(
                    "teacher__user",
                    "department",
                    "institution",
                )
                .filter(
                    id=payroll_id,
                    department=department,
                )
                .first()
            )

            if not payroll:
                return Response(
                    {
                        "detail": (
                            "Payroll was not found "
                            "in this Quran department."
                        )
                    },
                    status=(
                        status
                        .HTTP_404_NOT_FOUND
                    ),
                )

            # ------------------------------------------------
            # MARK PAID
            # ------------------------------------------------

            if action == "mark_paid":

                required_status = (
                    QuranTeacherMonthlyPayroll
                    .Status
                    .APPROVED
                )

                if payroll.status != required_status:
                    return Response(
                        {
                            "detail": (
                                "Only an Approved "
                                "payroll can be marked "
                                "as Paid."
                            ),
                            "payroll_id": (
                                payroll.id
                            ),
                            "current_status": (
                                payroll.status
                            ),
                            "required_status": (
                                required_status
                            ),
                        },
                        status=(
                            status
                            .HTTP_409_CONFLICT
                        ),
                    )

                readiness = (
                    payroll_readiness(
                        payroll
                    )
                )

                if not readiness.get(
                    "super_admin_approval_ready",
                    False,
                ):
                    return Response(
                        {
                            "detail": (
                                "Payroll cannot be "
                                "marked Paid because "
                                "new approval blockers "
                                "exist."
                            ),
                            "payroll_id": (
                                payroll.id
                            ),
                            "readiness": (
                                readiness
                            ),
                            "blockers": (
                                readiness.get(
                                    "approval_blockers",
                                    [],
                                )
                            ),
                        },
                        status=(
                            status
                            .HTTP_409_CONFLICT
                        ),
                    )

                now = timezone.now()

                payroll.status = (
                    QuranTeacherMonthlyPayroll
                    .Status
                    .PAID
                )

                payroll.paid_by = (
                    request.user
                )

                payroll.paid_at = now

                payroll.save(
                    update_fields=[
                        "status",
                        "paid_by",
                        "paid_at",
                        "updated_at",
                    ]
                )

                return Response(
                    {
                        "detail": (
                            "Payroll marked as Paid. "
                            "This payroll is now "
                            "historically immutable."
                        ),
                        "payroll": (
                            payroll_payload(
                                payroll
                            )
                        ),
                    },
                    status=(
                        status
                        .HTTP_200_OK
                    ),
                )

            # ------------------------------------------------
            # REOPEN
            # ------------------------------------------------

            if (
                payroll.status
                == QuranTeacherMonthlyPayroll
                .Status
                .PAID
            ):
                return Response(
                    {
                        "detail": (
                            "Paid payroll cannot be "
                            "reopened or mutated. "
                            "Any later correction must "
                            "be handled through a "
                            "future restoration or "
                            "adjustment."
                        ),
                        "payroll_id": (
                            payroll.id
                        ),
                        "current_status": (
                            payroll.status
                        ),
                    },
                    status=(
                        status
                        .HTTP_409_CONFLICT
                    ),
                )

            required_status = (
                QuranTeacherMonthlyPayroll
                .Status
                .APPROVED
            )

            if payroll.status != required_status:
                return Response(
                    {
                        "detail": (
                            "Only an Approved unpaid "
                            "payroll can be reopened."
                        ),
                        "payroll_id": (
                            payroll.id
                        ),
                        "current_status": (
                            payroll.status
                        ),
                        "required_status": (
                            required_status
                        ),
                    },
                    status=(
                        status
                        .HTTP_409_CONFLICT
                    ),
                )

            reopen_reason = str(
                request.data.get(
                    "reopen_reason",
                    request.data.get(
                        "reason",
                        "",
                    ),
                )
                or ""
            ).strip()

            if not reopen_reason:
                return Response(
                    {
                        "detail": (
                            "A reopen reason is "
                            "required."
                        )
                    },
                    status=(
                        status
                        .HTTP_400_BAD_REQUEST
                    ),
                )

            now = timezone.now()

            payroll.status = (
                QuranTeacherMonthlyPayroll
                .Status
                .REOPENED
            )

            payroll.reopen_reason = (
                reopen_reason
            )

            payroll.reopened_by = (
                request.user
            )

            payroll.reopened_at = now

            payroll.save(
                update_fields=[
                    "status",
                    "reopen_reason",
                    "reopened_by",
                    "reopened_at",
                    "updated_at",
                ]
            )

            return Response(
                {
                    "detail": (
                        "Payroll reopened for "
                        "recalculation and review."
                    ),
                    "payroll": (
                        payroll_payload(
                            payroll
                        )
                    ),
                },
                status=(
                    status
                    .HTTP_200_OK
                ),
            )

        try:
            month, year = (
                _month_year(
                    request
                )
            )

        except ValueError as exc:
            return Response(
                {
                    "detail": str(exc)
                },
                status=(
                    status
                    .HTTP_400_BAD_REQUEST
                ),
            )

        payrolls = (
            calculate_department_payrolls(
                department,
                year,
                month,
                request.user,
            )
        )

        # A completed calculation moves an editable
        # payroll into Department Review.
        editable_statuses = {
            (
                QuranTeacherMonthlyPayroll
                .Status
                .CALCULATING
            ),
            (
                QuranTeacherMonthlyPayroll
                .Status
                .REJECTED
            ),
            (
                QuranTeacherMonthlyPayroll
                .Status
                .REOPENED
            ),
        }

        rows = []

        for payroll in payrolls:

            if (
                payroll.status
                in editable_statuses
            ):
                payroll.status = (
                    QuranTeacherMonthlyPayroll
                    .Status
                    .DEPARTMENT_REVIEW
                )

                payroll.save(
                    update_fields=[
                        "status",
                        "updated_at",
                    ]
                )

            rows.append(
                payroll_payload(
                    payroll
                )
            )

        return Response({
            "department": {
                "id": department.id,
                "name": (
                    department.name
                ),
            },
            "month": month,
            "year": year,
            "payrolls": rows,
            "count": len(rows),
        })


class QuranSalaryV2ProofView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        department, error = _resolve_department(request)

        if error:
            return error

        try:
            payroll_id = _positive_int(
                request.query_params.get("payroll_id"),
                "payroll_id",
            )

        except ValueError as exc:
            return Response(
                {
                    "detail": str(exc),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        payrolls = (
            QuranTeacherMonthlyPayroll
            .objects
            .select_related(
                "teacher__user",
                "department",
                "institution",
            )
            .filter(
                id=payroll_id,
                department=department,
            )
        )

        # Teacher self-service proof is private server-side.
        if _role(request.user) == "teacher":
            payrolls = payrolls.filter(
                teacher__user=request.user,
            )

        payroll = payrolls.first()

        if not payroll:
            return Response(
                {
                    "detail": (
                        "Salary V2 payroll proof was not found "
                        "in this Quran department."
                    ),
                },
                status=status.HTTP_404_NOT_FOUND,
            )

        ledger = ledger_payload(payroll)

        return Response(
            {
                "department": {
                    "id": department.id,
                    "name": department.name,
                },
                "payroll": payroll_payload(payroll),
                "ledger": ledger,
                "ledger_count": len(ledger),
            },
            status=status.HTTP_200_OK,
        )
