from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0008_quran_management_features"),
    ]

    operations = [
        migrations.CreateModel(
            name="CoordinatorTabAccess",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("tab_key", models.CharField(max_length=120)),
                ("is_visible", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "coordinator",
                    models.ForeignKey(
                        limit_choices_to={"role": "coordinator"},
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="coordinator_tab_access",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "department",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="coordinator_tab_access",
                        to="accounts.department",
                    ),
                ),
                (
                    "updated_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="updated_coordinator_tab_access",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["department__name", "coordinator__username", "tab_key"],
            },
        ),
        migrations.AddConstraint(
            model_name="coordinatortabaccess",
            constraint=models.UniqueConstraint(
                fields=("coordinator", "department", "tab_key"),
                name="unique_coordinator_tab_access",
            ),
        ),
    ]
