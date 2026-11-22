"""Comprehensive Regression Tests for Teacher Special Case (Coordinator Special Package Assignment)."""
from datetime import date, time, timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from academy.models import (
    Attendance,
    ClassSchedule,
    StudentProfile,
    TeacherProfile,
)
from accounts.models import Department, Institution, User, UserDepartmentRole
from salary.calculation_engine import build_calculation_prefetch_context, calculate_teacher_salary_preview
from salary.models import (
    SalaryAttendanceVerification,
    SalaryPayrollPeriod,
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    TeacherPolicyAssignment,
)
from salary.resolver import resolve_teacher_class_rate


class TeacherSpecialCaseTests(APITestCase):
    def setUp(self):
        self.institution = Institution.objects.create(name="IVS Campus", slug="ivs-campus")
        self.quran_dept = Department.objects.create(
            institution=self.institution, name="Quran Department", code="QURAN", department_type="quran"
        )
        self.tuition_dept = Department.objects.create(
            institution=self.institution, name="Tuition Department", code="TUITION", department_type="tuition"
        )

        self.dept_admin = User.objects.create_user(
            username="admin_quran",
            password="password123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.quran_dept,
        )
        self.tuition_admin = User.objects.create_user(
            username="admin_tuition",
            password="password123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.tuition_dept,
        )
        self.coordinator_user = User.objects.create_user(
            username="coord_quran",
            password="password123",
            role=User.Role.COORDINATOR,
            institution=self.institution,
            department=self.quran_dept,
        )

        # Normal Teacher B and C (must remain unaffected by Teacher A)
        self.teacher_b_user = User.objects.create_user(
            username="teacher_b",
            first_name="Teacher B",
            password="password123",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.quran_dept,
        )
        self.teacher_b = TeacherProfile.objects.create(
            user=self.teacher_b_user,
            institution=self.institution,
            department=self.quran_dept,
            joining_date=date(2026, 1, 1),
        )

        # Published Quran policy with 5_days and coordinator_special plans
        self.policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="QURAN_STD",
            name="Quran Standard Policy",
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
            is_active=True,
        )
        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
            coordinator_qualifying_weekdays=["friday", "saturday", "sunday", "monday"],
        )
        self.plan_5 = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_code="5_days",
            plan_name="5 days/week",
            days_per_week=5,
            is_coordinator_special=False,
            sort_order=1,
        )
        self.plan_coord_special = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_code="coordinator_special",
            plan_name="Coordinator special",
            days_per_week=None,
            is_coordinator_special=True,
            sort_order=5,
        )
        self.tier_1_15 = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="1-15 students",
            min_students=1,
            max_students=15,
            sort_order=1,
        )
        SalaryPlanTierRate.objects.create(
            policy_version=self.version,
            teaching_plan=self.plan_5,
            rate_tier=self.tier_1_15,
            rate_per_class=Decimal("100.00"),
        )
        SalaryPlanTierRate.objects.create(
            policy_version=self.version,
            teaching_plan=self.plan_coord_special,
            rate_tier=self.tier_1_15,
            rate_per_class=Decimal("200.00"),
        )
        self.version.status = SalaryPolicyVersion.Status.PUBLISHED
        self.version.published_at = timezone.now()
        self.version.published_by = self.dept_admin
        self.version.save()

        # Assign normal policy to Teacher B
        self.assign_b = TeacherPolicyAssignment.objects.create(
            department=self.quran_dept,
            teacher=self.teacher_b,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
            is_active=True,
            is_special_case=False,
            assigned_by=self.dept_admin,
        )

    def _create_teacher_via_api(self, username, special_case=False, effective_from=None):
        self.client.force_authenticate(user=self.dept_admin)
        payload = {
            "role": "teacher",
            "username": username,
            "password": "password123",
            "first_name": username,
            "joining_date": "2026-01-01",
            "special_case": special_case,
        }
        if effective_from:
            payload["special_case_effective_from"] = effective_from
        return self.client.post("/api/auth/accounts/", payload, format="json")

    def test_1_normal_teacher_creation(self):
        res = self._create_teacher_via_api("normal_t1", special_case=False)
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertEqual(res.data["role"], "teacher")
        self.assertFalse(res.data["teacher_profile"]["special_case"])
        teacher_id = res.data["teacher_profile"]["id"]
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher_id=teacher_id, is_special_case=True).count(), 0)

    def test_2_and_3_and_4_special_teacher_creation_role_preservation_and_isolation(self):
        res = self._create_teacher_via_api("special_t1", special_case=True, effective_from="2026-10-01")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED, res.data)
        self.assertEqual(res.data["role"], "teacher")
        self.assertTrue(res.data["teacher_profile"]["special_case"])

        user_obj = User.objects.get(username="special_t1")
        self.assertEqual(user_obj.role, User.Role.TEACHER)
        self.assertFalse(user_obj.is_superuser)
        self.assertFalse(
            UserDepartmentRole.objects.filter(user=user_obj, role=UserDepartmentRole.Role.COORDINATOR).exists()
        )

        # Teacher can still be assigned a student & schedule
        student_res = self.client.post(
            "/api/auth/accounts/",
            {
                "role": "student",
                "username": "student_for_special",
                "password": "password123",
                "first_name": "Student Special",
                "teacher_id": res.data["teacher_profile"]["id"],
                "time_slot": "10:00",
                "class_days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
            },
            format="json",
        )
        self.assertEqual(student_res.status_code, status.HTTP_201_CREATED, student_res.data)

        # Teacher B remains unaffected
        self.assign_b.refresh_from_db()
        self.assertFalse(self.assign_b.is_special_case)

    def test_5_persist_after_refresh(self):
        res = self._create_teacher_via_api("persist_t1", special_case=True, effective_from="2026-10-01")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        teacher_profile_id = res.data["teacher_profile"]["id"]

        list_res = self.client.get("/api/auth/accounts/")
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        found = next((t for t in list_res.data["teachers"] if t["username"] == "persist_t1"), None)
        self.assertIsNotNone(found)
        self.assertTrue(found["teacher_profile"]["special_case"])

        ctx_res = self.client.get(f"/api/salary/special-case-context/?teacher_id={teacher_profile_id}")
        self.assertEqual(ctx_res.status_code, status.HTTP_200_OK)
        self.assertTrue(ctx_res.data["current_special_case"])

    def test_6_and_7_salary_preview_and_calculation_engine(self):
        res = self._create_teacher_via_api("calc_t1", special_case=True, effective_from="2026-10-01")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        teacher_a = TeacherProfile.objects.get(pk=res.data["teacher_profile"]["id"])

        # Create student & schedule for Teacher A
        st_user = User.objects.create_user(
            username="st_calc",
            password="password123",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.quran_dept,
        )
        student = StudentProfile.objects.create(
            user=st_user,
            institution=self.institution,
            department=self.quran_dept,
            teacher=teacher_a,
        )
        for wd in ["monday", "tuesday", "wednesday", "thursday", "friday"]:
            ClassSchedule.objects.create(
                institution=self.institution,
                department=self.quran_dept,
                student=student,
                teacher=teacher_a,
                weekday=wd,
                time_slot=time(10, 0),
                effective_from=date(2026, 10, 1),
                is_active=True,
            )

        # Rate preview: Friday (2026-10-02) is qualifying -> 200.00; Tuesday (2026-10-06) is normal -> 100.00
        fri_rate = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=teacher_a.id,
            class_date=date(2026, 10, 2),
            teaching_plan_code="5_days",
            student_id=student.id,
            student_count=1,
        )
        self.assertTrue(fri_rate.is_resolved)
        self.assertEqual(fri_rate.winning_rate, Decimal("200.00"))
        self.assertEqual(fri_rate.precedence_level, 4)

        tue_rate = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=teacher_a.id,
            class_date=date(2026, 10, 6),
            teaching_plan_code="5_days",
            student_id=student.id,
            student_count=1,
        )
        self.assertTrue(tue_rate.is_resolved)
        self.assertEqual(tue_rate.winning_rate, Decimal("100.00"))
        self.assertEqual(tue_rate.precedence_level, 5)

        # Verify Teacher B on the same Friday gets normal 100.00
        b_fri_rate = resolve_teacher_class_rate(
            department_id=self.quran_dept.id,
            teacher_id=self.teacher_b.id,
            class_date=date(2026, 10, 2),
            teaching_plan_code="5_days",
            student_count=1,
        )
        self.assertEqual(b_fri_rate.winning_rate, Decimal("100.00"))

        # Attendance verifications for 2026-10-02 (Friday) and 2026-10-06 (Tuesday)
        for d in [date(2026, 10, 2), date(2026, 10, 6)]:
            att = Attendance.objects.create(
                institution=self.institution,
                department=self.quran_dept,
                entity_type=Attendance.EntityType.STUDENT,
                student=student,
                teacher=teacher_a,
                date=d,
                status=Attendance.Status.PRESENT,
            )
            SalaryAttendanceVerification.objects.create(
                institution=self.institution,
                department=self.quran_dept,
                teacher=teacher_a,
                student=student,
                class_date=d,
                source_attendance_id=att.id,
                verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
                resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
                occurrence_key=f"occ-{teacher_a.id}-{student.id}-{d.isoformat()}",
            )

        prefetch = build_calculation_prefetch_context(self.quran_dept, [teacher_a], 2026, 10)
        preview = calculate_teacher_salary_preview(self.quran_dept, teacher_a, 2026, 10, prefetch_context=prefetch)
        # 200.00 (Fri) + 100.00 (Tue) = 300.00; no duplicate coordinator_allowance
        self.assertEqual(Decimal(preview["earnings"]["regular_class_earnings"]), Decimal("300.00"))
        self.assertEqual(Decimal(preview["earnings"]["positive_adjustments"]), Decimal("0.00"))

    def test_8_and_9_and_11_edit_enable_disable_and_duplicate_prevention(self):
        self.client.force_authenticate(user=self.dept_admin)
        # Enable Special Case on Teacher B effective 2026-10-15
        res = self.client.patch(
            f"/api/auth/accounts/{self.teacher_b_user.id}/",
            {
                "special_case": True,
                "special_case_effective_from": "2026-10-15",
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_200_OK, res.data)
        self.assertTrue(res.data["teacher_profile"]["special_case"])

        # Historical assignment preserved through 2026-10-14
        self.assign_b.refresh_from_db()
        self.assertEqual(self.assign_b.effective_to, date(2026, 10, 14))
        self.assertFalse(self.assign_b.is_special_case)

        # Repeated save with special_case=True must not create duplicates
        res_dup = self.client.patch(
            f"/api/auth/accounts/{self.teacher_b_user.id}/",
            {
                "special_case": True,
                "special_case_effective_from": "2026-10-15",
            },
            format="json",
        )
        self.assertEqual(res_dup.status_code, status.HTTP_200_OK)
        self.assertEqual(
            TeacherPolicyAssignment.objects.filter(teacher=self.teacher_b, is_special_case=True).count(),
            1,
        )

        # Disable Special Case effective 2026-10-20 -> restores normal policy
        res_off = self.client.patch(
            f"/api/auth/accounts/{self.teacher_b_user.id}/",
            {
                "special_case": False,
                "special_case_effective_from": "2026-10-20",
            },
            format="json",
        )
        self.assertEqual(res_off.status_code, status.HTTP_200_OK, res_off.data)
        self.assertFalse(res_off.data["teacher_profile"]["special_case"])
        # Total 3 historical/current assignments for Teacher B:
        # 1) normal 2026-01-01..2026-10-14, 2) special 2026-10-15..2026-10-19, 3) normal 2026-10-20..None
        self.assertEqual(TeacherPolicyAssignment.objects.filter(teacher=self.teacher_b).count(), 3)

    def test_10_locked_payroll_protection(self):
        SalaryPayrollPeriod.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            payroll_year=2026,
            payroll_month=9,
            status=SalaryPayrollPeriod.Status.APPROVED,
            created_by=self.dept_admin,
        )
        SalaryPayrollPeriod.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            payroll_year=2026,
            payroll_month=8,
            status=SalaryPayrollPeriod.Status.PAID,
            created_by=self.dept_admin,
        )
        self.client.force_authenticate(user=self.dept_admin)
        for eff_date in ["2026-09-15", "2026-08-15"]:
            res = self.client.patch(
                f"/api/auth/accounts/{self.teacher_b_user.id}/",
                {
                    "special_case": True,
                    "special_case_effective_from": eff_date,
                },
                format="json",
            )
            self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(
            TeacherPolicyAssignment.objects.filter(teacher=self.teacher_b, is_special_case=True).exists()
        )

    def test_12_permissions_enforced(self):
        # Teacher cannot grant themselves Special Case
        self.client.force_authenticate(user=self.teacher_b_user)
        res_t = self.client.patch(
            f"/api/auth/accounts/{self.teacher_b_user.id}/",
            {"special_case": True},
            format="json",
        )
        self.assertEqual(res_t.status_code, status.HTTP_403_FORBIDDEN)

        # Coordinator cannot change Special Case without salary-admin permission
        self.client.force_authenticate(user=self.coordinator_user)
        res_c = self.client.patch(
            f"/api/auth/accounts/{self.teacher_b_user.id}/",
            {"special_case": True},
            format="json",
        )
        self.assertEqual(res_c.status_code, status.HTTP_403_FORBIDDEN)

        res_ctx = self.client.get("/api/salary/special-case-context/")
        self.assertEqual(res_ctx.status_code, status.HTTP_403_FORBIDDEN)

    def test_13_department_isolation_and_unconfigured_package(self):
        # Tuition department has no Coordinator Special package configured -> clear validation error
        self.client.force_authenticate(user=self.tuition_admin)
        res = self.client.post(
            "/api/auth/accounts/",
            {
                "role": "teacher",
                "username": "tuition_special",
                "password": "password123",
                "first_name": "Tuition Teacher",
                "special_case": True,
            },
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("special_case", res.data)

        # Tuition admin cannot query Quran teacher's Special Case context
        res_cross = self.client.get(f"/api/salary/special-case-context/?teacher_id={self.teacher_b.id}")
        self.assertEqual(res_cross.status_code, status.HTTP_403_FORBIDDEN)

    def test_14_friday_saturday_only_early_morning_pkt_and_preview_consistency(self):
        """
        Verifies:
        - Published policy with Friday and Saturday only (`['friday', 'saturday']`).
        - 2_days plan (1–15 students: Rs 175.00; 16–19 students: Rs 200.00) vs coordinator_special (1–15: Rs 200.00; 16–19: Rs 225.00).
        - Two identically named students ('MD.Masud Rana', ivq1007 @ 01:00 AM and ivq1008 @ 01:30 AM) on Sunday & Monday.
        - Special Case teacher gets Rs 200.00 on Friday/Saturday and Rs 175.00 on Sunday–Thursday (including Sunday 1:00 AM & Monday 1:30 AM Asia/Karachi).
        - Genuine teaching coordinator follows the same qualifying-day rules.
        - Normal teacher gets Rs 175.00 on all days (Friday–Thursday).
        - Rate Preview API, Monthly Salary Preview API, and draft payroll generation agree.
        """
        pol_fs = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            code="IVS_Q_FS",
            name="ivs q",
            policy_type=SalaryPolicy.PolicyType.STANDARD,
            compensation_model=SalaryPolicy.CompensationModel.PER_CLASS,
            is_active=True,
        )
        ver_fs = SalaryPolicyVersion.objects.create(
            policy=pol_fs,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 11, 1),
            effective_to=date(2027, 12, 31),
            coordinator_qualifying_weekdays=["friday", "saturday"],
        )
        p2 = SalaryTeachingPlan.objects.create(
            policy_version=ver_fs, plan_code="2_days", plan_name="2 days/week", days_per_week=2, is_coordinator_special=False, sort_order=4
        )
        pcs = SalaryTeachingPlan.objects.create(
            policy_version=ver_fs, plan_code="coordinator_special", plan_name="Coordinator special", days_per_week=None, is_coordinator_special=True, sort_order=5
        )
        t_1_15 = SalaryRateTier.objects.create(
            policy_version=ver_fs, tier_name="1–15 students", min_students=1, max_students=15, sort_order=1
        )
        t_16_19 = SalaryRateTier.objects.create(
            policy_version=ver_fs, tier_name="16–19 students", min_students=16, max_students=19, sort_order=2
        )
        SalaryPlanTierRate.objects.create(policy_version=ver_fs, teaching_plan=p2, rate_tier=t_1_15, rate_per_class=Decimal("175.00"))
        SalaryPlanTierRate.objects.create(policy_version=ver_fs, teaching_plan=p2, rate_tier=t_16_19, rate_per_class=Decimal("200.00"))
        SalaryPlanTierRate.objects.create(policy_version=ver_fs, teaching_plan=pcs, rate_tier=t_1_15, rate_per_class=Decimal("200.00"))
        SalaryPlanTierRate.objects.create(policy_version=ver_fs, teaching_plan=pcs, rate_tier=t_16_19, rate_per_class=Decimal("225.00"))
        ver_fs.status = SalaryPolicyVersion.Status.PUBLISHED
        ver_fs.published_at = timezone.now()
        ver_fs.published_by = self.dept_admin
        ver_fs.save()

        # Special Case Teacher Zia
        zia_user = User.objects.create_user(
            username="ivs_zia_test", first_name="01 Zia", password="password123",
            role=User.Role.TEACHER, institution=self.institution, department=self.quran_dept,
        )
        zia = TeacherProfile.objects.create(
            user=zia_user, institution=self.institution, department=self.quran_dept, joining_date=date(2026, 1, 1)
        )
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept, teacher=zia, policy=pol_fs,
            effective_from=date(2026, 11, 1), effective_to=date(2027, 12, 31),
            is_active=True, is_special_case=True, assigned_by=self.dept_admin,
        )

        # Genuine Teaching Coordinator
        coord_tp = TeacherProfile.objects.create(
            user=self.coordinator_user, institution=self.institution, department=self.quran_dept, joining_date=date(2026, 1, 1)
        )
        TeacherPolicyAssignment.objects.create(
            department=self.quran_dept, teacher=coord_tp, policy=pol_fs,
            effective_from=date(2026, 11, 1), effective_to=date(2027, 12, 31),
            is_active=True, is_special_case=False, assigned_by=self.dept_admin,
        )

        # Two identically named students: MD.Masud Rana (ivq1007 @ 01:00 AM, ivq1008 @ 01:30 AM) on Sunday & Monday
        s1_user = User.objects.create_user(username="ivq1007_t", first_name="MD.Masud Rana", password="password123", role=User.Role.STUDENT, institution=self.institution, department=self.quran_dept)
        s1 = StudentProfile.objects.create(user=s1_user, institution=self.institution, department=self.quran_dept, teacher=zia)
        s2_user = User.objects.create_user(username="ivq1008_t", first_name="MD.Masud Rana", password="password123", role=User.Role.STUDENT, institution=self.institution, department=self.quran_dept)
        s2 = StudentProfile.objects.create(user=s2_user, institution=self.institution, department=self.quran_dept, teacher=zia)

        for st, tm in [(s1, time(1, 0)), (s2, time(1, 30))]:
            for wd in ["sunday", "monday"]:
                ClassSchedule.objects.create(
                    institution=self.institution, department=self.quran_dept,
                    student=st, teacher=zia, weekday=wd, time_slot=tm, is_active=True,
                )

        # Verify all 7 weekdays for Special Case teacher (8 students -> 1–15 tier):
        # Fri (2026-11-06) & Sat (2026-11-07) -> 200.00 (Level 4)
        # Sun (2026-11-01), Mon (2026-11-02), Tue (2026-11-03), Wed (2026-11-04), Thu (2026-11-05) -> 175.00 (Level 5)
        expected_by_date = [
            (date(2026, 11, 1), Decimal("175.00"), 5),  # Sunday
            (date(2026, 11, 2), Decimal("175.00"), 5),  # Monday
            (date(2026, 11, 3), Decimal("175.00"), 5),  # Tuesday
            (date(2026, 11, 4), Decimal("175.00"), 5),  # Wednesday
            (date(2026, 11, 5), Decimal("175.00"), 5),  # Thursday
            (date(2026, 11, 6), Decimal("200.00"), 4),  # Friday
            (date(2026, 11, 7), Decimal("200.00"), 4),  # Saturday
        ]
        for d, exp_rate, exp_level in expected_by_date:
            res_zia = resolve_teacher_class_rate(
                department_id=self.quran_dept.id, teacher_id=zia.id, class_date=d,
                teaching_plan_code="2_days", student_id=s1.id, student_count=8,
            )
            self.assertEqual(res_zia.winning_rate, exp_rate, f"Failed on {d} ({d.strftime('%A')})")
            self.assertEqual(res_zia.precedence_level, exp_level)

            # Genuine coordinator matches Special Case weekday behavior
            res_coord = resolve_teacher_class_rate(
                department_id=self.quran_dept.id, teacher_id=coord_tp.id, class_date=d,
                teaching_plan_code="2_days", student_count=8,
            )
            self.assertEqual(res_coord.winning_rate, exp_rate)

        # Tier 16–19 students: normal 2_days is 200.00 (Sun/Mon), coordinator_special is 225.00 (Fri/Sat)
        self.assertEqual(
            resolve_teacher_class_rate(self.quran_dept.id, zia.id, date(2026, 11, 1), teaching_plan_code="2_days", student_count=17).winning_rate,
            Decimal("200.00"),
        )
        self.assertEqual(
            resolve_teacher_class_rate(self.quran_dept.id, zia.id, date(2026, 11, 6), teaching_plan_code="2_days", student_count=17).winning_rate,
            Decimal("225.00"),
        )

        # Verified Sunday 01:00 AM, Sunday 01:30 AM, Monday 01:00 AM, Monday 01:30 AM classes in Nov 2026
        for st, tm in [(s1, time(1, 0)), (s2, time(1, 30))]:
            for d in [date(2026, 11, 1), date(2026, 11, 2), date(2026, 11, 8), date(2026, 11, 9)]:
                att = Attendance.objects.create(
                    institution=self.institution, department=self.quran_dept,
                    entity_type=Attendance.EntityType.STUDENT, student=st, teacher=zia,
                    date=d, status=Attendance.Status.PRESENT,
                )
                SalaryAttendanceVerification.objects.create(
                    institution=self.institution, department=self.quran_dept,
                    teacher=zia, student=st, class_date=d, scheduled_time=tm,
                    source_attendance_id=att.id,
                    verification_status=SalaryAttendanceVerification.VerificationStatus.VERIFIED,
                    resolution_type=SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
                    occurrence_key=f"quran:zia-{st.id}:{d.isoformat()}",
                )

        # Monthly Salary Preview API agrees with resolver (all 8 Sunday/Monday occurrences at Rs 175.00 = Rs 1400.00)
        self.client.force_authenticate(user=self.dept_admin)
        api_prev = self.client.post(
            "/api/salary/calculations/preview/",
            {"department_id": self.quran_dept.id, "year": 2026, "month": 11, "teacher_id": zia.id, "summary_only": False},
            format="json",
        )
        self.assertEqual(api_prev.status_code, status.HTTP_200_OK)
        t_prev = api_prev.data["teacher_previews"][0]
        self.assertEqual(Decimal(t_prev["earnings"]["regular_class_earnings"]), Decimal("1400.00"))
        for line in t_prev["class_earning_lines"]:
            self.assertEqual(Decimal(line["applied_rate"]), Decimal("175.00"))
            self.assertEqual(line["precedence_level"], 5)

