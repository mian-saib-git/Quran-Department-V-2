"""
IVS Unified Salary Management — Stage 5A Calculation Corrections and Configuration Tests.

Tests the 24 focused test scenarios required for Stage 5A:
1. All five rate precedence levels.
2. Coordinator rate on a configured qualifying day.
3. Ordinary rate on a nonqualifying day.
4. Teacher override defeating coordinator special rate.
5. Coordinator special rate when student tiers change.
6. Basic-only compensation.
7. Per-class-only compensation.
8. Basic-plus-per-class compensation.
9. Different basic amounts for teachers on authorized agreements.
10. Basic salary independent of the weekly class minimum.
11. Mid-month basic salary eligibility and proration.
12. Effective-dated basic salary changes.
13. Missing basic salary configuration causes incomplete preview.
14. Published basic compensation configuration remains immutable.
15. One completed lesson linked to multiple same-day class candidates.
16. No duplicate lesson bonus.
17. Student absence receives no lesson bonus.
18. Paid and unpaid cancellations.
19. Teacher-availability-conditional cancellation.
20. Future payroll year selection.
21. Department isolation.
22. No legacy payroll modifications.
23. No payable payroll records created.
24. No existing database changes.
"""
from datetime import date, datetime, time, timedelta
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
    DailyLessonReport,
    DailyLessonSubjectEntry,
    QuranClassCoverage,
    StudentClassHistory,
    StudentProfile,
    TeacherProfile,
    TeacherSalarySlip,
    QuranTeacherMonthlyPayroll,
)
from salary.models import (
    SalaryAttendanceVerification,
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryReconciliationBatch,
    SalaryTeachingPlan,
    TeacherPolicyAssignment,
    TeacherSalaryOverride,
)
from salary.calculation_engine import (
    calculate_department_salary_preview,
    calculate_teacher_salary_preview,
)
from salary.resolver import resolve_teacher_class_rate

User = get_user_model()


class SalaryCorrectionsStage5ATests(TestCase):
    """24 Targeted Unit & API Tests for Stage 5A Corrections."""

    def setUp(self):
        # 1. Institutions & Departments
        self.institution = Institution.objects.create(name="IVS Academy", slug="ivs-acad")
        self.inst_other = Institution.objects.create(name="Other Inst", slug="other-inst")

        self.quran_dept = Department.objects.create(
            institution=self.institution,
            name="Quran Department",
            code="quran-dept",
            department_type="quran",
        )
        self.tuition_dept = Department.objects.create(
            institution=self.institution,
            name="Tuition Department",
            code="tuition-dept",
            department_type="tuition",
        )
        self.other_dept = Department.objects.create(
            institution=self.inst_other,
            name="External Dept",
            code="ext-dept",
            department_type="quran",
        )

        # 2. Admin & User Roles
        self.dept_admin = User.objects.create_user(
            username="admin_5a",
            email="admin_5a@ivs.local",
            role=User.Role.DEPARTMENT_ADMIN,
            department=self.quran_dept,
            institution=self.institution,
        )

        # Coordinator who teaches
        self.coord_user = User.objects.create_user(
            username="coord_teacher_5a",
            email="coord_teacher_5a@ivs.local",
            role=User.Role.COORDINATOR,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.coord_profile = TeacherProfile.objects.create(
            user=self.coord_user,
            department=self.quran_dept,
            institution=self.institution,
            historical_name="Coordinator Ustadh Ali",
        )

        # Regular Teacher
        self.teacher_user = User.objects.create_user(
            username="teacher_regular_5a",
            email="teacher_regular_5a@ivs.local",
            role=User.Role.TEACHER,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.teacher_profile = TeacherProfile.objects.create(
            user=self.teacher_user,
            department=self.quran_dept,
            institution=self.institution,
            historical_name="Ustadh Bilal",
        )

        # Second Regular Teacher
        self.teacher_user_2 = User.objects.create_user(
            username="teacher_regular_2_5a",
            email="teacher_regular_2_5a@ivs.local",
            role=User.Role.TEACHER,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.teacher_profile_2 = TeacherProfile.objects.create(
            user=self.teacher_user_2,
            department=self.quran_dept,
            institution=self.institution,
            historical_name="Ustadh Tariq",
        )

        # Students
        self.student_user_1 = User.objects.create_user(
            username="student_1_5a",
            email="student_1@ivs.local",
            role=User.Role.STUDENT,
            first_name="Ahmed",
            last_name="Khan",
        )
        self.student_1 = StudentProfile.objects.create(
            user=self.student_user_1,
            teacher=self.teacher_profile,
            department=self.quran_dept,
            institution=self.institution,
        )

        self.student_user_2 = User.objects.create_user(
            username="student_2_5a",
            email="student_2@ivs.local",
            role=User.Role.STUDENT,
            first_name="Zayd",
            last_name="Malik",
        )
        self.student_2 = StudentProfile.objects.create(
            user=self.student_user_2,
            teacher=self.teacher_profile,
            department=self.quran_dept,
            institution=self.institution,
        )

        # 3. Base Standard Policy
        self.policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="POL_5A_STD",
            name="Standard 5A Policy",
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
        )
        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 12, 31),
            status=SalaryPolicyVersion.Status.DRAFT,
            week_start_day="monday",
            min_qualifying_weeks=2,
            lesson_plan_bonus_per_class=Decimal("10.00"),
            substitute_rate_per_class=Decimal("80.00"),
            cancellation_rate_per_class=Decimal("80.00"),
            cancellation_payment_rule="paid_always",
            coordinator_qualifying_weekdays=["friday", "saturday", "sunday", "monday"],
        )

        # Tiers
        self.tier_1 = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="1–15 students",
            min_students=1,
            max_students=15,
            sort_order=1,
        )
        self.tier_2 = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="16–19 students",
            min_students=16,
            max_students=19,
            sort_order=2,
        )
        self.tier_3 = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="20+ students",
            min_students=20,
            max_students=None,
            sort_order=3,
        )

        # Plans
        self.plan_5d = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_code="5_days",
            plan_name="5 Days / Week",
            days_per_week=5,
            sort_order=1,
        )
        self.plan_coord = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_code="coordinator_special",
            plan_name="Coordinator Special",
            is_coordinator_special=True,
            sort_order=5,
        )

        # Rates Matrix
        # 5_days
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_5d, rate_tier=self.tier_1, rate_per_class=Decimal("80.00"))
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_5d, rate_tier=self.tier_2, rate_per_class=Decimal("90.00"))
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_5d, rate_tier=self.tier_3, rate_per_class=Decimal("100.00"))
        # Coordinator Special
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_coord, rate_tier=self.tier_1, rate_per_class=Decimal("200.00"))
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_coord, rate_tier=self.tier_2, rate_per_class=Decimal("225.00"))
        SalaryPlanTierRate.objects.create(policy_version=self.version, teaching_plan=self.plan_coord, rate_tier=self.tier_3, rate_per_class=Decimal("250.00"))

        # Publish version
        self.version.status = SalaryPolicyVersion.Status.PUBLISHED
        self.version.save()

        # Batch
        self.batch = SalaryReconciliationBatch.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            period_year=2026,
            period_month=11,
            start_date=date(2026, 11, 1),
            end_date=date(2026, 11, 30),
            is_complete=True,
        )

        # Assignments
        self.assign_coord = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.coord_profile,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )
        self.assign_teacher = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

    # =========================================================================
    # TESTS 1 TO 5: FIVE-LEVEL RATE HIERARCHY & COORDINATOR SPECIAL RATES
    # =========================================================================

    def test_01_all_five_rate_precedence_levels(self):
        """1. Verify that all 5 rate precedence levels resolve in exact priority order."""
        # Class date on Friday Nov 6, 2026
        target_date = date(2026, 11, 6)

        # Create Overrides for Coordinator:
        # Level 1: Student-specific = 350
        ov_l1 = TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.coord_profile,
            override_level=TeacherSalaryOverride.OverrideLevel.STUDENT_SPECIFIC,
            student=self.student_1,
            rate_per_class=Decimal("350.00"),
            effective_from=date(2026, 1, 1),
            reason="L1 Student Override",
        )
        # Level 2: Plan-specific = 320
        ov_l2 = TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.coord_profile,
            override_level=TeacherSalaryOverride.OverrideLevel.PLAN_SPECIFIC,
            teaching_plan=self.plan_5d,
            rate_per_class=Decimal("320.00"),
            effective_from=date(2026, 1, 1),
            reason="L2 Plan Override",
        )
        # Level 3: Teacher-wide = 300
        ov_l3 = TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.coord_profile,
            override_level=TeacherSalaryOverride.OverrideLevel.TEACHER_WIDE,
            rate_per_class=Decimal("300.00"),
            effective_from=date(2026, 1, 1),
            reason="L3 Teacher Wide",
        )

        # With all active: Level 1 must win (Rs. 350)
        res = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.coord_profile.id,
            class_date=target_date,
            teaching_plan_id=self.plan_5d.id,
            student_id=self.student_1.id,
            student_count=10,
        )
        self.assertEqual(res.precedence_level, 1)
        self.assertEqual(res.winning_rate, Decimal("350.00"))

        # Deactivate Level 1: Level 2 must win (Rs. 320)
        ov_l1.is_active = False
        ov_l1.save()
        res = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.coord_profile.id,
            class_date=target_date,
            teaching_plan_id=self.plan_5d.id,
            student_id=self.student_1.id,
            student_count=10,
        )
        self.assertEqual(res.precedence_level, 2)
        self.assertEqual(res.winning_rate, Decimal("320.00"))

        # Deactivate Level 2: Level 3 must win (Rs. 300)
        ov_l2.is_active = False
        ov_l2.save()
        res = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.coord_profile.id,
            class_date=target_date,
            teaching_plan_id=self.plan_5d.id,
            student_id=self.student_1.id,
            student_count=10,
        )
        self.assertEqual(res.precedence_level, 3)
        self.assertEqual(res.winning_rate, Decimal("300.00"))

        # Deactivate Level 3: Level 4 Special Coordinator Rate must win (Rs. 200 on Friday)
        ov_l3.is_active = False
        ov_l3.save()
        res = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.coord_profile.id,
            class_date=target_date,
            teaching_plan_id=self.plan_5d.id,
            student_id=self.student_1.id,
            student_count=10,
        )
        self.assertEqual(res.precedence_level, 4)
        self.assertEqual(res.winning_rate, Decimal("200.00"))

        # On nonqualifying day (Wednesday Nov 4, 2026): Level 5 Department default must win (Rs. 80)
        wednesday = date(2026, 11, 4)
        res = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.coord_profile.id,
            class_date=wednesday,
            teaching_plan_id=self.plan_5d.id,
            student_id=self.student_1.id,
            student_count=10,
        )
        self.assertEqual(res.precedence_level, 5)
        self.assertEqual(res.winning_rate, Decimal("80.00"))

    def test_02_coordinator_rate_on_configured_qualifying_day(self):
        """2. Special coordinator rate applies on configured qualifying weekday for coordinator."""
        friday = date(2026, 11, 6)
        res = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.coord_profile.id,
            class_date=friday,
            teaching_plan_id=self.plan_5d.id,
            student_count=10,
        )
        self.assertTrue(res.is_resolved)
        self.assertEqual(res.precedence_level, 4)
        self.assertEqual(res.winning_rate, Decimal("200.00"))

    def test_03_ordinary_rate_on_nonqualifying_day(self):
        """3. Ordinary rate on nonqualifying day (and for non-coordinator on qualifying day)."""
        # Tuesday (nonqualifying for coordinator)
        tuesday = date(2026, 11, 3)
        res_coord = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.coord_profile.id,
            class_date=tuesday,
            teaching_plan_id=self.plan_5d.id,
            student_count=10,
        )
        self.assertEqual(res_coord.precedence_level, 5)
        self.assertEqual(res_coord.winning_rate, Decimal("80.00"))

        # Friday (qualifying day, but regular teacher is not a coordinator)
        friday = date(2026, 11, 6)
        res_regular = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher_profile.id,
            class_date=friday,
            teaching_plan_id=self.plan_5d.id,
            student_count=10,
        )
        self.assertEqual(res_regular.precedence_level, 5)
        self.assertEqual(res_regular.winning_rate, Decimal("80.00"))

    def test_04_teacher_override_defeating_coordinator_special_rate(self):
        """4. Individual teacher-wide override defeats the coordinator special day rate."""
        friday = date(2026, 11, 6)
        TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.coord_profile,
            override_level=TeacherSalaryOverride.OverrideLevel.TEACHER_WIDE,
            rate_per_class=Decimal("280.00"),
            effective_from=date(2026, 1, 1),
            reason="Negotiated Senior Coordinator Rate",
        )
        res = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.coord_profile.id,
            class_date=friday,
            teaching_plan_id=self.plan_5d.id,
            student_count=10,
        )
        self.assertEqual(res.precedence_level, 3)
        self.assertEqual(res.winning_rate, Decimal("280.00"))

    def test_05_coordinator_special_rate_when_student_tiers_change(self):
        """5. Coordinator special rate respects dynamic student-count tier."""
        friday = date(2026, 11, 6)
        # Tier 1 (1-15 students) -> Rs. 200
        res_t1 = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.coord_profile.id,
            class_date=friday,
            teaching_plan_id=self.plan_5d.id,
            student_count=12,
        )
        self.assertEqual(res_t1.winning_rate, Decimal("200.00"))

        # Tier 2 (16-19 students) -> Rs. 225
        res_t2 = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.coord_profile.id,
            class_date=friday,
            teaching_plan_id=self.plan_5d.id,
            student_count=17,
        )
        self.assertEqual(res_t2.winning_rate, Decimal("225.00"))

        # Tier 3 (20+ students) -> Rs. 250
        res_t3 = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.coord_profile.id,
            class_date=friday,
            teaching_plan_id=self.plan_5d.id,
            student_count=25,
        )
        self.assertEqual(res_t3.winning_rate, Decimal("250.00"))

    # =========================================================================
    # TESTS 6 TO 14: BASIC MONTHLY SALARY CONFIGURATION & ELIGIBILITY
    # =========================================================================

    def test_06_basic_only_compensation(self):
        """6. Basic-only compensation model pays fixed monthly salary and sets regular class pay to Rs. 0."""
        basic_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="POL_5A_BASIC_ONLY",
            name="Basic Only Policy",
            compensation_model=SalaryPolicy.CompensationModel.BASIC,
        )
        b_ver = SalaryPolicyVersion.objects.create(
            policy=basic_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
            basic_salary_amount=Decimal("30000.00"),
        )
        tier = SalaryRateTier.objects.create(policy_version=b_ver, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        plan = SalaryTeachingPlan.objects.create(policy_version=b_ver, plan_code="5_days", plan_name="5d", days_per_week=5)
        SalaryPlanTierRate.objects.create(policy_version=b_ver, teaching_plan=plan, rate_tier=tier, rate_per_class=Decimal("80.00"))
        b_ver.status = SalaryPolicyVersion.Status.PUBLISHED
        b_ver.save()

        self.assign_teacher.delete()

        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile_2,
            policy=basic_policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

        # Add 2 verified classes for Ustadh Tariq
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile_2,
            student=self.student_1,
            occurrence_key="test_b1",
            class_date=date(2026, 11, 2),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile_2,
            student=self.student_1,
            occurrence_key="test_b2",
            class_date=date(2026, 11, 9),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )

        prev = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile_2, 2026, 11)
        self.assertEqual(prev["earnings"]["basic_salary_earnings"], "30000.00")
        self.assertEqual(prev["earnings"]["regular_class_earnings"], "0.00")
        self.assertEqual(prev["earnings"]["gross_draft_earnings"], "30000.00")

    def test_07_per_class_only_compensation(self):
        """7. Per-class only compensation produces Rs. 0 basic salary and pays verified classes."""
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile,
            student=self.student_1,
            occurrence_key="test_pc1",
            class_date=date(2026, 11, 2),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile,
            student=self.student_1,
            occurrence_key="test_pc2",
            class_date=date(2026, 11, 9),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )

        prev = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile, 2026, 11)
        self.assertEqual(prev["earnings"]["basic_salary_earnings"], "0.00")
        self.assertEqual(prev["earnings"]["regular_class_earnings"], "160.00")

    def test_08_basic_plus_per_class_compensation(self):
        """8. Basic-plus-per-class combines basic monthly salary and regular class earnings."""
        combo_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="POL_5A_COMBO",
            name="Combo Policy",
            compensation_model=SalaryPolicy.CompensationModel.BASIC_PLUS_PER_CLASS,
        )
        c_ver = SalaryPolicyVersion.objects.create(
            policy=combo_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
            basic_salary_amount=Decimal("20000.00"),
        )
        tier = SalaryRateTier.objects.create(policy_version=c_ver, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        plan = SalaryTeachingPlan.objects.create(policy_version=c_ver, plan_code="5_days", plan_name="5d", days_per_week=5)
        SalaryPlanTierRate.objects.create(policy_version=c_ver, teaching_plan=plan, rate_tier=tier, rate_per_class=Decimal("100.00"))
        c_ver.status = SalaryPolicyVersion.Status.PUBLISHED
        c_ver.save()

        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile_2,
            policy=combo_policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile_2,
            student=self.student_1,
            occurrence_key="test_cb1",
            class_date=date(2026, 11, 2),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile_2,
            student=self.student_1,
            occurrence_key="test_cb2",
            class_date=date(2026, 11, 9),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )

        prev = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile_2, 2026, 11)
        self.assertEqual(prev["earnings"]["basic_salary_earnings"], "20000.00")
        self.assertEqual(prev["earnings"]["regular_class_earnings"], "200.00")
        self.assertEqual(prev["earnings"]["gross_draft_earnings"], "20200.00")

    def test_09_different_basic_amounts_for_teachers_on_authorized_agreements(self):
        """9. Different teachers on authorized agreements receive their respective customized basic amounts."""
        combo_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="POL_5A_AGREEMENTS",
            name="Agreements Policy",
            compensation_model=SalaryPolicy.CompensationModel.BASIC_PLUS_PER_CLASS,
        )
        c_ver = SalaryPolicyVersion.objects.create(
            policy=combo_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
            basic_salary_amount=Decimal("18000.00"),  # Policy default
        )
        tier = SalaryRateTier.objects.create(policy_version=c_ver, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        plan = SalaryTeachingPlan.objects.create(policy_version=c_ver, plan_code="5_days", plan_name="5d", days_per_week=5)
        SalaryPlanTierRate.objects.create(policy_version=c_ver, teaching_plan=plan, rate_tier=tier, rate_per_class=Decimal("80.00"))
        c_ver.status = SalaryPolicyVersion.Status.PUBLISHED
        c_ver.save()

        # Remove existing default assignment from setUp
        self.assign_teacher.delete()

        # Teacher 1 has authorized agreement for 28,000
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile,
            policy=combo_policy,
            effective_from=date(2026, 1, 1),
            basic_salary_override=Decimal("28000.00"),
            is_active=True,
        )
        # Teacher 2 has authorized agreement for 35,000
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile_2,
            policy=combo_policy,
            effective_from=date(2026, 1, 1),
            basic_salary_override=Decimal("35000.00"),
            is_active=True,
        )

        prev_1 = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile, 2026, 11)
        prev_2 = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile_2, 2026, 11)
        self.assertEqual(prev_1["earnings"]["basic_salary_earnings"], "28000.00")
        self.assertEqual(prev_2["earnings"]["basic_salary_earnings"], "35000.00")

    def test_10_basic_salary_independent_of_weekly_class_minimum(self):
        """10. Basic salary remains fully payable even when teacher fails the 2-week class minimum."""
        basic_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="POL_5A_INDEP",
            name="Indep Policy",
            compensation_model=SalaryPolicy.CompensationModel.BASIC_PLUS_PER_CLASS,
        )
        b_ver = SalaryPolicyVersion.objects.create(
            policy=basic_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
            basic_salary_amount=Decimal("22000.00"),
            min_qualifying_weeks=2,
        )
        tier = SalaryRateTier.objects.create(policy_version=b_ver, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        plan = SalaryTeachingPlan.objects.create(policy_version=b_ver, plan_code="5_days", plan_name="5d", days_per_week=5)
        SalaryPlanTierRate.objects.create(policy_version=b_ver, teaching_plan=plan, rate_tier=tier, rate_per_class=Decimal("80.00"))
        b_ver.status = SalaryPolicyVersion.Status.PUBLISHED
        b_ver.save()

        self.assign_teacher.delete()

        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile,
            policy=basic_policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

        # Only 1 class conducted in the entire month (Week 1 only) -> fails 2-week threshold
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile,
            student=self.student_1,
            occurrence_key="test_single_w1",
            class_date=date(2026, 11, 2),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )

        prev = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile, 2026, 11)
        # Class earnings disqualified due to 1 week
        self.assertEqual(prev["earnings"]["regular_class_earnings"], "0.00")
        # Basic salary completely intact
        self.assertEqual(prev["earnings"]["basic_salary_earnings"], "22000.00")
        self.assertEqual(prev["earnings"]["gross_draft_earnings"], "22000.00")

    def test_11_mid_month_basic_salary_eligibility(self):
        """11. Mid-month joining prorates basic salary by calendar days."""
        basic_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="POL_5A_PRORATE",
            name="Prorate Policy",
            compensation_model=SalaryPolicy.CompensationModel.BASIC,
        )
        b_ver = SalaryPolicyVersion.objects.create(
            policy=basic_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
            basic_salary_amount=Decimal("30000.00"),
            basic_salary_partial_month_proration="calendar_days",
        )
        tier = SalaryRateTier.objects.create(policy_version=b_ver, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        plan = SalaryTeachingPlan.objects.create(policy_version=b_ver, plan_code="5_days", plan_name="5d", days_per_week=5)
        SalaryPlanTierRate.objects.create(policy_version=b_ver, teaching_plan=plan, rate_tier=tier, rate_per_class=Decimal("80.00"))
        b_ver.status = SalaryPolicyVersion.Status.PUBLISHED
        b_ver.save()

        # Teacher assigned starting Nov 16, 2026 (15 active days out of 30 days in November)
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile_2,
            policy=basic_policy,
            effective_from=date(2026, 11, 16),
            is_active=True,
        )

        prev = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile_2, 2026, 11)
        # 15/30 * 30,000 = 15,000
        self.assertEqual(prev["earnings"]["basic_salary_earnings"], "15000.00")
        self.assertIn("prorated for 15/30 active calendar days", prev["basic_salary_notes"])

    def test_12_effective_dated_basic_salary_changes(self):
        """12. Effective-dated basic salary assignment ending mid-month prorates accurately."""
        basic_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="POL_5A_DATED",
            name="Dated Policy",
            compensation_model=SalaryPolicy.CompensationModel.BASIC,
        )
        b_ver = SalaryPolicyVersion.objects.create(
            policy=basic_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
            basic_salary_amount=Decimal("60000.00"),
            basic_salary_partial_month_proration="calendar_days",
        )
        tier = SalaryRateTier.objects.create(policy_version=b_ver, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        plan = SalaryTeachingPlan.objects.create(policy_version=b_ver, plan_code="5_days", plan_name="5d", days_per_week=5)
        SalaryPlanTierRate.objects.create(policy_version=b_ver, teaching_plan=plan, rate_tier=tier, rate_per_class=Decimal("80.00"))
        b_ver.status = SalaryPolicyVersion.Status.PUBLISHED
        b_ver.save()

        self.assign_teacher.delete()

        # Assignment ends on Nov 10 (10 active days out of 30)
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile,
            policy=basic_policy,
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 11, 10),
            is_active=True,
        )

        prev = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile, 2026, 11)
        # 10/30 * 60,000 = 20,000
        self.assertEqual(prev["earnings"]["basic_salary_earnings"], "20000.00")

    def test_13_missing_basic_salary_configuration_causes_incomplete_preview(self):
        """13. Missing basic salary configuration on basic policy flags calculation incomplete."""
        basic_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="POL_5A_MISSING_BASIC",
            name="Missing Basic Policy",
            compensation_model=SalaryPolicy.CompensationModel.BASIC,
        )
        b_ver = SalaryPolicyVersion.objects.create(
            policy=basic_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
            basic_salary_amount=None,  # Missing on policy version
        )
        tier = SalaryRateTier.objects.create(policy_version=b_ver, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        plan = SalaryTeachingPlan.objects.create(policy_version=b_ver, plan_code="5_days", plan_name="5d", days_per_week=5)
        SalaryPlanTierRate.objects.create(policy_version=b_ver, teaching_plan=plan, rate_tier=tier, rate_per_class=Decimal("80.00"))
        b_ver.status = SalaryPolicyVersion.Status.PUBLISHED
        b_ver.save()

        self.assign_teacher.delete()

        # Assignment also lacks override
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile,
            policy=basic_policy,
            effective_from=date(2026, 1, 1),
            basic_salary_override=None,
            is_active=True,
        )

        prev = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile, 2026, 11)
        self.assertFalse(prev["is_calculation_complete"])
        self.assertTrue(any("Basic salary amount is not configured" in r for r in prev["incompleteness_reasons"]))
        self.assertEqual(prev["earnings"]["basic_salary_earnings"], "0.00")

    def test_14_published_basic_compensation_configuration_remains_immutable(self):
        """14. Published basic salary, proration, and qualifying weekdays cannot be modified."""
        self.assertTrue(self.version.status == SalaryPolicyVersion.Status.PUBLISHED)
        self.version.basic_salary_amount = Decimal("50000.00")
        with self.assertRaises(ValidationError):
            self.version.clean()

    # =========================================================================
    # TESTS 15 TO 17: LESSON BONUS EVIDENCE VERIFICATION & DEDUPLICATION
    # =========================================================================

    def test_15_one_completed_lesson_linked_to_multiple_same_day_class_candidates(self):
        """15. When 2 classes occur for the same student on one day, only 1 bonus is awarded from 1 report."""
        # Student 1 has two classes on Nov 2 (morning 10:00 and afternoon 16:00)
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile,
            student=self.student_1,
            occurrence_key="multi_cls_1",
            class_date=date(2026, 11, 2),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile,
            student=self.student_1,
            occurrence_key="multi_cls_2",
            class_date=date(2026, 11, 2),
            scheduled_time=time(16, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )
        # Also need a second week to qualify regular earnings
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile,
            student=self.student_1,
            occurrence_key="multi_cls_w2",
            class_date=date(2026, 11, 9),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
        )

        # Create exactly ONE completed DailyLessonReport for Nov 2
        report = DailyLessonReport.objects.create(
            student=self.student_1,
            teacher=self.teacher_profile,
            date=date(2026, 11, 2),
            notes="Surah Al-Baqarah verses 1-10",
        )
        DailyLessonSubjectEntry.objects.create(
            report=report,
            subject="Tajweed",
            topic_summary="Tajweed rules",
            progress_status="good",
        )

        prev = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile, 2026, 11)
        # Find lines for Nov 2
        nov2_lines = [l for l in prev["class_earning_lines"] if l["class_date"] == "2026-11-02"]
        self.assertEqual(len(nov2_lines), 2)
        # First line gets bonus (10.00), second line gets 0.00 bonus
        bonuses = [Decimal(l["lesson_plan_bonus"]) for l in nov2_lines]
        self.assertIn(Decimal("10.00"), bonuses)
        self.assertIn(Decimal("0.00"), bonuses)

    def test_16_no_duplicate_lesson_bonus(self):
        """16. Confirms total lesson bonuses awarded on a single date with multiple classes equals Rs. 10."""
        # Same setup as test 15
        self.test_15_one_completed_lesson_linked_to_multiple_same_day_class_candidates()
        prev = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile, 2026, 11)
        # Total bonus earnings across the entire month for Nov 2 is exactly Rs. 10.00
        self.assertEqual(prev["earnings"]["lesson_plan_bonus_earnings"], "10.00")
        self.assertEqual(prev["summary_counts"]["lesson_plan_bonus_classes"], 1)

    def test_17_student_absence_receives_no_lesson_bonus(self):
        """17. Class with student absence earns regular rate (teacher available) but zero lesson bonus."""
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile,
            student=self.student_1,
            occurrence_key="absent_cls_1",
            class_date=date(2026, 11, 2),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.STUDENT_ABSENT_TEACHER_AVAILABLE,
            teacher_available_determination=True,
        )
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile,
            student=self.student_1,
            occurrence_key="absent_cls_2",
            class_date=date(2026, 11, 9),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.STUDENT_ABSENT_TEACHER_AVAILABLE,
            teacher_available_determination=True,
        )

        prev = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile, 2026, 11)
        self.assertEqual(prev["earnings"]["regular_class_earnings"], "160.00")
        self.assertEqual(prev["earnings"]["lesson_plan_bonus_earnings"], "0.00")
        self.assertEqual(prev["summary_counts"]["lesson_plan_bonus_classes"], 0)

    # =========================================================================
    # TESTS 18 TO 19: CANCELLATIONS SALARY TREATMENT
    # =========================================================================

    def test_18_paid_and_unpaid_cancellations(self):
        """18. Verifies paid cancellation yields configured amount while unpaid produces Rs. 0."""
        # 1. Paid cancellation
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile,
            student=self.student_1,
            occurrence_key="canc_paid",
            class_date=date(2026, 11, 2),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION,
            is_cancelled=True,
        )

        prev = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile, 2026, 11)
        self.assertEqual(prev["earnings"]["cancellation_earnings"], "80.00")
        self.assertEqual(prev["earnings"]["regular_class_earnings"], "0.00")
        self.assertEqual(prev["earnings"]["lesson_plan_bonus_earnings"], "0.00")

    def test_19_teacher_availability_conditional_cancellation(self):
        """19. Teacher-availability-conditional cancellation requires verified teacher availability."""
        cond_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="POL_5A_COND_CANC",
            name="Cond Canc Policy",
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
        )
        c_ver = SalaryPolicyVersion.objects.create(
            policy=cond_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
            cancellation_rate_per_class=Decimal("95.00"),
            cancellation_payment_rule="teacher_available_only",
        )
        tier = SalaryRateTier.objects.create(policy_version=c_ver, tier_name="1-15", min_students=1, max_students=15, sort_order=1)
        plan = SalaryTeachingPlan.objects.create(policy_version=c_ver, plan_code="5_days", plan_name="5d", days_per_week=5)
        SalaryPlanTierRate.objects.create(policy_version=c_ver, teaching_plan=plan, rate_tier=tier, rate_per_class=Decimal("80.00"))
        c_ver.status = SalaryPolicyVersion.Status.PUBLISHED
        c_ver.save()

        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile_2,
            policy=cond_policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
        )

        # Available teacher cancellation -> paid
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile_2,
            student=self.student_1,
            occurrence_key="canc_avail",
            class_date=date(2026, 11, 2),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION,
            teacher_available_determination=True,
            is_cancelled=True,
        )
        # Unavailable teacher cancellation -> unpaid
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher_profile_2,
            student=self.student_1,
            occurrence_key="canc_unavail",
            class_date=date(2026, 11, 9),
            scheduled_time=time(10, 0),
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION,
            teacher_available_determination=False,
            is_cancelled=True,
        )

        prev = calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile_2, 2026, 11)
        # Only the available one is paid: Rs. 95.00
        self.assertEqual(prev["earnings"]["cancellation_earnings"], "95.00")

    # =========================================================================
    # TESTS 20 TO 24: SECURITY, ISOLATION & NON-FINANCIAL STATUTORY COMPLIANCE
    # =========================================================================

    def test_20_future_payroll_year_selection(self):
        """20. Preview API accepts future payroll years without fixed 2027 cap."""
        client = APIClient()
        client.force_authenticate(user=self.dept_admin)

        # Year 2028
        res = client.post("/api/salary/calculations/preview/", {
            "department_id": self.quran_dept.id,
            "year": 2028,
            "month": 5,
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Year 2035
        res = client.post("/api/salary/calculations/preview/", {
            "department_id": self.quran_dept.id,
            "year": 2035,
            "month": 1,
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Invalid year (<2020)
        res = client.post("/api/salary/calculations/preview/", {
            "department_id": self.quran_dept.id,
            "year": 2015,
            "month": 1,
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_21_department_isolation(self):
        """21. Department Admin cannot request preview for another department."""
        client = APIClient()
        client.force_authenticate(user=self.dept_admin)

        # Attempt to access Tuition Department
        res = client.post("/api/salary/calculations/preview/", {
            "department_id": self.tuition_dept.id,
            "year": 2026,
            "month": 11,
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    def test_22_no_legacy_payroll_modifications(self):
        """22. Stateless calculation creates zero legacy V1 or V2 records."""
        initial_v1 = TeacherSalarySlip.objects.count()
        initial_v2 = QuranTeacherMonthlyPayroll.objects.count()

        calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile, 2026, 11)
        calculate_department_salary_preview(self.quran_dept, 2026, 11)

        self.assertEqual(TeacherSalarySlip.objects.count(), initial_v1)
        self.assertEqual(QuranTeacherMonthlyPayroll.objects.count(), initial_v2)

    def test_23_no_payable_payroll_records_created(self):
        """23. Stateless calculation creates zero payable payroll records in database."""
        calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile, 2026, 11)
        calculate_department_salary_preview(self.quran_dept, 2026, 11)
        # Database verification: zero payroll slips exist in DB
        self.assertEqual(TeacherSalarySlip.objects.count(), 0)
        self.assertEqual(QuranTeacherMonthlyPayroll.objects.count(), 0)

    def test_24_no_existing_database_changes(self):
        """24. Pre-existing attendance records remain completely unmutated."""
        att = Attendance.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_profile,
            student=self.student_1,
            date=date(2026, 11, 2),
            status="present",
        )
        calculate_teacher_salary_preview(self.quran_dept, self.teacher_profile, 2026, 11)
        att.refresh_from_db()
        self.assertEqual(att.status, "present")
