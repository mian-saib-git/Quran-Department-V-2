from datetime import timedelta, time

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from accounts.models import Department, Institution, User
from accounts.teacher_retirement_api import TeacherRetirementView
from accounts.views import CoordinatorAccountDetailView, CoordinatorAccountListCreateView
from academy.models import Attendance, ClassSchedule, StudentClassHistory, StudentProfile, TeacherProfile, QuranSalaryLedgerEntry, QuranTeacherMonthlyPayroll


class TeacherRetirementWorkflowTests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(name="Retirement Test Institution", slug="retirement-test-institution")
        self.department = Department.objects.create(
            institution=self.institution, name="Quran", code="quran-retire-test",
            department_type=Department.DepartmentType.QURAN,
        )
        self.admin = self._user("retirement-admin", User.Role.DEPARTMENT_ADMIN)
        self.teacher_user = self._user("retirement-source", User.Role.TEACHER)
        self.destination_user = self._user("retirement-destination", User.Role.TEACHER)
        self.teacher = TeacherProfile.objects.create(user=self.teacher_user, department=self.department, institution=self.institution)
        self.destination = TeacherProfile.objects.create(user=self.destination_user, department=self.department, institution=self.institution)
        self.student_user = self._user("retirement-student", User.Role.STUDENT)
        self.student = StudentProfile.objects.create(
            user=self.student_user, teacher=self.teacher, department=self.department, institution=self.institution,
            class_status=StudentProfile.ClassStatus.ON_LEAVE,
        )
        self.today = timezone.localdate()
        self.schedule = ClassSchedule.objects.create(
            student=self.student, teacher=self.teacher, weekday=ClassSchedule.WeekDay.MONDAY,
            time_slot=time(14, 0), is_active=True, effective_from=self.today - timedelta(days=15),
        )
        self.factory = APIRequestFactory()

    def _user(self, username, role):
        return User.objects.create_user(
            username=username, password="local-test-only-password", role=role,
            department=self.department, institution=self.institution,
        )

    def _request(self, method, path, view, **kwargs):
        request = getattr(self.factory, method)(path, data=kwargs.pop("payload", None), format="json")
        force_authenticate(request, user=kwargs.pop("actor", self.admin))
        return view.as_view()(request, **kwargs)

    def _retire(self):
        return self._request("delete", f"/api/auth/accounts/{self.teacher_user.pk}/", CoordinatorAccountDetailView, user_id=self.teacher_user.pk)

    def _preview(self):
        return self._request("get", f"/api/auth/accounts/{self.teacher_user.pk}/teacher-retirement/", TeacherRetirementView, user_id=self.teacher_user.pk)

    def _transfer(self, destination_id=None, student_id=None):
        return self._request(
            "post", f"/api/auth/accounts/{self.teacher_user.pk}/teacher-retirement/", TeacherRetirementView,
            user_id=self.teacher_user.pk,
            payload={"student_id": student_id or self.student.pk,
                     "destination_teacher_id": destination_id or self.destination.pk},
        )

    def test_teacher_with_on_leave_student_and_active_class_cannot_delete_login(self):
        preview = self._preview()
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data["assigned_students"], 1)
        self.assertEqual(preview.data["active_classes"], 1)
        self.assertFalse(preview.data["can_archive"])
        denied = self._retire()
        self.assertEqual(denied.status_code, 409, denied.data)
        self.teacher_user.refresh_from_db()
        self.assertTrue(self.teacher_user.is_active)
        self.assertTrue(User.objects.filter(pk=self.student_user.pk).exists())
        self.assertTrue(ClassSchedule.objects.filter(pk=self.schedule.pk).exists())

    def test_transfer_preserves_history_then_deletes_login_without_deleting_student(self):
        transferred = self._transfer()
        self.assertEqual(transferred.status_code, 200, transferred.data)
        self.student.refresh_from_db()
        self.schedule.refresh_from_db()
        self.assertEqual(self.student.teacher_id, self.destination.pk)
        self.assertFalse(self.schedule.is_active)
        self.assertEqual(self.schedule.effective_to, self.today - timedelta(days=1))
        self.assertTrue(ClassSchedule.objects.filter(student=self.student, teacher=self.destination, is_active=True).exists())
        self.assertTrue(StudentClassHistory.objects.filter(
            student=self.student, previous_teacher=self.teacher, new_teacher=self.destination,
            event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
        ).exists())
        self.assertTrue(self._preview().data["can_archive"])
        result = self._retire()
        self.assertEqual(result.status_code, 200, result.data)
        self.assertFalse(User.objects.filter(pk=self.teacher_user.pk).exists())
        former = TeacherProfile.objects.get(pk=self.teacher.pk)
        self.assertIsNone(former.user_id)
        self.assertIsNotNone(former.login_deleted_at)
        self.assertEqual(former.login_deleted_effective_date, self.today)
        self.assertTrue(StudentProfile.objects.filter(pk=self.student.pk).exists())
        self.assertTrue(ClassSchedule.objects.filter(pk=self.schedule.pk).exists())

    def test_no_transfer_to_self_other_department_or_inactive_teacher(self):
        self.assertEqual(self._transfer(destination_id=self.teacher.pk).status_code, 400)
        other_dept = Department.objects.create(institution=self.institution, name="Other Quran", code="other-retire", department_type=Department.DepartmentType.QURAN)
        other_user = User.objects.create_user(username="retire-outsider", password="local-test-password", role=User.Role.TEACHER, department=other_dept, institution=self.institution)
        other_teacher = TeacherProfile.objects.create(user=other_user, department=other_dept, institution=self.institution)
        self.assertEqual(self._transfer(destination_id=other_teacher.pk).status_code, 400)
        self.destination_user.is_active = False
        self.destination_user.save(update_fields=["is_active"])
        self.assertEqual(self._transfer().status_code, 400)
        self.student.refresh_from_db()
        self.assertEqual(self.student.teacher_id, self.teacher.pk)

    def test_empty_teacher_can_delete_login_without_deleting_historical_data(self):
        self.student.teacher = self.destination
        self.student.save(update_fields=["teacher"])
        self.schedule.is_active = False
        self.schedule.effective_to = self.today - timedelta(days=1)
        self.schedule.save(update_fields=["is_active", "effective_to"])
        result = self._retire()
        self.assertEqual(result.status_code, 200, result.data)
        self.assertFalse(User.objects.filter(pk=self.teacher_user.pk).exists())
        self.assertTrue(TeacherProfile.objects.filter(pk=self.teacher.pk, user__isnull=True).exists())
        self.assertTrue(User.objects.filter(pk=self.student_user.pk).exists())
        self.assertTrue(ClassSchedule.objects.filter(pk=self.schedule.pk).exists())

    def test_cannot_delete_login_with_orphan_active_schedule(self):
        self.student.teacher = self.destination
        self.student.save(update_fields=["teacher"])
        preview = self._preview()
        self.assertEqual(preview.data["assigned_students"], 0)
        self.assertEqual(preview.data["active_classes"], 1)
        self.assertEqual(self._retire().status_code, 409)

    def test_paid_historical_payroll_and_attendance_survive_transfer_and_login_deletion(self):
        historical_day = self.today.replace(day=1) - timedelta(days=1)
        attendance = Attendance.objects.create(
            teacher=self.teacher, student=self.student, marked_by=self.admin,
            date=historical_day, entity_type=Attendance.EntityType.STUDENT,
            status=Attendance.Status.PRESENT, class_key="14:00",
        )
        payroll = QuranTeacherMonthlyPayroll.objects.create(
            department=self.department, institution=self.institution,
            teacher=self.teacher, year=historical_day.year, month=historical_day.month,
            status=QuranTeacherMonthlyPayroll.Status.PAID, final_total="80.00",
        )
        ledger = QuranSalaryLedgerEntry.objects.create(
            payroll=payroll, department=self.department, teacher=self.teacher,
            student=self.student, entry_type=QuranSalaryLedgerEntry.EntryType.NORMAL_EARNING,
            effective_date=historical_day, amount="80.00",
        )
        self.assertEqual(self._transfer().status_code, 200)
        self.assertEqual(self._retire().status_code, 200)
        self.assertFalse(User.objects.filter(pk=self.teacher_user.pk).exists())
        self.assertTrue(TeacherProfile.objects.filter(pk=self.teacher.pk, user__isnull=True).exists())
        self.assertTrue(Attendance.objects.filter(pk=attendance.pk).exists())
        self.assertTrue(QuranTeacherMonthlyPayroll.objects.filter(pk=payroll.pk, status=QuranTeacherMonthlyPayroll.Status.PAID).exists())
        self.assertTrue(QuranSalaryLedgerEntry.objects.filter(pk=ledger.pk).exists())

    def _new_destination(self, suffix):
        user = self._user(f"retire-dest-{suffix}", User.Role.TEACHER)
        return TeacherProfile.objects.create(
            user=user, department=self.department, institution=self.institution,
        )

    def _new_source_student(self, suffix, day, hour):
        user = self._user(f"retire-student-{suffix}", User.Role.STUDENT)
        student = StudentProfile.objects.create(
            user=user, teacher=self.teacher, department=self.department,
            institution=self.institution,
        )
        ClassSchedule.objects.create(
            student=student, teacher=self.teacher, weekday=day,
            time_slot=time(hour, 0), duration_minutes=30, is_active=True,
            effective_from=self.today - timedelta(days=15),
        )
        return student

    def _occupy(self, teacher, suffix, day, hour, minutes=30):
        user = self._user(f"occupied-student-{suffix}", User.Role.STUDENT)
        student = StudentProfile.objects.create(
            user=user, teacher=teacher, department=self.department, institution=self.institution,
        )
        ClassSchedule.objects.create(
            student=student, teacher=teacher, weekday=day, time_slot=time(hour, minutes),
            duration_minutes=30, is_active=True, effective_from=self.today - timedelta(days=15),
        )
        return student

    def test_preview_filters_overlapping_slots_but_keeps_free_teachers(self):
        busy = self.destination
        free = self._new_destination("free")
        self._occupy(busy, "monday", ClassSchedule.WeekDay.MONDAY, 14, 15)
        preview = self._preview()
        self.assertEqual(preview.status_code, 200, preview.data)
        student = preview.data["students"][0]
        self.assertIn(free.pk, student["available_teacher_ids"])
        self.assertNotIn(busy.pk, student["available_teacher_ids"])
        self.assertEqual(student["schedule"][0]["weekday"], ClassSchedule.WeekDay.MONDAY)

    def test_single_transfer_rejects_overlap_on_backend(self):
        self._occupy(self.destination, "busy", ClassSchedule.WeekDay.MONDAY, 14, 15)
        result = self._transfer()
        self.assertEqual(result.status_code, 409, result.data)
        self.student.refresh_from_db()
        self.assertEqual(self.student.teacher_id, self.teacher.id)

    def test_multiple_students_can_go_to_different_teachers_in_one_request(self):
        second = self._new_source_student("two", ClassSchedule.WeekDay.TUESDAY, 15)
        second_destination = self._new_destination("second")
        result = self._request(
            "post", f"/api/auth/accounts/{self.teacher_user.pk}/teacher-retirement/",
            TeacherRetirementView, user_id=self.teacher_user.pk,
            payload={"transfers": [
                {"student_id": self.student.pk, "destination_teacher_id": self.destination.pk},
                {"student_id": second.pk, "destination_teacher_id": second_destination.pk},
            ]},
        )
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(len(result.data["transferred"]), 2)
        self.student.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(self.student.teacher_id, self.destination.id)
        self.assertEqual(second.teacher_id, second_destination.id)
        self.assertTrue(self._preview().data["can_archive"])

    def test_batch_conflict_rolls_back_every_transfer(self):
        second = self._new_source_student("rollback", ClassSchedule.WeekDay.TUESDAY, 14)
        self._occupy(self.destination, "blocked", ClassSchedule.WeekDay.TUESDAY, 14, 15)
        result = self._request(
            "post", f"/api/auth/accounts/{self.teacher_user.pk}/teacher-retirement/",
            TeacherRetirementView, user_id=self.teacher_user.pk,
            payload={"transfers": [
                {"student_id": self.student.pk, "destination_teacher_id": self.destination.pk},
                {"student_id": second.pk, "destination_teacher_id": self.destination.pk},
            ]},
        )
        self.assertEqual(result.status_code, 409, result.data)
        self.student.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(self.student.teacher_id, self.teacher.pk)
        self.assertEqual(second.teacher_id, self.teacher.pk)
        self.assertTrue(self.schedule.is_active)
        self.assertFalse(StudentClassHistory.objects.filter(
            student=self.student,
            event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
        ).exists())

    def test_batch_detects_two_planned_classes_at_same_destination_slot(self):
        second = self._new_source_student("duplicate", ClassSchedule.WeekDay.MONDAY, 14)
        result = self._request(
            "post", f"/api/auth/accounts/{self.teacher_user.pk}/teacher-retirement/",
            TeacherRetirementView, user_id=self.teacher_user.pk,
            payload={"transfers": [
                {"student_id": self.student.pk, "destination_teacher_id": self.destination.pk},
                {"student_id": second.pk, "destination_teacher_id": self.destination.pk},
            ]},
        )
        self.assertEqual(result.status_code, 409, result.data)
        self.student.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(self.student.teacher_id, self.teacher.pk)
        self.assertEqual(second.teacher_id, self.teacher.pk)

    def test_deleted_teacher_is_not_visible_in_active_teacher_list(self):
        source_user_id = self.teacher_user.pk
        source_username = self.teacher_user.username
        self.assertEqual(self._transfer().status_code, 200)
        self.assertEqual(self._retire().status_code, 200)
        self.assertFalse(User.objects.filter(pk=source_user_id).exists())
        self.assertFalse(User.objects.filter(username=source_username).exists())
        response = self._request(
            "get", "/api/auth/accounts/?role=teacher", CoordinatorAccountListCreateView,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn(source_user_id, [row["id"] for row in response.data["teachers"]])
        self.assertTrue(TeacherProfile.objects.filter(pk=self.teacher.pk, user__isnull=True).exists())

    def test_deleted_historical_teacher_is_not_offered_as_transfer_destination(self):
        empty_user = self._user("retirement-empty", User.Role.TEACHER)
        empty_teacher = TeacherProfile.objects.create(
            user=empty_user, department=self.department, institution=self.institution,
        )
        response = self._request(
            "delete", f"/api/auth/accounts/{empty_user.pk}/",
            CoordinatorAccountDetailView, user_id=empty_user.pk,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(TeacherProfile.objects.filter(pk=empty_teacher.pk, user__isnull=True).exists())
        preview = self._preview()
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertNotIn(empty_teacher.pk, [row["id"] for row in preview.data["destination_teachers"]])

    def test_slots_allow_back_to_back_classes_but_block_over_midnight(self):
        from accounts.teacher_retirement_service import candidate_is_available
        monday = [{"weekday": "monday", "time_slot": "14:00", "duration_minutes": 30}]
        following = [{"weekday": "monday", "time_slot": "14:30", "duration_minutes": 30}]
        self.assertTrue(candidate_is_available(monday, following))
        night = [{"weekday": "sunday", "time_slot": "23:45", "duration_minutes": 30}]
        monday_morning = [{"weekday": "monday", "time_slot": "00:00", "duration_minutes": 30}]
        self.assertFalse(candidate_is_available(night, monday_morning))
