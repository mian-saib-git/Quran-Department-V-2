from django.db import transaction
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import User


def profile_payload(user):
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

        password = str(
            request.data.get("password", "")
            or ""
        )

        if password and len(password) < 6:
            return Response(
                {
                    "password": (
                        "Password must be at least "
                        "6 characters."
                    )
                },
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

        if password:
            user.set_password(password)

        user.save()

        return Response(profile_payload(user))
