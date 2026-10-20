"""Permanently remove a teacher login while preserving original history rows.

No current students/classes may remain. User deletion is atomic and will fail
on any unexpected PROTECT relation rather than erase a salary or audit row.
"""
from django.db import transaction
from django.utils import timezone
from zoneinfo import ZoneInfo
from django.db.models.deletion import Collector

from academy.models import (
    Attendance, ClassSchedule, DailyLessonReport, Lesson,
    MonthlyLessonPlan, MonthlyLessonSummary, StudentProfile, TeacherProfile,
)
from .models import User
from .teacher_retirement_service import teacher_retirement_readiness, TeacherRetirementBlocked
from .platform_runtime import record_audit_event

AUTHOR_MODELS = (
    (Attendance, "marked_by"),
    (Lesson, "created_by"),
    (DailyLessonReport, "created_by"),
    (MonthlyLessonSummary, "created_by"),
    (MonthlyLessonPlan, "created_by"),
)

@transaction.atomic
def delete_teacher_login_permanently(*, user, actor, request=None):
    user = User.objects.select_for_update().get(pk=user.pk)
    if user.role != User.Role.TEACHER or user.is_superuser or user.pk == actor.pk:
        raise ValueError("Only a separate, non-superuser teacher login can be permanently deleted.")
    teacher = TeacherProfile.objects.select_for_update().get(user=user)
    readiness = teacher_retirement_readiness(teacher)
    if not readiness["can_archive"]:
        raise TeacherRetirementBlocked(readiness)
    # Defensive second check. Never delete student accounts or historical classes.
    if StudentProfile.objects.filter(teacher=teacher).exists() or ClassSchedule.objects.filter(
        teacher=teacher, is_active=True
    ).exists():
        raise TeacherRetirementBlocked(teacher_retirement_readiness(teacher))

    teacher_id, user_id = teacher.pk, user.pk
    historical_name = (user.get_full_name().strip() or f"Former teacher #{teacher_id}")[:255]
    now = timezone.now()
    teacher.historical_name = historical_name
    teacher.login_deleted_at = now
    teacher.login_deleted_effective_date = timezone.localdate(now, timezone=ZoneInfo("Asia/Karachi"))
    teacher.user = None
    teacher.save(update_fields=["historical_name", "login_deleted_at", "login_deleted_effective_date", "user"])

    # Preserve the attribution of historical teacher-authored records when
    # their User foreign key is nulled by SET_NULL on actual hard deletion.
    for model, fk in AUTHOR_MODELS:
        model.objects.filter(**{fk: user}).update(actor_name_snapshot=historical_name)

    # Prevent any accidental cascading deletion of salary, student, teaching
    # or other business records. If a new CASCADE appears, reject removal.
    collector = Collector(using=user._state.db or "default")
    collector.collect([user])
    allowed_cascade = {
        "accounts.user", "accounts.userdepartmentrole",
        # These are login-specific permissions/access records, not business history.
        "accounts.coordinatortabaccess", "accounts.user_groups",
        "accounts.user_user_permissions",
        "token_blacklist.outstandingtoken", "token_blacklist.blacklistedtoken",
        "admin.logentry", "accounts.platformnoticereceipt",
        # Recipient-only notifications can be removed with the deleted login.
        "accounts.portalnotification",
    }
    unexpected = sorted({model._meta.label_lower for model in collector.data if model._meta.label_lower not in allowed_cascade})
    unexpected += sorted({model.model._meta.label_lower for model in collector.fast_deletes if model.model._meta.label_lower not in allowed_cascade})
    if unexpected:
        raise ValueError("Deletion blocked: unexpected dependent records: " + ", ".join(sorted(set(unexpected))))
    user.delete()
    if User.objects.filter(pk=user_id).exists():
        raise ValueError("Teacher login was not removed; deletion rolled back.")
    if not TeacherProfile.objects.filter(pk=teacher_id, user__isnull=True).exists():
        raise ValueError("Historical teacher profile was not retained; deletion rolled back.")

    record_audit_event(
        actor=actor, request=request, category="accounts", action="teacher_login_deleted_permanently",
        summary=f"Deleted teacher login, retained historical teacher #{teacher_id}",
        target_type="teacher_historical_profile", target_id=teacher_id, target_label=historical_name,
        details={"teacher_profile_id": teacher_id, "removed_user_id": user_id,
                 "salary_history_preserved": True, "login_deleted_date": str(teacher.login_deleted_effective_date)},
    )
    return {"detail": "Teacher login permanently deleted; historical salary and attendance retained.",
            "teacher_profile_id": teacher_id, "deleted_user_id": user_id, "historical_name": historical_name}
