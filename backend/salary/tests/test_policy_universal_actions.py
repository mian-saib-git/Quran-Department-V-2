"""Automated Verification Tests for Universal Salary Policy Management:
Delete Permanently, Discard Draft, Deactivate/Activate, Archive, Restore.

Covers all 10 required verification scenarios:
1. Delete an unused new policy.
2. Discard an unused draft version.
3. Discard a draft belonging to a policy that also has a published version.
4. Deactivate an active policy.
5. Archive an inactive policy with historical assignments (like 2ivq).
6. Restore an archived policy.
7. Confirm archived policies disappear from new assignment dropdowns and cannot be assigned.
8. Verify correct published/inactive status and eligibility details.
9. Verify permissions across multiple institutions and departments.
10. Confirm historical salary calculations and payroll remain intact (immutability).
"""
from datetime import date
from decimal import Decimal
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Department, Institution, PlatformAuditLog, User
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
    TeacherPolicyAssignment,
    TeacherSalaryOverride,
)


class UniversalPolicyManagementTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Institution A (Primary)
        self.inst_a = Institution.objects.create(name="Institution Alpha", slug="inst-alpha")
        self.dept_quran = Department.objects.create(
            institution=self.inst_a,
            name="Quran Department",
            code="DEPT_QURAN",
        )
        self.dept_math = Department.objects.create(
            institution=self.inst_a,
            name="Math Department",
            code="DEPT_MATH",
        )

        # Institution B (Secondary - for isolation checks)
        self.inst_b = Institution.objects.create(name="Institution Beta", slug="inst-beta")
        self.dept_beta = Department.objects.create(
            institution=self.inst_b,
            name="Beta Department",
            code="DEPT_BETA",
        )

        # Users
        self.quran_admin = User.objects.create_user(
            username="quran_admin_uni",
            password="test-password-123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst_a,
            department=self.dept_quran,
        )
        self.math_admin = User.objects.create_user(
            username="math_admin_uni",
            password="test-password-123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst_a,
            department=self.dept_math,
        )
        self.inst_a_admin = User.objects.create_user(
            username="inst_a_admin_uni",
            password="test-password-123",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.inst_a,
        )
        self.inst_b_admin = User.objects.create_user(
            username="inst_b_admin_uni",
            password="test-password-123",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.inst_b,
        )
        self.super_admin = User.objects.create_superuser(
            username="super_admin_uni",
            password="test-password-123",
            email="super_uni@ivs.com",
            role=User.Role.PLATFORM_ADMIN,
        )
        self.teacher_user = User.objects.create_user(
            username="teacher_user_uni",
            password="test-password-123",
            role=User.Role.TEACHER,
            institution=self.inst_a,
            department=self.dept_quran,
        )
        self.teacher_profile = TeacherProfile.objects.create(
            institution=self.inst_a,
            department=self.dept_quran,
            user=self.teacher_user,
        )

    # Scenario 1: Delete an unused new policy
    def test_01_delete_unused_new_policy(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst_a,
            department=self.dept_quran,
            code="NEW_UNUSED_POL",
            name="Brand New Unused Policy",
            is_active=False,
        )
        elig_res = self.client.get(f"/api/salary/policies/{policy.id}/deletion-eligibility/")
        self.assertEqual(elig_res.status_code, status.HTTP_200_OK)
        self.assertTrue(elig_res.data["can_delete"])

        del_res = self.client.delete(f"/api/salary/policies/{policy.id}/")
        self.assertIn(del_res.status_code, [status.HTTP_200_OK, status.HTTP_204_NO_CONTENT])
        self.assertFalse(SalaryPolicy.objects.filter(id=policy.id).exists())

    # Scenario 2: Discard an unused draft version
    def test_02_discard_unused_draft_version(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst_a,
            department=self.dept_quran,
            code="DRAFT_POL_02",
            name="Draft Version Policy",
            is_active=True,
        )
        draft_ver = SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
        )
        tier = SalaryRateTier.objects.create(
            policy_version=draft_ver,
            tier_name="Tier 1",
            min_students=1,
            max_students=5,
            sort_order=1,
        )
        plan = SalaryTeachingPlan.objects.create(
            policy_version=draft_ver,
            plan_code="plan_3d",
            plan_name="Plan 3D",
            days_per_week=3,
            sort_order=1,
        )
        SalaryPlanTierRate.objects.create(
            policy_version=draft_ver,
            teaching_plan=plan,
            rate_tier=tier,
            rate_per_class=Decimal("150.00"),
        )

        res = self.client.delete(f"/api/salary/versions/{draft_ver.id}/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(SalaryPolicyVersion.objects.filter(id=draft_ver.id).exists())
        self.assertFalse(SalaryRateTier.objects.filter(id=tier.id).exists())
        self.assertFalse(SalaryTeachingPlan.objects.filter(id=plan.id).exists())
        # Parent policy remains intact
        self.assertTrue(SalaryPolicy.objects.filter(id=policy.id).exists())

    # Scenario 3: Discard a draft belonging to a policy that also has a published version and assignments
    def test_03_discard_draft_on_policy_with_published_version_and_assignments(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst_a,
            department=self.dept_quran,
            code="PUB_AND_DRAFT_POL",
            name="Policy With Both",
            is_active=True,
        )
        pub_ver = SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2026, 1, 1),
            published_at=timezone.now(),
        )
        # Teacher is assigned to the policy
        TeacherPolicyAssignment.objects.create(
            department=self.dept_quran,
            teacher=self.teacher_profile,
            policy=policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        # Add a new draft version (v2)
        draft_v2 = SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=2,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 2, 1),
        )

        # Deleting draft v2 MUST SUCCEED even though policy has published version & teacher assignments
        res = self.client.delete(f"/api/salary/versions/{draft_v2.id}/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(SalaryPolicyVersion.objects.filter(id=draft_v2.id).exists())
        # Published version and assignments MUST remain completely untouched
        self.assertTrue(SalaryPolicyVersion.objects.filter(id=pub_ver.id).exists())
        self.assertTrue(TeacherPolicyAssignment.objects.filter(policy=policy).exists())

    # Scenario 4: Deactivate an active policy
    def test_04_deactivate_active_policy(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst_a,
            department=self.dept_quran,
            code="DEACT_POL_04",
            name="Policy To Deactivate",
            is_active=True,
        )
        res = self.client.post(f"/api/salary/policies/{policy.id}/deactivate/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        policy.refresh_from_db()
        self.assertFalse(policy.is_active)
        self.assertFalse(policy.is_archived)

        # Test reactivating it
        res_act = self.client.post(f"/api/salary/policies/{policy.id}/activate/")
        self.assertEqual(res_act.status_code, status.HTTP_200_OK)
        policy.refresh_from_db()
        self.assertTrue(policy.is_active)

    # Scenario 5: Archive an inactive policy with historical assignments (like 2ivq)
    def test_05_archive_inactive_policy_with_historical_assignments(self):
        self.client.force_authenticate(user=self.quran_admin)
        # Mimic 2ivq: inactive, published version, historical assignment
        policy = SalaryPolicy.objects.create(
            institution=self.inst_a,
            department=self.dept_quran,
            code="2ivq_SIM",
            name="Simulated 2ivq Policy",
            is_active=False,
            is_archived=False,
        )
        pub_ver = SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2025, 1, 1),
            published_at=timezone.now(),
        )
        assignment = TeacherPolicyAssignment.objects.create(
            department=self.dept_quran,
            teacher=self.teacher_profile,
            policy=policy,
            effective_from=date(2025, 1, 1),
            effective_to=date(2025, 12, 31),
            is_active=False,  # Historical assignment
        )

        # Under new safe permanent deletion rules, published version with historical assignments
        # is eligible for permanent deletion because complete snapshots preserve historical data
        elig_res = self.client.get(f"/api/salary/policies/{policy.id}/deletion-eligibility/")
        self.assertEqual(elig_res.status_code, status.HTTP_200_OK)
        self.assertTrue(elig_res.data["can_delete"])

        # Administrator can directly archive the policy WITHOUT activating it first
        arch_res = self.client.post(f"/api/salary/policies/{policy.id}/archive/")
        self.assertEqual(arch_res.status_code, status.HTTP_200_OK)
        policy.refresh_from_db()
        self.assertTrue(policy.is_archived)
        self.assertIsNotNone(policy.archived_at)
        self.assertEqual(policy.archived_by, self.quran_admin)
        self.assertFalse(policy.is_active)

        # Published version and historical assignments remain completely intact
        self.assertTrue(SalaryPolicyVersion.objects.filter(id=pub_ver.id).exists())
        self.assertTrue(TeacherPolicyAssignment.objects.filter(id=assignment.id).exists())

    # Scenario 6: Restore an archived policy
    def test_06_restore_archived_policy(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst_a,
            department=self.dept_quran,
            code="RESTORE_POL_06",
            name="Policy To Restore",
            is_active=True,
            is_archived=True,
            archived_at=timezone.now(),
            archived_by=self.quran_admin,
        )
        res = self.client.post(f"/api/salary/policies/{policy.id}/restore/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        policy.refresh_from_db()
        self.assertFalse(policy.is_archived)
        self.assertIsNone(policy.archived_at)
        self.assertIsNone(policy.archived_by)
        # Must restore to inactive state to allow inspection before re-enabling
        self.assertFalse(policy.is_active)

    # Scenario 7: Archived policies disappear from new assignment dropdowns and cannot be assigned
    def test_07_archived_policies_disappear_and_cannot_be_assigned(self):
        self.client.force_authenticate(user=self.quran_admin)
        active_pol = SalaryPolicy.objects.create(
            institution=self.inst_a,
            department=self.dept_quran,
            code="ACT_07",
            name="Active Policy",
            is_active=True,
            is_archived=False,
        )
        SalaryPolicyVersion.objects.create(
            policy=active_pol,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2026, 1, 1),
            published_at=timezone.now(),
        )

        arch_pol = SalaryPolicy.objects.create(
            institution=self.inst_a,
            department=self.dept_quran,
            code="ARCH_07",
            name="Archived Policy",
            is_active=False,
            is_archived=True,
        )
        SalaryPolicyVersion.objects.create(
            policy=arch_pol,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2026, 1, 1),
            published_at=timezone.now(),
        )

        # 1. Listing with status=active excludes archived policies
        res = self.client.get(f"/api/salary/policies/?department_id={self.dept_quran.id}&status=active")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        returned_ids = [p["id"] for p in res.data]
        self.assertIn(active_pol.id, returned_ids)
        self.assertNotIn(arch_pol.id, returned_ids)

        # 2. Assigning an archived policy is blocked
        assign_res = self.client.post(
            "/api/salary/assignments/",
            {
                "department": self.dept_quran.id,
                "teacher": self.teacher_profile.id,
                "policy": arch_pol.id,
                "effective_from": "2026-03-01",
            },
        )
        self.assertEqual(assign_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("archived", str(assign_res.data).lower())

        # 3. Bulk assigning an archived policy is blocked
        bulk_res = self.client.post(
            "/api/salary/assignments/bulk-assign/",
            {
                "department_id": self.dept_quran.id,
                "teacher_ids": [self.teacher_profile.id],
                "policy": arch_pol.id,
                "effective_from": "2026-03-01",
            },
        )
        self.assertEqual(bulk_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("archived", str(bulk_res.data).lower())

    # Scenario 8: Verify correct published/inactive status labels & eligibility
    def test_08_correct_published_inactive_status_and_eligibility(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst_a,
            department=self.dept_quran,
            code="STATUS_08",
            name="Status Check Policy",
            is_active=False,
            is_archived=False,
        )
        SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2026, 1, 1),
            published_at=timezone.now(),
        )
        res = self.client.get(f"/api/salary/policies/{policy.id}/deletion-eligibility/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        # Backend reports authoritative state: safe for deletion because historical snapshots preserve versions
        self.assertTrue(res.data["can_delete"])
        self.assertFalse(res.data["is_active"])
        self.assertFalse(res.data["is_archived"])
        self.assertEqual(res.data["published_versions_count"], 1)
        self.assertEqual(len(res.data["blocking_reasons"]), 0)

    # Scenario 9: Verify permissions across multiple institutions and departments
    def test_09_multitenant_permissions_and_isolation(self):
        # Create policy in Quran department of Institution A
        policy_quran = SalaryPolicy.objects.create(
            institution=self.inst_a,
            department=self.dept_quran,
            code="ISO_QURAN",
            name="Quran Only Policy",
            is_active=True,
        )

        # 1. Beta Admin (Institution B) cannot view, deactivate, archive or delete
        self.client.force_authenticate(user=self.inst_b_admin)
        res_b = self.client.post(f"/api/salary/policies/{policy_quran.id}/deactivate/")
        self.assertIn(res_b.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND])

        res_b_del = self.client.delete(f"/api/salary/policies/{policy_quran.id}/")
        self.assertIn(res_b_del.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND])

        # 2. Math Admin (Different Department in Institution A) cannot modify Quran policy
        self.client.force_authenticate(user=self.math_admin)
        res_m = self.client.post(f"/api/salary/policies/{policy_quran.id}/archive/")
        self.assertEqual(res_m.status_code, status.HTTP_403_FORBIDDEN)

        # 3. Super Admin can manage it
        self.client.force_authenticate(user=self.super_admin)
        res_s = self.client.post(f"/api/salary/policies/{policy_quran.id}/archive/")
        self.assertEqual(res_s.status_code, status.HTTP_200_OK)
        policy_quran.refresh_from_db()
        self.assertTrue(policy_quran.is_archived)

    # Scenario 10: Confirm historical salary calculations and payroll remain intact (immutability)
    def test_10_historical_salary_calculations_and_payroll_immutability(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst_a,
            department=self.dept_quran,
            code="PAYROLL_PROT_10",
            name="Protected Payroll Policy",
            is_active=False,
        )
        pub_ver = SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2026, 1, 1),
            published_at=timezone.now(),
        )
        period = SalaryPayrollPeriod.objects.create(
            department=self.dept_quran,
            institution=self.inst_a,
            payroll_year=2026,
            payroll_month=1,
        )
        payroll = TeacherPayroll.objects.create(
            payroll_period=period,
            teacher=self.teacher_profile,
            applied_policy_version=pub_ver,
            gross_salary=Decimal("25000.00"),
            net_salary=Decimal("25000.00"),
        )
        PayrollEarningLine.objects.create(
            teacher_payroll=payroll,
            policy_version=pub_ver,
            earning_type=PayrollEarningLine.EarningType.REGULAR_CLASS,
            quantity=Decimal("10.00"),
            rate=Decimal("2500.00"),
            amount=Decimal("25000.00"),
        )

        # 1. Policy deletion must fail with 409 Conflict
        del_pol_res = self.client.delete(f"/api/salary/policies/{policy.id}/")
        self.assertEqual(del_pol_res.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(SalaryPolicy.objects.filter(id=policy.id).exists())

        # 2. Version deletion must fail
        del_ver_res = self.client.delete(f"/api/salary/versions/{pub_ver.id}/")
        self.assertEqual(del_ver_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(SalaryPolicyVersion.objects.filter(id=pub_ver.id).exists())

        # 3. Published version revert to draft must fail (published immutability)
        rev_res = self.client.post(f"/api/salary/versions/{pub_ver.id}/revert-to-draft/")
        self.assertEqual(rev_res.status_code, status.HTTP_400_BAD_REQUEST)
        pub_ver.refresh_from_db()
        self.assertEqual(pub_ver.status, SalaryPolicyVersion.Status.PUBLISHED)

        # 4. Payroll and earning lines remain completely intact
        self.assertTrue(TeacherPayroll.objects.filter(id=payroll.id).exists())
        self.assertTrue(PayrollEarningLine.objects.filter(policy_version=pub_ver).exists())
