"""User-owned notification inbox; never accepts arbitrary notification creation."""
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.views import APIView

from django.db.models import Q
from .models import PortalNotification, User, UserDepartmentRole


def _visible_for(user):
    """Old inbox items cannot leak after a role/department permission change."""
    rows = PortalNotification.objects.filter(recipient=user)
    role = getattr(user, "role", "")
    if user.is_superuser or role == User.Role.PLATFORM_ADMIN:
        return rows.filter(kind="salary_submitted")
    if role == User.Role.TEACHER:
        allowed_kinds = ["lesson_decision", "lesson_permission"]
    elif role == User.Role.COORDINATOR:
        allowed_kinds = ["lesson_request"]
    elif role == User.Role.DEPARTMENT_ADMIN:
        allowed_kinds = ["lesson_request", "salary_approved", "salary_rejected"]
    else:
        return rows.none()
    ids = set()
    if user.department_id:
        ids.add(user.department_id)
    ids.update(UserDepartmentRole.objects.filter(
        user=user, is_active=True, role=role, department__isnull=False,
    ).values_list("department_id", flat=True))
    if role == User.Role.COORDINATOR:
        from .views import coordinator_has_effective_tab_access
        from .models import Department
        ids = {i for i in ids if coordinator_has_effective_tab_access(user, Department.objects.get(pk=i), "tab_lessons_control")}
    return rows.filter(kind__in=allowed_kinds, department_id__in=ids)



def _data(item):
    return {
        "id": item.id,
        "kind": item.kind,
        "title": item.title,
        "body": item.body,
        "target": item.target,
        "created_at": item.created_at.isoformat(),
        "read_at": item.read_at.isoformat() if item.read_at else None,
    }


class PortalNotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except (ValueError, TypeError):
            page = 1
        page = min(page, 1000)
        queryset = _visible_for(request.user)
        unread = queryset.filter(read_at__isnull=True).count()
        rows = queryset.order_by("-created_at", "-id")[(page - 1) * 25:page * 25 + 1]
        rows = list(rows)
        return Response({"results": [_data(item) for item in rows[:25]], "unread_count": unread, "has_more": len(rows) > 25, "page": page})


class PortalNotificationReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, notification_id):
        updated = _visible_for(request.user).filter(
            id=notification_id, read_at__isnull=True
        ).update(read_at=timezone.now())
        exists = updated or _visible_for(request.user).filter(
            id=notification_id
        ).exists()
        if not exists:
            return Response({"detail": "Notification not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"read": True})


class PortalNotificationReadAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        updated = _visible_for(request.user).filter(
            read_at__isnull=True
        ).update(read_at=timezone.now())
        return Response({"updated": updated})


class PortalNotificationClearView(APIView):
    """Permanently remove only notifications currently visible to this recipient."""
    permission_classes = [IsAuthenticated]

    def post(self, request, notification_id):
        deleted, _ = _visible_for(request.user).filter(id=notification_id).delete()
        if not deleted:
            return Response({"detail": "Notification not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"cleared": True})


class PortalNotificationClearAllView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        deleted, _ = _visible_for(request.user).delete()
        return Response({"cleared": deleted})
