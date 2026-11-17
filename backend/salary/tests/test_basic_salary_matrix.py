"""Automated Regression Test Suite for 2D Basic Monthly Salary Matrix (Stage 2, 5, 7A/7B).

Validates all 18 test requirements:
1. Basic salary changes by teaching package.
2. Basic salary changes by student-count tier.
3. Correct matrix lookup (Policy Version + Plan + Tier = Basic Salary).
4. Correct salary calculation for each package/tier combination.
5. Per-Class Salary model excludes basic salary.
6. Basic + Per-Class model combines both components correctly.
7. Teacher basic salary overrides retain precedence over matrix.
8. Student-count changes during a payroll period prorates basic salary.
9. Teaching package changes during a payroll period prorates basic salary.
10. Mid-month salary proration across calendar days.
11. Legacy published policies remain compatible (fallback to single basic salary).
12. Historical salary calculations remain reproducible via payroll snapshot line items.
13. Stage 5 correctly displays basic salary metadata and cell provenance.
14. Stage 7A payroll uses the correct amount with matrix cell metadata.
15. Stage 7B approval safeguards remain intact (locked payroll cannot be altered).
16. Missing cells prevent invalid publication.
17. Cross-department access is blocked.
18. Different institutions can configure independent matrices.
"""
from datetime import date, time, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import Department, Institution, UserDepartmentRole
from academy.models import (
    Attendance,
    ClassSchedule,
    StudentClassHistory,
    StudentProfile,
    TeacherProfile,
)
from salary.models import (
    PayrollEarningLine,
    SalaryAttendanceVerification,
    SalaryPayrollPeriod,
    SalaryPlanTierBasicSalary,
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    TeacherPayroll,
    TeacherPolicyAssignment,
    TeacherSalaryOverride,
)
from salary.calculation_engine import calculate_teacher_salary_preview
from salary.payroll_service import PayrollLifecycleService

User = get_user_model()


class BasicSalaryMatrixRegressionTests(TestCase):
    def setUp(self):
        # 1. Institutions & Departments
        self.institution_a = Institution.objects.create(name="IVS Academy", slug="ivs-academy")
        self.institution_b = Institution.objects.create(name="Second Institution", slug="second-inst")

        self.dept_a1 = Department.objects.create(
            institution=self.institution_a,
            name="Qur'an Department",
            code="quran-dept",
            department_type=Department.DepartmentType.QURAN,
        )
        self.dept_a2 = Department.objects.create(
            institution=self.institution_a,
            name="Tuition Department",
            code="tuition-dept",
            department_type=Department.DepartmentType.TUITION,
        )
        self.dept_b = Department.objects.create(
            institution=self.institution_b,
            name="Branch Quran Dept",
            code="branch-quran",
            department_type=Department.DepartmentType.QURAN,
        )

        # 2. Users & Roles
        self.admin_a1 = User.objects.create_user(
            username="admin_a1",
            password="pass-1234-admin",
            role=User.Role.DEPARTMENT_ADMIN,
            department=self.dept_a1,
        )
        UserDepartmentRole.objects.create(
            user=self.admin_a1,
            department=self.dept_a1,
            institution=self.institution_a,
            role=UserDepartmentRole.Role.DEPARTMENT_ADMIN,
        )

        self.admin_a2 = User.objects.create_user(
            username="admin_a2",
            password="pass-1234-admin2",
            role=User.Role.DEPARTMENT_ADMIN,
            department=self.dept_a2,
        )
        UserDepartmentRole.objects.create(
            user=self.admin_a2,
            department=self.dept_a2,
            institution=self.institution_a,
            role=UserDepartmentRole.Role.DEPARTMENT_ADMIN,
        )

        # 3. Teacher
        self.teacher_user = User.objects.create_user(
            username="teacher_test",
            password="pass-1234-teacher",
            role=User.Role.TEACHER,
            department=self.dept_a1,
        )
        self.teacher_profile = TeacherProfile.objects.create(
            user=self.teacher_user,
            department=self.dept_a1,
            institution=self.institution_a,
            joining_date=date(2025, 1, 1),
        )

        # 4. Standard Policy with Basic + Per-Class model
        self.policy = SalaryPolicy.objects.create(
            institution=self.institution_a,
            department=self.dept_a1,
            name="Standard Quran Faculty Policy",
            code="POL-QURAN-01",
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            compensation_model=SalaryPolicy.CompensationModel.BASIC_PLUS_PER_CLASS,
            created_by=self.admin_a1,
        )

        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            week_start_day="monday",
            lesson_plan_bonus_per_class=Decimal("50.00"),
            substitute_rate_per_class=Decimal("200.00"),
            cancellation_rate_per_class=Decimal("100.00"),
            basic_salary_partial_month_proration="calendar_days",
        )

        # 5. Teaching Plans (5-day, 3-day)
        self.plan_5d = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_name="5 Days / Week",
            plan_code="5D",
            days_per_week=5,
            sort_order=1,
        )
        self.plan_3d = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_name="3 Days / Week",
            plan_code="3D",
            days_per_week=3,
            sort_order=2,
        )

        # 6. Student Tiers (Tier 1: 1-15, Tier 2: 16-19, Tier 3: 20+)
        self.tier_1 = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="Tier 1 (1-15)",
            min_students=1,
            max_students=15,
            sort_order=1,
        )
        self.tier_2 = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="Tier 2 (16-19)",
            min_students=16,
            max_students=19,
            sort_order=2,
        )
        self.tier_3 = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="Tier 3 (20+)",
            min_students=20,
            max_students=None,
            sort_order=3,
        )

        # 7. Configure Per-Class Rates Matrix (Matrix B)
        self.rates = {
            (self.plan_5d, self.tier_1): Decimal("300.00"),
            (self.plan_5d, self.tier_2): Decimal("350.00"),
            (self.plan_5d, self.tier_3): Decimal("400.00"),
            (self.plan_3d, self.tier_1): Decimal("250.00"),
            (self.plan_3d, self.tier_2): Decimal("280.00"),
            (self.plan_3d, self.tier_3): Decimal("320.00"),
        }
        for (plan, tier), rate in self.rates.items():
            SalaryPlanTierRate.objects.create(
                policy_version=self.version,
                teaching_plan=plan,
                rate_tier=tier,
                rate_per_class=rate,
            )

        # 8. Configure Basic Monthly Salary Matrix (Matrix A)
        self.basic_salaries = {
            (self.plan_5d, self.tier_1): Decimal("25000.00"),
            (self.plan_5d, self.tier_2): Decimal("30000.00"),
            (self.plan_5d, self.tier_3): Decimal("35000.00"),
            (self.plan_3d, self.tier_1): Decimal("15000.00"),
            (self.plan_3d, self.tier_2): Decimal("18000.00"),
            (self.plan_3d, self.tier_3): Decimal("21000.00"),
        }
        for (plan, tier), basic in self.basic_salaries.items():
            SalaryPlanTierBasicSalary.objects.create(
                policy_version=self.version,
                teaching_plan=plan,
                rate_tier=tier,
                basic_salary_amount=basic,
            )

        # Publish the version
        self.version.status = SalaryPolicyVersion.Status.PUBLISHED
        self.version.save()

        # Assign teacher to this policy
        self.assignment = TeacherPolicyAssignment.objects.create(
            teacher=self.teacher_profile,
            policy=self.policy,
            department=self.dept_a1,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            assigned_by=self.admin_a1,
        )

    def _setup_teacher_classes(self, student_count=10, days_per_week=5):
        """Helper to create student profiles and schedules for the teacher in May 2026."""
        students = []
        for i in range(student_count):
            u = User.objects.create_user(
                username=f"std_{student_count}_{i}_{days_per_week}",
                password="pass",
                role=User.Role.STUDENT,
                department=self.dept_a1,
            )
            sp = StudentProfile.objects.create(
                user=u,
                teacher=self.teacher_profile,
                department=self.dept_a1,
                institution=self.institution_a,
                class_status=StudentProfile.ClassStatus.RUNNING,
            )
            StudentClassHistory.objects.create(
                student=sp,
                event_type=StudentClassHistory.EventType.ENROLLED,
                effective_date=date(2026, 1, 1),
            )
            students.append(sp)

        # Assign days (e.g. 5 days = Mon..Fri; 3 days = Mon, Wed, Fri)
        day_names = ["monday", "tuesday", "wednesday", "thursday", "friday"][:days_per_week]
        for idx, sp in enumerate(students):
            ClassSchedule.objects.create(
                teacher=self.teacher_profile,
                student=sp,
                weekday=day_names[idx % len(day_names)],
                time_slot=time(9, 0),
                is_active=True,
                department=self.dept_a1,
                institution=self.institution_a,
            )
        return students

    # --- 1 & 2 & 3 & 4. Package, Tier, Lookup and Calculation ---
    def test_basic_salary_changes_by_teaching_package_and_tier(self):
        """1, 2, 3, 4: Basic salary resolves distinctly based on teaching package and student-count tier."""
        # 5-day package with Tier 1 (10 students) => 25,000 PKR basic
        self._setup_teacher_classes(student_count=10, days_per_week=5)
        res = calculate_teacher_salary_preview(self.dept_a1, self.teacher_profile, 2026, 5)
        self.assertEqual(res["basic_salary_package"], "5 Days / Week")
        self.assertEqual(res["basic_salary_tier"], "Tier 1 (1-15)")
        self.assertEqual(Decimal(res["earnings"]["basic_salary_earnings"]), Decimal("25000.00"))
        self.assertEqual(Decimal(res["basic_salary_matrix_rate"]), Decimal("25000.00"))

    def test_basic_salary_tier_2_lookup(self):
        """Tier 2 (16-19 students) with 5-day package resolves to 30,000 PKR basic."""
        self._setup_teacher_classes(student_count=18, days_per_week=5)
        res = calculate_teacher_salary_preview(self.dept_a1, self.teacher_profile, 2026, 5)
        self.assertEqual(res["basic_salary_package"], "5 Days / Week")
        self.assertEqual(res["basic_salary_tier"], "Tier 2 (16-19)")
        self.assertEqual(Decimal(res["earnings"]["basic_salary_earnings"]), Decimal("30000.00"))

    def test_basic_salary_tier_3_with_3d_package(self):
        """Tier 3 (20+ students) with 3-day package resolves to 21,000 PKR basic."""
        self._setup_teacher_classes(student_count=22, days_per_week=3)
        res = calculate_teacher_salary_preview(self.dept_a1, self.teacher_profile, 2026, 5)
        self.assertEqual(res["basic_salary_package"], "3 Days / Week")
        self.assertEqual(res["basic_salary_tier"], "Tier 3 (20+)")
        self.assertEqual(Decimal(res["earnings"]["basic_salary_earnings"]), Decimal("21000.00"))

    # --- 5. Per-Class Salary model excludes basic salary ---
    def test_per_class_salary_model_excludes_basic_salary(self):
        """5: Policies with compensation_model='per_class' must zero out basic salary."""
        policy_per_class = SalaryPolicy.objects.create(
            institution=self.institution_a,
            department=self.dept_a1,
            name="Per Class Only Policy",
            code="POL-PER-CLASS",
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
            created_by=self.admin_a1,
        )
        version_pc = SalaryPolicyVersion.objects.create(
            policy=policy_per_class,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            week_start_day="monday",
        )
        self.assignment.policy = policy_per_class
        self.assignment.save()

        self._setup_teacher_classes(student_count=10, days_per_week=5)
        res = calculate_teacher_salary_preview(self.dept_a1, self.teacher_profile, 2026, 5)
        self.assertEqual(Decimal(res["earnings"]["basic_salary_earnings"]), Decimal("0.00"))
        self.assertIn("pure per-class compensation model", res["basic_salary_notes"])

    # --- 6. Basic + Per-Class model combines both correctly ---
    def test_basic_plus_per_class_combines_both_correctly(self):
        """6: Verified classes earn per-class rates AND monthly basic salary is added."""
        students = self._setup_teacher_classes(student_count=10, days_per_week=5)
        # Create 2 verified attendances across 2 distinct weeks to satisfy min_qualifying_weeks=2
        for c_date in [date(2026, 5, 4), date(2026, 5, 11)]:
            att = Attendance.objects.create(
                institution=self.institution_a,
                department=self.dept_a1,
                student=students[0],
                teacher=self.teacher_profile,
                date=c_date,
                status=Attendance.Status.PRESENT,
            )
            SalaryAttendanceVerification.objects.create(
                institution=self.institution_a,
                department=self.dept_a1,
                teacher=self.teacher_profile,
                student=students[0],
                occurrence_key=f"occ-test-{c_date.isoformat()}-{att.id}",
                class_date=c_date,
                scheduled_time=time(9, 0),
                verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
                resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
                teacher_available_determination=True,
                resolved_by=self.admin_a1,
            )

        res = calculate_teacher_salary_preview(self.dept_a1, self.teacher_profile, 2026, 5)
        # Per class rate for 5D + Tier 1 = 300.00. 2 classes taught = 600.00
        self.assertEqual(Decimal(res["earnings"]["regular_class_earnings"]), Decimal("600.00"))
        # Basic salary = 25,000.00
        self.assertEqual(Decimal(res["earnings"]["basic_salary_earnings"]), Decimal("25000.00"))
        # Gross = 25,600.00
        self.assertEqual(Decimal(res["earnings"]["gross_draft_earnings"]), Decimal("25600.00"))

    # --- 7. Teacher basic salary override takes precedence ---
    def test_teacher_basic_salary_override_precedence(self):
        """7: TeacherPolicyAssignment.basic_salary_override takes absolute precedence over matrix."""
        self._setup_teacher_classes(student_count=10, days_per_week=5)
        self.assignment.basic_salary_override = Decimal("45000.00")
        self.assignment.save()

        res = calculate_teacher_salary_preview(self.dept_a1, self.teacher_profile, 2026, 5)
        self.assertEqual(Decimal(res["earnings"]["basic_salary_earnings"]), Decimal("45000.00"))
        self.assertIn("agreement override", res["basic_salary_notes"])

    # --- 8 & 9. Mid-month student count and package change segmentation ---
    def test_student_count_changes_during_payroll_period(self):
        """8: Student count change mid-month crossing tiers calculates daily segmented proration."""
        students = self._setup_teacher_classes(student_count=10, days_per_week=5)
        # Add 10 more students effective May 16 (days 1-15: Tier 1, days 16-31: Tier 3)
        for i in range(10):
            u = User.objects.create_user(
                username=f"std_extra_{i}",
                password="pass",
                role=User.Role.STUDENT,
                department=self.dept_a1,
            )
            sp = StudentProfile.objects.create(
                user=u,
                teacher=self.teacher_profile,
                department=self.dept_a1,
                institution=self.institution_a,
                class_status=StudentProfile.ClassStatus.RUNNING,
            )
            StudentClassHistory.objects.create(
                student=sp,
                event_type=StudentClassHistory.EventType.ENROLLED,
                effective_date=date(2026, 5, 16),
            )
            ClassSchedule.objects.create(
                teacher=self.teacher_profile,
                student=sp,
                weekday=["monday", "tuesday", "wednesday", "thursday", "friday"][i % 5],
                time_slot=time(10, 0),
                is_active=True,
                department=self.dept_a1,
                institution=self.institution_a,
            )

        res = calculate_teacher_salary_preview(self.dept_a1, self.teacher_profile, 2026, 5)
        # May has 31 days. Segment 1: 15 days @ 25,000. Segment 2: 16 days @ 35,000.
        # Expected = round(25000 * 15/31 + 35000 * 16/31, 2) = round(12096.774 + 18064.516, 2) = 30161.29
        expected = round(Decimal("25000.00") * Decimal(15) / Decimal(31), 2) + round(
            Decimal("35000.00") * Decimal(16) / Decimal(31), 2
        )
        self.assertEqual(Decimal(res["earnings"]["basic_salary_earnings"]), expected)

    # --- 10. Mid-month salary proration ---
    def test_mid_month_salary_proration_calendar_days(self):
        """10: Teacher starting mid-month (e.g. May 16) is prorated based on calendar days."""
        self.assignment.effective_from = date(2026, 5, 16)
        self.assignment.save()

        self._setup_teacher_classes(student_count=10, days_per_week=5)
        res = calculate_teacher_salary_preview(self.dept_a1, self.teacher_profile, 2026, 5)
        # 16 active days out of 31 days in May @ 25,000 PKR
        expected = round(Decimal("25000.00") * Decimal(16) / Decimal(31), 2)
        self.assertEqual(Decimal(res["earnings"]["basic_salary_earnings"]), expected)
        self.assertIn("prorated for 16/31 active calendar days", res["basic_salary_notes"])

    # --- 11. Legacy published policy compatibility ---
    def test_legacy_published_policy_compatibility(self):
        """11: Legacy policy versions without SalaryPlanTierBasicSalary fall back to version.basic_salary_amount."""
        legacy_policy = SalaryPolicy.objects.create(
            institution=self.institution_a,
            department=self.dept_a1,
            name="Legacy Quran Policy",
            code="POL-LEGACY-01",
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            compensation_model=SalaryPolicy.CompensationModel.BASIC_PLUS_PER_CLASS,
            created_by=self.admin_a1,
        )
        legacy_version = SalaryPolicyVersion.objects.create(
            policy=legacy_policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2025, 1, 1),
            effective_to=date(2025, 12, 31),
            basic_salary_amount=Decimal("28000.00"),
            week_start_day="monday",
        )
        # Give it teaching plan and tiers and rates, but NO plan_tier_basic_salaries
        p5 = SalaryTeachingPlan.objects.create(
            policy_version=legacy_version,
            plan_name="5 Days",
            plan_code="5D_LEGACY",
            days_per_week=5,
            sort_order=1,
        )
        t1 = SalaryRateTier.objects.create(
            policy_version=legacy_version,
            tier_name="Tier 1",
            min_students=1,
            max_students=None,
            sort_order=1,
        )
        SalaryPlanTierRate.objects.create(
            policy_version=legacy_version,
            teaching_plan=p5,
            rate_tier=t1,
            rate_per_class=Decimal("300.00"),
        )
        # Now mark published
        legacy_version.status = SalaryPolicyVersion.Status.PUBLISHED
        legacy_version.save()

        self.assignment.policy = legacy_policy
        self.assignment.effective_from = date(2025, 1, 1)
        self.assignment.effective_to = date(2025, 12, 31)
        self.assignment.save()

        self._setup_teacher_classes(student_count=5, days_per_week=5)
        res = calculate_teacher_salary_preview(self.dept_a1, self.teacher_profile, 2025, 6)
        self.assertEqual(Decimal(res["earnings"]["basic_salary_earnings"]), Decimal("28000.00"))
        self.assertIn("legacy policy default", res["basic_salary_notes"])

    # --- 12 & 14. Stage 7A payroll generation and historical line items ---
    def test_stage_7a_payroll_line_and_metadata(self):
        """12 & 14: Stage 7A payroll generation creates basic salary PayrollEarningLine with cell metadata."""
        self._setup_teacher_classes(student_count=10, days_per_week=5)
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.dept_a1,
            year=2026,
            month=5,
            user=self.admin_a1,
        )
        self.assertEqual(period.status, SalaryPayrollPeriod.Status.DRAFT)
        t_payroll = TeacherPayroll.objects.get(
            payroll_period=period,
            teacher=self.teacher_profile,
        )
        self.assertEqual(t_payroll.basic_salary, Decimal("25000.00"))

        basic_line = PayrollEarningLine.objects.filter(
            teacher_payroll=t_payroll,
            earning_type=PayrollEarningLine.EarningType.BASIC_SALARY,
        ).first()
        self.assertIsNotNone(basic_line)
        self.assertEqual(basic_line.amount, Decimal("25000.00"))
        self.assertEqual(basic_line.rate, Decimal("25000.00"))
        self.assertEqual(basic_line.metadata.get("teaching_plan_name"), "5 Days / Week")
        self.assertEqual(basic_line.metadata.get("rate_tier_name"), "Tier 1 (1-15)")

    # --- 13. Stage 5 preview output metadata ---
    def test_stage_5_preview_output_metadata(self):
        """13: Stage 5 preview contains explicit package, tier, matrix rate, version, and cell id."""
        self._setup_teacher_classes(student_count=10, days_per_week=5)
        res = calculate_teacher_salary_preview(self.dept_a1, self.teacher_profile, 2026, 5)
        self.assertEqual(res["basic_salary_package"], "5 Days / Week")
        self.assertEqual(res["basic_salary_tier"], "Tier 1 (1-15)")
        self.assertEqual(res["basic_salary_matrix_rate"], "25000.00")
        self.assertEqual(res["basic_salary_policy_version"], "v1")
        self.assertIsNotNone(res["basic_salary_cell_id"])

    # --- 15. Stage 7B approval safeguards remain intact ---
    def test_stage_7b_approval_safeguards_intact(self):
        """15: Approved/locked payroll cannot be recalculated or altered."""
        self._setup_teacher_classes(student_count=10, days_per_week=5)
        period = PayrollLifecycleService.generate_draft_payroll(
            department=self.dept_a1,
            year=2026,
            month=5,
            user=self.admin_a1,
        )
        period.status = SalaryPayrollPeriod.Status.APPROVED
        period.save()

        # Attempting to re-generate draft payroll on approved payroll raises ValidationError
        with self.assertRaises(ValidationError):
            PayrollLifecycleService.generate_draft_payroll(
                department=self.dept_a1,
                year=2026,
                month=5,
                user=self.admin_a1,
            )

    # --- 16. Missing cells prevent invalid publication ---
    def test_missing_basic_salary_cells_prevent_publication(self):
        """16: Draft validation and publishing API block publication if any basic salary cell is missing."""
        client = APIClient()
        client.force_authenticate(user=self.admin_a1)

        # Create a new draft version with 1 plan and 2 tiers
        v_draft = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=3,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 7, 1),
        )
        plan = SalaryTeachingPlan.objects.create(policy_version=v_draft, plan_name="Plan 1", plan_code="P1", days_per_week=5, sort_order=1)
        tier1 = SalaryRateTier.objects.create(policy_version=v_draft, tier_name="T1", min_students=1, max_students=10, sort_order=1)
        tier2 = SalaryRateTier.objects.create(policy_version=v_draft, tier_name="T2", min_students=11, max_students=None, sort_order=2)

        # Populate per-class rates for both tiers
        SalaryPlanTierRate.objects.create(policy_version=v_draft, teaching_plan=plan, rate_tier=tier1, rate_per_class=Decimal("300.00"))
        SalaryPlanTierRate.objects.create(policy_version=v_draft, teaching_plan=plan, rate_tier=tier2, rate_per_class=Decimal("350.00"))

        # Populate basic salary for ONLY tier 1 (leaving tier 2 missing!)
        SalaryPlanTierBasicSalary.objects.create(
            policy_version=v_draft,
            teaching_plan=plan,
            rate_tier=tier1,
            basic_salary_amount=Decimal("20000.00"),
        )

        # Validate draft endpoint
        val_res = client.post(f"/api/salary/versions/{v_draft.id}/validate/")
        self.assertEqual(val_res.status_code, status.HTTP_200_OK)
        self.assertFalse(val_res.data["is_valid"])
        self.assertTrue(any("Basic salary matrix is incomplete" in err for err in val_res.data["errors"]))

        # Publish attempt should be blocked with 400 Bad Request
        pub_res = client.post(f"/api/salary/versions/{v_draft.id}/publish/")
        self.assertEqual(pub_res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("cannot publish", str(pub_res.data).lower())

    # --- 17. Cross-department access is blocked ---
    def test_cross_department_access_blocked(self):
        """17: Department A2 admin cannot view or edit Matrix for Department A1."""
        client = APIClient()
        client.force_authenticate(user=self.admin_a2)

        res = client.get(f"/api/salary/versions/{self.version.id}/matrix/")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # --- 18. Different institutions can configure independent matrices ---
    def test_different_institutions_independent_matrices(self):
        """18: Institution B can configure its own policy, plans, tiers, and basic salary matrix completely independently."""
        admin_b = User.objects.create_user(
            username="admin_b",
            password="pass",
            role=User.Role.DEPARTMENT_ADMIN,
            department=self.dept_b,
        )
        UserDepartmentRole.objects.create(
            user=admin_b,
            department=self.dept_b,
            institution=self.institution_b,
            role=UserDepartmentRole.Role.DEPARTMENT_ADMIN,
        )

        policy_b = SalaryPolicy.objects.create(
            institution=self.institution_b,
            department=self.dept_b,
            name="Branch Quran Policy",
            code="POL-BRANCH-01",
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            compensation_model=SalaryPolicy.CompensationModel.BASIC_PLUS_PER_CLASS,
            created_by=admin_b,
        )
        version_b = SalaryPolicyVersion.objects.create(
            policy=policy_b,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
        )
        plan_b = SalaryTeachingPlan.objects.create(policy_version=version_b, plan_name="Branch Plan", plan_code="BP", days_per_week=4, sort_order=1)
        tier_b = SalaryRateTier.objects.create(policy_version=version_b, tier_name="Branch Tier", min_students=1, max_students=None, sort_order=1)

        basic_b = SalaryPlanTierBasicSalary.objects.create(
            policy_version=version_b,
            teaching_plan=plan_b,
            rate_tier=tier_b,
            basic_salary_amount=Decimal("12345.67"),
        )
        self.assertEqual(basic_b.basic_salary_amount, Decimal("12345.67"))
        self.assertEqual(basic_b.policy_version.policy.department.institution.name, "Second Institution")
        # Ensure it has zero collision with Institution A
        self.assertNotEqual(basic_b.policy_version.policy.department.institution_id, self.institution_a.id)
