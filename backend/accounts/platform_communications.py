from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from django.db.models import Q
from django.utils import timezone

from .models import (
    PlatformMaintenanceWindow,
    PlatformNotice,
    PlatformNoticeReceipt,
    User,
    UserDepartmentRole,
)


PORTAL_ADMIN_ROLES = {
    User.Role.INSTITUTION_ADMIN,
    User.Role.DEPARTMENT_ADMIN,
}


@dataclass(frozen=True)
class UserScope:
    institution_ids: set[int]
    department_ids: set[int]


def user_scope(user) -> UserScope:
    institution_ids: set[int] = set()
    department_ids: set[int] = set()

    institution_id = getattr(user, "institution_id", None)
    department_id = getattr(user, "department_id", None)
    if institution_id:
        institution_ids.add(int(institution_id))
    if department_id:
        department_ids.add(int(department_id))
        department = getattr(user, "department", None)
        if department and getattr(department, "institution_id", None):
            institution_ids.add(int(department.institution_id))

    links = UserDepartmentRole.objects.filter(user=user, is_active=True).values_list(
        "institution_id", "department_id"
    )
    for link_institution_id, link_department_id in links:
        if link_institution_id:
            institution_ids.add(int(link_institution_id))
        if link_department_id:
            department_ids.add(int(link_department_id))

    return UserScope(institution_ids=institution_ids, department_ids=department_ids)


def _currently_active_filter(now=None) -> Q:
    current = now or timezone.now()
    return (
        Q(is_active=True)
        & (Q(starts_at__isnull=True) | Q(starts_at__lte=current))
        & (Q(ends_at__isnull=True) | Q(ends_at__gt=current))
    )


def maintenance_payload(item: PlatformMaintenanceWindow | None) -> dict:
    if not item:
        return {"active": False}

    if item.department_id:
        target_label = item.department.name
    elif item.institution_id:
        target_label = item.institution.name
    else:
        target_label = "All departments"

    return {
        "active": True,
        "id": item.id,
        "scope_type": item.scope_type,
        "title": item.title,
        "message": item.message,
        "target_label": target_label,
        "starts_at": item.starts_at.isoformat() if item.starts_at else None,
        "ends_at": item.ends_at.isoformat() if item.ends_at else None,
    }


def active_maintenance_for_user(user) -> PlatformMaintenanceWindow | None:
    if not user or not getattr(user, "is_authenticated", False):
        return None
    if getattr(user, "is_superuser", False) or getattr(user, "role", "") == User.Role.PLATFORM_ADMIN:
        return None

    scope = user_scope(user)
    scope_query = Q(scope_type=PlatformMaintenanceWindow.ScopeType.PLATFORM)
    if scope.institution_ids:
        scope_query |= Q(
            scope_type=PlatformMaintenanceWindow.ScopeType.INSTITUTION,
            institution_id__in=scope.institution_ids,
        )
    if scope.department_ids:
        scope_query |= Q(
            scope_type=PlatformMaintenanceWindow.ScopeType.DEPARTMENT,
            department_id__in=scope.department_ids,
        )

    items = list(
        PlatformMaintenanceWindow.objects.filter(_currently_active_filter())
        .filter(scope_query)
        .select_related("institution", "department")
    )
    if not items:
        return None

    priority = {
        PlatformMaintenanceWindow.ScopeType.DEPARTMENT: 3,
        PlatformMaintenanceWindow.ScopeType.INSTITUTION: 2,
        PlatformMaintenanceWindow.ScopeType.PLATFORM: 1,
    }
    items.sort(
        key=lambda item: (
            priority.get(item.scope_type, 0),
            item.updated_at or item.created_at,
            item.id,
        ),
        reverse=True,
    )
    return items[0]


def notice_matches_role(notice: PlatformNotice, role: str) -> bool:
    if notice.audience == PlatformNotice.Audience.ALL:
        return True
    if notice.audience == PlatformNotice.Audience.PORTAL_ADMIN:
        return role in PORTAL_ADMIN_ROLES
    return notice.audience == role


def notice_payload(item: PlatformNotice) -> dict:
    if item.department_id:
        target_label = item.department.name
    elif item.institution_id:
        target_label = item.institution.name
    else:
        target_label = "All departments"

    return {
        "id": item.id,
        "title": item.title,
        "message": item.message,
        "severity": item.severity,
        "audience": item.audience,
        "delivery_mode": item.delivery_mode,
        "scope_type": item.scope_type,
        "target_label": target_label,
        "starts_at": item.starts_at.isoformat() if item.starts_at else None,
        "ends_at": item.ends_at.isoformat() if item.ends_at else None,
    }


def active_notices_for_user(user) -> list[PlatformNotice]:
    if not user or not getattr(user, "is_authenticated", False):
        return []
    if getattr(user, "is_superuser", False) or getattr(user, "role", "") == User.Role.PLATFORM_ADMIN:
        return []

    role = str(getattr(user, "role", "") or "")
    scope = user_scope(user)
    scope_query = Q(scope_type=PlatformNotice.ScopeType.PLATFORM)
    if scope.institution_ids:
        scope_query |= Q(
            scope_type=PlatformNotice.ScopeType.INSTITUTION,
            institution_id__in=scope.institution_ids,
        )
    if scope.department_ids:
        scope_query |= Q(
            scope_type=PlatformNotice.ScopeType.DEPARTMENT,
            department_id__in=scope.department_ids,
        )

    queryset = (
        PlatformNotice.objects.filter(_currently_active_filter())
        .filter(scope_query)
        .select_related("institution", "department")
        .order_by("-created_at", "-id")
    )

    dismissed_once_ids = set(
        PlatformNoticeReceipt.objects.filter(user=user).values_list("notice_id", flat=True)
    )

    result: list[PlatformNotice] = []
    severity_priority = {"critical": 4, "warning": 3, "info": 2, "success": 1}
    for notice in queryset:
        if not notice_matches_role(notice, role):
            continue
        if notice.delivery_mode == PlatformNotice.DeliveryMode.ONCE and notice.id in dismissed_once_ids:
            continue
        result.append(notice)

    result.sort(
        key=lambda item: (
            severity_priority.get(item.severity, 0),
            item.created_at,
            item.id,
        ),
        reverse=True,
    )
    return result


def deactivate_overlapping_maintenance(*, scope_type: str, institution_id=None, department_id=None, actor=None) -> None:
    queryset = PlatformMaintenanceWindow.objects.filter(is_active=True, scope_type=scope_type)
    if scope_type == PlatformMaintenanceWindow.ScopeType.PLATFORM:
        queryset = queryset.filter(institution__isnull=True, department__isnull=True)
    elif scope_type == PlatformMaintenanceWindow.ScopeType.INSTITUTION:
        queryset = queryset.filter(institution_id=institution_id)
    elif scope_type == PlatformMaintenanceWindow.ScopeType.DEPARTMENT:
        queryset = queryset.filter(department_id=department_id)
    queryset.update(is_active=False, updated_by=actor, updated_at=timezone.now())
