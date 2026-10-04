from rest_framework.exceptions import APIException
from rest_framework_simplejwt.authentication import JWTAuthentication

from .platform_communications import active_maintenance_for_user, maintenance_payload


class MaintenanceModeException(APIException):
    status_code = 423
    default_code = "maintenance_mode"
    default_detail = "This portal is temporarily unavailable due to scheduled maintenance."


class MaintenanceAwareJWTAuthentication(JWTAuthentication):
    """JWT authentication that enforces active institution/department maintenance.

    The context and active-notice endpoints remain available so the frontend can
    render a proper maintenance screen instead of a generic API failure.
    """

    BYPASS_PATHS = {
        "/api/auth/context/",
        "/api/auth/notices/active/",
    }

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None

        user, token = result
        if request.path in self.BYPASS_PATHS:
            return user, token

        maintenance = active_maintenance_for_user(user)
        if maintenance:
            payload = maintenance_payload(maintenance)
            error = MaintenanceModeException()
            error.detail = {
                "detail": payload.get("message") or self.default_detail,
                "code": "maintenance_mode",
                "maintenance": payload,
            }
            raise error

        return user, token
