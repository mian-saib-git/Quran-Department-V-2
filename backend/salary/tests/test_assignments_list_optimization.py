from datetime import date

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Department, Institution, User
from academy.models import TeacherProfile
from salary.models import (
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    SalaryPlanTierRate,
    TeacherPolicyAssignment,
)


class SalaryAssignmentListOptimizationTests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(
            name="Salary Opt Inst",
            slug="salary-opt-inst",
        )
        self.dept_a = Department.objects.create(
            institution=self.institution,
            name="Quran Sal A",
            code="quran-sal-a",
            department_type=Department.DepartmentType.QURAN,
        )
        self.dept_b = Department.objects.create(
            institution=self.institution,
            name="Quran Sal B",
            code="quran-sal-b",
            department_type=Department.DepartmentType.QURAN,
        )
        self.admin_a = User.objects.create_user(
            username="sal_admin_a",
            password="Password123!",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.dept_a,
        )
        self.admin_b = User.objects.create_user(
            username="sal_admin_b",
            password="Password123!",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.dept_b,
        )
        self.teacher_user = User.objects.create_user(
            username="sal_teacher_a",
            password="Password123!",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.dept_a,
            first_name="Sal",
            last_name="Teacher",
        )
        self.teacher = TeacherProfile.objects.create(
            user=self.teacher_user,
            institution=self.institution,
            department=self.dept_a,
        )
        self.policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.dept_a,
            name="Standard Policy",
            code="STD-01",
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
            is_active=True,
        )
        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
        )
        self.tier = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="1-5 Students",
            min_students=1,
            max_students=5,
            sort_order=1,
        )
        self.plan = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_code="5D",
            plan_name="5 Days",
            days_per_week=5,
        )
        SalaryPlanTierRate.objects.create(
            policy_version=self.version,
            teaching_plan=self.plan,
            rate_tier=self.tier,
            rate_per_class="250.00",
        )
        self.version.status = SalaryPolicyVersion.Status.PUBLISHED
        self.version.save(update_fields=["status"])
        self.snapshot = {
            "policy_id": self.policy.id,
            "policy": {"id": self.policy.id, "name": "Standard Policy", "code": "STD-01"},
            "versions": [{"id": self.version.id, "version_number": 1}],
        }
        self.active_assignment = TeacherPolicyAssignment.objects.create(
            department=self.dept_a,
            teacher=self.teacher,
            policy=self.policy,
            policy_snapshot_name="Standard Policy",
            policy_snapshot_code="STD-01",
            archived_policy_snapshot=self.snapshot,
            effective_from=date(2026, 2, 1),
            is_active=True,
            basic_salary_override="15000.00",
            assigned_by=self.admin_a,
        )
        self.archived_assignment = TeacherPolicyAssignment.objects.create(
            department=self.dept_a,
            teacher=self.teacher,
            policy=None,
            policy_snapshot_name="Legacy Policy",
            policy_snapshot_code="LEG-01",
            archived_policy_snapshot=self.snapshot,
            effective_from=date(2025, 1, 1),
            effective_to=date(2026, 1, 31),
            is_active=False,
            assigned_by=self.admin_a,
        )

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    def test_list_omits_snapshot_while_detail_and_opt_in_preserve_it(self):
        client = self._client(self.admin_a)

        list_resp = client.get(
            f"/api/salary/assignments/?department_id={self.dept_a.id}",
            HTTP_HOST="localhost",
        )
        self.assertEqual(list_resp.status_code, 200)
        rows = list_resp.json()
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertNotIn("archived_policy_snapshot", row)
            self.assertIn("policy_snapshot_name", row)
            self.assertIn("policy_snapshot_code", row)

        # Detail endpoint preserves full archived_policy_snapshot
        det_resp = client.get(
            f"/api/salary/assignments/{self.archived_assignment.id}/",
            HTTP_HOST="localhost",
        )
        self.assertEqual(det_resp.status_code, 200)
        self.assertEqual(det_resp.json()["archived_policy_snapshot"], self.snapshot)
        self.assertEqual(det_resp.json()["policy_name"], "Legacy Policy")

        # Opt-in include_snapshot=true preserves full snapshot on list
        opt_resp = client.get(
            f"/api/salary/assignments/?department_id={self.dept_a.id}&include_snapshot=true",
            HTTP_HOST="localhost",
        )
        self.assertEqual(opt_resp.status_code, 200)
        self.assertEqual(opt_resp.json()[0]["archived_policy_snapshot"], self.snapshot)

    def test_optional_pagination_and_department_isolation(self):
        client_a = self._client(self.admin_a)
        page_resp = client_a.get(
            f"/api/salary/assignments/?department_id={self.dept_a.id}&page=1&page_size=1",
            HTTP_HOST="localhost",
        )
        self.assertEqual(page_resp.status_code, 200)
        body = page_resp.json()
        self.assertEqual(body["count"], 2)
        self.assertEqual(body["total_pages"], 2)
        self.assertEqual(body["next"], 2)
        self.assertEqual(len(body["results"]), 1)

        bad_resp = client_a.get(
            f"/api/salary/assignments/?department_id={self.dept_a.id}&page=0",
            HTTP_HOST="localhost",
        )
        self.assertEqual(bad_resp.status_code, 400)

        # Cross-department isolation: admin_b cannot see dept_a assignments
        client_b = self._client(self.admin_b)
        cross_resp = client_b.get(
            f"/api/salary/assignments/?department_id={self.dept_a.id}",
            HTTP_HOST="localhost",
        )
        self.assertEqual(cross_resp.status_code, 200)
        self.assertEqual(cross_resp.json(), [])
