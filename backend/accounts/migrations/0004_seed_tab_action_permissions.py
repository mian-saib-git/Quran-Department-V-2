from django.db import migrations


FEATURES = [
    ("tab_daily_classes", "Daily Classes Tab", "Show or hide the Daily Classes tab.", 1),
    ("tab_accounts_enrollment", "Accounts & Enrollment Tab", "Show or hide the Accounts & Enrollment tab.", 2),
    ("tab_lessons_control", "Lessons Control Tab", "Show or hide the Lessons Control tab.", 3),
    ("tab_scheduling", "Scheduling Tab", "Show or hide the Scheduling tab.", 4),
    ("tab_attendance", "Attendance Tab", "Show or hide the Attendance tab.", 5),
    ("tab_reports", "Reports Tab", "Show or hide the Reports tab.", 6),

    ("csv_export", "CSV Export", "Allow CSV export actions.", 30),
    ("excel_export", "Excel Export", "Allow Excel export actions.", 31),
    ("bulk_import", "Bulk Import", "Allow bulk import actions.", 32),
    ("delete_accounts", "Delete Accounts", "Allow permanent account deletion.", 33),
]


def seed_permissions(apps, schema_editor):
    Feature = apps.get_model("accounts", "Feature")
    Department = apps.get_model("accounts", "Department")
    DepartmentFeature = apps.get_model("accounts", "DepartmentFeature")

    for key, name, description, sort_order in FEATURES:
        feature, _ = Feature.objects.update_or_create(
            key=key,
            defaults={
                "name": name,
                "description": description,
                "sort_order": sort_order,
                "is_active": True,
            },
        )

        for department in Department.objects.all():
            DepartmentFeature.objects.get_or_create(
                department=department,
                feature=feature,
                defaults={"is_enabled": True},
            )


def reverse_permissions(apps, schema_editor):
    Feature = apps.get_model("accounts", "Feature")
    Feature.objects.filter(key__in=[item[0] for item in FEATURES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_seed_default_institution_department_features'),
    ]

    operations = [
        migrations.RunPython(seed_permissions, reverse_permissions),
    ]
