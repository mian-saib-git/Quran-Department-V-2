from __future__ import annotations

from datetime import datetime, time, timedelta

from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from academy.models import Attendance, ClassSchedule, Lesson, StudentProfile, TeacherProfile
from tuition.models import TuitionAttendance, TuitionEnrollment, TuitionSchedule

from .models import (
    Department,
    DepartmentFeature,
    Institution,
    PlatformAuditLog,
    PlatformBackup,
    PlatformMaintenanceWindow,
    PlatformNotice,
    User,
)
from .platform_runtime import is_main_admin


ROLE_LABELS = {
    User.Role.PLATFORM_ADMIN: "Main Admins",
    User.Role.INSTITUTION_ADMIN: "Institution Admins",
    User.Role.DEPARTMENT_ADMIN: "Department Admins",
    User.Role.COORDINATOR: "Coordinators",
    User.Role.TEACHER: "Teachers",
    User.Role.STUDENT: "Students",
}


class PlatformAnalyticsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_main_admin(request.user):
            return Response(
                {"detail": "Only the Main Admin can view platform analytics."},
                status=status.HTTP_403_FORBIDDEN,
            )

        today = timezone.localdate()
        start_day = today - timedelta(days=13)
        now = timezone.now()

        # Related totals are calculated in one aggregate per model, avoiding
        # repeated round trips without changing the counts returned to clients.
        institution_counts = Institution.objects.aggregate(
            total=Count("id"), active=Count("id", filter=Q(is_active=True))
        )
        department_counts = Department.objects.aggregate(
            total=Count("id"), active=Count("id", filter=Q(is_active=True))
        )
        user_counts = User.objects.aggregate(
            total=Count("id"), active=Count("id", filter=Q(is_active=True))
        )
        institutions_total = institution_counts["total"]
        institutions_active = institution_counts["active"]
        departments_total = department_counts["total"]
        departments_active = department_counts["active"]
        users_total = user_counts["total"]
        users_active = user_counts["active"]

        role_rows = User.objects.values("role").annotate(value=Count("id")).order_by("role")
        users_by_role = [
            {"key": row["role"], "label": ROLE_LABELS.get(row["role"], row["role"].replace("_", " ").title()), "value": row["value"]}
            for row in role_rows
        ]

        department_types = [
            {
                "key": row["department_type"],
                "label": "Qur'an" if row["department_type"] == "quran" else row["department_type"].title(),
                "value": row["value"],
            }
            for row in Department.objects.values("department_type").annotate(value=Count("id")).order_by("department_type")
        ]

        top_departments = [
            {
                "id": row["id"],
                "name": row["name"],
                "institution": row["institution__name"],
                "department_type": row["department_type"],
                "users": row["users_count"],
            }
            for row in (
                Department.objects.annotate(
                    users_count=Count("users", filter=Q(users__is_active=True), distinct=True)
                )
                .values("id", "name", "institution__name", "department_type", "users_count")
                .order_by("-users_count", "name")[:8]
            )
        ]

        quran_attendance_by_status = {
            row["status"]: row["value"]
            for row in Attendance.objects.values("status").annotate(value=Count("id"))
        }
        tuition_attendance_by_status = {
            row["status"]: row["value"]
            for row in TuitionAttendance.objects.values("status").annotate(value=Count("id"))
        }
        attendance_status = [
            {
                "status": label,
                "quran": quran_attendance_by_status.get(key, 0),
                "tuition": tuition_attendance_by_status.get(key, 0),
                "total": quran_attendance_by_status.get(key, 0) + tuition_attendance_by_status.get(key, 0),
            }
            for key, label in (("present", "Present"), ("absent", "Absent"), ("leave", "Leave"))
        ]
        attendance_total = sum(item["total"] for item in attendance_status)
        attendance_present = next((item["total"] for item in attendance_status if item["status"] == "Present"), 0)
        attendance_rate = round((attendance_present / attendance_total) * 100, 1) if attendance_total else 0

        quran_activity = {
            row["day"]: row["value"]
            for row in Attendance.objects.filter(date__gte=start_day)
            .values(day=TruncDate("date"))
            .annotate(value=Count("id"))
        }
        tuition_activity = {
            row["day"]: row["value"]
            for row in TuitionAttendance.objects.filter(date__gte=start_day)
            .values(day=TruncDate("date"))
            .annotate(value=Count("id"))
        }
        lessons_activity = {
            row["day"]: row["value"]
            for row in Lesson.objects.filter(date__gte=start_day)
            .values(day=TruncDate("date"))
            .annotate(value=Count("id"))
        }
        # Filter directly on the datetime column so an index on created_at can
        # be used; TruncDate only groups the already-filtered 14-day rows.
        start_at = timezone.make_aware(
            datetime.combine(start_day, time.min), timezone.get_current_timezone()
        )
        audit_activity = {
            row["day"]: row["value"]
            for row in PlatformAuditLog.objects.filter(created_at__gte=start_at)
            .annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(value=Count("id"))
        }
        activity_timeline = []
        for offset in range(14):
            day = start_day + timedelta(days=offset)
            activity_timeline.append(
                {
                    "date": day.isoformat(),
                    "label": day.strftime("%d %b"),
                    "quran_attendance": quran_activity.get(day, 0),
                    "tuition_attendance": tuition_activity.get(day, 0),
                    "lessons": lessons_activity.get(day, 0),
                    "admin_activity": audit_activity.get(day, 0),
                }
            )

        feature_counts = DepartmentFeature.objects.aggregate(
            total=Count("id"), enabled=Count("id", filter=Q(is_enabled=True))
        )
        feature_total = feature_counts["total"]
        feature_enabled = feature_counts["enabled"]
        feature_rate = round((feature_enabled / feature_total) * 100, 1) if feature_total else 0

        feature_by_type = {
            row["department__department_type"]: row
            for row in DepartmentFeature.objects.values("department__department_type")
            .annotate(total=Count("id"), enabled=Count("id", filter=Q(is_enabled=True)))
        }
        # department_types was already loaded above; avoid three extra
        # existence queries when a department has no configured features.
        existing_types = {row["key"] for row in department_types}
        type_feature_health = []
        for department_type in [Department.DepartmentType.QURAN, Department.DepartmentType.TUITION, Department.DepartmentType.GENERAL]:
            counts = feature_by_type.get(department_type, {})
            total = counts.get("total", 0)
            enabled = counts.get("enabled", 0)
            if total or department_type in existing_types:
                type_feature_health.append(
                    {
                        "key": department_type,
                        "label": "Qur'an" if department_type == "quran" else department_type.title(),
                        "enabled": enabled,
                        "total": total,
                        "rate": round((enabled / total) * 100, 1) if total else 0,
                    }
                )

        maintenance_active = PlatformMaintenanceWindow.objects.filter(
            is_active=True,
        ).filter(
            Q(starts_at__isnull=True) | Q(starts_at__lte=now),
            Q(ends_at__isnull=True) | Q(ends_at__gt=now),
        ).count()
        notices_active = PlatformNotice.objects.filter(
            is_active=True,
        ).filter(
            Q(starts_at__isnull=True) | Q(starts_at__lte=now),
            Q(ends_at__isnull=True) | Q(ends_at__gt=now),
        ).count()

        return Response(
            {
                "generated_at": now.isoformat(),
                "summary": {
                    "institutions": institutions_total,
                    "active_institutions": institutions_active,
                    "departments": departments_total,
                    "active_departments": departments_active,
                    "users": users_total,
                    "active_users": users_active,
                    "teachers": TeacherProfile.objects.count(),
                    "students": StudentProfile.objects.count(),
                    "quran_schedules": ClassSchedule.objects.filter(is_active=True).count(),
                    "tuition_schedules": TuitionSchedule.objects.filter(is_active=True).count(),
                    "quran_lessons": Lesson.objects.count(),
                    "tuition_enrollments": TuitionEnrollment.objects.filter(is_active=True).count(),
                    "attendance_records": attendance_total,
                    "attendance_rate": attendance_rate,
                    "feature_enablement_rate": feature_rate,
                    "backups": PlatformBackup.objects.count(),
                    "active_notices": notices_active,
                    "active_maintenance": maintenance_active,
                },
                "users_by_role": users_by_role,
                "department_types": department_types,
                "attendance_status": attendance_status,
                "activity_timeline": activity_timeline,
                "top_departments": top_departments,
                "feature_health": type_feature_health,
            }
        )
