from django.db import migrations, models


QURAN_FEATURES = [
    ("tab_daily_classes", "Daily Classes Tab", "Show the Daily Classes section in the Quran portal.", 1),
    ("tab_accounts_enrollment", "Accounts & Enrollment Tab", "Show the Quran Accounts & Enrollment section.", 2),
    ("tab_lessons_control", "Lessons Control Tab", "Show the Quran Lessons Control section.", 3),
    ("tab_scheduling", "Scheduling Tab", "Show the Quran Scheduling section.", 4),
    ("tab_attendance", "Attendance Tab", "Show the Quran Attendance section.", 5),
    ("tab_reports", "Reports Tab", "Show the Quran Reports section.", 6),
    ("pdf_reports", "PDF Reports", "Allow Quran PDF report exports.", 30),
    ("csv_export", "CSV Export", "Allow Quran CSV export actions.", 31),
    ("excel_export", "Excel Export", "Allow Quran Excel export actions.", 32),
    ("bulk_import", "Bulk Import", "Allow Quran teacher and student bulk import.", 40),
    ("delete_accounts", "Delete Accounts", "Allow permanent Quran account deletion.", 41),
    ("delete_schedule", "Delete Schedule", "Allow Quran schedule deletion.", 50),
    ("ai_assistant", "AI Assistant", "Allow the Quran AI assistant.", 60),
]


TUITION_FEATURES = [
    ("tab_tuition_dashboard", "Tuition Dashboard", "Show the Tuition dashboard.", 201),
    ("tab_tuition_accounts", "Tuition Accounts & Enrollment", "Show Tuition accounts and enrollment.", 202),
    ("tab_tuition_scheduling", "Tuition Scheduling", "Show Tuition scheduling.", 203),
    ("tab_tuition_attendance", "Tuition Attendance", "Show Tuition attendance.", 204),
    ("tab_tuition_reports", "Tuition Reports", "Show Tuition reports and analytics.", 205),
    ("tuition_pdf_reports", "Tuition PDF Reports", "Allow Tuition PDF report exports.", 220),
    ("tuition_csv_export", "Tuition CSV Export", "Allow Tuition CSV export actions.", 221),
    ("tuition_excel_export", "Tuition Excel Export", "Allow Tuition Excel export actions.", 222),
    ("tuition_bulk_import", "Tuition Bulk Import", "Allow Tuition teacher and student bulk import.", 230),
    ("tuition_delete_accounts", "Delete Tuition Accounts", "Allow permanent Tuition account deletion.", 231),
    ("tuition_manage_enrollments", "Manage Tuition Enrollments", "Allow creation and editing of Tuition enrollments.", 232),
    ("tuition_manage_crash_programs", "Manage Crash Programs", "Allow custom Tuition crash-program classes and subjects.", 233),
    ("tuition_create_schedule", "Create Tuition Schedule", "Allow creation of Tuition schedules.", 240),
    ("tuition_edit_schedule", "Edit Tuition Schedule", "Allow editing of Tuition schedules.", 241),
    ("tuition_delete_schedule", "Delete Tuition Schedule", "Allow deletion of Tuition schedules.", 242),
    ("tuition_manage_availability", "Manage Teacher Availability", "Allow Tuition teacher availability management.", 243),
    ("tuition_mark_attendance", "Mark Tuition Attendance", "Allow marking and clearing Tuition attendance.", 250),
    ("tuition_ai_assistant", "Tuition AI Assistant", "Allow the Tuition AI assistant.", 260),
]


OLD_TUITION_VALUE_MAP = {
    "tuition_pdf_reports": "pdf_reports",
    "tuition_csv_export": "csv_export",
    "tuition_excel_export": "excel_export",
    "tuition_bulk_import": "bulk_import",
    "tuition_delete_accounts": "delete_accounts",
    "tuition_ai_assistant": "ai_assistant",
}


UNIMPLEMENTED_TUITION_KEYS = {
    "tab_tuition_availability",
    "tab_tuition_assignments",
    "tab_tuition_submissions",
    "tab_tuition_progress",
    "tab_tuition_messages",
    "tuition_create_assignment",
    "tuition_delete_assignment",
    "tuition_review_submissions",
    "tuition_grade_submissions",
    "tuition_download_attachments",
}


def configure_feature_scope(apps, schema_editor):
    Department = apps.get_model("accounts", "Department")
    Feature = apps.get_model("accounts", "Feature")
    DepartmentFeature = apps.get_model("accounts", "DepartmentFeature")

    quran_keys = {item[0] for item in QURAN_FEATURES}
    tuition_keys = {item[0] for item in TUITION_FEATURES}

    for key, name, description, sort_order in QURAN_FEATURES:
        Feature.objects.update_or_create(
            key=key,
            defaults={
                "name": name,
                "description": description,
                "sort_order": sort_order,
                "is_active": True,
                "department_type": "quran",
            },
        )

    for key, name, description, sort_order in TUITION_FEATURES:
        Feature.objects.update_or_create(
            key=key,
            defaults={
                "name": name,
                "description": description,
                "sort_order": sort_order,
                "is_active": True,
                "department_type": "tuition",
            },
        )

    Feature.objects.filter(key__in=UNIMPLEMENTED_TUITION_KEYS).update(
        is_active=False,
        department_type="tuition",
    )

    Feature.objects.exclude(key__in=quran_keys | tuition_keys | UNIMPLEMENTED_TUITION_KEYS).update(
        department_type="general",
    )

    for department in Department.objects.all():
        if department.department_type == "quran":
            applicable = QURAN_FEATURES
        elif department.department_type == "tuition":
            applicable = TUITION_FEATURES
        else:
            applicable = []

        existing_by_key = {
            row.feature.key: row.is_enabled
            for row in DepartmentFeature.objects.filter(department=department).select_related("feature")
        }

        for key, _name, _description, _sort_order in applicable:
            enabled = existing_by_key.get(key)
            if enabled is None and department.department_type == "tuition":
                legacy_key = OLD_TUITION_VALUE_MAP.get(key)
                if legacy_key:
                    enabled = existing_by_key.get(legacy_key)
            if enabled is None:
                enabled = True

            feature = Feature.objects.get(key=key)
            DepartmentFeature.objects.update_or_create(
                department=department,
                feature=feature,
                defaults={"is_enabled": bool(enabled)},
            )

        allowed_keys = {item[0] for item in applicable}
        DepartmentFeature.objects.filter(department=department).exclude(
            feature__key__in=allowed_keys
        ).delete()


def reverse_scope(apps, schema_editor):
    # Keep configured production permissions when rolling back code.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("tuition", "0005_tuitionteachercapability_available_schedule_slots"),
        ("accounts", "0004_seed_tab_action_permissions"),
    ]

    operations = [
        migrations.AddField(
            model_name="feature",
            name="department_type",
            field=models.CharField(
                choices=[("quran", "Quran"), ("tuition", "Tuition"), ("general", "General")],
                db_index=True,
                default="general",
                max_length=50,
            ),
        ),
        migrations.RunPython(configure_feature_scope, reverse_scope),
    ]
