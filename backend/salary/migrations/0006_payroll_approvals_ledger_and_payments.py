# Additive migration for Unified Salary Management Stage 7B:
# Payroll Approvals, Immutable Ledger, Payment Recording, and Cutover Guard.
from decimal import Decimal
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
        ("academy", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("salary", "0005_monthly_payroll_records_and_submissions"),
    ]

    operations = [
        # 1. SalaryPayrollPeriod approval fields
        migrations.AddField(
            model_name="salarypayrollperiod",
            name="approved_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="salarypayrollperiod",
            name="approved_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="salarypayrollperiod",
            name="approval_notes",
            field=models.TextField(blank=True),
        ),

        # 2. TeacherPayroll payment fields
        migrations.AddField(
            model_name="teacherpayroll",
            name="paid_amount",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=10),
        ),
        migrations.AddField(
            model_name="teacherpayroll",
            name="payment_status",
            field=models.CharField(
                choices=[
                    ("unpaid", "Unpaid"),
                    ("partially_paid", "Partially Paid"),
                    ("paid", "Fully Paid"),
                ],
                db_index=True,
                default="unpaid",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="teacherpayroll",
            name="paid_at",
            field=models.DateTimeField(blank=True, null=True),
        ),

        # 3. PayrollLedgerEntry Model
        migrations.CreateModel(
            name="PayrollLedgerEntry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "event_type",
                    models.CharField(
                        choices=[
                            ("earning_basic", "Basic Salary"),
                            ("earning_regular_class", "Regular Class Earnings"),
                            ("earning_lesson_bonus", "Lesson Plan Bonus"),
                            ("earning_substitute", "Substitute Teaching Compensation"),
                            ("earning_cancellation", "Official Cancellation Earnings"),
                            ("adjustment_addition", "Positive Adjustment / Bonus"),
                            ("adjustment_cutting", "Salary Cutting / Deduction"),
                            ("payment_settlement", "Payment Settlement Record"),
                        ],
                        db_index=True,
                        max_length=50,
                    ),
                ),
                (
                    "classification",
                    models.CharField(
                        choices=[
                            ("credit", "Credit / Earning / Addition"),
                            ("debit", "Debit / Deduction / Settlement"),
                        ],
                        db_index=True,
                        max_length=20,
                    ),
                ),
                ("amount", models.DecimalField(decimal_places=2, max_digits=12)),
                ("supporting_reference", models.CharField(blank=True, max_length=255)),
                ("revision", models.PositiveIntegerField(default=1)),
                ("approval_reference", models.CharField(blank=True, max_length=120)),
                ("posted_at", models.DateTimeField(auto_now_add=True)),
                ("idempotency_key", models.CharField(db_index=True, max_length=160, unique=True)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                (
                    "department",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="payroll_ledger_entries",
                        to="accounts.department",
                    ),
                ),
                (
                    "institution",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="payroll_ledger_entries",
                        to="accounts.institution",
                    ),
                ),
                (
                    "payroll_period",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ledger_entries",
                        to="salary.salarypayrollperiod",
                    ),
                ),
                (
                    "posted_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "supporting_adjustment",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="salary.payrolladjustment",
                    ),
                ),
                (
                    "supporting_earning_line",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="salary.payrollearningline",
                    ),
                ),
                (
                    "teacher",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="salary_ledger_entries",
                        to="academy.teacherprofile",
                    ),
                ),
                (
                    "teacher_payroll",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ledger_entries",
                        to="salary.teacherpayroll",
                    ),
                ),
            ],
            options={
                "verbose_name": "Payroll Ledger Entry",
                "verbose_name_plural": "Payroll Ledger Entries",
                "ordering": ["posted_at", "id"],
            },
        ),
        migrations.AddIndex(
            model_name="payrollledgerentry",
            index=models.Index(fields=["payroll_period", "event_type"], name="sal_ledger_period_event"),
        ),
        migrations.AddIndex(
            model_name="payrollledgerentry",
            index=models.Index(fields=["teacher_payroll", "classification"], name="sal_ledger_tp_class"),
        ),
        migrations.AddIndex(
            model_name="payrollledgerentry",
            index=models.Index(fields=["teacher", "posted_at"], name="sal_ledger_teach_posted"),
        ),

        # 4. TeacherPayrollPayment Model
        migrations.CreateModel(
            name="TeacherPayrollPayment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "payment_method",
                    models.CharField(
                        choices=[
                            ("bank_transfer", "Bank Transfer"),
                            ("cash", "Cash Payment"),
                            ("cheque", "Cheque"),
                            ("other", "Authorized Alternative"),
                        ],
                        default="bank_transfer",
                        max_length=30,
                    ),
                ),
                ("amount_paid", models.DecimalField(decimal_places=2, max_digits=12)),
                ("payment_date", models.DateField()),
                ("reference_number", models.CharField(max_length=120)),
                ("proof_document", models.FileField(blank=True, null=True, upload_to="salary_payments/%Y/%m/")),
                ("proof_notes", models.TextField(blank=True)),
                ("recorded_at", models.DateTimeField(auto_now_add=True)),
                ("idempotency_key", models.CharField(db_index=True, max_length=160, unique=True)),
                ("notes", models.TextField(blank=True)),
                (
                    "department",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="salary_payments",
                        to="accounts.department",
                    ),
                ),
                (
                    "institution",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="salary_payments",
                        to="accounts.institution",
                    ),
                ),
                (
                    "payroll_period",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="payment_records",
                        to="salary.salarypayrollperiod",
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "teacher",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="salary_payment_records",
                        to="academy.teacherprofile",
                    ),
                ),
                (
                    "teacher_payroll",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="payment_records",
                        to="salary.teacherpayroll",
                    ),
                ),
            ],
            options={
                "verbose_name": "Teacher Payroll Payment",
                "verbose_name_plural": "Teacher Payroll Payments",
                "ordering": ["-payment_date", "-recorded_at"],
            },
        ),
        migrations.AddIndex(
            model_name="teacherpayrollpayment",
            index=models.Index(fields=["payroll_period", "payment_date"], name="sal_pay_period_date"),
        ),
        migrations.AddIndex(
            model_name="teacherpayrollpayment",
            index=models.Index(fields=["teacher_payroll", "payment_date"], name="sal_pay_tp_date"),
        ),
        migrations.AddIndex(
            model_name="teacherpayrollpayment",
            index=models.Index(fields=["reference_number"], name="sal_pay_ref"),
        ),

        # 5. SalaryEngineCutoverRegistry Model
        migrations.CreateModel(
            name="SalaryEngineCutoverRegistry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("period_year", models.PositiveIntegerField(db_index=True)),
                ("period_month", models.PositiveSmallIntegerField(db_index=True)),
                ("is_unified_engine_active", models.BooleanField(default=False)),
                ("authorized_at", models.DateTimeField(blank=True, null=True)),
                ("notes", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "authorized_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "department",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="salary_cutover_registries",
                        to="accounts.department",
                    ),
                ),
            ],
            options={
                "verbose_name": "Salary Engine Cutover Registry",
                "verbose_name_plural": "Salary Engine Cutover Registries",
            },
        ),
        migrations.AddConstraint(
            model_name="salaryenginecutoverregistry",
            constraint=models.UniqueConstraint(
                fields=["department", "period_year", "period_month"],
                name="unique_dept_period_cutover_registry",
            ),
        ),
        migrations.AddIndex(
            model_name="salaryenginecutoverregistry",
            index=models.Index(fields=["department", "period_year", "period_month"], name="sal_cutover_dept_period"),
        ),
    ]
