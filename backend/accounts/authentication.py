from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import APIException
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.utils import get_md5_hash_password

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

    def get_user(self, validated_token):
        """Load the authenticated user with primary department and institution joined.

        Preserves all simplejwt validation checks while avoiding lazy FK queries
        when maintenance checks or views access user.department / user.institution.
        """
        try:
            user_id = validated_token[api_settings.USER_ID_CLAIM]
        except KeyError as exc:
            raise InvalidToken(_("Token contained no recognizable user identification")) from exc

        try:
            user = (
                self.user_model.objects.select_related("department", "institution")
                .get(**{api_settings.USER_ID_FIELD: user_id})
            )
        except self.user_model.DoesNotExist as exc:
            raise AuthenticationFailed(_("User not found"), code="user_not_found") from exc

        if api_settings.CHECK_USER_IS_ACTIVE and not user.is_active:
            raise AuthenticationFailed(_("User is inactive"), code="user_inactive")

        if api_settings.CHECK_REVOKE_TOKEN:
            if validated_token.get(api_settings.REVOKE_TOKEN_CLAIM) != get_md5_hash_password(user.password):
                raise AuthenticationFailed(_("The user's password has been changed."), code="password_changed")

        return user

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
