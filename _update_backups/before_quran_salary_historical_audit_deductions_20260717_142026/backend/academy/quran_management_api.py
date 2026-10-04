from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import DepartmentFeature, PlatformAuditLog

from .models import (
    Attendance,
    ClassSchedule,
    SalaryConfiguration,
    StudentProfile,
    TeacherProfile,
    TeacherSalarySlip,
)
from .permissions import is_department_manager
from .salary_service import (
    configuration_payload,
    refresh_salary_slip,
    salary_configuration_for_department,
    salary_slip_payload,
)
from .ws_notify import notify_global


def _user_department(user):
    department = getattr(user, "department", None)
    if department and str(getattr(department, "department_type", "")).lower() == "quran":
        return department
    return None


def _feature_enabled(department, key):
    if not department:
        return False
    row = DepartmentFeature.objects.filter(
        department=department,
        feature__key=key,
        feature__is_active=True,
    ).select_related("feature").first()
    return bool(row and row.is_enabled)


def _scoped_students(user):
    department = _user_department(user)
    qs = StudentProfile.objects.select_related(
        "user", "teacher__user", "department", "institution"
    ).prefetch_related("schedules")
    if department:
        qs = qs.filter(Q(department=department) | Q(user__department=department))
    if str(getattr(user, "role", "")).lower() == "teacher":
        try:
            qs = qs.filter(teacher=user.teacher_profile)
        except TeacherProfile.DoesNotExist:
            return qs.none()
    return qs.order_by("teacher__user__first_name", "user__first_name", "user__username", "id")


def _student_schedule_summary(student):
    schedules = [item for item in student.schedules.all() if item.is_active]
    days = []
    times = []
    for item in schedules:
        label = item.get_weekday_display()
        if label not in days:
            days.append(label)
        value = item.time_slot.strftime("%H:%M")
        if value not in times:
            times.append(value)
    return {
        "class_days": days,
        "time_slots": times,
        "class_days_count": len(days),
    }


def _audit(request, action, summary, target_type="", target_id="", target_label="", details=None):
    try:
        forwarded = str(request.META.get("HTTP_X_FORWARDED_FOR", "") or "").split(",")[0].strip()
        ip = forwarded or request.META.get("REMOTE_ADDR") or None
        PlatformAuditLog.objects.create(
            actor=request.user,
            category="quran_salary",
            action=action,
            summary=summary,
            target_type=target_type,
            target_id=str(target_id or ""),
            target_label=target_label,
            details=details or {},
            ip_address=ip,
        )
    except Exception:
        pass


class DroppedLeaveStudentsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        department = _user_department(request.user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)
        if not _feature_enabled(department, "tab_dropped_leave"):
            return Response({"detail": "Dropped & Leave is disabled for this department."}, status=status.HTTP_403_FORBIDDEN)

        students = list(_scoped_students(request.user))
        student_ids = [item.id for item in students]
        attendance_rows = Attendance.objects.filter(
            entity_type=Attendance.EntityType.STUDENT,
            student_id__in=student_ids,
        ).order_by("student_id", "-date", "-updated_at", "-id")

        grouped = defaultdict(list)
        seen = set()
        for row in attendance_rows:
            key = (row.student_id, row.date)
            if key in seen:
                continue
            seen.add(key)
            grouped[row.student_id].append(row)

        results = []
        for student in students:
            rows = grouped.get(student.id, [])
            if not rows:
                continue
            latest_status = rows[0].status
            if latest_status not in {Attendance.Status.LEAVE, Attendance.Status.ABSENT}:
                continue

            streak_rows = []
            for row in rows:
                if row.status != latest_status:
                    break
                streak_rows.append(row)
            if len(streak_rows) < 2:
                continue

            schedule = _student_schedule_summary(student)
            results.append({
                "student_id": student.id,
                "student_name": str(student),
                "username": student.user.username,
                "teacher_id": student.teacher_id,
                "teacher_name": str(student.teacher),
                "flag_type": "leave" if latest_status == Attendance.Status.LEAVE else "dropped",
                "attendance_status": latest_status,
                "days_count": len(streak_rows),
                "streak_start": str(streak_rows[-1].date),
                "last_marked_date": str(streak_rows[0].date),
                "student_type": student.student_type,
                "student_type_label": student.get_student_type_display(),
                "class_status": student.class_status,
                "class_status_label": student.get_class_status_display(),
                **schedule,
            })

        results.sort(key=lambda item: (-item["days_count"], item["teacher_name"], item["student_name"]))
        return Response({
            "results": results,
            "summary": {
                "total": len(results),
                "on_leave": sum(1 for item in results if item["flag_type"] == "leave"),
                "dropped": sum(1 for item in results if item["flag_type"] == "dropped"),
            },
            "generated_at": timezone.now().isoformat(),
        })


def _validate_tiers(value, field_name):
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field_name} must contain at least one tier.")
    cleaned = []
    for row in value:
        if not isinstance(row, dict):
            raise ValueError(f"Every {field_name} row must be an object.")
        minimum = int(row.get("min", 0))
        maximum = row.get("max")
        maximum = None if maximum in (None, "") else int(maximum)
        rate = float(row.get("rate", 0))
        if minimum < 0 or rate < 0 or (maximum is not None and maximum < minimum):
            raise ValueError(f"Invalid range or rate in {field_name}.")
        cleaned.append({"min": minimum, "max": maximum, "rate": rate})
    cleaned.sort(key=lambda row: row["min"])
    return cleaned


def _validate_bonus_rates(value):
    if not isinstance(value, dict):
        raise ValueError("Bonus rates must be an object.")
    return {
        key: max(0, float(value.get(key, 0) or 0))
        for key in ["english", "lesson_filled", "night", "reference"]
    }


def _validate_payouts(value):
    if not isinstance(value, list):
        raise ValueError("Achievement payouts must be a list.")
    cleaned = []
    for row in value:
        minimum = int(row.get("min_points", 0))
        maximum = int(row.get("max_points", minimum))
        amount = max(0, float(row.get("amount", 0) or 0))
        if minimum < 0 or maximum < minimum or maximum > 10:
            raise ValueError("Achievement point ranges must be between 0 and 10.")
        cleaned.append({"min_points": minimum, "max_points": maximum, "amount": amount})
    return cleaned


class QuranSalarySettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def _guard(self, request):
        department = _user_department(request.user)
        if not department or not is_department_manager(request.user):
            return None, Response({"detail": "Quran portal administrator access is required."}, status=status.HTTP_403_FORBIDDEN)
        if not _feature_enabled(department, "tab_teacher_salary"):
            return None, Response({"detail": "Teacher Salary Management is disabled."}, status=status.HTTP_403_FORBIDDEN)
        return department, None

    def get(self, request):
        department, error = self._guard(request)
        if error:
            return error
        config = salary_configuration_for_department(department, request.user)
        return Response(configuration_payload(config))

    def patch(self, request):
        department, error = self._guard(request)
        if error:
            return error
        config = salary_configuration_for_department(department, request.user)
        try:
            if "standard_tiers" in request.data:
                config.standard_tiers = _validate_tiers(request.data.get("standard_tiers"), "standard tiers")
            if "three_day_tiers" in request.data:
                config.three_day_tiers = _validate_tiers(request.data.get("three_day_tiers"), "three-day tiers")
            if "bonus_rates" in request.data:
                config.bonus_rates = _validate_bonus_rates(request.data.get("bonus_rates"))
            if "achievement_payouts" in request.data:
                config.achievement_payouts = _validate_payouts(request.data.get("achievement_payouts"))
            if "night_start" in request.data:
                config.night_start = datetime.strptime(str(request.data.get("night_start")), "%H:%M").time()
            if "night_end" in request.data:
                config.night_end = datetime.strptime(str(request.data.get("night_end")), "%H:%M").time()
            config.updated_by = request.user
            config.save()
        except (TypeError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        _audit(request, "salary_settings_updated", "Quran salary settings updated.", "department", department.id, department.name)
        notify_global("academy_update", {"event": "salary_settings_updated", "department_id": department.id})
        return Response(configuration_payload(config))


class QuranSalaryDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def _guard(self, request):
        department = _user_department(request.user)
        if not department or not is_department_manager(request.user):
            return None, Response({"detail": "Quran portal administrator access is required."}, status=status.HTTP_403_FORBIDDEN)
        if not _feature_enabled(department, "tab_teacher_salary"):
            return None, Response({"detail": "Teacher Salary Management is disabled."}, status=status.HTTP_403_FORBIDDEN)
        return department, None

    def get(self, request):
        department, error = self._guard(request)
        if error:
            return error
        today = timezone.localdate()
        try:
            month = int(request.query_params.get("month", today.month))
            year = int(request.query_params.get("year", today.year))
            if month < 1 or month > 12 or year < 2020 or year > 2200:
                raise ValueError
        except (TypeError, ValueError):
            return Response({"detail": "A valid month and year are required."}, status=status.HTTP_400_BAD_REQUEST)

        config = salary_configuration_for_department(department, request.user)
        teachers = TeacherProfile.objects.select_related("user").filter(
            Q(department=department) | Q(user__department=department)
        ).order_by("user__first_name", "user__username", "id")

        slips = []
        for teacher in teachers:
            slip, _ = TeacherSalarySlip.objects.get_or_create(
                department=department,
                teacher=teacher,
                month=month,
                year=year,
                defaults={
                    "institution": department.institution,
                    "updated_by": request.user,
                },
            )
            refresh_salary_slip(slip, request.user)
            slips.append(salary_slip_payload(slip))

        return Response({
            "month": month,
            "year": year,
            "department": {"id": department.id, "name": department.name},
            "configuration": configuration_payload(config),
            "teachers": slips,
            "summary": {
                "teachers": len(slips),
                "draft": sum(1 for item in slips if item["status"] == "draft"),
                "processed": sum(1 for item in slips if item["status"] == "processed"),
                "total_payout": round(sum(float(item["final_total"]) for item in slips), 2),
            },
        })

    @transaction.atomic
    def patch(self, request):
        department, error = self._guard(request)
        if error:
            return error
        try:
            slip_id = int(request.data.get("slip_id"))
            slip = TeacherSalarySlip.objects.select_for_update().select_related("teacher__user").get(
                id=slip_id,
                department=department,
            )
        except (TypeError, ValueError, TeacherSalarySlip.DoesNotExist):
            return Response({"detail": "Salary slip not found."}, status=status.HTTP_404_NOT_FOUND)

        if "behavior_good" in request.data:
            slip.behavior_good = bool(request.data.get("behavior_good"))
        if "half_class_overrides" in request.data:
            rows = request.data.get("half_class_overrides")
            if not isinstance(rows, list):
                return Response({"detail": "Half-class overrides must be a list."}, status=status.HTTP_400_BAD_REQUEST)
            slip.half_class_overrides = rows
        if "other_bonuses" in request.data:
            rows = request.data.get("other_bonuses")
            if not isinstance(rows, list):
                return Response({"detail": "Other bonuses must be a list."}, status=status.HTTP_400_BAD_REQUEST)
            cleaned = []
            for row in rows:
                reason = str((row or {}).get("reason", "") or "").strip()
                try:
                    amount = float((row or {}).get("amount", 0) or 0)
                except (TypeError, ValueError):
                    return Response({"detail": "Every bonus amount must be numeric."}, status=status.HTTP_400_BAD_REQUEST)
                if amount and not reason:
                    return Response({"detail": "A reason is required for every other bonus."}, status=status.HTTP_400_BAD_REQUEST)
                if reason and amount:
                    cleaned.append({"reason": reason, "amount": amount})
            slip.other_bonuses = cleaned
        if "override_values" in request.data:
            overrides = request.data.get("override_values")
            if not isinstance(overrides, dict):
                return Response({"detail": "Override values must be an object."}, status=status.HTTP_400_BAD_REQUEST)
            allowed = {
                "base_salary", "english_bonus", "lesson_bonus", "night_bonus",
                "reference_bonus", "achievement_bonus", "final_total",
            }
            slip.override_values = {key: value for key, value in overrides.items() if key in allowed and value not in (None, "")}
        if "admin_note" in request.data:
            slip.admin_note = str(request.data.get("admin_note", "") or "").strip()
        if "status" in request.data:
            next_status = str(request.data.get("status", "") or "").lower()
            if next_status not in {TeacherSalarySlip.Status.DRAFT, TeacherSalarySlip.Status.PROCESSED}:
                return Response({"detail": "Invalid salary status."}, status=status.HTTP_400_BAD_REQUEST)
            slip.status = next_status
            if next_status == TeacherSalarySlip.Status.PROCESSED:
                slip.processed_by = request.user
                slip.processed_at = timezone.now()
            else:
                slip.processed_by = None
                slip.processed_at = None
        slip.updated_by = request.user
        slip.save()
        refresh_salary_slip(slip, request.user, force=True)

        _audit(
            request,
            "salary_slip_updated",
            f"Salary slip updated for {slip.teacher} ({slip.month}/{slip.year}).",
            "teacher_salary_slip",
            slip.id,
            str(slip.teacher),
            {"status": slip.status, "final_total": float(slip.final_total)},
        )
        notify_global("academy_update", {"event": "salary_slip_updated", "teacher_id": slip.teacher_id})
        return Response(salary_slip_payload(slip))
