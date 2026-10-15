from datetime import date, timedelta
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from accounts.models import Department, Feature, Institution, User
from accounts.serializers import CreateAccountSerializer
from academy.models import Attendance, StudentProfile, TeacherProfile
from academy.views import AcademyStateView, AttendanceListCreateView
from tuition.models import TuitionAttendance
from tuition.views import TuitionAttendanceListCreateView


class QuranFixtureMixin:
    def setUp(self):
        self.factory = APIRequestFactory()
        self.institution = Institution.objects.create(name="Pagination Test", slug="pagination-test")
        self.department = Department.objects.create(
            institution=self.institution,
            name="Quran A",
            code="quran-a",
            department_type=Department.DepartmentType.QURAN,
        )
        self.other_department = Department.objects.create(
            institution=self.institution,
            name="Quran B",
            code="quran-b",
            department_type=Department.DepartmentType.QURAN,
        )
        self.manager = self.user("manager", User.Role.COORDINATOR, self.department)
        self.teacher_user = self.user("teacher", User.Role.TEACHER, self.department)
        self.teacher = TeacherProfile.objects.create(
            user=self.teacher_user, institution=self.institution, department=self.department
        )
        self.student_user = self.user("student", User.Role.STUDENT, self.department)
        self.student = StudentProfile.objects.create(
            user=self.student_user,
            teacher=self.teacher,
            institution=self.institution,
            department=self.department,
        )

    def user(self, username, role, department):
        return User.objects.create_user(
            username=username,
            password="fixture-password",
            role=role,
            institution=self.institution,
            department=department,
        )

    def response(self, user, query=""):
        request = self.factory.get(f"/api/academy/attendance/{query}")
        force_authenticate(request, user=user)
        return AttendanceListCreateView.as_view()(request)


class AttendancePaginationTests(QuranFixtureMixin, TestCase):
    def setUp(self):
        super().setUp()
        start = date.today() - timedelta(days=4000)
        rows = [
            Attendance(
                entity_type=Attendance.EntityType.STUDENT,
                student=self.student,
                teacher=self.teacher,
                institution=self.institution,
                department=self.department,
                date=start + timedelta(days=index),
                status=Attendance.Status.PRESENT,
                marked_by=self.manager,
            )
            for index in range(4001)
        ]
        Attendance.objects.bulk_create(rows, batch_size=500)
        other_user = self.user("other-student", User.Role.STUDENT, self.other_department)
        other_teacher_user = self.user("other-teacher", User.Role.TEACHER, self.other_department)
        other_teacher = TeacherProfile.objects.create(
            user=other_teacher_user, institution=self.institution, department=self.other_department
        )
        other_student = StudentProfile.objects.create(
            user=other_user, teacher=other_teacher,
            institution=self.institution, department=self.other_department,
        )
        Attendance.objects.bulk_create([
            Attendance(
                entity_type=Attendance.EntityType.STUDENT,
                student=other_student,
                teacher=other_teacher,
                institution=self.institution,
                department=self.other_department,
                date=start + timedelta(days=index),
                status=Attendance.Status.ABSENT,
                marked_by=self.manager,
            )
            for index in range(25)
        ])

    def test_manager_can_page_all_authorized_records_above_four_thousand(self):
        first = self.response(self.manager, "?scope=state&page=1&page_size=500")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data["count"], 4001)
        self.assertEqual(first.data["page_size"], 500)
        self.assertEqual(first.data["total_pages"], 9)
        self.assertEqual(len(first.data["results"]), 500)
        self.assertEqual(first.data["status_counts"], {"present": 4001})
        last = self.response(self.manager, f"?scope=state&page=9&page_size=500&snapshot={first.data['snapshot']}")
        self.assertEqual(last.status_code, 200)
        self.assertEqual(last.data["count"], 4001)
        self.assertEqual(len(last.data["results"]), 1)
        ids = {row["id"] for row in first.data["results"]}
        self.assertFalse(ids.intersection(row["id"] for row in last.data["results"]))

    def test_page_size_is_bounded_and_roles_cannot_escape_scope(self):
        manager = self.response(self.manager, "?scope=state&page_size=10000")
        teacher = self.response(self.teacher_user, "?scope=state&page_size=500")
        student = self.response(self.student_user, "?scope=state&page_size=500")
        self.assertEqual(manager.data["page_size"], 500)
        self.assertEqual(teacher.data["count"], 4001)
        self.assertEqual(student.data["count"], 4001)
        self.assertTrue(all(row["status"] == "present" for row in manager.data["results"]))

    def test_state_bootstrap_returns_today_only_and_total(self):
        request = self.factory.get("/api/academy/state/")
        force_authenticate(request, user=self.manager)
        response = AcademyStateView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["attendance_count"], 4001)
        self.assertLessEqual(len(response.data["attendance"]), 1)
        self.assertTrue(all(item["date"] == str(date.today()) for item in response.data["attendance"]))


class QuranImportSafetyTests(QuranFixtureMixin, TestCase):
    def post_account(self, payload):
        request = self.factory.post("/api/auth/accounts/", payload, format="json")
        force_authenticate(request, user=self.manager)
        from accounts.views import CoordinatorAccountListCreateView
        return CoordinatorAccountListCreateView.as_view()(request)

    def teacher_payload(self, username):
        return {
            "role": "teacher", "username": username, "password": "safe-password",
            "first_name": "Teacher", "last_name": username, "bulk_import": True,
        }

    def student_payload(self, username, teacher_id):
        return {
            "role": "student", "username": username, "password": "safe-password",
            "first_name": "Student", "last_name": username, "teacher_id": teacher_id,
            "time_slot": "16:00", "class_days": ["Monday"], "bulk_import": True,
        }

    def test_imports_40_then_140_without_user_throttle(self):
        teacher_response = self.post_account(self.teacher_payload("bulk-teacher"))
        self.assertEqual(teacher_response.status_code, 201)
        teacher_id = teacher_response.data["teacher_profile"]["id"]
        for index in range(40):
            self.assertEqual(self.post_account(self.student_payload(f"first-{index}", teacher_id)).status_code, 201)
        for index in range(140):
            self.assertEqual(self.post_account(self.student_payload(f"second-{index}", teacher_id)).status_code, 201)
        # The fixture supplies one pre-existing student, plus 40 then 140 imports.
        self.assertEqual(StudentProfile.objects.filter(department=self.department).count(), 181)

    def test_repeated_import_is_a_conflict_without_a_duplicate(self):
        teacher = self.post_account(self.teacher_payload("repeat-teacher"))
        payload = self.student_payload("stable-student-id", teacher.data["teacher_profile"]["id"])
        self.assertEqual(self.post_account(payload).status_code, 201)
        repeated = self.post_account(payload)
        self.assertEqual(repeated.status_code, 409)
        self.assertEqual(repeated.data["code"], "import_conflict")
        self.assertEqual(User.objects.filter(username="stable-student-id").count(), 1)

    def test_account_transaction_rolls_back_on_a_late_failure(self):
        with patch("accounts.serializers.sync_student_schedules", side_effect=RuntimeError("fixture failure")):
            serializer = CreateAccountSerializer(
                data=self.student_payload("rolled-back-student", self.teacher.id),
                context={"request_user": self.manager},
            )
            self.assertTrue(serializer.is_valid(), serializer.errors)
            with self.assertRaises(RuntimeError):
                serializer.save()
        self.assertFalse(User.objects.filter(username="rolled-back-student").exists())
        self.assertFalse(StudentProfile.objects.filter(user__username="rolled-back-student").exists())


class TuitionAttendancePaginationTests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.institution = Institution.objects.create(name="Tuition Pagination", slug="tuition-pagination")
        self.department = Department.objects.create(
            institution=self.institution,
            name="Tuition A",
            code="tuition-a",
            department_type=Department.DepartmentType.TUITION,
        )
        self.other_department = Department.objects.create(
            institution=self.institution,
            name="Tuition B",
            code="tuition-b",
            department_type=Department.DepartmentType.TUITION,
        )
        self.manager = User.objects.create_user(
            username="tuition-manager",
            password="fixture-password",
            role=User.Role.COORDINATOR,
            institution=self.institution,
            department=self.department,
        )
        teacher_user = User.objects.create_user(
            username="tuition-teacher",
            password="fixture-password",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        student_user = User.objects.create_user(
            username="tuition-student",
            password="fixture-password",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        self.teacher = TeacherProfile.objects.create(
            user=teacher_user, institution=self.institution, department=self.department
        )
        self.student = StudentProfile.objects.create(
            user=student_user,
            teacher=self.teacher,
            institution=self.institution,
            department=self.department,
        )
        for key in ("tab_tuition_dashboard", "tab_tuition_attendance", "tab_tuition_reports"):
            feature, _ = Feature.objects.get_or_create(
                key=key,
                defaults={
                    "name": key,
                    "department_type": Department.DepartmentType.TUITION,
                },
            )
            if feature.department_type != Department.DepartmentType.TUITION:
                feature.department_type = Department.DepartmentType.TUITION
                feature.save(update_fields=["department_type"])
        start = date.today() - timedelta(days=3000)
        TuitionAttendance.objects.bulk_create([
            TuitionAttendance(
                institution=self.institution,
                department=self.department,
                entity_type=TuitionAttendance.EntityType.STUDENT,
                teacher=self.teacher,
                student=self.student,
                date=start + timedelta(days=index),
                status=TuitionAttendance.Status.PRESENT,
                marked_by=self.manager,
            )
            for index in range(3001)
        ], batch_size=500)

    def test_manager_pages_tuition_history_without_cross_department_rows(self):
        request = self.factory.get(
            f"/api/tuition/attendance/?department_id={self.department.id}&page=1&page_size=500"
        )
        force_authenticate(request, user=self.manager)
        response = TuitionAttendanceListCreateView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 3001)
        self.assertEqual(response.data["page_size"], 500)
        self.assertEqual(response.data["total_pages"], 7)
        self.assertEqual(len(response.data["results"]), 500)
        self.assertEqual(response.data["status_counts"], {"present": 3001})
