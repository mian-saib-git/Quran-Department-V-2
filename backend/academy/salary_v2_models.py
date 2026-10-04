from decimal import Decimal

from django.conf import settings
from django.db import models


class QuranSalaryPolicy(models.Model):
    """
    Effective-dated Quran salary policy.

    Policy changes must create a new effective-dated record so old
    payroll calculations keep the rate that applied at that time.
    """

    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="quran_salary_policies_v2",
    )

    effective_from = models.DateField(db_index=True)

    rate_1_to_15 = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("80.00"),
    )

    rate_16_to_19 = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("90.00"),
    )

    rate_20_plus = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("100.00"),
    )

    monthly_salary_day_cap = models.PositiveSmallIntegerField(default=20)

    is_active = models.BooleanField(default=True, db_index=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_quran_salary_policies_v2",
    )

    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="updated_quran_salary_policies_v2",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-effective_from", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["department", "effective_from"],
                name="uniq_quran_salary_policy_date_v2",
            )
        ]
        indexes = [
            models.Index(
                fields=["department", "effective_from"],
                name="qsalpol_dept_date_v2",
            ),
            models.Index(
                fields=["department", "is_active"],
                name="qsalpol_dept_active_v2",
            ),
        ]

    def __str__(self):
        return f"{self.department} salary policy from {self.effective_from}"

    def rate_for_class_count(self, class_count):
        class_count = max(0, int(class_count or 0))

        if class_count <= 15:
            return self.rate_1_to_15

        if class_count <= 19:
            return self.rate_16_to_19

        return self.rate_20_plus


class QuranTeacherMonthlyPayroll(models.Model):
    """
    One Quran payroll record for one teacher and one salary month.
    """

    class Status(models.TextChoices):
        CALCULATING = "calculating", "Calculating"
        DEPARTMENT_REVIEW = "department_review", "Department Review"
        PENDING_SUPER_ADMIN = (
            "pending_super_admin",
            "Pending Super Admin Approval",
        )
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        PAID = "paid", "Paid"
        REOPENED = "reopened", "Reopened"

    institution = models.ForeignKey(
        "accounts.Institution",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )

    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="quran_teacher_payrolls_v2",
    )

    teacher = models.ForeignKey(
        "TeacherProfile",
        on_delete=models.PROTECT,
        related_name="monthly_payrolls_v2",
    )

    month = models.PositiveSmallIntegerField()
    year = models.PositiveIntegerField()

    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.CALCULATING,
        db_index=True,
    )

    normal_earnings = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
    )

    substitute_earnings = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
    )

    approved_bonus_total = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
    )

    automatic_absence_deduction_total = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
    )

    approved_manual_deduction_total = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
    )

    dropped_class_reversal_total = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
    )

    previous_month_restoration_total = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
    )

    gross_total = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
    )

    deduction_total = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
    )

    final_total = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
    )

    calculation_snapshot = models.JSONField(default=dict, blank=True)

    department_note = models.TextField(blank=True)
    super_admin_note = models.TextField(blank=True)

    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="submitted_quran_payrolls_v2",
    )
    submitted_at = models.DateTimeField(null=True, blank=True)

    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="approved_quran_payrolls_v2",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    rejected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="rejected_quran_payrolls_v2",
    )
    rejected_at = models.DateTimeField(null=True, blank=True)

    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="paid_quran_payrolls_v2",
    )
    paid_at = models.DateTimeField(null=True, blank=True)

    reopened_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reopened_quran_payrolls_v2",
    )
    reopened_at = models.DateTimeField(null=True, blank=True)
    reopen_reason = models.TextField(blank=True)

    calculated_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = [
            "-year",
            "-month",
            "teacher__user__first_name",
            "teacher__user__username",
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["department", "teacher", "year", "month"],
                name="uniq_quran_teacher_payroll_v2",
            )
        ]
        indexes = [
            models.Index(
                fields=["department", "year", "month"],
                name="qpay_dept_month_v2",
            ),
            models.Index(
                fields=["teacher", "year", "month"],
                name="qpay_teacher_month_v2",
            ),
            models.Index(
                fields=["status", "year", "month"],
                name="qpay_status_month_v2",
            ),
        ]

    def __str__(self):
        return f"{self.teacher} - {self.month}/{self.year} - {self.status}"


class QuranSalaryLedgerEntry(models.Model):
    """
    Detailed evidence explaining exactly how a payroll total was built.
    """

    class EntryType(models.TextChoices):
        NORMAL_EARNING = "normal_earning", "Normal Class Earning"
        SUBSTITUTE_EARNING = "substitute_earning", "Substitute Class Earning"

        TEACHER_ABSENCE_DEDUCTION = (
            "teacher_absence_deduction",
            "Teacher Absence/Leave Deduction",
        )

        DROPPED_CLASS_REVERSAL = (
            "dropped_class_reversal",
            "Dropped Class Reversal",
        )

        TRANSFER_ADJUSTMENT = (
            "transfer_adjustment",
            "Teacher Transfer Adjustment",
        )

        REJOIN_RESTORATION = (
            "rejoin_restoration",
            "Previous Month Rejoin Restoration",
        )

        SYSTEM_CORRECTION = "system_correction", "System Correction"

    payroll = models.ForeignKey(
        QuranTeacherMonthlyPayroll,
        on_delete=models.CASCADE,
        related_name="ledger_entries",
    )

    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="+",
    )

    teacher = models.ForeignKey(
        "TeacherProfile",
        on_delete=models.PROTECT,
        related_name="salary_ledger_entries_v2",
    )

    student = models.ForeignKey(
        "StudentProfile",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="salary_ledger_entries_v2",
    )

    entry_type = models.CharField(
        max_length=40,
        choices=EntryType.choices,
        db_index=True,
    )

    effective_date = models.DateField(
        null=True,
        blank=True,
        db_index=True,
    )

    salary_unit_number = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Optional salary entitlement unit from 1 through 20.",
    )

    class_count_at_time = models.PositiveIntegerField(default=0)

    rate = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )

    quantity = models.DecimalField(
        max_digits=8,
        decimal_places=2,
        default=1,
    )

    amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
        help_text="Earnings are positive. Deductions/reversals are negative.",
    )

    description = models.CharField(max_length=500, blank=True)

    source_month = models.PositiveSmallIntegerField(null=True, blank=True)
    source_year = models.PositiveIntegerField(null=True, blank=True)

    metadata = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["effective_date", "id"]
        indexes = [
            models.Index(
                fields=["payroll", "entry_type"],
                name="qled_payroll_type_v2",
            ),
            models.Index(
                fields=["teacher", "effective_date"],
                name="qled_teacher_date_v2",
            ),
            models.Index(
                fields=["student", "effective_date"],
                name="qled_student_date_v2",
            ),
        ]

    def __str__(self):
        return f"{self.teacher} - {self.entry_type} - {self.amount}"


class QuranSalaryAdjustment(models.Model):
    """
    Human-entered bonus, fine, deduction or correction.

    Department Admin requests it.
    Super Admin approves/rejects it.
    Pending/rejected records do not affect approved salary.
    """

    class AdjustmentType(models.TextChoices):
        BONUS = "bonus", "Bonus"
        FINE = "fine", "Fine"
        DEDUCTION = "deduction", "Deduction"
        CORRECTION = "correction", "Salary Correction"

        REJOIN_RESTORATION = (
            "rejoin_restoration",
            "Previous Month Rejoin Restoration",
        )

    class Effect(models.TextChoices):
        CREDIT = "credit", "Credit"
        DEBIT = "debit", "Debit"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending Super Admin Approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        CANCELLED = "cancelled", "Cancelled"

    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="quran_salary_adjustments_v2",
    )

    teacher = models.ForeignKey(
        "TeacherProfile",
        on_delete=models.PROTECT,
        related_name="salary_adjustments_v2",
    )

    payroll = models.ForeignKey(
        QuranTeacherMonthlyPayroll,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="adjustments",
    )

    salary_month = models.PositiveSmallIntegerField()
    salary_year = models.PositiveIntegerField()

    adjustment_type = models.CharField(
        max_length=30,
        choices=AdjustmentType.choices,
        db_index=True,
    )

    effect = models.CharField(
        max_length=10,
        choices=Effect.choices,
        default=Effect.CREDIT,
        db_index=True,
    )

    amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
    )

    reason = models.TextField()

    source_month = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text=(
            "Original earning month for cross-month restoration/correction."
        ),
    )

    source_year = models.PositiveIntegerField(null=True, blank=True)

    student = models.ForeignKey(
        "StudentProfile",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="salary_adjustments_v2",
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )

    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="requested_quran_salary_adjustments_v2",
    )

    requested_at = models.DateTimeField(auto_now_add=True)

    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_quran_salary_adjustments_v2",
    )

    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(
                fields=["department", "salary_year", "salary_month"],
                name="qadj_dept_month_v2",
            ),
            models.Index(
                fields=["teacher", "salary_year", "salary_month"],
                name="qadj_teacher_month_v2",
            ),
            models.Index(
                fields=["status", "adjustment_type"],
                name="qadj_status_type_v2",
            ),
        ]

    def clean(self):
        from django.core.exceptions import ValidationError

        if self.amount is None or self.amount <= 0:
            raise ValidationError(
                {"amount": "Adjustment amount must be greater than zero."}
            )

        if not str(self.reason or "").strip():
            raise ValidationError(
                {"reason": "A reason is required for every salary adjustment."}
            )

        if bool(self.source_month) != bool(self.source_year):
            raise ValidationError(
                "source_month and source_year must be supplied together."
            )

        credit_only = {
            self.AdjustmentType.BONUS,
            self.AdjustmentType.REJOIN_RESTORATION,
        }
        debit_only = {
            self.AdjustmentType.FINE,
            self.AdjustmentType.DEDUCTION,
        }

        if (
            self.adjustment_type in credit_only
            and self.effect != self.Effect.CREDIT
        ):
            raise ValidationError(
                {"effect": "This adjustment type must be a credit."}
            )

        if (
            self.adjustment_type in debit_only
            and self.effect != self.Effect.DEBIT
        ):
            raise ValidationError(
                {"effect": "This adjustment type must be a debit."}
            )

    def __str__(self):
        return (
            f"{self.teacher} - {self.adjustment_type} - "
            f"{self.amount} - {self.status}"
        )


class QuranClassCoverage(models.Model):
    """
    A real scheduled session affected by teacher absence/leave.

    No fake attendance dates are created for 2-day or 3-day students.
    """

    class CoverageStatus(models.TextChoices):
        UNRESOLVED = "unresolved", "Replacement Required"
        ASSIGNED = "assigned", "Substitute Assigned"
        NOT_REQUIRED = "not_required", "No Substitute Required"
        CANCELLED = "cancelled", "Cancelled"

    class TeacherStatus(models.TextChoices):
        ABSENT = "absent", "Absent"
        LEAVE = "leave", "Leave"

    class StudentStatus(models.TextChoices):
        PRESENT = "present", "Present"
        ABSENT = "absent", "Absent"
        LEAVE = "leave", "Leave"
        NOT_MARKED = "not_marked", "Not Marked"

    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="quran_class_coverages_v2",
    )

    date = models.DateField(db_index=True)

    class_key = models.CharField(
        max_length=5,
        blank=True,
        default="",
        db_index=True,
        help_text="Teacher session key in HH:MM format.",
    )

    schedule = models.ForeignKey(
        "ClassSchedule",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="salary_coverages_v2",
    )

    teacher_attendance = models.ForeignKey(
        "Attendance",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="salary_coverages_v2",
    )

    student = models.ForeignKey(
        "StudentProfile",
        on_delete=models.CASCADE,
        related_name="class_coverages_v2",
    )

    original_teacher = models.ForeignKey(
        "TeacherProfile",
        on_delete=models.PROTECT,
        related_name="original_class_coverages_v2",
    )

    substitute_teacher = models.ForeignKey(
        "TeacherProfile",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="substitute_class_coverages_v2",
    )

    teacher_status = models.CharField(
        max_length=20,
        choices=TeacherStatus.choices,
    )

    student_status = models.CharField(
        max_length=20,
        choices=StudentStatus.choices,
        default=StudentStatus.NOT_MARKED,
    )

    coverage_status = models.CharField(
        max_length=20,
        choices=CoverageStatus.choices,
        default=CoverageStatus.UNRESOLVED,
        db_index=True,
    )

    original_teacher_rate = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )

    substitute_rate = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
    )

    reason = models.TextField(blank=True)

    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_quran_class_coverages_v2",
    )

    assigned_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date", "original_teacher_id", "student_id"]
        constraints = [
            models.UniqueConstraint(
                fields=["date", "student", "original_teacher"],
                name="uniq_quran_class_coverage_v2",
            )
        ]
        indexes = [
            models.Index(
                fields=["department", "date"],
                name="qcov_dept_date_v2",
            ),
            models.Index(
                fields=["department", "date", "class_key"],
                name="qcov_dept_session_v2",
            ),
            models.Index(
                fields=["original_teacher", "date"],
                name="qcov_orig_date_v2",
            ),
            models.Index(
                fields=["substitute_teacher", "date"],
                name="qcov_sub_date_v2",
            ),
            models.Index(
                fields=["coverage_status", "date"],
                name="qcov_status_date_v2",
            ),
        ]

    def __str__(self):
        return (
            f"{self.date} - {self.student} - "
            f"{self.original_teacher} - {self.coverage_status}"
        )


class QuranStudentDropEvent(models.Model):
    """
    Salary/drop interpretation of student attendance.

    Drop occurs after three consecutive scheduled sessions where each
    attendance status is Absent or Leave, including mixed combinations.
    """

    class Status(models.TextChoices):
        DROPPED = "dropped", "Dropped"
        REJOINED = "rejoined", "Rejoined"

    department = models.ForeignKey(
        "accounts.Department",
        on_delete=models.CASCADE,
        related_name="quran_drop_events_v2",
    )

    student = models.ForeignKey(
        "StudentProfile",
        on_delete=models.CASCADE,
        related_name="drop_events_v2",
    )

    teacher = models.ForeignKey(
        "TeacherProfile",
        on_delete=models.PROTECT,
        related_name="student_drop_events_v2",
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DROPPED,
        db_index=True,
    )

    drop_effective_date = models.DateField(db_index=True)

    streak_start_date = models.DateField()
    streak_end_date = models.DateField()

    streak_attendance = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            "Three qualifying scheduled attendance records establishing the drop."
        ),
    )

    rejoined_date = models.DateField(
        null=True,
        blank=True,
        db_index=True,
    )

    previous_month_restoration_required = models.BooleanField(default=False)

    detected_by_system = models.BooleanField(default=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_quran_drop_events_v2",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-drop_effective_date", "-id"]
        indexes = [
            models.Index(
                fields=["student", "drop_effective_date"],
                name="qdrop_student_date_v2",
            ),
            models.Index(
                fields=["teacher", "drop_effective_date"],
                name="qdrop_teacher_date_v2",
            ),
            models.Index(
                fields=["status", "drop_effective_date"],
                name="qdrop_status_date_v2",
            ),
        ]

    def __str__(self):
        return (
            f"{self.student} - {self.status} - "
            f"{self.drop_effective_date}"
        )
