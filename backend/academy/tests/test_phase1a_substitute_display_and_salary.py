from datetime import date, time
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Department, Institution, User
from academy.models import (
    Attendance,
    ClassSchedule,
    QuranClassCoverage,
    QuranSalaryLedgerEntry,
    QuranSalaryPolicy,
    QuranTeacherMonthlyPayroll,
    StudentProfile,
    TeacherProfile,
)
from academy.salary_v2_proof_service import student_attendance_summaries
from academy.salary_v2_service import calculate_department_payrolls, payroll_readiness
from salary.calculation_engine import calculate_teacher_salary_preview
from salary.models import (
    SalaryAttendanceVerification,
    SalaryPolicy,
    SalaryPolicyVersion,
    TeacherPolicyAssignment,
)


class Phase1ASubstituteDisplayAndSalaryTests(TestCase):
    def setUp(self):
        self.institution = Institution.objects.create(
            name="Phase 1A Test Inst",
            slug="phase1a-test-inst",
        )
        self.department = Department.objects.create(
            institution=self.institution,
            name="Quran Phase 1A",
            code="quran-phase1a",
            department_type=Department.DepartmentType.QURAN,
        )
        self.manager = User.objects.create_user(
            username="p1a_manager",
            password="pw",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.institution,
            department=self.department,
        )
        self.teacher_a_user = User.objects.create_user(
            username="p1a_teacher_a",
            first_name="39 Fahad",
            last_name="Ali",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        self.teacher_a = TeacherProfile.objects.create(
            user=self.teacher_a_user,
            institution=self.institution,
            department=self.department,
        )
        self.teacher_b_user = User.objects.create_user(
            username="p1a_teacher_b",
            first_name="40 Bilal",
            last_name="Ahmed",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        self.teacher_b = TeacherProfile.objects.create(
            user=self.teacher_b_user,
            institution=self.institution,
            department=self.department,
        )
        self.teacher_c_user = User.objects.create_user(
            username="p1a_teacher_c",
            first_name="41 Hamza",
            last_name="Khan",
            password="pw",
            role=User.Role.TEACHER,
            institution=self.institution,
            department=self.department,
        )
        self.teacher_c = TeacherProfile.objects.create(
            user=self.teacher_c_user,
            institution=self.institution,
            department=self.department,
        )

        self.target_date = date(2026, 11, 16)  # Monday
        self.weekday = "monday"

        self.student_1_user = User.objects.create_user(
            username="p1a_student_1",
            first_name="Student",
            last_name="One",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        self.student_1 = StudentProfile.objects.create(
            user=self.student_1_user,
            institution=self.institution,
            department=self.department,
            teacher=self.teacher_a,
        )
        self.student_2_user = User.objects.create_user(
            username="p1a_student_2",
            first_name="Student",
            last_name="Two",
            password="pw",
            role=User.Role.STUDENT,
            institution=self.institution,
            department=self.department,
        )
        self.student_2 = StudentProfile.objects.create(
            user=self.student_2_user,
            institution=self.institution,
            department=self.department,
            teacher=self.teacher_a,
        )

        ClassSchedule.objects.create(
            institution=self.institution,
            department=self.department,
            student=self.student_1,
            teacher=self.teacher_a,
            weekday=self.weekday,
            time_slot=time(14, 0),
            duration_minutes=30,
            effective_from=date(2026, 11, 1),
        )
        ClassSchedule.objects.create(
            institution=self.institution,
            department=self.department,
            student=self.student_2,
            teacher=self.teacher_a,
            weekday=self.weekday,
            time_slot=time(14, 0),
            duration_minutes=30,
            effective_from=date(2026, 11, 1),
        )

        self.policy = QuranSalaryPolicy.objects.create(
            department=self.department,
            effective_from=date(2026, 11, 1),
            rate_1_to_15=Decimal("80.00"),
            rate_16_to_19=Decimal("90.00"),
            rate_20_plus=Decimal("100.00"),
            created_by=self.manager,
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.manager)

    def _mark_student(self, student, status_val="present"):
        return self.client.post(
            "/api/academy/attendance/",
            {
                "entity_type": "student",
                "teacher_id": self.teacher_a.id,
                "student_id": student.id,
                "date": str(self.target_date),
                "status": status_val,
                "class_key": "14:00",
            },
            format="json",
        )

    def test_attendance_list_returns_saved_substitute_per_student_and_clears_on_cancel(self):
        self.assertIn(self._mark_student(self.student_1, "present").status_code, (200, 201))
        self.assertIn(self._mark_student(self.student_2, "present").status_code, (200, 201))

        save_res = self.client.post(
            "/api/academy/teacher-session-attendance-v2/",
            {
                "teacher_id": self.teacher_a.id,
                "date": str(self.target_date),
                "class_key": "14:00",
                "status": "absent",
                "coverage_assignments": [
                    {"student_id": self.student_1.id, "substitute_teacher_id": self.teacher_b.id},
                    {"student_id": self.student_2.id, "substitute_teacher_id": self.teacher_c.id},
                ],
            },
            format="json",
        )
        self.assertEqual(save_res.status_code, 200)

        list_res = self.client.get(f"/api/academy/attendance/?date={self.target_date}&scope=state")
        self.assertEqual(list_res.status_code, 200)
        by_student = {
            row["student_id"]: row
            for row in list_res.data["results"]
            if row["entity_type"] == "student"
        }
        self.assertEqual(by_student[self.student_1.id]["substitute_teacher_id"], self.teacher_b.id)
        self.assertEqual(by_student[self.student_1.id]["substitute_teacher_name"], str(self.teacher_b))
        self.assertEqual(by_student[self.student_2.id]["substitute_teacher_id"], self.teacher_c.id)
        self.assertEqual(by_student[self.student_2.id]["substitute_teacher_name"], str(self.teacher_c))

        # Changing teacher back to present cancels coverage and clears substitute_teacher_name
        present_res = self.client.post(
            "/api/academy/teacher-session-attendance-v2/",
            {
                "teacher_id": self.teacher_a.id,
                "date": str(self.target_date),
                "class_key": "14:00",
                "status": "present",
                "coverage_assignments": [],
            },
            format="json",
        )
        self.assertEqual(present_res.status_code, 200)

        list_after = self.client.get(f"/api/academy/attendance/?date={self.target_date}&scope=state")
        self.assertEqual(list_after.status_code, 200)
        by_student_after = {
            row["student_id"]: row
            for row in list_after.data["results"]
            if row["entity_type"] == "student"
        }
        self.assertIsNone(by_student_after[self.student_1.id]["substitute_teacher_id"])
        self.assertEqual(by_student_after[self.student_1.id]["substitute_teacher_name"], "")
        self.assertIsNone(by_student_after[self.student_2.id]["substitute_teacher_id"])
        self.assertEqual(by_student_after[self.student_2.id]["substitute_teacher_name"], "")

    def test_salary_v2_deduction_and_substitute_earning_end_to_end(self):
        # Student 1 Present, Student 2 Absent (so only Student 1 requires substitute)
        self.assertIn(self._mark_student(self.student_1, "present").status_code, (200, 201))
        self.assertIn(self._mark_student(self.student_2, "absent").status_code, (200, 201))

        save_res = self.client.post(
            "/api/academy/teacher-session-attendance-v2/",
            {
                "teacher_id": self.teacher_a.id,
                "date": str(self.target_date),
                "class_key": "14:00",
                "status": "absent",
                "coverage_assignments": [
                    {"student_id": self.student_1.id, "substitute_teacher_id": self.teacher_b.id},
                ],
            },
            format="json",
        )
        self.assertEqual(save_res.status_code, 200)

        cov = QuranClassCoverage.objects.get(
            student=self.student_1,
            date=self.target_date,
            original_teacher=self.teacher_a,
        )
        self.assertEqual(cov.coverage_status, QuranClassCoverage.CoverageStatus.ASSIGNED)
        self.assertEqual(cov.substitute_teacher_id, self.teacher_b.id)

        calculate_department_payrolls(self.department, 2026, 11, actor=self.manager)

        payroll_a = QuranTeacherMonthlyPayroll.objects.get(
            department=self.department,
            teacher=self.teacher_a,
            year=2026,
            month=11,
        )
        payroll_b = QuranTeacherMonthlyPayroll.objects.get(
            department=self.department,
            teacher=self.teacher_b,
            year=2026,
            month=11,
        )

        # Teacher A: absence deduction recorded for the missed class (no duplicate deductions)
        deduction_entries_a = QuranSalaryLedgerEntry.objects.filter(
            payroll=payroll_a,
            effective_date=self.target_date,
            entry_type=QuranSalaryLedgerEntry.EntryType.TEACHER_ABSENCE_DEDUCTION,
        )
        self.assertEqual(deduction_entries_a.filter(student=self.student_1).count(), 1)
        self.assertGreater(payroll_a.automatic_absence_deduction_total, Decimal("0.00"))

        # Teacher B: exactly 1 substitute earning of 80.00 (1-15 tier) for Student 1 on target_date
        sub_entries_b = QuranSalaryLedgerEntry.objects.filter(
            payroll=payroll_b,
            effective_date=self.target_date,
            entry_type=QuranSalaryLedgerEntry.EntryType.SUBSTITUTE_EARNING,
        )
        self.assertEqual(sub_entries_b.count(), 1)
        self.assertEqual(sub_entries_b.first().amount, Decimal("80.00"))
        self.assertEqual(payroll_b.substitute_earnings, Decimal("80.00"))
        self.assertEqual(payroll_b.final_total, Decimal("80.00"))

        # Proof & readiness are clean and consistent
        readiness_a = payroll_readiness(payroll_a)
        readiness_b = payroll_readiness(payroll_b)
        self.assertEqual(readiness_a["counts"]["unresolved_coverages"], 0)
        self.assertEqual(readiness_b["counts"]["unresolved_coverages"], 0)
        proof_a = student_attendance_summaries(payroll_a)
        self.assertTrue(len(proof_a) >= 1)

    def test_academy_state_persists_substitute_across_refresh_and_syncs_unified_salary(self):
        today = timezone.localdate()
        weekday = today.strftime("%A").lower()
        ClassSchedule.objects.create(
            institution=self.institution,
            department=self.department,
            student=self.student_1,
            teacher=self.teacher_a,
            weekday=weekday,
            time_slot=time(15, 0),
            duration_minutes=30,
            effective_from=today.replace(day=1),
        )
        ClassSchedule.objects.create(
            institution=self.institution,
            department=self.department,
            student=self.student_2,
            teacher=self.teacher_a,
            weekday=weekday,
            time_slot=time(15, 0),
            duration_minutes=30,
            effective_from=today.replace(day=1),
        )

        # Configure Unified Salary policy + assignment for substitute teacher B
        unified_policy = SalaryPolicy.objects.create(
            institution=self.institution,
            department=self.department,
            name="Quran Unified Test Policy",
            code="quran-unified-test",
            is_active=True,
            created_by=self.manager,
        )
        SalaryPolicyVersion.objects.create(
            policy=unified_policy,
            version_number=1,
            effective_from=today.replace(day=1),
            substitute_rate_per_class=Decimal("80.00"),
            status=SalaryPolicyVersion.Status.PUBLISHED,
            published_by=self.manager,
        )
        TeacherPolicyAssignment.objects.create(
            department=self.department,
            teacher=self.teacher_b,
            policy=unified_policy,
            effective_from=today.replace(day=1),
            is_active=True,
            assigned_by=self.manager,
        )
        TeacherPolicyAssignment.objects.create(
            department=self.department,
            teacher=self.teacher_a,
            policy=unified_policy,
            effective_from=today.replace(day=1),
            is_active=True,
            assigned_by=self.manager,
        )

        # Mark both students Present today
        for s in (self.student_1, self.student_2):
            res = self.client.post(
                "/api/academy/attendance/",
                {
                    "entity_type": "student",
                    "teacher_id": self.teacher_a.id,
                    "student_id": s.id,
                    "date": str(today),
                    "status": "present",
                    "class_key": "15:00",
                },
                format="json",
            )
            self.assertIn(res.status_code, (200, 201))

        # Assign different substitutes for student 1 and student 2
        save_res = self.client.post(
            "/api/academy/teacher-session-attendance-v2/",
            {
                "teacher_id": self.teacher_a.id,
                "date": str(today),
                "class_key": "15:00",
                "status": "absent",
                "coverage_assignments": [
                    {"student_id": self.student_1.id, "substitute_teacher_id": self.teacher_b.id},
                    {"student_id": self.student_2.id, "substitute_teacher_id": self.teacher_c.id},
                ],
            },
            format="json",
        )
        self.assertEqual(save_res.status_code, 200)

        # Simulate browser refresh: GET /api/academy/state/?dashboard=true
        state_res = self.client.get("/api/academy/state/?dashboard=true")
        self.assertEqual(state_res.status_code, 200)
        att_by_student = {
            int(row["studentId"]): row
            for row in state_res.data["attendance"]
            if row["entityType"] == "Student" and row["date"] == str(today)
        }
        self.assertEqual(att_by_student[self.student_1.id]["substituteTeacherId"], str(self.teacher_b.id))
        self.assertEqual(att_by_student[self.student_1.id]["substituteTeacherName"], str(self.teacher_b))
        self.assertEqual(att_by_student[self.student_2.id]["substituteTeacherId"], str(self.teacher_c.id))
        self.assertEqual(att_by_student[self.student_2.id]["substituteTeacherName"], str(self.teacher_c))

        # Unified Salary preview immediately reflects Teacher B's substitute earning (Rs 80.00)
        preview_b = calculate_teacher_salary_preview(
            self.department, self.teacher_b, today.year, today.month, summary_only=True
        )
        self.assertEqual(preview_b["earnings"]["substitute_compensation_earnings"], "80.00")
        self.assertEqual(
            SalaryAttendanceVerification.objects.filter(
                department=self.department,
                class_date=today,
                substitute_teacher=self.teacher_b,
            ).count(),
            1,
        )

        # Unmarking teacher cancels coverage, clears state on refresh, and resets Unified preview to 0.00
        del_res = self.client.delete(
            f"/api/academy/teacher-session-attendance-v2/?teacher_id={self.teacher_a.id}&date={today}&class_key=15:00"
        )
        self.assertEqual(del_res.status_code, 200)

        state_after = self.client.get("/api/academy/state/?dashboard=true")
        self.assertEqual(state_after.status_code, 200)
        att_after = {
            int(row["studentId"]): row
            for row in state_after.data["attendance"]
            if row["entityType"] == "Student" and row["date"] == str(today)
        }
        self.assertEqual(att_after[self.student_1.id]["substituteTeacherName"], "")
        self.assertEqual(att_after[self.student_2.id]["substituteTeacherName"], "")

        preview_b_after = calculate_teacher_salary_preview(
            self.department, self.teacher_b, today.year, today.month, summary_only=True
        )
        self.assertEqual(preview_b_after["earnings"]["substitute_compensation_earnings"], "0.00")
