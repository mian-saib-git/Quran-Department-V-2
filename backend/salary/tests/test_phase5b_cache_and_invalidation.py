from datetime import date, time
from decimal import Decimal
from unittest.mock import patch
from django.core.cache import cache
from django.db import transaction
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Department, Institution, User
from academy.models import StudentProfile, TeacherProfile
from academy.student_status_service import confirm_student_drop_leave_return
from salary.models import (
    PayrollAdjustment,
    SalaryAdjustmentCategory,
    SalaryAttendanceVerification,
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    TeacherPolicyAssignment,
)
from salary.views import (
    _atomic_bump_preview_version,
    invalidate_department_salary_preview_cache,
    invalidate_salary_preview_cache,
)


class Phase5BCacheAndInvalidationTests(TestCase):
    def setUp(self):
        cache.clear()
        self.inst = Institution.objects.create(name="IVS 5B Inst", slug="ivs-5b")
        self.dept = Department.objects.create(
            institution=self.inst, name="Quran 5B", code="quran-5b", department_type="quran"
        )
        self.other_dept = Department.objects.create(
            institution=self.inst, name="Tuition 5B", code="tuition-5b", department_type="tuition"
        )
        self.admin = User.objects.create_user(
            username="admin5b", password="pw", role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst, department=self.dept,
        )
        self.other_admin = User.objects.create_user(
            username="other5b", password="pw", role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst, department=self.other_dept,
        )

        self.u_t1 = User.objects.create_user(
            username="t1_5b", first_name="Tariq", last_name="Ali", password="pw",
            role=User.Role.TEACHER, institution=self.inst, department=self.dept,
        )
        self.t1 = TeacherProfile.objects.create(user=self.u_t1, institution=self.inst, department=self.dept)

        self.u_s1 = User.objects.create_user(
            username="s1_5b", first_name="Omar", last_name="Farooq", password="pw",
            role=User.Role.STUDENT, institution=self.inst, department=self.dept,
        )
        self.s1 = StudentProfile.objects.create(
            user=self.u_s1,
            institution=self.inst,
            department=self.dept,
            teacher=self.t1,
            class_status=StudentProfile.ClassStatus.RUNNING,
        )

        # Published policy with 1 tier & 1 plan (1000 PKR/class)
        self.policy = SalaryPolicy.objects.create(
            institution=self.inst, department=self.dept, name="Standard 5B", code="STD5B"
        )
        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
        )
        self.tier = SalaryRateTier.objects.create(
            policy_version=self.version, tier_name="1-5", min_students=1, max_students=5, sort_order=1
        )
        self.plan = SalaryTeachingPlan.objects.create(
            policy_version=self.version, plan_code="3d", plan_name="3 Days", days_per_week=3, sort_order=1
        )
        SalaryPlanTierRate.objects.create(
            policy_version=self.version, teaching_plan=self.plan, rate_tier=self.tier, rate_per_class=Decimal("1000.00")
        )
        self.version.status = SalaryPolicyVersion.Status.PUBLISHED
        self.version.save(update_fields=["status"])
        TeacherPolicyAssignment.objects.create(
            department=self.dept,
            teacher=self.t1,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

        self.verif = SalaryAttendanceVerification.objects.create(
            institution=self.inst,
            department=self.dept,
            source_department_type="quran",
            teacher=self.t1,
            student=self.s1,
            occurrence_key="occ-5b-1",
            class_date=date(2026, 11, 2),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.PENDING,
        )

        self.cat = SalaryAdjustmentCategory.objects.create(
            institution=self.inst, department=self.dept, code="bonus_5b", name="Bonus", direction="credit", is_active=True
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_cold_vs_warm_and_force_refresh_and_teacher_detail_cache(self):
        with patch(
            "salary.views.calculate_department_salary_preview",
            wraps=__import__("salary.calculation_engine", fromlist=["calculate_department_salary_preview"]).calculate_department_salary_preview,
        ) as spy:
            # Cold
            r1 = self.client.post("/api/salary/calculations/preview/", {
                "department_id": self.dept.id, "year": 2026, "month": 11, "summary_only": True
            }, format="json")
            self.assertEqual(r1.status_code, 200)
            self.assertEqual(spy.call_count, 1)

            # Warm reuse
            r2 = self.client.post("/api/salary/calculations/preview/", {
                "department_id": self.dept.id, "year": 2026, "month": 11, "summary_only": True
            }, format="json")
            self.assertEqual(r2.status_code, 200)
            self.assertEqual(spy.call_count, 1)

            # Teacher detail cold -> warm
            r3 = self.client.post("/api/salary/calculations/preview/", {
                "department_id": self.dept.id, "year": 2026, "month": 11, "teacher_id": self.t1.id, "summary_only": False
            }, format="json")
            self.assertEqual(r3.status_code, 200)
            self.assertEqual(spy.call_count, 2)

            r4 = self.client.post("/api/salary/calculations/preview/", {
                "department_id": self.dept.id, "year": 2026, "month": 11, "teacher_id": self.t1.id, "summary_only": False
            }, format="json")
            self.assertEqual(r4.status_code, 200)
            self.assertEqual(spy.call_count, 2)

            # Explicit force_refresh bypasses cache
            r5 = self.client.post("/api/salary/calculations/preview/", {
                "department_id": self.dept.id, "year": 2026, "month": 11, "summary_only": True, "force_refresh": True
            }, format="json")
            self.assertEqual(r5.status_code, 200)
            self.assertEqual(spy.call_count, 3)

    def test_department_and_month_isolation(self):
        r_nov = self.client.post("/api/salary/calculations/preview/", {
            "department_id": self.dept.id, "year": 2026, "month": 11, "summary_only": True
        }, format="json")
        r_oct = self.client.post("/api/salary/calculations/preview/", {
            "department_id": self.dept.id, "year": 2026, "month": 10, "summary_only": True
        }, format="json")
        self.assertEqual(r_nov.data["payroll_month"], 11)
        self.assertEqual(r_oct.data["payroll_month"], 10)

        self.client.force_authenticate(user=self.other_admin)
        r_other = self.client.post("/api/salary/calculations/preview/", {
            "department_id": self.other_dept.id, "year": 2026, "month": 11, "summary_only": True
        }, format="json")
        self.assertEqual(r_other.data["department_id"], self.other_dept.id)
        self.assertEqual(r_other.data["evaluated_teachers_count"], 0)

    def test_atomic_version_bump_and_rollback_safety(self):
        ver_key = f"salary_calc_preview_ver_{self.dept.id}_2026_11"
        _atomic_bump_preview_version(ver_key)
        v1 = cache.get(ver_key)
        _atomic_bump_preview_version(ver_key)
        v2 = cache.get(ver_key)
        self.assertEqual(v2, v1 + 1)

        # Rolled-back transaction must NOT execute on_commit invalidation
        try:
            with transaction.atomic():
                invalidate_salary_preview_cache(self.dept.id, 2026, 11)
                raise RuntimeError("Force rollback")
        except RuntimeError:
            pass
        self.assertEqual(cache.get(ver_key), v2)

    def test_verification_resolve_and_adjustment_and_drop_invalidate_on_commit(self):
        # Prime cache
        r1 = self.client.post("/api/salary/calculations/preview/", {
            "department_id": self.dept.id, "year": 2026, "month": 11, "summary_only": True
        }, format="json")
        self.assertEqual(r1.status_code, 200)
        v_before = cache.get(f"salary_calc_preview_ver_{self.dept.id}_2026_11", 1)

        # 1. Verification resolve bumps version on commit
        with self.captureOnCommitCallbacks(execute=True):
            res_ver = self.client.post(f"/api/salary/verifications/{self.verif.id}/resolve/", {
                "resolution_type": "class_taught",
                "reason": "Confirmed taught",
            }, format="json")
        self.assertEqual(res_ver.status_code, 200)
        v_after_ver = cache.get(f"salary_calc_preview_ver_{self.dept.id}_2026_11", 1)
        self.assertGreater(v_after_ver, v_before)

        # 2. Adjustment creation bumps version and updates preview total
        with self.captureOnCommitCallbacks(execute=True):
            res_adj = self.client.post("/api/salary/adjustments/", {
                "department_id": self.dept.id,
                "teacher_id": self.t1.id,
                "period_year": 2026,
                "period_month": 11,
                "category": self.cat.code,
                "direction": "credit",
                "amount": "500.00",
                "reason": "Phase 5B test",
            }, format="json")
        self.assertEqual(res_adj.status_code, 201)
        v_after_adj = cache.get(f"salary_calc_preview_ver_{self.dept.id}_2026_11", 1)
        self.assertGreater(v_after_adj, v_after_ver)

        r2 = self.client.post("/api/salary/calculations/preview/", {
            "department_id": self.dept.id, "year": 2026, "month": 11, "summary_only": True
        }, format="json")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(Decimal(r2.data["summary"]["positive_adjustments"]), Decimal("500.00"))

        # 3. Drop/Leave/Return bumps version on commit
        with self.captureOnCommitCallbacks(execute=True):
            confirm_student_drop_leave_return(
                department=self.dept,
                student_id=self.s1.id,
                action="confirm_leave",
                effective_date=date(2026, 11, 15),
                reason="Family travel",
                actor=self.admin,
            )
        v_after_leave = cache.get(f"salary_calc_preview_ver_{self.dept.id}_2026_11", 1)
        self.assertGreater(v_after_leave, v_after_adj)

    def test_policy_assignment_override_reconcile_recalculate_and_redis_resilience(self):
        dept_ver_key = f"salary_calc_preview_dept_ver_{self.dept.id}"
        month_ver_key = f"salary_calc_preview_ver_{self.dept.id}_2026_11"

        # 1. Policy version publish bumps dept_ver
        policy2 = SalaryPolicy.objects.create(
            institution=self.inst, department=self.dept, name="Special 5B", code="SPL5B"
        )
        draft_v = SalaryPolicyVersion.objects.create(
            policy=policy2, version_number=1, status=SalaryPolicyVersion.Status.DRAFT, effective_from=date(2026, 12, 1)
        )
        t2 = SalaryRateTier.objects.create(policy_version=draft_v, tier_name="1-5", min_students=1, max_students=5, sort_order=1)
        p2 = SalaryTeachingPlan.objects.create(policy_version=draft_v, plan_code="3d", plan_name="3 Days", days_per_week=3, sort_order=1)
        SalaryPlanTierRate.objects.create(policy_version=draft_v, teaching_plan=p2, rate_tier=t2, rate_per_class=Decimal("1100.00"))

        dv0 = cache.get(dept_ver_key, 1)
        with self.captureOnCommitCallbacks(execute=True):
            r_pub = self.client.post(f"/api/salary/versions/{draft_v.id}/publish/", {}, format="json")
        self.assertIn(r_pub.status_code, (200, 201))
        dv1 = cache.get(dept_ver_key, 1)
        self.assertGreater(dv1, dv0)

        # 2. Teacher assignment / override bumps dept_ver
        with self.captureOnCommitCallbacks(execute=True):
            invalidate_department_salary_preview_cache(self.dept.id)
        dv2 = cache.get(dept_ver_key, 1)
        self.assertGreater(dv2, dv1)

        # 3. Attendance sync / schedule change / payroll recalculate bumps month_ver
        mv0 = cache.get(month_ver_key, 1)
        with self.captureOnCommitCallbacks(execute=True):
            from salary.attendance_reconciler import sync_salary_verification_for_date
            sync_salary_verification_for_date(self.dept, date(2026, 11, 2), user=self.admin)
        mv1 = cache.get(month_ver_key, 1)
        self.assertGreater(mv1, mv0)

        # 4. Simulated Redis failure on preview cache must NOT break calculation preview
        orig_get = cache.get
        orig_set = cache.set

        def _fail_preview_get(k, *a, **kw):
            if str(k).startswith("salary_calc_preview"):
                raise ConnectionError("Redis down")
            return orig_get(k, *a, **kw)

        def _fail_preview_set(k, *a, **kw):
            if str(k).startswith("salary_calc_preview"):
                raise ConnectionError("Redis down")
            return orig_set(k, *a, **kw)

        with patch("salary.views.cache.get", side_effect=_fail_preview_get), patch(
            "salary.views.cache.set", side_effect=_fail_preview_set
        ):
            r_resilient = self.client.post("/api/salary/calculations/preview/", {
                "department_id": self.dept.id, "year": 2026, "month": 11, "summary_only": True
            }, format="json")
            self.assertEqual(r_resilient.status_code, 200)
            self.assertEqual(r_resilient.data["department_id"], self.dept.id)
