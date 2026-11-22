from datetime import date, datetime, time, timedelta
from datetime import timezone as dt_timezone
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Department, DepartmentFeature, Feature, Institution, User
from academy.models import (
    Attendance,
    ClassSchedule,
    QuranSalaryPolicy,
    QuranTeacherMonthlyPayroll,
    StudentClassHistory,
    StudentProfile,
    TeacherProfile,
)
from academy.salary_v2_service import calculate_department_payrolls


class Phase2DropLeaveSyncTests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(
            name="Phase 2 Test Inst",
            slug="phase2-test-inst",
        )
        self.department = Department.objects.create(
            institution=self.institution,
            name="Quran Phase 2",
            code="quran-phase2",
            department_type=Department.DepartmentType.QURAN,
        )
        self.other_dept = Department.objects.create(
            institution=self.institution,
            name="Quran Other",
            code="quran-other-p2",
            department_type=Department.DepartmentType.QURAN,
        )
        feat, _ = Feature.objects.get_or_create(
            key="tab_dropped_leave",
            defaults={"name": "Dropped & Leave", "is_active": True},
        )
        for dept in (self.department, self.other_dept):
            DepartmentFeature.objects.update_or_create(
                department=dept,
                feature=feat,
                defaults={"is_enabled": True},
            )
        self.manager = User.objects.create_user(
            username="p2_manager",
            password="pw",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.department,
        )
        self.other_manager = User.objects.create_user(
            username="p2_other_manager",
            password="pw",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.other_dept,
        )
        self.teacher_user = User.objects.create_user(
            username="p2_teacher_a",
            first_name="Teacher",
            last_name="A",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        self.teacher = TeacherProfile.objects.create(
            user=self.teacher_user,
            institution=self.institution,
            department=self.department,
        )
        self.student_user = User.objects.create_user(
            username="p2_student_1",
            first_name="Student",
            last_name="One",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        self.student = StudentProfile.objects.create(
            user=self.student_user,
            institution=self.institution,
            department=self.department,
            teacher=self.teacher,
            student_type=StudentProfile.StudentType.OLD_STUDENT,
            class_status=StudentProfile.ClassStatus.RUNNING,
        )

        self.today = timezone.localdate()
        self.weekday = self.today.strftime("%A").lower()
        self.schedule = ClassSchedule.objects.create(
            institution=self.institution,
            department=self.department,
            student=self.student,
            teacher=self.teacher,
            weekday=self.weekday,
            time_slot=time(16, 0),
            duration_minutes=30,
            effective_from=self.today - timedelta(days=10),
        )
        self.past_att = Attendance.objects.create(
            institution=self.institution,
            department=self.department,
            entity_type=Attendance.EntityType.STUDENT,
            student=self.student,
            teacher=self.teacher,
            date=self.today - timedelta(days=2),
            class_key="16:00",
            status=Attendance.Status.PRESENT,
            marked_by=self.manager,
        )
        QuranSalaryPolicy.objects.create(
            department=self.department,
            effective_from=self.today.replace(day=1),
            rate_1_to_15=Decimal("80.00"),
            rate_16_to_19=Decimal("90.00"),
            rate_20_plus=Decimal("100.00"),
            created_by=self.manager,
        )

        self.coord_client = APIClient()
        self.coord_client.force_authenticate(user=self.manager)
        self.teacher_client = APIClient()
        self.teacher_client.force_authenticate(user=self.teacher_user)
        self.other_client = APIClient()
        self.other_client.force_authenticate(user=self.other_manager)

    def test_1_active_student_appears_in_teacher_portal(self):
        res = self.teacher_client.get("/api/academy/dashboard/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual([s["id"] for s in res.data["students"]], [self.student.id])
        self.assertEqual(len(res.data["schedules"]), 1)

    def test_2_and_4_confirm_drop_removes_from_teacher_portal_and_return_restores(self):
        drop_res = self.coord_client.post(
            "/api/academy/dropped-leave/",
            {
                "student_id": self.student.id,
                "action": "confirm_drop",
                "effective_date": str(self.today),
                "reason": "Stopped attending",
            },
            format="json",
        )
        self.assertEqual(drop_res.status_code, 200)
        self.assertEqual(drop_res.data["class_status"], StudentProfile.ClassStatus.OLD_DROPPED)

        # Duplicate drop confirmation is rejected cleanly
        dup_res = self.coord_client.post(
            "/api/academy/dropped-leave/",
            {
                "student_id": self.student.id,
                "action": "confirm_drop",
                "effective_date": str(self.today),
            },
            format="json",
        )
        self.assertEqual(dup_res.status_code, 409)

        # Teacher portal no longer sees student or active schedules, but keeps historical attendance
        t_res = self.teacher_client.get("/api/academy/dashboard/")
        self.assertEqual(t_res.status_code, 200)
        self.assertEqual(t_res.data["students"], [])
        self.assertEqual(t_res.data["schedules"], [])
        self.assertTrue(Attendance.objects.filter(id=self.past_att.id).exists())

        # State refresh preserves inactive status
        state_res = self.coord_client.get("/api/academy/state/?dashboard=true")
        self.assertEqual(state_res.status_code, 200)
        st_row = next(s for s in state_res.data["students"] if int(s["id"]) == self.student.id)
        self.assertEqual(st_row["classStatus"], StudentProfile.ClassStatus.OLD_DROPPED)

        # Student remains visible in Dropped & Leave list for return
        dl_res = self.coord_client.get("/api/academy/dropped-leave/")
        self.assertEqual(dl_res.status_code, 200)
        dl_ids = [r["student_id"] for r in dl_res.data["results"]]
        self.assertIn(self.student.id, dl_ids)

        # Confirm Return restores student to Teacher A
        ret_res = self.coord_client.post(
            "/api/academy/dropped-leave/",
            {
                "student_id": self.student.id,
                "action": "confirm_return",
                "effective_date": str(self.today),
            },
            format="json",
        )
        self.assertEqual(ret_res.status_code, 200)
        self.assertEqual(ret_res.data["class_status"], StudentProfile.ClassStatus.RUNNING)
        self.assertFalse(ret_res.data["requires_reassignment"])

        t_after = self.teacher_client.get("/api/academy/dashboard/")
        self.assertEqual([s["id"] for s in t_after.data["students"]], [self.student.id])
        self.assertEqual(len(t_after.data["schedules"]), 1)

        # Duplicate return when already active is rejected
        dup_ret = self.coord_client.post(
            "/api/academy/dropped-leave/",
            {
                "student_id": self.student.id,
                "action": "confirm_return",
                "effective_date": str(self.today),
            },
            format="json",
        )
        self.assertEqual(dup_ret.status_code, 409)

    def test_3_confirm_leave_hides_from_teacher_and_preserves_history(self):
        leave_res = self.coord_client.post(
            "/api/academy/dropped-leave/",
            {
                "student_id": self.student.id,
                "action": "confirm_leave",
                "effective_date": str(self.today),
                "reason": "Family travel",
            },
            format="json",
        )
        self.assertEqual(leave_res.status_code, 200)
        self.assertEqual(leave_res.data["class_status"], StudentProfile.ClassStatus.ON_LEAVE)

        t_res = self.teacher_client.get("/api/academy/dashboard/")
        self.assertEqual(t_res.data["students"], [])
        self.assertEqual(t_res.data["schedules"], [])
        self.assertTrue(Attendance.objects.filter(id=self.past_att.id).exists())

        dup_leave = self.coord_client.post(
            "/api/academy/dropped-leave/",
            {
                "student_id": self.student.id,
                "action": "confirm_leave",
                "effective_date": str(self.today),
            },
            format="json",
        )
        self.assertEqual(dup_leave.status_code, 409)

    def test_5_invalid_old_assignment_flags_reassignment_without_fabricating(self):
        self.coord_client.post(
            "/api/academy/dropped-leave/",
            {"student_id": self.student.id, "action": "confirm_drop", "effective_date": str(self.today)},
            format="json",
        )
        # Deactivate the old schedule while student is dropped
        self.schedule.is_active = False
        self.schedule.save(update_fields=["is_active"])

        ret_res = self.coord_client.post(
            "/api/academy/dropped-leave/",
            {"student_id": self.student.id, "action": "confirm_return", "effective_date": str(self.today)},
            format="json",
        )
        self.assertEqual(ret_res.status_code, 200)
        self.assertEqual(ret_res.data["class_status"], StudentProfile.ClassStatus.RUNNING)
        self.assertTrue(ret_res.data["requires_reassignment"])
        self.assertEqual(ClassSchedule.objects.filter(student=self.student, is_active=True).count(), 0)

    def test_6_and_7_permissions_and_locked_payroll_protection(self):
        # Teacher cannot confirm drop
        t_res = self.teacher_client.post(
            "/api/academy/dropped-leave/",
            {"student_id": self.student.id, "action": "confirm_drop", "effective_date": str(self.today)},
            format="json",
        )
        self.assertEqual(t_res.status_code, 403)

        # Cross-department admin cannot confirm drop
        o_res = self.other_client.post(
            "/api/academy/dropped-leave/",
            {"student_id": self.student.id, "action": "confirm_drop", "effective_date": str(self.today)},
            format="json",
        )
        self.assertEqual(o_res.status_code, 404)

        # Locked payroll period protects completed salary records
        calculate_department_payrolls(self.department, self.today.year, self.today.month, actor=self.manager)
        payroll = QuranTeacherMonthlyPayroll.objects.get(
            department=self.department,
            teacher=self.teacher,
            year=self.today.year,
            month=self.today.month,
        )
        payroll.status = QuranTeacherMonthlyPayroll.Status.PAID
        payroll.save(update_fields=["status"])

        locked_res = self.coord_client.post(
            "/api/academy/dropped-leave/",
            {"student_id": self.student.id, "action": "confirm_drop", "effective_date": str(self.today)},
            format="json",
        )
        self.assertEqual(locked_res.status_code, 409)
        self.student.refresh_from_db()
        self.assertEqual(self.student.class_status, StudentProfile.ClassStatus.RUNNING)
        self.assertEqual(StudentClassHistory.objects.filter(student=self.student).count(), 0)

    def test_8_same_name_students_and_effective_date_boundaries(self):
        # Create a second distinct student with the exact same full name
        twin_user = User.objects.create_user(
            username="p2_student_twin",
            first_name="Student",
            last_name="One",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        twin_student = StudentProfile.objects.create(
            user=twin_user,
            institution=self.institution,
            department=self.department,
            teacher=self.teacher,
            student_type=StudentProfile.StudentType.TRIAL_STUDENT,
            class_status=StudentProfile.ClassStatus.RUNNING,
        )
        ClassSchedule.objects.create(
            institution=self.institution,
            department=self.department,
            student=twin_student,
            teacher=self.teacher,
            weekday=self.weekday,
            time_slot=time(17, 30),
            duration_minutes=30,
            effective_from=self.today - timedelta(days=5),
        )

        # Confirm Drop ONLY for twin_student effective today
        drop_res = self.coord_client.post(
            "/api/academy/dropped-leave/",
            {
                "student_id": twin_student.id,
                "action": "confirm_drop",
                "effective_date": str(self.today),
                "reason": "Trial discontinued",
            },
            format="json",
        )
        self.assertEqual(drop_res.status_code, 200)
        self.assertEqual(drop_res.data["class_status"], StudentProfile.ClassStatus.TRIAL_DROPPED)

        # Original student (same name) remains Running and active in Teacher A's portal
        self.student.refresh_from_db()
        twin_student.refresh_from_db()
        self.assertEqual(self.student.class_status, StudentProfile.ClassStatus.RUNNING)
        self.assertEqual(twin_student.class_status, StudentProfile.ClassStatus.TRIAL_DROPPED)
        self.assertTrue(twin_student.user.is_active)

        t_res = self.teacher_client.get("/api/academy/dashboard/")
        self.assertEqual(t_res.status_code, 200)
        self.assertEqual([s["id"] for s in t_res.data["students"]], [self.student.id])
        self.assertEqual({row["student"]["id"] for row in t_res.data["schedules"]}, {self.student.id})

        # Future effective date: student remains teaching-active before drop_effective_date
        from academy.student_status_service import is_student_teaching_active
        self.assertTrue(is_student_teaching_active(twin_student, self.today - timedelta(days=1)))
        self.assertFalse(is_student_teaching_active(twin_student, self.today))

    def test_9_pakistan_midnight_boundary_same_day_and_rollback(self):
        from academy.salary_v2_models import QuranStudentDropEvent
        from academy.student_status_service import academy_localdate

        # Test A: 2026-11-22 00:11 Asia/Karachi == 2026-11-21 19:11 UTC
        midnight_utc = datetime(2026, 11, 21, 19, 11, 0, tzinfo=dt_timezone.utc)
        with patch("academy.student_status_service.timezone.now", return_value=midnight_utc):
            self.assertEqual(academy_localdate(), date(2026, 11, 22))

            self.coord_client.post(
                "/api/academy/dropped-leave/",
                {
                    "student_id": self.student.id,
                    "action": "confirm_drop",
                    "effective_date": "2026-11-21",
                },
                format="json",
            )

            # 2026-11-23 is genuinely in the future -> 400
            future_res = self.coord_client.post(
                "/api/academy/dropped-leave/",
                {
                    "student_id": self.student.id,
                    "action": "confirm_return",
                    "effective_date": "2026-11-23",
                },
                format="json",
            )
            self.assertEqual(future_res.status_code, 400)

            # 2026-11-20 is before drop effective date 2026-11-21 -> 400
            early_res = self.coord_client.post(
                "/api/academy/dropped-leave/",
                {
                    "student_id": self.student.id,
                    "action": "confirm_return",
                    "effective_date": "2026-11-20",
                },
                format="json",
            )
            self.assertEqual(early_res.status_code, 400)

            # 2026-11-22 is today in Asia/Karachi -> 200
            ok_res = self.coord_client.post(
                "/api/academy/dropped-leave/",
                {
                    "student_id": self.student.id,
                    "action": "confirm_return",
                    "effective_date": "2026-11-22",
                },
                format="json",
            )
            self.assertEqual(ok_res.status_code, 200)
            self.assertEqual(ok_res.data["class_status"], StudentProfile.ClassStatus.RUNNING)

        # Test E & F: Same-day drop+return allowed; simulated failure rolls back cleanly
        self.coord_client.post(
            "/api/academy/dropped-leave/",
            {"student_id": self.student.id, "action": "confirm_drop", "effective_date": str(self.today)},
            format="json",
        )
        hist_before = StudentClassHistory.objects.filter(student=self.student).count()
        with patch("academy.student_status_service.PlatformAuditLog.objects.create", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                self.coord_client.post(
                    "/api/academy/dropped-leave/",
                    {"student_id": self.student.id, "action": "confirm_return", "effective_date": str(self.today)},
                    format="json",
                )
        self.student.refresh_from_db()
        self.assertEqual(self.student.class_status, StudentProfile.ClassStatus.OLD_DROPPED)
        self.assertEqual(StudentClassHistory.objects.filter(student=self.student).count(), hist_before)

        same_day_res = self.coord_client.post(
            "/api/academy/dropped-leave/",
            {"student_id": self.student.id, "action": "confirm_return", "effective_date": str(self.today)},
            format="json",
        )
        self.assertEqual(same_day_res.status_code, 200)
        self.assertEqual(same_day_res.data["class_status"], StudentProfile.ClassStatus.RUNNING)

        # Test C: Controlled Salary V2 drop event + Return
        drop_event = QuranStudentDropEvent.objects.create(
            department=self.department,
            student=self.student,
            teacher=self.teacher,
            streak_start_date=self.today - timedelta(days=4),
            streak_end_date=self.today - timedelta(days=2),
            drop_effective_date=self.today - timedelta(days=2),
            status=QuranStudentDropEvent.Status.DROPPED,
        )
        v2_ret = self.coord_client.post(
            "/api/academy/dropped-leave/",
            {"student_id": self.student.id, "action": "confirm_return", "effective_date": str(self.today)},
            format="json",
        )
        self.assertEqual(v2_ret.status_code, 200)
        drop_event.refresh_from_db()
        self.assertEqual(drop_event.rejoined_date, self.today)
