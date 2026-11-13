"""
Comprehensive Profile of Salary V2 endpoints with realistic dataset:
78 teachers, 601 classes, attendance verifications, policies, adjustments, and payroll records.
"""
import os
import sys
import time

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"

from django.conf import settings
settings.ALLOWED_HOSTS = ["*"]
settings.DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
installed_apps = [app for app in settings.INSTALLED_APPS if app != "daphne"]
settings.INSTALLED_APPS = installed_apps

class DisableMigrations:
    def __contains__(self, item): return True
    def __getitem__(self, item): return None

settings.MIGRATION_MODULES = DisableMigrations()
settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

import django
django.setup()

from django.test.utils import get_runner
TestRunner = get_runner(settings)
test_runner = TestRunner(verbosity=0, interactive=False)
db_config = test_runner.setup_databases()

from rest_framework.test import APIClient
from django.db import connection, reset_queries
from decimal import Decimal
from datetime import date
from accounts.models import Institution, Department, User, UserDepartmentRole
from academy.models import TeacherProfile, StudentProfile, ClassSchedule, Attendance
from academy.salary_v2_models import QuranTeacherMonthlyPayroll, QuranClassCoverage, QuranSalaryAdjustment
from salary.models import (
    SalaryPolicy, SalaryPolicyVersion, SalaryRateTier, SalaryTeachingPlan,
    SalaryPlanTierRate, TeacherPolicyAssignment, TeacherSalaryOverride,
    SalaryAttendanceVerification, SalaryAdjustmentCategory, PayrollAdjustment,
    SalaryPayrollPeriod, TeacherPayroll, PayrollEarningLine, SalaryEngineCutoverRegistry
)

print("Seeding test database for 78 teachers...", flush=True)

# 1. Institution and Department
inst = Institution.objects.create(name="Quran Academy Test Inst")
dept = Department.objects.create(institution=inst, name="Quran Department", code="QURAN", department_type="quran")

# 2. Admin user
admin_user = User.objects.create_user(
    username="deptadmin", email="deptadmin@test.com", password="password",
    role="department_admin", institution=inst, department=dept
)
UserDepartmentRole.objects.create(user=admin_user, department=dept, institution=inst, role="department_admin")

# 3. Create 78 teachers
teachers = []
for i in range(1, 79):
    u = User.objects.create_user(
        username=f"teacher{i}", email=f"teacher{i}@test.com", password="password",
        role="teacher", first_name=f"Teacher{i}", last_name="Khan", institution=inst
    )
    t = TeacherProfile.objects.create(user=u, department=dept, institution=inst)
    teachers.append(t)

# 4. Policy, version, tiers, plans, matrix
policy = SalaryPolicy.objects.create(
    institution=inst, department=dept, code="QURAN_STANDARD", name="Quran Standard Policy",
    policy_type="standard", compensation_model="per_class", created_by=admin_user
)
version = SalaryPolicyVersion.objects.create(
    policy=policy, version_number=1, status=SalaryPolicyVersion.Status.DRAFT,
    effective_from=date(2026, 1, 1), week_start_day="monday",
    lesson_plan_bonus_per_class=Decimal("10.00"), substitute_rate_per_class=Decimal("80.00"),
    cancellation_rate_per_class=Decimal("50.00"), basic_salary_amount=Decimal("5000.00"),
    published_by=admin_user
)
tier1 = SalaryRateTier.objects.create(policy_version=version, tier_name="1-5", min_students=1, max_students=5, sort_order=1)
tier2 = SalaryRateTier.objects.create(policy_version=version, tier_name="6+", min_students=6, max_students=None, sort_order=2)
plan_2d = SalaryTeachingPlan.objects.create(policy_version=version, plan_code="2_days", plan_name="2 Days", days_per_week=2, sort_order=1)
plan_5d = SalaryTeachingPlan.objects.create(policy_version=version, plan_code="5_days", plan_name="5 Days", days_per_week=5, sort_order=2)
SalaryPlanTierRate.objects.create(policy_version=version, teaching_plan=plan_2d, rate_tier=tier1, rate_per_class=Decimal("150.00"))
SalaryPlanTierRate.objects.create(policy_version=version, teaching_plan=plan_2d, rate_tier=tier2, rate_per_class=Decimal("180.00"))
SalaryPlanTierRate.objects.create(policy_version=version, teaching_plan=plan_5d, rate_tier=tier1, rate_per_class=Decimal("200.00"))
SalaryPlanTierRate.objects.create(policy_version=version, teaching_plan=plan_5d, rate_tier=tier2, rate_per_class=Decimal("250.00"))

version.status = SalaryPolicyVersion.Status.PUBLISHED
version.save()

# 5. Teacher assignments
for t in teachers:
    TeacherPolicyAssignment.objects.create(
        department=dept, teacher=t, policy=policy, is_active=True,
        effective_from=date(2026, 1, 1), assigned_by=admin_user
    )

# 6. Students and verifications (601 classes total across 78 teachers)
students = []
for i in range(1, 100):
    su = User.objects.create_user(username=f"student{i}", role="student", institution=inst)
    sp = StudentProfile.objects.create(user=su, teacher=teachers[i % len(teachers)], department=dept, institution=inst)
    students.append(sp)

# Create 601 attendance verifications for Nov 2026
verifs = []
for idx in range(601):
    t = teachers[idx % len(teachers)]
    s = students[idx % len(students)]
    day = 1 + (idx % 28)
    status_choice = "pending" if idx < 430 else "verified"
    v = SalaryAttendanceVerification.objects.create(
        institution=inst, department=dept, source_department_type="quran",
        teacher=t, student=s, occurrence_key=f"quran:sched_{idx}:2026-11-{day:02d}",
        class_date=date(2026, 11, day), verification_status=status_choice
    )
    verifs.append(v)

# 7. Quran Teacher Monthly Payroll (Stage 1 / V2)
for t in teachers:
    QuranTeacherMonthlyPayroll.objects.create(
        institution=inst, department=dept, teacher=t,
        month=11, year=2026, status="calculating",
        normal_earnings=Decimal("12000.00"), gross_total=Decimal("12000.00"),
        final_total=Decimal("12000.00")
    )

# 8. Unified Salary Payroll Period (Stage 7A / 7B)
period = SalaryPayrollPeriod.objects.create(
    institution=inst, department=dept, payroll_year=2026, payroll_month=11,
    status=SalaryPayrollPeriod.Status.PENDING_APPROVAL, total_teachers=78,
    gross_total=Decimal("936000.00"), net_total=Decimal("936000.00"),
    created_by=admin_user, submitted_by=admin_user
)
for t in teachers:
    tp = TeacherPayroll.objects.create(
        payroll_period=period, teacher=t, applied_policy=policy, applied_policy_version=version,
        gross_salary=Decimal("12000.00"), net_salary=Decimal("12000.00")
    )
    PayrollEarningLine.objects.create(
        teacher_payroll=tp, earning_type="regular_class",
        rate=Decimal("200.00"), amount=Decimal("200.00")
    )

# Cutover registry
SalaryEngineCutoverRegistry.objects.create(
    department=dept, period_year=2026, period_month=11,
    is_unified_engine_active=True, authorized_by=admin_user
)

print("Test database seeded successfully!", flush=True)

from rest_framework.test import APIClient

# Profile endpoints
client = APIClient()
client.force_authenticate(user=admin_user)

# Warm up initial static categories once before profiling
client.get(f"/api/salary/adjustments/categories/?department_id=1")

endpoints = [
    ("Tab 1: Active Payroll (Salary V2)", "GET", "/api/academy/teacher-salary-v2/?month=11&year=2026", None),
    ("Tab 2: Policy Builder", "GET", "/api/salary/policies/?department_id=1", None),
    ("Tab 3: Assignments & Overrides", "GET", f"/api/salary/teachers/?department_id=1", None),
    ("Tab 4: Attendance Verification", "GET", f"/api/salary/verifications/?department_id=1&year=2026&month=11", None),
    ("Tab 5: Monthly Salary Preview", "POST", "/api/salary/calculations/preview/", {"department_id": 1, "year": 2026, "month": 11, "summary_only": True}),
    ("Tab 6: Cuttings & Adjustments", "GET", f"/api/salary/adjustments/categories/?department_id=1", None),
    ("Tab 7: Monthly Payroll", "GET", f"/api/salary/payrolls/{period.id}/", None),
    ("Tab 8: Approvals & Disbursements", "GET", f"/api/salary/payrolls/{period.id}/blockers/", None),
]

print("\n" + "="*80)
print(f"{'Endpoint':<35} | {'Queries':<8} | {'DB Time (ms)':<12} | {'Total Time (ms)':<15} | {'Payload Size':<12}")
print("="*80)

settings.DEBUG = True

for label, method, url, body in endpoints:
    reset_queries()
    t0 = time.perf_counter()
    if method == "GET":
        resp = client.get(url)
    else:
        resp = client.post(url, data=body, content_type="application/json")
    t1 = time.perf_counter()

    total_time_ms = (t1 - t0) * 1000
    query_count = len(connection.queries)
    db_time_ms = sum(float(q.get("time", 0)) for q in connection.queries) * 1000
    payload_size_kb = len(resp.content) / 1024

    print(f"{label:<35} | {query_count:<8} | {db_time_ms:<12.2f} | {total_time_ms:<15.2f} | {payload_size_kb:<10.1f} KB")

print("="*80)
test_runner.teardown_databases(db_config)
