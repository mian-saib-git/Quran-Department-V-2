"""Business-event to private-inbox delivery. No role-wide sensitive payloads."""
import logging
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.db.models import Q, F

from .models import User, UserDepartmentRole, PortalNotification

logger = logging.getLogger(__name__)


def _eligible_users(department, roles):
    if department is None:
        return []
    users = User.objects.filter(
        role__in=roles, is_active=True, archived_at__isnull=True,
    ).filter(
        Q(department_id=department.id)
        | Q(department_roles__department_id=department.id,
            department_roles__role=F("role"),
            department_roles__is_active=True)
    ).distinct()
    result = []
    for user in users:
        if user.role == User.Role.COORDINATOR:
            # The department-admin tab setting and platform-level feature both apply.
            from .views import coordinator_has_effective_tab_access
            if not coordinator_has_effective_tab_access(user, department, "tab_lessons_control"):
                continue
        result.append(user)
    return result


def _push(recipient_id, notification_id):
    try:
        layer = get_channel_layer()
        if layer is None:
            return
        async_to_sync(layer.group_send)(
            f"user_{recipient_id}",
            {"type": "notification_created", "notification_id": notification_id},
        )
    except Exception:
        logger.exception("Unable to push notification %s; inbox row is durable", notification_id)


def publish(users, *, event_key, kind, title, body, target, department=None):
    """Deduplicated insert, with after-commit push to recipient's private group."""
    for user in users:
        if not user or not user.is_active or user.archived_at:
            continue
        item, created = PortalNotification.objects.get_or_create(
            recipient=user,
            event_key=event_key,
            defaults={
                "department": department,
                "kind": kind,
                "title": title[:180],
                "body": body[:500],
                "target": target[:48],
            },
        )
        if created:
            transaction.on_commit(lambda uid=user.pk, nid=item.pk: _push(uid, nid))


def lesson_request_created(item):
    department = item.department
    publish(
        _eligible_users(department, [User.Role.DEPARTMENT_ADMIN, User.Role.COORDINATOR]),
        event_key=f"quran-lesson-request:{item.pk}:created",
        kind="lesson_request", title="New lesson request",
        body=f"{item.teacher}: {item.get_request_type_display()} for {item.student} ({item.lesson_date}).",
        target="lesson_requests", department=department,
    )


def lesson_request_reviewed(item):
    teacher_user = getattr(item.teacher, "user", None)
    publish(
        [teacher_user], event_key=f"quran-lesson-request:{item.pk}:{item.status}",
        kind="lesson_decision", title=f"Lesson request {item.status}",
        body=f"{item.get_request_type_display()} request for {item.student} ({item.lesson_date}).",
        target="lesson_requests", department=item.department,
    )


def lesson_permission_changed(item, enabled):
    publish(
        [getattr(item.teacher, "user", None)],
        event_key=f"quran-lesson-permission:{item.pk}:{'granted' if enabled else 'revoked'}",
        kind="lesson_permission",
        title="Lesson access granted" if enabled else "Lesson access revoked",
        body=f"{'You can now' if enabled else 'You can no longer'} {item.access_type} lessons for {item.student} ({item.lesson_date}).",
        target="lessons", department=item.department,
    )


def salary_transition(payroll, action):
    dept = payroll.department
    if action == "submit":
        # Superadmins can be institution-agnostic, but must be active.
        users = User.objects.filter(is_active=True, archived_at__isnull=True).filter(
            Q(role=User.Role.PLATFORM_ADMIN) | Q(is_superuser=True)
        ).distinct()
        recipient_kind = "salary_submitted"
        title = "Salary awaiting approval"
        target = "salary_approvals"
        event_stamp = payroll.submitted_at
    else:
        users = _eligible_users(dept, [User.Role.DEPARTMENT_ADMIN])
        recipient_kind = f"salary_{action}"
        title = f"Salary {action}"
        target = "salary"
        event_stamp = payroll.approved_at if action == "approved" else payroll.rejected_at
    publish(
        users,
        event_key=f"quran-payroll:{payroll.pk}:{action}:{event_stamp.isoformat() if event_stamp else ''}",
        kind=recipient_kind, title=title,
        body=f"{payroll.teacher} · {payroll.month:02d}/{payroll.year} · {dept.name}",
        target=target, department=dept,
    )
