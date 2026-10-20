import logging
logger = logging.getLogger(__name__)
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def _send(group: str, payload: dict):
    try:
        layer = get_channel_layer()
        async_to_sync(layer.group_send)(group, payload)
    except Exception as e:
        logger.warning("WebSocket notify failed: %s", e)


def notify_global(event_type: str, data: dict):
    _send("global", {"type": event_type, **data})


def notify_role(role: str, event_type: str, data: dict):
    _send(f"role_{role}", {"type": event_type, **data})


def notify_user(user_id: int, event_type: str, data: dict):
    _send(f"user_{user_id}", {"type": event_type, **data})



def _notify_lesson_department(department, event_type, payload):
    """Preserve legacy refresh messages without sending across departments."""
    try:
        from accounts.notification_service import _eligible_users
        from accounts.models import User
        for recipient in _eligible_users(
            department, [User.Role.COORDINATOR, User.Role.DEPARTMENT_ADMIN]
        ):
            notify_user(recipient.pk, event_type, payload)
    except Exception:
        logger.exception("Department-scoped websocket fanout failed")

def notify_lesson_saved(report, created: bool):
    payload = {
        "type": "lesson_saved",
        "action": "created" if created else "updated",
        "student_id": report.student_id,
        "student_name": str(report.student),
        "teacher_id": report.teacher_id,
        "teacher_name": str(report.teacher),
        "date": str(report.date),
        "report_id": report.id,
    }
    # Notify coordinator role
    _notify_lesson_department(report.department, "lesson_saved", payload)
    # Notify the teacher
    notify_user(report.teacher.user_id, "lesson_saved", payload)


def notify_permission_granted(permission):
    try:
        from accounts.notification_service import lesson_permission_changed
        lesson_permission_changed(permission, True)
    except Exception:
        logger.exception("Persistent notification delivery failed")
    payload = {
        "type": "permission_granted",
        "permission_id": permission.id,
        "student_id": permission.student_id,
        "student_name": str(permission.student),
        "teacher_id": permission.teacher_id,
        "teacher_name": str(permission.teacher),
        "lesson_date": str(permission.lesson_date),
        "access_type": permission.access_type,
        "subject": permission.subject or "",
    }
    # Notify the teacher so they immediately see the permission
    notify_user(permission.teacher.user_id, "permission_granted", payload)
    _notify_lesson_department(permission.department, "permission_granted", payload)
def notify_permission_disabled(permission):
    try:
        from accounts.notification_service import lesson_permission_changed
        lesson_permission_changed(permission, False)
    except Exception:
        logger.exception("Persistent notification delivery failed")
    payload = {
        "type": "permission_disabled",
        "permission_id": permission.id,
        "student_id": permission.student_id,
        "teacher_id": permission.teacher_id,
        "lesson_date": str(permission.lesson_date),
        "access_type": permission.access_type,
        "subject": permission.subject or "",
    }
    notify_user(permission.teacher.user_id, "permission_disabled", payload)
    _notify_lesson_department(permission.department, "permission_disabled", payload)
def notify_request_reviewed(request_obj, action: str):
    try:
        from accounts.notification_service import lesson_request_reviewed
        lesson_request_reviewed(request_obj)
    except Exception:
        logger.exception("Persistent notification delivery failed")
    payload = {
        "type": "request_reviewed",
        "request_id": request_obj.id,
        "action": action,
        "status": request_obj.status,
        "student_id": request_obj.student_id,
        "teacher_id": request_obj.teacher_id,
        "lesson_date": str(request_obj.lesson_date),
        "request_type": request_obj.request_type,
        "subject": request_obj.subject or "",
    }
    notify_user(request_obj.teacher.user_id, "request_reviewed", payload)
    _notify_lesson_department(request_obj.department, "request_reviewed", payload)
def notify_request_created(request_obj):
    try:
        from accounts.notification_service import lesson_request_created
        lesson_request_created(request_obj)
    except Exception:
        logger.exception("Persistent notification delivery failed")
    payload = {
        "type": "lesson_request_created",
        "request_id": request_obj.id,
        "student_id": request_obj.student_id,
        "student_name": str(request_obj.student),
        "teacher_id": request_obj.teacher_id,
        "teacher_name": str(request_obj.teacher),
        "lesson_date": str(request_obj.lesson_date),
        "request_type": request_obj.request_type,
        "subject": request_obj.subject or "",
        "reason": request_obj.reason or "",
    }
    _notify_lesson_department(request_obj.department, "lesson_request_created", payload)
def notify_attendance_marked(attendance):
    payload = {
        "type": "attendance_marked",
        "attendance_id": attendance.id,
        "entity_type": attendance.entity_type,
        "student_id": attendance.student_id,
        "student_name": str(attendance.student) if attendance.student else None,
        "teacher_id": attendance.teacher_id,
        "date": str(attendance.date),
        "status": attendance.status,
    }
    notify_role("coordinator", "attendance_marked", payload)
    notify_role("department_admin", "attendance_marked", payload)
    if attendance.student_id:
        notify_user(attendance.student.user_id, "attendance_marked", payload)
    if attendance.teacher_id:
        notify_user(attendance.teacher.user_id, "attendance_marked", payload)

def notify_account_created(user, student_profile=None, teacher_profile=None):
    payload = {
        "type": "academy_update",
        "event": "account_created",
        "user_id": user.id,
        "role": user.role,
        "username": user.username,
        "student_id": student_profile.id if student_profile else None,
        "teacher_id": teacher_profile.id if teacher_profile else None,
    }
    notify_role("coordinator", "academy_update", payload)
    notify_role("department_admin", "academy_update", payload)
    notify_role("teacher", "academy_update", payload)


def notify_account_updated(user):
    payload = {
        "type": "academy_update",
        "event": "account_updated",
        "user_id": user.id,
        "role": user.role,
        "username": user.username,
    }
    notify_role("coordinator", "academy_update", payload)
    notify_role("department_admin", "academy_update", payload)
    notify_role("teacher", "academy_update", payload)


def notify_account_deleted(user_id, role):
    payload = {
        "type": "academy_update",
        "event": "account_deleted",
        "user_id": user_id,
        "role": role,
    }
    notify_role("coordinator", "academy_update", payload)
    notify_role("department_admin", "academy_update", payload)
    notify_role("teacher", "academy_update", payload)
