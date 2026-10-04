from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_feature_department_scope"),
    ]

    operations = [
        migrations.CreateModel(
            name="PlatformSetting",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("key", models.CharField(max_length=120, unique=True)),
                ("value", models.JSONField(blank=True, default=dict)),
                ("encrypted_value", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("updated_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="updated_platform_settings", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["key"]},
        ),
        migrations.CreateModel(
            name="PlatformAuditLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("category", models.CharField(db_index=True, max_length=80)),
                ("action", models.CharField(db_index=True, max_length=120)),
                ("summary", models.CharField(max_length=500)),
                ("target_type", models.CharField(blank=True, max_length=80)),
                ("target_id", models.CharField(blank=True, max_length=120)),
                ("target_label", models.CharField(blank=True, max_length=255)),
                ("details", models.JSONField(blank=True, default=dict)),
                ("ip_address", models.GenericIPAddressField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="platform_audit_events", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(fields=["category", "created_at"], name="accounts_pl_categor_5e148a_idx"),
                    models.Index(fields=["action", "created_at"], name="accounts_pl_action_256e91_idx"),
                ],
            },
        ),
        migrations.CreateModel(
            name="PlatformBackup",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("filename", models.CharField(max_length=255, unique=True)),
                ("original_filename", models.CharField(blank=True, max_length=255)),
                ("source", models.CharField(choices=[("generated", "Generated"), ("uploaded", "Uploaded"), ("pre_restore", "Pre-restore")], default="generated", max_length=30)),
                ("status", models.CharField(choices=[("ready", "Ready"), ("validated", "Validated"), ("failed", "Failed")], default="ready", max_length=30)),
                ("size_bytes", models.BigIntegerField(default=0)),
                ("checksum_sha256", models.CharField(blank=True, max_length=64)),
                ("database_name", models.CharField(blank=True, max_length=255)),
                ("postgres_version", models.CharField(blank=True, max_length=120)),
                ("validation_message", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="platform_backups", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
    ]
