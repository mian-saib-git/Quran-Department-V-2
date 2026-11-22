from datetime import time, timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Department, Institution, User
from academy.models import (
    ClassSchedule,
    StudentClassHistory,
    StudentProfile,
    TeacherProfile,
)


class Phase2CTeacherDetailsTests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(
            name="Phase 2C Test Inst",
            slug="phase2c-test-inst",
        )
        self.department = Department.objects.create(
            institution=self.institution,
            name="Quran Phase 2C",
            code="quran-phase2c",
            department_type=Department.DepartmentType.QURAN,
        )
        self.other_dept = Department.objects.create(
            institution=self.institution,
            name="Quran Other 2C",
            code="quran-other-2c",
            department_type=Department.DepartmentType.QURAN,
        )
        self.manager = User.objects.create_user(
            username="p2c_manager",
            password="pw",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.department,
        )
        self.other_manager = User.objects.create_user(
            username="p2c_other_manager",
            password="pw",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.other_dept,
        )

        # Two teachers with identical display names
        self.t1_user = User.objects.create_user(
            username="p2c_teacher_1",
            first_name="26 chan",
            last_name="zaib",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        self.teacher_1 = TeacherProfile.objects.create(
            user=self.t1_user,
            institution=self.institution,
            department=self.department,
        )
        self.t2_user = User.objects.create_user(
            username="p2c_teacher_2",
            first_name="26 chan",
            last_name="zaib",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        self.teacher_2 = TeacherProfile.objects.create(
            user=self.t2_user,
            institution=self.institution,
            department=self.department,
        )

        self.today = timezone.localdate()

        # Active student with 2 schedules under teacher_1
        self.s_active_u = User.objects.create_user(
            username="p2c_s_active",
            first_name="Active",
            last_name="Student",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        self.s_active = StudentProfile.objects.create(
            user=self.s_active_u,
            institution=self.institution,
            department=self.department,
            teacher=self.teacher_1,
            class_status=StudentProfile.ClassStatus.RUNNING,
        )
        ClassSchedule.objects.create(
            institution=self.institution,
            department=self.department,
            student=self.s_active,
            teacher=self.teacher_1,
            weekday="monday",
            time_slot=time(16, 0),
            duration_minutes=30,
            effective_from=self.today - timedelta(days=5),
        )
        ClassSchedule.objects.create(
            institution=self.institution,
            department=self.department,
            student=self.s_active,
            teacher=self.teacher_1,
            weekday="wednesday",
            time_slot=time(16, 0),
            duration_minutes=30,
            effective_from=self.today - timedelta(days=5),
        )

        # Dropped student under teacher_1 (login account still active)
        self.s_drop_u = User.objects.create_user(
            username="p2c_s_drop",
            first_name="Dropped",
            last_name="Student",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        self.s_drop = StudentProfile.objects.create(
            user=self.s_drop_u,
            institution=self.institution,
            department=self.department,
            teacher=self.teacher_1,
            student_type=StudentProfile.StudentType.TRIAL_STUDENT,
            class_status=StudentProfile.ClassStatus.TRIAL_DROPPED,
            status_effective_date=self.today,
        )
        StudentClassHistory.objects.create(
            student=self.s_drop,
            event_type=StudentClassHistory.EventType.STATUS_CHANGED,
            effective_date=self.today,
            previous_teacher=self.teacher_1,
            new_teacher=self.teacher_1,
            previous_class_status=StudentProfile.ClassStatus.RUNNING,
            new_class_status=StudentProfile.ClassStatus.TRIAL_DROPPED,
            notes="Stopped attending",
            created_by=self.manager,
        )

        # On-leave student under teacher_1
        self.s_leave_u = User.objects.create_user(
            username="p2c_s_leave",
            first_name="Leave",
            last_name="Student",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        self.s_leave = StudentProfile.objects.create(
            user=self.s_leave_u,
            institution=self.institution,
            department=self.department,
            teacher=self.teacher_1,
            class_status=StudentProfile.ClassStatus.ON_LEAVE,
            status_effective_date=self.today,
        )

        # Separate student under teacher_2 (same display name as teacher_1)
        self.s_t2_u = User.objects.create_user(
            username="p2c_s_t2",
            first_name="Other",
            last_name="Student",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        self.s_t2 = StudentProfile.objects.create(
            user=self.s_t2_u,
            institution=self.institution,
            department=self.department,
            teacher=self.teacher_2,
            class_status=StudentProfile.ClassStatus.RUNNING,
        )

        self.coord_client = APIClient()
        self.coord_client.force_authenticate(user=self.manager)
        self.teacher_client = APIClient()
        self.teacher_client.force_authenticate(user=self.t1_user)
        self.other_client = APIClient()
        self.other_client.force_authenticate(user=self.other_manager)

    def test_teacher_details_identity_counts_and_historical_separation(self):
        res1 = self.coord_client.get(f"/api/academy/teachers/{self.teacher_1.id}/details/")
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res1.data["teacher"]["id"], self.teacher_1.id)
        self.assertEqual(res1.data["teacher"]["display_number"], "26")
        self.assertEqual(res1.data["summary"]["active_students_count"], 1)
        self.assertEqual(res1.data["summary"]["dropped_students_count"], 1)
        self.assertEqual(res1.data["summary"]["on_leave_students_count"], 1)
        self.assertEqual(res1.data["summary"]["active_schedules_count"], 2)

        # Multi-schedule student appears once in active_students with 2 schedules
        self.assertEqual(len(res1.data["active_students"]), 1)
        self.assertEqual(res1.data["active_students"][0]["student_id"], self.s_active.id)
        self.assertEqual(res1.data["active_students"][0]["scheduled_classes_count"], 2)

        # Dropped and On-Leave students categorized accurately with active login account preserved
        dl_by_id = {row["student_id"]: row for row in res1.data["dropped_leave_students"]}
        self.assertEqual(set(dl_by_id.keys()), {self.s_drop.id, self.s_leave.id})
        self.assertTrue(dl_by_id[self.s_drop.id]["is_dropped"])
        self.assertTrue(dl_by_id[self.s_drop.id]["account_is_active"])
        self.assertEqual(dl_by_id[self.s_drop.id]["reason"], "Stopped attending")
        self.assertTrue(dl_by_id[self.s_leave.id]["is_on_leave"])

        # Same-named teacher_2 has completely separate data
        res2 = self.coord_client.get(f"/api/academy/teachers/{self.teacher_2.id}/details/")
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(res2.data["teacher"]["id"], self.teacher_2.id)
        self.assertEqual([s["student_id"] for s in res2.data["active_students"]], [self.s_t2.id])
        self.assertEqual(res2.data["dropped_leave_students"], [])
        self.assertEqual(res2.data["historical_dropped_classes"], [])

        # Restoring s_drop returns it to active_students
        self.s_drop.class_status = StudentProfile.ClassStatus.RUNNING
        self.s_drop.save(update_fields=["class_status"])
        res1_after = self.coord_client.get(f"/api/academy/teachers/{self.teacher_1.id}/details/")
        self.assertEqual(res1_after.data["summary"]["active_students_count"], 2)
        self.assertEqual(res1_after.data["summary"]["dropped_students_count"], 0)
        # Historical dropped record remains in historical_dropped_classes
        self.assertEqual(len(res1_after.data["historical_dropped_classes"]), 1)

    def test_teacher_details_permissions_and_department_isolation(self):
        t_res = self.teacher_client.get(f"/api/academy/teachers/{self.teacher_1.id}/details/")
        self.assertEqual(t_res.status_code, 403)

        o_res = self.other_client.get(f"/api/academy/teachers/{self.teacher_1.id}/details/")
        self.assertEqual(o_res.status_code, 404)
