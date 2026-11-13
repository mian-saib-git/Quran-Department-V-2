"""Deterministic Rate Preview and Precedence Resolver Service (Stage 3).

Implements the agreed 5-level rate precedence hierarchy:
1. Student-specific override (Level 1)
2. Teaching-plan-specific override (Level 2)
3. Teacher-wide override (Level 3)
4. Special coordinator rate for qualifying days (Level 4 override or coordinator plan)
5. Department policy rate (Level 5 base matrix rate)

Deterministic and non-financial: zero ledger postings, zero payroll calculations.
"""
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from django.db import models
from django.db.models import Q

from academy.models import StudentProfile, TeacherProfile
from salary.models import (
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    TeacherPolicyAssignment,
    TeacherSalaryOverride,
)


@dataclass
class ResolvedRateResult:
    is_resolved: bool
    winning_rate: Optional[Decimal]
    precedence_level: Optional[int]
    precedence_name: Optional[str]
    selection_reason: str
    error_message: Optional[str] = None

    # Contextual resolution metadata
    salary_policy: Optional[Dict[str, Any]] = None
    policy_version: Optional[Dict[str, Any]] = None
    rate_tier: Optional[Dict[str, Any]] = None
    teaching_plan: Optional[Dict[str, Any]] = None
    base_plan_rate: Optional[Decimal] = None
    special_coordinator_rate: Optional[Decimal] = None
    matching_override: Optional[Dict[str, Any]] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    evaluated_inputs: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "is_resolved": self.is_resolved,
            "winning_rate": str(self.winning_rate) if self.winning_rate is not None else None,
            "precedence_level": self.precedence_level,
            "precedence_name": self.precedence_name,
            "selection_reason": self.selection_reason,
            "error_message": self.error_message,
            "salary_policy": self.salary_policy,
            "policy_version": self.policy_version,
            "rate_tier": self.rate_tier,
            "teaching_plan": self.teaching_plan,
            "base_plan_rate": str(self.base_plan_rate) if self.base_plan_rate is not None else None,
            "special_coordinator_rate": str(self.special_coordinator_rate) if self.special_coordinator_rate is not None else None,
            "matching_override": self.matching_override,
            "effective_from": self.effective_from.isoformat() if self.effective_from else None,
            "effective_to": self.effective_to.isoformat() if self.effective_to else None,
            "evaluated_inputs": self.evaluated_inputs,
        }


@dataclass
class RateResolutionContext:
    teacher: TeacherProfile
    teacher_name: str
    student_map: Dict[int, StudentProfile] = field(default_factory=dict)
    assignment: Optional[TeacherPolicyAssignment] = None
    versions: List[SalaryPolicyVersion] = field(default_factory=list)
    matrix_rates: Dict[Tuple[int, int, int], Decimal] = field(default_factory=dict)
    overrides: List[TeacherSalaryOverride] = field(default_factory=list)
    is_coordinator: bool = False


def resolve_teacher_class_rate(
    department_id: int,
    teacher_id: int,
    class_date: Optional[date] = None,
    teaching_plan_id: Optional[int] = None,
    teaching_plan_code: Optional[str] = None,
    student_id: Optional[int] = None,
    student_count: Optional[int] = None,
    context: Optional[RateResolutionContext] = None,
) -> ResolvedRateResult:
    """
    Deterministically resolves the applicable class rate for a given teacher,
    department, class date, teaching plan, and optional student.
    Supports in-memory high-performance resolution when RateResolutionContext is provided.
    """
    if class_date is None:
        class_date = date.today()

    evaluated_inputs = {
        "department_id": department_id,
        "teacher_id": teacher_id,
        "class_date": class_date.isoformat(),
        "teaching_plan_id": teaching_plan_id,
        "teaching_plan_code": teaching_plan_code,
        "student_id": student_id,
        "student_count": student_count,
    }

    # High-Performance In-Memory Resolution Path
    if context is not None:
        teacher = context.teacher
        teacher_name = context.teacher_name
        evaluated_inputs["teacher_name"] = teacher_name

        student_name = None
        if student_id:
            student = context.student_map.get(student_id)
            if not student:
                try:
                    student = StudentProfile.objects.select_related("user").get(pk=student_id)
                except StudentProfile.DoesNotExist:
                    return ResolvedRateResult(
                        is_resolved=False, winning_rate=None, precedence_level=None, precedence_name=None,
                        selection_reason="Student profile not found.", error_message="Student profile not found.",
                        evaluated_inputs=evaluated_inputs
                    )
            student_name = student.user.get_full_name() if student.user else f"Student #{student.pk}"
            evaluated_inputs["student_name"] = student_name

        assignment = context.assignment
        if not assignment or assignment.effective_from > class_date or (assignment.effective_to and assignment.effective_to < class_date):
            return ResolvedRateResult(
                is_resolved=False, winning_rate=None, precedence_level=None, precedence_name=None,
                selection_reason=f"No active salary policy assignment found for teacher {teacher_name} on {class_date}.",
                error_message="No active salary policy assigned for this date. Department Admin must assign a published policy.",
                evaluated_inputs=evaluated_inputs
            )

        policy = assignment.policy
        policy_dict = {
            "id": policy.id, "name": policy.name, "code": policy.code,
            "policy_type": policy.policy_type, "compensation_model": policy.compensation_model
        }

        version = None
        for v in context.versions:
            if v.policy_id == policy.id and v.effective_from <= class_date and (v.effective_to is None or v.effective_to >= class_date):
                version = v
                break

        if not version:
            return ResolvedRateResult(
                is_resolved=False, winning_rate=None, precedence_level=None, precedence_name=None,
                selection_reason=f"Policy '{policy.name}' has no published version effective on {class_date}.",
                error_message=f"No published policy version covers {class_date}. Check policy publication effective dates.",
                salary_policy=policy_dict, evaluated_inputs=evaluated_inputs
            )

        version_dict = {
            "id": version.id, "version_number": version.version_number,
            "effective_from": version.effective_from.isoformat(),
            "effective_to": version.effective_to.isoformat() if version.effective_to else None,
            "week_start_day": version.week_start_day
        }

        plans = getattr(version, "_cached_sorted_plans", None)
        if plans is None:
            plans = sorted(version.teaching_plans.all(), key=lambda x: getattr(x, "sort_order", 0))
            setattr(version, "_cached_sorted_plans", plans)
        matched_plan = None
        if teaching_plan_id:
            for p in plans:
                if p.id == int(teaching_plan_id):
                    matched_plan = p
                    break
        elif teaching_plan_code:
            clean_code = str(teaching_plan_code).strip().lower()
            for p in plans:
                if p.plan_code.lower() == clean_code:
                    matched_plan = p
                    break
        else:
            for p in plans:
                if not p.is_coordinator_special:
                    matched_plan = p
                    break
            if not matched_plan and plans:
                matched_plan = plans[0]

        if not matched_plan:
            return ResolvedRateResult(
                is_resolved=False, winning_rate=None, precedence_level=None, precedence_name=None,
                selection_reason="Teaching plan could not be identified in the published policy version.",
                error_message="Teaching plan not found in published policy version.",
                salary_policy=policy_dict, policy_version=version_dict, evaluated_inputs=evaluated_inputs
            )

        plan_dict = {
            "id": matched_plan.id, "plan_code": matched_plan.plan_code, "plan_name": matched_plan.plan_name,
            "days_per_week": matched_plan.days_per_week, "is_coordinator_special": matched_plan.is_coordinator_special
        }

        tiers = getattr(version, "_cached_sorted_tiers", None)
        if tiers is None:
            tiers = sorted(version.rate_tiers.all(), key=lambda x: (getattr(x, "sort_order", 0), x.min_students))
            setattr(version, "_cached_sorted_tiers", tiers)
        matched_tier = None
        if student_count is not None and student_count > 0:
            for t in tiers:
                if t.min_students <= student_count and (t.max_students is None or student_count <= t.max_students):
                    matched_tier = t
                    break
        else:
            matched_tier = tiers[0] if tiers else None

        tier_dict = None
        if matched_tier:
            tier_dict = {
                "id": matched_tier.id, "tier_name": matched_tier.tier_name,
                "min_students": matched_tier.min_students, "max_students": matched_tier.max_students,
                "sort_order": matched_tier.sort_order
            }

        base_plan_rate = None
        if matched_tier and matched_plan:
            base_plan_rate = context.matrix_rates.get((version.id, matched_plan.id, matched_tier.id))

        special_coord_rate = None
        coord_plan = next((p for p in plans if p.is_coordinator_special), None)
        if coord_plan and matched_tier:
            special_coord_rate = context.matrix_rates.get((version.id, coord_plan.id, matched_tier.id))

        active_overrides = [
            o for o in context.overrides
            if o.effective_from <= class_date and (o.effective_to is None or o.effective_to >= class_date)
        ]
        weekday_name = class_date.strftime("%A").lower()

        # Priority 1: Student-specific
        if student_id:
            student_override = next(
                (o for o in active_overrides if o.override_level == TeacherSalaryOverride.OverrideLevel.STUDENT_SPECIFIC and o.student_id == int(student_id)),
                None
            )
            if student_override:
                return ResolvedRateResult(
                    is_resolved=True, winning_rate=student_override.rate_per_class, precedence_level=1,
                    precedence_name="Level 1: Student-Specific Override",
                    selection_reason=f"Selected highest-priority student-specific rate for student {student_name or student_id}. Reason: {student_override.reason}",
                    salary_policy=policy_dict, policy_version=version_dict, rate_tier=tier_dict, teaching_plan=plan_dict,
                    base_plan_rate=base_plan_rate, special_coordinator_rate=special_coord_rate,
                    matching_override=_serialize_override(student_override), effective_from=student_override.effective_from,
                    effective_to=student_override.effective_to, evaluated_inputs=evaluated_inputs
                )

        # Priority 2: Plan-specific
        if matched_plan:
            plan_override = next(
                (o for o in active_overrides if o.override_level == TeacherSalaryOverride.OverrideLevel.PLAN_SPECIFIC and (o.teaching_plan_id == matched_plan.id or (o.teaching_plan and o.teaching_plan.plan_code == matched_plan.plan_code))),
                None
            )
            if plan_override:
                return ResolvedRateResult(
                    is_resolved=True, winning_rate=plan_override.rate_per_class, precedence_level=2,
                    precedence_name="Level 2: Teaching-Plan Override",
                    selection_reason=f"Selected plan-specific override rate for teaching plan '{matched_plan.plan_name}'. Reason: {plan_override.reason}",
                    salary_policy=policy_dict, policy_version=version_dict, rate_tier=tier_dict, teaching_plan=plan_dict,
                    base_plan_rate=base_plan_rate, special_coordinator_rate=special_coord_rate,
                    matching_override=_serialize_override(plan_override), effective_from=plan_override.effective_from,
                    effective_to=plan_override.effective_to, evaluated_inputs=evaluated_inputs
                )

        # Priority 3: Teacher-wide
        teacher_override = next(
            (o for o in active_overrides if o.override_level == TeacherSalaryOverride.OverrideLevel.TEACHER_WIDE),
            None
        )
        if teacher_override:
            return ResolvedRateResult(
                is_resolved=True, winning_rate=teacher_override.rate_per_class, precedence_level=3,
                precedence_name="Level 3: Teacher-Wide Override",
                selection_reason=f"Selected teacher-wide individual override rate. Reason: {teacher_override.reason}",
                salary_policy=policy_dict, policy_version=version_dict, rate_tier=tier_dict, teaching_plan=plan_dict,
                base_plan_rate=base_plan_rate, special_coordinator_rate=special_coord_rate,
                matching_override=_serialize_override(teacher_override), effective_from=teacher_override.effective_from,
                effective_to=teacher_override.effective_to, evaluated_inputs=evaluated_inputs
            )

        # Priority 4: Coordinator special day
        is_coordinator = context.is_coordinator
        coordinator_override = next(
            (o for o in active_overrides if o.override_level == TeacherSalaryOverride.OverrideLevel.COORDINATOR_DAY and o.qualifying_weekday == weekday_name),
            None
        )
        policy_qualifying_weekdays = [str(w).lower() for w in (getattr(version, "coordinator_qualifying_weekdays", None) or [])]
        is_qualifying_weekday = (weekday_name in policy_qualifying_weekdays) or (coordinator_override is not None)

        if (is_coordinator or coordinator_override is not None) and is_qualifying_weekday:
            if coordinator_override:
                return ResolvedRateResult(
                    is_resolved=True, winning_rate=coordinator_override.rate_per_class, precedence_level=4,
                    precedence_name="Level 4: Coordinator Special Day Override",
                    selection_reason=f"Selected coordinator special day rate for {weekday_name.capitalize()}. Reason: {coordinator_override.reason}",
                    salary_policy=policy_dict, policy_version=version_dict, rate_tier=tier_dict, teaching_plan=plan_dict,
                    base_plan_rate=base_plan_rate, special_coordinator_rate=special_coord_rate,
                    matching_override=_serialize_override(coordinator_override), effective_from=coordinator_override.effective_from,
                    effective_to=coordinator_override.effective_to, evaluated_inputs=evaluated_inputs
                )
            elif special_coord_rate is not None:
                coord_plan_obj = next((p for p in plans if p.is_coordinator_special or p.plan_code == "coordinator_special"), None)
                tier_label = matched_tier.tier_name if matched_tier else "Standard"
                plan_label = coord_plan_obj.plan_name if coord_plan_obj else "Coordinator Special"
                return ResolvedRateResult(
                    is_resolved=True, winning_rate=special_coord_rate, precedence_level=4,
                    precedence_name="Level 4: Special Coordinator-Day Rate",
                    selection_reason=f"Selected special coordinator-day rate for {weekday_name.capitalize()} from policy '{policy.name}' (v{version.version_number}) for plan '{plan_label}' and tier '{tier_label}'.",
                    salary_policy=policy_dict, policy_version=version_dict, rate_tier=tier_dict, teaching_plan=plan_dict,
                    base_plan_rate=base_plan_rate, special_coordinator_rate=special_coord_rate,
                    effective_from=version.effective_from, effective_to=version.effective_to, evaluated_inputs=evaluated_inputs
                )

        # Priority 5: Policy Rate
        if base_plan_rate is not None:
            tier_label = matched_tier.tier_name if matched_tier else "Standard"
            return ResolvedRateResult(
                is_resolved=True, winning_rate=base_plan_rate, precedence_level=5,
                precedence_name="Level 5: Department Policy Rate",
                selection_reason=f"Selected base matrix rate from policy '{policy.name}' (v{version.version_number}) for plan '{matched_plan.plan_name}' and tier '{tier_label}'.",
                salary_policy=policy_dict, policy_version=version_dict, rate_tier=tier_dict, teaching_plan=plan_dict,
                base_plan_rate=base_plan_rate, special_coordinator_rate=special_coord_rate,
                effective_from=version.effective_from, effective_to=version.effective_to, evaluated_inputs=evaluated_inputs
            )

        return ResolvedRateResult(
            is_resolved=False, winning_rate=None, precedence_level=None, precedence_name=None,
            selection_reason=f"No rate configured in policy '{policy.name}' for plan '{matched_plan.plan_name}' and tier '{matched_tier.tier_name if matched_tier else 'Unknown'}'.",
            error_message="Matrix cell has no rate configured. Please configure rate in policy version matrix.",
            salary_policy=policy_dict, policy_version=version_dict, rate_tier=tier_dict, teaching_plan=plan_dict,
            special_coordinator_rate=special_coord_rate, evaluated_inputs=evaluated_inputs
        )

    # Fallback to Direct Database Query Execution

    # 1. Verify Teacher exists and belongs to the department
    try:
        teacher = TeacherProfile.objects.select_related("user").get(pk=teacher_id)
    except TeacherProfile.DoesNotExist:
        return ResolvedRateResult(
            is_resolved=False,
            winning_rate=None,
            precedence_level=None,
            precedence_name=None,
            selection_reason="Teacher profile not found.",
            error_message="Teacher profile not found.",
            evaluated_inputs=evaluated_inputs,
        )

    if teacher.department_id and teacher.department_id != int(department_id):
        return ResolvedRateResult(
            is_resolved=False,
            winning_rate=None,
            precedence_level=None,
            precedence_name=None,
            selection_reason="Teacher belongs to a different department.",
            error_message="Teacher belongs to a different department than requested.",
            evaluated_inputs=evaluated_inputs,
        )

    teacher_name = getattr(teacher, "historical_name", None) or (teacher.user.get_full_name() if teacher.user else f"Teacher #{teacher.pk}")
    evaluated_inputs["teacher_name"] = teacher_name

    # Verify student if provided
    student_name = None
    if student_id:
        try:
            student = StudentProfile.objects.select_related("user").get(pk=student_id)
            if student.department_id and student.department_id != int(department_id):
                return ResolvedRateResult(
                    is_resolved=False,
                    winning_rate=None,
                    precedence_level=None,
                    precedence_name=None,
                    selection_reason="Student belongs to a different department.",
                    error_message="Student belongs to a different department than requested.",
                    evaluated_inputs=evaluated_inputs,
                )
            student_name = student.user.get_full_name() if student.user else f"Student #{student.pk}"
            evaluated_inputs["student_name"] = student_name
        except StudentProfile.DoesNotExist:
            return ResolvedRateResult(
                is_resolved=False,
                winning_rate=None,
                precedence_level=None,
                precedence_name=None,
                selection_reason="Student profile not found.",
                error_message="Student profile not found.",
                evaluated_inputs=evaluated_inputs,
            )

    # 2. Find active TeacherPolicyAssignment for this teacher and date
    assignment = (
        TeacherPolicyAssignment.objects.filter(
            teacher_id=teacher.pk,
            department_id=department_id,
            is_active=True,
            effective_from__lte=class_date,
        )
        .filter(models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=class_date))
        .select_related("policy")
        .order_by("-effective_from")
        .first()
    )

    if not assignment:
        return ResolvedRateResult(
            is_resolved=False,
            winning_rate=None,
            precedence_level=None,
            precedence_name=None,
            selection_reason=f"No active salary policy assignment found for teacher {teacher_name} on {class_date}.",
            error_message="No active salary policy assigned for this date. Department Admin must assign a published policy.",
            evaluated_inputs=evaluated_inputs,
        )

    policy = assignment.policy
    policy_dict = {
        "id": policy.id,
        "name": policy.name,
        "code": policy.code,
        "policy_type": policy.policy_type,
        "compensation_model": policy.compensation_model,
    }

    # 3. Find published SalaryPolicyVersion covering class_date
    version = (
        SalaryPolicyVersion.objects.filter(
            policy_id=policy.pk,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from__lte=class_date,
        )
        .filter(models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=class_date))
        .prefetch_related("rate_tiers", "teaching_plans", "plan_tier_rates")
        .order_by("-effective_from", "-version_number")
        .first()
    )

    if not version:
        return ResolvedRateResult(
            is_resolved=False,
            winning_rate=None,
            precedence_level=None,
            precedence_name=None,
            selection_reason=f"Policy '{policy.name}' has no published version effective on {class_date}.",
            error_message=f"No published policy version covers {class_date}. Check policy publication effective dates.",
            salary_policy=policy_dict,
            evaluated_inputs=evaluated_inputs,
        )

    version_dict = {
        "id": version.id,
        "version_number": version.version_number,
        "effective_from": version.effective_from.isoformat(),
        "effective_to": version.effective_to.isoformat() if version.effective_to else None,
        "week_start_day": version.week_start_day,
    }

    # 4. Resolve Teaching Plan in this published version
    plans = list(version.teaching_plans.all().order_by("sort_order"))
    matched_plan: Optional[SalaryTeachingPlan] = None
    if teaching_plan_id:
        for p in plans:
            if p.id == int(teaching_plan_id):
                matched_plan = p
                break
    elif teaching_plan_code:
        clean_code = str(teaching_plan_code).strip().lower()
        for p in plans:
            if p.plan_code.lower() == clean_code:
                matched_plan = p
                break
    else:
        # Default to first standard plan
        for p in plans:
            if not p.is_coordinator_special:
                matched_plan = p
                break
        if not matched_plan and plans:
            matched_plan = plans[0]

    if not matched_plan:
        return ResolvedRateResult(
            is_resolved=False,
            winning_rate=None,
            precedence_level=None,
            precedence_name=None,
            selection_reason="Teaching plan could not be identified in the published policy version.",
            error_message="Teaching plan not found in published policy version.",
            salary_policy=policy_dict,
            policy_version=version_dict,
            evaluated_inputs=evaluated_inputs,
        )

    plan_dict = {
        "id": matched_plan.id,
        "plan_code": matched_plan.plan_code,
        "plan_name": matched_plan.plan_name,
        "days_per_week": matched_plan.days_per_week,
        "is_coordinator_special": matched_plan.is_coordinator_special,
    }

    # 5. Resolve Student Count Tier in this published version
    tiers = list(version.rate_tiers.all().order_by("sort_order", "min_students"))
    matched_tier: Optional[SalaryRateTier] = None
    if student_count is not None and student_count > 0:
        for t in tiers:
            if t.min_students <= student_count and (t.max_students is None or student_count <= t.max_students):
                matched_tier = t
                break
    else:
        # Default to baseline tier (tier 1) for preview when student count not specified
        matched_tier = tiers[0] if tiers else None

    tier_dict = None
    if matched_tier:
        tier_dict = {
            "id": matched_tier.id,
            "tier_name": matched_tier.tier_name,
            "min_students": matched_tier.min_students,
            "max_students": matched_tier.max_students,
            "sort_order": matched_tier.sort_order,
        }

    # 6. Resolve base policy rate from 2D matrix
    base_plan_rate = None
    if matched_tier and matched_plan:
        matrix_cell = version.plan_tier_rates.filter(
            teaching_plan_id=matched_plan.id,
            rate_tier_id=matched_tier.id,
        ).first()
        if matrix_cell:
            base_plan_rate = matrix_cell.rate_per_class

    # Look up coordinator special rate from matrix if present
    special_coord_rate = None
    coord_plan = next((p for p in plans if p.is_coordinator_special), None)
    if coord_plan and matched_tier:
        coord_cell = version.plan_tier_rates.filter(
            teaching_plan_id=coord_plan.id,
            rate_tier_id=matched_tier.id,
        ).first()
        if coord_cell:
            special_coord_rate = coord_cell.rate_per_class

    # 7. Query active overrides for this teacher covering class_date
    active_overrides = list(
        TeacherSalaryOverride.objects.filter(
            teacher_id=teacher.pk,
            department_id=department_id,
            is_active=True,
            effective_from__lte=class_date,
        )
        .filter(models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=class_date))
        .select_related("student", "teaching_plan", "salary_policy")
        .order_by("-effective_from")
    )

    weekday_name = class_date.strftime("%A").lower()

    # =========================================================================
    # PRECEDENCE EVALUATION (Levels 1 to 5)
    # =========================================================================

    # PRIORITY 1: Student-specific override
    if student_id:
        student_override = next(
            (o for o in active_overrides if o.override_level == TeacherSalaryOverride.OverrideLevel.STUDENT_SPECIFIC and o.student_id == int(student_id)),
            None,
        )
        if student_override:
            override_info = _serialize_override(student_override)
            return ResolvedRateResult(
                is_resolved=True,
                winning_rate=student_override.rate_per_class,
                precedence_level=1,
                precedence_name="Level 1: Student-Specific Override",
                selection_reason=f"Selected highest-priority student-specific rate for student {student_name or student_id}. Reason: {student_override.reason}",
                salary_policy=policy_dict,
                policy_version=version_dict,
                rate_tier=tier_dict,
                teaching_plan=plan_dict,
                base_plan_rate=base_plan_rate,
                special_coordinator_rate=special_coord_rate,
                matching_override=override_info,
                effective_from=student_override.effective_from,
                effective_to=student_override.effective_to,
                evaluated_inputs=evaluated_inputs,
            )

    # PRIORITY 2: Teaching-plan-specific override
    if matched_plan:
        plan_override = next(
            (o for o in active_overrides if o.override_level == TeacherSalaryOverride.OverrideLevel.PLAN_SPECIFIC and (o.teaching_plan_id == matched_plan.id or (o.teaching_plan and o.teaching_plan.plan_code == matched_plan.plan_code))),
            None,
        )
        if plan_override:
            override_info = _serialize_override(plan_override)
            return ResolvedRateResult(
                is_resolved=True,
                winning_rate=plan_override.rate_per_class,
                precedence_level=2,
                precedence_name="Level 2: Teaching-Plan Override",
                selection_reason=f"Selected plan-specific override rate for teaching plan '{matched_plan.plan_name}'. Reason: {plan_override.reason}",
                salary_policy=policy_dict,
                policy_version=version_dict,
                rate_tier=tier_dict,
                teaching_plan=plan_dict,
                base_plan_rate=base_plan_rate,
                special_coordinator_rate=special_coord_rate,
                matching_override=override_info,
                effective_from=plan_override.effective_from,
                effective_to=plan_override.effective_to,
                evaluated_inputs=evaluated_inputs,
            )

    # PRIORITY 3: Teacher-wide override
    teacher_override = next(
        (o for o in active_overrides if o.override_level == TeacherSalaryOverride.OverrideLevel.TEACHER_WIDE),
        None,
    )
    if teacher_override:
        override_info = _serialize_override(teacher_override)
        return ResolvedRateResult(
            is_resolved=True,
            winning_rate=teacher_override.rate_per_class,
            precedence_level=3,
            precedence_name="Level 3: Teacher-Wide Override",
            selection_reason=f"Selected teacher-wide individual override rate. Reason: {teacher_override.reason}",
            salary_policy=policy_dict,
            policy_version=version_dict,
            rate_tier=tier_dict,
            teaching_plan=plan_dict,
            base_plan_rate=base_plan_rate,
            special_coordinator_rate=special_coord_rate,
            matching_override=override_info,
            effective_from=teacher_override.effective_from,
            effective_to=teacher_override.effective_to,
            evaluated_inputs=evaluated_inputs,
        )

    # PRIORITY 4: Special coordinator rate for qualifying days
    # Eligible if teacher is a teaching coordinator or has an explicit coordinator-day override
    user = getattr(teacher, "user", None)
    is_coordinator = False
    if user:
        role_val = getattr(user, "role", "")
        if role_val == "coordinator":
            is_coordinator = True
        elif hasattr(user, "is_coordinator") and callable(user.is_coordinator) and user.is_coordinator():
            is_coordinator = True
        elif hasattr(user, "department_roles"):
            is_coordinator = user.department_roles.filter(
                department_id=department_id,
                role="coordinator",
                is_active=True,
            ).exists()

    coordinator_override = next(
        (o for o in active_overrides if o.override_level == TeacherSalaryOverride.OverrideLevel.COORDINATOR_DAY and o.qualifying_weekday == weekday_name),
        None,
    )

    policy_qualifying_weekdays = [str(w).lower() for w in (getattr(version, "coordinator_qualifying_weekdays", None) or [])]
    is_qualifying_weekday = (weekday_name in policy_qualifying_weekdays) or (coordinator_override is not None)

    if (is_coordinator or coordinator_override is not None) and is_qualifying_weekday:
        if coordinator_override:
            override_info = _serialize_override(coordinator_override)
            return ResolvedRateResult(
                is_resolved=True,
                winning_rate=coordinator_override.rate_per_class,
                precedence_level=4,
                precedence_name="Level 4: Coordinator Special Day Override",
                selection_reason=f"Selected coordinator special day rate for {weekday_name.capitalize()}. Reason: {coordinator_override.reason}",
                salary_policy=policy_dict,
                policy_version=version_dict,
                rate_tier=tier_dict,
                teaching_plan=plan_dict,
                base_plan_rate=base_plan_rate,
                special_coordinator_rate=special_coord_rate,
                matching_override=override_info,
                effective_from=coordinator_override.effective_from,
                effective_to=coordinator_override.effective_to,
                evaluated_inputs=evaluated_inputs,
            )
        elif special_coord_rate is not None:
            coord_plan_obj = next((p for p in plans if p.is_coordinator_special or p.plan_code == "coordinator_special"), None)
            tier_label = matched_tier.tier_name if matched_tier else "Standard"
            plan_label = coord_plan_obj.plan_name if coord_plan_obj else "Coordinator Special"
            return ResolvedRateResult(
                is_resolved=True,
                winning_rate=special_coord_rate,
                precedence_level=4,
                precedence_name="Level 4: Special Coordinator-Day Rate",
                selection_reason=f"Selected special coordinator-day rate for {weekday_name.capitalize()} from policy '{policy.name}' (v{version.version_number}) for plan '{plan_label}' and tier '{tier_label}'.",
                salary_policy=policy_dict,
                policy_version=version_dict,
                rate_tier=tier_dict,
                teaching_plan=plan_dict,
                base_plan_rate=base_plan_rate,
                special_coordinator_rate=special_coord_rate,
                matching_override=None,
                effective_from=version.effective_from,
                effective_to=version.effective_to,
                evaluated_inputs=evaluated_inputs,
            )

    # PRIORITY 5: Department policy rate (standard 2D matrix cell)
    if base_plan_rate is not None:
        tier_label = matched_tier.tier_name if matched_tier else "Standard"
        return ResolvedRateResult(
            is_resolved=True,
            winning_rate=base_plan_rate,
            precedence_level=5,
            precedence_name="Level 5: Department Policy Rate",
            selection_reason=f"Selected standard published department rate from policy '{policy.name}' (v{version.version_number}) for plan '{matched_plan.plan_name}' and tier '{tier_label}'.",
            salary_policy=policy_dict,
            policy_version=version_dict,
            rate_tier=tier_dict,
            teaching_plan=plan_dict,
            base_plan_rate=base_plan_rate,
            special_coordinator_rate=special_coord_rate,
            matching_override=None,
            effective_from=version.effective_from,
            effective_to=version.effective_to,
            evaluated_inputs=evaluated_inputs,
        )

    # If matrix cell is missing for the combination
    return ResolvedRateResult(
        is_resolved=False,
        winning_rate=None,
        precedence_level=None,
        precedence_name=None,
        selection_reason=f"No rate defined in policy '{policy.name}' v{version.version_number} for plan '{matched_plan.plan_name}' and the matched tier.",
        error_message="Matrix rate cell not found in published policy version.",
        salary_policy=policy_dict,
        policy_version=version_dict,
        rate_tier=tier_dict,
        teaching_plan=plan_dict,
        evaluated_inputs=evaluated_inputs,
    )


def _serialize_override(override: TeacherSalaryOverride) -> Dict[str, Any]:
    return {
        "id": override.id,
        "override_level": override.override_level,
        "override_level_display": override.get_override_level_display(),
        "rate_per_class": str(override.rate_per_class),
        "effective_from": override.effective_from.isoformat(),
        "effective_to": override.effective_to.isoformat() if override.effective_to else None,
        "reason": override.reason,
        "student_id": override.student_id,
        "student_name": str(override.student) if override.student else None,
        "teaching_plan_id": override.teaching_plan_id,
        "teaching_plan_name": override.teaching_plan.plan_name if override.teaching_plan else None,
        "qualifying_weekday": override.qualifying_weekday,
        "qualifying_weekday_display": override.get_qualifying_weekday_display() if override.qualifying_weekday else None,
        "created_by_name": override.created_by.get_full_name() if override.created_by else None,
        "created_at": override.created_at.isoformat(),
    }
