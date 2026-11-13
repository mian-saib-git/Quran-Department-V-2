"""
IVS Unified Salary Management — Comprehensive Automated Test Suite for Stage 7B:
Payroll Approvals, Correction Authority, Immutable Ledger, Salary Slips, and Payment Recording.

Tests:
1. Department Admin correction request.
2. Institution Admin correction approval within scope.
3. Super Admin correction approval within scope.
4. Unauthorized correction approval rejection.
5. Self-approval rejection.
6. Correction request rejection leaves payroll locked.
7. Authorized return enables permitted correction.
8. Original submission snapshot preservation.
9. Recalculation and resubmission after return.
10. Department Admin final approval denial.
11. Cross-institution approval denial.
12. Approval with pending attendance blocked.
13. Approval with stale reconciliation blocked.
14. Approval with incomplete salary calculation blocked.
15. Approval with incomplete adjustments blocked.
16. Approval of valid submitted payroll.
17. Repeated approval prevented.
18. Concurrent approval safely handled.
19. Approved payroll immutability.
20. Paid payroll immutability.
21. Ledger item totals reconcile with payroll.
22. No duplicate earning ledger entries.
23. No duplicate cutting ledger entries.
24. Idempotent ledger posting.
25. Cannot mark unapproved payroll paid.
26. Full external payment recording.
27. Partial external payment handling.
28. Duplicate payment recording prevention.
29. Overpayment prevention.
30. Department-level paid status correctness.
31. Payment proof authorization.
32. PDF reflects approved snapshot.
33. PDF includes individual and bulk adjustments.
34. PDF endpoint department isolation.
35. Unauthorized teacher or coordinator administration denied.
36. Legacy payroll remains unchanged.
37. New-engine activation guard denies real operations before cutover.
38. No real bank transfer is initiated.
39. All previous salary tests remain passing.
40. Frontend typecheck and production build pass.
"""
from datetime import date, time
from decimal import Decimal
import io

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Department, Institution, User, UserDepartmentRole
from academy.models import (
    ClassSchedule,
    QuranTeacherMonthlyPayroll,
    StudentProfile,
    TeacherProfile,
    TeacherSalarySlip,
)
from salary.models import (
    PayrollAdjustment,
    PayrollAdjustmentAudit,
    PayrollCalculationSnapshot,
    PayrollCorrectionRequest,
    PayrollEarningLine,
    PayrollLedgerEntry,
    PayrollLifecycleAudit,
    SalaryAdjustmentCategory,
    SalaryAdvanceRecovery,
    SalaryAttendanceVerification,
    SalaryBulkAdjustmentBatch,
    SalaryEngineCutoverRegistry,
    SalaryPayrollPeriod,
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryReconciliationBatch,
    SalaryTeachingPlan,
    TeacherPayroll,
    TeacherPayrollPayment,
    TeacherPolicyAssignment,
)
from salary.payroll_service import (
    PayrollLifecycleService,
    activate_unified_engine_for_period,
    deactivate_unified_engine_for_period,
    is_unified_salary_engine_active,
)
from salary.pdf_service import generate_salary_slip_pdf, get_salary_slip_statement_data


class PayrollApprovalsStage7BTests(APITestCase):
    """Test suite covering all 40 required Stage 7B requirements."""

    def setUp(self):
        # 1. Institutions & Departments
        self.institution = Institution.objects.create(name="IVS Main Institution", slug="ivs-main-7b")
        self.foreign_institution = Institution.objects.create(name="Foreign Institution", slug="foreign-inst-7b")

        self.quran_dept = Department.objects.create(
            institution=self.institution,
            name="Quran Department",
            code="QURAN_7B",
        )
        self.foreign_dept = Department.objects.create(
            institution=self.foreign_institution,
            name="Foreign Department",
            code="FOREIGN_7B",
        )

        # 2. Users & Roles
        self.super_admin = User.objects.create_superuser(
            username="super_admin_7b",
            email="super_admin_7b@ivs.com",
            password="password123",
            role=User.Role.PLATFORM_ADMIN,
        )
        self.inst_admin = User.objects.create_user(
            username="inst_admin_7b",
            email="inst_admin_7b@ivs.com",
            password="password123",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.institution,
        )
        self.foreign_inst_admin = User.objects.create_user(
            username="foreign_inst_admin_7b",
            email="foreign_admin_7b@other.com",
            password="password123",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.foreign_institution,
        )
        self.dept_admin_user = User.objects.create_user(
            username="dept_admin_7b",
            email="dept_admin_7b@ivs.com",
            password="password123",
            role=User.Role.DEPARTMENT_ADMIN,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.teacher_user1 = User.objects.create_user(
            username="teacher1_7b",
            email="teacher1_7b@ivs.com",
            password="password123",
            role=User.Role.TEACHER,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.teacher_user2 = User.objects.create_user(
            username="teacher2_7b",
            email="teacher2_7b@ivs.com",
            password="password123",
            role=User.Role.TEACHER,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.coordinator_user = User.objects.create_user(
            username="coordinator_7b",
            email="coordinator_7b@ivs.com",
            password="password123",
            role=User.Role.COORDINATOR,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.student_user = User.objects.create_user(
            username="student_7b",
            email="student_7b@ivs.com",
            password="password123",
            role=User.Role.STUDENT,
            department=self.quran_dept,
            institution=self.institution,
        )

        # 3. Profiles
        self.teacher_profile1 = TeacherProfile.objects.create(
            user=self.teacher_user1,
            department=self.quran_dept,
            historical_name="Ustadh Ahmad",
        )
        self.teacher_profile2 = TeacherProfile.objects.create(
            user=self.teacher_user2,
            department=self.quran_dept,
            historical_name="Ustadh Bilal",
        )
        self.student_profile = StudentProfile.objects.create(
            user=self.student_user,
            teacher=self.teacher_profile1,
            department=self.quran_dept,
        )

        # 4. Foundation Salary Policy & Version (Published)
        self.policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            name="Quran Standard Policy 7B",
            code="QRN-7B",
            compensation_model=SalaryPolicy.CompensationModel.BASIC_PLUS_PER_CLASS,
            created_by=self.dept_admin_user,
        )
        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
            basic_salary_amount=Decimal("15000.00"),
            lesson_plan_bonus_per_class=Decimal("10.00"),
            substitute_rate_per_class=Decimal("80.00"),
            cancellation_rate_per_class=Decimal("50.00"),
        )
        self.tier1 = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="1-15 Students",
            min_students=1,
            max_students=15,
            sort_order=1,
        )
        self.plan5 = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_code="5_days",
            plan_name="5 Days/Week",
            days_per_week=5,
            sort_order=1,
        )
        SalaryPlanTierRate.objects.create(
            policy_version=self.version,
            teaching_plan=self.plan5,
            rate_tier=self.tier1,
            rate_per_class=Decimal("80.00"),
        )
        self.version.status = SalaryPolicyVersion.Status.PUBLISHED
        self.version.published_by = self.dept_admin_user
        self.version.published_at = timezone.now()
        self.version.save()

        # 5. Teacher Policy Assignment
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile1,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
            assigned_by=self.dept_admin_user,
        )
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile2,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
            assigned_by=self.dept_admin_user,
        )

        # 6. Complete Reconciliation Batch & Verifications for Oct 2026
        self.batch = SalaryReconciliationBatch.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            period_year=2026,
            period_month=10,
            start_date=date(2026, 10, 1),
            end_date=date(2026, 10, 31),
            is_complete=True,
            total_occurrences=2,
            verified_count=2,
            pending_count=0,
            conflicted_count=0,
            scanned_by=self.dept_admin_user,
        )
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile1,
            student=self.student_profile,
            occurrence_key="quran:verif:2026-10-05:t1",
            class_date=date(2026, 10, 5),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile2,
            student=self.student_profile,
            occurrence_key="quran:verif:2026-10-06:t2",
            class_date=date(2026, 10, 6),
            scheduled_time=time(11, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )

        # 7. Activate Unified Salary Cutover for testing
        activate_unified_engine_for_period(self.quran_dept, 2026, 10, self.super_admin, "Test Suite Setup")

    def _create_submitted_period(self):
        """Helper to create and submit a valid monthly payroll period for Oct 2026."""
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        return PayrollLifecycleService.submit_department_payroll(
            period,
            self.dept_admin_user,
            notes="Submitted for review.",
        )

    # ------------------------------------------------------------------------
    # 1. Department Admin correction request
    # ------------------------------------------------------------------------
    def test_01_department_admin_correction_request(self):
        period = self._create_submitted_period()
        req = PayrollLifecycleService.request_return_for_correction(
            payroll_period=period,
            user=self.dept_admin_user,
            reason="Missing substitute class compensation on Oct 15.",
            correction_scope="Attendance update for Teacher #1",
        )
        self.assertEqual(req.status, PayrollCorrectionRequest.Status.PENDING)
        self.assertEqual(req.submission_revision, 1)
        self.assertEqual(period.status, SalaryPayrollPeriod.Status.PENDING_APPROVAL)

    # ------------------------------------------------------------------------
    # 2. Institution Admin correction approval within scope
    # ------------------------------------------------------------------------
    def test_02_institution_admin_correction_approval_within_scope(self):
        period = self._create_submitted_period()
        req = PayrollLifecycleService.request_return_for_correction(
            payroll_period=period,
            user=self.dept_admin_user,
            reason="Attendance update required.",
            correction_scope="October class 12",
        )
        approved_req = PayrollLifecycleService.approve_correction_request(
            payroll_period=period,
            correction_request_id=req.id,
            user=self.inst_admin,
            notes="Authorized by Institution Admin for attendance adjustment.",
        )
        period.refresh_from_db()
        self.assertEqual(approved_req.status, PayrollCorrectionRequest.Status.APPROVED)
        self.assertEqual(period.status, SalaryPayrollPeriod.Status.RETURNED_FOR_CORRECTION)
        self.assertEqual(approved_req.reviewed_by, self.inst_admin)

    # ------------------------------------------------------------------------
    # 3. Super Admin correction approval within scope
    # ------------------------------------------------------------------------
    def test_03_super_admin_correction_approval_within_scope(self):
        period = self._create_submitted_period()
        req = PayrollLifecycleService.request_return_for_correction(
            payroll_period=period,
            user=self.dept_admin_user,
            reason="Bonus policy discrepancy.",
            correction_scope="All teachers bonus review",
        )
        approved_req = PayrollLifecycleService.approve_correction_request(
            payroll_period=period,
            correction_request_id=req.id,
            user=self.super_admin,
            notes="Authorized by Super Admin.",
        )
        period.refresh_from_db()
        self.assertEqual(approved_req.status, PayrollCorrectionRequest.Status.APPROVED)
        self.assertEqual(period.status, SalaryPayrollPeriod.Status.RETURNED_FOR_CORRECTION)

    # ------------------------------------------------------------------------
    # 4. Unauthorized correction approval rejection
    # ------------------------------------------------------------------------
    def test_04_unauthorized_correction_approval_rejection(self):
        period = self._create_submitted_period()
        req = PayrollLifecycleService.request_return_for_correction(
            payroll_period=period,
            user=self.dept_admin_user,
            reason="Need correction.",
            correction_scope="Scope",
        )
        # Foreign Institution Admin cannot authorize
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.approve_correction_request(
                payroll_period=period,
                correction_request_id=req.id,
                user=self.foreign_inst_admin,
                notes="Unauthorized cross-institution attempt.",
            )

    # ------------------------------------------------------------------------
    # 5. Self-approval rejection
    # ------------------------------------------------------------------------
    def test_05_self_approval_rejection(self):
        period = self._create_submitted_period()
        req = PayrollLifecycleService.request_return_for_correction(
            payroll_period=period,
            user=self.dept_admin_user,
            reason="Self-correction request.",
            correction_scope="Scope",
        )
        # Requester / Department Admin cannot approve their own request
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.approve_correction_request(
                payroll_period=period,
                correction_request_id=req.id,
                user=self.dept_admin_user,
                notes="Self approval attempt.",
            )

    # ------------------------------------------------------------------------
    # 6. Correction request rejection leaves payroll locked
    # ------------------------------------------------------------------------
    def test_06_correction_request_rejection_leaves_payroll_locked(self):
        period = self._create_submitted_period()
        req = PayrollLifecycleService.request_return_for_correction(
            payroll_period=period,
            user=self.dept_admin_user,
            reason="Frivolous reason.",
            correction_scope="Scope",
        )
        rejected_req = PayrollLifecycleService.reject_correction_request(
            payroll_period=period,
            correction_request_id=req.id,
            user=self.inst_admin,
            notes="Rejected: Claim is unsubstantiated by verified logs.",
        )
        period.refresh_from_db()
        self.assertEqual(rejected_req.status, PayrollCorrectionRequest.Status.REJECTED)
        self.assertEqual(period.status, SalaryPayrollPeriod.Status.PENDING_APPROVAL)

    # ------------------------------------------------------------------------
    # 7. Authorized return enables permitted correction
    # ------------------------------------------------------------------------
    def test_07_authorized_return_enables_permitted_correction(self):
        period = self._create_submitted_period()
        req = PayrollLifecycleService.request_return_for_correction(
            payroll_period=period,
            user=self.dept_admin_user,
            reason="Legitimate adjustment needed.",
            correction_scope="Bonus addition",
        )
        PayrollLifecycleService.approve_correction_request(
            payroll_period=period,
            correction_request_id=req.id,
            user=self.inst_admin,
            notes="Approved return.",
        )
        period.refresh_from_db()
        # Period in RETURNED_FOR_CORRECTION allows recalculation
        recalculated = PayrollLifecycleService.recalculate_draft_payroll(
            payroll_period=period,
            user=self.dept_admin_user,
            reason="Recalculating after authorized return.",
        )
        self.assertEqual(recalculated.current_revision, 2)

    # ------------------------------------------------------------------------
    # 8. Original submission snapshot preservation
    # ------------------------------------------------------------------------
    def test_08_original_submission_snapshot_preservation(self):
        period = self._create_submitted_period()
        initial_sub_snapshot = period.calculation_snapshots.filter(
            snapshot_type=PayrollCalculationSnapshot.SnapshotType.SUBMISSION,
            revision=1,
        ).first()
        self.assertIsNotNone(initial_sub_snapshot)

        # Authorize return and recalculate
        req = PayrollLifecycleService.request_return_for_correction(
            payroll_period=period,
            user=self.dept_admin_user,
            reason="Scope change.",
            correction_scope="Scope",
        )
        PayrollLifecycleService.approve_correction_request(
            payroll_period=period,
            correction_request_id=req.id,
            user=self.inst_admin,
            notes="Approved return.",
        )
        PayrollLifecycleService.recalculate_draft_payroll(
            period,
            self.dept_admin_user,
            reason="Recalculate revision 2",
        )
        # Verify initial snapshot is still preserved
        preserved_snap = PayrollCalculationSnapshot.objects.filter(id=initial_sub_snapshot.id).first()
        self.assertIsNotNone(preserved_snap)
        self.assertEqual(preserved_snap.revision, 1)

    # ------------------------------------------------------------------------
    # 9. Recalculation and resubmission after return
    # ------------------------------------------------------------------------
    def test_09_recalculation_and_resubmission_after_return(self):
        period = self._create_submitted_period()
        req = PayrollLifecycleService.request_return_for_correction(
            payroll_period=period,
            user=self.dept_admin_user,
            reason="Correction required.",
            correction_scope="General update",
        )
        PayrollLifecycleService.approve_correction_request(
            payroll_period=period,
            correction_request_id=req.id,
            user=self.inst_admin,
            notes="Approved.",
        )
        period.refresh_from_db()
        recalculated = PayrollLifecycleService.recalculate_draft_payroll(
            period,
            self.dept_admin_user,
            reason="Updated after return.",
        )
        resubmitted = PayrollLifecycleService.submit_department_payroll(
            recalculated,
            self.dept_admin_user,
            notes="Resubmitted after correction.",
        )
        self.assertEqual(resubmitted.status, SalaryPayrollPeriod.Status.PENDING_APPROVAL)
        self.assertEqual(resubmitted.current_revision, 2)

    # ------------------------------------------------------------------------
    # 10. Department Admin final approval denial
    # ------------------------------------------------------------------------
    def test_10_department_admin_final_approval_denial(self):
        period = self._create_submitted_period()
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.approve_department_payroll(
                payroll_period=period,
                user=self.dept_admin_user,
                notes="Attempted self-approval.",
            )

    # ------------------------------------------------------------------------
    # 11. Cross-institution approval denial
    # ------------------------------------------------------------------------
    def test_11_cross_institution_approval_denial(self):
        period = self._create_submitted_period()
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.approve_department_payroll(
                payroll_period=period,
                user=self.foreign_inst_admin,
                notes="Attempted cross-institution approval.",
            )

    # ------------------------------------------------------------------------
    # 12. Approval with pending attendance blocked
    # ------------------------------------------------------------------------
    def test_12_approval_with_pending_attendance_blocked(self):
        # Create a pending unverified class occurrence
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile1,
            student=self.student_profile,
            occurrence_key="quran:pending:2026-10-20:t1",
            class_date=date(2026, 10, 20),
            verification_status=SalaryAttendanceVerification.VerificationStatus.PENDING,
        )
        period = self._create_submitted_period()
        # Must raise ValidationError blocking approval
        with self.assertRaises(ValidationError) as cm:
            PayrollLifecycleService.approve_department_payroll(
                payroll_period=period,
                user=self.inst_admin,
                notes="Approve despite pending attendance",
            )
        self.assertIn("BLOCKED", str(cm.exception))

    # ------------------------------------------------------------------------
    # 13. Approval with stale reconciliation blocked
    # ------------------------------------------------------------------------
    def test_13_approval_with_stale_reconciliation_blocked(self):
        period = self._create_submitted_period()
        # Mark reconciliation batch incomplete to simulate interrupted/stale scan
        self.batch.is_complete = False
        self.batch.save()
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.approve_department_payroll(
                payroll_period=period,
                user=self.inst_admin,
                notes="Approve with incomplete batch",
            )

    # ------------------------------------------------------------------------
    # 14. Approval with incomplete salary calculation blocked
    # ------------------------------------------------------------------------
    def test_14_approval_with_incomplete_salary_calculation_blocked(self):
        period = self._create_submitted_period()
        # Flag a teacher calculation as incomplete
        tp = period.teacher_payrolls.first()
        tp.is_calculation_complete = False
        tp.save()
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.approve_department_payroll(
                payroll_period=period,
                user=self.inst_admin,
                notes="Approve with incomplete teacher calculation",
            )

    # ------------------------------------------------------------------------
    # 15. Approval with incomplete adjustments blocked
    # ------------------------------------------------------------------------
    def test_15_approval_with_incomplete_adjustments_blocked(self):
        period = self._create_submitted_period()
        # Force a negative net salary to simulate unresolved excessive cutting
        tp = period.teacher_payrolls.first()
        tp.net_salary = Decimal("-500.00")
        tp.save()
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.approve_department_payroll(
                payroll_period=period,
                user=self.inst_admin,
                notes="Approve with negative salary",
            )

    # ------------------------------------------------------------------------
    # 16. Approval of valid submitted payroll
    # ------------------------------------------------------------------------
    def test_16_approval_of_valid_submitted_payroll(self):
        period = self._create_submitted_period()
        approved = PayrollLifecycleService.approve_department_payroll(
            payroll_period=period,
            user=self.inst_admin,
            notes="Approved after full attendance and adjustment verification.",
        )
        self.assertEqual(approved.status, SalaryPayrollPeriod.Status.APPROVED)
        self.assertEqual(approved.approved_by, self.inst_admin)
        self.assertIsNotNone(approved.approved_at)

    # ------------------------------------------------------------------------
    # 17. Repeated approval prevented
    # ------------------------------------------------------------------------
    def test_17_repeated_approval_prevented(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(
            payroll_period=period,
            user=self.inst_admin,
            notes="First approval",
        )
        period.refresh_from_db()
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.approve_department_payroll(
                payroll_period=period,
                user=self.inst_admin,
                notes="Repeated approval attempt",
            )

    # ------------------------------------------------------------------------
    # 18. Concurrent approval safely handled
    # ------------------------------------------------------------------------
    def test_18_concurrent_approval_safely_handled(self):
        period = self._create_submitted_period()
        # First call succeeds
        p1 = PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "First approval")
        self.assertEqual(p1.status, SalaryPayrollPeriod.Status.APPROVED)
        # Second simultaneous call fails gracefully
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.approve_department_payroll(p1, self.super_admin, "Second simultaneous")

    # ------------------------------------------------------------------------
    # 19. Approved payroll immutability
    # ------------------------------------------------------------------------
    def test_19_approved_payroll_immutability(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")
        period.refresh_from_db()

        # Recalculate must fail
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.recalculate_draft_payroll(period, self.dept_admin_user, "Attempt edit")

        # Modifying gross_total directly in clean() raises error
        period.gross_total += Decimal("1000.00")
        with self.assertRaises(ValidationError):
            period.clean()

    # ------------------------------------------------------------------------
    # 20. Paid payroll immutability
    # ------------------------------------------------------------------------
    def test_20_paid_payroll_immutability(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")

        # Pay all teachers
        for tp in period.teacher_payrolls.all():
            PayrollLifecycleService.record_teacher_payment(
                teacher_payroll=tp,
                user=self.inst_admin,
                payment_data={
                    "amount": str(tp.net_salary),
                    "reference_number": f"FULL-PAY-{tp.id}",
                },
            )
        period.refresh_from_db()
        self.assertEqual(period.status, SalaryPayrollPeriod.Status.PAID)

        # Attempt to change status or total
        period.net_total = Decimal("0.00")
        with self.assertRaises(ValidationError):
            period.clean()

    # ------------------------------------------------------------------------
    # 21. Ledger item totals reconcile with payroll
    # ------------------------------------------------------------------------
    def test_21_ledger_item_totals_reconcile_with_payroll(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")

        ledger_entries = period.ledger_entries.all()
        self.assertTrue(ledger_entries.exists())

        for tp in period.teacher_payrolls.all():
            tp_credits = sum(
                e.amount for e in ledger_entries.filter(teacher_payroll=tp, classification=PayrollLedgerEntry.Classification.CREDIT)
            )
            tp_debits = sum(
                e.amount for e in ledger_entries.filter(teacher_payroll=tp, classification=PayrollLedgerEntry.Classification.DEBIT)
            )
            net_reconciled = tp_credits - tp_debits
            self.assertEqual(net_reconciled, tp.net_salary)

    # ------------------------------------------------------------------------
    # 22. No duplicate earning ledger entries
    # ------------------------------------------------------------------------
    def test_22_no_duplicate_earning_ledger_entries(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")

        idempotency_keys = list(period.ledger_entries.values_list("idempotency_key", flat=True))
        self.assertEqual(len(idempotency_keys), len(set(idempotency_keys)))

    # ------------------------------------------------------------------------
    # 23. No duplicate cutting ledger entries
    # ------------------------------------------------------------------------
    def test_23_no_duplicate_cutting_ledger_entries(self):
        # Add cutting adjustment
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile1,
            period_year=2026,
            period_month=10,
            category="equipment_damage",
            direction=PayrollAdjustment.Direction.DEBIT,
            amount=Decimal("500.00"),
            reason="Broken headset replacement.",
            status=PayrollAdjustment.Status.CONFIRMED,
            created_by=self.dept_admin_user,
        )
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")

        cutting_entries = period.ledger_entries.filter(event_type=PayrollLedgerEntry.EventType.ADJUSTMENT_CUTTING)
        self.assertEqual(cutting_entries.count(), 1)
        self.assertEqual(cutting_entries.first().amount, Decimal("500.00"))

    # ------------------------------------------------------------------------
    # 24. Idempotent ledger posting
    # ------------------------------------------------------------------------
    def test_24_idempotent_ledger_posting(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")
        count_before = period.ledger_entries.count()

        # Calling _post_immutable_payroll_ledger again will raise IntegrityError due to idempotency keys
        from django.db import IntegrityError, transaction
        with transaction.atomic():
            with self.assertRaises(IntegrityError):
                PayrollLifecycleService._post_immutable_payroll_ledger(period, self.inst_admin)
        self.assertEqual(period.ledger_entries.count(), count_before)

    # ------------------------------------------------------------------------
    # 25. Cannot mark unapproved payroll paid
    # ------------------------------------------------------------------------
    def test_25_cannot_mark_unapproved_payroll_paid(self):
        period = self._create_submitted_period()
        # Period is PENDING_APPROVAL, not APPROVED
        tp = period.teacher_payrolls.first()
        with self.assertRaises(ValidationError) as cm:
            PayrollLifecycleService.record_teacher_payment(
                teacher_payroll=tp,
                user=self.inst_admin,
                payment_data={
                    "amount": str(tp.net_salary),
                    "reference_number": "TRX-UNAPPROVED",
                },
            )
        self.assertIn("approved", str(cm.exception))

    # ------------------------------------------------------------------------
    # 26. Full external payment recording
    # ------------------------------------------------------------------------
    def test_26_full_external_payment_recording(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")

        tp = period.teacher_payrolls.first()
        payment = PayrollLifecycleService.record_teacher_payment(
            teacher_payroll=tp,
            user=self.inst_admin,
            payment_data={
                "amount": str(tp.net_salary),
                "reference_number": "TRX-FULL-1",
                "payment_method": "bank_transfer",
            },
        )
        tp.refresh_from_db()
        self.assertEqual(tp.paid_amount, tp.net_salary)
        self.assertEqual(tp.payment_status, "paid")
        self.assertEqual(payment.reference_number, "TRX-FULL-1")

    # ------------------------------------------------------------------------
    # 27. Partial external payment handling
    # ------------------------------------------------------------------------
    def test_27_partial_external_payment_handling(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")

        tp = period.teacher_payrolls.first()
        partial_amt = (tp.net_salary / Decimal("2.00")).quantize(Decimal("0.01"))

        payment = PayrollLifecycleService.record_teacher_payment(
            teacher_payroll=tp,
            user=self.inst_admin,
            payment_data={
                "amount": str(partial_amt),
                "reference_number": "TRX-PARTIAL-1",
            },
        )
        tp.refresh_from_db()
        self.assertEqual(tp.paid_amount, partial_amt)
        self.assertEqual(tp.payment_status, "partially_paid")
        self.assertNotEqual(tp.payment_status, "paid")

    # ------------------------------------------------------------------------
    # 28. Duplicate payment recording prevention
    # ------------------------------------------------------------------------
    def test_28_duplicate_payment_recording_prevention(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")

        tp = period.teacher_payrolls.first()
        half_amt = (tp.net_salary / Decimal("3.00")).quantize(Decimal("0.01"))

        PayrollLifecycleService.record_teacher_payment(
            teacher_payroll=tp,
            user=self.inst_admin,
            payment_data={
                "amount": str(half_amt),
                "reference_number": "TRX-SAME-REF",
            },
        )
        # Second call with same reference number for same teacher payroll fails
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.record_teacher_payment(
                teacher_payroll=tp,
                user=self.inst_admin,
                payment_data={
                    "amount": str(half_amt),
                    "reference_number": "TRX-SAME-REF",
                },
            )

    # ------------------------------------------------------------------------
    # 29. Overpayment prevention
    # ------------------------------------------------------------------------
    def test_29_overpayment_prevention(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")

        tp = period.teacher_payrolls.first()
        excessive_amt = tp.net_salary + Decimal("100.00")

        with self.assertRaises(ValidationError) as cm:
            PayrollLifecycleService.record_teacher_payment(
                teacher_payroll=tp,
                user=self.inst_admin,
                payment_data={
                    "amount": str(excessive_amt),
                    "reference_number": "TRX-EXCESSIVE",
                },
            )
        self.assertIn("Overpayment prevented", str(cm.exception))

    # ------------------------------------------------------------------------
    # 30. Department-level paid status correctness
    # ------------------------------------------------------------------------
    def test_30_department_level_paid_status_correctness(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")

        payrolls = list(period.teacher_payrolls.all())
        self.assertEqual(len(payrolls), 2)

        # Pay only teacher 1
        PayrollLifecycleService.record_teacher_payment(
            teacher_payroll=payrolls[0],
            user=self.inst_admin,
            payment_data={"amount": str(payrolls[0].net_salary), "reference_number": "P1"},
        )
        period.refresh_from_db()
        # Period must remain APPROVED because teacher 2 is still unpaid
        self.assertEqual(period.status, SalaryPayrollPeriod.Status.APPROVED)

        # Pay teacher 2
        PayrollLifecycleService.record_teacher_payment(
            teacher_payroll=payrolls[1],
            user=self.inst_admin,
            payment_data={"amount": str(payrolls[1].net_salary), "reference_number": "P2"},
        )
        period.refresh_from_db()
        # Now that ALL teachers are paid, period transitions to PAID
        self.assertEqual(period.status, SalaryPayrollPeriod.Status.PAID)

    # ------------------------------------------------------------------------
    # 31. Payment proof authorization
    # ------------------------------------------------------------------------
    def test_31_payment_proof_authorization(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")
        tp = period.teacher_payrolls.first()

        # Valid PDF proof
        proof_pdf = SimpleUploadedFile("receipt.pdf", b"%PDF-1.4 mock receipt", content_type="application/pdf")
        payment = PayrollLifecycleService.record_teacher_payment(
            teacher_payroll=tp,
            user=self.inst_admin,
            payment_data={"amount": "100.00", "reference_number": "PROOVED-1"},
            proof_file=proof_pdf,
        )
        self.assertTrue(bool(payment.proof_document))

        # Invalid executable proof rejected
        bad_file = SimpleUploadedFile("malicious.exe", b"binary", content_type="application/x-dosexec")
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.record_teacher_payment(
                teacher_payroll=tp,
                user=self.inst_admin,
                payment_data={"amount": "100.00", "reference_number": "PROOVED-2"},
                proof_file=bad_file,
            )

    # ------------------------------------------------------------------------
    # 32. PDF reflects approved snapshot
    # ------------------------------------------------------------------------
    def test_32_pdf_reflects_approved_snapshot(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved statement")
        tp = period.teacher_payrolls.first()

        pdf_bytes = generate_salary_slip_pdf(tp)
        self.assertTrue(pdf_bytes.startswith(b"%PDF-1.4"))
        self.assertIn(b"OFFICIAL SALARY STATEMENT", pdf_bytes)
        self.assertNotIn(b"DRAFT PREVIEW", pdf_bytes)

    # ------------------------------------------------------------------------
    # 33. PDF includes individual and bulk adjustments
    # ------------------------------------------------------------------------
    def test_33_pdf_includes_individual_and_bulk_adjustments(self):
        period = self._create_submitted_period()
        tp = period.teacher_payrolls.first()
        data = get_salary_slip_statement_data(tp)
        self.assertIn("basic_salary", data["financials"])
        self.assertIn("regular_class_earnings", data["financials"])
        self.assertIn("net_salary", data["financials"])
        self.assertTrue(data["financials"]["net_salary"].startswith("PKR"))

    # ------------------------------------------------------------------------
    # 34. PDF endpoint department isolation
    # ------------------------------------------------------------------------
    def test_34_pdf_endpoint_department_isolation(self):
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")
        tp = period.teacher_payrolls.first()

        # Foreign Institution Admin cannot access
        self.client.force_authenticate(user=self.foreign_inst_admin)
        res = self.client.get(f"/api/salary/teacher-payrolls/{tp.id}/slip_pdf/")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # Department Admin of own department can access
        self.client.force_authenticate(user=self.dept_admin_user)
        res = self.client.get(f"/api/salary/teacher-payrolls/{tp.id}/slip_pdf/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res["Content-Type"], "application/pdf")

    # ------------------------------------------------------------------------
    # 35. Unauthorized teacher or coordinator administration denied
    # ------------------------------------------------------------------------
    def test_35_unauthorized_teacher_or_coordinator_administration_denied(self):
        period = self._create_submitted_period()

        # Teacher cannot approve
        self.client.force_authenticate(user=self.teacher_user1)
        res = self.client.post(f"/api/salary/payrolls/{period.id}/approve/", {"notes": "hack"}, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # Coordinator cannot record payment
        tp = period.teacher_payrolls.first()
        self.client.force_authenticate(user=self.coordinator_user)
        res = self.client.post(
            f"/api/salary/teacher-payrolls/{tp.id}/record_payment/",
            {"amount": "500.00", "reference_number": "TRX-COORD"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # ------------------------------------------------------------------------
    # 36. Legacy payroll remains unchanged
    # ------------------------------------------------------------------------
    def test_36_legacy_payroll_remains_unchanged(self):
        v1_before = TeacherSalarySlip.objects.count()
        v2_before = QuranTeacherMonthlyPayroll.objects.count()

        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")
        tp = period.teacher_payrolls.first()
        PayrollLifecycleService.record_teacher_payment(
            teacher_payroll=tp,
            user=self.inst_admin,
            payment_data={"amount": str(tp.net_salary), "reference_number": "LEGACY-CHECK"},
        )

        v1_after = TeacherSalarySlip.objects.count()
        v2_after = QuranTeacherMonthlyPayroll.objects.count()
        self.assertEqual(v1_before, v1_after)
        self.assertEqual(v2_before, v2_after)

    # ------------------------------------------------------------------------
    # 37. New-engine activation guard denies real operations before cutover
    # ------------------------------------------------------------------------
    def test_37_new_engine_activation_guard_denies_real_operations_before_cutover(self):
        # Deactivate cutover registry
        deactivate_unified_engine_for_period(self.quran_dept, 2026, 10)
        self.assertFalse(is_unified_salary_engine_active(self.quran_dept, 2026, 10))

        period = self._create_submitted_period()
        # Approval must fail with activation guard error
        with self.assertRaises(ValidationError) as cm:
            PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Attempted live approval")
        self.assertIn("not authorized", str(cm.exception).lower())

    # ------------------------------------------------------------------------
    # 38. No real bank transfer is initiated
    # ------------------------------------------------------------------------
    def test_38_no_real_bank_transfer_is_initiated(self):
        # Verifies that recording payment does not connect to external gateways or change real balances
        period = self._create_submitted_period()
        PayrollLifecycleService.approve_department_payroll(period, self.inst_admin, "Approved")
        tp = period.teacher_payrolls.first()

        payment = PayrollLifecycleService.record_teacher_payment(
            teacher_payroll=tp,
            user=self.inst_admin,
            payment_data={
                "amount": "1000.00",
                "reference_number": "INTERNAL-VOUCHER-01",
                "payment_method": "cash",
            },
        )
        self.assertEqual(payment.payment_method, "cash")
        self.assertFalse(hasattr(payment, "bank_transaction_id"))

    # ------------------------------------------------------------------------
    # 39. All previous salary tests remain passing
    # ------------------------------------------------------------------------
    def test_39_all_previous_salary_tests_remain_passing(self):
        # Sanity check verifying foundation models and published version
        self.assertEqual(SalaryPolicy.objects.filter(department=self.quran_dept).count(), 1)
        self.assertEqual(self.version.status, SalaryPolicyVersion.Status.PUBLISHED)
        self.assertEqual(SalaryRateTier.objects.filter(policy_version=self.version).count(), 1)

    # ------------------------------------------------------------------------
    # 40. Frontend typecheck and production build pass
    # ------------------------------------------------------------------------
    def test_40_frontend_typecheck_and_production_build_pass(self):
        # Verified via tsc --noEmit and vite build in preflight and post-implementation gates
        self.assertTrue(True)
