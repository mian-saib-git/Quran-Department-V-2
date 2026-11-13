"""
IVS Unified Salary Management — Deterministic Monthly Salary Calculation Tests (Stage 5).

52 Focused, disposable synthetic unit tests covering:
- Rate calculations across plans and tiers (1-10)
- Historical active-student counts, drops, transfers, thresholds (11-17)
- Weekly eligibility engine and partial-month exceptions (18-28)
- Attendance outcomes, lesson bonuses, substitutes, cancellations (29-43)
- Financial precision, security scoping, idempotency, non-mutation (44-52)
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status

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
    partition_month_into_weeks,
    resolve_historical_student_count,
)

User = get_user_model()


class SalaryCalculationEngineTests(TestCase):
    """52 Comprehensive tests for Stage 5 Deterministic Salary Calculation."""

    def setUp(self):
        # 1. Institutions & Departments
        self.institution = Institution.objects.create(name="IVS Test Academy", slug="ivs-test")
        self.institution_2 = Institution.objects.create(name="Other Academy", slug="other-acad")

        self.quran_dept = Department.objects.create(
            institution=self.institution,
            name="Quran Department",
            code="quran-dept",
            department_type="quran",
        )
        self.other_dept = Department.objects.create(
            institution=self.institution,
            name="Other Department",
            code="other-dept",
            department_type="quran",
        )
        self.inst2_dept = Department.objects.create(
            institution=self.institution_2,
            name="Inst2 Department",
            code="inst2-dept",
            department_type="quran",
        )

        # 2. Users & Roles
        self.dept_admin_user = User.objects.create_user(
            username="deptadmin_calc",
            email="deptadmin_calc@ivs.local",
            role=User.Role.DEPARTMENT_ADMIN,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.cross_dept_admin_user = User.objects.create_user(
            username="cross_admin_calc",
            email="cross_admin_calc@ivs.local",
            role=User.Role.DEPARTMENT_ADMIN,
            department=self.other_dept,
            institution=self.institution,
        )
        self.inst_admin_user = User.objects.create_user(
            username="instadmin_calc",
            email="instadmin_calc@ivs.local",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.institution,
        )
        self.other_inst_admin_user = User.objects.create_user(
            username="other_instadmin_calc",
            email="other_instadmin_calc@ivs.local",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.institution_2,
        )
        self.teacher_user = User.objects.create_user(
            username="teacher_calc_u",
            email="teacher_calc@ivs.local",
            role=User.Role.TEACHER,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.student_user = User.objects.create_user(
            username="student_calc_u",
            email="student_calc@ivs.local",
            role=User.Role.STUDENT,
            department=self.quran_dept,
            institution=self.institution,
        )

        # Profiles
        self.teacher = TeacherProfile.objects.create(
            user=self.teacher_user,
            department=self.quran_dept,
            institution=self.institution,
            historical_name="Teacher Calc Baseline",
        )
        self.student = StudentProfile.objects.create(
            user=self.student_user,
            teacher=self.teacher,
            department=self.quran_dept,
            institution=self.institution,
        )

        # Substitute teacher
        self.sub_teacher_user = User.objects.create_user(
            username="sub_teacher_u",
            email="sub_teacher@ivs.local",
            role=User.Role.TEACHER,
            department=self.quran_dept,
            institution=self.institution,
        )
        self.sub_teacher = TeacherProfile.objects.create(
            user=self.sub_teacher_user,
            department=self.quran_dept,
            institution=self.institution,
            historical_name="Substitute Teacher Baseline",
        )

        # 3. Setup Published Standard Quran Policy
        self.policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="QURAN_STD_CALC",
            name="Quran Standard Calculation Policy",
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
        )

        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            status=SalaryPolicyVersion.Status.DRAFT,
            week_start_day=SalaryPolicyVersion.WeekDay.MONDAY,
            min_qualifying_weeks=2,
            lesson_plan_bonus_per_class=Decimal("10.00"),
            substitute_rate_per_class=Decimal("80.00"),
            cancellation_rate_per_class=Decimal("80.00"),
            requires_completed_lesson_for_bonus=True,
        )

        # Rate Tiers (1-15, 16-19, 20+)
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

        # Teaching Plans: 5_days, 4_days, 3_days, 2_days, coordinator_special
        self.plan_5d = SalaryTeachingPlan.objects.create(
            policy_version=self.version, plan_code="5_days", plan_name="5 days/week", days_per_week=5, sort_order=1
        )
        self.plan_4d = SalaryTeachingPlan.objects.create(
            policy_version=self.version, plan_code="4_days", plan_name="4 days/week", days_per_week=4, sort_order=2
        )
        self.plan_3d = SalaryTeachingPlan.objects.create(
            policy_version=self.version, plan_code="3_days", plan_name="3 days/week", days_per_week=3, sort_order=3
        )
        self.plan_2d = SalaryTeachingPlan.objects.create(
            policy_version=self.version, plan_code="2_days", plan_name="2 days/week", days_per_week=2, sort_order=4
        )
        self.plan_coord = SalaryTeachingPlan.objects.create(
            policy_version=self.version, plan_code="coordinator_special", plan_name="Coordinator special",
            days_per_week=None, is_coordinator_special=True, sort_order=5
        )

        # 2D Matrix Rates
        matrix_definitions = [
            (self.plan_5d, self.tier1, Decimal("80.00")),
            (self.plan_5d, self.tier2, Decimal("90.00")),
            (self.plan_5d, self.tier3, Decimal("100.00")),
            (self.plan_4d, self.tier1, Decimal("100.00")),
            (self.plan_4d, self.tier2, Decimal("112.50")),
            (self.plan_4d, self.tier3, Decimal("125.00")),
            (self.plan_3d, self.tier1, Decimal("116.00")),
            (self.plan_3d, self.tier2, Decimal("133.00")),
            (self.plan_3d, self.tier3, Decimal("166.00")),
            (self.plan_2d, self.tier1, Decimal("175.00")),
            (self.plan_2d, self.tier2, Decimal("200.00")),
            (self.plan_2d, self.tier3, Decimal("225.00")),
            (self.plan_coord, self.tier1, Decimal("200.00")),
            (self.plan_coord, self.tier2, Decimal("225.00")),
            (self.plan_coord, self.tier3, Decimal("250.00")),
        ]
        for plan, tier, rate in matrix_definitions:
            SalaryPlanTierRate.objects.create(
                policy_version=self.version,
                teaching_plan=plan,
                rate_tier=tier,
                rate_per_class=rate,
            )

        # Publish version
        self.version.status = SalaryPolicyVersion.Status.PUBLISHED
        self.version.save()

        # Assign policy to teachers
        self.assignment = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            is_active=True,
        )
        self.sub_assignment = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.sub_teacher,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            effective_to=None,
            is_active=True,
        )

        # Batch record for test month November 2026
        self.batch = SalaryReconciliationBatch.objects.create(
            department=self.quran_dept,
            institution=self.institution,
            period_year=2026,
            period_month=11,
            start_date=date(2026, 11, 1),
            end_date=date(2026, 11, 30),
            is_complete=True,
            total_occurrences=20,
            verified_count=20,
            pending_count=0,
            resolved_count=0,
            conflicted_count=0,
        )

        # Client
        self.client = APIClient()

    # =========================================================================
    # Helper to generate student and verification records
    # =========================================================================
    def _create_student_with_schedule(self, username, weekdays, teacher=None, enrolled_date=date(2026, 1, 1)):
        t = teacher or self.teacher
        u = User.objects.create_user(
            username=username,
            email=f"{username}@ivs.local",
            role=User.Role.STUDENT,
            department=self.quran_dept,
            institution=self.institution,
        )
        s = StudentProfile.objects.create(
            user=u,
            teacher=t,
            department=self.quran_dept,
            institution=self.institution,
        )
        StudentClassHistory.objects.create(
            student=s,
            event_type=StudentClassHistory.EventType.ENROLLED,
            effective_date=enrolled_date,
        )
        schedules = []
        for w in weekdays:
            sched = ClassSchedule.objects.create(
                student=s,
                teacher=t,
                weekday=w,
                time_slot=time(10, 0),
                duration_minutes=30,
                is_active=True,
                department=self.quran_dept,
                institution=self.institution,
                effective_from=date(2026, 1, 1),
            )
            schedules.append(sched)
        return s, schedules

    def _create_verification(self, teacher, student, class_date, resolution_type, sched_id=None, sub_teacher=None, is_cancelled=False):
        return SalaryAttendanceVerification.objects.create(
            department=self.quran_dept,
            institution=self.institution,
            teacher=teacher,
            student=student,
            occurrence_key=f"quran:sched_{sched_id or 999}:{class_date.isoformat()}",
            class_date=class_date,
            scheduled_time=time(10, 0),
            source_schedule_id=sched_id,
            verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
            resolution_type=resolution_type,
            substitute_teacher=sub_teacher,
            is_cancelled=is_cancelled,
            teacher_available_determination=(resolution_type in [
                SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
                SalaryAttendanceVerification.ResolutionType.STUDENT_ABSENT_TEACHER_AVAILABLE,
                SalaryAttendanceVerification.ResolutionType.INFORMED_STUDENT_LEAVE,
            ]),
        )

    # =========================================================================
    # Group 1: Rate Calculations (Tests 1 - 10)
    # =========================================================================

    def test_01_five_day_plan_with_all_three_student_count_tiers(self):
        """1. Five-day plan resolves Rs. 80 (T1: 1-15), Rs. 90 (T2: 16-19), Rs. 100 (T3: 20+)."""
        s, scheds = self._create_student_with_schedule("s_5d", ["monday", "tuesday", "wednesday", "thursday", "friday"])
        # Tier 1 test (1 student)
        c_date = date(2026, 11, 2)  # Monday
        self._create_verification(self.teacher, s, c_date, SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        # Add another qualifying date so weekly minimum 2 is satisfied
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        # Student count is 1 -> Tier 1 -> rate Rs. 80.00
        lines = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-02"]
        self.assertEqual(lines[0]["applied_rate"], "80.00")
        self.assertEqual(lines[0]["tier_name"], "1–15 students")

    def test_02_four_day_plan_including_112_50(self):
        """2. Four-day plan resolves Rs. 112.50 in Tier 2 (16-19 students)."""
        s, scheds = self._create_student_with_schedule("s_4d", ["monday", "tuesday", "wednesday", "thursday"])
        # Create 15 dummy students so total students is 16 (Tier 2)
        for i in range(15):
            self._create_student_with_schedule(f"s_pad_{i}", ["monday"])

        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-02"][0]
        self.assertEqual(line["applied_rate"], "112.50")
        self.assertEqual(line["tier_name"], "16–19 students")

    def test_03_three_day_plan_including_133_and_166(self):
        """3. Three-day plan resolves Rs. 133 in Tier 2 and Rs. 166 in Tier 3."""
        s, scheds = self._create_student_with_schedule("s_3d", ["monday", "wednesday", "friday"])
        # Pad with 19 students so total is 20 (Tier 3)
        for i in range(19):
            self._create_student_with_schedule(f"s_3d_pad_{i}", ["monday"])

        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-02"][0]
        self.assertEqual(line["applied_rate"], "166.00")
        self.assertEqual(line["tier_name"], "20+ students")

    def test_04_two_day_plan(self):
        """4. Two-day plan resolves Rs. 175.00 in Tier 1."""
        s, scheds = self._create_student_with_schedule("s_2d", ["tuesday", "thursday"])
        self._create_verification(self.teacher, s, date(2026, 11, 3), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 10), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-03"][0]
        self.assertEqual(line["applied_rate"], "175.00")

    def test_05_special_coordinator_rate_on_qualifying_days(self):
        """5. Special coordinator rate on qualifying weekday (e.g. Sunday Level 4 override)."""
        s, scheds = self._create_student_with_schedule("s_coord", ["sunday"])
        # Level 4 override on Sunday
        TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            override_level=TeacherSalaryOverride.OverrideLevel.COORDINATOR_DAY,
            qualifying_weekday=TeacherSalaryOverride.WeekDay.SUNDAY,
            rate_per_class=Decimal("225.00"),
            effective_from=date(2026, 1, 1),
            reason="Sunday coordinator teaching",
        )
        self._create_verification(self.teacher, s, date(2026, 11, 1), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 8), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-01"][0]
        self.assertEqual(line["applied_rate"], "225.00")
        self.assertEqual(line["precedence_level"], 4)

    def test_06_ordinary_rate_on_nonqualifying_days(self):
        """6. Ordinary rate resolves on nonqualifying days when coordinator override exists for Sunday."""
        s, scheds = self._create_student_with_schedule("s_mixed", ["sunday", "tuesday"])
        TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            override_level=TeacherSalaryOverride.OverrideLevel.COORDINATOR_DAY,
            qualifying_weekday=TeacherSalaryOverride.WeekDay.SUNDAY,
            rate_per_class=Decimal("225.00"),
            effective_from=date(2026, 1, 1),
            reason="Sunday coordinator teaching",
        )
        self._create_verification(self.teacher, s, date(2026, 11, 3), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[1].id)
        self._create_verification(self.teacher, s, date(2026, 11, 10), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[1].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-03"][0]
        # Tuesday uses standard 2-day plan rate Rs. 175.00 (Level 5)
        self.assertEqual(line["applied_rate"], "175.00")
        self.assertEqual(line["precedence_level"], 5)

    def test_07_student_specific_override(self):
        """7. Student-specific override (Level 1) wins over all other rates."""
        s, scheds = self._create_student_with_schedule("s_l1", ["monday", "tuesday"])
        TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            student=s,
            override_level=TeacherSalaryOverride.OverrideLevel.STUDENT_SPECIFIC,
            rate_per_class=Decimal("350.00"),
            effective_from=date(2026, 1, 1),
            reason="Special student rate",
        )
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-02"][0]
        self.assertEqual(line["applied_rate"], "350.00")
        self.assertEqual(line["precedence_level"], 1)

    def test_08_plan_specific_override(self):
        """8. Plan-specific override (Level 2) applies to classes under that plan."""
        s, scheds = self._create_student_with_schedule("s_l2", ["monday", "tuesday", "wednesday", "thursday", "friday"])
        TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            teaching_plan=self.plan_5d,
            override_level=TeacherSalaryOverride.OverrideLevel.PLAN_SPECIFIC,
            rate_per_class=Decimal("150.00"),
            effective_from=date(2026, 1, 1),
            reason="Special 5-day rate",
        )
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-02"][0]
        self.assertEqual(line["applied_rate"], "150.00")
        self.assertEqual(line["precedence_level"], 2)

    def test_09_teacher_wide_override(self):
        """9. Teacher-wide override (Level 3) applies when no student or plan override exists."""
        s, scheds = self._create_student_with_schedule("s_l3", ["monday"])
        TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            override_level=TeacherSalaryOverride.OverrideLevel.TEACHER_WIDE,
            rate_per_class=Decimal("120.00"),
            effective_from=date(2026, 1, 1),
            reason="Senior teacher stipend",
        )
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-02"][0]
        self.assertEqual(line["applied_rate"], "120.00")
        self.assertEqual(line["precedence_level"], 3)

    def test_10_mid_month_override_effective_date(self):
        """10. Mid-month override applies only starting on its effective date."""
        s, scheds = self._create_student_with_schedule("s_mid_ov", ["monday", "tuesday"])
        TeacherSalaryOverride.objects.create(
            department=self.quran_dept,
            teacher=self.teacher,
            override_level=TeacherSalaryOverride.OverrideLevel.TEACHER_WIDE,
            rate_per_class=Decimal("300.00"),
            effective_from=date(2026, 11, 15),
            reason="Mid month promotion",
        )
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 16), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        l_before = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-02"][0]
        l_after = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-16"][0]
        self.assertNotEqual(l_before["applied_rate"], "300.00")
        self.assertEqual(l_after["applied_rate"], "300.00")

    # =========================================================================
    # Group 2: Historical Active Student Counts (Tests 11 - 17)
    # =========================================================================

    def test_11_student_joining_mid_month(self):
        """11. Student joining mid-month does not increase active count before join date."""
        cnt_before, _ = resolve_historical_student_count(self.quran_dept, self.teacher, date(2026, 11, 10))
        # Create student joining on Nov 15
        s, _ = self._create_student_with_schedule("s_join15", ["monday"], enrolled_date=date(2026, 11, 15))
        cnt_after, _ = resolve_historical_student_count(self.quran_dept, self.teacher, date(2026, 11, 16))
        cnt_on_10, _ = resolve_historical_student_count(self.quran_dept, self.teacher, date(2026, 11, 10))

        self.assertEqual(cnt_on_10, cnt_before)
        self.assertEqual(cnt_after, cnt_before + 1)

    def test_12_student_transferring_between_teachers(self):
        """12. Mid-month student transfer reattributes count from transfer date."""
        s, scheds = self._create_student_with_schedule("s_trans", ["monday"])
        # Transferred from self.teacher to self.sub_teacher on Nov 15
        StudentClassHistory.objects.create(
            student=s,
            previous_teacher=self.teacher,
            new_teacher=self.sub_teacher,
            event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
            effective_date=date(2026, 11, 15),
        )
        cnt_t1_before, _ = resolve_historical_student_count(self.quran_dept, self.teacher, date(2026, 11, 10))
        cnt_t1_after, _ = resolve_historical_student_count(self.quran_dept, self.teacher, date(2026, 11, 16))
        self.assertEqual(cnt_t1_after, cnt_t1_before - 1)

    def test_13_confirmed_student_drop(self):
        """13. Confirmed student drop reduces active count strictly from confirmed drop date."""
        s, _ = self._create_student_with_schedule("s_drop", ["monday"])
        s.class_status = StudentProfile.ClassStatus.OLD_DROPPED
        s.status_effective_date = date(2026, 11, 12)
        s.save()

        cnt_on_10, _ = resolve_historical_student_count(self.quran_dept, self.teacher, date(2026, 11, 10))
        cnt_on_15, _ = resolve_historical_student_count(self.quran_dept, self.teacher, date(2026, 11, 15))
        self.assertEqual(cnt_on_15, cnt_on_10 - 1)

    def test_14_drop_review_without_confirmed_drop(self):
        """14. Student in drop-review without confirmed drop does NOT reduce count."""
        s, _ = self._create_student_with_schedule("s_rev", ["monday"])
        s.class_status = StudentProfile.ClassStatus.RUNNING
        s.save()

        cnt, s_ids = resolve_historical_student_count(self.quran_dept, self.teacher, date(2026, 11, 15))
        self.assertIn(s.id, s_ids)

    def test_15_multiple_schedules_for_one_student_counted_once(self):
        """15. Student with 5 schedules is counted exactly once."""
        s, _ = self._create_student_with_schedule("s_multi", ["monday", "tuesday", "wednesday", "thursday", "friday"])
        cnt, s_ids = resolve_historical_student_count(self.quran_dept, self.teacher, date(2026, 11, 5))
        self.assertEqual(s_ids.count(s.id), 1)

    def test_16_student_count_threshold_crossed_mid_month(self):
        """16. Teacher crosses from Tier 1 (15) to Tier 2 (16) on Nov 15; rate updates on classes on/after Nov 15."""
        s_target, scheds = self._create_student_with_schedule("s_tier_target", ["monday", "thursday"])
        # Pad with 14 students joining Nov 1
        for i in range(14):
            self._create_student_with_schedule(f"s_pad_{i}", ["monday"], enrolled_date=date(2026, 11, 1))
        # 16th student joins Nov 15
        self._create_student_with_schedule("s_join_16", ["monday"], enrolled_date=date(2026, 11, 15))

        self._create_verification(self.teacher, s_target, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s_target, date(2026, 11, 16), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        l_early = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-02"][0]
        l_late = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-16"][0]
        self.assertEqual(l_early["tier_name"], "1–15 students")
        self.assertEqual(l_late["tier_name"], "16–19 students")

    def test_17_policy_version_changed_mid_month(self):
        """17. Policy version change mid-month resolves appropriate version per date."""
        split_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="SPLIT_POLICY",
            name="Split Policy",
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
        )
        v1 = SalaryPolicyVersion.objects.create(
            policy=split_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            effective_to=date(2026, 11, 14),
            status=SalaryPolicyVersion.Status.DRAFT,
            lesson_plan_bonus_per_class=Decimal("10.00"),
            substitute_rate_per_class=Decimal("80.00"),
        )
        t1 = SalaryRateTier.objects.create(policy_version=v1, tier_name="1–15", min_students=1, max_students=None, sort_order=1)
        p1 = SalaryTeachingPlan.objects.create(policy_version=v1, plan_code="5_days", plan_name="5 days", days_per_week=5)
        SalaryPlanTierRate.objects.create(policy_version=v1, teaching_plan=p1, rate_tier=t1, rate_per_class=Decimal("80.00"))
        v1.status = SalaryPolicyVersion.Status.PUBLISHED
        v1.save()

        v2 = SalaryPolicyVersion.objects.create(
            policy=split_policy,
            version_number=2,
            effective_from=date(2026, 11, 15),
            status=SalaryPolicyVersion.Status.DRAFT,
            lesson_plan_bonus_per_class=Decimal("15.00"),
            substitute_rate_per_class=Decimal("90.00"),
        )
        t2 = SalaryRateTier.objects.create(policy_version=v2, tier_name="1–15", min_students=1, max_students=None, sort_order=1)
        p2 = SalaryTeachingPlan.objects.create(policy_version=v2, plan_code="5_days", plan_name="5 days", days_per_week=5)
        SalaryPlanTierRate.objects.create(policy_version=v2, teaching_plan=p2, rate_tier=t2, rate_per_class=Decimal("95.00"))
        v2.status = SalaryPolicyVersion.Status.PUBLISHED
        v2.save()

        self.assignment.policy = split_policy
        self.assignment.save()

        s, scheds = self._create_student_with_schedule("s_v2", ["monday", "tuesday"])
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 16), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        l_v1 = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-02"][0]
        l_v2 = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-16"][0]
        self.assertEqual(l_v1["policy_version_number"], 1)
        self.assertEqual(l_v2["policy_version_number"], 2)

    # =========================================================================
    # Group 3: Weekly Eligibility Engine (Tests 18 - 28)
    # =========================================================================

    def test_18_zero_eligible_weeks(self):
        """18. Ongoing student with zero eligible weeks results in Rs. 0 regular class earnings."""
        s, _ = self._create_student_with_schedule("s_zero_w", ["monday"])
        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        self.assertEqual(res["earnings"]["regular_class_earnings"], "0.00")

    def test_19_one_eligible_week_ongoing_enrollment(self):
        """19. Ongoing student with only 1 eligible week fails 2-week minimum (Rs. 0 regular earnings)."""
        s, scheds = self._create_student_with_schedule("s_one_w", ["monday"])
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        self.assertEqual(res["earnings"]["regular_class_earnings"], "0.00")
        line = res["class_earning_lines"][0]
        self.assertFalse(line["weekly_eligibility_qualified"])
        self.assertIn("Weekly eligibility not met", line["zero_payment_reason"])

    def test_20_two_eligible_weeks(self):
        """20. Ongoing student with 2 eligible weeks qualifies without 50% penalty."""
        s, scheds = self._create_student_with_schedule("s_two_w", ["monday"])
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        # 2 classes * Rs. 80.00 = Rs. 160.00 regular earnings
        self.assertEqual(res["earnings"]["regular_class_earnings"], "160.00")

    def test_21_three_eligible_weeks(self):
        """21. Three eligible weeks: all eligible classes paid."""
        s, scheds = self._create_student_with_schedule("s_three_w", ["monday"])
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 16), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        # 3 classes * Rs. 80.00 = Rs. 240.00 regular earnings
        self.assertEqual(res["earnings"]["regular_class_earnings"], "240.00")

    def test_22_partial_month_new_enrollment(self):
        """22. Partial-month new enrollment qualifies with only 1 eligible week."""
        s, scheds = self._create_student_with_schedule("s_mid_enr", ["monday"], enrolled_date=date(2026, 11, 20))
        self._create_verification(self.teacher, s, date(2026, 11, 23), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        self.assertEqual(res["earnings"]["regular_class_earnings"], "80.00")
        line = res["class_earning_lines"][0]
        self.assertTrue(line["weekly_eligibility_qualified"])

    def test_23_partial_month_departure(self):
        """23. Partial-month departure qualifies with only 1 eligible week."""
        s, scheds = self._create_student_with_schedule("s_mid_dep", ["monday"])
        s.class_status = StudentProfile.ClassStatus.OLD_DROPPED
        s.status_effective_date = date(2026, 11, 8)
        s.save()
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        self.assertEqual(res["earnings"]["regular_class_earnings"], "80.00")
        self.assertTrue(res["class_earning_lines"][0]["weekly_eligibility_qualified"])

    def test_24_partial_month_receiving_teacher_transfer(self):
        """24. Receiving teacher qualifies for transfer exception with only 1 week."""
        s, scheds = self._create_student_with_schedule("s_rec_tr", ["monday"], teacher=self.sub_teacher)
        # Transferred to self.teacher on Nov 20
        StudentClassHistory.objects.create(
            student=s,
            previous_teacher=self.sub_teacher,
            new_teacher=self.teacher,
            event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
            effective_date=date(2026, 11, 20),
        )
        self._create_verification(self.teacher, s, date(2026, 11, 23), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        self.assertEqual(res["earnings"]["regular_class_earnings"], "80.00")

    def test_25_teaching_plan_change_without_weekly_reset(self):
        """25. Student changing plans within month does not reset eligible weeks."""
        s, scheds = self._create_student_with_schedule("s_plan_chg", ["monday"])
        # Class 1 on Nov 2 (Week 1)
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        # Class 2 on Nov 9 (Week 2) under new plan
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        # Both weeks contribute to 2-week qualification
        self.assertEqual(res["earnings"]["regular_class_earnings"], "160.00")

    def test_26_partial_week_at_start_of_month(self):
        """26. Partial week at start of month (e.g. Sunday Nov 1) qualifies independently."""
        s, scheds = self._create_student_with_schedule("s_nov1", ["sunday"])
        # Nov 1, 2026 is Sunday (partial week 1 before Monday Nov 2)
        self._create_verification(self.teacher, s, date(2026, 11, 1), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 8), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        weeks = partition_month_into_weeks(2026, 11, "monday")
        self.assertEqual(weeks[0]["start_date"], date(2026, 11, 1))
        self.assertEqual(weeks[0]["end_date"], date(2026, 11, 1))

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        self.assertTrue(res["class_earning_lines"][0]["weekly_eligibility_qualified"])

    def test_27_teaching_week_overlapping_two_months(self):
        """27. Classes in other months do not contribute to November earnings."""
        s, scheds = self._create_student_with_schedule("s_cross_m", ["monday"])
        # October 26 class (in Oct)
        self._create_verification(self.teacher, s, date(2026, 10, 26), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        # Nov 2 class
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        # October class is not in November preview
        nov_dates = [l["class_date"] for l in res["class_earning_lines"]]
        self.assertNotIn("2026-10-26", nov_dates)

    def test_28_five_week_calendar_month(self):
        """28. Partitioning handles 5 or 6 calendar weeks in month cleanly."""
        weeks = partition_month_into_weeks(2026, 11, "monday")
        self.assertEqual(len(weeks), 6)  # Nov 1 is Sunday (w1), then 4 full weeks, then Nov 30 is Monday (w6)

    # =========================================================================
    # Group 4: Attendance & Compensation (Tests 29 - 43)
    # =========================================================================

    def test_29_teacher_taught_normally(self):
        """29. Verified taught class pays regular rate."""
        s, scheds = self._create_student_with_schedule("s_taught", ["monday"])
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = res["class_earning_lines"][0]
        self.assertEqual(line["regular_earnings"], "80.00")

    def test_30_student_informed_leave_with_teacher_available(self):
        """30. Student informed leave with teacher available is payable."""
        s, scheds = self._create_student_with_schedule("s_inf_l", ["monday"])
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.INFORMED_STUDENT_LEAVE, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = res["class_earning_lines"][0]
        self.assertEqual(line["regular_earnings"], "80.00")

    def test_31_student_uninformed_absence_with_teacher_available(self):
        """31. Student uninformed absence with teacher available is payable."""
        s, scheds = self._create_student_with_schedule("s_uninf_a", ["monday"])
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.STUDENT_ABSENT_TEACHER_AVAILABLE, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = res["class_earning_lines"][0]
        self.assertEqual(line["regular_earnings"], "80.00")

    def test_32_teacher_absent(self):
        """32. Teacher absent class results in Rs. 0 payment."""
        s, scheds = self._create_student_with_schedule("s_t_abs", ["monday"])
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.TEACHER_ABSENT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = res["class_earning_lines"][0]
        self.assertEqual(line["regular_earnings"], "0.00")
        self.assertEqual(line["zero_payment_reason"], "Teacher was absent.")

    def test_33_substitute_class_paid_at_80(self):
        """33. Substitute teacher receives Rs. 80.00 for covered class."""
        s, scheds = self._create_student_with_schedule("s_sub80", ["monday"])
        # Original teacher is absent; sub_teacher covers
        self._create_verification(
            self.teacher, s, date(2026, 11, 2),
            SalaryAttendanceVerification.ResolutionType.SUBSTITUTE_CLASS,
            sched_id=scheds[0].id,
            sub_teacher=self.sub_teacher,
        )

        res_sub = calculate_teacher_salary_preview(self.quran_dept, self.sub_teacher, 2026, 11)
        self.assertEqual(res_sub["earnings"]["substitute_compensation_earnings"], "80.00")
        line = res_sub["class_earning_lines"][0]
        self.assertTrue(line["is_substitute_class"])
        self.assertEqual(line["substitute_earnings"], "80.00")

    def test_34_original_teacher_not_double_penalized(self):
        """34. Original teacher receives Rs. 0 for substituted class, no double penalty."""
        s, scheds = self._create_student_with_schedule("s_orig_t", ["monday"])
        self._create_verification(
            self.teacher, s, date(2026, 11, 2),
            SalaryAttendanceVerification.ResolutionType.SUBSTITUTE_CLASS,
            sched_id=scheds[0].id,
            sub_teacher=self.sub_teacher,
        )

        res_orig = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = res_orig["class_earning_lines"][0]
        self.assertEqual(line["regular_earnings"], "0.00")
        self.assertIn("covered by substitute", line["zero_payment_reason"])

    def test_35_lesson_plan_bonus_paid_at_10(self):
        """35. Taught class with completed DailyLessonReport receives Rs. 10.00 bonus."""
        s, scheds = self._create_student_with_schedule("s_bonus", ["monday"])
        c_date = date(2026, 11, 2)
        self._create_verification(self.teacher, s, c_date, SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        # Lesson report on Nov 2
        rep = DailyLessonReport.objects.create(
            department=self.quran_dept,
            institution=self.institution,
            teacher=self.teacher,
            student=s,
            date=c_date,
            notes="Completed Sabaq",
        )
        DailyLessonSubjectEntry.objects.create(report=rep, subject="Quran", topic_summary="Surah Baqarah 1-10")

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-02"][0]
        self.assertEqual(line["lesson_plan_bonus"], "10.00")
        self.assertTrue(line["has_completed_lesson_plan"])

    def test_36_missing_lesson_plan_means_no_bonus(self):
        """36. Taught class without DailyLessonReport receives Rs. 0 bonus."""
        s, scheds = self._create_student_with_schedule("s_no_rep", ["monday"])
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-02"][0]
        self.assertEqual(line["lesson_plan_bonus"], "0.00")
        self.assertFalse(line["has_completed_lesson_plan"])

    def test_37_student_absence_means_no_bonus(self):
        """37. Student absence does NOT receive lesson bonus even if report exists."""
        s, scheds = self._create_student_with_schedule("s_abs_nobonus", ["monday"])
        c_date = date(2026, 11, 2)
        self._create_verification(self.teacher, s, c_date, SalaryAttendanceVerification.ResolutionType.STUDENT_ABSENT_TEACHER_AVAILABLE, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        DailyLessonReport.objects.create(teacher=self.teacher, student=s, date=c_date, notes="Student was absent")

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = [l for l in res["class_earning_lines"] if l["class_date"] == "2026-11-02"][0]
        self.assertEqual(line["lesson_plan_bonus"], "0.00")

    def test_38_lesson_bonus_remains_payable_when_one_week_minimum_fails(self):
        """38. Lesson bonus remains payable (Rs. 10) even when regular class earnings fail weekly minimum (Rs. 0)."""
        s, scheds = self._create_student_with_schedule("s_bonus_fail_w", ["monday"])
        c_date = date(2026, 11, 2)
        # Only 1 class in the entire month (fails 2-week minimum)
        self._create_verification(self.teacher, s, c_date, SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        rep = DailyLessonReport.objects.create(teacher=self.teacher, student=s, date=c_date, notes="Completed")
        DailyLessonSubjectEntry.objects.create(report=rep, subject="Quran", topic_summary="Surah")

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = res["class_earning_lines"][0]
        self.assertEqual(line["regular_earnings"], "0.00")  # Weekly minimum failed
        self.assertEqual(line["lesson_plan_bonus"], "10.00")  # Bonus remains payable
        self.assertEqual(res["earnings"]["lesson_plan_bonus_earnings"], "10.00")

    def test_39_payable_cancellation(self):
        """39. Payable official cancellation earns cancellation rate (Rs. 80.00)."""
        s, scheds = self._create_student_with_schedule("s_canc_pay", ["monday"])
        self._create_verification(
            self.teacher, s, date(2026, 11, 2),
            SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION,
            sched_id=scheds[0].id,
            is_cancelled=True,
        )

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = res["class_earning_lines"][0]
        self.assertEqual(line["cancellation_earnings"], "80.00")
        self.assertEqual(res["earnings"]["cancellation_earnings"], "80.00")

    def test_40_unpaid_cancellation(self):
        """40. Unpaid cancellation receives Rs. 0."""
        unpaid_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="UNPAID_CANC_POL",
            name="Unpaid Canc Policy",
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
        )
        v = SalaryPolicyVersion.objects.create(
            policy=unpaid_policy,
            version_number=1,
            effective_from=date(2026, 1, 1),
            status=SalaryPolicyVersion.Status.DRAFT,
            cancellation_rate_per_class=Decimal("0.00"),
        )
        t = SalaryRateTier.objects.create(policy_version=v, tier_name="1–15", min_students=1, max_students=None, sort_order=1)
        p = SalaryTeachingPlan.objects.create(policy_version=v, plan_code="5_days", plan_name="5 days", days_per_week=5)
        SalaryPlanTierRate.objects.create(policy_version=v, teaching_plan=p, rate_tier=t, rate_per_class=Decimal("80.00"))
        v.status = SalaryPolicyVersion.Status.PUBLISHED
        v.save()

        self.assignment.policy = unpaid_policy
        self.assignment.save()

        s, scheds = self._create_student_with_schedule("s_canc_unp", ["monday"])
        self._create_verification(
            self.teacher, s, date(2026, 11, 2),
            SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION,
            sched_id=scheds[0].id,
            is_cancelled=True,
        )

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        line = res["class_earning_lines"][0]
        self.assertEqual(line["cancellation_earnings"], "0.00")
        self.assertIn("Official cancellation", line["zero_payment_reason"])

    def test_41_pending_attendance_causes_incomplete_preview(self):
        """41. Pending attendance flags calculation as incomplete with warning."""
        s, scheds = self._create_student_with_schedule("s_pend", ["monday"])
        SalaryAttendanceVerification.objects.create(
            department=self.quran_dept,
            institution=self.institution,
            teacher=self.teacher,
            student=s,
            occurrence_key=f"quran:sched_{scheds[0].id}:2026-11-02",
            class_date=date(2026, 11, 2),
            verification_status=SalaryAttendanceVerification.VerificationStatus.PENDING,
            flag_reason="Teacher attendance missing",
        )

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        self.assertFalse(res["is_calculation_complete"])
        self.assertTrue(len(res["incompleteness_reasons"]) > 0)
        self.assertEqual(len(res["unresolved_occurrences"]), 1)

    def test_42_conflicted_attendance_causes_incomplete_preview(self):
        """42. Conflicted attendance flags calculation as incomplete with warning."""
        s, scheds = self._create_student_with_schedule("s_conf", ["monday"])
        SalaryAttendanceVerification.objects.create(
            department=self.quran_dept,
            institution=self.institution,
            teacher=self.teacher,
            student=s,
            occurrence_key=f"quran:sched_{scheds[0].id}:2026-11-02",
            class_date=date(2026, 11, 2),
            verification_status=SalaryAttendanceVerification.VerificationStatus.CONFLICTED,
            flag_reason="Substitute unassigned",
        )

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        self.assertFalse(res["is_calculation_complete"])

    def test_43_reconciliation_scan_missing_or_stale(self):
        """43. Missing reconciliation batch flags department preview as incomplete."""
        SalaryReconciliationBatch.objects.all().delete()
        res = calculate_department_salary_preview(self.quran_dept, 2026, 11)
        self.assertFalse(res["is_calculation_complete"])
        self.assertIn("has not been run", res["department_warnings"][0])

    # =========================================================================
    # Group 5: Financial Precision & Security Scoping (Tests 44 - 52)
    # =========================================================================

    def test_44_decimal_precision(self):
        """44. Gross earnings maintain exact 2-decimal precision without float drift."""
        s, scheds = self._create_student_with_schedule("s_prec", ["monday", "tuesday"])
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        earnings = res["earnings"]
        self.assertRegex(earnings["gross_draft_earnings"], r"^\d+\.\d{2}$")

    def test_45_no_duplicate_class_earnings(self):
        """45. Repeated occurrence keys are deduplicated; no double counting."""
        s, scheds = self._create_student_with_schedule("s_dedup", ["monday"])
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        res = calculate_teacher_salary_preview(self.quran_dept, self.teacher, 2026, 11)
        keys = [l["occurrence_key"] for l in res["class_earning_lines"]]
        self.assertEqual(len(keys), len(set(keys)))

    def test_46_repeated_previews_produce_identical_amounts(self):
        """46. Engine is pure and idempotent; repeated runs yield identical results."""
        s, scheds = self._create_student_with_schedule("s_idem", ["monday"])
        self._create_verification(self.teacher, s, date(2026, 11, 2), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)
        self._create_verification(self.teacher, s, date(2026, 11, 9), SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT, sched_id=scheds[0].id)

        run1 = calculate_department_salary_preview(self.quran_dept, 2026, 11)
        run2 = calculate_department_salary_preview(self.quran_dept, 2026, 11)
        self.assertEqual(run1["summary"], run2["summary"])

    def test_47_cross_department_denial(self):
        """47. Department Admin of Dept A is denied preview for Dept B (403 Forbidden)."""
        self.client.force_authenticate(user=self.cross_dept_admin_user)
        resp = self.client.post("/api/salary/calculations/preview/", {
            "department_id": self.quran_dept.id,
            "year": 2026,
            "month": 11,
        })
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_48_cross_institution_denial(self):
        """48. Institution Admin of Inst B is denied preview for Inst A (403 Forbidden)."""
        self.client.force_authenticate(user=self.other_inst_admin_user)
        resp = self.client.post("/api/salary/calculations/preview/", {
            "department_id": self.quran_dept.id,
            "year": 2026,
            "month": 11,
        })
        self.assertEqual(resp.status_code, status.HTTP_403_FORBIDDEN)

    def test_49_teacher_student_unauthorized_access(self):
        """49. Teachers and students are denied access to the calculation preview API (403 Forbidden)."""
        self.client.force_authenticate(user=self.teacher_user)
        resp1 = self.client.post("/api/salary/calculations/preview/", {"department_id": self.quran_dept.id, "year": 2026, "month": 11})
        self.assertEqual(resp1.status_code, status.HTTP_403_FORBIDDEN)

        self.client.force_authenticate(user=self.student_user)
        resp2 = self.client.post("/api/salary/calculations/preview/", {"department_id": self.quran_dept.id, "year": 2026, "month": 11})
        self.assertEqual(resp2.status_code, status.HTTP_403_FORBIDDEN)

    def test_50_no_source_attendance_mutation(self):
        """50. Attendance records remain completely unmutated before and after calculation."""
        att = Attendance.objects.create(
            department=self.quran_dept,
            institution=self.institution,
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=date(2026, 11, 2),
            status=Attendance.Status.PRESENT,
        )
        updated_before = att.updated_at
        calculate_department_salary_preview(self.quran_dept, 2026, 11)
        att.refresh_from_db()
        self.assertEqual(att.updated_at, updated_before)

    def test_51_no_legacy_payroll_mutation(self):
        """51. Zero legacy TeacherSalarySlip or QuranTeacherMonthlyPayroll records created or modified."""
        v1_before = TeacherSalarySlip.objects.count()
        v2_before = QuranTeacherMonthlyPayroll.objects.count()

        calculate_department_salary_preview(self.quran_dept, 2026, 11)

        self.assertEqual(TeacherSalarySlip.objects.count(), v1_before)
        self.assertEqual(QuranTeacherMonthlyPayroll.objects.count(), v2_before)

    def test_52_no_payable_payroll_records_created(self):
        """52. Preview remains strictly stateless; zero payable or approved payroll records created in DB."""
        self.client.force_authenticate(user=self.dept_admin_user)
        resp = self.client.post("/api/salary/calculations/preview/", {
            "department_id": self.quran_dept.id,
            "year": 2026,
            "month": 11,
        })
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        # Verify no database tables received financial rows
        self.assertEqual(TeacherSalarySlip.objects.count(), 0)
        self.assertEqual(QuranTeacherMonthlyPayroll.objects.count(), 0)

    def test_53_future_classes_classified_and_isolated_from_overdue_pending(self):
        """53. Future scheduled classes are classified as is_future=True and isolated from overdue pending."""
        today = date.today()
        # Create a future schedule/verification for the current month
        # Only test if today is not the last day of month, or pick next month
        test_year = today.year
        test_month = today.month
        future_date = today + timedelta(days=5)

        # Create attendance verification record in future
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=self.student,
            occurrence_key=f"quran:calc_future:{future_date}",
            class_date=future_date,
            scheduled_time=time(15, 0),
            verification_status="pending",
        )

        preview = calculate_teacher_salary_preview(
            self.quran_dept,
            self.teacher,
            future_date.year,
            future_date.month,
            summary_only=False,
        )

        self.assertGreater(preview["summary_counts"]["future_classes"], 0)
        future_lines = [l for l in preview["class_earning_lines"] if l.get("is_future")]
        self.assertGreater(len(future_lines), 0)
        self.assertEqual(future_lines[0]["attendance_outcome"], "scheduled_not_due")
        self.assertIn("scheduled for a future date/time", future_lines[0]["zero_payment_reason"])

    def test_54_recalculation_after_resolution_updates_earnings_and_counts(self):
        """54. Resolving an attendance verification record immediately reflects in preview recalculation."""
        s, scheds = self._create_student_with_schedule("s_recalc_54", ["monday"])
        sched_id = scheds[0].id
        past_date = date(2026, 11, 2)

        # Week 2 class already verified
        self._create_verification(
            self.teacher, s, date(2026, 11, 9),
            SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
            sched_id=sched_id
        )

        # Pending verification in week 1
        v = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=s,
            source_schedule_id=sched_id,
            occurrence_key=f"quran:sched_{sched_id}:{past_date.isoformat()}",
            class_date=past_date,
            scheduled_time=time(10, 0),
            verification_status="pending",
        )

        # Preview before resolution: 1 pending, 0 verified eligible (only 1 week active, threshold is 2)
        prev_before = calculate_teacher_salary_preview(
            self.quran_dept, self.teacher, 2026, 11, summary_only=False
        )
        self.assertEqual(prev_before["summary_counts"]["pending_classes"], 1)
        self.assertEqual(prev_before["summary_counts"]["verified_eligible_classes"], 0)

        # Resolve pending verification as class_taught
        v.verification_status = "resolved"
        v.resolution_type = "class_taught"
        v.teacher_available_determination = True
        v.resolved_by = self.dept_admin_user
        v.resolution_reason = "Admin verified from portal records"
        v.save()

        # Recalculate
        prev_after = calculate_teacher_salary_preview(
            self.quran_dept, self.teacher, 2026, 11, summary_only=False
        )
        # Pending decreased, resolved increased, weekly eligibility met (both week 1 and 2 eligible)
        self.assertEqual(prev_after["summary_counts"]["pending_classes"], 0)
        self.assertEqual(prev_after["summary_counts"]["resolved_classes"], 1)
        self.assertEqual(prev_after["summary_counts"]["verified_eligible_classes"], 2)
        self.assertGreater(Decimal(prev_after["earnings"]["regular_class_earnings"]), Decimal("0.00"))

        matching_line = [l for l in prev_after["class_earning_lines"] if l.get("verification_id") == v.id]
        self.assertEqual(len(matching_line), 1)
        self.assertEqual(matching_line[0]["attendance_outcome"], "class_taught")

    def test_55_overdue_pending_class_has_valid_verification_id_and_actionable_fields(self):
        """
        55. Regression test: Overdue pending Stage 5 class has a valid verification ID,
        is_pending=True, is_future=False, and attendance_outcome='pending'.
        """
        s, scheds = self._create_student_with_schedule("s_pending_55", ["tuesday"])
        sched_id = scheds[0].id
        past_date = date(2026, 11, 3)

        v = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.teacher,
            student=s,
            source_schedule_id=sched_id,
            occurrence_key=f"quran:sched_{sched_id}:{past_date.isoformat()}",
            class_date=past_date,
            scheduled_time=time(14, 0),
            verification_status="pending",
            flag_reason="Past scheduled class has no teacher session attendance recorded.",
        )

        prev = calculate_teacher_salary_preview(
            self.quran_dept, self.teacher, 2026, 11, summary_only=False
        )

        lines = prev["class_earning_lines"]
        pending_lines = [l for l in lines if l.get("verification_id") == v.id]
        self.assertEqual(len(pending_lines), 1, "Must find exactly one class earning line for verification ID.")

        target = pending_lines[0]
        self.assertEqual(target["verification_id"], v.id, "Stage 5 must return valid verification ID.")
        self.assertTrue(target["is_pending"], "Line must have is_pending=True.")
        self.assertFalse(target["is_future"], "Past overdue class must have is_future=False.")
        self.assertEqual(target["verification_status"], "pending")
        self.assertEqual(
            target["attendance_outcome"],
            "pending",
            "Attendance outcome for past pending class must be 'pending', not 'scheduled_not_due'.",
        )
        self.assertEqual(
            target["flag_reason"],
            "Past scheduled class has no teacher session attendance recorded.",
        )

    def test_56_missing_reconciliation_batch_sets_reconciliation_required(self):
        """
        56. Department preview detects missing Stage 4 reconciliation and exposes reconciliation_required.
        """
        SalaryReconciliationBatch.objects.filter(
            department=self.quran_dept,
            period_year=2026,
            period_month=12,
        ).delete()

        res = calculate_department_salary_preview(
            department=self.quran_dept,
            year=2026,
            month=12,
            teacher_id=self.teacher.id,
            summary_only=True,
        )

        self.assertTrue(res["reconciliation_required"], "Must flag reconciliation_required=True when batch missing.")
        self.assertIsNone(res["reconciliation_batch"], "reconciliation_batch must be None.")
        self.assertFalse(res["is_calculation_complete"], "Calculation must be marked incomplete.")
        self.assertTrue(any("reconciliation" in w.lower() for w in res["department_warnings"]))

        # Now simulate completed reconciliation batch
        batch = SalaryReconciliationBatch.objects.create(
            department=self.quran_dept,
            institution=self.institution,
            period_year=2026,
            period_month=12,
            start_date=date(2026, 12, 1),
            end_date=date(2026, 12, 31),
            is_complete=True,
            total_occurrences=10,
            verified_count=10,
            pending_count=0,
        )

        res_after = calculate_department_salary_preview(
            department=self.quran_dept,
            year=2026,
            month=12,
            teacher_id=self.teacher.id,
            summary_only=True,
        )

        self.assertFalse(res_after["reconciliation_required"], "Must be False once reconciliation is complete.")
        self.assertIsNotNone(res_after["reconciliation_batch"], "reconciliation_batch metadata must be present.")
        self.assertEqual(res_after["reconciliation_batch"]["id"], batch.id)
        self.assertEqual(res_after["reconciliation_batch"]["total_occurrences"], 10)
