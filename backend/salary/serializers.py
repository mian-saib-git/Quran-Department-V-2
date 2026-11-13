"""Serializers for Unified Salary Management Policy Builder and Assignments API."""
from datetime import date
from decimal import Decimal
from rest_framework import serializers

from academy.models import StudentProfile, TeacherProfile
from salary.models import (
    date_intervals_overlap,
    get_policy_published_coverage_intervals,
    resolve_teacher_policy_coverage,
    SalaryPlanTierRate,
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    TeacherPolicyAssignment,
    TeacherSalaryOverride,
    SalaryAttendanceVerification,
    SalaryAttendanceAudit,
    SalaryReconciliationBatch,
    SalaryAdjustmentCategory,
    SalaryBulkAdjustmentBatch,
    RecurringSalaryAdjustment,
    SalaryAdvanceRecovery,
    PayrollAdjustment,
    PayrollAdjustmentAudit,
    SalaryPayrollPeriod,
    TeacherPayroll,
    PayrollEarningLine,
    PayrollCalculationSnapshot,
    PayrollLifecycleAudit,
    PayrollCorrectionRequest,
    PayrollLedgerEntry,
    TeacherPayrollPayment,
    SalaryEngineCutoverRegistry,
)


class SalaryRateTierSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalaryRateTier
        fields = [
            "id",
            "policy_version",
            "tier_name",
            "min_students",
            "max_students",
            "sort_order",
        ]
        read_only_fields = ["id", "policy_version"]

    def validate(self, attrs):
        min_students = attrs.get("min_students")
        max_students = attrs.get("max_students")
        if min_students is not None and min_students < 1:
            raise serializers.ValidationError({"min_students": "Minimum student count must be at least 1."})
        if min_students is not None and max_students is not None and max_students < min_students:
            raise serializers.ValidationError({"max_students": "Maximum student count cannot be less than minimum."})
        return attrs


class SalaryTeachingPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalaryTeachingPlan
        fields = [
            "id",
            "policy_version",
            "plan_code",
            "plan_name",
            "days_per_week",
            "is_coordinator_special",
            "sort_order",
        ]
        read_only_fields = ["id", "policy_version"]

    def validate_plan_code(self, value):
        val = str(value or "").strip().lower().replace(" ", "_")
        if not val:
            raise serializers.ValidationError("Plan code cannot be blank.")
        return val


class SalaryPlanTierRateSerializer(serializers.ModelSerializer):
    teaching_plan_code = serializers.CharField(source="teaching_plan.plan_code", read_only=True)
    teaching_plan_name = serializers.CharField(source="teaching_plan.plan_name", read_only=True)
    rate_tier_name = serializers.CharField(source="rate_tier.tier_name", read_only=True)

    class Meta:
        model = SalaryPlanTierRate
        fields = [
            "id",
            "policy_version",
            "teaching_plan",
            "teaching_plan_code",
            "teaching_plan_name",
            "rate_tier",
            "rate_tier_name",
            "rate_per_class",
        ]
        read_only_fields = ["id", "policy_version"]

    def validate_rate_per_class(self, value):
        if value is None or value < Decimal("0.00"):
            raise serializers.ValidationError("Rate per class must be non-negative.")
        return value


class SalaryPolicyVersionSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    week_start_day_display = serializers.CharField(source="get_week_start_day_display", read_only=True)
    published_by_name = serializers.SerializerMethodField()
    tiers_count = serializers.SerializerMethodField()
    plans_count = serializers.SerializerMethodField()
    rates_count = serializers.SerializerMethodField()

    class Meta:
        model = SalaryPolicyVersion
        fields = [
            "id",
            "policy",
            "version_number",
            "status",
            "status_display",
            "effective_from",
            "effective_to",
            "week_start_day",
            "week_start_day_display",
            "min_qualifying_weeks",
            "lesson_plan_bonus_per_class",
            "substitute_rate_per_class",
            "cancellation_rate_per_class",
            "cancellation_payment_rule",
            "basic_salary_amount",
            "basic_salary_partial_month_proration",
            "coordinator_qualifying_weekdays",
            "requires_completed_lesson_for_bonus",
            "notes",
            "published_at",
            "published_by",
            "published_by_name",
            "tiers_count",
            "plans_count",
            "rates_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "policy",
            "version_number",
            "status",
            "published_at",
            "published_by",
            "created_at",
            "updated_at",
        ]

    def get_published_by_name(self, obj):
        if not obj.published_by:
            return None
        return obj.published_by.get_full_name() or obj.published_by.username

    def get_tiers_count(self, obj):
        return obj.rate_tiers.count()

    def get_plans_count(self, obj):
        return obj.teaching_plans.count()

    def get_rates_count(self, obj):
        return obj.plan_tier_rates.count()

    def validate(self, attrs):
        eff_from = attrs.get("effective_from") or (self.instance.effective_from if self.instance else None)
        eff_to = attrs.get("effective_to") or (self.instance.effective_to if self.instance else None)
        if eff_from and eff_to and eff_to < eff_from:
            raise serializers.ValidationError({"effective_to": "Effective end date cannot precede start date."})
        return attrs


class SalaryPolicyVersionDetailSerializer(SalaryPolicyVersionSerializer):
    rate_tiers = SalaryRateTierSerializer(many=True, read_only=True)
    teaching_plans = SalaryTeachingPlanSerializer(many=True, read_only=True)
    plan_tier_rates = SalaryPlanTierRateSerializer(many=True, read_only=True)

    class Meta(SalaryPolicyVersionSerializer.Meta):
        fields = SalaryPolicyVersionSerializer.Meta.fields + [
            "rate_tiers",
            "teaching_plans",
            "plan_tier_rates",
        ]


class SalaryPolicySerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True)
    institution_name = serializers.CharField(source="institution.name", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    versions_count = serializers.SerializerMethodField()
    published_versions_count = serializers.SerializerMethodField()
    active_version = serializers.SerializerMethodField()
    published_effective_from = serializers.SerializerMethodField()
    published_effective_to = serializers.SerializerMethodField()
    published_versions = serializers.SerializerMethodField()

    class Meta:
        model = SalaryPolicy
        fields = [
            "id",
            "institution",
            "institution_name",
            "department",
            "department_name",
            "code",
            "name",
            "description",
            "policy_type",
            "compensation_model",
            "is_active",
            "versions_count",
            "published_versions_count",
            "active_version",
            "published_effective_from",
            "published_effective_to",
            "published_versions",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "institution",
            "department",
            "created_by",
            "created_at",
            "updated_at",
        ]

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return None
        return obj.created_by.get_full_name() or obj.created_by.username

    def get_versions_count(self, obj):
        return obj.versions.count()

    def get_published_versions_count(self, obj):
        return obj.versions.filter(status=SalaryPolicyVersion.Status.PUBLISHED).count()

    def get_active_version(self, obj):
        # Latest published version
        published = (
            obj.versions.filter(status=SalaryPolicyVersion.Status.PUBLISHED)
            .order_by("-effective_from", "-version_number")
            .first()
        )
        if published:
            return {
                "id": published.id,
                "version_number": published.version_number,
                "effective_from": published.effective_from,
                "effective_to": published.effective_to,
                "week_start_day": published.week_start_day,
            }
        return None

    def get_published_effective_from(self, obj):
        val = getattr(obj, "published_effective_from", None)
        return val.isoformat() if val else None

    def get_published_effective_to(self, obj):
        val = getattr(obj, "published_effective_to", None)
        return val.isoformat() if val else None

    def get_published_versions(self, obj):
        versions = (
            obj.versions.filter(status=SalaryPolicyVersion.Status.PUBLISHED)
            .order_by("effective_from", "version_number")
        )
        return [
            {
                "id": v.id,
                "version_number": v.version_number,
                "effective_from": v.effective_from.isoformat(),
                "effective_to": v.effective_to.isoformat() if v.effective_to else None,
            }
            for v in versions
        ]

    def validate_code(self, value):
        val = str(value or "").strip().upper().replace(" ", "_")
        if not val:
            raise serializers.ValidationError("Policy code cannot be blank.")
        return val


class RateMatrixCellInputSerializer(serializers.Serializer):
    teaching_plan_id = serializers.IntegerField()
    rate_tier_id = serializers.IntegerField()
    rate_per_class = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.00"))


class BatchRateMatrixUpdateSerializer(serializers.Serializer):
    rates = RateMatrixCellInputSerializer(many=True)


# =============================================================================
# STAGE 3: TEACHER POLICY ASSIGNMENTS & OVERRIDES SERIALIZERS
# =============================================================================

class TeacherPolicyAssignmentSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True)
    teacher_name = serializers.SerializerMethodField()
    policy_code = serializers.CharField(source="policy.code", read_only=True)
    policy_name = serializers.CharField(source="policy.name", read_only=True)
    assigned_by_name = serializers.SerializerMethodField()
    effective_from = serializers.DateField(required=False, allow_null=True)
    effective_to = serializers.DateField(required=False, allow_null=True)

    class Meta:
        model = TeacherPolicyAssignment
        fields = [
            "id",
            "department",
            "department_name",
            "teacher",
            "teacher_name",
            "policy",
            "policy_code",
            "policy_name",
            "effective_from",
            "effective_to",
            "is_active",
            "basic_salary_override",
            "basic_salary_eligibility",
            "notes",
            "assigned_by",
            "assigned_by_name",
            "assigned_at",
        ]
        read_only_fields = [
            "id",
            "department_name",
            "teacher_name",
            "policy_code",
            "policy_name",
            "assigned_by",
            "assigned_by_name",
            "assigned_at",
        ]

    def get_teacher_name(self, obj):
        if not obj.teacher:
            return None
        return getattr(obj.teacher, "historical_name", None) or (obj.teacher.user.get_full_name() if obj.teacher.user else f"Teacher #{obj.teacher_id}")

    def get_assigned_by_name(self, obj):
        if not obj.assigned_by:
            return None
        return obj.assigned_by.get_full_name() or obj.assigned_by.username

    def validate(self, attrs):
        policy = attrs.get("policy") or (self.instance.policy if self.instance else None)
        teacher = attrs.get("teacher") or (self.instance.teacher if self.instance else None)
        department = attrs.get("department") or (self.instance.department if self.instance else None)

        if policy:
            if not policy.is_active:
                raise serializers.ValidationError({"policy": "Cannot assign an inactive salary policy."})
            has_published = policy.versions.filter(status=SalaryPolicyVersion.Status.PUBLISHED).exists()
            if not has_published:
                raise serializers.ValidationError({"policy": "Cannot assign a salary policy that has no published versions."})

        if policy and department and policy.department_id != department.id:
            raise serializers.ValidationError({"policy": "Salary policy belongs to a different department than the assignment department."})

        if teacher and department and teacher.department_id and teacher.department_id != department.id:
            raise serializers.ValidationError({"teacher": "Teacher belongs to a different department than the assignment department."})

        # Automatic effective date resolution from published policy and teacher constraints
        eff_from = attrs.get("effective_from")
        eff_to = attrs.get("effective_to")

        if not eff_from and not self.instance and policy:
            try:
                resolved_dates = resolve_teacher_policy_coverage(policy, teacher)
                eff_from = resolved_dates["effective_from"]
                eff_to = resolved_dates["effective_to"]
                attrs["effective_from"] = eff_from
                attrs["effective_to"] = eff_to
            except ValidationError as e:
                raise serializers.ValidationError(e.message_dict if hasattr(e, "message_dict") else str(e))
        else:
            eff_from = eff_from or (self.instance.effective_from if self.instance else None)
            eff_to = eff_to if "effective_to" in attrs else (self.instance.effective_to if self.instance else None)

        if eff_from and eff_to and eff_to < eff_from:
            raise serializers.ValidationError({"effective_to": "Effective end date cannot precede effective start date."})

        # Enforce teacher joining date boundary: do not silently pay teacher for periods before eligibility began
        if eff_from and teacher and getattr(teacher, "joining_date", None):
            if eff_from < teacher.joining_date:
                raise serializers.ValidationError(
                    {"effective_from": f"Assignment effective date ({eff_from}) cannot precede teacher's joining date ({teacher.joining_date})."}
                )

        # Policy published coverage boundary validation when explicit dates provided
        if eff_from and policy and policy.versions.filter(status=SalaryPolicyVersion.Status.PUBLISHED).exists():
            intervals = get_policy_published_coverage_intervals(policy)
            if intervals:
                earliest_pub = intervals[0][0]
                latest_pub = intervals[-1][1] if intervals[-1][1] is not None and all(i[1] is not None for i in intervals) else None
                if eff_from < earliest_pub:
                    raise serializers.ValidationError(
                        {"effective_from": f"Assignment effective date ({eff_from}) cannot precede policy's earliest published date ({earliest_pub})."}
                    )
                if latest_pub is not None and eff_from > latest_pub:
                    raise serializers.ValidationError(
                        {"effective_from": f"Assignment effective date ({eff_from}) is after policy's published coverage ended ({latest_pub})."}
                    )
                # Check for published policy version gap
                is_in_gap = not any(b_start <= eff_from and (b_end is None or eff_from <= b_end) for b_start, b_end in intervals)
                if is_in_gap:
                    raise serializers.ValidationError(
                        {"effective_from": f"Assignment effective date ({eff_from}) falls within a gap between published policy versions."}
                    )

        override_amt = attrs.get("basic_salary_override") if "basic_salary_override" in attrs else (self.instance.basic_salary_override if self.instance else None)
        if override_amt is not None and override_amt < Decimal("0.00"):
            raise serializers.ValidationError({"basic_salary_override": "Basic salary override must be non-negative."})

        # Overlapping assignment check for active assignments
        is_active = attrs.get("is_active", self.instance.is_active if self.instance else True)
        if is_active and teacher and department and eff_from:
            qs = TeacherPolicyAssignment.objects.filter(
                teacher=teacher,
                department=department,
                is_active=True,
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            for other in qs:
                if date_intervals_overlap(eff_from, eff_to, other.effective_from, other.effective_to):
                    raise serializers.ValidationError(
                        f"Active assignment dates [{eff_from} to {eff_to or 'indefinite'}] "
                        f"overlap with existing active assignment [{other.effective_from} to {other.effective_to or 'indefinite'}] for this teacher."
                    )

        return attrs


class TeacherSalaryOverrideSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True)
    teacher_name = serializers.SerializerMethodField()
    override_level_display = serializers.CharField(source="get_override_level_display", read_only=True)
    salary_policy_name = serializers.CharField(source="salary_policy.name", read_only=True)
    student_name = serializers.SerializerMethodField()
    teaching_plan_name = serializers.CharField(source="teaching_plan.plan_name", read_only=True)
    teaching_plan_code = serializers.CharField(source="teaching_plan.plan_code", read_only=True)
    qualifying_weekday_display = serializers.CharField(source="get_qualifying_weekday_display", read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = TeacherSalaryOverride
        fields = [
            "id",
            "department",
            "department_name",
            "teacher",
            "teacher_name",
            "override_level",
            "override_level_display",
            "salary_policy",
            "salary_policy_name",
            "student",
            "student_name",
            "teaching_plan",
            "teaching_plan_name",
            "teaching_plan_code",
            "qualifying_weekday",
            "qualifying_weekday_display",
            "rate_per_class",
            "effective_from",
            "effective_to",
            "is_active",
            "reason",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "department_name",
            "teacher_name",
            "override_level_display",
            "salary_policy_name",
            "student_name",
            "teaching_plan_name",
            "teaching_plan_code",
            "qualifying_weekday_display",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
        ]

    def get_teacher_name(self, obj):
        if not obj.teacher:
            return None
        return getattr(obj.teacher, "historical_name", None) or (obj.teacher.user.get_full_name() if obj.teacher.user else f"Teacher #{obj.teacher_id}")

    def get_student_name(self, obj):
        if not obj.student:
            return None
        return obj.student.user.get_full_name() if obj.student.user else f"Student #{obj.student_id}"

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return None
        return obj.created_by.get_full_name() or obj.created_by.username

    def validate(self, attrs):
        reason = attrs.get("reason", self.instance.reason if self.instance else "")
        if not reason or not reason.strip():
            raise serializers.ValidationError({"reason": "A mandatory business reason is required for any salary rate override."})

        rate = attrs.get("rate_per_class", self.instance.rate_per_class if self.instance else None)
        if rate is not None and rate < Decimal("0.00"):
            raise serializers.ValidationError({"rate_per_class": "Rate per class must be non-negative."})

        eff_from = attrs.get("effective_from") or (self.instance.effective_from if self.instance else None)
        eff_to = attrs.get("effective_to") if "effective_to" in attrs else (self.instance.effective_to if self.instance else None)
        if eff_from and eff_to and eff_to < eff_from:
            raise serializers.ValidationError({"effective_to": "Effective end date cannot precede effective start date."})

        level = attrs.get("override_level", self.instance.override_level if self.instance else None)
        student = attrs.get("student", self.instance.student if self.instance else None)
        teaching_plan = attrs.get("teaching_plan", self.instance.teaching_plan if self.instance else None)
        weekday = attrs.get("qualifying_weekday", self.instance.qualifying_weekday if self.instance else None)
        department = attrs.get("department", self.instance.department if self.instance else None)
        teacher = attrs.get("teacher", self.instance.teacher if self.instance else None)
        policy = attrs.get("salary_policy", self.instance.salary_policy if self.instance else None)

        if level == TeacherSalaryOverride.OverrideLevel.STUDENT_SPECIFIC and not student:
            raise serializers.ValidationError({"student": "Student is required for student-specific overrides."})
        elif level == TeacherSalaryOverride.OverrideLevel.PLAN_SPECIFIC and not teaching_plan:
            raise serializers.ValidationError({"teaching_plan": "Teaching plan is required for teaching-plan-specific overrides."})
        elif level == TeacherSalaryOverride.OverrideLevel.COORDINATOR_DAY and not weekday:
            raise serializers.ValidationError({"qualifying_weekday": "Qualifying weekday is required for coordinator special day overrides."})

        # Department scoping checks
        if department:
            if teacher and teacher.department_id and teacher.department_id != department.id:
                raise serializers.ValidationError({"teacher": "Teacher belongs to a different department than override department."})
            if student and student.department_id and student.department_id != department.id:
                raise serializers.ValidationError({"student": "Student belongs to a different department than override department."})
            if policy and policy.department_id != department.id:
                raise serializers.ValidationError({"salary_policy": "Salary policy belongs to a different department than override department."})
            if teaching_plan and teaching_plan.policy_version.policy.department_id != department.id:
                raise serializers.ValidationError({"teaching_plan": "Teaching plan belongs to a different department than override department."})

        # Overlapping equal-scope active override check
        is_active = attrs.get("is_active", self.instance.is_active if self.instance else True)
        if is_active and teacher and department and eff_from and level:
            qs = TeacherSalaryOverride.objects.filter(
                teacher=teacher,
                department=department,
                override_level=level,
                is_active=True,
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)

            if level == TeacherSalaryOverride.OverrideLevel.STUDENT_SPECIFIC:
                qs = qs.filter(student=student)
            elif level == TeacherSalaryOverride.OverrideLevel.PLAN_SPECIFIC:
                qs = qs.filter(teaching_plan=teaching_plan)
            elif level == TeacherSalaryOverride.OverrideLevel.COORDINATOR_DAY:
                qs = qs.filter(qualifying_weekday=weekday)

            for other in qs:
                if date_intervals_overlap(eff_from, eff_to, other.effective_from, other.effective_to):
                    raise serializers.ValidationError(
                        f"Active override dates [{eff_from} to {eff_to or 'indefinite'}] "
                        f"overlap with existing active override [{other.effective_from} to {other.effective_to or 'indefinite'}] of equal precedence and scope."
                    )

        return attrs


class DepartmentTeacherSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    user_id = serializers.IntegerField(allow_null=True)
    name = serializers.CharField()
    email = serializers.CharField(allow_blank=True)
    phone = serializers.CharField(allow_blank=True)
    department_id = serializers.IntegerField()
    joining_date = serializers.CharField(allow_null=True, required=False)
    salary_end_date = serializers.CharField(allow_null=True, required=False)
    current_policy = serializers.DictField(allow_null=True)
    active_overrides_count = serializers.IntegerField()
    available_plans = serializers.ListField()


class BulkTeacherPolicyAssignmentSerializer(serializers.Serializer):
    department = serializers.IntegerField(required=False)
    teacher_ids = serializers.ListField(
        child=serializers.IntegerField(),
        allow_empty=False,
        max_length=500,
        help_text="Bounded array of teacher IDs to assign policy to."
    )
    policy = serializers.IntegerField(help_text="ID of the published salary policy.")
    basic_salary_override = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        required=False,
        allow_null=True,
        min_value=Decimal("0.00"),
    )
    basic_salary_eligibility = serializers.ChoiceField(
        choices=[
            ("always_eligible", "Always Eligible"),
            ("active_assignment", "Active Assignment During Month"),
            ("conditional_availability", "Conditional on Availability"),
        ],
        default="active_assignment",
        required=False,
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    replace_existing = serializers.BooleanField(default=False, required=False)
    replace_teacher_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        default=list,
    )


class DepartmentStudentSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    email = serializers.CharField(allow_blank=True)
    phone = serializers.CharField(allow_blank=True)
    department_id = serializers.IntegerField()
    teacher_id = serializers.IntegerField(allow_null=True)


class RatePreviewRequestSerializer(serializers.Serializer):
    department_id = serializers.IntegerField()
    teacher_id = serializers.IntegerField()
    class_date = serializers.DateField(required=False, default=date.today)
    teaching_plan_id = serializers.IntegerField(required=False, allow_null=True)
    teaching_plan_code = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    student_id = serializers.IntegerField(required=False, allow_null=True)
    student_count = serializers.IntegerField(required=False, allow_null=True, min_value=0)


class SalaryAttendanceAuditSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = SalaryAttendanceAudit
        fields = [
            "id",
            "verification",
            "previous_status",
            "new_status",
            "previous_resolution",
            "new_resolution",
            "action",
            "actor",
            "actor_name",
            "reason",
            "source_evidence_snapshot",
            "created_at",
        ]
        read_only_fields = fields

    def get_actor_name(self, obj):
        if obj.actor:
            return getattr(obj.actor, "get_full_name", lambda: "")() or obj.actor.username
        return "System Reconciler"


class SalaryAttendanceVerificationSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True)
    teacher_name = serializers.SerializerMethodField()
    student_name = serializers.SerializerMethodField()
    substitute_teacher_name = serializers.SerializerMethodField()
    resolved_by_name = serializers.SerializerMethodField()
    verification_status_display = serializers.CharField(source="get_verification_status_display", read_only=True)
    resolution_type_display = serializers.CharField(source="get_resolution_type_display", read_only=True)
    audit_logs = SalaryAttendanceAuditSerializer(many=True, read_only=True)

    class Meta:
        model = SalaryAttendanceVerification
        fields = [
            "id",
            "institution",
            "department",
            "department_name",
            "source_department_type",
            "teacher",
            "teacher_name",
            "student",
            "student_name",
            "occurrence_key",
            "class_date",
            "scheduled_time",
            "source_schedule_id",
            "source_attendance_id",
            "original_teacher_attendance_status",
            "original_student_attendance_status",
            "substitute_teacher",
            "substitute_teacher_name",
            "is_cancelled",
            "cancellation_reason",
            "verification_status",
            "verification_status_display",
            "resolution_type",
            "resolution_type_display",
            "teacher_available_determination",
            "student_attendance_determination",
            "flag_reason",
            "resolution_reason",
            "resolved_by",
            "resolved_by_name",
            "resolved_at",
            "audit_logs",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_teacher_name(self, obj):
        return getattr(obj.teacher, "historical_name", None) or str(obj.teacher)

    def get_student_name(self, obj):
        return getattr(obj.student.user, "get_full_name", lambda: "")() or str(obj.student)

    def get_substitute_teacher_name(self, obj):
        if obj.substitute_teacher:
            return getattr(obj.substitute_teacher, "historical_name", None) or str(obj.substitute_teacher)
        return None

    def get_resolved_by_name(self, obj):
        if obj.resolved_by:
            return getattr(obj.resolved_by, "get_full_name", lambda: "")() or obj.resolved_by.username
        return None


class AttendanceResolutionRequestSerializer(serializers.Serializer):
    resolution_type = serializers.ChoiceField(choices=SalaryAttendanceVerification.ResolutionType.choices)
    reason = serializers.CharField(min_length=3, help_text="Mandatory business reason for resolving attendance.")
    teacher_available = serializers.BooleanField(required=False, allow_null=True)
    student_attendance = serializers.CharField(required=False, allow_blank=True)


class AttendanceBulkResolutionRequestSerializer(serializers.Serializer):
    department_id = serializers.IntegerField()
    year = serializers.IntegerField(required=False, min_value=2020, max_value=2099)
    month = serializers.IntegerField(required=False, min_value=1, max_value=12)
    verification_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
        max_length=500,
        help_text="Explicit bounded list of verification record IDs (max 500)."
    )
    resolution_type = serializers.ChoiceField(choices=SalaryAttendanceVerification.ResolutionType.choices)
    reason = serializers.CharField(min_length=3, help_text="Mandatory business reason for resolving attendance.")
    teacher_available = serializers.BooleanField(required=False, allow_null=True)
    student_attendance = serializers.CharField(required=False, allow_blank=True)


class AttendanceReconciliationPreviewRequestSerializer(serializers.Serializer):
    department_id = serializers.IntegerField()
    year = serializers.IntegerField(required=False, min_value=2020, max_value=2099)
    month = serializers.IntegerField(required=False, min_value=1, max_value=12)
    start_date = serializers.DateField(required=False)
    end_date = serializers.DateField(required=False)
    teacher_id = serializers.IntegerField(required=False, allow_null=True)
    student_id = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        start_date = attrs.get("start_date")
        end_date = attrs.get("end_date")
        year = attrs.get("year")
        month = attrs.get("month")

        if not (year and month) and not (start_date and end_date):
            raise serializers.ValidationError("Either (year, month) or (start_date, end_date) must be provided.")

        if start_date and end_date and start_date > end_date:
            raise serializers.ValidationError("start_date cannot be after end_date.")

        return attrs


class AttendanceReconcileRequestSerializer(serializers.Serializer):
    department_id = serializers.IntegerField()
    year = serializers.IntegerField(min_value=2020, max_value=2099)
    month = serializers.IntegerField(min_value=1, max_value=12)


class SalaryCalculationPreviewRequestSerializer(serializers.Serializer):
    department_id = serializers.IntegerField(required=False)
    year = serializers.IntegerField(min_value=2020, max_value=2099)
    month = serializers.IntegerField(min_value=1, max_value=12)
    teacher_id = serializers.IntegerField(required=False, allow_null=True)
    summary_only = serializers.BooleanField(required=False, default=False)
    force_refresh = serializers.BooleanField(required=False, default=False)


class SalaryAdjustmentCategorySerializer(serializers.ModelSerializer):
    department_id = serializers.IntegerField(source="department.id", allow_null=True, required=False)

    class Meta:
        model = SalaryAdjustmentCategory
        fields = [
            "id",
            "institution",
            "department",
            "department_id",
            "code",
            "name",
            "direction",
            "description",
            "is_active",
            "is_system_default",
            "created_at",
        ]
        read_only_fields = ["id", "is_system_default", "created_at"]

    def validate_code(self, value):
        val = str(value or "").strip().lower()
        if not val:
            raise serializers.ValidationError("Category code cannot be empty.")
        if not all(c.isalnum() or c == "_" for c in val):
            raise serializers.ValidationError("Category code must contain only letters, numbers, and underscores.")
        return val


class PayrollAdjustmentAuditSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = PayrollAdjustmentAudit
        fields = [
            "id",
            "action",
            "previous_amount",
            "new_amount",
            "previous_status",
            "new_status",
            "actor",
            "actor_name",
            "reason",
            "created_at",
        ]
        read_only_fields = fields

    def get_actor_name(self, obj):
        if obj.actor:
            return getattr(obj.actor, "get_full_name", lambda: "")() or obj.actor.username
        return "System"


class PayrollAdjustmentSerializer(serializers.ModelSerializer):
    teacher_id = serializers.IntegerField(read_only=True)
    department_id = serializers.IntegerField(read_only=True)
    institution_id = serializers.IntegerField(read_only=True)
    batch_id = serializers.IntegerField(read_only=True, allow_null=True)
    recurring_instruction_id = serializers.IntegerField(read_only=True, allow_null=True)
    advance_recovery_id = serializers.IntegerField(read_only=True, allow_null=True)
    teacher_name = serializers.SerializerMethodField()
    category_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    cancelled_by_name = serializers.SerializerMethodField()
    audit_logs = PayrollAdjustmentAuditSerializer(many=True, read_only=True)

    class Meta:
        model = PayrollAdjustment
        fields = [
            "id",
            "institution",
            "institution_id",
            "department",
            "department_id",
            "teacher",
            "teacher_id",
            "teacher_name",
            "period_year",
            "period_month",
            "category",
            "category_name",
            "direction",
            "amount",
            "calculation_mode",
            "percentage_basis",
            "percentage_rate",
            "reason",
            "status",
            "batch",
            "batch_id",
            "recurring_instruction",
            "recurring_instruction_id",
            "advance_recovery",
            "advance_recovery_id",
            "reference_note",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
            "cancelled_by",
            "cancelled_by_name",
            "cancelled_at",
            "cancellation_reason",
            "audit_logs",
        ]
        read_only_fields = [
            "id",
            "institution_id",
            "department_id",
            "teacher_id",
            "batch_id",
            "recurring_instruction_id",
            "advance_recovery_id",
            "status",
            "batch",
            "recurring_instruction",
            "created_by",
            "created_at",
            "updated_at",
            "cancelled_by",
            "cancelled_at",
            "cancellation_reason",
        ]

    def get_teacher_name(self, obj):
        if obj.teacher:
            return getattr(obj.teacher, "historical_name", None) or (
                obj.teacher.user.get_full_name() if obj.teacher.user else f"Teacher #{obj.teacher.id}"
            )
        return ""

    def get_category_name(self, obj):
        cat = SalaryAdjustmentCategory.objects.filter(code=obj.category).first()
        return cat.name if cat else obj.category.replace("_", " ").title()

    def get_created_by_name(self, obj):
        if obj.created_by:
            return getattr(obj.created_by, "get_full_name", lambda: "")() or obj.created_by.username
        return None

    def get_cancelled_by_name(self, obj):
        if obj.cancelled_by:
            return getattr(obj.cancelled_by, "get_full_name", lambda: "")() or obj.cancelled_by.username
        return None


class PayrollAdjustmentCreateSerializer(serializers.Serializer):
    department_id = serializers.IntegerField()
    teacher_id = serializers.IntegerField()
    period_year = serializers.IntegerField(min_value=2020, max_value=2099)
    period_month = serializers.IntegerField(min_value=1, max_value=12)
    category = serializers.CharField(max_length=60)
    direction = serializers.ChoiceField(choices=PayrollAdjustment.Direction.choices)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    calculation_mode = serializers.ChoiceField(
        choices=PayrollAdjustment.CalculationMode.choices,
        default=PayrollAdjustment.CalculationMode.FIXED,
    )
    percentage_basis = serializers.CharField(required=False, allow_blank=True)
    percentage_rate = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False, allow_null=True
    )
    reason = serializers.CharField(min_length=3, help_text="Mandatory business reason for adjustment.")
    reference_note = serializers.CharField(required=False, allow_blank=True)
    advance_recovery_id = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        mode = attrs.get("calculation_mode", "fixed")
        if mode == "percentage":
            if not attrs.get("percentage_rate") or attrs["percentage_rate"] <= Decimal("0.00"):
                raise serializers.ValidationError({"percentage_rate": "Positive percentage rate is required."})
            if not attrs.get("percentage_basis"):
                raise serializers.ValidationError({"percentage_basis": "Percentage calculation basis must be provided."})
        return attrs


class BulkAdjustmentPreviewRequestSerializer(serializers.Serializer):
    department_id = serializers.IntegerField()
    period_year = serializers.IntegerField(min_value=2020, max_value=2099)
    period_month = serializers.IntegerField(min_value=1, max_value=12)
    operation_type = serializers.ChoiceField(choices=SalaryBulkAdjustmentBatch.OperationType.choices)
    selection_mode = serializers.ChoiceField(
        choices=SalaryBulkAdjustmentBatch.SelectionMode.choices,
        default=SalaryBulkAdjustmentBatch.SelectionMode.ALL,
    )
    teacher_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, default=list
    )
    category = serializers.CharField(max_length=60)
    calculation_mode = serializers.ChoiceField(
        choices=SalaryBulkAdjustmentBatch.CalculationMode.choices,
        default=SalaryBulkAdjustmentBatch.CalculationMode.FIXED,
    )
    fixed_amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True
    )
    percentage_rate = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False, allow_null=True
    )
    percentage_basis = serializers.CharField(required=False, allow_blank=True)
    reason = serializers.CharField(min_length=3)
    reference_note = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        mode = attrs.get("calculation_mode", "fixed")
        if mode == "fixed":
            amt = attrs.get("fixed_amount")
            if amt is None or amt <= Decimal("0.00"):
                raise serializers.ValidationError({"fixed_amount": "Positive fixed amount is required for fixed calculation."})
        elif mode == "percentage":
            rate = attrs.get("percentage_rate")
            if rate is None or rate <= Decimal("0.00"):
                raise serializers.ValidationError({"percentage_rate": "Positive percentage rate is required."})
            if not attrs.get("percentage_basis"):
                raise serializers.ValidationError({"percentage_basis": "Percentage basis must be specified."})

        if attrs.get("selection_mode") == "selected" and not attrs.get("teacher_ids"):
            raise serializers.ValidationError({"teacher_ids": "teacher_ids must be provided when selection_mode is 'selected'."})

        return attrs


class BulkAdjustmentConfirmRequestSerializer(serializers.Serializer):
    idempotency_key = serializers.CharField(max_length=64)
    department_id = serializers.IntegerField()
    period_year = serializers.IntegerField(min_value=2020, max_value=2099)
    period_month = serializers.IntegerField(min_value=1, max_value=12)
    operation_type = serializers.ChoiceField(choices=SalaryBulkAdjustmentBatch.OperationType.choices)
    category = serializers.CharField(max_length=60)
    calculation_mode = serializers.ChoiceField(choices=SalaryBulkAdjustmentBatch.CalculationMode.choices)
    fixed_amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True
    )
    percentage_rate = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False, allow_null=True
    )
    percentage_basis = serializers.CharField(required=False, allow_blank=True)
    reason = serializers.CharField(min_length=3)
    reference_note = serializers.CharField(required=False, allow_blank=True)
    confirmed_teacher_ids = serializers.ListField(
        child=serializers.IntegerField(), min_length=1
    )


class SalaryBulkAdjustmentBatchSerializer(serializers.ModelSerializer):
    department_id = serializers.IntegerField(read_only=True)
    institution_id = serializers.IntegerField(read_only=True)
    created_by_name = serializers.SerializerMethodField()
    confirmed_by_name = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()

    class Meta:
        model = SalaryBulkAdjustmentBatch
        fields = [
            "id",
            "department",
            "department_id",
            "department_name",
            "institution",
            "institution_id",
            "period_year",
            "period_month",
            "operation_type",
            "selection_mode",
            "category",
            "calculation_mode",
            "percentage_basis",
            "percentage_rate",
            "fixed_amount",
            "proposed_total",
            "affected_teacher_count",
            "reason",
            "reference_note",
            "status",
            "idempotency_key",
            "teacher_selection_snapshot",
            "created_by",
            "created_by_name",
            "created_at",
            "confirmed_by",
            "confirmed_by_name",
            "confirmed_at",
            "audit_metadata",
        ]
        read_only_fields = fields

    def get_department_name(self, obj):
        return obj.department.name if obj.department else ""

    def get_created_by_name(self, obj):
        if obj.created_by:
            return getattr(obj.created_by, "get_full_name", lambda: "")() or obj.created_by.username
        return None

    def get_confirmed_by_name(self, obj):
        if obj.confirmed_by:
            return getattr(obj.confirmed_by, "get_full_name", lambda: "")() or obj.confirmed_by.username
        return None


class RecurringSalaryAdjustmentSerializer(serializers.ModelSerializer):
    teacher_id = serializers.IntegerField(read_only=True)
    department_id = serializers.IntegerField(read_only=True)
    institution_id = serializers.IntegerField(read_only=True)
    teacher_name = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()

    class Meta:
        model = RecurringSalaryAdjustment
        fields = [
            "id",
            "institution",
            "institution_id",
            "department",
            "department_id",
            "department_name",
            "teacher",
            "teacher_id",
            "teacher_name",
            "direction",
            "category",
            "calculation_mode",
            "percentage_basis",
            "percentage_rate",
            "amount",
            "start_year",
            "start_month",
            "end_year",
            "end_month",
            "reason",
            "status",
            "created_at",
            "updated_at",
            "cancelled_at",
            "cancellation_reason",
        ]
        read_only_fields = [
            "id",
            "institution",
            "institution_id",
            "department_id",
            "teacher_id",
            "status",
            "created_at",
            "updated_at",
            "cancelled_at",
            "cancellation_reason",
        ]

    def get_teacher_name(self, obj):
        if obj.teacher:
            return getattr(obj.teacher, "historical_name", None) or (
                obj.teacher.user.get_full_name() if obj.teacher.user else f"Teacher #{obj.teacher.id}"
            )
        return ""

    def get_department_name(self, obj):
        return obj.department.name if obj.department else ""


class SalaryAdvanceRecoverySerializer(serializers.ModelSerializer):
    teacher_id = serializers.IntegerField(read_only=True)
    department_id = serializers.IntegerField(read_only=True)
    institution_id = serializers.IntegerField(read_only=True)
    teacher_name = serializers.SerializerMethodField()
    remaining_balance = serializers.SerializerMethodField()

    class Meta:
        model = SalaryAdvanceRecovery
        fields = [
            "id",
            "institution",
            "institution_id",
            "department",
            "department_id",
            "teacher",
            "teacher_id",
            "teacher_name",
            "advance_date",
            "original_amount",
            "monthly_installment",
            "recovered_amount",
            "remaining_balance",
            "reason",
            "reference_no",
            "status",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "institution",
            "institution_id",
            "department_id",
            "teacher_id",
            "recovered_amount",
            "remaining_balance",
            "status",
            "created_at",
            "updated_at",
        ]

    def get_teacher_name(self, obj):
        if obj.teacher:
            return getattr(obj.teacher, "historical_name", None) or (
                obj.teacher.user.get_full_name() if obj.teacher.user else f"Teacher #{obj.teacher.id}"
            )
        return ""

    def get_remaining_balance(self, obj):
        return str(obj.remaining_balance)


# ============================================================================
# STAGE 7A: MONTHLY PAYROLL SERIALIZERS
# ============================================================================

class PayrollEarningLineSerializer(serializers.ModelSerializer):
    earning_type_display = serializers.CharField(source="get_earning_type_display", read_only=True)

    class Meta:
        model = PayrollEarningLine
        fields = [
            "id",
            "earning_type",
            "earning_type_display",
            "student",
            "student_name",
            "class_occurrence_id",
            "rate",
            "quantity",
            "amount",
            "effective_date",
            "policy_version",
            "applied_override_type",
            "attendance_evidence",
            "metadata",
        ]
        read_only_fields = fields


class TeacherPayrollSerializer(serializers.ModelSerializer):
    teacher_name = serializers.SerializerMethodField()
    applied_policy_name = serializers.SerializerMethodField()
    applied_policy_code = serializers.SerializerMethodField()
    earning_lines = PayrollEarningLineSerializer(many=True, read_only=True)
    payment_status_display = serializers.CharField(source="get_payment_status_display", read_only=True)

    class Meta:
        model = TeacherPayroll
        fields = [
            "id",
            "payroll_period",
            "teacher",
            "teacher_name",
            "applied_policy",
            "applied_policy_name",
            "applied_policy_code",
            "applied_policy_version",
            "basic_salary",
            "regular_class_earnings",
            "lesson_bonuses",
            "substitute_earnings",
            "cancellation_earnings",
            "positive_adjustments",
            "cuttings",
            "gross_salary",
            "net_salary",
            "paid_amount",
            "payment_status",
            "payment_status_display",
            "paid_at",
            "is_calculation_complete",
            "completeness_notes",
            "revision",
            "created_at",
            "updated_at",
            "earning_lines",
        ]
        read_only_fields = fields

    def get_teacher_name(self, obj):
        if obj.teacher:
            return getattr(obj.teacher, "historical_name", None) or (
                obj.teacher.user.get_full_name() if obj.teacher.user else f"Teacher #{obj.teacher.id}"
            )
        return ""

    def get_applied_policy_name(self, obj):
        return obj.applied_policy.name if obj.applied_policy else ""

    def get_applied_policy_code(self, obj):
        return obj.applied_policy.code if obj.applied_policy else ""


class SalaryPayrollPeriodSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    submitted_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    teacher_payrolls = TeacherPayrollSerializer(many=True, read_only=True)

    class Meta:
        model = SalaryPayrollPeriod
        fields = [
            "id",
            "institution",
            "department",
            "department_name",
            "payroll_year",
            "payroll_month",
            "status",
            "status_display",
            "current_revision",
            "total_teachers",
            "gross_total",
            "positive_adjustments_total",
            "cuttings_total",
            "net_total",
            "is_calculation_complete",
            "attendance_readiness_complete",
            "incompleteness_reasons",
            "submitted_by",
            "submitted_by_name",
            "submitted_at",
            "submission_notes",
            "submission_metadata",
            "source_fingerprint",
            "approved_by",
            "approved_by_name",
            "approved_at",
            "approval_notes",
            "created_by",
            "created_by_name",
            "created_at",
            "updated_at",
            "teacher_payrolls",
        ]
        read_only_fields = fields

    def get_submitted_by_name(self, obj):
        if obj.submitted_by:
            return obj.submitted_by.get_full_name() or obj.submitted_by.username
        return ""

    def get_approved_by_name(self, obj):
        if obj.approved_by:
            return obj.approved_by.get_full_name() or obj.approved_by.username
        return ""

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return ""


class SalaryPayrollPeriodListSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    submitted_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SalaryPayrollPeriod
        fields = [
            "id",
            "department",
            "department_name",
            "payroll_year",
            "payroll_month",
            "status",
            "status_display",
            "current_revision",
            "total_teachers",
            "gross_total",
            "positive_adjustments_total",
            "cuttings_total",
            "net_total",
            "is_calculation_complete",
            "attendance_readiness_complete",
            "incompleteness_reasons",
            "submitted_by",
            "submitted_by_name",
            "submitted_at",
            "approved_by",
            "approved_by_name",
            "approved_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_submitted_by_name(self, obj):
        if obj.submitted_by:
            return obj.submitted_by.get_full_name() or obj.submitted_by.username
        return ""

    def get_approved_by_name(self, obj):
        if obj.approved_by:
            return obj.approved_by.get_full_name() or obj.approved_by.username
        return ""


class PayrollCalculationSnapshotSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    snapshot_type_display = serializers.CharField(source="get_snapshot_type_display", read_only=True)

    class Meta:
        model = PayrollCalculationSnapshot
        fields = [
            "id",
            "payroll_period",
            "teacher_payroll",
            "revision",
            "snapshot_type",
            "snapshot_type_display",
            "snapshot_data",
            "created_by",
            "created_by_name",
            "created_at",
            "source_fingerprint",
        ]
        read_only_fields = fields

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return ""


class PayrollLifecycleAuditSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = PayrollLifecycleAudit
        fields = [
            "id",
            "payroll_period",
            "action",
            "action_display",
            "actor",
            "actor_name",
            "performed_at",
            "previous_status",
            "new_status",
            "revision",
            "gross_total_before",
            "gross_total_after",
            "net_total_before",
            "net_total_after",
            "reason",
            "metadata",
        ]
        read_only_fields = fields

    def get_actor_name(self, obj):
        if obj.actor:
            return obj.actor.get_full_name() or obj.actor.username
        return ""


class PayrollCorrectionRequestSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = PayrollCorrectionRequest
        fields = [
            "id",
            "payroll_period",
            "requested_by",
            "requested_by_name",
            "requested_at",
            "reason",
            "correction_scope",
            "submission_revision",
            "status",
            "status_display",
            "reviewed_by",
            "reviewed_by_name",
            "reviewed_at",
            "review_notes",
        ]
        read_only_fields = fields

    def get_requested_by_name(self, obj):
        if obj.requested_by:
            return obj.requested_by.get_full_name() or obj.requested_by.username
        return ""

    def get_reviewed_by_name(self, obj):
        if obj.reviewed_by:
            return obj.reviewed_by.get_full_name() or obj.reviewed_by.username
        return ""


class PayrollDraftGenerateRequestSerializer(serializers.Serializer):
    department_id = serializers.IntegerField(required=True)
    payroll_year = serializers.IntegerField(required=True)
    payroll_month = serializers.IntegerField(required=True, min_value=1, max_value=12)


class PayrollRecalculateRequestSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True)


class PayrollSubmissionRequestSerializer(serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True)


class PayrollCorrectionRequestCreateSerializer(serializers.Serializer):
    reason = serializers.CharField(required=True)
    correction_scope = serializers.CharField(required=True)


class PayrollLedgerEntrySerializer(serializers.ModelSerializer):
    event_type_display = serializers.CharField(source="get_event_type_display", read_only=True)
    classification_display = serializers.CharField(source="get_classification_display", read_only=True)
    teacher_name = serializers.SerializerMethodField()
    posted_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PayrollLedgerEntry
        fields = [
            "id",
            "institution",
            "department",
            "payroll_period",
            "teacher_payroll",
            "teacher",
            "teacher_name",
            "event_type",
            "event_type_display",
            "classification",
            "classification_display",
            "amount",
            "supporting_earning_line",
            "supporting_adjustment",
            "supporting_reference",
            "revision",
            "approval_reference",
            "posted_by",
            "posted_by_name",
            "posted_at",
            "idempotency_key",
            "metadata",
        ]
        read_only_fields = fields

    def get_teacher_name(self, obj):
        if obj.teacher:
            return getattr(obj.teacher, "historical_name", None) or (
                obj.teacher.user.get_full_name() if obj.teacher.user else f"Teacher #{obj.teacher_id}"
            )
        return ""

    def get_posted_by_name(self, obj):
        if obj.posted_by:
            return obj.posted_by.get_full_name() or obj.posted_by.username
        return ""


class TeacherPayrollPaymentSerializer(serializers.ModelSerializer):
    payment_method_display = serializers.CharField(source="get_payment_method_display", read_only=True)
    recorded_by_name = serializers.SerializerMethodField()
    teacher_name = serializers.SerializerMethodField()

    class Meta:
        model = TeacherPayrollPayment
        fields = [
            "id",
            "institution",
            "department",
            "payroll_period",
            "teacher_payroll",
            "teacher",
            "teacher_name",
            "payment_method",
            "payment_method_display",
            "amount_paid",
            "payment_date",
            "reference_number",
            "proof_document",
            "proof_notes",
            "recorded_by",
            "recorded_by_name",
            "recorded_at",
            "idempotency_key",
            "notes",
        ]
        read_only_fields = [
            "id",
            "institution",
            "department",
            "payroll_period",
            "teacher_payroll",
            "teacher",
            "teacher_name",
            "payment_method_display",
            "recorded_by",
            "recorded_by_name",
            "recorded_at",
            "idempotency_key",
        ]

    def get_recorded_by_name(self, obj):
        if obj.recorded_by:
            return obj.recorded_by.get_full_name() or obj.recorded_by.username
        return ""

    def get_teacher_name(self, obj):
        if obj.teacher:
            return getattr(obj.teacher, "historical_name", None) or (
                obj.teacher.user.get_full_name() if obj.teacher.user else f"Teacher #{obj.teacher_id}"
            )
        return ""


class SalaryEngineCutoverRegistrySerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True)
    authorized_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SalaryEngineCutoverRegistry
        fields = [
            "id",
            "department",
            "department_name",
            "period_year",
            "period_month",
            "is_unified_engine_active",
            "authorized_by",
            "authorized_by_name",
            "authorized_at",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "authorized_by_name", "created_at", "updated_at"]

    def get_authorized_by_name(self, obj):
        if obj.authorized_by:
            return obj.authorized_by.get_full_name() or obj.authorized_by.username
        return ""


class PayrollApprovalRequestSerializer(serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True)


class PayrollCorrectionReviewRequestSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["approve", "reject"], required=True)
    notes = serializers.CharField(required=True)


class TeacherPaymentRecordRequestSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=True, min_value=Decimal("0.01"))
    payment_method = serializers.ChoiceField(
        choices=TeacherPayrollPayment.PaymentMethod.choices,
        default=TeacherPayrollPayment.PaymentMethod.BANK_TRANSFER,
    )
    payment_date = serializers.DateField(required=False)
    reference_number = serializers.CharField(required=True, max_length=120)
    notes = serializers.CharField(required=False, allow_blank=True)
    proof_notes = serializers.CharField(required=False, allow_blank=True)
