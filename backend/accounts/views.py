from django.contrib.auth import authenticate
from django.core.paginator import Paginator
from django.db.models import Q, Prefetch
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User, Institution, Department, Feature, DepartmentFeature, UserDepartmentRole
from .serializers import (
    CreateAccountSerializer,
    UpdateAccountSerializer,
    account_payload_for_user,
)
from academy.models import TeacherProfile, StudentProfile, StudentSubject, ClassSchedule
from academy.ws_notify import notify_global


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



class AuthContextView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        institution = user.institution
        department = user.department

        roles_qs = (
            UserDepartmentRole.objects.filter(user=user, is_active=True)
            .select_related("institution", "department")
            .order_by("institution__name", "department__name", "role")
        )

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
            feature_settings = (
                DepartmentFeature.objects.filter(department=department)
                .select_related("feature")
                .order_by("feature__sort_order", "feature__name")
            )

            features = {
                item.feature.key: item.is_enabled
                for item in feature_settings
                if item.feature.is_active
            }

        return Response({
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
        })


class CoordinatorAccountListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.role != User.Role.COORDINATOR:
            return Response(
                {"detail": "Only coordinators can view accounts."},
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
            qs = TeacherProfile.objects.select_related("user").order_by(
                "user__first_name",
                "user__username",
                "id",
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
            qs = (
                StudentProfile.objects.select_related("user", "teacher__user")
                .prefetch_related(active_subjects_prefetch, active_schedules_prefetch)
                .order_by("user__first_name", "user__username", "id")
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
            if not request.user.is_superuser:
                return User.objects.none()

            qs = User.objects.filter(role=User.Role.COORDINATOR).order_by(
                "first_name",
                "username",
                "id",
            )

            if search:
                qs = qs.filter(
                    Q(username__icontains=search)
                    | Q(email__icontains=search)
                    | Q(first_name__icontains=search)
                    | Q(last_name__icontains=search)
                )

            return qs

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

        if request.user.is_superuser:
            coordinators = [
                account_payload_for_user(item)
                for item in User.objects.filter(
                    role=User.Role.COORDINATOR,
                    is_superuser=False,
                )
                .order_by("first_name", "username", "id")
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
        if request.user.role != User.Role.COORDINATOR:
            return Response(
                {"detail": "Only coordinators can create accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        requested_role = str(request.data.get("role", "")).strip()

        if requested_role == User.Role.COORDINATOR and not request.user.is_superuser:
            return Response(
                {"detail": "Only superadmin can create coordinator accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = CreateAccountSerializer(data=request.data)

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

    def get_object(self, user_id):
        try:
            return User.objects.get(
                id=user_id,
                role__in=[
                    User.Role.COORDINATOR,
                    User.Role.TEACHER,
                    User.Role.STUDENT,
                ],
            )
        except User.DoesNotExist:
            return None

    def patch(self, request, user_id):
        if request.user.role != User.Role.COORDINATOR:
            return Response(
                {"detail": "Only coordinators can edit accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        user = self.get_object(user_id)

        if user is None:
            return Response(
                {"detail": "Account not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if user.role == User.Role.COORDINATOR and not request.user.is_superuser:
            return Response(
                {"detail": "Only superadmin can edit coordinator accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = UpdateAccountSerializer(
            user,
            data=request.data,
            partial=True,
            context={"user": user},
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
        if request.user.role != User.Role.COORDINATOR:
            return Response(
                {"detail": "Only coordinators can delete accounts."},
                status=status.HTTP_403_FORBIDDEN,
            )

        user = self.get_object(user_id)

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

        if user.role == User.Role.COORDINATOR and not request.user.is_superuser:
            return Response(
                {"detail": "Only superadmin can delete coordinator accounts."},
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



def is_platform_manager(user):
    return bool(
        user.is_superuser
        or getattr(user, "role", "") == User.Role.PLATFORM_ADMIN
        or getattr(user, "role", "") == User.Role.INSTITUTION_ADMIN
    )


def feature_payload(feature, department_feature=None):
    return {
        "id": feature.id,
        "key": feature.key,
        "name": feature.name,
        "description": feature.description,
        "is_active": feature.is_active,
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
                {
                    "id": item.id,
                    "name": item.name,
                    "slug": item.slug,
                    "is_active": item.is_active,
                }
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

        features = Feature.objects.filter(is_active=True).order_by("sort_order", "name", "id")

        return Response({
            "features": [
                {
                    "id": item.id,
                    "key": item.key,
                    "name": item.name,
                    "description": item.description,
                    "is_active": item.is_active,
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

        features = list(Feature.objects.filter(is_active=True).order_by("sort_order", "name", "id"))

        settings_by_feature_id = {
            item.feature_id: item
            for item in DepartmentFeature.objects.filter(department=department)
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
            feature = Feature.objects.get(key=feature_key, is_active=True)
        except Feature.DoesNotExist:
            return Response(
                {"detail": "Feature not found."},
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

        return Response({
            "department": department_payload(department),
            "feature": feature_payload(feature, setting),
        })

