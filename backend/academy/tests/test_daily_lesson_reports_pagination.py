from datetime import date, timedelta

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Department, Institution, User
from academy.models import (
    DailyLessonReport,
    DailyLessonSubjectEntry,
    StudentProfile,
    SubjectName,
    TeacherProfile,
)


class DailyLessonReportsPaginationTests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(
            name="Lesson Pagination Inst",
            slug="lesson-pagination-inst",
        )
        self.dept_a = Department.objects.create(
            institution=self.institution,
            name="Quran A",
            code="quran-dlr-a",
            department_type=Department.DepartmentType.QURAN,
        )
        self.dept_b = Department.objects.create(
            institution=self.institution,
            name="Quran B",
            code="quran-dlr-b",
            department_type=Department.DepartmentType.QURAN,
        )
        self.coordinator = User.objects.create_user(
            username="coord_dlr_a",
            password="Password123!",
            role=User.Role.COORDINATOR,
            institution=self.institution,
            department=self.dept_a,
        )
        self.teacher_user = User.objects.create_user(
            username="teacher_dlr_a",
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
        self.other_teacher_user = User.objects.create_user(
            username="teacher_dlr_b",
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
        self.student_user = User.objects.create_user(
            username="student_dlr_a",
            password="Password123!",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.dept_a,
            first_name="Zaid",
        )
        self.student = StudentProfile.objects.create(
            user=self.student_user,
            teacher=self.teacher,
            institution=self.institution,
            department=self.dept_a,
        )
        self.other_student_user = User.objects.create_user(
            username="student_dlr_b",
            password="Password123!",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.dept_b,
        )
        self.other_student = StudentProfile.objects.create(
            user=self.other_student_user,
            teacher=self.other_teacher,
            institution=self.institution,
            department=self.dept_b,
        )

        base_day = date(2026, 10, 1)
        self.created_ids = []
        for idx in range(5):
            report = DailyLessonReport.objects.create(
                institution=self.institution,
                department=self.dept_a,
                teacher=self.teacher,
                student=self.student,
                date=base_day + timedelta(days=idx),
                notes=f"Note {idx}",
                created_by=self.teacher_user,
            )
            DailyLessonSubjectEntry.objects.create(
                report=report,
                subject=SubjectName.NAZIRA if idx % 2 == 0 else SubjectName.QAIDA,
                topic_summary=f"Topic {idx}",
                progress_status="completed" if idx % 2 == 0 else "in_progress",
            )
            self.created_ids.append(report.id)

        # Department B report that must never appear in Department A
        other_report = DailyLessonReport.objects.create(
            institution=self.institution,
            department=self.dept_b,
            teacher=self.other_teacher,
            student=self.other_student,
            date=base_day,
            notes="Other dept note",
            created_by=self.other_teacher_user,
        )
        DailyLessonSubjectEntry.objects.create(
            report=other_report,
            subject=SubjectName.NAZIRA,
            topic_summary="Secret Dept B",
            progress_status="completed",
        )
        self.other_report_id = other_report.id

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_pagination_completeness_and_ordering(self):
        client = self._client(self.coordinator)
        seen_ids = []
        page = 1
        while page is not None:
            resp = client.get(
                f"/api/academy/daily-lesson-reports/?page={page}&page_size=2",
                HTTP_HOST="localhost",
            )
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertEqual(body["count"], 5)
            self.assertEqual(body["total_pages"], 3)
            self.assertEqual(body["page"], page)
            seen_ids.extend(row["id"] for row in body["results"])
            page = body["next"]

        self.assertEqual(len(seen_ids), 5)
        self.assertEqual(len(set(seen_ids)), 5)
        self.assertNotIn(self.other_report_id, seen_ids)
        # Most recent date first
        self.assertEqual(seen_ids, list(reversed(self.created_ids)))

    def test_backend_search_and_filters_across_all_history(self):
        client = self._client(self.coordinator)
        resp = client.get(
            "/api/academy/daily-lesson-reports/?search=Topic 0&page=1&page_size=2",
            HTTP_HOST="localhost",
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["count"], 1)
        self.assertEqual(body["results"][0]["id"], self.created_ids[0])

        # Filter by subject and progress_status
        resp2 = client.get(
            f"/api/academy/daily-lesson-reports/?subject={SubjectName.QAIDA}&progress_status=in_progress",
            HTTP_HOST="localhost",
        )
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.json()["count"], 2)

    def test_invalid_pagination_and_empty_results(self):
        client = self._client(self.teacher_user)
        for bad in ("page=0", "page=-1", "page=abc", "page_size=0", "date=not-a-date"):
            resp = client.get(f"/api/academy/daily-lesson-reports/?{bad}", HTTP_HOST="localhost")
            self.assertEqual(resp.status_code, 400, f"Expected 400 for {bad}")

        empty_resp = client.get(
            "/api/academy/daily-lesson-reports/?search=no-such-topic-xyz",
            HTTP_HOST="localhost",
        )
        self.assertEqual(empty_resp.status_code, 200)
        self.assertEqual(empty_resp.json()["count"], 0)
        self.assertEqual(empty_resp.json()["results"], [])

    def test_new_report_appears_at_top_of_page_1(self):
        new_report = DailyLessonReport.objects.create(
            institution=self.institution,
            department=self.dept_a,
            teacher=self.teacher,
            student=self.student,
            date=date(2026, 10, 20),
            notes="Brand new report",
            created_by=self.teacher_user,
        )
        DailyLessonSubjectEntry.objects.create(
            report=new_report,
            subject=SubjectName.NAZIRA,
            topic_summary="Surah Yasin",
            progress_status="completed",
        )
        new_id = new_report.id

        teacher_client = self._client(self.teacher_user)
        list_resp = teacher_client.get("/api/academy/daily-lesson-reports/?page=1&page_size=2", HTTP_HOST="localhost")
        self.assertEqual(list_resp.status_code, 200)
        self.assertEqual(list_resp.json()["count"], 6)
        self.assertEqual(list_resp.json()["results"][0]["id"], new_id)
