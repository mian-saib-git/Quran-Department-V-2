from datetime import timedelta

from django.db import transaction

from .models import (
    ClassSchedule,
    StudentClassHistory,
)
from .payroll_source_locks import (
    ensure_schedule_change_payroll_editable,
)


def _schedule_key(
    teacher_id,
    weekday,
    time_slot,
    duration_minutes,
):
    return (
        int(teacher_id),
        str(weekday),
        str(time_slot)[:8],
        int(duration_minutes),
    )


@transaction.atomic
def sync_student_schedule_history(
    *,
    student,
    desired_teacher,
    desired_rows,
    effective_date,
    actor=None,
    note="Academy state schedule sync.",
):
    ensure_schedule_change_payroll_editable(
        student=student,
        desired_teacher=desired_teacher,
        effective_date=effective_date,
    )

    previous_teacher = student.teacher
    teacher_changed = bool(
        desired_teacher
        and previous_teacher
        and desired_teacher.id != previous_teacher.id
    )

    department = student.department
    institution = (
        student.institution
        or getattr(department, "institution", None)
    )

    active_rows = list(
        ClassSchedule.objects
        .select_for_update()
        .filter(
            student=student,
            is_active=True,
            effective_to__isnull=True,
        )
        .order_by("id")
    )

    normalized_desired = []

    for item in desired_rows or []:
        if not desired_teacher:
            continue

        normalized_desired.append({
            "teacher": desired_teacher,
            "weekday": item["weekday"],
            "time_slot": item["time_slot"],
            "duration_minutes": int(
                item.get("duration_minutes", 30)
            ),
        })

    if not normalized_desired and teacher_changed:
        normalized_desired = [
            {
                "teacher": desired_teacher,
                "weekday": row.weekday,
                "time_slot": row.time_slot,
                "duration_minutes": row.duration_minutes,
            }
            for row in active_rows
        ]

    if teacher_changed:
        StudentClassHistory.objects.create(
            institution=institution,
            department=department,
            student=student,
            event_type=(
                StudentClassHistory.EventType.TEACHER_TRANSFER
            ),
            effective_date=effective_date,
            previous_teacher=previous_teacher,
            new_teacher=desired_teacher,
            notes=note,
            created_by=actor,
        )

        student.teacher = desired_teacher
        student.save(update_fields=["teacher"])

    if not normalized_desired and not teacher_changed:
        return {
            "teacher_changed": False,
            "closed": 0,
            "created": 0,
            "kept": len(active_rows),
        }

    desired_by_key = {}

    for item in normalized_desired:
        key = _schedule_key(
            item["teacher"].id,
            item["weekday"],
            item["time_slot"],
            item["duration_minutes"],
        )
        desired_by_key[key] = item

    kept_keys = set()
    closed = 0
    created = 0
    kept = 0

    for row in active_rows:
        key = _schedule_key(
            row.teacher_id,
            row.weekday,
            row.time_slot,
            row.duration_minutes,
        )

        if key in desired_by_key and key not in kept_keys:
            kept_keys.add(key)
            kept += 1
            continue

        if row.effective_from and row.effective_from >= effective_date:
            row.delete()
            closed += 1
            continue

        row.is_active = False
        row.effective_to = effective_date - timedelta(days=1)
        row.save(update_fields=["is_active", "effective_to"])
        closed += 1

    for key, item in desired_by_key.items():
        if key in kept_keys:
            continue

        ClassSchedule.objects.create(
            institution=institution,
            department=department,
            student=student,
            teacher=item["teacher"],
            weekday=item["weekday"],
            time_slot=item["time_slot"],
            duration_minutes=item["duration_minutes"],
            is_active=True,
            effective_from=effective_date,
            effective_to=None,
        )
        created += 1

    return {
        "teacher_changed": teacher_changed,
        "closed": closed,
        "created": created,
        "kept": kept,
    }
