"""
Payroll Approval Blocker and Attendance Verification Readiness Service (Stage 4).

Validates that all scheduled class occurrences for a department and payroll period
have been fully reconciled and verified before future final payroll approval can proceed.
Blocks final approval if any unresolved, pending, conflicted, or un-scanned attendance exists.
"""
from __future__ import annotations

from typing import Any, Dict, List
from django.core.exceptions import ValidationError

from accounts.models import Department
from salary.models import (
    SalaryAttendanceVerification,
    SalaryReconciliationBatch,
)
from salary.attendance_reconciler import get_month_date_range


class SalaryApprovalBlockedError(ValidationError):
    """Raised when attendance verification invariants prevent final payroll approval."""
    def __init__(self, message: str, blocking_details: Dict[str, Any]):
        super().__init__(message)
        self.blocking_details = blocking_details


def validate_attendance_approval_readiness(
    department: Department,
    period_year: int,
    period_month: int,
) -> Dict[str, Any]:
    """
    Examines attendance reconciliation status and returns structured readiness info.
    Does not raise exceptions; returns complete diagnostic data for UI gates and API responses.
    """
    start_date, end_date = get_month_date_range(period_year, period_month)

    # 1. Scan completeness check: Must have completed batch record
    batch = SalaryReconciliationBatch.objects.filter(
        department=department,
        period_year=period_year,
        period_month=period_month,
    ).first()

    blocking_reasons: List[str] = []
    scan_complete = bool(batch and batch.is_complete)

    if not batch:
        blocking_reasons.append(
            f"Attendance reconciliation has not been executed for {department.name} "
            f"for period {period_year}-{period_month:02d}."
        )
    elif not batch.is_complete:
        blocking_reasons.append(
            f"Attendance reconciliation scan for {department.name} ({period_year}-{period_month:02d}) "
            "was incomplete or interrupted."
        )

    # 2. Check for pending or conflicted verifications
    verifications_qs = SalaryAttendanceVerification.objects.filter(
        department=department,
        class_date__gte=start_date,
        class_date__lte=end_date,
    )

    pending_qs = verifications_qs.filter(
        verification_status=SalaryAttendanceVerification.VerificationStatus.PENDING,
    )
    conflicted_qs = verifications_qs.filter(
        verification_status=SalaryAttendanceVerification.VerificationStatus.CONFLICTED,
    )

    pending_count = pending_qs.count()
    conflicted_count = conflicted_qs.count()

    if pending_count > 0:
        blocking_reasons.append(
            f"There are {pending_count} scheduled class occurrences pending attendance verification."
        )

    if conflicted_count > 0:
        blocking_reasons.append(
            f"There are {conflicted_count} class occurrences with conflicting source attendance evidence."
        )

    unresolved_items: List[Dict[str, Any]] = []
    if pending_count > 0 or conflicted_count > 0:
        for item in verifications_qs.filter(
            verification_status__in=[
                SalaryAttendanceVerification.VerificationStatus.PENDING,
                SalaryAttendanceVerification.VerificationStatus.CONFLICTED,
            ]
        ).select_related(
            "teacher",
            "teacher__user",
            "student",
            "student__user",
        )[:50]:
            unresolved_items.append({
                "id": item.id,
                "occurrence_key": item.occurrence_key,
                "class_date": item.class_date.isoformat(),
                "scheduled_time": item.scheduled_time.strftime("%H:%M:%S") if item.scheduled_time else None,
                "teacher_id": item.teacher_id,
                "teacher_name": getattr(item.teacher, "historical_name", "") or str(item.teacher),
                "student_id": item.student_id,
                "student_name": getattr(item.student.user, "get_full_name", lambda: "")() or str(item.student),
                "verification_status": item.verification_status,
                "flag_reason": item.flag_reason,
            })

    is_ready = scan_complete and pending_count == 0 and conflicted_count == 0

    return {
        "is_ready": is_ready,
        "department_id": department.id,
        "department_name": department.name,
        "period_year": period_year,
        "period_month": period_month,
        "scan_complete": scan_complete,
        "total_occurrences": batch.total_occurrences if batch else 0,
        "verified_count": batch.verified_count if batch else 0,
        "resolved_count": batch.resolved_count if batch else 0,
        "pending_count": pending_count,
        "conflicted_count": conflicted_count,
        "blocking_reasons": blocking_reasons,
        "unresolved_sample": unresolved_items,
    }


def assert_attendance_ready_for_final_approval(
    department: Department,
    period_year: int,
    period_month: int,
) -> None:
    """
    Asserts that attendance is 100% verified for final payroll approval.
    Raises SalaryApprovalBlockedError with detailed breakdown if any issue exists.
    """
    result = validate_attendance_approval_readiness(
        department=department,
        period_year=period_year,
        period_month=period_month,
    )

    if not result["is_ready"]:
        reasons_text = "; ".join(result["blocking_reasons"])
        msg = (
            f"Final payroll approval is BLOCKED for {department.name} ({period_year}-{period_month:02d}). "
            f"Unresolved attendance evidence detected: {reasons_text}"
        )
        raise SalaryApprovalBlockedError(message=msg, blocking_details=result)
