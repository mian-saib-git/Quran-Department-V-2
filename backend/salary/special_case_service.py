"""
Service layer for assigning and removing the Coordinator Special salary package
for individual teachers via the Special Case flag on TeacherPolicyAssignment.
"""
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import connection, models, transaction
from django.utils import timezone

ACADEMY_TIME_ZONE = ZoneInfo("Asia/Karachi")


def _academy_today() -> date:
    return timezone.localdate(timezone=ACADEMY_TIME_ZONE)

from accounts.models import Department, PlatformAuditLog
from salary.models import (
    SalaryPayrollPeriod,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryTeachingPlan,
    TeacherPolicyAssignment,
    get_policy_published_coverage_intervals,
    resolve_teacher_policy_coverage,
)
from salary.permissions import get_authorized_department_id_for_user

LOCKED_PAYROLL_STATUSES = [
    SalaryPayrollPeriod.Status.DEPARTMENT_REVIEW,
    SalaryPayrollPeriod.Status.PENDING_APPROVAL,
    SalaryPayrollPeriod.Status.APPROVED,
    SalaryPayrollPeriod.Status.PAID,
]

EDITABLE_PAYROLL_STATUSES = [
    SalaryPayrollPeriod.Status.DRAFT,
    SalaryPayrollPeriod.Status.RETURNED_FOR_CORRECTION,
]


def find_coordinator_special_package(
    department: Department,
    prefer_policy: Optional[SalaryPolicy] = None,
) -> Tuple[Optional[SalaryPolicy], Optional[SalaryPolicyVersion], Optional[SalaryTeachingPlan]]:
    """Find an active, published SalaryPolicy in `department` with a Coordinator Special plan."""
    if not department:
        return None, None, None

    candidates = list(
        SalaryPolicy.objects.filter(
            department=department,
            is_active=True,
            is_archived=False,
        ).order_by("id")
    )
    if prefer_policy and prefer_policy in candidates:
        candidates.remove(prefer_policy)
        candidates.insert(0, prefer_policy)

    today = _academy_today()
    for policy in candidates:
        versions = list(
            policy.versions.filter(status=SalaryPolicyVersion.Status.PUBLISHED)
            .prefetch_related("teaching_plans")
            .order_by("-effective_from", "-version_number")
        )
        # Prefer version covering today, otherwise latest published version
        covering = [
            v
            for v in versions
            if v.effective_from <= today and (v.effective_to is None or v.effective_to >= today)
        ]
        ordered_versions = covering + [v for v in versions if v not in covering]
        for version in ordered_versions:
            coord_plan = next(
                (p for p in version.teaching_plans.all() if p.is_coordinator_special),
                None,
            )
            if coord_plan:
                return policy, version, coord_plan

    return None, None, None


def get_available_normal_policies(department: Department) -> List[SalaryPolicy]:
    """Return active, non-archived, published policies in `department` suitable for normal teachers."""
    if not department:
        return []
    policies = (
        SalaryPolicy.objects.filter(
            department=department,
            is_active=True,
            is_archived=False,
            versions__status=SalaryPolicyVersion.Status.PUBLISHED,
        )
        .distinct()
        .order_by("name", "id")
    )
    return list(policies)


def get_teacher_active_assignment(
    teacher,
    target_date: Optional[date] = None,
) -> Optional[TeacherPolicyAssignment]:
    """Return the teacher's active TeacherPolicyAssignment covering `target_date`."""
    if not teacher or not getattr(teacher, "department_id", None):
        return None
    target = target_date or _academy_today()
    return (
        TeacherPolicyAssignment.objects.filter(
            teacher=teacher,
            department_id=teacher.department_id,
            is_active=True,
            effective_from__lte=target,
        )
        .filter(models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=target))
        .select_related("policy")
        .order_by("-effective_from", "-id")
        .first()
    )


def _check_payroll_period_status(department_id: int, target_date: date) -> Tuple[Optional[SalaryPayrollPeriod], bool]:
    """Return (period, is_locked) for the month of `target_date`."""
    period = SalaryPayrollPeriod.objects.filter(
        department_id=department_id,
        payroll_year=target_date.year,
        payroll_month=target_date.month,
    ).first()
    if not period:
        return None, False
    return period, period.status in LOCKED_PAYROLL_STATUSES


def _resolve_default_effective_from(policy: SalaryPolicy, teacher=None, requested_date: Optional[date] = None) -> date:
    """Resolve a valid default effective_from date within policy coverage and teacher joining date."""
    today = requested_date or _academy_today()
    if teacher and getattr(teacher, "joining_date", None) and requested_date is None:
        if teacher.joining_date > today:
            today = teacher.joining_date

    intervals = get_policy_published_coverage_intervals(policy)
    if not intervals:
        return today

    earliest_start = intervals[0][0]
    latest_end = (
        intervals[-1][1]
        if intervals[-1][1] is not None and all(i[1] is not None for i in intervals)
        else None
    )

    eff = today
    if eff < earliest_start:
        eff = earliest_start
    if teacher and getattr(teacher, "joining_date", None) and eff < teacher.joining_date:
        eff = teacher.joining_date
    if latest_end is not None and eff > latest_end:
        eff = latest_end
    return eff


def get_teacher_special_case_context(
    department: Department,
    teacher=None,
    target_date: Optional[date] = None,
) -> Dict[str, Any]:
    """Build UI/API metadata for enabling or disabling Special Case on a teacher."""
    today = target_date or _academy_today()
    current_assignment = get_teacher_active_assignment(teacher, today) if teacher else None
    prefer_policy = current_assignment.policy if current_assignment and current_assignment.policy else None

    coord_policy, coord_version, coord_plan = find_coordinator_special_package(
        department, prefer_policy=prefer_policy
    )
    normal_policies = get_available_normal_policies(department)

    package_info = None
    config_error = None
    proposed_effective_from = today

    if coord_policy and coord_version and coord_plan:
        proposed_effective_from = _resolve_default_effective_from(coord_policy, teacher, target_date)
        package_info = {
            "policy_id": coord_policy.id,
            "policy_code": coord_policy.code,
            "policy_name": coord_policy.name,
            "version_id": coord_version.id,
            "version_number": coord_version.version_number,
            "plan_id": coord_plan.id,
            "plan_code": coord_plan.plan_code,
            "plan_name": coord_plan.plan_name,
            "qualifying_weekdays": list(getattr(coord_version, "coordinator_qualifying_weekdays", None) or []),
            "effective_from": coord_version.effective_from.isoformat(),
            "effective_to": coord_version.effective_to.isoformat() if coord_version.effective_to else None,
        }
    else:
        config_error = (
            "Coordinator Special salary package is not configured for this department. "
            "Please configure a published salary policy with a Coordinator Special teaching plan."
        )

    period, is_locked = _check_payroll_period_status(department.id, proposed_effective_from)
    payroll_warning = None
    if period and is_locked:
        payroll_warning = (
            f"Payroll for {period.payroll_year}-{period.payroll_month:02d} is in "
            f"'{period.get_status_display()}' status and cannot be modified retroactively."
        )
    elif period and period.status in EDITABLE_PAYROLL_STATUSES:
        payroll_warning = (
            f"Payroll for {period.payroll_year}-{period.payroll_month:02d} is currently in "
            f"'{period.get_status_display()}' status. Changing Special Case will affect draft payroll calculations."
        )

    result: Dict[str, Any] = {
        "coordinator_special_configured": bool(package_info),
        "coordinator_special_package": package_info,
        "configuration_error": config_error,
        "proposed_effective_from": proposed_effective_from.isoformat(),
        "payroll_period_locked": is_locked,
        "payroll_period_warning": payroll_warning,
        "available_normal_policies": [
            {"id": p.id, "code": p.code, "name": p.name} for p in normal_policies
        ],
    }

    if teacher is not None:
        current_special = bool(current_assignment and current_assignment.is_special_case)
        result["current_special_case"] = current_special
        result["current_assignment"] = (
            {
                "id": current_assignment.id,
                "policy_id": current_assignment.policy_id,
                "policy_code": current_assignment.policy.code if current_assignment.policy else current_assignment.policy_snapshot_code,
                "policy_name": current_assignment.policy.name if current_assignment.policy else current_assignment.policy_snapshot_name,
                "effective_from": current_assignment.effective_from.isoformat(),
                "effective_to": current_assignment.effective_to.isoformat() if current_assignment.effective_to else None,
                "is_special_case": current_assignment.is_special_case,
            }
            if current_assignment
            else None
        )

        # Identify unambiguous previous normal policy when disabling Special Case
        previous_normal = None
        requires_selection = False
        valid_normal_ids = {p.id for p in normal_policies}

        prior_normal_assignments = list(
            TeacherPolicyAssignment.objects.filter(
                teacher=teacher,
                department=department,
                is_special_case=False,
                policy_id__in=valid_normal_ids,
            )
            .select_related("policy")
            .order_by("-effective_from", "-id")
        )

        distinct_prior_ids = []
        for a in prior_normal_assignments:
            if a.policy_id and a.policy_id not in distinct_prior_ids:
                distinct_prior_ids.append(a.policy_id)

        if len(distinct_prior_ids) == 1:
            pol = next(p for p in normal_policies if p.id == distinct_prior_ids[0])
            previous_normal = {"id": pol.id, "code": pol.code, "name": pol.name}
        elif len(distinct_prior_ids) > 1:
            # Multiple prior normal policies in history: do not guess
            requires_selection = True
        else:
            # No prior normal assignment: check if there's a single unambiguous normal policy
            if len(normal_policies) == 1:
                pol = normal_policies[0]
                previous_normal = {"id": pol.id, "code": pol.code, "name": pol.name}
            elif current_assignment and current_assignment.policy_id in valid_normal_ids and len(normal_policies) > 1:
                # Current assignment's policy is valid, but other normal policies also exist — require explicit confirmation/selection if multiple
                pol = current_assignment.policy
                previous_normal = {"id": pol.id, "code": pol.code, "name": pol.name}
                requires_selection = True
            elif len(normal_policies) > 1:
                requires_selection = True

        result["previous_normal_policy"] = previous_normal
        result["requires_replacement_selection"] = requires_selection

    return result


def apply_teacher_special_case(
    *,
    actor,
    teacher,
    enable: bool,
    effective_from: Optional[date] = None,
    replacement_policy_id: Optional[int] = None,
) -> Optional[TeacherPolicyAssignment]:
    """
    Transactionally enable or disable the Coordinator Special salary package
    for an individual teacher without changing their role or affecting other teachers.
    """
    if not teacher or not getattr(teacher, "department_id", None):
        raise ValidationError({"special_case": "Teacher must belong to a department before assigning a salary package."})

    auth_dept_id = get_authorized_department_id_for_user(actor, teacher.department_id)
    if not auth_dept_id or auth_dept_id != teacher.department_id:
        raise PermissionDenied("Only authorized administrators can assign or remove Special Case salary packages.")

    department = teacher.department

    with transaction.atomic():
        lock_kwargs = {"of": ("self",)} if getattr(connection.features, "has_select_for_update_of", False) else {}
        locked_teacher = type(teacher).objects.select_for_update(**lock_kwargs).get(pk=teacher.pk)

        if enable:
            existing_active = get_teacher_active_assignment(locked_teacher, effective_from or _academy_today())
            prefer_pol = existing_active.policy if existing_active and existing_active.policy else None
            coord_policy, _ver, _plan = find_coordinator_special_package(department, prefer_policy=prefer_pol)
            if not coord_policy:
                raise ValidationError({
                    "special_case": (
                        "Coordinator Special salary package is not configured for this department. "
                        "Please configure a published salary policy with a Coordinator Special teaching plan."
                    )
                })

            eff_date = effective_from or _resolve_default_effective_from(coord_policy, locked_teacher)
            coverage = resolve_teacher_policy_coverage(coord_policy, locked_teacher)
            if eff_date < coverage["effective_from"]:
                raise ValidationError({
                    "special_case_effective_from": (
                        f"Effective date ({eff_date}) cannot precede allowable coverage start ({coverage['effective_from']})."
                    )
                })
            if coverage["effective_to"] is not None and eff_date > coverage["effective_to"]:
                raise ValidationError({
                    "special_case_effective_from": (
                        f"Effective date ({eff_date}) is after policy coverage ended ({coverage['effective_to']})."
                    )
                })

            # Check idempotency / current assignment on eff_date
            current_on_date = get_teacher_active_assignment(locked_teacher, eff_date)
            if current_on_date and current_on_date.is_special_case and current_on_date.policy_id == coord_policy.id:
                return current_on_date

            # Enforce payroll lock protection on eff_date
            period, is_locked = _check_payroll_period_status(department.id, eff_date)
            if is_locked:
                raise ValidationError({
                    "special_case_effective_from": (
                        f"Cannot enable Special Case effective {eff_date}: Payroll for "
                        f"{period.payroll_year}-{period.payroll_month:02d} is '{period.get_status_display()}' "
                        "and is protected against modifications."
                    )
                })

            # Prevent overwriting future assignments
            future_conflict = (
                TeacherPolicyAssignment.objects.select_for_update(**lock_kwargs)
                .filter(
                    teacher=locked_teacher,
                    department=department,
                    is_active=True,
                    effective_from__gt=eff_date,
                )
                .first()
            )
            if future_conflict:
                raise ValidationError({
                    "special_case_effective_from": (
                        f"Teacher already has a future active assignment starting {future_conflict.effective_from}. "
                        "Choose an effective date on or after that date, or manage it in Salary Assignments."
                    )
                })

            if current_on_date:
                if current_on_date.effective_from == eff_date:
                    current_on_date.policy = coord_policy
                    current_on_date.is_special_case = True
                    current_on_date.assigned_by = actor
                    current_on_date.save()
                    assignment = current_on_date
                else:
                    # Preserve historical assignment prior to eff_date
                    current_on_date.effective_to = eff_date - timedelta(days=1)
                    current_on_date.save()
                    assignment = TeacherPolicyAssignment.objects.create(
                        department=department,
                        teacher=locked_teacher,
                        policy=coord_policy,
                        effective_from=eff_date,
                        effective_to=coverage["effective_to"],
                        is_active=True,
                        is_special_case=True,
                        assigned_by=actor,
                        notes="Assigned Coordinator Special package via Special Case.",
                    )
            else:
                assignment = TeacherPolicyAssignment.objects.create(
                    department=department,
                    teacher=locked_teacher,
                    policy=coord_policy,
                    effective_from=eff_date,
                    effective_to=coverage["effective_to"],
                    is_active=True,
                    is_special_case=True,
                    assigned_by=actor,
                    notes="Assigned Coordinator Special package via Special Case.",
                )

            _log_special_case_audit(actor, locked_teacher, assignment, "enable_special_case")
            return assignment

        else:
            # Disabling Special Case
            eff_date = effective_from or _academy_today()
            current_on_date = get_teacher_active_assignment(locked_teacher, eff_date)
            if not current_on_date or not current_on_date.is_special_case:
                # Already normal or no Special Case assignment
                return current_on_date

            period, is_locked = _check_payroll_period_status(department.id, eff_date)
            if is_locked:
                raise ValidationError({
                    "special_case_effective_from": (
                        f"Cannot disable Special Case effective {eff_date}: Payroll for "
                        f"{period.payroll_year}-{period.payroll_month:02d} is '{period.get_status_display()}' "
                        "and is protected against modifications."
                    )
                })

            # Resolve replacement normal policy
            replacement_policy = None
            if replacement_policy_id:
                replacement_policy = SalaryPolicy.objects.filter(
                    pk=replacement_policy_id,
                    department=department,
                    is_active=True,
                    is_archived=False,
                ).first()
                if not replacement_policy or not replacement_policy.versions.filter(
                    status=SalaryPolicyVersion.Status.PUBLISHED
                ).exists():
                    raise ValidationError({
                        "replacement_policy_id": "Selected replacement salary package is invalid, inactive, or unpublished."
                    })
            else:
                ctx = get_teacher_special_case_context(department, locked_teacher, eff_date)
                if ctx.get("requires_replacement_selection") or not ctx.get("previous_normal_policy"):
                    raise ValidationError({
                        "replacement_policy_id": "Please select a valid normal salary package to restore when disabling Special Case."
                    })
                replacement_policy = SalaryPolicy.objects.get(pk=ctx["previous_normal_policy"]["id"])

            coverage = resolve_teacher_policy_coverage(replacement_policy, locked_teacher)
            if eff_date < coverage["effective_from"]:
                eff_date = coverage["effective_from"]
            if coverage["effective_to"] is not None and eff_date > coverage["effective_to"]:
                raise ValidationError({
                    "special_case_effective_from": (
                        f"Effective date ({eff_date}) is after replacement policy coverage ended ({coverage['effective_to']})."
                    )
                })

            if current_on_date.effective_from == eff_date:
                current_on_date.policy = replacement_policy
                current_on_date.is_special_case = False
                current_on_date.assigned_by = actor
                current_on_date.save()
                assignment = current_on_date
            else:
                # Preserve historical Special Case assignment prior to eff_date
                current_on_date.effective_to = eff_date - timedelta(days=1)
                current_on_date.save()
                assignment = TeacherPolicyAssignment.objects.create(
                    department=department,
                    teacher=locked_teacher,
                    policy=replacement_policy,
                    effective_from=eff_date,
                    effective_to=coverage["effective_to"],
                    is_active=True,
                    is_special_case=False,
                    assigned_by=actor,
                    notes="Disabled Special Case; restored normal salary package.",
                )

            _log_special_case_audit(actor, locked_teacher, assignment, "disable_special_case")
            return assignment


def _log_special_case_audit(actor, teacher, assignment: TeacherPolicyAssignment, action: str):
    try:
        from salary.attendance_reconciler import invalidate_salary_preview_cache
        from salary.views import invalidate_department_salary_preview_cache

        invalidate_department_salary_preview_cache(assignment.department_id)
        today = _academy_today()
        months = {(today.year, today.month)}
        if assignment.effective_from:
            months.add((assignment.effective_from.year, assignment.effective_from.month))
        for y, m in months:
            invalidate_salary_preview_cache(assignment.department_id, y, m)
    except Exception:
        pass
    try:
        teacher_name = getattr(teacher, "historical_name", None) or (
            teacher.user.get_full_name() if teacher.user else f"Teacher #{teacher.id}"
        )
        policy_name = assignment.policy.name if assignment.policy else "Unknown"
        PlatformAuditLog.objects.create(
            actor=actor,
            category="salary_assignment",
            action=action,
            summary=(
                f"{'Enabled' if action == 'enable_special_case' else 'Disabled'} Special Case "
                f"for {teacher_name} (Policy: '{policy_name}', effective {assignment.effective_from})"
            ),
            target_type="TeacherPolicyAssignment",
            target_id=str(assignment.id),
            target_label=f"{teacher_name} -> {policy_name}",
            details={
                "assignment_id": assignment.id,
                "department_id": assignment.department_id,
                "teacher_id": assignment.teacher_id,
                "policy_id": assignment.policy_id,
                "is_special_case": assignment.is_special_case,
                "effective_from": assignment.effective_from.isoformat(),
                "effective_to": assignment.effective_to.isoformat() if assignment.effective_to else None,
            },
        )
    except Exception:
        pass
