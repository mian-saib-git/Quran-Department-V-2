"""Comprehensive Test Suite for Stage 3: Teacher Policy Assignments, Salary Overrides, and Rate Preview.

Verifies:
1. Assigning a valid published policy.
2. Rejecting draft policy assignments when inappropriate.
3. Cross-department assignment rejection.
4. Overlapping assignment rejection.
5. Future-dated policy assignment.
6. Historical assignment preservation.
7. Teacher-wide override.
8. Teaching-plan override.
9. Student-specific override.
10. Override precedence.
11. Effective-date boundaries.
12. Special coordinator day precedence.
13. Equal-priority overlap rejection.
14. Unauthorized mutation (teacher, coordinator, student, cross-department admin).
15. Invalid foreign-key combinations.
16. Policy version compatibility.
17. Rate preview correctness.
18. Missing applicable policy behavior.
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Department, Institution, PlatformAuditLog, User, UserDepartmentRole
from academy.models import StudentProfile, TeacherProfile
from salary.models import (
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    TeacherPolicyAssignment,
    TeacherSalaryOverride,
)
from salary.resolver import resolve_teacher_class_rate


class TeacherSalaryAssignmentAndOverrideTests(APITestCase):
    def setUp(self):
        # 1. Institutions
        self.institution = Institution.objects.create(name="IVS Main Campus", slug="ivs-main-campus")
        self.other_institution = Institution.objects.create(name="Other Inst", slug="other-inst")

        # 2. Departments
        self.quran_dept = Department.objects.create(
            institution=self.institution, name="Quran Department", code="QURAN"
        )
        self.tuition_dept = Department.objects.create(
            institution=self.institution, name="Tuition Department", code="TUITION"
        )
        self.foreign_dept = Department.objects.create(
            institution=self.other_institution, name="Foreign Dept", code="FOREIGN"
        )

        # 3. Users & Roles
        self.dept_admin = User.objects.create_user(
            username="dept_admin_quran",
            password="password123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.quran_dept,
        )
        self.tuition_admin = User.objects.create_user(
            username="dept_admin_tuition",
            password="password123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.tuition_dept,
        )
        self.inst_admin = User.objects.create_user(
            username="inst_admin_ivs",
            password="password123",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.institution,
        )
        self.super_admin = User.objects.create_superuser(
            username="super_admin_ivs",
            password="password123",
            email="super@ivs.com",
        )
        self.teacher_user = User.objects.create_user(
            username="teacher_ahmed",
            first_name="Ahmed",
            last_name="Khan",
            password="password123",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.quran_dept,
        )
        self.coordinator_user = User.objects.create_user(
            username="coord_bilal",
            first_name="Bilal",
            password="password123",
            role=User.Role.COORDINATOR,
            institution=self.institution,
            department=self.quran_dept,
        )
        self.student_user = User.objects.create_user(
            username="student_zayd",
            first_name="Zayd",
            last_name="Ali",
            password="password123",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.quran_dept,
        )

        # 4. Teacher & Student Profiles
        self.teacher = TeacherProfile.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            user=self.teacher_user,
            phone="03001234567",
        )
        self.tuition_teacher_user = User.objects.create_user(
            username="tuition_tutor_fatima",
            first_name="Fatima",
            password="password123",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.tuition_dept,
        )
        self.tuition_teacher = TeacherProfile.objects.create(
            institution=self.institution,
            department=self.tuition_dept,
            user=self.tuition_teacher_user,
        )

        self.student = StudentProfile.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            user=self.student_user,
            teacher=self.teacher,
        )

        # 5. Quran Published Policy & Rate Matrix Setup
        self.policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="QURAN_STD_2026",
            name="Quran Standard 2026",
            created_by=self.dept_admin,
        )
        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            published_by=self.dept_admin,
        )
        self.tier1 = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="1–15 students",
            min_students=1,
            max_students=15,
            sort_order=1,
        )
        self.tier2 = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="16–19 students",
            min_students=16,
            max_students=19,
            sort_order=2,
        )
        self.tier3 = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="20+ students",
            min_students=20,
            max_students=None,
            sort_order=3,
        )

        self.plan_5d = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_code="5_days",
            plan_name="5 Days / Week",
            days_per_week=5,
            sort_order=1,
        )
        self.plan_3d = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_code="3_days",
            plan_name="3 Days / Week",
            days_per_week=3,
            sort_order=2,
        )
        self.plan_coord = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_code="coordinator_special",
            plan_name="Coordinator Special",
            is_coordinator_special=True,
            sort_order=3,
        )

        # Matrix rates
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_5d, rate_tier=self.tier1, rate_per_class=Decimal("80.00"))
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_5d, rate_tier=self.tier2, rate_per_class=Decimal("90.00"))
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_5d, rate_tier=self.tier3, rate_per_class=Decimal("100.00"))

        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_3d, rate_tier=self.tier1, rate_per_class=Decimal("116.00"))
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_3d, rate_tier=self.tier2, rate_per_class=Decimal("133.00"))
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_3d, rate_tier=self.tier3, rate_per_class=Decimal("166.00"))

        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_coord, rate_tier=self.tier1, rate_per_class=Decimal("200.00"))
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_coord, rate_tier=self.tier2, rate_per_class=Decimal("225.00"))
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_coord, rate_tier=self.tier3, rate_per_class=Decimal("250.00"))

        # Publish the version once components are assembled
        self.version.status = SalaryPolicyVersion.Status.PUBLISHED
        self.version.save()

        # Draft-only policy for negative testing
        self.draft_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="QURAN_DRAFT_ONLY",
            name="Draft Only Policy",
            created_by=self.dept_admin,
        )
        SalaryPolicyVersion.objects.create(
            policy=self.draft_policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
        )

    # 1. Assigning a valid published policy
    def test_01_assign_valid_published_policy(self):
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher": self.teacher.id,
            "policy": self.policy.id,
            "effective_from": "2026-01-01",
            "effective_to": None,
            "notes": "Standard teacher assignment for 2026.",
        }
        res = self.client.post("/api/salary/assignments/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["policy_code"], "QURAN_STD_2026")
        self.assertEqual(res.data["teacher"], self.teacher.id)
        self.assertEqual(TeacherPolicyAssignment.objects.count(), 1)

    # 2. Rejecting draft policy assignments when inappropriate
    def test_02_reject_draft_policy_assignment(self):
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher": self.teacher.id,
            "policy": self.draft_policy.id,  # Has NO published versions
            "effective_from": "2026-01-01",
        }
        res = self.client.post("/api/salary/assignments/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("no published versions", str(res.data))

    # 3. Cross-department assignment rejection
    def test_03_reject_cross_department_assignment(self):
        self.client.force_authenticate(user=self.dept_admin)
        # Attempting to assign Tuition teacher to Quran policy
        payload = {
            "department": self.quran_dept.id,
            "teacher": self.tuition_teacher.id,
            "policy": self.policy.id,
            "effective_from": "2026-01-01",
        }
        res = self.client.post("/api/salary/assignments/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("different department", str(res.data))

    # 4. Overlapping assignment rejection
    def test_04_reject_overlapping_active_assignments(self):
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 6, 30),
            is_active=True,
        )
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher": self.teacher.id,
            "policy": self.policy.id,
            "effective_from": "2026-04-01",  # Overlaps with Jan-June
            "effective_to": "2026-12-31",
        }
        res = self.client.post("/api/salary/assignments/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("overlap", str(res.data).lower())

    # 5. Future-dated policy assignment (scheduled change)
    def test_05_future_dated_policy_assignment(self):
        # Current assignment: 2026-01-01 to 2026-06-30
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 6, 30),
            is_active=True,
        )
        self.client.force_authenticate(user=self.dept_admin)
        # Scheduled assignment: 2026-07-01 onwards
        payload = {
            "department": self.quran_dept.id,
            "teacher": self.teacher.id,
            "policy": self.policy.id,
            "effective_from": "2026-07-01",
            "effective_to": None,
            "notes": "H2 2026 scheduled assignment",
        }
        res = self.client.post("/api/salary/assignments/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher=self.teacher).count(), 2)

    # 6. Historical assignment preservation
    def test_06_historical_assignment_preservation(self):
        past_assignment = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            policy=self.policy,
            effective_from=date(2025, 1, 1),
            effective_to=date(2025, 12, 31),
            is_active=True,
        )
        current_assignment = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            is_active=True,
        )
        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.get(f"/api/salary/assignments/?teacher_id={self.teacher.id}")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 2)
        # Both records preserved in order
        dates = [r["effective_from"] for r in res.data]
        self.assertIn("2025-01-01", dates)
        self.assertIn("2026-01-01", dates)

    # 7. Teacher-wide override (Level 3)
    def test_07_teacher_wide_override(self):
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher": self.teacher.id,
            "override_level": "teacher_wide",
            "rate_per_class": "120.00",
            "effective_from": "2026-01-01",
            "effective_to": None,
            "reason": "Senior teacher distinction approved by department head.",
        }
        res = self.client.post("/api/salary/overrides/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["override_level"], "teacher_wide")
        self.assertEqual(res.data["rate_per_class"], "120.00")
        self.assertEqual(TeacherSalaryOverride.objects.count(), 1)

    # 8. Teaching-plan override (Level 2)
    def test_08_teaching_plan_override(self):
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher": self.teacher.id,
            "override_level": "plan_specific",
            "teaching_plan": self.plan_5d.id,
            "rate_per_class": "95.00",
            "effective_from": "2026-01-01",
            "effective_to": None,
            "reason": "Special 5-day intensive preparation rate.",
        }
        res = self.client.post("/api/salary/overrides/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["override_level"], "plan_specific")
        self.assertEqual(res.data["teaching_plan_code"], "5_days")

    # 9. Student-specific override (Level 1)
    def test_09_student_specific_override(self):
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher": self.teacher.id,
            "override_level": "student_specific",
            "student": self.student.id,
            "rate_per_class": "150.00",
            "effective_from": "2026-01-01",
            "effective_to": None,
            "reason": "Special needs student 1-on-1 rate.",
        }
        res = self.client.post("/api/salary/overrides/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["override_level"], "student_specific")
        self.assertEqual(res.data["student"], self.student.id)

    # 10. Override precedence (Level 1 > Level 2 > Level 3 > Level 5)
    def test_10_override_precedence(self):
        # Assign base policy
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        test_date = date(2026, 2, 1)

        # Baseline: No overrides -> Level 5 Department Policy Rate
        res5 = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=test_date,
            teaching_plan_id=self.plan_5d.id,
            student_count=10,  # Tier 1 (rate: 80.00)
        )
        self.assertTrue(res5.is_resolved)
        self.assertEqual(res5.precedence_level, 5)
        self.assertEqual(res5.winning_rate, Decimal("80.00"))

        # Add Teacher-wide override (Level 3: 120.00)
        ov_teacher = TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            override_level=TeacherSalaryOverride.OverrideLevel.TEACHER_WIDE,
            rate_per_class=Decimal("120.00"),
            effective_from=date(2026, 1, 1),
            reason="Teacher wide override",
        )
        res3 = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=test_date,
            teaching_plan_id=self.plan_5d.id,
            student_count=10,
        )
        self.assertEqual(res3.precedence_level, 3)
        self.assertEqual(res3.winning_rate, Decimal("120.00"))

        # Add Plan-specific override (Level 2: 135.00)
        ov_plan = TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            override_level=TeacherSalaryOverride.OverrideLevel.PLAN_SPECIFIC,
            teaching_plan=self.plan_5d,
            rate_per_class=Decimal("135.00"),
            effective_from=date(2026, 1, 1),
            reason="5-day plan override",
        )
        res2 = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=test_date,
            teaching_plan_id=self.plan_5d.id,
            student_count=10,
        )
        self.assertEqual(res2.precedence_level, 2)
        self.assertEqual(res2.winning_rate, Decimal("135.00"))

        # Add Student-specific override (Level 1: 180.00)
        ov_student = TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            override_level=TeacherSalaryOverride.OverrideLevel.STUDENT_SPECIFIC,
            student=self.student,
            rate_per_class=Decimal("180.00"),
            effective_from=date(2026, 1, 1),
            reason="Special student rate",
        )
        res1 = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=test_date,
            teaching_plan_id=self.plan_5d.id,
            student_id=self.student.id,
            student_count=10,
        )
        self.assertEqual(res1.precedence_level, 1)
        self.assertEqual(res1.winning_rate, Decimal("180.00"))

    # 11. Effective-date boundaries
    def test_11_effective_date_boundaries(self):
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        # Override active strictly in March 2026
        TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            override_level=TeacherSalaryOverride.OverrideLevel.TEACHER_WIDE,
            rate_per_class=Decimal("150.00"),
            effective_from=date(2026, 3, 1),
            effective_to=date(2026, 3, 31),
            reason="March special bonus rate",
        )
        # Before March 1 -> Falls back to department policy rate (80.00)
        res_feb = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=date(2026, 2, 28),
            teaching_plan_id=self.plan_5d.id,
            student_count=10,
        )
        self.assertEqual(res_feb.precedence_level, 5)
        self.assertEqual(res_feb.winning_rate, Decimal("80.00"))

        # In March -> Override active (150.00)
        res_mar = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=date(2026, 3, 15),
            teaching_plan_id=self.plan_5d.id,
            student_count=10,
        )
        self.assertEqual(res_mar.precedence_level, 3)
        self.assertEqual(res_mar.winning_rate, Decimal("150.00"))

        # After March 31 -> Falls back to department policy rate (80.00)
        res_apr = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=date(2026, 4, 1),
            teaching_plan_id=self.plan_5d.id,
            student_count=10,
        )
        self.assertEqual(res_apr.precedence_level, 5)
        self.assertEqual(res_apr.winning_rate, Decimal("80.00"))

    # 12. Special coordinator day precedence
    def test_12_coordinator_day_precedence(self):
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        # 2026-03-01 is Sunday
        TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            override_level=TeacherSalaryOverride.OverrideLevel.COORDINATOR_DAY,
            qualifying_weekday="sunday",
            rate_per_class=Decimal("210.00"),
            effective_from=date(2026, 1, 1),
            reason="Sunday coordinator coverage rate",
        )
        # Sunday class -> Level 4 Coordinator Special Day Override (210.00)
        res_sun = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=date(2026, 3, 1),  # Sunday
            teaching_plan_id=self.plan_5d.id,
            student_count=10,
        )
        self.assertEqual(res_sun.precedence_level, 4)
        self.assertEqual(res_sun.winning_rate, Decimal("210.00"))

        # Monday class (2026-03-02) -> Falls back to Level 5 policy rate
        res_mon = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=date(2026, 3, 2),  # Monday
            teaching_plan_id=self.plan_5d.id,
            student_count=10,
        )
        self.assertEqual(res_mon.precedence_level, 5)
        self.assertEqual(res_mon.winning_rate, Decimal("80.00"))

    # 13. Equal-priority overlap rejection
    def test_13_equal_priority_overlap_rejection(self):
        TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            override_level=TeacherSalaryOverride.OverrideLevel.TEACHER_WIDE,
            rate_per_class=Decimal("120.00"),
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 6, 30),
            reason="First teacher wide override",
        )
        self.client.force_authenticate(user=self.dept_admin)
        # Attempting second active teacher-wide override overlapping with first
        payload = {
            "department": self.quran_dept.id,
            "teacher": self.teacher.id,
            "override_level": "teacher_wide",
            "rate_per_class": "130.00",
            "effective_from": "2026-05-01",
            "effective_to": "2026-10-31",
            "reason": "Second overlapping teacher wide override",
        }
        res = self.client.post("/api/salary/overrides/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("overlap", str(res.data).lower())

    # 14. Unauthorized mutation (teacher, coordinator, student, cross-department admin)
    def test_14_unauthorized_mutation_rejection(self):
        payload = {
            "department": self.quran_dept.id,
            "teacher": self.teacher.id,
            "policy": self.policy.id,
            "effective_from": "2026-01-01",
        }
        # Teacher cannot assign policy
        self.client.force_authenticate(user=self.teacher_user)
        res = self.client.post("/api/salary/assignments/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # Coordinator cannot assign policy
        self.client.force_authenticate(user=self.coordinator_user)
        res = self.client.post("/api/salary/assignments/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # Student cannot assign policy
        self.client.force_authenticate(user=self.student_user)
        res = self.client.post("/api/salary/assignments/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

        # Tuition admin cannot assign policy in Quran department
        self.client.force_authenticate(user=self.tuition_admin)
        res = self.client.post("/api/salary/assignments/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 15. Invalid foreign-key combinations
    def test_15_invalid_foreign_key_combinations(self):
        self.client.force_authenticate(user=self.dept_admin)
        # Student specific override with non-existent student ID
        payload = {
            "department": self.quran_dept.id,
            "teacher": self.teacher.id,
            "override_level": "student_specific",
            "student": 99999,
            "rate_per_class": "120.00",
            "effective_from": "2026-01-01",
            "reason": "Invalid student ID test",
        }
        res = self.client.post("/api/salary/overrides/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # Plan specific override with non-existent plan ID
        payload["override_level"] = "plan_specific"
        del payload["student"]
        payload["teaching_plan"] = 99999
        res = self.client.post("/api/salary/overrides/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    # 16. Policy version compatibility (assignments reference published policy, resolver finds effective version)
    def test_16_policy_version_compatibility(self):
        mv_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="QURAN_MULTI_VER",
            name="Quran Multi Version Policy",
            created_by=self.dept_admin,
        )
        # v1: Jan 1, 2026 to June 30, 2026
        v1 = SalaryPolicyVersion.objects.create(
            policy=mv_policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 6, 30),
            published_by=self.dept_admin,
        )
        tier1_v1 = SalaryRateTier.objects.create(policy_version=v1, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        plan_5d_v1 = SalaryTeachingPlan.objects.create(policy_version=v1, plan_code="5_days", plan_name="5 Days v1", days_per_week=5, sort_order=1)
        SalaryPlanTierRate.objects.create(policy_version=v1, teaching_plan=plan_5d_v1, rate_tier=tier1_v1, rate_per_class=Decimal("80.00"))
        v1.status = SalaryPolicyVersion.Status.PUBLISHED
        v1.save()

        # v2: July 1, 2026 to indefinite with higher rate
        v2 = SalaryPolicyVersion.objects.create(
            policy=mv_policy,
            version_number=2,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 7, 1),
            effective_to=None,
            published_by=self.dept_admin,
        )
        tier1_v2 = SalaryRateTier.objects.create(policy_version=v2, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        plan_5d_v2 = SalaryTeachingPlan.objects.create(policy_version=v2, plan_code="5_days", plan_name="5 Days v2", days_per_week=5, sort_order=1)
        SalaryPlanTierRate.objects.create(policy_version=v2, teaching_plan=plan_5d_v2, rate_tier=tier1_v2, rate_per_class=Decimal("95.00"))
        v2.status = SalaryPolicyVersion.Status.PUBLISHED
        v2.save()

        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            policy=mv_policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

        # Look up on March 1, 2026 -> Resolves v1 (80.00)
        res_v1 = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=date(2026, 3, 1),
            teaching_plan_code="5_days",
            student_count=10,
        )
        self.assertEqual(res_v1.winning_rate, Decimal("80.00"))
        self.assertEqual(res_v1.policy_version["version_number"], 1)

        # Look up on August 1, 2026 -> Resolves v2 (95.00)
        res_v2 = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=date(2026, 8, 1),
            teaching_plan_code="5_days",
            student_count=10,
        )
        self.assertEqual(res_v2.winning_rate, Decimal("95.00"))
        self.assertEqual(res_v2.policy_version["version_number"], 2)

    # 17. Rate preview correctness via API
    def test_17_rate_preview_api_correctness(self):
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department_id": self.quran_dept.id,
            "teacher_id": self.teacher.id,
            "class_date": "2026-03-15",
            "teaching_plan_code": "5_days",
            "student_count": 18,  # Tier 2 (rate: 90.00)
        }
        res = self.client.post("/api/salary/preview-rate/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.data["is_resolved"])
        self.assertEqual(res.data["winning_rate"], "90.00")
        self.assertEqual(res.data["precedence_level"], 5)
        self.assertEqual(res.data["rate_tier"]["tier_name"], "16–19 students")
        self.assertIn("standard published department rate", res.data["selection_reason"].lower())

    # 18. Missing applicable policy behavior
    def test_18_missing_applicable_policy_behavior(self):
        # Teacher Ahmed has NO assigned policy
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department_id": self.quran_dept.id,
            "teacher_id": self.teacher.id,
            "class_date": "2026-03-15",
            "teaching_plan_code": "5_days",
            "student_count": 10,
        }
        res = self.client.post("/api/salary/preview-rate/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertFalse(res.data["is_resolved"])
        self.assertIn("No active salary policy", res.data["selection_reason"])

    # 19. Department teachers listing endpoint retrieval and isolation (Stage 3)
    def test_19_department_teachers_api_retrieval_and_isolation(self):
        # Assign policy to self.teacher
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        # Create an override for self.teacher
        TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            override_level=TeacherSalaryOverride.OverrideLevel.TEACHER_WIDE,
            rate_per_class=Decimal("120.00"),
            effective_from=date(2026, 1, 1),
            is_active=True,
            reason="Excellence",
        )

        # Authorized Quran Admin access
        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.get(f"/api/salary/teachers/?department_id={self.quran_dept.id}")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)
        teacher_entry = res.data[0]
        self.assertEqual(teacher_entry["id"], self.teacher.id)
        self.assertEqual(teacher_entry["department_id"], self.quran_dept.id)
        self.assertEqual(teacher_entry["active_overrides_count"], 1)
        self.assertIsNotNone(teacher_entry["current_policy"])
        self.assertEqual(teacher_entry["current_policy"]["policy_id"], self.policy.id)
        self.assertGreater(len(teacher_entry["available_plans"]), 0)

        # Cross-department admin access (Tuition admin accessing Quran department)
        self.client.force_authenticate(user=self.tuition_admin)
        res_cross = self.client.get(f"/api/salary/teachers/?department_id={self.quran_dept.id}")
        self.assertEqual(res_cross.status_code, status.HTTP_403_FORBIDDEN)

    # 20. Target date and version effective range transparency in teachers API
    def test_20_department_teachers_api_target_date_and_version_effective_range(self):
        # Create a policy with version starting in future: Nov 10, 2026
        future_policy = SalaryPolicy.objects.create(
            department=self.quran_dept,
            institution=self.institution,
            name="2 days",
            code="2",
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            is_active=True,
        )
        v1 = SalaryPolicyVersion.objects.create(
            policy=future_policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2026, 11, 10),
            effective_to=None,
        )
        # Assign policy starting from Oct 1, 2026
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            policy=future_policy,
            effective_from=date(2026, 10, 1),
            is_active=True,
        )

        self.client.force_authenticate(user=self.dept_admin)

        # Query for October 1, 2026: version v1 is NOT effective yet
        res_oct = self.client.get(f"/api/salary/teachers/?department_id={self.quran_dept.id}&target_date=2026-10-01")
        self.assertEqual(res_oct.status_code, status.HTTP_200_OK)
        teacher_oct = res_oct.data[0]
        self.assertIsNotNone(teacher_oct["current_policy"])
        self.assertEqual(teacher_oct["current_policy"]["effective_from"], "2026-10-01")
        self.assertIsNone(teacher_oct["current_policy"]["version_number"])
        self.assertIsNone(teacher_oct["current_policy"]["version_effective_from"])

        # Query for November 10, 2026: version v1 IS effective
        res_nov = self.client.get(f"/api/salary/teachers/?department_id={self.quran_dept.id}&target_date=2026-11-10")
        self.assertEqual(res_nov.status_code, status.HTTP_200_OK)
        teacher_nov = res_nov.data[0]
        self.assertIsNotNone(teacher_nov["current_policy"])
        self.assertEqual(teacher_nov["current_policy"]["version_number"], 1)
        self.assertEqual(teacher_nov["current_policy"]["version_effective_from"], "2026-11-10")

    # 21. Individual assignment with automatically resolved dates
    def test_21_individual_assignment_auto_resolved_dates(self):
        self.client.force_authenticate(user=self.dept_admin)
        # Omit effective_from and effective_to in payload
        payload = {
            "department": self.quran_dept.id,
            "teacher": self.teacher.id,
            "policy": self.policy.id,
            "notes": "Assigned with auto-resolved dates.",
        }
        res = self.client.post("/api/salary/assignments/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        # Should inherit self.version.effective_from ("2026-01-01") and effective_to (None)
        self.assertEqual(res.data["effective_from"], "2026-01-01")
        self.assertIsNone(res.data["effective_to"])
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher=self.teacher).count(), 1)
        # Check PlatformAuditLog
        audit = PlatformAuditLog.objects.filter(action="assign_policy", target_type="TeacherPolicyAssignment").first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.actor, self.dept_admin)

    # 22. Teacher joining date boundary enforcement
    def test_22_joining_date_boundary_enforcement(self):
        # Teacher with authoritative joining date in February 2026
        joined_user = User.objects.create_user(
            username="teacher_joined_feb",
            first_name="Hassan",
            password="password123",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.quran_dept,
        )
        joined_teacher = TeacherProfile.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            user=joined_user,
            joining_date=date(2026, 2, 1),
        )

        self.client.force_authenticate(user=self.dept_admin)

        # A) Auto-resolution: assignment starts at joining date, NOT policy start date
        res_auto = self.client.post(
            "/api/salary/assignments/",
            {
                "department": self.quran_dept.id,
                "teacher": joined_teacher.id,
                "policy": self.policy.id,
            },
            format="json",
        )
        self.assertEqual(res_auto.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_auto.data["effective_from"], "2026-02-01")

        # Clean up assignment for negative test
        TeacherPolicyAssignment.objects.filter(teacher=joined_teacher).delete()

        # B) Explicit dates: Attempting to assign before joining date must be rejected
        res_early = self.client.post(
            "/api/salary/assignments/",
            {
                "department": self.quran_dept.id,
                "teacher": joined_teacher.id,
                "policy": self.policy.id,
                "effective_from": "2026-01-15",  # Before Feb 1 joining date
            },
            format="json",
        )
        self.assertEqual(res_early.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("cannot precede teacher's joining date", str(res_early.data).lower())

    # 23. Policies with multiple published versions
    def test_23_multi_version_policy_effective_date_inheritance(self):
        # Policy with two contiguous versions:
        # Version 2: 2026-10-01 to 2026-11-09
        # Version 1: 2026-11-10 to indefinite
        multi_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="MULTI_VER_POLICY",
            name="Multi Version 2 Days Policy",
            created_by=self.dept_admin,
        )
        v2 = SalaryPolicyVersion.objects.create(
            policy=multi_policy,
            version_number=2,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 10, 1),
            effective_to=date(2026, 11, 9),
        )
        plan_v2 = SalaryTeachingPlan.objects.create(
            policy_version=v2, plan_code="5_days", plan_name="5 Days / Week", days_per_week=5, sort_order=1
        )
        tier_v2 = SalaryRateTier.objects.create(
            policy_version=v2, tier_name="Standard", min_students=1, sort_order=1
        )
        SalaryPlanTierRate.objects.create(
            policy_version=v2, teaching_plan=plan_v2, rate_tier=tier_v2, rate_per_class=Decimal("85.00")
        )
        v2.status = SalaryPolicyVersion.Status.PUBLISHED
        v2.save()

        v1 = SalaryPolicyVersion.objects.create(
            policy=multi_policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 11, 10),
            effective_to=None,
        )
        plan_v1 = SalaryTeachingPlan.objects.create(
            policy_version=v1, plan_code="5_days", plan_name="5 Days / Week", days_per_week=5, sort_order=1
        )
        tier_v1 = SalaryRateTier.objects.create(
            policy_version=v1, tier_name="Standard", min_students=1, sort_order=1
        )
        SalaryPlanTierRate.objects.create(
            policy_version=v1, teaching_plan=plan_v1, rate_tier=tier_v1, rate_per_class=Decimal("95.00")
        )
        v1.status = SalaryPolicyVersion.Status.PUBLISHED
        v1.save()

        self.client.force_authenticate(user=self.dept_admin)
        res = self.client.post(
            "/api/salary/assignments/",
            {
                "department": self.quran_dept.id,
                "teacher": self.teacher.id,
                "policy": multi_policy.id,
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        # Should cover from the earliest version start (2026-10-01) to indefinite (None)
        self.assertEqual(res.data["effective_from"], "2026-10-01")
        self.assertIsNone(res.data["effective_to"])

        # Stage 5 resolver check: Date in v2 resolves v2 rate (85.00)
        res_oct = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=date(2026, 10, 15),
            teaching_plan_code="5_days",
            student_count=5,
        )
        self.assertTrue(res_oct.is_resolved)
        self.assertEqual(res_oct.winning_rate, Decimal("85.00"))
        self.assertEqual(res_oct.policy_version["version_number"], 2)

        # Stage 5 resolver check: Date in v1 resolves v1 rate (95.00) without recreating assignment
        res_nov = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher.id,
            class_date=date(2026, 11, 15),
            teaching_plan_code="5_days",
            student_count=5,
        )
        self.assertTrue(res_nov.is_resolved)
        self.assertEqual(res_nov.winning_rate, Decimal("95.00"))
        self.assertEqual(res_nov.policy_version["version_number"], 1)

    # 24. Policy version gap enforcement
    def test_24_policy_version_gap_enforcement(self):
        # Policy with a gap: Jan-Mar (Q1), and Jul-Dec (H2). Gap in April, May, June.
        gap_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="GAP_POLICY",
            name="Policy With Gap",
            created_by=self.dept_admin,
        )
        SalaryPolicyVersion.objects.create(
            policy=gap_policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 3, 31),
        )
        SalaryPolicyVersion.objects.create(
            policy=gap_policy,
            version_number=2,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2026, 7, 1),
            effective_to=None,
        )

        self.client.force_authenticate(user=self.dept_admin)
        # Attempting explicit assignment starting in gap (e.g. May 1)
        res = self.client.post(
            "/api/salary/assignments/",
            {
                "department": self.quran_dept.id,
                "teacher": self.teacher.id,
                "policy": gap_policy.id,
                "effective_from": "2026-05-01",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("gap between published policy versions", str(res.data).lower())

    # 25. Bulk assignment of multiple eligible teachers
    def test_25_bulk_assignment_multiple_teachers(self):
        # Create 3 unassigned Quran teachers
        teachers = []
        for i in range(1, 4):
            u = User.objects.create_user(
                username=f"bulk_quran_teacher_{i}",
                first_name=f"Teacher{i}",
                password="password123",
                role=User.Role.TEACHER,
                institution=self.institution,
                department=self.quran_dept,
            )
            t = TeacherProfile.objects.create(
                institution=self.institution,
                department=self.quran_dept,
                user=u,
            )
            teachers.append(t)

        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t.id for t in teachers],
            "policy": self.policy.id,
            "notes": "Bulk assignment Q1 2026",
        }
        res = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["assigned_count"], 3)
        self.assertEqual(res.data["skipped_count"], 0)
        self.assertEqual(res.data["failed_count"], 0)
        self.assertEqual(len(res.data["successful"]), 3)

        # Verify assignments in database
        self.assertEqual(
            TeacherPolicyAssignment.objects.filter(
                teacher_id__in=[t.id for t in teachers],
                policy=self.policy,
                is_active=True,
            ).count(),
            3,
        )
        # Verify PlatformAuditLog was created for bulk operation
        batch_log = PlatformAuditLog.objects.filter(action="bulk_assign_policy").first()
        self.assertIsNotNone(batch_log)
        self.assertEqual(batch_log.details["assigned_count"], 3)

    # 26. Bulk assignment skips already assigned teachers without replacement confirmation
    def test_26_bulk_assignment_skips_already_assigned_without_replacement(self):
        u1 = User.objects.create_user(
            username="already_assigned_t1", password="password123", role=User.Role.TEACHER, department=self.quran_dept
        )
        t1 = TeacherProfile.objects.create(institution=self.institution, department=self.quran_dept, user=u1)
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t1,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

        u2 = User.objects.create_user(
            username="unassigned_t2", password="password123", role=User.Role.TEACHER, department=self.quran_dept
        )
        t2 = TeacherProfile.objects.create(institution=self.institution, department=self.quran_dept, user=u2)

        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t1.id, t2.id],
            "policy": self.policy.id,
            "replace_existing": False,
        }
        res = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["assigned_count"], 1)
        self.assertEqual(res.data["skipped_count"], 1)
        self.assertEqual(res.data["successful"][0]["teacher_id"], t2.id)
        self.assertEqual(res.data["skipped"][0]["teacher_id"], t1.id)
        self.assertIn("already", res.data["skipped"][0]["reason"].lower())

    # 27. Bulk assignment with explicit replacement confirmation preserves history
    def test_27_bulk_assignment_with_explicit_replacement_preserves_history(self):
        u = User.objects.create_user(
            username="reassigned_teacher", password="password123", role=User.Role.TEACHER, department=self.quran_dept
        )
        t = TeacherProfile.objects.create(institution=self.institution, department=self.quran_dept, user=u)

        old_assignment = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=t,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            is_active=True,
            notes="Original assignment",
        )

        # New policy starting July 1, 2026
        new_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="H2_QURAN_2026",
            name="Quran H2 2026 Policy",
            created_by=self.dept_admin,
        )
        SalaryPolicyVersion.objects.create(
            policy=new_policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2026, 7, 1),
            effective_to=None,
        )

        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t.id],
            "policy": new_policy.id,
            "replace_existing": True,  # Explicitly confirmed
        }
        res = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["assigned_count"], 1)
        self.assertTrue(res.data["successful"][0]["replaced_previous"])

        # Verify old assignment history was PRESERVED and capped at 2026-06-30
        old_assignment.refresh_from_db()
        self.assertEqual(old_assignment.effective_to, date(2026, 6, 30))
        # Total assignments for this teacher is now 2
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher=t).count(), 2)

    # 28. Bulk assignment repeated request idempotency
    def test_28_bulk_assignment_idempotency(self):
        u = User.objects.create_user(
            username="idempotent_t", password="password123", role=User.Role.TEACHER, department=self.quran_dept
        )
        t = TeacherProfile.objects.create(institution=self.institution, department=self.quran_dept, user=u)

        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [t.id],
            "policy": self.policy.id,
        }
        # First call: assigns
        res1 = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        self.assertEqual(res1.data["assigned_count"], 1)

        # Second call (identical): skipped gracefully without error or duplicates
        res2 = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertEqual(res2.data["assigned_count"], 0)
        self.assertEqual(res2.data["skipped_count"], 1)
        self.assertIn("already actively assigned", res2.data["skipped"][0]["reason"].lower())
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher=t).count(), 1)

    # 29. Bulk assignment cross-department rejection
    def test_29_bulk_assignment_cross_department_rejection(self):
        self.client.force_authenticate(user=self.dept_admin)
        # Attempt to include a Tuition teacher in Quran department bulk assignment
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [self.teacher.id, self.tuition_teacher.id],
            "policy": self.policy.id,
        }
        res = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("different department", str(res.data).lower())

    # 30. Bulk assignment unauthorized role rejection
    def test_30_bulk_assignment_unauthorized_role_rejection(self):
        # Teacher cannot bulk assign
        self.client.force_authenticate(user=self.teacher_user)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [self.teacher.id],
            "policy": self.policy.id,
        }
        res_t = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res_t.status_code, status.HTTP_403_FORBIDDEN)

        # Coordinator cannot bulk assign
        self.client.force_authenticate(user=self.coordinator_user)
        res_c = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res_c.status_code, status.HTTP_403_FORBIDDEN)

        # Tuition department admin cannot assign in Quran department
        self.client.force_authenticate(user=self.tuition_admin)
        res_cross = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res_cross.status_code, status.HTTP_403_FORBIDDEN)

    # 31. Bulk assignment transaction integrity
    def test_31_bulk_assignment_transaction_integrity(self):
        self.client.force_authenticate(user=self.dept_admin)
        # Request with a non-existent teacher ID (99999)
        payload = {
            "department": self.quran_dept.id,
            "teacher_ids": [self.teacher.id, 99999],
            "policy": self.policy.id,
        }
        res = self.client.post("/api/salary/assignments/bulk-assign/", payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        # Whole transaction rolled back: self.teacher should NOT be assigned
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher=self.teacher).count(), 0)

    # 32. Stage 5 policy resolution after assignment
    def test_32_stage_5_policy_resolution_after_assignment(self):
        u = User.objects.create_user(
            username="stage5_teacher", password="password123", role=User.Role.TEACHER, department=self.quran_dept
        )
        t = TeacherProfile.objects.create(institution=self.institution, department=self.quran_dept, user=u)

        self.client.force_authenticate(user=self.dept_admin)
        res_assign = self.client.post(
            "/api/salary/assignments/",
            {
                "department": self.quran_dept.id,
                "teacher": t.id,
                "policy": self.policy.id,
            },
            format="json",
        )
        self.assertEqual(res_assign.status_code, status.HTTP_201_CREATED)

        # Deterministic preview rate on 2026-03-15 for 5_days plan and 10 students
        res_preview = self.client.post(
            "/api/salary/preview-rate/",
            {
                "department_id": self.quran_dept.id,
                "teacher_id": t.id,
                "class_date": "2026-03-15",
                "teaching_plan_code": "5_days",
                "student_count": 10,
            },
            format="json",
        )
        self.assertEqual(res_preview.status_code, status.HTTP_200_OK)
        self.assertTrue(res_preview.data["is_resolved"])
        self.assertEqual(res_preview.data["winning_rate"], "80.00")
        self.assertEqual(res_preview.data["precedence_level"], 5)
        self.assertEqual(res_preview.data["salary_policy"]["code"], "QURAN_STD_2026")
