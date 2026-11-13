"""
Attendance Evidence Reconciliation and Unmarked Class Detection Engine (Stage 4).

Reconciles scheduled class occurrences across Quran and Tuition departments with
real attendance, substitute coverage, student drops/transfers, and cancellation records.
Produces reliable, auditable, department-scoped attendance evidence for Unified Salary Management.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import Department
from academy.models import (
    Attendance,
    ClassSchedule,
    QuranClassCoverage,
    StudentClassHistory,
    StudentProfile,
    TeacherProfile,
)
from tuition.models import (
    TuitionAttendance,
    TuitionEnrollment,
    TuitionSchedule,
)

from salary.models import (
    SalaryAttendanceAudit,
    SalaryAttendanceVerification,
    SalaryReconciliationBatch,
)


def get_application_timezone() -> ZoneInfo:
    """Return authoritative application timezone (Asia/Karachi)."""
    tz_name = getattr(settings, "DJANGO_TIME_ZONE", "Asia/Karachi") or "Asia/Karachi"
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return ZoneInfo("Asia/Karachi")


def get_current_local_datetime() -> datetime:
    """Get current datetime localized to authoritative timezone."""
    tz = get_application_timezone()
    return datetime.now(tz)


def get_month_date_range(year: int, month: int) -> Tuple[date, date]:
    """Get first and last calendar dates for a year and month."""
    _, last_day = calendar.monthrange(year, month)
    return date(year, month, 1), date(year, month, last_day)


class QuranAttendanceAdapter:
    """Reconciles Quran Department schedules, session attendance, coverage, and history."""

    @classmethod
    def get_occurrences_for_date_range(
        cls,
        department: Department,
        start_date: date,
        end_date: date,
        teacher_filter_id: Optional[int] = None,
        student_filter_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        # Query schedules matching department and date validity
        schedules_qs = ClassSchedule.objects.filter(
            Q(department=department) | Q(student__department=department),
        ).select_related("student", "teacher", "student__user", "teacher__user")

        if teacher_filter_id:
            schedules_qs = schedules_qs.filter(teacher_id=teacher_filter_id)
        if student_filter_id:
            schedules_qs = schedules_qs.filter(student_id=student_filter_id)

        # Date range validity filter:
        # Schedule was effective if (effective_from is null or <= end_date)
        # AND (effective_to is null or >= start_date)
        schedules_qs = schedules_qs.filter(
            Q(effective_from__isnull=True) | Q(effective_from__lte=end_date)
        ).filter(
            Q(effective_to__isnull=True) | Q(effective_to__gte=start_date)
        )

        schedules = list(schedules_qs)
        if not schedules:
            return []

        student_ids = {s.student_id for s in schedules}
        teacher_ids = {s.teacher_id for s in schedules}

        # 1. Pre-fetch StudentClassHistory for transfers and enrollments
        histories = list(
            StudentClassHistory.objects.filter(
                student_id__in=student_ids
            ).order_by("effective_date", "id")
        )

        from collections import defaultdict
        transfers_by_student = defaultdict(list)
        enrollment_by_student = {}
        for h in histories:
            if h.event_type == StudentClassHistory.EventType.TEACHER_TRANSFER:
                transfers_by_student[h.student_id].append(h)
            elif h.event_type == StudentClassHistory.EventType.ENROLLED:
                if h.student_id not in enrollment_by_student:
                    enrollment_by_student[h.student_id] = h

        # 2. Pre-fetch Attendance records for target date range
        all_atts = list(
            Attendance.objects.filter(
                date__gte=start_date,
                date__lte=end_date,
            ).filter(
                Q(entity_type=Attendance.EntityType.TEACHER, teacher_id__in=teacher_ids)
                | Q(entity_type=Attendance.EntityType.STUDENT, student_id__in=student_ids)
            ).order_by("-updated_at", "-id")
        )

        teacher_att_map = {}
        student_att_map = {}
        for att in all_atts:
            if att.entity_type == Attendance.EntityType.TEACHER:
                key = (att.teacher_id, att.date, att.class_key)
                if key not in teacher_att_map:
                    teacher_att_map[key] = att
            elif att.entity_type == Attendance.EntityType.STUDENT:
                key = (att.student_id, att.date)
                if key not in student_att_map:
                    student_att_map[key] = att

        # 3. Pre-fetch QuranClassCoverage for target date range
        all_covs = list(
            QuranClassCoverage.objects.filter(
                date__gte=start_date,
                date__lte=end_date,
                student_id__in=student_ids,
                original_teacher_id__in=teacher_ids,
            ).order_by("-updated_at", "-id")
        )

        coverage_map = {}
        for cov in all_covs:
            key = (cov.student_id, cov.original_teacher_id, cov.date)
            if key not in coverage_map:
                coverage_map[key] = cov

        # Group schedules by weekday
        schedules_by_weekday = defaultdict(list)
        for s in schedules:
            w = (s.weekday or "").strip().lower()
            schedules_by_weekday[w].append(s)

        occurrences: List[Dict[str, Any]] = []
        curr_date = start_date

        while curr_date <= end_date:
            weekday_name = curr_date.strftime("%A").lower()
            day_scheds = schedules_by_weekday.get(weekday_name, [])

            for sched in day_scheds:
                # Schedule effective bounds for curr_date
                if sched.effective_from and sched.effective_from > curr_date:
                    continue
                if sched.effective_to and sched.effective_to < curr_date:
                    continue

                student = sched.student
                teacher = sched.teacher

                # 1. Edge case: Student Drop check
                if student.is_dropped and student.status_effective_date:
                    if curr_date > student.status_effective_date:
                        continue

                # 2. Edge case: Student Teacher Transfer check
                student_transfers = transfers_by_student.get(student.id, [])
                transfer_record = None
                for tr in reversed(student_transfers):
                    if tr.effective_date <= curr_date:
                        transfer_record = tr
                        break
                if transfer_record and transfer_record.new_teacher_id and teacher.id != transfer_record.new_teacher_id:
                    continue

                # 3. Mid-month enrollment check:
                enroll_record = enrollment_by_student.get(student.id)
                if enroll_record and enroll_record.effective_date > curr_date:
                    continue

                time_str = sched.time_slot.strftime("%H:%M") if sched.time_slot else "00:00"
                occurrence_key = f"quran:sched_{sched.id}:{curr_date.isoformat()}"

                teacher_att = teacher_att_map.get((teacher.id, curr_date, time_str))
                student_att = student_att_map.get((student.id, curr_date))
                coverage = coverage_map.get((student.id, teacher.id, curr_date))

                occurrences.append({
                    "source_department_type": SalaryAttendanceVerification.DepartmentType.QURAN,
                    "department": department,
                    "institution": department.institution,
                    "teacher": teacher,
                    "student": student,
                    "occurrence_key": occurrence_key,
                    "class_date": curr_date,
                    "scheduled_time": sched.time_slot,
                    "source_schedule_id": sched.id,
                    "source_attendance_id": (student_att.id if student_att else (teacher_att.id if teacher_att else None)),
                    "teacher_attendance": teacher_att,
                    "student_attendance": student_att,
                    "coverage": coverage,
                })

            curr_date += timedelta(days=1)

        return occurrences

    @classmethod
    def get_occurrences_for_date(
        cls,
        department: Department,
        target_date: date,
        teacher_filter_id: Optional[int] = None,
        student_filter_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        return cls.get_occurrences_for_date_range(
            department=department,
            start_date=target_date,
            end_date=target_date,
            teacher_filter_id=teacher_filter_id,
            student_filter_id=student_filter_id,
        )


class TuitionAttendanceAdapter:
    """Reconciles Tuition Department schedules, enrollments, and tuition attendance."""

    @classmethod
    def get_occurrences_for_date_range(
        cls,
        department: Department,
        start_date: date,
        end_date: date,
        teacher_filter_id: Optional[int] = None,
        student_filter_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        schedules_qs = TuitionSchedule.objects.filter(
            department=department,
            is_active=True,
        ).select_related("student", "teacher", "enrollment", "student__user", "teacher__user")

        if teacher_filter_id:
            schedules_qs = schedules_qs.filter(teacher_id=teacher_filter_id)
        if student_filter_id:
            schedules_qs = schedules_qs.filter(student_id=student_filter_id)

        schedules = list(schedules_qs)
        if not schedules:
            return []

        # Pre-fetch all TuitionAttendance for the department and date range
        tuition_atts = list(
            TuitionAttendance.objects.filter(
                department=department,
                date__gte=start_date,
                date__lte=end_date,
            ).order_by("-updated_at", "-id")
        )

        teacher_att_map = {}
        student_att_map = {}
        for att in tuition_atts:
            if att.entity_type == TuitionAttendance.EntityType.TEACHER:
                key = (att.teacher_id, att.date, att.schedule_id)
                if key not in teacher_att_map:
                    teacher_att_map[key] = att
            elif att.entity_type == TuitionAttendance.EntityType.STUDENT:
                key = (att.student_id, att.date, att.schedule_id)
                if key not in student_att_map:
                    student_att_map[key] = att

        from collections import defaultdict
        schedules_by_weekday = defaultdict(list)
        for s in schedules:
            w = (s.weekday or "").strip().lower()
            schedules_by_weekday[w].append(s)

        occurrences: List[Dict[str, Any]] = []
        curr_date = start_date

        while curr_date <= end_date:
            weekday_name = curr_date.strftime("%A").lower()
            day_scheds = schedules_by_weekday.get(weekday_name, [])

            for sched in day_scheds:
                enrollment = sched.enrollment
                if not enrollment or not enrollment.is_active:
                    continue

                # Check enrollment active dates
                if enrollment.start_date and enrollment.start_date > curr_date:
                    continue
                if enrollment.end_date and enrollment.end_date < curr_date:
                    continue

                student = sched.student
                teacher = sched.teacher
                occurrence_key = f"tuition:sched_{sched.id}:{curr_date.isoformat()}"

                teacher_att = teacher_att_map.get((teacher.id, curr_date, sched.id))
                student_att = student_att_map.get((student.id, curr_date, sched.id))

                occurrences.append({
                    "source_department_type": SalaryAttendanceVerification.DepartmentType.TUITION,
                    "department": department,
                    "institution": department.institution,
                    "teacher": teacher,
                    "student": student,
                    "occurrence_key": occurrence_key,
                    "class_date": curr_date,
                    "scheduled_time": sched.start_time,
                    "source_schedule_id": sched.id,
                    "source_attendance_id": (student_att.id if student_att else (teacher_att.id if teacher_att else None)),
                    "teacher_attendance": teacher_att,
                    "student_attendance": student_att,
                    "coverage": None,
                })

            curr_date += timedelta(days=1)

        return occurrences

    @classmethod
    def get_occurrences_for_date(
        cls,
        department: Department,
        target_date: date,
        teacher_filter_id: Optional[int] = None,
        student_filter_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        return cls.get_occurrences_for_date_range(
            department=department,
            start_date=target_date,
            end_date=target_date,
            teacher_filter_id=teacher_filter_id,
            student_filter_id=student_filter_id,
        )


class AttendanceDetector:
    """Evaluates scheduled occurrences against raw attendance evidence and determines verification status."""

    @classmethod
    def evaluate_occurrence(
        cls,
        occ: Dict[str, Any],
        now_dt: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        if now_dt is None:
            now_dt = get_current_local_datetime()

        today = now_dt.date()
        class_date = occ["class_date"]
        sched_time = occ.get("scheduled_time")

        # Future class boundary check:
        # A class occurring in the future is NOT overdue/pending
        is_future = False
        if class_date > today:
            is_future = True
        elif class_date == today and sched_time:
            # If scheduled time is after current local time, it is in the future
            if sched_time > now_dt.time():
                is_future = True

        teacher_att = occ.get("teacher_attendance")
        student_att = occ.get("student_attendance")
        coverage = occ.get("coverage")

        t_status = getattr(teacher_att, "status", None) or "missing"
        s_status = getattr(student_att, "status", None) or "missing"

        substitute_teacher = None
        is_cancelled = False
        cancellation_reason = ""
        flag_reason = ""

        # Coverage evaluation (Quran)
        if coverage is not None:
            if coverage.coverage_status == QuranClassCoverage.CoverageStatus.CANCELLED:
                is_cancelled = True
                cancellation_reason = coverage.reason or "Class cancelled officially."
                return {
                    "verification_status": SalaryAttendanceVerification.VerificationStatus.VERIFIED,
                    "resolution_type": SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION,
                    "teacher_available_determination": False,
                    "student_attendance_determination": s_status if s_status != "missing" else "",
                    "substitute_teacher": None,
                    "is_cancelled": True,
                    "cancellation_reason": cancellation_reason,
                    "flag_reason": "",
                    "is_future": is_future,
                    "original_teacher_attendance_status": t_status,
                    "original_student_attendance_status": s_status,
                }

            if coverage.coverage_status == QuranClassCoverage.CoverageStatus.ASSIGNED and coverage.substitute_teacher_id:
                substitute_teacher = coverage.substitute_teacher
                return {
                    "verification_status": SalaryAttendanceVerification.VerificationStatus.VERIFIED,
                    "resolution_type": SalaryAttendanceVerification.ResolutionType.SUBSTITUTE_CLASS,
                    "teacher_available_determination": False,
                    "student_attendance_determination": s_status if s_status != "missing" else "present",
                    "substitute_teacher": substitute_teacher,
                    "is_cancelled": False,
                    "cancellation_reason": "",
                    "flag_reason": "",
                    "is_future": is_future,
                    "original_teacher_attendance_status": t_status,
                    "original_student_attendance_status": s_status,
                }

            if coverage.coverage_status == QuranClassCoverage.CoverageStatus.UNRESOLVED:
                # Conflicting / unresolved replacement required
                return {
                    "verification_status": SalaryAttendanceVerification.VerificationStatus.CONFLICTED,
                    "resolution_type": "",
                    "teacher_available_determination": False,
                    "student_attendance_determination": s_status if s_status != "missing" else "",
                    "substitute_teacher": None,
                    "is_cancelled": False,
                    "cancellation_reason": "",
                    "flag_reason": "Teacher absence has unresolved substitute coverage.",
                    "is_future": is_future,
                    "original_teacher_attendance_status": t_status,
                    "original_student_attendance_status": s_status,
                }

        # Source attendance evaluation
        if t_status == "present":
            # Teacher taught/available
            if s_status == "present":
                return {
                    "verification_status": SalaryAttendanceVerification.VerificationStatus.VERIFIED,
                    "resolution_type": SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
                    "teacher_available_determination": True,
                    "student_attendance_determination": "present",
                    "substitute_teacher": None,
                    "is_cancelled": False,
                    "cancellation_reason": "",
                    "flag_reason": "",
                    "is_future": is_future,
                    "original_teacher_attendance_status": t_status,
                    "original_student_attendance_status": s_status,
                }
            elif s_status == "absent":
                # Student absent, teacher available
                return {
                    "verification_status": SalaryAttendanceVerification.VerificationStatus.VERIFIED,
                    "resolution_type": SalaryAttendanceVerification.ResolutionType.STUDENT_ABSENT_TEACHER_AVAILABLE,
                    "teacher_available_determination": True,
                    "student_attendance_determination": "absent",
                    "substitute_teacher": None,
                    "is_cancelled": False,
                    "cancellation_reason": "",
                    "flag_reason": "",
                    "is_future": is_future,
                    "original_teacher_attendance_status": t_status,
                    "original_student_attendance_status": s_status,
                }
            elif s_status == "leave":
                # Informed student leave, teacher available
                return {
                    "verification_status": SalaryAttendanceVerification.VerificationStatus.VERIFIED,
                    "resolution_type": SalaryAttendanceVerification.ResolutionType.INFORMED_STUDENT_LEAVE,
                    "teacher_available_determination": True,
                    "student_attendance_determination": "leave",
                    "substitute_teacher": None,
                    "is_cancelled": False,
                    "cancellation_reason": "",
                    "flag_reason": "",
                    "is_future": is_future,
                    "original_teacher_attendance_status": t_status,
                    "original_student_attendance_status": s_status,
                }
            else:
                # Student attendance missing while teacher present
                if is_future:
                    flag_reason = "Scheduled class has not occurred yet."
                    v_status = SalaryAttendanceVerification.VerificationStatus.PENDING
                else:
                    flag_reason = "Teacher attended but student attendance is unrecorded."
                    v_status = SalaryAttendanceVerification.VerificationStatus.PENDING

                return {
                    "verification_status": v_status,
                    "resolution_type": "",
                    "teacher_available_determination": True,
                    "student_attendance_determination": "",
                    "substitute_teacher": None,
                    "is_cancelled": False,
                    "cancellation_reason": "",
                    "flag_reason": flag_reason,
                    "is_future": is_future,
                    "original_teacher_attendance_status": t_status,
                    "original_student_attendance_status": s_status,
                }

        elif t_status in ("absent", "leave"):
            # Teacher missed class without substitute
            return {
                "verification_status": SalaryAttendanceVerification.VerificationStatus.VERIFIED,
                "resolution_type": SalaryAttendanceVerification.ResolutionType.TEACHER_ABSENT,
                "teacher_available_determination": False,
                "student_attendance_determination": s_status if s_status != "missing" else "",
                "substitute_teacher": None,
                "is_cancelled": False,
                "cancellation_reason": "",
                "flag_reason": "",
                "is_future": is_future,
                "original_teacher_attendance_status": t_status,
                "original_student_attendance_status": s_status,
            }

        else:
            # Teacher attendance is missing
            if is_future:
                flag_reason = "Future scheduled class (not overdue)."
                v_status = SalaryAttendanceVerification.VerificationStatus.PENDING
            else:
                if s_status == "missing":
                    flag_reason = "Past scheduled class is completely unmarked (neither teacher nor student attendance recorded)."
                else:
                    flag_reason = f"Past scheduled class has no teacher session attendance recorded (student status: {s_status})."
                v_status = SalaryAttendanceVerification.VerificationStatus.PENDING

            return {
                "verification_status": v_status,
                "resolution_type": "",
                "teacher_available_determination": None,
                "student_attendance_determination": s_status if s_status != "missing" else "",
                "substitute_teacher": None,
                "is_cancelled": False,
                "cancellation_reason": "",
                "flag_reason": flag_reason,
                "is_future": is_future,
                "original_teacher_attendance_status": t_status,
                "original_student_attendance_status": s_status,
            }


class AttendanceReconcilerService:
    """Orchestrates source discovery, unmarked class detection, and idempotent database synchronization."""

    @classmethod
    def get_adapter_for_department(cls, department: Department):
        dept_type = str(getattr(department, "department_type", "") or "").lower()
        if dept_type == "tuition":
            return TuitionAttendanceAdapter
        return QuranAttendanceAdapter

    @classmethod
    def preview_reconciliation(
        cls,
        department: Department,
        start_date: date,
        end_date: date,
        teacher_id: Optional[int] = None,
        student_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Pure read-only scan of scheduled occurrences without writing or modifying database records.
        """
        adapter = cls.get_adapter_for_department(department)
        now_dt = get_current_local_datetime()

        raw_occurrences = adapter.get_occurrences_for_date_range(
            department=department,
            start_date=start_date,
            end_date=end_date,
            teacher_filter_id=teacher_id,
            student_filter_id=student_id,
        )

        total_count = len(raw_occurrences)
        verified_count = 0
        pending_count = 0
        conflicted_count = 0
        future_count = 0

        evaluated_list = []

        for occ in raw_occurrences:
            eval_res = AttendanceDetector.evaluate_occurrence(occ, now_dt=now_dt)
            v_status = eval_res["verification_status"]

            if eval_res["is_future"]:
                future_count += 1
            elif v_status == SalaryAttendanceVerification.VerificationStatus.VERIFIED:
                verified_count += 1
            elif v_status == SalaryAttendanceVerification.VerificationStatus.CONFLICTED:
                conflicted_count += 1
            else:
                pending_count += 1

            evaluated_list.append({
                "occurrence_key": occ["occurrence_key"],
                "class_date": occ["class_date"].isoformat(),
                "scheduled_time": occ["scheduled_time"].strftime("%H:%M:%S") if occ["scheduled_time"] else None,
                "teacher_id": occ["teacher"].id,
                "teacher_name": getattr(occ["teacher"], "historical_name", "") or str(occ["teacher"]),
                "student_id": occ["student"].id,
                "student_name": getattr(occ["student"].user, "get_full_name", lambda: "")() or str(occ["student"]),
                "verification_status": v_status,
                "resolution_type": eval_res["resolution_type"],
                "flag_reason": eval_res["flag_reason"],
                "original_teacher_status": eval_res["original_teacher_attendance_status"],
                "original_student_status": eval_res["original_student_attendance_status"],
                "is_future": eval_res["is_future"],
            })

        return {
            "department_id": department.id,
            "department_name": department.name,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "total_occurrences": total_count,
            "verified_count": verified_count,
            "pending_count": pending_count,
            "conflicted_count": conflicted_count,
            "future_count": future_count,
            "occurrences": evaluated_list,
        }

    @classmethod
    @transaction.atomic
    def reconcile_period(
        cls,
        department: Department,
        year: int,
        month: int,
        user=None,
    ) -> SalaryReconciliationBatch:
        """
        Idempotent reconciliation scan for department and payroll month.
        Creates or updates SalaryAttendanceVerification records:
        - NEVER resets or overwrites existing administrator resolutions ('resolved').
        - Updates pending/verified records predictably with fresh source attendance.
        - Preserves append-only audit trail.
        """
        start_date, end_date = get_month_date_range(year, month)
        adapter = cls.get_adapter_for_department(department)
        now_dt = get_current_local_datetime()

        raw_occurrences = adapter.get_occurrences_for_date_range(
            department=department,
            start_date=start_date,
            end_date=end_date,
        )

        total_count = len(raw_occurrences)
        verified_count = 0
        pending_count = 0
        resolved_count = 0
        conflicted_count = 0

        # Pre-fetch existing verifications for the period with select_for_update
        existing_verifs = {
            v.occurrence_key: v
            for v in SalaryAttendanceVerification.objects.select_for_update().filter(
                department=department,
                class_date__gte=start_date,
                class_date__lte=end_date,
            )
        }

        verifs_to_create = []
        verifs_to_update = []
        audits_to_create = []

        for occ in raw_occurrences:
            eval_res = AttendanceDetector.evaluate_occurrence(occ, now_dt=now_dt)
            occurrence_key = occ["occurrence_key"]
            existing = existing_verifs.get(occurrence_key)

            # Build serializable snapshot for JSONField
            evidence_snapshot = dict(eval_res)
            if evidence_snapshot.get("substitute_teacher") is not None:
                evidence_snapshot["substitute_teacher"] = getattr(
                    evidence_snapshot["substitute_teacher"], "id", evidence_snapshot["substitute_teacher"]
                )

            if existing:
                # Rule: Administrator resolutions are immutable by automated reconciliation
                if existing.verification_status == SalaryAttendanceVerification.VerificationStatus.RESOLVED:
                    resolved_count += 1
                    continue

                prev_status = existing.verification_status
                new_status = eval_res["verification_status"]

                sub_teacher_id = (
                    eval_res["substitute_teacher"].id
                    if hasattr(eval_res["substitute_teacher"], "id")
                    else eval_res["substitute_teacher"]
                )

                fields_changed = (
                    existing.class_date != occ["class_date"]
                    or existing.scheduled_time != occ["scheduled_time"]
                    or existing.source_schedule_id != occ.get("source_schedule_id")
                    or existing.source_attendance_id != occ.get("source_attendance_id")
                    or existing.original_teacher_attendance_status != eval_res["original_teacher_attendance_status"]
                    or existing.original_student_attendance_status != eval_res["original_student_attendance_status"]
                    or existing.substitute_teacher_id != sub_teacher_id
                    or existing.is_cancelled != eval_res["is_cancelled"]
                    or existing.cancellation_reason != eval_res["cancellation_reason"]
                    or existing.flag_reason != eval_res["flag_reason"]
                    or existing.verification_status != new_status
                    or existing.resolution_type != eval_res["resolution_type"]
                    or existing.teacher_available_determination != eval_res["teacher_available_determination"]
                    or existing.student_attendance_determination != eval_res["student_attendance_determination"]
                )

                if fields_changed:
                    existing.class_date = occ["class_date"]
                    existing.scheduled_time = occ["scheduled_time"]
                    existing.source_schedule_id = occ.get("source_schedule_id")
                    existing.source_attendance_id = occ.get("source_attendance_id")
                    existing.original_teacher_attendance_status = eval_res["original_teacher_attendance_status"]
                    existing.original_student_attendance_status = eval_res["original_student_attendance_status"]
                    existing.substitute_teacher = eval_res["substitute_teacher"]
                    existing.is_cancelled = eval_res["is_cancelled"]
                    existing.cancellation_reason = eval_res["cancellation_reason"]
                    existing.flag_reason = eval_res["flag_reason"]
                    existing.resolution_type = eval_res["resolution_type"]
                    existing.teacher_available_determination = eval_res["teacher_available_determination"]
                    existing.student_attendance_determination = eval_res["student_attendance_determination"]
                    existing.source_evidence_snapshot = evidence_snapshot

                    # If status changed due to updated source attendance
                    if prev_status != new_status:
                        existing.verification_status = new_status

                        audits_to_create.append(
                            SalaryAttendanceAudit(
                                verification=existing,
                                previous_status=prev_status,
                                new_status=new_status,
                                previous_resolution="",
                                new_resolution=eval_res["resolution_type"],
                                action="reconciled_source_update",
                                actor=user,
                                reason="Updated verification status from refreshed source attendance records.",
                                source_evidence_snapshot=evidence_snapshot,
                            )
                        )

                    verifs_to_update.append(existing)

                current_status = existing.verification_status
                if current_status == SalaryAttendanceVerification.VerificationStatus.VERIFIED:
                    verified_count += 1
                elif current_status == SalaryAttendanceVerification.VerificationStatus.CONFLICTED:
                    conflicted_count += 1
                else:
                    pending_count += 1

            else:
                # Create new verification entry
                v_status = eval_res["verification_status"]
                new_verif = SalaryAttendanceVerification(
                    institution=department.institution,
                    department=department,
                    source_department_type=occ["source_department_type"],
                    teacher=occ["teacher"],
                    student=occ["student"],
                    occurrence_key=occurrence_key,
                    class_date=occ["class_date"],
                    scheduled_time=occ["scheduled_time"],
                    source_schedule_id=occ.get("source_schedule_id"),
                    source_attendance_id=occ.get("source_attendance_id"),
                    original_teacher_attendance_status=eval_res["original_teacher_attendance_status"],
                    original_student_attendance_status=eval_res["original_student_attendance_status"],
                    substitute_teacher=eval_res["substitute_teacher"],
                    is_cancelled=eval_res["is_cancelled"],
                    cancellation_reason=eval_res["cancellation_reason"],
                    verification_status=v_status,
                    resolution_type=eval_res["resolution_type"],
                    teacher_available_determination=eval_res["teacher_available_determination"],
                    student_attendance_determination=eval_res["student_attendance_determination"],
                    flag_reason=eval_res["flag_reason"],
                    source_evidence_snapshot=evidence_snapshot,
                )
                verifs_to_create.append(new_verif)

                if v_status == SalaryAttendanceVerification.VerificationStatus.VERIFIED:
                    verified_count += 1
                elif v_status == SalaryAttendanceVerification.VerificationStatus.CONFLICTED:
                    conflicted_count += 1
                else:
                    pending_count += 1

        # Execute bulk operations
        if verifs_to_create:
            created_instances = SalaryAttendanceVerification.objects.bulk_create(
                verifs_to_create, batch_size=2000
            )
            for v in created_instances:
                audits_to_create.append(
                    SalaryAttendanceAudit(
                        verification=v,
                        previous_status="none",
                        new_status=v.verification_status,
                        previous_resolution="",
                        new_resolution=v.resolution_type,
                        action="initial_reconciliation",
                        actor=user,
                        reason="Initial reconciliation scan of scheduled occurrence against source attendance.",
                        source_evidence_snapshot=v.source_evidence_snapshot,
                    )
                )

        if verifs_to_update:
            SalaryAttendanceVerification.objects.bulk_update(
                verifs_to_update,
                fields=[
                    "class_date",
                    "scheduled_time",
                    "source_schedule_id",
                    "source_attendance_id",
                    "original_teacher_attendance_status",
                    "original_student_attendance_status",
                    "substitute_teacher",
                    "is_cancelled",
                    "cancellation_reason",
                    "flag_reason",
                    "verification_status",
                    "resolution_type",
                    "teacher_available_determination",
                    "student_attendance_determination",
                    "source_evidence_snapshot",
                ],
                batch_size=2000,
            )

        if audits_to_create:
            SalaryAttendanceAudit.objects.bulk_create(audits_to_create, batch_size=2000)

        # Record or update batch scan record
        batch, _ = SalaryReconciliationBatch.objects.update_or_create(
            department=department,
            period_year=year,
            period_month=month,
            defaults={
                "institution": department.institution,
                "start_date": start_date,
                "end_date": end_date,
                "is_complete": True,
                "total_occurrences": total_count,
                "verified_count": verified_count,
                "pending_count": pending_count,
                "resolved_count": resolved_count,
                "conflicted_count": conflicted_count,
                "scanned_by": user,
            },
        )

        return batch
