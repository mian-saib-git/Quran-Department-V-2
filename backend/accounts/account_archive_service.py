"""Archive Quran accounts without deleting financial or teaching evidence."""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from zoneinfo import ZoneInfo

from academy.models import ClassSchedule, StudentProfile, TeacherProfile
from .teacher_retirement_service import TeacherRetirementBlocked, teacher_retirement_readiness

from .models import User
from .platform_runtime import record_audit_event


@transaction.atomic
def archive_quran_account(*, user, actor, request=None):
    """Cut off salary after the local archive date and close current schedules.

    Historical attendance, payroll, ledger, class history and the user/profile
    are never deleted. Assigned students remain and must be reassigned explicitly.
    """
    user = User.objects.select_for_update().get(pk=user.pk)
    if user.archived_at:
        return {"already_archived": True, "archive_date": str(user.archived_effective_date)}
    if user.pk == actor.pk or user.is_superuser:
        raise ValueError("You cannot archive your own or a Super Admin account.")
    if user.role not in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
        raise ValueError("Only Quran teacher, student, and coordinator accounts can be archived here.")

    now = timezone.now()
    effective_date = timezone.localdate(now, timezone=ZoneInfo("Asia/Karachi"))
    teacher = TeacherProfile.objects.filter(user=user).first() if user.role == User.Role.TEACHER else None
    student = StudentProfile.objects.filter(user=user).first() if user.role == User.Role.STUDENT else None
    assigned_students = StudentProfile.objects.filter(teacher=teacher).count() if teacher else 0
    if teacher:
        # This check must run INSIDE the same atomic transaction that locks
        # and archives the user, not only in the frontend preview.
        TeacherProfile.objects.select_for_update().get(pk=teacher.pk)
        readiness = teacher_retirement_readiness(teacher)
        if not readiness["can_archive"]:
            raise TeacherRetirementBlocked(readiness)

    schedule_qs = ClassSchedule.objects.select_for_update().filter(
        is_active=True, effective_to__isnull=True,
    )
    if teacher:
        schedule_qs = schedule_qs.filter(teacher=teacher)
    elif student:
        schedule_qs = schedule_qs.filter(student=student)
    else:
        schedule_qs = schedule_qs.none()

    # Future-only rows cannot be closed before effective_from because of
    # qsched_valid_date_range. Deactivate them as legacy-inactive/open ended.
    future_rows = schedule_qs.filter(effective_from__gt=effective_date)
    future_closed = future_rows.update(is_active=False)
    # Today's sessions remain historically eligible, but there is no active
    # schedule or salary eligibility from tomorrow onward.
    current_closed = schedule_qs.exclude(effective_from__gt=effective_date).update(
        is_active=False, effective_to=effective_date,
    )

    user.is_active = False
    user.archived_at = now
    user.archived_effective_date = effective_date
    user.archived_by = actor
    user.save(update_fields=[
        "is_active", "archived_at", "archived_effective_date", "archived_by",
    ])

    record_audit_event(
        actor=actor, request=request, category="accounts",
        action="account_archived", summary=f"{user.role.title()} account archived: {user.username}",
        target_type="user", target_id=user.pk, target_label=user.username,
        details={"role": user.role, "effective_date": str(effective_date),
                 "closed_schedules": future_closed + current_closed,
                 "students_needing_reassignment": assigned_students,
                 "salary_rule": "earnings stop after archive effective date"},
    )
    return {
        "already_archived": False,
        "archive_date": str(effective_date),
        "closed_schedules": future_closed + current_closed,
        "students_needing_reassignment": assigned_students,
    }
