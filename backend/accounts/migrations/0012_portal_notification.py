from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("accounts", "0011_safe_account_archive")]

    operations = [
        migrations.CreateModel(
            name="PortalNotification",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("event_key", models.CharField(max_length=190)),
                ("kind", models.CharField(max_length=48)),
                ("title", models.CharField(max_length=180)),
                ("body", models.CharField(blank=True, default="", max_length=500)),
                ("target", models.CharField(blank=True, default="", max_length=48)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                ("department", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="portal_notifications", to="accounts.department")),
                ("recipient", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="portal_notifications", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
        migrations.AddConstraint(
            model_name="portalnotification",
            constraint=models.UniqueConstraint(fields=("recipient", "event_key"), name="ivs_notification_recipient_event_unique"),
        ),
        migrations.AddIndex(
            model_name="portalnotification",
            index=models.Index(fields=["recipient", "read_at", "-created_at"], name="ivs_notif_unread_idx"),
        ),
    ]
