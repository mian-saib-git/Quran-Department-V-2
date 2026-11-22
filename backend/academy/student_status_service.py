from __future__ import annotations

from datetime import date
from zoneinfo import ZoneInfo

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone

from accounts.models import PlatformAuditLog

from .models import ClassSchedule, StudentClassHistory, StudentProfile
from .payroll_source_locks import (
    PayrollSourceLockedError,
    ensure_student_state_change_payroll_editable,
)
from .salary_v2_models import QuranStudentDropEvent
from .student_rejoin_service import StudentRejoinError, rejoin_student_drop


ACADEMY_TIME_ZONE = ZoneInfo("Asia/Karachi")


def academy_localdate() -> date:
    """Return today's calendar date in the authoritative academy timezone (Asia/Karachi)."""
    return timezone.localdate(timezone=ACADEMY_TIME_ZONE)


DROPPED_CLASS_STATUSES = {
    StudentProfile.ClassStatus.OLD_DROPPED,
    StudentProfile.ClassStatus.TRIAL_DROPPED,
    StudentProfile.ClassStatus.OLD_DROPPED_OTHER,
}

INACTIVE_TEACHING_STATUSES = {
    StudentProfile.ClassStatus.ON_LEAVE,
    *DROPPED_CLASS_STATUSES,
}


class StudentStatusTransitionError(Exception):
    """Domain error for coordinator Drop/Leave/Return confirmation."""

    def __init__(self, *, code: str, detail: str, status_code: int = 409, payload: dict | None = None):
        body = {"detail": detail, "code": code}
        if payload:
            body.update(payload)
        self.code = code
        self.status_code = status_code
        self.payload = body
        super().__init__(detail)


def is_student_teaching_active(student: StudentProfile, target_date: date | None = None) -> bool:
    """Authoritative rule for whether a student is eligible for active teaching views on target_date."""
    if student is None:
        return False
    check_date = target_date or academy_localdate()
    user = getattr(student, "user", None)
    if user is not None:
        if not getattr(user, "is_active", True):
            return False
        archived_at = getattr(user, "archived_at", None)
        archived_eff = getattr(user, "archived_effective_date", None)
        if archived_at is not None and (archived_eff is None or check_date >= archived_eff):
            return False

    if student.class_status in INACTIVE_TEACHING_STATUSES:
        eff = student.status_effective_date
        if eff is None or check_date >= eff:
            return False

    return True


def validate_student_return_assignment(student: StudentProfile, department) -> tuple[bool, str]:
    """Verify whether the student's previous teacher & active schedule remain valid on return."""
    teacher = getattr(student, "teacher", None)
    if teacher is None:
        return False, "No teacher is currently assigned to this student."

    if teacher.department_id != department.id:
        return False, "Previous teacher belongs to a different department."

    teacher_user = getattr(teacher, "user", None)
    if (
        teacher_user is None
        or not getattr(teacher_user, "is_active", False)
        or getattr(teacher_user, "archived_at", None) is not None
        or getattr(teacher, "login_deleted_at", None) is not None
    ):
        return False, "Previous teacher account is inactive or archived. Coordinator reassignment is required."

    has_active_schedule = ClassSchedule.objects.filter(
        department=department,
        student=student,
        teacher=teacher,
        is_active=True,
    ).exists()
    if not has_active_schedule:
        return False, "No active class schedule exists for the previous teacher. Coordinator reassignment is required."

    return True, ""


@transaction.atomic
def confirm_student_drop_leave_return(
    *,
    department,
    student_id: int,
    action: str,
    effective_date: date,
    reason: str = "",
    actor=None,
) -> dict:
    """Confirm Dropped, On Leave, or Return/Rejoin for a Quran student."""
    if action not in {"confirm_drop", "confirm_leave", "confirm_return"}:
        raise StudentStatusTransitionError(
            code="invalid_action",
            detail="Action must be 'confirm_drop', 'confirm_leave', or 'confirm_return'.",
            status_code=400,
        )

    if not isinstance(effective_date, date):
        raise StudentStatusTransitionError(
            code="invalid_effective_date",
            detail="A valid effective_date (YYYY-MM-DD) is required.",
            status_code=400,
        )

    student = (
        StudentProfile.objects.select_for_update(of=("self",))
        .select_related("user", "teacher__user")
        .filter(id=student_id, department=department)
        .first()
    )
    if student is None:
        raise StudentStatusTransitionError(
            code="student_not_found",
            detail="Student not found in this Quran department.",
            status_code=404,
        )

    try:
        ensure_student_state_change_payroll_editable(
            student=student,
            effective_date=effective_date,
        )
    except PayrollSourceLockedError as exc:
        raise StudentStatusTransitionError(
            code="payroll_locked",
            detail=exc.payload.get("detail", "Target payroll period is locked."),
            status_code=409,
            payload=exc.payload,
        ) from exc

    previous_status = student.class_status
    previous_type = student.student_type
    clean_reason = (reason or "").strip()

    if action == "confirm_drop":
        if previous_status in DROPPED_CLASS_STATUSES:
            raise StudentStatusTransitionError(
                code="already_dropped",
                detail="Student is already confirmed as Dropped.",
                status_code=409,
            )
        new_status = (
            StudentProfile.ClassStatus.TRIAL_DROPPED
            if student.student_type == StudentProfile.StudentType.TRIAL_STUDENT
            else StudentProfile.ClassStatus.OLD_DROPPED
        )
        student.class_status = new_status
        student.status_effective_date = effective_date
        student.save(update_fields=["class_status", "status_effective_date"])

        StudentClassHistory.objects.create(
            student=student,
            event_type=StudentClassHistory.EventType.STATUS_CHANGED,
            effective_date=effective_date,
            previous_teacher=student.teacher,
            new_teacher=student.teacher,
            previous_student_type=previous_type,
            new_student_type=student.student_type,
            previous_class_status=previous_status,
            new_class_status=new_status,
            notes=clean_reason or "Coordinator confirmed student Dropped.",
            created_by=actor,
        )
        PlatformAuditLog.objects.create(
            actor=actor,
            action="student_drop_confirmed",
            target_type="student_profile",
            target_id=str(student.id),
            summary=f"Confirmed Dropped for {student} effective {effective_date}.",
            details={
                "department_id": department.id,
                "previous_class_status": previous_status,
                "new_class_status": new_status,
                "effective_date": str(effective_date),
                "reason": clean_reason,
            },
        )
        return {
            "student_id": student.id,
            "action": action,
            "class_status": student.class_status,
            "class_status_label": student.get_class_status_display(),
            "status_effective_date": str(student.status_effective_date),
            "requires_reassignment": False,
            "reassignment_reason": "",
            "detail": f"{student} confirmed as Dropped effective {effective_date}.",
        }

    if action == "confirm_leave":
        if previous_status == StudentProfile.ClassStatus.ON_LEAVE:
            raise StudentStatusTransitionError(
                code="already_on_leave",
                detail="Student is already confirmed On Leave.",
                status_code=409,
            )
        new_status = StudentProfile.ClassStatus.ON_LEAVE
        student.class_status = new_status
        student.status_effective_date = effective_date
        student.save(update_fields=["class_status", "status_effective_date"])

        StudentClassHistory.objects.create(
            student=student,
            event_type=StudentClassHistory.EventType.STATUS_CHANGED,
            effective_date=effective_date,
            previous_teacher=student.teacher,
            new_teacher=student.teacher,
            previous_student_type=previous_type,
            new_student_type=student.student_type,
            previous_class_status=previous_status,
            new_class_status=new_status,
            notes=clean_reason or "Coordinator confirmed student On Leave.",
            created_by=actor,
        )
        PlatformAuditLog.objects.create(
            actor=actor,
            action="student_leave_confirmed",
            target_type="student_profile",
            target_id=str(student.id),
            summary=f"Confirmed On Leave for {student} effective {effective_date}.",
            details={
                "department_id": department.id,
                "previous_class_status": previous_status,
                "new_class_status": new_status,
                "effective_date": str(effective_date),
                "reason": clean_reason,
            },
        )
        return {
            "student_id": student.id,
            "action": action,
            "class_status": student.class_status,
            "class_status_label": student.get_class_status_display(),
            "status_effective_date": str(student.status_effective_date),
            "requires_reassignment": False,
            "reassignment_reason": "",
            "detail": f"{student} confirmed On Leave effective {effective_date}.",
        }

    # action == "confirm_return"
    if effective_date > academy_localdate():
        raise StudentStatusTransitionError(
            code="future_return_date",
            detail="A return date cannot be in the future.",
            status_code=400,
        )

    if (
        previous_status in INACTIVE_TEACHING_STATUSES
        and student.status_effective_date is not None
        and effective_date < student.status_effective_date
    ):
        raise StudentStatusTransitionError(
            code="return_before_inactive_date",
            detail=(
                f"Return date ({effective_date}) cannot be earlier than the "
                f"effective date ({student.status_effective_date})."
            ),
            status_code=400,
        )

    active_drop = (
        QuranStudentDropEvent.objects.select_for_update(of=("self",))
        .filter(
            department=department,
            student=student,
            status=QuranStudentDropEvent.Status.DROPPED,
            rejoined_date__isnull=True,
        )
        .order_by("-drop_effective_date", "-id")
        .first()
    )

    if previous_status not in INACTIVE_TEACHING_STATUSES and active_drop is None:
        raise StudentStatusTransitionError(
            code="already_active",
            detail="Student is already active (Running).",
            status_code=409,
        )

    rejoin_payload = None
    if active_drop is not None:
        try:
            rejoin_payload = rejoin_student_drop(
                student=student,
                rejoin_date=effective_date,
                actor=actor,
            )
        except StudentRejoinError as exc:
            raise StudentStatusTransitionError(
                code=exc.code,
                detail=exc.payload.get("detail", "Could not record student rejoin."),
                status_code=409,
                payload=exc.payload,
            ) from exc

    returning_from_leave = previous_status == StudentProfile.ClassStatus.ON_LEAVE
    if returning_from_leave:
        student.student_type = StudentProfile.StudentType.RETURNED_FROM_LEAVE
    student.class_status = StudentProfile.ClassStatus.RUNNING
    student.status_effective_date = effective_date
    student.save(
        update_fields=[
            "class_status",
            "student_type",
            "status_effective_date",
        ]
    )

    assignment_valid, reassignment_reason = validate_student_return_assignment(
        student, department
    )

    StudentClassHistory.objects.create(
        student=student,
        event_type=(
            StudentClassHistory.EventType.RETURNED_FROM_LEAVE
            if returning_from_leave
            else StudentClassHistory.EventType.STATUS_CHANGED
        ),
        effective_date=effective_date,
        previous_teacher=student.teacher,
        new_teacher=student.teacher,
        previous_student_type=previous_type,
        new_student_type=student.student_type,
        previous_class_status=previous_status,
        new_class_status=student.class_status,
        notes=clean_reason or "Coordinator confirmed student returned / rejoined.",
        created_by=actor,
    )
    PlatformAuditLog.objects.create(
        actor=actor,
        action="student_return_confirmed",
        target_type="student_profile",
        target_id=str(student.id),
        summary=f"Confirmed Return for {student} effective {effective_date}.",
        details={
            "department_id": department.id,
            "previous_class_status": previous_status,
            "new_class_status": student.class_status,
            "effective_date": str(effective_date),
            "requires_reassignment": not assignment_valid,
            "reassignment_reason": reassignment_reason,
            "reason": clean_reason,
        },
    )

    detail = (
        f"{student} returned to Running effective {effective_date}, but requires coordinator reassignment: {reassignment_reason}"
        if not assignment_valid
        else f"{student} returned to active teaching effective {effective_date}."
    )

    return {
        "student_id": student.id,
        "action": action,
        "class_status": student.class_status,
        "class_status_label": student.get_class_status_display(),
        "status_effective_date": str(student.status_effective_date),
        "requires_reassignment": not assignment_valid,
        "reassignment_reason": reassignment_reason,
        "rejoin": rejoin_payload,
        "detail": detail,
    }
