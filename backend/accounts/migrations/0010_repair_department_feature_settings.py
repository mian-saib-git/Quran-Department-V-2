# IVS_PERMANENT_FEATURE_CONTEXT_FIX_V23
from django.db import migrations


def repair_department_feature_settings(apps, schema_editor):
    Department = apps.get_model("accounts", "Department")
    Feature = apps.get_model("accounts", "Feature")
    DepartmentFeature = apps.get_model("accounts", "DepartmentFeature")

    for department in Department.objects.all().iterator():
        applicable_ids = set(
            Feature.objects.filter(
                is_active=True,
                department_type=department.department_type,
            ).values_list("id", flat=True)
        )

        existing_ids = set(
            DepartmentFeature.objects.filter(
                department_id=department.id,
                feature_id__in=applicable_ids,
            ).values_list("feature_id", flat=True)
        )

        DepartmentFeature.objects.bulk_create(
            [
                DepartmentFeature(
                    department_id=department.id,
                    feature_id=feature_id,
                    is_enabled=True,
                )
                for feature_id in sorted(applicable_ids - existing_ids)
            ],
            ignore_conflicts=True,
        )

        DepartmentFeature.objects.filter(
            department_id=department.id,
        ).exclude(feature_id__in=applicable_ids).delete()


def reverse_repair(apps, schema_editor):
    # Preserve production permission selections when rolling back code.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0009_coordinator_tab_access"),
    ]

    operations = [
        migrations.RunPython(
            repair_department_feature_settings,
            reverse_repair,
        ),
    ]
