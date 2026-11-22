from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re

from django.core.paginator import EmptyPage, Paginator
from django.db import transaction
from django.db.models import Prefetch, Q
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
    StudentClassHistory,
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
from .salary_v2_models import QuranStudentDropEvent
from .student_status_service import (
    DROPPED_CLASS_STATUSES,
    INACTIVE_TEACHING_STATUSES,
    StudentStatusTransitionError,
    academy_localdate,
    confirm_student_drop_leave_return,
    is_student_teaching_active,
)


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

        active_drop_rows = (
            QuranStudentDropEvent.objects
            .filter(
                department=department,
                student_id__in=student_ids,
                status=QuranStudentDropEvent.Status.DROPPED,
                rejoined_date__isnull=True,
            )
            .order_by(
                "student_id",
                "-drop_effective_date",
                "-id",
            )
        )

        active_drop_by_student = {}

        for drop_event in active_drop_rows:
            active_drop_by_student.setdefault(
                drop_event.student_id,
                drop_event,
            )

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
            active_drop = active_drop_by_student.get(
                student.id
            )

            latest_status = (
                rows[0].status
                if rows
                else ""
            )

            is_confirmed_inactive = student.class_status in INACTIVE_TEACHING_STATUSES
            streak_rows = []

            if active_drop is None:
                if rows and latest_status in {
                    Attendance.Status.LEAVE,
                    Attendance.Status.ABSENT,
                }:
                    for row in rows:
                        if row.status != latest_status:
                            break
                        streak_rows.append(row)

                if len(streak_rows) < 2 and not is_confirmed_inactive:
                    continue

                if is_confirmed_inactive:
                    flag_type = (
                        "leave"
                        if student.class_status == StudentProfile.ClassStatus.ON_LEAVE
                        else "dropped"
                    )
                    attendance_status = (
                        latest_status
                        if latest_status in {Attendance.Status.LEAVE, Attendance.Status.ABSENT}
                        else (
                            Attendance.Status.LEAVE
                            if flag_type == "leave"
                            else Attendance.Status.ABSENT
                        )
                    )
                else:
                    flag_type = (
                        "leave"
                        if latest_status == Attendance.Status.LEAVE
                        else "dropped"
                    )
                    attendance_status = latest_status

                days_count = len(streak_rows)
                streak_start = (
                    str(streak_rows[-1].date)
                    if streak_rows
                    else (str(student.status_effective_date) if student.status_effective_date else "")
                )
                last_marked_date = str(streak_rows[0].date) if streak_rows else ""
            else:
                flag_type = "dropped"
                attendance_status = (
                    latest_status
                    if latest_status in {
                        Attendance.Status.LEAVE,
                        Attendance.Status.ABSENT,
                    }
                    else Attendance.Status.ABSENT
                )
                days_count = 3
                streak_start = str(
                    active_drop.streak_start_date
                )
                last_marked_date = str(
                    active_drop.streak_end_date
                )

            schedule = _student_schedule_summary(student)
            is_confirmed_dropped = student.class_status in DROPPED_CLASS_STATUSES
            is_confirmed_leave = student.class_status == StudentProfile.ClassStatus.ON_LEAVE
            results.append({
                "student_id": student.id,
                "student_name": str(student),
                "username": student.user.username,
                "teacher_id": student.teacher_id,
                "teacher_name": str(student.teacher),
                "flag_type": flag_type,
                "attendance_status": attendance_status,
                "days_count": days_count,
                "streak_start": streak_start,
                "last_marked_date": last_marked_date,
                "student_type": student.student_type,
                "student_type_label": student.get_student_type_display(),
                "class_status": student.class_status,
                "class_status_label": student.get_class_status_display(),
                "status_effective_date": (
                    str(student.status_effective_date)
                    if student.status_effective_date
                    else ""
                ),
                "is_confirmed_dropped": is_confirmed_dropped,
                "is_confirmed_leave": is_confirmed_leave,
                "can_confirm_drop": not is_confirmed_dropped,
                "can_confirm_leave": not is_confirmed_leave,
                "can_confirm_return": is_confirmed_inactive or (active_drop is not None),
                "active_drop_event": active_drop is not None,
                "drop_event_id": (
                    active_drop.id
                    if active_drop is not None
                    else None
                ),
                "drop_effective_date": (
                    str(active_drop.drop_effective_date)
                    if active_drop is not None
                    else ""
                ),
                "can_rejoin": active_drop is not None,
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

    def post(self, request):
        if not is_department_manager(request.user):
            return Response(
                {"detail": "Only department admins and coordinators can update student Drop/Leave status."},
                status=status.HTTP_403_FORBIDDEN,
            )
        department = _user_department(request.user)
        if not department:
            return Response({"detail": "Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)
        if not _feature_enabled(department, "tab_dropped_leave"):
            return Response({"detail": "Dropped & Leave is disabled for this department."}, status=status.HTTP_403_FORBIDDEN)

        raw_student_id = request.data.get("student_id")
        try:
            student_id = int(raw_student_id)
        except (TypeError, ValueError):
            return Response({"detail": "Valid student_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        action = str(request.data.get("action") or "").strip()
        raw_date = str(request.data.get("effective_date") or "").strip()
        if raw_date:
            try:
                effective_date = date.fromisoformat(raw_date)
            except ValueError:
                return Response({"detail": "effective_date must be YYYY-MM-DD."}, status=status.HTTP_400_BAD_REQUEST)
        else:
            effective_date = academy_localdate()

        reason = str(request.data.get("reason") or "")

        try:
            result = confirm_student_drop_leave_return(
                department=department,
                student_id=student_id,
                action=action,
                effective_date=effective_date,
                reason=reason,
                actor=request.user,
            )
        except StudentStatusTransitionError as exc:
            return Response(exc.payload, status=exc.status_code)

        try:
            transaction.on_commit(
                lambda: notify_global(
                    "academy_update",
                    {
                        "event": "account_status_updated",
                        "department_id": department.id,
                        "student_id": student_id,
                        "action": action,
                    },
                )
            )
        except Exception:
            pass

        return Response(result, status=status.HTTP_200_OK)


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
            month_start = date(year, month, 1)
            teacher_qs = TeacherProfile.objects.select_related("user").filter(
                Q(department=department) | Q(user__department=department)
            ).filter(
                Q(user__archived_effective_date__isnull=True)
                | Q(user__archived_effective_date__gte=month_start)
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
        from salary.cutover_guard import is_unified_salary_active
        if is_unified_salary_active(department, year, month):
            # Unified ownership active: read-only historical mode.
            # Do NOT create new slips or recalculate existing slips.
            for teacher in teachers:
                slip = TeacherSalarySlip.objects.filter(
                    department=department,
                    teacher=teacher,
                    month=month,
                    year=year,
                ).first()
                if slip:
                    slips.append(salary_slip_payload(slip))
        else:
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
            slip = TeacherSalarySlip.objects.select_for_update(of=("self",)).select_related("teacher__user").get(
                id=slip_id,
                department=department,
            )
            from salary.cutover_guard import check_legacy_write_guard
            guard_error = check_legacy_write_guard(
                department=slip.department or department,
                year=slip.year,
                month=slip.month,
                operation="update_salary_slip (V1)",
            )
            if guard_error:
                return guard_error
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


def _schedule_end_time(time_slot, duration_minutes: int) -> str:
    if not time_slot:
        return ""
    start_dt = datetime.combine(date(2000, 1, 1), time_slot)
    end_dt = start_dt + timedelta(minutes=int(duration_minutes or 30))
    return end_dt.strftime("%H:%M")


def _extract_display_number(full_name: str) -> str:
    match = re.match(r"^\s*(\d+)\b", str(full_name or ""))
    return match.group(1) if match else ""


class QuranTeacherDetailsView(APIView):
    """Read-only, department-scoped details for a single Quran TeacherProfile."""

    permission_classes = [IsAuthenticated]

    def get(self, request, teacher_id: int):
        if not is_department_manager(request.user):
            return Response(
                {"detail": "Only department admins and coordinators can view teacher details."},
                status=status.HTTP_403_FORBIDDEN,
            )

        department = _user_department(request.user)
        if not department:
            return Response(
                {"detail": "Quran department assignment is required."},
                status=status.HTTP_403_FORBIDDEN,
            )

        teacher = (
            TeacherProfile.objects.select_related("user", "department", "institution")
            .filter(id=teacher_id, department=department)
            .first()
        )
        if teacher is None:
            return Response(
                {"detail": "Teacher not found in this Quran department."},
                status=status.HTTP_404_NOT_FOUND,
            )

        today = academy_localdate()

        active_schedules_prefetch = Prefetch(
            "schedules",
            queryset=(
                ClassSchedule.objects.filter(department=department, teacher=teacher, is_active=True)
                .order_by("weekday", "time_slot", "id")
            ),
            to_attr="teacher_active_schedules",
        )
        all_schedules_prefetch = Prefetch(
            "schedules",
            queryset=(
                ClassSchedule.objects.filter(department=department)
                .order_by("-is_active", "weekday", "time_slot", "id")
            ),
            to_attr="teacher_all_schedules",
        )

        assigned_students = list(
            StudentProfile.objects.select_related("user", "teacher__user")
            .prefetch_related(active_schedules_prefetch)
            .filter(department=department, teacher=teacher)
            .order_by("user__first_name", "user__username", "id")
        )

        inactive_student_ids = [
            s.id for s in assigned_students if not is_student_teaching_active(s, today)
        ]

        latest_history_by_student = {}
        active_drop_by_student = {}
        previous_schedules_by_student = {}

        if inactive_student_ids:
            history_rows = (
                StudentClassHistory.objects.select_related("previous_teacher__user")
                .filter(
                    student_id__in=inactive_student_ids,
                    new_class_status__in=INACTIVE_TEACHING_STATUSES,
                )
                .order_by("student_id", "-effective_date", "-id")
            )
            for row in history_rows:
                latest_history_by_student.setdefault(row.student_id, row)

            drop_rows = (
                QuranStudentDropEvent.objects.filter(
                    department=department,
                    student_id__in=inactive_student_ids,
                    status=QuranStudentDropEvent.Status.DROPPED,
                )
                .order_by("student_id", "-drop_effective_date", "-id")
            )
            for drop in drop_rows:
                active_drop_by_student.setdefault(drop.student_id, drop)

            inactive_students_with_scheds = (
                StudentProfile.objects.filter(id__in=inactive_student_ids)
                .prefetch_related(all_schedules_prefetch)
            )
            for st in inactive_students_with_scheds:
                previous_schedules_by_student[st.id] = list(
                    getattr(st, "teacher_all_schedules", [])
                )

        active_students_payload = []
        dropped_leave_payload = []
        class_schedules_payload = []

        for student in assigned_students:
            full_name = student.user.get_full_name() or student.user.username
            student_schedules = list(getattr(student, "teacher_active_schedules", []))

            if is_student_teaching_active(student, today):
                sched_items = []
                for sched in student_schedules:
                    start_str = sched.time_slot.strftime("%H:%M") if sched.time_slot else ""
                    end_str = _schedule_end_time(sched.time_slot, sched.duration_minutes)
                    sched_item = {
                        "id": sched.id,
                        "weekday": sched.weekday,
                        "time_slot": start_str,
                        "end_time": end_str,
                        "duration_minutes": sched.duration_minutes,
                    }
                    sched_items.append(sched_item)
                    class_schedules_payload.append({
                        "id": sched.id,
                        "student_id": student.id,
                        "student_name": full_name,
                        "student_username": student.user.username,
                        "weekday": sched.weekday,
                        "time_slot": start_str,
                        "end_time": end_str,
                        "duration_minutes": sched.duration_minutes,
                        "class_status": student.class_status,
                        "class_status_label": student.get_class_status_display(),
                        "salary_class_mode": student.salary_class_mode,
                        "salary_class_mode_label": student.get_salary_class_mode_display(),
                    })

                active_students_payload.append({
                    "student_id": student.id,
                    "full_name": full_name,
                    "username": student.user.username,
                    "class_status": student.class_status,
                    "class_status_label": student.get_class_status_display(),
                    "student_type": student.student_type,
                    "student_type_label": student.get_student_type_display(),
                    "salary_class_mode": student.salary_class_mode,
                    "salary_class_mode_label": student.get_salary_class_mode_display(),
                    "account_is_active": bool(
                        student.user.is_active and student.user.archived_at is None
                    ),
                    "schedules": sched_items,
                    "scheduled_classes_count": len(sched_items),
                })
            elif student.class_status in INACTIVE_TEACHING_STATUSES:
                hist = latest_history_by_student.get(student.id)
                drop_ev = active_drop_by_student.get(student.id)
                prev_scheds = previous_schedules_by_student.get(student.id, [])
                prev_days = []
                prev_times = []
                for sched in prev_scheds:
                    if sched.weekday and sched.weekday not in prev_days:
                        prev_days.append(sched.weekday)
                    if sched.time_slot:
                        t_str = sched.time_slot.strftime("%H:%M")
                        if t_str not in prev_times:
                            prev_times.append(t_str)

                dropped_leave_payload.append({
                    "student_id": student.id,
                    "full_name": full_name,
                    "username": student.user.username,
                    "class_status": student.class_status,
                    "class_status_label": student.get_class_status_display(),
                    "is_on_leave": student.class_status == StudentProfile.ClassStatus.ON_LEAVE,
                    "is_dropped": student.class_status in DROPPED_CLASS_STATUSES,
                    "effective_date": (
                        str(student.status_effective_date)
                        if student.status_effective_date
                        else ""
                    ),
                    "account_is_active": bool(
                        student.user.is_active and student.user.archived_at is None
                    ),
                    "original_teacher_name": str(teacher),
                    "previous_class_days": prev_days,
                    "previous_time_slots": prev_times,
                    "reason": hist.notes if hist else "",
                    "rejoined_date": (
                        str(drop_ev.rejoined_date)
                        if drop_ev and drop_ev.rejoined_date
                        else ""
                    ),
                })

        # Section D: Historical dropped/leave assignments attributed to this teacher
        historical_rows = list(
            StudentClassHistory.objects.select_related(
                "student__user",
                "student__teacher__user",
                "previous_teacher__user",
            )
            .filter(
                department=department,
                previous_teacher=teacher,
                new_class_status__in=INACTIVE_TEACHING_STATUSES,
            )
            .order_by("-effective_date", "-id")[:50]
        )
        status_label_map = dict(StudentProfile.ClassStatus.choices)
        historical_dropped_payload = [
            {
                "history_id": row.id,
                "student_id": row.student_id,
                "student_name": (
                    row.student.user.get_full_name() or row.student.user.username
                ) if row.student_id else "",
                "student_username": row.student.user.username if row.student_id else "",
                "new_class_status": row.new_class_status,
                "new_class_status_label": status_label_map.get(
                    row.new_class_status, row.new_class_status
                ),
                "effective_date": str(row.effective_date),
                "teacher_name": str(row.previous_teacher) if row.previous_teacher else "",
                "current_teacher_name": (
                    str(row.student.teacher)
                    if (row.student_id and row.student.teacher_id)
                    else ""
                ),
                "notes": row.notes or "",
            }
            for row in historical_rows
        ]

        teacher_full_name = teacher.user.get_full_name() or teacher.user.username
        is_archived = teacher.user.archived_at is not None
        is_active = bool(
            teacher.user.is_active and not is_archived and teacher.login_deleted_at is None
        )
        account_status_label = (
            "Archived" if is_archived else ("Active" if is_active else "Disabled")
        )

        dropped_count = sum(1 for item in dropped_leave_payload if item["is_dropped"])
        on_leave_count = sum(1 for item in dropped_leave_payload if item["is_on_leave"])

        return _no_store(
            Response(
                {
                    "teacher": {
                        "id": teacher.id,
                        "user_id": teacher.user_id,
                        "full_name": teacher_full_name,
                        "display_number": _extract_display_number(teacher_full_name),
                        "username": teacher.user.username,
                        "department_id": department.id,
                        "department_name": department.name,
                        "is_active": is_active,
                        "account_status_label": account_status_label,
                    },
                    "summary": {
                        "active_students_count": len(active_students_payload),
                        "dropped_students_count": dropped_count,
                        "on_leave_students_count": on_leave_count,
                        "active_schedules_count": len(class_schedules_payload),
                        "historical_dropped_count": len(historical_dropped_payload),
                    },
                    "active_students": active_students_payload,
                    "dropped_leave_students": dropped_leave_payload,
                    "class_schedules": class_schedules_payload,
                    "historical_dropped_classes": historical_dropped_payload,
                },
                status=status.HTTP_200_OK,
            )
        )


def _parse_date_value(raw_value):
    if not raw_value:
        return None
    if isinstance(raw_value, date):
        return raw_value
    text = str(raw_value).strip()
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _parse_time_value(raw_value):
    if not raw_value:
        return None
    text = str(raw_value).strip()
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).time()
        except ValueError:
            continue
    return None


def _resolve_department_student(department, data):
    student_id = data.get("student_id")
    user_id = data.get("user_id")
    qs = StudentProfile.objects.select_related("user", "teacher__user").filter(
        Q(department=department) | Q(user__department=department)
    )
    if student_id not in (None, ""):
        student = qs.filter(id=student_id).first()
        if student:
            return student
    if user_id not in (None, ""):
        return qs.filter(user_id=user_id).first()
    return None


def _resolve_department_teacher(department, teacher_id, fallback_teacher=None):
    if teacher_id in (None, ""):
        return fallback_teacher
    return (
        TeacherProfile.objects.select_related("user")
        .filter(Q(department=department) | Q(user__department=department))
        .filter(Q(id=teacher_id) | Q(user_id=teacher_id))
        .first()
    )


def _require_quran_manager(request):
    if not is_department_manager(request.user):
        return None, Response(
            {"detail": "Only department admins and coordinators can manage schedules."},
            status=status.HTTP_403_FORBIDDEN,
        )
    department = _user_department(request.user)
    if not department:
        return None, Response(
            {"detail": "Quran department assignment is required."},
            status=status.HTTP_403_FORBIDDEN,
        )
    return department, None


class QuranScheduleChangePreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        department, error_response = _require_quran_manager(request)
        if error_response:
            return error_response

        from .schedule_change_service import preview_schedule_salary_change

        student = _resolve_department_student(department, request.data)
        if not student:
            return Response(
                {"detail": "Student not found in Quran department."},
                status=status.HTTP_404_NOT_FOUND,
            )

        teacher = _resolve_department_teacher(
            department,
            request.data.get("teacher_id"),
            fallback_teacher=student.teacher,
        )
        new_class_days = request.data.get("class_days")
        if not isinstance(new_class_days, list) or not new_class_days:
            return Response(
                {"detail": "class_days must be a non-empty list."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        eff_date = _parse_date_value(request.data.get("effective_date")) or academy_localdate()
        time_slot = _parse_time_value(request.data.get("time_slot"))
        duration_minutes = request.data.get("duration_minutes")

        payload = preview_schedule_salary_change(
            department=department,
            student=student,
            new_class_days=new_class_days,
            effective_date=eff_date,
            new_teacher=teacher,
            new_time_slot=time_slot,
            duration_minutes=duration_minutes,
            actor=request.user,
        )
        return _no_store(Response(payload, status=status.HTTP_200_OK))


class QuranScheduleChangeConfirmView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        department, error_response = _require_quran_manager(request)
        if error_response:
            return error_response

        from .payroll_source_locks import PayrollSourceLockedError
        from .schedule_change_service import apply_schedule_change_with_salary_mode

        student = _resolve_department_student(department, request.data)
        if not student:
            return Response(
                {"detail": "Student not found in Quran department."},
                status=status.HTTP_404_NOT_FOUND,
            )

        teacher = _resolve_department_teacher(
            department,
            request.data.get("teacher_id"),
            fallback_teacher=student.teacher,
        )
        if not teacher:
            return Response(
                {"detail": "Teacher not found in Quran department."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_class_days = request.data.get("class_days")
        if not isinstance(new_class_days, list) or not new_class_days:
            return Response(
                {"detail": "class_days must be a non-empty list."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing_schedule = student.schedules.filter(is_active=True).order_by("id").first()
        time_slot = _parse_time_value(request.data.get("time_slot")) or (
            existing_schedule.time_slot if existing_schedule else None
        )
        if not time_slot:
            return Response(
                {"detail": "time_slot is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        duration_minutes = request.data.get("duration_minutes")
        if duration_minutes is None and existing_schedule:
            duration_minutes = getattr(existing_schedule, "duration_minutes", 30) or 30

        eff_date = _parse_date_value(request.data.get("effective_date")) or academy_localdate()
        salary_mode = str(request.data.get("salary_mode") or "preserve").strip()

        try:
            result = apply_schedule_change_with_salary_mode(
                department=department,
                student=student,
                teacher=teacher,
                time_slot=time_slot,
                class_days=new_class_days,
                duration_minutes=duration_minutes or 30,
                effective_date=eff_date,
                salary_mode=salary_mode,
                actor=request.user,
            )
        except PayrollSourceLockedError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_409_CONFLICT)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        notify_global(
            "academy_update",
            {
                "event": "schedule_updated",
                "student_id": student.id,
                "teacher_id": teacher.id,
            },
        )
        return _no_store(Response(result, status=status.HTTP_200_OK))



