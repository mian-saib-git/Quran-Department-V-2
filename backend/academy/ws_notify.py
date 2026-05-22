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
    notify_role("coordinator", "lesson_saved", payload)
    # Notify the teacher
    notify_user(report.teacher.user_id, "lesson_saved", payload)


def notify_permission_granted(permission):
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
    notify_role("coordinator", "permission_granted", payload)


def notify_permission_disabled(permission):
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
    notify_role("coordinator", "permission_disabled", payload)


def notify_request_reviewed(request_obj, action: str):
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
    notify_role("coordinator", "request_reviewed", payload)


def notify_request_created(request_obj):
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
    notify_role("coordinator", "lesson_request_created", payload)


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
    if attendance.student_id:
        notify_user(attendance.student.user_id, "attendance_marked", payload)
    if attendance.teacher_id:
        notify_user(attendance.teacher.user_id, "attendance_marked", payload)