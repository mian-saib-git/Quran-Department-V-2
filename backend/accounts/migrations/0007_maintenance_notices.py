from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0006_platform_admin_tools"),
    ]

    operations = [
        migrations.CreateModel(
            name="PlatformMaintenanceWindow",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("scope_type", models.CharField(choices=[("platform", "Entire Platform"), ("institution", "Institution"), ("department", "Department")], db_index=True, default="department", max_length=20)),
                ("title", models.CharField(default="Scheduled maintenance", max_length=160)),
                ("message", models.TextField(default="This portal is temporarily unavailable while scheduled maintenance is completed. Please try again soon.")),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("starts_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("ends_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_maintenance_windows", to=settings.AUTH_USER_MODEL)),
                ("department", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="maintenance_windows", to="accounts.department")),
                ("institution", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="maintenance_windows", to="accounts.institution")),
                ("updated_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="updated_maintenance_windows", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-is_active", "-created_at", "-id"]},
        ),
        migrations.CreateModel(
            name="PlatformNotice",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=180)),
                ("message", models.TextField()),
                ("severity", models.CharField(choices=[("info", "Information"), ("success", "Success"), ("warning", "Important"), ("critical", "Critical")], db_index=True, default="info", max_length=20)),
                ("audience", models.CharField(choices=[("all", "Everyone"), ("portal_admin", "Portal Admins"), ("coordinator", "Coordinators"), ("teacher", "Teachers"), ("student", "Students")], db_index=True, default="all", max_length=30)),
                ("delivery_mode", models.CharField(choices=[("once", "Show Once"), ("one_day", "Show for 24 Hours"), ("custom", "Custom Time")], db_index=True, default="once", max_length=20)),
                ("scope_type", models.CharField(choices=[("platform", "All Institutions"), ("institution", "Institution"), ("department", "Department")], db_index=True, default="platform", max_length=20)),
                ("is_active", models.BooleanField(db_index=True, default=True)),
                ("starts_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("ends_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="created_platform_notices", to=settings.AUTH_USER_MODEL)),
                ("department", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="platform_notices", to="accounts.department")),
                ("institution", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name="platform_notices", to="accounts.institution")),
                ("updated_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="updated_platform_notices", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-is_active", "-created_at", "-id"]},
        ),
        migrations.CreateModel(
            name="PlatformNoticeReceipt",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("dismissed_at", models.DateTimeField(auto_now_add=True)),
                ("notice", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="receipts", to="accounts.platformnotice")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="platform_notice_receipts", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-dismissed_at", "-id"]},
        ),
        migrations.AddConstraint(
            model_name="platformnoticereceipt",
            constraint=models.UniqueConstraint(fields=("notice", "user"), name="unique_platform_notice_receipt"),
        ),
        migrations.AddIndex(model_name="platformmaintenancewindow", index=models.Index(fields=["scope_type", "is_active"], name="accounts_mt_scope_a_idx")),
        migrations.AddIndex(model_name="platformmaintenancewindow", index=models.Index(fields=["institution", "is_active"], name="accounts_mt_institu_idx")),
        migrations.AddIndex(model_name="platformmaintenancewindow", index=models.Index(fields=["department", "is_active"], name="accounts_mt_departm_idx")),
        migrations.AddIndex(model_name="platformnotice", index=models.Index(fields=["scope_type", "is_active"], name="accounts_no_scope_a_idx")),
        migrations.AddIndex(model_name="platformnotice", index=models.Index(fields=["audience", "is_active"], name="accounts_no_audienc_idx")),
        migrations.AddIndex(model_name="platformnotice", index=models.Index(fields=["starts_at", "ends_at"], name="accounts_no_window_idx")),
        migrations.AddIndex(model_name="platformnoticereceipt", index=models.Index(fields=["user", "dismissed_at"], name="accounts_nr_user_di_idx")),
    ]
