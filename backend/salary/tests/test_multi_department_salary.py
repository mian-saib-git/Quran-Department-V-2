"""
Comprehensive Multi-Institution & Multi-Department Regression Test Suite for Unified Salary Management.

Covers the 20 critical requirements:
1. Quran Admin salary access
2. IVQ Admin salary access
3. IVQ teacher roster retrieval
4. Correct institution and department IDs
5. Department context switching
6. Institution context switching
7. Missing department context
8. Unauthorized department access
9. Cross-institution isolation
10. Department with zero teachers
11. Department with teachers but no policies
12. Department with published policies
13. Stage 3 bulk assignment authorization
14. Stage 4 attendance isolation
15. Stage 5 salary calculation isolation
16. Stage 6 adjustment isolation
17. Stage 7A payroll generation isolation
18. Stage 7B approval protection
19. Newly created department support
20. Preservation of Quran Department functionality
"""
from datetime import date, timedelta
from decimal import Decimal

from django.core.exceptions import PermissionDenied, ValidationError
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import Department, Institution, User, UserDepartmentRole
from academy.models import TeacherProfile, StudentProfile, ClassSchedule, Attendance
from salary.models import (
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    SalaryPlanTierRate,
    TeacherPolicyAssignment,
    TeacherSalaryOverride,
    SalaryPayrollPeriod,
    TeacherPayroll,
    PayrollAdjustment,
    SalaryAdjustmentCategory,
)
from salary.permissions import (
    get_authorized_department_id_for_user,
    is_user_department_admin_for_department,
)


class MultiDepartmentUnifiedSalaryTests(APITestCase):
    def setUp(self):
        # Institutions
        self.inst1 = Institution.objects.create(name="Salary Test Institution", slug="salary-multi-department-test")
        self.inst2 = Institution.objects.create(name="Umar Quran Department", slug="umar-quran-department")
        self.inst3 = Institution.objects.create(name="Third Institution", slug="third-institution")

        # Departments
        self.dept_quran = Department.objects.create(
            name="Quran Department", code="quran", department_type="quran", institution=self.inst1, is_active=True
        )
        self.dept_tuition = Department.objects.create(
            name="Tuition Department", code="tuition", department_type="tuition", institution=self.inst1, is_active=True
        )
        self.dept_ivq = Department.objects.create(
            name="IVQ", code="ivq", department_type="quran", institution=self.inst2, is_active=True
        )

        # Users
        self.quran_admin = User.objects.create_user(
            username="quran_admin",
            email="quran_admin@ivs.com",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst1,
            department=self.dept_quran,
        )
        self.ivq_admin = User.objects.create_user(
            username="ivq_admin",
            email="ivq_admin@ivs.com",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst2,
            department=self.dept_ivq,
        )
        self.inst_admin = User.objects.create_user(
            username="inst_admin",
            email="inst_admin@ivs.com",
            role=User.Role.INSTITUTION_ADMIN,
            institution=self.inst1,
        )
        self.platform_admin = User.objects.create_user(
            username="platform_admin",
            email="platform_admin@ivs.com",
            role=User.Role.PLATFORM_ADMIN,
            is_superuser=True,
        )
        self.teacher_user = User.objects.create_user(
            username="teacher_user",
            email="teacher@ivs.com",
            role=User.Role.TEACHER,
            institution=self.inst1,
            department=self.dept_quran,
        )
        self.coordinator_user = User.objects.create_user(
            username="coordinator_user",
            email="coordinator@ivs.com",
            role=User.Role.COORDINATOR,
            institution=self.inst2,
            department=self.dept_ivq,
        )

        # Teachers
        self.quran_teacher = TeacherProfile.objects.create(
            department=self.dept_quran,
            historical_name="Quran Master Teacher",
            joining_date=date(2025, 1, 1),
        )
        self.ivq_teacher = TeacherProfile.objects.create(
            department=self.dept_ivq,
            historical_name="IVQ Lead Teacher",
            joining_date=date(2025, 1, 1),
        )

    # 1. Quran Admin salary access
    def test_01_quran_admin_salary_access(self):
        self.client.force_authenticate(user=self.quran_admin)
        res = self.client.get("/api/salary/departments/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        dept_ids = [d["id"] for d in res.data]
        self.assertIn(self.dept_quran.id, dept_ids)
        self.assertNotIn(self.dept_ivq.id, dept_ids)

    # 2. IVQ Admin salary access
    def test_02_ivq_admin_salary_access(self):
        self.client.force_authenticate(user=self.ivq_admin)
        res = self.client.get("/api/salary/departments/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        dept_ids = [d["id"] for d in res.data]
        self.assertIn(self.dept_ivq.id, dept_ids)
        self.assertNotIn(self.dept_quran.id, dept_ids)

    # 3. IVQ teacher roster retrieval
    def test_03_ivq_teacher_roster_retrieval(self):
        self.client.force_authenticate(user=self.ivq_admin)
        res = self.client.get(f"/api/salary/teachers/?department_id={self.dept_ivq.id}")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["name"], "IVQ Lead Teacher")
        self.assertEqual(res.data[0]["department_id"], self.dept_ivq.id)

    # 4. Correct institution and department IDs
    def test_04_correct_institution_and_department_ids(self):
        self.assertEqual(self.dept_ivq.institution_id, self.inst2.id)
        self.assertEqual(self.dept_quran.institution_id, self.inst1.id)
        self.assertEqual(get_authorized_department_id_for_user(self.ivq_admin, self.dept_ivq.id), self.dept_ivq.id)
        self.assertEqual(get_authorized_department_id_for_user(self.quran_admin, self.dept_quran.id), self.dept_quran.id)

    # 5. Department context switching (user with multiple departments)
    def test_05_department_context_switching_for_multi_department_admin(self):
        multi_admin = User.objects.create_user(
            username="multi_admin",
            email="multi@ivs.com",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=self.inst1,
            department=self.dept_quran,
        )
        UserDepartmentRole.objects.create(
            user=multi_admin,
            institution=self.inst2,
            department=self.dept_ivq,
            role=UserDepartmentRole.Role.DEPARTMENT_ADMIN,
            is_active=True,
        )
        self.client.force_authenticate(user=multi_admin)
        res = self.client.get("/api/salary/departments/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        dept_ids = [d["id"] for d in res.data]
        self.assertIn(self.dept_quran.id, dept_ids)
        self.assertIn(self.dept_ivq.id, dept_ids)

        # Authorized for both
        self.assertEqual(get_authorized_department_id_for_user(multi_admin, self.dept_quran.id), self.dept_quran.id)
        self.assertEqual(get_authorized_department_id_for_user(multi_admin, self.dept_ivq.id), self.dept_ivq.id)

    # 6. Institution context switching
    def test_06_institution_context_switching(self):
        self.client.force_authenticate(user=self.inst_admin)
        res = self.client.get("/api/salary/departments/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        inst_ids = {d["institution_id"] for d in res.data}
        self.assertEqual(inst_ids, {self.inst1.id})

    # 7. Missing department context falls back to primary authorized department
    def test_07_missing_department_context_defaults_safely(self):
        self.client.force_authenticate(user=self.ivq_admin)
        res = self.client.get("/api/salary/teachers/")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["department_id"], self.dept_ivq.id)

    # 8. Unauthorized department access rejected
    def test_08_unauthorized_department_access(self):
        self.client.force_authenticate(user=self.ivq_admin)
        # IVQ admin attempting to read Quran department teachers
        res = self.client.get(f"/api/salary/teachers/?department_id={self.dept_quran.id}")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn("Department ID is required and must be authorized.", str(res.data))

    # 9. Cross-institution isolation
    def test_09_cross_institution_isolation(self):
        self.client.force_authenticate(user=self.inst_admin)
        # Institution admin of Inst1 attempting to access Inst2 (IVQ)
        res = self.client.get(f"/api/salary/teachers/?department_id={self.dept_ivq.id}")
        self.assertEqual(res.status_code, status.HTTP_403_FORBIDDEN)

    # 10. Department with zero teachers
    def test_10_department_with_zero_teachers(self):
        empty_dept = Department.objects.create(
            name="Empty Dept", code="empty", department_type="quran", institution=self.inst1, is_active=True
        )
        UserDepartmentRole.objects.create(
            user=self.quran_admin,
            institution=self.inst1,
            department=empty_dept,
            role=UserDepartmentRole.Role.DEPARTMENT_ADMIN,
            is_active=True,
        )
        self.client.force_authenticate(user=self.quran_admin)
        res = self.client.get(f"/api/salary/teachers/?department_id={empty_dept.id}")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 0)

    # 11. Department with teachers but no policies
    def test_11_department_with_teachers_but_no_policies(self):
        self.client.force_authenticate(user=self.ivq_admin)
        # Verify no policy exists
        res_policies = self.client.get(f"/api/salary/policies/?department_id={self.dept_ivq.id}")
        self.assertEqual(res_policies.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_policies.data), 0)
        # Roster loads successfully without error
        res_teachers = self.client.get(f"/api/salary/teachers/?department_id={self.dept_ivq.id}")
        self.assertEqual(res_teachers.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_teachers.data), 1)
        self.assertIsNone(res_teachers.data[0]["current_policy"])

    # 12. Department with published policies
    def test_12_department_with_published_policies(self):
        policy = SalaryPolicy.objects.create(
            institution=self.inst2,
            department=self.dept_ivq,
            code="IVQ-STD",
            name="IVQ Standard Policy",
            is_active=True,
            created_by=self.ivq_admin,
        )
        version = SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2025, 1, 1),
            effective_to=None,
            published_by=self.ivq_admin,
        )
        self.client.force_authenticate(user=self.ivq_admin)
        res = self.client.get(f"/api/salary/policies/?department_id={self.dept_ivq.id}")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["code"], "IVQ-STD")

    # 13. Stage 3 bulk assignment authorization
    def test_13_stage_3_bulk_assignment_authorization(self):
        policy = SalaryPolicy.objects.create(
            institution=self.inst2,
            department=self.dept_ivq,
            code="IVQ-BULK",
            name="IVQ Bulk Policy",
            is_active=True,
            created_by=self.ivq_admin,
        )
        SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2025, 1, 1),
            effective_to=None,
            published_by=self.ivq_admin,
        )
        self.client.force_authenticate(user=self.ivq_admin)
        res = self.client.post("/api/salary/assignments/bulk-assign/", {
            "department": self.dept_ivq.id,
            "teacher_ids": [self.ivq_teacher.id],
            "policy": policy.id,
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["assigned_count"], 1)

        # Cross-department bulk assign attempt rejected
        res_cross = self.client.post("/api/salary/assignments/bulk-assign/", {
            "department": self.dept_quran.id,
            "teacher_ids": [self.quran_teacher.id],
            "policy": policy.id,
        }, format="json")
        self.assertEqual(res_cross.status_code, status.HTTP_403_FORBIDDEN)

    # 14. Stage 4 attendance isolation
    def test_14_stage_4_attendance_isolation(self):
        self.client.force_authenticate(user=self.ivq_admin)
        res = self.client.get(f"/api/salary/verifications/summary/?department_id={self.dept_ivq.id}&year=2026&month=1")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Cross-department summary rejected
        res_cross = self.client.get(f"/api/salary/verifications/summary/?department_id={self.dept_quran.id}&year=2026&month=1")
        self.assertEqual(res_cross.status_code, status.HTTP_403_FORBIDDEN)

    # 15. Stage 5 salary calculation isolation
    def test_15_stage_5_salary_calculation_isolation(self):
        self.client.force_authenticate(user=self.ivq_admin)
        res = self.client.post("/api/salary/calculations/preview/", {
            "department_id": self.dept_ivq.id,
            "year": 2026,
            "month": 1,
            "summary_only": True,
        }, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Cross-department calculation rejected
        res_cross = self.client.post("/api/salary/calculations/preview/", {
            "department_id": self.dept_quran.id,
            "year": 2026,
            "month": 1,
            "summary_only": True,
        }, format="json")
        self.assertEqual(res_cross.status_code, status.HTTP_403_FORBIDDEN)

    # 16. Stage 6 adjustment isolation
    def test_16_stage_6_adjustment_isolation(self):
        cat = SalaryAdjustmentCategory.objects.create(
            institution=self.inst2,
            department=self.dept_ivq,
            name="IVQ Special Performance",
            code="IVQ_PERF",
            direction=SalaryAdjustmentCategory.Direction.CREDIT,
            is_active=True,
        )
        adj = PayrollAdjustment.objects.create(
            institution=self.inst2,
            department=self.dept_ivq,
            teacher=self.ivq_teacher,
            category=cat.code,
            direction=PayrollAdjustment.Direction.CREDIT,
            amount=Decimal("1500.00"),
            period_year=2026,
            period_month=1,
            reason="Exemplary class completion",
            created_by=self.ivq_admin,
        )
        self.client.force_authenticate(user=self.ivq_admin)
        res = self.client.get(f"/api/salary/adjustments/?department_id={self.dept_ivq.id}")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)

        # Quran admin gets empty list for IVQ department
        self.client.force_authenticate(user=self.quran_admin)
        res_cross = self.client.get(f"/api/salary/adjustments/?department_id={self.dept_ivq.id}")
        self.assertEqual(len(res_cross.data), 0)

    # 17. Stage 7A payroll generation isolation
    def test_17_stage_7a_payroll_generation_isolation(self):
        period = SalaryPayrollPeriod.objects.create(
            institution=self.inst2,
            department=self.dept_ivq,
            payroll_year=2026,
            payroll_month=1,
            status=SalaryPayrollPeriod.Status.DRAFT,
            submitted_by=self.ivq_admin,
        )
        self.client.force_authenticate(user=self.ivq_admin)
        res = self.client.get(f"/api/salary/payrolls/?department_id={self.dept_ivq.id}")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)

        # Quran admin querying IVQ payroll gets empty
        self.client.force_authenticate(user=self.quran_admin)
        res_cross = self.client.get(f"/api/salary/payrolls/?department_id={self.dept_ivq.id}")
        self.assertEqual(len(res_cross.data), 0)

    # 18. Stage 7B approval protection
    def test_18_stage_7b_approval_protection(self):
        period = SalaryPayrollPeriod.objects.create(
            institution=self.inst2,
            department=self.dept_ivq,
            payroll_year=2026,
            payroll_month=2,
            status=SalaryPayrollPeriod.Status.PENDING_APPROVAL,
            submitted_by=self.ivq_admin,
        )
        # Department Admin cannot approve payroll
        self.client.force_authenticate(user=self.ivq_admin)
        res_dept_approve = self.client.post(f"/api/salary/payrolls/{period.id}/approve/", {"notes": "Self-approval attempt"})
        self.assertEqual(res_dept_approve.status_code, status.HTTP_403_FORBIDDEN)

        # Institution Admin of different institution cannot approve (concealed/isolated via 403 or 404)
        self.client.force_authenticate(user=self.inst_admin)
        res_cross_inst = self.client.post(f"/api/salary/payrolls/{period.id}/approve/", {"notes": "Cross-institution approval attempt"})
        self.assertIn(res_cross_inst.status_code, [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND])

    # 19. Newly created department support without code change
    def test_19_newly_created_department_support(self):
        new_inst = Institution.objects.create(name="Future Academy", slug="future-academy")
        new_dept = Department.objects.create(
            name="Advanced Coding", code="coding", department_type="coding", institution=new_inst, is_active=True
        )
        new_admin = User.objects.create_user(
            username="coding_admin",
            email="coding_admin@ivs.com",
            role=User.Role.DEPARTMENT_ADMIN,
            institution=new_inst,
            department=new_dept,
        )
        new_teacher = TeacherProfile.objects.create(
            department=new_dept,
            historical_name="Coding Instructor",
            joining_date=date(2026, 1, 1),
        )
        self.client.force_authenticate(user=new_admin)

        # 1. Departments endpoint returns new department dynamically
        res_depts = self.client.get("/api/salary/departments/")
        self.assertEqual(res_depts.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_depts.data), 1)
        self.assertEqual(res_depts.data[0]["id"], new_dept.id)
        self.assertEqual(res_depts.data[0]["name"], "Advanced Coding")

        # 2. Teacher roster retrieves new teacher dynamically
        res_teachers = self.client.get(f"/api/salary/teachers/?department_id={new_dept.id}")
        self.assertEqual(res_teachers.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res_teachers.data), 1)
        self.assertEqual(res_teachers.data[0]["name"], "Coding Instructor")

    # 20. Preservation of Quran Department functionality
    def test_20_preservation_of_quran_department_functionality(self):
        policy = SalaryPolicy.objects.create(
            institution=self.inst1,
            department=self.dept_quran,
            code="QURAN-STD",
            name="Quran Standard Compensation",
            is_active=True,
            created_by=self.quran_admin,
        )
        version = SalaryPolicyVersion.objects.create(
            policy=policy,
            version_number=1,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from=date(2025, 1, 1),
            effective_to=None,
            published_by=self.quran_admin,
        )
        assignment = TeacherPolicyAssignment.objects.create(
            department=self.dept_quran,
            teacher=self.quran_teacher,
            policy=policy,
            effective_from=date(2025, 1, 1),
            is_active=True,
            assigned_by=self.quran_admin,
        )
        self.client.force_authenticate(user=self.quran_admin)
        res = self.client.get(f"/api/salary/teachers/?department_id={self.dept_quran.id}")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(res.data), 1)
        self.assertIsNotNone(res.data[0]["current_policy"])
        self.assertEqual(res.data[0]["current_policy"]["policy_code"], "QURAN-STD")
