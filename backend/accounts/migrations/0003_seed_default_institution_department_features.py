from django.db import migrations


DEFAULT_FEATURES = [
    ("live_classes", "Live Classes", "Show live/current class cards", 10),
    ("up_next_classes", "Up Next Classes", "Show upcoming class cards", 20),
    ("student_attendance", "Student Attendance", "Mark and manage student attendance", 30),
    ("teacher_attendance", "Teacher Attendance", "Mark and manage teacher attendance", 40),
    ("lesson_reports", "Lesson Reports", "Teacher daily lesson reports", 50),
    ("monthly_lesson_plans", "Monthly Lesson Plans", "Monthly student lesson planning", 60),
    ("monthly_summaries", "Monthly Summaries", "Monthly progress summaries", 70),
    ("pdf_reports", "PDF Reports", "Generate PDF reports", 80),
    ("chat_system", "Chat System", "Internal academy chat system", 90),
    ("ai_assistant", "AI Assistant", "AI assistant for academy data", 100),
    ("fees", "Fees", "Fee, invoice, and payment tracking", 110),
    ("homework", "Homework", "Homework assignment and tracking", 120),
    ("tests_quizzes", "Tests & Quizzes", "Tests, quizzes, and marks tracking", 130),
    ("parent_portal", "Parent Portal", "Parent login and student progress view", 140),
]


def seed_default_foundation(apps, schema_editor):
    Institution = apps.get_model("accounts", "Institution")
    Department = apps.get_model("accounts", "Department")
    Feature = apps.get_model("accounts", "Feature")
    DepartmentFeature = apps.get_model("accounts", "DepartmentFeature")
    User = apps.get_model("accounts", "User")
    UserDepartmentRole = apps.get_model("accounts", "UserDepartmentRole")

    institution, _ = Institution.objects.get_or_create(
        slug="iqra-virtual-school",
        defaults={
            "name": "Iqra Virtual School",
            "is_active": True,
        },
    )

    quran_department, _ = Department.objects.get_or_create(
        institution=institution,
        code="quran",
        defaults={
            "name": "Quran Department",
            "department_type": "quran",
            "is_active": True,
        },
    )

    for key, name, description, sort_order in DEFAULT_FEATURES:
        feature, _ = Feature.objects.get_or_create(
            key=key,
            defaults={
                "name": name,
                "description": description,
                "is_active": True,
                "sort_order": sort_order,
            },
        )

        DepartmentFeature.objects.get_or_create(
            department=quran_department,
            feature=feature,
            defaults={"is_enabled": True},
        )

    for user in User.objects.all():
        user.institution = institution
        user.department = quran_department
        user.save(update_fields=["institution", "department"])

        role = user.role

        if user.is_superuser:
            UserDepartmentRole.objects.get_or_create(
                user=user,
                institution=institution,
                department=None,
                role="platform_admin",
                defaults={"is_active": True},
            )

            UserDepartmentRole.objects.get_or_create(
                user=user,
                institution=institution,
                department=quran_department,
                role="department_admin",
                defaults={"is_active": True},
            )

        UserDepartmentRole.objects.get_or_create(
            user=user,
            institution=institution,
            department=quran_department,
            role=role,
            defaults={"is_active": True},
        )


def reverse_seed_default_foundation(apps, schema_editor):
    # Keep data on reverse to avoid accidentally removing production users/structure.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0002_department_feature_institution_alter_user_role_and_more"),
    ]

    operations = [
        migrations.RunPython(seed_default_foundation, reverse_seed_default_foundation),
    ]