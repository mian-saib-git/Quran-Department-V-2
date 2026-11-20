from datetime import time
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Department, Institution, PlatformAuditLog, User
from academy.models import (
    Attendance,
    ClassSchedule,
    QuranClassCoverage,
    QuranTeacherMonthlyPayroll,
    StudentProfile,
    TeacherProfile,
)


class TeacherSessionAttendanceV2Tests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(
            name="V2 Attendance Test",
            slug="v2-attendance-test",
        )
        self.department = Department.objects.create(
            institution=self.institution,
            name="Quran V2",
            code="quran-v2",
            department_type=Department.DepartmentType.QURAN,
        )
        self.manager = User.objects.create_user(
            username="v2_manager",
            password="pw",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.department,
        )
        self.teacher_user = User.objects.create_user(
            username="v2_teacher",
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
        self.sub_user = User.objects.create_user(
            username="v2_sub",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        self.sub_teacher = TeacherProfile.objects.create(
            user=self.sub_user,
            institution=self.institution,
            department=self.department,
        )
        self.student_user = User.objects.create_user(
            username="v2_student",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        self.student = StudentProfile.objects.create(
            user=self.student_user,
            teacher=self.teacher,
            institution=self.institution,
            department=self.department,
        )

        self.target_date = timezone.localdate()
        self.session_time = time(14, 0)
        self.class_key = "14:00"
        self.schedule = ClassSchedule.objects.create(
            institution=self.institution,
            department=self.department,
            student=self.student,
            teacher=self.teacher,
            weekday=self.target_date.strftime("%A").lower(),
            time_slot=self.session_time,
            duration_minutes=30,
            is_active=True,
        )

        # Student attendance must be marked before teacher Absent/Leave
        Attendance.objects.create(
            entity_type=Attendance.EntityType.STUDENT,
            teacher=self.teacher,
            student=self.student,
            date=self.target_date,
            class_key=self.class_key,
            status=Attendance.Status.PRESENT,
            marked_by=self.manager,
            department=self.department,
            institution=self.institution,
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.manager)

    def _post_session(self, status_value, coverage_assignments=None):
        return self.client.post(
            "/api/academy/teacher-session-attendance-v2/",
            {
                "teacher_id": self.teacher.id,
                "date": str(self.target_date),
                "class_key": self.class_key,
                "status": status_value,
                "coverage_assignments": coverage_assignments or [],
            },
            format="json",
            HTTP_HOST="localhost",
        )

    def _delete_session(self):
        return self.client.delete(
            f"/api/academy/teacher-session-attendance-v2/?teacher_id={self.teacher.id}&date={self.target_date}&class_key={self.class_key}",
            HTTP_HOST="localhost",
        )

    def test_1_present_on_unmarked_session_and_audit(self):
        resp = self._post_session("present")
        self.assertEqual(resp.status_code, 200)

        att = Attendance.objects.get(
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=self.target_date,
            class_key=self.class_key,
        )
        self.assertEqual(att.status, Attendance.Status.PRESENT)

        audit = PlatformAuditLog.objects.filter(
            action="teacher_session_attendance_v2",
            target_id=str(att.id),
        ).latest("id")
        self.assertEqual(audit.details["teacher_status"], "present")
        self.assertIsNone(audit.details["original_rate"])

    def test_2_absent_on_unmarked_session_creates_coverage_and_rates(self):
        resp = self._post_session(
            "absent",
            [{"student_id": self.student.id, "substitute_teacher_id": self.sub_teacher.id}],
        )
        self.assertEqual(resp.status_code, 200)

        att = Attendance.objects.get(
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=self.target_date,
            class_key=self.class_key,
        )
        self.assertEqual(att.status, Attendance.Status.ABSENT)

        cov = QuranClassCoverage.objects.get(
            department=self.department,
            original_teacher=self.teacher,
            student=self.student,
            date=self.target_date,
        )
        self.assertEqual(cov.coverage_status, QuranClassCoverage.CoverageStatus.ASSIGNED)
        self.assertEqual(cov.substitute_teacher_id, self.sub_teacher.id)

        audit = PlatformAuditLog.objects.filter(
            action="teacher_session_attendance_v2",
            target_id=str(att.id),
        ).latest("id")
        self.assertEqual(audit.details["teacher_status"], "absent")
        self.assertIsNotNone(audit.details["original_rate"])

    def test_3_leave_on_unmarked_session(self):
        resp = self._post_session(
            "leave",
            [{"student_id": self.student.id, "substitute_teacher_id": self.sub_teacher.id}],
        )
        self.assertEqual(resp.status_code, 200)

        att = Attendance.objects.get(
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=self.target_date,
            class_key=self.class_key,
        )
        self.assertEqual(att.status, Attendance.Status.LEAVE)
        cov = QuranClassCoverage.objects.get(
            department=self.department,
            original_teacher=self.teacher,
            student=self.student,
            date=self.target_date,
        )
        self.assertEqual(cov.coverage_status, QuranClassCoverage.CoverageStatus.ASSIGNED)

    def test_4_absent_to_present_cancels_coverage(self):
        r1 = self._post_session(
            "absent",
            [{"student_id": self.student.id, "substitute_teacher_id": self.sub_teacher.id}],
        )
        self.assertEqual(r1.status_code, 200)

        r2 = self._post_session("present")
        self.assertEqual(r2.status_code, 200)

        att = Attendance.objects.get(
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=self.target_date,
            class_key=self.class_key,
        )
        self.assertEqual(att.status, Attendance.Status.PRESENT)

        cov = QuranClassCoverage.objects.get(
            department=self.department,
            original_teacher=self.teacher,
            student=self.student,
            date=self.target_date,
        )
        self.assertEqual(cov.coverage_status, QuranClassCoverage.CoverageStatus.CANCELLED)

    def test_5_leave_to_present_cancels_coverage(self):
        r1 = self._post_session(
            "leave",
            [{"student_id": self.student.id, "substitute_teacher_id": self.sub_teacher.id}],
        )
        self.assertEqual(r1.status_code, 200)

        r2 = self._post_session("present")
        self.assertEqual(r2.status_code, 200)

        att = Attendance.objects.get(
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=self.target_date,
            class_key=self.class_key,
        )
        self.assertEqual(att.status, Attendance.Status.PRESENT)
        cov = QuranClassCoverage.objects.get(
            department=self.department,
            original_teacher=self.teacher,
            student=self.student,
            date=self.target_date,
        )
        self.assertEqual(cov.coverage_status, QuranClassCoverage.CoverageStatus.CANCELLED)

    def test_6_present_to_unmark_deletes_attendance_and_audits(self):
        self._post_session("present")
        att_id = Attendance.objects.get(
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.teacher,
            date=self.target_date,
            class_key=self.class_key,
        ).id

        del_resp = self._delete_session()
        self.assertEqual(del_resp.status_code, 200)
        self.assertFalse(
            Attendance.objects.filter(id=att_id).exists(),
        )
        audit = PlatformAuditLog.objects.filter(
            action="teacher_session_unmarked_v2",
            target_id=str(att_id),
        ).latest("id")
        self.assertEqual(audit.details["previous_status"], "present")

    def test_7_payroll_locked_attendance_is_rejected(self):
        QuranTeacherMonthlyPayroll.objects.create(
            institution=self.institution,
            department=self.department,
            teacher=self.teacher,
            year=self.target_date.year,
            month=self.target_date.month,
            status=QuranTeacherMonthlyPayroll.Status.APPROVED,
        )

        resp = self._post_session("present")
        self.assertEqual(resp.status_code, 409)
        self.assertFalse(
            Attendance.objects.filter(
                entity_type=Attendance.EntityType.TEACHER,
                teacher=self.teacher,
                date=self.target_date,
                class_key=self.class_key,
            ).exists()
        )

    def test_8_database_rollback_on_failure(self):
        with patch(
            "academy.attendance_v2_api.QuranClassCoverage.objects.filter",
            side_effect=RuntimeError("Simulated failure"),
        ):
            with self.assertRaises(RuntimeError):
                self._post_session("present")

        self.assertFalse(
            Attendance.objects.filter(
                entity_type=Attendance.EntityType.TEACHER,
                teacher=self.teacher,
                date=self.target_date,
                class_key=self.class_key,
            ).exists()
        )
