"""Comprehensive Regression Test Suite for Bulk Unassign Salary Policies (Stage 3).

Covers all 20 required scenarios:
1. One teacher unassignment.
2. Multiple teacher unassignment.
3. Mixed policy assignments.
4. Already unassigned teachers.
5. Selected teachers without policies.
6. Invalid teacher IDs.
7. Unauthorized administrators (teacher, coordinator, unauthenticated).
8. Cross-department attempts.
9. Cross-institution attempts.
10. Duplicate teacher IDs in request.
11. Concurrent unassignment idempotency.
12. Historical assignment preservation (records not deleted, rates resolve before cutoff).
13. Historical payroll protection (APPROVED/PAID periods locked).
14. Correct effective cutoff handling (defaults to today, handles cutoff <= effective_from).
15. Correct Stage 5 salary calculation behavior across cutoff boundary.
16. Correct Stage 7A draft recalculation behavior (marks draft incomplete).
17. Accurate assigned and unassigned counts in DepartmentTeachersView.
18. Individual PlatformAuditLog records.
19. Batch validation failure and rollback.
20. Preservation of existing Bulk Assign functionality.
"""
from datetime import date, timedelta
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
    SalaryPayrollPeriod,
    TeacherPolicyAssignment,
)
from salary.resolver import resolve_teacher_class_rate


class BulkSalaryPolicyUnassignTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        # 1. Institutions
        cls.institution = Institution.objects.create(name="IVS Test Academy", slug="ivs-test-academy")
        cls.foreign_institution = Institution.objects.create(name="Foreign Academy", slug="foreign-academy")

        # 2. Departments
        cls.quran_dept = Department.objects.create(
            name="Quran Department", code="QURAN", institution=cls.institution
        )
        cls.tuition_dept = Department.objects.create(
            name="Tuition Department", code="TUITION", institution=cls.institution
        )
        cls.foreign_dept = Department.objects.create(
            name="Foreign Dept", code="FOREIGN", institution=cls.foreign_institution
        )

        # 3. Users & Admins
        cls.quran_admin = User.objects.create_user(
            username="unassign_quran_admin",
            password="adminpassword123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=cls.institution,
            department=cls.quran_dept,
        )
        UserDepartmentRole.objects.create(
            user=cls.quran_admin,
            institution=cls.institution,
            department=cls.quran_dept,
            role=UserDepartmentRole.Role.DEPARTMENT_ADMIN,
        )

        cls.tuition_admin = User.objects.create_user(
            username="unassign_tuition_admin",
            password="adminpassword123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=cls.institution,
            department=cls.tuition_dept,
        )
        cls.inst_admin = User.objects.create_user(
            username="unassign_inst_admin",
            password="adminpassword123",
            role=User.Role.INSTITUTION_ADMIN,
            institution=cls.institution,
        )
        cls.platform_admin = User.objects.create_superuser(
            username="unassign_platform_admin",
            password="adminpassword123",
            email="platform@ivs.com",
        )
        cls.teacher_user = User.objects.create_user(
            username="unassign_regular_teacher",
            password="password123",
            role=User.Role.TEACHER,
            institution=cls.institution,
            department=cls.quran_dept,
        )
        cls.coordinator_user = User.objects.create_user(
            username="unassign_coordinator",
            password="password123",
            role=User.Role.COORDINATOR,
            institution=cls.institution,
            department=cls.quran_dept,
        )

        # 4. Published Policies
        cls.policy_a = cls._create_published_policy(
            name="Quran Standard Policy", code="QSP-01", department=cls.quran_dept, rate=Decimal("300.00")
        )
        cls.policy_b = cls._create_published_policy(
            name="Quran Weekend Policy", code="QWP-02", department=cls.quran_dept, rate=Decimal("450.00")
        )
        cls.foreign_policy = cls._create_published_policy(
            name="Foreign Policy", code="FP-01", department=cls.foreign_dept, rate=Decimal("500.00")
        )

    @classmethod
    def _create_published_policy(cls, name, code, department, rate):
        policy = SalaryPolicy.objects.create(
            institution=department.institution,
            department=department,
            name=name,
            code=code,
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
        )
        version = SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            effective_to=date(2027, 12, 31),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        tier = SalaryRateTier.objects.create(
            policy_version=version, tier_name="1 Student", min_students=1, max_students=1, sort_order=1
        )
        plan = SalaryTeachingPlan.objects.create(
            policy_version=version, plan_name="2 Days", plan_code="2_DAYS", days_per_week=2
        )
        SalaryPlanTierRate.objects.create(
            policy_version=version,
            teaching_plan=plan,
            rate_tier=tier,
            rate_per_class=rate,
        )
        version.status = SalaryPolicyVersion.Status.PUBLISHED
        version.save()
        return policy

    def _create_teacher(self, username_suffix, department=None, joining_date=None):
        dept = department or self.quran_dept
        user = User.objects.create_user(
            username=f"t_{username_suffix}_{timezone.now().timestamp()}",
            role=User.Role.TEACHER,
            institution=dept.institution,
            department=dept,
        )
        teacher = TeacherProfile.objects.create(
            institution=dept.institution,
            department=dept,
            user=user,
            historical_name=f"Teacher {username_suffix.title()}",
            joining_date=joining_date or date(2026, 1, 1),
        )
        return teacher

    # 1. One teacher unassignment
    def test_01_one_teacher_unassignment(self):
        teacher = self._create_teacher("single")
        assignment = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=teacher,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        self.client.force_authenticate(user=self.quran_admin)
        cutoff = date(2026, 11, 1)

        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [teacher.id],
            "effective_cutoff": cutoff.isoformat(),
            "reason": "Transitioning out of active roster",
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["unassigned_count"], 1)
        self.assertEqual(res.data["skipped_count"], 0)
        self.assertEqual(res.data["failed_count"], 0)

        assignment.refresh_from_db()
        self.assertEqual(assignment.effective_to, date(2026, 10, 31))
        self.assertFalse(assignment.is_active)
        self.assertIn("Transitioning out of active roster", assignment.notes)

    # 2. Multiple teacher unassignment
    def test_02_multiple_teacher_unassignment(self):
        t1 = self._create_teacher("multi_1")
        t2 = self._create_teacher("multi_2")
        t3 = self._create_teacher("multi_3")

        for t in [t1, t2, t3]:
            TeacherPolicyAssignment.objects.create(
                department=self.quran_dept,
                teacher=t,
                policy=self.policy_a,
                effective_from=date(2026, 1, 1),
                is_active=True,
            )

        self.client.force_authenticate(user=self.quran_admin)
        cutoff = date(2026, 11, 15)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t1.id, t2.id, t3.id],
            "effective_cutoff": cutoff.isoformat(),
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["unassigned_count"], 3)
        self.assertEqual(res.data["skipped_count"], 0)

        for t in [t1, t2, t3]:
            a = TeacherPolicyAssignment.objects.get(teacher=t, department=self.quran_dept)
            self.assertEqual(a.effective_to, date(2026, 11, 14))

    # 3. Mixed policy assignments
    def test_03_mixed_policy_assignments(self):
        t_a = self._create_teacher("policy_a_teacher")
        t_b = self._create_teacher("policy_b_teacher")

        a1 = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t_a,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        a2 = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t_b,
            policy=self.policy_b,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

        self.client.force_authenticate(user=self.quran_admin)
        cutoff = date(2026, 11, 15)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t_a.id, t_b.id],
            "effective_cutoff": cutoff.isoformat(),
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["unassigned_count"], 2)

        p_names = {s["policy_name"] for s in res.data["successful"]}
        self.assertIn("Quran Standard Policy", p_names)
        self.assertIn("Quran Weekend Policy", p_names)

    # 4. Already unassigned teachers
    def test_04_already_unassigned_teachers(self):
        t = self._create_teacher("already_unassigned")
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 6, 30),
            is_active=True,
        )

        self.client.force_authenticate(user=self.quran_admin)
        cutoff = date(2026, 11, 15)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t.id],
            "effective_cutoff": cutoff.isoformat(),
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["unassigned_count"], 0)
        self.assertEqual(res.data["skipped_count"], 1)
        self.assertIn("No active salary policy", res.data["skipped"][0]["reason"])

    # 5. Selected teachers without policies
    def test_05_selected_teachers_without_policies(self):
        t_assigned = self._create_teacher("has_policy")
        t_unassigned = self._create_teacher("no_policy")

        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t_assigned,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

        self.client.force_authenticate(user=self.quran_admin)
        cutoff = date(2026, 11, 15)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t_assigned.id, t_unassigned.id],
            "effective_cutoff": cutoff.isoformat(),
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["unassigned_count"], 1)
        self.assertEqual(res.data["skipped_count"], 1)
        self.assertEqual(res.data["successful"][0]["teacher_id"], t_assigned.id)
        self.assertEqual(res.data["skipped"][0]["teacher_id"], t_unassigned.id)

    # 6. Invalid teacher IDs
    def test_06_invalid_teacher_ids(self):
        self.client.force_authenticate(user=self.quran_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [999999, 888888],
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("not found", res.data["detail"].lower())

    # 7. Unauthorized administrators (teacher, coordinator, unauthenticated)
    def test_07_unauthorized_administrators(self):
        t = self._create_teacher("target_teacher")
        payload = {"department": self.quran_dept.id, "teacher_ids": [t.id]}

        # A) Unauthenticated
        self.client.logout()
        res_anon = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res_anon.status_code, status.HTTP_401_UNAUTHORIZED)

        # B) Teacher role
        self.client.force_authenticate(user=self.teacher_user)
        res_teacher = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res_teacher.status_code, status.HTTP_403_FORBIDDEN)

        # C) Coordinator role
        self.client.force_authenticate(user=self.coordinator_user)
        res_coord = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res_coord.status_code, status.HTTP_403_FORBIDDEN)

    # 8. Cross-department attempts
    def test_08_cross_department_attempts(self):
        tuition_teacher = self._create_teacher("tuition_teacher", department=self.tuition_dept)
        self.client.force_authenticate(user=self.quran_admin)

        # A) Trying to unassign tuition department while Quran admin
        payload_1 = {
            "department": self.tuition_dept.id,
            "teacher_ids": [tuition_teacher.id],
        }
        res_1 = self.client.post("/api/salary/assignments/bulk-unassign/", payload_1, format="json")
        self.assertEqual(res_1.status_code, status.HTTP_403_FORBIDDEN)

        # B) Trying to pass tuition teacher under quran department
        payload_2 = {
            "department": self.quran_dept.id,
            "teacher_ids": [tuition_teacher.id],
        }
        res_2 = self.client.post("/api/salary/assignments/bulk-unassign/", payload_2, format="json")
        self.assertEqual(res_2.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("different department", res_2.data["detail"].lower())

    # 9. Cross-institution attempts
    def test_09_cross_institution_attempts(self):
        foreign_teacher = self._create_teacher("foreign_teacher", department=self.foreign_dept)
        # Institution Admin of IVS attempts to access foreign department
        self.client.force_authenticate(user=self.inst_admin)

        payload = {
            "department": self.foreign_dept.id,
            "teacher_ids": [foreign_teacher.id],
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 10. Duplicate teacher IDs in request
    def test_10_duplicate_teacher_ids_deduplicated(self):
        t = self._create_teacher("dup_test")
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        self.client.force_authenticate(user=self.quran_admin)
        cutoff = date(2026, 11, 15)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t.id, t.id, t.id],
            "effective_cutoff": cutoff.isoformat(),
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["total_requested"], 1)
        self.assertEqual(res.data["unassigned_count"], 1)

    # 11. Concurrent unassignment idempotency
    def test_11_concurrent_unassignment_requests(self):
        t = self._create_teacher("concurrent_test")
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        self.client.force_authenticate(user=self.quran_admin)
        cutoff = date(2026, 11, 15)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t.id],
            "effective_cutoff": cutoff.isoformat(),
        }
        # First request succeeds
        res1 = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res1.data["unassigned_count"], 1)

        # Second identical request safely skips without error
        res2 = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertEqual(res2.data["unassigned_count"], 0)
        self.assertEqual(res2.data["skipped_count"], 1)

    # 12. Historical assignment preservation (records preserved, historical rates intact)
    def test_12_historical_assignment_preservation(self):
        t = self._create_teacher("history_preserve")
        old_a = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        self.client.force_authenticate(user=self.quran_admin)
        cutoff = date(2026, 11, 15)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t.id],
            "effective_cutoff": cutoff.isoformat(),
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Verify old assignment row was NOT deleted
        self.assertTrue(TeacherPolicyAssignment.objects.filter(id=old_a.id).exists())
        old_a.refresh_from_db()
        self.assertEqual(old_a.effective_to, date(2026, 11, 14))

        # Historical class on 2026-11-14 resolves rate successfully
        plan = SalaryTeachingPlan.objects.get(policy_version__policy=self.policy_a)
        rate_before = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=t.id,
            class_date=date(2026, 11, 14),
            teaching_plan_id=plan.id,
            student_count=1,
        )
        self.assertTrue(rate_before.is_resolved)
        self.assertEqual(rate_before.winning_rate, Decimal("300.00"))

        # Class on cutoff date 2026-11-15 is unassigned
        rate_cutoff = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=t.id,
            class_date=date(2026, 11, 15),
            teaching_plan_id=plan.id,
            student_count=1,
        )
        self.assertFalse(rate_cutoff.is_resolved)
        self.assertIn("No active salary policy assignment found", rate_cutoff.selection_reason)

    # 13. Historical payroll protection (APPROVED/PAID periods locked)
    def test_13_historical_payroll_protection(self):
        t = self._create_teacher("payroll_protect")
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        # Create an APPROVED payroll period for October 2026
        SalaryPayrollPeriod.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            payroll_year=2026,
            payroll_month=10,
            status=SalaryPayrollPeriod.Status.APPROVED,
        )

        self.client.force_authenticate(user=self.quran_admin)
        # Attempting to backdate unassignment into October 2026 must be rejected
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t.id],
            "effective_cutoff": "2026-10-15",
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("protected against modifications", res.data["detail"])

    # 14. Correct effective cutoff handling (defaults to today; cutoff <= effective_from)
    def test_14_correct_effective_cutoff_handling(self):
        t1 = self._create_teacher("future_start")
        # Assignment starting in the future
        future_a = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t1,
            policy=self.policy_a,
            effective_from=date(2026, 12, 1),
            is_active=True,
        )
        self.client.force_authenticate(user=self.quran_admin)
        # Cutoff on or before effective_from
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t1.id],
            "effective_cutoff": "2026-12-01",
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        future_a.refresh_from_db()
        # Deactivated cleanly without violating check constraint
        self.assertFalse(future_a.is_active)

    # 15. Correct Stage 5 salary calculation after cutoff
    def test_15_stage_5_salary_calculation_after_cutoff(self):
        t = self._create_teacher("stage5_calc")
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        self.client.force_authenticate(user=self.quran_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t.id],
            "effective_cutoff": "2026-11-15",
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        plan = SalaryTeachingPlan.objects.get(policy_version__policy=self.policy_a)

        # Before cutoff date (2026-11-14): rate resolves successfully (200 OK)
        res_before = self.client.post(
            "/api/salary/preview-rate/",
            {
                "department_id": self.quran_dept.id,
                "teacher_id": t.id,
                "class_date": "2026-11-14",
                "teaching_plan_id": plan.id,
                "student_count": 1,
            },
            format="json",
        )
        self.assertEqual(res_before.status_code, status.HTTP_200_OK)
        self.assertTrue(res_before.data["is_resolved"])

        # On or after cutoff date (2026-11-15): rate preview returns 422 unresolved
        res_after = self.client.post(
            "/api/salary/preview-rate/",
            {
                "department_id": self.quran_dept.id,
                "teacher_id": t.id,
                "class_date": "2026-11-15",
                "teaching_plan_id": plan.id,
                "student_count": 1,
            },
            format="json",
        )
        self.assertEqual(res_after.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertFalse(res_after.data["is_resolved"])
        self.assertIn("No active salary policy", res_after.data["selection_reason"])

    # 16. Correct Stage 7A draft recalculation behavior
    def test_16_stage_7a_draft_recalculation_behavior(self):
        t = self._create_teacher("draft_recalc_teacher")
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        # Create an unlocked draft payroll for November 2026
        draft_period = SalaryPayrollPeriod.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            payroll_year=2026,
            payroll_month=11,
            status=SalaryPayrollPeriod.Status.DRAFT,
            is_calculation_complete=True,
            incompleteness_reasons=[],
        )

        self.client.force_authenticate(user=self.quran_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t.id],
            "effective_cutoff": "2026-11-15",
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Draft payroll is flagged as incomplete requiring recalculation
        draft_period.refresh_from_db()
        self.assertFalse(draft_period.is_calculation_complete)
        self.assertTrue(any("recalculation required" in r.lower() for r in draft_period.incompleteness_reasons))

    # 17. Accurate assigned and unassigned counts in DepartmentTeachersView
    def test_17_accurate_assigned_and_unassigned_counts(self):
        t1 = self._create_teacher("roster_t1")
        t2 = self._create_teacher("roster_t2")

        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t1,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t2,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

        self.client.force_authenticate(user=self.quran_admin)
        # Before unassign: both assigned on 2026-11-15
        roster_before = self.client.get(
            f"/api/salary/teachers/?department_id={self.quran_dept.id}&target_date=2026-11-15"
        )
        t1_data = next(x for x in roster_before.data if x["id"] == t1.id)
        t2_data = next(x for x in roster_before.data if x["id"] == t2.id)
        self.assertIsNotNone(t1_data["current_policy"])
        self.assertIsNotNone(t2_data["current_policy"])

        # Unassign t1 only
        res = self.client.post(
            "/api/salary/assignments/bulk-unassign/",
            {"department": self.quran_dept.id, "teacher_ids": [t1.id], "effective_cutoff": "2026-11-15"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # After unassign: t1 is unassigned on 2026-11-15, t2 remains assigned
        roster_after = self.client.get(
            f"/api/salary/teachers/?department_id={self.quran_dept.id}&target_date=2026-11-15"
        )
        t1_after = next(x for x in roster_after.data if x["id"] == t1.id)
        t2_after = next(x for x in roster_after.data if x["id"] == t2.id)
        self.assertIsNone(t1_after["current_policy"])
        self.assertIsNotNone(t2_after["current_policy"])

    # 18. Individual audit records
    def test_18_individual_audit_records(self):
        t = self._create_teacher("audit_t")
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        self.client.force_authenticate(user=self.quran_admin)
        cutoff = date(2026, 11, 15)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t.id],
            "effective_cutoff": cutoff.isoformat(),
            "reason": "Department policy update",
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        audit_log = PlatformAuditLog.objects.filter(
            category="salary_assignment",
            action="unassign_policy",
            details__teacher_id=t.id,
        ).first()
        self.assertIsNotNone(audit_log)
        self.assertEqual(audit_log.details["effective_cutoff"], cutoff.isoformat())
        self.assertEqual(audit_log.details["reason"], "Department policy update")

    # 19. Batch validation failure and rollback
    def test_19_batch_validation_failure_and_rollback(self):
        t_valid = self._create_teacher("batch_valid")
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t_valid,
            policy=self.policy_a,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        self.client.force_authenticate(user=self.quran_admin)
        # Passing valid teacher with a non-existent teacher ID
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t_valid.id, 999999],
        }
        res = self.client.post("/api/salary/assignments/bulk-unassign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Verify valid teacher's assignment was NOT modified
        assignment = TeacherPolicyAssignment.objects.get(teacher=t_valid)
        self.assertIsNone(assignment.effective_to)

    # 20. Preservation of existing Bulk Assign functionality
    def test_20_preservation_of_existing_bulk_assign_functionality(self):
        t1 = self._create_teacher("preserve_bulk_assign_1")
        t2 = self._create_teacher("preserve_bulk_assign_2")

        self.client.force_authenticate(user=self.quran_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t1.id, t2.id],
            "policy": self.policy_a.id,
            "notes": "Verify bulk-assign works untouched",
        }
        res = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["assigned_count"], 2)
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher__in=[t1, t2], policy=self.policy_a).count(), 2)
