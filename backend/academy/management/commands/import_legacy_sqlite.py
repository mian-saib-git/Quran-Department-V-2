import json
import re
import sqlite3
from pathlib import Path
from datetime import datetime, time

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from academy.models import (
    Attendance,
    ClassSchedule,
    StudentProfile,
    StudentSubject,
    SubjectName,
    TeacherProfile,
)


def clean_text(value, default=""):
    if value is None:
        return default
    return str(value).strip()


def safe_json_list(value):
    try:
        parsed = json.loads(value or "[]")
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def slug_username(value, fallback):
    raw = clean_text(value).lower()
    raw = re.sub(r"[^a-z0-9_]+", "_", raw)
    raw = re.sub(r"_+", "_", raw).strip("_")
    return raw or fallback


def unique_username(User, base):
    username = base[:140] or "user"
    candidate = username
    n = 1

    while User.objects.filter(username=candidate).exists():
        n += 1
        suffix = f"_{n}"
        candidate = f"{username[:140 - len(suffix)]}{suffix}"

    return candidate


def parse_date(value):
    value = clean_text(value)
    if not value:
        return None

    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            pass

    return None


def parse_time(value):
    value = clean_text(value)
    if not value:
        return time(16, 0)

    value = value.split(".")[0]

    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(value, fmt).time()
        except ValueError:
            pass

    return time(16, 0)


def normalize_status(value):
    value = clean_text(value).lower()

    if value in ["present", "p"]:
        return Attendance.Status.PRESENT
    if value in ["absent", "a"]:
        return Attendance.Status.ABSENT
    if value in ["leave", "l"]:
        return Attendance.Status.LEAVE

    return Attendance.Status.PRESENT


def normalize_entity_type(value):
    value = clean_text(value).lower()

    if value == "teacher":
        return Attendance.EntityType.TEACHER
    if value == "student":
        return Attendance.EntityType.STUDENT

    return value


def normalize_weekday(value):
    value = clean_text(value).lower()

    mapping = {
        "monday": ClassSchedule.WeekDay.MONDAY,
        "tuesday": ClassSchedule.WeekDay.TUESDAY,
        "wednesday": ClassSchedule.WeekDay.WEDNESDAY,
        "thursday": ClassSchedule.WeekDay.THURSDAY,
        "friday": ClassSchedule.WeekDay.FRIDAY,
        "saturday": ClassSchedule.WeekDay.SATURDAY,
        "sunday": ClassSchedule.WeekDay.SUNDAY,
    }

    return mapping.get(value)


def normalize_subject(value):
    value = clean_text(value)

    valid = {choice[0] for choice in SubjectName.choices}
    if value in valid:
        return value, ""

    lower_map = {
        "qaida": SubjectName.QAIDA,
        "qaida nooraniyya": SubjectName.QAIDA,
        "nazira": SubjectName.NAZIRA,
        "nazira quran": SubjectName.NAZIRA,
        "quran memorization": SubjectName.MEMORIZATION,
        "memorization": SubjectName.MEMORIZATION,
        "hifz": SubjectName.MEMORIZATION,
        "tajweed": SubjectName.TAJWEED,
        "duas": SubjectName.DUAS,
        "duas & sunnah": SubjectName.DUAS,
        "arabic": SubjectName.ARABIC,
        "arabic basics": SubjectName.ARABIC,
    }

    mapped = lower_map.get(value.lower())
    if mapped:
        return mapped, ""

    if value:
        return SubjectName.OTHER, value

    return SubjectName.NAZIRA, ""


class Command(BaseCommand):
    help = "Import old server/quran-academy.db SQLite data into Django PostgreSQL."

    def add_arguments(self, parser):
        parser.add_argument(
            "--sqlite-path",
            default=None,
            help="Path to old quran-academy.db. Defaults to project root/server/quran-academy.db",
        )
        parser.add_argument(
            "--reset-academy",
            action="store_true",
            help="Delete existing academy teachers/students/schedules/attendance before import. Does not delete coordinator users.",
        )

    def handle(self, *args, **options):
        backend_dir = Path(__file__).resolve().parents[3]
        project_root = backend_dir.parent

        sqlite_path = options["sqlite_path"]
        if sqlite_path:
            sqlite_path = Path(sqlite_path)
        else:
            sqlite_path = project_root / "server" / "quran-academy.db"

        if not sqlite_path.exists():
            raise FileNotFoundError(f"SQLite database not found: {sqlite_path}")

        User = get_user_model()

        self.stdout.write(self.style.WARNING(f"Importing from: {sqlite_path}"))

        conn = sqlite3.connect(str(sqlite_path))
        conn.row_factory = sqlite3.Row

        teacher_rows = conn.execute("SELECT * FROM teachers").fetchall()
        student_rows = conn.execute("SELECT * FROM students").fetchall()
        attendance_rows = conn.execute("SELECT * FROM attendance").fetchall()

        self.stdout.write(f"Found teachers: {len(teacher_rows)}")
        self.stdout.write(f"Found students: {len(student_rows)}")
        self.stdout.write(f"Found attendance records: {len(attendance_rows)}")

        teacher_map = {}
        student_map = {}

        with transaction.atomic():
            if options["reset_academy"]:
                self.stdout.write(self.style.WARNING("Resetting academy data..."))

                Attendance.objects.all().delete()
                ClassSchedule.objects.all().delete()
                StudentSubject.objects.all().delete()
                StudentProfile.objects.all().delete()
                TeacherProfile.objects.all().delete()

                User.objects.filter(role__in=["teacher", "student"]).delete()

            coordinator = (
                User.objects.filter(role="coordinator", is_superuser=True).first()
                or User.objects.filter(role="coordinator").first()
                or User.objects.filter(is_superuser=True).first()
            )

            if not coordinator:
                raise RuntimeError("No coordinator/superuser found. Create coordinator first.")

            # -----------------------------
            # Import teachers
            # -----------------------------
            for row in teacher_rows:
                old_id = clean_text(row["id"])
                name = clean_text(row["name"], "Teacher")
                email = clean_text(row["email"])
                login_pin = clean_text(row["login_pin"]) or "teacher123"

                base_username = slug_username(name, f"teacher_{old_id[:8]}")
                username = unique_username(User, base_username)

                user = User.objects.create_user(
                    username=username,
                    email=email,
                    password=login_pin,
                    role="teacher",
                    first_name=name,
                )

                teacher = TeacherProfile.objects.create(
                    user=user,
                    father_name=clean_text(row["father_name"]),
                    phone=clean_text(row["phone"]),
                    address=clean_text(row["address"]),
                    joining_date=parse_date(row["joining_date"]),
                    notes=clean_text(row["notes"]),
                    zoom_link="",
                )

                teacher_map[old_id] = {
                    "profile": teacher,
                    "subjects": safe_json_list(row["subjects"]),
                    "login_password": login_pin,
                    "username": username,
                }

            # -----------------------------
            # Import students
            # -----------------------------
            for row in student_rows:
                old_id = clean_text(row["id"])
                old_teacher_id = clean_text(row["teacher_id"])
                name = clean_text(row["name"], "Student")
                login_id = clean_text(row["login_id"]) or f"student_{old_id[:8]}"

                teacher_info = teacher_map.get(old_teacher_id)
                if not teacher_info:
                    self.stdout.write(
                        self.style.WARNING(
                            f"Skipping student {name}: teacher not found for old teacher id {old_teacher_id}"
                        )
                    )
                    continue

                teacher = teacher_info["profile"]

                base_username = slug_username(login_id, f"student_{old_id[:8]}")
                username = unique_username(User, base_username)

                user = User.objects.create_user(
                    username=username,
                    email="",
                    password=login_id,
                    role="student",
                    first_name=name,
                )

                student = StudentProfile.objects.create(
                    user=user,
                    teacher=teacher,
                    phone="",
                    notes=f"Legacy login ID: {login_id}",
                )

                student_map[old_id] = {
                    "profile": student,
                    "username": username,
                    "login_password": login_id,
                    "old_teacher_id": old_teacher_id,
                }

                # Class schedules from old class_days + time_slot
                class_days = safe_json_list(row["class_days"])
                class_time = parse_time(row["time_slot"])

                for day in class_days:
                    weekday = normalize_weekday(day)
                    if not weekday:
                        continue

                    ClassSchedule.objects.get_or_create(
                        student=student,
                        teacher=teacher,
                        weekday=weekday,
                        time_slot=class_time,
                        defaults={"is_active": True},
                    )

                # Student subjects
                teacher_subjects = teacher_info.get("subjects") or []

                if not teacher_subjects:
                    teacher_subjects = [SubjectName.NAZIRA]

                for subject_raw in teacher_subjects:
                    subject, custom = normalize_subject(subject_raw)

                    StudentSubject.objects.get_or_create(
                        student=student,
                        subject=subject,
                        custom_subject_name=custom,
                        defaults={
                            "is_active": True,
                            "notes": "Imported from legacy teacher subjects.",
                        },
                    )

            # -----------------------------
            # Import attendance
            # -----------------------------
            imported_attendance = 0
            skipped_attendance = 0

            for row in attendance_rows:
                entity_type = normalize_entity_type(row["entity_type"])
                old_entity_id = clean_text(row["entity_id"])
                date_value = parse_date(row["date"])
                status_value = normalize_status(row["status"])

                if not date_value:
                    skipped_attendance += 1
                    continue

                if entity_type == Attendance.EntityType.TEACHER:
                    teacher_info = teacher_map.get(old_entity_id)
                    if not teacher_info:
                        skipped_attendance += 1
                        continue

                    teacher = teacher_info["profile"]

                    # Old SQLite tracked teacher attendance by class_key/time.
                    # Current Django model tracks one teacher attendance per day.
                    Attendance.objects.update_or_create(
                        entity_type=Attendance.EntityType.TEACHER,
                        teacher=teacher,
                        date=date_value,
                        defaults={
                            "student": None,
                            "status": status_value,
                            "marked_by": coordinator,
                        },
                    )
                    imported_attendance += 1

                elif entity_type == Attendance.EntityType.STUDENT:
                    student_info = student_map.get(old_entity_id)
                    if not student_info:
                        skipped_attendance += 1
                        continue

                    student = student_info["profile"]

                    Attendance.objects.update_or_create(
                        entity_type=Attendance.EntityType.STUDENT,
                        student=student,
                        date=date_value,
                        defaults={
                            "teacher": None,
                            "status": status_value,
                            "marked_by": coordinator,
                        },
                    )
                    imported_attendance += 1

                else:
                    skipped_attendance += 1

        conn.close()

        self.stdout.write(self.style.SUCCESS("Import completed successfully."))
        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"Teachers imported: {TeacherProfile.objects.count()}"))
        self.stdout.write(self.style.SUCCESS(f"Students imported: {StudentProfile.objects.count()}"))
        self.stdout.write(self.style.SUCCESS(f"Schedules imported: {ClassSchedule.objects.count()}"))
        self.stdout.write(self.style.SUCCESS(f"Student subjects imported: {StudentSubject.objects.count()}"))
        self.stdout.write(self.style.SUCCESS(f"Attendance imported/updated: {imported_attendance}"))
        self.stdout.write(self.style.WARNING(f"Attendance skipped: {skipped_attendance}"))
        self.stdout.write("")
        self.stdout.write(self.style.WARNING("Teacher login password = old teacher login_pin."))
        self.stdout.write(self.style.WARNING("Student login password = old student login_id."))