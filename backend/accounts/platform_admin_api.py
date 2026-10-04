import os
import re
import secrets
import string
import time
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.paginator import Paginator
from django.db import connection, transaction
from django.db.models import Q
from django.http import FileResponse
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    Department,
    Institution,
    PlatformAuditLog,
    PlatformBackup,
    User,
    UserDepartmentRole,
)
from .platform_backups import (
    backup_path,
    backup_payload,
    create_database_backup,
    delete_backup_file,
    find_postgres_binary,
    postgres_command_version,
    save_uploaded_backup,
)
from .platform_runtime import (
    SETTING_BACKUP_RETENTION,
    SETTING_CORS_ORIGINS,
    SETTING_GEMINI_API_KEY,
    SETTING_GEMINI_MODEL,
    SETTING_MAINTENANCE_MESSAGE,
    clear_secret_setting,
    get_backup_retention_count,
    get_gemini_credentials,
    get_json_setting,
    get_runtime_cors_origins,
    get_secret_setting,
    invalidate_runtime_settings_cache,
    is_main_admin,
    record_audit_event,
    require_current_password,
    set_json_setting,
    set_secret_setting,
)


MANAGER_ROLES = {
    User.Role.INSTITUTION_ADMIN,
    User.Role.DEPARTMENT_ADMIN,
    User.Role.COORDINATOR,
}


def _forbidden_if_not_main_admin(request):
    if is_main_admin(request.user):
        return None
    return Response(
        {"detail": "Only the Main Admin can access this platform administration area."},
        status=status.HTTP_403_FORBIDDEN,
    )


def _password_error_response(request):
    error = require_current_password(
        request.user,
        request.data.get("current_password", ""),
    )
    if not error:
        return None
    return Response({"current_password": error}, status=status.HTTP_400_BAD_REQUEST)


def _split_full_name(full_name: str) -> tuple[str, str]:
    parts = [item for item in str(full_name or "").strip().split() if item]
    if not parts:
        return "", ""
    return parts[0], " ".join(parts[1:])


def _admin_scope(user: User) -> tuple[Institution | None, Department | None]:
    institution = user.institution
    department = user.department
    if department:
        return department.institution, department

    link = (
        UserDepartmentRole.objects.filter(
            user=user,
            is_active=True,
            department__isnull=False,
            role__in=[
                UserDepartmentRole.Role.DEPARTMENT_ADMIN,
                UserDepartmentRole.Role.COORDINATOR,
                UserDepartmentRole.Role.INSTITUTION_ADMIN,
            ],
        )
        .select_related("institution", "department")
        .order_by("id")
        .first()
    )
    if link:
        return link.institution, link.department
    return institution, None


def _canonical_manager_role(user: User, department: Department | None) -> str:
    """Return the one active scoped manager role when the primary role is stale."""
    links = UserDepartmentRole.objects.filter(
        user=user,
        is_active=True,
        role__in=[
            UserDepartmentRole.Role.INSTITUTION_ADMIN,
            UserDepartmentRole.Role.DEPARTMENT_ADMIN,
            UserDepartmentRole.Role.COORDINATOR,
        ],
    )
    if department is not None:
        links = links.filter(department=department)

    active_roles = list(links.values_list("role", flat=True).distinct())
    if user.role in active_roles:
        return user.role
    if len(active_roles) == 1:
        return active_roles[0]
    return user.role


def portal_admin_payload(user: User) -> dict:
    institution, department = _admin_scope(user)
    canonical_role = _canonical_manager_role(user, department)
    return {
        "id": user.id,
        "full_name": user.get_full_name() or user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "username": user.username,
        "email": user.email,
        "role": canonical_role,
        "role_label": dict(User.Role.choices).get(canonical_role, canonical_role.replace("_", " ").title()),
        "is_active": user.is_active,
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "date_joined": user.date_joined.isoformat() if user.date_joined else None,
        "institution": (
            {"id": institution.id, "name": institution.name, "slug": institution.slug}
            if institution
            else None
        ),
        "department": (
            {
                "id": department.id,
                "name": department.name,
                "code": department.code,
                "department_type": department.department_type,
            }
            if department
            else None
        ),
    }


def _portal_admin_queryset():
    return (
        User.objects.filter(
            Q(role__in=MANAGER_ROLES)
            | Q(
                department_roles__role__in=[
                    UserDepartmentRole.Role.INSTITUTION_ADMIN,
                    UserDepartmentRole.Role.DEPARTMENT_ADMIN,
                    UserDepartmentRole.Role.COORDINATOR,
                ],
                department_roles__is_active=True,
            )
        )
        .exclude(is_superuser=True)
        .exclude(role=User.Role.PLATFORM_ADMIN)
        .select_related("institution", "department", "department__institution")
        .prefetch_related("department_roles__institution", "department_roles__department")
        .distinct()
        .order_by("institution__name", "department__name", "role", "username")
    )


def _get_portal_admin(user_id: int) -> User | None:
    try:
        user = _portal_admin_queryset().get(id=user_id)
    except User.DoesNotExist:
        return None
    return user


def _validate_username(username: str, *, exclude_id: int | None = None) -> str | None:
    if not username:
        return "Username is required."
    if not re.fullmatch(r"[\w.@+-]{3,150}", username):
        return "Use 3 to 150 letters, numbers, or @/./+/-/_ characters."
    queryset = User.objects.filter(username__iexact=username)
    if exclude_id:
        queryset = queryset.exclude(id=exclude_id)
    if queryset.exists():
        return "This username is already in use."
    return None


def _validate_new_password(password: str, user: User | None = None) -> list[str]:
    try:
        validate_password(password, user=user)
        return []
    except DjangoValidationError as exc:
        return list(exc.messages)


def _active_admin_count(department: Department, exclude_user_id: int | None = None) -> int:
    queryset = _portal_admin_queryset().filter(
        Q(department=department)
        | Q(department_roles__department=department, department_roles__is_active=True)
    ).filter(is_active=True)
    if exclude_user_id:
        queryset = queryset.exclude(id=exclude_user_id)
    return queryset.distinct().count()


def _assign_manager_scope(user: User, department: Department, role: str) -> None:
    user.institution = department.institution
    user.department = department
    user.role = role
    user.save(update_fields=["institution", "department", "role"])

    UserDepartmentRole.objects.filter(
        user=user,
        role__in=[
            UserDepartmentRole.Role.INSTITUTION_ADMIN,
            UserDepartmentRole.Role.DEPARTMENT_ADMIN,
            UserDepartmentRole.Role.COORDINATOR,
        ],
    ).exclude(department=department, role=role).update(is_active=False)

    UserDepartmentRole.objects.update_or_create(
        user=user,
        institution=department.institution,
        department=department,
        role=role,
        defaults={"is_active": True},
    )


def _generate_temporary_password() -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    while True:
        candidate = "IVS-" + "".join(secrets.choice(alphabet) for _ in range(14))
        if any(char.islower() for char in candidate) and any(char.isupper() for char in candidate) and any(char.isdigit() for char in candidate):
            return candidate


class PlatformPortalAdministratorListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied

        search = str(request.query_params.get("search", "") or "").strip()
        department_id = str(request.query_params.get("department_id", "") or "").strip()
        role = str(request.query_params.get("role", "") or "").strip()

        queryset = _portal_admin_queryset()
        if search:
            queryset = queryset.filter(
                Q(username__icontains=search)
                | Q(email__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(department__name__icontains=search)
                | Q(institution__name__icontains=search)
            )
        if department_id.isdigit():
            queryset = queryset.filter(
                Q(department_id=int(department_id))
                | Q(department_roles__department_id=int(department_id), department_roles__is_active=True)
            ).distinct()
        if role in MANAGER_ROLES:
            queryset = queryset.filter(
                Q(role=role)
                | Q(department_roles__role=role, department_roles__is_active=True)
            ).distinct()

        response = Response({
            "administrators": [portal_admin_payload(item) for item in queryset],
            "departments": [
                {
                    "id": department.id,
                    "name": department.name,
                    "code": department.code,
                    "department_type": department.department_type,
                    "institution": {
                        "id": department.institution_id,
                        "name": department.institution.name,
                        "slug": department.institution.slug,
                    },
                }
                for department in Department.objects.select_related("institution").order_by("institution__name", "name")
            ],
        })
        response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response["Pragma"] = "no-cache"
        response["Expires"] = "0"
        return response

    @transaction.atomic
    def post(self, request):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied
        password_error = _password_error_response(request)
        if password_error:
            return password_error

        username = str(request.data.get("username", "") or "").strip()
        email = str(request.data.get("email", "") or "").strip()
        full_name = str(request.data.get("full_name", "") or "").strip()
        role = str(request.data.get("role", User.Role.DEPARTMENT_ADMIN) or "").strip()
        new_password = str(request.data.get("new_password", "") or "")
        department_id = request.data.get("department_id")

        if role not in {User.Role.DEPARTMENT_ADMIN, User.Role.COORDINATOR}:
            return Response(
                {"role": "New portal accounts can be Department Admins or Coordinators."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        username_error = _validate_username(username)
        if username_error:
            return Response({"username": username_error}, status=status.HTTP_400_BAD_REQUEST)
        if not full_name:
            return Response({"full_name": "Full name is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not new_password:
            return Response({"new_password": "A password is required for the new administrator."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            department = Department.objects.select_related("institution").get(id=department_id)
        except (Department.DoesNotExist, TypeError, ValueError):
            return Response({"department_id": "Select a valid department."}, status=status.HTTP_400_BAD_REQUEST)

        first_name, last_name = _split_full_name(full_name)
        placeholder = User(
            username=username,
            email=email,
            first_name=first_name,
            last_name=last_name,
            role=role,
            institution=department.institution,
            department=department,
        )
        password_errors = _validate_new_password(new_password, placeholder)
        if password_errors:
            return Response({"new_password": password_errors}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.create_user(
            username=username,
            email=email,
            password=new_password,
            first_name=first_name,
            last_name=last_name,
            role=role,
            institution=department.institution,
            department=department,
            is_active=bool(request.data.get("is_active", True)),
        )
        _assign_manager_scope(user, department, role)

        record_audit_event(
            actor=request.user,
            request=request,
            category="administrators",
            action="portal_admin_created",
            summary=f"Created portal administrator {user.username}.",
            target_type="user",
            target_id=user.id,
            target_label=user.username,
            details={"department_id": department.id, "role": role},
        )
        return Response(portal_admin_payload(user), status=status.HTTP_201_CREATED)


class PlatformPortalAdministratorDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def patch(self, request, user_id):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied
        password_error = _password_error_response(request)
        if password_error:
            return password_error

        user = _get_portal_admin(user_id)
        if not user:
            return Response({"detail": "Portal administrator not found."}, status=status.HTTP_404_NOT_FOUND)

        previous_institution, previous_department = _admin_scope(user)
        username = str(request.data.get("username", user.username) or "").strip()
        username_error = _validate_username(username, exclude_id=user.id)
        if username_error:
            return Response({"username": username_error}, status=status.HTTP_400_BAD_REQUEST)

        role = str(request.data.get("role", user.role) or "").strip()
        if role not in MANAGER_ROLES:
            return Response({"role": "Select a valid manager role."}, status=status.HTTP_400_BAD_REQUEST)

        department_id = request.data.get("department_id", user.department_id)
        try:
            department = Department.objects.select_related("institution").get(id=department_id)
        except (Department.DoesNotExist, TypeError, ValueError):
            return Response({"department_id": "Select a valid department."}, status=status.HTTP_400_BAD_REQUEST)

        is_active = request.data.get("is_active", user.is_active)
        is_active = bool(is_active)
        moving_department = bool(previous_department and previous_department.id != department.id)
        disabling = user.is_active and not is_active
        if previous_department and (moving_department or disabling):
            if _active_admin_count(previous_department, exclude_user_id=user.id) <= 0:
                return Response(
                    {"detail": "This department must keep at least one active portal administrator."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        full_name = str(request.data.get("full_name", user.get_full_name()) or "").strip()
        if not full_name:
            return Response({"full_name": "Full name is required."}, status=status.HTTP_400_BAD_REQUEST)
        first_name, last_name = _split_full_name(full_name)

        new_password = str(request.data.get("new_password", "") or "")
        if new_password:
            password_errors = _validate_new_password(new_password, user)
            if password_errors:
                return Response({"new_password": password_errors}, status=status.HTTP_400_BAD_REQUEST)
            if user.check_password(new_password):
                return Response(
                    {"new_password": "The new password must be different from the current password."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        user.username = username
        user.email = str(request.data.get("email", user.email) or "").strip()
        user.first_name = first_name
        user.last_name = last_name
        user.is_active = is_active
        if new_password:
            user.set_password(new_password)
        user.save()
        _assign_manager_scope(user, department, role)

        record_audit_event(
            actor=request.user,
            request=request,
            category="administrators",
            action="portal_admin_updated",
            summary=f"Updated portal administrator {user.username}.",
            target_type="user",
            target_id=user.id,
            target_label=user.username,
            details={
                "department_id": department.id,
                "previous_department_id": previous_department.id if previous_department else None,
                "role": role,
                "active": user.is_active,
                "password_changed": bool(new_password),
            },
        )
        return Response(portal_admin_payload(user))


class PlatformPortalAdministratorResetPasswordView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, user_id):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied
        password_error = _password_error_response(request)
        if password_error:
            return password_error

        user = _get_portal_admin(user_id)
        if not user:
            return Response({"detail": "Portal administrator not found."}, status=status.HTTP_404_NOT_FOUND)

        requested = str(request.data.get("new_password", "") or "")
        generated = not bool(requested)
        new_password = requested or _generate_temporary_password()
        password_errors = _validate_new_password(new_password, user)
        if password_errors:
            return Response({"new_password": password_errors}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save(update_fields=["password"])

        record_audit_event(
            actor=request.user,
            request=request,
            category="administrators",
            action="portal_admin_password_reset",
            summary=f"Reset the password for {user.username}.",
            target_type="user",
            target_id=user.id,
            target_label=user.username,
            details={"temporary_password_generated": generated},
        )
        response = Response({
            "detail": "Password reset successfully.",
            "administrator": portal_admin_payload(user),
            "temporary_password": new_password if generated else None,
        })
        response["Cache-Control"] = "no-store"
        return response


# IVS_PORTAL_ADMIN_RESET_LIST_FIX_V26
class PlatformBackupListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied
        items = PlatformBackup.objects.select_related("created_by").all()
        return Response({
            "backups": [backup_payload(item) for item in items],
            "capabilities": {
                "pg_dump_available": bool(find_postgres_binary("pg_dump")),
                "pg_restore_available": bool(find_postgres_binary("pg_restore")),
                "pg_dump_version": postgres_command_version("pg_dump"),
                "pg_restore_version": postgres_command_version("pg_restore"),
                "retention_count": get_backup_retention_count(),
                "restore_mode": "terminal_command",
            },
        })

    def post(self, request):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied
        password_error = _password_error_response(request)
        if password_error:
            return password_error

        try:
            item = create_database_backup(request.user)
        except Exception as exc:
            record_audit_event(
                actor=request.user,
                request=request,
                category="backups",
                action="backup_create_failed",
                summary="Database backup creation failed.",
                details={"error": str(exc)[:500]},
            )
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        record_audit_event(
            actor=request.user,
            request=request,
            category="backups",
            action="backup_created",
            summary=f"Created database backup {item.filename}.",
            target_type="backup",
            target_id=item.id,
            target_label=item.filename,
            details={"size_bytes": item.size_bytes, "checksum": item.checksum_sha256},
        )
        return Response(backup_payload(item), status=status.HTTP_201_CREATED)


class PlatformBackupUploadView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied
        error = require_current_password(request.user, request.data.get("current_password", ""))
        if error:
            return Response({"current_password": error}, status=status.HTTP_400_BAD_REQUEST)

        uploaded = request.FILES.get("backup")
        if not uploaded:
            return Response({"backup": "Choose a PostgreSQL .dump or .backup file."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            item = save_uploaded_backup(uploaded, request.user)
        except ValueError as exc:
            return Response({"backup": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        record_audit_event(
            actor=request.user,
            request=request,
            category="backups",
            action="backup_uploaded",
            summary=f"Uploaded and validated backup {item.filename}.",
            target_type="backup",
            target_id=item.id,
            target_label=item.filename,
            details={"original_filename": item.original_filename, "size_bytes": item.size_bytes},
        )
        return Response(backup_payload(item), status=status.HTTP_201_CREATED)


class PlatformBackupDownloadView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, backup_id):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied
        try:
            item = PlatformBackup.objects.get(id=backup_id)
        except PlatformBackup.DoesNotExist:
            return Response({"detail": "Backup not found."}, status=status.HTTP_404_NOT_FOUND)

        path = backup_path(item.filename)
        if not path.exists():
            return Response({"detail": "The backup file is missing from storage."}, status=status.HTTP_404_NOT_FOUND)

        record_audit_event(
            actor=request.user,
            request=request,
            category="backups",
            action="backup_downloaded",
            summary=f"Downloaded database backup {item.filename}.",
            target_type="backup",
            target_id=item.id,
            target_label=item.filename,
        )
        return FileResponse(path.open("rb"), as_attachment=True, filename=item.filename, content_type="application/octet-stream")


class PlatformBackupDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, backup_id):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied
        password_error = _password_error_response(request)
        if password_error:
            return password_error
        try:
            item = PlatformBackup.objects.get(id=backup_id)
        except PlatformBackup.DoesNotExist:
            return Response({"detail": "Backup not found."}, status=status.HTTP_404_NOT_FOUND)

        confirmation = str(request.data.get("confirmation_filename", "") or "").strip()
        if confirmation != item.filename:
            return Response(
                {"confirmation_filename": "Type the exact backup filename to delete it."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        filename = item.filename
        delete_backup_file(item)
        record_audit_event(
            actor=request.user,
            request=request,
            category="backups",
            action="backup_deleted",
            summary=f"Deleted database backup {filename}.",
            target_type="backup",
            target_label=filename,
        )
        return Response({"detail": f"Backup '{filename}' deleted."})


class PlatformSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied
        api_key, key_source = get_secret_setting(SETTING_GEMINI_API_KEY, "GEMINI_API_KEY")
        model = str(get_json_setting(SETTING_GEMINI_MODEL, "") or "").strip() or str(
            os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
        ).strip()
        return Response({
            "cors_allowed_origins": get_runtime_cors_origins(),
            "gemini_model": model,
            "gemini_api_key_configured": bool(api_key),
            "gemini_api_key_hint": f"••••••••{api_key[-4:]}" if api_key else "",
            "gemini_api_key_source": key_source,
            "backup_retention_count": get_backup_retention_count(),
            "maintenance_message": str(get_json_setting(SETTING_MAINTENANCE_MESSAGE, "") or ""),
        })

    @transaction.atomic
    def patch(self, request):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied
        password_error = _password_error_response(request)
        if password_error:
            return password_error

        changed = []
        if "cors_allowed_origins" in request.data:
            origins = request.data.get("cors_allowed_origins")
            if not isinstance(origins, list):
                return Response({"cors_allowed_origins": "Provide a list of trusted origins."}, status=status.HTTP_400_BAD_REQUEST)
            clean_origins = []
            for raw in origins:
                origin = str(raw or "").strip().rstrip("/")
                parsed = urlparse(origin)
                if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"}:
                    return Response(
                        {"cors_allowed_origins": f"Invalid origin: {origin or '(blank)'}. Use a scheme and hostname only."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                clean_origins.append(origin)
            clean_origins = sorted(set(clean_origins))
            set_json_setting(SETTING_CORS_ORIGINS, clean_origins, request.user)
            changed.append("cors_allowed_origins")

        if "gemini_model" in request.data:
            model = str(request.data.get("gemini_model", "") or "").strip()
            if not re.fullmatch(r"[A-Za-z0-9._-]{3,120}", model):
                return Response({"gemini_model": "Enter a valid Gemini model name."}, status=status.HTTP_400_BAD_REQUEST)
            set_json_setting(SETTING_GEMINI_MODEL, model, request.user)
            changed.append("gemini_model")

        replacement_key = str(request.data.get("gemini_api_key", "") or "").strip()
        if replacement_key:
            if len(replacement_key) < 20:
                return Response({"gemini_api_key": "The Gemini API key appears too short."}, status=status.HTTP_400_BAD_REQUEST)
            try:
                set_secret_setting(SETTING_GEMINI_API_KEY, replacement_key, request.user)
            except RuntimeError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
            changed.append("gemini_api_key_replaced")
        if request.data.get("clear_gemini_api_key") is True:
            clear_secret_setting(SETTING_GEMINI_API_KEY, request.user)
            changed.append("gemini_api_key_override_cleared")

        if "backup_retention_count" in request.data:
            try:
                retention = int(request.data.get("backup_retention_count"))
            except (TypeError, ValueError):
                return Response({"backup_retention_count": "Enter a whole number from 1 to 50."}, status=status.HTTP_400_BAD_REQUEST)
            if retention < 1 or retention > 50:
                return Response({"backup_retention_count": "Choose a value from 1 to 50."}, status=status.HTTP_400_BAD_REQUEST)
            set_json_setting(SETTING_BACKUP_RETENTION, retention, request.user)
            changed.append("backup_retention_count")

        if "maintenance_message" in request.data:
            message = str(request.data.get("maintenance_message", "") or "").strip()
            if len(message) > 500:
                return Response({"maintenance_message": "Use 500 characters or fewer."}, status=status.HTTP_400_BAD_REQUEST)
            set_json_setting(SETTING_MAINTENANCE_MESSAGE, message, request.user)
            changed.append("maintenance_message")

        invalidate_runtime_settings_cache()
        record_audit_event(
            actor=request.user,
            request=request,
            category="settings",
            action="application_settings_updated",
            summary="Updated safe application settings.",
            target_type="platform_settings",
            details={"changed_fields": changed},
        )
        return self.get(request)


class PlatformGeminiTestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied
        api_key, model, source = get_gemini_credentials()
        if not api_key:
            return Response({"detail": "No Gemini API key is configured."}, status=status.HTTP_400_BAD_REQUEST)
        started = time.perf_counter()
        try:
            response = requests.get(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}",
                headers={"x-goog-api-key": api_key},
                timeout=15,
            )
        except requests.RequestException as exc:
            return Response({"detail": f"Gemini connection failed: {exc}"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        latency_ms = round((time.perf_counter() - started) * 1000)
        if response.status_code >= 400:
            detail = "Gemini rejected the configured key or model."
            try:
                detail = response.json().get("error", {}).get("message", detail)
            except Exception:
                pass
            return Response({"detail": detail, "status_code": response.status_code}, status=status.HTTP_400_BAD_REQUEST)

        record_audit_event(
            actor=request.user,
            request=request,
            category="settings",
            action="gemini_connection_tested",
            summary="Tested the Gemini configuration successfully.",
            details={"model": model, "source": source, "latency_ms": latency_ms},
        )
        return Response({"detail": "Gemini connection successful.", "model": model, "source": source, "latency_ms": latency_ms})


class PlatformSystemHealthView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied

        database_ok = False
        database_latency_ms = None
        database_error = ""
        started = time.perf_counter()
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
            database_ok = True
            database_latency_ms = round((time.perf_counter() - started) * 1000)
        except Exception as exc:
            database_error = str(exc)[:300]

        db_config = settings.DATABASES["default"]
        db_user = str(db_config.get("USER", "") or "")
        masked_user = (db_user[:2] + "••••" + db_user[-2:]) if len(db_user) > 4 else ("••••" if db_user else "")
        api_key, model, key_source = get_gemini_credentials()
        request_scheme = "https" if request.is_secure() else "http"
        ws_scheme = "wss" if request.is_secure() else "ws"
        host = request.get_host()
        secret_key = str(settings.SECRET_KEY or "")
        backup_size = sum(PlatformBackup.objects.values_list("size_bytes", flat=True))

        return Response({
            "environment": {
                "debug": bool(settings.DEBUG),
                "mode": "Development" if settings.DEBUG else "Production",
                "secret_key_configured": bool(secret_key and secret_key != "dev-only-change-me" and len(secret_key) >= 32),
                "secret_key_length": len(secret_key),
                "allowed_hosts": list(settings.ALLOWED_HOSTS),
            },
            "database": {
                "connected": database_ok,
                "latency_ms": database_latency_ms,
                "error": database_error,
                "engine": "PostgreSQL",
                "name": str(db_config.get("NAME", "") or ""),
                "host": str(db_config.get("HOST", "") or ""),
                "port": str(db_config.get("PORT", "") or ""),
                "username_masked": masked_user,
                "password_configured": bool(db_config.get("PASSWORD")),
            },
            "network": {
                "api_base_url": f"{request_scheme}://{host}",
                "websocket_base_url": f"{ws_scheme}://{host}",
                "cors_allowed_origins": get_runtime_cors_origins(),
            },
            "channels": {
                "mode": str(getattr(settings, "CHANNEL_LAYER_MODE", "memory")),
                "production_ready": str(getattr(settings, "CHANNEL_LAYER_MODE", "memory")) == "redis",
            },
            "gemini": {
                "configured": bool(api_key),
                "model": model,
                "key_source": key_source,
            },
            "backups": {
                "pg_dump_available": bool(find_postgres_binary("pg_dump")),
                "pg_restore_available": bool(find_postgres_binary("pg_restore")),
                "pg_dump_version": postgres_command_version("pg_dump"),
                "pg_restore_version": postgres_command_version("pg_restore"),
                "backup_count": PlatformBackup.objects.count(),
                "total_size_bytes": backup_size,
                "retention_count": get_backup_retention_count(),
                "restore_mode": "terminal_command",
            },
            "platform": {
                "institutions": Institution.objects.count(),
                "departments": Department.objects.count(),
                "users": User.objects.count(),
                "active_users": User.objects.filter(is_active=True).count(),
            },
        })


class PlatformAuditLogListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        denied = _forbidden_if_not_main_admin(request)
        if denied:
            return denied

        queryset = PlatformAuditLog.objects.select_related("actor").all()
        search = str(request.query_params.get("search", "") or "").strip()
        category = str(request.query_params.get("category", "") or "").strip()
        if search:
            queryset = queryset.filter(
                Q(summary__icontains=search)
                | Q(action__icontains=search)
                | Q(target_label__icontains=search)
                | Q(actor__username__icontains=search)
            )
        if category:
            queryset = queryset.filter(category=category)

        try:
            page = max(int(request.query_params.get("page", 1)), 1)
            page_size = min(max(int(request.query_params.get("page_size", 30)), 1), 100)
        except (TypeError, ValueError):
            page, page_size = 1, 30
        paginator = Paginator(queryset, page_size)
        page_obj = paginator.get_page(min(page, paginator.num_pages or 1))

        return Response({
            "logs": [
                {
                    "id": item.id,
                    "category": item.category,
                    "action": item.action,
                    "summary": item.summary,
                    "target_type": item.target_type,
                    "target_id": item.target_id,
                    "target_label": item.target_label,
                    "details": item.details,
                    "ip_address": item.ip_address,
                    "created_at": item.created_at.isoformat(),
                    "actor": (
                        {
                            "id": item.actor_id,
                            "username": item.actor.username,
                            "full_name": item.actor.get_full_name() or item.actor.username,
                        }
                        if item.actor_id and item.actor
                        else None
                    ),
                }
                for item in page_obj.object_list
            ],
            "pagination": {
                "page": page_obj.number,
                "page_size": page_size,
                "total_items": paginator.count,
                "total_pages": paginator.num_pages or 1,
            },
            "categories": sorted(set(PlatformAuditLog.objects.values_list("category", flat=True))),
        })
