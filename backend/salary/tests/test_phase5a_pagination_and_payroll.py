from datetime import date, time
from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Department, Institution, User
from academy.models import StudentProfile, TeacherProfile
from salary.models import (
    PayrollEarningLine,
    SalaryAttendanceVerification,
    SalaryPayrollPeriod,
    TeacherPayroll,
)


class Phase5APaginationAndPayrollTests(TestCase):
    def setUp(self):
        self.inst = Institution.objects.create(name="IVS Test Inst", slug="ivs-test-5a")
        self.dept = Department.objects.create(
            institution=self.inst, name="Quran Dept", code="quran-5a", department_type="quran"
        )
        self.other_dept = Department.objects.create(
            institution=self.inst, name="Tuition Dept", code="tuition-5a", department_type="tuition"
        )
        self.admin = User.objects.create_user(
            username="admin5a", password="pw", role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst, department=self.dept,
        )
        self.other_admin = User.objects.create_user(
            username="other5a", password="pw", role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst, department=self.other_dept,
        )

        self.u_t1 = User.objects.create_user(
            username="t1_5a", first_name="Ali", last_name="Khan", password="pw",
            role=User.Role.TEACHER, institution=self.inst, department=self.dept,
        )
        self.t1 = TeacherProfile.objects.create(user=self.u_t1, institution=self.inst, department=self.dept)

        self.u_t2 = User.objects.create_user(
            username="t2_5a", first_name="Zain", last_name="Raza", password="pw",
            role=User.Role.TEACHER, institution=self.inst, department=self.dept,
        )
        self.t2 = TeacherProfile.objects.create(user=self.u_t2, institution=self.inst, department=self.dept)

        self.u_s1 = User.objects.create_user(
            username="s1_5a", first_name="Bilal", last_name="Ahmed", password="pw",
            role=User.Role.STUDENT, institution=self.inst, department=self.dept,
        )
        self.s1 = StudentProfile.objects.create(
            user=self.u_s1, institution=self.inst, department=self.dept, teacher=self.t1
        )

        # Create 5 verifications across 2 teachers and 2 statuses
        for idx in range(5):
            SalaryAttendanceVerification.objects.create(
                institution=self.inst,
                department=self.dept,
                source_department_type="quran",
                teacher=self.t1 if idx < 3 else self.t2,
                student=self.s1,
                occurrence_key=f"occ-5a-{idx}",
                class_date=date(2026, 11, 1 + idx),
                scheduled_time=time(10, 0),
                verification_status=(
                    SalaryAttendanceVerification.VerificationStatus.PENDING
                    if idx < 3
                    else SalaryAttendanceVerification.VerificationStatus.VERIFIED
                ),
            )

        # Create payroll period + teacher payroll + 3 earning lines
        self.period = SalaryPayrollPeriod.objects.create(
            institution=self.inst,
            department=self.dept,
            payroll_year=2026,
            payroll_month=11,
            status=SalaryPayrollPeriod.Status.DRAFT,
            total_teachers=1,
            gross_total=Decimal("3000.00"),
            net_total=Decimal("3000.00"),
            created_by=self.admin,
        )
        self.tp = TeacherPayroll.objects.create(
            payroll_period=self.period,
            teacher=self.t1,
            regular_class_earnings=Decimal("3000.00"),
            gross_salary=Decimal("3000.00"),
            net_salary=Decimal("3000.00"),
        )
        for i in range(3):
            PayrollEarningLine.objects.create(
                teacher_payroll=self.tp,
                earning_type=PayrollEarningLine.EarningType.REGULAR_CLASS,
                student=self.s1,
                student_name="Bilal Ahmed",
                class_occurrence_id=f"occ-line-{i}",
                rate=Decimal("1000.00"),
                quantity=Decimal("1.00"),
                amount=Decimal("1000.00"),
                effective_date=date(2026, 11, 1 + i),
            )

        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_verifications_pagination_pages_and_invalid_page(self):
        r1 = self.client.get(
            f"/api/salary/verifications/?department_id={self.dept.id}&year=2026&month=11&page=1&page_size=2"
        )
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.data["count"], 5)
        self.assertEqual(r1.data["page"], 1)
        self.assertEqual(r1.data["total_pages"], 3)
        self.assertEqual(len(r1.data["results"]), 2)

        r_last = self.client.get(
            f"/api/salary/verifications/?department_id={self.dept.id}&year=2026&month=11&page=3&page_size=2"
        )
        self.assertEqual(r_last.status_code, 200)
        self.assertEqual(len(r_last.data["results"]), 1)

        r_invalid = self.client.get(
            f"/api/salary/verifications/?department_id={self.dept.id}&year=2026&month=11&page=99&page_size=2"
        )
        self.assertEqual(r_invalid.status_code, 404)

    def test_verifications_server_side_filters_and_search(self):
        r_status = self.client.get(
            f"/api/salary/verifications/?department_id={self.dept.id}&year=2026&month=11&status=verified&page=1&page_size=50"
        )
        self.assertEqual(r_status.status_code, 200)
        self.assertEqual(r_status.data["count"], 2)

        r_search = self.client.get(
            f"/api/salary/verifications/?department_id={self.dept.id}&year=2026&month=11&search=Zain&page=1&page_size=50"
        )
        self.assertEqual(r_search.status_code, 200)
        self.assertEqual(r_search.data["count"], 2)
        self.assertEqual(r_search.data["results"][0]["teacher"], self.t2.id)

    def test_verifications_cross_department_denied(self):
        self.client.force_authenticate(user=self.other_admin)
        r = self.client.get(
            f"/api/salary/verifications/?department_id={self.dept.id}&year=2026&month=11&page=1"
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["count"], 0)

    def test_payroll_summary_only_and_on_demand_earning_lines(self):
        r_sum = self.client.get(f"/api/salary/payrolls/{self.period.id}/?summary_only=true")
        self.assertEqual(r_sum.status_code, 200)
        self.assertEqual(r_sum.data["net_total"], "3000.00")
        tp_data = r_sum.data["teacher_payrolls"][0]
        self.assertEqual(tp_data["earning_lines_count"], 3)
        self.assertNotIn("earning_lines", tp_data)

        # Full retrieve still works for backward compatibility
        r_full = self.client.get(f"/api/salary/payrolls/{self.period.id}/")
        self.assertEqual(r_full.status_code, 200)
        self.assertEqual(len(r_full.data["teacher_payrolls"][0]["earning_lines"]), 3)

        # On-demand earning lines endpoint
        r_lines = self.client.get(
            f"/api/salary/teacher-payrolls/{self.tp.id}/earning_lines/?page=1&page_size=2"
        )
        self.assertEqual(r_lines.status_code, 200)
        self.assertEqual(r_lines.data["count"], 3)
        self.assertEqual(r_lines.data["total_pages"], 2)
        self.assertEqual(len(r_lines.data["results"]), 2)

        # Cross-department denial on earning_lines
        self.client.force_authenticate(user=self.other_admin)
        r_denied = self.client.get(
            f"/api/salary/teacher-payrolls/{self.tp.id}/earning_lines/"
        )
        self.assertEqual(r_denied.status_code, 403)
