from .student_drop_service import (
    StudentDropDetectionError,
    reconcile_student_drop_from_attendance,
)
# IVS_ATTENDANCE_TIME_CLASS_BASED_V24
from collections import Counter
from datetime import datetime, date, time, timedelta
from io import StringIO
from pathlib import Path
import os
import tempfile
import requests
import logging
logger = logging.getLogger(__name__)
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import transaction
from django.db.models import Q, Prefetch
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.platform_runtime import get_gemini_credentials
from accounts.models import Department, UserDepartmentRole

from .models import (
    TeacherProfile,
    StudentProfile,
    StudentSubject,
    ClassSchedule,
    Attendance,
    Lesson,
    DailyLessonReport,
    DailyLessonSubjectEntry,
    MonthlyLessonPlan,
    MonthlyLessonSummary,
    LessonAccessPermission,
    LessonAccessRequest,
)

from .attendance_import import (
    AttendanceCsvFormatError,
    normalize_name as normalize_attendance_import_name,
    parse_monthly_attendance_csv,
    strip_leading_teacher_number,
)
from .attendance_report_import import (
    AttendanceReportFormatError,
    detect_attendance_csv_format,
    import_attendance_report_csv,
    parse_attendance_report_csv,
)
from .attendance_v2_api import reconcile_student_coverage
from .payroll_source_locks import (
    PayrollSourceLockedError,
    student_attendance_payroll_lock_payload,
)
from .schedule_history_service import sync_student_schedule_history
from .ws_notify import (
    notify_lesson_saved,
    notify_permission_granted,
    notify_permission_disabled,
    notify_request_reviewed,
    notify_request_created,
    notify_attendance_marked,
)



DEPARTMENT_MANAGER_ROLES = {"coordinator", "department_admin", "institution_admin"}


def is_department_manager(user):
    role = str(getattr(user, "role", "") or "").lower()
    return bool(
        user
        and user.is_authenticated
        and (
            getattr(user, "is_superuser", False)
            or role in DEPARTMENT_MANAGER_ROLES
        )
    )


def is_teacher_role(user):
    return str(getattr(user, "role", "") or "").lower() == "teacher"


def is_student_role(user):
    return str(getattr(user, "role", "") or "").lower() == "student"


def quran_department_for_user(user):
    """Resolve the active Quran department for every academy request.

    This is intentionally department-ID aware rather than assuming the legacy
    Quran department. It lets multiple Quran departments share the same academy
    engine while keeping every queryset isolated.
    """
    if not user or not getattr(user, "is_authenticated", False):
        return None

    direct = getattr(user, "department", None)
    if (
        direct
        and getattr(direct, "is_active", True)
        and str(getattr(direct, "department_type", "") or "").lower() == "quran"
    ):
        return direct

    for profile_name in ("teacher_profile", "student_profile"):
        try:
            profile = getattr(user, profile_name)
        except Exception:
            profile = None
        department = getattr(profile, "department", None) if profile else None
        if (
            department
            and getattr(department, "is_active", True)
            and str(getattr(department, "department_type", "") or "").lower() == "quran"
        ):
            return department

    role_link = (
        UserDepartmentRole.objects.select_related("department")
        .filter(
            user=user,
            is_active=True,
            department__is_active=True,
            department__department_type=Department.DepartmentType.QURAN,
        )
        .order_by("id")
        .first()
    )
    return role_link.department if role_link else None


def quran_scope(queryset, user):
    department = quran_department_for_user(user)
    if not department:
        return queryset.none()
    return queryset.filter(department=department)


def object_belongs_to_quran_department(obj, user):
    department = quran_department_for_user(user)
    return bool(department and getattr(obj, "department_id", None) == department.id)


# ============================================================
# Small payload helpers
# ============================================================

def user_display_name(user):
    if not user:
        return ""

    full_name = user.get_full_name().strip()
    if full_name:
        return full_name

    return user.username


def user_payload(user):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "full_name": user_display_name(user),
        "first_name": user.first_name,
        "last_name": user.last_name,
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
        "password_change_allowed": False,  # nosec B105
        "password_change_message": (
            "To change your password, contact the developer on WhatsApp: wa.me/923189995518"
            if is_department_manager(user)
            else ""
        ),
    }


def teacher_payload(teacher):
    return {
        "id": teacher.id,
        "user_id": teacher.user_id,
        "username": teacher.user.username,
        "name": teacher.user.get_full_name() or teacher.user.username,
        "father_name": teacher.father_name,
        "phone": teacher.phone,
        "address": teacher.address,
        "joining_date": str(teacher.joining_date) if teacher.joining_date else None,
        "notes": teacher.notes,
        "zoom_link": teacher.zoom_link,
    }


def student_subject_payload(item):
    return {
        "id": item.id,
        "subject": item.subject,
        "custom_subject_name": item.custom_subject_name,
        "display_name": item.display_name,
        "is_active": item.is_active,
        "notes": item.notes,
    }


# ---------------------------------------------------------------------------
# FIX: Two variants of assigned-subjects resolution
#
# 1. assigned_subjects_from_prefetch(student)
#    Reads from `student.prefetched_active_subjects` when present (set by the
#    Prefetch(..., to_attr="prefetched_active_subjects") calls in each view).
#    Falls back to a live DB query only when the attribute is absent, so code
#    that hasn't been updated yet still works correctly.
#
# 2. assigned_subjects_for_student(student)  [kept for backwards compatibility]
#    Always does a fresh DB query – used by paths that load a single student
#    without bulk prefetching (e.g. detail endpoints).
# ---------------------------------------------------------------------------

def assigned_subjects_from_prefetch(student):
    """
    Return subject payloads using prefetched data when available.

    The Prefetch queryset already filters is_active=True and orders by
    (subject, custom_subject_name, id), so we just serialise whatever
    Django put into student.prefetched_active_subjects.

    If the attribute is missing (student was loaded without the Prefetch)
    we fall back to a live DB query so no call site breaks.
    """
    prefetched = getattr(student, "prefetched_active_subjects", None)

    if prefetched is not None:
        # prefetched is a plain Python list – iterate directly, no extra query
        return [student_subject_payload(item) for item in prefetched]

    # Fallback: student was not loaded with the active-subjects Prefetch
    return assigned_subjects_for_student(student)


def assigned_subjects_for_student(student):
    """
    Always hits the DB.  Use this only for single-student detail paths.
    For list/dashboard paths use assigned_subjects_from_prefetch() instead.
    """
    subjects = StudentSubject.objects.filter(
        student=student,
        is_active=True,
    ).order_by("subject", "custom_subject_name", "id")
    return [student_subject_payload(item) for item in subjects]


# ---------------------------------------------------------------------------
# FIX: student_payload now uses prefetched subjects (no extra DB hit per student)
# ---------------------------------------------------------------------------

def student_payload(student):
    # Get earliest schedule date as enrollment proxy
    first_schedule = ClassSchedule.objects.filter(
        student=student,
    ).order_by("id").first()

    enrollment_date = None
    if first_schedule:
        # Use the teacher's joining date or a fixed school start date
        # We use the student user's date_joined as enrollment date
        enrollment_date = student.user.date_joined.date().isoformat()

    return {
        "id": student.id,
        "user_id": student.user_id,
        "username": student.user.username,
        "name": student.user.get_full_name() or student.user.username,
        "phone": student.phone,
        "notes": student.notes,
        "teacher_id": student.teacher_id,
        "teacher_name": str(student.teacher),
        "enrollment_date": enrollment_date,
        "assigned_subjects": assigned_subjects_from_prefetch(student),
    }


def schedule_payload(schedule):
    student = schedule.student
    subjects = StudentSubject.objects.filter(
        student=student,
        is_active=True,
    ).order_by("subject", "custom_subject_name", "id")
    student_data = {
        "id": student.id,
        "user_id": student.user_id,
        "username": student.user.username,
        "name": student.user.get_full_name() or student.user.username,
        "phone": student.phone,
        "notes": student.notes,
        "teacher_id": student.teacher_id,
        "teacher_name": str(student.teacher),
        "assigned_subjects": [student_subject_payload(item) for item in subjects],
    }
    return {
        "id": schedule.id,
        "student": student_data,
        "teacher": teacher_payload(schedule.teacher),
        "weekday": schedule.weekday,
        "time_slot": str(schedule.time_slot),
        "duration_minutes": schedule.duration_minutes,
        "is_active": schedule.is_active,
    }


def attendance_payload(attendance):
    marked_by = attendance.marked_by

    return {
        "id": attendance.id,
        "entity_type": attendance.entity_type,
        "teacher_id": attendance.teacher_id,
        "teacher_name": str(attendance.teacher) if attendance.teacher else None,
        "student_id": attendance.student_id,
        "student_name": str(attendance.student) if attendance.student else None,
        "date": str(attendance.date),
        "classKey": attendance.class_key or "",
        "class_key": attendance.class_key or "",
        "status": attendance.status,
        "marked_by": marked_by.username,
        "marked_by_id": marked_by.id,
        "marked_by_username": marked_by.username,
        "marked_by_name": user_display_name(marked_by),
        "marked_by_role": marked_by.role,
        "created_at": attendance.created_at.isoformat() if attendance.created_at else None,
        "updated_at": attendance.updated_at.isoformat() if attendance.updated_at else None,
    }


def lesson_payload(lesson):
    return {
        "id": lesson.id,
        "student_id": lesson.student_id,
        "student_name": str(lesson.student),
        "teacher_id": lesson.teacher_id,
        "teacher_name": str(lesson.teacher),
        "date": str(lesson.date),
        "subject": lesson.subject,
        "topic_summary": lesson.topic_summary,
        "progress_status": lesson.progress_status,
        "remarks": lesson.remarks,
        "lesson_data": lesson.lesson_data or {},
        "title": lesson.title,
        "notes": lesson.notes,
        "created_by": lesson.created_by.username,
        "created_by_id": lesson.created_by.id,
        "created_by_username": lesson.created_by.username,
        "created_by_name": user_display_name(lesson.created_by),
        "created_by_role": lesson.created_by.role,
        "created_at": lesson.created_at.isoformat(),
        "updated_at": lesson.updated_at.isoformat(),
    }


def daily_lesson_subject_entry_payload(entry):
    return {
        "id": entry.id,
        "subject": entry.subject,
        "topic_summary": entry.topic_summary,
        "progress_status": entry.progress_status,
        "remarks": entry.remarks,
        "lesson_data": entry.lesson_data or {},
        "sort_order": entry.sort_order,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }


def daily_lesson_report_payload(report):
    return {
        "id": report.id,
        "student_id": report.student_id,
        "student_name": str(report.student),
        "teacher_id": report.teacher_id,
        "teacher_name": str(report.teacher),
        "date": str(report.date),
        "notes": report.notes,
        "subject_entries": [
            daily_lesson_subject_entry_payload(entry)
            for entry in report.subject_entries.all()
        ],
        "created_by": report.created_by.username,
        "created_by_id": report.created_by.id,
        "created_by_username": report.created_by.username,
        "created_by_name": user_display_name(report.created_by),
        "created_by_role": report.created_by.role,
        "edit_permission_until": (
            report.edit_permission_until.isoformat()
            if report.edit_permission_until
            else None
        ),
        "edit_permission_note": report.edit_permission_note,
        "created_at": report.created_at.isoformat(),
        "updated_at": report.updated_at.isoformat(),
    }



def monthly_summary_payload(summary):
    if summary is None:
        return None

    creator = summary.created_by

    start_date = (
        str(summary.start_date)
        if summary.start_date
        else ""
    )

    end_date = (
        str(summary.end_date)
        if summary.end_date
        else ""
    )

    return {
        "id": summary.id,
        "student_id": summary.student_id,
        "student_name": str(summary.student),
        "teacher_id": summary.teacher_id,
        "teacher_name": str(summary.teacher),
        "month": summary.month,
        "year": summary.year,
        "start_date": start_date,
        "end_date": end_date,
        "subject": summary.subject,
        "summary_text": summary.summary_text,
        "strengths": summary.strengths,
        "weaknesses": summary.weaknesses,
        "recommendations": summary.recommendations,
        "improvement_areas": summary.weaknesses,
        "parent_message": summary.recommendations,
        "source": summary.source,
        "ai_generated": (
            summary.source
            == MonthlyLessonSummary.SummarySource.AI
        ),
        "generated_from_lessons_count": (
            summary.generated_from_lessons_count
        ),
        "created_by": (
            user_display_name(creator)
            if creator
            else ""
        ),
        "created_by_id": (
            creator.id
            if creator
            else None
        ),
        "created_by_username": (
            creator.username
            if creator
            else ""
        ),
        "created_by_name": (
            user_display_name(creator)
            if creator
            else ""
        ),
        "created_by_role": (
            creator.role
            if creator
            else ""
        ),
        "created_at": (
            summary.created_at.isoformat()
            if summary.created_at
            else None
        ),
        "updated_at": (
            summary.updated_at.isoformat()
            if summary.updated_at
            else None
        ),
    }

def monthly_plan_payload(plan):
    creator = plan.created_by

    return {
        "id": plan.id,
        "student_id": plan.student_id,
        "student_name": str(plan.student),
        "teacher_id": plan.teacher_id,
        "teacher_name": str(plan.teacher),
        "month": plan.month,
        "year": plan.year,
        "subject": plan.subject,
        "plan_data": plan.plan_data or {},
        "plan_text": plan.plan_text,
        "target_summary": plan.target_summary,
        "notes": plan.notes,
        "status": plan.status,
        "created_by": (
            user_display_name(creator)
            if creator
            else ""
        ),
        "created_by_id": (
            creator.id
            if creator
            else None
        ),
        "created_by_username": (
            creator.username
            if creator
            else ""
        ),
        "created_by_name": (
            user_display_name(creator)
            if creator
            else ""
        ),
        "created_by_role": (
            creator.role
            if creator
            else ""
        ),
        "created_at": (
            plan.created_at.isoformat()
            if plan.created_at
            else None
        ),
        "updated_at": (
            plan.updated_at.isoformat()
            if plan.updated_at
            else None
        ),
    }

def safe_int(value, fallback=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def model_has_field(model_class, field_name):
    return any(field.name == field_name for field in model_class._meta.fields)


def build_month_range(year, month):
    first_day = date(year, month, 1)

    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)

    return first_day, next_month


def build_student_auto_summary(student_item):
    total_lessons = student_item["total_lessons"]

    if total_lessons == 0:
        return "No lessons were recorded for this student this month."

    summary = (
        f"{student_item['student_name']} completed {total_lessons} lesson"
        f"{'' if total_lessons == 1 else 's'} this month."
    )

    subjects = list(student_item["subjects"].keys())

    if subjects:
        summary += f" Subjects covered: {', '.join(subjects)}."

    non_empty = {k: v for k, v in student_item["progress_counts"].items() if v > 0}

    if non_empty:
        best_status = max(non_empty.items(), key=lambda pair: pair[1])[0]
        if best_status != "blank":
            summary += f" Overall progress was mostly {best_status.replace('_', ' ')}."

    if student_item["topics"]:
        topic_preview = student_item["topics"][:5]
        summary += f" Main topics: {', '.join(topic_preview)}."

    return summary


def parse_date_str(value, field_label="date"):
    try:
        return datetime.strptime(str(value), "%Y-%m-%d").date(), None
    except (TypeError, ValueError):
        return None, f"{field_label} must be YYYY-MM-DD."

def parse_frontend_date(value):
    """Convert supported frontend date values to a Python date.

    The state-sync endpoint accepts ISO dates and ISO datetimes. Invalid or
    empty values return None so callers can skip unsafe records.
    """
    if isinstance(value, datetime):
        return value.date()

    if isinstance(value, date):
        return value

    text = str(value or "").strip()
    if not text:
        return None

    normalized = text.replace("Z", "+00:00")

    try:
        return datetime.fromisoformat(normalized).date()
    except ValueError:
        pass

    for date_format in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, date_format).date()
        except ValueError:
            continue

    return None


def parse_frontend_time(value):
    """Convert 24-hour, 12-hour, or ISO-like frontend values to a time."""
    if isinstance(value, datetime):
        return value.time().replace(tzinfo=None)

    if isinstance(value, time):
        return value.replace(tzinfo=None)

    text = str(value or "").strip()
    if not text:
        return None

    # Accept a datetime string as well as plain clock strings.
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).time().replace(tzinfo=None)
    except ValueError:
        pass

    for time_format in ("%H:%M:%S", "%H:%M", "%I:%M %p", "%I:%M:%S %p"):
        try:
            return datetime.strptime(text, time_format).time()
        except ValueError:
            continue

    return None


def frontend_weekday_to_django(value):
    """Normalize frontend weekday labels/codes to ClassSchedule values."""
    if isinstance(value, int):
        return {
            0: "sunday",
            1: "monday",
            2: "tuesday",
            3: "wednesday",
            4: "thursday",
            5: "friday",
            6: "saturday",
        }.get(value, "")

    clean = str(value or "").strip().lower()
    aliases = {
        "sun": "sunday",
        "sunday": "sunday",
        "mon": "monday",
        "monday": "monday",
        "tue": "tuesday",
        "tues": "tuesday",
        "tuesday": "tuesday",
        "wed": "wednesday",
        "wednesday": "wednesday",
        "thu": "thursday",
        "thur": "thursday",
        "thurs": "thursday",
        "thursday": "thursday",
        "fri": "friday",
        "friday": "friday",
        "sat": "saturday",
        "saturday": "saturday",
    }
    return aliases.get(clean, "")


def frontend_entity_to_django(value):
    """Normalize frontend attendance entity labels."""
    clean = str(value or "").strip().lower()
    return {
        "teacher": Attendance.EntityType.TEACHER,
        "teachers": Attendance.EntityType.TEACHER,
        "student": Attendance.EntityType.STUDENT,
        "students": Attendance.EntityType.STUDENT,
    }.get(clean, "")


def frontend_status_to_django(value):
    """Normalize frontend attendance status labels."""
    clean = str(value or "").strip().lower()
    return {
        "present": Attendance.Status.PRESENT,
        "absent": Attendance.Status.ABSENT,
        "leave": Attendance.Status.LEAVE,
    }.get(clean, "")


# ============================================================
# Shared Prefetch definitions
# ============================================================

# ---------------------------------------------------------------------------
# FIX: Define the active-subjects prefetch once and reuse it everywhere.
#      The critical detail is to_attr="prefetched_active_subjects" — without
#      this, Django merges the filtered queryset into the default manager
#      cache and student.assigned_subjects.all() would still return ALL
#      subjects (including inactive ones from unrelated querysets).
# ---------------------------------------------------------------------------
def make_active_subjects_prefetch():
    return Prefetch(
        "assigned_subjects",
        queryset=StudentSubject.objects.filter(
            is_active=True,
        ).order_by("subject", "custom_subject_name", "id"),
        to_attr="prefetched_active_subjects",
    )


def make_active_schedules_prefetch():
    return Prefetch(
        "schedules",
        queryset=ClassSchedule.objects.filter(is_active=True).order_by(
            "weekday", "time_slot", "id"
        ),
        to_attr="prefetched_active_schedules",
    )


# ============================================================
# Health
# ============================================================

class AcademyHealthView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "status": "ok",
            "message": "Django backend is running.",
            "role": request.user.role,
        })


# ============================================================
# Lesson Permission Helpers
# ============================================================

def normalize_lesson_access_type(value):
    clean = str(value or "").strip().lower()
    if clean == "write":
        return "add"
    if clean in ["add", "edit"]:
        return clean
    return ""


def lesson_permission_payload(permission):
    return {
        "id": permission.id,
        "student_id": permission.student_id,
        "student_name": str(permission.student),
        "teacher_id": permission.teacher_id,
        "teacher_name": str(permission.teacher),
        "date": str(permission.lesson_date),
        "lesson_date": str(permission.lesson_date),
        "access_type": permission.access_type,
        "subject": getattr(permission, "subject", "") or "",
        "is_active": permission.is_active,
        "reason": permission.reason or "",
        "granted_by_id": permission.granted_by_id,
        "granted_by": permission.granted_by.username if permission.granted_by else "",
        "granted_by_name": user_display_name(permission.granted_by) if permission.granted_by else "",
        "created_at": permission.created_at.isoformat() if permission.created_at else None,
        "updated_at": permission.updated_at.isoformat() if permission.updated_at else None,
        # Compatibility for older frontend code.
        "can_write": permission.access_type == "add" and permission.is_active,
        "can_add": permission.access_type == "add" and permission.is_active,
        "can_edit": permission.access_type == "edit" and permission.is_active,
    }


def get_lesson_class_window(student, teacher, lesson_date):
    schedules = ClassSchedule.objects.filter(
        student=student,
        teacher=teacher,
        is_active=True,
        weekday=lesson_date.strftime("%A").lower(),
    ).order_by("time_slot")

    windows = []

    for schedule in schedules:
        start_naive = datetime.combine(lesson_date, schedule.time_slot)
        start = timezone.make_aware(start_naive, timezone.get_current_timezone())
        end = start + timedelta(hours=24)
        windows.append((start, end))

    return windows


def class_window_is_open(student, teacher, lesson_date):
    now = timezone.now()

    for start, end in get_lesson_class_window(student, teacher, lesson_date):
        if start <= now <= end:
            return True

    return False


def has_active_lesson_permission(student, teacher, lesson_date, access_type):
    return LessonAccessPermission.objects.filter(
        student=student,
        teacher=teacher,
        lesson_date=lesson_date,
        access_type=access_type,
        is_active=True,
    ).exists()


def teacher_can_add_lesson_now(student, teacher, lesson_date):
    return class_window_is_open(student, teacher, lesson_date) or has_active_lesson_permission(
        student,
        teacher,
        lesson_date,
        "add",
    )


def teacher_can_edit_lesson_now(lesson):
    now = timezone.now()

    if lesson.created_at:
        try:
            if now <= lesson.created_at + timedelta(hours=24):
                return True
        except TypeError:
            pass

    return has_active_lesson_permission(
        lesson.student,
        lesson.teacher,
        lesson.date,
        "edit",
    )


# ============================================================
# Dashboard API
# ============================================================

class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        # ---------------------------------------------------------------------------
        # FIX: Use the shared prefetch helpers so every code path gets the same,
        #      correctly-filtered prefetch with the right to_attr name.
        # ---------------------------------------------------------------------------
        active_subjects_prefetch = make_active_subjects_prefetch()
        schedule_prefetch = make_active_schedules_prefetch()

        if is_department_manager(user):
            return Response({
                "user": user_payload(user),
                "dashboard_type": "coordinator",
                "counts": {
                    "teachers": TeacherProfile.objects.filter(department=department).count(),
                    "students": StudentProfile.objects.filter(department=department).count(),
                    "active_schedules": ClassSchedule.objects.filter(department=department, is_active=True).count(),
                    "attendance_records": Attendance.objects.filter(department=department).count(),
                    "lessons": Lesson.objects.filter(department=department).count(),
                    "student_subjects": StudentSubject.objects.filter(department=department, is_active=True).count(),
                    "monthly_lesson_plans": MonthlyLessonPlan.objects.filter(department=department).count(),
                    "lesson_permissions": LessonAccessPermission.objects.filter(department=department, is_active=True).count(),
                },
                "recent_attendance": [
                    attendance_payload(item)
                    for item in Attendance.objects.select_related(
                        "teacher__user",
                        "student__user",
                        "marked_by",
                    ).filter(department=department).order_by("-date", "-updated_at", "-id")[:50]
                ],
                # ---------------------------------------------------------------------------
                # FIX: Coordinator schedule list now prefetches active subjects properly.
                #      Previously used `prefetch_related("student__assigned_subjects")` which
                #      fetched ALL subjects (active and inactive) and never set to_attr, so
                #      student_payload's assigned_subjects_from_prefetch() could not use it.
                # ---------------------------------------------------------------------------
                "schedules": [
                    schedule_payload(item)
                    for item in ClassSchedule.objects.select_related(
                        "teacher__user",
                        "student__user",
                        "student__teacher__user",
                    ).filter(
                        department=department,
                        is_active=True,
                    ).order_by("weekday", "time_slot", "id")[:150]
                ],

                "lessons": [
                    lesson_payload(item)
                    for item in Lesson.objects.select_related(
                        "teacher__user",
                        "student__user",
                        "created_by",
                    ).filter(department=department).order_by("-date", "-updated_at", "-id")[:100]
                ],
                "lesson_access_permissions": [
                    lesson_permission_payload(item)
                    for item in LessonAccessPermission.objects.select_related(
                        "teacher__user",
                        "student__user",
                        "granted_by",
                    ).filter(department=department, is_active=True).order_by("-lesson_date", "-updated_at", "-id")[:200]
                ],
            })

        if is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response({
                    "user": user_payload(user),
                    "dashboard_type": "teacher",
                    "error": "Teacher profile not found.",
                }, status=status.HTTP_404_NOT_FOUND)

            # ---------------------------------------------------------------------------
            # FIX: Both prefetches now use the shared helpers (correct to_attr names).
            #      student_payload → assigned_subjects_from_prefetch reads from
            #      student.prefetched_active_subjects and returns ALL active subjects.
            # ---------------------------------------------------------------------------
            students = StudentProfile.objects.select_related(
                "user",
                "teacher__user",
            ).prefetch_related(
                active_subjects_prefetch,
                schedule_prefetch,
            ).filter(
                department=department,
                teacher=teacher,
            ).order_by("user__first_name", "user__username", "id")

            # ---------------------------------------------------------------------------
            # FIX: Schedule queryset now uses active_subjects_prefetch (with to_attr)
            #      instead of the plain `prefetch_related("student__assigned_subjects")`.
            #      The student objects inside each schedule will then have
            #      prefetched_active_subjects populated, so schedule_payload →
            #      student_payload → assigned_subjects_from_prefetch returns all subjects.
            # ---------------------------------------------------------------------------
            schedules = ClassSchedule.objects.select_related(
                            "teacher__user",
                            "student__user",
                            "student__teacher__user",
                        ).filter(
                            department=department,
                            teacher=teacher,
                            is_active=True,
                        ).order_by("weekday", "time_slot", "student__user__first_name", "id")

            attendance = Attendance.objects.select_related(
                "teacher__user",
                "student__user",
                "marked_by",
            ).filter(department=department).filter(
                Q(entity_type=Attendance.EntityType.STUDENT, student__teacher=teacher)
                | Q(entity_type=Attendance.EntityType.TEACHER, teacher=teacher)
            ).order_by("-date", "-updated_at", "-id")[:300]

            lessons = Lesson.objects.select_related(
                "teacher__user",
                "student__user",
                "created_by",
            ).filter(
                department=department,
                teacher=teacher,
            ).order_by("-date", "-updated_at", "-id")[:100]

            monthly_plans = MonthlyLessonPlan.objects.select_related(
                "teacher__user",
                "student__user",
                "created_by",
            ).filter(
                department=department,
                teacher=teacher,
            ).order_by("-year", "-month", "student__user__first_name", "subject", "-id")[:300]

            lesson_permissions = LessonAccessPermission.objects.select_related(
                "teacher__user",
                "student__user",
                "granted_by",
            ).filter(
                department=department,
                teacher=teacher,
                is_active=True,
            ).order_by("-lesson_date", "-updated_at", "-id")[:200]

            return Response({
                "user": user_payload(user),
                "dashboard_type": "teacher",
                "teacher": teacher_payload(teacher),
                "students": [student_payload(item) for item in students],
                "schedules": [schedule_payload(item) for item in schedules],
                "attendance": [attendance_payload(item) for item in attendance],
                "lessons": [lesson_payload(item) for item in lessons],
                "monthly_lesson_plans": [monthly_plan_payload(item) for item in monthly_plans],
                "lesson_access_permissions": [lesson_permission_payload(item) for item in lesson_permissions],
                "permissions": {
                    "can_mark_attendance": False,
                    "can_edit_attendance": False,
                    "can_view_attendance": True,
                    "can_create_lessons": True,
                    "can_create_monthly_plans": True,
                },
            })

        if is_student_role(user):
            try:
                student = StudentProfile.objects.select_related(
                    "user",
                    "teacher__user",
                ).prefetch_related(
                    active_subjects_prefetch,
                    schedule_prefetch,
                ).get(user=user, department=department)
            except StudentProfile.DoesNotExist:
                return Response({
                    "user": user_payload(user),
                    "dashboard_type": "student",
                    "error": "Student profile not found.",
                }, status=status.HTTP_404_NOT_FOUND)

            schedules = ClassSchedule.objects.select_related(
                "teacher__user",
                "student__user",
            ).filter(
                department=department,
                student=student,
                is_active=True,
            ).order_by("weekday", "time_slot", "id")

            attendance = Attendance.objects.select_related(
                "teacher__user",
                "student__user",
                "marked_by",
            ).filter(
                department=department,
                entity_type=Attendance.EntityType.STUDENT,
                student=student,
            ).order_by("-date", "-updated_at", "-id")[:100]

            daily_reports = DailyLessonReport.objects.select_related(
                "teacher__user",
                "student__user",
                "created_by",
            ).prefetch_related("subject_entries").filter(
                department=department,
                student=student,
            ).order_by("-date", "-updated_at", "-id")[:100]

            monthly_plans = MonthlyLessonPlan.objects.select_related(
                "teacher__user",
                "student__user",
                "created_by",
            ).filter(
                department=department,
                student=student,
            ).order_by("-year", "-month", "subject", "-id")[:200]

            return Response({
                "user": user_payload(user),
                "dashboard_type": "student",
                "student": student_payload(student),
                "schedules": [schedule_payload(item) for item in schedules],
                "attendance": [attendance_payload(item) for item in attendance],
                "lessons": [
                    {
                        "id": entry.id,
                        "student_id": report.student_id,
                        "student_name": str(report.student),
                        "teacher_id": report.teacher_id,
                        "teacher_name": str(report.teacher),
                        "date": str(report.date),
                        "subject": entry.subject,
                        "topic_summary": entry.topic_summary,
                        "title": entry.topic_summary,
                        "notes": report.notes,
                        "progress_status": entry.progress_status,
                        "remarks": entry.remarks,
                        "lesson_data": entry.lesson_data or {},
                        "created_by": report.created_by.username,
                        "created_by_id": report.created_by.id,
                        "created_by_username": report.created_by.username,
                        "created_by_name": report.created_by.get_full_name() or report.created_by.username,
                        "created_by_role": report.created_by.role,
                        "created_at": report.created_at.isoformat(),
                        "updated_at": report.updated_at.isoformat(),
                    }
                    for report in daily_reports
                    for entry in report.subject_entries.all()
                ],
                "monthly_lesson_plans": [monthly_plan_payload(item) for item in monthly_plans],
                "permissions": {
                    "can_mark_attendance": False,
                    "can_edit_attendance": False,
                    "can_view_attendance": True,
                    "can_create_lessons": False,
                    "can_create_monthly_plans": False,
                },
            })

        return Response({
            "user": user_payload(user),
            "error": "Unknown role.",
        }, status=status.HTTP_400_BAD_REQUEST)


# ============================================================
# Lessons API
# ============================================================

class LessonListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        student_id = safe_int(request.query_params.get("student_id"))
        teacher_id = safe_int(request.query_params.get("teacher_id"))
        month = safe_int(request.query_params.get("month"))
        year = safe_int(request.query_params.get("year"))

        lessons = Lesson.objects.filter(department=department).select_related(
            "student__user",
            "teacher__user",
            "created_by",
        )

        if student_id:
            lessons = lessons.filter(student_id=student_id)

        if teacher_id:
            lessons = lessons.filter(teacher_id=teacher_id)

        if month and year:
            first_day, next_month = build_month_range(year, month)
            lessons = lessons.filter(date__gte=first_day, date__lt=next_month)

        if is_department_manager(user):
            pass

        elif is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            lessons = lessons.filter(teacher=teacher)

        elif is_student_role(user):
            try:
                student = user.student_profile
            except StudentProfile.DoesNotExist:
                return Response(
                    {"detail": "Student profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            lessons = lessons.filter(student=student)

        else:
            return Response(
                {"detail": "Invalid role."},
                status=status.HTTP_403_FORBIDDEN,
            )

        lessons = lessons.order_by("-date", "-id")

        return Response({
            "user": user_payload(user),
            "count": lessons.count(),
            "results": [lesson_payload(item) for item in lessons],
        })

    def post(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if user.role not in ["teacher", "coordinator"]:
            return Response(
                {"detail": "Students cannot create lessons."},
                status=status.HTTP_403_FORBIDDEN,
            )

        student_id = request.data.get("student_id")
        subject = str(request.data.get("subject", "")).strip()
        topic_summary = str(request.data.get("topic_summary", "")).strip()
        progress_status = str(request.data.get("progress_status", "")).strip()
        remarks = str(request.data.get("remarks", "")).strip()
        notes = str(request.data.get("notes", "")).strip()
        lesson_data = request.data.get("lesson_data") or {}
        lesson_date = request.data.get("date") or timezone.localdate().isoformat()

        if not student_id:
            return Response({"detail": "student_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not subject:
            return Response({"detail": "subject is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not topic_summary:
            return Response({"detail": "topic_summary is required."}, status=status.HTTP_400_BAD_REQUEST)

        allowed_statuses = ["excellent", "good", "satisfactory", "needs_improvement", ""]

        if progress_status not in allowed_statuses:
            return Response({"detail": "Invalid progress_status."}, status=status.HTTP_400_BAD_REQUEST)

        parsed_lesson_date, date_error = parse_date_str(lesson_date, "lesson date")
        if date_error:
            return Response({"detail": date_error}, status=status.HTTP_400_BAD_REQUEST)

        try:
            student = StudentProfile.objects.filter(department=department).select_related(
                "teacher",
                "teacher__user",
                "user",
            ).get(id=student_id)
        except StudentProfile.DoesNotExist:
            return Response({"detail": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        if is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

            if student.teacher_id != teacher.id:
                return Response(
                    {"detail": "You can only create lessons for your assigned students."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            if not teacher_can_add_lesson_now(student, teacher, parsed_lesson_date):
                return Response(
                    {
                        "detail": (
                            "Lesson add window expired or has not started yet. "
                            "Please ask department admin or coordinator to enable add permission."
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        else:
            teacher_id = request.data.get("teacher_id") or student.teacher_id

            try:
                teacher = TeacherProfile.objects.filter(department=department).get(id=teacher_id)
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher not found."}, status=status.HTTP_404_NOT_FOUND)

        duplicate = Lesson.objects.filter(department=department).filter(
            student=student,
            teacher=teacher,
            date=parsed_lesson_date,
            subject=subject,
        ).first()

        if duplicate:
            return Response(
                {
                    "detail": (
                        "A lesson already exists for this student, date, and subject. "
                        "Please edit the existing lesson instead."
                    ),
                    "lesson": lesson_payload(duplicate),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        lesson = Lesson.objects.create(
            student=student,
            teacher=teacher,
            date=parsed_lesson_date,
            subject=subject,
            topic_summary=topic_summary,
            title=topic_summary[:200],
            notes=notes,
            progress_status=progress_status,
            remarks=remarks,
            lesson_data=lesson_data,
            created_by=user,
        )

        return Response(lesson_payload(lesson), status=status.HTTP_201_CREATED)


class LessonDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        try:
            lesson = Lesson.objects.filter(department=department).select_related(
                "student__user",
                "teacher__user",
                "created_by",
            ).get(id=pk)
        except Lesson.DoesNotExist:
            return Response({"detail": "Lesson not found."}, status=status.HTTP_404_NOT_FOUND)

        if is_department_manager(user):
            pass

        elif is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

            if lesson.teacher_id != teacher.id:
                return Response(
                    {"detail": "You can only edit your own students' lessons."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            if not teacher_can_edit_lesson_now(lesson):
                return Response(
                    {
                        "detail": (
                            "Lesson edit window expired. "
                            "Please ask department admin or coordinator to enable edit permission."
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        else:
            return Response(
                {"detail": "Only department admins and coordinators and teachers can edit lessons."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if "subject" in request.data:
            next_subject = str(request.data.get("subject") or "").strip()
            if next_subject:
                duplicate = Lesson.objects.filter(department=department).filter(
                    student=lesson.student,
                    teacher=lesson.teacher,
                    date=lesson.date,
                    subject=next_subject,
                ).exclude(id=lesson.id).first()

                if duplicate:
                    return Response(
                        {"detail": "Another lesson already exists for this student, date, and subject."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            lesson.subject = next_subject

        if "topic_summary" in request.data:
            lesson.topic_summary = str(request.data.get("topic_summary") or "").strip()
            lesson.title = lesson.topic_summary[:200]

        if "progress_status" in request.data:
            progress_status = str(request.data.get("progress_status") or "").strip()
            allowed_statuses = ["excellent", "good", "satisfactory", "needs_improvement", ""]

            if progress_status not in allowed_statuses:
                return Response({"detail": "Invalid progress_status."}, status=status.HTTP_400_BAD_REQUEST)

            lesson.progress_status = progress_status

        if "remarks" in request.data:
            lesson.remarks = str(request.data.get("remarks") or "").strip()

        if "notes" in request.data:
            lesson.notes = str(request.data.get("notes") or "").strip()

        if "lesson_data" in request.data:
            lesson.lesson_data = request.data.get("lesson_data") or {}

        lesson.save()

        return Response(lesson_payload(lesson))


class LessonAccessPermissionView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if not (is_department_manager(user) or is_teacher_role(user)):
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        permissions = LessonAccessPermission.objects.filter(department=department).select_related(
            "student__user",
            "teacher__user",
            "granted_by",
        )

        student_id = safe_int(request.query_params.get("student_id"))
        teacher_id = safe_int(request.query_params.get("teacher_id"))
        lesson_date = (
            str(request.query_params.get("lesson_date", "")).strip()
            or str(request.query_params.get("date", "")).strip()
        )
        access_type = normalize_lesson_access_type(request.query_params.get("access_type"))
        is_active_value = request.query_params.get("is_active")

        if student_id:
            permissions = permissions.filter(student_id=student_id)

        if teacher_id:
            permissions = permissions.filter(teacher_id=teacher_id)

        if lesson_date:
            permissions = permissions.filter(lesson_date=lesson_date)

        if access_type:
            permissions = permissions.filter(access_type=access_type)

        if is_active_value is not None:
            active_text = str(is_active_value).strip().lower()

            if active_text in ["true", "1", "yes"]:
                permissions = permissions.filter(is_active=True)
            elif active_text in ["false", "0", "no"]:
                permissions = permissions.filter(is_active=False)

        if is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

            permissions = permissions.filter(teacher=teacher)

        total_count = permissions.count()
        permissions = list(permissions.order_by("-lesson_date", "-updated_at", "-id")[:500])

        return Response({
            "count": total_count,
            "results": [lesson_permission_payload(item) for item in permissions],
        })

    def post(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if not is_department_manager(user):
            return Response(
                {"detail": "Only department admins and coordinators can manage lesson permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        student_id = request.data.get("student_id")
        teacher_id = request.data.get("teacher_id")
        lesson_date_value = request.data.get("lesson_date") or request.data.get("date")
        access_type = normalize_lesson_access_type(request.data.get("access_type"))
        subject = str(request.data.get("subject", "") or "").strip()
        reason = str(request.data.get("reason", "") or "").strip()
        is_active = bool(request.data.get("is_active", True))

        if not student_id:
            return Response({"detail": "student_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not teacher_id:
            return Response({"detail": "teacher_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not lesson_date_value:
            return Response({"detail": "lesson_date is required."}, status=status.HTTP_400_BAD_REQUEST)

        if access_type not in ["add", "edit"]:
            return Response(
                {"detail": "access_type must be add or edit."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        lesson_date, date_error = parse_date_str(lesson_date_value, "lesson_date")
        if date_error:
            return Response({"detail": date_error}, status=status.HTTP_400_BAD_REQUEST)

        try:
            student = StudentProfile.objects.filter(department=department).select_related("teacher", "user").get(id=student_id)
        except StudentProfile.DoesNotExist:
            return Response({"detail": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            teacher = TeacherProfile.objects.filter(department=department).select_related("user").get(id=teacher_id)
        except TeacherProfile.DoesNotExist:
            return Response({"detail": "Teacher not found."}, status=status.HTTP_404_NOT_FOUND)

        if student.teacher_id != teacher.id:
            return Response(
                {"detail": "This student is not assigned to the selected teacher."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        LessonAccessPermission.objects.filter(department=department).filter(
            student=student,
            teacher=teacher,
            lesson_date=lesson_date,
            subject=subject,
            access_type=access_type,
            is_active=True,
        ).update(is_active=False)

        permission = LessonAccessPermission.objects.create(
            student=student,
            teacher=teacher,
            lesson_date=lesson_date,
            subject=subject,
            access_type=access_type,
            is_active=is_active,
            reason=reason,
            granted_by=user,
        )

        try:
            notify_permission_granted(permission)
        except Exception as e:
            logger.warning("WebSocket notify failed: %s", e)

        return Response(lesson_permission_payload(permission), status=status.HTTP_201_CREATED)

    def delete(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if not is_department_manager(user):
            return Response(
                {"detail": "Only department admins and coordinators can disable lesson permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        permission_id = request.query_params.get("id")

        if not permission_id:
            return Response({"detail": "Permission id is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            permission = LessonAccessPermission.objects.filter(department=department).get(id=permission_id)
        except LessonAccessPermission.DoesNotExist:
            return Response({"detail": "Permission not found."}, status=status.HTTP_404_NOT_FOUND)

        permission.is_active = False
        permission.save(update_fields=["is_active", "updated_at"])

        try:
            notify_permission_disabled(permission)
        except Exception as e:
            logger.warning("WebSocket notify failed: %s", e)

        return Response({"detail": "Permission disabled successfully."})


def lesson_access_request_payload(item):
    return {
        "id": item.id,
        "student_id": item.student_id,
        "student_name": str(item.student),
        "teacher_id": item.teacher_id,
        "teacher_name": str(item.teacher),
        "date": str(item.lesson_date),
        "lesson_date": str(item.lesson_date),
        "subject": item.subject or "",
        "request_type": item.request_type,
        "status": item.status,
        "reason": item.reason or "",
        "coordinator_note": item.coordinator_note or "",
        "reviewed_by_id": item.reviewed_by_id,
        "reviewed_by_name": user_display_name(item.reviewed_by) if item.reviewed_by else "",
        "permission_id": item.permission_id,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


class LessonAccessRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if not (is_department_manager(user) or is_teacher_role(user)):
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        rows = LessonAccessRequest.objects.filter(department=department).select_related(
            "student__user",
            "teacher__user",
            "reviewed_by",
            "permission",
        )

        status_value = str(request.query_params.get("status", "pending") or "").strip().lower()
        request_type = normalize_lesson_access_type(request.query_params.get("request_type"))
        student_id = safe_int(request.query_params.get("student_id"))
        teacher_id = safe_int(request.query_params.get("teacher_id"))

        if status_value and status_value != "all":
            rows = rows.filter(status=status_value)

        if request_type:
            rows = rows.filter(request_type=request_type)

        if student_id:
            rows = rows.filter(student_id=student_id)

        if teacher_id:
            rows = rows.filter(teacher_id=teacher_id)

        if is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

            rows = rows.filter(teacher=teacher)

        total_count = rows.count()
        rows = list(rows.order_by("-created_at", "-id")[:500])

        return Response({
            "count": total_count,
            "results": [lesson_access_request_payload(item) for item in rows],
        })

    def post(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if user.role != "teacher":
            return Response(
                {"detail": "Only teachers can request lesson permissions."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            teacher = user.teacher_profile
        except TeacherProfile.DoesNotExist:
            return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

        student_id = request.data.get("student_id")
        lesson_date_value = request.data.get("lesson_date") or request.data.get("date")
        request_type = normalize_lesson_access_type(request.data.get("request_type"))
        subject = str(request.data.get("subject", "") or "").strip()
        reason = str(request.data.get("reason", "") or "").strip()

        if not student_id:
            return Response({"detail": "student_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not lesson_date_value:
            return Response({"detail": "lesson_date is required."}, status=status.HTTP_400_BAD_REQUEST)

        if request_type not in ["add", "edit"]:
            return Response({"detail": "request_type must be add or edit."}, status=status.HTTP_400_BAD_REQUEST)

        lesson_date, date_error = parse_date_str(lesson_date_value, "lesson_date")
        if date_error:
            return Response({"detail": date_error}, status=status.HTTP_400_BAD_REQUEST)

        try:
            student = StudentProfile.objects.filter(department=department).select_related("teacher", "user").get(id=student_id)
        except StudentProfile.DoesNotExist:
            return Response({"detail": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        if student.teacher_id != teacher.id:
            return Response(
                {"detail": "You can only request permissions for your assigned students."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if request_type == "edit":
                    if not subject:
                        return Response({"detail": "subject is required for edit requests."}, status=status.HTTP_400_BAD_REQUEST)

                    # Check if a daily report exists for this date (even if this specific subject isn't there yet)
                    # This allows teachers to request permission to add a new subject to an existing report
                    report_exists = DailyLessonReport.objects.filter(department=department).filter(
                        student=student,
                        teacher=teacher,
                        date=lesson_date,
                    ).exists()

                    exists_in_lesson = Lesson.objects.filter(department=department).filter(
                        student=student,
                        teacher=teacher,
                        date=lesson_date,
                        subject=subject,
                    ).exists()

                    exists_in_daily_report = DailyLessonSubjectEntry.objects.filter(department=department).filter(
                        report__student=student,
                        report__teacher=teacher,
                        report__date=lesson_date,
                        subject=subject,
                    ).exists()

                    # Allow if: subject exists in old Lesson model, OR subject exists in daily report,
                    # OR a daily report exists for this date (teacher adding new subject to existing report)
                    if not exists_in_lesson and not exists_in_daily_report and not report_exists:
                        return Response(
                            {"detail": "No lesson report exists for this student and date."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

        if request_type == "add":
            subject = ""

        existing = LessonAccessRequest.objects.filter(department=department).filter(
            teacher=teacher,
            student=student,
            lesson_date=lesson_date,
            subject=subject,
            request_type=request_type,
            status="pending",
        ).first()

        if existing:
            return Response(lesson_access_request_payload(existing), status=status.HTTP_200_OK)

        item = LessonAccessRequest.objects.create(
            teacher=teacher,
            student=student,
            lesson_date=lesson_date,
            subject=subject,
            request_type=request_type,
            status="pending",
            reason=reason,
        )

        try:
            notify_request_created(item)
        except Exception as e:
            logger.warning("WebSocket notify failed: %s", e)

        return Response(lesson_access_request_payload(item), status=status.HTTP_201_CREATED)


class LessonAccessRequestDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if not is_department_manager(user):
            return Response(
                {"detail": "Only department admins and coordinators can delete lesson permission requests."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            item = LessonAccessRequest.objects.filter(department=department).get(id=pk)
        except LessonAccessRequest.DoesNotExist:
            return Response({"detail": "Request not found."}, status=status.HTTP_404_NOT_FOUND)

        if item.status == "pending":
            return Response(
                {"detail": "Pending requests cannot be cleared. Please approve or reject first."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        item.delete()
        return Response({"detail": "Request cleared permanently."}, status=status.HTTP_200_OK)

    def patch(self, request, pk):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if not is_department_manager(user):
            return Response(
                {"detail": "Only department admins and coordinators can review lesson permission requests."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            item = LessonAccessRequest.objects.filter(department=department).select_related(
                "student__user",
                "teacher__user",
                "reviewed_by",
                "permission",
            ).get(id=pk)
        except LessonAccessRequest.DoesNotExist:
            return Response({"detail": "Request not found."}, status=status.HTTP_404_NOT_FOUND)

        action = str(request.data.get("action", "") or "").strip().lower()
        coordinator_note = str(request.data.get("coordinator_note", "") or "").strip()

        if item.status != "pending":
            return Response({"detail": "This request has already been reviewed."}, status=status.HTTP_400_BAD_REQUEST)

        if action not in ["approve", "reject"]:
            return Response({"detail": "action must be approve or reject."}, status=status.HTTP_400_BAD_REQUEST)

        item.coordinator_note = coordinator_note
        item.reviewed_by = user
        item.reviewed_at = timezone.now()

        if action == "reject":
            item.status = "rejected"
            item.save()
            try:
                notify_request_reviewed(item, "reject")
            except Exception as e:
                logger.warning("WebSocket notify failed: %s", e)
            return Response(lesson_access_request_payload(item))

        LessonAccessPermission.objects.filter(department=department).filter(
            teacher=item.teacher,
            student=item.student,
            lesson_date=item.lesson_date,
            subject=item.subject or "",
            access_type=item.request_type,
            is_active=True,
        ).update(is_active=False)

        permission = LessonAccessPermission.objects.create(
            teacher=item.teacher,
            student=item.student,
            lesson_date=item.lesson_date,
            subject=item.subject or "",
            access_type=item.request_type,
            is_active=True,
            reason=item.reason or coordinator_note,
            granted_by=user,
        )

        item.status = "approved"
        item.permission = permission
        item.save()

        try:
            notify_request_reviewed(item, "approve")
        except Exception as e:
            logger.warning("WebSocket notify failed: %s", e)

        return Response(lesson_access_request_payload(item))


class DailyLessonReportListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        student_id = safe_int(request.query_params.get("student_id"))
        teacher_id = safe_int(request.query_params.get("teacher_id"))
        month = safe_int(request.query_params.get("month"))
        year = safe_int(request.query_params.get("year"))

        reports = DailyLessonReport.objects.filter(department=department).select_related(
            "student__user",
            "teacher__user",
            "created_by",
            "edit_permission_granted_by",
        ).prefetch_related("subject_entries")

        if student_id:
            reports = reports.filter(student_id=student_id)

        if teacher_id:
            reports = reports.filter(teacher_id=teacher_id)

        if month and year:
            first_day, next_month = build_month_range(year, month)
            reports = reports.filter(date__gte=first_day, date__lt=next_month)

        if is_department_manager(user):
            pass

        elif is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

            reports = reports.filter(teacher=teacher)

        elif is_student_role(user):
            try:
                student = user.student_profile
            except StudentProfile.DoesNotExist:
                return Response({"detail": "Student profile not found."}, status=status.HTTP_404_NOT_FOUND)

            reports = reports.filter(student=student)

        else:
            return Response({"detail": "Invalid role."}, status=status.HTTP_403_FORBIDDEN)

        reports = reports.order_by("-date", "-updated_at", "-id")
        total_count = reports.count()

        return Response({
            "count": total_count,
            "results": [daily_lesson_report_payload(item) for item in reports],
        })

    def post(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if user.role not in ["teacher", "coordinator"]:
            return Response(
                {"detail": "Students cannot create lesson reports."},
                status=status.HTTP_403_FORBIDDEN,
            )

        student_id = request.data.get("student_id")
        lesson_date = request.data.get("date") or timezone.localdate().isoformat()
        notes = str(request.data.get("notes", "") or "").strip()
        subject_entries = request.data.get("subject_entries") or []

        if not student_id:
            return Response({"detail": "student_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not isinstance(subject_entries, list) or not subject_entries:
            return Response(
                {"detail": "subject_entries must contain at least one subject."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        parsed_lesson_date, date_error = parse_date_str(lesson_date, "date")
        if date_error:
            return Response({"detail": "Invalid date format. Use YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            student = StudentProfile.objects.filter(department=department).select_related(
                "teacher",
                "teacher__user",
                "user",
            ).get(id=student_id)
        except StudentProfile.DoesNotExist:
            return Response({"detail": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        if is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

            if student.teacher_id != teacher.id:
                return Response(
                    {"detail": "You can only create lesson reports for your assigned students."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            report_exists = DailyLessonReport.objects.filter(department=department).filter(
                student=student,
                teacher=teacher,
                date=parsed_lesson_date,
            ).exists()

            if report_exists:
                fake_lesson = type("LessonPermissionCheck", (), {
                    "student": student,
                    "teacher": teacher,
                    "date": parsed_lesson_date,
                    "created_at": None,
                })()

                if not teacher_can_edit_lesson_now(fake_lesson):
                    return Response(
                        {
                            "detail": (
                                "Daily lesson report already exists and the edit window expired. "
                                "Please ask department admin or coordinator to enable edit permission."
                            )
                        },
                        status=status.HTTP_403_FORBIDDEN,
                    )
            else:
                if parsed_lesson_date > date.today():
                    return Response(
                        {"detail": "Future dates are not allowed."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                elif not teacher_can_add_lesson_now(student, teacher, parsed_lesson_date):
                    return Response(
                        {
                            "detail": (
                                "Lesson add window expired or has not started yet. "
                                "Please ask department admin or coordinator to enable add permission."
                            )
                        },
                        status=status.HTTP_403_FORBIDDEN,
                    )

        else:
            teacher_id = request.data.get("teacher_id") or student.teacher_id

            try:
                teacher = TeacherProfile.objects.filter(department=department).get(id=teacher_id)
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher not found."}, status=status.HTTP_404_NOT_FOUND)

        allowed_statuses = ["excellent", "good", "satisfactory", "needs_improvement", ""]
        cleaned_entries = []

        for index, raw_entry in enumerate(subject_entries):
            if not isinstance(raw_entry, dict):
                continue

            subject = str(raw_entry.get("subject", "") or "").strip()
            topic_summary = str(raw_entry.get("topic_summary", "") or "").strip()
            progress_status = str(raw_entry.get("progress_status", "") or "").strip()
            remarks = str(raw_entry.get("remarks", "") or "").strip()
            lesson_data = raw_entry.get("lesson_data") or {}

            if not subject:
                return Response(
                    {"detail": f"Subject is required for subject block {index + 1}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if not topic_summary:
                return Response(
                    {"detail": f"Topic summary is required for subject block {index + 1}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if progress_status not in allowed_statuses:
                return Response(
                    {"detail": f"Invalid progress status in subject block {index + 1}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            cleaned_entries.append({
                "subject": subject,
                "topic_summary": topic_summary,
                "progress_status": progress_status,
                "remarks": remarks,
                "lesson_data": lesson_data,
                "sort_order": index,
            })

        if not cleaned_entries:
            return Response(
                {"detail": "At least one valid subject entry is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            report, created = DailyLessonReport.objects.filter(department=department).update_or_create(
                student=student,
                teacher=teacher,
                date=parsed_lesson_date,
                defaults={
                    "notes": notes,
                    "created_by": user,
                },
            )

            submitted_subject_names = {item["subject"] for item in cleaned_entries}
            if is_department_manager(user):
                report.subject_entries.all().delete()
            else:
                report.subject_entries.filter(subject__in=submitted_subject_names).delete()

            DailyLessonSubjectEntry.objects.bulk_create([

            
                DailyLessonSubjectEntry(
                    report=report,
                    subject=item["subject"],
                    topic_summary=item["topic_summary"],
                    progress_status=item["progress_status"],
                    remarks=item["remarks"],
                    lesson_data=item["lesson_data"],
                    sort_order=item["sort_order"],
                )
                for item in cleaned_entries
            ])

        report = DailyLessonReport.objects.filter(department=department).select_related(
            "student__user",
            "teacher__user",
            "created_by",
            "edit_permission_granted_by",
        ).prefetch_related("subject_entries").get(id=report.id)

        # FIX: Auto-disable teacher lesson permissions after save.
        # Add request approved -> teacher saves new lesson -> disable add permission.
        # Edit request approved -> teacher saves edited lesson -> disable edit permission.
        # Coordinator still receives the lesson saved notification, but no manual disable is needed.
        if is_teacher_role(user):
            try:
                teacher_obj = user.teacher_profile
                submitted_subjects = {
                    str(item.get("subject", "")).strip()
                    for item in cleaned_entries
                    if str(item.get("subject", "")).strip()
                }

                permission_type = "add" if created else "edit"

                for subj in submitted_subjects:
                    updated_count = LessonAccessPermission.objects.filter(department=department).filter(
                        student=student,
                        teacher=teacher_obj,
                        lesson_date=parsed_lesson_date,
                        access_type=permission_type,
                        is_active=True,
                    ).filter(
                        Q(subject=subj) | Q(subject="")
                    ).update(is_active=False)

                    logger.info(
                        "Auto-disabled %s lesson permission after save: student=%s teacher=%s date=%s subject=%s count=%s",
                        permission_type,
                        student.id,
                        teacher_obj.id,
                        parsed_lesson_date,
                        subj,
                        updated_count,
                    )
            except Exception as e:
                logger.warning("Auto-disable permission failed: %s", e)

        try:
            notify_lesson_saved(report, created)
        except Exception as e:
            logger.warning("WebSocket notify failed: %s", e)

        return Response(
            daily_lesson_report_payload(report),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

# ============================================================
# Attendance API
# ============================================================

def _attendance_manager_scope(user):
    """
    Resolve attendance visibility for manager roles.

    Superuser:
        all records

    Coordinator / Department Admin:
        assigned department only

    Institution Admin:
        assigned institution only
    """

    if getattr(
        user,
        "is_superuser",
        False,
    ):
        return "all", None

    role = str(
        getattr(user, "role", "")
        or ""
    ).lower()

    if role in {
        "coordinator",
        "department_admin",
    }:
        department = getattr(
            user,
            "department",
            None,
        )

        if department is None:
            return None, None

        return (
            "department",
            department,
        )

    if role == "institution_admin":
        institution = getattr(
            user,
            "institution",
            None,
        )

        if institution is None:
            return None, None

        return (
            "institution",
            institution,
        )

    return None, None


def _scope_attendance_for_manager(
    queryset,
    user,
):
    scope_type, scope_object = (
        _attendance_manager_scope(
            user
        )
    )

    if scope_type == "all":
        return queryset

    if scope_type == "department":
        return (
            queryset.filter(
                Q(
                    department=
                    scope_object
                )
                | Q(
                    teacher__department=
                    scope_object
                )
                | Q(
                    teacher__user__department=
                    scope_object
                )
                | Q(
                    student__department=
                    scope_object
                )
                | Q(
                    student__user__department=
                    scope_object
                )
            )
            .distinct()
        )

    if scope_type == "institution":
        return (
            queryset.filter(
                Q(
                    institution=
                    scope_object
                )
                | Q(
                    teacher__institution=
                    scope_object
                )
                | Q(
                    teacher__user__institution=
                    scope_object
                )
                | Q(
                    student__institution=
                    scope_object
                )
                | Q(
                    student__user__institution=
                    scope_object
                )
            )
            .distinct()
        )

    return queryset.none()


def _scope_students_for_manager(
    queryset,
    user,
):
    scope_type, scope_object = (
        _attendance_manager_scope(
            user
        )
    )

    if scope_type == "all":
        return queryset

    if scope_type == "department":
        return (
            queryset.filter(
                Q(
                    department=
                    scope_object
                )
                | Q(
                    user__department=
                    scope_object
                )
            )
            .distinct()
        )

    if scope_type == "institution":
        return (
            queryset.filter(
                Q(
                    institution=
                    scope_object
                )
                | Q(
                    user__institution=
                    scope_object
                )
            )
            .distinct()
        )

    return queryset.none()


def _attendance_import_truthy(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _resolve_attendance_import_teacher_for_user(user, csv_teacher_name):
    """Resolve the CSV teacher inside the authenticated coordinator's Quran scope."""
    queryset = TeacherProfile.objects.select_related("user").all()

    if not getattr(user, "is_superuser", False):
        department = quran_department_for_user(user)
        if department is None:
            return None, "No active Quran department is assigned to this coordinator."
        queryset = queryset.filter(
            Q(department=department) | Q(user__department=department)
        ).distinct()

    targets = {
        normalize_attendance_import_name(csv_teacher_name),
        normalize_attendance_import_name(strip_leading_teacher_number(csv_teacher_name)),
    }
    targets.discard("")

    matches = []
    for teacher in queryset.order_by("id"):
        candidates = {
            normalize_attendance_import_name(str(teacher)),
            normalize_attendance_import_name(teacher.user.username),
            normalize_attendance_import_name(teacher.user.get_full_name()),
            normalize_attendance_import_name(strip_leading_teacher_number(str(teacher))),
            normalize_attendance_import_name(strip_leading_teacher_number(teacher.user.get_full_name())),
        }
        if targets & candidates:
            matches.append(teacher)

    if not matches:
        return None, f"Could not match CSV teacher {csv_teacher_name!r} inside your Quran department."
    if len(matches) > 1:
        ids = ", ".join(str(item.id) for item in matches)
        return None, (
            f"Teacher name {csv_teacher_name!r} matched multiple teachers ({ids}). "
            "Please make the teacher name in the CSV more specific."
        )
    return matches[0], None


def _attendance_import_scope_querysets(user):
    """Return teacher/student querysets limited to the caller's Quran department."""
    teachers = TeacherProfile.objects.select_related("user").all()
    students = StudentProfile.objects.select_related("user", "teacher__user").all()

    if getattr(user, "is_superuser", False):
        return teachers.order_by("id"), students.order_by("id"), None

    department = quran_department_for_user(user)
    if department is None:
        return teachers.none(), students.none(), "No active Quran department is assigned to this coordinator."

    teachers = teachers.filter(
        Q(department=department) | Q(user__department=department)
    ).distinct()
    students = students.filter(
        Q(department=department) | Q(user__department=department)
    ).distinct()
    return teachers.order_by("id"), students.order_by("id"), None


class AttendanceMonthlyImportView(APIView):
    """Preview or commit one monthly teacher attendance CSV using the tested importer engine."""

    permission_classes = [IsAuthenticated]
    MAX_UPLOAD_BYTES = 5 * 1024 * 1024

    def post(self, request):
        role = str(getattr(request.user, "role", "") or "").lower()
        if not (getattr(request.user, "is_superuser", False) or role == "coordinator"):
            return Response(
                {"detail": "Only coordinators can import monthly attendance."},
                status=status.HTTP_403_FORBIDDEN,
            )

        upload = request.FILES.get("file") or request.FILES.get("csv")
        if upload is None:
            return Response(
                {"detail": "Choose a CSV attendance file first."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        filename = Path(str(getattr(upload, "name", "attendance.csv"))).name
        if Path(filename).suffix.lower() != ".csv":
            return Response(
                {"detail": "Attendance import accepts CSV files only."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if int(getattr(upload, "size", 0) or 0) > self.MAX_UPLOAD_BYTES:
            return Response(
                {"detail": "CSV file is too large. Maximum upload size is 5 MB."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        commit = _attendance_import_truthy(request.data.get("commit"))
        allow_unmatched = _attendance_import_truthy(
            request.data.get("allow_unmatched_students")
        )

        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb", suffix=".csv", prefix="ivs-attendance-", delete=False
            ) as temp_handle:
                for chunk in upload.chunks():
                    temp_handle.write(chunk)
                temp_path = temp_handle.name

            detected_format = detect_attendance_csv_format(temp_path)

            if detected_format == "report":
                try:
                    parsed_report = parse_attendance_report_csv(temp_path)
                except AttendanceReportFormatError as exc:
                    return Response(
                        {
                            "detail": str(exc),
                            "success": False,
                            "mode": "commit" if commit else "preview",
                            "format": "report",
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                teachers, students, scope_error = _attendance_import_scope_querysets(request.user)
                if scope_error:
                    return Response(
                        {
                            "detail": scope_error,
                            "success": False,
                            "mode": "commit" if commit else "preview",
                            "format": "report",
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                report_result = import_attendance_report_csv(
                    parsed_report,
                    allowed_teachers=teachers,
                    allowed_students=students,
                    actor=request.user,
                    commit=commit,
                    allow_unmatched_students=allow_unmatched,
                )
                return Response(
                    {
                        **report_result,
                        "mode": "commit" if commit else "preview",
                        "filename": filename,
                        "format": "report",
                        "date_range": parsed_report.date_label,
                        "allow_unmatched_students": allow_unmatched,
                    },
                    status=status.HTTP_200_OK,
                )

            if detected_format == "unknown":
                return Response(
                    {
                        "detail": (
                            "Could not recognize this attendance CSV. Use either the monthly teacher template "
                            "(contains TEACHER NAME, Month Start Date, and day columns) or an exported "
                            "attendance report CSV (Date, Class Time, Teacher, Student, Type, Status)."
                        ),
                        "success": False,
                        "mode": "commit" if commit else "preview",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                parsed = parse_monthly_attendance_csv(temp_path)
            except AttendanceCsvFormatError as exc:
                return Response(
                    {"detail": str(exc), "success": False, "mode": "commit" if commit else "preview", "format": "monthly"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            teacher, teacher_error = _resolve_attendance_import_teacher_for_user(
                request.user, parsed.teacher_name
            )
            if teacher_error:
                return Response(
                    {
                        "detail": teacher_error,
                        "success": False,
                        "mode": "commit" if commit else "preview",
                        "teacher_name": parsed.teacher_name,
                        "month": parsed.month_label,
                        "format": "monthly",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            output = StringIO()
            command_options = {
                "commit": commit,
                "allow_unmatched_students": allow_unmatched,
                "teacher_id": teacher.id,
                "stdout": output,
                "stderr": output,
            }
            if role == "coordinator":
                command_options["marked_by"] = request.user.username

            try:
                call_command(
                    "import_monthly_attendance",
                    temp_path,
                    **command_options,
                )
                success = True
                detail = (
                    "Attendance imported successfully."
                    if commit
                    else "Preview passed. No database changes were made."
                )
            except CommandError as exc:
                success = False
                detail = str(exc)
                output.write(f"\n{detail}\n")

            return Response(
                {
                    "success": success,
                    "mode": "commit" if commit else "preview",
                    "detail": detail,
                    "output": output.getvalue(),
                    "filename": filename,
                    "teacher_id": teacher.id,
                    "teacher_name": str(teacher),
                    "csv_teacher_name": parsed.teacher_name,
                    "month": parsed.month_label,
                    "format": "monthly",
                    "allow_unmatched_students": allow_unmatched,
                },
                status=status.HTTP_200_OK,
            )
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass


class AttendanceListCreateView(APIView):
    permission_classes = [
        IsAuthenticated
    ]

    def get(self, request):
        user = request.user

        date_value = str(
            request.query_params.get(
                "date",
                "",
            )
        ).strip()

        student_id = str(
            request.query_params.get(
                "student_id",
                "",
            )
        ).strip()

        teacher_id = str(
            request.query_params.get(
                "teacher_id",
                "",
            )
        ).strip()

        attendance = (
            Attendance.objects
            .select_related(
                "teacher__user",
                "student__user",
                "marked_by",
                "department",
                "institution",
            )
        )

        if date_value:
            attendance = (
                attendance.filter(
                    date=date_value
                )
            )

        if (
            student_id
            and student_id.isdigit()
        ):
            attendance = (
                attendance.filter(
                    student_id=int(
                        student_id
                    )
                )
            )

        if (
            teacher_id
            and teacher_id.isdigit()
        ):
            attendance = (
                attendance.filter(
                    teacher_id=int(
                        teacher_id
                    )
                )
            )

        if is_department_manager(
            user
        ):
            scope_type, _scope = (
                _attendance_manager_scope(
                    user
                )
            )

            if scope_type is None:
                return Response(
                    {
                        "detail": (
                            "Your account does "
                            "not have a valid "
                            "attendance scope."
                        )
                    },
                    status=(
                        status
                        .HTTP_403_FORBIDDEN
                    ),
                )

            attendance = (
                _scope_attendance_for_manager(
                    attendance,
                    user,
                )
            )

        elif is_teacher_role(user):
            try:
                teacher = (
                    user.teacher_profile
                )
            except (
                TeacherProfile
                .DoesNotExist
            ):
                return Response(
                    {
                        "detail": (
                            "Teacher profile "
                            "not found."
                        )
                    },
                    status=(
                        status
                        .HTTP_404_NOT_FOUND
                    ),
                )

            attendance = (
                attendance.filter(
                    Q(
                        teacher=teacher
                    )
                    | Q(
                        student__teacher=
                        teacher
                    )
                )
            )

        elif is_student_role(user):
            try:
                student = (
                    user.student_profile
                )
            except (
                StudentProfile
                .DoesNotExist
            ):
                return Response(
                    {
                        "detail": (
                            "Student profile "
                            "not found."
                        )
                    },
                    status=(
                        status
                        .HTTP_404_NOT_FOUND
                    ),
                )

            attendance = (
                attendance.filter(
                    student=student
                )
            )

        else:
            return Response(
                {
                    "detail":
                    "Invalid role."
                },
                status=(
                    status
                    .HTTP_403_FORBIDDEN
                ),
            )

        total_count = (
            attendance.count()
        )

        rows = list(
            attendance
            .order_by(
                "-date",
                "-updated_at",
                "-id",
            )[:1000]
        )

        return Response({
            "count": total_count,
            "results": [
                attendance_payload(
                    item
                )
                for item in rows
            ],
        })


    @transaction.atomic
    def post(self, request):
        user = request.user

        if not is_department_manager(
            user
        ):
            return Response(
                {
                    "detail": (
                        "Only department "
                        "admins and "
                        "coordinators can "
                        "mark attendance."
                    )
                },
                status=(
                    status
                    .HTTP_403_FORBIDDEN
                ),
            )

        scope_type, _scope = (
            _attendance_manager_scope(
                user
            )
        )

        if scope_type is None:
            return Response(
                {
                    "detail": (
                        "Your account does "
                        "not have a valid "
                        "attendance scope."
                    )
                },
                status=(
                    status
                    .HTTP_403_FORBIDDEN
                ),
            )

        entity_type = str(
            request.data.get(
                "entity_type",
                "",
            )
        ).strip().lower()

        if entity_type not in {
            "teacher",
            "student",
        }:
            return Response(
                {
                    "detail": (
                        "entity_type must "
                        "be teacher or "
                        "student."
                    )
                },
                status=(
                    status
                    .HTTP_400_BAD_REQUEST
                ),
            )

        # Teacher attendance may affect salary.
        # It must use the transactional V2 route.
        if entity_type == "teacher":
            return Response(
                {
                    "detail": (
                        "Teacher attendance "
                        "must use the "
                        "teacher-session "
                        "attendance V2 "
                        "endpoint."
                    )
                },
                status=(
                    status
                    .HTTP_409_CONFLICT
                ),
            )

        student_id = (
            request.data.get(
                "student_id"
            )
        )

        if not student_id:
            return Response(
                {
                    "detail": (
                        "student_id is "
                        "required for "
                        "student attendance."
                    )
                },
                status=(
                    status
                    .HTTP_400_BAD_REQUEST
                ),
            )

        raw_date = (
            request.data.get(
                "date"
            )
            or timezone
            .localdate()
            .isoformat()
        )

        try:
            target_date = (
                datetime.strptime(
                    str(raw_date),
                    "%Y-%m-%d",
                ).date()
            )
        except (
            TypeError,
            ValueError,
        ):
            return Response(
                {
                    "detail": (
                        "date must use "
                        "YYYY-MM-DD format."
                    )
                },
                status=(
                    status
                    .HTTP_400_BAD_REQUEST
                ),
            )

        if (
            target_date
            > timezone.localdate()
        ):
            return Response(
                {
                    "detail": (
                        "Future attendance "
                        "dates are not "
                        "allowed."
                    )
                },
                status=(
                    status
                    .HTTP_400_BAD_REQUEST
                ),
            )

        status_value = str(
            request.data.get(
                "status",
                "",
            )
        ).strip().lower()

        if status_value not in {
            "present",
            "absent",
            "leave",
        }:
            return Response(
                {
                    "detail": (
                        "status must be "
                        "present, absent, "
                        "or leave."
                    )
                },
                status=(
                    status
                    .HTTP_400_BAD_REQUEST
                ),
            )

        students = (
            StudentProfile.objects
            .select_related(
                "user",
                "department",
                "institution",
                "user__department",
                "user__institution",
            )
        )

        students = (
            _scope_students_for_manager(
                students,
                user,
            )
        )

        try:
            student = students.get(
                id=student_id
            )
        except (
            StudentProfile
            .DoesNotExist
        ):
            return Response(
                {
                    "detail": (
                        "Student not found "
                        "in your permitted "
                        "scope."
                    )
                },
                status=(
                    status
                    .HTTP_404_NOT_FOUND
                ),
            )

        attendance_teacher = student.teacher

        requested_class_time = parse_frontend_time(
            request.data.get("class_key")
            or request.data.get("classKey")
        )

        if requested_class_time is None:
            weekday_name = (
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
            )[target_date.weekday()]

            schedule = (
                ClassSchedule.objects
                .filter(
                    student=student,
                    is_active=True,
                    weekday=weekday_name,
                )
                .order_by("time_slot", "id")
                .first()
            )

            if schedule is None:
                schedule = (
                    ClassSchedule.objects
                    .filter(
                        student=student,
                        is_active=True,
                    )
                    .order_by("time_slot", "id")
                    .first()
                )

            requested_class_time = (
                schedule.time_slot
                if schedule is not None
                else None
            )

        attendance_class_key = (
            requested_class_time.strftime("%H:%M")
            if requested_class_time is not None
            else ""
        )

        attendance_department = (
            student.department
            or getattr(
                student.user,
                "department",
                None,
            )
        )

        attendance_institution = (
            student.institution
            or getattr(
                student.user,
                "institution",
                None,
            )
            or getattr(
                attendance_department,
                "institution",
                None,
            )
        )

        source_lock = (
            student_attendance_payroll_lock_payload(
                student=student,
                target_date=target_date,
                department=attendance_department,
            )
        )

        if source_lock:
            return Response(
                source_lock,
                status=(
                    status
                    .HTTP_409_CONFLICT
                ),
            )

        Attendance.objects.filter(
            entity_type=(
                Attendance
                .EntityType
                .STUDENT
            ),
            student=student,
            date=target_date,
        ).delete()

        attendance = (
            Attendance.objects.create(
                entity_type=(
                    Attendance
                    .EntityType
                    .STUDENT
                ),
                teacher=attendance_teacher,
                student=student,
                date=target_date,
                class_key=attendance_class_key,
                status=status_value,
                marked_by=user,
                department=(
                    attendance_department
                ),
                institution=(
                    attendance_institution
                ),
            )
        )

        reconcile_student_coverage(
            student=student,
            target_date=target_date,
            actor=user,
            student_status=(
                status_value
            ),
        )

        try:
            reconcile_student_drop_from_attendance(
                student=student,
                target_date=target_date,
                actor=user,
            )
        except PayrollSourceLockedError as exc:
            transaction.set_rollback(
                True
            )
            return Response(
                exc.payload,
                status=(
                    status
                    .HTTP_409_CONFLICT
                ),
            )
        except StudentDropDetectionError as exc:
            transaction.set_rollback(
                True
            )
            return Response(
                exc.payload,
                status=(
                    status
                    .HTTP_409_CONFLICT
                ),
            )

        try:
            notify_attendance_marked(
                attendance
            )
        except Exception as exc:
            logger.warning(
                "WebSocket notify failed: %s",
                exc,
            )

        return Response(
            attendance_payload(
                attendance
            ),
            status=(
                status
                .HTTP_201_CREATED
            ),
        )


class AttendanceDeleteView(APIView):
    permission_classes = [
        IsAuthenticated
    ]

    @transaction.atomic
    def delete(
        self,
        request,
        pk,
    ):
        user = request.user

        if not is_department_manager(
            user
        ):
            return Response(
                {
                    "detail": (
                        "Only department "
                        "admins and "
                        "coordinators can "
                        "delete attendance."
                    )
                },
                status=(
                    status
                    .HTTP_403_FORBIDDEN
                ),
            )

        scope_type, _scope = (
            _attendance_manager_scope(
                user
            )
        )

        if scope_type is None:
            return Response(
                {
                    "detail": (
                        "Your account does "
                        "not have a valid "
                        "attendance scope."
                    )
                },
                status=(
                    status
                    .HTTP_403_FORBIDDEN
                ),
            )

        queryset = (
            Attendance.objects
            .select_related(
                "student__user",
                "student__department",
                "student__institution",
                "teacher__user",
                "teacher__department",
                "teacher__institution",
                "department",
                "institution",
            )
        )

        queryset = (
            _scope_attendance_for_manager(
                queryset,
                user,
            )
        )

        try:
            attendance = (
                queryset.get(
                    id=pk
                )
            )
        except (
            Attendance
            .DoesNotExist
        ):
            return Response(
                {
                    "detail": (
                        "Attendance record "
                        "not found."
                    )
                },
                status=(
                    status
                    .HTTP_404_NOT_FOUND
                ),
            )

        if (
            attendance.entity_type
            == Attendance
            .EntityType
            .TEACHER
        ):
            return Response(
                {
                    "detail": (
                        "Teacher attendance "
                        "must be unmarked "
                        "through the "
                        "teacher-session V2 "
                        "endpoint."
                    )
                },
                status=(
                    status
                    .HTTP_409_CONFLICT
                ),
            )

        student = (
            attendance.student
        )

        target_date = (
            attendance.date
        )

        source_lock = (
            student_attendance_payroll_lock_payload(
                student=student,
                target_date=target_date,
                department=(
                    attendance.department
                ),
            )
        )

        if source_lock:
            return Response(
                source_lock,
                status=(
                    status
                    .HTTP_409_CONFLICT
                ),
            )

        attendance.delete()

        if student is not None:
            reconcile_student_coverage(
                student=student,
                target_date=target_date,
                actor=user,
                student_status=(
                    "not_marked"
                ),
            )

        return Response(
            {
                "detail": (
                    "Attendance deleted "
                    "successfully."
                )
            }
        )


# ============================================================
# Monthly Lesson Plan API
# ============================================================

class MonthlyLessonPlanListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        month = safe_int(request.query_params.get("month"))
        year = safe_int(request.query_params.get("year"))
        student_id = safe_int(request.query_params.get("student_id"))
        teacher_id = safe_int(request.query_params.get("teacher_id"))

        plans = MonthlyLessonPlan.objects.filter(department=department).select_related(
            "student__user",
            "teacher__user",
            "created_by",
        )

        if month:
            plans = plans.filter(month=month)

        if year:
            plans = plans.filter(year=year)

        if student_id:
            plans = plans.filter(student_id=student_id)

        if teacher_id:
            plans = plans.filter(teacher_id=teacher_id)

        if is_department_manager(user):
            pass

        elif is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

            plans = plans.filter(teacher=teacher)

        elif is_student_role(user):
            try:
                student = user.student_profile
            except StudentProfile.DoesNotExist:
                return Response({"detail": "Student profile not found."}, status=status.HTTP_404_NOT_FOUND)

            plans = plans.filter(student=student)

        else:
            return Response({"detail": "Invalid role."}, status=status.HTTP_403_FORBIDDEN)

        plans = plans.order_by("-year", "-month", "student__user__first_name", "subject", "-id")

        return Response({
            "count": plans.count(),
            "results": [monthly_plan_payload(item) for item in plans],
        })

    def post(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if not (is_department_manager(user) or is_teacher_role(user)):
            return Response(
                {"detail": "Students cannot create monthly lesson plans."},
                status=status.HTTP_403_FORBIDDEN,
            )

        student_id = request.data.get("student_id")
        teacher_id = request.data.get("teacher_id")
        month = safe_int(request.data.get("month"))
        year = safe_int(request.data.get("year"))
        subject = str(request.data.get("subject", "")).strip()
        plan_text = str(
            request.data.get("plan_text")
            or request.data.get("target_summary")
            or request.data.get("week_1_plan")
            or ""
        ).strip()
        notes = str(request.data.get("notes", "") or "").strip()

        if not student_id:
            return Response({"detail": "student_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not month or month < 1 or month > 12:
            return Response({"detail": "month must be between 1 and 12."}, status=status.HTTP_400_BAD_REQUEST)

        if not year or year < 2000:
            return Response({"detail": "year is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not subject:
            return Response({"detail": "subject is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not plan_text:
            return Response({"detail": "plan_text is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            student = StudentProfile.objects.filter(department=department).select_related(
                "teacher",
                "teacher__user",
                "user",
            ).get(id=student_id)
        except StudentProfile.DoesNotExist:
            return Response({"detail": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        if is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

            if student.teacher_id != teacher.id:
                return Response(
                    {"detail": "You can only create plans for your assigned students."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        else:
            teacher_id = teacher_id or student.teacher_id

            try:
                teacher = TeacherProfile.objects.filter(department=department).get(id=teacher_id)
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher not found."}, status=status.HTTP_404_NOT_FOUND)

        plan_data = (
            request.data.get("plan_data")
            or {}
        )

        if not isinstance(plan_data, dict):
            return Response(
                {
                    "detail":
                    "plan_data must be a JSON object."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        allowed_statuses = ["planned", "in_progress", "completed"]
        plan_status = str(request.data.get("status", "planned")).strip().lower()

        if plan_status not in allowed_statuses:
            return Response({"detail": "Invalid plan status."}, status=status.HTTP_400_BAD_REQUEST)

        defaults = {
            "notes": notes,
            "status": plan_status,
            "created_by": user,
        }

        if model_has_field(MonthlyLessonPlan, "plan_text"):
            defaults["plan_text"] = plan_text

        if model_has_field(MonthlyLessonPlan, "target_summary"):
            defaults["target_summary"] = plan_text

        if model_has_field(
            MonthlyLessonPlan,
            "plan_data",
        ):
            defaults["plan_data"] = plan_data

        plan, created = MonthlyLessonPlan.objects.filter(department=department).update_or_create(
            student=student,
            teacher=teacher,
            month=month,
            year=year,
            subject=subject,
            defaults=defaults,
        )

        return Response(monthly_plan_payload(plan), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class MonthlyLessonPlanDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        try:
            plan = MonthlyLessonPlan.objects.filter(department=department).select_related(
                "student__user",
                "teacher__user",
                "created_by",
            ).get(id=pk)
        except MonthlyLessonPlan.DoesNotExist:
            return Response({"detail": "Monthly lesson plan not found."}, status=status.HTTP_404_NOT_FOUND)

        if is_department_manager(user):
            pass

        elif is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

            if plan.teacher_id != teacher.id:
                return Response(
                    {"detail": "You can only update your own students' plans."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        else:
            return Response(
                {"detail": "Only department admins and coordinators and teachers can update monthly lesson plans."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if "plan_text" in request.data and model_has_field(MonthlyLessonPlan, "plan_text"):
            plan.plan_text = str(request.data.get("plan_text") or "").strip()

        if "target_summary" in request.data and model_has_field(MonthlyLessonPlan, "target_summary"):
            value = str(request.data.get("target_summary") or "").strip()
            plan.target_summary = value

            if model_has_field(MonthlyLessonPlan, "plan_text") and not getattr(plan, "plan_text", ""):
                plan.plan_text = value

        if (
            "plan_data" in request.data
            and model_has_field(
                MonthlyLessonPlan,
                "plan_data",
            )
        ):
            plan_data = (
                request.data.get("plan_data")
                or {}
            )

            if not isinstance(plan_data, dict):
                return Response(
                    {
                        "detail":
                        "plan_data must be a JSON object."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            plan.plan_data = plan_data

        if "notes" in request.data:
            plan.notes = str(request.data.get("notes") or "").strip()

        if "status" in request.data:
            value = str(request.data.get("status") or "").strip().lower()

            if value not in ["planned", "in_progress", "completed"]:
                return Response({"detail": "Invalid plan status."}, status=status.HTTP_400_BAD_REQUEST)

            plan.status = value

        plan.save()
        return Response(monthly_plan_payload(plan))

    def delete(self, request, pk):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if not is_department_manager(user):
            return Response(
                {"detail": "Only department admins and coordinators can delete monthly lesson plans."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            plan = MonthlyLessonPlan.objects.filter(department=department).get(id=pk)
        except MonthlyLessonPlan.DoesNotExist:
            return Response({"detail": "Monthly lesson plan not found."}, status=status.HTTP_404_NOT_FOUND)

        plan.delete()
        return Response({"detail": "Monthly lesson plan deleted successfully."})



class MonthlyLessonSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def _resolve_range(self, data, query=False):
        getter = (
            data.get
            if query
            else data.get
        )

        start_value = str(
            getter("start_date") or ""
        ).strip()

        end_value = str(
            getter("end_date") or ""
        ).strip()

        month = safe_int(getter("month"))
        year = safe_int(getter("year"))

        if start_value or end_value:
            if not start_value or not end_value:
                return None, None, None, None, (
                    "Both start_date and end_date are required."
                )

            start_date, start_error = parse_date_str(
                start_value,
                "start_date",
            )

            end_date, end_error = parse_date_str(
                end_value,
                "end_date",
            )

            if start_error or end_error:
                return None, None, None, None, (
                    "Invalid date format. Use YYYY-MM-DD."
                )

            if start_date > end_date:
                return None, None, None, None, (
                    "start_date cannot be after end_date."
                )

            return (
                start_date,
                end_date,
                start_date.month,
                start_date.year,
                None,
            )

        if not month or month < 1 or month > 12:
            return None, None, None, None, (
                "Provide start_date and end_date, or a valid month."
            )

        if not year or year < 2000:
            return None, None, None, None, (
                "Provide start_date and end_date, or a valid year."
            )

        first_day, next_month = build_month_range(
            year,
            month,
        )

        last_day = date.fromordinal(
            next_month.toordinal() - 1
        )

        return (
            first_day,
            last_day,
            month,
            year,
            None,
        )

    def get(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        (
            range_start,
            range_end,
            month,
            year,
            range_error,
        ) = self._resolve_range(
            request.query_params,
            query=True,
        )

        if range_error:
            return Response(
                {"detail": range_error},
                status=status.HTTP_400_BAD_REQUEST,
            )

        student_id = safe_int(
            request.query_params.get("student_id")
        )

        teacher_id = safe_int(
            request.query_params.get("teacher_id")
        )

        reports = (
            DailyLessonReport.objects
            .select_related(
                "student__user",
                "teacher__user",
                "created_by",
            )
            .prefetch_related("subject_entries")
            .filter(
                date__gte=range_start,
                date__lte=range_end,
            )
        )

        plans = (
            MonthlyLessonPlan.objects
            .select_related(
                "student__user",
                "teacher__user",
                "created_by",
            )
            .filter(
                year__gte=range_start.year,
                year__lte=range_end.year,
            )
        )

        summaries = (
            MonthlyLessonSummary.objects
            .select_related(
                "student__user",
                "teacher__user",
                "created_by",
            )
            .filter(
                start_date=range_start,
                end_date=range_end,
                created_by=user,
            )
        )

        if student_id:
            reports = reports.filter(
                student_id=student_id
            )

            plans = plans.filter(
                student_id=student_id
            )

            summaries = summaries.filter(
                student_id=student_id
            )

        if teacher_id:
            reports = reports.filter(
                teacher_id=teacher_id
            )

            plans = plans.filter(
                teacher_id=teacher_id
            )

            summaries = summaries.filter(
                teacher_id=teacher_id
            )

        if is_department_manager(user):
            pass

        elif is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response(
                    {
                        "detail":
                        "Teacher profile not found."
                    },
                    status=status.HTTP_404_NOT_FOUND,
                )

            reports = reports.filter(teacher=teacher)
            plans = plans.filter(teacher=teacher)
            summaries = summaries.filter(teacher=teacher)

        elif is_student_role(user):
            try:
                student = user.student_profile
            except StudentProfile.DoesNotExist:
                return Response(
                    {
                        "detail":
                        "Student profile not found."
                    },
                    status=status.HTTP_404_NOT_FOUND,
                )

            reports = reports.filter(student=student)
            plans = plans.filter(student=student)
            summaries = summaries.none()

        else:
            return Response(
                {"detail": "Invalid role."},
                status=status.HTTP_403_FORBIDDEN,
            )

        report_rows = list(
            reports.order_by(
                "student__user__first_name",
                "date",
                "id",
            )
        )

        all_plan_rows = list(
            plans.order_by(
                "student__user__first_name",
                "year",
                "month",
                "subject",
                "id",
            )
        )

        plan_rows = []

        for plan in all_plan_rows:
            plan_start, plan_next = build_month_range(
                plan.year,
                plan.month,
            )

            plan_end = date.fromordinal(
                plan_next.toordinal() - 1
            )

            if (
                plan_start <= range_end
                and plan_end >= range_start
            ):
                plan_rows.append(plan)

        summary_rows = list(
            summaries.order_by(
                "-updated_at",
                "-id",
            )
        )

        progress_counts = {
            "excellent": 0,
            "good": 0,
            "satisfactory": 0,
            "needs_improvement": 0,
            "blank": 0,
        }

        subjects = Counter()
        students = {}
        lesson_rows = []

        for report in report_rows:
            student_key = report.student_id

            if student_key not in students:
                students[student_key] = {
                    "student_id": report.student_id,
                    "student_name": str(report.student),
                    "teacher_id": report.teacher_id,
                    "teacher_name": str(report.teacher),
                    "total_lessons": 0,
                    "subjects": Counter(),
                    "progress_counts": {
                        "excellent": 0,
                        "good": 0,
                        "satisfactory": 0,
                        "needs_improvement": 0,
                        "blank": 0,
                    },
                    "topics": [],
                    "remarks": [],
                }

            students[student_key][
                "total_lessons"
            ] += 1

            for entry in report.subject_entries.all():
                status_value = (
                    entry.progress_status
                    or "blank"
                )

                progress_counts[status_value] = (
                    progress_counts.get(
                        status_value,
                        0,
                    ) + 1
                )

                if entry.subject:
                    subjects[entry.subject] += 1

                    students[student_key][
                        "subjects"
                    ][entry.subject] += 1

                students[student_key][
                    "progress_counts"
                ][status_value] = (
                    students[student_key][
                        "progress_counts"
                    ].get(status_value, 0) + 1
                )

                if entry.topic_summary:
                    students[student_key][
                        "topics"
                    ].append(entry.topic_summary)

                if entry.remarks:
                    students[student_key][
                        "remarks"
                    ].append(entry.remarks)

                lesson_rows.append({
                    "id": entry.id,
                    "report_id": report.id,
                    "student_id": report.student_id,
                    "student_name": str(report.student),
                    "teacher_id": report.teacher_id,
                    "teacher_name": str(report.teacher),
                    "date": str(report.date),
                    "subject": entry.subject,
                    "topic_summary":
                        entry.topic_summary,
                    "progress_status":
                        entry.progress_status,
                    "remarks": entry.remarks,
                    "lesson_data":
                        entry.lesson_data,
                    "notes": report.notes,
                    "created_at": (
                        report.created_at.isoformat()
                        if report.created_at
                        else None
                    ),
                    "updated_at": (
                        report.updated_at.isoformat()
                        if report.updated_at
                        else None
                    ),
                })

        saved_by_student = {
            summary.student_id: summary
            for summary in summary_rows
        }

        student_summaries = []

        for item in students.values():
            saved_summary = saved_by_student.get(
                item["student_id"]
            )

            student_summaries.append({
                "student_id": item["student_id"],
                "student_name": item["student_name"],
                "teacher_id": item["teacher_id"],
                "teacher_name": item["teacher_name"],
                "total_lessons": item["total_lessons"],
                "subjects": dict(item["subjects"]),
                "progress_counts":
                    item["progress_counts"],
                "topics": item["topics"][:20],
                "remarks": item["remarks"][:20],
                "auto_summary":
                    build_student_auto_summary(item),
                "saved_summary": (
                    monthly_summary_payload(
                        saved_summary
                    )
                    if saved_summary
                    else None
                ),
            })

        return Response({
            "month": month,
            "year": year,
            "start_date": str(range_start),
            "end_date": str(range_end),
            "total_lessons": len(report_rows),
            "total_plans": len(plan_rows),
            "subjects": dict(subjects),
            "progress_counts": progress_counts,
            "plans": [
                monthly_plan_payload(item)
                for item in plan_rows
            ],
            "lessons": lesson_rows,
            "summaries": [
                monthly_summary_payload(item)
                for item in summary_rows
            ],
            "student_summaries":
                student_summaries,
        })

    def post(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if not (
            is_department_manager(user)
            or is_teacher_role(user)
        ):
            return Response(
                {
                    "detail":
                    "Only teachers and department managers "
                    "can generate lesson summaries."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        (
            range_start,
            range_end,
            month,
            year,
            range_error,
        ) = self._resolve_range(request.data)

        if range_error:
            return Response(
                {"detail": range_error},
                status=status.HTTP_400_BAD_REQUEST,
            )

        student_id = request.data.get("student_id")
        teacher_id = request.data.get("teacher_id")

        if not student_id:
            return Response(
                {"detail": "student_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            student = (
                StudentProfile.objects
                .select_related(
                    "teacher",
                    "teacher__user",
                    "user",
                )
                .get(id=student_id)
            )
        except StudentProfile.DoesNotExist:
            return Response(
                {"detail": "Student not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response(
                    {
                        "detail":
                        "Teacher profile not found."
                    },
                    status=status.HTTP_404_NOT_FOUND,
                )

            if student.teacher_id != teacher.id:
                return Response(
                    {
                        "detail":
                        "You can only generate summaries "
                        "for your assigned students."
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        else:
            teacher_id = (
                teacher_id
                or student.teacher_id
            )

            try:
                teacher = TeacherProfile.objects.filter(department=department).get(
                    id=teacher_id
                )
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        subject = str(
            request.data.get("subject") or ""
        ).strip()

        reports = (
            DailyLessonReport.objects
            .prefetch_related("subject_entries")
            .filter(
                student=student,
                teacher=teacher,
                date__gte=range_start,
                date__lte=range_end,
            )
            .order_by("date", "id")
        )

        report_rows = list(reports)

        subjects = Counter()
        progress_counts = Counter()
        topics = []
        remarks = []
        matching_report_ids = set()

        for report in report_rows:
            for entry in report.subject_entries.all():
                if (
                    subject
                    and entry.subject != subject
                ):
                    continue

                matching_report_ids.add(report.id)

                if entry.subject:
                    subjects[entry.subject] += 1

                progress_counts[
                    entry.progress_status
                    or "blank"
                ] += 1

                if entry.topic_summary:
                    topics.append(
                        entry.topic_summary
                    )

                if entry.remarks:
                    remarks.append(entry.remarks)

        total_lessons = len(matching_report_ids)

        summary_text = str(
            request.data.get("summary_text") or ""
        ).strip()

        strengths = str(
            request.data.get("strengths") or ""
        ).strip()

        weaknesses = str(
            request.data.get("improvement_areas")
            or request.data.get("weaknesses")
            or ""
        ).strip()

        recommendations = str(
            request.data.get("parent_message")
            or request.data.get(
                "recommendations"
            )
            or ""
        ).strip()

        range_label = (
            f"{range_start.strftime('%d %b %Y')} "
            f"to {range_end.strftime('%d %b %Y')}"
        )

        if not summary_text:
            if total_lessons == 0:
                summary_text = (
                    f"No lessons were recorded for "
                    f"{student} from {range_label}."
                )
            else:
                subject_names = (
                    ", ".join(subjects.keys())
                    if subjects
                    else "multiple subjects"
                )

                topic_preview = (
                    ", ".join(topics[:8])
                    if topics
                    else "regular revision"
                )

                summary_text = (
                    f"{student} completed "
                    f"{total_lessons} lesson"
                    f"{'' if total_lessons == 1 else 's'} "
                    f"from {range_label}. "
                    f"Subjects covered: "
                    f"{subject_names}. "
                    f"Main topics: {topic_preview}."
                )

        if not strengths:
            excellent = progress_counts.get(
                "excellent",
                0,
            )

            good = progress_counts.get(
                "good",
                0,
            )

            strengths = (
                f"The student completed "
                f"{total_lessons} recorded lessons. "
                f"Excellent: {excellent}; "
                f"Good: {good}."
            )

        if not weaknesses:
            needs_improvement = progress_counts.get(
                "needs_improvement",
                0,
            )

            weaknesses = (
                "Continue regular revision and focus "
                "on consistency."
                if not needs_improvement
                else (
                    f"{needs_improvement} lesson"
                    f"{'' if needs_improvement == 1 else 's'} "
                    "were marked as needing improvement."
                )
            )

        if not recommendations:
            recommendations = (
                "Please support daily revision at home "
                "and encourage regular attendance."
            )

        source = (
            MonthlyLessonSummary.SummarySource.AI
            if request.data.get("ai_generated")
            else (
                MonthlyLessonSummary
                .SummarySource.TEACHER
            )
        )

        summary, created = (
            MonthlyLessonSummary.objects
            .update_or_create(
                student=student,
                teacher=teacher,
                start_date=range_start,
                end_date=range_end,
                subject=subject,
                created_by=user,
                defaults={
                    "month": month,
                    "year": year,
                    "summary_text": summary_text,
                    "strengths": strengths,
                    "weaknesses": weaknesses,
                    "recommendations":
                        recommendations,
                    "source": source,
                    "generated_from_lessons_count":
                        total_lessons,
                },
            )
        )

        return Response(
            monthly_summary_payload(summary),
            status=(
                status.HTTP_201_CREATED
                if created
                else status.HTTP_200_OK
            ),
        )

class AcademyStateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        schedules_prefetch = Prefetch(
            "schedules",
            queryset=ClassSchedule.objects.filter(department=department, is_active=True).order_by("weekday", "time_slot"),
        )

        if is_department_manager(user):
            teachers = TeacherProfile.objects.filter(department=department).select_related("user").filter(department=department).order_by("id")
            students = StudentProfile.objects.filter(department=department).select_related(
                "user",
                "teacher__user",
            ).prefetch_related(schedules_prefetch).filter(department=department).order_by("user__first_name", "user__username", "id")
            attendance_qs = Attendance.objects.filter(department=department).select_related(
                "teacher__user",
                "student__user",
                "marked_by",
            ).filter(department=department)

        elif is_teacher_role(user):
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response({"detail": "Teacher profile not found."}, status=status.HTTP_404_NOT_FOUND)

            teachers = TeacherProfile.objects.filter(department=department).select_related("user").filter(id=teacher.id, department=department)
            students = StudentProfile.objects.filter(department=department).select_related(
                "user",
                "teacher__user",
            ).prefetch_related(schedules_prefetch).filter(department=department, teacher=teacher).order_by("user__first_name", "user__username", "id")
            attendance_qs = Attendance.objects.filter(department=department).select_related(
                "teacher__user",
                "student__user",
                "marked_by",
            ).filter(department=department).filter(Q(teacher=teacher) | Q(student__teacher=teacher))

        elif is_student_role(user):
            try:
                student = user.student_profile
            except StudentProfile.DoesNotExist:
                return Response({"detail": "Student profile not found."}, status=status.HTTP_404_NOT_FOUND)

            teachers = TeacherProfile.objects.filter(department=department).select_related("user").filter(id=student.teacher_id, department=department)
            students = StudentProfile.objects.filter(department=department).select_related(
                "user",
                "teacher__user",
            ).prefetch_related(schedules_prefetch).filter(id=student.id, department=department)
            attendance_qs = Attendance.objects.filter(department=department).select_related(
                "teacher__user",
                "student__user",
                "marked_by",
            ).filter(department=department, student=student)

        else:
            return Response({"detail": "Invalid role."}, status=status.HTTP_403_FORBIDDEN)

        is_dashboard = request.query_params.get("dashboard") == "true"
        if is_dashboard:
            today = timezone.localdate()
            if is_department_manager(user):
                attendance_qs = attendance_qs.filter(date=today).order_by("-date", "-id")
            elif is_teacher_role(user):
                attendance_qs = attendance_qs.filter(date=today).order_by("-date", "-id")
            elif is_student_role(user):
                attendance_qs = attendance_qs.filter(date=today).order_by("-date", "-id")
        else:
            if is_department_manager(user):
                attendance_qs = attendance_qs.order_by("-date", "-id")[:2000]
            elif is_teacher_role(user):
                attendance_qs = attendance_qs.order_by("-date", "-id")[:1000]
            elif is_student_role(user):
                attendance_qs = attendance_qs.order_by("-date", "-id")[:500]

        weekday_label = {
            "monday": "Monday",
            "tuesday": "Tuesday",
            "wednesday": "Wednesday",
            "thursday": "Thursday",
            "friday": "Friday",
            "saturday": "Saturday",
            "sunday": "Sunday",
        }

        teacher_subjects_map = {}

        if not is_dashboard:
            # Precompute teacher subjects for full state consumers. The Dashboard
            # does not render or normalize these values, so skip the all-subject
            # scan on the lightweight path.
            active_subjects = StudentSubject.objects.filter(
                department=department,
                is_active=True
            ).select_related("student").order_by("subject", "custom_subject_name", "id")

            for subject in active_subjects:
                tid = subject.student.teacher_id if subject.student else None
                if tid:
                    if tid not in teacher_subjects_map:
                        teacher_subjects_map[tid] = []
                    if subject.display_name not in teacher_subjects_map[tid]:
                        teacher_subjects_map[tid].append(subject.display_name)

        teacher_rows = []

        for teacher in teachers:
            if is_dashboard:
                teacher_rows.append({
                    "id": str(teacher.id),
                    "name": teacher.user.get_full_name() or teacher.user.username,
                })
                continue

            teacher_rows.append({
                "id": str(teacher.id),
                "name": teacher.user.get_full_name() or teacher.user.username,
                "fatherName": teacher.father_name or "",
                "email": teacher.user.email or "",
                "phone": teacher.phone or "",
                "address": teacher.address or "",
                "joiningDate": str(teacher.joining_date) if teacher.joining_date else "",
                "notes": teacher.notes or "",
                "photoUrl": "",
                "loginPin": "",
                "salary": 0,
                "subjects": teacher_subjects_map.get(teacher.id, []),
            })

        student_rows = []

        for student in students:
            active_schedules = list(student.schedules.all())
            class_days = []
            time_slots = []

            for schedule in active_schedules:
                day = weekday_label.get(schedule.weekday, schedule.weekday)

                if day and day not in class_days:
                    class_days.append(day)

                if schedule.time_slot:
                    time_value = str(schedule.time_slot)[:5]
                    if time_value not in time_slots:
                        time_slots.append(time_value)

            if time_slots:
                time_slot = Counter(time_slots).most_common(1)[0][0]
            else:
                time_slot = ""

            days_count = len(class_days)

            if days_count <= 1:
                class_type = "1 day / week"
            elif days_count == 2:
                class_type = "2 days / week"
            elif days_count == 3:
                class_type = "3 days / week"
            elif days_count == 4:
                class_type = "4 days / week"
            elif days_count == 5:
                class_type = "5 days / week"
            elif days_count == 6:
                class_type = "6 days / week"
            else:
                class_type = "7 days / week"

            student_row = {
                "id": str(student.id),
                "name": student.user.get_full_name() or student.user.username,
                "teacherId": str(student.teacher_id),
                "timeSlot": time_slot,
                "classType": class_type,
                "classDays": class_days,
                "loginId": student.user.username,
            }

            if not is_dashboard:
                student_row.update({
                    "studentType": student.student_type,
                    "studentTypeLabel": student.get_student_type_display(),
                    "classStatus": student.class_status,
                    "classStatusLabel": student.get_class_status_display(),
                    "speakingLanguage": student.speaking_language,
                    "speakingLanguageLabel": student.get_speaking_language_display(),
                    "firstFeePaid": student.first_fee_paid,
                    "referralTeacherId": str(student.referral_teacher_id) if student.referral_teacher_id else "",
                    "statusEffectiveDate": str(student.status_effective_date) if student.status_effective_date else "",
                    "salaryClassMode": student.salary_class_mode,
                    "halfMonthSalaryAmount": float(student.half_month_salary_amount or 0),
                    "isNightClass": any(
                        schedule.time_slot >= time(22, 0) or schedule.time_slot <= time(8, 30)
                        for schedule in active_schedules
                    ),
                })

            student_rows.append(student_row)

        attendance_rows = []

        for item in attendance_qs:
            if item.entity_type == Attendance.EntityType.TEACHER:
                entity_id = item.teacher_id
                entity_type = "Teacher"
                # Teacher attendance is class-based. Preserve the class key
                # (Quran uses the HH:MM class start time) in academy state.
                class_key = item.class_key or ""
            else:
                entity_id = item.student_id
                entity_type = "Student"
                # Student attendance can also preserve the historical class
                # time. This is important when a student later changes teacher
                # or schedule and reports need the original relationship.
                class_key = item.class_key or ""

            if not entity_id:
                continue

            status_map = {
                "present": "Present",
                "absent": "Absent",
                "leave": "Leave",
            }

            attendance_rows.append({
                "id": str(item.id),
                "entityId": str(entity_id),
                "entityType": entity_type,
                "date": str(item.date),
                "classKey": class_key,
                "teacherId": str(item.teacher_id) if item.teacher_id else "",
                "teacherName": str(item.teacher) if item.teacher else "",
                "studentId": str(item.student_id) if item.student_id else "",
                "studentName": str(item.student) if item.student else "",
                "status": status_map.get(item.status, item.status),
                "markedById": str(item.marked_by_id) if item.marked_by_id else "",
                "markedByUsername": item.marked_by.username if item.marked_by else "",
                "markedByName": user_display_name(item.marked_by) if item.marked_by else "",
                "markedByRole": item.marked_by.role if item.marked_by else "",
                "timestamp": int(item.updated_at.timestamp() * 1000) if item.updated_at else 0,
            })

        return Response({
            "teachers": teacher_rows,
            "students": student_rows,
            "attendance": attendance_rows,
        })

    @transaction.atomic
    def post(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if not is_department_manager(user):
            return Response({"detail": "Only department admins and coordinators can sync state."}, status=status.HTTP_403_FORBIDDEN)

        data = request.data or {}
        teachers_data = data.get("teachers", [])
        students_data = data.get("students", [])
        attendance_data = data.get("attendance", [])

        if not isinstance(teachers_data, list):
            teachers_data = []

        if not isinstance(students_data, list):
            students_data = []

        if not isinstance(attendance_data, list):
            attendance_data = []

        for teacher_item in teachers_data:
            teacher_id = str(teacher_item.get("id", "")).strip()

            if not teacher_id.isdigit():
                continue

            try:
                teacher = TeacherProfile.objects.filter(department=department).select_related("user").get(id=int(teacher_id), department=department)
            except TeacherProfile.DoesNotExist:
                continue

            teacher.father_name = str(teacher_item.get("fatherName", teacher.father_name) or "").strip()
            teacher.phone = str(teacher_item.get("phone", teacher.phone) or "").strip()
            teacher.address = str(teacher_item.get("address", teacher.address) or "").strip()
            teacher.notes = str(teacher_item.get("notes", teacher.notes) or "").strip()

            joining_date = str(teacher_item.get("joiningDate", "") or "").strip()

            if joining_date:
                parsed_joining_date = parse_frontend_date(joining_date)
                if parsed_joining_date:
                    teacher.joining_date = parsed_joining_date

            teacher.save()

            name = str(teacher_item.get("name", "") or "").strip()

            if name:
                teacher.user.first_name = name
                teacher.user.last_name = ""
                teacher.user.save()

        for student_item in students_data:
            student_id = str(student_item.get("id", "")).strip()

            if not student_id.isdigit():
                continue

            try:
                student = StudentProfile.objects.filter(department=department).select_related("user", "teacher").get(id=int(student_id), department=department)
            except StudentProfile.DoesNotExist:
                continue

            name = str(student_item.get("name", "") or "").strip()

            if name:
                student.user.first_name = name
                student.user.last_name = ""
                student.user.save()

            teacher_id = str(
                student_item.get(
                    "teacherId",
                    "",
                )
            ).strip()

            desired_teacher = student.teacher

            if teacher_id.isdigit():
                try:
                    desired_teacher = (
                        TeacherProfile.objects
                        .filter(
                            department=department
                        )
                        .get(
                            id=int(teacher_id),
                            department=department,
                        )
                    )
                except TeacherProfile.DoesNotExist:
                    desired_teacher = student.teacher

            time_slot = parse_frontend_time(
                student_item.get(
                    "timeSlot"
                )
            )
            class_days = student_item.get(
                "classDays",
                [],
            )
            duration_minutes = safe_int(
                student_item.get(
                    "durationMinutes"
                )
                or student_item.get(
                    "duration_minutes"
                ),
                30,
            )

            if duration_minutes not in [30, 60]:
                duration_minutes = 30

            if not isinstance(class_days, list):
                class_days = []

            desired_rows = []
            seen_days = set()

            if class_days and time_slot:
                for raw_day in class_days:
                    weekday = frontend_weekday_to_django(raw_day)

                    if not weekday or weekday in seen_days:
                        continue

                    seen_days.add(weekday)
                    desired_rows.append({
                        "weekday": weekday,
                        "time_slot": time_slot,
                        "duration_minutes": duration_minutes,
                    })

            try:
                sync_student_schedule_history(
                    student=student,
                    desired_teacher=desired_teacher,
                    desired_rows=desired_rows,
                    effective_date=timezone.localdate(),
                    actor=user,
                    note=(
                        "Teacher/schedule change recorded "
                        "through Academy state sync."
                    ),
                )
            except PayrollSourceLockedError as exc:
                return Response(
                    exc.payload,
                    status=(
                        status
                        .HTTP_409_CONFLICT
                    ),
                )

        # Attendance is intentionally not written through
        # this legacy bulk state endpoint. Student attendance
        # uses the dedicated attendance API, while teacher
        # attendance uses the V2 teacher-session endpoint.

        return Response({
            "detail": (
                "State synced successfully."
            )
        })


# ============================================================
# Gemini AI Assistant API
# ============================================================

def build_assistant_school_context(user):
    today = timezone.localdate()
    today_name = today.strftime("%A")
    department = quran_department_for_user(user)
    if not department:
        return "No active Quran department is assigned to this account."

    teachers = TeacherProfile.objects.filter(department=department).select_related("user").order_by("user__first_name", "user__username", "id")
    students = StudentProfile.objects.filter(department=department).select_related("user", "teacher__user").prefetch_related(
        Prefetch(
            "schedules",
            queryset=ClassSchedule.objects.filter(department=department, is_active=True).order_by("weekday", "time_slot"),
        )
    ).order_by("user__first_name", "user__username", "id")

    attendance_today = Attendance.objects.filter(department=department).select_related(
        "teacher__user",
        "student__user",
        "marked_by",
    ).filter(date=today)

    recent_lessons = Lesson.objects.filter(department=department).select_related(
        "student__user",
        "teacher__user",
        "created_by",
    ).order_by("-date", "-updated_at", "-id")[:80]

    recent_plans = MonthlyLessonPlan.objects.filter(department=department).select_related(
        "student__user",
        "teacher__user",
        "created_by",
    ).order_by("-year", "-month", "-updated_at", "-id")[:60]

    if is_teacher_role(user):
        try:
            teacher = user.teacher_profile
            teachers = teachers.filter(id=teacher.id)
            students = students.filter(teacher=teacher)
            attendance_today = attendance_today.filter(Q(teacher=teacher) | Q(student__teacher=teacher))
            recent_lessons = recent_lessons.filter(teacher=teacher)
            recent_plans = recent_plans.filter(teacher=teacher)
        except TeacherProfile.DoesNotExist:
            pass

    elif is_student_role(user):
        try:
            student = user.student_profile
            teachers = teachers.filter(id=student.teacher_id)
            students = students.filter(id=student.id)
            attendance_today = attendance_today.filter(student=student)
            recent_lessons = recent_lessons.filter(student=student)
            recent_plans = recent_plans.filter(student=student)
        except StudentProfile.DoesNotExist:
            pass

    teacher_lines = []
    for teacher in teachers[:80]:
        teacher_students = StudentProfile.objects.filter(department=department, teacher=teacher).select_related("user")
        teacher_lines.append(
            f"- Teacher: {teacher.user.get_full_name() or teacher.user.username} "
            f"| ID: {teacher.id} "
            f"| Username: {teacher.user.username} "
            f"| Students: {teacher_students.count()} "
            f"| Phone: {teacher.phone or 'N/A'}"
        )

    student_lines = []
    weekday_label = {
        "monday": "Monday",
        "tuesday": "Tuesday",
        "wednesday": "Wednesday",
        "thursday": "Thursday",
        "friday": "Friday",
        "saturday": "Saturday",
        "sunday": "Sunday",
    }

    for student in students[:200]:
        active_schedules = list(student.schedules.all())
        days = []
        times = []

        for schedule in active_schedules:
            day = weekday_label.get(schedule.weekday, schedule.weekday)
            if day and day not in days:
                days.append(day)

            if schedule.time_slot:
                time_value = str(schedule.time_slot)[:5]
                if time_value not in times:
                    times.append(time_value)

        student_lines.append(
            f"- Student: {student.user.get_full_name() or student.user.username} "
            f"| ID: {student.id} "
            f"| Username: {student.user.username} "
            f"| Teacher: {student.teacher.user.get_full_name() or student.teacher.user.username} "
            f"| Days: {', '.join(days) if days else 'No days'} "
            f"| Time: {', '.join(times) if times else 'No time'} "
            f"| Phone: {student.phone or 'N/A'}"
        )

    attendance_counts = Counter(attendance_today.values_list("status", flat=True))

    lesson_lines = []
    for lesson in recent_lessons:
        lesson_lines.append(
            f"- {lesson.date}: {lesson.student} with {lesson.teacher} "
            f"| Subject: {lesson.subject or 'N/A'} "
            f"| Topic: {lesson.topic_summary or lesson.title or 'N/A'} "
            f"| Progress: {lesson.progress_status or 'unmarked'}"
        )

    plan_lines = []
    for plan in recent_plans:
        plan_text = getattr(plan, "plan_text", "") or getattr(plan, "target_summary", "") or ""
        plan_lines.append(
            f"- {plan.month}/{plan.year}: {plan.student} with {plan.teacher} "
            f"| Subject: {plan.subject or 'N/A'} "
            f"| Status: {plan.status or 'N/A'} "
            f"| Plan: {plan_text[:180] or 'N/A'}"
        )

    return f"""
You are the AI Assistant for Iqra Virtual School, {department.name}.

CURRENT USER:
- Username: {user.username}
- Role: {user.role}
- Full name: {user_display_name(user)}
- Today: {today_name}, {today}

IMPORTANT RULES:
- Answer ONLY the question asked. Do not add unrelated information.
- Do not mention today's schedule unless the user specifically asks about schedule or classes.
- If the answer is not available in the data, say you do not have that information.
- Be helpful, clear, and concise.
- For lists, use clean bullet points.
- Never invent students, teachers, attendance, lessons, or schedules.

SCHOOL SUMMARY:
- Total teachers visible to this user: {teachers.count()}
- Total students visible to this user: {students.count()}
- Attendance today:
  - Present: {attendance_counts.get('present', 0)}
  - Absent: {attendance_counts.get('absent', 0)}
  - Leave: {attendance_counts.get('leave', 0)}
  - Total marked: {attendance_today.count()}

TEACHERS:
{chr(10).join(teacher_lines) if teacher_lines else 'No teacher data available.'}

STUDENTS AND SCHEDULES:
{chr(10).join(student_lines) if student_lines else 'No student data available.'}

RECENT LESSONS:
{chr(10).join(lesson_lines) if lesson_lines else 'No recent lesson data available.'}

RECENT MONTHLY PLANS:
{chr(10).join(plan_lines) if plan_lines else 'No monthly plan data available.'}
""".strip()


class GeminiAssistantView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        department = quran_department_for_user(user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        message = str(request.data.get("message", "") or "").strip()
        history = request.data.get("history", [])

        if not message:
            return Response({"detail": "message is required."}, status=status.HTTP_400_BAD_REQUEST)

        api_key, model, _key_source = get_gemini_credentials()

        if not api_key:
            return Response(
                {"detail": "The Gemini API key is not configured."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
        school_context = build_assistant_school_context(user)
        safe_history = []

        if isinstance(history, list):
            for item in history[-8:]:
                role = str(item.get("role", "")).strip()
                content = str(item.get("content", "")).strip()

                if role not in ["user", "assistant"]:
                    continue

                if not content:
                    continue

                safe_history.append({
                    "role": "user" if role == "user" else "model",
                    "parts": [{"text": content[:1500]}],
                })

        contents = [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            f"{school_context}\n\n"
                            f"User question:\n{message}"
                        )
                    }
                ],
            }
        ]

        if safe_history:
            contents = safe_history + contents

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

        try:
            response = requests.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": api_key,
                },
                json={
                    "contents": contents,
                    "generationConfig": {
                        "temperature": 0.2,
                        "maxOutputTokens": 900,
                    },
                },
                timeout=35,
            )

            if response.status_code >= 400:
                return Response(
                    {
                        "detail": "Gemini API request failed.",
                        "status_code": response.status_code,
                        "error": response.text[:1000],
                    },
                    status=status.HTTP_502_BAD_GATEWAY,
                )

            data = response.json()
            candidates = data.get("candidates", [])

            if not candidates:
                return Response({"reply": "I could not generate an answer. Please try again."})

            parts = candidates[0].get("content", {}).get("parts", [])
            reply = "".join(
                str(part.get("text", ""))
                for part in parts
                if isinstance(part, dict)
            ).strip()

            return Response({"reply": reply or "I could not find a clear answer."})

        except requests.RequestException as exc:
            return Response(
                {
                    "detail": "Could not connect to Gemini API.",
                    "error": str(exc),
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )
