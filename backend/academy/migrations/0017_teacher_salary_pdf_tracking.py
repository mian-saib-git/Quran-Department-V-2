from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("academy", "0016_quran_salary_audit_deductions"),
    ]

    operations = [
        migrations.AddField(
            model_name="teachersalaryslip",
            name="pdf_generated_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="teachersalaryslip",
            name="pdf_download_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="teachersalaryslip",
            name="pdf_last_downloaded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
