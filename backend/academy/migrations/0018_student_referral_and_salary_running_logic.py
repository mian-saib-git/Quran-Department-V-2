from django.db import migrations, models
import django.db.models.deletion


def backfill_referral_students(apps, schema_editor):
    # Existing teacher-based referrals cannot be mapped to one exact student
    # safely. Keep the historical teacher credit and leave referral_student
    # empty so administrators can rely on accurate data going forward.
    return


class Migration(migrations.Migration):
    dependencies = [
        ("academy", "0017_teacher_salary_pdf_tracking"),
    ]

    operations = [
        migrations.AddField(
            model_name="studentprofile",
            name="referral_student",
            field=models.ForeignKey(
                blank=True,
                help_text="Existing student who referred this student. The teacher credit is captured from the referring student's teacher at enrollment time.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="referred_new_students",
                to="academy.studentprofile",
            ),
        ),
        migrations.RunPython(backfill_referral_students, migrations.RunPython.noop),
    ]
