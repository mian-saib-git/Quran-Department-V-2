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

    def _get_session(self, teacher_id=None):
        tid = teacher_id or self.teacher.id
        return self.client.get(
            f"/api/academy/teacher-session-attendance-v2/?teacher_id={tid}&date={self.target_date}&class_key={self.class_key}",
            HTTP_HOST="localhost",
        )

    def test_9_available_substitutes_include_scheduled_and_unscheduled_active_teachers(self):
        # Teacher with overlapping scheduled class & Present student
        busy_user = User.objects.create_user(
            username="v2_busy_teacher",
            first_name="Busy",
            last_name="Teacher",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        busy_teacher = TeacherProfile.objects.create(
            user=busy_user,
            institution=self.institution,
            department=self.department,
        )
        other_student_user = User.objects.create_user(
            username="v2_other_student",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        other_student = StudentProfile.objects.create(
            user=other_student_user,
            teacher=busy_teacher,
            institution=self.institution,
            department=self.department,
        )
        ClassSchedule.objects.create(
            institution=self.institution,
            department=self.department,
            student=other_student,
            teacher=busy_teacher,
            weekday=self.target_date.strftime("%A").lower(),
            time_slot=self.session_time,
            duration_minutes=30,
            is_active=True,
        )
        Attendance.objects.create(
            entity_type=Attendance.EntityType.STUDENT,
            teacher=busy_teacher,
            student=other_student,
            date=self.target_date,
            class_key=self.class_key,
            status=Attendance.Status.PRESENT,
            marked_by=self.manager,
            department=self.department,
            institution=self.institution,
        )

        # Inactive teacher
        inactive_user = User.objects.create_user(
            username="v2_inactive_teacher",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
            is_active=False,
        )
        inactive_teacher = TeacherProfile.objects.create(
            user=inactive_user,
            institution=self.institution,
            department=self.department,
        )

        # Archived teacher
        archived_user = User.objects.create_user(
            username="v2_archived_teacher",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
            is_active=True,
            archived_at=timezone.now(),
        )
        archived_teacher = TeacherProfile.objects.create(
            user=archived_user,
            institution=self.institution,
            department=self.department,
        )

        # Deleted-login teacher
        deleted_teacher = TeacherProfile.objects.create(
            user=None,
            historical_name="Deleted Login Teacher",
            login_deleted_at=timezone.now(),
            institution=self.institution,
            department=self.department,
        )

        # Other department teacher
        other_dept = Department.objects.create(
            institution=self.institution,
            name="Other Quran",
            code="other-quran-v2",
            department_type=Department.DepartmentType.QURAN,
        )
        other_dept_user = User.objects.create_user(
            username="v2_other_dept_teacher",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=other_dept,
        )
        other_dept_teacher = TeacherProfile.objects.create(
            user=other_dept_user,
            institution=self.institution,
            department=other_dept,
        )

        resp = self._get_session()
        self.assertEqual(resp.status_code, 200)
        sub_ids = {item["id"] for item in resp.data["available_substitutes"]}

        # Included: unscheduled active teacher & active teacher with own scheduled class
        self.assertIn(self.sub_teacher.id, sub_ids)
        self.assertIn(busy_teacher.id, sub_ids)

        # Excluded: original teacher, inactive, archived, deleted-login, other department
        self.assertNotIn(self.teacher.id, sub_ids)
        self.assertNotIn(inactive_teacher.id, sub_ids)
        self.assertNotIn(archived_teacher.id, sub_ids)
        self.assertNotIn(deleted_teacher.id, sub_ids)
        self.assertNotIn(other_dept_teacher.id, sub_ids)

    def test_10_assign_scheduled_teacher_as_substitute_persists_and_reloads(self):
        busy_user = User.objects.create_user(
            username="v2_scheduled_sub",
            first_name="Scheduled",
            last_name="Sub",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        busy_teacher = TeacherProfile.objects.create(
            user=busy_user,
            institution=self.institution,
            department=self.department,
        )
        other_student_user = User.objects.create_user(
            username="v2_busy_student",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        other_student = StudentProfile.objects.create(
            user=other_student_user,
            teacher=busy_teacher,
            institution=self.institution,
            department=self.department,
        )
        ClassSchedule.objects.create(
            institution=self.institution,
            department=self.department,
            student=other_student,
            teacher=busy_teacher,
            weekday=self.target_date.strftime("%A").lower(),
            time_slot=self.session_time,
            duration_minutes=30,
            is_active=True,
        )

        post_resp = self._post_session(
            "absent",
            [{"student_id": self.student.id, "substitute_teacher_id": busy_teacher.id}],
        )
        self.assertEqual(post_resp.status_code, 200)

        get_resp = self._get_session()
        self.assertEqual(get_resp.status_code, 200)
        self.assertEqual(get_resp.data["teacher_attendance"]["status"], "absent")
        self.assertEqual(
            get_resp.data["students"][0]["coverage"]["substitute_teacher_id"],
            busy_teacher.id,
        )

    def test_11_integrity_rules_reject_contradictory_assignments_with_clear_reason(self):
        # 1. Inactive substitute rejected on POST
        inactive_user = User.objects.create_user(
            username="v2_sub_inactive",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
            is_active=False,
        )
        inactive_sub = TeacherProfile.objects.create(
            user=inactive_user,
            institution=self.institution,
            department=self.department,
        )
        r_inactive = self._post_session(
            "absent",
            [{"student_id": self.student.id, "substitute_teacher_id": inactive_sub.id}],
        )
        self.assertEqual(r_inactive.status_code, 400)
        self.assertIn("inactive", r_inactive.data["detail"].lower())

        # 2. Substitute marked ABSENT at same class_key remains visible in GET, rejected on POST
        Attendance.objects.create(
            entity_type=Attendance.EntityType.TEACHER,
            teacher=self.sub_teacher,
            date=self.target_date,
            class_key=self.class_key,
            status=Attendance.Status.ABSENT,
            marked_by=self.manager,
            department=self.department,
            institution=self.institution,
        )
        get_resp = self._get_session()
        self.assertIn(
            self.sub_teacher.id,
            {item["id"] for item in get_resp.data["available_substitutes"]},
        )
        r_absent = self._post_session(
            "absent",
            [{"student_id": self.student.id, "substitute_teacher_id": self.sub_teacher.id}],
        )
        self.assertEqual(r_absent.status_code, 409)
        self.assertEqual(r_absent.data["code"], "substitute_unavailable_attendance")

        # 3. Overlapping substitute coverage remains visible in GET, rejected on POST
        sub2_user = User.objects.create_user(
            username="v2_sub2",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        sub2 = TeacherProfile.objects.create(
            user=sub2_user,
            institution=self.institution,
            department=self.department,
        )
        other_teacher_user = User.objects.create_user(
            username="v2_other_t",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        other_teacher = TeacherProfile.objects.create(
            user=other_teacher_user,
            institution=self.institution,
            department=self.department,
        )
        other_student_user = User.objects.create_user(
            username="v2_other_s2",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        other_student = StudentProfile.objects.create(
            user=other_student_user,
            teacher=other_teacher,
            institution=self.institution,
            department=self.department,
        )
        other_schedule = ClassSchedule.objects.create(
            institution=self.institution,
            department=self.department,
            student=other_student,
            teacher=other_teacher,
            weekday=self.target_date.strftime("%A").lower(),
            time_slot=self.session_time,
            duration_minutes=30,
            is_active=True,
        )
        QuranClassCoverage.objects.create(
            department=self.department,
            date=self.target_date,
            class_key=self.class_key,
            schedule=other_schedule,
            original_teacher=other_teacher,
            substitute_teacher=sub2,
            student=other_student,
            teacher_status=Attendance.Status.ABSENT,
            student_status=QuranClassCoverage.StudentStatus.PRESENT,
            coverage_status=QuranClassCoverage.CoverageStatus.ASSIGNED,
        )
        get_resp_2 = self._get_session()
        self.assertIn(
            sub2.id,
            {item["id"] for item in get_resp_2.data["available_substitutes"]},
        )
        r_conflict = self._post_session(
            "absent",
            [{"student_id": self.student.id, "substitute_teacher_id": sub2.id}],
        )
        self.assertEqual(r_conflict.status_code, 409)
        self.assertEqual(r_conflict.data["code"], "substitute_booking_conflict")

    def test_12_permissions_and_confirmation_validation(self):
        # Teacher role cannot access GET or POST
        teacher_client = APIClient()
        teacher_client.force_authenticate(user=self.teacher_user)
        r_get = teacher_client.get(
            f"/api/academy/teacher-session-attendance-v2/?teacher_id={self.teacher.id}&date={self.target_date}&class_key={self.class_key}",
            HTTP_HOST="localhost",
        )
        self.assertEqual(r_get.status_code, 403)
        r_post = teacher_client.post(
            "/api/academy/teacher-session-attendance-v2/",
            {
                "teacher_id": self.teacher.id,
                "date": str(self.target_date),
                "class_key": self.class_key,
                "status": "present",
            },
            format="json",
            HTTP_HOST="localhost",
        )
        self.assertEqual(r_post.status_code, 403)

        # Missing substitute for Present student rejected
        r_missing = self._post_session("absent", [])
        self.assertEqual(r_missing.status_code, 400)
        self.assertIn("missing_student_ids", r_missing.data)

        # Unmarked student blocks Absent/Leave
        Attendance.objects.filter(
            entity_type=Attendance.EntityType.STUDENT,
            student=self.student,
            date=self.target_date,
        ).delete()
        r_unmarked = self._post_session(
            "absent",
            [{"student_id": self.student.id, "substitute_teacher_id": self.sub_teacher.id}],
        )
        self.assertEqual(r_unmarked.status_code, 400)
        self.assertIn("not_marked_student_ids", r_unmarked.data)
