from datetime import date, time
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Department, Institution
from academy.models import Attendance, ClassSchedule, StudentClassHistory, StudentProfile, TeacherProfile


User = get_user_model()


class SchedulingMutationPhase5DTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.inst = Institution.objects.create(name="Test Inst", slug="ti5d")
        self.quran_dept = Department.objects.create(
            institution=self.inst, name="Quran Dept", code="QD5D", department_type="quran"
        )
        self.other_quran_dept = Department.objects.create(
            institution=self.inst, name="Other Quran Dept", code="QD5D2", department_type="quran"
        )
        self.tuition_dept = Department.objects.create(
            institution=self.inst, name="Tuition Dept", code="TD5D", department_type="tuition"
        )

        self.coord = User.objects.create_user(
            username="coord5d", password="pw", role="coordinator", institution=self.inst, department=self.quran_dept
        )
        self.tuition_coord = User.objects.create_user(
            username="tcoord5d", password="pw", role="coordinator", institution=self.inst, department=self.tuition_dept
        )
        self.u_t1 = User.objects.create_user(
            username="t1_5d", password="pw", role="teacher", institution=self.inst, department=self.quran_dept
        )
        self.u_t2 = User.objects.create_user(
            username="t2_5d", password="pw", role="teacher", institution=self.inst, department=self.quran_dept
        )
        self.u_other_t = User.objects.create_user(
            username="ot_5d", password="pw", role="teacher", institution=self.inst, department=self.other_quran_dept
        )
        self.u_s1 = User.objects.create_user(
            username="s1_5d", password="pw", role="student", institution=self.inst, department=self.quran_dept, first_name="Ali"
        )

        self.t1 = TeacherProfile.objects.create(user=self.u_t1, institution=self.inst, department=self.quran_dept)
        self.t2 = TeacherProfile.objects.create(user=self.u_t2, institution=self.inst, department=self.quran_dept)
        self.other_t = TeacherProfile.objects.create(user=self.u_other_t, institution=self.inst, department=self.other_quran_dept)
        self.s1 = StudentProfile.objects.create(user=self.u_s1, institution=self.inst, department=self.quran_dept, teacher=self.t1)

        ClassSchedule.objects.create(
            student=self.s1, teacher=self.t1, weekday=ClassSchedule.WeekDay.MONDAY, time_slot=time(3, 30), duration_minutes=30
        )
        self.att = Attendance.objects.create(
            institution=self.inst,
            department=self.quran_dept,
            entity_type=Attendance.EntityType.STUDENT,
            student=self.s1,
            teacher=self.t1,
            date=date(2026, 11, 18),
            status=Attendance.Status.PRESENT,
            class_key="03:30",
        )

    def test_edit_remove_delete_preserve_attendance_and_enforce_isolation(self):
        # Unauthorized roles rejected
        for u in [self.u_t1, self.u_s1, self.tuition_coord]:
            self.client.force_authenticate(user=u)
            r = self.client.post("/api/academy/scheduling/", {
                "action": "edit_student",
                "student_id": self.s1.id,
                "teacher_id": self.t2.id,
                "time_slot": "04:00",
                "class_days": ["Monday"],
            }, format="json")
            self.assertEqual(r.status_code, 403)

        self.client.force_authenticate(user=self.coord)

        # Cross-department teacher rejected (404)
        r_cross = self.client.post("/api/academy/scheduling/", {
            "action": "edit_student",
            "student_id": self.s1.id,
            "teacher_id": self.other_t.id,
            "time_slot": "04:00",
            "class_days": ["Monday"],
        }, format="json")
        self.assertEqual(r_cross.status_code, 404)

        # Invalid time_slot rejected (400) without mutating DB
        r_bad = self.client.post("/api/academy/scheduling/", {
            "action": "edit_student",
            "student_id": self.s1.id,
            "teacher_id": self.t2.id,
            "time_slot": "99:99",
            "class_days": ["Monday"],
        }, format="json")
        self.assertEqual(r_bad.status_code, 400)
        self.s1.refresh_from_db()
        self.assertEqual(self.s1.teacher_id, self.t1.id)

        # Valid edit_student updates ClassSchedule, teacher, and records history
        r_ok = self.client.post("/api/academy/scheduling/", {
            "action": "edit_student",
            "student_id": self.s1.id,
            "teacher_id": self.t2.id,
            "time_slot": "04:00",
            "class_days": ["Monday", "Wednesday"],
        }, format="json")
        self.assertEqual(r_ok.status_code, 200)
        self.s1.refresh_from_db()
        self.assertEqual(self.s1.teacher_id, self.t2.id)
        self.assertEqual(ClassSchedule.objects.filter(student=self.s1, teacher=self.t2, time_slot=time(4, 0)).count(), 2)
        self.assertEqual(StudentClassHistory.objects.filter(student=self.s1).count(), 1)
        self.assertTrue(Attendance.objects.filter(id=self.att.id).exists())

        # remove_student clears ClassSchedule while preserving StudentProfile & Attendance
        r_rm = self.client.post("/api/academy/scheduling/", {
            "action": "remove_student",
            "student_id": self.s1.id,
            "teacher_id": self.t2.id,
            "time_slot": "04:00",
        }, format="json")
        self.assertEqual(r_rm.status_code, 200)
        self.assertEqual(ClassSchedule.objects.filter(student=self.s1).count(), 0)
        self.assertTrue(StudentProfile.objects.filter(id=self.s1.id).exists())
        self.assertTrue(Attendance.objects.filter(id=self.att.id).exists())

        # Re-add schedule then delete_class
        ClassSchedule.objects.create(
            student=self.s1, teacher=self.t2, weekday=ClassSchedule.WeekDay.MONDAY, time_slot=time(4, 0), duration_minutes=30
        )
        r_del = self.client.post("/api/academy/scheduling/", {
            "action": "delete_class",
            "teacher_id": self.t2.id,
            "time_slot": "04:00",
        }, format="json")
        self.assertEqual(r_del.status_code, 200)
        self.assertEqual(ClassSchedule.objects.filter(student=self.s1).count(), 0)
        self.assertTrue(Attendance.objects.filter(id=self.att.id).exists())
