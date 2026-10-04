from django.db import migrations


FEATURES = [
    (
        "tab_dropped_leave",
        "Dropped & Leave Tab",
        "Track Quran students with consecutive leave or absence records.",
        7,
    ),
    (
        "tab_teacher_salary",
        "Teacher Salary Management Tab",
        "Calculate and manage Quran teacher monthly salaries, bonuses, and achievement points.",
        8,
    ),
]


def seed_features(apps, schema_editor):
    Feature = apps.get_model("accounts", "Feature")
    Department = apps.get_model("accounts", "Department")
    DepartmentFeature = apps.get_model("accounts", "DepartmentFeature")

    quran_departments = Department.objects.filter(department_type="quran")

    for key, name, description, sort_order in FEATURES:
        feature, _ = Feature.objects.update_or_create(
            key=key,
            defaults={
                "name": name,
                "description": description,
                "sort_order": sort_order,
                "is_active": True,
                "department_type": "quran",
            },
        )
        for department in quran_departments:
            DepartmentFeature.objects.get_or_create(
                department=department,
                feature=feature,
                defaults={"is_enabled": True},
            )


def reverse_features(apps, schema_editor):
    Feature = apps.get_model("accounts", "Feature")
    Feature.objects.filter(key__in=[item[0] for item in FEATURES]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0007_maintenance_notices"),
    ]

    operations = [
        migrations.RunPython(seed_features, reverse_features),
    ]
