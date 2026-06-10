from django.db import migrations


ACADEMY_MODELS = [
    "TeacherProfile",
    "StudentProfile",
    "StudentSubject",
    "ClassSchedule",
    "Attendance",
    "Lesson",
    "DailyLessonReport",
    "DailyLessonSubjectEntry",
    "LessonAccessPermission",
    "LessonAccessRequest",
    "MonthlyLessonSummary",
    "MonthlyLessonPlan",
]


def assign_existing_records(apps, schema_editor):
    Institution = apps.get_model("accounts", "Institution")
    Department = apps.get_model("accounts", "Department")

    institution = Institution.objects.get(slug="iqra-virtual-school")
    department = Department.objects.get(
        institution=institution,
        code="quran",
    )

    for model_name in ACADEMY_MODELS:
        Model = apps.get_model("academy", model_name)
        Model.objects.filter(institution__isnull=True).update(
            institution=institution,
            department=department,
        )


def reverse_assign_existing_records(apps, schema_editor):
    # Keep production data assigned. Do not wipe department links on reverse.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0003_seed_default_institution_department_features"),
        ("academy", "0012_attendance_department_attendance_institution_and_more"),
    ]

    operations = [
        migrations.RunPython(assign_existing_records, reverse_assign_existing_records),
    ]