from datetime import time

from django.db import migrations


FEATURES = [
    (
        "tab_tuition_dashboard",
        "Tuition Dashboard",
        "Show or hide the Tuition dashboard.",
        200,
    ),
    (
        "tab_tuition_accounts",
        "Tuition Accounts & Enrollment",
        "Manage Tuition teachers, students and enrollments.",
        201,
    ),
    (
        "tab_tuition_scheduling",
        "Tuition Scheduling",
        "Manage 40-minute Tuition class schedules.",
        202,
    ),
    (
        "tab_tuition_availability",
        "Teacher Availability",
        "Allow Tuition teacher availability management.",
        203,
    ),
    (
        "tab_tuition_assignments",
        "Tuition Assignments",
        "Create and manage Tuition assignments.",
        204,
    ),
    (
        "tab_tuition_submissions",
        "Submission Review",
        "Review student Tuition submissions and feedback.",
        205,
    ),
    (
        "tab_tuition_attendance",
        "Tuition Attendance",
        "Manage Tuition attendance.",
        206,
    ),
    (
        "tab_tuition_progress",
        "Tuition Academic Progress",
        "Manage Tuition progress records.",
        207,
    ),
    (
        "tab_tuition_reports",
        "Tuition Reports",
        "View Tuition reports and analytics.",
        208,
    ),
    (
        "tab_tuition_messages",
        "Tuition Messages",
        "Use Tuition Department messaging.",
        209,
    ),
    (
        "tuition_create_schedule",
        "Create Tuition Schedule",
        "Allow creation of Tuition schedules.",
        230,
    ),
    (
        "tuition_edit_schedule",
        "Edit Tuition Schedule",
        "Allow editing of Tuition schedules.",
        231,
    ),
    (
        "tuition_delete_schedule",
        "Delete Tuition Schedule",
        "Allow deletion of Tuition schedules.",
        232,
    ),
    (
        "tuition_manage_availability",
        "Manage Teacher Availability",
        "Allow teachers and coordinators to manage availability.",
        233,
    ),
    (
        "tuition_manage_enrollments",
        "Manage Tuition Enrollments",
        "Allow creation and editing of subject enrollments.",
        234,
    ),
    (
        "tuition_manage_crash_programs",
        "Manage Crash Programs",
        "Allow custom crash-program classes and subjects.",
        235,
    ),
    (
        "tuition_create_assignment",
        "Create Tuition Assignment",
        "Allow teachers to create assignments.",
        236,
    ),
    (
        "tuition_delete_assignment",
        "Delete Tuition Assignment",
        "Allow deletion of assignments.",
        237,
    ),
    (
        "tuition_review_submissions",
        "Review Tuition Submissions",
        "Allow teachers and coordinators to read submissions.",
        238,
    ),
    (
        "tuition_grade_submissions",
        "Grade Tuition Submissions",
        "Allow marks, grades and completion status.",
        239,
    ),
    (
        "tuition_download_attachments",
        "Download Tuition Attachments",
        "Allow access to assignment and submission files.",
        240,
    ),
]


CLASS_LEVELS = [
    ("fs-1", "FS 1", "general", 1),
    ("fs-2", "FS 2", "general", 2),
    ("fs-3", "FS 3", "general", 3),
    ("grade-1", "Grade 1", "general", 10),
    ("grade-2", "Grade 2", "general", 11),
    ("grade-3", "Grade 3", "general", 12),
    ("grade-4", "Grade 4", "general", 13),
    ("grade-5", "Grade 5", "general", 14),
    ("grade-6", "Grade 6", "general", 15),
    ("grade-7", "Grade 7", "general", 16),
    (
        "grade-8-federal",
        "Grade 8 Federal Board",
        "federal",
        20,
    ),
    (
        "grade-9-federal",
        "Grade 9 Federal Board",
        "federal",
        21,
    ),
    (
        "grade-10-federal",
        "Grade 10 Federal Board",
        "federal",
        22,
    ),
    (
        "grade-11-federal",
        "Grade 11 Federal Board",
        "federal",
        23,
    ),
    (
        "grade-12-federal",
        "Grade 12 Federal Board",
        "federal",
        24,
    ),
    (
        "grade-8-igcse",
        "Grade 8 IGCSE",
        "igcse",
        30,
    ),
    (
        "grade-9-igcse",
        "Grade 9 IGCSE",
        "igcse",
        31,
    ),
    (
        "grade-10-igcse",
        "Grade 10 IGCSE",
        "igcse",
        32,
    ),
    (
        "as-levels",
        "AS Levels",
        "cambridge",
        40,
    ),
    (
        "a-levels",
        "A Levels",
        "cambridge",
        41,
    ),
]


SUBJECTS = [
    ("english", "English", 1),
    ("urdu", "Urdu", 2),
    ("science", "Science", 3),
    ("maths", "Maths", 4),
    ("sst", "SST", 5),
    ("islamic-studies", "Islamic Studies", 6),
    ("computer", "Computer", 7),
    ("ict", "ICT", 8),
    ("education", "Education", 9),
    ("civics", "Civics", 10),
    ("economics", "Economics", 11),
    ("business", "Business", 12),
]


STANDARD_SLOTS = [
    (
        "PK",
        "Asia/Karachi",
        "Zero Period",
        time(16, 20),
        time(17, 0),
        0,
    ),
    (
        "PK",
        "Asia/Karachi",
        "1st Lecture",
        time(17, 0),
        time(17, 40),
        1,
    ),
    (
        "PK",
        "Asia/Karachi",
        "2nd Lecture",
        time(17, 40),
        time(18, 20),
        2,
    ),
    (
        "PK",
        "Asia/Karachi",
        "3rd Lecture",
        time(18, 35),
        time(19, 15),
        3,
    ),
    (
        "PK",
        "Asia/Karachi",
        "4th Lecture",
        time(19, 15),
        time(19, 55),
        4,
    ),
    (
        "PK",
        "Asia/Karachi",
        "5th Lecture",
        time(19, 55),
        time(20, 35),
        5,
    ),
    (
        "PK",
        "Asia/Karachi",
        "6th Lecture",
        time(20, 35),
        time(21, 15),
        6,
    ),
    (
        "PK",
        "Asia/Karachi",
        "7th Lecture",
        time(21, 15),
        time(21, 55),
        7,
    ),

    (
        "KSA",
        "Asia/Riyadh",
        "Zero Period",
        time(14, 20),
        time(15, 0),
        0,
    ),
    (
        "KSA",
        "Asia/Riyadh",
        "1st Lecture",
        time(15, 0),
        time(15, 40),
        1,
    ),
    (
        "KSA",
        "Asia/Riyadh",
        "2nd Lecture",
        time(15, 40),
        time(16, 20),
        2,
    ),
    (
        "KSA",
        "Asia/Riyadh",
        "3rd Lecture",
        time(16, 35),
        time(17, 15),
        3,
    ),
    (
        "KSA",
        "Asia/Riyadh",
        "4th Lecture",
        time(17, 15),
        time(17, 55),
        4,
    ),
    (
        "KSA",
        "Asia/Riyadh",
        "5th Lecture",
        time(17, 55),
        time(18, 35),
        5,
    ),
    (
        "KSA",
        "Asia/Riyadh",
        "6th Lecture",
        time(18, 35),
        time(19, 15),
        6,
    ),
    (
        "KSA",
        "Asia/Riyadh",
        "7th Lecture",
        time(19, 15),
        time(19, 55),
        7,
    ),

    (
        "UAE",
        "Asia/Dubai",
        "Zero Period",
        time(15, 20),
        time(16, 0),
        0,
    ),
    (
        "UAE",
        "Asia/Dubai",
        "1st Lecture",
        time(16, 0),
        time(16, 40),
        1,
    ),
    (
        "UAE",
        "Asia/Dubai",
        "2nd Lecture",
        time(16, 40),
        time(17, 20),
        2,
    ),
    (
        "UAE",
        "Asia/Dubai",
        "3rd Lecture",
        time(17, 35),
        time(18, 15),
        3,
    ),
    (
        "UAE",
        "Asia/Dubai",
        "4th Lecture",
        time(18, 15),
        time(18, 55),
        4,
    ),
    (
        "UAE",
        "Asia/Dubai",
        "5th Lecture",
        time(18, 55),
        time(19, 35),
        5,
    ),
    (
        "UAE",
        "Asia/Dubai",
        "6th Lecture",
        time(19, 35),
        time(20, 15),
        6,
    ),
    (
        "UAE",
        "Asia/Dubai",
        "7th Lecture",
        time(20, 15),
        time(20, 55),
        7,
    ),
]


def seed_tuition_foundation(
    apps,
    schema_editor,
):
    Institution = apps.get_model(
        "accounts",
        "Institution",
    )

    Department = apps.get_model(
        "accounts",
        "Department",
    )

    Feature = apps.get_model(
        "accounts",
        "Feature",
    )

    DepartmentFeature = apps.get_model(
        "accounts",
        "DepartmentFeature",
    )

    Config = apps.get_model(
        "tuition",
        "TuitionDepartmentConfig",
    )

    ClassLevel = apps.get_model(
        "tuition",
        "TuitionClassLevel",
    )

    Subject = apps.get_model(
        "tuition",
        "TuitionSubject",
    )

    StandardSlot = apps.get_model(
        "tuition",
        "TuitionStandardSlot",
    )

    institution, _ = (
        Institution.objects.get_or_create(
            slug="iqra-virtual-school",
            defaults={
                "name": "Iqra Virtual School",
                "is_active": True,
            },
        )
    )


    tuition_department = (
        Department.objects
        .filter(
            institution=institution,
            department_type="tuition",
        )
        .order_by("id")
        .first()
    )

    if tuition_department is None:
        tuition_department = (
            Department.objects.create(
                institution=institution,
                name="Tuition Department",
                code="tuition-department",
                department_type="tuition",
                notes=(
                    "One-to-one academic Tuition "
                    "classes with teacher availability, "
                    "40-minute scheduling and assignments."
                ),
                is_active=True,
            )
        )

    update_fields = []

    if tuition_department.name != "Tuition Department":
        tuition_department.name = "Tuition Department"
        update_fields.append("name")

    if tuition_department.department_type != "tuition":
        tuition_department.department_type = "tuition"
        update_fields.append("department_type")

    if not tuition_department.is_active:
        tuition_department.is_active = True
        update_fields.append("is_active")

    if update_fields:
        tuition_department.save(
            update_fields=update_fields
        )

    Config.objects.get_or_create(
        institution=institution,
        department=tuition_department,
        defaults={
            "default_timezone": "Asia/Karachi",
            "operating_start": time(10, 0),
            "operating_end": time(22, 0),
            "class_duration_minutes": 40,
            "operating_weekdays": [
                "sunday",
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
            ],
            "allow_custom_start_times": True,
        },
    )

    for code, name, board, order in CLASS_LEVELS:
        ClassLevel.objects.update_or_create(
            department=tuition_department,
            code=code,
            defaults={
                "institution": institution,
                "name": name,
                "board": board,
                "sort_order": order,
                "is_active": True,
            },
        )

    for code, name, order in SUBJECTS:
        Subject.objects.update_or_create(
            department=tuition_department,
            code=code,
            defaults={
                "institution": institution,
                "name": name,
                "is_standard": True,
                "sort_order": order,
                "is_active": True,
            },
        )

    for (
        region,
        timezone_name,
        label,
        start_time,
        end_time,
        order,
    ) in STANDARD_SLOTS:
        StandardSlot.objects.update_or_create(
            department=tuition_department,
            region=region,
            label=label,
            defaults={
                "institution": institution,
                "timezone_name": timezone_name,
                "start_time": start_time,
                "end_time": end_time,
                "sort_order": order,
                "is_active": True,
            },
        )

    all_departments = list(
        Department.objects.all()
    )

    for (
        key,
        name,
        description,
        sort_order,
    ) in FEATURES:
        feature, _ = Feature.objects.update_or_create(
            key=key,
            defaults={
                "name": name,
                "description": description,
                "sort_order": sort_order,
                "is_active": True,
            },
        )

        for department in all_departments:
            DepartmentFeature.objects.get_or_create(
                department=department,
                feature=feature,
                defaults={
                    "is_enabled": (
                        department.id
                        == tuition_department.id
                    ),
                },
            )


def reverse_seed(
    apps,
    schema_editor,
):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0004_seed_tab_action_permissions"),
        ("tuition", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(
            seed_tuition_foundation,
            reverse_seed,
        ),
    ]
