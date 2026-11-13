"""
Unified Salary Management — Stage 9A: Cross-Engine Pre-Activation Conflict Auditor

Read-only, non-destructive conflict auditor for pre-activation validation.
Audits a selected institution, department, and payroll period against all
salary engines (Legacy V1, Legacy V2, Unified Salary) and operational readiness.

Invariants:
- 100% read-only: does NOT delete, rewrite, reopen, invalidate, or settle records.
- Returns a structured BLOCKED result whenever conflicts exist.
- Never fabricates a clean state by excluding conflicting teachers.
- Human review required to resolve any flagged discrepancies.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response

from salary.cutover_guard import (
    SalaryEngine,
    is_unified_salary_active,
    _resolve_department_and_institution,
    _validate_period_bounds,
)


class CrossEngineConflictAuditor:
    """Read-only pre-activation audit service."""

    @classmethod
    def audit_pre_activation(
        cls,
        department: Any,
        year: int,
        month: int,
        institution: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """
        Executes an exhaustive, read-only conflict audit for a department & payroll month.
        Returns a dictionary with status 'CLEAN' or 'BLOCKED' and detailed findings.
        """
        from academy.models import (
            TeacherProfile,
            TeacherSalarySlip,
            QuranTeacherMonthlyPayroll,
        )
        from salary.models import (
            SalaryAttendanceVerification,
            SalaryEngineCutoverRegistry,
            SalaryPayrollPeriod,
            TeacherPayroll,
            TeacherPolicyAssignment,
            PayrollLedgerEntry,
            TeacherPayrollPayment,
        )

        _validate_period_bounds(year, month)
        dept, inst_id = _resolve_department_and_institution(department, institution)
        dept_id = getattr(dept, "id", dept)
        dept_name = getattr(dept, "name", f"Department #{dept_id}")

        blockers: List[str] = []
        conflicts: List[Dict[str, Any]] = []

        # --------------------------------------------------------------------
        # 1. CUTOVER OWNERSHIP STATUS
        # --------------------------------------------------------------------
        registry_entry = SalaryEngineCutoverRegistry.objects.filter(
            department_id=dept_id,
            period_year=year,
            period_month=month,
        ).first()

        is_currently_unified = bool(registry_entry and registry_entry.is_unified_engine_active)
        ownership_status = {
            "registry_record_exists": registry_entry is not None,
            "is_unified_engine_active": is_currently_unified,
            "applicable_engine": SalaryEngine.UNIFIED if is_currently_unified else SalaryEngine.LEGACY,
            "authorized_by": getattr(registry_entry.authorized_by, "username", None) if registry_entry else None,
            "authorized_at": registry_entry.authorized_at.isoformat() if (registry_entry and registry_entry.authorized_at) else None,
            "notes": registry_entry.notes if registry_entry else "",
        }

        # --------------------------------------------------------------------
        # 2. LEGACY V1 SALARY RECORDS
        # --------------------------------------------------------------------
        v1_slips = TeacherSalarySlip.objects.filter(
            teacher__department_id=dept_id,
            year=year,
            month=month,
        ).select_related("teacher__user")

        v1_count = v1_slips.count()
        v1_statuses: Dict[str, int] = {}
        v1_teacher_ids = set()
        v1_finalized_count = 0

        for slip in v1_slips:
            v1_teacher_ids.add(slip.teacher_id)
            st = str(slip.status or "unknown")
            v1_statuses[st] = v1_statuses.get(st, 0) + 1
            if st in {"processed", "paid"}:
                v1_finalized_count += 1

        v1_audit = {
            "count": v1_count,
            "statuses": v1_statuses,
            "finalized_or_paid_count": v1_finalized_count,
            "teacher_ids": sorted(list(v1_teacher_ids)),
        }

        if v1_finalized_count > 0:
            blockers.append(
                f"Legacy Salary V1 has {v1_finalized_count} processed/paid salary slip(s) "
                f"for {dept_name} in {year}-{month:02d}. Unified cutover is blocked."
            )

        # --------------------------------------------------------------------
        # 3. LEGACY V2 SALARY RECORDS
        # --------------------------------------------------------------------
        v2_payrolls = QuranTeacherMonthlyPayroll.objects.filter(
            department_id=dept_id,
            year=year,
            month=month,
        ).select_related("teacher__user")

        v2_count = v2_payrolls.count()
        v2_statuses: Dict[str, int] = {}
        v2_teacher_ids = set()
        v2_approved_count = 0
        v2_paid_count = 0

        for p in v2_payrolls:
            v2_teacher_ids.add(p.teacher_id)
            st = str(p.status or "unknown")
            v2_statuses[st] = v2_statuses.get(st, 0) + 1
            if st == "approved":
                v2_approved_count += 1
            elif st == "paid":
                v2_paid_count += 1

        v2_audit = {
            "count": v2_count,
            "statuses": v2_statuses,
            "approved_count": v2_approved_count,
            "paid_count": v2_paid_count,
            "teacher_ids": sorted(list(v2_teacher_ids)),
        }

        if (v2_approved_count + v2_paid_count) > 0:
            blockers.append(
                f"Legacy Salary V2 has {v2_approved_count} approved and {v2_paid_count} paid payroll record(s) "
                f"for {dept_name} in {year}-{month:02d}. Unified cutover is blocked."
            )

        # --------------------------------------------------------------------
        # 4. UNIFIED SALARY ENGINE RECORDS
        # --------------------------------------------------------------------
        unified_period = SalaryPayrollPeriod.objects.filter(
            department_id=dept_id,
            payroll_year=year,
            payroll_month=month,
        ).first()

        unified_audit = {
            "period_exists": unified_period is not None,
            "period_status": unified_period.status if unified_period else None,
            "revision": unified_period.current_revision if unified_period else 0,
            "gross_total": str(unified_period.gross_total) if unified_period else "0.00",
            "net_total": str(unified_period.net_total) if unified_period else "0.00",
            "teacher_payrolls_count": 0,
            "approved": False,
            "paid": False,
            "ledger_postings_count": 0,
            "payments_recorded_count": 0,
            "teacher_ids": [],
        }

        unified_teacher_ids = set()
        if unified_period:
            teacher_payrolls = TeacherPayroll.objects.filter(payroll_period=unified_period)
            unified_audit["teacher_payrolls_count"] = teacher_payrolls.count()
            unified_teacher_ids = set(teacher_payrolls.values_list("teacher_id", flat=True))
            unified_audit["teacher_ids"] = sorted(list(unified_teacher_ids))
            unified_audit["approved"] = unified_period.status in {
                SalaryPayrollPeriod.Status.APPROVED,
                SalaryPayrollPeriod.Status.PAID,
            }
            unified_audit["paid"] = unified_period.status == SalaryPayrollPeriod.Status.PAID
            unified_audit["ledger_postings_count"] = PayrollLedgerEntry.objects.filter(payroll_period=unified_period).count()
            unified_audit["payments_recorded_count"] = TeacherPayrollPayment.objects.filter(payroll_period=unified_period).count()

        # --------------------------------------------------------------------
        # 5. CROSS-ENGINE TEACHER IDENTITY CONFLICTS
        # --------------------------------------------------------------------
        # Conflict: A teacher exists in both Legacy (V1/V2) and Unified
        legacy_teacher_ids = v1_teacher_ids.union(v2_teacher_ids)
        overlapping_teachers = legacy_teacher_ids.intersection(unified_teacher_ids)

        if overlapping_teachers:
            for t_id in sorted(list(overlapping_teachers)):
                t_profile = TeacherProfile.objects.filter(id=t_id).select_related("user").first()
                t_name = str(t_profile.user.get_full_name() or t_profile.user.username) if t_profile else f"Teacher #{t_id}"
                c_detail = {
                    "teacher_id": t_id,
                    "teacher_name": t_name,
                    "in_v1": t_id in v1_teacher_ids,
                    "in_v2": t_id in v2_teacher_ids,
                    "in_unified": t_id in unified_teacher_ids,
                }
                conflicts.append(c_detail)
            blockers.append(
                f"{len(overlapping_teachers)} teacher(s) have payroll records in both legacy and Unified engines "
                f"for period {year}-{month:02d}."
            )

        # Conflict: Inactive cutover but Unified records are approved/paid
        if not is_currently_unified and (unified_audit["approved"] or unified_audit["paid"]):
            blockers.append(
                f"Cutover registry is INACTIVE for {dept_name} ({year}-{month:02d}), but Unified Salary period "
                f"is marked as {unified_audit['period_status']}. Cutover ownership inconsistency detected."
            )

        # --------------------------------------------------------------------
        # 6. ATTENDANCE RECONCILIATION VERIFICATION
        # --------------------------------------------------------------------
        unresolved_verifications = SalaryAttendanceVerification.objects.filter(
            department_id=dept_id,
            class_date__year=year,
            class_date__month=month,
            verification_status__in=[
                SalaryAttendanceVerification.VerificationStatus.PENDING,
                SalaryAttendanceVerification.VerificationStatus.CONFLICTED,
            ],
        ).count()

        if unresolved_verifications > 0:
            blockers.append(
                f"{unresolved_verifications} attendance verification record(s) remain PENDING/CONFLICTED "
                f"for period {year}-{month:02d}."
            )

        # --------------------------------------------------------------------
        # 7. SALARY POLICY ASSIGNMENTS
        # --------------------------------------------------------------------
        active_department_teachers = TeacherProfile.objects.filter(
            department_id=dept_id,
            user__is_active=True,
        ).select_related("user")

        unassigned_teachers = []
        for teacher in active_department_teachers:
            has_assignment = TeacherPolicyAssignment.objects.filter(
                teacher=teacher,
                department_id=dept_id,
                effective_from__lte=f"{year}-{month:02d}-28",
            ).filter(
                Q(effective_to__isnull=True) | Q(effective_to__gte=f"{year}-{month:02d}-01")
            ).exists()
            if not has_assignment:
                unassigned_teachers.append({
                    "teacher_id": teacher.id,
                    "teacher_name": str(teacher.user.get_full_name() or teacher.user.username),
                })

        if unassigned_teachers:
            blockers.append(
                f"{len(unassigned_teachers)} active teacher(s) lack a published salary policy assignment "
                f"for period {year}-{month:02d}."
            )

        # --------------------------------------------------------------------
        # 8. FINAL AUDIT DECISION
        # --------------------------------------------------------------------
        is_clean = len(blockers) == 0
        overall_status = "CLEAN" if is_clean else "BLOCKED"

        return {
            "status": overall_status,
            "can_activate": is_clean,
            "department": {
                "id": dept_id,
                "name": dept_name,
                "institution_id": inst_id,
            },
            "period": {
                "year": year,
                "month": month,
            },
            "ownership": ownership_status,
            "legacy_v1": v1_audit,
            "legacy_v2": v2_audit,
            "unified_engine": unified_audit,
            "conflicting_teachers": conflicts,
            "unresolved_attendance_count": unresolved_verifications,
            "unassigned_teachers": unassigned_teachers,
            "blockers_count": len(blockers),
            "blockers": blockers,
        }
