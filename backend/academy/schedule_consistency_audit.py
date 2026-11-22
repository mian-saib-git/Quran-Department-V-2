from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from django.db import transaction
from django.db.models import Q

from accounts.models import PlatformAuditLog

from .models import ClassSchedule, StudentProfile
from .student_status_service import INACTIVE_TEACHING_STATUSES, academy_localdate


def run_schedule_consistency_audit(department=None) -> dict:
    students_qs = StudentProfile.objects.select_related("user", "teacher__user", "department").all()
    if department is not None:
        students_qs = students_qs.filter(Q(department=department) | Q(user__department=department))

    schedules_qs = ClassSchedule.objects.select_related("student__user", "teacher__user").order_by(
        "student_id", "weekday", "-is_active", "-id"
    )
    if department is not None:
        schedules_qs = schedules_qs.filter(
            Q(student__department=department) | Q(student__user__department=department)
        )

    schedules_by_student: dict[int, list[ClassSchedule]] = defaultdict(list)
    for row in schedules_qs:
        schedules_by_student[row.student_id].append(row)

    findings: dict[str, list[dict]] = {
        "duplicate_active_weekday": [],
        "active_schedule_for_inactive_student": [],
        "teacher_mismatch": [],
        "overlapping_effective_range": [],
        "missing_active_schedule": [],
        "duplicate_verification_occurrences": [],
        "stale_verification_wrong_teacher": [],
    }
    affected_student_ids: set[int] = set()

    for student in students_qs:
        rows = schedules_by_student.get(student.id, [])
        active_rows = [r for r in rows if r.is_active]
        is_inactive_student = (
            not student.user.is_active
            or student.user.archived_at is not None
            or student.class_status in INACTIVE_TEACHING_STATUSES
        )

        # 1. Duplicate active weekday
        by_day: dict[str, list[ClassSchedule]] = defaultdict(list)
        for row in active_rows:
            by_day[row.weekday].append(row)
        for weekday, day_rows in by_day.items():
            if len(day_rows) > 1:
                affected_student_ids.add(student.id)
                findings["duplicate_active_weekday"].append(
                    {
                        "student_id": student.id,
                        "username": student.user.username,
                        "weekday": weekday,
                        "schedule_ids": [r.id for r in day_rows],
                    }
                )

        # 2. Active schedule on inactive/dropped/on-leave student
        if is_inactive_student and active_rows:
            affected_student_ids.add(student.id)
            findings["active_schedule_for_inactive_student"].append(
                {
                    "student_id": student.id,
                    "username": student.user.username,
                    "class_status": student.class_status,
                    "active_schedule_ids": [r.id for r in active_rows],
                }
            )

        # 3. Teacher mismatch
        mismatched = [
            r for r in active_rows if student.teacher_id and r.teacher_id != student.teacher_id
        ]
        if mismatched:
            affected_student_ids.add(student.id)
            findings["teacher_mismatch"].append(
                {
                    "student_id": student.id,
                    "username": student.user.username,
                    "student_teacher_id": student.teacher_id,
                    "mismatched_schedule_ids": [r.id for r in mismatched],
                }
            )

        # 4. Missing active schedule for active teaching student
        if not is_inactive_student and student.teacher_id and not active_rows:
            affected_student_ids.add(student.id)
            findings["missing_active_schedule"].append(
                {
                    "student_id": student.id,
                    "username": student.user.username,
                    "class_status": student.class_status,
                }
            )

        # 5. Overlapping effective ranges per weekday
        all_by_day: dict[str, list[ClassSchedule]] = defaultdict(list)
        for row in rows:
            all_by_day[row.weekday].append(row)
        for weekday, day_rows in all_by_day.items():
            if len(day_rows) < 2:
                continue
            for i in range(len(day_rows)):
                for j in range(i + 1, len(day_rows)):
                    a, b = day_rows[i], day_rows[j]
                    if a.is_active and b.is_active:
                        continue  # Already captured in duplicate_active_weekday
                    a_start = a.effective_from or date.min
                    b_start = b.effective_from or date.min
                    a_end = a.effective_to
                    b_end = b.effective_to
                    overlaps = (a_end is None or b_start <= a_end) and (
                        b_end is None or a_start <= b_end
                    )
                    if overlaps:
                        affected_student_ids.add(student.id)
                        findings["overlapping_effective_range"].append(
                            {
                                "student_id": student.id,
                                "username": student.user.username,
                                "weekday": weekday,
                                "schedule_ids": [a.id, b.id],
                            }
                        )

    # 6 & 7. Read-only SalaryAttendanceVerification consistency checks (duplicates & post-transfer teacher mismatch)
    try:
        from salary.models import SalaryAttendanceVerification
        from .models import StudentClassHistory

        verifs_qs = SalaryAttendanceVerification.objects.select_related("student__user").all()
        if department is not None:
            verifs_qs = verifs_qs.filter(department=department)

        verifs_by_student_date: dict[tuple[int, object], list] = defaultdict(list)
        for v in verifs_qs:
            if v.student_id:
                verifs_by_student_date[(v.student_id, v.class_date)].append(v)

        for (sid, c_date), v_list in verifs_by_student_date.items():
            if len(v_list) > 1:
                affected_student_ids.add(sid)
                findings["duplicate_verification_occurrences"].append(
                    {
                        "student_id": sid,
                        "username": v_list[0].student.user.username if v_list[0].student else "",
                        "class_date": c_date.isoformat(),
                        "verification_ids": [v.id for v in v_list],
                    }
                )

        transfers_by_student: dict[int, list] = defaultdict(list)
        transfers_qs = (
            StudentClassHistory.objects.filter(
                event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
                new_teacher_id__isnull=False,
            )
            .select_related("student__user")
            .order_by("effective_date", "id")
        )
        for tr in transfers_qs:
            if tr.effective_date:
                transfers_by_student[tr.student_id].append(tr)

        for sid, tr_list in transfers_by_student.items():
            wrong_verifs = []
            for (v_sid, c_date), v_list in verifs_by_student_date.items():
                if v_sid != sid:
                    continue
                # Resolve the latest effective transfer on or before c_date
                effective_tr = None
                for tr in tr_list:
                    if tr.effective_date <= c_date:
                        effective_tr = tr
                    else:
                        break
                if not effective_tr:
                    continue
                for v in v_list:
                    if v.teacher_id != effective_tr.new_teacher_id and v.verification_status == "pending":
                        wrong_verifs.append((v, effective_tr))
            if wrong_verifs:
                affected_student_ids.add(sid)
                latest_tr = wrong_verifs[-1][1]
                student_obj = wrong_verifs[0][0].student
                findings["stale_verification_wrong_teacher"].append(
                    {
                        "student_id": sid,
                        "username": student_obj.user.username if student_obj else "",
                        "transfer_effective_date": latest_tr.effective_date.isoformat(),
                        "expected_teacher_id": latest_tr.new_teacher_id,
                        "verification_ids": [pair[0].id for pair in wrong_verifs],
                    }
                )
    except Exception:
        pass

    return {
        "total_students_scanned": students_qs.count(),
        "affected_student_ids": sorted(affected_student_ids),
        "counts": {key: len(items) for key, items in findings.items()},
        "findings": findings,
    }


@transaction.atomic
def apply_schedule_consistency_cleanup(
    *,
    approved_student_ids: list[int],
    actor=None,
    department=None,
) -> dict:
    if not approved_student_ids:
        return {"applied_students": [], "changes": 0}

    eff_date = academy_localdate()
    prior_day = eff_date - timedelta(days=1)
    students_qs = StudentProfile.objects.select_related("user", "teacher").filter(
        id__in=approved_student_ids
    )
    if department is not None:
        students_qs = students_qs.filter(Q(department=department) | Q(user__department=department))

    changes = 0
    applied_students: list[int] = []

    for student in students_qs:
        student_changed = False
        is_inactive_student = (
            not student.user.is_active
            or student.user.archived_at is not None
            or student.class_status in INACTIVE_TEACHING_STATUSES
        )
        active_rows = list(
            ClassSchedule.objects.filter(student=student, is_active=True).order_by("-id")
        )

        if is_inactive_student:
            for row in active_rows:
                row.is_active = False
                if row.effective_to is None or row.effective_to > prior_day:
                    row.effective_to = prior_day
                row.save(update_fields=["is_active", "effective_to"])
                changes += 1
                student_changed = True
        else:
            seen_weekdays: set[str] = set()
            for row in active_rows:
                if row.weekday in seen_weekdays:
                    row.is_active = False
                    if row.effective_to is None or row.effective_to > prior_day:
                        row.effective_to = prior_day
                    row.save(update_fields=["is_active", "effective_to"])
                    changes += 1
                    student_changed = True
                    continue
                seen_weekdays.add(row.weekday)
                if student.teacher_id and row.teacher_id != student.teacher_id:
                    row.teacher_id = student.teacher_id
                    row.save(update_fields=["teacher"])
                    changes += 1
                    student_changed = True

        if student_changed:
            applied_students.append(student.id)

    PlatformAuditLog.objects.create(
        actor=actor,
        category="schedule_consistency_audit",
        action="apply_cleanup",
        summary=f"Applied guarded schedule consistency cleanup to {len(applied_students)} student(s).",
        target_type="student_batch",
        target_id=",".join(str(sid) for sid in applied_students),
        target_label="schedule_consistency_audit",
        details={
            "approved_student_ids": list(approved_student_ids),
            "applied_students": applied_students,
            "changes": changes,
        },
    )

    return {"applied_students": applied_students, "changes": changes}


@transaction.atomic
def apply_verification_cleanup(
    *,
    approved_verification_ids: list[int],
    actor=None,
    department=None,
) -> dict:
    """
    Guarded, ID-specific cleanup for stale pending SalaryAttendanceVerification rows
    (duplicates or post-transfer orphaned pending rows). Never deletes verified,
    resolved, conflicted, attendance-linked, or locked-payroll rows.
    """
    from salary.models import SalaryAttendanceVerification, SalaryPayrollPeriod

    if not approved_verification_ids:
        return {"deleted_ids": [], "skipped": []}

    qs = SalaryAttendanceVerification.objects.select_for_update().filter(
        id__in=approved_verification_ids
    )
    if department is not None:
        qs = qs.filter(department=department)

    locked_months = set(
        SalaryPayrollPeriod.objects.filter(
            status__in=[
                SalaryPayrollPeriod.Status.PENDING_APPROVAL,
                SalaryPayrollPeriod.Status.APPROVED,
                SalaryPayrollPeriod.Status.PAID,
            ]
        ).values_list("department_id", "payroll_year", "payroll_month")
    )

    before_snapshots = []
    deletable_ids = []
    skipped = []

    for v in qs:
        if (v.department_id, v.class_date.year, v.class_date.month) in locked_months:
            skipped.append({"id": v.id, "reason": "payroll_locked"})
            continue
        if v.verification_status != SalaryAttendanceVerification.VerificationStatus.PENDING:
            skipped.append({"id": v.id, "reason": f"status_{v.verification_status}"})
            continue
        if v.source_attendance_id is not None:
            skipped.append({"id": v.id, "reason": "has_source_attendance"})
            continue

        before_snapshots.append(
            {
                "id": v.id,
                "department_id": v.department_id,
                "teacher_id": v.teacher_id,
                "student_id": v.student_id,
                "class_date": v.class_date.isoformat(),
                "scheduled_time": v.scheduled_time.strftime("%H:%M:%S") if v.scheduled_time else None,
                "occurrence_key": v.occurrence_key,
                "source_schedule_id": v.source_schedule_id,
            }
        )
        deletable_ids.append(v.id)

    if deletable_ids:
        SalaryAttendanceVerification.objects.filter(id__in=deletable_ids).delete()

    PlatformAuditLog.objects.create(
        actor=actor,
        category="schedule_consistency_audit",
        action="apply_verification_cleanup",
        summary=f"Removed {len(deletable_ids)} stale pending verification row(s) with before-snapshots preserved.",
        target_type="salary_verification_batch",
        target_id=",".join(str(vid) for vid in deletable_ids),
        target_label="apply_verification_cleanup",
        details={
            "approved_verification_ids": list(approved_verification_ids),
            "deleted_ids": deletable_ids,
            "skipped": skipped,
            "before_snapshots": before_snapshots,
        },
    )

    return {
        "deleted_ids": deletable_ids,
        "skipped": skipped,
        "before_snapshots": before_snapshots,
    }
