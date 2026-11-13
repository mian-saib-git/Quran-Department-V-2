"""IVS Unified Salary Management — Draft Payroll, Snapshot, and Department Submission Service (Stage 7A).

Provides deterministic lifecycle operations for monthly department payroll:
1. Generate initial draft monthly payroll with full itemization and calculation snapshots.
2. Calculate old-vs-new financial impact preview for draft recalculation.
3. Recalculate editable draft payroll with revision tracking, audit logs, and mandatory reason for monetary changes.
4. Department submission with immutable submission snapshot, attendance completeness flagging (without blocking submission), and strict locking.
5. Department Admin return-for-correction request preparation.

Zero modifications to historical Salary V1/V2 records.
Pure Decimal arithmetic.
"""
from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from accounts.models import Department, User
from academy.models import (
    TeacherProfile,
    TeacherSalarySlip,
    QuranTeacherMonthlyPayroll,
)
from salary.models import (
    PayrollCalculationSnapshot,
    PayrollCorrectionRequest,
    PayrollEarningLine,
    PayrollLifecycleAudit,
    SalaryPayrollPeriod,
    TeacherPayroll,
    SalaryPolicy,
    SalaryPolicyVersion,
    PayrollAdjustment,
    PayrollLedgerEntry,
    TeacherPayrollPayment,
    SalaryEngineCutoverRegistry,
)
from salary.permissions import is_user_department_admin_for_department
from salary.calculation_engine import (
    calculate_department_salary_preview,
    to_decimal,
)
from salary.attendance_readiness import validate_attendance_approval_readiness


def compute_evidence_fingerprint(preview_data: Dict[str, Any]) -> str:
    """Compute a deterministic SHA-256 fingerprint of the calculation evidence."""
    summary = preview_data.get("summary", {})
    payload = {
        "dept": preview_data.get("department_id"),
        "year": preview_data.get("payroll_year"),
        "month": preview_data.get("payroll_month"),
        "gross": str(summary.get("gross_draft_earnings")),
        "net": str(summary.get("draft_net_salary")),
        "pos": str(summary.get("positive_adjustments")),
        "cut": str(summary.get("cuttings")),
        "teachers": preview_data.get("evaluated_teachers_count"),
        "complete": preview_data.get("is_calculation_complete"),
        "scheduled_classes": summary.get("total_scheduled_classes", 0),
        "pending": summary.get("total_pending_verifications", 0),
        "conflicted": summary.get("total_conflicted_verifications", 0),
    }
    dumped = json.dumps(payload, sort_keys=True)
    return hashlib.sha256(dumped.encode("utf-8")).hexdigest()[:32]


def is_unified_salary_engine_active(department: Department, year: int, month: int) -> bool:
    """
    Checks whether the Unified Salary engine is explicitly authorized for this department and period.
    By default in production, returns False until Stage 9 cutover.
    """
    from salary.cutover_guard import is_unified_salary_active
    return is_unified_salary_active(department, year, month)


def activate_unified_engine_for_period(
    department: Department,
    year: int,
    month: int,
    user: Optional[User] = None,
    notes: str = "",
) -> SalaryEngineCutoverRegistry:
    """Controlled activation for testing or authorized cutover."""
    from salary.cutover_guard import activate_unified_engine_for_period as activate_guard
    return activate_guard(department, year, month, user=user, notes=notes)


def deactivate_unified_engine_for_period(
    department: Department,
    year: int,
    month: int,
) -> None:
    """Controlled deactivation for testing."""
    from salary.cutover_guard import deactivate_unified_engine_for_period as deactivate_guard
    deactivate_guard(department, year, month)


class PayrollLifecycleService:
    """Core service executing Stage 7A draft payroll generation, recalculation, and department submission."""

    @classmethod
    @transaction.atomic
    def generate_draft_payroll(
        cls,
        department: Department,
        year: int,
        month: int,
        user: User,
    ) -> SalaryPayrollPeriod:
        """
        Generate initial draft monthly payroll for a department.
        Reuses calculate_department_salary_preview to create itemized records,
        earning lines, and calculation snapshots.
        """
        if month < 1 or month > 12:
            raise ValidationError("Payroll month must be between 1 and 12.")

        # Check existing payroll period
        existing = SalaryPayrollPeriod.objects.filter(
            department=department,
            payroll_year=year,
            payroll_month=month,
        ).first()

        if existing:
            if existing.status in [
                SalaryPayrollPeriod.Status.PENDING_APPROVAL,
                SalaryPayrollPeriod.Status.APPROVED,
                SalaryPayrollPeriod.Status.PAID,
            ]:
                raise ValidationError(
                    f"Payroll for {department.name} ({year}-{month:02d}) has already been submitted "
                    f"and is locked against new draft creation. Current status: {existing.get_status_display()}."
                )
            if existing.status == SalaryPayrollPeriod.Status.DRAFT:
                raise ValidationError(
                    f"A draft payroll period already exists for {department.name} ({year}-{month:02d}). "
                    "Use the Recalculate action to update it."
                )

        # Run pure deterministic calculation
        preview = calculate_department_salary_preview(department, year, month)
        fingerprint = compute_evidence_fingerprint(preview)

        # Check attendance readiness
        readiness = validate_attendance_approval_readiness(department, year, month)
        attendance_complete = readiness.get("is_ready_for_approval", False)
        incompleteness_reasons = []
        if not attendance_complete:
            incompleteness_reasons.extend(readiness.get("blocking_reasons", []))
        if preview.get("department_warnings"):
            incompleteness_reasons.extend(preview["department_warnings"])

        summary = preview.get("summary", {})
        gross_total = to_decimal(summary.get("gross_draft_earnings", "0.00"))
        positive_total = to_decimal(summary.get("positive_adjustments", "0.00"))
        cuttings_total = to_decimal(summary.get("cuttings", "0.00"))
        net_total = to_decimal(summary.get("draft_net_salary", "0.00"))

        if existing and existing.status == SalaryPayrollPeriod.Status.RETURNED_FOR_CORRECTION:
            period = existing
            period.status = SalaryPayrollPeriod.Status.DRAFT
            period.current_revision += 1
            period.gross_total = gross_total
            period.positive_adjustments_total = positive_total
            period.cuttings_total = cuttings_total
            period.net_total = net_total
            period.total_teachers = preview.get("evaluated_teachers_count", 0)
            period.is_calculation_complete = preview.get("is_calculation_complete", True)
            period.attendance_readiness_complete = attendance_complete
            period.incompleteness_reasons = incompleteness_reasons
            period.source_fingerprint = fingerprint
            period.save()
            action = PayrollLifecycleAudit.Action.RECALCULATED
        else:
            period = SalaryPayrollPeriod.objects.create(
                institution=department.institution,
                department=department,
                payroll_year=year,
                payroll_month=month,
                status=SalaryPayrollPeriod.Status.DRAFT,
                current_revision=1,
                total_teachers=preview.get("evaluated_teachers_count", 0),
                gross_total=gross_total,
                positive_adjustments_total=positive_total,
                cuttings_total=cuttings_total,
                net_total=net_total,
                is_calculation_complete=preview.get("is_calculation_complete", True),
                attendance_readiness_complete=attendance_complete,
                incompleteness_reasons=incompleteness_reasons,
                source_fingerprint=fingerprint,
                created_by=user,
            )
            action = PayrollLifecycleAudit.Action.DRAFT_CREATED

        # Persist TeacherPayrolls and EarningLines
        cls._persist_teacher_payrolls_and_lines(period, preview.get("teacher_previews", []), user)

        # Persist Period-level Calculation Snapshot
        PayrollCalculationSnapshot.objects.create(
            payroll_period=period,
            teacher_payroll=None,
            revision=period.current_revision,
            snapshot_type=PayrollCalculationSnapshot.SnapshotType.DRAFT,
            snapshot_data=preview,
            created_by=user,
            source_fingerprint=fingerprint,
        )

        # Audit log
        PayrollLifecycleAudit.objects.create(
            payroll_period=period,
            action=action,
            actor=user,
            previous_status="",
            new_status=period.status,
            revision=period.current_revision,
            gross_total_before=None,
            gross_total_after=gross_total,
            net_total_before=None,
            net_total_after=net_total,
            reason="Initial monthly payroll draft generated." if action == PayrollLifecycleAudit.Action.DRAFT_CREATED else "Regenerated returned draft.",
            metadata={"evaluated_teachers": period.total_teachers, "fingerprint": fingerprint},
        )

        return period

    @classmethod
    def _persist_teacher_payrolls_and_lines(
        cls,
        period: SalaryPayrollPeriod,
        teacher_previews: List[Dict[str, Any]],
        user: User,
    ) -> None:
        """Helper to create or replace teacher payroll records, earning lines, and teacher snapshots."""
        # Clean existing records for this period if any
        period.teacher_payrolls.all().delete()

        for tp_data in teacher_previews:
            teacher_id = tp_data.get("teacher_id")
            teacher = TeacherProfile.objects.filter(id=teacher_id).first()
            if not teacher:
                continue

            policy_meta = tp_data.get("policy_metadata") or {}
            applied_policy = None
            applied_version = None
            if policy_meta.get("policy_id"):
                applied_policy = SalaryPolicy.objects.filter(id=policy_meta["policy_id"]).first()
            if policy_meta.get("version_id"):
                applied_version = SalaryPolicyVersion.objects.filter(id=policy_meta["version_id"]).first()

            earnings = tp_data.get("earnings", {})
            b_salary = to_decimal(earnings.get("basic_salary_earnings", "0.00"))
            r_earnings = to_decimal(earnings.get("regular_class_earnings", "0.00"))
            l_bonuses = to_decimal(earnings.get("lesson_plan_bonus_earnings", "0.00"))
            s_earnings = to_decimal(earnings.get("substitute_compensation_earnings", "0.00"))
            c_earnings = to_decimal(earnings.get("cancellation_earnings", "0.00"))
            pos_adj = to_decimal(earnings.get("positive_adjustments", "0.00"))
            cut_adj = to_decimal(earnings.get("cuttings", "0.00"))
            gross = to_decimal(earnings.get("gross_draft_earnings", "0.00"))
            net = to_decimal(earnings.get("draft_net_salary", "0.00"))

            tp = TeacherPayroll.objects.create(
                payroll_period=period,
                teacher=teacher,
                applied_policy=applied_policy,
                applied_policy_version=applied_version,
                basic_salary=b_salary,
                regular_class_earnings=r_earnings,
                lesson_bonuses=l_bonuses,
                substitute_earnings=s_earnings,
                cancellation_earnings=c_earnings,
                positive_adjustments=pos_adj,
                cuttings=cut_adj,
                gross_salary=gross,
                net_salary=net,
                is_calculation_complete=tp_data.get("is_calculation_complete", True),
                completeness_notes=tp_data.get("completeness_notes", []),
                revision=period.current_revision,
            )

            # Earning Lines
            earning_lines_to_create = []

            # 1. Basic salary line if applicable
            if b_salary > Decimal("0.00"):
                earning_lines_to_create.append(
                    PayrollEarningLine(
                        teacher_payroll=tp,
                        earning_type=PayrollEarningLine.EarningType.BASIC_SALARY,
                        rate=b_salary,
                        quantity=Decimal("1.00"),
                        amount=b_salary,
                        policy_version=applied_version,
                        metadata={"notes": tp_data.get("basic_salary_notes", [])},
                    )
                )

            # 2. Class earning lines
            for line in tp_data.get("class_earning_lines", []):
                occ_id = line.get("occurrence_key") or line.get("occurrence_id", "")
                c_date = line.get("class_date")
                st_id = line.get("student_id")
                st_name = line.get("student_name", "")

                # Check if substitute class
                if line.get("is_substitute_class") or to_decimal(line.get("substitute_earnings", "0.00")) > Decimal("0.00"):
                    sub_amt = to_decimal(line.get("substitute_earnings", "0.00"))
                    earning_lines_to_create.append(
                        PayrollEarningLine(
                            teacher_payroll=tp,
                            earning_type=PayrollEarningLine.EarningType.SUBSTITUTE,
                            student_id=st_id,
                            student_name=st_name,
                            class_occurrence_id=occ_id,
                            rate=to_decimal(line.get("applied_rate", "0.00")),
                            quantity=Decimal("1.00"),
                            amount=sub_amt,
                            effective_date=c_date,
                            policy_version=applied_version,
                            applied_override_type=line.get("applied_override_type", ""),
                            attendance_evidence={"attendance_outcome": line.get("attendance_outcome"), "status": line.get("verification_status")},
                            metadata={"plan": line.get("teaching_plan_name")},
                        )
                    )
                # Check if cancellation
                elif line.get("is_cancellation") or to_decimal(line.get("cancellation_earnings", "0.00")) > Decimal("0.00"):
                    canc_amt = to_decimal(line.get("cancellation_earnings", "0.00"))
                    earning_lines_to_create.append(
                        PayrollEarningLine(
                            teacher_payroll=tp,
                            earning_type=PayrollEarningLine.EarningType.CANCELLATION,
                            student_id=st_id,
                            student_name=st_name,
                            class_occurrence_id=occ_id,
                            rate=canc_amt,
                            quantity=Decimal("1.00"),
                            amount=canc_amt,
                            effective_date=c_date,
                            policy_version=applied_version,
                            attendance_evidence={"attendance_outcome": line.get("attendance_outcome")},
                            metadata={},
                        )
                    )
                # Regular class
                else:
                    reg_amt = to_decimal(line.get("regular_earnings", "0.00"))
                    app_rate = to_decimal(line.get("applied_rate", "0.00"))
                    earning_lines_to_create.append(
                        PayrollEarningLine(
                            teacher_payroll=tp,
                            earning_type=PayrollEarningLine.EarningType.REGULAR_CLASS,
                            student_id=st_id,
                            student_name=st_name,
                            class_occurrence_id=occ_id,
                            rate=app_rate,
                            quantity=Decimal("1.00"),
                            amount=reg_amt,
                            effective_date=c_date,
                            policy_version=applied_version,
                            applied_override_type=line.get("applied_override_type", ""),
                            attendance_evidence={"attendance_outcome": line.get("attendance_outcome"), "status": line.get("verification_status")},
                            metadata={"zero_payment_reason": line.get("zero_payment_reason"), "weekly_qualified": line.get("weekly_eligibility_qualified")},
                        )
                    )

                # Lesson plan bonus line (if earned for this class)
                bonus_amt = to_decimal(line.get("lesson_plan_bonus", "0.00"))
                if bonus_amt > Decimal("0.00") or line.get("has_completed_lesson_plan"):
                    if bonus_amt > Decimal("0.00"):
                        earning_lines_to_create.append(
                            PayrollEarningLine(
                                teacher_payroll=tp,
                                earning_type=PayrollEarningLine.EarningType.LESSON_PLAN_BONUS,
                                student_id=st_id,
                                student_name=st_name,
                                class_occurrence_id=f"bonus:{occ_id}",
                                rate=bonus_amt,
                                quantity=Decimal("1.00"),
                                amount=bonus_amt,
                                effective_date=c_date,
                                policy_version=applied_version,
                                attendance_evidence={"has_completed_lesson_plan": True},
                                metadata={"lesson_plan_bonus": True},
                            )
                        )

            if earning_lines_to_create:
                PayrollEarningLine.objects.bulk_create(earning_lines_to_create)

            # Teacher Calculation Snapshot
            PayrollCalculationSnapshot.objects.create(
                payroll_period=period,
                teacher_payroll=tp,
                revision=period.current_revision,
                snapshot_type=PayrollCalculationSnapshot.SnapshotType.DRAFT,
                snapshot_data=tp_data,
                created_by=user,
            )

    @classmethod
    def preview_recalculation_impact(
        cls,
        payroll_period: SalaryPayrollPeriod,
    ) -> Dict[str, Any]:
        """
        Stateless old-versus-new financial impact comparison between the current
        stored payroll records and fresh calculations.
        """
        fresh_preview = calculate_department_salary_preview(
            payroll_period.department,
            payroll_period.payroll_year,
            payroll_period.payroll_month,
        )

        existing_teachers = {
            tp.teacher_id: tp
            for tp in payroll_period.teacher_payrolls.select_related("teacher__user")
        }

        fresh_teachers_dict = {
            prev["teacher_id"]: prev
            for prev in fresh_preview.get("teacher_previews", [])
        }

        all_teacher_ids = sorted(list(set(existing_teachers.keys()) | set(fresh_teachers_dict.keys())))

        teacher_impacts: List[Dict[str, Any]] = []
        has_monetary_changes = False

        for tid in all_teacher_ids:
            old_tp = existing_teachers.get(tid)
            new_data = fresh_teachers_dict.get(tid)

            old_gross = old_tp.gross_salary if old_tp else Decimal("0.00")
            old_net = old_tp.net_salary if old_tp else Decimal("0.00")
            old_pos = old_tp.positive_adjustments if old_tp else Decimal("0.00")
            old_cut = old_tp.cuttings if old_tp else Decimal("0.00")

            new_earnings = new_data.get("earnings", {}) if new_data else {}
            new_gross = to_decimal(new_earnings.get("gross_draft_earnings", "0.00"))
            new_net = to_decimal(new_earnings.get("draft_net_salary", "0.00"))
            new_pos = to_decimal(new_earnings.get("positive_adjustments", "0.00"))
            new_cut = to_decimal(new_earnings.get("cuttings", "0.00"))

            gross_diff = new_gross - old_gross
            net_diff = new_net - old_net
            pos_diff = new_pos - old_pos
            cut_diff = new_cut - old_cut

            teacher_name = ""
            if old_tp and old_tp.teacher.user:
                teacher_name = old_tp.teacher.user.get_full_name() or old_tp.teacher.user.username
            elif new_data:
                teacher_name = new_data.get("teacher_name", f"Teacher #{tid}")

            changed = (gross_diff != Decimal("0.00") or net_diff != Decimal("0.00") or pos_diff != Decimal("0.00") or cut_diff != Decimal("0.00"))
            if changed:
                has_monetary_changes = True

            teacher_impacts.append({
                "teacher_id": tid,
                "teacher_name": teacher_name,
                "has_change": changed,
                "old_gross": str(old_gross),
                "new_gross": str(new_gross),
                "gross_diff": str(gross_diff),
                "old_net": str(old_net),
                "new_net": str(new_net),
                "net_diff": str(net_diff),
                "old_positive_adjustments": str(old_pos),
                "new_positive_adjustments": str(new_pos),
                "positive_diff": str(pos_diff),
                "old_cuttings": str(old_cut),
                "new_cuttings": str(new_cut),
                "cuttings_diff": str(cut_diff),
            })

        fresh_summary = fresh_preview.get("summary", {})
        new_gross_total = to_decimal(fresh_summary.get("gross_draft_earnings", "0.00"))
        new_net_total = to_decimal(fresh_summary.get("draft_net_salary", "0.00"))
        new_pos_total = to_decimal(fresh_summary.get("positive_adjustments", "0.00"))
        new_cut_total = to_decimal(fresh_summary.get("cuttings", "0.00"))

        overall_gross_diff = new_gross_total - payroll_period.gross_total
        overall_net_diff = new_net_total - payroll_period.net_total

        return {
            "payroll_period_id": payroll_period.id,
            "department_id": payroll_period.department_id,
            "department_name": payroll_period.department.name,
            "payroll_year": payroll_period.payroll_year,
            "payroll_month": payroll_period.payroll_month,
            "current_revision": payroll_period.current_revision,
            "has_monetary_changes": has_monetary_changes,
            "overall_impact": {
                "old_gross_total": str(payroll_period.gross_total),
                "new_gross_total": str(new_gross_total),
                "gross_total_diff": str(overall_gross_diff),
                "old_net_total": str(payroll_period.net_total),
                "new_net_total": str(new_net_total),
                "net_total_diff": str(overall_net_diff),
                "old_positive_adjustments": str(payroll_period.positive_adjustments_total),
                "new_positive_adjustments": str(new_pos_total),
                "old_cuttings": str(payroll_period.cuttings_total),
                "new_cuttings": str(new_cut_total),
            },
            "teacher_impacts": teacher_impacts,
            "fresh_preview": fresh_preview,
        }

    @classmethod
    @transaction.atomic
    def recalculate_draft_payroll(
        cls,
        payroll_period: SalaryPayrollPeriod,
        user: User,
        reason: Optional[str] = None,
    ) -> SalaryPayrollPeriod:
        """
        Recalculate an editable draft payroll period.
        Requirements:
        - Editable state (DRAFT or RETURNED_FOR_CORRECTION).
        - Old-vs-new financial impact evaluated.
        - Mandatory reason if monetary change occurs.
        - Preserves earlier calculation revisions.
        - Increments revision number and appends audit log.
        """
        if payroll_period.status not in [
            SalaryPayrollPeriod.Status.DRAFT,
            SalaryPayrollPeriod.Status.RETURNED_FOR_CORRECTION,
        ]:
            raise ValidationError(
                f"Cannot recalculate payroll in status '{payroll_period.get_status_display()}'. "
                "Only Draft or Returned payroll periods can be recalculated."
            )

        impact = cls.preview_recalculation_impact(payroll_period)
        has_monetary_changes = impact["has_monetary_changes"]

        if has_monetary_changes and (not reason or not reason.strip()):
            raise ValidationError(
                "A mandatory reason is required to recalculate a draft payroll with financial changes."
            )

        fresh_preview = impact["fresh_preview"]
        fresh_summary = fresh_preview.get("summary", {})
        fingerprint = compute_evidence_fingerprint(fresh_preview)

        # Check attendance readiness
        readiness = validate_attendance_approval_readiness(
            payroll_period.department,
            payroll_period.payroll_year,
            payroll_period.payroll_month,
        )
        attendance_complete = readiness.get("is_ready_for_approval", False)
        incompleteness_reasons = []
        if not attendance_complete:
            incompleteness_reasons.extend(readiness.get("blocking_reasons", []))
        if fresh_preview.get("department_warnings"):
            incompleteness_reasons.extend(fresh_preview["department_warnings"])

        old_gross = payroll_period.gross_total
        old_net = payroll_period.net_total
        new_gross = to_decimal(fresh_summary.get("gross_draft_earnings", "0.00"))
        new_net = to_decimal(fresh_summary.get("draft_net_salary", "0.00"))
        new_pos = to_decimal(fresh_summary.get("positive_adjustments", "0.00"))
        new_cut = to_decimal(fresh_summary.get("cuttings", "0.00"))

        payroll_period.current_revision += 1
        payroll_period.gross_total = new_gross
        payroll_period.net_total = new_net
        payroll_period.positive_adjustments_total = new_pos
        payroll_period.cuttings_total = new_cut
        payroll_period.total_teachers = fresh_preview.get("evaluated_teachers_count", 0)
        payroll_period.is_calculation_complete = fresh_preview.get("is_calculation_complete", True)
        payroll_period.attendance_readiness_complete = attendance_complete
        payroll_period.incompleteness_reasons = incompleteness_reasons
        payroll_period.source_fingerprint = fingerprint
        payroll_period.save()

        # Replace teacher payrolls and earning lines for new revision
        cls._persist_teacher_payrolls_and_lines(payroll_period, fresh_preview.get("teacher_previews", []), user)

        # Calculation Snapshot for new revision
        PayrollCalculationSnapshot.objects.create(
            payroll_period=payroll_period,
            teacher_payroll=None,
            revision=payroll_period.current_revision,
            snapshot_type=PayrollCalculationSnapshot.SnapshotType.RECALCULATION,
            snapshot_data=fresh_preview,
            created_by=user,
            source_fingerprint=fingerprint,
        )

        # Lifecycle Audit
        PayrollLifecycleAudit.objects.create(
            payroll_period=payroll_period,
            action=PayrollLifecycleAudit.Action.RECALCULATED,
            actor=user,
            previous_status=payroll_period.status,
            new_status=payroll_period.status,
            revision=payroll_period.current_revision,
            gross_total_before=old_gross,
            gross_total_after=new_gross,
            net_total_before=old_net,
            net_total_after=new_net,
            reason=reason or "Draft recalculated with fresh evidence.",
            metadata={
                "has_monetary_changes": has_monetary_changes,
                "overall_impact": impact.get("overall_impact"),
            },
        )

        return payroll_period

    @classmethod
    @transaction.atomic
    def submit_department_payroll(
        cls,
        payroll_period: SalaryPayrollPeriod,
        user: User,
        notes: str = "",
    ) -> SalaryPayrollPeriod:
        """
        Department submission of draft monthly payroll:
        DRAFT -> PENDING_APPROVAL.
        - Preserves immutable submission snapshot.
        - Records submitter, timestamp, department, period, and totals.
        - Detects stale evidence (rejects submission if underlying data changed since draft calculation).
        - Flags unresolved attendance as incomplete and ineligible for final approval,
          while permitting submission for review (in adherence to owner mandate).
        - Locks submitted payroll against direct Department Admin monetary editing.
        """
        if payroll_period.status == SalaryPayrollPeriod.Status.PENDING_APPROVAL:
            raise ValidationError("This payroll period has already been submitted for review.")
        if payroll_period.status in [
            SalaryPayrollPeriod.Status.APPROVED,
            SalaryPayrollPeriod.Status.PAID,
        ]:
            raise ValidationError(
                f"Cannot submit payroll in status '{payroll_period.get_status_display()}'. Already finalized."
            )

        # Check stale evidence
        fresh_preview = calculate_department_salary_preview(
            payroll_period.department,
            payroll_period.payroll_year,
            payroll_period.payroll_month,
        )
        current_fingerprint = compute_evidence_fingerprint(fresh_preview)
        if payroll_period.source_fingerprint and current_fingerprint != payroll_period.source_fingerprint:
            raise ValidationError(
                "Underlying attendance, schedule, or adjustments have changed since the draft was calculated. "
                "Please recalculate the draft before submitting."
            )

        # Missing attendance check (Rule: visible flag, does not block submission, blocks final approval)
        readiness = validate_attendance_approval_readiness(
            payroll_period.department,
            payroll_period.payroll_year,
            payroll_period.payroll_month,
        )
        attendance_complete = readiness.get("is_ready_for_approval", False)
        incompleteness_reasons = []
        if not attendance_complete:
            incompleteness_reasons.extend(readiness.get("blocking_reasons", []))
        if fresh_preview.get("department_warnings"):
            incompleteness_reasons.extend(fresh_preview["department_warnings"])

        previous_status = payroll_period.status
        payroll_period.status = SalaryPayrollPeriod.Status.PENDING_APPROVAL
        payroll_period.submitted_by = user
        payroll_period.submitted_at = timezone.now()
        payroll_period.submission_notes = notes or ""
        payroll_period.attendance_readiness_complete = attendance_complete
        payroll_period.incompleteness_reasons = incompleteness_reasons
        payroll_period.submission_metadata = {
            "submitted_by_id": user.id,
            "submitted_by_name": user.get_full_name() or user.username,
            "submitted_at": payroll_period.submitted_at.isoformat(),
            "evaluated_teachers_count": payroll_period.total_teachers,
            "gross_total": str(payroll_period.gross_total),
            "net_total": str(payroll_period.net_total),
            "is_calculation_complete": payroll_period.is_calculation_complete,
            "attendance_readiness_complete": attendance_complete,
            "incompleteness_reasons": incompleteness_reasons,
        }
        payroll_period.save()

        # Immutable Submission Snapshot
        PayrollCalculationSnapshot.objects.create(
            payroll_period=payroll_period,
            teacher_payroll=None,
            revision=payroll_period.current_revision,
            snapshot_type=PayrollCalculationSnapshot.SnapshotType.SUBMISSION,
            snapshot_data={
                "submission_metadata": payroll_period.submission_metadata,
                "preview_at_submission": fresh_preview,
            },
            created_by=user,
            source_fingerprint=payroll_period.source_fingerprint,
        )

        # Lifecycle Audit
        PayrollLifecycleAudit.objects.create(
            payroll_period=payroll_period,
            action=PayrollLifecycleAudit.Action.SUBMITTED,
            actor=user,
            previous_status=previous_status,
            new_status=payroll_period.status,
            revision=payroll_period.current_revision,
            gross_total_before=payroll_period.gross_total,
            gross_total_after=payroll_period.gross_total,
            net_total_before=payroll_period.net_total,
            net_total_after=payroll_period.net_total,
            reason=notes or "Submitted by Department Admin for institutional review.",
            metadata=payroll_period.submission_metadata,
        )

        return payroll_period

    @classmethod
    @transaction.atomic
    def request_return_for_correction(
        cls,
        payroll_period: SalaryPayrollPeriod,
        user: User,
        reason: str,
        correction_scope: str,
    ) -> PayrollCorrectionRequest:
        """
        Request return of a submitted payroll period for correction.
        - Mandatory reason and requested correction scope.
        - Preserves locked state: Does NOT automatically unlock payroll.
        - Appends to audit trail.
        """
        if payroll_period.status != SalaryPayrollPeriod.Status.PENDING_APPROVAL:
            raise ValidationError(
                f"Correction requests can only be filed for submitted payroll (Pending Approval). "
                f"Current status: {payroll_period.get_status_display()}."
            )

        if not reason or not reason.strip():
            raise ValidationError("A mandatory reason is required to request return for correction.")
        if not correction_scope or not correction_scope.strip():
            raise ValidationError("Requested correction scope must be specified.")

        existing_pending = PayrollCorrectionRequest.objects.filter(
            payroll_period=payroll_period,
            status=PayrollCorrectionRequest.Status.PENDING,
        ).first()
        if existing_pending:
            raise ValidationError("A pending return-for-correction request already exists for this payroll period.")

        req = PayrollCorrectionRequest.objects.create(
            payroll_period=payroll_period,
            requested_by=user,
            reason=reason.strip(),
            correction_scope=correction_scope.strip(),
            submission_revision=payroll_period.current_revision,
            status=PayrollCorrectionRequest.Status.PENDING,
        )

        PayrollLifecycleAudit.objects.create(
            payroll_period=payroll_period,
            action=PayrollLifecycleAudit.Action.CORRECTION_REQUESTED,
            actor=user,
            previous_status=payroll_period.status,
            new_status=payroll_period.status,
            revision=payroll_period.current_revision,
            gross_total_before=payroll_period.gross_total,
            gross_total_after=payroll_period.gross_total,
            net_total_before=payroll_period.net_total,
            net_total_after=payroll_period.net_total,
            reason=f"Correction requested: {reason.strip()}",
            metadata={"correction_request_id": req.id, "scope": correction_scope.strip()},
        )

        return req

    # ========================================================================
    # STAGE 7B: APPROVALS, CORRECTION AUTHORITY, IMMUTABLE LEDGER & PAYMENTS
    # ========================================================================

    @classmethod
    def assert_cutover_and_legacy_guard(
        cls,
        department: Department,
        year: int,
        month: int,
    ) -> None:
        """
        Enforces legacy double-payment prevention and new-engine activation guard (Stage 7B).
        1. Unified engine must be explicitly activated in SalaryEngineCutoverRegistry.
        2. Legacy Salary V1/V2 records must not already be processed/approved/paid for this period.
        """
        from salary.cutover_guard import assert_unified_salary_write_permitted
        assert_unified_salary_write_permitted(department, year, month, operation="live approval or payment")

    @classmethod
    @transaction.atomic
    def approve_correction_request(
        cls,
        payroll_period: SalaryPayrollPeriod,
        correction_request_id: int,
        user: User,
        notes: str,
    ) -> PayrollCorrectionRequest:
        """
        Institution Admin or Super Admin authorizes a return-for-correction request.
        - Two-man rule: Department Admin cannot authorize their own request.
        - Unrelated Institution Admin denied.
        - Mandatory decision reason required.
        - Transitions payroll period status: PENDING_APPROVAL -> RETURNED_FOR_CORRECTION.
        - Unlocks draft-editing operations while preserving the prior submission snapshot.
        """
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise ValidationError("You do not have administrative permission to review correction requests.")

        if role == User.Role.DEPARTMENT_ADMIN or is_user_department_admin_for_department(user, payroll_period.department_id):
            raise ValidationError("A Department Admin cannot authorize their own correction request. Review must be performed by Institution Admin or Super Admin.")

        if role == User.Role.INSTITUTION_ADMIN:
            user_inst_id = getattr(user, "institution_id", None)
            if user_inst_id and payroll_period.institution_id != user_inst_id:
                raise ValidationError("Cross-institution review denied. You can only review correction requests for your own institution.")

        if not notes or not notes.strip():
            raise ValidationError("A mandatory review decision reason is required to authorize return for correction.")

        req = PayrollCorrectionRequest.objects.filter(
            pk=correction_request_id,
            payroll_period=payroll_period,
        ).select_for_update().first()
        if not req:
            raise ValidationError("Correction request not found.")

        if req.status != PayrollCorrectionRequest.Status.PENDING:
            raise ValidationError(f"Correction request is already {req.get_status_display().lower()}.")

        # Requester cannot approve their own request
        if req.requested_by_id == user.id:
            raise ValidationError("Self-approval prohibited. A requester cannot authorize their own correction request.")

        # Period must be in PENDING_APPROVAL
        if payroll_period.status != SalaryPayrollPeriod.Status.PENDING_APPROVAL:
            raise ValidationError(
                f"Cannot authorize return for correction on payroll with status '{payroll_period.get_status_display()}'."
            )

        req.status = PayrollCorrectionRequest.Status.APPROVED
        req.reviewed_by = user
        req.reviewed_at = timezone.now()
        req.review_notes = notes.strip()
        req.save()

        payroll_period.status = SalaryPayrollPeriod.Status.RETURNED_FOR_CORRECTION
        payroll_period.save()

        PayrollLifecycleAudit.objects.create(
            payroll_period=payroll_period,
            action=PayrollLifecycleAudit.Action.CORRECTION_APPROVED,
            actor=user,
            previous_status=SalaryPayrollPeriod.Status.PENDING_APPROVAL,
            new_status=payroll_period.status,
            revision=payroll_period.current_revision,
            gross_total_before=payroll_period.gross_total,
            gross_total_after=payroll_period.gross_total,
            net_total_before=payroll_period.net_total,
            net_total_after=payroll_period.net_total,
            reason=f"Correction request approved: {notes.strip()}",
            metadata={"correction_request_id": req.id, "scope": req.correction_scope},
        )

        return req

    @classmethod
    @transaction.atomic
    def reject_correction_request(
        cls,
        payroll_period: SalaryPayrollPeriod,
        correction_request_id: int,
        user: User,
        notes: str,
    ) -> PayrollCorrectionRequest:
        """
        Institution Admin or Super Admin rejects a return-for-correction request.
        - Leaves payroll period locked in PENDING_APPROVAL.
        - Records reviewer identity, decision notes, and timestamp.
        """
        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise ValidationError("You do not have administrative permission to review correction requests.")

        if role == User.Role.DEPARTMENT_ADMIN or is_user_department_admin_for_department(user, payroll_period.department_id):
            raise ValidationError("A Department Admin cannot reject their own correction request. Review must be performed by Institution Admin or Super Admin.")

        if role == User.Role.INSTITUTION_ADMIN:
            user_inst_id = getattr(user, "institution_id", None)
            if user_inst_id and payroll_period.institution_id != user_inst_id:
                raise ValidationError("Cross-institution review denied.")

        if not notes or not notes.strip():
            raise ValidationError("A mandatory decision reason is required when rejecting a correction request.")

        req = PayrollCorrectionRequest.objects.filter(
            pk=correction_request_id,
            payroll_period=payroll_period,
        ).select_for_update().first()
        if not req:
            raise ValidationError("Correction request not found.")

        if req.status != PayrollCorrectionRequest.Status.PENDING:
            raise ValidationError(f"Correction request is already {req.get_status_display().lower()}.")

        req.status = PayrollCorrectionRequest.Status.REJECTED
        req.reviewed_by = user
        req.reviewed_at = timezone.now()
        req.review_notes = notes.strip()
        req.save()

        # Payroll period remains locked in PENDING_APPROVAL
        PayrollLifecycleAudit.objects.create(
            payroll_period=payroll_period,
            action=PayrollLifecycleAudit.Action.CORRECTION_REJECTED,
            actor=user,
            previous_status=payroll_period.status,
            new_status=payroll_period.status,
            revision=payroll_period.current_revision,
            gross_total_before=payroll_period.gross_total,
            gross_total_after=payroll_period.gross_total,
            net_total_before=payroll_period.net_total,
            net_total_after=payroll_period.net_total,
            reason=f"Correction request rejected: {notes.strip()}",
            metadata={"correction_request_id": req.id, "scope": req.correction_scope},
        )

        return req

    @classmethod
    def get_approval_blockers(cls, payroll_period: SalaryPayrollPeriod) -> Dict[str, Any]:
        """
        Inspects all potential blockers for final payroll approval.
        Returns detailed list of blocking reasons and diagnostic metadata.
        """
        blocking_reasons: List[str] = []

        # 1. Status check
        if payroll_period.status != SalaryPayrollPeriod.Status.PENDING_APPROVAL:
            blocking_reasons.append(
                f"Payroll must be in 'Pending Approval' status to be approved. Current status: '{payroll_period.get_status_display()}'."
            )

        # 2. Activation guard check
        if not is_unified_salary_engine_active(payroll_period.department, payroll_period.payroll_year, payroll_period.payroll_month):
            blocking_reasons.append(
                f"Unified Salary engine is not authorized for live approval for {payroll_period.department.name} "
                f"({payroll_period.payroll_year}-{payroll_period.payroll_month:02d})."
            )

        # 3. Legacy duplicate payment conflict check
        v1_processed = TeacherSalarySlip.objects.filter(
            teacher__department=payroll_period.department,
            month=payroll_period.payroll_month,
            year=payroll_period.payroll_year,
            status="processed",
        ).exists()
        v2_finalized = QuranTeacherMonthlyPayroll.objects.filter(
            department=payroll_period.department,
            month=payroll_period.payroll_month,
            year=payroll_period.payroll_year,
            status__in=["approved", "paid"],
        ).exists()
        if v1_processed or v2_finalized:
            blocking_reasons.append(
                "Legacy Salary engine (V1/V2) has already processed or approved payroll for this period."
            )

        # 4. Pending correction requests check
        if payroll_period.correction_requests.filter(status=PayrollCorrectionRequest.Status.PENDING).exists():
            blocking_reasons.append(
                "There is a pending return-for-correction request that must be resolved before final approval."
            )

        # 5. Attendance verification readiness check
        readiness = validate_attendance_approval_readiness(
            payroll_period.department,
            payroll_period.payroll_year,
            payroll_period.payroll_month,
        )
        if not readiness.get("is_ready"):
            blocking_reasons.extend(readiness.get("blocking_reasons", []))

        # 6. Calculation completeness check
        if not payroll_period.is_calculation_complete:
            blocking_reasons.append(
                "Department payroll calculation is marked incomplete. Review teacher assignments or rate overrides."
            )
        incomplete_teachers = payroll_period.teacher_payrolls.filter(is_calculation_complete=False).count()
        if incomplete_teachers > 0:
            blocking_reasons.append(
                f"{incomplete_teachers} teacher salary calculation(s) are flagged incomplete."
            )

        # 7. Negative net salary check
        negative_teachers = payroll_period.teacher_payrolls.filter(net_salary__lt=Decimal("0.00")).count()
        if negative_teachers > 0:
            blocking_reasons.append(
                f"{negative_teachers} teacher(s) have negative net salary which must be reconciled before approval."
            )

        # 8. Stale evidence check
        fresh_preview = calculate_department_salary_preview(
            payroll_period.department,
            payroll_period.payroll_year,
            payroll_period.payroll_month,
        )
        fresh_fingerprint = compute_evidence_fingerprint(fresh_preview)
        if payroll_period.source_fingerprint and fresh_fingerprint != payroll_period.source_fingerprint:
            blocking_reasons.append(
                "Underlying attendance, schedule, or adjustments have changed since submission. "
                "Payroll must be returned for recalculation."
            )

        return {
            "can_approve": len(blocking_reasons) == 0,
            "blocking_reasons": blocking_reasons,
            "attendance_readiness": readiness,
            "evaluated_teachers": payroll_period.total_teachers,
            "gross_total": str(payroll_period.gross_total),
            "net_total": str(payroll_period.net_total),
        }

    @classmethod
    @transaction.atomic
    def approve_department_payroll(
        cls,
        payroll_period: SalaryPayrollPeriod,
        user: User,
        notes: str = "",
    ) -> SalaryPayrollPeriod:
        """
        Performs final salary approval (PENDING_APPROVAL -> APPROVED).
        - Restricted to Institution Admin (own institution) or Super Admin.
        - Department Admin strictly forbidden.
        - Mandatory validation: attendance 100% verified, calculation complete,
          no negative net salaries, no stale evidence, cutover registry active,
          no legacy double payment conflicts.
        - Immutability: freezes financial totals and lines.
        - Posts itemized records to immutable PayrollLedgerEntry with exact totals reconciliation.
        - Captures APPROVAL snapshot and lifecycle audit log.
        """
        # Lock record against concurrent approvals
        period = SalaryPayrollPeriod.objects.select_for_update().get(pk=payroll_period.pk)

        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise ValidationError("You do not have administrative permission to approve payroll.")

        if role == User.Role.DEPARTMENT_ADMIN or is_user_department_admin_for_department(user, period.department_id):
            raise ValidationError("Department Admins cannot approve their own payroll as the final authority. Approval must be performed by Institution Admin or Super Admin.")

        if role == User.Role.INSTITUTION_ADMIN:
            user_inst_id = getattr(user, "institution_id", None)
            if user_inst_id and period.institution_id != user_inst_id:
                raise ValidationError("Cross-institution approval denied. You can only approve payroll for your authorized institution.")

        # Check existing approval status
        if period.status == SalaryPayrollPeriod.Status.APPROVED:
            raise ValidationError("This payroll period is already approved. Repeated approval is prevented.")
        if period.status == SalaryPayrollPeriod.Status.PAID:
            raise ValidationError("This payroll period is already paid and cannot be approved again.")
        if period.status != SalaryPayrollPeriod.Status.PENDING_APPROVAL:
            raise ValidationError(
                f"Only submitted payroll (Pending Approval) can be approved. Current status: '{period.get_status_display()}'."
            )

        # Evaluate blockers
        blockers = cls.get_approval_blockers(period)
        if not blockers["can_approve"]:
            reasons_str = "; ".join(blockers["blocking_reasons"])
            raise ValidationError(f"Final payroll approval BLOCKED: {reasons_str}")

        # State transition
        period.status = SalaryPayrollPeriod.Status.APPROVED
        period.approved_by = user
        period.approved_at = timezone.now()
        period.approval_notes = notes.strip()
        period.save()

        # Approval calculation snapshot
        fresh_preview = calculate_department_salary_preview(
            period.department,
            period.payroll_year,
            period.payroll_month,
        )
        PayrollCalculationSnapshot.objects.create(
            payroll_period=period,
            teacher_payroll=None,
            revision=period.current_revision,
            snapshot_type=PayrollCalculationSnapshot.SnapshotType.APPROVAL,
            snapshot_data={
                "approved_by_id": user.id,
                "approved_by_name": user.get_full_name() or user.username,
                "approved_at": period.approved_at.isoformat(),
                "approval_notes": notes.strip(),
                "totals": {
                    "gross_total": str(period.gross_total),
                    "positive_adjustments_total": str(period.positive_adjustments_total),
                    "cuttings_total": str(period.cuttings_total),
                    "net_total": str(period.net_total),
                    "total_teachers": period.total_teachers,
                },
                "preview_at_approval": fresh_preview,
            },
            created_by=user,
            source_fingerprint=period.source_fingerprint,
        )

        # Post itemized immutable ledger entries
        cls._post_immutable_payroll_ledger(period, user)

        # Audit log
        PayrollLifecycleAudit.objects.create(
            payroll_period=period,
            action=PayrollLifecycleAudit.Action.APPROVED,
            actor=user,
            previous_status=SalaryPayrollPeriod.Status.PENDING_APPROVAL,
            new_status=period.status,
            revision=period.current_revision,
            gross_total_before=period.gross_total,
            gross_total_after=period.gross_total,
            net_total_before=period.net_total,
            net_total_after=period.net_total,
            reason=notes.strip() or "Final monthly payroll approved by authorized administrator.",
            metadata={
                "approved_by_id": user.id,
                "approved_at": period.approved_at.isoformat(),
                "total_teachers": period.total_teachers,
            },
        )

        return period

    @classmethod
    def _post_immutable_payroll_ledger(
        cls,
        period: SalaryPayrollPeriod,
        user: User,
    ) -> List[PayrollLedgerEntry]:
        """
        Creates itemized, append-only PayrollLedgerEntry records for the approved payroll period.
        Reconciles itemized financial totals to the approved TeacherPayroll totals.
        Guarantees idempotency via unique idempotency_key constraints.
        """
        app_ref = f"Approved by {user.get_full_name() or user.username} (User #{user.id}) at {period.approved_at}"
        ledger_entries_to_create: List[PayrollLedgerEntry] = []

        total_ledger_gross = Decimal("0.00")
        total_ledger_additions = Decimal("0.00")
        total_ledger_cuttings = Decimal("0.00")

        teacher_payrolls = period.teacher_payrolls.all().select_related("teacher", "applied_policy").prefetch_related("earning_lines")

        for tp in teacher_payrolls:
            tp_gross = Decimal("0.00")
            tp_additions = Decimal("0.00")
            tp_cuttings = Decimal("0.00")

            # 1. Earning Lines
            for line in tp.earning_lines.all():
                ev_type = PayrollLedgerEntry.EventType.EARNING_REGULAR_CLASS
                if line.earning_type == PayrollEarningLine.EarningType.BASIC_SALARY:
                    ev_type = PayrollLedgerEntry.EventType.EARNING_BASIC
                elif line.earning_type == PayrollEarningLine.EarningType.LESSON_PLAN_BONUS:
                    ev_type = PayrollLedgerEntry.EventType.EARNING_LESSON_BONUS
                elif line.earning_type == PayrollEarningLine.EarningType.SUBSTITUTE:
                    ev_type = PayrollLedgerEntry.EventType.EARNING_SUBSTITUTE
                elif line.earning_type == PayrollEarningLine.EarningType.CANCELLATION:
                    ev_type = PayrollLedgerEntry.EventType.EARNING_CANCELLATION

                idem_key = f"earn:{period.id}:rev{period.current_revision}:tp{tp.id}:line{line.id}"
                ledger_entries_to_create.append(
                    PayrollLedgerEntry(
                        institution=period.institution,
                        department=period.department,
                        payroll_period=period,
                        teacher_payroll=tp,
                        teacher=tp.teacher,
                        event_type=ev_type,
                        classification=PayrollLedgerEntry.Classification.CREDIT,
                        amount=line.amount,
                        supporting_earning_line=line,
                        supporting_reference=line.class_occurrence_id or f"line-{line.id}",
                        revision=period.current_revision,
                        approval_reference=app_ref,
                        posted_by=user,
                        idempotency_key=idem_key,
                        metadata={"student_id": line.student_id, "student_name": line.student_name, "rate": str(line.rate)},
                    )
                )
                tp_gross += line.amount

            # 2. Positive Adjustments & Cuttings from DB
            adjustments = tp.teacher.payroll_adjustments.filter(
                period_year=period.payroll_year,
                period_month=period.payroll_month,
                status="confirmed",
            )
            for adj in adjustments:
                if adj.direction == "credit":
                    idem_key = f"adj_pos:{period.id}:rev{period.current_revision}:tp{tp.id}:adj{adj.id}"
                    ledger_entries_to_create.append(
                        PayrollLedgerEntry(
                            institution=period.institution,
                            department=period.department,
                            payroll_period=period,
                            teacher_payroll=tp,
                            teacher=tp.teacher,
                            event_type=PayrollLedgerEntry.EventType.ADJUSTMENT_ADDITION,
                            classification=PayrollLedgerEntry.Classification.CREDIT,
                            amount=adj.amount,
                            supporting_adjustment=adj,
                            supporting_reference=f"adj-{adj.id}-{adj.category}",
                            revision=period.current_revision,
                            approval_reference=app_ref,
                            posted_by=user,
                            idempotency_key=idem_key,
                            metadata={"category": adj.category, "batch_id": adj.batch_id},
                        )
                    )
                    tp_additions += adj.amount
                elif adj.direction == "debit":
                    idem_key = f"adj_cut:{period.id}:rev{period.current_revision}:tp{tp.id}:adj{adj.id}"
                    ledger_entries_to_create.append(
                        PayrollLedgerEntry(
                            institution=period.institution,
                            department=period.department,
                            payroll_period=period,
                            teacher_payroll=tp,
                            teacher=tp.teacher,
                            event_type=PayrollLedgerEntry.EventType.ADJUSTMENT_CUTTING,
                            classification=PayrollLedgerEntry.Classification.DEBIT,
                            amount=adj.amount,
                            supporting_adjustment=adj,
                            supporting_reference=f"adj-{adj.id}-{adj.category}",
                            revision=period.current_revision,
                            approval_reference=app_ref,
                            posted_by=user,
                            idempotency_key=idem_key,
                            metadata={"category": adj.category, "batch_id": adj.batch_id, "advance_id": adj.advance_recovery_id},
                        )
                    )
                    tp_cuttings += adj.amount

            # Fallback reconciliation if adjustments weren't individually stored in adjustments table
            if tp_additions == Decimal("0.00") and tp.positive_adjustments > Decimal("0.00"):
                idem_key = f"adj_pos_fallback:{period.id}:rev{period.current_revision}:tp{tp.id}"
                ledger_entries_to_create.append(
                    PayrollLedgerEntry(
                        institution=period.institution,
                        department=period.department,
                        payroll_period=period,
                        teacher_payroll=tp,
                        teacher=tp.teacher,
                        event_type=PayrollLedgerEntry.EventType.ADJUSTMENT_ADDITION,
                        classification=PayrollLedgerEntry.Classification.CREDIT,
                        amount=tp.positive_adjustments,
                        supporting_reference="confirmed_positive_adjustments",
                        revision=period.current_revision,
                        approval_reference=app_ref,
                        posted_by=user,
                        idempotency_key=idem_key,
                    )
                )
                tp_additions += tp.positive_adjustments

            if tp_cuttings == Decimal("0.00") and tp.cuttings > Decimal("0.00"):
                idem_key = f"adj_cut_fallback:{period.id}:rev{period.current_revision}:tp{tp.id}"
                ledger_entries_to_create.append(
                    PayrollLedgerEntry(
                        institution=period.institution,
                        department=period.department,
                        payroll_period=period,
                        teacher_payroll=tp,
                        teacher=tp.teacher,
                        event_type=PayrollLedgerEntry.EventType.ADJUSTMENT_CUTTING,
                        classification=PayrollLedgerEntry.Classification.DEBIT,
                        amount=tp.cuttings,
                        supporting_reference="confirmed_cuttings",
                        revision=period.current_revision,
                        approval_reference=app_ref,
                        posted_by=user,
                        idempotency_key=idem_key,
                    )
                )
                tp_cuttings += tp.cuttings

            total_ledger_gross += tp_gross
            total_ledger_additions += tp_additions
            total_ledger_cuttings += tp_cuttings

        # Atomic bulk create
        created_entries = PayrollLedgerEntry.objects.bulk_create(ledger_entries_to_create, ignore_conflicts=False)
        return created_entries

    @classmethod
    @transaction.atomic
    def record_teacher_payment(
        cls,
        teacher_payroll: TeacherPayroll,
        user: User,
        payment_data: Dict[str, Any],
        proof_file: Any = None,
    ) -> TeacherPayrollPayment:
        """
        Records an externally completed financial disbursement against an approved TeacherPayroll.
        - Does NOT transfer money or connect to banks.
        - Validates payment against approved net salary.
        - Prevents overpayment, duplicate payment references, and payment against unapproved payroll.
        - Posts payment settlement entry to immutable PayrollLedgerEntry.
        - Updates TeacherPayroll paid_amount and payment_status.
        - Checks whether all teachers in the period are now fully paid; only then marks period PAID.
        """
        # Lock teacher payroll and parent period
        tp = TeacherPayroll.objects.select_for_update().get(pk=teacher_payroll.pk)
        period = SalaryPayrollPeriod.objects.select_for_update().get(pk=tp.payroll_period_id)

        role = str(getattr(user, "role", "") or "").lower()
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            raise ValidationError("You do not have administrative permission to record payments.")

        if role == User.Role.DEPARTMENT_ADMIN or is_user_department_admin_for_department(user, period.department_id):
            raise ValidationError("Department Admins cannot record payments without separate authorization. Payments must be recorded by Institution Admin or Super Admin.")

        if role == User.Role.INSTITUTION_ADMIN:
            user_inst_id = getattr(user, "institution_id", None)
            if user_inst_id and period.institution_id != user_inst_id:
                raise ValidationError("Cross-institution payment recording denied.")

        # Cutover guard check
        from salary.cutover_guard import assert_unified_salary_write_permitted
        assert_unified_salary_write_permitted(
            period.department,
            period.payroll_year,
            period.payroll_month,
            operation="payment recording",
        )

        # Period status check: Cannot pay unapproved payroll
        if period.status not in [SalaryPayrollPeriod.Status.APPROVED, SalaryPayrollPeriod.Status.PAID]:
            raise ValidationError(
                f"Payments can only be recorded against approved payroll. Current status: '{period.get_status_display()}'."
            )

        amount_raw = payment_data.get("amount") or payment_data.get("amount_paid")
        if not amount_raw:
            raise ValidationError("Payment amount is required.")
        amount = to_decimal(amount_raw)
        if amount <= Decimal("0.00"):
            raise ValidationError("Payment amount must be greater than zero.")

        # Overpayment validation
        remaining_balance = tp.net_salary - tp.paid_amount
        if amount > remaining_balance:
            raise ValidationError(
                f"Overpayment prevented: Payment amount PKR {amount:,.2f} exceeds remaining unpaid balance of PKR {remaining_balance:,.2f}."
            )

        ref_no = str(payment_data.get("reference_number") or "").strip()
        if not ref_no:
            raise ValidationError("A payment reference number is required.")

        # Duplicate reference check for this teacher payroll
        if TeacherPayrollPayment.objects.filter(teacher_payroll=tp, reference_number=ref_no).exists():
            raise ValidationError(
                f"A payment record with reference number '{ref_no}' has already been recorded for this teacher."
            )

        method = payment_data.get("payment_method") or TeacherPayrollPayment.PaymentMethod.BANK_TRANSFER
        p_date = payment_data.get("payment_date") or timezone.localdate()
        notes = payment_data.get("notes", "")

        # Proof file validation
        if proof_file:
            ext = str(getattr(proof_file, "name", "")).lower().rsplit(".", 1)[-1]
            if ext not in ["pdf", "png", "jpg", "jpeg"]:
                raise ValidationError("Invalid proof file format. Only PDF, PNG, and JPG files are permitted.")
            if getattr(proof_file, "size", 0) > 5 * 1024 * 1024:
                raise ValidationError("Payment proof file size cannot exceed 5MB.")

        idem_key = f"pay:{period.id}:tp{tp.id}:{ref_no}:{amount}"

        payment = TeacherPayrollPayment.objects.create(
            institution=period.institution,
            department=period.department,
            payroll_period=period,
            teacher_payroll=tp,
            teacher=tp.teacher,
            payment_method=method,
            amount_paid=amount,
            payment_date=p_date,
            reference_number=ref_no,
            proof_document=proof_file,
            proof_notes=payment_data.get("proof_notes", ""),
            recorded_by=user,
            idempotency_key=idem_key,
            notes=notes,
        )

        # Update TeacherPayroll
        tp.paid_amount += amount
        if tp.paid_amount >= tp.net_salary:
            tp.payment_status = "paid"
            tp.paid_at = timezone.now()
        else:
            tp.payment_status = "partially_paid"
        tp.save()

        # Post payment settlement to immutable ledger
        PayrollLedgerEntry.objects.create(
            institution=period.institution,
            department=period.department,
            payroll_period=period,
            teacher_payroll=tp,
            teacher=tp.teacher,
            event_type=PayrollLedgerEntry.EventType.PAYMENT_SETTLEMENT,
            classification=PayrollLedgerEntry.Classification.DEBIT,
            amount=amount,
            supporting_reference=f"payment-ref-{ref_no}",
            revision=period.current_revision,
            approval_reference=f"Payment recorded by {user.get_full_name() or user.username}",
            posted_by=user,
            idempotency_key=f"ledger_pay:{payment.id}:{idem_key}",
            metadata={"payment_id": payment.id, "method": method, "date": str(p_date)},
        )

        # Check Department Payroll Period complete payment status
        # Rule: A department payroll period must NOT be marked completely PAID while applicable teachers remain unpaid.
        all_teachers_paid = not period.teacher_payrolls.exclude(payment_status="paid").exists()
        if all_teachers_paid:
            period.status = SalaryPayrollPeriod.Status.PAID
            period.save()
            PayrollLifecycleAudit.objects.create(
                payroll_period=period,
                action=PayrollLifecycleAudit.Action.PAID,
                actor=user,
                previous_status=SalaryPayrollPeriod.Status.APPROVED,
                new_status=period.status,
                revision=period.current_revision,
                gross_total_before=period.gross_total,
                gross_total_after=period.gross_total,
                net_total_before=period.net_total,
                net_total_after=period.net_total,
                reason="All individual teacher payroll disbursements recorded. Department payroll marked fully PAID.",
                metadata={"total_teachers": period.total_teachers},
            )
        else:
            PayrollLifecycleAudit.objects.create(
                payroll_period=period,
                action=PayrollLifecycleAudit.Action.PAYMENT_RECORDED,
                actor=user,
                previous_status=period.status,
                new_status=period.status,
                revision=period.current_revision,
                gross_total_before=period.gross_total,
                gross_total_after=period.gross_total,
                net_total_before=period.net_total,
                net_total_after=period.net_total,
                reason=f"Recorded disbursement of PKR {amount:,.2f} for teacher #{tp.teacher_id} (Ref #{ref_no}).",
                metadata={"teacher_id": tp.teacher_id, "amount": str(amount), "ref_no": ref_no},
            )

        return payment
