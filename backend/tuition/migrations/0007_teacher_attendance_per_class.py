# IVS_TUITION_TEACHER_ATTENDANCE_UNIQUE_V24
from django.db import migrations, models
from django.db.models import Count


def deduplicate_teacher_class_attendance(apps, schema_editor):
    Attendance = apps.get_model("tuition", "TuitionAttendance")

    duplicate_groups = (
        Attendance.objects.filter(
            entity_type="teacher",
            teacher_id__isnull=False,
        )
        .values(
            "department_id",
            "entity_type",
            "teacher_id",
            "date",
            "class_key",
        )
        .annotate(row_count=Count("id"))
        .filter(row_count__gt=1)
    )

    for group in duplicate_groups.iterator():
        rows = Attendance.objects.filter(
            department_id=group["department_id"],
            entity_type=group["entity_type"],
            teacher_id=group["teacher_id"],
            date=group["date"],
            class_key=group["class_key"],
        ).order_by("-updated_at", "-id")

        keep = rows.first()
        if keep is not None:
            rows.exclude(id=keep.id).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("tuition", "0006_tuitionattendance"),
    ]

    operations = [
        migrations.RunPython(
            deduplicate_teacher_class_attendance,
            migrations.RunPython.noop,
        ),
        migrations.AddConstraint(
            model_name="tuitionattendance",
            constraint=models.UniqueConstraint(
                fields=(
                    "department",
                    "entity_type",
                    "teacher",
                    "date",
                    "class_key",
                ),
                name="unique_tuition_teacher_attendance_per_class",
            ),
        ),
    ]
