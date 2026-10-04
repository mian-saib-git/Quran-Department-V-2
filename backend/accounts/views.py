# IVS_PERMANENT_FEATURE_CONTEXT_FIX_V23
from django.contrib.auth import authenticate
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import Q, Prefetch
from django.utils.text import slugify
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import (
    User,
    Institution,
    Department,
    Feature,
    DepartmentFeature,
    UserDepartmentRole,
    CoordinatorTabAccess,
)
from .deletion_service import permanently_delete_department, permanently_delete_institution
from .platform_runtime import record_audit_event
from .platform_communications import active_maintenance_for_user, maintenance_payload
from .serializers import (
    CreateAccountSerializer,
    UpdateAccountSerializer,
    account_payload_for_user,
)
from academy.models import TeacherProfile, StudentProfile, StudentSubject, ClassSchedule
from academy.ws_notify import notify_global


COORDINATOR_TAB_DEFINITIONS = {
    Department.DepartmentType.QURAN: [
        {"key": "tab_daily_classes", "label": "Dashboard", "description": "Daily classes dashboard and live class overview."},
        {"key": "tab_accounts_enrollment", "label": "Accounts & Enrollment", "description": "Teacher and student account management."},
        {"key": "tab_lessons_control", "label": "Lessons Control", "description": "Lesson records, plans and lesson controls."},
        {"key": "tab_scheduling", "label": "Scheduling", "description": "Quran class schedules and timetable."},
        {"key": "tab_attendance", "label": "Attendance", "description": "Attendance workspace and attendance records."},
        {"key": "tab_dropped_leave", "label": "Dropped & Leave", "description": "Dropped, leave and absence tracking."},
        {"key": "tab_reports", "label": "Reports", "description": "Attendance and performance reports."},
    ],
    Department.DepartmentType.TUITION: [
        {"key": "tab_tuition_dashboard", "label": "Dashboard", "description": "Tuition dashboard and live class overview."},
        {"key": "tab_tuition_accounts", "label": "Accounts & Enrollment", "description": "Tuition accounts and enrollment workspace."},
        {"key": "tab_tuition_scheduling", "label": "Scheduling", "description": "Tuition schedules and teacher availability."},
        {"key": "tab_tuition_attendance", "label": "Attendance", "description": "Tuition attendance workspace."},
        {"key": "tab_tuition_reports", "label": "Reports", "description": "Tuition reports and analytics."},
    ],
}


def coordinator_tab_definitions(department):
    if not department:
        return []
    return list(COORDINATOR_TAB_DEFINITIONS.get(department.department_type, []))


def coordinator_tab_access_map(user, department):
    definitions = coordinator_tab_definitions(department)
    access = {item["key"]: True for item in definitions}

    if (
        not user
        or not department
        or str(getattr(user, "role", "") or "").lower() != User.Role.COORDINATOR
    ):
        return access

    configured = CoordinatorTabAccess.objects.filter(
        coordinator=user,
        department=department,
        tab_key__in=list(access.keys()),
    ).values_list("tab_key", "is_visible")

    for tab_key, is_visible in configured:
        access[tab_key] = bool(is_visible)

    return access


def department_feature_map(department):
    definitions = coordinator_tab_definitions(department)
    tab_keys = [item["key"] for item in definitions]
    result = {key: True for key in tab_keys}

    if not department or not tab_keys:
        return result

    features = {
        feature.key: feature
        for feature in Feature.objects.filter(
            key__in=tab_keys,
            is_active=True,
            department_type=department.department_type,
        )
    }
    configured = {
        item.feature_id: item.is_enabled
        for item in DepartmentFeature.objects.filter(
            department=department,
            feature_id__in=[feature.id for feature in features.values()],
        )
    }

    for key, feature in features.items():
        result[key] = configured.get(feature.id, True)

    return result


def coordinator_tab_is_visible(user, department, tab_key):
    if str(getattr(user, "role", "") or "").lower() != User.Role.COORDINATOR:
        return True
    return coordinator_tab_access_map(user, department).get(tab_key, True)


def coordinator_has_effective_tab_access(user, department, tab_key):
    if not department:
        return False
    if not department_feature_map(department).get(tab_key, True):
        return False
    return coordinator_tab_is_visible(user, department, tab_key)


def coordinator_departments(user):
    departments = []
    seen = set()

    direct = getattr(user, "department", None)
    if direct and direct.is_active:
        departments.append(direct)
        seen.add(direct.id)

    linked = (
        UserDepartmentRole.objects.filter(
            user=user,
            role=UserDepartmentRole.Role.COORDINATOR,
            is_active=True,
            department__isnull=False,
            department__is_active=True,
        )
        .select_related("department", "department__institution")
        .order_by("id")
    )
    for item in linked:
        if item.department_id not in seen:
            departments.append(item.department)
            seen.add(item.department_id)

    return departments


def actor_can_manage_coordinator_department(actor, department):
    if not actor or not getattr(actor, "is_authenticated", False) or not department:
        return False

    role = str(getattr(actor, "role", "") or "").lower()
    if getattr(actor, "is_superuser", False) or role == User.Role.PLATFORM_ADMIN:
        return True
    if role == User.Role.INSTITUTION_ADMIN:
        return bool(getattr(actor, "institution_id", None) == department.institution_id)
    if role != User.Role.DEPARTMENT_ADMIN:
        return False

    if getattr(actor, "department_id", None) == department.id:
        return True

    return UserDepartmentRole.objects.filter(
        user=actor,
        department=department,
        role=UserDepartmentRole.Role.DEPARTMENT_ADMIN,
        is_active=True,
    ).exists()


def resolve_managed_coordinator_department(actor, coordinator):
    for department in coordinator_departments(coordinator):
        if actor_can_manage_coordinator_department(actor, department):
            return department
    return None


def coordinator_tab_access_payload(coordinator, department):
    definitions = coordinator_tab_definitions(department)
    access = coordinator_tab_access_map(coordinator, department)
    main_features = department_feature_map(department)
    return {
        "user_id": coordinator.id,
        "department": {
            "id": department.id,
            "name": department.name,
            "code": department.code,
            "department_type": department.department_type,
        },
        "tabs": access,
        "options": [
            {
                **item,
                "is_allowed": access.get(item["key"], True),
                "main_admin_enabled": main_features.get(item["key"], True),
            }
            for item in definitions
        ],
    }



def resolve_department_for_account_scope(user, department_type="quran"):
    """Return the department that the Quran Accounts API must use for scoping.

    This prevents Tuition coordinators from appearing inside Quran Accounts and
    also prevents Quran coordinators from appearing inside Tuition manager APIs.
    """
    if not user or not getattr(user, "is_authenticated", False):
        return None

    primary_department = getattr(user, "department", None)
    if primary_department and (
        not department_type
        or getattr(primary_department, "department_type", None) == department_type
    ):
        return primary_department

    role_link_qs = (
        UserDepartmentRole.objects.filter(
            user=user,
            is_active=True,
            department__isnull=False,
        )
        .select_related("department", "institution")
        .order_by("id")
    )

    if department_type:
        role_link_qs = role_link_qs.filter(
            department__department_type=department_type,
        )

    role_link = role_link_qs.first()
    if role_link and role_link.department:
        return role_link.department

    institution_id = getattr(user, "institution_id", None)
    if institution_id:
        departments = Department.objects.filter(
            institution_id=institution_id,
            is_active=True,
        ).order_by("id")
        if department_type:
            departments = departments.filter(department_type=department_type)
        department = departments.first()
        if department:
            return department

    if getattr(user, "is_superuser", False):
        departments = Department.objects.filter(is_active=True).order_by("id")
        if department_type:
            departments = departments.filter(department_type=department_type)
        return departments.first()

    return None


def user_is_in_same_account_scope(manager_user, target_user, department_type="quran"):
    department = resolve_department_for_account_scope(manager_user, department_type)
    if not department:
        return False

    if getattr(target_user, "department_id", None) == department.id:
        return True

    return UserDepartmentRole.objects.filter(
        user=target_user,
        department=department,
        is_active=True,
    ).exists()


def scoped_coordinator_queryset(manager_user, base_queryset=None, department_type="quran"):
    department = resolve_department_for_account_scope(manager_user, department_type)
    queryset = base_queryset if base_queryset is not None else User.objects.all()

    queryset = queryset.filter(
        role=User.Role.COORDINATOR,
        is_superuser=False,
    )

    if not department:
        return queryset.none()

    return (
        queryset.filter(
            Q(department=department)
            | Q(
                department_roles__department=department,
                department_roles__role=UserDepartmentRole.Role.COORDINATOR,
                department_roles__is_active=True,
            )
        )
        .distinct()
    )


def account_role(user):
    return str(getattr(user, "role", "") or "").lower()


def can_manage_department_accounts(user):
    role = account_role(user)
    return bool(
        user
        and user.is_authenticated
        and (
            getattr(user, "is_superuser", False)
            or role in {"coordinator", "department_admin", "institution_admin"}
        )
    )


def can_manage_coordinator_accounts(user):
    role = account_role(user)
    return bool(
        user
        and user.is_authenticated
        and (
            getattr(user, "is_superuser", False)
            or role in {"department_admin", "institution_admin"}
        )
    )



def user_can_manage_accounts(user):
    role = str(getattr(user, "role", "") or "").lower()
    return (
        bool(getattr(user, "is_superuser", False))
        or role in {"coordinator", "department_admin", "institution_admin", "platform_admin"}
    )



def auth_payload(user):
    payload = {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "full_name": user.get_full_name() or user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
    }

    if user.role == User.Role.TEACHER:
        try:
            teacher = user.teacher_profile
            payload["teacherId"] = str(teacher.id)
            payload["teacher_id"] = teacher.id
        except TeacherProfile.DoesNotExist:
            payload["teacherId"] = None
            payload["teacher_id"] = None

    if user.role == User.Role.STUDENT:
        try:
            student = user.student_profile
            payload["studentId"] = str(student.id)
            payload["student_id"] = student.id
            payload["teacherId"] = str(student.teacher_id)
            payload["teacher_id"] = student.teacher_id
        except StudentProfile.DoesNotExist:
            payload["studentId"] = None
            payload["student_id"] = None
            payload["teacherId"] = None
            payload["teacher_id"] = None

    return payload


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        from django.core.cache import cache

        username = str(request.data.get("username", "")).strip()
        password = str(request.data.get("password", ""))

        if not username or not password:
            return Response(
                {"detail": "Username and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ── Brute Force Protection ────────────────────────────
        cache_key = f"login_fail_{username}"
        fail_count = cache.get(cache_key, 0)

        if fail_count >= 5:
            return Response(
                {"detail": "Too many failed attempts. Please wait 15 minutes and try again."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        # ─────────────────────────────────────────────────────

        user = authenticate(request, username=username, password=password)

        if user is None:
            # Increase fail counter by 1, block for 15 minutes
            cache.set(cache_key, fail_count + 1, timeout=900)
            return Response(
                {"detail": "Invalid username or password."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if not user.is_active:
            return Response(
                {"detail": "This account is disabled."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # ── Reset fail counter on successful login ────────────
        cache.delete(cache_key)
        # ─────────────────────────────────────────────────────

        refresh = RefreshToken.for_user(user)

        return Response({
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": auth_payload(user),
        })


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(auth_payload(request.user))




def resolve_auth_context_department(user, roles_qs):
    """Resolve one stable active department for the signed-in portal.

    Prefer the user's primary department when it is still represented by an
    active department role. If that primary assignment is stale or missing,
    use the active role matching the user's current role before falling back.
    """
    primary = getattr(user, "department", None)
    primary_is_active = bool(
        primary
        and primary.is_active
        and primary.institution_id
        and primary.institution.is_active
    )

    active_role_links = [
        item
        for item in roles_qs
        if item.department
        and item.department.is_active
        and item.institution.is_active
    ]

    if primary_is_active:
        if not active_role_links or any(
            item.department_id == primary.id for item in active_role_links
        ):
            return primary

    current_role = str(getattr(user, "role", "") or "")
    for item in active_role_links:
        if item.role == current_role:
            return item.department

    if primary_is_active:
        return primary

    if active_role_links:
        return active_role_links[0].department

    if user.is_superuser or current_role in [
        User.Role.PLATFORM_ADMIN,
        User.Role.INSTITUTION_ADMIN,
    ]:
        return (
            Department.objects.filter(
                department_type=Department.DepartmentType.QURAN,
                is_active=True,
                institution__is_active=True,
            )
            .select_related("institution")
            .order_by("id")
            .first()
        )

    return None


class AuthContextView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        roles_qs = list(
            UserDepartmentRole.objects.filter(user=user, is_active=True)
            .select_related("institution", "department", "department__institution")
            .order_by("institution__name", "department__name", "role", "id")
        )

        department = resolve_auth_context_department(user, roles_qs)
        institution = department.institution if department else getattr(user, "institution", None)

        roles = [
            {
                "id": item.id,
                "role": item.role,
                "institution": {
                    "id": item.institution_id,
                    "name": item.institution.name,
                    "slug": item.institution.slug,
                },
                "department": {
                    "id": item.department_id,
                    "name": item.department.name,
                    "code": item.department.code,
                    "department_type": item.department.department_type,
                } if item.department else None,
            }
            for item in roles_qs
        ]

        features = {}
        if department:
            applicable_features = list(
                Feature.objects.filter(
                    is_active=True,
                    department_type=department.department_type,
                ).order_by("sort_order", "name", "id")
            )

            settings_by_feature_id = {
                item.feature_id: item.is_enabled
                for item in DepartmentFeature.objects.filter(
                    department=department,
                    feature_id__in=[feature.id for feature in applicable_features],
                )
            }

            # Missing rows mean the default setting has never been materialized,
            # not that Main Admin disabled the feature. Migrations repair those
            # rows, while this default prevents a partial permission map from
            # falsely locking a dashboard during deployment.
            features = {
                feature.key: settings_by_feature_id.get(feature.id, True)
                for feature in applicable_features
            }

        response = Response({
            "user": auth_payload(user),
            "institution": {
                "id": institution.id,
                "name": institution.name,
                "slug": institution.slug,
            } if institution else None,
            "department": {
                "id": department.id,
                "name": department.name,
                "code": department.code,
                "department_type": department.department_type,
            } if department else None,
            "features": features,
            "roles": roles,
            "maintenance": maintenance_payload(active_maintenance_for_user(user)),
        })
        response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response["Pragma"] = "no-cache"
        return response


class CoordinatorAccountListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not can_manage_department_accounts(request.user):
            return Response(
                {"detail": "Only Quran department admins and coordinators can view accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        department = resolve_department_for_account_scope(request.user, "quran")
        if not coordinator_has_effective_tab_access(
            request.user, department, "tab_accounts_enrollment"
        ):
            return Response(
                {"detail": "Accounts & Enrollment is not available for this coordinator."},
                status=status.HTTP_403_FORBIDDEN,
            )

        role_filter = str(request.query_params.get("role", "")).strip().lower()
        search = str(request.query_params.get("search", "")).strip()

        def safe_int(value, default):
            try:
                number = int(value)
                return number if number > 0 else default
            except Exception:
                return default

        page = safe_int(request.query_params.get("page", 1), 1)
        page_size = safe_int(request.query_params.get("page_size", 25), 25)
        page_size = min(page_size, 100)

        active_subjects_prefetch = Prefetch(
            "assigned_subjects",
            queryset=StudentSubject.objects.filter(is_active=True).order_by(
                "subject",
                "custom_subject_name",
                "id",
            ),
            to_attr="prefetched_active_subjects",
        )

        active_schedules_prefetch = Prefetch(
            "schedules",
            queryset=ClassSchedule.objects.filter(is_active=True)
            .select_related("teacher__user")
            .order_by("time_slot", "weekday", "id"),
            to_attr="prefetched_active_schedules",
        )

        def build_teachers():
            department = resolve_department_for_account_scope(
                request.user,
                "quran",
            )

            if not department:
                return TeacherProfile.objects.none()

            qs = (
                TeacherProfile.objects
                .filter(department=department)
                .select_related("user")
                .order_by(
                    "user__first_name",
                    "user__username",
                    "id",
                )
            )

            if search:
                qs = qs.filter(
                    Q(user__username__icontains=search)
                    | Q(user__email__icontains=search)
                    | Q(user__first_name__icontains=search)
                    | Q(user__last_name__icontains=search)
                    | Q(phone__icontains=search)
                )

            return qs

        def build_students():
            department = resolve_department_for_account_scope(
                request.user,
                "quran",
            )

            if not department:
                return StudentProfile.objects.none()

            qs = (
                StudentProfile.objects
                .filter(department=department)
                .select_related("user", "teacher__user")
                .prefetch_related(
                    active_subjects_prefetch,
                    active_schedules_prefetch,
                )
                .order_by(
                    "user__first_name",
                    "user__username",
                    "id",
                )
            )

            if search:
                qs = qs.filter(
                    Q(user__username__icontains=search)
                    | Q(user__email__icontains=search)
                    | Q(user__first_name__icontains=search)
                    | Q(user__last_name__icontains=search)
                    | Q(phone__icontains=search)
                    | Q(teacher__user__first_name__icontains=search)
                    | Q(teacher__user__last_name__icontains=search)
                    | Q(teacher__user__username__icontains=search)
                    | Q(schedules__weekday__icontains=search)
                    | Q(schedules__time_slot__icontains=search)
                ).distinct()

            return qs

        def build_coordinators():
            if not can_manage_coordinator_accounts(request.user):
                return User.objects.none()

            qs = scoped_coordinator_queryset(request.user)

            if search:
                qs = qs.filter(
                    Q(username__icontains=search)
                    | Q(email__icontains=search)
                    | Q(first_name__icontains=search)
                    | Q(last_name__icontains=search)
                )

            return qs.order_by("first_name", "username", "id")

        def paginated_response(items_qs, payload_fn, role_name, extra=None):
            paginator = Paginator(items_qs, page_size)
            safe_page = min(max(page, 1), paginator.num_pages or 1)
            page_obj = paginator.get_page(safe_page)

            payload_items = [payload_fn(item) for item in page_obj.object_list]

            response_data = {
                "coordinators": [],
                "teachers": [],
                "students": [],
                "pagination": {
                    "role": role_name,
                    "page": safe_page,
                    "page_size": page_size,
                    "total_items": paginator.count,
                    "total_pages": paginator.num_pages or 1,
                },
            }

            response_data[role_name + "s"] = payload_items

            if extra:
                response_data.update(extra)

            return Response(response_data)

        # New fast paginated API.
        # Example: /api/auth/accounts/?role=student&page=1&page_size=25
        if role_filter == "coordinator":
            return paginated_response(
                build_coordinators(),
                lambda user: account_payload_for_user(user),
                "coordinator",
            )

        if role_filter == "teacher":
            return paginated_response(
                build_teachers(),
                lambda teacher: account_payload_for_user(teacher.user),
                "teacher",
            )

        if role_filter == "student":
            # Students page still needs the teacher list for the Add/Edit student dropdown.
            all_teachers = [
                account_payload_for_user(item.user)
                for item in TeacherProfile.objects.select_related("user").order_by(
                    "user__first_name",
                    "user__username",
                    "id",
                )
            ]

            return paginated_response(
                build_students(),
                lambda student: account_payload_for_user(student.user),
                "student",
                extra={"teachers": all_teachers},
            )

        # Old API shape. Keep this so nothing breaks before frontend update.
        coordinators = []

        if can_manage_coordinator_accounts(request.user):
            coordinators = [
                account_payload_for_user(item)
                for item in scoped_coordinator_queryset(request.user).order_by(
                    "first_name",
                    "username",
                    "id",
                )
            ]

        teachers = [
            account_payload_for_user(item.user)
            for item in build_teachers()
        ]

        students = [
            account_payload_for_user(item.user)
            for item in build_students()
        ]

        return Response({
            "coordinators": coordinators,
            "teachers": teachers,
            "students": students,
        })

    def post(self, request):
        if not can_manage_department_accounts(request.user):
            return Response(
                {"detail": "Only coordinators can create accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        department = resolve_department_for_account_scope(request.user, "quran")
        if not coordinator_has_effective_tab_access(
            request.user, department, "tab_accounts_enrollment"
        ):
            return Response(
                {"detail": "Accounts & Enrollment is not available for this coordinator."},
                status=status.HTTP_403_FORBIDDEN,
            )

        requested_role = str(request.data.get("role", "")).strip()

        if requested_role == User.Role.COORDINATOR and not can_manage_coordinator_accounts(request.user):
            return Response(
                {"detail": "Only department admins can create coordinator accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = CreateAccountSerializer(data=request.data, context={"request_user": request.user})

        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        account = serializer.save()

        from academy.ws_notify import notify_role
        notify_global("academy_update", {
            "event": "account_created",
            "message": "Account created",
            "account_id": account.get("id") if isinstance(account, dict) else None,
            "role": account.get("role") if isinstance(account, dict) else requested_role,
        })
        # Notify teacher role so their dashboard refreshes
        # Using threading to add slight delay ensuring DB commit is complete
        import threading
        def _notify():
            import time
            time.sleep(0.8)
            notify_role("teacher", "academy_update", {
                "event": "account_created",
                "role": account.get("role") if isinstance(account, dict) else requested_role,
            })
        threading.Thread(target=_notify, daemon=True).start()

        return Response(account, status=status.HTTP_201_CREATED)


class CoordinatorAccountDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_object(self, request, user_id):
        try:
            user = User.objects.get(
                id=user_id,
                role__in=[
                    User.Role.COORDINATOR,
                    User.Role.TEACHER,
                    User.Role.STUDENT,
                ],
            )
        except User.DoesNotExist:
            return None

        if user.role == User.Role.COORDINATOR and not user_is_in_same_account_scope(
            request.user,
            user,
            "quran",
        ):
            return None

        return user

    def patch(self, request, user_id):
        department = resolve_department_for_account_scope(request.user, "quran")
        if not coordinator_has_effective_tab_access(
            request.user, department, "tab_accounts_enrollment"
        ):
            return Response(
                {"detail": "Accounts & Enrollment is not available for this coordinator."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not can_manage_department_accounts(request.user):
            return Response(
                {"detail": "Only coordinators can edit accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        user = self.get_object(request, user_id)

        if user is None:
            return Response(
                {"detail": "Account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if user.role == User.Role.COORDINATOR and not can_manage_coordinator_accounts(request.user):
            return Response(
                {"detail": "Only department admins can edit coordinator accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = UpdateAccountSerializer(
            user,
            data=request.data,
            partial=True,
            context={"user": user, "request_user": request.user},
        )

        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        account = serializer.save()

        notify_global("academy_update", {
            "event": "account_updated",
            "message": "Account updated",
            "account_id": account.get("id") if isinstance(account, dict) else user.id,
            "role": account.get("role") if isinstance(account, dict) else user.role,
        })

        return Response(account)

    def delete(self, request, user_id):
        department = resolve_department_for_account_scope(request.user, "quran")
        if not coordinator_has_effective_tab_access(
            request.user, department, "tab_accounts_enrollment"
        ):
            return Response(
                {"detail": "Accounts & Enrollment is not available for this coordinator."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not can_manage_department_accounts(request.user):
            return Response(
                {"detail": "Only coordinators can delete accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        user = self.get_object(request, user_id)

        if user is None:
            return Response(
                {"detail": "Account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if user.id == request.user.id:
            return Response(
                {"detail": "You cannot delete your own account."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if user.is_superuser:
            return Response(
                {"detail": "Super admin account cannot be deleted from here."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if user.role == User.Role.COORDINATOR and not can_manage_coordinator_accounts(request.user):
            return Response(
                {"detail": "Only department admins can delete coordinator accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        from django.db import transaction
        from academy.models import (
            Attendance,
            ClassSchedule,
            DailyLessonReport,
            Lesson,
            LessonAccessPermission,
            LessonAccessRequest,
            MonthlyLessonPlan,
            MonthlyLessonSummary,
            StudentProfile,
            StudentSubject,
            TeacherProfile,
        )

        deleted_role = user.role
        deleted_username = user.username

        with transaction.atomic():
            if user.role == User.Role.STUDENT:
                try:
                    student = user.student_profile
                except StudentProfile.DoesNotExist:
                    student = None

                if student:
                    Attendance.objects.filter(student=student).delete()
                    StudentSubject.objects.filter(student=student).delete()
                    ClassSchedule.objects.filter(student=student).delete()
                    LessonAccessPermission.objects.filter(student=student).delete()
                    LessonAccessRequest.objects.filter(student=student).delete()
                    MonthlyLessonPlan.objects.filter(student=student).delete()
                    MonthlyLessonSummary.objects.filter(student=student).delete()
                    DailyLessonReport.objects.filter(student=student).delete()
                    Lesson.objects.filter(student=student).delete()

            elif user.role == User.Role.TEACHER:
                try:
                    teacher = user.teacher_profile
                except TeacherProfile.DoesNotExist:
                    teacher = None

                if teacher:
                    students = list(StudentProfile.objects.filter(teacher=teacher))

                    for student in students:
                        Attendance.objects.filter(student=student).delete()
                        StudentSubject.objects.filter(student=student).delete()
                        ClassSchedule.objects.filter(student=student).delete()
                        LessonAccessPermission.objects.filter(student=student).delete()
                        LessonAccessRequest.objects.filter(student=student).delete()
                        MonthlyLessonPlan.objects.filter(student=student).delete()
                        MonthlyLessonSummary.objects.filter(student=student).delete()
                        DailyLessonReport.objects.filter(student=student).delete()
                        Lesson.objects.filter(student=student).delete()
                        student.user.delete()

                    Attendance.objects.filter(teacher=teacher).delete()
                    ClassSchedule.objects.filter(teacher=teacher).delete()
                    LessonAccessPermission.objects.filter(teacher=teacher).delete()
                    LessonAccessRequest.objects.filter(teacher=teacher).delete()
                    MonthlyLessonPlan.objects.filter(teacher=teacher).delete()
                    MonthlyLessonSummary.objects.filter(teacher=teacher).delete()
                    DailyLessonReport.objects.filter(teacher=teacher).delete()
                    Lesson.objects.filter(teacher=teacher).delete()

            user.delete()

        return Response({
            "detail": f"{deleted_role.title()} account '{deleted_username}' deleted permanently."
        })


class CoordinatorTabAccessView(APIView):
    permission_classes = [IsAuthenticated]

    def get_target(self, request, user_id):
        try:
            coordinator = User.objects.get(
                id=user_id,
                role=User.Role.COORDINATOR,
                is_superuser=False,
            )
        except User.DoesNotExist:
            return None, None

        department = resolve_managed_coordinator_department(request.user, coordinator)
        return coordinator, department

    def get(self, request, user_id):
        coordinator, department = self.get_target(request, user_id)
        if coordinator is None or department is None:
            return Response(
                {"detail": "Coordinator was not found in a department you manage."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(coordinator_tab_access_payload(coordinator, department))

    def put(self, request, user_id):
        return self.update_access(request, user_id)

    def patch(self, request, user_id):
        return self.update_access(request, user_id)

    def update_access(self, request, user_id):
        coordinator, department = self.get_target(request, user_id)
        if coordinator is None or department is None:
            return Response(
                {"detail": "Coordinator was not found in a department you manage."},
                status=status.HTTP_404_NOT_FOUND,
            )

        submitted = request.data.get("tabs")
        if not isinstance(submitted, dict):
            return Response(
                {"detail": "tabs must be an object containing tab keys and true/false values."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        definitions = coordinator_tab_definitions(department)
        allowed_keys = {item["key"] for item in definitions}
        unknown = sorted(set(submitted.keys()) - allowed_keys)
        if unknown:
            return Response(
                {"detail": f"Unsupported coordinator tab keys: {', '.join(unknown)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        current = coordinator_tab_access_map(coordinator, department)
        next_access = {
            key: bool(submitted.get(key, current.get(key, True)))
            for key in allowed_keys
        }

        with transaction.atomic():
            for tab_key, is_visible in next_access.items():
                CoordinatorTabAccess.objects.update_or_create(
                    coordinator=coordinator,
                    department=department,
                    tab_key=tab_key,
                    defaults={
                        "is_visible": is_visible,
                        "updated_by": request.user,
                    },
                )

        record_audit_event(
            actor=request.user,
            request=request,
            category="permissions",
            action="coordinator_tab_access_updated",
            summary=f"Updated tab access for coordinator {coordinator.username}.",
            target_type="coordinator",
            target_id=coordinator.id,
            target_label=coordinator.get_full_name() or coordinator.username,
            details={
                "department_id": department.id,
                "department_type": department.department_type,
                "tabs": next_access,
            },
        )

        notify_global("academy_update", {
            "event": "coordinator_tab_access_updated",
            "message": "Coordinator tab access updated",
            "user_id": coordinator.id,
            "department_id": department.id,
        })

        return Response(coordinator_tab_access_payload(coordinator, department))



def is_platform_manager(user):
    return bool(
        user.is_superuser
        or getattr(user, "role", "") == User.Role.PLATFORM_ADMIN
        or getattr(user, "role", "") == User.Role.INSTITUTION_ADMIN
    )


def can_permanently_delete_platform_scope(user):
    return bool(
        user.is_superuser
        or getattr(user, "role", "") == User.Role.PLATFORM_ADMIN
    )


def validate_permanent_delete_request(request, expected_name):
    confirmation_name = str(
        request.data.get("confirmation_name", "") or ""
    ).strip()
    current_password = str(
        request.data.get("current_password", "") or ""
    )

    if confirmation_name != expected_name:
        return Response(
            {"detail": "The confirmation name does not match."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not current_password:
        return Response(
            {"detail": "Your current Main Admin password is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not request.user.check_password(current_password):
        return Response(
            {"detail": "The current Main Admin password is incorrect."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return None


def applicable_features_for_department(department):
    if not department:
        return Feature.objects.none()

    return Feature.objects.filter(
        is_active=True,
        department_type=department.department_type,
    ).order_by("sort_order", "name", "id")


def sync_department_feature_settings(department):
    applicable = list(applicable_features_for_department(department))
    applicable_ids = [feature.id for feature in applicable]

    DepartmentFeature.objects.filter(department=department).exclude(
        feature_id__in=applicable_ids
    ).delete()

    for feature in applicable:
        DepartmentFeature.objects.get_or_create(
            department=department,
            feature=feature,
            defaults={"is_enabled": True},
        )


def feature_payload(feature, department_feature=None):
    return {
        "id": feature.id,
        "key": feature.key,
        "name": feature.name,
        "description": feature.description,
        "is_active": feature.is_active,
        "department_type": feature.department_type,
        "sort_order": feature.sort_order,
        "is_enabled": department_feature.is_enabled if department_feature else False,
    }


def department_payload(department):
    return {
        "id": department.id,
        "name": department.name,
        "code": department.code,
        "department_type": department.department_type,
        "is_active": department.is_active,
        "institution": {
            "id": department.institution_id,
            "name": department.institution.name,
            "slug": department.institution.slug,
        },
    }


def institution_payload(institution):
    return {
        "id": institution.id,
        "name": institution.name,
        "slug": institution.slug,
        "is_active": institution.is_active,
        "logo_url": institution.logo_url,
        "website": institution.website,
        "notes": institution.notes,
    }


def make_unique_slug(model, base_value, existing_id=None, field_name="slug"):
    base_slug = slugify(base_value or "") or "item"
    slug = base_slug
    counter = 2

    while True:
        qs = model.objects.filter(**{field_name: slug})
        if existing_id:
            qs = qs.exclude(id=existing_id)

        if not qs.exists():
            return slug

        slug = f"{base_slug}-{counter}"
        counter += 1


class PlatformInstitutionListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_platform_manager(request.user):
            return Response(
                {"detail": "Only platform or institution admins can view institutions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        institutions = Institution.objects.order_by("name", "id")

        if request.user.role == User.Role.INSTITUTION_ADMIN and request.user.institution_id:
            institutions = institutions.filter(id=request.user.institution_id)

        return Response({
            "institutions": [institution_payload(item) for item in institutions]
        })

    def post(self, request):
        if not request.user.is_superuser and request.user.role != User.Role.PLATFORM_ADMIN:
            return Response(
                {"detail": "Only platform super admin can create institutions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        name = str(request.data.get("name", "")).strip()
        website = str(request.data.get("website", "")).strip()
        logo_url = str(request.data.get("logo_url", "")).strip()
        notes = str(request.data.get("notes", "")).strip()
        is_active = request.data.get("is_active", True)

        if not name:
            return Response(
                {"detail": "Institution name is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not isinstance(is_active, bool):
            is_active = True

        institution = Institution.objects.create(
            name=name,
            slug=make_unique_slug(Institution, name),
            website=website,
            logo_url=logo_url,
            notes=notes,
            is_active=is_active,
        )

        record_audit_event(
            actor=request.user, request=request, category="institutions",
            action="institution_created", summary=f"Created institution {institution.name}.",
            target_type="institution", target_id=institution.id, target_label=institution.name,
        )
        return Response(institution_payload(institution), status=status.HTTP_201_CREATED)


class PlatformInstitutionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_object(self, request, institution_id):
        try:
            institution = Institution.objects.get(id=institution_id)
        except Institution.DoesNotExist:
            return None

        if request.user.role == User.Role.INSTITUTION_ADMIN:
            if request.user.institution_id != institution.id:
                return None

        return institution

    def patch(self, request, institution_id):
        if not is_platform_manager(request.user):
            return Response(
                {"detail": "Only platform or institution admins can update institutions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        institution = self.get_object(request, institution_id)

        if not institution:
            return Response(
                {"detail": "Institution not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if "name" in request.data:
            name = str(request.data.get("name", "")).strip()
            if not name:
                return Response(
                    {"detail": "Institution name cannot be blank."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            institution.name = name

        for field in ["website", "logo_url", "notes"]:
            if field in request.data:
                setattr(institution, field, str(request.data.get(field, "") or "").strip())

        if "is_active" in request.data and isinstance(request.data.get("is_active"), bool):
            institution.is_active = request.data.get("is_active")

        institution.save()
        record_audit_event(
            actor=request.user, request=request, category="institutions",
            action="institution_updated", summary=f"Updated institution {institution.name}.",
            target_type="institution", target_id=institution.id, target_label=institution.name,
            details={"is_active": institution.is_active},
        )

        return Response(institution_payload(institution))

    def delete(self, request, institution_id):
        if not can_permanently_delete_platform_scope(request.user):
            return Response(
                {"detail": "Only the Main Admin can permanently delete institutions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        institution = self.get_object(request, institution_id)

        if not institution:
            return Response(
                {"detail": "Institution not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        validation_error = validate_permanent_delete_request(
            request,
            institution.name,
        )
        if validation_error:
            return validation_error

        summary = permanently_delete_institution(
            institution,
            request.user,
        )
        record_audit_event(
            actor=request.user, request=request, category="institutions",
            action="institution_deleted_permanently",
            summary=f"Permanently deleted institution {summary['name']}.",
            target_type="institution", target_id=summary["id"], target_label=summary["name"],
            details={key: value for key, value in summary.items() if key not in {"name"}},
        )

        notify_global("academy_update", {
            "event": "institution_deleted_permanently",
            "institution_id": summary["id"],
            "institution_name": summary["name"],
        })

        return Response({
            "detail": (
                f"Institution '{summary['name']}' and "
                f"{summary['departments_deleted']} department(s) "
                "were deleted permanently."
            ),
            "deleted": summary,
        })


class PlatformDepartmentListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not is_platform_manager(request.user):
            return Response(
                {"detail": "Only platform or institution admins can create departments."},
                status=status.HTTP_403_FORBIDDEN,
            )

        institution_id = request.data.get("institution_id") or request.data.get("institution")
        name = str(request.data.get("name", "")).strip()
        department_type = str(request.data.get("department_type", "general") or "general").strip().lower()
        notes = str(request.data.get("notes", "") or "").strip()
        is_active = request.data.get("is_active", True)

        if not name:
            return Response(
                {"detail": "Department name is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            institution = Institution.objects.get(id=institution_id)
        except Exception:
            return Response(
                {"detail": "Valid institution_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if request.user.role == User.Role.INSTITUTION_ADMIN and request.user.institution_id != institution.id:
            return Response(
                {"detail": "You can only create departments inside your own institution."},
                status=status.HTTP_403_FORBIDDEN,
            )

        valid_types = [choice[0] for choice in Department.DepartmentType.choices]
        if department_type not in valid_types:
            department_type = Department.DepartmentType.GENERAL

        if not isinstance(is_active, bool):
            is_active = True

        code = make_unique_slug(
            Department,
            name,
            field_name="code",
        )

        while Department.objects.filter(institution=institution, code=code).exists():
            code = make_unique_slug(Department, f"{name}-{Department.objects.count() + 1}", field_name="code")

        department = Department.objects.create(
            institution=institution,
            name=name,
            code=code,
            department_type=department_type,
            notes=notes,
            is_active=is_active,
        )

        sync_department_feature_settings(department)
        record_audit_event(
            actor=request.user, request=request, category="departments",
            action="department_created", summary=f"Created department {department.name}.",
            target_type="department", target_id=department.id, target_label=department.name,
            details={"institution_id": institution.id, "department_type": department.department_type},
        )

        return Response(department_payload(department), status=status.HTTP_201_CREATED)


class PlatformDepartmentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_object(self, request, department_id):
        try:
            department = Department.objects.select_related("institution").get(id=department_id)
        except Department.DoesNotExist:
            return None

        if request.user.role == User.Role.INSTITUTION_ADMIN and request.user.institution_id != department.institution_id:
            return None

        return department

    def patch(self, request, department_id):
        if not is_platform_manager(request.user):
            return Response(
                {"detail": "Only platform or institution admins can update departments."},
                status=status.HTTP_403_FORBIDDEN,
            )

        department = self.get_object(request, department_id)

        if not department:
            return Response(
                {"detail": "Department not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if "name" in request.data:
            name = str(request.data.get("name", "")).strip()
            if not name:
                return Response(
                    {"detail": "Department name cannot be blank."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            department.name = name

        if "department_type" in request.data:
            department_type = str(request.data.get("department_type", "") or "").strip().lower()
            valid_types = [choice[0] for choice in Department.DepartmentType.choices]
            if department_type in valid_types:
                department.department_type = department_type

        if "notes" in request.data:
            department.notes = str(request.data.get("notes", "") or "").strip()

        if "is_active" in request.data and isinstance(request.data.get("is_active"), bool):
            department.is_active = request.data.get("is_active")

        department.save()
        sync_department_feature_settings(department)
        record_audit_event(
            actor=request.user, request=request, category="departments",
            action="department_updated", summary=f"Updated department {department.name}.",
            target_type="department", target_id=department.id, target_label=department.name,
            details={"institution_id": department.institution_id, "department_type": department.department_type, "is_active": department.is_active},
        )

        return Response(department_payload(department))

    def delete(self, request, department_id):
        if not can_permanently_delete_platform_scope(request.user):
            return Response(
                {"detail": "Only the Main Admin can permanently delete departments."},
                status=status.HTTP_403_FORBIDDEN,
            )

        department = self.get_object(request, department_id)

        if not department:
            return Response(
                {"detail": "Department not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        validation_error = validate_permanent_delete_request(
            request,
            department.name,
        )
        if validation_error:
            return validation_error

        summary = permanently_delete_department(
            department,
            request.user,
        )
        record_audit_event(
            actor=request.user, request=request, category="departments",
            action="department_deleted_permanently",
            summary=f"Permanently deleted department {summary['name']}.",
            target_type="department", target_id=summary["id"], target_label=summary["name"],
            details={key: value for key, value in summary.items() if key not in {"name"}},
        )

        notify_global("academy_update", {
            "event": "department_deleted_permanently",
            "department_id": summary["id"],
            "department_name": summary["name"],
            "institution_id": summary["institution_id"],
        })

        return Response({
            "detail": f"Department '{summary['name']}' was deleted permanently.",
            "deleted": summary,
        })


class PlatformDepartmentListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_platform_manager(request.user):
            return Response(
                {"detail": "Only platform or institution admins can view departments."},
                status=status.HTTP_403_FORBIDDEN,
            )

        departments = (
            Department.objects.select_related("institution")
            .order_by("institution__name", "name", "id")
        )

        if request.user.role == User.Role.INSTITUTION_ADMIN and request.user.institution_id:
            departments = departments.filter(institution=request.user.institution)

        return Response({
            "institutions": [
                institution_payload(item)
                for item in Institution.objects.order_by("name", "id")
            ],
            "departments": [department_payload(item) for item in departments],
        })


class PlatformFeatureListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_platform_manager(request.user):
            return Response(
                {"detail": "Only platform or institution admins can view features."},
                status=status.HTTP_403_FORBIDDEN,
            )

        features = (
            Feature.objects.filter(
                is_active=True,
                department_type__in=[
                    Department.DepartmentType.QURAN,
                    Department.DepartmentType.TUITION,
                ],
            )
            .order_by("department_type", "sort_order", "name", "id")
        )

        return Response({
            "features": [
                {
                    "id": item.id,
                    "key": item.key,
                    "name": item.name,
                    "description": item.description,
                    "is_active": item.is_active,
                    "department_type": item.department_type,
                    "sort_order": item.sort_order,
                }
                for item in features
            ]
        })


class PlatformDepartmentFeatureView(APIView):
    permission_classes = [IsAuthenticated]

    def get_department(self, request, department_id):
        try:
            department = Department.objects.select_related("institution").get(id=department_id)
        except Department.DoesNotExist:
            return None

        if request.user.role == User.Role.INSTITUTION_ADMIN:
            if request.user.institution_id != department.institution_id:
                return None

        return department

    def get(self, request, department_id):
        if not is_platform_manager(request.user):
            return Response(
                {"detail": "Only platform or institution admins can view department features."},
                status=status.HTTP_403_FORBIDDEN,
            )

        department = self.get_department(request, department_id)

        if not department:
            return Response(
                {"detail": "Department not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        features = list(applicable_features_for_department(department))

        settings_by_feature_id = {
            item.feature_id: item
            for item in DepartmentFeature.objects.filter(
                department=department,
                feature__is_active=True,
                feature__department_type=department.department_type,
            )
        }

        return Response({
            "department": department_payload(department),
            "features": [
                feature_payload(feature, settings_by_feature_id.get(feature.id))
                for feature in features
            ],
        })

    def patch(self, request, department_id):
        if not is_platform_manager(request.user):
            return Response(
                {"detail": "Only platform or institution admins can update department features."},
                status=status.HTTP_403_FORBIDDEN,
            )

        department = self.get_department(request, department_id)

        if not department:
            return Response(
                {"detail": "Department not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        feature_key = str(request.data.get("feature_key", "")).strip()
        is_enabled = request.data.get("is_enabled", None)

        if not feature_key:
            return Response(
                {"detail": "feature_key is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not isinstance(is_enabled, bool):
            return Response(
                {"detail": "is_enabled must be true or false."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            feature = Feature.objects.get(
                key=feature_key,
                is_active=True,
                department_type=department.department_type,
            )
        except Feature.DoesNotExist:
            return Response(
                {"detail": "This feature is not available for the selected department type."},
                status=status.HTTP_404_NOT_FOUND,
            )

        setting, _created = DepartmentFeature.objects.get_or_create(
            department=department,
            feature=feature,
            defaults={"is_enabled": is_enabled},
        )

        if setting.is_enabled != is_enabled:
            setting.is_enabled = is_enabled
            setting.save(update_fields=["is_enabled"])

        record_audit_event(
            actor=request.user, request=request, category="permissions",
            action="department_feature_updated",
            summary=f"{'Enabled' if is_enabled else 'Disabled'} {feature.name} for {department.name}.",
            target_type="department_feature", target_id=setting.id,
            target_label=f"{department.name} / {feature.name}",
            details={"department_id": department.id, "feature_key": feature.key, "is_enabled": is_enabled},
        )
        return Response({
            "department": department_payload(department),
            "feature": feature_payload(feature, setting),
        })

