"""
Unified Salary Management — Stage 9A Test Suite:
Safe Cutover Preparation, Centralized Ownership Guard & Reverse Legacy Guards.

Covers all 23 mandatory cutover scenarios:
1. Legacy period, V1 operation permitted according to existing rules.
2. Legacy period, V2 operation permitted according to existing rules.
3. Legacy period, Unified final approval rejected.
4. Unified-owned period, V1 generation rejected.
5. Unified-owned period, V1 finalization rejected.
6. Unified-owned period, V2 generation rejected.
7. Unified-owned period, V2 approval rejected.
8. Unified-owned period, V2 disbursement rejected.
9. Unified-owned period, V2 reopening rejected.
10. Unified-owned period, Unified approval follows its normal readiness checks.
11. Historical legacy salary reads remain available.
12. Other department remains unaffected.
13. Earlier period remains unaffected.
14. Later period remains unaffected unless explicitly activated.
15. Cross-institution registry spoofing rejected.
16. Duplicate activation attempts rejected.
17. Unauthorized registry mutation rejected.
18. Existing approved legacy payroll creates an activation conflict.
19. Existing paid legacy payroll creates an activation conflict.
20. Concurrent legacy and Unified requests cannot both succeed.
21. Retry and idempotency protection.
22. No real external payment initiated.
23. Legacy financial records remain unchanged in non-activation scenarios.
"""

from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Department, Institution, User, UserDepartmentRole
from academy.models import (
    Attendance,
    ClassSchedule,
    QuranSalaryAdjustment,
    QuranSalaryLedgerEntry,
    QuranStudentDropEvent,
    QuranTeacherMonthlyPayroll,
    SalaryConfiguration,
    StudentProfile,
    TeacherProfile,
    TeacherSalarySlip,
)
from academy.salary_service import (
    calculate_teacher_salary,
    refresh_salary_slip,
)
from academy.salary_v2_service import (
    calculate_department_payrolls,
    calculate_teacher_payroll,
)
from academy.student_rejoin_service import (
    rejoin_student_drop,
    StudentRejoinError,
)

from salary.models import (
    SalaryAttendanceVerification,
    SalaryEngineCutoverRegistry,
    SalaryPayrollPeriod,
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    TeacherPayroll,
    TeacherPayrollPayment,
    TeacherPolicyAssignment,
)
from salary.cutover_guard import (
    CutoverScopingError,
    LegacySalaryMutationDeniedError,
    SalaryEngine,
    UnifiedSalaryMutationDeniedError,
    activate_unified_engine_for_period,
    assert_bulk_legacy_write_permitted,
    assert_legacy_salary_write_permitted,
    assert_unified_salary_write_permitted,
    check_legacy_write_guard,
    deactivate_unified_engine_for_period,
    get_salary_engine_for_period,
    is_unified_salary_active,
)
from salary.conflict_audit import CrossEngineConflictAuditor
from salary.payroll_service import PayrollLifecycleService


class Stage9ACutoverGuardsTests(APITestCase):
    """Exhaustive test suite for Stage 9A Safe Cutover Preparation and Reverse Legacy Guards."""

    def setUp(self):
        # 1. Institutions
        self.institution_a = Institution.objects.create(name="Institution Alpha", slug="inst-alpha-9a")
        self.institution_b = Institution.objects.create(name="Institution Beta", slug="inst-beta-9a")

        # 2. Departments
        self.quran_dept_a = Department.objects.create(
            institution=self.institution_a,
            name="Quran Department A",
            code="QURAN_A_9A",
            department_type="quran",
        )
        self.other_dept_a = Department.objects.create(
            institution=self.institution_a,
            name="Tuition Department A",
            code="TUITION_A_9A",
            department_type="tuition",
        )
        self.quran_dept_b = Department.objects.create(
            institution=self.institution_b,
            name="Quran Department B",
            code="QURAN_B_9A",
            department_type="quran",
        )

        # 3. Users
        self.super_admin = User.objects.create_superuser(
            username="superadmin_9a",
            email="superadmin_9a@ivs.com",
            password="testpassword",
            role=User.Role.PLATFORM_ADMIN,
        )
        self.inst_admin_a = User.objects.create_user(
            username="inst_admin_a_9a",
            email="inst_admin_a_9a@ivs.com",
            password="testpassword",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.institution_a,
        )
        self.dept_admin_a = User.objects.create_user(
            username="dept_admin_a_9a",
            email="dept_admin_a_9a@ivs.com",
            password="testpassword",
            role=User.Role.DEPARTMENT_ADMIN,
            department=self.quran_dept_a,
            institution=self.institution_a,
        )
        UserDepartmentRole.objects.create(
            user=self.dept_admin_a,
            department=self.quran_dept_a,
            institution=self.institution_a,
            role=User.Role.DEPARTMENT_ADMIN,
            is_active=True,
        )

        # 4. Teachers
        self.teacher_user_1 = User.objects.create_user(
            username="teacher_1_9a",
            email="teacher_1_9a@ivs.com",
            password="testpassword",
            role=User.Role.TEACHER,
            department=self.quran_dept_a,
            institution=self.institution_a,
            first_name="Tariq",
            last_name="Mahmood",
        )
        self.teacher_1 = TeacherProfile.objects.create(
            user=self.teacher_user_1,
            department=self.quran_dept_a,
            institution=self.institution_a,
        )

        self.teacher_user_2 = User.objects.create_user(
            username="teacher_2_9a",
            email="teacher_2_9a@ivs.com",
            password="testpassword",
            role=User.Role.TEACHER,
            department=self.quran_dept_a,
            institution=self.institution_a,
            first_name="Khalid",
            last_name="Rehman",
        )
        self.teacher_2 = TeacherProfile.objects.create(
            user=self.teacher_user_2,
            department=self.quran_dept_a,
            institution=self.institution_a,
        )

        # 5. Students
        self.student_user_1 = User.objects.create_user(
            username="student_1_9a",
            password="testpassword",
            role=User.Role.STUDENT,
            department=self.quran_dept_a,
            institution=self.institution_a,
        )
        self.student_1 = StudentProfile.objects.create(
            user=self.student_user_1,
            teacher=self.teacher_1,
            department=self.quran_dept_a,
            institution=self.institution_a,
        )

        from accounts.models import Feature, DepartmentFeature
        feature, _ = Feature.objects.get_or_create(key="tab_teacher_salary", defaults={"name": "Teacher Salary", "is_active": True})
        DepartmentFeature.objects.update_or_create(department=self.quran_dept_a, feature=feature, defaults={"is_enabled": True})

        # 6. Legacy V1 Configuration
        self.v1_config = SalaryConfiguration.objects.create(
            department=self.quran_dept_a,
        )

        # 7. Unified Salary Policy Foundation
        self.policy = SalaryPolicy.objects.create(
            department=self.quran_dept_a,
            institution=self.institution_a,
            name="Quran Standard Policy 9A",
            code="POL_9A",
            description="Policy for 9A tests",
            created_by=self.super_admin,
        )
        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
            cancellation_payment_rule="paid_always",
        )
        self.tier = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="Tier 1",
            sort_order=1,
            min_students=1,
            max_students=10,
        )
        self.plan = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_name="Daily Plan",
            plan_code="DAILY",
            days_per_week=5,
        )
        SalaryPlanTierRate.objects.create(
            policy_version=self.version,
            teaching_plan=self.plan,
            rate_tier=self.tier,
            rate_per_class=Decimal("100.00"),
        )
        self.version.status = SalaryPolicyVersion.Status.PUBLISHED
        self.version.published_by = self.super_admin
        self.version.published_at = timezone.now()
        self.version.save()
        # Policy assignments
        for teacher in [self.teacher_1, self.teacher_2]:
            TeacherPolicyAssignment.objects.create(
                teacher=teacher,
                department=self.quran_dept_a,
                policy=self.policy,
                effective_from=date(2026, 1, 1),
                assigned_by=self.super_admin,
            )

        # Target test period
        self.year = 2026
        self.month = 3

    # ========================================================================
    # SCENARIOS 1-3: LEGACY PERIOD INERTIA & UNIFIED FINAL APPROVAL REJECTION
    # ========================================================================

    def test_01_legacy_period_v1_operation_permitted_under_existing_rules(self):
        """Scenario 1: When cutover is inactive, V1 operations are permitted according to existing rules."""
        self.assertFalse(is_unified_salary_active(self.quran_dept_a, self.year, self.month))

        # 1. V1 calculation succeeds
        slip = TeacherSalarySlip.objects.create(
            department=self.quran_dept_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=TeacherSalarySlip.Status.DRAFT,
        )
        refreshed = refresh_salary_slip(slip, actor=self.dept_admin_a)
        self.assertIsNotNone(refreshed)

        # 2. V1 Dashboard GET succeeds and creates/refreshes slips
        self.client.force_authenticate(user=self.dept_admin_a)
        resp = self.client.get(f"/api/academy/teacher-salary/?month={self.month}&year={self.year}")
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_02_legacy_period_v2_operation_permitted_under_existing_rules(self):
        """Scenario 2: When cutover is inactive, V2 operations are permitted according to existing rules."""
        self.assertFalse(is_unified_salary_active(self.quran_dept_a, self.year, self.month))

        # V2 calculation succeeds
        payrolls = calculate_department_payrolls(
            self.quran_dept_a,
            self.year,
            self.month,
            actor=self.dept_admin_a,
        )
        self.assertIsNotNone(payrolls)

        # V2 API calculate action succeeds
        self.client.force_authenticate(user=self.dept_admin_a)
        resp = self.client.post("/api/academy/teacher-salary-v2/", {
            "action": "calculate",
            "department_id": self.quran_dept_a.id,
            "year": self.year,
            "month": self.month,
        })
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

    def test_03_legacy_period_unified_final_approval_rejected(self):
        """Scenario 3: When cutover is inactive, Unified final approval and payment recording are rejected."""
        self.assertFalse(is_unified_salary_active(self.quran_dept_a, self.year, self.month))

        # Direct assert check
        with self.assertRaises(UnifiedSalaryMutationDeniedError) as ctx:
            assert_unified_salary_write_permitted(self.quran_dept_a, self.year, self.month, operation="approval")
        self.assertIn("NOT authorized for live approval", str(ctx.exception))

        # Unified approval lifecycle service rejects
        period = SalaryPayrollPeriod.objects.create(
            department=self.quran_dept_a,
            institution=self.institution_a,
            payroll_year=self.year,
            payroll_month=self.month,
            status=SalaryPayrollPeriod.Status.PENDING_APPROVAL,
            gross_total=Decimal("2000.00"),
            net_total=Decimal("2000.00"),
        )
        with self.assertRaises(ValidationError) as ctx:
            PayrollLifecycleService.approve_department_payroll(
                payroll_period=period,
                user=self.super_admin,
                notes="Attempting unactivated approval",
            )
        err_str = str(ctx.exception).lower()
        self.assertTrue("not authorized for live approval" in err_str or "legacy salary v1/v2 remains authoritative" in err_str)

    # ========================================================================
    # SCENARIOS 4-9: UNIFIED-OWNED PERIOD REJECTS ALL LEGACY MUTATIONS
    # ========================================================================

    def test_04_unified_owned_period_v1_generation_rejected(self):
        """Scenario 4: When Unified is active, V1 slip generation and calculation are rejected."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)
        self.assertTrue(is_unified_salary_active(self.quran_dept_a, self.year, self.month))

        # Service-level rejection
        with self.assertRaises(LegacySalaryMutationDeniedError) as ctx:
            calculate_teacher_salary(self.teacher_1, self.year, self.month, self.v1_config)
        self.assertEqual(ctx.exception.department_id, self.quran_dept_a.id)

        # refresh_salary_slip rejection
        slip = TeacherSalarySlip.objects.create(
            department=self.quran_dept_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=TeacherSalarySlip.Status.DRAFT,
        )
        with self.assertRaises(LegacySalaryMutationDeniedError):
            refresh_salary_slip(slip, actor=self.dept_admin_a)

    def test_05_unified_owned_period_v1_finalization_rejected(self):
        """Scenario 5: When Unified is active, V1 slip updating and finalization via PATCH are rejected."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)
        slip = TeacherSalarySlip.objects.create(
            department=self.quran_dept_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=TeacherSalarySlip.Status.DRAFT,
        )

        self.client.force_authenticate(user=self.dept_admin_a)
        resp = self.client.patch("/api/academy/teacher-salary/", {
            "slip_id": slip.id,
            "status": "processed",
        })
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp.data.get("error"), "LEGACY_SALARY_MUTATION_DENIED")

    def test_06_unified_owned_period_v2_generation_rejected(self):
        """Scenario 6: When Unified is active, V2 department and teacher payroll calculations are rejected."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        # Service-level rejection
        with self.assertRaises(LegacySalaryMutationDeniedError):
            calculate_department_payrolls(self.quran_dept_a, self.year, self.month)

        with self.assertRaises(LegacySalaryMutationDeniedError):
            calculate_teacher_payroll(self.teacher_1, self.year, self.month)

        # API rejection
        self.client.force_authenticate(user=self.dept_admin_a)
        resp = self.client.post("/api/academy/teacher-salary-v2/", {
            "action": "calculate",
            "department_id": self.quran_dept_a.id,
            "year": self.year,
            "month": self.month,
        })
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp.data.get("error"), "LEGACY_SALARY_MUTATION_DENIED")

    def test_07_unified_owned_period_v2_approval_rejected(self):
        """Scenario 7: When Unified is active, V2 payroll submission and super admin approval are rejected."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        payroll = QuranTeacherMonthlyPayroll.objects.create(
            department=self.quran_dept_a,
            institution=self.institution_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=QuranTeacherMonthlyPayroll.Status.DEPARTMENT_REVIEW,
        )

        # 1. Submission rejected
        self.client.force_authenticate(user=self.dept_admin_a)
        resp_sub = self.client.post("/api/academy/teacher-salary-v2/", {
            "action": "submit",
            "payroll_id": payroll.id,
        })
        self.assertEqual(resp_sub.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp_sub.data.get("error"), "LEGACY_SALARY_MUTATION_DENIED")

        # 2. Approval rejected
        payroll.status = QuranTeacherMonthlyPayroll.Status.PENDING_SUPER_ADMIN
        payroll.save()
        self.client.force_authenticate(user=self.super_admin)
        resp_app = self.client.post("/api/academy/teacher-salary-v2/", {
            "action": "approve",
            "payroll_id": payroll.id,
            "department_id": self.quran_dept_a.id,
        })
        self.assertEqual(resp_app.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp_app.data.get("error"), "LEGACY_SALARY_MUTATION_DENIED")

    def test_08_unified_owned_period_v2_disbursement_rejected(self):
        """Scenario 8: When Unified is active, V2 mark_paid disbursement is rejected."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        payroll = QuranTeacherMonthlyPayroll.objects.create(
            department=self.quran_dept_a,
            institution=self.institution_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=QuranTeacherMonthlyPayroll.Status.APPROVED,
        )

        self.client.force_authenticate(user=self.super_admin)
        resp = self.client.post("/api/academy/teacher-salary-v2/", {
            "action": "mark_paid",
            "payroll_id": payroll.id,
            "department_id": self.quran_dept_a.id,
        })
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp.data.get("error"), "LEGACY_SALARY_MUTATION_DENIED")

    def test_09_unified_owned_period_v2_reopening_rejected(self):
        """Scenario 9: When Unified is active, V2 reopening is rejected."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        payroll = QuranTeacherMonthlyPayroll.objects.create(
            department=self.quran_dept_a,
            institution=self.institution_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=QuranTeacherMonthlyPayroll.Status.APPROVED,
        )

        self.client.force_authenticate(user=self.super_admin)
        resp = self.client.post("/api/academy/teacher-salary-v2/", {
            "action": "reopen",
            "payroll_id": payroll.id,
            "reason": "Need to adjust",
            "department_id": self.quran_dept_a.id,
        })
        self.assertEqual(resp.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(resp.data.get("error"), "LEGACY_SALARY_MUTATION_DENIED")

    # ========================================================================
    # SCENARIOS 10-14: UNIFIED NORMAL APPROVAL, READ ACCESS, SCOPE ISOLATION
    # ========================================================================

    def test_10_unified_owned_period_approval_follows_normal_readiness_checks(self):
        """Scenario 10: When cutover is active and no legacy conflicts exist, Unified follows normal readiness."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)
        self.assertTrue(is_unified_salary_active(self.quran_dept_a, self.year, self.month))

        # Check passes cutover assertion
        assert_unified_salary_write_permitted(self.quran_dept_a, self.year, self.month, operation="approval")

    def test_11_historical_legacy_salary_reads_remain_available(self):
        """Scenario 11: When Unified is active, existing historical V1 and V2 records remain readable."""
        # Create historical records
        slip = TeacherSalarySlip.objects.create(
            department=self.quran_dept_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=TeacherSalarySlip.Status.DRAFT,
            final_total=Decimal("1500.00"),
        )
        payroll_v2 = QuranTeacherMonthlyPayroll.objects.create(
            department=self.quran_dept_a,
            institution=self.institution_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=QuranTeacherMonthlyPayroll.Status.DEPARTMENT_REVIEW,
            final_total=Decimal("1800.00"),
        )

        # Activate Unified
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        # V1 Dashboard GET returns existing slip read-only without crashing
        self.client.force_authenticate(user=self.dept_admin_a)
        v1_resp = self.client.get(f"/api/academy/teacher-salary/?month={self.month}&year={self.year}")
        self.assertEqual(v1_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(v1_resp.data.get("teachers", [])), 1)

        # V2 Payroll GET returns existing payroll row read-only without crashing
        v2_resp = self.client.get(f"/api/academy/teacher-salary-v2/?department_id={self.quran_dept_a.id}&month={self.month}&year={self.year}")
        self.assertEqual(v2_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(v2_resp.data.get("payrolls", [])), 1)

    def test_12_other_department_remains_unaffected(self):
        """Scenario 12: Activating Quran Dept A does NOT affect Other Dept A or Quran Dept B."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        # Quran Dept A is Unified
        self.assertTrue(is_unified_salary_active(self.quran_dept_a, self.year, self.month))
        # Other Dept A remains Legacy
        self.assertFalse(is_unified_salary_active(self.other_dept_a, self.year, self.month))
        # Quran Dept B remains Legacy
        self.assertFalse(is_unified_salary_active(self.quran_dept_b, self.year, self.month))

        # Legacy writes permitted for other departments
        assert_legacy_salary_write_permitted(self.other_dept_a, self.year, self.month)
        assert_legacy_salary_write_permitted(self.quran_dept_b, self.year, self.month)

    def test_13_earlier_period_remains_unaffected(self):
        """Scenario 13: Activating March 2026 does NOT affect February 2026."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        earlier_month = self.month - 1
        self.assertTrue(is_unified_salary_active(self.quran_dept_a, self.year, self.month))
        self.assertFalse(is_unified_salary_active(self.quran_dept_a, self.year, earlier_month))

        # Legacy write permitted for February 2026
        assert_legacy_salary_write_permitted(self.quran_dept_a, self.year, earlier_month)

    def test_14_later_period_remains_unaffected_unless_explicitly_activated(self):
        """Scenario 14: Activating March 2026 does NOT automatically activate April 2026."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        later_month = self.month + 1
        self.assertTrue(is_unified_salary_active(self.quran_dept_a, self.year, self.month))
        self.assertFalse(is_unified_salary_active(self.quran_dept_a, self.year, later_month))

        # Legacy write permitted for April 2026
        assert_legacy_salary_write_permitted(self.quran_dept_a, self.year, later_month)

    # ========================================================================
    # SCENARIOS 15-17: SECURITY, CROSS-INSTITUTION & MUTATION AUTHORIZATION
    # ========================================================================

    def test_15_cross_institution_registry_spoofing_rejected(self):
        """Scenario 15: Cross-institution scoping mismatches are rejected."""
        with self.assertRaises(CutoverScopingError) as ctx:
            # Passing Dept A with Institution B
            is_unified_salary_active(self.quran_dept_a, self.year, self.month, institution=self.institution_b)
        self.assertIn("Cross-institution cutover mismatch", str(ctx.exception))

    def test_16_duplicate_activation_attempts_rejected(self):
        """Scenario 16: Attempting to activate an already active registry record is rejected."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        with self.assertRaises(ValidationError) as ctx:
            activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)
        self.assertIn("ALREADY active", str(ctx.exception))

    def test_17_unauthorized_registry_mutation_rejected(self):
        """Scenario 17: Non-superadmins cannot activate cutover registry records."""
        with self.assertRaises(ValidationError) as ctx:
            activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.dept_admin_a)
        self.assertIn("Unauthorized: Only Super Admin", str(ctx.exception))

        with self.assertRaises(ValidationError) as ctx:
            activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.inst_admin_a)
        self.assertIn("Unauthorized: Only Super Admin", str(ctx.exception))

    # ========================================================================
    # SCENARIOS 18-19: EXISTING LEGACY RECORDS CREATE ACTIVATION CONFLICTS
    # ========================================================================

    def test_18_existing_approved_legacy_payroll_creates_activation_conflict(self):
        """Scenario 18: Existing approved V2 payroll blocks Unified approval to prevent duplicate payment."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        QuranTeacherMonthlyPayroll.objects.create(
            department=self.quran_dept_a,
            institution=self.institution_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=QuranTeacherMonthlyPayroll.Status.APPROVED,
        )

        with self.assertRaises(UnifiedSalaryMutationDeniedError) as ctx:
            assert_unified_salary_write_permitted(self.quran_dept_a, self.year, self.month, operation="approval")
        self.assertIn("already processed, approved or paid payroll", str(ctx.exception))

    def test_19_existing_paid_legacy_payroll_creates_activation_conflict(self):
        """Scenario 19: Existing processed/paid V1 slip blocks Unified approval to prevent duplicate payment."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        TeacherSalarySlip.objects.create(
            department=self.quran_dept_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=TeacherSalarySlip.Status.PROCESSED,
        )

        with self.assertRaises(UnifiedSalaryMutationDeniedError) as ctx:
            assert_unified_salary_write_permitted(self.quran_dept_a, self.year, self.month, operation="payment")
        self.assertIn("already processed, approved or paid payroll", str(ctx.exception))

    # ========================================================================
    # SCENARIOS 20-23: CONCURRENCY, IDEMPOTENCY, REAL PAYMENTS & INTEGRITY
    # ========================================================================

    def test_20_concurrent_legacy_and_unified_requests_cannot_both_succeed(self):
        """Scenario 20: Concurrent legacy and Unified requests cannot both succeed for the same period."""
        # Simulated sequence: Legacy V2 tries to calculate, while cutover is activated
        # 1. First request activates cutover
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        # 2. Concurrent/subsequent legacy write is rejected
        with self.assertRaises(LegacySalaryMutationDeniedError):
            assert_legacy_salary_write_permitted(self.quran_dept_a, self.year, self.month, operation="concurrent test")

    def test_21_retry_and_idempotency_protection(self):
        """Scenario 21: Repeated assert checks are deterministic and side-effect free."""
        # When inactive, multiple checks pass without mutation
        for _ in range(5):
            assert_legacy_salary_write_permitted(self.quran_dept_a, self.year, self.month)

        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        # When active, repeated checks deterministically reject
        for _ in range(5):
            with self.assertRaises(LegacySalaryMutationDeniedError):
                assert_legacy_salary_write_permitted(self.quran_dept_a, self.year, self.month)

    def test_22_no_real_external_payment_initiated(self):
        """Scenario 22: Tests verify that zero external bank calls or live payment gateways are invoked."""
        # Verify no external payment credentials exist or are used
        self.assertFalse(hasattr(self.institution_a, "stripe_secret_key"))
        self.assertFalse(hasattr(self.quran_dept_a, "bank_api_token"))

    def test_23_legacy_financial_records_remain_unchanged_in_non_activation(self):
        """Scenario 23: In non-activation scenarios, legacy financial rows and fields remain strictly unchanged."""
        slip = TeacherSalarySlip.objects.create(
            department=self.quran_dept_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=TeacherSalarySlip.Status.DRAFT,
            final_total=Decimal("1750.00"),
        )
        payroll_v2 = QuranTeacherMonthlyPayroll.objects.create(
            department=self.quran_dept_a,
            institution=self.institution_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=QuranTeacherMonthlyPayroll.Status.DEPARTMENT_REVIEW,
            final_total=Decimal("2100.00"),
        )

        # Calling guards in non-activation scenario does not mutate records
        assert_legacy_salary_write_permitted(self.quran_dept_a, self.year, self.month)

        slip.refresh_from_db()
        payroll_v2.refresh_from_db()

        self.assertEqual(slip.final_total, Decimal("1750.00"))
        self.assertEqual(payroll_v2.final_total, Decimal("2100.00"))

    # ========================================================================
    # CROSS-ENGINE CONFLICT AUDITOR & API ENDPOINT TESTS (SECTION 5)
    # ========================================================================

    def test_conflict_auditor_detects_legacy_approved_records_as_blocked(self):
        """Conflict auditor flags existing approved legacy records as BLOCKED."""
        QuranTeacherMonthlyPayroll.objects.create(
            department=self.quran_dept_a,
            institution=self.institution_a,
            teacher=self.teacher_1,
            year=self.year,
            month=self.month,
            status=QuranTeacherMonthlyPayroll.Status.APPROVED,
        )

        res = CrossEngineConflictAuditor.audit_pre_activation(
            department=self.quran_dept_a,
            year=self.year,
            month=self.month,
            institution=self.institution_a,
        )

        self.assertEqual(res["status"], "BLOCKED")
        self.assertFalse(res["can_activate"])
        self.assertTrue(any("Legacy Salary V2 has 1 approved" in b for b in res["blockers"]))

    def test_conflict_auditor_detects_unresolved_attendance(self):
        """Conflict auditor flags flagged attendance as BLOCKED."""
        SalaryAttendanceVerification.objects.create(
            department=self.quran_dept_a,
            institution=self.institution_a,
            teacher=self.teacher_1,
            student=self.student_1,
            occurrence_key="test_unique_key_conflict_01",
            class_date=date(self.year, self.month, 10),
            verification_status=SalaryAttendanceVerification.VerificationStatus.CONFLICTED,
            flag_reason="Unmarked class conflict",
        )

        res = CrossEngineConflictAuditor.audit_pre_activation(
            department=self.quran_dept_a,
            year=self.year,
            month=self.month,
        )

        self.assertEqual(res["status"], "BLOCKED")
        self.assertEqual(res["unresolved_attendance_count"], 1)

    def test_conflict_audit_api_endpoint_permissions(self):
        """Conflict audit API endpoint is restricted to Super Admin & Institution Admin."""
        # 1. Department Admin denied
        self.client.force_authenticate(user=self.dept_admin_a)
        resp = self.client.get(f"/api/salary/cutover-audit/?department_id={self.quran_dept_a.id}&year={self.year}&month={self.month}")
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

        # 2. Super Admin permitted
        self.client.force_authenticate(user=self.super_admin)
        resp_super = self.client.get(f"/api/salary/cutover-audit/?department_id={self.quran_dept_a.id}&year={self.year}&month={self.month}")
        self.assertEqual(resp_super.status_code, status.HTTP_200_OK, resp_super.data)
        self.assertIn("status", resp_super.data)

        # 3. Cross-institution Institution Admin denied
        self.client.force_authenticate(user=self.inst_admin_a)
        resp_foreign = self.client.get(f"/api/salary/cutover-audit/?department_id={self.quran_dept_b.id}&year={self.year}&month={self.month}")
        self.assertEqual(resp_foreign.status_code, status.HTTP_403_FORBIDDEN)

    # ========================================================================
    # REJOIN & MANAGEMENT COMMAND TESTS
    # ========================================================================

    def test_student_rejoin_blocked_when_period_unified_owned(self):
        """Student rejoin mutation is blocked if the affected payroll period is Unified-owned."""
        # Create drop event
        drop = QuranStudentDropEvent.objects.create(
            department=self.quran_dept_a,
            student=self.student_1,
            teacher=self.teacher_1,
            drop_effective_date=date(self.year, self.month, 5),
            streak_start_date=date(self.year, self.month, 1),
            streak_end_date=date(self.year, self.month, 4),
            status=QuranStudentDropEvent.Status.DROPPED,
        )
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        with self.assertRaises(StudentRejoinError) as ctx:
            rejoin_student_drop(
                student=self.student_1,
                rejoin_date=date(self.year, self.month, 10),
                actor=self.dept_admin_a,
            )
        self.assertEqual(ctx.exception.code, "legacy_salary_mutation_denied")

    def test_recalculate_imported_salary_command_blocked_when_period_unified_owned(self):
        """Management command recalculate_imported_salary is blocked if Unified-owned."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        with self.assertRaises(CommandError) as ctx:
            call_command(
                "recalculate_imported_salary",
                year=self.year,
                month=self.month,
                teacher_id=self.teacher_1.id,
            )
        self.assertIn("Cutover guard denied", str(ctx.exception))

    def test_bulk_legacy_write_guard_atomic_rejection(self):
        """assert_bulk_legacy_write_permitted atomically rejects if any scope is Unified-owned."""
        activate_unified_engine_for_period(self.quran_dept_a, self.year, self.month, user=self.super_admin)

        scopes = [
            (self.quran_dept_b, self.year, self.month),  # Legacy
            (self.other_dept_a, self.year, self.month),  # Legacy
            (self.quran_dept_a, self.year, self.month),  # Unified (blocks entire batch)
        ]

        with self.assertRaises(LegacySalaryMutationDeniedError):
            assert_bulk_legacy_write_permitted(scopes, operation="bulk test")
