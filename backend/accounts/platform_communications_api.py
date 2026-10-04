from __future__ import annotations

from datetime import timedelta

from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from academy.ws_notify import notify_global

from .models import (
    Department,
    Institution,
    PlatformMaintenanceWindow,
    PlatformNotice,
    PlatformNoticeReceipt,
)
from .platform_communications import (
    active_notices_for_user,
    deactivate_overlapping_maintenance,
    maintenance_payload,
    notice_payload,
)
from .platform_runtime import is_main_admin, record_audit_event, require_current_password


DEFAULT_MAINTENANCE_MESSAGE = (
    "This portal is temporarily unavailable while scheduled maintenance is completed. "
    "Please try again soon."
)


def _notify_after_commit(event_type: str, payload: dict) -> None:
    transaction.on_commit(lambda: notify_global(event_type, payload))


def _main_admin_denied(request):
    if is_main_admin(request.user):
        return None
    return Response(
        {"detail": "Only the Main Admin can manage maintenance and notices."},
        status=status.HTTP_403_FORBIDDEN,
    )


def _password_denied(request):
    error = require_current_password(request.user, request.data.get("current_password", ""))
    if not error:
        return None
    return Response({"current_password": error}, status=status.HTTP_400_BAD_REQUEST)


def _parse_optional_datetime(value, field_name):
    if value in (None, ""):
        return None, None
    parsed = parse_datetime(str(value))
    if parsed is None:
        return None, Response(
            {field_name: "Use a valid date and time."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed, None


def _scope_target(data, *, model_scope_type):
    scope_type = str(data.get("scope_type", model_scope_type.PLATFORM) or "").strip().lower()
    valid = {choice for choice, _label in model_scope_type.choices}
    if scope_type not in valid:
        return None, None, None, Response(
            {"scope_type": "Select a valid scope."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    institution = None
    department = None
    if scope_type == model_scope_type.INSTITUTION:
        try:
            institution = Institution.objects.get(id=data.get("institution_id"))
        except (Institution.DoesNotExist, TypeError, ValueError):
            return None, None, None, Response(
                {"institution_id": "Select a valid institution."},
                status=status.HTTP_400_BAD_REQUEST,
            )
    elif scope_type == model_scope_type.DEPARTMENT:
        try:
            department = Department.objects.select_related("institution").get(id=data.get("department_id"))
        except (Department.DoesNotExist, TypeError, ValueError):
            return None, None, None, Response(
                {"department_id": "Select a valid department."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        institution = department.institution

    return scope_type, institution, department, None


def _maintenance_admin_payload(item):
    payload = maintenance_payload(item)
    now = timezone.now()
    currently_effective = bool(
        item.is_active
        and (item.starts_at is None or item.starts_at <= now)
        and (item.ends_at is None or item.ends_at > now)
    )
    if not item.is_active:
        status_label = "Paused"
    elif item.starts_at and item.starts_at > now:
        status_label = "Scheduled"
    elif item.ends_at and item.ends_at <= now:
        status_label = "Expired"
    else:
        status_label = "Active"
    payload.update(
        {
            "active": currently_effective,
            "status_label": status_label,
            "is_active": item.is_active,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            "institution": {
                "id": item.institution_id,
                "name": item.institution.name,
                "slug": item.institution.slug,
            }
            if item.institution_id
            else None,
            "department": {
                "id": item.department_id,
                "name": item.department.name,
                "code": item.department.code,
                "department_type": item.department.department_type,
            }
            if item.department_id
            else None,
        }
    )
    return payload


def _notice_admin_payload(item):
    payload = notice_payload(item)
    now = timezone.now()
    currently_effective = bool(
        item.is_active
        and (item.starts_at is None or item.starts_at <= now)
        and (item.ends_at is None or item.ends_at > now)
    )
    if not item.is_active:
        status_label = "Paused"
    elif item.starts_at and item.starts_at > now:
        status_label = "Scheduled"
    elif item.ends_at and item.ends_at <= now:
        status_label = "Expired"
    else:
        status_label = "Active"
    payload.update(
        {
            "active": currently_effective,
            "status_label": status_label,
            "is_active": item.is_active,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "updated_at": item.updated_at.isoformat() if item.updated_at else None,
            "dismissed_count": getattr(item, "dismissed_count_value", item.receipts.count()),
            "institution": {
                "id": item.institution_id,
                "name": item.institution.name,
                "slug": item.institution.slug,
            }
            if item.institution_id
            else None,
            "department": {
                "id": item.department_id,
                "name": item.department.name,
                "code": item.department.code,
                "department_type": item.department.department_type,
            }
            if item.department_id
            else None,
        }
    )
    return payload


class PlatformMaintenanceListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        denied = _main_admin_denied(request)
        if denied:
            return denied
        items = (
            PlatformMaintenanceWindow.objects.select_related("institution", "department")
            .all()
            .order_by("-is_active", "-updated_at", "-id")
        )
        return Response({"maintenance_windows": [_maintenance_admin_payload(item) for item in items]})

    @transaction.atomic
    def post(self, request):
        denied = _main_admin_denied(request)
        if denied:
            return denied
        password_error = _password_denied(request)
        if password_error:
            return password_error

        scope_type, institution, department, scope_error = _scope_target(
            request.data, model_scope_type=PlatformMaintenanceWindow.ScopeType
        )
        if scope_error:
            return scope_error

        title = str(request.data.get("title", "Scheduled maintenance") or "").strip()
        message = str(request.data.get("message", DEFAULT_MAINTENANCE_MESSAGE) or "").strip()
        if not title:
            return Response({"title": "A maintenance title is required."}, status=status.HTTP_400_BAD_REQUEST)
        if not message:
            return Response({"message": "A maintenance message is required."}, status=status.HTTP_400_BAD_REQUEST)
        if len(title) > 160 or len(message) > 1200:
            return Response({"detail": "The maintenance title or message is too long."}, status=status.HTTP_400_BAD_REQUEST)

        starts_at, starts_error = _parse_optional_datetime(request.data.get("starts_at"), "starts_at")
        if starts_error:
            return starts_error
        ends_at, ends_error = _parse_optional_datetime(request.data.get("ends_at"), "ends_at")
        if ends_error:
            return ends_error
        if starts_at and ends_at and ends_at <= starts_at:
            return Response({"ends_at": "End time must be after the start time."}, status=status.HTTP_400_BAD_REQUEST)

        is_active = bool(request.data.get("is_active", True))
        if is_active:
            deactivate_overlapping_maintenance(
                scope_type=scope_type,
                institution_id=getattr(institution, "id", None),
                department_id=getattr(department, "id", None),
                actor=request.user,
            )

        item = PlatformMaintenanceWindow.objects.create(
            scope_type=scope_type,
            institution=institution,
            department=department,
            title=title,
            message=message,
            is_active=is_active,
            starts_at=starts_at,
            ends_at=ends_at,
            created_by=request.user,
            updated_by=request.user,
        )
        record_audit_event(
            actor=request.user,
            request=request,
            category="maintenance",
            action="maintenance_enabled" if is_active else "maintenance_created",
            summary=f"Configured maintenance for {maintenance_payload(item).get('target_label')}.",
            target_type="maintenance_window",
            target_id=item.id,
            target_label=maintenance_payload(item).get("target_label", ""),
            details={"scope_type": scope_type, "starts_at": str(starts_at or ""), "ends_at": str(ends_at or "")},
        )
        _notify_after_commit("maintenance_updated", {"maintenance_id": item.id, "scope_type": item.scope_type})
        return Response(_maintenance_admin_payload(item), status=status.HTTP_201_CREATED)


class PlatformMaintenanceDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, maintenance_id):
        denied = _main_admin_denied(request)
        if denied:
            return denied
        password_error = _password_denied(request)
        if password_error:
            return password_error
        try:
            item = PlatformMaintenanceWindow.objects.select_related("institution", "department").get(id=maintenance_id)
        except PlatformMaintenanceWindow.DoesNotExist:
            return Response({"detail": "Maintenance record not found."}, status=status.HTTP_404_NOT_FOUND)

        if "is_active" in request.data:
            next_active = bool(request.data.get("is_active"))
            if next_active:
                deactivate_overlapping_maintenance(
                    scope_type=item.scope_type,
                    institution_id=item.institution_id,
                    department_id=item.department_id,
                    actor=request.user,
                )
            item.is_active = next_active
        if "title" in request.data:
            item.title = str(request.data.get("title") or "").strip()
        if "message" in request.data:
            item.message = str(request.data.get("message") or "").strip()
        if "ends_at" in request.data:
            item.ends_at, error = _parse_optional_datetime(request.data.get("ends_at"), "ends_at")
            if error:
                return error
        if not item.title or not item.message:
            return Response({"detail": "Title and message are required."}, status=status.HTTP_400_BAD_REQUEST)
        item.updated_by = request.user
        item.save()

        record_audit_event(
            actor=request.user,
            request=request,
            category="maintenance",
            action="maintenance_enabled" if item.is_active else "maintenance_disabled",
            summary=f"{'Enabled' if item.is_active else 'Disabled'} maintenance for {maintenance_payload(item).get('target_label')}.",
            target_type="maintenance_window",
            target_id=item.id,
            target_label=maintenance_payload(item).get("target_label", ""),
        )
        _notify_after_commit("maintenance_updated", {"maintenance_id": item.id, "scope_type": item.scope_type})
        return Response(_maintenance_admin_payload(item))

    def delete(self, request, maintenance_id):
        denied = _main_admin_denied(request)
        if denied:
            return denied
        password_error = _password_denied(request)
        if password_error:
            return password_error
        try:
            item = PlatformMaintenanceWindow.objects.select_related("institution", "department").get(id=maintenance_id)
        except PlatformMaintenanceWindow.DoesNotExist:
            return Response({"detail": "Maintenance record not found."}, status=status.HTTP_404_NOT_FOUND)
        label = maintenance_payload(item).get("target_label", "")
        record_id = item.id
        item.delete()
        record_audit_event(
            actor=request.user,
            request=request,
            category="maintenance",
            action="maintenance_deleted",
            summary=f"Deleted maintenance configuration for {label}.",
            target_type="maintenance_window",
            target_id=record_id,
            target_label=label,
        )
        _notify_after_commit("maintenance_updated", {"maintenance_id": record_id, "deleted": True})
        return Response({"detail": "Maintenance record deleted."})


class PlatformNoticeListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        denied = _main_admin_denied(request)
        if denied:
            return denied
        items = (
            PlatformNotice.objects.select_related("institution", "department")
            .annotate(dismissed_count_value=Count("receipts"))
            .all()
            .order_by("-is_active", "-created_at", "-id")
        )
        return Response({"notices": [_notice_admin_payload(item) for item in items]})

    @transaction.atomic
    def post(self, request):
        denied = _main_admin_denied(request)
        if denied:
            return denied
        password_error = _password_denied(request)
        if password_error:
            return password_error

        scope_type, institution, department, scope_error = _scope_target(
            request.data, model_scope_type=PlatformNotice.ScopeType
        )
        if scope_error:
            return scope_error

        title = str(request.data.get("title", "") or "").strip()
        message = str(request.data.get("message", "") or "").strip()
        audience = str(request.data.get("audience", PlatformNotice.Audience.ALL) or "").strip()
        severity = str(request.data.get("severity", PlatformNotice.Severity.INFO) or "").strip()
        delivery_mode = str(request.data.get("delivery_mode", PlatformNotice.DeliveryMode.ONCE) or "").strip()
        if not title or not message:
            return Response({"detail": "Notice title and message are required."}, status=status.HTTP_400_BAD_REQUEST)
        if len(title) > 180 or len(message) > 2000:
            return Response({"detail": "The notice title or message is too long."}, status=status.HTTP_400_BAD_REQUEST)
        if audience not in {value for value, _ in PlatformNotice.Audience.choices}:
            return Response({"audience": "Select a valid audience."}, status=status.HTTP_400_BAD_REQUEST)
        if severity not in {value for value, _ in PlatformNotice.Severity.choices}:
            return Response({"severity": "Select a valid notice style."}, status=status.HTTP_400_BAD_REQUEST)
        if delivery_mode not in {value for value, _ in PlatformNotice.DeliveryMode.choices}:
            return Response({"delivery_mode": "Select a valid display schedule."}, status=status.HTTP_400_BAD_REQUEST)

        starts_at, starts_error = _parse_optional_datetime(request.data.get("starts_at"), "starts_at")
        if starts_error:
            return starts_error
        starts_at = starts_at or timezone.now()
        ends_at, ends_error = _parse_optional_datetime(request.data.get("ends_at"), "ends_at")
        if ends_error:
            return ends_error
        if delivery_mode == PlatformNotice.DeliveryMode.ONE_DAY:
            ends_at = starts_at + timedelta(hours=24)
        elif delivery_mode == PlatformNotice.DeliveryMode.CUSTOM:
            if not ends_at:
                return Response({"ends_at": "Choose when the custom notice should end."}, status=status.HTTP_400_BAD_REQUEST)
            if ends_at <= starts_at:
                return Response({"ends_at": "End time must be after the start time."}, status=status.HTTP_400_BAD_REQUEST)

        item = PlatformNotice.objects.create(
            title=title,
            message=message,
            severity=severity,
            audience=audience,
            delivery_mode=delivery_mode,
            scope_type=scope_type,
            institution=institution,
            department=department,
            is_active=bool(request.data.get("is_active", True)),
            starts_at=starts_at,
            ends_at=ends_at,
            created_by=request.user,
            updated_by=request.user,
        )
        record_audit_event(
            actor=request.user,
            request=request,
            category="notices",
            action="notice_created",
            summary=f"Published notice “{item.title}” to {notice_payload(item).get('target_label')}.",
            target_type="platform_notice",
            target_id=item.id,
            target_label=item.title,
            details={"audience": audience, "delivery_mode": delivery_mode, "scope_type": scope_type},
        )
        _notify_after_commit("notice_updated", {"notice_id": item.id, "action": "created"})
        return Response(_notice_admin_payload(item), status=status.HTTP_201_CREATED)


class PlatformNoticeDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, notice_id):
        denied = _main_admin_denied(request)
        if denied:
            return denied
        password_error = _password_denied(request)
        if password_error:
            return password_error
        try:
            item = PlatformNotice.objects.select_related("institution", "department").get(id=notice_id)
        except PlatformNotice.DoesNotExist:
            return Response({"detail": "Notice not found."}, status=status.HTTP_404_NOT_FOUND)
        if "is_active" in request.data:
            item.is_active = bool(request.data.get("is_active"))
        if "title" in request.data:
            item.title = str(request.data.get("title") or "").strip()
        if "message" in request.data:
            item.message = str(request.data.get("message") or "").strip()
        if not item.title or not item.message:
            return Response({"detail": "Title and message are required."}, status=status.HTTP_400_BAD_REQUEST)
        item.updated_by = request.user
        item.save()
        record_audit_event(
            actor=request.user,
            request=request,
            category="notices",
            action="notice_enabled" if item.is_active else "notice_disabled",
            summary=f"{'Enabled' if item.is_active else 'Disabled'} notice “{item.title}”.",
            target_type="platform_notice",
            target_id=item.id,
            target_label=item.title,
        )
        _notify_after_commit("notice_updated", {"notice_id": item.id, "action": "updated"})
        return Response(_notice_admin_payload(item))

    def delete(self, request, notice_id):
        denied = _main_admin_denied(request)
        if denied:
            return denied
        password_error = _password_denied(request)
        if password_error:
            return password_error
        try:
            item = PlatformNotice.objects.get(id=notice_id)
        except PlatformNotice.DoesNotExist:
            return Response({"detail": "Notice not found."}, status=status.HTTP_404_NOT_FOUND)
        title = item.title
        record_id = item.id
        item.delete()
        record_audit_event(
            actor=request.user,
            request=request,
            category="notices",
            action="notice_deleted",
            summary=f"Deleted notice “{title}”.",
            target_type="platform_notice",
            target_id=record_id,
            target_label=title,
        )
        _notify_after_commit("notice_updated", {"notice_id": record_id, "action": "deleted"})
        return Response({"detail": "Notice deleted."})


class ActivePlatformNoticesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"notices": [notice_payload(item) for item in active_notices_for_user(request.user)]})


class DismissPlatformNoticeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, notice_id):
        try:
            notice = PlatformNotice.objects.get(id=notice_id)
        except PlatformNotice.DoesNotExist:
            return Response({"detail": "Notice not found."}, status=status.HTTP_404_NOT_FOUND)

        if notice.delivery_mode == PlatformNotice.DeliveryMode.ONCE:
            PlatformNoticeReceipt.objects.get_or_create(notice=notice, user=request.user)
            return Response({"detail": "Notice dismissed.", "dismissed_permanently": True})

        return Response({"detail": "Notice closed for this page view.", "dismissed_permanently": False})
