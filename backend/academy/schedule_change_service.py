from __future__ import annotations

import calendar
from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable

from django.db import transaction
from django.db.models import Sum

from accounts.models import PlatformAuditLog
from accounts.serializers import (
    _student_history,
    _sync_schedule_activity_for_status,
    sync_student_schedules,
)

from .models import ClassSchedule, StudentClassHistory, StudentProfile, TeacherProfile
from .payroll_source_locks import (
    PayrollSourceLockedError,
    ensure_student_state_change_payroll_editable,
)
from .salary_v2_models import (
    QuranSalaryLedgerEntry,
    QuranSalaryPolicy,
    QuranTeacherMonthlyPayroll,
)
from .salary_v2_service import calculate_department_payrolls, decimal_text, money
from .student_status_service import academy_localdate


WEEKDAY_ORDER = [
    ClassSchedule.WeekDay.MONDAY,
    ClassSchedule.WeekDay.TUESDAY,
    ClassSchedule.WeekDay.WEDNESDAY,
    ClassSchedule.WeekDay.THURSDAY,
    ClassSchedule.WeekDay.FRIDAY,
    ClassSchedule.WeekDay.SATURDAY,
    ClassSchedule.WeekDay.SUNDAY,
]
VALID_WEEKDAY_SET = set(WEEKDAY_ORDER)


def normalize_class_days(class_days: Iterable[str] | None) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in class_days or []:
        day = str(raw or "").strip().lower()
        if day in VALID_WEEKDAY_SET and day not in seen:
            seen.add(day)
            normalized.append(day)
    order_index = {day: idx for idx, day in enumerate(WEEKDAY_ORDER)}
    normalized.sort(key=lambda d: order_index.get(d, 99))
    return normalized


def _frequency_label(days_count: int) -> str:
    if days_count <= 0:
        return "0 days / week"
    unit = "day" if days_count == 1 else "days"
    return f"{days_count} {unit} / week"


def _has_published_unified_policy(department) -> bool:
    from salary.models import SalaryPolicyVersion

    return SalaryPolicyVersion.objects.filter(
        policy__department=department,
        status=SalaryPolicyVersion.Status.PUBLISHED,
    ).exists()


def _ensure_unified_payroll_editable(department, eff_date: date) -> None:
    from salary.models import SalaryPayrollPeriod

    locked_period = SalaryPayrollPeriod.objects.filter(
        department=department,
        payroll_year=eff_date.year,
        payroll_month=eff_date.month,
        status__in=[
            SalaryPayrollPeriod.Status.PENDING_APPROVAL,
            SalaryPayrollPeriod.Status.APPROVED,
            SalaryPayrollPeriod.Status.PAID,
        ],
    ).first()
    if locked_period:
        raise PayrollSourceLockedError(
            {
                "detail": (
                    f"Unified payroll for {eff_date.strftime('%B %Y')} is "
                    f"{locked_period.get_status_display()} and cannot be recalculated."
                )
            }
        )


def _tier_summary(department, teacher: TeacherProfile | None, days_count: int, eff_date: date) -> dict:
    plan_name = None
    try:
        from salary.models import SalaryPolicyVersion, SalaryTeachingPlan

        published = (
            SalaryPolicyVersion.objects.filter(
                policy__department=department,
                status=SalaryPolicyVersion.Status.PUBLISHED,
            )
            .order_by("-version_number", "-id")
            .first()
        )
        if published:
            plan = (
                SalaryTeachingPlan.objects.filter(
                    policy_version=published,
                    days_per_week=days_count,
                )
                .order_by("sort_order", "id")
                .first()
            )
            if plan:
                plan_name = plan.plan_name
    except Exception:
        plan_name = None

    policy = (
        QuranSalaryPolicy.objects.filter(
            department=department,
            effective_from__lte=eff_date,
        )
        .order_by("-effective_from", "-id")
        .first()
    )
    policy_label = None
    if policy:
        policy_label = (
            f"Per-Class Tier ({policy.rate_1_to_15} / {policy.rate_16_to_19} / {policy.rate_20_plus})"
        )

    freq_label = _frequency_label(days_count)
    display_label = f"{plan_name} ({freq_label})" if plan_name else freq_label
    return {
        "frequency": days_count,
        "salary_class_mode": freq_label,
        "plan_name": plan_name,
        "policy_label": policy_label,
        "display_label": display_label,
    }


def _cleanup_stale_pending_verifications(department, student: StudentProfile, from_date: date) -> None:
    """
    Remove unverified/pending SalaryAttendanceVerification rows on or after from_date
    whose source_schedule_id is no longer active for that date, preventing duplicate
    entries when schedules change mid-month.
    """
    try:
        from salary.models import SalaryAttendanceVerification

        active_ids = set(
            student.schedules.filter(is_active=True).values_list("id", flat=True)
        )
        stale_qs = SalaryAttendanceVerification.objects.filter(
            department=department,
            student=student,
            class_date__gte=from_date,
            verification_status=SalaryAttendanceVerification.VerificationStatus.PENDING,
            source_attendance_id__isnull=True,
        ).exclude(source_schedule_id__in=active_ids)
        stale_qs.delete()
    except Exception:
        pass


def _reconcile_and_invalidate_unified_salary(
    department,
    year: int,
    month: int,
    actor=None,
    teacher_ids: Iterable[int] | None = None,
) -> None:
    from salary.attendance_reconciler import AttendanceReconcilerService
    from salary.views import invalidate_salary_preview_cache

    AttendanceReconcilerService.reconcile_period(
        department=department,
        year=year,
        month=month,
        user=actor,
    )
    invalidate_salary_preview_cache(department.id, year, month)
    for tid in teacher_ids or []:
        if tid:
            invalidate_salary_preview_cache(department.id, year, month, teacher_id=tid)


def _apply_unified_tier_override(
    *,
    department,
    student: StudentProfile,
    teacher: TeacherProfile,
    year: int,
    month: int,
    previous_days: list[str],
    proposed_days: list[str],
    eff_date: date,
) -> int:
    """
    Stamp an explicit Option B salary-tier override onto current-month
    SalaryAttendanceVerification rows without altering historical ClassSchedule rows.
    """
    from salary.models import SalaryAttendanceVerification

    last_day = calendar.monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, last_day)

    new_freq = len(proposed_days)
    prev_freq = len(previous_days)
    reason = (
        f"Authorized schedule-change override "
        f"(Historical: {prev_freq} day{'s' if prev_freq != 1 else ''}/week -> "
        f"Applied: {new_freq} day{'s' if new_freq != 1 else ''}/week)"
    )

    verifs = list(
        SalaryAttendanceVerification.objects.filter(
            department=department,
            student=student,
            teacher=teacher,
            class_date__range=(month_start, month_end),
        )
    )
    updated = 0
    for v in verifs:
        snap = dict(v.source_evidence_snapshot or {})
        snap["salary_tier_override_days_per_week"] = new_freq
        snap["salary_tier_override_plan_label"] = _frequency_label(new_freq)
        snap["salary_tier_override_reason"] = reason
        snap["salary_tier_override_effective_date"] = eff_date.isoformat()
        snap["historical_schedule_days_per_week"] = prev_freq
        v.source_evidence_snapshot = snap
        v.save(update_fields=["source_evidence_snapshot"])
        updated += 1
    return updated


def _clear_unified_tier_override(
    *,
    department,
    student: StudentProfile,
    from_date: date,
) -> None:
    try:
        from salary.models import SalaryAttendanceVerification

        verifs = list(
            SalaryAttendanceVerification.objects.filter(
                department=department,
                student=student,
                class_date__gte=from_date,
            )
        )
        for v in verifs:
            snap = dict(v.source_evidence_snapshot or {})
            changed = False
            for key in (
                "salary_tier_override_days_per_week",
                "salary_tier_override_plan_label",
                "salary_tier_override_reason",
                "salary_tier_override_effective_date",
                "historical_schedule_days_per_week",
            ):
                if key in snap:
                    snap.pop(key, None)
                    changed = True
            if changed:
                v.source_evidence_snapshot = snap
                v.save(update_fields=["source_evidence_snapshot"])
    except Exception:
        pass


def _teacher_unified_month_metrics(department, teacher: TeacherProfile, student_id: int, year: int, month: int) -> dict:
    from salary.calculation_engine import calculate_teacher_salary_preview

    preview = calculate_teacher_salary_preview(department, teacher, year, month)
    lines = preview.get("class_earning_lines") or []
    student_lines = [ln for ln in lines if ln.get("student_id") == student_id]
    earnings = preview.get("earnings") or {}
    teacher_total = money(
        earnings.get("draft_net_salary")
        or earnings.get("gross_draft_earnings")
        or 0
    )
    student_total = money(
        sum(Decimal(str(ln.get("total_class_earnings") or "0")) for ln in student_lines)
    )
    return {
        "teacher_total": teacher_total,
        "student_total": student_total,
        "affected_classes": len(student_lines),
    }


def _teacher_v2_month_metrics(department, teacher_id: int, student_id: int, year: int, month: int) -> dict:
    payroll = QuranTeacherMonthlyPayroll.objects.filter(
        department=department,
        teacher_id=teacher_id,
        year=year,
        month=month,
    ).first()
    teacher_total = money(payroll.final_total if payroll else 0)
    student_qs = (
        QuranSalaryLedgerEntry.objects.filter(
            payroll=payroll,
            student_id=student_id,
            entry_type=QuranSalaryLedgerEntry.EntryType.NORMAL_EARNING,
        )
        if payroll
        else QuranSalaryLedgerEntry.objects.none()
    )
    student_total = money(student_qs.aggregate(total=Sum("amount")).get("total") or 0)
    affected_classes = student_qs.count()
    return {
        "teacher_total": teacher_total,
        "student_total": student_total,
        "affected_classes": affected_classes,
    }


def _recalculate_v2_if_permitted(department, year: int, month: int, actor, teacher_ids: list[int]) -> None:
    if not teacher_ids:
        return
    try:
        calculate_department_payrolls(
            department,
            year,
            month,
            actor=actor,
            target_teacher_ids=teacher_ids,
        )
    except Exception:
        # Cutover guard or missing V2 policy: ignore when Unified Salary is authoritative
        pass


def preview_schedule_salary_change(
    *,
    department,
    student: StudentProfile,
    new_class_days: Iterable[str],
    effective_date: date | None = None,
    new_teacher: TeacherProfile | None = None,
    new_time_slot=None,
    duration_minutes: int | None = None,
    actor=None,
) -> dict:
    eff_date = effective_date or academy_localdate()
    year, month = eff_date.year, eff_date.month

    active_schedules = list(student.schedules.filter(is_active=True).order_by("weekday", "id"))
    current_days = normalize_class_days([row.weekday for row in active_schedules])
    proposed_days = normalize_class_days(new_class_days)
    target_teacher = new_teacher or student.teacher
    target_time_slot = new_time_slot or (active_schedules[0].time_slot if active_schedules else None)
    target_duration = duration_minutes or (
        getattr(active_schedules[0], "duration_minutes", 30) if active_schedules else 30
    )

    payroll_editable = True
    lock_reason = ""
    try:
        ensure_student_state_change_payroll_editable(
            student=student,
            effective_date=eff_date,
        )
        _ensure_unified_payroll_editable(department, eff_date)
    except PayrollSourceLockedError as exc:
        payroll_editable = False
        lock_reason = str(exc)

    before_tier = _tier_summary(department, student.teacher, len(current_days), eff_date)
    after_tier = _tier_summary(department, target_teacher, len(proposed_days), eff_date)

    before_metrics = {
        "teacher_total": Decimal("0.00"),
        "student_total": Decimal("0.00"),
        "affected_classes": 0,
    }
    after_metrics = {
        "teacher_total": Decimal("0.00"),
        "student_total": Decimal("0.00"),
        "affected_classes": 0,
    }

    use_unified = _has_published_unified_policy(department)

    if target_teacher:
        if payroll_editable and target_time_slot and proposed_days:
            with transaction.atomic():
                sid = transaction.savepoint()
                try:
                    if use_unified:
                        _reconcile_and_invalidate_unified_salary(
                            department, year, month, actor=actor, teacher_ids=[target_teacher.id]
                        )
                        before_metrics = _teacher_unified_month_metrics(
                            department, target_teacher, student.id, year, month
                        )
                    else:
                        _recalculate_v2_if_permitted(
                            department, year, month, actor, [target_teacher.id]
                        )
                        before_metrics = _teacher_v2_month_metrics(
                            department, target_teacher.id, student.id, year, month
                        )

                    # Simulate Option B: preserve historical schedules before eff_date, apply new from eff_date,
                    # and apply Option B tier override across current-month draft occurrences.
                    sync_student_schedules(
                        student=student,
                        teacher=target_teacher,
                        time_slot=target_time_slot,
                        class_days=proposed_days,
                        duration_minutes=target_duration,
                        effective_date=eff_date,
                        preserve_history=True,
                    )
                    if use_unified:
                        _cleanup_stale_pending_verifications(department, student, eff_date)
                        _reconcile_and_invalidate_unified_salary(
                            department, year, month, actor=actor, teacher_ids=[target_teacher.id]
                        )
                        _apply_unified_tier_override(
                            department=department,
                            student=student,
                            teacher=target_teacher,
                            year=year,
                            month=month,
                            previous_days=current_days,
                            proposed_days=proposed_days,
                            eff_date=eff_date,
                        )
                        after_metrics = _teacher_unified_month_metrics(
                            department, target_teacher, student.id, year, month
                        )
                    else:
                        _recalculate_v2_if_permitted(
                            department, year, month, actor, [target_teacher.id]
                        )
                        after_metrics = _teacher_v2_month_metrics(
                            department, target_teacher.id, student.id, year, month
                        )
                finally:
                    transaction.savepoint_rollback(sid)
        else:
            if use_unified:
                before_metrics = _teacher_unified_month_metrics(
                    department, target_teacher, student.id, year, month
                )
            else:
                before_metrics = _teacher_v2_month_metrics(
                    department, target_teacher.id, student.id, year, month
                )
            after_metrics = dict(before_metrics)

    teacher_diff = money(after_metrics["teacher_total"] - before_metrics["teacher_total"])
    student_diff = money(after_metrics["student_total"] - before_metrics["student_total"])

    return {
        "student_id": student.id,
        "student_name": student.user.get_full_name() or student.user.username,
        "student_username": student.user.username,
        "teacher_id": target_teacher.id if target_teacher else None,
        "teacher_name": (
            target_teacher.user.get_full_name() or target_teacher.user.username
            if target_teacher
            else ""
        ),
        "effective_date": eff_date.isoformat(),
        "payroll_year": year,
        "payroll_month": month,
        "payroll_month_label": eff_date.strftime("%B %Y"),
        "payroll_editable": payroll_editable,
        "recalculate_allowed": payroll_editable and bool(target_teacher and target_time_slot and proposed_days),
        "lock_reason": lock_reason,
        "current_class_days": current_days,
        "proposed_class_days": proposed_days,
        "previous_frequency": len(current_days),
        "new_frequency": len(proposed_days),
        "before_tier": before_tier,
        "after_tier": after_tier,
        "before_amount": decimal_text(before_metrics["teacher_total"]),
        "after_amount": decimal_text(after_metrics["teacher_total"]),
        "monetary_difference": decimal_text(teacher_diff),
        "student_before_amount": decimal_text(before_metrics["student_total"]),
        "student_after_amount": decimal_text(after_metrics["student_total"]),
        "student_monetary_difference": decimal_text(student_diff),
        "affected_classes_count": after_metrics["affected_classes"] or before_metrics["affected_classes"],
    }


@transaction.atomic
def apply_schedule_change_with_salary_mode(
    *,
    department,
    student: StudentProfile,
    teacher: TeacherProfile,
    time_slot,
    class_days: Iterable[str],
    duration_minutes: int = 30,
    effective_date: date | None = None,
    salary_mode: str = "preserve",
    actor=None,
) -> dict:
    if salary_mode not in ("preserve", "recalculate_current_month"):
        raise ValueError("salary_mode must be 'preserve' or 'recalculate_current_month'.")

    eff_date = effective_date or academy_localdate()
    proposed_days = normalize_class_days(class_days)
    if not proposed_days:
        raise ValueError("At least one valid class day is required.")
    if not time_slot:
        raise ValueError("A valid class time slot is required.")

    try:
        dur = int(duration_minutes or 30)
    except (TypeError, ValueError):
        dur = 30
    if dur not in (30, 60):
        dur = 30

    previous_teacher = student.teacher
    previous_days = normalize_class_days(
        student.schedules.filter(is_active=True).values_list("weekday", flat=True)
    )
    affected_teacher_ids = sorted({t.id for t in (previous_teacher, teacher) if t})

    if salary_mode == "recalculate_current_month":
        ensure_student_state_change_payroll_editable(
            student=student,
            effective_date=eff_date,
        )
        _ensure_unified_payroll_editable(department, eff_date)

    if previous_teacher != teacher:
        student.teacher = teacher
        student.save(update_fields=["teacher"])

    use_unified = _has_published_unified_policy(department)
    preview_before = (
        _teacher_unified_month_metrics(department, teacher, student.id, eff_date.year, eff_date.month)
        if use_unified
        else _teacher_v2_month_metrics(department, teacher.id, student.id, eff_date.year, eff_date.month)
    )

    # Always preserve actual historical teaching schedules via effective-dated split!
    sync_student_schedules(
        student=student,
        teacher=teacher,
        time_slot=time_slot,
        class_days=proposed_days,
        duration_minutes=dur,
        effective_date=eff_date,
        preserve_history=True,
    )
    _cleanup_stale_pending_verifications(department, student, eff_date)
    _reconcile_and_invalidate_unified_salary(
        department,
        eff_date.year,
        eff_date.month,
        actor=actor,
        teacher_ids=affected_teacher_ids,
    )

    if salary_mode == "preserve":
        _clear_unified_tier_override(
            department=department,
            student=student,
            from_date=eff_date,
        )
    else:
        _apply_unified_tier_override(
            department=department,
            student=student,
            teacher=teacher,
            year=eff_date.year,
            month=eff_date.month,
            previous_days=previous_days,
            proposed_days=proposed_days,
            eff_date=eff_date,
        )
        _recalculate_v2_if_permitted(
            department, eff_date.year, eff_date.month, actor, affected_teacher_ids
        )

    # Ensure cache is cleared after override/recalculation
    _reconcile_and_invalidate_unified_salary(
        department,
        eff_date.year,
        eff_date.month,
        actor=actor,
        teacher_ids=affected_teacher_ids,
    )

    _sync_schedule_activity_for_status(student)
    _student_history(
        student=student,
        event_type=StudentClassHistory.EventType.STATUS_CHANGED,
        actor=actor,
        previous_teacher=previous_teacher,
        new_teacher=teacher,
        previous_student_type=student.student_type,
        new_student_type=student.student_type,
        previous_class_status=student.class_status,
        new_class_status=student.class_status,
        notes=(
            f"Schedule updated ({', '.join(previous_days)} -> {', '.join(proposed_days)}) "
            f"with salary_mode={salary_mode}."
        ),
        effective_date=eff_date,
    )

    preview_after = (
        _teacher_unified_month_metrics(department, teacher, student.id, eff_date.year, eff_date.month)
        if use_unified
        else _teacher_v2_month_metrics(department, teacher.id, student.id, eff_date.year, eff_date.month)
    )

    PlatformAuditLog.objects.create(
        actor=actor,
        category="schedule_salary",
        action="schedule_change_confirmed",
        summary=(
            f"Updated {student.user.username} class days ({len(previous_days)} -> {len(proposed_days)}/wk) "
            f"with mode '{salary_mode}'."
        ),
        target_type="student",
        target_id=str(student.id),
        target_label=student.user.username,
        details={
            "student_id": student.id,
            "teacher_id": teacher.id,
            "previous_days": previous_days,
            "proposed_days": proposed_days,
            "effective_date": eff_date.isoformat(),
            "salary_mode": salary_mode,
            "before_teacher_total": decimal_text(preview_before["teacher_total"]),
            "after_teacher_total": decimal_text(preview_after["teacher_total"]),
        },
    )

    return {
        "student_id": student.id,
        "teacher_id": teacher.id,
        "class_days": proposed_days,
        "salary_mode": salary_mode,
        "effective_date": eff_date.isoformat(),
        "before_teacher_total": decimal_text(preview_before["teacher_total"]),
        "after_teacher_total": decimal_text(preview_after["teacher_total"]),
    }
