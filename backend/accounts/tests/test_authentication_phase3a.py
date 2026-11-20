from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.request import Request as DRFRequest
from rest_framework.test import APIClient, APIRequestFactory, APITestCase
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.authentication import MaintenanceAwareJWTAuthentication, MaintenanceModeException
from accounts.models import Department, Institution, PlatformMaintenanceWindow, UserDepartmentRole

User = get_user_model()


@override_settings(ALLOWED_HOSTS=["localhost", "127.0.0.1", "testserver"])
class AuthenticationPhase3ARegressionTests(APITestCase):
    def setUp(self):
        self.institution = Institution.objects.create(name="IVS Test", slug="ivs-auth-3a")
        self.other_institution = Institution.objects.create(name="IVS Other", slug="ivs-other-3a")
        self.quran_dept = Department.objects.create(
            institution=self.institution,
            name="Quran",
            code="quran-3a",
            department_type=Department.DepartmentType.QURAN,
        )
        self.tuition_dept = Department.objects.create(
            institution=self.institution,
            name="Tuition",
            code="tuition-3a",
            department_type=Department.DepartmentType.TUITION,
        )
        self.other_dept = Department.objects.create(
            institution=self.other_institution,
            name="Other Quran",
            code="other-quran-3a",
            department_type=Department.DepartmentType.QURAN,
        )

        self.coordinator = User.objects.create_user(
            username="coord_3a",
            password="Password123!",
            role=User.Role.COORDINATOR,
            institution=self.institution,
            department=self.quran_dept,
        )
        UserDepartmentRole.objects.create(
            user=self.coordinator,
            institution=self.institution,
            department=self.quran_dept,
            role=UserDepartmentRole.Role.COORDINATOR,
            is_active=True,
        )

        self.tuition_coord = User.objects.create_user(
            username="tuition_coord_3a",
            password="Password123!",
            role=User.Role.COORDINATOR,
            institution=self.institution,
            department=self.tuition_dept,
        )
        UserDepartmentRole.objects.create(
            user=self.tuition_coord,
            institution=self.institution,
            department=self.tuition_dept,
            role=UserDepartmentRole.Role.COORDINATOR,
            is_active=True,
        )

        self.platform_admin = User.objects.create_user(
            username="platform_admin_3a",
            password="Password123!",
            role=User.Role.PLATFORM_ADMIN,
            is_staff=True,
            is_superuser=True,
        )

        self.multi_dept_user = User.objects.create_user(
            username="multi_dept_3a",
            password="Password123!",
            role=User.Role.COORDINATOR,
            institution=self.institution,
            department=self.quran_dept,
        )
        UserDepartmentRole.objects.create(
            user=self.multi_dept_user,
            institution=self.institution,
            department=self.quran_dept,
            role=UserDepartmentRole.Role.COORDINATOR,
            is_active=True,
        )
        self.multi_tuition_role = UserDepartmentRole.objects.create(
            user=self.multi_dept_user,
            institution=self.institution,
            department=self.tuition_dept,
            role=UserDepartmentRole.Role.TEACHER,
            is_active=True,
        )

        self.factory = APIRequestFactory()
        self.auth = MaintenanceAwareJWTAuthentication()
        self.client = APIClient()

    def _token_for(self, user):
        return str(RefreshToken.for_user(user).access_token)

    def _authenticate_token(self, token, path="/api/auth/notifications/"):
        request = DRFRequest(self.factory.get(path, HTTP_AUTHORIZATION=f"Bearer {token}"))
        return self.auth.authenticate(request)

    def _authenticate(self, user, path="/api/auth/notifications/"):
        token = self._token_for(user)
        return self._authenticate_token(token, path=path)

    def test_auth_query_counts_within_budget(self):
        coord_token = self._token_for(self.coordinator)
        with self.assertNumQueries(2):
            user, _ = self._authenticate_token(coord_token)
            self.assertEqual(user.department_id, self.quran_dept.id)
            # Accessing joined department and institution must not trigger extra queries.
            _ = user.department.institution_id

        multi_token = self._token_for(self.multi_dept_user)
        with self.assertNumQueries(2):
            self._authenticate_token(multi_token)

        admin_token = self._token_for(self.platform_admin)
        with self.assertNumQueries(1):
            self._authenticate_token(admin_token)

    def test_inactive_user_and_invalid_tokens_rejected(self):
        token = self._token_for(self.coordinator)
        self.coordinator.is_active = False
        self.coordinator.save(update_fields=["is_active"])

        with self.assertRaises(AuthenticationFailed):
            request = DRFRequest(
                self.factory.get("/api/auth/me/", HTTP_AUTHORIZATION=f"Bearer {token}")
            )
            self.auth.authenticate(request)

        with self.assertRaises(InvalidToken):
            request = DRFRequest(
                self.factory.get("/api/auth/me/", HTTP_AUTHORIZATION="Bearer invalid.jwt.token")
            )
            self.auth.authenticate(request)

    def test_department_maintenance_isolation_and_exemptions(self):
        PlatformMaintenanceWindow.objects.create(
            scope_type=PlatformMaintenanceWindow.ScopeType.DEPARTMENT,
            institution=self.institution,
            department=self.quran_dept,
            title="Quran Maintenance",
            message="Quran portal is under maintenance.",
            is_active=True,
        )

        coord_token = self._token_for(self.coordinator)
        with self.assertNumQueries(2):
            with self.assertRaises(MaintenanceModeException) as ctx:
                self._authenticate_token(coord_token)
            self.assertEqual(ctx.exception.status_code, 423)

        # Multi-department user assigned to Quran is blocked.
        with self.assertRaises(MaintenanceModeException):
            self._authenticate(self.multi_dept_user)

        # Tuition-only user is not blocked by Quran department maintenance.
        user, _ = self._authenticate(self.tuition_coord)
        self.assertEqual(user.id, self.tuition_coord.id)

        # Platform Admin is exempt from maintenance.
        admin_user, _ = self._authenticate(self.platform_admin)
        self.assertEqual(admin_user.id, self.platform_admin.id)

    def test_role_revocation_and_grant_take_effect_immediately(self):
        PlatformMaintenanceWindow.objects.create(
            scope_type=PlatformMaintenanceWindow.ScopeType.DEPARTMENT,
            institution=self.institution,
            department=self.tuition_dept,
            title="Tuition Maintenance",
            message="Tuition portal is under maintenance.",
            is_active=True,
        )

        # Initially, coordinator is only in Quran -> not blocked by Tuition maintenance.
        self._authenticate(self.coordinator)

        # Grant active Tuition role to coordinator -> blocked on very next request (same token).
        token = self._token_for(self.coordinator)
        granted_role = UserDepartmentRole.objects.create(
            user=self.coordinator,
            institution=self.institution,
            department=self.tuition_dept,
            role=UserDepartmentRole.Role.TEACHER,
            is_active=True,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        resp_blocked = self.client.get("/api/auth/me/")
        self.assertEqual(resp_blocked.status_code, 423)

        # Revoke the Tuition role -> unblocked on very next request (same token).
        granted_role.is_active = False
        granted_role.save(update_fields=["is_active"])
        resp_ok = self.client.get("/api/auth/me/")
        self.assertEqual(resp_ok.status_code, 200)

    def test_maintenance_schedule_boundaries_and_manual_toggle(self):
        now = timezone.now()
        window = PlatformMaintenanceWindow.objects.create(
            scope_type=PlatformMaintenanceWindow.ScopeType.PLATFORM,
            title="Scheduled Platform Maintenance",
            message="Scheduled window",
            is_active=True,
            starts_at=now + timedelta(minutes=10),
            ends_at=now + timedelta(minutes=30),
        )
        token = self._token_for(self.coordinator)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

        # Future maintenance must not block.
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)

        # Window starts during active session -> blocks immediately.
        window.starts_at = now - timedelta(minutes=1)
        window.save(update_fields=["starts_at"])
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 423)

        # Bypass paths remain accessible and /api/auth/context/ reports active maintenance.
        ctx_resp = self.client.get("/api/auth/context/")
        self.assertEqual(ctx_resp.status_code, 200)
        self.assertTrue(ctx_resp.data["maintenance"]["active"])
        self.assertEqual(self.client.get("/api/auth/notices/active/").status_code, 200)

        # Window ends during active session -> unblocks immediately.
        window.ends_at = now - timedelta(seconds=1)
        window.save(update_fields=["ends_at"])
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)

        # Re-open window and deactivate manually -> unblocks immediately.
        window.ends_at = now + timedelta(minutes=30)
        window.save(update_fields=["ends_at"])
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 423)

        window.is_active = False
        window.save(update_fields=["is_active"])
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)
