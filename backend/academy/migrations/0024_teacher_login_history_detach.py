"""Keep historical teacher and authored evidence after login-only hard deletion."""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [
        ("academy", "0023_fix_attendance_conditional_uniques"),
        ("accounts", "0011_safe_account_archive"),
    ]
    operations = [
        migrations.AlterField(
            model_name="teacherprofile", name="user",
            field=models.OneToOneField(
                to=settings.AUTH_USER_MODEL, null=True, blank=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="teacher_profile",
            ),
        ),
        migrations.AddField(model_name="teacherprofile", name="historical_name", field=models.CharField(max_length=255, blank=True, default="")),
        migrations.AddField(model_name="teacherprofile", name="login_deleted_at", field=models.DateTimeField(null=True, blank=True, db_index=True)),
        migrations.AddField(model_name="teacherprofile", name="login_deleted_effective_date", field=models.DateField(null=True, blank=True, db_index=True)),
        migrations.AlterField(model_name="attendance", name="marked_by", field=models.ForeignKey(to=settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL, related_name="marked_attendance")),
        migrations.AddField(model_name="attendance", name="actor_name_snapshot", field=models.CharField(max_length=255, blank=True, default="")),
        migrations.AlterField(model_name="lesson", name="created_by", field=models.ForeignKey(to=settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_lessons")),
        migrations.AddField(model_name="lesson", name="actor_name_snapshot", field=models.CharField(max_length=255, blank=True, default="")),
        migrations.AlterField(model_name="dailylessonreport", name="created_by", field=models.ForeignKey(to=settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_daily_lesson_reports")),
        migrations.AddField(model_name="dailylessonreport", name="actor_name_snapshot", field=models.CharField(max_length=255, blank=True, default="")),
        migrations.AlterField(model_name="monthlylessonsummary", name="created_by", field=models.ForeignKey(to=settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_monthly_lesson_summaries")),
        migrations.AddField(model_name="monthlylessonsummary", name="actor_name_snapshot", field=models.CharField(max_length=255, blank=True, default="")),
        migrations.AlterField(model_name="monthlylessonplan", name="created_by", field=models.ForeignKey(to=settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_monthly_lesson_plans")),
        migrations.AddField(model_name="monthlylessonplan", name="actor_name_snapshot", field=models.CharField(max_length=255, blank=True, default="")),
    ]
