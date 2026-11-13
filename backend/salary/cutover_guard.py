"""
Unified Salary Management — Stage 9A: Centralized Salary Engine Ownership Guard

Enforces the non-negotiable cross-engine ownership rule:
Before Unified Salary is enabled for any department and payroll month,
both the new system and legacy systems (V1 and V2) must enforce the same
department-and-period ownership boundaries.

Ownership Semantics:
- Keyed authoritatively by: (department, period_year, period_month)
- Linked to institution via department.institution_id
- Inactive (default): Legacy Salary V1/V2 is authoritative.
  Unified engine cannot approve or record payments. Legacy writes operate normally.
- Active (Unified Cutover): Unified Salary is authoritative.
  Legacy V1/V2 write paths (generation, recalculation, approval, disbursement, reopening)
  are strictly prohibited and reject mutations with HTTP 409 Conflict.
  Historical legacy payroll reads, PDFs, and audit records remain accessible.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, Optional, Tuple, Union

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

logger = logging.getLogger(__name__)


class SalaryEngine:
    """Salary engine identifiers."""
    LEGACY = "legacy"      # Salary V1 (slips) and Salary V2 (Quran monthly payroll)
    UNIFIED = "unified"    # Unified Salary Management (Stage 1-8A)


class CutoverScopingError(Exception):
    """Raised when department or institution context is invalid or mismatched."""
    pass


class LegacySalaryMutationDeniedError(Exception):
    """
    Raised when a legacy Salary V1 or V2 write operation is attempted
    against a department and period whose authoritative ownership has been
    transferred to Unified Salary Management.
    """

    def __init__(
        self,
        department_id: int,
        department_name: str,
        year: int,
        month: int,
        operation: str = "mutation",
        detail: Optional[str] = None,
    ):
        self.department_id = department_id
        self.department_name = department_name
        self.year = year
        self.month = month
        self.operation = operation
        self.detail = detail or (
            f"Department #{department_id} ('{department_name}') for period {year}-{month:02d} "
            f"has been migrated to Unified Salary Management. Legacy V1/V2 write operation "
            f"'{operation}' is denied. Historical payroll records remain strictly read-only."
        )
        super().__init__(self.detail)

    def to_payload(self) -> Dict[str, Any]:
        return {
            "error": "LEGACY_SALARY_MUTATION_DENIED",
            "detail": self.detail,
            "department_id": self.department_id,
            "department_name": self.department_name,
            "year": self.year,
            "month": self.month,
            "operation": self.operation,
            "authoritative_engine": SalaryEngine.UNIFIED,
        }


class UnifiedSalaryMutationDeniedError(Exception):
    """
    Raised when Unified Salary final approval or payment recording is attempted
    on a period that is not active in the cutover registry, or when conflicting
    historical legacy payroll exists.
    """

    def __init__(
        self,
        department_id: int,
        department_name: str,
        year: int,
        month: int,
        reason: str,
        conflict_type: str = "INACTIVE_ENGINE",
    ):
        self.department_id = department_id
        self.department_name = department_name
        self.year = year
        self.month = month
        self.reason = reason
        self.conflict_type = conflict_type
        super().__init__(reason)

    def to_payload(self) -> Dict[str, Any]:
        return {
            "error": "UNIFIED_SALARY_MUTATION_DENIED",
            "conflict_type": self.conflict_type,
            "detail": self.reason,
            "department_id": self.department_id,
            "department_name": self.department_name,
            "year": self.year,
            "month": self.month,
            "authoritative_engine": SalaryEngine.LEGACY,
        }


def _validate_period_bounds(year: int, month: int) -> None:
    if not isinstance(month, int) or month < 1 or month > 12:
        raise ValueError(f"Month must be an integer between 1 and 12, received: {month}")
    if not isinstance(year, int) or year < 2020 or year > 2200:
        raise ValueError(f"Year must be an integer between 2020 and 2200, received: {year}")


def _resolve_department_and_institution(
    department: Any,
    institution: Optional[Any] = None,
) -> Tuple[Any, Optional[int]]:
    """Defensively resolves department model and verifies institution alignment."""
    if department is None:
        raise CutoverScopingError("Department cannot be None for cutover ownership evaluation.")

    dept_id = getattr(department, "id", department)
    dept_inst_id = getattr(department, "institution_id", None)

    if institution is not None:
        inst_id = getattr(institution, "id", institution)
        if dept_inst_id is not None and int(dept_inst_id) != int(inst_id):
            raise CutoverScopingError(
                f"Cross-institution cutover mismatch: Department #{dept_id} belongs to "
                f"Institution #{dept_inst_id}, but caller requested Institution #{inst_id}."
            )

    return department, dept_inst_id


def is_unified_salary_active(
    department: Any,
    year: int,
    month: int,
    institution: Optional[Any] = None,
) -> bool:
    """
    Check whether the Unified Salary engine is authoritative for this department and period.
    Returns True if an active cutover registry record exists; False otherwise.
    """
    from salary.models import SalaryEngineCutoverRegistry

    _validate_period_bounds(year, month)
    dept, _ = _resolve_department_and_institution(department, institution)

    dept_id = getattr(dept, "id", dept)
    return SalaryEngineCutoverRegistry.objects.filter(
        department_id=dept_id,
        period_year=year,
        period_month=month,
        is_unified_engine_active=True,
    ).exists()


def get_salary_engine_for_period(
    department: Any,
    year: int,
    month: int,
    institution: Optional[Any] = None,
) -> str:
    """Return the authoritative salary engine identifier: 'unified' or 'legacy'."""
    return (
        SalaryEngine.UNIFIED
        if is_unified_salary_active(department, year, month, institution)
        else SalaryEngine.LEGACY
    )


def assert_legacy_salary_write_permitted(
    department: Any,
    year: int,
    month: int,
    operation: str = "operation",
    institution: Optional[Any] = None,
) -> None:
    """
    Reverse guard for Legacy V1/V2 write paths.
    If Unified Salary IS active for this scope, legacy mutations are denied.
    If Unified Salary is NOT active, passes silently (inert for legacy-owned periods).
    """
    dept, _ = _resolve_department_and_institution(department, institution)
    dept_id = getattr(dept, "id", dept)
    dept_name = getattr(dept, "name", f"Department #{dept_id}")

    if is_unified_salary_active(dept, year, month, institution):
        logger.warning(
            "Legacy salary mutation blocked: Dept #%s (%s), Period %s-%02d, Op: %s",
            dept_id, dept_name, year, month, operation,
        )
        raise LegacySalaryMutationDeniedError(
            department_id=dept_id,
            department_name=dept_name,
            year=year,
            month=month,
            operation=operation,
        )


def check_legacy_write_guard(
    department: Any,
    year: int,
    month: int,
    operation: str = "operation",
    institution: Optional[Any] = None,
) -> Optional[Response]:
    """
    DRF-compatible view guard for legacy write endpoints.
    Returns None if the legacy write is permitted.
    Returns HTTP 409 Conflict Response if Unified Salary is active.
    """
    try:
        assert_legacy_salary_write_permitted(
            department=department,
            year=year,
            month=month,
            operation=operation,
            institution=institution,
        )
        return None
    except LegacySalaryMutationDeniedError as exc:
        return Response(exc.to_payload(), status=status.HTTP_409_CONFLICT)
    except CutoverScopingError as exc:
        return Response(
            {"error": "SCOPING_ERROR", "detail": str(exc)},
            status=status.HTTP_400_BAD_REQUEST,
        )


def assert_bulk_legacy_write_permitted(
    scopes: Iterable[Tuple[Any, int, int]],
    operation: str = "bulk operation",
) -> None:
    """
    Atomically validate all affected (department, year, month) scopes for a bulk operation.
    If ANY scope is Unified-owned, atomically reject the entire operation before any mutation.
    """
    for item in scopes:
        dept, year, month = item[0], item[1], item[2]
        assert_legacy_salary_write_permitted(dept, year, month, operation=operation)


def assert_unified_salary_write_permitted(
    department: Any,
    year: int,
    month: int,
    operation: str = "approval",
    institution: Optional[Any] = None,
) -> None:
    """
    Guard for Unified Salary final approval and payment recording.
    1. Unified engine must be active in SalaryEngineCutoverRegistry.
    2. Legacy Salary V1/V2 must not have processed, approved, or paid records for this period.
    """
    from academy.models import TeacherSalarySlip, QuranTeacherMonthlyPayroll

    dept, _ = _resolve_department_and_institution(department, institution)
    dept_id = getattr(dept, "id", dept)
    dept_name = getattr(dept, "name", f"Department #{dept_id}")

    # 1. Activation guard
    if not is_unified_salary_active(dept, year, month, institution):
        raise UnifiedSalaryMutationDeniedError(
            department_id=dept_id,
            department_name=dept_name,
            year=year,
            month=month,
            reason=(
                f"Unified Salary engine is NOT authorized for live {operation} for {dept_name} "
                f"({year}-{month:02d}). Legacy Salary V1/V2 remains authoritative until official Stage 9 cutover."
            ),
            conflict_type="INACTIVE_ENGINE",
        )

    # 2. Legacy double-payment conflict check
    v1_processed = TeacherSalarySlip.objects.filter(
        teacher__department_id=dept_id,
        month=month,
        year=year,
        status__in=["processed", "paid"],
    ).exists()

    v2_finalized = QuranTeacherMonthlyPayroll.objects.filter(
        department_id=dept_id,
        month=month,
        year=year,
        status__in=["approved", "paid"],
    ).exists()

    if v1_processed or v2_finalized:
        legacy_engine = "Salary V1 and V2" if (v1_processed and v2_finalized) else ("Salary V1" if v1_processed else "Salary V2")
        raise UnifiedSalaryMutationDeniedError(
            department_id=dept_id,
            department_name=dept_name,
            year=year,
            month=month,
            reason=(
                f"Legacy {legacy_engine} has already processed, approved or paid payroll for {dept_name} "
                f"for {year}-{month:02d}. Unified Salary {operation} is blocked to prevent duplicate payment."
            ),
            conflict_type="LEGACY_RECORDS_EXIST",
        )


def activate_unified_engine_for_period(
    department: Any,
    year: int,
    month: int,
    user: Optional[Any] = None,
    notes: str = "",
) -> Any:
    """
    Controlled activation for testing or authorized Stage 9 cutover.
    Enforces authorization check and conflict checks before activating.
    """
    from salary.models import SalaryEngineCutoverRegistry
    from accounts.models import User

    _validate_period_bounds(year, month)
    dept, _ = _resolve_department_and_institution(department)

    # Scoping / user role check
    if user is not None:
        role = str(getattr(user, "role", "") or "").lower()
        is_super = getattr(user, "is_superuser", False) or role in {"platform_admin", "superadmin", "super_admin"}
        if not is_super:
            raise ValidationError(
                "Unauthorized: Only Super Admin can authorize Unified Salary engine cutover activation."
            )

    # Check for existing duplicate active record to prevent duplicate activations
    existing = SalaryEngineCutoverRegistry.objects.filter(
        department=dept,
        period_year=year,
        period_month=month,
    ).first()

    if existing and existing.is_unified_engine_active:
        raise ValidationError(
            f"Department #{getattr(dept, 'id', dept)} for period {year}-{month:02d} "
            f"is ALREADY active in the cutover registry."
        )

    reg, _ = SalaryEngineCutoverRegistry.objects.update_or_create(
        department=dept,
        period_year=year,
        period_month=month,
        defaults={
            "is_unified_engine_active": True,
            "authorized_by": user,
            "authorized_at": timezone.now(),
            "notes": notes or "Authorized Unified Salary engine activation.",
        },
    )
    return reg


def deactivate_unified_engine_for_period(
    department: Any,
    year: int,
    month: int,
    user: Optional[Any] = None,
    notes: str = "",
) -> None:
    """Controlled deactivation for testing or emergency rollback."""
    from salary.models import SalaryEngineCutoverRegistry

    _validate_period_bounds(year, month)
    dept, _ = _resolve_department_and_institution(department)

    SalaryEngineCutoverRegistry.objects.filter(
        department=dept,
        period_year=year,
        period_month=month,
    ).update(
        is_unified_engine_active=False,
        notes=notes or "Unified engine deactivated.",
    )
