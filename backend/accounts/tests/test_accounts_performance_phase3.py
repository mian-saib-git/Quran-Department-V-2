from datetime import date, time
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase

from academy.models import ClassSchedule, StudentProfile, TeacherProfile
from accounts.models import Department, DepartmentFeature, Feature, Institution, User, UserDepartmentRole
from tuition.models import (
    TuitionClassLevel,
    TuitionEnrollment,
    TuitionSubject,
    TuitionTeacherCapability,
)


@override_settings(ALLOWED_HOSTS=["testserver", "localhost"])
class AccountsPerformancePhase3Tests(APITestCase):
    def setUp(self):
        self.institution = Institution.objects.create(
            name="IVS Academy",
            is_active=True,
        )
        self.quran_dept = Department.objects.create(
            institution=self.institution,
            name="Quran Academy",
            code="quran-p3",
            department_type=Department.DepartmentType.QURAN,
            is_active=True,
        )
        self.tuition_dept = Department.objects.create(
            institution=self.institution,
            name="Tuition Academy",
            code="tuition-p3",
            department_type=Department.DepartmentType.TUITION,
            is_active=True,
        )
        self.other_quran_dept = Department.objects.create(
            institution=self.institution,
            name="Quran Other",
            code="quran-other-p3",
            department_type=Department.DepartmentType.QURAN,
            is_active=True,
        )

        feat, _ = Feature.objects.get_or_create(
            key="tab_tuition_accounts",
            defaults={"name": "Tuition Accounts", "is_active": True},
        )
        DepartmentFeature.objects.create(
            department=self.tuition_dept,
            feature=feat,
            is_enabled=True,
        )

        self.quran_admin = User.objects.create_user(
            username="q_admin_p3",
            password="password123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.quran_dept,
            first_name="Quran",
            last_name="Admin",
        )
        self.quran_coord = User.objects.create_user(
            username="q_coord_p3",
            password="password123",
            role=User.Role.COORDINATOR,
            institution=self.institution,
            department=self.quran_dept,
            first_name="Quran",
            last_name="Coord",
        )
        self.other_coord = User.objects.create_user(
            username="q_other_coord_p3",
            password="password123",
            role=User.Role.COORDINATOR,
            institution=self.institution,
            department=self.other_quran_dept,
            first_name="Other",
            last_name="Coord",
        )

        self.quran_teachers = []
        for idx in range(6):
            u = User.objects.create_user(
                username=f"q_teacher_{idx}_p3",
                password="password123",
                role=User.Role.TEACHER,
                institution=self.institution,
                department=self.quran_dept,
                first_name=f"Teacher{idx}",
            )
            t = TeacherProfile.objects.create(
                user=u,
                institution=self.institution,
                department=self.quran_dept,
                phone=f"030012345{idx}",
            )
            self.quran_teachers.append((u, t))

        self.quran_students = []
        for idx in range(8):
            u = User.objects.create_user(
                username=f"q_student_{idx}_p3",
                password="password123",
                role=User.Role.STUDENT,
                institution=self.institution,
                department=self.quran_dept,
                first_name=f"Student{idx}",
            )
            t_profile = self.quran_teachers[idx % len(self.quran_teachers)][1]
            s = StudentProfile.objects.create(
                user=u,
                institution=self.institution,
                department=self.quran_dept,
                teacher=t_profile,
                phone=f"031112345{idx}",
            )
            ClassSchedule.objects.create(
                institution=self.institution,
                department=self.quran_dept,
                student=s,
                teacher=t_profile,
                weekday="monday",
                time_slot=time(9 + (idx % 4), 0),
                duration_minutes=30,
                is_active=True,
            )
            self.quran_students.append((u, s))

        # Tuition setup
        self.tuition_admin = User.objects.create_user(
            username="t_admin_p3",
            password="password123",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.tuition_dept,
            first_name="Tuition",
            last_name="Admin",
        )
        UserDepartmentRole.objects.create(
            user=self.tuition_admin,
            institution=self.institution,
            department=self.tuition_dept,
            role=User.Role.DEPARTMENT_ADMIN,
            is_active=True,
        )
        self.t_class = TuitionClassLevel.objects.create(
            institution=self.institution,
            department=self.tuition_dept,
            name="Grade 9",
            code="G9",
            is_active=True,
        )
        self.t_subject = TuitionSubject.objects.create(
            institution=self.institution,
            department=self.tuition_dept,
            name="Mathematics",
            code="MATH",
            is_active=True,
        )
        self.t_teachers = []
        for idx in range(5):
            u = User.objects.create_user(
                username=f"t_teacher_{idx}_p3",
                password="password123",
                role=User.Role.TEACHER,
                institution=self.institution,
                department=self.tuition_dept,
                first_name=f"TTeacher{idx}",
            )
            t = TeacherProfile.objects.create(
                user=u,
                institution=self.institution,
                department=self.tuition_dept,
            )
            TuitionTeacherCapability.objects.create(
                institution=self.institution,
                department=self.tuition_dept,
                teacher=t,
                subject=self.t_subject,
                is_active=True,
            )
            self.t_teachers.append((u, t))

        self.t_students = []
        for idx in range(6):
            u = User.objects.create_user(
                username=f"t_student_{idx}_p3",
                password="password123",
                role=User.Role.STUDENT,
                institution=self.institution,
                department=self.tuition_dept,
                first_name=f"TStudent{idx}",
            )
            s = StudentProfile.objects.create(
                user=u,
                institution=self.institution,
                department=self.tuition_dept,
                teacher=self.t_teachers[0][1],
            )
            TuitionEnrollment.objects.create(
                institution=self.institution,
                department=self.tuition_dept,
                student=s,
                teacher=self.t_teachers[idx % len(self.t_teachers)][1],
                class_level=self.t_class,
                subject=self.t_subject,
                start_date=date.today(),
                is_active=True,
            )
            self.t_students.append((u, s))

    def test_quran_paginated_teachers_and_counts_with_bounded_queries(self):
        self.client.force_authenticate(user=self.quran_admin)
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get("/api/auth/accounts/?role=teacher&page=1&page_size=2")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["teachers"]), 2)
        self.assertEqual(data["students"], [])
        self.assertEqual(data["pagination"]["total_items"], 6)
        self.assertEqual(data["pagination"]["total_pages"], 3)
        self.assertEqual(data["counts"]["coordinators"], 1)
        self.assertEqual(data["counts"]["teachers"], 6)
        self.assertEqual(data["counts"]["students"], 8)
        self.assertEqual(data["counts"]["active_accounts"], 15)
        self.assertLessEqual(len(ctx), 15)

    def test_quran_paginated_students_search_time_filter_and_export(self):
        self.client.force_authenticate(user=self.quran_coord)
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get("/api/auth/accounts/?role=student&page=1&page_size=3&include_teachers=0")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data["students"]), 3)
        self.assertEqual(data["teachers"], [])
        self.assertEqual(data["counts"]["coordinators"], 0)
        self.assertEqual(data["counts"]["students"], 8)
        self.assertLessEqual(len(ctx), 16)

        # Time filter (11:00 to 12:00 matches idx 2,3,6,7)
        t_resp = self.client.get("/api/auth/accounts/?role=student&page=1&page_size=10&time_from=11:00&time_to=12:00&include_teachers=0")
        self.assertEqual(t_resp.status_code, 200)
        self.assertEqual(t_resp.json()["pagination"]["total_items"], 4)

        # Server-side search
        s_resp = self.client.get("/api/auth/accounts/?role=student&search=q_student_5_p3&include_teachers=0")
        self.assertEqual(s_resp.status_code, 200)
        self.assertEqual(len(s_resp.json()["students"]), 1)

        # Export all students
        e_resp = self.client.get("/api/auth/accounts/?role=student&export=1")
        self.assertEqual(e_resp.status_code, 200)
        self.assertEqual(len(e_resp.json()["students"]), 8)

    def test_quran_permissions_and_cross_department_isolation(self):
        teacher_user = self.quran_teachers[0][0]
        self.client.force_authenticate(user=teacher_user)
        resp = self.client.get("/api/auth/accounts/?role=student")
        self.assertEqual(resp.status_code, 403)

        self.client.force_authenticate(user=self.other_coord)
        other_resp = self.client.get("/api/auth/accounts/?role=student")
        self.assertEqual(other_resp.status_code, 200)
        self.assertEqual(other_resp.json()["students"], [])
        self.assertEqual(other_resp.json()["counts"]["students"], 0)

    def test_tuition_paginated_accounts_enrollments_and_options_bounded_queries(self):
        self.client.force_authenticate(user=self.tuition_admin)

        with CaptureQueriesContext(connection) as ctx_t:
            t_resp = self.client.get(
                f"/api/tuition/accounts/?department_id={self.tuition_dept.id}&role=teacher&page=1&page_size=3"
            )
        self.assertEqual(t_resp.status_code, 200)
        t_data = t_resp.json()
        self.assertEqual(len(t_data["results"]), 3)
        self.assertEqual(t_data["counts"]["teachers"], 5)
        self.assertEqual(t_data["counts"]["students"], 6)
        self.assertEqual(t_data["counts"]["active_enrollments"], 6)
        self.assertLessEqual(len(ctx_t), 18)

        with CaptureQueriesContext(connection) as ctx_s:
            s_resp = self.client.get(
                f"/api/tuition/accounts/?department_id={self.tuition_dept.id}&role=student&page=1&page_size=3"
            )
        self.assertEqual(s_resp.status_code, 200)
        s_data = s_resp.json()
        self.assertEqual(len(s_data["results"]), 3)
        self.assertTrue(len(s_data["results"][0]["active_enrollments"]) >= 1)
        self.assertLessEqual(len(ctx_s), 18)

        # Search by subject name
        search_resp = self.client.get(
            f"/api/tuition/accounts/?department_id={self.tuition_dept.id}&role=student&search=Mathematics"
        )
        self.assertEqual(search_resp.status_code, 200)
        self.assertEqual(search_resp.json()["pagination"]["total_items"], 6)

        with CaptureQueriesContext(connection) as ctx_o:
            o_resp = self.client.get(f"/api/tuition/options/?department_id={self.tuition_dept.id}")
        self.assertEqual(o_resp.status_code, 200)
        self.assertEqual(len(o_resp.json()["teachers"]), 5)
        self.assertLessEqual(len(ctx_o), 15)

        # Cross-department isolation: Quran admin cannot access Tuition accounts
        self.client.force_authenticate(user=self.quran_admin)
        forbidden = self.client.get(
            f"/api/tuition/accounts/?department_id={self.tuition_dept.id}&role=student"
        )
        self.assertEqual(forbidden.status_code, 403)

    def test_quran_pagination_boundaries_and_midnight_wrap_time_filter(self):
        self.client.force_authenticate(user=self.quran_admin)
        # Collect all students across pages (page_size=3 -> 3 pages for 8 students)
        seen_ids = []
        for p in (1, 2, 3):
            res = self.client.get(f"/api/auth/accounts/?role=student&page={p}&page_size=3&include_teachers=0")
            self.assertEqual(res.status_code, 200)
            seen_ids.extend([s["id"] for s in res.json()["students"]])
        self.assertEqual(len(seen_ids), 8)
        self.assertEqual(len(set(seen_ids)), 8)

        # Out-of-bounds page clamps to last page
        clamped = self.client.get("/api/auth/accounts/?role=student&page=99&page_size=3&include_teachers=0")
        self.assertEqual(clamped.status_code, 200)
        self.assertEqual(clamped.json()["pagination"]["page"], 3)

        # Midnight-wrap time filter (22:00 to 02:00)
        night_u = User.objects.create_user(
            username="q_night_student_p3",
            password="password123",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.quran_dept,
            first_name="NightStudent",
        )
        night_s = StudentProfile.objects.create(
            user=night_u,
            institution=self.institution,
            department=self.quran_dept,
            teacher=self.quran_teachers[0][1],
        )
        ClassSchedule.objects.create(
            institution=self.institution,
            department=self.quran_dept,
            student=night_s,
            teacher=self.quran_teachers[0][1],
            weekday="tuesday",
            time_slot=time(23, 30),
            duration_minutes=30,
            is_active=True,
        )
        wrap_res = self.client.get(
            "/api/auth/accounts/?role=student&time_from=22:00&time_to=02:00&include_teachers=0"
        )
        self.assertEqual(wrap_res.status_code, 200)
        wrap_usernames = [s["username"] for s in wrap_res.json()["students"]]
        self.assertEqual(wrap_usernames, ["q_night_student_p3"])

    def test_quran_crud_teacher_details_drop_leave_and_schedule_preview(self):
        self.client.force_authenticate(user=self.quran_admin)
        # Create teacher
        t_res = self.client.post(
            "/api/auth/accounts/",
            {
                "role": "teacher",
                "username": "q_new_teacher_p3",
                "password": "password123",
                "first_name": "NewTeacher",
            },
            format="json",
        )
        self.assertEqual(t_res.status_code, 201, t_res.data)
        teacher_profile_id = t_res.json()["teacher_profile"]["id"]

        # Create student assigned to new teacher
        s_res = self.client.post(
            "/api/auth/accounts/",
            {
                "role": "student",
                "username": "q_new_student_p3",
                "password": "password123",
                "first_name": "NewStudent",
                "teacher_id": teacher_profile_id,
                "time_slot": "15:00",
                "duration_minutes": 30,
                "class_days": ["monday", "wednesday"],
            },
            format="json",
        )
        self.assertEqual(s_res.status_code, 201, s_res.data)
        student_user_id = s_res.json()["id"]

        # Teacher Details popup endpoint returns active students & schedule
        td_res = self.client.get(f"/api/academy/teachers/{teacher_profile_id}/details/")
        self.assertEqual(td_res.status_code, 200)
        self.assertEqual(len(td_res.json()["active_students"]), 1)

        # Class-day salary change preview
        prev_res = self.client.post(
            "/api/academy/schedule-change-preview/",
            {
                "user_id": student_user_id,
                "teacher_id": teacher_profile_id,
                "time_slot": "15:00",
                "duration_minutes": 30,
                "class_days": ["monday", "wednesday", "friday"],
            },
            format="json",
        )
        self.assertEqual(prev_res.status_code, 200, prev_res.data)

        # Update student to On Leave & verify academic status in paginated endpoint
        patch_res = self.client.patch(
            f"/api/auth/accounts/{student_user_id}/",
            {"class_status": StudentProfile.ClassStatus.ON_LEAVE},
            format="json",
        )
        self.assertEqual(patch_res.status_code, 200, patch_res.data)
        search_res = self.client.get(
            "/api/auth/accounts/?role=student&search=q_new_student_p3&include_teachers=0"
        )
        self.assertEqual(search_res.status_code, 200)
        self.assertEqual(
            search_res.json()["students"][0]["student_profile"]["class_status"],
            StudentProfile.ClassStatus.ON_LEAVE,
        )

    def test_tuition_deferred_scheduling_matrix_and_enrollment_edit(self):
        self.client.force_authenticate(user=self.tuition_admin)
        matrix_res = self.client.get(f"/api/tuition/scheduling/?department_id={self.tuition_dept.id}")
        self.assertEqual(matrix_res.status_code, 200)
        self.assertIn("schedules", matrix_res.json())
        self.assertIn("availability", matrix_res.json())
