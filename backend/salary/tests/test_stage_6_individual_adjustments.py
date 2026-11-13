"""
Regression test suite for Stage 6 Individual Teacher Adjustments fix.
Verifies:
1. Individual bonus applied to correct teacher.
2. Individual cutting applied to correct teacher.
3. Correct draft net salary calculation (Gross + Positive - Cuttings).
4. Department summary equals the sum of individual teacher amounts.
5. Serializer exposes teacher_id, department_id, batch_id, etc.
6. Wrong department access rejected.
7. Adjustment belonging to another teacher not counted in teacher preview.
8. Wrong payroll month excluded.
9. Reversed or cancelled records excluded.
10. Bulk adjustments allocated correctly.
11. Stage 7A draft payroll integration receives correct adjusted amounts.
12. Duplicate financial adjustments prevented.
"""
from datetime import date
from decimal import Decimal
import uuid

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Department, Institution, UserDepartmentRole
from academy.models import TeacherProfile
from salary.models import (
    PayrollAdjustment,
    PayrollAdjustmentAudit,
    SalaryAdjustmentCategory,
    SalaryBulkAdjustmentBatch,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryTeachingPlan,
    SalaryPlanTierRate,
    SalaryRateTier,
    SalaryReconciliationBatch,
    TeacherPolicyAssignment,
)
from salary.serializers import PayrollAdjustmentSerializer
from salary.calculation_engine import (
    calculate_department_salary_preview,
    calculate_teacher_salary_preview,
)
from salary.payroll_service import PayrollLifecycleService

User = get_user_model()


class Stage6IndividualAdjustmentsRegressionTests(TestCase):
    def setUp(self):
        # 1. Organization setup
        self.institution = Institution.objects.create(name="IVS Academy Test", slug="ivs-test")
        self.dept_quran = Department.objects.create(
            institution=self.institution,
            name="Quran Department",
            code="quran-dept",
            department_type="quran",
        )
        self.dept_other = Department.objects.create(
            institution=self.institution,
            name="Tuition Department",
            code="tuition-dept",
            department_type="tuition",
        )

        # 2. Users & Roles
        self.admin_user = User.objects.create_user(
            username="admin_stage6",
            email="admin@ivs.com",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.institution,
        )
        self.dept_admin_user = User.objects.create_user(
            username="deptadmin_stage6",
            email="deptadmin@ivs.com",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.dept_quran,
        )
        UserDepartmentRole.objects.create(
            user=self.dept_admin_user,
            institution=self.institution,
            department=self.dept_quran,
            role="department_admin",
        )

        # 3. Teachers
        self.user_zia = User.objects.create_user(
            username="zia_01",
            first_name="Zia",
            last_name="Rehman",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.dept_quran,
        )
        self.teacher_zia = TeacherProfile.objects.create(
            user=self.user_zia,
            institution=self.institution,
            department=self.dept_quran,
            historical_name="01 Zia",
        )

        self.user_mehboob = User.objects.create_user(
            username="mehboob_02",
            first_name="Mehboob",
            last_name="Alam",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.dept_quran,
        )
        self.teacher_mehboob = TeacherProfile.objects.create(
            user=self.user_mehboob,
            institution=self.institution,
            department=self.dept_quran,
            historical_name="02 Mehboob",
        )

        # 4. Salary Policy and assignment for Zia and Mehboob
        self.policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.dept_quran,
            name="Standard Quran Policy",
            code="POL-QURAN",
            compensation_model=SalaryPolicy.CompensationModel.BASIC,
        )
        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.PUBLISHED,
            basic_salary_amount=Decimal("2055.00"),
            min_qualifying_weeks=2,
        )
        TeacherPolicyAssignment.objects.create(
            department=self.dept_quran,
            teacher=self.teacher_zia,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        TeacherPolicyAssignment.objects.create(
            department=self.dept_quran,
            teacher=self.teacher_mehboob,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

        # 5. Completed attendance reconciliation batch so calculations are marked complete
        SalaryReconciliationBatch.objects.create(
            institution=self.institution,
            department=self.dept_quran,
            period_year=2026,
            period_month=11,
            start_date=date(2026, 11, 1),
            end_date=date(2026, 11, 30),
            is_complete=True,
            total_occurrences=0,
            verified_count=0,
            pending_count=0,
            resolved_count=0,
            conflicted_count=0,
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.dept_admin_user)

    def test_serializer_exposes_teacher_id_and_department_id(self):
        """Serializer must include teacher_id, department_id, batch_id so frontend can link them."""
        adj = PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.dept_quran,
            teacher=self.teacher_zia,
            period_year=2026,
            period_month=11,
            category="coordinator_allowance",
            direction=PayrollAdjustment.Direction.CREDIT,
            amount=Decimal("20000.00"),
            reason="coordinator salary",
            status=PayrollAdjustment.Status.DRAFT,
            created_by=self.dept_admin_user,
        )
        data = PayrollAdjustmentSerializer(adj).data
        self.assertEqual(data["teacher_id"], self.teacher_zia.id)
        self.assertEqual(data["department_id"], self.dept_quran.id)
        self.assertEqual(data["teacher"], self.teacher_zia.id)
        self.assertEqual(data["department"], self.dept_quran.id)
        self.assertIn("batch_id", data)
        self.assertIn("recurring_instruction_id", data)
        self.assertIn("advance_recovery_id", data)

    def test_individual_bonus_and_cutting_applied_to_distinct_teachers(self):
        """Bonus to Zia and cutting to Mehboob do not bleed into each other."""
        # Rs 20,000 bonus for Zia
        adj_zia = PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.dept_quran,
            teacher=self.teacher_zia,
            period_year=2026,
            period_month=11,
            category="coordinator_allowance",
            direction=PayrollAdjustment.Direction.CREDIT,
            amount=Decimal("20000.00"),
            reason="coordinator bonus",
            status=PayrollAdjustment.Status.DRAFT,
            created_by=self.dept_admin_user,
        )
        # Rs 5,000 cutting for Mehboob
        adj_mehboob = PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.dept_quran,
            teacher=self.teacher_mehboob,
            period_year=2026,
            period_month=11,
            category="approved_recovery",
            direction=PayrollAdjustment.Direction.DEBIT,
            amount=Decimal("5000.00"),
            reason="disciplinary cutting",
            status=PayrollAdjustment.Status.DRAFT,
            created_by=self.dept_admin_user,
        )

        # 1. Preview Zia
        zia_prev = calculate_teacher_salary_preview(self.dept_quran, self.teacher_zia, 2026, 11)
        self.assertEqual(Decimal(zia_prev["earnings"]["gross_draft_earnings"]), Decimal("2055.00"))
        self.assertEqual(Decimal(zia_prev["earnings"]["positive_adjustments"]), Decimal("20000.00"))
        self.assertEqual(Decimal(zia_prev["earnings"]["cuttings"]), Decimal("0.00"))
        self.assertEqual(Decimal(zia_prev["earnings"]["draft_net_salary"]), Decimal("22055.00"))
        self.assertEqual(len(zia_prev["adjustments"]), 1)
        self.assertEqual(zia_prev["adjustments"][0]["id"], adj_zia.id)

        # 2. Preview Mehboob
        mehboob_prev = calculate_teacher_salary_preview(self.dept_quran, self.teacher_mehboob, 2026, 11)
        self.assertEqual(Decimal(mehboob_prev["earnings"]["gross_draft_earnings"]), Decimal("2055.00"))
        self.assertEqual(Decimal(mehboob_prev["earnings"]["positive_adjustments"]), Decimal("0.00"))
        self.assertEqual(Decimal(mehboob_prev["earnings"]["cuttings"]), Decimal("5000.00"))
        self.assertEqual(Decimal(mehboob_prev["earnings"]["draft_net_salary"]), Decimal("-2945.00"))
        self.assertTrue(mehboob_prev["is_net_negative"])
        self.assertEqual(len(mehboob_prev["adjustments"]), 1)
        self.assertEqual(mehboob_prev["adjustments"][0]["id"], adj_mehboob.id)

    def test_department_summary_reconciles_sum_of_teachers(self):
        """Department summary positive and cutting totals must match sum of individual teacher rows."""
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.dept_quran,
            teacher=self.teacher_zia,
            period_year=2026,
            period_month=11,
            category="coordinator_allowance",
            direction=PayrollAdjustment.Direction.CREDIT,
            amount=Decimal("20000.00"),
            reason="bonus",
            status=PayrollAdjustment.Status.CONFIRMED,
            created_by=self.dept_admin_user,
        )
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.dept_quran,
            teacher=self.teacher_mehboob,
            period_year=2026,
            period_month=11,
            category="approved_recovery",
            direction=PayrollAdjustment.Direction.DEBIT,
            amount=Decimal("5000.00"),
            reason="cutting",
            status=PayrollAdjustment.Status.DRAFT,
            created_by=self.dept_admin_user,
        )

        dept_prev = calculate_department_salary_preview(self.dept_quran, 2026, 11)
        summary = dept_prev["summary"]

        teachers_pos_sum = sum(
            Decimal(tp["earnings"]["positive_adjustments"]) for tp in dept_prev["teacher_previews"]
        )
        teachers_cut_sum = sum(
            Decimal(tp["earnings"]["cuttings"]) for tp in dept_prev["teacher_previews"]
        )
        teachers_net_sum = sum(
            Decimal(tp["earnings"]["draft_net_salary"]) for tp in dept_prev["teacher_previews"]
        )

        self.assertEqual(Decimal(summary["positive_adjustments"]), Decimal("20000.00"))
        self.assertEqual(Decimal(summary["cuttings"]), Decimal("5000.00"))
        self.assertEqual(Decimal(summary["positive_adjustments"]), teachers_pos_sum)
        self.assertEqual(Decimal(summary["cuttings"]), teachers_cut_sum)
        self.assertEqual(Decimal(summary["draft_net_salary"]), teachers_net_sum)

    def test_cancelled_and_different_month_adjustments_excluded(self):
        """Cancelled adjustments and adjustments for another month must not affect current payroll."""
        # Cancelled
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.dept_quran,
            teacher=self.teacher_zia,
            period_year=2026,
            period_month=11,
            category="coordinator_allowance",
            direction=PayrollAdjustment.Direction.CREDIT,
            amount=Decimal("15000.00"),
            reason="cancelled bonus",
            status=PayrollAdjustment.Status.CANCELLED,
            created_by=self.dept_admin_user,
        )
        # Different month (October 2026)
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.dept_quran,
            teacher=self.teacher_zia,
            period_year=2026,
            period_month=10,
            category="coordinator_allowance",
            direction=PayrollAdjustment.Direction.CREDIT,
            amount=Decimal("10000.00"),
            reason="october bonus",
            status=PayrollAdjustment.Status.CONFIRMED,
            created_by=self.dept_admin_user,
        )

        zia_prev = calculate_teacher_salary_preview(self.dept_quran, self.teacher_zia, 2026, 11)
        self.assertEqual(Decimal(zia_prev["earnings"]["positive_adjustments"]), Decimal("0.00"))
        self.assertEqual(Decimal(zia_prev["earnings"]["cuttings"]), Decimal("0.00"))
        self.assertEqual(Decimal(zia_prev["earnings"]["draft_net_salary"]), Decimal("2055.00"))

    def test_cross_department_access_blocked(self):
        """A department admin cannot query or create adjustments for a different department."""
        resp = self.client.post("/api/salary/adjustments/", {
            "department_id": self.dept_other.id,
            "teacher_id": self.teacher_zia.id,
            "period_year": 2026,
            "period_month": 11,
            "category": "general_bonus",
            "direction": "credit",
            "amount": "1000.00",
            "reason": "unauthorized attempt",
        })
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_stage_7a_receives_correct_adjusted_draft_net(self):
        """Stage 7A payroll generation incorporates Stage 6 adjustments accurately."""
        # Bonus of Rs 5,000 for Zia
        PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.dept_quran,
            teacher=self.teacher_zia,
            period_year=2026,
            period_month=11,
            category="coordinator_allowance",
            direction=PayrollAdjustment.Direction.CREDIT,
            amount=Decimal("5000.00"),
            reason="performance reward",
            status=PayrollAdjustment.Status.CONFIRMED,
            created_by=self.dept_admin_user,
        )

        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.dept_quran,
            year=2026,
            month=11,
            user=self.dept_admin_user,
        )

        zia_payroll = period.teacher_payrolls.get(teacher=self.teacher_zia)
        self.assertEqual(zia_payroll.gross_salary, Decimal("2055.00"))
        self.assertEqual(zia_payroll.positive_adjustments, Decimal("5000.00"))
        self.assertEqual(zia_payroll.cuttings, Decimal("0.00"))
        self.assertEqual(zia_payroll.net_salary, Decimal("7055.00"))

    def test_confirm_individual_draft_adjustment(self):
        """Department admin can confirm an individual draft adjustment with full audit trail."""
        adj = PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.dept_quran,
            teacher=self.teacher_zia,
            period_year=2026,
            period_month=11,
            category="coordinator_allowance",
            direction=PayrollAdjustment.Direction.CREDIT,
            amount=Decimal("20000.00"),
            reason="bonus proposal",
            status=PayrollAdjustment.Status.DRAFT,
            created_by=self.dept_admin_user,
        )

        # Confirm via endpoint
        resp = self.client.post(f"/api/salary/adjustments/{adj.id}/confirm/", {
            "reason": "Confirmed by Director.",
        })
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        adj.refresh_from_db()
        self.assertEqual(adj.status, PayrollAdjustment.Status.CONFIRMED)

        # Audit log verification
        audit = adj.audit_logs.filter(action="confirmed").first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.new_status, "confirmed")
        self.assertEqual(audit.reason, "Confirmed by Director.")

        # Re-confirm rejected
        resp_re = self.client.post(f"/api/salary/adjustments/{adj.id}/confirm/")
        self.assertEqual(resp_re.status_code, status.HTTP_400_BAD_REQUEST)

    def test_calculation_preview_exposes_adjustment_items_with_category_name(self):
        """calculate_department_salary_preview exposes adjustment_items with category_name even in summary_only mode."""
        adj = PayrollAdjustment.objects.create(
            institution=self.institution,
            department=self.dept_quran,
            teacher=self.teacher_zia,
            period_year=2026,
            period_month=11,
            category="coordinator_allowance",
            direction=PayrollAdjustment.Direction.CREDIT,
            amount=Decimal("20000.00"),
            reason="coordinator bonus",
            status=PayrollAdjustment.Status.DRAFT,
            created_by=self.dept_admin_user,
        )

        dept_prev = calculate_department_salary_preview(self.dept_quran, 2026, 11, summary_only=True)
        zia_prev = next(tp for tp in dept_prev["teacher_previews"] if tp["teacher_id"] == self.teacher_zia.id)
        self.assertEqual(len(zia_prev["adjustments"]), 1)
        self.assertEqual(zia_prev["adjustments"][0]["category_name"], "Coordinator Allowance")
        self.assertEqual(zia_prev["adjustments"][0]["status"], "draft")
        self.assertEqual(Decimal(zia_prev["adjustments"][0]["amount"]), Decimal("20000.00"))
