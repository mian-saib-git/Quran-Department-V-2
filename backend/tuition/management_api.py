from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User, UserDepartmentRole

from .models import (
    TuitionEnrollment,
    TuitionSchedule,
    TuitionTeacherCapability,
)
from .permissions import (
    TuitionDepartmentAccessPermission,
    TuitionFeaturePermission,
    TuitionManagerPermission,
    tuition_role_for_user,
)


MANAGER_ROLES = {
    "department_admin",
    "coordinator",
}


def manager_payload(user, department):
    role_link = (
        UserDepartmentRole.objects
        .filter(
            user=user,
            department=department,
            role__in=MANAGER_ROLES,
        )
        .order_by("id")
        .first()
    )

    full_name = f"{user.first_name} {user.last_name}".strip()

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": full_name or user.username,
        "role": (
            role_link.role
            if role_link
            else str(user.role or "")
        ),
        "is_active": bool(
            user.is_active
            and (
                (role_link and role_link.is_active)
                or user.department_id == department.id
            )
        ),
        "global_is_active": user.is_active,
        "department_id": department.id,
        "institution_id": department.institution_id,
    }


def manager_queryset(department):
    """Return Tuition coordinators only.

    Department-admin accounts are intentionally excluded from the
    Accounts & Enrollment workspace. Department admins manage their
    own credentials from Settings instead.
    """
    return (
        User.objects
        .filter(
            institution_id=department.institution_id,
            role="coordinator",
        )
        .filter(
            Q(department=department)
            | Q(
                department_roles__department=department,
                department_roles__role="coordinator",
                department_roles__is_active=True,
            )
        )
        .distinct()
        .order_by("first_name", "username", "id")
    )


def actor_role(request, department):
    return (
        tuition_role_for_user(
            request.user,
            department,
        )
        or str(getattr(request.user, "role", "") or "")
    ).lower()


def can_manage_role(request, department, target_role):
    if request.user.is_superuser:
        return True

    role = actor_role(request, department)

    if target_role == "department_admin":
        return role in {
            "platform_admin",
            "institution_admin",
            "department_admin",
        }

    return role in {
        "platform_admin",
        "institution_admin",
        "department_admin",
    }


class TuitionManagerListCreateView(APIView):
    feature_key = "tab_tuition_accounts"

    permission_classes = [
        IsAuthenticated,
        TuitionDepartmentAccessPermission,
        TuitionManagerPermission,
        TuitionFeaturePermission,
    ]

    def get(self, request):
        department = request.tuition_department
        queryset = manager_queryset(department)

        role = str(
            request.query_params.get("role", "")
            or ""
        ).strip().lower()

        search = str(
            request.query_params.get("search", "")
            or ""
        ).strip()

        if role in MANAGER_ROLES:
            queryset = queryset.filter(role=role)

        if search:
            queryset = queryset.filter(
                Q(username__icontains=search)
                | Q(email__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
            )

        results = [
            manager_payload(user, department)
            for user in queryset
        ]

        return Response({
            "results": results,
            "count": len(results),
        })

    @transaction.atomic
    def post(self, request):
        department = request.tuition_department

        role = "coordinator"

        if not can_manage_role(
            request,
            department,
            role,
        ):
            return Response(
                {
                    "detail": (
                        "You are not allowed to create "
                        "this management role."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        username = str(
            request.data.get("username", "")
            or ""
        ).strip()
        password = str(
            request.data.get("password", "")
            or ""
        )

        if not username:
            return Response(
                {"username": "Username is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(
            username__iexact=username
        ).exists():
            return Response(
                {
                    "username": (
                        "This username already exists."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(password) < 6:
            return Response(
                {
                    "password": (
                        "Password must be at least "
                        "6 characters."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.create(
            username=username,
            email=str(
                request.data.get("email", "")
                or ""
            ).strip(),
            first_name=str(
                request.data.get("first_name", "")
                or ""
            ).strip(),
            last_name=str(
                request.data.get("last_name", "")
                or ""
            ).strip(),
            role=role,
            institution=department.institution,
            department=department,
            is_active=bool(
                request.data.get("is_active", True)
            ),
        )
        user.set_password(password)
        user.save()

        UserDepartmentRole.objects.update_or_create(
            user=user,
            institution=department.institution,
            department=department,
            role=role,
            defaults={
                "is_active": True,
            },
        )

        return Response(
            manager_payload(user, department),
            status=status.HTTP_201_CREATED,
        )


class TuitionManagerDetailView(APIView):
    feature_key = "tab_tuition_accounts"

    permission_classes = [
        IsAuthenticated,
        TuitionDepartmentAccessPermission,
        TuitionManagerPermission,
        TuitionFeaturePermission,
    ]

    def get_object(self, department, user_id):
        return manager_queryset(department).filter(
            id=user_id
        ).first()

    def get(self, request, user_id):
        department = request.tuition_department
        user = self.get_object(department, user_id)

        if not user:
            return Response(
                {"detail": "Manager account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(manager_payload(user, department))

    @transaction.atomic
    def patch(self, request, user_id):
        department = request.tuition_department
        user = self.get_object(department, user_id)

        if not user:
            return Response(
                {"detail": "Manager account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        current_payload = manager_payload(
            user,
            department,
        )
        current_role = current_payload["role"]
        next_role = str(
            request.data.get("role", current_role)
            or current_role
        ).strip().lower()

        if next_role != "coordinator":
            return Response(
                {"role": "Only coordinator accounts are managed here."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not can_manage_role(
            request,
            department,
            current_role,
        ) or not can_manage_role(
            request,
            department,
            next_role,
        ):
            return Response(
                {
                    "detail": (
                        "You are not allowed to update "
                        "this management role."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        username = str(
            request.data.get(
                "username",
                user.username,
            )
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
                {
                    "username": (
                        "This username already exists."
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
        user.role = next_role
        user.is_active = bool(
            request.data.get(
                "is_active",
                user.is_active,
            )
        )
        user.institution = department.institution
        user.department = department

        password = str(
            request.data.get("password", "")
            or ""
        )

        if password:
            if len(password) < 6:
                return Response(
                    {
                        "password": (
                            "Password must be at least "
                            "6 characters."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            user.set_password(password)

        user.save()

        if current_role != next_role:
            UserDepartmentRole.objects.filter(
                user=user,
                department=department,
                role=current_role,
            ).delete()

        UserDepartmentRole.objects.update_or_create(
            user=user,
            institution=department.institution,
            department=department,
            role=next_role,
            defaults={
                "is_active": user.is_active,
            },
        )

        return Response(manager_payload(user, department))

    @transaction.atomic
    def delete(self, request, user_id):
        department = request.tuition_department
        user = self.get_object(department, user_id)

        if not user:
            return Response(
                {"detail": "Manager account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if user.id == request.user.id:
            return Response(
                {
                    "detail": (
                        "You cannot remove your own "
                        "Tuition access while signed in."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        target_role = manager_payload(
            user,
            department,
        )["role"]

        if not can_manage_role(
            request,
            department,
            target_role,
        ):
            return Response(
                {
                    "detail": (
                        "You are not allowed to remove "
                        "this management role."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        other_links = (
            UserDepartmentRole.objects
            .filter(user=user, is_active=True)
            .exclude(department=department)
            .exists()
        )

        if other_links or (
            user.department_id
            not in {None, department.id}
        ):
            UserDepartmentRole.objects.filter(
                user=user,
                department=department,
                role__in=MANAGER_ROLES,
            ).update(is_active=False)

            if user.department_id == department.id:
                user.department = None
                user.save(update_fields=["department"])

            return Response({
                "detail": (
                    "Tuition Department access removed."
                )
            })

        user.delete()

        return Response({
            "detail": (
                "Tuition manager account deleted."
            )
        })


def schedule_payload(schedule, minutes_until=None):
    enrollment = schedule.enrollment

    return {
        "id": schedule.id,
        "enrollment_id": schedule.enrollment_id,
        "enrollment_start_date": schedule.enrollment.start_date,
        "enrollment_end_date": schedule.enrollment.end_date,
        "enrollment_created_at": schedule.enrollment.created_at,
        "student_id": schedule.student_id,
        "student_name": (
            f"{schedule.student.user.first_name} "
            f"{schedule.student.user.last_name}"
        ).strip() or schedule.student.user.username,
        "teacher_id": schedule.teacher_id,
        "teacher_name": (
            f"{schedule.teacher.user.first_name} "
            f"{schedule.teacher.user.last_name}"
        ).strip() or schedule.teacher.user.username,
        "class_name": enrollment.display_class,
        "subject_name": enrollment.display_subject,
        "weekday": schedule.weekday,
        "start_time": schedule.start_time.strftime("%H:%M"),
        "end_time": schedule.end_time.strftime("%H:%M"),
        "timezone_name": schedule.timezone_name,
        "meeting_link": schedule.meeting_link,
        **(
            {"minutes_until": minutes_until}
            if minutes_until is not None
            else {}
        ),
    }


class TuitionDashboardView(APIView):
    feature_key = "tab_tuition_dashboard"

    permission_classes = [
        IsAuthenticated,
        TuitionDepartmentAccessPermission,
        TuitionManagerPermission,
        TuitionFeaturePermission,
    ]

    def get(self, request):
        department = request.tuition_department

        schedules = (
            TuitionSchedule.objects
            .filter(
                department=department,
                is_active=True,
                enrollment__is_active=True,
            )
            .select_related(
                "enrollment__class_level",
                "enrollment__subject",
                "student__user",
                "teacher__user",
            )
        )

        live_classes = []
        upcoming = []

        for schedule in schedules:
            try:
                local_now = datetime.now(
                    ZoneInfo(
                        schedule.timezone_name
                        or "Asia/Karachi"
                    )
                )
            except Exception:
                local_now = datetime.now(
                    ZoneInfo("Asia/Karachi")
                )

            weekday = local_now.strftime("%A").lower()

            if weekday != schedule.weekday:
                continue

            current_minutes = (
                local_now.hour * 60
                + local_now.minute
            )
            start_minutes = (
                schedule.start_time.hour * 60
                + schedule.start_time.minute
            )
            end_minutes = (
                schedule.end_time.hour * 60
                + schedule.end_time.minute
            )

            if start_minutes <= current_minutes < end_minutes:
                live_classes.append(
                    schedule_payload(schedule)
                )
            elif current_minutes < start_minutes:
                upcoming.append((
                    start_minutes - current_minutes,
                    schedule,
                ))

        upcoming.sort(
            key=lambda item: (
                item[0],
                item[1].start_time,
                item[1].teacher_id,
            )
        )

        active_subjects = (
            TuitionEnrollment.objects
            .filter(
                department=department,
                is_active=True,
            )
            .values(
                "student_id",
                "subject_id",
                "custom_subject_name",
            )
            .distinct()
            .count()
        )

        manager_count = manager_queryset(
            department
        ).count()

        teacher_count = (
            User.objects
            .filter(
                institution_id=department.institution_id,
                role="teacher",
                is_active=True,
            )
            .filter(
                Q(department=department)
                | Q(
                    department_roles__department=department,
                    department_roles__role="teacher",
                    department_roles__is_active=True,
                )
            )
            .distinct()
            .count()
        )

        student_count = (
            User.objects
            .filter(
                institution_id=department.institution_id,
                role="student",
                is_active=True,
            )
            .filter(
                Q(department=department)
                | Q(
                    department_roles__department=department,
                    department_roles__role="student",
                    department_roles__is_active=True,
                )
            )
            .distinct()
            .count()
        )

        return Response({
            "counts": {
                "students": student_count,
                "teachers": teacher_count,
                "managers": manager_count,
                "active_subjects": active_subjects,
                "active_schedules": schedules.count(),
            },
            "live_classes": live_classes,
            "up_next_classes": [
                schedule_payload(
                    schedule,
                    minutes_until=minutes,
                )
                for minutes, schedule
                in upcoming[:12]
            ],
        })
