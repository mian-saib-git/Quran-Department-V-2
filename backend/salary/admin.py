"""Django Admin configuration for Unified Salary Management (Stage 1).

Provides safe inspection and limited editing of salary policies, effective-dated versions,
tiers, teaching plans, rate matrices, teacher assignments, and rate overrides.
Published versions and their associated rate matrices are protected against in-place edits.
"""
from django.contrib import admin
from .models import (
    SalaryPolicy,
    SalaryPolicyVersion,
    SalaryRateTier,
    SalaryTeachingPlan,
    SalaryPlanTierRate,
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


@admin.register(SalaryPolicy)
class SalaryPolicyAdmin(admin.ModelAdmin):
    list_display = (
        "code",
        "name",
        "department",
        "institution",
        "compensation_model",
        "policy_type",
        "is_active",
        "created_at",
    )
    list_filter = ("department", "compensation_model", "policy_type", "is_active")
    search_fields = ("code", "name", "description")
    readonly_fields = ("created_at", "updated_at")


class SalaryRateTierInline(admin.TabularInline):
    model = SalaryRateTier
    extra = 0
    fields = ("sort_order", "tier_name", "min_students", "max_students")

    def has_change_permission(self, request, obj=None):
        if obj and obj.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        if obj and obj.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_delete_permission(request, obj)

    def has_add_permission(self, request, obj=None):
        if obj and obj.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_add_permission(request, obj)


class SalaryTeachingPlanInline(admin.TabularInline):
    model = SalaryTeachingPlan
    extra = 0
    fields = ("sort_order", "plan_code", "plan_name", "days_per_week", "is_coordinator_special")

    def has_change_permission(self, request, obj=None):
        if obj and obj.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        if obj and obj.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_delete_permission(request, obj)

    def has_add_permission(self, request, obj=None):
        if obj and obj.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_add_permission(request, obj)


@admin.register(SalaryPolicyVersion)
class SalaryPolicyVersionAdmin(admin.ModelAdmin):
    list_display = (
        "policy",
        "version_number",
        "status",
        "week_start_day",
        "effective_from",
        "effective_to",
        "published_at",
    )
    list_filter = ("status", "week_start_day", "policy__department")
    search_fields = ("policy__name", "policy__code", "notes")
    readonly_fields = ("created_at", "updated_at", "published_at")
    inlines = [SalaryRateTierInline, SalaryTeachingPlanInline]

    def get_readonly_fields(self, request, obj=None):
        readonly = list(super().get_readonly_fields(request, obj))
        if obj and obj.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            # All configuration fields are locked down once published
            return readonly + [
                "policy",
                "version_number",
                "effective_from",
                "effective_to",
                "week_start_day",
                "min_qualifying_weeks",
                "lesson_plan_bonus_per_class",
                "substitute_rate_per_class",
                "cancellation_rate_per_class",
                "requires_completed_lesson_for_bonus",
            ]
        return readonly

    def has_delete_permission(self, request, obj=None):
        if obj and obj.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_delete_permission(request, obj)


@admin.register(SalaryRateTier)
class SalaryRateTierAdmin(admin.ModelAdmin):
    list_display = ("policy_version", "sort_order", "tier_name", "min_students", "max_students")
    list_filter = ("policy_version__policy__department", "policy_version__status")
    search_fields = ("tier_name", "policy_version__policy__name")

    def has_change_permission(self, request, obj=None):
        if obj and obj.policy_version.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        if obj and obj.policy_version.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_delete_permission(request, obj)


@admin.register(SalaryTeachingPlan)
class SalaryTeachingPlanAdmin(admin.ModelAdmin):
    list_display = ("policy_version", "sort_order", "plan_code", "plan_name", "days_per_week", "is_coordinator_special")
    list_filter = ("is_coordinator_special", "policy_version__policy__department")
    search_fields = ("plan_code", "plan_name")

    def has_change_permission(self, request, obj=None):
        if obj and obj.policy_version.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        if obj and obj.policy_version.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_delete_permission(request, obj)


@admin.register(SalaryPlanTierRate)
class SalaryPlanTierRateAdmin(admin.ModelAdmin):
    list_display = ("policy_version", "teaching_plan", "rate_tier", "rate_per_class")
    list_filter = ("policy_version__policy__department", "policy_version__status")
    search_fields = ("teaching_plan__plan_name", "rate_tier__tier_name")

    def has_change_permission(self, request, obj=None):
        if obj and obj.policy_version.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        if obj and obj.policy_version.status in (SalaryPolicyVersion.Status.PUBLISHED, SalaryPolicyVersion.Status.ARCHIVED):
            return False
        return super().has_delete_permission(request, obj)


@admin.register(TeacherPolicyAssignment)
class TeacherPolicyAssignmentAdmin(admin.ModelAdmin):
    list_display = (
        "teacher",
        "department",
        "policy",
        "effective_from",
        "effective_to",
        "is_active",
        "assigned_at",
    )
    list_filter = ("department", "is_active")
    search_fields = ("teacher__user__username", "teacher__historical_name", "policy__name")
    readonly_fields = ("assigned_at",)


@admin.register(TeacherSalaryOverride)
class TeacherSalaryOverrideAdmin(admin.ModelAdmin):
    list_display = (
        "teacher",
        "department",
        "override_level",
        "rate_per_class",
        "effective_from",
        "effective_to",
        "is_active",
    )
    list_filter = ("department", "override_level", "is_active")
    search_fields = ("teacher__user__username", "teacher__historical_name", "reason")
    readonly_fields = ("created_at", "updated_at")


class SalaryAttendanceAuditInline(admin.TabularInline):
    model = SalaryAttendanceAudit
    extra = 0
    readonly_fields = (
        "previous_status",
        "new_status",
        "previous_resolution",
        "new_resolution",
        "action",
        "actor",
        "reason",
        "created_at",
    )
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(SalaryAttendanceVerification)
class SalaryAttendanceVerificationAdmin(admin.ModelAdmin):
    list_display = (
        "occurrence_key",
        "department",
        "source_department_type",
        "teacher",
        "student",
        "class_date",
        "scheduled_time",
        "verification_status",
        "resolution_type",
        "resolved_by",
        "resolved_at",
    )
    list_filter = (
        "department",
        "source_department_type",
        "verification_status",
        "resolution_type",
        "is_cancelled",
    )
    search_fields = (
        "occurrence_key",
        "teacher__user__username",
        "teacher__historical_name",
        "student__user__username",
        "resolution_reason",
    )
    readonly_fields = ("created_at", "updated_at", "occurrence_key")
    inlines = [SalaryAttendanceAuditInline]


@admin.register(SalaryAttendanceAudit)
class SalaryAttendanceAuditAdmin(admin.ModelAdmin):
    list_display = (
        "verification",
        "previous_status",
        "new_status",
        "action",
        "actor",
        "created_at",
    )
    list_filter = ("action", "new_status")
    search_fields = ("verification__occurrence_key", "reason", "actor__username")
    readonly_fields = (
        "verification",
        "previous_status",
        "new_status",
        "previous_resolution",
        "new_resolution",
        "action",
        "actor",
        "reason",
        "source_evidence_snapshot",
        "created_at",
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(SalaryReconciliationBatch)
class SalaryReconciliationBatchAdmin(admin.ModelAdmin):
    list_display = (
        "department",
        "period_year",
        "period_month",
        "is_complete",
        "total_occurrences",
        "verified_count",
        "pending_count",
        "resolved_count",
        "conflicted_count",
        "scanned_at",
    )
    list_filter = ("department", "period_year", "is_complete")
    readonly_fields = ("created_at", "scanned_at")


@admin.register(SalaryAdjustmentCategory)
class SalaryAdjustmentCategoryAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "direction", "department", "is_active", "is_system_default")
    list_filter = ("direction", "is_active", "department")
    search_fields = ("code", "name", "description")


class PayrollAdjustmentAuditInline(admin.TabularInline):
    model = PayrollAdjustmentAudit
    extra = 0
    readonly_fields = ("action", "previous_amount", "new_amount", "previous_status", "new_status", "actor", "reason", "created_at")

    def has_add_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(PayrollAdjustment)
class PayrollAdjustmentAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "teacher",
        "department",
        "period_year",
        "period_month",
        "category",
        "direction",
        "amount",
        "calculation_mode",
        "status",
        "created_at",
    )
    list_filter = ("direction", "status", "period_year", "period_month", "department", "calculation_mode")
    search_fields = ("teacher__user__first_name", "teacher__user__last_name", "category", "reason", "reference_note")
    readonly_fields = ("created_at", "updated_at", "cancelled_at")
    inlines = [PayrollAdjustmentAuditInline]


@admin.register(SalaryBulkAdjustmentBatch)
class SalaryBulkAdjustmentBatchAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "department",
        "period_year",
        "period_month",
        "operation_type",
        "selection_mode",
        "category",
        "calculation_mode",
        "affected_teacher_count",
        "proposed_total",
        "status",
        "created_at",
        "confirmed_at",
    )
    list_filter = ("operation_type", "status", "period_year", "period_month", "department")
    search_fields = ("idempotency_key", "reason", "reference_note")
    readonly_fields = ("created_at", "confirmed_at", "idempotency_key")


@admin.register(RecurringSalaryAdjustment)
class RecurringSalaryAdjustmentAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "teacher",
        "department",
        "direction",
        "category",
        "amount",
        "start_year",
        "start_month",
        "end_year",
        "end_month",
        "status",
    )
    list_filter = ("direction", "status", "department")
    search_fields = ("teacher__user__first_name", "teacher__user__last_name", "category", "reason")
    readonly_fields = ("created_at", "updated_at", "cancelled_at")


@admin.register(SalaryAdvanceRecovery)
class SalaryAdvanceRecoveryAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "teacher",
        "department",
        "advance_date",
        "original_amount",
        "monthly_installment",
        "recovered_amount",
        "status",
    )
    list_filter = ("status", "department")
    search_fields = ("teacher__user__first_name", "teacher__user__last_name", "reference_no", "reason")
    readonly_fields = ("created_at", "updated_at")


@admin.register(SalaryPayrollPeriod)
class SalaryPayrollPeriodAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "department",
        "payroll_year",
        "payroll_month",
        "status",
        "current_revision",
        "total_teachers",
        "gross_total",
        "net_total",
        "is_calculation_complete",
        "attendance_readiness_complete",
        "submitted_at",
        "approved_by",
        "approved_at",
    )
    list_filter = ("status", "payroll_year", "payroll_month", "department")
    search_fields = ("department__name", "submission_notes", "source_fingerprint")
    readonly_fields = ("created_at", "updated_at", "submitted_at", "approved_at", "approved_by")

    def has_change_permission(self, request, obj=None):
        if obj and obj.status in [SalaryPayrollPeriod.Status.APPROVED, SalaryPayrollPeriod.Status.PAID]:
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        if obj and obj.status in [SalaryPayrollPeriod.Status.APPROVED, SalaryPayrollPeriod.Status.PAID]:
            return False
        return super().has_delete_permission(request, obj)


class PayrollEarningLineInline(admin.TabularInline):
    model = PayrollEarningLine
    extra = 0
    fields = ("earning_type", "student_name", "effective_date", "rate", "quantity", "amount")
    readonly_fields = ("earning_type", "student_name", "effective_date", "rate", "quantity", "amount")

    def has_add_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(TeacherPayroll)
class TeacherPayrollAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "payroll_period",
        "teacher",
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
        "paid_at",
        "is_calculation_complete",
        "revision",
    )
    list_filter = ("payment_status", "payroll_period__department", "payroll_period__payroll_year", "payroll_period__payroll_month")
    search_fields = ("teacher__user__first_name", "teacher__user__last_name")
    readonly_fields = ("created_at", "updated_at", "paid_at")
    inlines = [PayrollEarningLineInline]

    def has_change_permission(self, request, obj=None):
        if obj and obj.payroll_period.status in [SalaryPayrollPeriod.Status.APPROVED, SalaryPayrollPeriod.Status.PAID]:
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        if obj and obj.payroll_period.status in [SalaryPayrollPeriod.Status.APPROVED, SalaryPayrollPeriod.Status.PAID]:
            return False
        return super().has_delete_permission(request, obj)


@admin.register(PayrollCalculationSnapshot)
class PayrollCalculationSnapshotAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "payroll_period",
        "teacher_payroll",
        "revision",
        "snapshot_type",
        "created_by",
        "created_at",
    )
    list_filter = ("snapshot_type", "revision")
    readonly_fields = ("created_at", "snapshot_data", "source_fingerprint")


@admin.register(PayrollLifecycleAudit)
class PayrollLifecycleAuditAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "payroll_period",
        "action",
        "actor",
        "previous_status",
        "new_status",
        "revision",
        "gross_total_after",
        "net_total_after",
        "performed_at",
    )
    list_filter = ("action", "payroll_period__department")
    search_fields = ("reason",)
    readonly_fields = ("performed_at", "gross_total_before", "gross_total_after", "net_total_before", "net_total_after", "metadata")


@admin.register(PayrollCorrectionRequest)
class PayrollCorrectionRequestAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "payroll_period",
        "requested_by",
        "requested_at",
        "submission_revision",
        "status",
        "reviewed_by",
        "reviewed_at",
    )
    list_filter = ("status", "payroll_period__department")
    search_fields = ("reason", "correction_scope", "review_notes")
    readonly_fields = ("requested_at", "reviewed_at")


@admin.register(PayrollLedgerEntry)
class PayrollLedgerEntryAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "payroll_period",
        "teacher",
        "event_type",
        "classification",
        "amount",
        "revision",
        "posted_at",
    )
    list_filter = ("event_type", "classification", "payroll_period__department")
    search_fields = ("idempotency_key", "supporting_reference", "approval_reference")
    readonly_fields = [f.name for f in PayrollLedgerEntry._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(TeacherPayrollPayment)
class TeacherPayrollPaymentAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "payroll_period",
        "teacher",
        "payment_method",
        "amount_paid",
        "payment_date",
        "reference_number",
        "recorded_by",
        "recorded_at",
    )
    list_filter = ("payment_method", "payroll_period__department", "payment_date")
    search_fields = ("reference_number", "idempotency_key", "notes")
    readonly_fields = [f.name for f in TeacherPayrollPayment._meta.fields]

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(SalaryEngineCutoverRegistry)
class SalaryEngineCutoverRegistryAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "department",
        "period_year",
        "period_month",
        "is_unified_engine_active",
        "authorized_by",
        "authorized_at",
    )
    list_filter = ("is_unified_engine_active", "department")
    search_fields = ("department__name", "notes")
    readonly_fields = ("created_at", "updated_at")
