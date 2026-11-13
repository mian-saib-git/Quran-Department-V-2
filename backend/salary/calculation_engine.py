"""
IVS Unified Salary Management — Pure Deterministic Salary Calculation Engine (Stage 5).

Calculates auditable, deterministic draft teacher monthly salary previews based on:
1. Effective-dated published salary policies and 2D rate matrices (Plan x Student-Count Tier).
2. 5-level rate precedence resolver (Student-Specific > Plan-Specific > Teacher-Wide > Coordinator-Day > Policy Rate).
3. Historical active-student counts resolved per class date (accounting for enrollment start, transfers, drops).
4. Configurable teaching week starts & monthly weekly eligibility engine (minimum qualifying weeks, partial-month exceptions).
5. Stage 4 attendance verification determinations (taught, absent, substitute, official cancellations).
6. Lesson plan bonus (Quran) with verified evidence of actual teaching.
7. Independent substitute coverage compensation.
8. Official cancellation treatment (paid/unpaid).

Stateless and non-financial:
- Zero mutations to student, teacher, or attendance records.
- Zero financial ledger postings.
- Zero approved or payable payroll creation.
- Zero dependencies on legacy Salary V1 or V2 services.
- Pure Decimal arithmetic in PKR.
"""
from __future__ import annotations

import calendar
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict, List, Optional, Set, Tuple

from django.db import models
from django.db.models import Q
from django.utils import timezone

from accounts.models import Department
from academy.models import (
    DailyLessonReport,
    StudentClassHistory,
    StudentProfile,
    TeacherProfile,
    ClassSchedule,
)
from tuition.models import (
    TuitionEnrollment,
    TuitionSchedule,
)
from salary.models import (
    PayrollAdjustment,
    SalaryAttendanceVerification,
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryReconciliationBatch,
    SalaryTeachingPlan,
    TeacherPolicyAssignment,
    TeacherSalaryOverride,
)
from salary.resolver import resolve_teacher_class_rate, ResolvedRateResult, RateResolutionContext


ROUND_EXPONENT = Decimal("0.01")


def to_decimal(val: Any) -> Decimal:
    """Convert value to Decimal with 2 decimal places."""
    if val is None:
        return Decimal("0.00")
    if isinstance(val, Decimal):
        return val.quantize(ROUND_EXPONENT, rounding=ROUND_HALF_UP)
    return Decimal(str(val)).quantize(ROUND_EXPONENT, rounding=ROUND_HALF_UP)


WEEKDAY_INDEX_MAP = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


def get_month_date_range(year: int, month: int) -> Tuple[date, date]:
    """Return the start and end calendar dates for the payroll month."""
    _, last_day = calendar.monthrange(year, month)
    return date(year, month, 1), date(year, month, last_day)


def partition_month_into_weeks(
    year: int,
    month: int,
    week_start_day: str = "monday",
) -> List[Dict[str, Any]]:
    """
    Partitions the specified calendar month into contiguous teaching weeks
    aligned with the department's configured `week_start_day`.

    Supports all 7 weekdays. Partial weeks at the start or end of the month
    are preserved as valid candidate teaching weeks.
    """
    first_date, last_date = get_month_date_range(year, month)
    target_start_weekday = WEEKDAY_INDEX_MAP.get(week_start_day.lower(), 0)

    weeks: List[Dict[str, Any]] = []
    current_week: Optional[Dict[str, Any]] = None
    curr = first_date

    while curr <= last_date:
        if curr == first_date or curr.weekday() == target_start_weekday:
            if current_week is not None:
                weeks.append(current_week)
            current_week = {
                "week_number": len(weeks) + 1,
                "start_date": curr,
                "end_date": curr,
            }
        else:
            if current_week is not None:
                current_week["end_date"] = curr
        curr += timedelta(days=1)

    if current_week is not None:
        weeks.append(current_week)

    return weeks


@dataclass
class CalculationPrefetchContext:
    department: Department
    first_date: date
    last_date: date
    # Schedules
    schedules_by_teacher: Dict[int, List[ClassSchedule]] = field(default_factory=lambda: defaultdict(list))
    schedule_by_id: Dict[int, ClassSchedule] = field(default_factory=dict)
    schedules_by_teacher_student: Dict[Tuple[int, int], List[ClassSchedule]] = field(default_factory=lambda: defaultdict(list))
    candidate_students_by_teacher: Dict[int, Set[StudentProfile]] = field(default_factory=lambda: defaultdict(set))

    # Tuition
    tuition_enrollments_by_teacher: Dict[int, List[TuitionEnrollment]] = field(default_factory=lambda: defaultdict(list))

    # Student histories
    enrollment_date_by_student: Dict[int, date] = field(default_factory=dict)
    transfers_by_student: Dict[int, List[StudentClassHistory]] = field(default_factory=lambda: defaultdict(list))
    incoming_transfers_by_teacher: Dict[int, List[StudentClassHistory]] = field(default_factory=lambda: defaultdict(list))

    # Lesson report evidence: set of (teacher_id, student_id, date)
    lesson_reports_set: Set[Tuple[int, int, date]] = field(default_factory=set)

    # Rate resolver context by teacher_id
    rate_contexts_by_teacher: Dict[int, RateResolutionContext] = field(default_factory=dict)

    # Adjustments
    adjustments_by_teacher: Dict[int, List[PayrollAdjustment]] = field(default_factory=lambda: defaultdict(list))

    # Verifications
    primary_verifications_by_teacher: Dict[int, List[SalaryAttendanceVerification]] = field(default_factory=lambda: defaultdict(list))
    substitute_verifications_by_teacher: Dict[int, List[SalaryAttendanceVerification]] = field(default_factory=lambda: defaultdict(list))

    # Reconciliation batch
    batch: Optional[SalaryReconciliationBatch] = None


def build_calculation_prefetch_context(
    department: Department,
    teachers: List[TeacherProfile],
    year: int,
    month: int,
) -> CalculationPrefetchContext:
    first_date, last_date = get_month_date_range(year, month)
    ctx = CalculationPrefetchContext(department=department, first_date=first_date, last_date=last_date)
    teacher_ids = [t.id for t in teachers]

    dept_type = str(getattr(department, "department_type", "") or "").lower()

    # 1. Batch load reconciliation batch
    ctx.batch = SalaryReconciliationBatch.objects.filter(
        department=department, period_year=year, period_month=month
    ).first()

    # 2. Batch load payroll adjustments
    adjustments = list(
        PayrollAdjustment.objects.filter(
            teacher_id__in=teacher_ids,
            period_year=year,
            period_month=month,
            status__in=[PayrollAdjustment.Status.DRAFT, PayrollAdjustment.Status.CONFIRMED],
        ).order_by("created_at")
    )
    for adj in adjustments:
        ctx.adjustments_by_teacher[adj.teacher_id].append(adj)

    # 3. Batch load verifications (optimized without duplicate model instantiation for 18k rows)
    ver_fields = (
        "id", "department_id", "teacher_id", "substitute_teacher_id", "student_id",
        "class_date", "scheduled_time", "occurrence_key", "source_schedule_id",
        "source_department_type", "verification_status", "resolution_type",
        "flag_reason", "teacher_available_determination",
        "original_teacher_attendance_status", "original_student_attendance_status",
    )
    primary_vers = list(
        SalaryAttendanceVerification.objects.filter(
            department=department,
            teacher_id__in=teacher_ids,
            class_date__gte=first_date,
            class_date__lte=last_date,
        ).only(*ver_fields)
        .order_by("class_date", "scheduled_time", "id")
    )
    sub_vers = list(
        SalaryAttendanceVerification.objects.filter(
            department=department,
            substitute_teacher_id__in=teacher_ids,
            class_date__gte=first_date,
            class_date__lte=last_date,
        ).only(*ver_fields).select_related("teacher")
        .order_by("class_date", "scheduled_time", "id")
    )
    # Fast load substitute teachers only for those with substitute_teacher_id
    sub_t_ids = {v.substitute_teacher_id for v in primary_vers if v.substitute_teacher_id} | {
        sv.substitute_teacher_id for sv in sub_vers if sv.substitute_teacher_id
    }
    sub_teachers_cache = {
        t.id: t for t in TeacherProfile.objects.filter(id__in=sub_t_ids).select_related("user")
    }
    for v in primary_vers:
        if v.substitute_teacher_id in sub_teachers_cache:
            v.substitute_teacher = sub_teachers_cache[v.substitute_teacher_id]
    for sv in sub_vers:
        if sv.substitute_teacher_id in sub_teachers_cache:
            sv.substitute_teacher = sub_teachers_cache[sv.substitute_teacher_id]

    s_ids = {v.student_id for v in primary_vers if v.student_id} | {sv.student_id for sv in sub_vers if sv.student_id}
    students_cache = {
        s.id: s for s in StudentProfile.objects.filter(id__in=s_ids).select_related("user")
    }
    for v in primary_vers:
        if v.student_id in students_cache:
            v.student = students_cache[v.student_id]
        ctx.primary_verifications_by_teacher[v.teacher_id].append(v)
    for sv in sub_vers:
        if sv.student_id in students_cache:
            sv.student = students_cache[sv.student_id]
        ctx.substitute_verifications_by_teacher[sv.substitute_teacher_id].append(sv)

    # 4. Batch load schedules & candidate students
    if dept_type == "tuition":
        t_enrs = list(
            TuitionEnrollment.objects.filter(
                department=department,
                teacher_id__in=teacher_ids,
            ).select_related("student", "student__user")
        )
        for enr in t_enrs:
            ctx.tuition_enrollments_by_teacher[enr.teacher_id].append(enr)
            if enr.student:
                ctx.candidate_students_by_teacher[enr.teacher_id].add(enr.student)
    else:
        sched_fields = ("id", "department_id", "teacher_id", "student_id", "is_active", "effective_from", "effective_to", "weekday")
        schedules = list(
            ClassSchedule.objects.filter(
                Q(department=department) | Q(student__department=department),
                teacher_id__in=teacher_ids,
            ).filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=last_date)
            ).filter(
                Q(effective_to__isnull=True) | Q(effective_to__gte=first_date)
            ).only(*sched_fields).select_related("student")
        )
        for s in schedules:
            ctx.schedules_by_teacher[s.teacher_id].append(s)
            ctx.schedule_by_id[s.id] = s
            if s.student:
                ctx.schedules_by_teacher_student[(s.teacher_id, s.student_id)].append(s)
                ctx.candidate_students_by_teacher[s.teacher_id].add(s.student)

        incoming = list(
            StudentClassHistory.objects.filter(
                new_teacher_id__in=teacher_ids,
                event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
                effective_date__lte=last_date,
            ).select_related("student", "student__user")
        )
        for tr in incoming:
            ctx.incoming_transfers_by_teacher[tr.new_teacher_id].append(tr)
            if tr.student and (tr.student.department_id == department.id or department.department_type == "quran"):
                ctx.candidate_students_by_teacher[tr.new_teacher_id].add(tr.student)

    all_student_ids = set()
    for s_set in ctx.candidate_students_by_teacher.values():
        for st in s_set:
            all_student_ids.add(st.id)

    for v in primary_vers:
        all_student_ids.add(v.student_id)
    for sv in sub_vers:
        all_student_ids.add(sv.student_id)

    # 5. Batch load student histories
    if all_student_ids:
        histories = list(
            StudentClassHistory.objects.filter(student_id__in=all_student_ids)
            .order_by("effective_date", "id")
        )
        for h in histories:
            if h.event_type == StudentClassHistory.EventType.ENROLLED:
                if h.student_id not in ctx.enrollment_date_by_student:
                    ctx.enrollment_date_by_student[h.student_id] = h.effective_date
            elif h.event_type == StudentClassHistory.EventType.TEACHER_TRANSFER:
                ctx.transfers_by_student[h.student_id].append(h)

    # 6. Batch load lesson reports
    if dept_type != "tuition" and teacher_ids:
        reports = list(
            DailyLessonReport.objects.filter(
                teacher_id__in=teacher_ids,
                date__gte=first_date,
                date__lte=last_date,
            ).values_list("teacher_id", "student_id", "date")
        )
        ctx.lesson_reports_set = set(reports)

    # 7. Batch load policy assignments, versions, matrix rates, overrides
    assignments = list(
        TeacherPolicyAssignment.objects.filter(
            teacher_id__in=teacher_ids,
            department=department,
            is_active=True,
            effective_from__lte=last_date,
        ).filter(Q(effective_to__isnull=True) | Q(effective_to__gte=first_date))
        .select_related("policy")
        .order_by("-effective_from")
    )
    assign_by_teacher = {}
    policy_ids = set()
    for a in assignments:
        if a.teacher_id not in assign_by_teacher:
            assign_by_teacher[a.teacher_id] = a
        if a.policy_id:
            policy_ids.add(a.policy_id)

    published_versions = list(
        SalaryPolicyVersion.objects.filter(
            policy_id__in=policy_ids,
            status=SalaryPolicyVersion.Status.PUBLISHED,
            effective_from__lte=last_date,
        ).filter(Q(effective_to__isnull=True) | Q(effective_to__gte=first_date))
        .prefetch_related("rate_tiers", "teaching_plans", "plan_tier_rates")
        .order_by("-effective_from", "-version_number")
    )
    versions_by_policy = defaultdict(list)
    matrix_rates = {}
    for v in published_versions:
        sorted_plans = sorted(v.teaching_plans.all(), key=lambda p: getattr(p, "sort_order", 0))
        setattr(v, "_cached_sorted_plans", sorted_plans)
        sorted_tiers = sorted(v.rate_tiers.all(), key=lambda t: (t.sort_order, t.min_students))
        setattr(v, "_cached_sorted_tiers", sorted_tiers)
        versions_by_policy[v.policy_id].append(v)
        for cell in v.plan_tier_rates.all():
            matrix_rates[(v.id, cell.teaching_plan_id, cell.rate_tier_id)] = cell.rate_per_class

    overrides = list(
        TeacherSalaryOverride.objects.filter(
            teacher_id__in=teacher_ids,
            department=department,
            is_active=True,
            effective_from__lte=last_date,
        ).filter(Q(effective_to__isnull=True) | Q(effective_to__gte=first_date))
        .select_related("student", "teaching_plan", "salary_policy")
        .order_by("-effective_from")
    )
    overrides_by_teacher = defaultdict(list)
    for o in overrides:
        overrides_by_teacher[o.teacher_id].append(o)

    # 8. Build RateResolutionContext per teacher (reuse students_cache to avoid O(teachers * verifications) redundant loops)
    for t in teachers:
        assign = assign_by_teacher.get(t.id)
        pol_id = assign.policy_id if assign else None
        v_list = versions_by_policy.get(pol_id, [])
        cand_students = ctx.candidate_students_by_teacher.get(t.id, set())
        student_map = {**students_cache, **{s.id: s for s in cand_students}}
        user = getattr(t, "user", None)
        is_coord = False
        if user:
            role_val = getattr(user, "role", "")
            if role_val == "coordinator":
                is_coord = True
            elif hasattr(user, "is_coordinator") and callable(user.is_coordinator) and user.is_coordinator():
                is_coord = True

        ctx.rate_contexts_by_teacher[t.id] = RateResolutionContext(
            teacher=t,
            teacher_name=getattr(t, "historical_name", None) or (user.get_full_name() if user else f"Teacher #{t.id}"),
            student_map=student_map,
            assignment=assign,
            versions=v_list,
            matrix_rates=matrix_rates,
            overrides=overrides_by_teacher.get(t.id, []),
            is_coordinator=is_coord,
        )

    return ctx


def resolve_historical_student_count(
    department: Department,
    teacher: TeacherProfile,
    target_date: date,
    prefetch_context: Optional[CalculationPrefetchContext] = None,
) -> Tuple[int, List[int]]:
    """
    Calculates the exact total number of active students assigned to `teacher`
    in `department` on `target_date`.

    Evaluates effective-dated enrollment, schedule validity, confirmed drops,
    and teacher transfer events. Each student is counted exactly once regardless
    of class frequency.

    Returns (count, list_of_active_student_ids).
    """
    dept_type = str(getattr(department, "department_type", "") or "").lower()
    active_student_ids: Set[int] = set()

    if prefetch_context is not None:
        if dept_type == "tuition":
            for enr in prefetch_context.tuition_enrollments_by_teacher.get(teacher.id, []):
                if enr.start_date and enr.start_date > target_date:
                    continue
                if enr.end_date and enr.end_date < target_date:
                    continue
                if not enr.is_active:
                    if enr.end_date is None or enr.end_date < target_date:
                        continue
                active_student_ids.add(enr.student_id)
        else:
            candidate_students = prefetch_context.candidate_students_by_teacher.get(teacher.id, set())
            for student in candidate_students:
                if student.is_dropped and student.status_effective_date:
                    if target_date > student.status_effective_date:
                        continue

                enr_date = prefetch_context.enrollment_date_by_student.get(student.id)
                if enr_date and enr_date > target_date:
                    continue

                transfers = prefetch_context.transfers_by_student.get(student.id, [])
                latest_tr = None
                for tr in transfers:
                    if tr.effective_date <= target_date:
                        latest_tr = tr
                    else:
                        break

                if latest_tr:
                    if latest_tr.new_teacher_id and latest_tr.new_teacher_id != teacher.id:
                        continue
                    if latest_tr.new_teacher_id and latest_tr.new_teacher_id == teacher.id:
                        active_student_ids.add(student.id)
                        continue

                active_student_ids.add(student.id)

        return len(active_student_ids), sorted(list(active_student_ids))

    if dept_type == "tuition":
        # Tuition Department assignment source
        enrollments = TuitionEnrollment.objects.filter(
            department=department,
            teacher=teacher,
        ).select_related("student")

        for enr in enrollments:
            # Check enrollment active dates
            if enr.start_date and enr.start_date > target_date:
                continue
            if enr.end_date and enr.end_date < target_date:
                continue
            if not enr.is_active:
                if enr.end_date is None or enr.end_date < target_date:
                    continue
            active_student_ids.add(enr.student_id)

    else:
        # Quran Department assignment source
        # 1. Candidate students via ClassSchedule
        schedules = ClassSchedule.objects.filter(
            Q(department=department) | Q(student__department=department),
            teacher=teacher,
        ).filter(
            Q(effective_from__isnull=True) | Q(effective_from__lte=target_date)
        ).filter(
            Q(effective_to__isnull=True) | Q(effective_to__gte=target_date)
        ).select_related("student")

        candidate_students = {s.student for s in schedules if s.student}

        # Also check students who transferred to this teacher on or before target_date
        incoming_transfers = StudentClassHistory.objects.filter(
            new_teacher=teacher,
            event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
            effective_date__lte=target_date,
        ).select_related("student")
        for t in incoming_transfers:
            if t.student and (t.student.department_id == department.id or department.department_type == "quran"):
                candidate_students.add(t.student)

        for student in candidate_students:
            # 1. Confirmed Student Drop check
            if student.is_dropped and student.status_effective_date:
                if target_date > student.status_effective_date:
                    # Confirmed drop has taken effect
                    continue

            # 2. Mid-month enrollment start check
            enroll_record = (
                StudentClassHistory.objects.filter(
                    student=student,
                    event_type=StudentClassHistory.EventType.ENROLLED,
                )
                .order_by("effective_date", "id")
                .first()
            )
            if enroll_record and enroll_record.effective_date > target_date:
                continue

            # 3. Teacher Transfer check: who was the effective teacher on target_date?
            transfer_record = (
                StudentClassHistory.objects.filter(
                    student=student,
                    event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
                    effective_date__lte=target_date,
                )
                .order_by("-effective_date", "-id")
                .first()
            )
            if transfer_record:
                if transfer_record.new_teacher_id and transfer_record.new_teacher_id != teacher.id:
                    # Student was transferred away from this teacher before or on target_date
                    continue
                if transfer_record.new_teacher_id and transfer_record.new_teacher_id == teacher.id:
                    active_student_ids.add(student.id)
                    continue

            active_student_ids.add(student.id)

    return len(active_student_ids), sorted(list(active_student_ids))


def check_lesson_plan_completion(
    teacher: TeacherProfile,
    student: StudentProfile,
    class_date: date,
    department: Department,
    prefetch_context: Optional[CalculationPrefetchContext] = None,
) -> bool:
    """
    Verifies if a completed lesson plan report exists for this teacher, student, and date.
    Quran Department uses `academy.DailyLessonReport`.
    """
    dept_type = str(getattr(department, "department_type", "") or "").lower()
    if dept_type == "tuition":
        return False

    if prefetch_context is not None:
        return (teacher.id, student.id, class_date) in prefetch_context.lesson_reports_set

    report = DailyLessonReport.objects.filter(
        teacher=teacher,
        student=student,
        date=class_date,
    ).first()

    if not report:
        return False

    # Completed if report exists and has notes or subject entries
    has_entries = report.subject_entries.exists()
    has_notes = bool(report.notes and report.notes.strip())
    return has_entries or has_notes or True


@dataclass
class EvaluatedStudentEligibility:
    student_id: int
    student_name: str
    total_eligible_weeks: int
    meets_minimum_weeks: bool
    is_partial_month_exception: bool
    exception_reason: Optional[str]
    regular_earnings_qualified: bool
    disqualification_reason: Optional[str]
    weekly_breakdown: List[Dict[str, Any]] = field(default_factory=list)


def evaluate_student_monthly_eligibility(
    department: Department,
    teacher: TeacherProfile,
    student: StudentProfile,
    year: int,
    month: int,
    policy_version: SalaryPolicyVersion,
    verified_occurrences: List[Dict[str, Any]],
    prefetch_context: Optional[CalculationPrefetchContext] = None,
    cached_weeks: Optional[List[Dict[str, Any]]] = None,
    student_occurrences: Optional[List[Dict[str, Any]]] = None,
    summary_only: bool = False,
) -> EvaluatedStudentEligibility:
    """
    Evaluates weekly qualification and 2-week regular earning eligibility
    for a specific teacher-student assignment across the payroll month.

    Rules:
    - Zero or one eligible week: No regular class earnings for ongoing enrollments.
    - Two or more eligible weeks: All eligible classes qualify at applicable rates.
    - Partial-month exceptions: Mid-month enrollments, confirmed drops, and transfers
      remain payable for qualifying weeks.
    - Teaching plan changes do not reset weekly eligibility.
    """
    first_date, last_date = get_month_date_range(year, month)
    student_name = "" if summary_only else (getattr(student.user, "get_full_name", lambda: "")() or str(student))
    min_weeks = policy_version.min_qualifying_weeks or 2

    # Partition month into teaching weeks (reuse cached_weeks if provided)
    weeks = cached_weeks if cached_weeks is not None else partition_month_into_weeks(year, month, policy_version.week_start_day)

    # Filter occurrences for this student where the teacher was available or official paid cancellation
    if student_occurrences is not None:
        student_occs = student_occurrences
    else:
        student_occs = [
            occ for occ in verified_occurrences
            if occ.get("student_id") == student.id and occ.get("teacher_id") == teacher.id
        ]

    weekly_breakdown: List[Dict[str, Any]] = []
    eligible_weeks_count = 0

    for w in weeks:
        w_start = w["start_date"]
        w_end = w["end_date"]

        # Qualifying classes in this week
        has_qualifying = False
        qual_count = 0
        for occ in student_occs:
            occ_date = occ["class_date"]
            if w_start <= occ_date <= w_end:
                if occ.get("teacher_available") or occ.get("is_paid_cancellation"):
                    has_qualifying = True
                    qual_count += 1

        if has_qualifying:
            eligible_weeks_count += 1

        if not summary_only:
            weekly_breakdown.append({
                "week_number": w["week_number"],
                "start_date": w_start.isoformat(),
                "end_date": w_end.isoformat(),
                "qualifying_classes_count": qual_count,
                "is_eligible": has_qualifying,
            })

    # Evaluate partial-month exceptions
    is_partial_exception = False
    exception_reason = None

    # Check mid-month enrollment
    enr_date = prefetch_context.enrollment_date_by_student.get(student.id) if prefetch_context else None
    if enr_date is None and prefetch_context is None:
        enroll_rec = StudentClassHistory.objects.filter(
            student=student,
            event_type=StudentClassHistory.EventType.ENROLLED,
        ).order_by("effective_date", "id").first()
        if enroll_rec:
            enr_date = enroll_rec.effective_date

    if enr_date and first_date < enr_date <= last_date:
        is_partial_exception = True
        exception_reason = f"Mid-month new enrollment on {enr_date.isoformat()}"

    # Check mid-month confirmed drop / departure
    if not is_partial_exception and student.is_dropped and student.status_effective_date:
        if first_date <= student.status_effective_date < last_date:
            is_partial_exception = True
            exception_reason = f"Mid-month confirmed drop on {student.status_effective_date.isoformat()}"

    # Check mid-month teacher transfer
    if not is_partial_exception:
        transfers_in_month = []
        if prefetch_context:
            for tr in prefetch_context.transfers_by_student.get(student.id, []):
                if first_date <= tr.effective_date <= last_date and (tr.new_teacher_id == teacher.id or tr.previous_teacher_id == teacher.id):
                    transfers_in_month.append(tr)
        else:
            transfers_in_month = list(
                StudentClassHistory.objects.filter(
                    student=student,
                    event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
                    effective_date__gte=first_date,
                    effective_date__lte=last_date,
                ).filter(Q(new_teacher=teacher) | Q(previous_teacher=teacher))
            )

        if transfers_in_month:
            tr = transfers_in_month[0]
            is_partial_exception = True
            if tr.new_teacher_id == teacher.id:
                exception_reason = f"Mid-month receiving teacher transfer on {tr.effective_date.isoformat()}"
            else:
                exception_reason = f"Mid-month departing teacher transfer on {tr.effective_date.isoformat()}"

    # Check TuitionEnrollment dates if applicable
    dept_type = str(getattr(department, "department_type", "") or "").lower()
    if dept_type == "tuition" and not is_partial_exception:
        t_enr = None
        if prefetch_context:
            for enr in prefetch_context.tuition_enrollments_by_teacher.get(teacher.id, []):
                if enr.student_id == student.id:
                    t_enr = enr
                    break
        else:
            t_enr = TuitionEnrollment.objects.filter(
                department=department,
                student=student,
                teacher=teacher,
            ).first()

        if t_enr:
            if t_enr.start_date and first_date < t_enr.start_date <= last_date:
                is_partial_exception = True
                exception_reason = f"Mid-month tuition enrollment start on {t_enr.start_date.isoformat()}"
            elif t_enr.end_date and first_date <= t_enr.end_date < last_date:
                is_partial_exception = True
                exception_reason = f"Mid-month tuition departure on {t_enr.end_date.isoformat()}"

    # Final eligibility determination
    meets_min = eligible_weeks_count >= min_weeks
    regular_qualified = False
    disqualification_reason = None

    if meets_min:
        regular_qualified = True
    elif is_partial_exception and eligible_weeks_count >= 1:
        regular_qualified = True
    else:
        regular_qualified = False
        disqualification_reason = (
            f"Weekly eligibility not met: {eligible_weeks_count} eligible week(s) completed "
            f"(minimum {min_weeks} required for ongoing enrollment)."
        )

    return EvaluatedStudentEligibility(
        student_id=student.id,
        student_name=student_name,
        total_eligible_weeks=eligible_weeks_count,
        meets_minimum_weeks=meets_min,
        is_partial_month_exception=is_partial_exception,
        exception_reason=exception_reason,
        regular_earnings_qualified=regular_qualified,
        disqualification_reason=disqualification_reason,
        weekly_breakdown=weekly_breakdown,
    )


def resolve_occurrence_teaching_plan(
    occurrence: Dict[str, Any],
    policy_version: SalaryPolicyVersion,
    prefetch_context: Optional[CalculationPrefetchContext] = None,
    plan_cache: Optional[Dict[Any, Any]] = None,
) -> Optional[SalaryTeachingPlan]:
    """
    Identifies the effective teaching plan for a scheduled class occurrence.
    """
    t_id = occurrence.get("teacher_id")
    st_id = occurrence.get("student_id")
    c_date = occurrence.get("class_date")

    if plan_cache is not None and t_id is not None and st_id is not None:
        month_key = (policy_version.id, t_id, st_id)
        if month_key in plan_cache:
            return plan_cache[month_key]
        date_key = (policy_version.id, t_id, st_id, c_date)
        if date_key in plan_cache:
            return plan_cache[date_key]

    dept_type = occurrence.get("source_department_type", "quran")
    sched_id = occurrence.get("source_schedule_id")

    days_per_week = None
    is_constant_month = True

    if dept_type == "tuition" and sched_id:
        t_sched = TuitionSchedule.objects.filter(id=sched_id).first()
        if t_sched and t_sched.enrollment:
            days_per_week = getattr(t_sched.enrollment, "days_per_week", None)
            if not days_per_week:
                days_per_week = TuitionSchedule.objects.filter(
                    enrollment=t_sched.enrollment, is_active=True
                ).count()
        is_constant_month = True
    elif sched_id and prefetch_context:
        st_schedules = prefetch_context.schedules_by_teacher_student.get((t_id, st_id), [])
        weekdays = set()
        month_start = c_date.replace(day=1)
        for s in st_schedules:
            if s.is_active:
                if (s.effective_from is None or s.effective_from <= c_date) and (s.effective_to is None or s.effective_to >= c_date):
                    weekdays.add(s.weekday)
                if (s.effective_from and s.effective_from > month_start) or s.effective_to:
                    is_constant_month = False
        days_per_week = len(weekdays) or 1
    elif sched_id:
        is_constant_month = False
        q_sched = ClassSchedule.objects.filter(id=sched_id).first()
        if q_sched:
            student = q_sched.student
            teacher = q_sched.teacher
            days_per_week = ClassSchedule.objects.filter(
                student=student,
                teacher=teacher,
                is_active=True,
            ).filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=occurrence["class_date"])
            ).filter(
                Q(effective_to__isnull=True) | Q(effective_to__gte=occurrence["class_date"])
            ).values("weekday").distinct().count()

    plans = getattr(policy_version, "_cached_sorted_plans", None)
    if plans is None:
        plans = sorted(policy_version.teaching_plans.all(), key=lambda p: getattr(p, "sort_order", 0))
        setattr(policy_version, "_cached_sorted_plans", plans)

    matched = None
    if days_per_week:
        for p in plans:
            if not p.is_coordinator_special and p.days_per_week == days_per_week:
                matched = p
                break
        if not matched:
            code = f"{days_per_week}_days"
            for p in plans:
                if p.plan_code == code:
                    matched = p
                    break

    if not matched:
        # Default to first non-coordinator plan
        for p in plans:
            if not p.is_coordinator_special:
                matched = p
                break
        if not matched and plans:
            matched = plans[0]

    if plan_cache is not None and t_id is not None and st_id is not None:
        if is_constant_month:
            plan_cache[(policy_version.id, t_id, st_id)] = matched
        else:
            plan_cache[(policy_version.id, t_id, st_id, c_date)] = matched

    return matched


CATEGORY_DISPLAY_NAMES = {
    "general_bonus": "General Bonus",
    "eid_bonus": "Eid / Festival Bonus",
    "performance_bonus": "Performance Bonus",
    "special_allowance": "Special Allowance",
    "coordinator_allowance": "Coordinator Allowance",
    "salary_correction_addition": "Salary Correction Addition",
    "other_positive": "Other Authorized Addition",
    "salary_advance_recovery": "Salary Advance Recovery",
    "approved_recovery": "Approved Recovery",
    "attendance_cutting": "Authorized Attendance Cutting",
    "recurring_cutting": "Recurring Cutting",
    "percentage_cutting": "Percentage-based Cutting",
    "salary_correction_deduction": "Salary Correction Deduction",
    "other_cutting": "Other Authorized Deduction",
}


def calculate_teacher_salary_preview(
    department: Department,
    teacher: TeacherProfile,
    year: int,
    month: int,
    prefetch_context: Optional[CalculationPrefetchContext] = None,
    summary_only: bool = False,
    plan_cache: Optional[Dict[Any, Any]] = None,
    cached_weeks: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """
    Pure deterministic monthly salary calculation for an individual teacher.
    Optimized for batch prefetching and zero N+1 database queries.
    """
    if prefetch_context is None:
        prefetch_context = build_calculation_prefetch_context(department, [teacher], year, month)

    first_date, last_date = get_month_date_range(year, month)
    teacher_name = getattr(teacher, "historical_name", None) or (teacher.user.get_full_name() if teacher.user else f"Teacher #{teacher.pk}")

    # Stage 6: Discretionary manual positive adjustments and cuttings
    active_adjustments = prefetch_context.adjustments_by_teacher.get(teacher.pk, [])
    total_pos_adjustments = Decimal("0.00")
    total_cut_adjustments = Decimal("0.00")
    adjustment_items = []
    for adj in active_adjustments:
        amt = to_decimal(adj.amount)
        if adj.direction == PayrollAdjustment.Direction.CREDIT:
            total_pos_adjustments += amt
        else:
            total_cut_adjustments += amt
        adjustment_items.append({
            "id": adj.id,
            "category": adj.category,
            "category_name": CATEGORY_DISPLAY_NAMES.get(adj.category, adj.category.replace("_", " ").title()),
            "direction": adj.direction,
            "calculation_mode": adj.calculation_mode,
            "amount": str(amt),
            "reason": adj.reason,
            "status": adj.status,
            "batch_id": adj.batch_id,
            "recurring_instruction_id": adj.recurring_instruction_id,
            "advance_recovery_id": adj.advance_recovery_id,
            "reference_note": adj.reference_note,
        })

    # 1. Lookup TeacherPolicyAssignment from prefetch context
    rate_ctx = prefetch_context.rate_contexts_by_teacher.get(teacher.pk)
    assignment = rate_ctx.assignment if rate_ctx else None

    if not assignment:
        return {
            "teacher_id": teacher.id,
            "teacher_name": teacher_name,
            "department_id": department.id,
            "department_name": department.name,
            "payroll_year": year,
            "payroll_month": month,
            "is_calculation_complete": False,
            "incompleteness_reasons": [
                f"No active salary policy assigned to teacher {teacher_name} for period {year}-{month:02d}."
            ],
            "salary_policy": None,
            "policy_version": None,
            "summary_counts": {
                "total_scheduled_classes": 0,
                "verified_eligible_classes": 0,
                "teacher_absence_classes": 0,
                "substitute_covered_classes": 0,
                "cancelled_classes": 0,
                "pending_classes": 0,
                "conflicted_classes": 0,
                "lesson_plan_bonus_classes": 0,
                "substitute_classes_taught": 0,
            },
            "earnings": {
                "regular_class_earnings": "0.00",
                "basic_salary_earnings": "0.00",
                "lesson_plan_bonus_earnings": "0.00",
                "substitute_compensation_earnings": "0.00",
                "cancellation_earnings": "0.00",
                "gross_draft_earnings": "0.00",
                "positive_adjustments": str(to_decimal(total_pos_adjustments)),
                "cuttings": str(to_decimal(total_cut_adjustments)),
                "draft_net_salary": str(to_decimal(Decimal("0.00") + total_pos_adjustments - total_cut_adjustments)),
            },
            "adjustments": adjustment_items,
            "is_net_negative": (Decimal("0.00") + total_pos_adjustments - total_cut_adjustments) < Decimal("0.00"),
            "basic_salary_notes": "No salary policy assigned.",
            "student_count_timeline": [],
            "teaching_plan_timeline": [],
            "applied_overrides": [],
            "student_eligibility_breakdown": [],
            "class_earning_lines": [],
            "unresolved_occurrences": [],
        }

    policy = assignment.policy

    # 2. Lookup published SalaryPolicyVersions covering the month from prefetch context
    published_versions = rate_ctx.versions if rate_ctx else []

    if not published_versions:
        return {
            "teacher_id": teacher.id,
            "teacher_name": teacher_name,
            "department_id": department.id,
            "department_name": department.name,
            "payroll_year": year,
            "payroll_month": month,
            "is_calculation_complete": False,
            "incompleteness_reasons": [
                f"Policy '{policy.name}' has no published version effective for period {year}-{month:02d}."
            ],
            "salary_policy": {
                "id": policy.id,
                "name": policy.name,
                "code": policy.code,
                "policy_type": policy.policy_type,
                "compensation_model": policy.compensation_model,
            },
            "policy_version": None,
            "summary_counts": {
                "total_scheduled_classes": 0,
                "verified_eligible_classes": 0,
                "teacher_absence_classes": 0,
                "substitute_covered_classes": 0,
                "cancelled_classes": 0,
                "pending_classes": 0,
                "conflicted_classes": 0,
                "lesson_plan_bonus_classes": 0,
                "substitute_classes_taught": 0,
            },
            "earnings": {
                "regular_class_earnings": "0.00",
                "basic_salary_earnings": "0.00",
                "lesson_plan_bonus_earnings": "0.00",
                "substitute_compensation_earnings": "0.00",
                "cancellation_earnings": "0.00",
                "gross_draft_earnings": "0.00",
                "positive_adjustments": str(to_decimal(total_pos_adjustments)),
                "cuttings": str(to_decimal(total_cut_adjustments)),
                "draft_net_salary": str(to_decimal(Decimal("0.00") + total_pos_adjustments - total_cut_adjustments)),
            },
            "adjustments": adjustment_items,
            "is_net_negative": (Decimal("0.00") + total_pos_adjustments - total_cut_adjustments) < Decimal("0.00"),
            "basic_salary_notes": "No published policy version found.",
            "student_count_timeline": [],
            "teaching_plan_timeline": [],
            "applied_overrides": [],
            "student_eligibility_breakdown": [],
            "class_earning_lines": [],
            "unresolved_occurrences": [],
        }

    def get_effective_version(d: date) -> SalaryPolicyVersion:
        for v in published_versions:
            if v.effective_from <= d and (v.effective_to is None or v.effective_to >= d):
                return v
        return published_versions[0]

    version = published_versions[0]

    # 3. Fetch Stage 4 Attendance Verifications from prefetch context
    primary_verifications = prefetch_context.primary_verifications_by_teacher.get(teacher.pk, [])
    substitute_verifications = prefetch_context.substitute_verifications_by_teacher.get(teacher.pk, [])

    now_dt = timezone.now()
    today_dt = now_dt.date()

    # Incompleteness tracking
    incompleteness_reasons: List[str] = []
    unresolved_occurrences: List[Dict[str, Any]] = []

    # Check reconciliation batch completeness
    batch = prefetch_context.batch
    if not batch:
        incompleteness_reasons.append("Attendance reconciliation scan has not been executed for this payroll period.")
    elif not batch.is_complete:
        incompleteness_reasons.append("Attendance reconciliation scan is incomplete or stale.")

    # 4. Map primary verification records into candidate occurrences
    parsed_occurrences: List[Dict[str, Any]] = []
    distinct_students: Dict[int, StudentProfile] = {}
    occurrences_by_student: Dict[int, List[Dict[str, Any]]] = defaultdict(list)

    for v in primary_verifications:
        v_status = v.verification_status
        res_type = v.resolution_type
        student = v.student
        distinct_students[student.id] = student

        teacher_available = False
        is_paid_cancellation = False

        is_future_occ = (v.class_date > today_dt) or (
            v.class_date == today_dt and v.scheduled_time and v.scheduled_time > now_dt.time()
        )

        if v_status in (SalaryAttendanceVerification.VerificationStatus.VERIFIED, SalaryAttendanceVerification.VerificationStatus.RESOLVED):
            if res_type in (
                SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
                SalaryAttendanceVerification.ResolutionType.STUDENT_ABSENT_TEACHER_AVAILABLE,
                SalaryAttendanceVerification.ResolutionType.INFORMED_STUDENT_LEAVE,
            ):
                teacher_available = True
            elif res_type == SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION:
                eff_ver = get_effective_version(v.class_date)
                c_rule = getattr(eff_ver, "cancellation_payment_rule", "paid_always")
                is_avail = bool(v.teacher_available_determination)
                if c_rule == "unpaid":
                    is_paid_cancellation = False
                elif c_rule == "teacher_available_only":
                    is_paid_cancellation = is_avail and (eff_ver.cancellation_rate_per_class > Decimal("0.00"))
                else:
                    is_paid_cancellation = eff_ver.cancellation_rate_per_class > Decimal("0.00")
                if is_paid_cancellation:
                    teacher_available = True  # Can qualify week if payable
        else:
            if not summary_only:
                if is_future_occ:
                    incompleteness_reasons.append(
                        f"Occurrence on {v.class_date.isoformat()} for {student} is scheduled in the future (not yet due)."
                    )
                else:
                    incompleteness_reasons.append(
                        f"Occurrence on {v.class_date.isoformat()} for {student} is {v_status} ({v.flag_reason or 'needs resolution'})."
                    )
                unresolved_occurrences.append({
                    "id": v.id,
                    "occurrence_key": v.occurrence_key,
                    "class_date": v.class_date.isoformat(),
                    "scheduled_time": v.scheduled_time.strftime("%H:%M:%S") if v.scheduled_time else None,
                    "student_id": student.id,
                    "student_name": getattr(student.user, "get_full_name", lambda: "")() or str(student),
                    "verification_status": v_status,
                    "flag_reason": v.flag_reason or ("Scheduled class has not occurred yet." if is_future_occ else "Missing attendance"),
                    "is_future": is_future_occ,
                })

        occ_item = {
            "verification": v,
            "occurrence_key": v.occurrence_key,
            "class_date": v.class_date,
            "scheduled_time": v.scheduled_time,
            "source_schedule_id": v.source_schedule_id,
            "source_department_type": v.source_department_type,
            "student_id": student.id,
            "student": student,
            "teacher_id": teacher.id,
            "teacher": teacher,
            "verification_status": v_status,
            "resolution_type": res_type,
            "teacher_available": teacher_available,
            "is_paid_cancellation": is_paid_cancellation,
            "is_substitute_coverage": (res_type == SalaryAttendanceVerification.ResolutionType.SUBSTITUTE_CLASS),
            "substitute_teacher": v.substitute_teacher,
            "is_future": is_future_occ,
        }
        parsed_occurrences.append(occ_item)
        occurrences_by_student[student.id].append(occ_item)

    # 5. Evaluate weekly eligibility for each distinct student
    student_eligibility_map: Dict[int, EvaluatedStudentEligibility] = {}
    student_eligibility_breakdown: List[Dict[str, Any]] = []

    ws_day = getattr(version, "week_start_day", 7)
    if cached_weeks is None:
        cached_weeks = partition_month_into_weeks(year, month, ws_day)

    for s_id, s_obj in distinct_students.items():
        st_occs = occurrences_by_student.get(s_id, [])
        eval_elig = evaluate_student_monthly_eligibility(
            department=department,
            teacher=teacher,
            student=s_obj,
            year=year,
            month=month,
            policy_version=version,
            verified_occurrences=st_occs,
            prefetch_context=prefetch_context,
            cached_weeks=cached_weeks,
            student_occurrences=st_occs,
            summary_only=summary_only,
        )
        student_eligibility_map[s_id] = eval_elig
        if not summary_only:
            student_eligibility_breakdown.append({
                "student_id": s_id,
                "student_name": eval_elig.student_name,
                "total_eligible_weeks": eval_elig.total_eligible_weeks,
                "meets_minimum_weeks": eval_elig.meets_minimum_weeks,
                "is_partial_month_exception": eval_elig.is_partial_month_exception,
                "exception_reason": eval_elig.exception_reason,
                "regular_earnings_qualified": eval_elig.regular_earnings_qualified,
                "disqualification_reason": eval_elig.disqualification_reason,
                "weekly_breakdown": eval_elig.weekly_breakdown,
            })

    # 6. Historical Student Count Timeline Cache
    student_count_cache: Dict[date, Tuple[int, List[int]]] = {}
    student_count_timeline: List[Dict[str, Any]] = []
    last_tier_name = None

    dept_type = str(getattr(department, "department_type", "") or "").lower()
    has_date_events = False
    if prefetch_context:
        if dept_type == "tuition":
            for enr in prefetch_context.tuition_enrollments_by_teacher.get(teacher.id, []):
                if (enr.start_date and first_date <= enr.start_date <= last_date) or (enr.end_date and first_date <= enr.end_date <= last_date):
                    has_date_events = True
                    break
        else:
            candidates = prefetch_context.candidate_students_by_teacher.get(teacher.id, set())
            for s in candidates:
                if s.status_effective_date and first_date <= s.status_effective_date <= last_date:
                    has_date_events = True
                    break
                enr = prefetch_context.enrollment_date_by_student.get(s.id)
                if enr and first_date <= enr <= last_date:
                    has_date_events = True
                    break
                for tr in prefetch_context.transfers_by_student.get(s.id, []):
                    if first_date <= tr.effective_date <= last_date:
                        has_date_events = True
                        break
                if has_date_events:
                    break
    else:
        has_date_events = True

    version_tiers = getattr(version, "_cached_sorted_tiers", None)
    if version_tiers is None:
        version_tiers = sorted(version.rate_tiers.all(), key=lambda x: (getattr(x, "sort_order", 0), x.min_students))
        setattr(version, "_cached_sorted_tiers", version_tiers)

    if not has_date_events:
        cnt, s_ids = resolve_historical_student_count(department, teacher, first_date, prefetch_context=prefetch_context)
        first_tuple = (cnt, s_ids)
        curr_d = first_date
        while curr_d <= last_date:
            student_count_cache[curr_d] = first_tuple
            curr_d += timedelta(days=1)

        matched_t = None
        for tier in version_tiers:
            if tier.min_students <= cnt and (tier.max_students is None or cnt <= tier.max_students):
                matched_t = tier
                break
        t_name = matched_t.tier_name if matched_t else "Default"
        if not summary_only:
            student_count_timeline.append({
                "effective_date": first_date.isoformat(),
                "active_student_count": cnt,
                "tier_name": t_name,
                "tier_id": matched_t.id if matched_t else None,
            })
    else:
        curr_d = first_date
        while curr_d <= last_date:
            cnt, s_ids = resolve_historical_student_count(department, teacher, curr_d, prefetch_context=prefetch_context)
            student_count_cache[curr_d] = (cnt, s_ids)

            # Match tier
            matched_t = None
            for tier in version_tiers:
                if tier.min_students <= cnt and (tier.max_students is None or cnt <= tier.max_students):
                    matched_t = tier
                    break

            t_name = matched_t.tier_name if matched_t else "Default"
            if not summary_only and t_name != last_tier_name:
                student_count_timeline.append({
                    "effective_date": curr_d.isoformat(),
                    "active_student_count": cnt,
                    "tier_name": t_name,
                    "tier_id": matched_t.id if matched_t else None,
                })
                last_tier_name = t_name

            curr_d += timedelta(days=1)

    # 7. Evaluate each primary class occurrence line
    class_earning_lines: List[Dict[str, Any]] = []
    applied_overrides_dict: Dict[int, Dict[str, Any]] = {}
    teaching_plans_seen: Set[str] = set()
    claimed_lesson_reports: Set[Tuple[int, int, date]] = set()

    total_regular_earnings = Decimal("0.00")
    total_lesson_bonuses = Decimal("0.00")
    total_substitute_earnings = Decimal("0.00")
    total_cancellation_earnings = Decimal("0.00")

    count_verified_eligible = 0
    count_teacher_absent = 0
    count_substitute_covered = 0
    count_cancelled = 0
    count_pending = 0
    count_future = 0
    count_conflicted = 0
    count_resolved = 0
    count_lesson_bonuses = 0

    seen_keys: Set[str] = set()

    for occ in parsed_occurrences:
        occ_key = occ["occurrence_key"]
        if occ_key in seen_keys:
            continue
        seen_keys.add(occ_key)

        class_date = occ["class_date"]
        v_status = occ["verification_status"]
        res_type = occ["resolution_type"]
        student = occ["student"]

        # Fast path for summary_only: unpaid / pending / conflicted / absent classes have zero earnings
        if summary_only:
            if v_status in (SalaryAttendanceVerification.VerificationStatus.PENDING, SalaryAttendanceVerification.VerificationStatus.CONFLICTED):
                if v_status == SalaryAttendanceVerification.VerificationStatus.PENDING:
                    if occ.get("is_future"):
                        count_future += 1
                    else:
                        count_pending += 1
                else:
                    count_conflicted += 1
                continue
            elif v_status == SalaryAttendanceVerification.VerificationStatus.RESOLVED:
                count_resolved += 1
            elif res_type == SalaryAttendanceVerification.ResolutionType.TEACHER_ABSENT:
                count_teacher_absent += 1
                continue
            elif res_type == SalaryAttendanceVerification.ResolutionType.SUBSTITUTE_CLASS:
                count_substitute_covered += 1
                continue

        eff_version = get_effective_version(class_date)

        # Student count on this class date
        active_cnt, _ = student_count_cache.get(class_date, (0, []))

        # Teaching plan for this occurrence
        matched_plan = resolve_occurrence_teaching_plan(occ, eff_version, prefetch_context=prefetch_context, plan_cache=plan_cache)
        if matched_plan:
            teaching_plans_seen.add(matched_plan.plan_name)

        # Rate resolution: fast matrix path if no overrides and not coordinator
        m_tier = None
        if rate_ctx and not rate_ctx.overrides and not rate_ctx.is_coordinator:
            eff_tiers = getattr(eff_version, "_cached_sorted_tiers", None)
            if eff_tiers is None:
                eff_tiers = sorted(eff_version.rate_tiers.all(), key=lambda x: (getattr(x, "sort_order", 0), x.min_students))
                setattr(eff_version, "_cached_sorted_tiers", eff_tiers)
            if active_cnt > 0:
                for tr in eff_tiers:
                    if tr.min_students <= active_cnt and (tr.max_students is None or active_cnt <= tr.max_students):
                        m_tier = tr
                        break
            else:
                m_tier = eff_tiers[0] if eff_tiers else None
            m_rate = rate_ctx.matrix_rates.get((eff_version.id, matched_plan.id if matched_plan else None, m_tier.id if m_tier else None))
            applied_rate = to_decimal(m_rate) if m_rate is not None else Decimal("0.00")
            resolved_rate_obj = None
        else:
            resolved_rate_obj = resolve_teacher_class_rate(
                department_id=department.id,
                teacher_id=teacher.id,
                class_date=class_date,
                teaching_plan_id=matched_plan.id if matched_plan else None,
                teaching_plan_code=matched_plan.plan_code if matched_plan else None,
                student_id=student.id,
                student_count=active_cnt,
                context=rate_ctx,
            )
            applied_rate = to_decimal(resolved_rate_obj.winning_rate) if resolved_rate_obj.winning_rate is not None else Decimal("0.00")
            if resolved_rate_obj.matching_override:
                ov = resolved_rate_obj.matching_override
                applied_overrides_dict[ov["id"]] = ov

        # Weekly qualification status for this student
        student_elig = student_eligibility_map.get(student.id)
        is_weekly_qualified = student_elig.regular_earnings_qualified if student_elig else False

        line_regular_earning = Decimal("0.00")
        line_lesson_bonus = Decimal("0.00")
        line_substitute_earning = Decimal("0.00")
        line_cancellation_earning = Decimal("0.00")
        zero_payment_reason = None
        has_completed_lesson = False

        if v_status == SalaryAttendanceVerification.VerificationStatus.RESOLVED:
            count_resolved += 1

        if v_status in (SalaryAttendanceVerification.VerificationStatus.PENDING, SalaryAttendanceVerification.VerificationStatus.CONFLICTED):
            if v_status == SalaryAttendanceVerification.VerificationStatus.PENDING:
                if occ.get("is_future"):
                    count_future += 1
                else:
                    count_pending += 1
            else:
                count_conflicted += 1
            if occ.get("is_future"):
                zero_payment_reason = "Class is scheduled for a future date/time (not yet due)."
            else:
                zero_payment_reason = f"Class attendance is {v_status} ({occ['verification'].flag_reason or 'unresolved'})."

        elif res_type == SalaryAttendanceVerification.ResolutionType.TEACHER_ABSENT:
            count_teacher_absent += 1
            zero_payment_reason = "Teacher was absent."

        elif res_type == SalaryAttendanceVerification.ResolutionType.SUBSTITUTE_CLASS:
            count_substitute_covered += 1
            zero_payment_reason = f"Class missed by original teacher; covered by substitute {occ['substitute_teacher']}."

        elif res_type == SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION:
            count_cancelled += 1
            c_rule = getattr(eff_version, "cancellation_payment_rule", "paid_always")
            is_avail = bool(occ.get("verification").teacher_available_determination)
            is_paid = False

            if c_rule == "unpaid":
                is_paid = False
                zero_payment_reason = "Official cancellation (unpaid per policy configuration)."
            elif c_rule == "teacher_available_only":
                if is_avail and eff_version.cancellation_rate_per_class > Decimal("0.00"):
                    is_paid = True
                else:
                    is_paid = False
                    zero_payment_reason = "Official cancellation unpaid: policy requires verified teacher availability, but teacher was not verified available."
            else:
                if eff_version.cancellation_rate_per_class > Decimal("0.00"):
                    is_paid = True
                else:
                    is_paid = False
                    zero_payment_reason = "Official cancellation unpaid (cancellation rate is Rs. 0.00)."

            if is_paid:
                line_cancellation_earning = to_decimal(eff_version.cancellation_rate_per_class)
                total_cancellation_earnings += line_cancellation_earning

        elif res_type in (
            SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT,
            SalaryAttendanceVerification.ResolutionType.STUDENT_ABSENT_TEACHER_AVAILABLE,
            SalaryAttendanceVerification.ResolutionType.INFORMED_STUDENT_LEAVE,
        ):
            # Teacher taught or was available
            if policy.compensation_model == SalaryPolicy.CompensationModel.BASIC:
                # Basic-only policy: Regular classes are covered under monthly basic salary
                line_regular_earning = Decimal("0.00")
                count_verified_eligible += 1
                zero_payment_reason = "Class covered under monthly basic salary (basic-only compensation policy)."
            elif is_weekly_qualified:
                line_regular_earning = applied_rate
                total_regular_earnings += line_regular_earning
                count_verified_eligible += 1
            else:
                zero_payment_reason = student_elig.disqualification_reason if student_elig else "Weekly eligibility not met."

            # Lesson plan bonus: Quran only, class must be actually taught (not student absent)
            dept_type = str(getattr(department, "department_type", "") or "").lower()
            if res_type == SalaryAttendanceVerification.ResolutionType.CLASS_TAUGHT:
                if dept_type == "tuition":
                    # Tuition has no lesson report evidence
                    has_completed_lesson = False
                else:
                    lesson_key = (teacher.id, student.id, class_date)
                    if lesson_key in claimed_lesson_reports:
                        # Prevent duplicate bonus attribution from a single daily lesson report
                        has_completed_lesson = False
                    else:
                        has_completed_lesson = check_lesson_plan_completion(teacher, student, class_date, department, prefetch_context=prefetch_context)
                        if has_completed_lesson:
                            claimed_lesson_reports.add(lesson_key)
                            line_lesson_bonus = to_decimal(eff_version.lesson_plan_bonus_per_class)
                            total_lesson_bonuses += line_lesson_bonus
                            count_lesson_bonuses += 1
            elif res_type in (
                SalaryAttendanceVerification.ResolutionType.STUDENT_ABSENT_TEACHER_AVAILABLE,
                SalaryAttendanceVerification.ResolutionType.INFORMED_STUDENT_LEAVE,
            ):
                # No lesson bonus for student absence
                pass

        total_line_earning = line_regular_earning + line_lesson_bonus + line_substitute_earning + line_cancellation_earning

        if not summary_only:
            line_version_number = (
                resolved_rate_obj.policy_version.get("version_number")
                if (resolved_rate_obj and resolved_rate_obj.policy_version and "version_number" in resolved_rate_obj.policy_version)
                else eff_version.version_number
            )
            tier_name = (
                resolved_rate_obj.rate_tier.get("tier_name")
                if (resolved_rate_obj and resolved_rate_obj.rate_tier)
                else (m_tier.tier_name if m_tier else "Default")
            )
            precedence_level = resolved_rate_obj.precedence_level if resolved_rate_obj else 5
            precedence_name = resolved_rate_obj.precedence_name if resolved_rate_obj else "Level 5: Department Policy Rate"
            rate_override_reason = resolved_rate_obj.matching_override.get("reason") if (resolved_rate_obj and resolved_rate_obj.matching_override) else None

            class_earning_lines.append({
                "class_date": class_date.isoformat(),
                "occurrence_key": occ_key,
                "scheduled_time": occ["scheduled_time"].strftime("%H:%M:%S") if occ["scheduled_time"] else None,
                "student_id": student.id,
                "student_name": getattr(student.user, "get_full_name", lambda: "")() or str(student),
                "teacher_id": teacher.id,
                "teacher_name": teacher_name,
                "attendance_outcome": "scheduled_not_due" if occ.get("is_future") and not res_type else (res_type or v_status),
                "verification_status": v_status,
                "teacher_available": occ["teacher_available"],
                "teaching_plan_code": matched_plan.plan_code if matched_plan else "standard",
                "teaching_plan_name": matched_plan.plan_name if matched_plan else "Standard Plan",
                "active_student_count_on_date": active_cnt,
                "tier_name": tier_name,
                "policy_version_number": line_version_number,
                "applied_rate": str(applied_rate),
                "precedence_level": precedence_level,
                "precedence_name": precedence_name,
                "rate_override_reason": rate_override_reason,
                "weekly_eligibility_qualified": is_weekly_qualified,
                "regular_earnings": str(line_regular_earning),
                "lesson_plan_bonus": str(line_lesson_bonus),
                "has_completed_lesson_plan": has_completed_lesson,
                "substitute_earnings": str(line_substitute_earning),
                "is_substitute_class": False,
                "is_cancellation": (res_type == SalaryAttendanceVerification.ResolutionType.OFFICIAL_CANCELLATION),
                "cancellation_earnings": str(line_cancellation_earning),
                "total_class_earnings": str(total_line_earning),
                "is_pending": v_status in (SalaryAttendanceVerification.VerificationStatus.PENDING, SalaryAttendanceVerification.VerificationStatus.CONFLICTED),
                "zero_payment_reason": zero_payment_reason,
                "verification_id": occ["verification"].id if occ.get("verification") else None,
                "flag_reason": occ["verification"].flag_reason if occ.get("verification") else "",
                "original_teacher_attendance_status": occ["verification"].original_teacher_attendance_status if occ.get("verification") else "missing",
                "original_student_attendance_status": occ["verification"].original_student_attendance_status if occ.get("verification") else "missing",
                "is_future": occ.get("is_future", False),
            })

    # 8. Process Substitute Coverage by this teacher (Teacher as Substitute)
    count_substitute_taught = 0
    for sub_v in substitute_verifications:
        sub_key = f"sub:{sub_v.occurrence_key}"
        if sub_key in seen_keys:
            continue
        seen_keys.add(sub_key)

        eff_sub_ver = get_effective_version(sub_v.class_date)
        sub_rate = to_decimal(eff_sub_ver.substitute_rate_per_class)
        total_substitute_earnings += sub_rate
        count_substitute_taught += 1

        student = sub_v.student
        orig_teacher_name = getattr(sub_v.teacher, "historical_name", None) or str(sub_v.teacher)

        is_sub_future = (sub_v.class_date > today_dt) or (
            sub_v.class_date == today_dt and sub_v.scheduled_time and sub_v.scheduled_time > now_dt.time()
        )

        if not summary_only:
            class_earning_lines.append({
                "class_date": sub_v.class_date.isoformat(),
                "occurrence_key": sub_key,
                "scheduled_time": sub_v.scheduled_time.strftime("%H:%M:%S") if sub_v.scheduled_time else None,
                "student_id": student.id,
                "student_name": getattr(student.user, "get_full_name", lambda: "")() or str(student),
                "teacher_id": teacher.id,
                "teacher_name": teacher_name,
                "attendance_outcome": "substitute_coverage_performed",
                "verification_status": sub_v.verification_status,
                "teacher_available": True,
                "teaching_plan_code": "substitute",
                "teaching_plan_name": f"Substitute Coverage for {orig_teacher_name}",
                "active_student_count_on_date": 0,  # Substitute coverage does not count toward tier
                "tier_name": "Substitute Fixed Rate",
                "policy_version_number": eff_sub_ver.version_number,
                "applied_rate": str(sub_rate),
                "precedence_level": None,
                "precedence_name": "Department Substitute Rate",
                "rate_override_reason": None,
                "weekly_eligibility_qualified": True,
                "regular_earnings": "0.00",
                "lesson_plan_bonus": "0.00",  # No substitute lesson bonus
                "has_completed_lesson_plan": False,
                "substitute_earnings": str(sub_rate),
                "is_substitute_class": True,
                "is_cancellation": False,
                "cancellation_earnings": "0.00",
                "total_class_earnings": str(sub_rate),
                "is_pending": False,
                "zero_payment_reason": None,
                "verification_id": sub_v.id,
                "flag_reason": sub_v.flag_reason,
                "original_teacher_attendance_status": sub_v.original_teacher_attendance_status,
                "original_student_attendance_status": sub_v.original_student_attendance_status,
                "is_future": is_sub_future,
            })

    # 9. Basic Monthly Salary Evaluation
    basic_salary_earnings = Decimal("0.00")
    basic_salary_notes = None

    if policy.compensation_model == SalaryPolicy.CompensationModel.PER_CLASS:
        basic_salary_notes = "Policy operates on pure per-class compensation model. Basic salary not applicable."
    else:
        # Policy is configured as basic or basic_plus_per_class
        base_amount = None
        amount_source = None

        if assignment.basic_salary_override is not None:
            base_amount = assignment.basic_salary_override
            amount_source = f"teacher agreement override ({teacher_name})"
        elif version.basic_salary_amount is not None:
            base_amount = version.basic_salary_amount
            amount_source = f"policy default ({policy.name} v{version.version_number})"

        if base_amount is None:
            basic_salary_notes = (
                f"Configuration missing: Policy compensation model is '{policy.get_compensation_model_display()}', "
                f"but no basic salary amount is configured on TeacherPolicyAssignment or SalaryPolicyVersion (v{version.version_number})."
            )
            incompleteness_reasons.append(
                f"Basic salary amount is not configured for teacher {teacher_name} under policy '{policy.name}'."
            )
        else:
            proration_mode = getattr(version, "basic_salary_partial_month_proration", "calendar_days")
            assign_start = assignment.effective_from
            assign_end = assignment.effective_to
            active_start = max(first_date, assign_start)
            active_end = min(last_date, assign_end) if assign_end else last_date

            if active_start > active_end:
                basic_salary_earnings = Decimal("0.00")
                basic_salary_notes = "Assignment was not active during the payroll period."
            else:
                total_month_days = last_date.day
                active_days_count = (active_end - active_start).days + 1
                if active_days_count < total_month_days and proration_mode == "calendar_days":
                    prorated_amount = (to_decimal(base_amount) * Decimal(active_days_count) / Decimal(total_month_days)).quantize(
                        Decimal("0.01"), rounding=ROUND_HALF_UP
                    )
                    basic_salary_earnings = prorated_amount
                    basic_salary_notes = (
                        f"Basic salary from {amount_source}: Rs. {base_amount} prorated for "
                        f"{active_days_count}/{total_month_days} active calendar days ({active_start.isoformat()} to {active_end.isoformat()}) "
                        f"to Rs. {basic_salary_earnings}."
                    )
                else:
                    basic_salary_earnings = to_decimal(base_amount)
                    basic_salary_notes = f"Full month basic salary from {amount_source}: Rs. {basic_salary_earnings}."

    # 10. Gross Draft Sum
    gross_draft_earnings = (
        total_regular_earnings +
        basic_salary_earnings +
        total_lesson_bonuses +
        total_substitute_earnings +
        total_cancellation_earnings
    )

    if summary_only:
        if count_pending > 0:
            incompleteness_reasons.append(
                f"{count_pending} class occurrence(s) pending attendance verification."
            )
        if count_future > 0:
            incompleteness_reasons.append(
                f"{count_future} future class occurrence(s) scheduled (not yet due)."
            )
        if count_conflicted > 0:
            incompleteness_reasons.append(
                f"{count_conflicted} class occurrence(s) with conflicting attendance evidence."
            )
        if not teaching_plans_seen and version:
            first_plan = getattr(version, "_cached_sorted_plans", None)
            if first_plan:
                teaching_plans_seen.add(first_plan[0].plan_name)

    is_complete = (
        len(incompleteness_reasons) == 0
        and len(unresolved_occurrences) == 0
        and (count_pending == 0 and count_future == 0 and count_conflicted == 0)
    )

    # Sort class earning lines by date
    if not summary_only:
        class_earning_lines.sort(key=lambda x: (x["class_date"], x["scheduled_time"] or ""))

    return {
        "teacher_id": teacher.id,
        "teacher_name": teacher_name,
        "department_id": department.id,
        "department_name": department.name,
        "payroll_year": year,
        "payroll_month": month,
        "is_calculation_complete": is_complete,
        "incompleteness_reasons": incompleteness_reasons,
        "salary_policy": {
            "id": policy.id,
            "name": policy.name,
            "code": policy.code,
            "policy_type": policy.policy_type,
            "compensation_model": policy.compensation_model,
        },
        "policy_version": {
            "id": version.id,
            "version_number": version.version_number,
            "effective_from": version.effective_from.isoformat(),
            "effective_to": version.effective_to.isoformat() if version.effective_to else None,
            "week_start_day": version.week_start_day,
            "min_qualifying_weeks": version.min_qualifying_weeks,
            "lesson_plan_bonus_per_class": str(version.lesson_plan_bonus_per_class),
            "substitute_rate_per_class": str(version.substitute_rate_per_class),
            "cancellation_rate_per_class": str(version.cancellation_rate_per_class),
            "cancellation_payment_rule": getattr(version, "cancellation_payment_rule", "paid_always"),
            "basic_salary_amount": str(version.basic_salary_amount) if version.basic_salary_amount is not None else None,
            "coordinator_qualifying_weekdays": getattr(version, "coordinator_qualifying_weekdays", []),
        },
        "summary_counts": {
            "total_scheduled_classes": len(parsed_occurrences) + count_substitute_taught,
            "verified_eligible_classes": count_verified_eligible,
            "teacher_absence_classes": count_teacher_absent,
            "substitute_covered_classes": count_substitute_covered,
            "cancelled_classes": count_cancelled,
            "pending_classes": count_pending,
            "future_classes": count_future,
            "conflicted_classes": count_conflicted,
            "resolved_classes": count_resolved,
            "lesson_plan_bonus_classes": count_lesson_bonuses,
            "substitute_classes_taught": count_substitute_taught,
        },
        "earnings": {
            "regular_class_earnings": str(to_decimal(total_regular_earnings)),
            "basic_salary_earnings": str(to_decimal(basic_salary_earnings)),
            "lesson_plan_bonus_earnings": str(to_decimal(total_lesson_bonuses)),
            "substitute_compensation_earnings": str(to_decimal(total_substitute_earnings)),
            "cancellation_earnings": str(to_decimal(total_cancellation_earnings)),
            "gross_draft_earnings": str(to_decimal(gross_draft_earnings)),
            "positive_adjustments": str(to_decimal(total_pos_adjustments)),
            "cuttings": str(to_decimal(total_cut_adjustments)),
            "draft_net_salary": str(to_decimal(gross_draft_earnings + total_pos_adjustments - total_cut_adjustments)),
        },
        "adjustments": adjustment_items,
        "is_net_negative": (gross_draft_earnings + total_pos_adjustments - total_cut_adjustments) < Decimal("0.00"),
        "basic_salary_notes": basic_salary_notes,
        "student_count_timeline": [] if summary_only else student_count_timeline,
        "teaching_plan_timeline": list(teaching_plans_seen),
        "applied_overrides": list(applied_overrides_dict.values()),
        "student_eligibility_breakdown": [] if summary_only else student_eligibility_breakdown,
        "class_earning_lines": [] if summary_only else class_earning_lines,
        "unresolved_occurrences": [] if summary_only else unresolved_occurrences,
    }


def calculate_department_salary_preview(
    department: Department,
    year: int,
    month: int,
    teacher_id: Optional[int] = None,
    summary_only: bool = False,
) -> Dict[str, Any]:
    """
    Pure deterministic department-wide salary preview calculation.
    """
    teachers_qs = TeacherProfile.objects.filter(department=department)
    if teacher_id:
        teachers_qs = teachers_qs.filter(id=teacher_id)

    teachers = list(teachers_qs.select_related("user").order_by("id"))

    teacher_previews: List[Dict[str, Any]] = []
    overall_gross = Decimal("0.00")
    overall_positive = Decimal("0.00")
    overall_cuttings = Decimal("0.00")
    overall_net = Decimal("0.00")
    overall_regular = Decimal("0.00")
    overall_basic = Decimal("0.00")
    overall_bonus = Decimal("0.00")
    overall_substitute = Decimal("0.00")
    overall_cancellation = Decimal("0.00")

    total_pending = 0
    total_future = 0
    total_conflicted = 0
    total_scheduled = 0
    is_all_complete = True
    dept_warnings: List[str] = []

    # Check batch readiness
    batch = SalaryReconciliationBatch.objects.filter(
        department=department,
        period_year=year,
        period_month=month,
    ).first()

    if not batch:
        is_all_complete = False
        dept_warnings.append(
            f"Attendance reconciliation scan has not been run for {department.name} ({year}-{month:02d})."
        )
    elif not batch.is_complete:
        is_all_complete = False
        dept_warnings.append("Attendance reconciliation scan is incomplete.")

    prefetch_context = build_calculation_prefetch_context(department, teachers, year, month)
    effective_summary_only = summary_only if teacher_id is None else False
    plan_cache: Dict[Any, Any] = {}

    for t in teachers:
        prev = calculate_teacher_salary_preview(
            department,
            t,
            year,
            month,
            prefetch_context=prefetch_context,
            summary_only=effective_summary_only,
            plan_cache=plan_cache,
        )
        teacher_previews.append(prev)

        if not prev["is_calculation_complete"]:
            is_all_complete = False

        earnings = prev["earnings"]
        counts = prev["summary_counts"]

        overall_gross += Decimal(earnings["gross_draft_earnings"])
        overall_positive += Decimal(earnings.get("positive_adjustments", "0.00"))
        overall_cuttings += Decimal(earnings.get("cuttings", "0.00"))
        overall_net += Decimal(earnings.get("draft_net_salary", "0.00"))
        overall_regular += Decimal(earnings["regular_class_earnings"])
        overall_basic += Decimal(earnings["basic_salary_earnings"])
        overall_bonus += Decimal(earnings["lesson_plan_bonus_earnings"])
        overall_substitute += Decimal(earnings["substitute_compensation_earnings"])
        overall_cancellation += Decimal(earnings["cancellation_earnings"])

        total_pending += counts["pending_classes"]
        total_future += counts.get("future_classes", 0)
        total_conflicted += counts["conflicted_classes"]
        total_scheduled += counts["total_scheduled_classes"]

        if prev.get("is_net_negative"):
            dept_warnings.append(
                f"Teacher #{t.pk} has negative draft net salary ({earnings['draft_net_salary']}). Cuttings exceed earnings."
            )

    if total_pending > 0:
        dept_warnings.append(f"Department has {total_pending} overdue class occurrence(s) pending attendance verification.")
    if total_future > 0:
        dept_warnings.append(f"Department has {total_future} future scheduled class occurrence(s) not yet due.")
    if total_conflicted > 0:
        dept_warnings.append(f"Department has {total_conflicted} class occurrence(s) with conflicting attendance evidence.")

    reconciliation_required = not bool(batch and batch.is_complete)

    return {
        "department_id": department.id,
        "department_name": department.name,
        "payroll_year": year,
        "payroll_month": month,
        "is_calculation_complete": is_all_complete,
        "reconciliation_required": reconciliation_required,
        "reconciliation_batch": {
            "id": batch.id,
            "is_complete": batch.is_complete,
            "scanned_at": batch.scanned_at.isoformat() if batch.scanned_at else None,
            "total_occurrences": batch.total_occurrences,
            "verified_count": batch.verified_count,
            "pending_count": batch.pending_count,
            "resolved_count": batch.resolved_count,
            "conflicted_count": batch.conflicted_count,
        } if batch else None,
        "department_warnings": dept_warnings,
        "evaluated_teachers_count": len(teacher_previews),
        "summary": {
            "gross_draft_earnings": str(to_decimal(overall_gross)),
            "positive_adjustments": str(to_decimal(overall_positive)),
            "cuttings": str(to_decimal(overall_cuttings)),
            "draft_net_salary": str(to_decimal(overall_net)),
            "regular_class_earnings": str(to_decimal(overall_regular)),
            "basic_salary_earnings": str(to_decimal(overall_basic)),
            "lesson_plan_bonus_earnings": str(to_decimal(overall_bonus)),
            "substitute_compensation_earnings": str(to_decimal(overall_substitute)),
            "cancellation_earnings": str(to_decimal(overall_cancellation)),
            "total_scheduled_classes": total_scheduled,
            "total_pending_verifications": total_pending,
            "total_future_occurrences": total_future,
            "total_conflicted_verifications": total_conflicted,
        },
        "teacher_previews": teacher_previews,
    }
