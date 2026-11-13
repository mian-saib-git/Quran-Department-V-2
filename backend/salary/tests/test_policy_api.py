"""Automated Tests for Unified Salary Management (Stage 2 Policy Builder API).

Validates:
1. Policy listing and department-scoping
2. Department isolation (cross-department denial)
3. Institution isolation (cross-institution denial)
4. Unauthorized roles rejection (teachers, students, coordinators)
5. Policy creation and spoofed department ID rejection
6. Draft version creation
7. Draft version editing
8. Tier creation and overlap rejection
9. Teaching plan creation and uniqueness
10. Rate matrix saving and retrieval
11. Negative rate rejection
12. Cross-version foreign plan/tier rejection
13. Publication with missing rates rejection
14. Publication with tier gaps rejection
15. Successful publication and immutability enforcement
16. Clone published version to new editable draft
17. Effective-date overlap rejection with existing published versions
18. Reference Quran rate template application
"""
from datetime import date
from decimal import Decimal
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Department, Institution, PlatformAuditLog, User, UserDepartmentRole
from academy.models import TeacherProfile
from salary.models import (
    PayrollEarningLine,
    SalaryPayrollPeriod,
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    TeacherPayroll,
)


class SalaryPolicyApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Institution 1
        self.inst1 = Institution.objects.create(name="Primary Institution", slug="primary-inst")
        self.dept_quran = Department.objects.create(
            institution=self.inst1,
            name="Quran Department",
            code="QURAN_MAIN",
        )
        self.dept_tuition = Department.objects.create(
            institution=self.inst1,
            name="Tuition Department",
            code="TUITION_MAIN",
        )

        # Institution 2 (for cross-institution testing)
        self.inst2 = Institution.objects.create(name="Secondary Institution", slug="secondary-inst")
        self.dept_other = Department.objects.create(
            institution=self.inst2,
            name="Other Department",
            code="OTHER_DEPT",
        )

        # Users
        self.quran_admin = User.objects.create_user(
            username="quran_admin",
            password="test-password-123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst1,
            department=self.dept_quran,
        )
        self.tuition_admin = User.objects.create_user(
            username="tuition_admin",
            password="test-password-123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst1,
            department=self.dept_tuition,
        )
        self.inst_admin = User.objects.create_user(
            username="inst_admin",
            password="test-password-123",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.inst1,
        )
        self.super_admin = User.objects.create_superuser(
            username="super_admin",
            password="test-password-123",
            email="super@ivs.com",
        )
        self.coordinator = User.objects.create_user(
            username="coordinator_user",
            password="test-password-123",
            role=User.Role.COORDINATOR,
            institution=self.inst1,
            department=self.dept_quran,
        )
        self.teacher = User.objects.create_user(
            username="teacher_user",
            password="test-password-123",
            role=User.Role.TEACHER,
            institution=self.inst1,
            department=self.dept_quran,
        )
        self.student = User.objects.create_user(
            username="student_user",
            password="test-password-123",
            role=User.Role.STUDENT,
            institution=self.inst1,
            department=self.dept_quran,
        )

        # Create an existing Quran policy
        self.quran_policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="QURAN_STD_2026",
            name="Quran Standard 2026",
            description="Standard per-class teaching policy",
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
            created_by=self.quran_admin,
        )

    # 1. Policy listing and department-scoping
    def test_01_policy_listing_department_scoping(self):
        self.client.force_authenticate(user=self.quran_admin)
        res = self.client.get("/api/salary/policies/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        codes = [p["code"] for p in res.data]
        self.assertIn("QURAN_STD_2026", codes)

    # 2. Department isolation (cross-department denial)
    def test_02_department_isolation_cross_department_denial(self):
        # Tuition Admin cannot see Quran policy
        self.client.force_authenticate(user=self.tuition_admin)
        res = self.client.get("/api/salary/policies/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        codes = [p["code"] for p in res.data]
        self.assertNotIn("QURAN_STD_2026", codes)

        # Tuition Admin cannot directly retrieve Quran policy
        res_detail = self.client.get(f"/api/salary/policies/{self.quran_policy.id}/")
        self.assertEqual(res_detail.status_code, status.HTTP_403_FORBIDDEN)

        # Tuition Admin cannot mutate Quran policy
        res_patch = self.client.patch(f"/api/salary/policies/{self.quran_policy.id}/", {"name": "Hacked"})
        self.assertEqual(res_patch.status_code, status.HTTP_403_FORBIDDEN)

    # 3. Institution isolation (cross-institution denial)
    def test_03_institution_isolation(self):
        # Admin from inst2
        other_admin = User.objects.create_user(
            username="other_admin",
            password="test-password-123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst2,
            department=self.dept_other,
        )
        self.client.force_authenticate(user=other_admin)
        res = self.client.get(f"/api/salary/policies/{self.quran_policy.id}/")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 4. Unauthorized roles rejection (teachers, students, coordinators)
    def test_04_unauthorized_roles_rejection(self):
        for unauthorized_user in [self.coordinator, self.teacher, self.student]:
            self.client.force_authenticate(user=unauthorized_user)
            # List
            res_list = self.client.get("/api/salary/policies/")
            self.assertEqual(res_list.status_code, status.HTTP_403_FORBIDDEN)
            # Detail
            res_det = self.client.get(f"/api/salary/policies/{self.quran_policy.id}/")
            self.assertEqual(res_det.status_code, status.HTTP_403_FORBIDDEN)
            # Create
            res_create = self.client.post("/api/salary/policies/", {
                "name": "Unauthorized Policy",
                "code": "UNAUTH_01",
            })
            self.assertEqual(res_create.status_code, status.HTTP_403_FORBIDDEN)

    # 5. Policy creation and spoofed department ID rejection
    def test_05_policy_creation_spoofed_department_rejected(self):
        self.client.force_authenticate(user=self.quran_admin)

        # Successfully create policy in Quran department
        res = self.client.post("/api/salary/policies/", {
            "name": "Quran Hifz Policy",
            "code": "QURAN_HIFZ_2026",
            "policy_type": "hifz",
            "compensation_model": "per_class",
        })
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        created = SalaryPolicy.objects.get(code="QURAN_HIFZ_2026")
        self.assertEqual(created.department_id, self.dept_quran.id)
        self.assertEqual(created.institution_id, self.inst1.id)

        # Attempt to spoof tuition department ID
        res_spoof = self.client.post("/api/salary/policies/", {
            "name": "Spoofed Tuition Policy",
            "code": "SPOOFED_TUITION",
            "department": self.dept_tuition.id,
        })
        # Must be rejected because quran_admin is not dept admin of tuition
        self.assertEqual(res_spoof.status_code, status.HTTP_403_FORBIDDEN)

    # 6. Draft version creation
    def test_06_draft_version_creation(self):
        self.client.force_authenticate(user=self.quran_admin)
        res = self.client.post(f"/api/salary/policies/{self.quran_policy.id}/create-draft/", {
            "effective_from": "2026-01-01",
            "effective_to": "2026-12-31",
            "week_start_day": "monday",
            "min_qualifying_weeks": 2,
            "lesson_plan_bonus_per_class": "10.00",
            "substitute_rate_per_class": "80.00",
            "cancellation_rate_per_class": "80.00",
            "notes": "Initial 2026 Draft Version",
        })
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data["version_number"], 1)
        self.assertEqual(res.data["status"], "draft")

    # 7. Draft version editing
    def test_07_draft_version_editing(self):
        self.client.force_authenticate(user=self.quran_admin)
        version = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
            lesson_plan_bonus_per_class=Decimal("10.00"),
        )
        res = self.client.patch(f"/api/salary/versions/{version.id}/", {
            "lesson_plan_bonus_per_class": "15.00",
            "week_start_day": "sunday",
        })
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        version.refresh_from_db()
        self.assertEqual(version.lesson_plan_bonus_per_class, Decimal("15.00"))
        self.assertEqual(version.week_start_day, "sunday")

    # 8. Tier creation and overlap rejection
    def test_08_tier_creation_and_overlap_rejection(self):
        self.client.force_authenticate(user=self.quran_admin)
        version = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        # Create Tier 1: 1-15
        res1 = self.client.post(f"/api/salary/versions/{version.id}/tiers/", {
            "tier_name": "1–15 students",
            "min_students": 1,
            "max_students": 15,
            "sort_order": 1,
        })
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Create Overlapping Tier: 10-20 (must be rejected)
        res_overlap = self.client.post(f"/api/salary/versions/{version.id}/tiers/", {
            "tier_name": "Overlapping",
            "min_students": 10,
            "max_students": 20,
            "sort_order": 2,
        })
        self.assertEqual(res_overlap.status_code, status.HTTP_400_BAD_REQUEST)

    # 9. Teaching plan creation and uniqueness
    def test_09_teaching_plan_creation(self):
        self.client.force_authenticate(user=self.quran_admin)
        version = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        # Add 5 days plan
        res = self.client.post(f"/api/salary/versions/{version.id}/plans/", {
            "plan_code": "5_days",
            "plan_name": "5 days/week",
            "days_per_week": 5,
            "is_coordinator_special": False,
            "sort_order": 1,
        })
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)

        # Add duplicate plan code (must be rejected)
        res_dup = self.client.post(f"/api/salary/versions/{version.id}/plans/", {
            "plan_code": "5_days",
            "plan_name": "Duplicate Plan",
            "days_per_week": 5,
        })
        self.assertEqual(res_dup.status_code, status.HTTP_400_BAD_REQUEST)

    # 10. Rate matrix saving and retrieval
    def test_10_rate_matrix_saving_and_retrieval(self):
        self.client.force_authenticate(user=self.quran_admin)
        version = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        tier1 = SalaryRateTier.objects.create(policy_version=version, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        plan1 = SalaryTeachingPlan.objects.create(policy_version=version, plan_code="5_days", plan_name="5 days", days_per_week=5)

        # Batch save rate matrix
        res = self.client.post(f"/api/salary/versions/{version.id}/matrix/", {
            "rates": [
                {
                    "teaching_plan_id": plan1.id,
                    "rate_tier_id": tier1.id,
                    "rate_per_class": "80.00",
                }
            ]
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["saved_count"], 1)

        # Retrieve matrix
        res_get = self.client.get(f"/api/salary/versions/{version.id}/matrix/")
        self.assertEqual(res_get.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_get.data["rates"]), 1)
        self.assertEqual(Decimal(res_get.data["rates"][0]["rate_per_class"]), Decimal("80.00"))

    # 11. Negative rate rejection
    def test_11_negative_rate_rejection(self):
        self.client.force_authenticate(user=self.quran_admin)
        version = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        tier = SalaryRateTier.objects.create(policy_version=version, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        plan = SalaryTeachingPlan.objects.create(policy_version=version, plan_code="5_days", plan_name="5 days", days_per_week=5)

        res = self.client.post(f"/api/salary/versions/{version.id}/matrix/", {
            "rates": [
                {
                    "teaching_plan_id": plan.id,
                    "rate_tier_id": tier.id,
                    "rate_per_class": "-50.00",
                }
            ]
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    # 12. Cross-version foreign plan/tier rejection
    def test_12_cross_version_foreign_plan_rejection(self):
        self.client.force_authenticate(user=self.quran_admin)
        v1 = SalaryPolicyVersion.objects.create(policy=self.quran_policy, version_number=1, effective_from=date(2026, 1, 1))
        v2 = SalaryPolicyVersion.objects.create(policy=self.quran_policy, version_number=2, effective_from=date(2026, 7, 1))

        t1 = SalaryRateTier.objects.create(policy_version=v1, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        p2 = SalaryTeachingPlan.objects.create(policy_version=v2, plan_code="5_days", plan_name="5 days", days_per_week=5)

        # Attempt to save rate on v1 referencing p2 (which belongs to v2)
        res = self.client.post(f"/api/salary/versions/{v1.id}/matrix/", {
            "rates": [
                {
                    "teaching_plan_id": p2.id,  # From foreign version v2!
                    "rate_tier_id": t1.id,
                    "rate_per_class": "100.00",
                }
            ]
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    # 13. Publication with missing rates rejection
    def test_13_publication_with_missing_rates_rejected(self):
        self.client.force_authenticate(user=self.quran_admin)
        version = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        SalaryRateTier.objects.create(policy_version=version, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        SalaryRateTier.objects.create(policy_version=version, tier_name="16+", min_students=16, max_students=None, sort_order=2)
        SalaryTeachingPlan.objects.create(policy_version=version, plan_code="5_days", plan_name="5 days", days_per_week=5)

        # Dry-run validation should fail
        val_res = self.client.post(f"/api/salary/versions/{version.id}/validate/")
        self.assertEqual(val_res.status_code, status.HTTP_200_OK)
        self.assertFalse(val_res.data["is_valid"])
        self.assertTrue(any("incomplete" in err.lower() for err in val_res.data["errors"]))

        # Publish attempt must fail
        pub_res = self.client.post(f"/api/salary/versions/{version.id}/publish/")
        self.assertEqual(pub_res.status_code, status.HTTP_400_BAD_REQUEST)

    # 14. Publication with tier gaps rejection
    def test_14_publication_with_tier_gaps_rejected(self):
        self.client.force_authenticate(user=self.quran_admin)
        version = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        # Gap between 15 and 18
        SalaryRateTier.objects.create(policy_version=version, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        SalaryRateTier.objects.create(policy_version=version, tier_name="18+", min_students=18, max_students=None, sort_order=2)
        SalaryTeachingPlan.objects.create(policy_version=version, plan_code="5_days", plan_name="5 days", days_per_week=5)

        val_res = self.client.post(f"/api/salary/versions/{version.id}/validate/")
        self.assertFalse(val_res.data["is_valid"])
        self.assertTrue(any("gap" in err.lower() for err in val_res.data["errors"]))

    # 15. Successful publication and immutability enforcement
    def test_15_successful_publication_and_immutability(self):
        self.client.force_authenticate(user=self.quran_admin)
        version = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        # Apply reference Quran template (complete 5 plans, 3 tiers, 15 rates)
        self.client.post(f"/api/salary/versions/{version.id}/apply-template/")

        # Validate
        val_res = self.client.post(f"/api/salary/versions/{version.id}/validate/")
        self.assertTrue(val_res.data["is_valid"])

        # Publish
        pub_res = self.client.post(f"/api/salary/versions/{version.id}/publish/")
        self.assertEqual(pub_res.status_code, status.HTTP_200_OK)
        self.assertEqual(pub_res.data["status"], "published")

        version.refresh_from_db()
        self.assertEqual(version.status, SalaryPolicyVersion.Status.PUBLISHED)
        self.assertIsNotNone(version.published_at)

        # Immutability: patch parameter must fail
        res_patch = self.client.patch(f"/api/salary/versions/{version.id}/", {"lesson_plan_bonus_per_class": "20.00"})
        self.assertEqual(res_patch.status_code, status.HTTP_400_BAD_REQUEST)

        # Immutability: add tier must fail
        res_tier = self.client.post(f"/api/salary/versions/{version.id}/tiers/", {
            "tier_name": "New Tier", "min_students": 30, "max_students": 50, "sort_order": 4
        })
        self.assertEqual(res_tier.status_code, status.HTTP_400_BAD_REQUEST)

        # Immutability: modify rate matrix must fail
        plan = version.teaching_plans.first()
        tier = version.rate_tiers.first()
        res_matrix = self.client.post(f"/api/salary/versions/{version.id}/matrix/", {
            "rates": [{"teaching_plan_id": plan.id, "rate_tier_id": tier.id, "rate_per_class": "999.00"}]
        })
        self.assertEqual(res_matrix.status_code, status.HTTP_400_BAD_REQUEST)

    # 16. Clone published version to new editable draft
    def test_16_clone_published_version_to_draft(self):
        self.client.force_authenticate(user=self.quran_admin)
        version = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        self.client.post(f"/api/salary/versions/{version.id}/apply-template/")
        self.client.post(f"/api/salary/versions/{version.id}/publish/")

        # Clone to draft
        res_clone = self.client.post(f"/api/salary/versions/{version.id}/clone/", {
            "effective_from": "2027-01-01",
        })
        self.assertEqual(res_clone.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res_clone.data["version_number"], 2)
        self.assertEqual(res_clone.data["status"], "draft")
        self.assertEqual(res_clone.data["tiers_count"], 3)
        self.assertEqual(res_clone.data["plans_count"], 5)
        self.assertEqual(res_clone.data["rates_count"], 15)

        # The new draft CAN be edited
        new_v_id = res_clone.data["id"]
        res_edit = self.client.patch(f"/api/salary/versions/{new_v_id}/", {
            "lesson_plan_bonus_per_class": "25.00",
        })
        self.assertEqual(res_edit.status_code, status.HTTP_200_OK)

    # 17. Effective-date overlap rejection with existing published versions
    def test_17_effective_date_overlap_rejection(self):
        self.client.force_authenticate(user=self.quran_admin)
        v1 = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 12, 31),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        self.client.post(f"/api/salary/versions/{v1.id}/apply-template/")
        self.client.post(f"/api/salary/versions/{v1.id}/publish/")

        # Create v2 with overlapping dates
        v2 = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=2,
            effective_from=date(2026, 6, 1),  # Overlaps with 2026-01-01 to 2026-12-31!
            effective_to=date(2027, 5, 31),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        self.client.post(f"/api/salary/versions/{v2.id}/apply-template/")

        # Validate should report date overlap error
        val_res = self.client.post(f"/api/salary/versions/{v2.id}/validate/")
        self.assertFalse(val_res.data["is_valid"])
        self.assertTrue(any("overlap" in err.lower() for err in val_res.data["errors"]))

        # Publish must fail
        pub_res = self.client.post(f"/api/salary/versions/{v2.id}/publish/")
        self.assertEqual(pub_res.status_code, status.HTTP_400_BAD_REQUEST)

    # 18. Reference Quran rate template application
    def test_18_reference_quran_template_application(self):
        self.client.force_authenticate(user=self.quran_admin)
        version = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        res = self.client.post(f"/api/salary/versions/{version.id}/apply-template/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        version.refresh_from_db()
        self.assertEqual(version.rate_tiers.count(), 3)
        self.assertEqual(version.teaching_plans.count(), 5)
        self.assertEqual(version.plan_tier_rates.count(), 15)

        # Verify rate precision (Coordinator special x 20+ students = 250.00)
        coord_plan = version.teaching_plans.get(plan_code="coordinator_special")
        tier_20_plus = version.rate_tiers.get(min_students=20)
        rate_entry = version.plan_tier_rates.get(teaching_plan=coord_plan, rate_tier=tier_20_plus)
        self.assertEqual(rate_entry.rate_per_class, Decimal("250.00"))

    # 19. Draft version permanent deletion by authorized department admin
    def test_19_draft_version_permanent_deletion_by_admin(self):
        self.client.force_authenticate(user=self.quran_admin)
        version = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=10,
            effective_from=date(2026, 8, 1),
            effective_to=date(2026, 9, 30),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        self.client.post(f"/api/salary/versions/{version.id}/apply-template/")
        version_id = version.id

        # Verify initial related records
        self.assertEqual(SalaryRateTier.objects.filter(policy_version_id=version_id).count(), 3)
        self.assertEqual(SalaryTeachingPlan.objects.filter(policy_version_id=version_id).count(), 5)
        self.assertEqual(SalaryPlanTierRate.objects.filter(policy_version_id=version_id).count(), 15)

        # Authorized Admin DELETE
        res = self.client.delete(f"/api/salary/versions/{version_id}/")
        self.assertIn(res.status_code, (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT))

        # Confirm permanent deletion from database
        self.assertFalse(SalaryPolicyVersion.objects.filter(id=version_id).exists())
        self.assertFalse(SalaryRateTier.objects.filter(policy_version_id=version_id).exists())
        self.assertFalse(SalaryTeachingPlan.objects.filter(policy_version_id=version_id).exists())
        self.assertFalse(SalaryPlanTierRate.objects.filter(policy_version_id=version_id).exists())

        # Confirm PlatformAuditLog was written
        audit = PlatformAuditLog.objects.filter(
            action="policy_version_deleted",
            target_id=str(version_id),
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.actor, self.quran_admin)
        self.assertEqual(audit.category, "salary_policy")
        self.assertIn("v10", audit.summary)

    # 20. Published version revert to draft and direct permanent deletion
    def test_20_published_version_revert_and_deletion(self):
        self.client.force_authenticate(user=self.quran_admin)
        version = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=11,
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 12, 31),
            status=SalaryPolicyVersion.Status.DRAFT,
        )
        self.client.post(f"/api/salary/versions/{version.id}/apply-template/")
        self.client.post(f"/api/salary/versions/{version.id}/publish/")

        version.refresh_from_db()
        self.assertEqual(version.status, SalaryPolicyVersion.Status.PUBLISHED)

        # 1. Revert to draft endpoint
        revert_res = self.client.post(f"/api/salary/versions/{version.id}/revert-to-draft/")
        self.assertEqual(revert_res.status_code, status.HTTP_200_OK)
        version.refresh_from_db()
        self.assertEqual(version.status, SalaryPolicyVersion.Status.DRAFT)
        self.assertIsNone(version.published_at)

        # 2. Permanent deletion of unreferenced draft
        del_res = self.client.delete(f"/api/salary/versions/{version.id}/")
        self.assertEqual(del_res.status_code, status.HTTP_200_OK)
        self.assertFalse(SalaryPolicyVersion.objects.filter(id=version.id).exists())

    # 21. Non-admin roles and cross-department admins forbidden from deletion
    def test_21_non_admin_and_cross_department_deletion_forbidden(self):
        draft = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=12,
            effective_from=date(2026, 8, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
        )

        # Cross-department admin (Tuition Admin cannot delete Quran draft)
        self.client.force_authenticate(user=self.tuition_admin)
        res_cross = self.client.delete(f"/api/salary/versions/{draft.id}/")
        self.assertEqual(res_cross.status_code, status.HTTP_403_FORBIDDEN)

        # Teacher
        self.client.force_authenticate(user=self.teacher)
        res_teacher = self.client.delete(f"/api/salary/versions/{draft.id}/")
        self.assertEqual(res_teacher.status_code, status.HTTP_403_FORBIDDEN)

        # Coordinator
        self.client.force_authenticate(user=self.coordinator)
        res_coord = self.client.delete(f"/api/salary/versions/{draft.id}/")
        self.assertEqual(res_coord.status_code, status.HTTP_403_FORBIDDEN)

        # Student
        self.client.force_authenticate(user=self.student)
        res_student = self.client.delete(f"/api/salary/versions/{draft.id}/")
        self.assertEqual(res_student.status_code, status.HTTP_403_FORBIDDEN)

        # Institution Admin (read-only)
        self.client.force_authenticate(user=self.inst_admin)
        res_inst = self.client.delete(f"/api/salary/versions/{draft.id}/")
        self.assertEqual(res_inst.status_code, status.HTTP_403_FORBIDDEN)

        # Verify draft was NOT deleted
        self.assertTrue(SalaryPolicyVersion.objects.filter(id=draft.id).exists())

    # 22. Deletion blocked if referenced by teacher payroll
    def test_22_referenced_payroll_version_deletion_blocked(self):
        self.client.force_authenticate(user=self.quran_admin)
        draft = SalaryPolicyVersion.objects.create(
            policy=self.quran_policy,
            version_number=13,
            effective_from=date(2026, 8, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
        )

        teacher_profile = TeacherProfile.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            user=self.teacher,
        )
        period = SalaryPayrollPeriod.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            payroll_year=2026,
            payroll_month=8,
        )
        TeacherPayroll.objects.create(
            payroll_period=period,
            teacher=teacher_profile,
            applied_policy_version=draft,
        )

        res = self.client.delete(f"/api/salary/versions/{draft.id}/")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("payroll", str(res.data).lower())
        self.assertTrue(SalaryPolicyVersion.objects.filter(id=draft.id).exists())
