"""Focused Regression Tests for Salary Policy Deletion Eligibility & Protection (STEP 7)."""
from datetime import date
from decimal import Decimal
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Department, Institution, PlatformAuditLog, User
from academy.models import TeacherProfile
from salary.models import (
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    SalaryPlanTierRate,
    TeacherPolicyAssignment,
    TeacherSalaryOverride,
    TeacherPayroll,
    PayrollEarningLine,
    SalaryPayrollPeriod,
)


class SalaryPolicyDeletionEligibilityTests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Institution & Department 1 (Quran)
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

        # Users
        self.quran_admin = User.objects.create_user(
            username="quran_admin_del",
            password="test-password-123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst1,
            department=self.dept_quran,
        )
        self.tuition_admin = User.objects.create_user(
            username="tuition_admin_del",
            password="test-password-123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst1,
            department=self.dept_tuition,
        )
        self.inst_admin = User.objects.create_user(
            username="inst_admin_del",
            password="test-password-123",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.inst1,
        )
        self.teacher_user = User.objects.create_user(
            username="teacher_del",
            password="test-password-123",
            role=User.Role.TEACHER,
            institution=self.inst1,
            department=self.dept_quran,
        )
        self.teacher_profile = TeacherProfile.objects.create(
            user=self.teacher_user,
            department=self.dept_quran,
            institution=self.inst1,
        )

    # 1. Unused draft policy can be permanently deleted
    def test_01_unused_draft_policy_can_be_permanently_deleted(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="UNUSED_DRAFT_2026",
            name="Unused Draft Policy",
        )
        # Add a draft version
        SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
        )

        # Eligibility check
        el_res = self.client.get(f"/api/salary/policies/{policy.id}/deletion-eligibility/", HTTP_HOST="localhost")
        self.assertEqual(el_res.status_code, status.HTTP_200_OK)
        self.assertTrue(el_res.data["can_delete"])
        self.assertEqual(len(el_res.data["blocking_reasons"]), 0)

        # Deletion
        del_res = self.client.delete(f"/api/salary/policies/{policy.id}/", HTTP_HOST="localhost")
        self.assertEqual(del_res.status_code, status.HTTP_200_OK)
        self.assertFalse(SalaryPolicy.objects.filter(id=policy.id).exists())

    # 2. Policy with active teacher assignments cannot be deleted
    def test_02_policy_with_active_teacher_assignments_cannot_be_deleted(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="ACTIVE_ASSIGN_POL",
            name="Active Assign Policy",
        )
        TeacherPolicyAssignment.objects.create(
            department=self.dept_quran,
            teacher=self.teacher_profile,
            policy=policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

        el_res = self.client.get(f"/api/salary/policies/{policy.id}/deletion-eligibility/", HTTP_HOST="localhost")
        self.assertEqual(el_res.status_code, status.HTTP_200_OK)
        self.assertFalse(el_res.data["can_delete"])
        self.assertEqual(el_res.data["active_teacher_assignments"], 1)
        self.assertEqual(el_res.data["total_teacher_assignments"], 1)

        del_res = self.client.delete(f"/api/salary/policies/{policy.id}/", HTTP_HOST="localhost")
        self.assertEqual(del_res.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("active teacher assignment", del_res.data["detail"].lower())
        self.assertTrue(SalaryPolicy.objects.filter(id=policy.id).exists())

    # 3. Policy with historical teacher assignments CAN be safely deleted and preserves records
    def test_03_policy_with_historical_teacher_assignments_can_be_safely_deleted(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="HIST_ASSIGN_POL",
            name="Historical Assign Policy",
        )
        assign = TeacherPolicyAssignment.objects.create(
            department=self.dept_quran,
            teacher=self.teacher_profile,
            policy=policy,
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 6, 1),
            is_active=False,
            notes="Initial assignment notes",
        )

        # Eligibility check: can_delete must be True for 0 active assignments
        el_res = self.client.get(f"/api/salary/policies/{policy.id}/deletion-eligibility/", HTTP_HOST="localhost")
        self.assertEqual(el_res.status_code, status.HTTP_200_OK)
        self.assertTrue(el_res.data["can_delete"])
        self.assertEqual(el_res.data["active_teacher_assignments"], 0)
        self.assertEqual(el_res.data["historical_teacher_assignments"], 1)
        self.assertEqual(len(el_res.data["blocking_reasons"]), 0)

        # Deletion succeeds
        del_res = self.client.delete(f"/api/salary/policies/{policy.id}/", HTTP_HOST="localhost")
        self.assertEqual(del_res.status_code, status.HTTP_200_OK)
        self.assertFalse(SalaryPolicy.objects.filter(id=policy.id).exists())

        # Historical assignment MUST be preserved and detached safely
        self.assertTrue(TeacherPolicyAssignment.objects.filter(id=assign.id).exists())
        assign.refresh_from_db()
        self.assertIsNone(assign.policy)
        self.assertEqual(assign.policy_snapshot_name, "Historical Assign Policy")
        self.assertEqual(assign.policy_snapshot_code, "HIST_ASSIGN_POL")
        self.assertIsNotNone(assign.archived_policy_snapshot)
        self.assertEqual(assign.archived_policy_snapshot["policy_id"], policy.id)
        self.assertIn("Initial assignment notes", assign.notes)
        self.assertIn("Detached upon permanent policy deletion", assign.notes)

        # Audit log verification
        log = PlatformAuditLog.objects.filter(target_id=str(policy.id), action="policy_deleted").first()
        self.assertIsNotNone(log)
        self.assertEqual(log.details["historical_assignments_detached_count"], 1)

    # 4. Fixture matching 2ivq: 1 published version, 32 historical assignments, 0 active assignments, 0 payroll references
    def test_04_fixture_matching_2ivq_can_be_permanently_deleted_and_calculations_reproducible(self):
        from salary.resolver import resolve_teacher_class_rate

        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="2IVQ_FIXTURE_CODE",
            name="2ivq Fixture Policy",
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
        )
        version = SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
        )
        tier1 = SalaryRateTier.objects.create(
            policy_version=version,
            tier_name="1–15 students",
            min_students=1,
            max_students=15,
            sort_order=1,
        )
        tier2 = SalaryRateTier.objects.create(
            policy_version=version,
            tier_name="16+ students",
            min_students=16,
            max_students=None,
            sort_order=2,
        )
        plan5 = SalaryTeachingPlan.objects.create(
            policy_version=version,
            plan_code="5_days",
            plan_name="5 days/week",
            days_per_week=5,
            sort_order=1,
        )
        plan_coord = SalaryTeachingPlan.objects.create(
            policy_version=version,
            plan_code="coordinator_special",
            plan_name="Coordinator special",
            is_coordinator_special=True,
            sort_order=2,
        )
        rate1 = SalaryPlanTierRate.objects.create(
            policy_version=version,
            teaching_plan=plan5,
            rate_tier=tier1,
            rate_per_class=Decimal("80.00"),
        )
        rate2 = SalaryPlanTierRate.objects.create(
            policy_version=version,
            teaching_plan=plan5,
            rate_tier=tier2,
            rate_per_class=Decimal("95.00"),
        )
        rate_c = SalaryPlanTierRate.objects.create(
            policy_version=version,
            teaching_plan=plan_coord,
            rate_tier=tier1,
            rate_per_class=Decimal("150.00"),
        )
        # Publish version now that tiers and matrix are fully configured
        version.status = SalaryPolicyVersion.Status.PUBLISHED
        version.save()

        # Create 32 historical assignments (is_active=False)
        assignments = []
        for i in range(32):
            u = User.objects.create_user(
                username=f"hist_teacher_{i}",
                password="test-password-123",
                role=User.Role.TEACHER,
                institution=self.inst1,
                department=self.dept_quran,
            )
            tp = TeacherProfile.objects.create(
                user=u,
                department=self.dept_quran,
                institution=self.inst1,
            )
            a = TeacherPolicyAssignment.objects.create(
                department=self.dept_quran,
                teacher=tp,
                policy=policy,
                effective_from=date(2026, 1, 1),
                effective_to=date(2026, 6, 30),
                is_active=False,
                notes=f"Historical assignment #{i+1}",
            )
            assignments.append(a)

        # Pre-deletion verification: rate resolution reproduces 80.00 PKR
        first_teacher = assignments[0].teacher
        pre_res = resolve_teacher_class_rate(
            department_id=self.dept_quran.id,
            teacher_id=first_teacher.id,
            class_date=date(2026, 3, 15),
            teaching_plan_code="5_days",
            student_count=10,
        )
        self.assertTrue(pre_res.is_resolved)
        self.assertEqual(pre_res.winning_rate, Decimal("80.00"))

        # Eligibility check: can_delete must be True (0 active assignments, 0 payroll references)
        el_res = self.client.get(f"/api/salary/policies/{policy.id}/deletion-eligibility/", HTTP_HOST="localhost")
        self.assertEqual(el_res.status_code, status.HTTP_200_OK)
        self.assertTrue(el_res.data["can_delete"])
        self.assertEqual(el_res.data["active_teacher_assignments"], 0)
        self.assertEqual(el_res.data["historical_teacher_assignments"], 32)
        self.assertEqual(el_res.data["published_versions_count"], 1)
        self.assertEqual(el_res.data["protected_payroll_references_count"], 0)
        self.assertEqual(len(el_res.data["blocking_reasons"]), 0)

        # Deletion succeeds via API
        del_res = self.client.delete(f"/api/salary/policies/{policy.id}/", HTTP_HOST="localhost")
        self.assertEqual(del_res.status_code, status.HTTP_200_OK)
        self.assertFalse(SalaryPolicy.objects.filter(id=policy.id).exists())
        self.assertFalse(SalaryPolicyVersion.objects.filter(id=version.id).exists())

        # All 32 historical assignments remain preserved with complete immutable snapshots
        self.assertEqual(TeacherPolicyAssignment.objects.filter(id__in=[a.id for a in assignments]).count(), 32)
        sample = TeacherPolicyAssignment.objects.get(id=assignments[0].id)
        self.assertIsNone(sample.policy)
        self.assertEqual(sample.policy_snapshot_name, "2ivq Fixture Policy")
        self.assertEqual(sample.policy_snapshot_code, "2IVQ_FIXTURE_CODE")
        self.assertIsNotNone(sample.archived_policy_snapshot)

        snap = sample.archived_policy_snapshot
        self.assertEqual(snap["policy"]["name"], "2ivq Fixture Policy")
        self.assertEqual(len(snap["versions"]), 1)
        self.assertEqual(len(snap["versions"][0]["teaching_plans"]), 2)
        self.assertEqual(len(snap["versions"][0]["rate_tiers"]), 2)
        self.assertEqual(len(snap["versions"][0]["rate_matrix"]), 3)
        self.assertEqual(len(snap["teacher_assignments"]), 32)

        # Post-deletion verification: rate resolver still reproduces EXACT 80.00 PKR from preserved snapshot!
        post_res = resolve_teacher_class_rate(
            department_id=self.dept_quran.id,
            teacher_id=first_teacher.id,
            class_date=date(2026, 3, 15),
            teaching_plan_code="5_days",
            student_count=10,
        )
        self.assertTrue(post_res.is_resolved)
        self.assertEqual(post_res.winning_rate, Decimal("80.00"))
        self.assertIn("preserved policy snapshot", post_res.selection_reason.lower())

        # Audit log verification
        audit = PlatformAuditLog.objects.filter(target_id=str(policy.id), action="policy_deleted").first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.details["historical_assignments_detached_count"], 32)
        self.assertIn("complete_policy_snapshot", audit.details)

    # 5. Published policy with protected payroll references cannot be deleted and identifies exact records
    def test_05_published_policy_with_protected_payroll_references_cannot_be_deleted(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="PUB_PAYROLL_POL",
            name="Published Payroll Policy",
        )
        version = SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2026, 1, 1),
        )
        period = SalaryPayrollPeriod.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            payroll_year=2026,
            payroll_month=1,
            status="draft",
        )
        tp = TeacherPayroll.objects.create(
            payroll_period=period,
            teacher=self.teacher_profile,
            applied_policy=policy,
            applied_policy_version=version,
            net_salary=Decimal("45000.00"),
        )

        el_res = self.client.get(f"/api/salary/policies/{policy.id}/deletion-eligibility/", HTTP_HOST="localhost")
        self.assertEqual(el_res.status_code, status.HTTP_200_OK)
        self.assertFalse(el_res.data["can_delete"])
        self.assertGreater(el_res.data["protected_payroll_references_count"], 0)
        self.assertTrue(any("payroll record" in r.lower() for r in el_res.data["blocking_reasons"]))
        self.assertTrue(any(str(period) in r for r in el_res.data["blocking_reasons"]))

        del_res = self.client.delete(f"/api/salary/policies/{policy.id}/", HTTP_HOST="localhost")
        self.assertEqual(del_res.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(SalaryPolicy.objects.filter(id=policy.id).exists())

    # 6. Protected payroll references prevent deletion
    def test_06_protected_payroll_references_prevent_deletion(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="PAYROLL_REF_POL",
            name="Payroll Ref Policy",
        )
        period = SalaryPayrollPeriod.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            payroll_year=2026,
            payroll_month=1,
            status="draft",
        )
        TeacherPayroll.objects.create(
            payroll_period=period,
            teacher=self.teacher_profile,
            applied_policy=policy,
        )

        el_res = self.client.get(f"/api/salary/policies/{policy.id}/deletion-eligibility/", HTTP_HOST="localhost")
        self.assertEqual(el_res.status_code, status.HTTP_200_OK)
        self.assertFalse(el_res.data["can_delete"])
        self.assertGreater(el_res.data["protected_payroll_references_count"], 0)

        del_res = self.client.delete(f"/api/salary/policies/{policy.id}/", HTTP_HOST="localhost")
        self.assertEqual(del_res.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(SalaryPolicy.objects.filter(id=policy.id).exists())

    # 7. Teacher salary overrides prevent deletion
    def test_07_teacher_salary_overrides_prevent_deletion(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="OVERRIDE_REF_POL",
            name="Override Ref Policy",
        )
        TeacherSalaryOverride.objects.create(
            department=self.dept_quran,
            teacher=self.teacher_profile,
            salary_policy=policy,
            override_level=TeacherSalaryOverride.OverrideLevel.TEACHER_WIDE,
            rate_per_class=Decimal("500.00"),
            effective_from=date(2026, 1, 1),
            reason="Special teacher wide override for test",
            created_by=self.quran_admin,
        )

        el_res = self.client.get(f"/api/salary/policies/{policy.id}/deletion-eligibility/", HTTP_HOST="localhost")
        self.assertEqual(el_res.status_code, status.HTTP_200_OK)
        self.assertFalse(el_res.data["can_delete"])
        self.assertEqual(el_res.data["teacher_overrides_count"], 1)

        del_res = self.client.delete(f"/api/salary/policies/{policy.id}/", HTTP_HOST="localhost")
        self.assertEqual(del_res.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(SalaryPolicy.objects.filter(id=policy.id).exists())

    # 8. Frontend and backend eligibility decisions match
    def test_08_eligibility_matches_model_can_delete(self):
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="MATCH_CHECK_POL",
            name="Match Check Policy",
        )
        eligibility = policy.get_deletion_eligibility()
        self.assertTrue(eligibility["can_delete"])

        # Add active assignment -> can_delete becomes False
        TeacherPolicyAssignment.objects.create(
            department=self.dept_quran,
            teacher=self.teacher_profile,
            policy=policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        eligibility_after = policy.get_deletion_eligibility()
        self.assertFalse(eligibility_after["can_delete"])
        self.assertEqual(eligibility_after["active_teacher_assignments"], 1)

    # 9. HTTP 409 returns clear blocking reasons
    def test_09_http_409_returns_clear_blocking_reasons(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="CLEAR_REASONS_POL",
            name="Clear Reasons Policy",
        )
        TeacherPolicyAssignment.objects.create(
            department=self.dept_quran,
            teacher=self.teacher_profile,
            policy=policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        del_res = self.client.delete(f"/api/salary/policies/{policy.id}/", HTTP_HOST="localhost")
        self.assertEqual(del_res.status_code, status.HTTP_409_CONFLICT)
        self.assertIn("blocking_reasons", del_res.data)
        self.assertGreater(len(del_res.data["blocking_reasons"]), 0)
        self.assertIn("detail", del_res.data)
        self.assertFalse(del_res.data["detail"].startswith("0:"))

    # 10. Unauthorized deletion returns HTTP 403
    def test_10_unauthorized_deletion_returns_http_403(self):
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="UNAUTH_DEL_POL",
            name="Unauth Del Policy",
        )
        self.client.force_authenticate(user=self.teacher_user)
        res = self.client.delete(f"/api/salary/policies/{policy.id}/", HTTP_HOST="localhost")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(SalaryPolicy.objects.filter(id=policy.id).exists())

    # 11. No cross-department deletion
    def test_11_no_cross_department_deletion(self):
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="CROSS_DEPT_POL",
            name="Cross Dept Policy",
        )
        self.client.force_authenticate(user=self.tuition_admin)
        res = self.client.delete(f"/api/salary/policies/{policy.id}/", HTTP_HOST="localhost")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(SalaryPolicy.objects.filter(id=policy.id).exists())

    # 12. Institution Admin can delete eligible policy
    def test_12_inst_admin_can_delete_eligible_policy(self):
        self.client.force_authenticate(user=self.inst_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="INST_ADMIN_DEL_POL",
            name="Inst Admin Del Policy",
        )
        del_res = self.client.delete(f"/api/salary/policies/{policy.id}/", HTTP_HOST="localhost")
        self.assertEqual(del_res.status_code, status.HTTP_200_OK)
        self.assertFalse(SalaryPolicy.objects.filter(id=policy.id).exists())

    # 13. No financial records are deleted accidentally
    def test_13_no_financial_records_deleted_accidentally(self):
        self.client.force_authenticate(user=self.quran_admin)
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="FIN_SAFETY_POL",
            name="Financial Safety Policy",
        )
        period = SalaryPayrollPeriod.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            payroll_year=2026,
            payroll_month=2,
            status="draft",
        )
        payroll = TeacherPayroll.objects.create(
            payroll_period=period,
            teacher=self.teacher_profile,
            applied_policy=policy,
        )
        del_res = self.client.delete(f"/api/salary/policies/{policy.id}/", HTTP_HOST="localhost")
        self.assertEqual(del_res.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(TeacherPayroll.objects.filter(id=payroll.id).exists())
