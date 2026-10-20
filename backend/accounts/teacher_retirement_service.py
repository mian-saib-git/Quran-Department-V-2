"""Safe teacher reassignment and retirement readiness checks.

Never delete a student or historical schedule while retiring a teacher.
"""
from django.db import transaction
from datetime import time
from django.utils import timezone
from zoneinfo import ZoneInfo

from academy.models import ClassSchedule, StudentClassHistory, StudentProfile, TeacherProfile
from academy.schedule_history_service import sync_student_schedule_history


class TeacherRetirementSlotConflict(ValueError):
    """A destination already teaches at one of the requested class times."""


class TeacherRetirementBlocked(ValueError):
    def __init__(self, readiness):
        self.readiness = readiness
        super().__init__("Transfer all students and active classes before archiving this teacher.")


def teacher_retirement_readiness(teacher):
    """Count ALL assigned students, including dropped and on-leave students.

    Historical/inactive schedule rows do not prevent archival. Any current
    active schedule rows remaining on the old teacher do prevent it.
    """
    assigned = list(
        StudentProfile.objects.filter(teacher=teacher)
        .select_related("user")
        .order_by("user__first_name", "user__username", "id")
    )
    active_schedules = ClassSchedule.objects.filter(
        teacher=teacher, is_active=True,
    )
    active_count = active_schedules.count()
    student_rows = [
        {
            "id": student.id,
            "user_id": student.user_id,
            "name": student.user.get_full_name() or student.user.username,
            "username": student.user.username,
            "status": student.class_status,
            "active_class_count": active_schedules.filter(student=student).count(),
            "schedule": active_schedule_slots_for_student(student, teacher),
        }
        for student in assigned
    ]
    return {
        "teacher_id": teacher.id,
        "teacher_user_id": teacher.user_id,
        "teacher_name": teacher.user.get_full_name() or teacher.user.username,
        "assigned_students": len(assigned),
        "active_classes": active_count,
        "students": student_rows,
        "can_archive": len(assigned) == 0 and active_count == 0,
    }


def _minutes(value):
    """Schedule times are local wall-clock times stored as TimeField values."""
    if isinstance(value, str):
        value = time.fromisoformat(value)
    return value.hour * 60 + value.minute


def schedule_slots(rows):
    return [
        {
            "weekday": row.weekday,
            "time_slot": str(row.time_slot)[:5],
            "duration_minutes": row.duration_minutes,
        }
        for row in rows
    ]


WEEK_DAYS = {name: index for index, name in enumerate((
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
))}


def slots_overlap(left, right):
    """Detect overlaps, including classes ending after midnight or Sunday."""
    left_start = WEEK_DAYS[left["weekday"]] * 1440 + _minutes(left["time_slot"])
    right_start = WEEK_DAYS[right["weekday"]] * 1440 + _minutes(right["time_slot"])
    left_end = left_start + int(left["duration_minutes"])
    for week_shift in (-10080, 0, 10080):
        shifted_start = right_start + week_shift
        shifted_end = shifted_start + int(right["duration_minutes"])
        if left_start < shifted_end and shifted_start < left_end:
            return True
    return False


def candidate_is_available(required, occupied):
    """Free on ALL requested days; back-to-back nonoverlapping slots are allowed."""
    return not any(slots_overlap(wanted, existing) for wanted in required for existing in occupied)


def active_schedule_slots_for_student(student, teacher):
    return schedule_slots(ClassSchedule.objects.filter(
        student=student, teacher=teacher, is_active=True, effective_to__isnull=True,
    ).order_by("weekday", "time_slot", "pk"))


def candidate_occupied_slots(candidate):
    return schedule_slots(ClassSchedule.objects.filter(
        teacher=candidate, is_active=True, effective_to__isnull=True,
    ))


@transaction.atomic
def transfer_student_before_teacher_retirement(*, teacher, student_id, destination, actor):
    """Move one student's CURRENT assignment while preserving all past records."""
    if teacher.pk == destination.pk:
        raise ValueError("Select a different destination teacher.")
    if not teacher.department_id or destination.department_id != teacher.department_id:
        raise ValueError("Destination teacher must belong to the same department.")
    if teacher.institution_id != destination.institution_id:
        raise ValueError("Destination teacher must belong to the same institution.")
    if not destination.user.is_active or destination.user.archived_at is not None:
        raise ValueError("Destination teacher must have an active, unarchived account.")
    if teacher.user.archived_at is not None:
        raise ValueError("An archived teacher cannot transfer new assignments.")

    # Lock teachers in stable order and the student row before any modifications.
    list(TeacherProfile.objects.select_for_update().filter(pk__in=sorted([teacher.pk, destination.pk])).order_by("pk"))
    student = (
        StudentProfile.objects.select_for_update()
        .select_related("user", "teacher")
        .filter(pk=student_id, teacher=teacher, department_id=teacher.department_id)
        .first()
    )
    if not student:
        raise ValueError("Student is no longer assigned to this teacher. Refresh and try again.")
    today = timezone.localdate(timezone=ZoneInfo("Asia/Karachi"))
    rows = list(
        ClassSchedule.objects.filter(
            student=student, teacher=teacher, is_active=True,
            effective_to__isnull=True,
        ).order_by("id")
    )
    desired_rows = [
        {"weekday": row.weekday, "time_slot": row.time_slot,
         "duration_minutes": row.duration_minutes}
        for row in rows
    ]
    if not candidate_is_available(desired_rows, candidate_occupied_slots(destination)):
        raise TeacherRetirementSlotConflict(
            "This teacher already has a class overlapping one or more requested days/times. "
            "Choose a teacher with a free slot."
        )
    result = sync_student_schedule_history(
        student=student, desired_teacher=destination, desired_rows=desired_rows,
        effective_date=today, actor=actor,
        note="Transferred before source teacher account archival.",
    )
    # Preserve all inactive/historical schedules, payroll and attendance records.
    student.status_effective_date = today
    student.student_type = StudentProfile.StudentType.TRANSFERRED_FROM_TEACHER
    student.save(update_fields=["status_effective_date", "student_type"])
    return {"student_id": student.pk, "destination_teacher_id": destination.pk, **result}
