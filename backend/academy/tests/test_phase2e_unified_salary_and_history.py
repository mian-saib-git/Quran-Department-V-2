from datetime import date, time
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Department, Institution, User
from academy.models import (
    Attendance,
    ClassSchedule,
    StudentClassHistory,
    StudentProfile,
    TeacherProfile,
)
from academy.schedule_consistency_audit import (
    apply_verification_cleanup,
    run_schedule_consistency_audit,
)
from salary.attendance_reconciler import AttendanceReconcilerService
from salary.calculation_engine import calculate_teacher_salary_preview
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


class Phase2EUnifiedSalaryAndHistoryTests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(
            name="Phase 2E Test Inst",
            slug="phase2e-test-inst",
        )
        self.department = Department.objects.create(
            institution=self.institution,
            name="Quran Phase 2E",
            code="quran-phase2e",
            department_type=Department.DepartmentType.QURAN,
        )
        self.manager = User.objects.create_user(
            username="p2e_manager",
            password="pw",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.department,
        )
        self.teacher_user = User.objects.create_user(
            username="p2e_teacher",
            first_name="01",
            last_name="Zia",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        self.teacher = TeacherProfile.objects.create(
            user=self.teacher_user,
            department=self.department,
        )
        self.prev_teacher_user = User.objects.create_user(
            username="p2e_prev_teacher",
            first_name="02",
            last_name="Prev",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        self.prev_teacher = TeacherProfile.objects.create(
            user=self.prev_teacher_user,
            department=self.department,
        )
        self.student_user = User.objects.create_user(
            username="p2e_student",
            first_name="Jannat",
            last_name="Firdous",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        self.student = StudentProfile.objects.create(
            user=self.student_user,
            department=self.department,
            teacher=self.teacher,
            class_status=StudentProfile.ClassStatus.RUNNING,
            student_type=StudentProfile.StudentType.OLD_STUDENT,
            first_fee_paid=True,
        )

        # Published Unified Salary Policy with 5_days = Rs 80, 2_days = Rs 175
        self.policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.department,
            code="quran-unified-2e",
            name="Quran Unified Policy 2E",
        )
        self.version = SalaryPolicyVersion.objects.create(
            policy=self.policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.DRAFT,
            effective_from=date(2026, 1, 1),
            min_qualifying_weeks=1,
            substitute_rate_per_class=Decimal("100.00"),
            lesson_plan_bonus_per_class=Decimal("0.00"),
        )
        self.tier = SalaryRateTier.objects.create(
            policy_version=self.version,
            tier_name="1-15 Students",
            min_students=1,
            max_students=15,
            sort_order=1,
        )
        self.plan_5 = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_code="5_days",
            plan_name="5 days/week",
            days_per_week=5,
            sort_order=1,
        )
        self.plan_2 = SalaryTeachingPlan.objects.create(
            policy_version=self.version,
            plan_code="2_days",
            plan_name="2 days/week",
            days_per_week=2,
            sort_order=2,
        )
        SalaryPlanTierRate.objects.create(
            policy_version=self.version,
            teaching_plan=self.plan_5,
            rate_tier=self.tier,
            rate_per_class=Decimal("80.00"),
        )
        SalaryPlanTierRate.objects.create(
            policy_version=self.version,
            teaching_plan=self.plan_2,
            rate_tier=self.tier,
            rate_per_class=Decimal("175.00"),
        )
        self.version.status = SalaryPolicyVersion.Status.PUBLISHED
        self.version.save(update_fields=["status"])
        TeacherPolicyAssignment.objects.create(
            department=self.department,
            teacher=self.teacher,
            policy=self.policy,
            effective_from=date(2026, 1, 1),
        )

        # Initial 5-day schedule (Mon-Fri) effective from Nov 1, 2026
        for day in ["monday", "tuesday", "wednesday", "thursday", "friday"]:
            ClassSchedule.objects.create(
                student=self.student,
                teacher=self.teacher,
                weekday=day,
                time_slot=time(21, 30),
                duration_minutes=30,
                effective_from=date(2026, 11, 1),
                is_active=True,
            )

        # Two verified classes earlier in Nov 2026 (Mon Nov 2, Tue Nov 3)
        for d in (date(2026, 11, 2), date(2026, 11, 3)):
            Attendance.objects.create(
                entity_type=Attendance.EntityType.STUDENT,
                student=self.student,
                teacher=self.teacher,
                date=d,
                class_key="21:30",
                status=Attendance.Status.PRESENT,
                marked_by=self.teacher_user,
            )
            Attendance.objects.create(
                entity_type=Attendance.EntityType.TEACHER,
                teacher=self.teacher,
                date=d,
                class_key="21:30",
                status=Attendance.Status.PRESENT,
                marked_by=self.teacher_user,
            )

        AttendanceReconcilerService.reconcile_period(
            department=self.department,
            year=2026,
            month=11,
            user=self.manager,
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.manager)

    def test_option_a_preserves_5day_rate_and_option_b_reprices_to_2day_rate(self):
        # Verify initial preview: 2 verified classes @ Rs 80 = 160.00
        initial_prev = calculate_teacher_salary_preview(self.department, self.teacher, 2026, 11)
        self.assertEqual(
            Decimal(initial_prev["earnings"]["draft_net_salary"]),
            Decimal("160.00"),
            msg=f"verifs={SalaryAttendanceVerification.objects.count()}, summary={initial_prev.get('summary_counts')}, lines={initial_prev.get('class_earning_lines', [])[:2]}",
        )

        # Preview change 5 days -> 2 days (Sat/Sun) effective Nov 22
        preview_res = self.client.post(
            "/api/academy/schedule-change-preview/",
            {
                "student_id": self.student.id,
                "class_days": ["saturday", "sunday"],
                "effective_date": "2026-11-22",
            },
            format="json",
        )
        self.assertEqual(preview_res.status_code, 200)
        self.assertEqual(preview_res.data["previous_frequency"], 5)
        self.assertEqual(preview_res.data["new_frequency"], 2)
        self.assertEqual(Decimal(preview_res.data["before_amount"]), Decimal("160.00"))
        self.assertEqual(
            Decimal(preview_res.data["after_amount"]),
            Decimal("350.00"),
            msg=f"preview={preview_res.data}",
        )
        self.assertEqual(Decimal(preview_res.data["monetary_difference"]), Decimal("190.00"))

        # Option A: Preserve earlier earnings (Nov 2, Nov 3 stay 5 days/week @ Rs 80)
        opt_a = self.client.post(
            "/api/academy/schedule-change-confirm/",
            {
                "student_id": self.student.id,
                "teacher_id": self.teacher.id,
                "time_slot": "21:30",
                "class_days": ["saturday", "sunday"],
                "effective_date": "2026-11-22",
                "salary_mode": "preserve",
            },
            format="json",
        )
        self.assertEqual(opt_a.status_code, 200)
        prev_after_a = calculate_teacher_salary_preview(self.department, self.teacher, 2026, 11)
        self.assertEqual(Decimal(prev_after_a["earnings"]["draft_net_salary"]), Decimal("160.00"))
        nov_2_line_a = [ln for ln in prev_after_a["class_earning_lines"] if ln["class_date"] == "2026-11-02"][0]
        self.assertEqual(nov_2_line_a["teaching_plan_code"], "5_days")
        self.assertEqual(Decimal(nov_2_line_a["applied_rate"]), Decimal("80.00"))
        # No duplicate Nov 22 verification rows
        self.assertEqual(
            SalaryAttendanceVerification.objects.filter(
                student=self.student, class_date=date(2026, 11, 22)
            ).count(),
            1,
        )

        # Option B: Recalculate current month -> reprices Nov 2, Nov 3 to 2 days/week @ Rs 175 = 350.00
        # while preserving historical Mon-Fri ClassSchedule rows!
        opt_b = self.client.post(
            "/api/academy/schedule-change-confirm/",
            {
                "student_id": self.student.id,
                "teacher_id": self.teacher.id,
                "time_slot": "21:30",
                "class_days": ["saturday", "sunday"],
                "effective_date": "2026-11-22",
                "salary_mode": "recalculate_current_month",
            },
            format="json",
        )
        self.assertEqual(opt_b.status_code, 200)
        prev_after_b = calculate_teacher_salary_preview(self.department, self.teacher, 2026, 11)
        self.assertEqual(Decimal(prev_after_b["earnings"]["draft_net_salary"]), Decimal("350.00"))
        nov_2_line_b = [ln for ln in prev_after_b["class_earning_lines"] if ln["class_date"] == "2026-11-02"][0]
        self.assertEqual(nov_2_line_b["teaching_plan_code"], "2_days")
        self.assertEqual(Decimal(nov_2_line_b["applied_rate"]), Decimal("175.00"))
        self.assertIn("Authorized schedule-change override", nov_2_line_b["rate_override_reason"])

        # Historical Mon-Fri ClassSchedule rows remain intact (effective_to = Nov 21)
        self.assertEqual(
            ClassSchedule.objects.filter(
                student=self.student, is_active=False, effective_to=date(2026, 11, 21)
            ).count(),
            5,
        )
        # Attendance rows remain intact
        self.assertEqual(
            Attendance.objects.filter(student=self.student, entity_type=Attendance.EntityType.STUDENT).count(),
            2,
        )

    def test_locked_unified_payroll_blocks_option_b(self):
        SalaryPayrollPeriod.objects.create(
            institution=self.institution,
            department=self.department,
            payroll_year=2026,
            payroll_month=11,
            status=SalaryPayrollPeriod.Status.APPROVED,
        )
        res = self.client.post(
            "/api/academy/schedule-change-confirm/",
            {
                "student_id": self.student.id,
                "teacher_id": self.teacher.id,
                "time_slot": "21:30",
                "class_days": ["saturday", "sunday"],
                "effective_date": "2026-11-22",
                "salary_mode": "recalculate_current_month",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 409, msg=f"periods={list(SalaryPayrollPeriod.objects.values('id', 'department_id', 'payroll_year', 'payroll_month', 'status'))}, res={res.data}")

    def test_audit_detects_stale_post_transfer_and_duplicate_verifications(self):
        # Simulate transfer on Nov 13 with a stale pending verification under old teacher on Nov 16
        StudentClassHistory.objects.create(
            student=self.student,
            event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
            previous_teacher=self.prev_teacher,
            new_teacher=self.teacher,
            effective_date=date(2026, 11, 13),
        )
        SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.department,
            source_department_type="quran",
            teacher=self.prev_teacher,
            student=self.student,
            occurrence_key="quran:stale_test:2026-11-16",
            class_date=date(2026, 11, 16),
            scheduled_time=time(21, 30),
            verification_status=SalaryAttendanceVerification.VerificationStatus.PENDING,
        )
        audit = run_schedule_consistency_audit(department=self.department)
        self.assertEqual(audit["counts"]["duplicate_verification_occurrences"], 1)
        self.assertEqual(audit["counts"]["stale_verification_wrong_teacher"], 1)

    def test_isolated_cleanup_simulation_and_reconciliation(self):
        from accounts.models import PlatformAuditLog

        # Create 1 duplicate pending row for Nov 23 (Monday) and 1 stale post-transfer pending row for Nov 16
        dup_v = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.department,
            source_department_type="quran",
            teacher=self.teacher,
            student=self.student,
            occurrence_key="quran:dup_sim:2026-11-23",
            class_date=date(2026, 11, 23),
            scheduled_time=time(21, 30),
            verification_status=SalaryAttendanceVerification.VerificationStatus.PENDING,
        )
        stale_v = SalaryAttendanceVerification.objects.create(
            institution=self.institution,
            department=self.department,
            source_department_type="quran",
            teacher=self.prev_teacher,
            student=self.student,
            occurrence_key="quran:stale_sim:2026-11-16",
            class_date=date(2026, 11, 16),
            scheduled_time=time(21, 30),
            verification_status=SalaryAttendanceVerification.VerificationStatus.PENDING,
        )

        # Before: Nov 2 and Nov 3 verified earnings = 160.00; 2 rows on Nov 23
        before_prev = calculate_teacher_salary_preview(self.department, self.teacher, 2026, 11)
        self.assertEqual(Decimal(before_prev["earnings"]["draft_net_salary"]), Decimal("160.00"))
        self.assertEqual(
            SalaryAttendanceVerification.objects.filter(
                student=self.student, class_date=date(2026, 11, 23)
            ).count(),
            2,
        )

        # Simulate guarded cleanup on the exact candidate IDs (plus one verified row that must be skipped)
        verified_nov2 = SalaryAttendanceVerification.objects.get(
            student=self.student, class_date=date(2026, 11, 2)
        )
        result = apply_verification_cleanup(
            approved_verification_ids=[dup_v.id, stale_v.id, verified_nov2.id],
            actor=self.manager,
            department=self.department,
        )
        self.assertEqual(set(result["deleted_ids"]), {dup_v.id, stale_v.id})
        self.assertEqual(len(result["skipped"]), 1)
        self.assertEqual(result["skipped"][0]["id"], verified_nov2.id)

        # Re-reconcile and verify zero duplicates and intact earnings (160.00)
        AttendanceReconcilerService.reconcile_period(
            department=self.department, year=2026, month=11, user=self.manager
        )
        self.assertEqual(
            SalaryAttendanceVerification.objects.filter(
                student=self.student, class_date=date(2026, 11, 23)
            ).count(),
            1,
        )
        after_prev = calculate_teacher_salary_preview(self.department, self.teacher, 2026, 11)
        self.assertEqual(Decimal(after_prev["earnings"]["draft_net_salary"]), Decimal("160.00"))
        self.assertTrue(
            PlatformAuditLog.objects.filter(
                category="schedule_consistency_audit", action="apply_verification_cleanup"
            ).exists()
        )
