from datetime import time

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Department, Institution, User
from academy.models import ClassSchedule, StudentProfile, StudentSubject, SubjectName, TeacherProfile


class DashboardViewNPlusOneTests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(
            name="Dashboard Perf Inst",
            slug="dashboard-perf-inst",
        )
        self.dept_a = Department.objects.create(
            institution=self.institution,
            name="Quran A",
            code="quran-perf-a",
            department_type=Department.DepartmentType.QURAN,
        )
        self.dept_b = Department.objects.create(
            institution=self.institution,
            name="Quran B",
            code="quran-perf-b",
            department_type=Department.DepartmentType.QURAN,
        )
        self.coordinator = User.objects.create_user(
            username="coord_perf_a",
            password="Password123!",
            role=User.Role.COORDINATOR,
            institution=self.institution,
            department=self.dept_a,
        )
        self.teacher_user = User.objects.create_user(
            username="teacher_perf_a",
            password="Password123!",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.dept_a,
        )
        self.teacher = TeacherProfile.objects.create(
            user=self.teacher_user,
            institution=self.institution,
            department=self.dept_a,
        )
        # Department B data that must never leak into Department A
        self.other_teacher_user = User.objects.create_user(
            username="teacher_perf_b",
            password="Password123!",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.dept_b,
        )
        self.other_teacher = TeacherProfile.objects.create(
            user=self.other_teacher_user,
            institution=self.institution,
            department=self.dept_b,
        )
        other_student_user = User.objects.create_user(
            username="student_perf_b",
            password="Password123!",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.dept_b,
        )
        self.other_student = StudentProfile.objects.create(
            user=other_student_user,
            teacher=self.other_teacher,
            institution=self.institution,
            department=self.dept_b,
        )
        ClassSchedule.objects.create(
            institution=self.institution,
            department=self.dept_b,
            teacher=self.other_teacher,
            student=self.other_student,
            weekday=ClassSchedule.WeekDay.MONDAY,
            time_slot=time(9, 0),
            duration_minutes=30,
            is_active=True,
        )

    def _add_student_with_schedules(self, index, active_schedule=True):
        s_user = User.objects.create_user(
            username=f"student_perf_a_{index}",
            password="Password123!",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.dept_a,
        )
        student = StudentProfile.objects.create(
            user=s_user,
            teacher=self.teacher,
            institution=self.institution,
            department=self.dept_a,
        )
        StudentSubject.objects.create(
            institution=self.institution,
            department=self.dept_a,
            student=student,
            subject=SubjectName.NAZIRA,
            is_active=True,
        )
        StudentSubject.objects.create(
            institution=self.institution,
            department=self.dept_a,
            student=student,
            subject=SubjectName.MEMORIZATION,
            is_active=False,
        )
        ClassSchedule.objects.create(
            institution=self.institution,
            department=self.dept_a,
            teacher=self.teacher,
            student=student,
            weekday=ClassSchedule.WeekDay.MONDAY,
            time_slot=time(10, index % 60),
            duration_minutes=30,
            is_active=active_schedule,
        )
        if active_schedule:
            ClassSchedule.objects.create(
                institution=self.institution,
                department=self.dept_a,
                teacher=self.teacher,
                student=student,
                weekday=ClassSchedule.WeekDay.TUESDAY,
                time_slot=time(11, index % 60),
                duration_minutes=30,
                is_active=True,
            )
        return student

    def _get_dashboard_with_query_count(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        with CaptureQueriesContext(connection) as ctx:
            resp = client.get("/api/academy/dashboard/", HTTP_HOST="localhost")
        self.assertEqual(resp.status_code, 200)
        return resp.json(), len(ctx)

    def test_dashboard_queries_do_not_scale_with_students_or_schedules(self):
        first_student = self._add_student_with_schedules(1, active_schedule=True)

        coord_data_1, coord_q_1 = self._get_dashboard_with_query_count(self.coordinator)
        teacher_data_1, teacher_q_1 = self._get_dashboard_with_query_count(self.teacher_user)
        student_data_1, student_q_1 = self._get_dashboard_with_query_count(first_student.user)

        # Add 9 more students (1 with only an inactive schedule) and 17 more schedules
        inactive_only_student = self._add_student_with_schedules(2, active_schedule=False)
        for idx in range(3, 11):
            self._add_student_with_schedules(idx, active_schedule=True)

        coord_data_2, coord_q_2 = self._get_dashboard_with_query_count(self.coordinator)
        teacher_data_2, teacher_q_2 = self._get_dashboard_with_query_count(self.teacher_user)
        student_data_2, student_q_2 = self._get_dashboard_with_query_count(first_student.user)

        # Query count must stay O(1) as students/schedules scale
        self.assertEqual(coord_q_1, coord_q_2)
        self.assertEqual(teacher_q_1, teacher_q_2)
        self.assertEqual(student_q_1, student_q_2)
        self.assertLessEqual(coord_q_2, 20)
        self.assertLessEqual(teacher_q_2, 20)
        self.assertLessEqual(student_q_2, 15)

        # Verify inactive-only schedule still populates enrollment_date
        teacher_students = {s["id"]: s for s in teacher_data_2["students"]}
        self.assertIsNotNone(teacher_students[inactive_only_student.id]["enrollment_date"])

        # Verify only active subjects are returned
        for sched in coord_data_2["schedules"]:
            self.assertEqual(
                [subj["subject"] for subj in sched["student"]["assigned_subjects"]],
                [SubjectName.NAZIRA],
            )
            self.assertNotEqual(sched["student"]["id"], self.other_student.id)

        # Verify department isolation in counts and teacher students
        self.assertEqual(coord_data_2["counts"]["students"], 10)
        self.assertNotIn(self.other_student.id, teacher_students)
        self.assertEqual(len(student_data_2["schedules"]), 2)
