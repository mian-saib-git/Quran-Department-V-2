from datetime import date, time, timedelta
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Department, Institution, PlatformAuditLog, User
from accounts.serializers import sync_student_schedules
from academy.models import (
    Attendance,
    ClassSchedule,
    StudentClassHistory,
    StudentProfile,
    TeacherProfile,
)
from academy.salary_v2_models import QuranSalaryPolicy, QuranTeacherMonthlyPayroll
from academy.schedule_consistency_audit import (
    apply_schedule_consistency_cleanup,
    run_schedule_consistency_audit,
)


class Phase2DScheduleSalaryConsistencyTests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(
            name="Phase 2D Test Inst",
            slug="phase2d-test-inst",
        )
        self.department = Department.objects.create(
            institution=self.institution,
            name="Quran Phase 2D",
            code="quran-phase2d",
            department_type=Department.DepartmentType.QURAN,
        )
        self.manager = User.objects.create_user(
            username="p2d_manager",
            password="pw",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.department,
        )
        self.teacher_user = User.objects.create_user(
            username="p2d_teacher",
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
        self.student_user = User.objects.create_user(
            username="ivq1030_test",
            first_name="Ayman",
            last_name="Noor",
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
        )
        self.policy = QuranSalaryPolicy.objects.create(
            department=self.department,
            effective_from=date(2026, 1, 1),
            rate_1_to_15=Decimal("200.00"),
            rate_16_to_19=Decimal("250.00"),
            rate_20_plus=Decimal("300.00"),
            created_by=self.manager,
        )

        # Initial 5-day schedule effective from start of month
        for day in ["monday", "tuesday", "wednesday", "thursday", "friday"]:
            ClassSchedule.objects.create(
                student=self.student,
                teacher=self.teacher,
                weekday=day,
                time_slot=time(17, 0),
                duration_minutes=30,
                effective_from=date(2026, 11, 1),
                is_active=True,
            )

        self.client = APIClient()
        self.client.force_authenticate(user=self.manager)

    def test_effective_dated_sync_preserves_history_and_is_idempotent(self):
        eff_date = date(2026, 11, 15)
        sync_student_schedules(
            student=self.student,
            teacher=self.teacher,
            time_slot=time(17, 0),
            class_days=["saturday", "sunday"],
            duration_minutes=30,
            effective_date=eff_date,
            preserve_history=True,
        )

        active = list(
            ClassSchedule.objects.filter(student=self.student, is_active=True).order_by("weekday")
        )
        inactive = list(
            ClassSchedule.objects.filter(student=self.student, is_active=False).order_by("weekday")
        )
        self.assertEqual([r.weekday for r in active], ["saturday", "sunday"])
        self.assertTrue(all(r.effective_from == eff_date for r in active))
        self.assertEqual(len(inactive), 5)
        self.assertTrue(all(r.effective_to == eff_date - timedelta(days=1) for r in inactive))

        # Idempotent second call with identical schedule
        sync_student_schedules(
            student=self.student,
            teacher=self.teacher,
            time_slot=time(17, 0),
            class_days=["saturday", "sunday"],
            duration_minutes=30,
            effective_date=eff_date + timedelta(days=1),
            preserve_history=True,
        )
        self.assertEqual(ClassSchedule.objects.filter(student=self.student, is_active=True).count(), 2)
        self.assertEqual(ClassSchedule.objects.filter(student=self.student, is_active=False).count(), 5)

        # Teacher Details API reflects 2 active schedules, not 5
        res = self.client.get(f"/api/academy/teachers/{self.teacher.id}/details/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["summary"]["active_schedules_count"], 2)

    def test_same_day_resync_avoids_duplicate_rows(self):
        eff_date = date(2026, 11, 15)
        sync_student_schedules(
            student=self.student,
            teacher=self.teacher,
            time_slot=time(17, 0),
            class_days=["saturday", "sunday"],
            effective_date=eff_date,
        )
        sync_student_schedules(
            student=self.student,
            teacher=self.teacher,
            time_slot=time(18, 0),
            class_days=["monday", "wednesday"],
            effective_date=eff_date,
        )
        active = ClassSchedule.objects.filter(student=self.student, is_active=True)
        self.assertEqual(active.count(), 2)
        self.assertEqual(set(active.values_list("weekday", flat=True)), {"monday", "wednesday"})

    def test_schedule_change_preview_and_preserve_vs_recalculate(self):
        # Create corroborated attendance on Monday Nov 2, 2026 (within 5-day schedule)
        Attendance.objects.create(
            entity_type=Attendance.EntityType.STUDENT,
            student=self.student,
            teacher=self.teacher,
            date=date(2026, 11, 2),
            class_key="17:00",
            status=Attendance.Status.PRESENT,
            marked_by=self.teacher_user,
        )
        Attendance.objects.create(
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=date(2026, 11, 2),
            class_key="17:00",
            status=Attendance.Status.PRESENT,
            marked_by=self.teacher_user,
        )

        preview_res = self.client.post(
            "/api/academy/schedule-change-preview/",
            {
                "student_id": self.student.id,
                "class_days": ["saturday", "sunday"],
                "effective_date": "2026-11-15",
            },
            format="json",
        )
        self.assertEqual(preview_res.status_code, 200)
        self.assertEqual(preview_res.data["previous_frequency"], 5)
        self.assertEqual(preview_res.data["new_frequency"], 2)
        self.assertTrue(preview_res.data["payroll_editable"])
        self.assertTrue(preview_res.data["recalculate_allowed"])

        # Option A: Preserve previously earned salary
        confirm_res = self.client.post(
            "/api/academy/schedule-change-confirm/",
            {
                "student_id": self.student.id,
                "teacher_id": self.teacher.id,
                "time_slot": "17:00",
                "class_days": ["saturday", "sunday"],
                "effective_date": "2026-11-15",
                "salary_mode": "preserve",
            },
            format="json",
        )
        self.assertEqual(confirm_res.status_code, 200)
        self.assertEqual(confirm_res.data["salary_mode"], "preserve")
        self.assertTrue(
            PlatformAuditLog.objects.filter(
                category="schedule_salary", action="schedule_change_confirmed"
            ).exists()
        )
        self.assertTrue(
            StudentClassHistory.objects.filter(student=self.student).exists()
        )

        # Option B: Recalculate current month
        recalc_res = self.client.post(
            "/api/academy/schedule-change-confirm/",
            {
                "student_id": self.student.id,
                "teacher_id": self.teacher.id,
                "time_slot": "17:00",
                "class_days": ["saturday", "sunday"],
                "effective_date": "2026-11-15",
                "salary_mode": "recalculate_current_month",
            },
            format="json",
        )
        self.assertEqual(recalc_res.status_code, 200)
        self.assertEqual(recalc_res.data["salary_mode"], "recalculate_current_month")
        active = list(ClassSchedule.objects.filter(student=self.student, is_active=True))
        self.assertEqual([r.effective_from for r in active], [date(2026, 11, 15), date(2026, 11, 15)])

    def test_locked_payroll_blocks_recalculate_but_allows_preserve(self):
        QuranTeacherMonthlyPayroll.objects.create(
            department=self.department,
            teacher=self.teacher,
            year=2026,
            month=11,
            status=QuranTeacherMonthlyPayroll.Status.APPROVED,
            final_total=Decimal("1000.00"),
        )

        preview_res = self.client.post(
            "/api/academy/schedule-change-preview/",
            {
                "student_id": self.student.id,
                "class_days": ["saturday", "sunday"],
                "effective_date": "2026-11-15",
            },
            format="json",
        )
        self.assertEqual(preview_res.status_code, 200)
        self.assertFalse(preview_res.data["payroll_editable"])
        self.assertFalse(preview_res.data["recalculate_allowed"])

        recalc_res = self.client.post(
            "/api/academy/schedule-change-confirm/",
            {
                "student_id": self.student.id,
                "teacher_id": self.teacher.id,
                "time_slot": "17:00",
                "class_days": ["saturday", "sunday"],
                "effective_date": "2026-11-15",
                "salary_mode": "recalculate_current_month",
            },
            format="json",
        )
        self.assertEqual(recalc_res.status_code, 409)

        preserve_res = self.client.post(
            "/api/academy/schedule-change-confirm/",
            {
                "student_id": self.student.id,
                "teacher_id": self.teacher.id,
                "time_slot": "17:00",
                "class_days": ["saturday", "sunday"],
                "effective_date": "2026-11-15",
                "salary_mode": "preserve",
            },
            format="json",
        )
        self.assertEqual(preserve_res.status_code, 200)

    def test_unauthorized_teacher_cannot_preview_or_confirm_schedule_change(self):
        teacher_client = APIClient()
        teacher_client.force_authenticate(user=self.teacher_user)
        res = teacher_client.post(
            "/api/academy/schedule-change-preview/",
            {"student_id": self.student.id, "class_days": ["saturday", "sunday"]},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_schedule_consistency_audit_and_guarded_cleanup(self):
        # Create duplicate active monday row
        ClassSchedule.objects.create(
            student=self.student,
            teacher=self.teacher,
            weekday="monday",
            time_slot=time(18, 0),
            duration_minutes=30,
            is_active=True,
        )
        audit = run_schedule_consistency_audit(department=self.department)
        self.assertEqual(audit["counts"]["duplicate_active_weekday"], 1)
        self.assertIn(self.student.id, audit["affected_student_ids"])

        cleanup = apply_schedule_consistency_cleanup(
            approved_student_ids=[self.student.id],
            actor=self.manager,
            department=self.department,
        )
        self.assertEqual(cleanup["applied_students"], [self.student.id])
        self.assertEqual(
            ClassSchedule.objects.filter(
                student=self.student, weekday="monday", is_active=True
            ).count(),
            1,
        )
        self.assertTrue(
            PlatformAuditLog.objects.filter(
                category="schedule_consistency_audit", action="apply_cleanup"
            ).exists()
        )
