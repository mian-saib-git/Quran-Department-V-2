"""
Self-contained, isolated test runner for the Salary module.
Uses in-memory SQLite, disables daphne loopback socket hanging,
and disables postgres migration syntax checks.
"""
import os
import sys

backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings"

from django.conf import settings

# Force completely isolated disposable in-memory SQLite database
settings.DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}

# Daphne reactor attempts to bind to loopback sockets in sandbox, exclude during test runs
installed_apps = [app for app in settings.INSTALLED_APPS if app != "daphne"]
settings.INSTALLED_APPS = installed_apps

# Disable migrations during tests so SQLite builds tables directly from models
class DisableMigrations:
    def __contains__(self, item):
        return True
    def __getitem__(self, item):
        return None

settings.MIGRATION_MODULES = DisableMigrations()
settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

import django
django.setup()

from django.test.utils import get_runner

if __name__ == "__main__":
    TestRunner = get_runner(settings)
    test_runner = TestRunner(verbosity=2, interactive=False)
    test_labels = sys.argv[1:] if len(sys.argv) > 1 else [
        "salary.tests.test_policy_models",
        "salary.tests.test_policy_api",
        "salary.tests.test_assignments_and_overrides",
        "salary.tests.test_attendance_verification",
        "salary.tests.test_salary_calculation",
        "salary.tests.test_salary_corrections_stage_5a",
        "salary.tests.test_cuttings_and_bonuses_stage_6",
        "salary.tests.test_monthly_payroll_stage_7a",
        "salary.tests.test_payroll_approvals_stage_7b",
        "salary.tests.test_stage_8a_remediation",
        "salary.tests.test_stage_9a_cutover_guards",
    ]
    print(f"Running Unified Salary Test Suite for: {test_labels}...", flush=True)
    failures = test_runner.run_tests(test_labels)
    print(f"Total failures: {failures}", flush=True)
    sys.exit(failures)
