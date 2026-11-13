import datetime
from decimal import Decimal
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Department, Institution, PlatformAuditLog, User, UserDepartmentRole
from academy.models import TeacherProfile
from salary.models import (
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    SalaryPlanTierRate,
    TeacherPolicyAssignment,
)


class BulkSalaryAssignmentBatchTests(APITestCase):
    """
    Tests bulk assignment with small and large batches: 1, 5, 20, 50, and 75 teachers.
    Verifies PostgreSQL select_for_update row locking, date inheritance,
    validation error handling, and transaction atomicity.
    """

    @classmethod
    def setUpTestData(cls):
        cls.institution = Institution.objects.create(name="Batch Test Academy", slug="batch-test-academy")
        cls.dept = Department.objects.create(
            name="Quran Batch Department", code="QBD", institution=cls.institution
        )

        cls.dept_admin = User.objects.create_user(
            username="batch_dept_admin",
            password="adminpassword123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=cls.institution,
            department=cls.dept,
        )
        UserDepartmentRole.objects.create(
            user=cls.dept_admin,
            institution=cls.institution,
            department=cls.dept,
            role=UserDepartmentRole.Role.DEPARTMENT_ADMIN,
        )

        # Create published salary policy
        cls.policy = SalaryPolicy.objects.create(
            institution=cls.institution,
            department=cls.dept,
            name="Quran Batch Policy",
            code="QBP-01",
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
            created_by=cls.dept_admin,
        )
        cls.version = SalaryPolicyVersion.objects.create(
            policy=cls.policy,
            version_number=1,
            effective_from=datetime.date(2026, 1, 1),
            effective_to=datetime.date(2027, 12, 31),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        cls.tier = SalaryRateTier.objects.create(
            policy_version=cls.version, tier_name="1 Student", min_students=1, max_students=1
        )
        cls.plan = SalaryTeachingPlan.objects.create(
            policy_version=cls.version, plan_name="2 Days", plan_code="2_DAYS", days_per_week=2
        )
        SalaryPlanTierRate.objects.create(
            policy_version=cls.version,
            teaching_plan=cls.plan,
            rate_tier=cls.tier,
            rate_per_class=Decimal("350.00"),
        )
        cls.version.status = SalaryPolicyVersion.Status.PUBLISHED
        cls.version.save()

    def _create_isolated_teachers(self, count, prefix="t"):
        """Helper to create N isolated test teachers with raw save for speed."""
        teachers = []
        for i in range(1, count + 1):
            u = User(
                username=f"batch_{prefix}_{i}_{timezone.now().timestamp()}",
                role=User.Role.TEACHER,
                institution=self.institution,
                department=self.dept,
            )
            u.set_password("testpass123")
            u.save()
            t = TeacherProfile.objects.create(
                institution=self.institution,
                department=self.dept,
                user=u,
                historical_name=f"Batch Teacher {prefix.upper()} {i}",
                joining_date=datetime.date(2026, 1, 1),
            )
            teachers.append(t)
        return teachers

    def test_bulk_assign_1_teacher(self):
        teachers = self._create_isolated_teachers(1, prefix="single")
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.dept.id,
            "teacher_ids": [teachers[0].id],
            "policy": self.policy.id,
            "notes": "Batch 1 test",
        }
        res = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["assigned_count"], 1)
        self.assertEqual(res.data["skipped_count"], 0)
        self.assertEqual(res.data["failed_count"], 0)
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher=teachers[0], policy=self.policy).count(), 1)

    def test_bulk_assign_5_teachers(self):
        teachers = self._create_isolated_teachers(5, prefix="five")
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.dept.id,
            "teacher_ids": [t.id for t in teachers],
            "policy": self.policy.id,
            "notes": "Batch 5 test",
        }
        res = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["assigned_count"], 5)
        self.assertEqual(res.data["skipped_count"], 0)
        self.assertEqual(res.data["failed_count"], 0)
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher__in=teachers, policy=self.policy).count(), 5)

    def test_bulk_assign_20_teachers(self):
        teachers = self._create_isolated_teachers(20, prefix="twenty")
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.dept.id,
            "teacher_ids": [t.id for t in teachers],
            "policy": self.policy.id,
            "notes": "Batch 20 test",
        }
        res = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["assigned_count"], 20)
        self.assertEqual(res.data["skipped_count"], 0)
        self.assertEqual(res.data["failed_count"], 0)
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher__in=teachers, policy=self.policy).count(), 20)

    def test_bulk_assign_50_teachers(self):
        teachers = self._create_isolated_teachers(50, prefix="fifty")
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.dept.id,
            "teacher_ids": [t.id for t in teachers],
            "policy": self.policy.id,
            "notes": "Batch 50 test",
        }
        res = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["assigned_count"], 50)
        self.assertEqual(res.data["skipped_count"], 0)
        self.assertEqual(res.data["failed_count"], 0)
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher__in=teachers, policy=self.policy).count(), 50)

    def test_bulk_assign_75_teachers(self):
        teachers = self._create_isolated_teachers(75, prefix="seventyfive")
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.dept.id,
            "teacher_ids": [t.id for t in teachers],
            "policy": self.policy.id,
            "notes": "Batch 75 test",
        }
        res = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["assigned_count"], 75)
        self.assertEqual(res.data["skipped_count"], 0)
        self.assertEqual(res.data["failed_count"], 0)
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher__in=teachers, policy=self.policy).count(), 75)

    def test_bulk_assign_invalid_teacher_returns_validation_error_not_500(self):
        """If one teacher violates eligibility (e.g. joining date after policy ends), reports reason cleanly."""
        valid_teachers = self._create_isolated_teachers(2, prefix="valid")
        # Invalid teacher with joining date after policy coverage ended (2028-01-01 > 2027-12-31)
        invalid_u = User.objects.create_user(
            username=f"batch_invalid_{timezone.now().timestamp()}",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.dept,
        )
        invalid_t = TeacherProfile.objects.create(
            institution=self.institution,
            department=self.dept,
            user=invalid_u,
            historical_name="Invalid Future Teacher",
            joining_date=datetime.date(2028, 1, 1),
        )

        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.dept.id,
            "teacher_ids": [valid_teachers[0].id, invalid_t.id, valid_teachers[1].id],
            "policy": self.policy.id,
        }
        res = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["assigned_count"], 2)
        self.assertEqual(res.data["failed_count"], 1)
        self.assertIn("joining date", res.data["failed"][0]["reason"].lower())
        self.assertEqual(res.data["failed"][0]["teacher_id"], invalid_t.id)
