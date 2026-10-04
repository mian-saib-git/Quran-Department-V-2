from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import User
from .platform_runtime import record_audit_event


def profile_payload(user, *, password_changed=False):
    full_name = f"{user.first_name} {user.last_name}".strip()

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": full_name or user.username,
        "role": str(user.role or ""),
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
        "institution_id": user.institution_id,
        "department_id": user.department_id,
        "password_changed": password_changed,
    }


class SelfProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(profile_payload(request.user))

    @transaction.atomic
    def patch(self, request):
        user = request.user

        username = str(
            request.data.get("username", user.username)
            or ""
        ).strip()

        if not username:
            return Response(
                {"username": "Username is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        duplicate = (
            User.objects
            .filter(username__iexact=username)
            .exclude(id=user.id)
            .exists()
        )

        if duplicate:
            return Response(
                {"username": "This username already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # `new_password` is the secure Main Admin field. `password` remains
        # supported for older department settings screens.
        new_password = str(
            request.data.get(
                "new_password",
                request.data.get("password", ""),
            )
            or ""
        )
        current_password = str(
            request.data.get("current_password", "")
            or ""
        )

        username_changed = username.casefold() != user.username.casefold()
        is_platform_admin = bool(
            user.is_superuser
            or user.role == User.Role.PLATFORM_ADMIN
        )

        # Sensitive Main Admin changes require the current password even
        # though the user already has an authenticated session.
        if is_platform_admin and (username_changed or new_password):
            if not current_password:
                return Response(
                    {
                        "current_password": (
                            "Current password is required to change the "
                            "Main Admin username or password."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not user.check_password(current_password):
                return Response(
                    {"current_password": "Current password is incorrect."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        if new_password:
            if user.check_password(new_password):
                return Response(
                    {
                        "new_password": (
                            "The new password must be different from the "
                            "current password."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                validate_password(new_password, user=user)
            except DjangoValidationError as exc:
                return Response(
                    {"new_password": list(exc.messages)},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        user.username = username
        user.email = str(
            request.data.get("email", user.email)
            or ""
        ).strip()
        user.first_name = str(
            request.data.get(
                "first_name",
                user.first_name,
            )
            or ""
        ).strip()
        user.last_name = str(
            request.data.get(
                "last_name",
                user.last_name,
            )
            or ""
        ).strip()

        if new_password:
            user.set_password(new_password)

        user.save()
        if is_platform_admin:
            record_audit_event(
                actor=user,
                request=request,
                category="administrators",
                action="main_admin_profile_updated",
                summary="Updated the Main Admin account profile.",
                target_type="user",
                target_id=user.id,
                target_label=user.username,
                details={
                    "username_changed": username_changed,
                    "password_changed": bool(new_password),
                    "email_updated": "email" in request.data,
                    "name_updated": "first_name" in request.data or "last_name" in request.data,
                },
            )

        return Response(
            profile_payload(
                user,
                password_changed=bool(new_password),
            )
        )
