from django.db import migrations, models


def copy_existing_totals(apps, schema_editor):
    TeacherSalarySlip = apps.get_model("academy", "TeacherSalarySlip")
    for slip in TeacherSalarySlip.objects.all().iterator():
        slip.gross_total = slip.final_total or slip.calculated_total or 0
        slip.deduction_total = 0
        slip.deductions = {}
        slip.save(update_fields=["gross_total", "deduction_total", "deductions"])


class Migration(migrations.Migration):
    dependencies = [
        ("academy", "0015_quran_student_status_salary"),
    ]

    operations = [
        migrations.AddField(
            model_name="teachersalaryslip",
            name="deductions",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="teachersalaryslip",
            name="deduction_total",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="teachersalaryslip",
            name="gross_total",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14),
        ),
        migrations.RunPython(copy_existing_totals, migrations.RunPython.noop),
    ]
