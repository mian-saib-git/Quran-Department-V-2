from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from django.core.paginator import EmptyPage, Paginator
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
    decimal_text,
    money,
    normalize_deductions,
    refresh_salary_slip,
    salary_configuration_for_department,
    salary_audit_payload,
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


def _strict_money(value, label="Amount"):
    if value in (None, ""):
        return Decimal("0.00")
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"{label} must be numeric.")


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
        rate = _strict_money(row.get("rate", 0), f"{field_name} rate")
        if minimum < 0 or rate < 0 or (maximum is not None and maximum < minimum):
            raise ValueError(f"Invalid range or rate in {field_name}.")
        cleaned.append({"min": minimum, "max": maximum, "rate": decimal_text(rate)})
    cleaned.sort(key=lambda row: row["min"])
    return cleaned


def _validate_bonus_rates(value):
    if not isinstance(value, dict):
        raise ValueError("Bonus rates must be an object.")
    cleaned = {}
    for key in ["english", "lesson_filled", "night", "reference"]:
        amount = _strict_money(value.get(key, 0), f"{key.replace('_', ' ').title()} bonus")
        if amount < 0:
            raise ValueError("Bonus rates cannot be negative.")
        cleaned[key] = decimal_text(amount)
    return cleaned


def _validate_payouts(value):
    if not isinstance(value, list):
        raise ValueError("Achievement payouts must be a list.")
    cleaned = []
    for row in value:
        minimum = int(row.get("min_points", 0))
        maximum = int(row.get("max_points", minimum))
        amount = _strict_money(row.get("amount", 0), "Achievement payout")
        if minimum < 0 or maximum < minimum or maximum > 10:
            raise ValueError("Achievement point ranges must be between 0 and 10.")
        if amount < 0:
            raise ValueError("Achievement payouts cannot be negative.")
        cleaned.append({"min_points": minimum, "max_points": maximum, "amount": decimal_text(amount)})
    return cleaned



SALARY_ADMIN_ROLES = {"department_admin", "institution_admin"}


def _is_salary_admin(user):
    role = str(getattr(user, "role", "") or "").lower()
    return bool(getattr(user, "is_superuser", False) or role in SALARY_ADMIN_ROLES)


def _salary_access(request, *, admin_only=False):
    department = _user_department(request.user)
    if not department:
        return None, None, Response(
            {"detail": "Quran department assignment is required."},
            status=status.HTTP_403_FORBIDDEN,
        )
    if not _feature_enabled(department, "tab_teacher_salary"):
        return None, None, Response(
            {"detail": "Teacher Salary Management is disabled."},
            status=status.HTTP_403_FORBIDDEN,
        )

    if _is_salary_admin(request.user):
        return department, None, None

    role = str(getattr(request.user, "role", "") or "").lower()
    if not admin_only and role == "teacher":
        try:
            teacher = request.user.teacher_profile
        except TeacherProfile.DoesNotExist:
            return None, None, Response(
                {"detail": "Teacher profile was not found."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if teacher.department_id != department.id and getattr(request.user, "department_id", None) != department.id:
            return None, None, Response(
                {"detail": "Teacher department access is invalid."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return department, teacher, None

    return None, None, Response(
        {"detail": "Salary access is restricted to Quran portal administrators and the individual teacher."},
        status=status.HTTP_403_FORBIDDEN,
    )


def _parse_month_year(request):
    today = timezone.localdate()
    try:
        month = int(request.query_params.get("month", today.month))
        year = int(request.query_params.get("year", today.year))
        if month < 1 or month > 12 or year < 2020 or year > 2200:
            raise ValueError
    except (TypeError, ValueError):
        raise ValueError("A valid month and year are required.")
    return month, year


def _no_store(response):
    response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response["Pragma"] = "no-cache"
    return response


class QuranSalarySettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        department, _teacher, error = _salary_access(request, admin_only=True)
        if error:
            return error
        config = salary_configuration_for_department(department, request.user)
        return _no_store(Response(configuration_payload(config)))

    def patch(self, request):
        department, _teacher, error = _salary_access(request, admin_only=True)
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

    def get(self, request):
        department, own_teacher, error = _salary_access(request)
        if error:
            return error
        try:
            month, year = _parse_month_year(request)
            page_number = max(1, int(request.query_params.get("page", 1) or 1))
            page_size = min(50, max(1, int(request.query_params.get("page_size", 12) or 12)))
        except (TypeError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        config = salary_configuration_for_department(department, request.user if _is_salary_admin(request.user) else None)
        if own_teacher:
            teachers = [own_teacher]
            page_number = 1
            page_size = 1
            total_items = 1
            total_pages = 1
        else:
            teacher_qs = TeacherProfile.objects.select_related("user").filter(
                Q(department=department) | Q(user__department=department)
            ).distinct().order_by("user__first_name", "user__last_name", "user__username", "id")
            paginator = Paginator(teacher_qs, page_size)
            try:
                page_obj = paginator.page(page_number)
            except EmptyPage:
                page_number = max(1, paginator.num_pages)
                page_obj = paginator.page(page_number)
            teachers = list(page_obj.object_list)
            total_items = paginator.count
            total_pages = paginator.num_pages

        slips = []
        for teacher in teachers:
            slip, _ = TeacherSalarySlip.objects.get_or_create(
                department=department,
                teacher=teacher,
                month=month,
                year=year,
                defaults={
                    "institution": department.institution,
                    "updated_by": request.user if _is_salary_admin(request.user) else None,
                },
            )
            refresh_salary_slip(slip, request.user if _is_salary_admin(request.user) else None)
            slips.append(salary_slip_payload(slip))

        response = Response({
            "month": month,
            "year": year,
            "department": {"id": department.id, "name": department.name},
            "access_mode": "teacher" if own_teacher else "administrator",
            "configuration": configuration_payload(config) if not own_teacher else None,
            "teachers": slips,
            "pagination": {
                "page": page_number,
                "page_size": page_size,
                "total_items": total_items,
                "total_pages": total_pages,
                "has_next": page_number < total_pages,
                "has_previous": page_number > 1,
            },
            "summary": {
                "teachers": total_items,
                "page_teachers": len(slips),
                "draft": sum(1 for item in slips if item["status"] == "draft"),
                "processed": sum(1 for item in slips if item["status"] == "processed"),
                "total_payout": decimal_text(sum((money(item["final_total"]) for item in slips), money(0))),
                "page_payout": decimal_text(sum((money(item["final_total"]) for item in slips), money(0))),
            },
        })
        return _no_store(response)

    @transaction.atomic
    def patch(self, request):
        department, _teacher, error = _salary_access(request, admin_only=True)
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
            cleaned = []
            for row in rows:
                try:
                    student_id = int((row or {}).get("student_id"))
                    amount = _strict_money((row or {}).get("amount", 0), "Half-month amount")
                    if amount < 0:
                        raise ValueError
                except (TypeError, ValueError):
                    return Response({"detail": "Half-class values must be numeric."}, status=status.HTTP_400_BAD_REQUEST)
                cleaned.append({"student_id": student_id, "amount": decimal_text(amount)})
            slip.half_class_overrides = cleaned
        if "other_bonuses" in request.data:
            rows = request.data.get("other_bonuses")
            if not isinstance(rows, list):
                return Response({"detail": "Other bonuses must be a list."}, status=status.HTTP_400_BAD_REQUEST)
            cleaned = []
            for row in rows:
                reason = str((row or {}).get("reason", "") or "").strip()
                try:
                    amount = _strict_money((row or {}).get("amount", 0), "Bonus amount")
                except (TypeError, ValueError):
                    return Response({"detail": "Every bonus amount must be numeric."}, status=status.HTTP_400_BAD_REQUEST)
                if amount and not reason:
                    return Response({"detail": "A reason is required for every other bonus."}, status=status.HTTP_400_BAD_REQUEST)
                if reason and amount:
                    cleaned.append({"reason": reason, "amount": decimal_text(amount)})
            slip.other_bonuses = cleaned
        if "deductions" in request.data:
            raw = request.data.get("deductions")
            if not isinstance(raw, dict):
                return Response({"detail": "Deductions must be an object."}, status=status.HTTP_400_BAD_REQUEST)
            for key in ["food", "drop_leave", "fine", "imam_hadya", "advance"]:
                try:
                    amount = _strict_money(raw.get(key, 0), key.replace("_", " ").title())
                except ValueError as exc:
                    return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                if amount < 0:
                    return Response({"detail": f"{key.replace('_', ' ').title()} must be a non-negative number."}, status=status.HTTP_400_BAD_REQUEST)
            manual_rows = raw.get("manual", [])
            if not isinstance(manual_rows, list):
                return Response({"detail": "Manual deductions must be a list."}, status=status.HTTP_400_BAD_REQUEST)
            for row in manual_rows:
                reason = str((row or {}).get("reason", "") or "").strip()
                try:
                    amount = _strict_money((row or {}).get("amount", 0), "Manual deduction amount")
                except ValueError as exc:
                    return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
                if amount and not reason:
                    return Response({"detail": "A reason is mandatory for every manual cutting."}, status=status.HTTP_400_BAD_REQUEST)
                if amount < 0:
                    return Response({"detail": "Deduction amounts cannot be negative."}, status=status.HTTP_400_BAD_REQUEST)
            normalized, _total = normalize_deductions(raw)
            slip.deductions = normalized
        if "override_values" in request.data:
            overrides = request.data.get("override_values")
            if not isinstance(overrides, dict):
                return Response({"detail": "Override values must be an object."}, status=status.HTTP_400_BAD_REQUEST)
            money_keys = {
                "standard_rate", "three_day_rate", "manual_review_salary",
                "english_rate", "lesson_rate", "night_rate", "reference_rate",
            }
            count_keys = {
                "tier_basis_class_count", "standard_class_count", "three_day_class_count",
                "english_class_count", "lesson_filled_count",
                "night_class_count", "reference_student_count",
                "achievement_points",
            }
            cleaned = {}
            for key, value in overrides.items():
                if value in (None, ""):
                    continue
                if key in count_keys:
                    try:
                        decimal_value = Decimal(str(value))
                        if decimal_value < 0 or decimal_value != decimal_value.to_integral_value():
                            raise ValueError
                        count = int(decimal_value)
                    except (InvalidOperation, TypeError, ValueError):
                        return Response({"detail": f"Override {key} must be a whole non-negative number."}, status=status.HTTP_400_BAD_REQUEST)
                    if key == "achievement_points" and count > 10:
                        return Response({"detail": "Achievement points cannot exceed 10."}, status=status.HTTP_400_BAD_REQUEST)
                    cleaned[key] = str(count)
                    continue
                if key not in money_keys:
                    continue
                try:
                    amount = _strict_money(value, f"Override {key}")
                except (TypeError, ValueError):
                    return Response({"detail": f"Override {key} must be numeric."}, status=status.HTTP_400_BAD_REQUEST)
                if amount < 0:
                    return Response({"detail": "Salary overrides cannot be negative."}, status=status.HTTP_400_BAD_REQUEST)
                cleaned[key] = decimal_text(amount)
            slip.override_values = cleaned
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
            {
                "status": slip.status,
                "gross_total": str(slip.gross_total),
                "deduction_total": str(slip.deduction_total),
                "net_total": str(slip.final_total),
            },
        )
        notify_global("academy_update", {"event": "salary_slip_updated", "teacher_id": slip.teacher_id})
        return Response(salary_slip_payload(slip))


class QuranSalaryAuditView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        department, own_teacher, error = _salary_access(request)
        if error:
            return error
        try:
            month, year = _parse_month_year(request)
            teacher_id = int(request.query_params.get("teacher_id") or (own_teacher.id if own_teacher else 0))
            metric = str(request.query_params.get("metric", "") or "").strip()
        except (TypeError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if own_teacher and teacher_id != own_teacher.id:
            return Response({"detail": "Teachers can view only their own salary proof."}, status=status.HTTP_403_FORBIDDEN)
        try:
            teacher = TeacherProfile.objects.select_related("user").get(
                id=teacher_id,
            )
        except TeacherProfile.DoesNotExist:
            return Response({"detail": "Teacher not found."}, status=status.HTTP_404_NOT_FOUND)
        if teacher.department_id != department.id and getattr(teacher.user, "department_id", None) != department.id:
            return Response({"detail": "Teacher is outside this Quran department."}, status=status.HTTP_403_FORBIDDEN)

        slip = TeacherSalarySlip.objects.filter(
            department=department,
            teacher=teacher,
            month=month,
            year=year,
        ).first()
        try:
            payload = salary_audit_payload(teacher, year, month, metric, slip, department)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return _no_store(Response(payload))

class QuranSalaryPdfDownloadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        department, _teacher, error = _salary_access(request, admin_only=True)
        if error:
            return error
        try:
            slip_id = int(request.data.get("slip_id") or 0)
        except (TypeError, ValueError):
            slip_id = 0
        if not slip_id:
            return Response({"detail": "A valid salary slip is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            slip = TeacherSalarySlip.objects.select_related("teacher__user").get(
                id=slip_id,
                department=department,
            )
        except TeacherSalarySlip.DoesNotExist:
            return Response({"detail": "Salary slip not found."}, status=status.HTTP_404_NOT_FOUND)

        now = timezone.now()
        if not slip.pdf_generated_at:
            slip.pdf_generated_at = now
        slip.pdf_download_count = int(slip.pdf_download_count or 0) + 1
        slip.pdf_last_downloaded_at = now
        slip.updated_by = request.user
        slip.save(update_fields=[
            "pdf_generated_at",
            "pdf_download_count",
            "pdf_last_downloaded_at",
            "updated_by",
            "updated_at",
        ])

        _audit(
            request,
            "salary_pdf_downloaded",
            f"Salary PDF downloaded for {slip.teacher} ({slip.month}/{slip.year}).",
            "teacher_salary_slip",
            slip.id,
            str(slip.teacher),
            {
                "month": slip.month,
                "year": slip.year,
                "download_count": slip.pdf_download_count,
            },
        )
        return _no_store(Response(salary_slip_payload(slip)))

