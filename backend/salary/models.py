"""Unified Salary Management Configuration and Foundation Models.

Stage 1: Core policy definition, effective-dated versions, student count tiers,
weekly teaching plans, 2D rate matrices, teacher policy assignments, and overrides.
"""
from datetime import date, timedelta
from decimal import Decimal
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


def date_intervals_overlap(s1, e1, s2, e2):
    """Return True if two date intervals [s1, e1] and [s2, e2] overlap.

    Interval ends can be None, representing an open (unbounded) future.
    """
    cond1 = (e2 is None) or (s1 <= e2)
    cond2 = (e1 is None) or (s2 <= e1)
    return cond1 and cond2


def get_policy_published_coverage_intervals(policy):
    """
    Returns a list of (start_date, end_date) tuples representing contiguous
    published coverage blocks for the policy.
    end_date can be None (indefinite).
    """
    versions = list(
        policy.versions.filter(status=SalaryPolicyVersion.Status.PUBLISHED)
        .order_by("effective_from", "version_number")
    )
    if not versions:
        return []

    intervals = []
    current_start = versions[0].effective_from
    current_end = versions[0].effective_to

    for v in versions[1:]:
        if current_end is None:
            break
        if v.effective_from <= current_end + timedelta(days=1):
            if v.effective_to is None:
                current_end = None
            elif v.effective_to > current_end:
                current_end = v.effective_to
        else:
            intervals.append((current_start, current_end))
            current_start = v.effective_from
            current_end = v.effective_to

    intervals.append((current_start, current_end))
    return intervals


def resolve_teacher_policy_coverage(policy, teacher=None):
    """
    Authoritatively resolves the applicable assignment effective dates for a teacher
    and a published salary policy.
    Enforces published version coverage, policy-version gaps, and teacher joining date boundaries.
    """
    intervals = get_policy_published_coverage_intervals(policy)
    if not intervals:
        raise ValidationError({"policy": "Cannot assign a salary policy that has no published versions."})

    earliest_policy_start = intervals[0][0]
    latest_policy_end = intervals[-1][1] if intervals[-1][1] is not None and all(i[1] is not None for i in intervals) else None

    eff_from = earliest_policy_start
    eff_to = latest_policy_end

    # Enforce teacher joining date boundary:
    # Do not silently pay teacher for periods before their eligibility began.
    if teacher and getattr(teacher, "joining_date", None):
        j_date = teacher.joining_date
        if latest_policy_end is not None and j_date > latest_policy_end:
            raise ValidationError(
                {"teacher": f"Teacher joining date ({j_date}) is after policy coverage ended ({latest_policy_end})."}
            )
        if j_date > eff_from:
            eff_from = j_date

    # Enforce teacher salary end date boundary if applicable
    if teacher and getattr(teacher, "salary_end_date", None):
        s_end = teacher.salary_end_date
        if s_end < eff_from:
            raise ValidationError(
                {"teacher": f"Teacher salary end date ({s_end}) precedes policy effective start ({eff_from})."}
            )
        if eff_to is None or s_end < eff_to:
            eff_to = s_end

    # Check if eff_from falls within a policy gap
    is_covered = False
    for b_start, b_end in intervals:
        if b_start <= eff_from and (b_end is None or eff_from <= b_end):
            is_covered = True
            if b_end is not None and (eff_to is None or eff_to > b_end):
                eff_to = b_end
            break

    if not is_covered:
        raise ValidationError(
            {"effective_from": f"Resolved effective date ({eff_from}) falls within a gap between published policy versions."}
        )

    return {
        "effective_from": eff_from,
        "effective_to": eff_to,
        "intervals": intervals,
        "earliest_policy_start": earliest_policy_start,
        "latest_policy_end": latest_policy_end,
    }


class SalaryPolicy(models.Model):
    """Top-level salary policy definition, scoped strictly to a department."""

    class PolicyType(models.TextChoices):
        STANDARD = "standard", "Standard Policy"
        HIFZ = "hifz", "Hifz Special"
        CUSTOM = "custom", "Custom Policy"

    class CompensationModel(models.TextChoices):
        PER_CLASS = "per_class", "Per-Class Salary"
        BASIC = "basic", "Basic Salary"
        BASIC_PLUS_PER_CLASS = "basic_plus_per_class", "Basic Plus Per-Class Salary"

    institution = models.ForeignKey(
        "accounts.Institution",
        on_delete=models.CASCADE,
        related_name="salary_policies",
    )
    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="salary_policies",
    )
    code = models.CharField(
        max_length=60,
        db_index=True,
        help_text="Unique policy identifier within the department (e.g. QURAN_STANDARD_2026).",
    )
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    policy_type = models.CharField(
        max_length=30,
        choices=PolicyType.choices,
        default=PolicyType.STANDARD,
    )
    compensation_model = models.CharField(
        max_length=30,
        choices=CompensationModel.choices,
        default=CompensationModel.PER_CLASS,
    )
    is_active = models.BooleanField(default=True, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["department", "code"],
                name="unique_department_salary_policy_code",
            )
        ]
        ordering = ["department", "code"]
        verbose_name = "Salary Policy"
        verbose_name_plural = "Salary Policies"

    def __str__(self):
        return f"{self.name} ({self.code}) - {self.department.name}"

    def clean(self):
        super().clean()
        if self.department_id and self.institution_id:
            if self.department.institution_id != self.institution_id:
                raise ValidationError({"department": "Department does not belong to the specified Institution."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)




    @property
    def published_effective_from(self):
        intervals = get_policy_published_coverage_intervals(self)
        return intervals[0][0] if intervals else None

    @property
    def published_effective_to(self):
        intervals = get_policy_published_coverage_intervals(self)
        if not intervals:
            return None
        if any(i[1] is None for i in intervals):
            return None
        return intervals[-1][1]

    def delete(self, *args, **kwargs):
        if self.versions.filter(status=SalaryPolicyVersion.Status.PUBLISHED).exists():
            raise ValidationError("Cannot delete a salary policy that contains published versions.")
        if self.teacher_assignments.exists():
            raise ValidationError("Cannot delete a salary policy that has teacher assignments.")
        return super().delete(*args, **kwargs)


class SalaryPolicyVersion(models.Model):
    """Effective-dated, immutable configuration container for policy parameters.

    Published versions are protected against ordinary edits. To change rates or
    parameters, create a new draft version.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        PUBLISHED = "published", "Published"
        ARCHIVED = "archived", "Archived"

    class WeekDay(models.TextChoices):
        MONDAY = "monday", "Monday"
        TUESDAY = "tuesday", "Tuesday"
        WEDNESDAY = "wednesday", "Wednesday"
        THURSDAY = "thursday", "Thursday"
        FRIDAY = "friday", "Friday"
        SATURDAY = "saturday", "Saturday"
        SUNDAY = "sunday", "Sunday"

    policy = models.ForeignKey(
        SalaryPolicy,
        on_delete=models.CASCADE,
        related_name="versions",
    )
    version_number = models.PositiveIntegerField()
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    effective_from = models.DateField(db_index=True)
    effective_to = models.DateField(null=True, blank=True, db_index=True)
    week_start_day = models.CharField(
        max_length=12,
        choices=WeekDay.choices,
        default=WeekDay.MONDAY,
    )
    min_qualifying_weeks = models.PositiveSmallIntegerField(
        default=2,
        help_text="Minimum qualified weeks required for ongoing student compensation.",
    )
    lesson_plan_bonus_per_class = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("10.00"),
    )
    substitute_rate_per_class = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("80.00"),
    )
    cancellation_rate_per_class = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("80.00"),
    )
    cancellation_payment_rule = models.CharField(
        max_length=30,
        choices=[
            ("paid_always", "Always Paid"),
            ("teacher_available_only", "Paid Only If Teacher Available"),
            ("unpaid", "Unpaid"),
        ],
        default="paid_always",
        help_text="Compensation rule for official academy cancellations.",
    )
    basic_salary_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Default policy basic monthly salary in PKR for basic compensation models.",
    )
    basic_salary_partial_month_proration = models.CharField(
        max_length=20,
        choices=[
            ("calendar_days", "Prorate by Calendar Days"),
            ("working_days", "Prorate by Working Days"),
            ("none", "Full Month (No Proration)"),
        ],
        default="calendar_days",
        help_text="Proration method for teachers joining or leaving mid-month.",
    )
    coordinator_qualifying_weekdays = models.JSONField(
        default=list,
        blank=True,
        help_text="List of lowercase weekday names (e.g. ['friday', 'saturday', 'sunday', 'monday']) when coordinator special rates apply.",
    )
    requires_completed_lesson_for_bonus = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["policy", "version_number"],
                name="unique_policy_version_number",
            ),
            models.CheckConstraint(
                check=models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=models.F("effective_from")),
                name="check_valid_policy_version_dates",
            ),
        ]
        ordering = ["policy", "-version_number"]
        verbose_name = "Salary Policy Version"
        verbose_name_plural = "Salary Policy Versions"

    def __str__(self):
        return f"{self.policy.name} v{self.version_number} [{self.get_status_display()}]"

    def clean(self):
        super().clean()

        if self.effective_to and self.effective_from and self.effective_to < self.effective_from:
            raise ValidationError({"effective_to": "Effective end date cannot precede effective start date."})

        if self.basic_salary_amount is not None and self.basic_salary_amount < Decimal("0.00"):
            raise ValidationError({"basic_salary_amount": "Basic salary amount must be non-negative."})

        if self.coordinator_qualifying_weekdays:
            if not isinstance(self.coordinator_qualifying_weekdays, list):
                raise ValidationError({"coordinator_qualifying_weekdays": "Coordinator qualifying weekdays must be a list of weekday names."})
            valid_days = {w.value for w in self.WeekDay}
            invalid = [d for d in self.coordinator_qualifying_weekdays if str(d).lower() not in valid_days]
            if invalid:
                raise ValidationError({"coordinator_qualifying_weekdays": f"Invalid weekday names in coordinator qualifying weekdays: {invalid}."})

        # Check immutability if this instance was already published in the database
        if self.pk:
            prev = SalaryPolicyVersion.objects.filter(pk=self.pk).first()
            if prev and prev.status == self.Status.PUBLISHED:
                # Allowed transition: published -> archived
                if self.status == self.Status.ARCHIVED:
                    pass  # Archiving is allowed
                else:
                    # Published versions cannot modify configuration or dates
                    fields_to_check = [
                        "policy_id", "version_number", "effective_from", "effective_to",
                        "week_start_day", "min_qualifying_weeks", "lesson_plan_bonus_per_class",
                        "substitute_rate_per_class", "cancellation_rate_per_class",
                        "cancellation_payment_rule", "basic_salary_amount",
                        "basic_salary_partial_month_proration", "coordinator_qualifying_weekdays",
                        "requires_completed_lesson_for_bonus",
                    ]
                    modified = [f for f in fields_to_check if getattr(self, f) != getattr(prev, f)]
                    if modified:
                        raise ValidationError(
                            f"Published salary policy versions are immutable. Cannot modify: {', '.join(modified)}. "
                            "Create and publish a new version instead."
                        )

        # Overlapping check among published versions of the same policy
        if self.status == self.Status.PUBLISHED and self.policy_id:
            qs = SalaryPolicyVersion.objects.filter(
                policy_id=self.policy_id,
                status=self.Status.PUBLISHED,
            )
            if self.pk:
                qs = qs.exclude(pk=self.pk)
            for other in qs:
                if date_intervals_overlap(self.effective_from, self.effective_to, other.effective_from, other.effective_to):
                    raise ValidationError(
                        f"Effective dates [{self.effective_from} to {self.effective_to or 'indefinite'}] "
                        f"overlap with existing published version v{other.version_number} "
                        f"[{other.effective_from} to {other.effective_to or 'indefinite'}]."
                    )

            # Contiguous tier set validation on publication
            if self.pk:
                self.validate_contiguous_tiers()

    def validate_contiguous_tiers(self):
        """Validate that all defined tiers form a contiguous, non-overlapping sequence."""
        tiers = list(self.rate_tiers.all().order_by("sort_order", "min_students"))
        if not tiers:
            raise ValidationError("A published policy version must have at least one rate tier.")

        first = tiers[0]
        if first.min_students < 1:
            raise ValidationError("The first rate tier must start at 1 or greater.")

        for i in range(len(tiers) - 1):
            curr_tier = tiers[i]
            next_tier = tiers[i + 1]
            if curr_tier.max_students is None:
                raise ValidationError(
                    f"Tier '{curr_tier.tier_name}' is unbounded but is not the final tier. Only the final tier can be unbounded."
                )
            expected_next_min = curr_tier.max_students + 1
            if next_tier.min_students != expected_next_min:
                raise ValidationError(
                    f"Gap or overlap between tier '{curr_tier.tier_name}' (max {curr_tier.max_students}) "
                    f"and tier '{next_tier.tier_name}' (min {next_tier.min_students}). "
                    f"Expected next tier min to be {expected_next_min}."
                )

    def save(self, *args, **kwargs):
        if self.status == self.Status.PUBLISHED and not self.published_at:
            self.published_at = timezone.now()
        self.full_clean()
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.status == self.Status.PUBLISHED:
            raise ValidationError("Cannot delete a published salary policy version.")
        return super().delete(*args, **kwargs)


class SalaryRateTier(models.Model):
    """Student count tier (horizontal axis of rate matrix)."""

    policy_version = models.ForeignKey(
        SalaryPolicyVersion,
        on_delete=models.CASCADE,
        related_name="rate_tiers",
    )
    tier_name = models.CharField(max_length=60)
    min_students = models.PositiveIntegerField(default=1)
    max_students = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Leave blank for an unbounded upper tier (e.g. 20+).",
    )
    sort_order = models.PositiveSmallIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["policy_version", "sort_order"],
                name="unique_policy_version_tier_order",
            ),
            models.CheckConstraint(
                check=models.Q(min_students__gte=1),
                name="check_min_students_positive",
            ),
            models.CheckConstraint(
                check=models.Q(max_students__isnull=True) | models.Q(max_students__gte=models.F("min_students")),
                name="check_tier_min_lte_max",
            ),
        ]
        ordering = ["policy_version", "sort_order", "min_students"]
        verbose_name = "Salary Rate Tier"
        verbose_name_plural = "Salary Rate Tiers"

    def __str__(self):
        upper = f"{self.max_students}" if self.max_students is not None else "+"
        return f"{self.tier_name} ({self.min_students}–{upper})"

    def clean(self):
        super().clean()
        if self.policy_version_id and self.policy_version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise ValidationError("Cannot modify rate tiers of a published policy version.")
        if self.min_students is not None and self.min_students < 1:
            raise ValidationError({"min_students": "Minimum student count must be at least 1."})
        if self.max_students is not None and self.min_students is not None:
            if self.max_students < self.min_students:
                raise ValidationError({"max_students": "Maximum students must be greater than or equal to minimum students."})

        # Check overlapping with sibling tiers in same version
        if self.policy_version_id:
            qs = SalaryRateTier.objects.filter(policy_version_id=self.policy_version_id)
            if self.pk:
                qs = qs.exclude(pk=self.pk)
            for other in qs:
                s_min, s_max = self.min_students, self.max_students
                o_min, o_max = other.min_students, other.max_students
                overlap_1 = (o_max is None) or (s_min <= o_max)
                overlap_2 = (s_max is None) or (o_min <= s_max)
                if overlap_1 and overlap_2:
                    raise ValidationError(
                        f"Tier range ({s_min}–{s_max or '∞'}) overlaps with existing tier '{other.tier_name}' ({o_min}–{o_max or '∞'})."
                    )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)




    def delete(self, *args, **kwargs):
        if self.policy_version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise ValidationError("Cannot delete rate tiers of a published policy version.")
        return super().delete(*args, **kwargs)


class SalaryTeachingPlan(models.Model):
    """Weekly teaching arrangements (vertical axis of rate matrix)."""

    policy_version = models.ForeignKey(
        SalaryPolicyVersion,
        on_delete=models.CASCADE,
        related_name="teaching_plans",
    )
    plan_code = models.CharField(
        max_length=40,
        help_text="Unique plan code within policy version (e.g. 5_days, 4_days, coordinator_special).",
    )
    plan_name = models.CharField(max_length=100)
    days_per_week = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Standard teaching days per week (null for special plans like coordinator).",
    )
    is_coordinator_special = models.BooleanField(default=False)
    sort_order = models.PositiveSmallIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["policy_version", "plan_code"],
                name="unique_policy_version_plan_code",
            )
        ]
        ordering = ["policy_version", "sort_order", "plan_code"]
        verbose_name = "Salary Teaching Plan"
        verbose_name_plural = "Salary Teaching Plans"

    def __str__(self):
        return f"{self.plan_name} ({self.plan_code})"

    def clean(self):
        super().clean()
        if self.policy_version_id and self.policy_version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise ValidationError("Cannot modify teaching plans of a published policy version.")

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)




    def delete(self, *args, **kwargs):
        if self.policy_version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise ValidationError("Cannot delete teaching plans of a published policy version.")
        return super().delete(*args, **kwargs)


class SalaryPlanTierRate(models.Model):
    """Two-dimensional salary rate cell: Teaching Plan × Student-Count Tier."""

    policy_version = models.ForeignKey(
        SalaryPolicyVersion,
        on_delete=models.CASCADE,
        related_name="plan_tier_rates",
    )
    teaching_plan = models.ForeignKey(
        SalaryTeachingPlan,
        on_delete=models.CASCADE,
        related_name="tier_rates",
    )
    rate_tier = models.ForeignKey(
        SalaryRateTier,
        on_delete=models.CASCADE,
        related_name="plan_rates",
    )
    rate_per_class = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text="PKR amount per eligible attended class.",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["policy_version", "teaching_plan", "rate_tier"],
                name="unique_plan_tier_rate_entry",
            ),
            models.CheckConstraint(
                check=models.Q(rate_per_class__gte=Decimal("0.00")),
                name="check_positive_rate_per_class",
            ),
        ]
        ordering = ["policy_version", "teaching_plan", "rate_tier"]
        verbose_name = "Salary Plan Tier Rate"
        verbose_name_plural = "Salary Plan Tier Rates"

    def __str__(self):
        return f"{self.teaching_plan.plan_code} x {self.rate_tier.tier_name}: Rs. {self.rate_per_class}"

    def clean(self):
        super().clean()
        if self.policy_version_id and self.policy_version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise ValidationError("Cannot modify rate cells of a published policy version.")

        if self.rate_per_class is not None and self.rate_per_class < Decimal("0.00"):
            raise ValidationError({"rate_per_class": "Rate per class must be non-negative."})

        # Foreign version integrity: teaching plan must belong to the same policy version
        if self.teaching_plan_id and self.policy_version_id:
            if self.teaching_plan.policy_version_id != self.policy_version_id:
                raise ValidationError({"teaching_plan": "Teaching plan does not belong to the specified policy version."})

        # Foreign version integrity: rate tier must belong to the same policy version
        if self.rate_tier_id and self.policy_version_id:
            if self.rate_tier.policy_version_id != self.policy_version_id:
                raise ValidationError({"rate_tier": "Rate tier does not belong to the specified policy version."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)




    def delete(self, *args, **kwargs):
        if self.policy_version.status == SalaryPolicyVersion.Status.PUBLISHED:
            raise ValidationError("Cannot delete rates of a published policy version.")
        return super().delete(*args, **kwargs)


class TeacherPolicyAssignment(models.Model):
    """Assigns an effective-dated salary policy to a teacher within a department."""

    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="teacher_salary_assignments",
    )
    teacher = models.ForeignKey(
        "academy.TeacherProfile",
        on_delete=models.PROTECT,
        related_name="salary_policy_assignments",
    )
    policy = models.ForeignKey(
        SalaryPolicy,
        on_delete=models.PROTECT,
        related_name="teacher_assignments",
    )
    effective_from = models.DateField(db_index=True)
    effective_to = models.DateField(null=True, blank=True, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    assigned_at = models.DateTimeField(auto_now_add=True)
    basic_salary_override = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Teacher-specific authorized basic monthly salary agreement in PKR.",
    )
    basic_salary_eligibility = models.CharField(
        max_length=30,
        choices=[
            ("always_eligible", "Always Eligible"),
            ("active_assignment", "Active Assignment During Month"),
            ("conditional_availability", "Conditional on Availability"),
        ],
        default="active_assignment",
        help_text="Rule governing basic salary disbursement eligibility for this teacher.",
    )
    notes = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=models.F("effective_from")),
                name="check_valid_assignment_dates",
            ),
            models.CheckConstraint(
                check=models.Q(basic_salary_override__isnull=True) | models.Q(basic_salary_override__gte=Decimal("0.00")),
                name="check_positive_basic_salary_override",
            ),
        ]
        ordering = ["department", "teacher", "-effective_from"]
        verbose_name = "Teacher Policy Assignment"
        verbose_name_plural = "Teacher Policy Assignments"

    def __str__(self):
        teacher_name = getattr(self.teacher, "historical_name", None) or str(self.teacher)
        return f"{teacher_name} -> {self.policy.name} ({self.department.name})"

    def clean(self):
        super().clean()
        if self.effective_to and self.effective_from and self.effective_to < self.effective_from:
            raise ValidationError({"effective_to": "Effective end date cannot precede effective start date."})

        if self.basic_salary_override is not None and self.basic_salary_override < Decimal("0.00"):
            raise ValidationError({"basic_salary_override": "Basic salary override must be non-negative."})

        # Department consistency: Teacher must belong to the assignment department
        if self.teacher_id and self.department_id:
            if self.teacher.department_id and self.teacher.department_id != self.department_id:
                raise ValidationError({"teacher": "Teacher belongs to a different department than assignment department."})

        # Department consistency: Policy must belong to the assignment department
        if self.policy_id and self.department_id:
            if self.policy.department_id != self.department_id:
                raise ValidationError({"policy": "Salary policy belongs to a different department than assignment department."})

        # Prevent ambiguous overlapping active assignments for the same teacher and department
        if self.is_active and self.teacher_id and self.department_id and self.effective_from:
            qs = TeacherPolicyAssignment.objects.filter(
                teacher_id=self.teacher_id,
                department_id=self.department_id,
                is_active=True,
            )
            if self.pk:
                qs = qs.exclude(pk=self.pk)
            for other in qs:
                if date_intervals_overlap(self.effective_from, self.effective_to, other.effective_from, other.effective_to):
                    raise ValidationError(
                        f"Active assignment dates [{self.effective_from} to {self.effective_to or 'indefinite'}] "
                        f"overlap with existing active assignment [{other.effective_from} to {other.effective_to or 'indefinite'}] for this teacher."
                    )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)





class TeacherSalaryOverride(models.Model):
    """Effective-dated rate overrides implementing the 5-level precedence hierarchy."""

    class OverrideLevel(models.TextChoices):
        STUDENT_SPECIFIC = "student_specific", "Level 1: Student Specific"
        PLAN_SPECIFIC = "plan_specific", "Level 2: Teaching Plan Specific"
        TEACHER_WIDE = "teacher_wide", "Level 3: Teacher Wide"
        COORDINATOR_DAY = "coordinator_day", "Level 4: Coordinator Special Day"

    class WeekDay(models.TextChoices):
        MONDAY = "monday", "Monday"
        TUESDAY = "tuesday", "Tuesday"
        WEDNESDAY = "wednesday", "Wednesday"
        THURSDAY = "thursday", "Thursday"
        FRIDAY = "friday", "Friday"
        SATURDAY = "saturday", "Saturday"
        SUNDAY = "sunday", "Sunday"

    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="teacher_salary_overrides",
    )
    teacher = models.ForeignKey(
        "academy.TeacherProfile",
        on_delete=models.PROTECT,
        related_name="salary_overrides",
    )
    override_level = models.CharField(
        max_length=30,
        choices=OverrideLevel.choices,
        db_index=True,
    )
    salary_policy = models.ForeignKey(
        SalaryPolicy,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="teacher_overrides",
        help_text="Optional policy context for this override.",
    )
    student = models.ForeignKey(
        "academy.StudentProfile",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="salary_overrides",
    )
    teaching_plan = models.ForeignKey(
        SalaryTeachingPlan,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="plan_overrides",
    )
    qualifying_weekday = models.CharField(
        max_length=12,
        null=True,
        blank=True,
        choices=WeekDay.choices,
    )
    rate_per_class = models.DecimalField(
        max_digits=12,
        decimal_places=2,
    )
    effective_from = models.DateField(db_index=True)
    effective_to = models.DateField(null=True, blank=True, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)
    reason = models.TextField(help_text="Mandatory business reason for this override.")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=models.Q(rate_per_class__gte=Decimal("0.00")),
                name="check_positive_override_rate",
            ),
            models.CheckConstraint(
                check=models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=models.F("effective_from")),
                name="check_valid_override_dates",
            ),
        ]
        ordering = ["department", "teacher", "-effective_from"]
        verbose_name = "Teacher Salary Override"
        verbose_name_plural = "Teacher Salary Overrides"

    def __str__(self):
        teacher_name = getattr(self.teacher, "historical_name", None) or str(self.teacher)
        return f"{teacher_name} [{self.get_override_level_display()}]: Rs. {self.rate_per_class}"

    def clean(self):
        super().clean()

        if not self.reason or not self.reason.strip():
            raise ValidationError({"reason": "A mandatory reason is required for any salary rate override."})

        if self.rate_per_class is not None and self.rate_per_class < Decimal("0.00"):
            raise ValidationError({"rate_per_class": "Rate per class must be non-negative."})

        if self.effective_to and self.effective_from and self.effective_to < self.effective_from:
            raise ValidationError({"effective_to": "Effective end date cannot precede effective start date."})

        # Override Level prerequisites
        if self.override_level == self.OverrideLevel.STUDENT_SPECIFIC:
            if not self.student_id:
                raise ValidationError({"student": "Student is required for student-specific overrides."})
        elif self.override_level == self.OverrideLevel.PLAN_SPECIFIC:
            if not self.teaching_plan_id:
                raise ValidationError({"teaching_plan": "Teaching plan is required for teaching-plan-specific overrides."})
        elif self.override_level == self.OverrideLevel.COORDINATOR_DAY:
            if not self.qualifying_weekday:
                raise ValidationError({"qualifying_weekday": "Qualifying weekday is required for coordinator special day overrides."})

        # Department consistency checks
        if self.teacher_id and self.department_id:
            if self.teacher.department_id and self.teacher.department_id != self.department_id:
                raise ValidationError({"teacher": "Teacher belongs to a different department than override department."})

        if self.student_id and self.department_id:
            if self.student.department_id and self.student.department_id != self.department_id:
                raise ValidationError({"student": "Student belongs to a different department than override department."})

        if self.salary_policy_id and self.department_id:
            if self.salary_policy.department_id != self.department_id:
                raise ValidationError({"salary_policy": "Salary policy belongs to a different department than override department."})

        if self.teaching_plan_id and self.department_id:
            if self.teaching_plan.policy_version.policy.department_id != self.department_id:
                raise ValidationError({"teaching_plan": "Teaching plan's policy belongs to a different department than override department."})

        # Prevent ambiguous overlapping active overrides of equal precedence for the same teacher
        if self.is_active and self.teacher_id and self.department_id and self.effective_from:
            qs = TeacherSalaryOverride.objects.filter(
                teacher_id=self.teacher_id,
                department_id=self.department_id,
                override_level=self.override_level,
                is_active=True,
            )
            if self.pk:
                qs = qs.exclude(pk=self.pk)

            if self.override_level == self.OverrideLevel.STUDENT_SPECIFIC:
                qs = qs.filter(student_id=self.student_id)
            elif self.override_level == self.OverrideLevel.PLAN_SPECIFIC:
                qs = qs.filter(teaching_plan_id=self.teaching_plan_id)
            elif self.override_level == self.OverrideLevel.COORDINATOR_DAY:
                qs = qs.filter(qualifying_weekday=self.qualifying_weekday)

            for other in qs:
                if date_intervals_overlap(self.effective_from, self.effective_to, other.effective_from, other.effective_to):
                    raise ValidationError(
                        f"Active override dates [{self.effective_from} to {self.effective_to or 'indefinite'}] "
                        f"overlap with existing active override [{other.effective_from} to {other.effective_to or 'indefinite'}] of equal precedence and scope."
                    )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)





class SalaryAttendanceVerification(models.Model):
    """Department-scoped attendance evidence and reconciliation record for a scheduled class occurrence.

    Stage 4: Bridges raw Quran/Tuition attendance and scheduling sources to deterministic,
    audited evidence for future salary calculation.
    """

    class VerificationStatus(models.TextChoices):
        PENDING = "pending", "Pending Verification"
        VERIFIED = "verified", "Verified"
        RESOLVED = "resolved", "Resolved by Admin"
        CONFLICTED = "conflicted", "Conflicted Evidence"

    class ResolutionType(models.TextChoices):
        CLASS_TAUGHT = "class_taught", "Verified Class Taught"
        STUDENT_ABSENT_TEACHER_AVAILABLE = "student_absent_teacher_available", "Verified Student Absent, Teacher Available"
        INFORMED_STUDENT_LEAVE = "informed_student_leave", "Verified Informed Student Leave, Teacher Available"
        TEACHER_ABSENT = "teacher_absent", "Verified Teacher Absent"
        SUBSTITUTE_CLASS = "substitute_class", "Verified Substitute Class"
        OFFICIAL_CANCELLATION = "official_cancellation", "Verified Official Cancellation"
        NOT_APPLICABLE_SUPERSEDED = "not_applicable_superseded", "Confirmed Not Applicable or Superseded Schedule"

    class DepartmentType(models.TextChoices):
        QURAN = "quran", "Quran Department"
        TUITION = "tuition", "Tuition Department"

    institution = models.ForeignKey(
        "accounts.Institution",
        on_delete=models.CASCADE,
        related_name="salary_attendance_verifications",
    )
    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="salary_attendance_verifications",
    )
    source_department_type = models.CharField(
        max_length=20,
        choices=DepartmentType.choices,
        default=DepartmentType.QURAN,
    )
    teacher = models.ForeignKey(
        "academy.TeacherProfile",
        on_delete=models.PROTECT,
        related_name="salary_attendance_verifications",
    )
    student = models.ForeignKey(
        "academy.StudentProfile",
        on_delete=models.PROTECT,
        related_name="salary_attendance_verifications",
    )
    occurrence_key = models.CharField(
        max_length=128,
        db_index=True,
        help_text="Deterministic unique occurrence identity (e.g. quran:sched_12:2026-11-03).",
    )
    class_date = models.DateField(db_index=True)
    scheduled_time = models.TimeField(null=True, blank=True)
    source_schedule_id = models.PositiveIntegerField(null=True, blank=True)
    source_attendance_id = models.PositiveIntegerField(null=True, blank=True)
    original_teacher_attendance_status = models.CharField(max_length=30, blank=True, default="missing")
    original_student_attendance_status = models.CharField(max_length=30, blank=True, default="missing")
    substitute_teacher = models.ForeignKey(
        "academy.TeacherProfile",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )
    is_cancelled = models.BooleanField(default=False)
    cancellation_reason = models.TextField(blank=True)
    verification_status = models.CharField(
        max_length=30,
        choices=VerificationStatus.choices,
        default=VerificationStatus.PENDING,
        db_index=True,
    )
    resolution_type = models.CharField(
        max_length=50,
        choices=ResolutionType.choices,
        blank=True,
    )
    teacher_available_determination = models.BooleanField(null=True, blank=True)
    student_attendance_determination = models.CharField(max_length=30, blank=True)
    flag_reason = models.TextField(blank=True, help_text="Reason for pending or conflicted status.")
    resolution_reason = models.TextField(blank=True, help_text="Mandatory reason provided by administrator when resolved.")
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    source_evidence_snapshot = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["department", "occurrence_key"],
                name="unique_salary_attendance_occurrence",
            )
        ]
        indexes = [
            models.Index(fields=["department", "class_date"], name="sal_verif_dept_date"),
            models.Index(fields=["department", "verification_status"], name="sal_verif_dept_status"),
            models.Index(fields=["teacher", "class_date"], name="sal_verif_teach_date"),
            models.Index(fields=["student", "class_date"], name="sal_verif_stud_date"),
        ]
        ordering = ["-class_date", "scheduled_time", "id"]
        verbose_name = "Salary Attendance Verification"
        verbose_name_plural = "Salary Attendance Verifications"

    def __str__(self):
        return f"{self.occurrence_key} ({self.get_verification_status_display()})"

    def clean(self):
        super().clean()
        if self.department_id and self.institution_id:
            if self.department.institution_id != self.institution_id:
                raise ValidationError({"department": "Department does not belong to specified Institution."})
        if self.verification_status == self.VerificationStatus.RESOLVED:
            if not self.resolution_type:
                raise ValidationError({"resolution_type": "Resolution type is required when resolving attendance."})
            if not self.resolution_reason or not self.resolution_reason.strip():
                raise ValidationError({"resolution_reason": "A mandatory resolution reason is required."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)





class SalaryAttendanceAudit(models.Model):
    """Append-only audit trail for attendance verification resolutions and transitions.

    Preserves full decision history, actor identity, reasons, and evidence snapshots.
    """

    verification = models.ForeignKey(
        SalaryAttendanceVerification,
        on_delete=models.CASCADE,
        related_name="audit_logs",
    )
    previous_status = models.CharField(max_length=30)
    new_status = models.CharField(max_length=30)
    previous_resolution = models.CharField(max_length=50, blank=True)
    new_resolution = models.CharField(max_length=50, blank=True)
    action = models.CharField(max_length=40)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    reason = models.TextField()
    source_evidence_snapshot = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "Salary Attendance Audit"
        verbose_name_plural = "Salary Attendance Audits"

    def __str__(self):
        return f"Audit {self.verification_id}: {self.previous_status} -> {self.new_status} by {self.actor}"


class SalaryReconciliationBatch(models.Model):
    """Tracks execution and completeness of attendance reconciliation scans per department and payroll period.

    Required by the Approval Blocker to confirm that a scan has completely run before allowing payroll approval.
    """

    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="salary_reconciliation_batches",
    )
    institution = models.ForeignKey(
        "accounts.Institution",
        on_delete=models.CASCADE,
        related_name="salary_reconciliation_batches",
    )
    period_year = models.PositiveSmallIntegerField()
    period_month = models.PositiveSmallIntegerField()
    start_date = models.DateField()
    end_date = models.DateField()
    is_complete = models.BooleanField(default=True)
    total_occurrences = models.PositiveIntegerField(default=0)
    verified_count = models.PositiveIntegerField(default=0)
    pending_count = models.PositiveIntegerField(default=0)
    resolved_count = models.PositiveIntegerField(default=0)
    conflicted_count = models.PositiveIntegerField(default=0)
    scanned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    scanned_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["department", "period_year", "period_month"],
                name="unique_dept_period_reconciliation_batch",
            )
        ]
        ordering = ["-period_year", "-period_month", "department"]
        verbose_name = "Salary Reconciliation Batch"
        verbose_name_plural = "Salary Reconciliation Batches"

    def __str__(self):
        return f"{self.department.name} - {self.period_year}-{self.period_month:02d} ({'Complete' if self.is_complete else 'Incomplete'})"


class SalaryAdjustmentCategory(models.Model):
    """Configurable and extensible adjustment category for bonuses, cuttings, and corrections.

    Scoped optionally to a department, or institution/system-wide when department is null.
    """

    class Direction(models.TextChoices):
        CREDIT = "credit", "Credit / Bonus / Positive"
        DEBIT = "debit", "Debit / Cutting / Negative"

    institution = models.ForeignKey(
        "accounts.Institution",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="salary_adjustment_categories",
    )
    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="salary_adjustment_categories",
    )
    code = models.CharField(max_length=60, db_index=True)
    name = models.CharField(max_length=120)
    direction = models.CharField(max_length=10, choices=Direction.choices)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    is_system_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["department", "code"],
                name="unique_dept_adj_category_code",
            )
        ]
        ordering = ["direction", "name"]
        verbose_name = "Salary Adjustment Category"
        verbose_name_plural = "Salary Adjustment Categories"

    def __str__(self):
        dept = self.department.name if self.department else "System"
        return f"{self.name} ({self.code}) - {dept} [{self.get_direction_display()}]"

    def clean(self):
        super().clean()
        if not self.code or not self.code.strip():
            raise ValidationError({"code": "Category code cannot be empty."})
        if not self.name or not self.name.strip():
            raise ValidationError({"name": "Category name cannot be empty."})
        if self.department_id and self.institution_id:
            if self.department.institution_id != self.institution_id:
                raise ValidationError({"department": "Department does not belong to specified Institution."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)





class SalaryBulkAdjustmentBatch(models.Model):
    """Tracks a department-wide or selected-teacher bulk bonus or cutting operation.

    Enforces idempotency, preview/confirm safeguards, and full audit metadata.
    """

    class OperationType(models.TextChoices):
        BONUS = "bonus", "Bonus (Positive Adjustment)"
        CUTTING = "cutting", "Cutting (Negative Adjustment)"

    class SelectionMode(models.TextChoices):
        ALL = "all", "All Eligible Teachers in Department"
        SELECTED = "selected", "Selected Teachers Only"

    class CalculationMode(models.TextChoices):
        FIXED = "fixed", "Fixed Amount"
        PERCENTAGE = "percentage", "Percentage Based"

    class PercentageBasis(models.TextChoices):
        GROSS_EARNINGS = "gross_earnings", "Gross Earnings"
        BASIC_SALARY = "basic_salary", "Basic Salary"
        REGULAR_CLASS_EARNINGS = "regular_class_earnings", "Regular Class Earnings"

    class Status(models.TextChoices):
        PREVIEW = "preview", "Preview Only"
        CONFIRMED = "confirmed", "Confirmed"
        CANCELLED = "cancelled", "Cancelled"

    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="salary_bulk_batches",
    )
    institution = models.ForeignKey(
        "accounts.Institution",
        on_delete=models.CASCADE,
        related_name="salary_bulk_batches",
    )
    period_year = models.PositiveSmallIntegerField(db_index=True)
    period_month = models.PositiveSmallIntegerField(db_index=True)
    operation_type = models.CharField(max_length=10, choices=OperationType.choices)
    selection_mode = models.CharField(max_length=20, choices=SelectionMode.choices)
    category = models.CharField(max_length=60, db_index=True)
    calculation_mode = models.CharField(
        max_length=20,
        choices=CalculationMode.choices,
        default=CalculationMode.FIXED,
    )
    percentage_basis = models.CharField(
        max_length=40,
        choices=PercentageBasis.choices,
        blank=True,
    )
    percentage_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Percentage rate applied (e.g. 5.00 for 5%).",
    )
    fixed_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Fixed PKR amount applied per teacher.",
    )
    proposed_total = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    affected_teacher_count = models.PositiveIntegerField(default=0)
    reason = models.TextField(help_text="Mandatory business reason for bulk adjustment.")
    reference_note = models.CharField(max_length=255, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PREVIEW,
    )
    idempotency_key = models.CharField(max_length=64, unique=True, db_index=True)
    teacher_selection_snapshot = models.JSONField(
        default=list,
        blank=True,
        help_text="Snapshot of teacher IDs and calculations at confirmation time.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    audit_metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-period_year", "-period_month", "-created_at"]
        verbose_name = "Salary Bulk Adjustment Batch"
        verbose_name_plural = "Salary Bulk Adjustment Batches"

    def __str__(self):
        return (
            f"Batch #{self.id or 'new'} - {self.get_operation_type_display()} "
            f"({self.department.name} {self.period_year}-{self.period_month:02d}) [{self.get_status_display()}]"
        )

    def clean(self):
        super().clean()
        if not self.reason or not self.reason.strip():
            raise ValidationError({"reason": "A mandatory business reason is required for bulk operations."})
        if self.department_id and self.institution_id:
            if self.department.institution_id != self.institution_id:
                raise ValidationError({"department": "Department does not belong to specified Institution."})
        if self.calculation_mode == self.CalculationMode.FIXED:
            if self.fixed_amount is None or self.fixed_amount < Decimal("0.00"):
                raise ValidationError({"fixed_amount": "Fixed amount must be non-negative for fixed calculation."})
        elif self.calculation_mode == self.CalculationMode.PERCENTAGE:
            if self.percentage_rate is None or self.percentage_rate <= Decimal("0.00"):
                raise ValidationError({"percentage_rate": "Positive percentage rate is required for percentage calculation."})
            if not self.percentage_basis:
                raise ValidationError({"percentage_basis": "Percentage calculation basis must be specified."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)





class RecurringSalaryAdjustment(models.Model):
    """Instruction for recurring monthly positive additions or cutting deductions.

    Generates at most one draft PayrollAdjustment per applicable period.
    Cancelling a recurrence does NOT erase historical generated entries.
    """

    class Direction(models.TextChoices):
        CREDIT = "credit", "Credit / Positive"
        DEBIT = "debit", "Debit / Negative"

    class CalculationMode(models.TextChoices):
        FIXED = "fixed", "Fixed Amount"
        PERCENTAGE = "percentage", "Percentage Based"

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        CANCELLED = "cancelled", "Cancelled"

    institution = models.ForeignKey(
        "accounts.Institution",
        on_delete=models.CASCADE,
        related_name="recurring_salary_adjustments",
    )
    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="recurring_salary_adjustments",
    )
    teacher = models.ForeignKey(
        "academy.TeacherProfile",
        on_delete=models.CASCADE,
        related_name="recurring_salary_adjustments",
    )
    direction = models.CharField(max_length=10, choices=Direction.choices)
    category = models.CharField(max_length=60, db_index=True)
    calculation_mode = models.CharField(
        max_length=20,
        choices=CalculationMode.choices,
        default=CalculationMode.FIXED,
    )
    percentage_basis = models.CharField(max_length=40, blank=True)
    percentage_rate = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Fixed amount or estimated base amount.",
    )
    start_year = models.PositiveSmallIntegerField()
    start_month = models.PositiveSmallIntegerField()
    end_year = models.PositiveSmallIntegerField(null=True, blank=True)
    end_month = models.PositiveSmallIntegerField(null=True, blank=True)
    reason = models.TextField()
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True)
    audit_metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-start_year", "-start_month", "teacher"]
        verbose_name = "Recurring Salary Adjustment"
        verbose_name_plural = "Recurring Salary Adjustments"

    def __str__(self):
        return (
            f"Recurring {self.get_direction_display()} ({self.category}) - "
            f"Teacher #{self.teacher_id}: Rs. {self.amount} [{self.get_status_display()}]"
        )

    def clean(self):
        super().clean()
        if not self.reason or not self.reason.strip():
            raise ValidationError({"reason": "A mandatory reason is required for recurring adjustments."})
        if self.teacher_id and self.department_id:
            if self.teacher.department_id != self.department_id:
                raise ValidationError({"teacher": "Teacher does not belong to specified Department."})
        if self.department_id and self.institution_id:
            if self.department.institution_id != self.institution_id:
                raise ValidationError({"department": "Department does not belong to specified Institution."})
        if self.amount < Decimal("0.00"):
            raise ValidationError({"amount": "Amount must be non-negative."})
        if self.end_year and self.end_month:
            if (self.end_year, self.end_month) < (self.start_year, self.start_month):
                raise ValidationError({"end_month": "End period cannot be earlier than start period."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)




    def is_applicable_for_period(self, year: int, month: int) -> bool:
        """Check whether this recurring instruction applies to the given year/month."""
        if self.status != self.Status.ACTIVE:
            return False
        if (year, month) < (self.start_year, self.start_month):
            return False
        if self.end_year and self.end_month:
            if (year, month) > (self.end_year, self.end_month):
                return False
        return True


class SalaryAdvanceRecovery(models.Model):
    """Tracks authorized teacher salary advances and scheduled monthly recovery installments.

    Guarantees recovery never exceeds the outstanding balance and preserves historical recovery tracking.
    """

    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        COMPLETED = "completed", "Fully Recovered"
        CANCELLED = "cancelled", "Cancelled"

    institution = models.ForeignKey(
        "accounts.Institution",
        on_delete=models.CASCADE,
        related_name="salary_advance_recoveries",
    )
    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="salary_advance_recoveries",
    )
    teacher = models.ForeignKey(
        "academy.TeacherProfile",
        on_delete=models.CASCADE,
        related_name="salary_advance_recoveries",
    )
    advance_date = models.DateField()
    original_amount = models.DecimalField(max_digits=10, decimal_places=2)
    monthly_installment = models.DecimalField(max_digits=10, decimal_places=2)
    recovered_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
    )
    reason = models.TextField(help_text="Mandatory note on advance authorization.")
    reference_no = models.CharField(max_length=60, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.ACTIVE,
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    audit_metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-advance_date", "teacher"]
        verbose_name = "Salary Advance Recovery"
        verbose_name_plural = "Salary Advance Recoveries"

    def __str__(self):
        return (
            f"Advance #{self.id or 'new'} - Teacher #{self.teacher_id}: "
            f"Original Rs. {self.original_amount}, Remaining Rs. {self.remaining_balance} [{self.get_status_display()}]"
        )

    @property
    def remaining_balance(self) -> Decimal:
        rem = self.original_amount - self.recovered_amount
        return max(Decimal("0.00"), rem)

    def clean(self):
        super().clean()
        if not self.reason or not self.reason.strip():
            raise ValidationError({"reason": "A mandatory reason/reference is required for advance records."})
        if self.original_amount <= Decimal("0.00"):
            raise ValidationError({"original_amount": "Original advance amount must be positive."})
        if self.monthly_installment <= Decimal("0.00"):
            raise ValidationError({"monthly_installment": "Monthly installment must be positive."})
        if self.recovered_amount < Decimal("0.00"):
            raise ValidationError({"recovered_amount": "Recovered amount cannot be negative."})
        if self.recovered_amount > self.original_amount:
            raise ValidationError({"recovered_amount": "Recovered amount cannot exceed original advance amount."})
        if self.teacher_id and self.department_id:
            if self.teacher.department_id != self.department_id:
                raise ValidationError({"teacher": "Teacher does not belong to specified Department."})
        if self.department_id and self.institution_id:
            if self.department.institution_id != self.institution_id:
                raise ValidationError({"department": "Department does not belong to specified Institution."})

    def save(self, *args, **kwargs):
        if self.remaining_balance <= Decimal("0.00") and self.status == self.Status.ACTIVE:
            self.status = self.Status.COMPLETED
        self.full_clean()
        super().save(*args, **kwargs)


class PayrollAdjustment(models.Model):
    """Stores individual draft, confirmed, or cancelled positive/negative salary adjustments.

    Linked to an individual teacher and payroll period.
    """

    class Direction(models.TextChoices):
        CREDIT = "credit", "Credit / Bonus / Addition"
        DEBIT = "debit", "Debit / Cutting / Deduction"

    class CalculationMode(models.TextChoices):
        FIXED = "fixed", "Fixed Amount"
        PERCENTAGE = "percentage", "Percentage Based"

    class PercentageBasis(models.TextChoices):
        GROSS_EARNINGS = "gross_earnings", "Gross Earnings"
        BASIC_SALARY = "basic_salary", "Basic Salary"
        REGULAR_CLASS_EARNINGS = "regular_class_earnings", "Regular Class Earnings"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        CONFIRMED = "confirmed", "Confirmed"
        CANCELLED = "cancelled", "Cancelled"

    institution = models.ForeignKey(
        "accounts.Institution",
        on_delete=models.CASCADE,
        related_name="payroll_adjustments",
    )
    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="payroll_adjustments",
    )
    teacher = models.ForeignKey(
        "academy.TeacherProfile",
        on_delete=models.CASCADE,
        related_name="payroll_adjustments",
    )
    period_year = models.PositiveSmallIntegerField(db_index=True)
    period_month = models.PositiveSmallIntegerField(db_index=True)
    category = models.CharField(max_length=60, db_index=True)
    direction = models.CharField(max_length=10, choices=Direction.choices, db_index=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    calculation_mode = models.CharField(
        max_length=20,
        choices=CalculationMode.choices,
        default=CalculationMode.FIXED,
    )
    percentage_basis = models.CharField(
        max_length=40,
        choices=PercentageBasis.choices,
        blank=True,
    )
    percentage_rate = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    reason = models.TextField(help_text="Mandatory business reason for adjustment.")
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    batch = models.ForeignKey(
        SalaryBulkAdjustmentBatch,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="adjustments",
    )
    recurring_instruction = models.ForeignKey(
        RecurringSalaryAdjustment,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="generated_adjustments",
    )
    advance_recovery = models.ForeignKey(
        SalaryAdvanceRecovery,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="recovery_adjustments",
    )
    reference_note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    cancelled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True)
    audit_metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["batch", "teacher"],
                condition=models.Q(batch__isnull=False),
                name="unique_batch_teacher_adjustment",
            ),
            models.UniqueConstraint(
                fields=["recurring_instruction", "period_year", "period_month"],
                condition=models.Q(recurring_instruction__isnull=False),
                name="unique_recurring_period_adjustment",
            ),
        ]
        indexes = [
            models.Index(fields=["department", "period_year", "period_month", "status"], name="sal_adj_dept_period_stat"),
            models.Index(fields=["teacher", "period_year", "period_month", "status"], name="sal_adj_teach_period_stat"),
        ]
        ordering = ["-period_year", "-period_month", "-created_at"]
        verbose_name = "Payroll Adjustment"
        verbose_name_plural = "Payroll Adjustments"

    def __str__(self):
        return (
            f"Adj #{self.id or 'new'} - {self.get_direction_display()} ({self.category}): "
            f"Teacher #{self.teacher_id} Rs. {self.amount} for {self.period_year}-{self.period_month:02d} [{self.get_status_display()}]"
        )

    def clean(self):
        super().clean()
        if not self.reason or not self.reason.strip():
            raise ValidationError({"reason": "A mandatory reason is required for salary adjustments."})
        if self.amount < Decimal("0.00"):
            raise ValidationError({"amount": "Adjustment amount cannot be negative."})
        if self.teacher_id and self.department_id:
            if self.teacher.department_id != self.department_id:
                raise ValidationError({"teacher": "Teacher does not belong to specified Department."})
        if self.department_id and self.institution_id:
            if self.department.institution_id != self.institution_id:
                raise ValidationError({"department": "Department does not belong to specified Institution."})
        if self.calculation_mode == self.CalculationMode.PERCENTAGE:
            if self.percentage_rate is None or self.percentage_rate <= Decimal("0.00"):
                raise ValidationError({"percentage_rate": "Positive percentage rate is required for percentage calculation."})
            if not self.percentage_basis:
                raise ValidationError({"percentage_basis": "Percentage calculation basis must be specified."})
        if self.advance_recovery_id and self.status != self.Status.CANCELLED:
            if self.amount > self.advance_recovery.remaining_balance:
                raise ValidationError({
                    "amount": f"Amount (Rs. {self.amount}) exceeds remaining advance balance of Rs. {self.advance_recovery.remaining_balance}."
                })
        if self.department_id and self.period_year and self.period_month:
            submitted_period = SalaryPayrollPeriod.objects.filter(
                department_id=self.department_id,
                payroll_year=self.period_year,
                payroll_month=self.period_month,
                status__in=[
                    SalaryPayrollPeriod.Status.PENDING_APPROVAL,
                    SalaryPayrollPeriod.Status.APPROVED,
                    SalaryPayrollPeriod.Status.PAID,
                ],
            ).first()
            if submitted_period:
                raise ValidationError(
                    f"Cannot create or modify adjustments for {self.period_year}-{self.period_month:02d} "
                    f"because payroll has been submitted for review. Request return for correction first."
                )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)





class PayrollAdjustmentAudit(models.Model):
    """Append-only audit trail for payroll adjustments (creations, edits, cancellations)."""

    adjustment = models.ForeignKey(
        PayrollAdjustment,
        on_delete=models.CASCADE,
        related_name="audit_logs",
    )
    action = models.CharField(max_length=40)
    previous_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    new_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    previous_status = models.CharField(max_length=20, blank=True)
    new_status = models.CharField(max_length=20, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    reason = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "Payroll Adjustment Audit"
        verbose_name_plural = "Payroll Adjustment Audits"

    def __str__(self):
        return f"Audit {self.adjustment_id}: {self.action} by {self.actor} at {self.created_at}"


# ============================================================================
# STAGE 7A: MONTHLY PAYROLL RECORDS, SNAPSHOTS AND DEPARTMENT SUBMISSION
# ============================================================================

class SalaryPayrollPeriod(models.Model):
    """Monthly department payroll period managing draft, review, and submission states."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        DEPARTMENT_REVIEW = "department_review", "Department Review"
        PENDING_APPROVAL = "pending_approval", "Pending Approval"
        RETURNED_FOR_CORRECTION = "returned_for_correction", "Returned for Correction"
        APPROVED = "approved", "Approved"  # Stage 7B
        PAID = "paid", "Paid"  # Stage 7B

    institution = models.ForeignKey(
        "accounts.Institution",
        on_delete=models.CASCADE,
        related_name="unified_payroll_periods",
    )
    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="unified_payroll_periods",
    )
    payroll_year = models.PositiveIntegerField(db_index=True)
    payroll_month = models.PositiveSmallIntegerField(db_index=True)
    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    current_revision = models.PositiveIntegerField(default=1)
    total_teachers = models.PositiveIntegerField(default=0)

    # Monetary Totals (PKR Decimal with 2 decimal places)
    gross_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    positive_adjustments_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    cuttings_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    net_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    # Completeness and readiness tracking
    is_calculation_complete = models.BooleanField(default=True)
    attendance_readiness_complete = models.BooleanField(default=True)
    incompleteness_reasons = models.JSONField(default=list, blank=True)

    # Department Submission metadata
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    submitted_at = models.DateTimeField(null=True, blank=True)
    submission_notes = models.TextField(blank=True)
    submission_metadata = models.JSONField(default=dict, blank=True)
    source_fingerprint = models.CharField(max_length=64, blank=True)

    # Stage 7B Final Approval metadata
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    approval_notes = models.TextField(blank=True)

    # Audit & timestamps
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["department", "payroll_year", "payroll_month"],
                name="unique_department_payroll_period",
            ),
            models.CheckConstraint(
                check=models.Q(payroll_month__gte=1, payroll_month__lte=12),
                name="check_valid_payroll_month_range",
            ),
        ]
        indexes = [
            models.Index(fields=["department", "payroll_year", "payroll_month", "status"], name="sal_period_dept_stat"),
        ]
        ordering = ["-payroll_year", "-payroll_month"]
        verbose_name = "Salary Payroll Period"
        verbose_name_plural = "Salary Payroll Periods"

    def __str__(self):
        return f"{self.department.name} Payroll {self.payroll_year}-{self.payroll_month:02d} [{self.get_status_display()}] (Rev {self.current_revision})"

    def clean(self):
        super().clean()
        if self.payroll_month < 1 or self.payroll_month > 12:
            raise ValidationError({"payroll_month": "Payroll month must be between 1 and 12."})
        if self.department_id and self.institution_id:
            if self.department.institution_id != self.institution_id:
                raise ValidationError({"department": "Department does not belong to specified Institution."})

        # Stage 7B: Approved and Paid Payroll Immutability Guard
        if self.pk:
            prev = SalaryPayrollPeriod.objects.filter(pk=self.pk).values(
                "status", "gross_total", "net_total", "positive_adjustments_total", "cuttings_total",
                "department_id", "payroll_year", "payroll_month"
            ).first()
            if prev:
                prev_status = prev["status"]
                if prev_status == self.Status.PAID and self.status != self.Status.PAID:
                    raise ValidationError("Paid payroll is strictly immutable and cannot change status.")
                if prev_status == self.Status.APPROVED and self.status not in [self.Status.APPROVED, self.Status.PAID]:
                    raise ValidationError(f"Approved payroll cannot be moved back to '{self.get_status_display()}'.")
                if prev_status in [self.Status.APPROVED, self.Status.PAID]:
                    if (
                        prev["gross_total"] != self.gross_total
                        or prev["net_total"] != self.net_total
                        or prev["positive_adjustments_total"] != self.positive_adjustments_total
                        or prev["cuttings_total"] != self.cuttings_total
                        or prev["department_id"] != self.department_id
                        or prev["payroll_year"] != self.payroll_year
                        or prev["payroll_month"] != self.payroll_month
                    ):
                        raise ValidationError("Financial totals and period parameters of approved/paid payroll are immutable.")

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)





class TeacherPayroll(models.Model):
    """Itemized monthly payroll record for an individual teacher within a payroll period."""

    payroll_period = models.ForeignKey(
        SalaryPayrollPeriod,
        on_delete=models.CASCADE,
        related_name="teacher_payrolls",
    )
    teacher = models.ForeignKey(
        "academy.TeacherProfile",
        on_delete=models.CASCADE,
        related_name="unified_payrolls",
    )
    applied_policy = models.ForeignKey(
        SalaryPolicy,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    applied_policy_version = models.ForeignKey(
        SalaryPolicyVersion,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    # Component Earnings & Deductions
    basic_salary = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    regular_class_earnings = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    lesson_bonuses = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    substitute_earnings = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    cancellation_earnings = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    positive_adjustments = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    cuttings = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    gross_salary = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    net_salary = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))

    # Completeness & Verification
    is_calculation_complete = models.BooleanField(default=True)
    completeness_notes = models.JSONField(default=list, blank=True)
    revision = models.PositiveIntegerField(default=1)

    # Stage 7B: Payment recording fields
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    payment_status = models.CharField(
        max_length=20,
        default="unpaid",
        choices=[
            ("unpaid", "Unpaid"),
            ("partially_paid", "Partially Paid"),
            ("paid", "Fully Paid"),
        ],
        db_index=True,
    )
    paid_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["payroll_period", "teacher"],
                name="unique_payroll_period_teacher",
            ),
        ]
        indexes = [
            models.Index(fields=["payroll_period", "teacher"], name="sal_tp_period_teach"),
        ]
        ordering = ["payroll_period", "teacher"]
        verbose_name = "Teacher Payroll"
        verbose_name_plural = "Teacher Payrolls"

    def __str__(self):
        return f"Teacher #{self.teacher_id} - {self.payroll_period} : Net Rs. {self.net_salary}"

    def clean(self):
        super().clean()
        if self.payroll_period_id and self.teacher_id:
            if self.teacher.department_id != self.payroll_period.department_id:
                raise ValidationError({"teacher": "Teacher does not belong to the payroll period's department."})

        # Stage 7B: Approved/Paid Teacher Payroll Immutability Guard
        if self.pk and self.payroll_period_id:
            period = self.payroll_period
            if period.status in [SalaryPayrollPeriod.Status.APPROVED, SalaryPayrollPeriod.Status.PAID]:
                prev = TeacherPayroll.objects.filter(pk=self.pk).values(
                    "basic_salary", "regular_class_earnings", "lesson_bonuses", "substitute_earnings",
                    "cancellation_earnings", "positive_adjustments", "cuttings", "gross_salary", "net_salary", "teacher_id"
                ).first()
                if prev:
                    if (
                        prev["basic_salary"] != self.basic_salary
                        or prev["regular_class_earnings"] != self.regular_class_earnings
                        or prev["lesson_bonuses"] != self.lesson_bonuses
                        or prev["substitute_earnings"] != self.substitute_earnings
                        or prev["cancellation_earnings"] != self.cancellation_earnings
                        or prev["positive_adjustments"] != self.positive_adjustments
                        or prev["cuttings"] != self.cuttings
                        or prev["gross_salary"] != self.gross_salary
                        or prev["net_salary"] != self.net_salary
                        or prev["teacher_id"] != self.teacher_id
                    ):
                        raise ValidationError("Financial details and teacher attribution of an approved teacher payroll are strictly immutable.")

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)





class PayrollEarningLine(models.Model):
    """Itemized supporting evidence and rate application for an individual earning or compensation line."""

    class EarningType(models.TextChoices):
        REGULAR_CLASS = "regular_class", "Regular Class"
        BASIC_SALARY = "basic_salary", "Basic Salary"
        LESSON_PLAN_BONUS = "lesson_plan_bonus", "Lesson Plan Bonus"
        SUBSTITUTE = "substitute", "Substitute Teaching"
        CANCELLATION = "cancellation", "Official Cancellation"

    teacher_payroll = models.ForeignKey(
        TeacherPayroll,
        on_delete=models.CASCADE,
        related_name="earning_lines",
    )
    earning_type = models.CharField(
        max_length=40,
        choices=EarningType.choices,
        default=EarningType.REGULAR_CLASS,
    )
    student = models.ForeignKey(
        "academy.StudentProfile",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    student_name = models.CharField(max_length=120, blank=True)
    class_occurrence_id = models.CharField(max_length=120, blank=True, db_index=True)
    rate = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    quantity = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("1.00"))
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    effective_date = models.DateField(null=True, blank=True)
    policy_version = models.ForeignKey(
        SalaryPolicyVersion,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    applied_override_type = models.CharField(max_length=50, blank=True)
    attendance_evidence = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["teacher_payroll", "earning_type"], name="sal_earn_line_type"),
            models.Index(fields=["class_occurrence_id"], name="sal_earn_line_occ"),
        ]
        ordering = ["effective_date", "id"]
        verbose_name = "Payroll Earning Line"
        verbose_name_plural = "Payroll Earning Lines"

    def __str__(self):
        return f"{self.get_earning_type_display()}: Rs. {self.amount} ({self.effective_date})"


class PayrollCalculationSnapshot(models.Model):
    """Reproducible snapshot of evidence, rates, policy versions, and decisions for auditability."""

    class SnapshotType(models.TextChoices):
        DRAFT = "draft", "Draft Generation"
        RECALCULATION = "recalculation", "Recalculation Revision"
        SUBMISSION = "submission", "Department Submission"
        APPROVAL = "approval", "Final Approval"

    payroll_period = models.ForeignKey(
        SalaryPayrollPeriod,
        on_delete=models.CASCADE,
        related_name="calculation_snapshots",
    )
    teacher_payroll = models.ForeignKey(
        TeacherPayroll,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="calculation_snapshots",
    )
    revision = models.PositiveIntegerField(default=1)
    snapshot_type = models.CharField(
        max_length=30,
        choices=SnapshotType.choices,
        default=SnapshotType.DRAFT,
    )
    snapshot_data = models.JSONField(help_text="Complete reproducible calculation payload and evidence.")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    source_fingerprint = models.CharField(max_length=64, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["payroll_period", "revision", "snapshot_type"], name="sal_snap_period_rev"),
        ]
        ordering = ["-revision", "-created_at"]
        verbose_name = "Payroll Calculation Snapshot"
        verbose_name_plural = "Payroll Calculation Snapshots"

    def __str__(self):
        return f"Snapshot {self.get_snapshot_type_display()} Rev {self.revision} - Period #{self.payroll_period_id}"


class PayrollLifecycleAudit(models.Model):
    """Immutable audit log of all payroll lifecycle transitions, revisions, and monetary changes."""

    class Action(models.TextChoices):
        DRAFT_CREATED = "draft_created", "Draft Created"
        RECALCULATED = "recalculated", "Draft Recalculated"
        SUBMITTED = "submitted", "Submitted for Review"
        CORRECTION_REQUESTED = "correction_requested", "Return for Correction Requested"
        RETURNED = "returned", "Returned for Correction"
        CORRECTION_APPROVED = "correction_approved", "Correction Request Approved"
        CORRECTION_REJECTED = "correction_rejected", "Correction Request Rejected"
        APPROVED = "approved", "Approved"
        PAYMENT_RECORDED = "payment_recorded", "Payment Recorded"
        PAID = "paid", "Fully Paid"

    payroll_period = models.ForeignKey(
        SalaryPayrollPeriod,
        on_delete=models.CASCADE,
        related_name="lifecycle_audits",
    )
    action = models.CharField(max_length=40, choices=Action.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    performed_at = models.DateTimeField(auto_now_add=True)
    previous_status = models.CharField(max_length=40, blank=True)
    new_status = models.CharField(max_length=40, blank=True)
    revision = models.PositiveIntegerField(default=1)
    gross_total_before = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    gross_total_after = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    net_total_before = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    net_total_after = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    reason = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-performed_at", "-id"]
        verbose_name = "Payroll Lifecycle Audit"
        verbose_name_plural = "Payroll Lifecycle Audits"

    def __str__(self):
        return f"Payroll #{self.payroll_period_id} Rev {self.revision}: {self.action} by {self.actor} at {self.performed_at}"


class PayrollCorrectionRequest(models.Model):
    """Department Admin request to return a submitted payroll for correction."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending Review"
        APPROVED = "approved", "Approved"  # Stage 7B authority
        REJECTED = "rejected", "Rejected"  # Stage 7B authority

    payroll_period = models.ForeignKey(
        SalaryPayrollPeriod,
        on_delete=models.CASCADE,
        related_name="correction_requests",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
    )
    requested_at = models.DateTimeField(auto_now_add=True)
    reason = models.TextField(help_text="Mandatory justification for requesting return of submitted payroll.")
    correction_scope = models.TextField(help_text="Description of what needs correction (e.g., attendance update, missing bonus).")
    submission_revision = models.PositiveIntegerField()
    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-requested_at"]
        verbose_name = "Payroll Correction Request"
        verbose_name_plural = "Payroll Correction Requests"

    def __str__(self):
        return f"Correction Request #{self.id} for {self.payroll_period} [{self.get_status_display()}]"

    def clean(self):
        super().clean()
        if not self.reason or not self.reason.strip():
            raise ValidationError({"reason": "A mandatory reason is required to request return for correction."})
        if not self.correction_scope or not self.correction_scope.strip():
            raise ValidationError({"correction_scope": "Requested correction scope must be specified."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


# ============================================================================
# STAGE 7B: IMMUTABLE PAYROLL LEDGER, PAYMENT RECORDING & CUTOVER REGISTRY
# ============================================================================

class PayrollLedgerEntry(models.Model):
    """
    Immutable, itemized financial ledger for verified payroll earnings, adjustments,
    and payment settlements.

    Append-only: prevents modification or deletion once posted.
    Guarantees exact mathematical reconciliation with approved TeacherPayroll.
    """

    class EventType(models.TextChoices):
        EARNING_BASIC = "earning_basic", "Basic Salary"
        EARNING_REGULAR_CLASS = "earning_regular_class", "Regular Class Earnings"
        EARNING_LESSON_BONUS = "earning_lesson_bonus", "Lesson Plan Bonus"
        EARNING_SUBSTITUTE = "earning_substitute", "Substitute Teaching Compensation"
        EARNING_CANCELLATION = "earning_cancellation", "Official Cancellation Earnings"
        ADJUSTMENT_ADDITION = "adjustment_addition", "Positive Adjustment / Bonus"
        ADJUSTMENT_CUTTING = "adjustment_cutting", "Salary Cutting / Deduction"
        PAYMENT_SETTLEMENT = "payment_settlement", "Payment Settlement Record"

    class Classification(models.TextChoices):
        CREDIT = "credit", "Credit / Earning / Addition"
        DEBIT = "debit", "Debit / Deduction / Settlement"

    institution = models.ForeignKey(
        "accounts.Institution",
        on_delete=models.CASCADE,
        related_name="payroll_ledger_entries",
    )
    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="payroll_ledger_entries",
    )
    payroll_period = models.ForeignKey(
        SalaryPayrollPeriod,
        on_delete=models.CASCADE,
        related_name="ledger_entries",
    )
    teacher_payroll = models.ForeignKey(
        TeacherPayroll,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="ledger_entries",
    )
    teacher = models.ForeignKey(
        "academy.TeacherProfile",
        on_delete=models.PROTECT,
        related_name="salary_ledger_entries",
    )
    event_type = models.CharField(
        max_length=50,
        choices=EventType.choices,
        db_index=True,
    )
    classification = models.CharField(
        max_length=20,
        choices=Classification.choices,
        db_index=True,
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    supporting_earning_line = models.ForeignKey(
        PayrollEarningLine,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )
    supporting_adjustment = models.ForeignKey(
        PayrollAdjustment,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )
    supporting_reference = models.CharField(max_length=255, blank=True)
    revision = models.PositiveIntegerField(default=1)
    approval_reference = models.CharField(max_length=120, blank=True)
    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="+",
    )
    posted_at = models.DateTimeField(auto_now_add=True)
    idempotency_key = models.CharField(max_length=160, unique=True, db_index=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["payroll_period", "event_type"], name="sal_ledger_period_event"),
            models.Index(fields=["teacher_payroll", "classification"], name="sal_ledger_tp_class"),
            models.Index(fields=["teacher", "posted_at"], name="sal_ledger_teach_posted"),
        ]
        ordering = ["posted_at", "id"]
        verbose_name = "Payroll Ledger Entry"
        verbose_name_plural = "Payroll Ledger Entries"

    def __str__(self):
        return f"Ledger #{self.id or 'new'} [{self.get_event_type_display()}]: Rs. {self.amount} ({self.get_classification_display()}) for Teacher #{self.teacher_id}"

    def clean(self):
        super().clean()
        if self.amount < Decimal("0.00"):
            raise ValidationError({"amount": "Ledger entry amount must be non-negative."})
        if self.pk:
            raise ValidationError("Payroll ledger entries are strictly immutable and cannot be updated once posted.")

    def delete(self, *args, **kwargs):
        raise ValidationError("Payroll ledger entries are strictly immutable and cannot be deleted.")

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class TeacherPayrollPayment(models.Model):
    """
    Records an externally completed financial disbursement against an approved TeacherPayroll.

    Does NOT initiate bank transfers or move money. Records payment evidence, references,
    and supports partial external disbursements.
    """

    class PaymentMethod(models.TextChoices):
        BANK_TRANSFER = "bank_transfer", "Bank Transfer"
        CASH = "cash", "Cash Payment"
        CHEQUE = "cheque", "Cheque"
        OTHER = "other", "Authorized Alternative"

    institution = models.ForeignKey(
        "accounts.Institution",
        on_delete=models.CASCADE,
        related_name="salary_payments",
    )
    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="salary_payments",
    )
    payroll_period = models.ForeignKey(
        SalaryPayrollPeriod,
        on_delete=models.CASCADE,
        related_name="payment_records",
    )
    teacher_payroll = models.ForeignKey(
        TeacherPayroll,
        on_delete=models.CASCADE,
        related_name="payment_records",
    )
    teacher = models.ForeignKey(
        "academy.TeacherProfile",
        on_delete=models.PROTECT,
        related_name="salary_payment_records",
    )
    payment_method = models.CharField(
        max_length=30,
        choices=PaymentMethod.choices,
        default=PaymentMethod.BANK_TRANSFER,
    )
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2)
    payment_date = models.DateField()
    reference_number = models.CharField(max_length=120)
    proof_document = models.FileField(upload_to="salary_payments/%Y/%m/", null=True, blank=True)
    proof_notes = models.TextField(blank=True)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
    )
    recorded_at = models.DateTimeField(auto_now_add=True)
    idempotency_key = models.CharField(max_length=160, unique=True, db_index=True)
    notes = models.TextField(blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["payroll_period", "payment_date"], name="sal_pay_period_date"),
            models.Index(fields=["teacher_payroll", "payment_date"], name="sal_pay_tp_date"),
            models.Index(fields=["reference_number"], name="sal_pay_ref"),
        ]
        ordering = ["-payment_date", "-recorded_at"]
        verbose_name = "Teacher Payroll Payment"
        verbose_name_plural = "Teacher Payroll Payments"

    def __str__(self):
        return f"Payment #{self.id or 'new'}: Rs. {self.amount_paid} [{self.get_payment_method_display()}] ref {self.reference_number} for Teacher #{self.teacher_id}"

    def clean(self):
        super().clean()
        if self.amount_paid <= Decimal("0.00"):
            raise ValidationError({"amount_paid": "Payment amount must be greater than zero."})
        if not self.reference_number or not self.reference_number.strip():
            raise ValidationError({"reference_number": "A payment reference number is required."})
        if self.teacher_payroll_id:
            tp = self.teacher_payroll
            if tp.payroll_period.status not in [SalaryPayrollPeriod.Status.APPROVED, SalaryPayrollPeriod.Status.PAID]:
                raise ValidationError("Payments can only be recorded against approved payroll.")
            if self.teacher_id != tp.teacher_id:
                raise ValidationError({"teacher": "Teacher must match teacher on the specified TeacherPayroll."})
            if self.payroll_period_id != tp.payroll_period_id:
                raise ValidationError({"payroll_period": "Payroll period must match specified TeacherPayroll."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class SalaryEngineCutoverRegistry(models.Model):
    """
    Explicit activation guard controlling whether the Unified Salary engine is authorized
    to perform final approval and payment recording for a specific department and period.

    Prevents cross-engine duplicate payments across legacy V1/V2 and Unified engines.
    Disabled by default in production.
    """

    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="salary_cutover_registries",
    )
    period_year = models.PositiveIntegerField(db_index=True)
    period_month = models.PositiveSmallIntegerField(db_index=True)
    is_unified_engine_active = models.BooleanField(default=False)
    authorized_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    authorized_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["department", "period_year", "period_month"],
                name="unique_dept_period_cutover_registry",
            ),
        ]
        indexes = [
            models.Index(fields=["department", "period_year", "period_month"], name="sal_cutover_dept_period"),
        ]
        verbose_name = "Salary Engine Cutover Registry"
        verbose_name_plural = "Salary Engine Cutover Registries"

    def __str__(self):
        active_str = "ACTIVE (Cutover)" if self.is_unified_engine_active else "INACTIVE (Legacy Authoritative)"
        return f"{self.department.name} {self.period_year}-{self.period_month:02d} [{active_str}]"

    @property
    def institution(self):
        return getattr(self.department, "institution", None)

    @property
    def applicable_salary_engine(self) -> str:
        return "unified" if self.is_unified_engine_active else "legacy"
