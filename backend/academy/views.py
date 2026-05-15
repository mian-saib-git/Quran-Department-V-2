from collections import Counter
from datetime import datetime, date
import os
import requests

from django.utils import timezone
from django.db.models import Q, Prefetch

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated

from .models import (
    TeacherProfile,
    StudentProfile,
    StudentSubject,
    ClassSchedule,
    Attendance,
    Lesson,
    MonthlyLessonPlan,
)


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
        "password_change_allowed": False,
        "password_change_message": (
            "To change your password, contact the developer on WhatsApp: wa.me/923189995518"
            if user.role == "coordinator"
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


def assigned_subjects_for_student(student):
    if hasattr(student, "prefetched_active_subjects"):
        subjects = student.prefetched_active_subjects
    else:
        subjects = StudentSubject.objects.filter(
            student=student,
            is_active=True,
        ).order_by("subject", "custom_subject_name", "id")

    return [student_subject_payload(item) for item in subjects]


def student_payload(student):
    return {
        "id": student.id,
        "user_id": student.user_id,
        "username": student.user.username,
        "name": student.user.get_full_name() or student.user.username,
        "phone": student.phone,
        "notes": student.notes,
        "teacher_id": student.teacher_id,
        "teacher_name": str(student.teacher),
        "assigned_subjects": assigned_subjects_for_student(student),
    }


def schedule_payload(schedule):
    return {
        "id": schedule.id,
        "student": student_payload(schedule.student),
        "teacher": teacher_payload(schedule.teacher),
        "weekday": schedule.weekday,
        "time_slot": str(schedule.time_slot),
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


def monthly_plan_payload(plan):
    plan_text = getattr(plan, "plan_text", "") or ""
    target_summary = getattr(plan, "target_summary", "") or ""

    return {
        "id": plan.id,
        "student_id": plan.student_id,
        "student_name": str(plan.student),
        "teacher_id": plan.teacher_id,
        "teacher_name": str(plan.teacher),

        "month": plan.month,
        "year": plan.year,
        "subject": plan.subject,

        # New correct monthly plan field
        "plan_text": plan_text,

        # Old keys kept as empty strings so old frontend code does not crash
        "week_1_plan": "",
        "week_2_plan": "",
        "week_3_plan": "",
        "week_4_plan": "",
        "week_5_plan": "",

        # Kept for compatibility
        "target_summary": target_summary or plan_text,
        "notes": plan.notes,
        "status": plan.status,

        "created_by": plan.created_by.username,
        "created_by_id": plan.created_by.id,
        "created_by_username": plan.created_by.username,
        "created_by_name": user_display_name(plan.created_by),
        "created_by_role": plan.created_by.role,

        "created_at": plan.created_at.isoformat(),
        "updated_at": plan.updated_at.isoformat(),
    }


def safe_int(value, fallback=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def model_has_field(model_class, field_name):
    return any(field.name == field_name for field in model_class._meta.fields)


def student_has_subject(student, subject_name):
    """
    Subject assignment is no longer restricted by coordinator.
    Teachers can create lessons and monthly plans for any subject.
    This function is kept only for backward compatibility with older code.
    """
    subject_name = str(subject_name or "").strip()
    return bool(subject_name)


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

    best_status = max(
        student_item["progress_counts"].items(),
        key=lambda pair: pair[1],
    )[0]

    if best_status != "blank":
        summary += f" Overall progress was mostly {best_status.replace('_', ' ')}."

    if student_item["topics"]:
        topic_preview = student_item["topics"][:5]
        summary += f" Main topics: {', '.join(topic_preview)}."

    return summary


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
# Dashboard API
# ============================================================

class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        active_subjects_prefetch = Prefetch(
            "assigned_subjects",
            queryset=StudentSubject.objects.filter(is_active=True).order_by(
                "subject",
                "custom_subject_name",
                "id",
            ),
            to_attr="prefetched_active_subjects",
        )

        schedule_prefetch = Prefetch(
            "schedules",
            queryset=ClassSchedule.objects.filter(is_active=True).order_by(
                "weekday",
                "time_slot",
                "id",
            ),
            to_attr="prefetched_active_schedules",
        )

        # -----------------------------
        # Coordinator dashboard
        # -----------------------------
        if user.role == "coordinator":
            return Response({
                "user": user_payload(user),
                "dashboard_type": "coordinator",
                "counts": {
                    "teachers": TeacherProfile.objects.count(),
                    "students": StudentProfile.objects.count(),
                    "active_schedules": ClassSchedule.objects.filter(is_active=True).count(),
                    "attendance_records": Attendance.objects.count(),
                    "lessons": Lesson.objects.count(),
                    "student_subjects": StudentSubject.objects.filter(is_active=True).count(),
                    "monthly_lesson_plans": MonthlyLessonPlan.objects.count(),
                },
                "recent_attendance": [
                    attendance_payload(item)
                    for item in Attendance.objects.select_related(
                        "teacher__user",
                        "student__user",
                        "marked_by",
                    ).order_by("-date", "-updated_at", "-id")[:50]
                ],
                "schedules": [
                    schedule_payload(item)
                    for item in ClassSchedule.objects.select_related(
                        "teacher__user",
                        "student__user",
                    ).prefetch_related(
                        "student__assigned_subjects",
                    ).filter(
                        is_active=True,
                    ).order_by("weekday", "time_slot", "id")[:500]
                ],
                "lessons": [
                    lesson_payload(item)
                    for item in Lesson.objects.select_related(
                        "teacher__user",
                        "student__user",
                        "created_by",
                    ).order_by("-date", "-updated_at", "-id")[:100]
                ],
            })

        # -----------------------------
        # Teacher dashboard
        # -----------------------------
        if user.role == "teacher":
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response({
                    "user": user_payload(user),
                    "dashboard_type": "teacher",
                    "error": "Teacher profile not found.",
                }, status=status.HTTP_404_NOT_FOUND)

            students = StudentProfile.objects.select_related(
                "user",
                "teacher__user",
            ).prefetch_related(
                active_subjects_prefetch,
                schedule_prefetch,
            ).filter(
                teacher=teacher,
            ).order_by("user__first_name", "user__username", "id")

            schedules = ClassSchedule.objects.select_related(
                "teacher__user",
                "student__user",
            ).prefetch_related(
                "student__assigned_subjects",
            ).filter(
                teacher=teacher,
                is_active=True,
            ).order_by("weekday", "time_slot", "student__user__first_name", "id")

            attendance = Attendance.objects.select_related(
                "teacher__user",
                "student__user",
                "marked_by",
            ).filter(
                entity_type=Attendance.EntityType.STUDENT,
                student__teacher=teacher,
            ).order_by("-date", "-updated_at", "-id")[:500]

            lessons = Lesson.objects.select_related(
                "teacher__user",
                "student__user",
                "created_by",
            ).filter(
                teacher=teacher,
            ).order_by("-date", "-updated_at", "-id")[:300]

            monthly_plans = MonthlyLessonPlan.objects.select_related(
                "teacher__user",
                "student__user",
                "created_by",
            ).filter(
                teacher=teacher,
            ).order_by("-year", "-month", "student__user__first_name", "subject", "-id")[:300]

            return Response({
                "user": user_payload(user),
                "dashboard_type": "teacher",
                "teacher": teacher_payload(teacher),
                "students": [student_payload(item) for item in students],
                "schedules": [schedule_payload(item) for item in schedules],
                "attendance": [attendance_payload(item) for item in attendance],
                "lessons": [lesson_payload(item) for item in lessons],
                "monthly_lesson_plans": [monthly_plan_payload(item) for item in monthly_plans],
                "permissions": {
                    "can_mark_attendance": False,
                    "can_edit_attendance": False,
                    "can_view_attendance": True,
                    "can_create_lessons": True,
                    "can_create_monthly_plans": True,
                },
            })

        # -----------------------------
        # Student dashboard
        # -----------------------------
        if user.role == "student":
            try:
                student = StudentProfile.objects.select_related(
                    "user",
                    "teacher__user",
                ).prefetch_related(
                    active_subjects_prefetch,
                    schedule_prefetch,
                ).get(user=user)
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
                student=student,
                is_active=True,
            ).order_by("weekday", "time_slot", "id")

            attendance = Attendance.objects.select_related(
                "teacher__user",
                "student__user",
                "marked_by",
            ).filter(
                entity_type=Attendance.EntityType.STUDENT,
                student=student,
            ).order_by("-date", "-updated_at", "-id")[:300]

            lessons = Lesson.objects.select_related(
                "teacher__user",
                "student__user",
                "created_by",
            ).filter(
                student=student,
            ).order_by("-date", "-updated_at", "-id")[:300]

            monthly_plans = MonthlyLessonPlan.objects.select_related(
                "teacher__user",
                "student__user",
                "created_by",
            ).filter(
                student=student,
            ).order_by("-year", "-month", "subject", "-id")[:200]

            return Response({
                "user": user_payload(user),
                "dashboard_type": "student",
                "student": student_payload(student),
                "schedules": [schedule_payload(item) for item in schedules],
                "attendance": [attendance_payload(item) for item in attendance],
                "lessons": [lesson_payload(item) for item in lessons],
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

        student_id = safe_int(request.query_params.get("student_id"))
        teacher_id = safe_int(request.query_params.get("teacher_id"))
        month = safe_int(request.query_params.get("month"))
        year = safe_int(request.query_params.get("year"))

        lessons = Lesson.objects.select_related(
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

        if user.role == "coordinator":
            pass

        elif user.role == "teacher":
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            lessons = lessons.filter(teacher=teacher)

        elif user.role == "student":
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
            return Response(
                {"detail": "student_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not subject:
            return Response(
                {"detail": "subject is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not topic_summary:
            return Response(
                {"detail": "topic_summary is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        allowed_statuses = [
            "excellent",
            "good",
            "satisfactory",
            "needs_improvement",
            "",
        ]

        if progress_status not in allowed_statuses:
            return Response(
                {"detail": "Invalid progress_status."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            student = StudentProfile.objects.select_related(
                "teacher",
                "teacher__user",
                "user",
            ).get(id=student_id)
        except StudentProfile.DoesNotExist:
            return Response(
                {"detail": "Student not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if user.role == "teacher":
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if student.teacher_id != teacher.id:
                return Response(
                    {"detail": "You can only create lessons for your assigned students."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        else:
            teacher_id = request.data.get("teacher_id") or student.teacher_id

            try:
                teacher = TeacherProfile.objects.get(id=teacher_id)
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        lesson = Lesson.objects.create(
            student=student,
            teacher=teacher,
            date=lesson_date,
            subject=subject,
            topic_summary=topic_summary,
            title=topic_summary[:200],
            notes=notes,
            progress_status=progress_status,
            remarks=remarks,
            lesson_data=lesson_data,
            created_by=user,
        )

        return Response(
            lesson_payload(lesson),
            status=status.HTTP_201_CREATED,
        )

# ============================================================
# Attendance API
# ============================================================

class AttendanceListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        date_value = str(request.query_params.get("date", "")).strip()
        student_id = str(request.query_params.get("student_id", "")).strip()
        teacher_id = str(request.query_params.get("teacher_id", "")).strip()

        attendance = Attendance.objects.select_related(
            "teacher__user",
            "student__user",
            "marked_by",
        )

        if date_value:
            attendance = attendance.filter(date=date_value)

        if student_id and student_id.isdigit():
            attendance = attendance.filter(student_id=int(student_id))

        if teacher_id and teacher_id.isdigit():
            attendance = attendance.filter(teacher_id=int(teacher_id))

        if user.role == "coordinator":
            pass

        elif user.role == "teacher":
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            attendance = attendance.filter(
                Q(teacher=teacher) | Q(student__teacher=teacher)
            )

        elif user.role == "student":
            try:
                student = user.student_profile
            except StudentProfile.DoesNotExist:
                return Response(
                    {"detail": "Student profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            attendance = attendance.filter(student=student)

        else:
            return Response(
                {"detail": "Invalid role."},
                status=status.HTTP_403_FORBIDDEN,
            )

        attendance = attendance.order_by("-date", "-updated_at", "-id")[:1000]

        return Response({
            "count": len(attendance),
            "results": [attendance_payload(item) for item in attendance],
        })

    def post(self, request):
        user = request.user

        if user.role != "coordinator":
            return Response(
                {"detail": "Only coordinators can mark attendance."},
                status=status.HTTP_403_FORBIDDEN,
            )

        entity_type = str(request.data.get("entity_type", "")).strip().lower()
        teacher_id = request.data.get("teacher_id")
        student_id = request.data.get("student_id")
        date_value = request.data.get("date") or timezone.localdate().isoformat()
        status_value = str(request.data.get("status", "")).strip().lower()

        if entity_type not in ["teacher", "student"]:
            return Response(
                {"detail": "entity_type must be teacher or student."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if status_value not in ["present", "absent", "leave"]:
            return Response(
                {"detail": "status must be present, absent, or leave."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if entity_type == "teacher":
            if not teacher_id:
                return Response(
                    {"detail": "teacher_id is required for teacher attendance."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                teacher = TeacherProfile.objects.get(id=teacher_id)
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            Attendance.objects.filter(
                entity_type=Attendance.EntityType.TEACHER,
                teacher=teacher,
                date=date_value,
            ).delete()

            attendance = Attendance.objects.create(
                entity_type=Attendance.EntityType.TEACHER,
                teacher=teacher,
                student=None,
                date=date_value,
                status=status_value,
                marked_by=user,
            )

            return Response(
                attendance_payload(attendance),
                status=status.HTTP_201_CREATED,
            )

        if not student_id:
            return Response(
                {"detail": "student_id is required for student attendance."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            student = StudentProfile.objects.get(id=student_id)
        except StudentProfile.DoesNotExist:
            return Response(
                {"detail": "Student not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        Attendance.objects.filter(
            entity_type=Attendance.EntityType.STUDENT,
            student=student,
            date=date_value,
        ).delete()

        attendance = Attendance.objects.create(
            entity_type=Attendance.EntityType.STUDENT,
            teacher=None,
            student=student,
            date=date_value,
            status=status_value,
            marked_by=user,
        )

        return Response(
            attendance_payload(attendance),
            status=status.HTTP_201_CREATED,
        )


class AttendanceDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        user = request.user

        if user.role != "coordinator":
            return Response(
                {"detail": "Only coordinators can delete attendance."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            attendance = Attendance.objects.get(id=pk)
        except Attendance.DoesNotExist:
            return Response(
                {"detail": "Attendance record not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        attendance.delete()

        return Response({
            "detail": "Attendance deleted successfully."
        })


# ============================================================
# Monthly Lesson Plan API
# ============================================================
class MonthlyLessonPlanListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        month = safe_int(request.query_params.get("month"))
        year = safe_int(request.query_params.get("year"))
        student_id = safe_int(request.query_params.get("student_id"))
        teacher_id = safe_int(request.query_params.get("teacher_id"))

        plans = MonthlyLessonPlan.objects.select_related(
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

        if user.role == "coordinator":
            pass

        elif user.role == "teacher":
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            plans = plans.filter(teacher=teacher)

        elif user.role == "student":
            try:
                student = user.student_profile
            except StudentProfile.DoesNotExist:
                return Response(
                    {"detail": "Student profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            plans = plans.filter(student=student)

        else:
            return Response(
                {"detail": "Invalid role."},
                status=status.HTTP_403_FORBIDDEN,
            )

        plans = plans.order_by("-year", "-month", "student__user__first_name", "subject", "-id")

        return Response({
            "count": plans.count(),
            "results": [monthly_plan_payload(item) for item in plans],
        })

    def post(self, request):
        user = request.user

        if user.role not in ["coordinator", "teacher"]:
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
            return Response(
                {"detail": "student_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not month or month < 1 or month > 12:
            return Response(
                {"detail": "month must be between 1 and 12."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not year or year < 2000:
            return Response(
                {"detail": "year is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not subject:
            return Response(
                {"detail": "subject is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not plan_text:
            return Response(
                {"detail": "plan_text is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            student = StudentProfile.objects.select_related(
                "teacher",
                "teacher__user",
                "user",
            ).get(id=student_id)
        except StudentProfile.DoesNotExist:
            return Response(
                {"detail": "Student not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if user.role == "teacher":
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if student.teacher_id != teacher.id:
                return Response(
                    {"detail": "You can only create plans for your assigned students."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        else:
            teacher_id = teacher_id or student.teacher_id

            try:
                teacher = TeacherProfile.objects.get(id=teacher_id)
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

        allowed_statuses = ["planned", "in_progress", "completed"]
        plan_status = str(request.data.get("status", "planned")).strip().lower()

        if plan_status not in allowed_statuses:
            return Response(
                {"detail": "Invalid plan status."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        defaults = {
            "notes": notes,
            "status": plan_status,
            "created_by": user,
        }

        if model_has_field(MonthlyLessonPlan, "plan_text"):
            defaults["plan_text"] = plan_text

        if model_has_field(MonthlyLessonPlan, "target_summary"):
            defaults["target_summary"] = plan_text

        plan, created = MonthlyLessonPlan.objects.update_or_create(
            student=student,
            teacher=teacher,
            month=month,
            year=year,
            subject=subject,
            defaults=defaults,
        )

        return Response(
            monthly_plan_payload(plan),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

class MonthlyLessonPlanDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        user = request.user

        try:
            plan = MonthlyLessonPlan.objects.select_related(
                "student__user",
                "teacher__user",
                "created_by",
            ).get(id=pk)
        except MonthlyLessonPlan.DoesNotExist:
            return Response(
                {"detail": "Monthly lesson plan not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if user.role == "coordinator":
            pass

        elif user.role == "teacher":
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if plan.teacher_id != teacher.id:
                return Response(
                    {"detail": "You can only update your own students' plans."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        else:
            return Response(
                {"detail": "Only coordinators and teachers can update monthly lesson plans."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if "plan_text" in request.data and model_has_field(MonthlyLessonPlan, "plan_text"):
            plan.plan_text = str(request.data.get("plan_text") or "").strip()

        if "target_summary" in request.data and model_has_field(MonthlyLessonPlan, "target_summary"):
            value = str(request.data.get("target_summary") or "").strip()
            plan.target_summary = value

            if model_has_field(MonthlyLessonPlan, "plan_text") and not getattr(plan, "plan_text", ""):
                plan.plan_text = value

        if "notes" in request.data:
            plan.notes = str(request.data.get("notes") or "").strip()

        if "status" in request.data:
            value = str(request.data.get("status") or "").strip().lower()

            if value not in ["planned", "in_progress", "completed"]:
                return Response(
                    {"detail": "Invalid plan status."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            plan.status = value

        plan.save()

        return Response(monthly_plan_payload(plan))

    def delete(self, request, pk):
        user = request.user

        if user.role != "coordinator":
            return Response(
                {"detail": "Only coordinators can delete monthly lesson plans."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            plan = MonthlyLessonPlan.objects.get(id=pk)
        except MonthlyLessonPlan.DoesNotExist:
            return Response(
                {"detail": "Monthly lesson plan not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        plan.delete()

        return Response({
            "detail": "Monthly lesson plan deleted successfully."
        })


class MonthlyLessonSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        month = safe_int(request.query_params.get("month"))
        year = safe_int(request.query_params.get("year"))
        student_id = safe_int(request.query_params.get("student_id"))
        teacher_id = safe_int(request.query_params.get("teacher_id"))

        if not month or month < 1 or month > 12:
            return Response(
                {"detail": "month must be between 1 and 12."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not year or year < 2000:
            return Response(
                {"detail": "year is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        first_day, next_month = build_month_range(year, month)

        lessons = Lesson.objects.select_related(
            "student__user",
            "teacher__user",
            "created_by",
        ).filter(
            date__gte=first_day,
            date__lt=next_month,
        )

        plans = MonthlyLessonPlan.objects.select_related(
            "student__user",
            "teacher__user",
            "created_by",
        ).filter(
            month=month,
            year=year,
        )

        if student_id:
            lessons = lessons.filter(student_id=student_id)
            plans = plans.filter(student_id=student_id)

        if teacher_id:
            lessons = lessons.filter(teacher_id=teacher_id)
            plans = plans.filter(teacher_id=teacher_id)

        if user.role == "coordinator":
            pass

        elif user.role == "teacher":
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            lessons = lessons.filter(teacher=teacher)
            plans = plans.filter(teacher=teacher)

        elif user.role == "student":
            try:
                student = user.student_profile
            except StudentProfile.DoesNotExist:
                return Response(
                    {"detail": "Student profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            lessons = lessons.filter(student=student)
            plans = plans.filter(student=student)

        else:
            return Response(
                {"detail": "Invalid role."},
                status=status.HTTP_403_FORBIDDEN,
            )

        lesson_rows = list(lessons.order_by("student__user__first_name", "date", "id"))
        plan_rows = list(plans.order_by("student__user__first_name", "subject", "id"))

        progress_counts = {
            "excellent": 0,
            "good": 0,
            "satisfactory": 0,
            "needs_improvement": 0,
            "blank": 0,
        }

        subjects = Counter()
        students = {}

        for item in lesson_rows:
            status_value = item.progress_status or "blank"
            progress_counts[status_value] = progress_counts.get(status_value, 0) + 1

            if item.subject:
                subjects[item.subject] += 1

            key = item.student_id

            if key not in students:
                students[key] = {
                    "student_id": item.student_id,
                    "student_name": str(item.student),
                    "teacher_id": item.teacher_id,
                    "teacher_name": str(item.teacher),
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

            students[key]["total_lessons"] += 1

            if item.subject:
                students[key]["subjects"][item.subject] += 1

            students[key]["progress_counts"][status_value] = (
                students[key]["progress_counts"].get(status_value, 0) + 1
            )

            if item.topic_summary:
                students[key]["topics"].append(item.topic_summary)

            if item.remarks:
                students[key]["remarks"].append(item.remarks)

        student_summaries = []

        for item in students.values():
            auto_summary = build_student_auto_summary(item)

            student_summaries.append({
                "student_id": item["student_id"],
                "student_name": item["student_name"],
                "teacher_id": item["teacher_id"],
                "teacher_name": item["teacher_name"],
                "total_lessons": item["total_lessons"],
                "subjects": dict(item["subjects"]),
                "progress_counts": item["progress_counts"],
                "topics": item["topics"][:20],
                "remarks": item["remarks"][:20],
                "auto_summary": auto_summary,
            })

        return Response({
            "month": month,
            "year": year,
            "total_lessons": len(lesson_rows),
            "total_plans": len(plan_rows),
            "subjects": dict(subjects),
            "progress_counts": progress_counts,
            "plans": [monthly_plan_payload(item) for item in plan_rows],
            "lessons": [lesson_payload(item) for item in lesson_rows],
            "student_summaries": student_summaries,
        })


# ============================================================
# Frontend state sync helpers
# ============================================================

def frontend_teacher_payload(teacher):
    user = teacher.user

    return {
        "id": str(teacher.id),
        "name": user.get_full_name() or user.username,
        "fatherName": teacher.father_name,
        "email": user.email,
        "phone": teacher.phone,
        "address": teacher.address,
        "joiningDate": str(teacher.joining_date) if teacher.joining_date else "",
        "notes": teacher.notes,
        "photoUrl": "",
        "loginPin": "",
        "salary": 0,
        "subjects": [
            item.display_name
            for item in StudentSubject.objects.filter(
                student__teacher=teacher,
                is_active=True,
            ).order_by("subject", "custom_subject_name", "id")
        ],
    }


def frontend_student_payload(student):
    schedule = student.schedules.filter(is_active=True).order_by("weekday", "time_slot").first()

    class_days = list(
        student.schedules.filter(is_active=True)
        .order_by("weekday", "time_slot")
        .values_list("weekday", flat=True)
    )

    weekday_map = {
        "monday": "Monday",
        "tuesday": "Tuesday",
        "wednesday": "Wednesday",
        "thursday": "Thursday",
        "friday": "Friday",
        "saturday": "Saturday",
        "sunday": "Sunday",
    }

    class_days = [weekday_map.get(day, day) for day in class_days]

    if not class_days:
        class_days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

    return {
        "id": str(student.id),
        "name": student.user.get_full_name() or student.user.username,
        "teacherId": str(student.teacher_id),
        "timeSlot": str(schedule.time_slot)[:5] if schedule else "16:00",
        "classType": f"{len(class_days)} Day",
        "classDays": class_days,
        "loginId": student.user.username,
    }


def frontend_attendance_payload(record):
    if record.entity_type == Attendance.EntityType.TEACHER:
        entity_id = str(record.teacher_id)
        entity_type = "Teacher"
        class_key = ""
    else:
        entity_id = str(record.student_id)
        entity_type = "Student"
        class_key = ""

    status_map = {
        Attendance.Status.PRESENT: "Present",
        Attendance.Status.ABSENT: "Absent",
        Attendance.Status.LEAVE: "Leave",
    }

    return {
        "id": str(record.id),
        "entityId": entity_id,
        "entityType": entity_type,
        "date": str(record.date),
        "classKey": class_key,
        "status": status_map.get(record.status, "Present"),

        "markedById": str(record.marked_by_id) if record.marked_by_id else "",
        "markedByUsername": record.marked_by.username if record.marked_by else "",
        "markedByName": user_display_name(record.marked_by) if record.marked_by else "",
        "markedByRole": record.marked_by.role if record.marked_by else "",

        "timestamp": int(record.updated_at.timestamp() * 1000) if record.updated_at else 0,
    }


def parse_frontend_date(value):
    value = str(value or "").strip()
    if not value:
        return timezone.localdate()

    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return timezone.localdate()


def parse_frontend_time(value):
    value = str(value or "").strip() or "16:00"

    for fmt in ["%H:%M", "%H:%M:%S"]:
        try:
            return datetime.strptime(value, fmt).time()
        except ValueError:
            pass

    return datetime.strptime("16:00", "%H:%M").time()


def frontend_status_to_django(value):
    value = str(value or "").strip().lower()

    if value == "absent":
        return Attendance.Status.ABSENT

    if value == "leave":
        return Attendance.Status.LEAVE

    return Attendance.Status.PRESENT


def frontend_entity_to_django(value):
    value = str(value or "").strip().lower()

    if value == "teacher":
        return Attendance.EntityType.TEACHER

    return Attendance.EntityType.STUDENT


def frontend_weekday_to_django(value):
    value = str(value or "").strip().lower()

    mapping = {
        "monday": ClassSchedule.WeekDay.MONDAY,
        "tuesday": ClassSchedule.WeekDay.TUESDAY,
        "wednesday": ClassSchedule.WeekDay.WEDNESDAY,
        "thursday": ClassSchedule.WeekDay.THURSDAY,
        "friday": ClassSchedule.WeekDay.FRIDAY,
        "saturday": ClassSchedule.WeekDay.SATURDAY,
        "sunday": ClassSchedule.WeekDay.SUNDAY,
    }

    return mapping.get(value)


# ============================================================
# Academy State API
# ============================================================

class AcademyStateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        schedules_prefetch = Prefetch(
            "schedules",
            queryset=ClassSchedule.objects.filter(is_active=True).order_by("weekday", "time_slot"),
        )

        if user.role == "coordinator":
            teachers = TeacherProfile.objects.select_related("user").order_by("id")

            students = StudentProfile.objects.select_related(
                "user",
                "teacher__user",
            ).prefetch_related(
                schedules_prefetch,
            ).order_by("user__first_name", "user__username", "id")

            attendance_qs = Attendance.objects.select_related(
                "teacher__user",
                "student__user",
                "marked_by",
            ).order_by("-date", "-id")[:2000]

        elif user.role == "teacher":
            try:
                teacher = user.teacher_profile
            except TeacherProfile.DoesNotExist:
                return Response(
                    {"detail": "Teacher profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            teachers = TeacherProfile.objects.select_related("user").filter(id=teacher.id)

            students = StudentProfile.objects.select_related(
                "user",
                "teacher__user",
            ).prefetch_related(
                schedules_prefetch,
            ).filter(
                teacher=teacher,
            ).order_by("user__first_name", "user__username", "id")

            attendance_qs = Attendance.objects.select_related(
                "teacher__user",
                "student__user",
                "marked_by",
            ).filter(
                Q(teacher=teacher) | Q(student__teacher=teacher)
            ).order_by("-date", "-id")[:1000]

        elif user.role == "student":
            try:
                student = user.student_profile
            except StudentProfile.DoesNotExist:
                return Response(
                    {"detail": "Student profile not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            teachers = TeacherProfile.objects.select_related("user").filter(id=student.teacher_id)

            students = StudentProfile.objects.select_related(
                "user",
                "teacher__user",
            ).prefetch_related(
                schedules_prefetch,
            ).filter(
                id=student.id,
            )

            attendance_qs = Attendance.objects.select_related(
                "teacher__user",
                "student__user",
                "marked_by",
            ).filter(
                student=student,
            ).order_by("-date", "-id")[:500]

        else:
            return Response(
                {"detail": "Invalid role."},
                status=status.HTTP_403_FORBIDDEN,
            )

        weekday_label = {
            "monday": "Monday",
            "tuesday": "Tuesday",
            "wednesday": "Wednesday",
            "thursday": "Thursday",
            "friday": "Friday",
            "saturday": "Saturday",
            "sunday": "Sunday",
        }

        teacher_rows = []

        for teacher in teachers:
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
                "subjects": [
                    item.display_name
                    for item in StudentSubject.objects.filter(
                        student__teacher=teacher,
                        is_active=True,
                    ).order_by("subject", "custom_subject_name", "id")
                ],
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
                    time_slots.append(str(schedule.time_slot)[:5])

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

            student_rows.append({
                "id": str(student.id),
                "name": student.user.get_full_name() or student.user.username,
                "teacherId": str(student.teacher_id),
                "timeSlot": time_slot,
                "classType": class_type,
                "classDays": class_days,
                "loginId": student.user.username,
            })

        attendance_rows = []

        for item in attendance_qs:
            if item.entity_type == Attendance.EntityType.TEACHER:
                entity_id = item.teacher_id
                entity_type = "Teacher"
                class_key = ""
            else:
                entity_id = item.student_id
                entity_type = "Student"
                class_key = ""

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

    def post(self, request):
        user = request.user

        if user.role != "coordinator":
            return Response(
                {"detail": "Only coordinators can sync state."},
                status=status.HTTP_403_FORBIDDEN,
            )

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
                teacher = TeacherProfile.objects.select_related("user").get(id=int(teacher_id))
            except TeacherProfile.DoesNotExist:
                continue

            teacher.father_name = str(teacher_item.get("fatherName", teacher.father_name) or "").strip()
            teacher.phone = str(teacher_item.get("phone", teacher.phone) or "").strip()
            teacher.address = str(teacher_item.get("address", teacher.address) or "").strip()
            teacher.notes = str(teacher_item.get("notes", teacher.notes) or "").strip()

            joining_date = str(teacher_item.get("joiningDate", "") or "").strip()

            if joining_date:
                teacher.joining_date = parse_frontend_date(joining_date)

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
                student = StudentProfile.objects.select_related("user", "teacher").get(id=int(student_id))
            except StudentProfile.DoesNotExist:
                continue

            name = str(student_item.get("name", "") or "").strip()

            if name:
                student.user.first_name = name
                student.user.last_name = ""
                student.user.save()

            teacher_id = str(student_item.get("teacherId", "")).strip()

            if teacher_id.isdigit():
                try:
                    student.teacher = TeacherProfile.objects.get(id=int(teacher_id))
                    student.save()
                except TeacherProfile.DoesNotExist:
                    pass

            time_slot = parse_frontend_time(student_item.get("timeSlot"))
            class_days = student_item.get("classDays", [])

            if not isinstance(class_days, list):
                class_days = []

            ClassSchedule.objects.filter(student=student).delete()

            for day in class_days:
                weekday = frontend_weekday_to_django(day)

                if not weekday:
                    continue

                ClassSchedule.objects.create(
                    student=student,
                    teacher=student.teacher,
                    weekday=weekday,
                    time_slot=time_slot,
                    is_active=True,
                )

        latest_attendance = {}

        for item in attendance_data:
            entity_type = frontend_entity_to_django(item.get("entityType"))
            date_value = parse_frontend_date(item.get("date"))
            status_value = frontend_status_to_django(item.get("status"))
            entity_id = str(item.get("entityId", "")).strip()

            if not entity_id.isdigit():
                continue

            key = f"{entity_type}:{entity_id}:{date_value}"
            latest_attendance[key] = {
                "entity_type": entity_type,
                "entity_id": int(entity_id),
                "date": date_value,
                "status": status_value,
            }

        for item in latest_attendance.values():
            entity_type = item["entity_type"]
            entity_id = item["entity_id"]
            date_value = item["date"]
            status_value = item["status"]

            if entity_type == Attendance.EntityType.TEACHER:
                try:
                    teacher = TeacherProfile.objects.get(id=entity_id)
                except TeacherProfile.DoesNotExist:
                    continue

                Attendance.objects.filter(
                    entity_type=Attendance.EntityType.TEACHER,
                    teacher=teacher,
                    date=date_value,
                ).delete()

                Attendance.objects.create(
                    entity_type=Attendance.EntityType.TEACHER,
                    teacher=teacher,
                    student=None,
                    date=date_value,
                    status=status_value,
                    marked_by=user,
                )

            else:
                try:
                    student = StudentProfile.objects.get(id=entity_id)
                except StudentProfile.DoesNotExist:
                    continue

                Attendance.objects.filter(
                    entity_type=Attendance.EntityType.STUDENT,
                    student=student,
                    date=date_value,
                ).delete()

                Attendance.objects.create(
                    entity_type=Attendance.EntityType.STUDENT,
                    teacher=None,
                    student=student,
                    date=date_value,
                    status=status_value,
                    marked_by=user,
                )

        return Response({"detail": "State synced successfully."})

# ============================================================
# Gemini AI Assistant API
# ============================================================

def build_assistant_school_context(user):
    today = timezone.localdate()
    today_name = today.strftime("%A")

    teachers = TeacherProfile.objects.select_related("user").order_by("user__first_name", "user__username", "id")
    students = StudentProfile.objects.select_related("user", "teacher__user").prefetch_related(
        Prefetch(
            "schedules",
            queryset=ClassSchedule.objects.filter(is_active=True).order_by("weekday", "time_slot"),
        )
    ).order_by("user__first_name", "user__username", "id")

    attendance_today = Attendance.objects.select_related(
        "teacher__user",
        "student__user",
        "marked_by",
    ).filter(date=today)

    recent_lessons = Lesson.objects.select_related(
        "student__user",
        "teacher__user",
        "created_by",
    ).order_by("-date", "-updated_at", "-id")[:80]

    recent_plans = MonthlyLessonPlan.objects.select_related(
        "student__user",
        "teacher__user",
        "created_by",
    ).order_by("-year", "-month", "-updated_at", "-id")[:60]

    if user.role == "teacher":
        try:
            teacher = user.teacher_profile
            teachers = teachers.filter(id=teacher.id)
            students = students.filter(teacher=teacher)
            attendance_today = attendance_today.filter(Q(teacher=teacher) | Q(student__teacher=teacher))
            recent_lessons = recent_lessons.filter(teacher=teacher)
            recent_plans = recent_plans.filter(teacher=teacher)
        except TeacherProfile.DoesNotExist:
            pass

    elif user.role == "student":
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
        teacher_students = StudentProfile.objects.filter(teacher=teacher).select_related("user")
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
You are the AI Assistant for Iqra Virtual School, Qur'an Department.

CURRENT USER:
- Username: {user.username}
- Role: {user.role}
- Full name: {user_display_name(user)}
- Today: {today_name}, {today}

IMPORTANT RULES:
- Answer only using the school data below.
- If the answer is not available in the data, say you do not have that information.
- Be helpful, clear, and concise.
- For lists, use clean bullet points.
- For schedules, include teacher, student, day, and time when available.
- Never invent students, teachers, attendance, lessons, or schedules.

SCHOOL SUMMARY:
- Total teachers visible to this user: {teachers.count()}
- Total students visible to this user: {students.count()}
- Attendance today:
  - Present: {attendance_counts.get("present", 0)}
  - Absent: {attendance_counts.get("absent", 0)}
  - Leave: {attendance_counts.get("leave", 0)}
  - Total marked: {attendance_today.count()}

TEACHERS:
{chr(10).join(teacher_lines) if teacher_lines else "No teacher data available."}

STUDENTS AND SCHEDULES:
{chr(10).join(student_lines) if student_lines else "No student data available."}

RECENT LESSONS:
{chr(10).join(lesson_lines) if lesson_lines else "No recent lesson data available."}

RECENT MONTHLY PLANS:
{chr(10).join(plan_lines) if plan_lines else "No monthly plan data available."}
""".strip()


class GeminiAssistantView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user

        message = str(request.data.get("message", "") or "").strip()
        history = request.data.get("history", [])

        if not message:
            return Response(
                {"detail": "message is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        api_key = os.environ.get("GEMINI_API_KEY", "").strip()

        if not api_key:
            return Response(
                {
                    "detail": "GEMINI_API_KEY is not set on the Django server."
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
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
                return Response({
                    "reply": "I could not generate an answer. Please try again."
                })

            parts = (
                candidates[0]
                .get("content", {})
                .get("parts", [])
            )

            reply = "".join(
                str(part.get("text", ""))
                for part in parts
                if isinstance(part, dict)
            ).strip()

            return Response({
                "reply": reply or "I could not find a clear answer."
            })

        except requests.RequestException as exc:
            return Response(
                {
                    "detail": "Could not connect to Gemini API.",
                    "error": str(exc),
                },
                status=status.HTTP_502_BAD_GATEWAY,
            )    