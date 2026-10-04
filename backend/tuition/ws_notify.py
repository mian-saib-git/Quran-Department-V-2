from accounts.models import (
    User,
    UserDepartmentRole,
)
from academy.ws_notify import notify_user


MANAGER_ROLES = {
    "platform_admin",
    "institution_admin",
    "department_admin",
    "coordinator",
}


def notify_tuition_update(
    department,
    event,
    payload=None,
    user_ids=None,
):
    payload = dict(payload or {})

    message = {
        "event": event,
        "department_id": department.id,
        "department_code": department.code,
        "department_type": "tuition",
        **payload,
    }

    recipient_ids = set(user_ids or [])

    direct_manager_ids = (
        User.objects
        .filter(
            department=department,
            role__in=MANAGER_ROLES,
            is_active=True,
        )
        .values_list("id", flat=True)
    )

    recipient_ids.update(direct_manager_ids)

    linked_manager_ids = (
        UserDepartmentRole.objects
        .filter(
            department=department,
            role__in=MANAGER_ROLES,
            is_active=True,
            user__is_active=True,
        )
        .values_list("user_id", flat=True)
    )

    recipient_ids.update(linked_manager_ids)

    for user_id in recipient_ids:
        notify_user(
            user_id,
            "academy_update",
            message,
        )
