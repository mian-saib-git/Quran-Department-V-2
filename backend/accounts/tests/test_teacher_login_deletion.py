"""Hard-delete only teacher User; leave teaching and payroll references intact."""
from django.test import TestCase
from django.utils import timezone
from datetime import date
from accounts.models import User, Department, Institution
from academy.models import TeacherProfile, StudentProfile, ClassSchedule, Attendance
from academy.models import TeacherSalarySlip
from academy.serializers import AttendanceSerializer
from accounts.teacher_login_deletion_service import delete_teacher_login_permanently
from accounts.teacher_retirement_service import TeacherRetirementBlocked

class TeacherLoginHardDeleteTests(TestCase):
    def setUp(self):
        self.school = Institution.objects.create(name="Deletion tests", slug="teacher-login-delete-test")
        self.department = Department.objects.create(institution=self.school, name="Quran", code="quran-login-test", department_type="quran")
        self.admin = User.objects.create_user(username="deletion-admin", password="example", role=User.Role.DEPARTMENT_ADMIN, institution=self.school, department=self.department)
        self.teacher_user = User.objects.create_user(username="delete-teacher", password="example", first_name="Past", last_name="Teacher", role=User.Role.TEACHER, institution=self.school, department=self.department)
        self.teacher = TeacherProfile.objects.create(user=self.teacher_user, institution=self.school, department=self.department)

    def test_teacher_with_assigned_student_is_blocked_and_kept(self):
        student_user = User.objects.create_user(username="delete-student", password="example", role=User.Role.STUDENT, department=self.department, institution=self.school)
        StudentProfile.objects.create(user=student_user, teacher=self.teacher, institution=self.school, department=self.department)
        with self.assertRaises(TeacherRetirementBlocked):
            delete_teacher_login_permanently(user=self.teacher_user, actor=self.admin)
        self.assertTrue(User.objects.filter(pk=self.teacher_user.pk).exists())

    def test_login_removed_history_profile_and_attendance_remain(self):
        attendance = Attendance.objects.create(teacher=self.teacher, entity_type=Attendance.EntityType.TEACHER, date=date(2025, 4, 10), status=Attendance.Status.PRESENT, marked_by=self.teacher_user, department=self.department, institution=self.school)
        slip = TeacherSalarySlip.objects.create(teacher=self.teacher, department=self.department, institution=self.school, month=4, year=2025)
        uid, teacher_id = self.teacher_user.pk, self.teacher.pk
        result = delete_teacher_login_permanently(user=self.teacher_user, actor=self.admin)
        self.assertFalse(User.objects.filter(pk=uid).exists())
        self.assertTrue(TeacherProfile.objects.filter(pk=teacher_id, user__isnull=True).exists())
        attendance.refresh_from_db()
        slip.refresh_from_db()
        self.assertEqual(slip.teacher_id, teacher_id)
        self.assertEqual(str(slip.teacher), "Past Teacher")
        self.assertEqual(attendance.teacher_id, teacher_id)
        self.assertIsNone(attendance.marked_by_id)
        self.assertEqual(attendance.actor_name_snapshot, "Past Teacher")
        serialized = AttendanceSerializer(attendance).data
        self.assertEqual(serialized["teacher_name"], "Past Teacher")
        self.assertEqual(serialized["marked_by_username"], "Past Teacher")
        self.assertEqual(str(TeacherProfile.objects.get(pk=teacher_id)), "Past Teacher")
        self.assertEqual(result["deleted_user_id"], uid)
