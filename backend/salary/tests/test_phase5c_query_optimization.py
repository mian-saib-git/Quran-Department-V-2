from datetime import date
from decimal import Decimal
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Department, Institution, User
from academy.models import TeacherProfile
from salary.models import (
    PayrollAdjustment,
    PayrollAdjustmentAudit,
    SalaryAdjustmentCategory,
    SalaryPlanTierBasicSalary,
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
)


class Phase5CQueryOptimizationTests(TestCase):
    def setUp(self):
        self.inst = Institution.objects.create(name="IVS 5C Inst", slug="ivs-5c")
        self.dept = Department.objects.create(
            institution=self.inst, name="Quran 5C", code="quran-5c", department_type="quran"
        )
        self.other_dept = Department.objects.create(
            institution=self.inst, name="Tuition 5C", code="tuition-5c", department_type="tuition"
        )
        self.admin = User.objects.create_user(
            username="admin5c", first_name="Admin", last_name="One", password="pw",
            role=User.Role.DEPARTMENT_ADMIN, institution=self.inst, department=self.dept,
        )
        self.other_admin = User.objects.create_user(
            username="other5c", password="pw",
            role=User.Role.DEPARTMENT_ADMIN, institution=self.inst, department=self.other_dept,
        )

        self.u_t1 = User.objects.create_user(
            username="t1_5c", first_name="Bilal", last_name="Tariq", password="pw",
            role=User.Role.TEACHER, institution=self.inst, department=self.dept,
        )
        self.t1 = TeacherProfile.objects.create(user=self.u_t1, institution=self.inst, department=self.dept)

        self.cat1 = SalaryAdjustmentCategory.objects.create(
            institution=self.inst, department=self.dept, code="bonus_5c", name="Bonus 5C", direction="credit", is_active=True
        )
        self.cat2 = SalaryAdjustmentCategory.objects.create(
            institution=self.inst, department=self.dept, code="cut_5c", name="Cut 5C", direction="debit", is_active=True
        )

        for i in range(15):
            adj = PayrollAdjustment.objects.create(
                institution=self.inst,
                department=self.dept,
                teacher=self.t1,
                period_year=2026,
                period_month=11,
                category=self.cat1.code if i % 2 == 0 else self.cat2.code,
                direction="credit" if i % 2 == 0 else "debit",
                amount=Decimal("250.00"),
                reason=f"Reason {i}",
                created_by=self.admin,
            )
            PayrollAdjustmentAudit.objects.create(
                adjustment=adj,
                action="created",
                new_amount=Decimal("250.00"),
                actor=self.admin,
                reason=f"Audit {i}",
            )

        self.policy = SalaryPolicy.objects.create(
            institution=self.inst, department=self.dept, name="Policy 5C", code="POL5C"
        )
        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
            coordinator_qualifying_weekdays=["friday", "saturday"],
            published_by=self.admin,
        )
        tiers = [
            SalaryRateTier.objects.create(
                policy_version=self.version, tier_name=f"T{i}", min_students=i, max_students=i, sort_order=i
            )
            for i in range(1, 5)
        ]
        plans = [
            SalaryTeachingPlan.objects.create(
                policy_version=self.version,
                plan_code=f"p{i}",
                plan_name=f"Plan {i}",
                days_per_week=i,
                is_coordinator_special=(i == 4),
                sort_order=i,
            )
            for i in range(1, 5)
        ]
        for p in plans:
            for t in tiers:
                SalaryPlanTierRate.objects.create(
                    policy_version=self.version, teaching_plan=p, rate_tier=t, rate_per_class=Decimal("100.00")
                )
                SalaryPlanTierBasicSalary.objects.create(
                    policy_version=self.version, teaching_plan=p, rate_tier=t, basic_salary_amount=Decimal("5000.00")
                )

        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_adjustments_list_bounded_queries_and_completeness(self):
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get(f"/api/salary/adjustments/?department_id={self.dept.id}&year=2026&month=11")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 15)
        self.assertLessEqual(len(ctx.captured_queries), 6)
        first = res.data[0]
        self.assertIn(first["category_name"], {"Bonus 5C", "Cut 5C"})
        self.assertEqual(len(first["audit_logs"]), 1)
        self.assertEqual(first["audit_logs"][0]["actor_name"], "Admin One")

        # Cross-department isolation
        self.client.force_authenticate(user=self.other_admin)
        res_other = self.client.get(f"/api/salary/adjustments/?department_id={self.dept.id}&year=2026&month=11")
        self.assertEqual(res_other.status_code, 200)
        self.assertEqual(len(res_other.data), 0)

    def test_policy_versions_bounded_queries_and_matrix_completeness(self):
        with CaptureQueriesContext(connection) as ctx_list:
            r_list = self.client.get(f"/api/salary/versions/?policy_id={self.policy.id}")
        self.assertEqual(r_list.status_code, 200)
        self.assertLessEqual(len(ctx_list.captured_queries), 7)

        with CaptureQueriesContext(connection) as ctx_detail:
            r_det = self.client.get(f"/api/salary/versions/{self.version.id}/")
        self.assertEqual(r_det.status_code, 200)
        self.assertLessEqual(len(ctx_detail.captured_queries), 7)
        self.assertEqual(r_det.data["tiers_count"], 4)
        self.assertEqual(r_det.data["plans_count"], 4)
        self.assertEqual(r_det.data["rates_count"], 16)
        self.assertEqual(r_det.data["basic_salaries_count"], 16)
        self.assertEqual(r_det.data["coordinator_qualifying_weekdays"], ["friday", "saturday"])
