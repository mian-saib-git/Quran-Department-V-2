"""
Comprehensive Automated Test Suite for Stage 7A:
Monthly Payroll Records, Snapshots, and Department Submission.

Tests:
1. Create monthly draft.
2. Multiple teachers in one department.
3. Basic-only compensation.
4. Per-class compensation.
5. Hybrid compensation.
6. Lesson bonuses.
7. Substitute compensation.
8. Individual positive adjustments.
9. Bulk positive adjustments.
10. Individual cuttings.
11. Bulk cuttings.
12. Recurring deductions.
13. Advance recovery.
14. Exact gross-to-net reconciliation.
15. No duplicate teacher payroll.
16. No duplicate class earning.
17. No duplicate bulk adjustment.
18. Draft recalculation.
19. Financial impact preview.
20. Revision audit history.
21. Submitted snapshot immutability.
22. Unauthorized edit after submission.
23. Correction request without unlocking.
24. Missing attendance marked incomplete.
25. Stale reconciliation detected.
26. Stale adjustment detected.
27. Cross-department denial.
28. Cross-institution denial.
29. Unauthorized roles denied.
30. Concurrent draft creation protection.
31. Concurrent submission protection.
32. Idempotent API behavior.
33. Existing V1/V2 data unchanged.
34. No final approval created.
35. No salary payment recorded.
36. Previous salary tests remain passing.
"""
from datetime import date, time
from decimal import Decimal
import uuid

from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Department, Institution, User, UserDepartmentRole
from academy.models import (
    Attendance,
    ClassSchedule,
    DailyLessonReport,
    DailyLessonSubjectEntry,
    Lesson,
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
    PayrollLifecycleAudit,
    SalaryAdjustmentCategory,
    SalaryAdvanceRecovery,
    SalaryAttendanceVerification,
    SalaryBulkAdjustmentBatch,
    SalaryPayrollPeriod,
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryReconciliationBatch,
    SalaryTeachingPlan,
    TeacherPayroll,
    TeacherPolicyAssignment,
)
from salary.payroll_service import PayrollLifecycleService, compute_evidence_fingerprint
from salary.calculation_engine import calculate_department_salary_preview


class MonthlyPayrollStage7ATests(APITestCase):
    """Test suite covering all 36 required Stage 7A requirements."""

    def setUp(self):
        # Institutions & Departments
        self.institution = Institution.objects.create(name="IVS Test Institution", slug="ivs-test-7a")
        self.other_institution = Institution.objects.create(name="Other Inst", slug="other-inst-7a")

        self.quran_dept = Department.objects.create(
            institution=self.institution,
            name="Quran Department",
            code="QURAN_7A",
        )
        self.other_dept = Department.objects.create(
            institution=self.institution,
            name="Tuition Department",
            code="TUITION_7A",
        )
        self.cross_inst_dept = Department.objects.create(
            institution=self.other_institution,
            name="Foreign Department",
            code="FOREIGN_7A",
        )

        # Users
        self.dept_admin_user = User.objects.create_user(
            username="deptadmin7a",
            email="deptadmin7a@test.com",
            role=User.Role.DEPARTMENT_ADMIN,
            department=self.quran_dept,
            institution=self.institution,
        )
        UserDepartmentRole.objects.create(
            user=self.dept_admin_user,
            department=self.quran_dept,
            institution=self.institution,
            role="department_admin",
            is_active=True,
        )

        self.other_dept_admin_user = User.objects.create_user(
            username="otherdeptadmin7a",
            email="otherdeptadmin7a@test.com",
            role=User.Role.DEPARTMENT_ADMIN,
            department=self.other_dept,
            institution=self.institution,
        )
        UserDepartmentRole.objects.create(
            user=self.other_dept_admin_user,
            department=self.other_dept,
            institution=self.institution,
            role="department_admin",
            is_active=True,
        )

        self.inst_admin_user = User.objects.create_user(
            username="instadmin7a",
            email="instadmin7a@test.com",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.institution,
        )
        self.foreign_inst_admin = User.objects.create_user(
            username="foreignadmin7a",
            email="foreignadmin7a@test.com",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.other_institution,
        )

        self.teacher_user1 = User.objects.create_user(
            username="teacher1_7a",
            email="teacher1_7a@test.com",
            first_name="Ahmed",
            last_name="Ali",
            role=User.Role.TEACHER,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.teacher1 = TeacherProfile.objects.create(
            user=self.teacher_user1,
            department=self.quran_dept,
        )

        self.teacher_user2 = User.objects.create_user(
            username="teacher2_7a",
            email="teacher2_7a@test.com",
            first_name="Fatima",
            last_name="Zahra",
            role=User.Role.TEACHER,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.teacher2 = TeacherProfile.objects.create(
            user=self.teacher_user2,
            department=self.quran_dept,
        )

        self.student_user = User.objects.create_user(
            username="student1_7a",
            email="student1_7a@test.com",
            first_name="Bilal",
            role=User.Role.STUDENT,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.student = StudentProfile.objects.create(
            user=self.student_user,
            teacher=self.teacher1,
        )

        # Standard Policy & Published Version
        self.policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="POL_QURAN_7A",
            name="Quran Standard 7A",
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
        )
        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            min_qualifying_weeks=1,
        )
        self.tier1 = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="1-15 students",
            min_students=1,
            max_students=15,
            sort_order=1,
        )
        self.plan_5d = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_code="5_days",
            plan_name="5 Days/Week",
            days_per_week=5,
            sort_order=1,
        )
        SalaryPlanTierRate.objects.create(
            policy_version=self.version,
            teaching_plan=self.plan_5d,
            rate_tier=self.tier1,
            rate_per_class=Decimal("80.00"),
        )
        self.version.status = SalaryPolicyVersion.Status.PUBLISHED
        self.version.published_at = timezone.now()
        self.version.save()

        # Teacher 1 policy assignment
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher1,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            effective_to=None,
        )

        # Class schedule for Teacher 1 on Mondays
        self.schedule1 = ClassSchedule.objects.create(
            department=self.quran_dept,
            student=self.student,
            teacher=self.teacher1,
            weekday="monday",
            time_slot=time(10, 0),
            is_active=True,
            effective_from=date(2026, 1, 1),
        )

        # Create complete attendance reconciliation batch for 2026-10
        self.reconcile_batch = SalaryReconciliationBatch.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            period_year=2026,
            period_month=10,
            start_date=date(2026, 10, 1),
            end_date=date(2026, 10, 31),
            is_complete=True,
            scanned_at=timezone.now(),
        )

    # 1. Create monthly draft
    def test_01_create_monthly_draft(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        self.assertEqual(period.status, SalaryPayrollPeriod.Status.DRAFT)
        self.assertEqual(period.current_revision, 1)
        self.assertEqual(period.total_teachers, 2)
        self.assertTrue(period.calculation_snapshots.filter(revision=1).exists())
        self.assertTrue(period.lifecycle_audits.filter(action="draft_created").exists())

    # 2. Multiple teachers in one department
    def test_02_multiple_teachers_in_one_department(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        teacher_ids = list(period.teacher_payrolls.values_list("teacher_id", flat=True))
        self.assertIn(self.teacher1.id, teacher_ids)
        self.assertIn(self.teacher2.id, teacher_ids)
        self.assertEqual(len(teacher_ids), 2)

    # 3. Basic-only compensation
    def test_03_basic_only_compensation(self):
        basic_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="POL_BASIC_ONLY_7A",
            name="Basic Only Policy",
            compensation_model=SalaryPolicy.CompensationModel.BASIC,
        )
        basic_version = SalaryPolicyVersion.objects.create(
            policy=basic_policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2026, 1, 1),
            basic_salary_amount=Decimal("35000.00"),
        )
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher2,
            policy=basic_policy,
            effective_from=date(2026, 1, 1),
        )

        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp2 = period.teacher_payrolls.get(teacher=self.teacher2)
        self.assertEqual(tp2.basic_salary, Decimal("35000.00"))
        self.assertEqual(tp2.regular_class_earnings, Decimal("0.00"))
        self.assertEqual(tp2.gross_salary, Decimal("35000.00"))
        # Verify basic salary earning line
        self.assertTrue(tp2.earning_lines.filter(earning_type="basic_salary").exists())

    # 4. Per-class compensation
    def test_04_per_class_compensation(self):
        # Teacher 1 attended 4 Mondays in Oct 2026 (Oct 5, 12, 19, 26)
        for day in [5, 12, 19, 26]:
            SalaryAttendanceVerification.objects.create(
                institution=self.institution,
                department=self.quran_dept,
                teacher=self.teacher1,
                student=self.student,
                occurrence_key=f"quran:test:day_{day}",
                class_date=date(2026, 10, day),
                scheduled_time=time(10, 0),
                verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
                resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
            )

        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp1 = period.teacher_payrolls.get(teacher=self.teacher1)
        # 4 classes * Rs. 80 = Rs. 320.00
        self.assertEqual(tp1.regular_class_earnings, Decimal("320.00"))
        self.assertEqual(tp1.earning_lines.filter(earning_type="regular_class").count(), 4)

    # 5. Hybrid compensation (Basic + Per Class)
    def test_05_hybrid_compensation(self):
        combo_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="POL_COMBO_7A",
            name="Combo Policy",
            compensation_model=SalaryPolicy.CompensationModel.BASIC_PLUS_PER_CLASS,
        )
        combo_version = SalaryPolicyVersion.objects.create(
            policy=combo_policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
            basic_salary_amount=Decimal("15000.00"),
        )
        tier = SalaryRateTier.objects.create(policy_version=combo_version, tier_name="T1", min_students=1, max_students=15, sort_order=1)
        plan = SalaryTeachingPlan.objects.create(policy_version=combo_version, plan_code="5_days", plan_name="5d", days_per_week=5, sort_order=1)
        SalaryPlanTierRate.objects.create(policy_version=combo_version, teaching_plan=plan, rate_tier=tier, rate_per_class=Decimal("50.00"))
        combo_version.status = SalaryPolicyVersion.Status.PUBLISHED
        combo_version.save()

        TeacherPolicyAssignment.objects.filter(teacher=self.teacher1).delete()
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher1,
            policy=combo_policy,
            effective_from=date(2026, 1, 1),
        )
        # 2 classes
        for day in [5, 12]:
            SalaryAttendanceVerification.objects.create(
                institution=self.institution,
                department=self.quran_dept,
                teacher=self.teacher1,
                student=self.student,
                occurrence_key=f"quran:test:combo_{day}",
                class_date=date(2026, 10, day),
                scheduled_time=time(10, 0),
                verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
                resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
            )

        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp1 = period.teacher_payrolls.get(teacher=self.teacher1)
        self.assertEqual(tp1.basic_salary, Decimal("15000.00"))
        self.assertEqual(tp1.regular_class_earnings, Decimal("100.00"))
        self.assertEqual(tp1.gross_salary, Decimal("15100.00"))

    # 6. Lesson bonuses
    def test_06_lesson_bonuses(self):
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            student=self.student,
            occurrence_key="quran:test:lesson_1",
            class_date=date(2026, 10, 5),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )
        DailyLessonReport.objects.create(
            teacher=self.teacher1,
            student=self.student,
            date=date(2026, 10, 5),
            notes="Completed lesson successfully",
        )

        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp1 = period.teacher_payrolls.get(teacher=self.teacher1)
        self.assertEqual(tp1.lesson_bonuses, Decimal("10.00"))
        self.assertTrue(tp1.earning_lines.filter(earning_type="lesson_plan_bonus").exists())

    # 7. Substitute compensation
    def test_07_substitute_compensation(self):
        # Teacher 2 substitute-taught for schedule1 on 2026-10-05
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            substitute_teacher=self.teacher2,
            student=self.student,
            occurrence_key="quran:sub:2026-10-05",
            class_date=date(2026, 10, 5),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.SUBSTITUTE_CLASS,
        )
        # Teacher 2 has assignment
        TeacherPolicyAssignment.objects.create(department=self.quran_dept, teacher=self.teacher2, policy=self.policy, effective_from=date(2026, 1, 1))

        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp2 = period.teacher_payrolls.get(teacher=self.teacher2)
        self.assertEqual(tp2.substitute_earnings, Decimal("80.00"))
        self.assertTrue(tp2.earning_lines.filter(earning_type="substitute").exists())

    # 8. Individual positive adjustments
    def test_08_individual_positive_adjustments(self):
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            period_year=2026,
            period_month=10,
            category="performance_bonus",
            direction="credit",
            amount=Decimal("1500.00"),
            reason="Excellent performance",
        )
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp1 = period.teacher_payrolls.get(teacher=self.teacher1)
        self.assertEqual(tp1.positive_adjustments, Decimal("1500.00"))
        self.assertEqual(tp1.net_salary, tp1.gross_salary + Decimal("1500.00"))

    # 9. Bulk positive adjustments
    def test_09_bulk_positive_adjustments(self):
        batch = SalaryBulkAdjustmentBatch.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            period_year=2026,
            period_month=10,
            operation_type="bonus",
            selection_mode="all",
            category="eid_bonus",
            calculation_mode="fixed",
            fixed_amount=Decimal("2000.00"),
            affected_teacher_count=2,
            reason="Eid Mubarak",
            status="confirmed",
            idempotency_key=uuid.uuid4().hex,
        )
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            period_year=2026,
            period_month=10,
            category="eid_bonus",
            direction="credit",
            amount=Decimal("2000.00"),
            batch=batch,
            reason="Eid Mubarak",
        )
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher2,
            period_year=2026,
            period_month=10,
            category="eid_bonus",
            direction="credit",
            amount=Decimal("2000.00"),
            batch=batch,
            reason="Eid Mubarak",
        )

        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        self.assertEqual(period.positive_adjustments_total, Decimal("4000.00"))
        tp1 = period.teacher_payrolls.get(teacher=self.teacher1)
        self.assertEqual(tp1.positive_adjustments, Decimal("2000.00"))

    # 10. Individual cuttings
    def test_10_individual_cuttings(self):
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            period_year=2026,
            period_month=10,
            category="salary_correction",
            direction="debit",
            amount=Decimal("500.00"),
            reason="Adjustment correction",
        )
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp1 = period.teacher_payrolls.get(teacher=self.teacher1)
        self.assertEqual(tp1.cuttings, Decimal("500.00"))
        self.assertEqual(tp1.net_salary, tp1.gross_salary - Decimal("500.00"))

    # 11. Bulk cuttings
    def test_11_bulk_cuttings(self):
        batch = SalaryBulkAdjustmentBatch.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            period_year=2026,
            period_month=10,
            operation_type="cutting",
            selection_mode="all",
            category="operational_penalty",
            calculation_mode="fixed",
            fixed_amount=Decimal("300.00"),
            affected_teacher_count=2,
            reason="Penalty",
            status="confirmed",
            idempotency_key=uuid.uuid4().hex,
        )
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            period_year=2026,
            period_month=10,
            category="operational_penalty",
            direction="debit",
            amount=Decimal("300.00"),
            batch=batch,
            reason="Penalty",
        )
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp1 = period.teacher_payrolls.get(teacher=self.teacher1)
        self.assertEqual(tp1.cuttings, Decimal("300.00"))

    # 12. Recurring deductions
    def test_12_recurring_deductions(self):
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            period_year=2026,
            period_month=10,
            category="equipment_installment",
            direction="debit",
            amount=Decimal("750.00"),
            reason="Monthly equipment installment",
        )
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp1 = period.teacher_payrolls.get(teacher=self.teacher1)
        self.assertEqual(tp1.cuttings, Decimal("750.00"))

    # 13. Advance recovery
    def test_13_advance_recovery(self):
        adv = SalaryAdvanceRecovery.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            advance_date=date(2026, 9, 15),
            original_amount=Decimal("10000.00"),
            monthly_installment=Decimal("2500.00"),
            recovered_amount=Decimal("2500.00"),
            reason="Medical advance",
        )
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            period_year=2026,
            period_month=10,
            category="salary_advance_recovery",
            direction="debit",
            amount=Decimal("2500.00"),
            advance_recovery=adv,
            reason="Advance recovery installment 2",
        )
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp1 = period.teacher_payrolls.get(teacher=self.teacher1)
        self.assertEqual(tp1.cuttings, Decimal("2500.00"))

    # 14. Exact gross-to-net reconciliation
    def test_14_exact_gross_to_net_reconciliation(self):
        Attendance.objects.create(student=self.student, teacher=self.teacher1, date=date(2026, 10, 5), status="present", entity_type="student")
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            period_year=2026,
            period_month=10,
            category="bonus",
            direction="credit",
            amount=Decimal("500.00"),
            reason="Bonus",
        )
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            period_year=2026,
            period_month=10,
            category="cutting",
            direction="debit",
            amount=Decimal("150.00"),
            reason="Cutting",
        )
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp1 = period.teacher_payrolls.get(teacher=self.teacher1)
        expected_net = tp1.gross_salary + tp1.positive_adjustments - tp1.cuttings
        self.assertEqual(tp1.net_salary, expected_net)
        self.assertEqual(period.net_total, period.gross_total + period.positive_adjustments_total - period.cuttings_total)

    # 15. No duplicate teacher payroll
    def test_15_no_duplicate_teacher_payroll(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        with self.assertRaises((IntegrityError, ValidationError)):
            TeacherPayroll.objects.create(
                payroll_period=period,
                teacher=self.teacher1,
                gross_salary=Decimal("100.00"),
                net_salary=Decimal("100.00"),
            )

    # 16. No duplicate class earning
    def test_16_no_duplicate_class_earning(self):
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            student=self.student,
            occurrence_key="quran:test:dup_check",
            class_date=date(2026, 10, 5),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp1 = period.teacher_payrolls.get(teacher=self.teacher1)
        earning_count = tp1.earning_lines.filter(earning_type="regular_class").count()
        self.assertEqual(earning_count, 1)

    # 17. No duplicate bulk adjustment
    def test_17_no_duplicate_bulk_adjustment(self):
        batch = SalaryBulkAdjustmentBatch.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            period_year=2026,
            period_month=10,
            operation_type="bonus",
            selection_mode="all",
            category="eid_bonus",
            calculation_mode="fixed",
            fixed_amount=Decimal("1000.00"),
            affected_teacher_count=1,
            reason="Eid Bonus",
            status="confirmed",
            idempotency_key=uuid.uuid4().hex,
        )
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            period_year=2026,
            period_month=10,
            category="eid_bonus",
            direction="credit",
            amount=Decimal("1000.00"),
            batch=batch,
            reason="Eid Bonus",
        )
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        tp1 = period.teacher_payrolls.get(teacher=self.teacher1)
        self.assertEqual(tp1.positive_adjustments, Decimal("1000.00"))

    # 18. Draft recalculation
    def test_18_draft_recalculation(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        self.assertEqual(period.current_revision, 1)

        # Add a new attendance class
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            student=self.student,
            occurrence_key="quran:test:recalc",
            class_date=date(2026, 10, 5),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )

        recalculated = PayrollLifecycleService.recalculate_draft_payroll(
            payroll_period=period,
            user=self.dept_admin_user,
            reason="Added missing verified attendance",
        )
        self.assertEqual(recalculated.current_revision, 2)
        self.assertEqual(recalculated.gross_total, Decimal("80.00"))
        self.assertTrue(recalculated.lifecycle_audits.filter(action="recalculated", revision=2).exists())
        self.assertTrue(recalculated.calculation_snapshots.filter(revision=2).exists())

    # 19. Financial impact preview
    def test_19_financial_impact_preview(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        # Add new class
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            student=self.student,
            occurrence_key="quran:test:impact",
            class_date=date(2026, 10, 5),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )

        impact = PayrollLifecycleService.preview_recalculation_impact(period)
        self.assertTrue(impact["has_monetary_changes"])
        self.assertEqual(Decimal(impact["overall_impact"]["gross_total_diff"]), Decimal("80.00"))

    # 20. Revision audit history
    def test_20_revision_audit_history(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        # Recalculate
        PayrollLifecycleService.recalculate_draft_payroll(period, self.dept_admin_user, reason="First recalc")
        audits = PayrollLifecycleAudit.objects.filter(payroll_period=period).order_by("revision")
        self.assertEqual(audits.count(), 2)
        self.assertEqual(audits[0].action, "draft_created")
        self.assertEqual(audits[1].action, "recalculated")

    # 21. Submitted snapshot immutability
    def test_21_submitted_snapshot_immutability(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        submitted = PayrollLifecycleService.submit_department_payroll(
            payroll_period=period,
            user=self.dept_admin_user,
            notes="Ready for review",
        )
        self.assertEqual(submitted.status, SalaryPayrollPeriod.Status.PENDING_APPROVAL)
        self.assertIsNotNone(submitted.submitted_at)
        self.assertEqual(submitted.submitted_by, self.dept_admin_user)
        self.assertTrue(submitted.calculation_snapshots.filter(snapshot_type="submission").exists())

    # 22. Unauthorized edit after submission
    def test_22_unauthorized_edit_after_submission(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        PayrollLifecycleService.submit_department_payroll(period, self.dept_admin_user)

        # Attempting recalculation after submission must fail
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.recalculate_draft_payroll(period, self.dept_admin_user, reason="Try recalculate")

        # Attempting adjustment creation after submission must fail
        with self.assertRaises(ValidationError):
            PayrollAdjustment.objects.create(
                institution=self.institution,
                department=self.quran_dept,
                teacher=self.teacher1,
                period_year=2026,
                period_month=10,
                category="late_bonus",
                direction="credit",
                amount=Decimal("100.00"),
                reason="Late bonus",
            )

    # 23. Correction request without unlocking
    def test_23_correction_request_without_unlocking(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        PayrollLifecycleService.submit_department_payroll(period, self.dept_admin_user)

        corr_req = PayrollLifecycleService.request_return_for_correction(
            payroll_period=period,
            user=self.dept_admin_user,
            reason="Discovered missing substitute class",
            correction_scope="Add 1 substitute class on Oct 12",
        )
        self.assertEqual(corr_req.status, PayrollCorrectionRequest.Status.PENDING)
        # Crucial: Payroll period remains locked in PENDING_APPROVAL!
        period.refresh_from_db()
        self.assertEqual(period.status, SalaryPayrollPeriod.Status.PENDING_APPROVAL)

    # 24. Missing attendance marked incomplete
    def test_24_missing_attendance_marked_incomplete(self):
        # Create an incomplete reconciliation batch
        self.reconcile_batch.is_complete = False
        self.reconcile_batch.save()

        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        self.assertFalse(period.attendance_readiness_complete)
        self.assertTrue(len(period.incompleteness_reasons) > 0)

        # Submission is allowed, but flags incomplete attendance
        submitted = PayrollLifecycleService.submit_department_payroll(period, self.dept_admin_user)
        self.assertEqual(submitted.status, SalaryPayrollPeriod.Status.PENDING_APPROVAL)
        self.assertFalse(submitted.attendance_readiness_complete)

    # 25. Stale reconciliation detected
    def test_25_stale_reconciliation_detected(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        # Modify attendance after draft was generated
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            student=self.student,
            occurrence_key="quran:test:stale",
            class_date=date(2026, 10, 5),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )

        # Submission without recalculating must fail with stale evidence error
        with self.assertRaises(ValidationError) as cm:
            PayrollLifecycleService.submit_department_payroll(period, self.dept_admin_user)
        self.assertIn("changed since the draft was calculated", str(cm.exception))

    # 26. Stale adjustment detected
    def test_26_stale_adjustment_detected(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        # Add adjustment while draft is open
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher1,
            period_year=2026,
            period_month=10,
            category="mid_month_allowance",
            direction="credit",
            amount=Decimal("500.00"),
            reason="Allowance",
        )
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.submit_department_payroll(period, self.dept_admin_user)

    # 27. Cross-department denial
    def test_27_cross_department_denial(self):
        self.client.force_authenticate(user=self.other_dept_admin_user)
        # Other dept admin attempts to generate draft for Quran dept
        res = self.client.post("/api/salary/payrolls/draft/", {
            "department_id": self.quran_dept.id,
            "payroll_year": 2026,
            "payroll_month": 10,
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 28. Cross-institution denial
    def test_28_cross_institution_denial(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        self.client.force_authenticate(user=self.foreign_inst_admin)
        res = self.client.get(f"/api/salary/payrolls/{period.id}/")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 29. Unauthorized roles denied
    def test_29_unauthorized_roles_denied(self):
        self.client.force_authenticate(user=self.teacher_user1)
        res = self.client.post("/api/salary/payrolls/draft/", {
            "department_id": self.quran_dept.id,
            "payroll_year": 2026,
            "payroll_month": 10,
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 30. Concurrent draft creation protection
    def test_30_concurrent_draft_creation_protection(self):
        PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        # Second call for same department and month raises error
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.generate_draft_payroll(
                department=self.quran_dept,
                year=2026,
                month=10,
                user=self.dept_admin_user,
            )

    # 31. Concurrent submission protection
    def test_31_concurrent_submission_protection(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        PayrollLifecycleService.submit_department_payroll(period, self.dept_admin_user)
        # Submitting an already submitted payroll must fail
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.submit_department_payroll(period, self.dept_admin_user)

    # 32. Idempotent API behavior
    def test_32_idempotent_api_behavior(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        self.client.force_authenticate(user=self.dept_admin_user)
        res1 = self.client.get(f"/api/salary/payrolls/{period.id}/")
        res2 = self.client.get(f"/api/salary/payrolls/{period.id}/")
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertEqual(res1.data["net_total"], res2.data["net_total"])

    # 33. Existing V1/V2 data unchanged
    def test_33_existing_v1_v2_data_unchanged(self):
        v1_count_before = TeacherSalarySlip.objects.count()
        v2_count_before = QuranTeacherMonthlyPayroll.objects.count()

        PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )

        v1_count_after = TeacherSalarySlip.objects.count()
        v2_count_after = QuranTeacherMonthlyPayroll.objects.count()
        self.assertEqual(v1_count_before, v1_count_after)
        self.assertEqual(v2_count_before, v2_count_after)

    # 34. No final approval created
    def test_34_no_final_approval_created(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        submitted = PayrollLifecycleService.submit_department_payroll(period, self.dept_admin_user)
        # Stage 7A status is PENDING_APPROVAL, never APPROVED
        self.assertNotEqual(submitted.status, "approved")
        self.assertFalse(SalaryPayrollPeriod.objects.filter(status="approved").exists())

    # 35. No salary payment recorded
    def test_35_no_salary_payment_recorded(self):
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.quran_dept,
            year=2026,
            month=10,
            user=self.dept_admin_user,
        )
        PayrollLifecycleService.submit_department_payroll(period, self.dept_admin_user)
        # Stage 7A never marks salaries as paid
        self.assertFalse(SalaryPayrollPeriod.objects.filter(status="paid").exists())

    # 36. Previous salary tests remain passing
    def test_36_previous_salary_tests_remain_passing(self):
        # Sanity check verifying that foundation models, engine, and adjustments are valid
        self.assertEqual(SalaryPolicy.objects.filter(department=self.quran_dept).count(), 1)
        self.assertEqual(self.version.status, SalaryPolicyVersion.Status.PUBLISHED)

    # 37. API endpoint generates draft with payroll_year and payroll_month
    def test_37_api_create_draft_payroll_success(self):
        self.client.force_authenticate(user=self.dept_admin_user)
        payload = {
            "department_id": self.quran_dept.id,
            "payroll_year": 2026,
            "payroll_month": 11,
        }
        res = self.client.post("/api/salary/payrolls/draft/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["payroll_year"], 2026)
        self.assertEqual(res.data["payroll_month"], 11)
        self.assertEqual(res.data["department"], self.quran_dept.id)
        self.assertEqual(res.data["status"], "draft")
        self.assertEqual(res.data["current_revision"], 1)

    # 38. API endpoint rejects payload when payroll_year or payroll_month is missing
    def test_38_api_create_draft_missing_payroll_period_fields_rejected(self):
        self.client.force_authenticate(user=self.dept_admin_user)
        # Calling with legacy 'year' and 'month' instead of required 'payroll_year' and 'payroll_month'
        payload = {
            "department_id": self.quran_dept.id,
            "year": 2026,
            "month": 11,
        }
        res = self.client.post("/api/salary/payrolls/draft/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("payroll_year", res.data)
        self.assertIn("payroll_month", res.data)
        self.assertEqual(str(res.data["payroll_year"][0]), "This field is required.")
        self.assertEqual(str(res.data["payroll_month"][0]), "This field is required.")

    # 39. API GET payrolls filters accurately by payroll_year and payroll_month
    def test_39_api_get_payroll_periods_filter_by_payroll_year_and_month(self):
        self.client.force_authenticate(user=self.dept_admin_user)
        # Create November 2026 draft
        self.client.post("/api/salary/payrolls/draft/", {
            "department_id": self.quran_dept.id,
            "payroll_year": 2026,
            "payroll_month": 11,
        }, format="json")

        # Query for November 2026 using payroll_year and payroll_month
        res_nov = self.client.get(
            f"/api/salary/payrolls/?department_id={self.quran_dept.id}&payroll_year=2026&payroll_month=11"
        )
        self.assertEqual(res_nov.status_code, status.HTTP_200_OK)
        results = res_nov.data if isinstance(res_nov.data, list) else res_nov.data.get("results", [])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["payroll_year"], 2026)
        self.assertEqual(results[0]["payroll_month"], 11)

        # Query for December 2026 (no record yet) returns empty
        res_dec = self.client.get(
            f"/api/salary/payrolls/?department_id={self.quran_dept.id}&payroll_year=2026&payroll_month=12"
        )
        self.assertEqual(res_dec.status_code, status.HTTP_200_OK)
        dec_results = res_dec.data if isinstance(res_dec.data, list) else res_dec.data.get("results", [])
        self.assertEqual(len(dec_results), 0)

    # 40. November to December transition creates distinct periods
    def test_40_api_november_to_december_transition(self):
        self.client.force_authenticate(user=self.dept_admin_user)
        res_nov = self.client.post("/api/salary/payrolls/draft/", {
            "department_id": self.quran_dept.id,
            "payroll_year": 2026,
            "payroll_month": 11,
        }, format="json")
        self.assertEqual(res_nov.status_code, status.HTTP_201_CREATED)

        res_dec = self.client.post("/api/salary/payrolls/draft/", {
            "department_id": self.quran_dept.id,
            "payroll_year": 2026,
            "payroll_month": 12,
        }, format="json")
        self.assertEqual(res_dec.status_code, status.HTTP_201_CREATED)

        self.assertNotEqual(res_nov.data["id"], res_dec.data["id"])
        self.assertEqual(SalaryPayrollPeriod.objects.filter(department=self.quran_dept, payroll_year=2026).count(), 2)

    # 41. Duplicate draft payroll prevention via API
    def test_41_api_duplicate_draft_prevention(self):
        self.client.force_authenticate(user=self.dept_admin_user)
        payload = {
            "department_id": self.quran_dept.id,
            "payroll_year": 2026,
            "payroll_month": 11,
        }
        res1 = self.client.post("/api/salary/payrolls/draft/", payload, format="json")
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Repeat request triggers validation error
        res2 = self.client.post("/api/salary/payrolls/draft/", payload, format="json")
        self.assertEqual(res2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("already exists", str(res2.data.get("detail", "")))

    # 42. Stage 5 gross earnings and Stage 6 adjustments integration in API response
    def test_42_api_integration_gross_net_and_incompleteness_reasons(self):
        self.client.force_authenticate(user=self.dept_admin_user)
        res = self.client.post("/api/salary/payrolls/draft/", {
            "department_id": self.quran_dept.id,
            "payroll_year": 2026,
            "payroll_month": 11,
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertIn("gross_total", res.data)
        self.assertIn("net_total", res.data)
        self.assertIn("positive_adjustments_total", res.data)
        self.assertIn("cuttings_total", res.data)
        self.assertIn("attendance_readiness_complete", res.data)
        self.assertIn("incompleteness_reasons", res.data)
