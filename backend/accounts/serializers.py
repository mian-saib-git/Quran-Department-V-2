import calendar
from django.utils import timezone
from rest_framework import serializers

from .models import User, UserDepartmentRole
from academy.models import (
    TeacherProfile,
    StudentProfile,
    StudentSubject,
    ClassSchedule,
    StudentClassHistory,
)
from django.db import transaction
from academy.student_state_history_service import sync_student_state_history


SUBJECT_CHOICES = [
    "Qaida Nooraniyya",
    "Nazira Quran",
    "Quran Memorization",
    "Tajweed",
    "Duas & Sunnah",
    "Arabic Basics",
    "Other",
]


SUBJECT_ALIASES = {
    "qaida": "Qaida Nooraniyya",
    "qaida nooraniyya": "Qaida Nooraniyya",
    "noorani qaida": "Qaida Nooraniyya",
    "nooraniyya": "Qaida Nooraniyya",

    "nazira": "Nazira Quran",
    "nazira quran": "Nazira Quran",
    "quran nazira": "Nazira Quran",

    "memorization": "Quran Memorization",
    "quran memorization": "Quran Memorization",
    "hifz": "Quran Memorization",
    "hifz quran": "Quran Memorization",

    "tajweed": "Tajweed",

    "duas": "Duas & Sunnah",
    "dua": "Duas & Sunnah",
    "duas & sunnah": "Duas & Sunnah",
    "duas and sunnah": "Duas & Sunnah",
    "sunnah": "Duas & Sunnah",

    "arabic": "Arabic Basics",
    "arabic basics": "Arabic Basics",

    "other": "Other",
}


def normalize_subject(value):
    """
    Accepts subject values from the frontend in a flexible way.
    Returns a valid StudentSubject.subject value or "".
    """
    raw = str(value or "").strip()

    if not raw:
        return ""

    if raw in SUBJECT_CHOICES:
        return raw

    lowered = raw.lower().strip()

    return SUBJECT_ALIASES.get(lowered, "")


def user_basic_payload(user):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": user.get_full_name() or user.username,
        "role": user.role,
        "is_active": user.is_active,
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
    }


def teacher_account_payload(teacher):
    user = teacher.user

    return {
        **user_basic_payload(user),
        "teacher_profile": {
            "id": teacher.id,
            "father_name": teacher.father_name,
            "phone": teacher.phone,
            "address": teacher.address,
            "joining_date": str(teacher.joining_date) if teacher.joining_date else "",
            "notes": teacher.notes,
            "zoom_link": teacher.zoom_link,
        },
    }

def schedule_payload_for_student(student):
    day_order = {
        "monday": 1,
        "tuesday": 2,
        "wednesday": 3,
        "thursday": 4,
        "friday": 5,
        "saturday": 6,
        "sunday": 7,
    }

    raw_schedules = getattr(student, "prefetched_active_schedules", None)

    if raw_schedules is None:
        raw_schedules = list(
            student.schedules.filter(is_active=True)
            .select_related("teacher__user")
            .order_by("time_slot", "weekday", "id")
        )

    active_schedules = list(raw_schedules)

    active_schedules.sort(
        key=lambda item: (
            item.time_slot,
            day_order.get(str(item.weekday).lower(), 99),
            item.id,
        )
    )

    schedules = []

    for item in active_schedules:
        schedules.append({
            "id": item.id,
            "teacher_id": item.teacher_id,
            "teacher_name": str(item.teacher),
            "weekday": item.weekday,
            "weekday_display": item.get_weekday_display(),
            "time_slot": item.time_slot.strftime("%H:%M"),
            "duration_minutes": getattr(item, "duration_minutes", 30) or 30,
            "is_active": item.is_active,
        })

    class_days = []
    seen_days = set()

    schedules_by_day = sorted(
        schedules,
        key=lambda item: day_order.get(str(item["weekday"]).lower(), 99),
    )

    for item in schedules_by_day:
        day = item["weekday_display"]
        if day not in seen_days:
            class_days.append(day)
            seen_days.add(day)

    time_slot = schedules[0]["time_slot"] if schedules else ""
    duration_minutes = schedules[0]["duration_minutes"] if schedules else 30

    return {
        "schedules": schedules,
        "class_days": class_days,
        "time_slot": time_slot,
        "duration_minutes": duration_minutes,
    }

def sync_student_schedules(student, teacher, time_slot, class_days, duration_minutes=30):
    if not time_slot or not class_days:
        return

    try:
        duration_minutes = int(duration_minutes or 30)
    except (TypeError, ValueError):
        duration_minutes = 30

    if duration_minutes not in [30, 60]:
        duration_minutes = 30

    ClassSchedule.objects.filter(student=student).delete()

    valid_days = {
        "monday": ClassSchedule.WeekDay.MONDAY,
        "tuesday": ClassSchedule.WeekDay.TUESDAY,
        "wednesday": ClassSchedule.WeekDay.WEDNESDAY,
        "thursday": ClassSchedule.WeekDay.THURSDAY,
        "friday": ClassSchedule.WeekDay.FRIDAY,
        "saturday": ClassSchedule.WeekDay.SATURDAY,
        "sunday": ClassSchedule.WeekDay.SUNDAY,
    }

    for day in class_days:
        key = str(day or "").strip().lower()
        weekday = valid_days.get(key)

        if not weekday:
            continue

        ClassSchedule.objects.create(
            student=student,
            teacher=teacher,
            weekday=weekday,
            time_slot=time_slot,
            duration_minutes=duration_minutes,
            is_active=True,
        )

def _is_night_time(value):
    raw = str(value or "")[:5]
    if not raw or ":" not in raw:
        return False
    try:
        hours, minutes = [int(part) for part in raw.split(":", 1)]
    except (TypeError, ValueError):
        return False
    total = hours * 60 + minutes
    return total >= (22 * 60) or total <= (8 * 60 + 30)


def _student_history(
    *,
    student,
    event_type,
    actor=None,
    previous_teacher=None,
    new_teacher=None,
    previous_student_type="",
    new_student_type="",
    previous_class_status="",
    new_class_status="",
    notes="",
    effective_date=None,
):
    StudentClassHistory.objects.create(
        institution=student.institution or getattr(student.user, "institution", None),
        department=student.department or getattr(student.user, "department", None),
        student=student,
        event_type=event_type,
        effective_date=effective_date or timezone.localdate(),
        previous_teacher=previous_teacher,
        new_teacher=new_teacher,
        previous_student_type=previous_student_type or "",
        new_student_type=new_student_type or "",
        previous_class_status=previous_class_status or "",
        new_class_status=new_class_status or "",
        notes=str(notes or "").strip(),
        created_by=actor,
    )


def _sync_schedule_activity_for_status(student):
    dropped_statuses = {
        StudentProfile.ClassStatus.OLD_DROPPED,
        StudentProfile.ClassStatus.TRIAL_DROPPED,
        StudentProfile.ClassStatus.OLD_DROPPED_OTHER,
    }
    student.schedules.update(is_active=student.class_status not in dropped_statuses)


def student_account_payload(student):
    user = student.user

    raw_subjects = getattr(student, "prefetched_active_subjects", None)

    if raw_subjects is None:
        raw_subjects = student.assigned_subjects.filter(is_active=True).order_by(
            "subject",
            "custom_subject_name",
            "id",
        )

    assigned_subjects = [
        {
            "id": item.id,
            "subject": item.subject,
            "custom_subject_name": item.custom_subject_name,
            "display_name": item.display_name,
            "is_active": item.is_active,
            "notes": item.notes,
        }
        for item in raw_subjects
    ]

    schedule_data = schedule_payload_for_student(student)

    return {
        **user_basic_payload(user),
        "student_profile": {
            "id": student.id,
            "phone": student.phone,
            "notes": student.notes,
            "teacher_id": student.teacher_id,
            "teacher_name": str(student.teacher),
            "assigned_subjects": assigned_subjects,

            "schedules": schedule_data["schedules"],
            "class_days": schedule_data["class_days"],
            "time_slot": schedule_data["time_slot"],
            "duration_minutes": schedule_data["duration_minutes"],
            "student_type": student.student_type,
            "student_type_label": student.get_student_type_display(),
            "class_status": student.class_status,
            "class_status_label": student.get_class_status_display(),
            "speaking_language": student.speaking_language,
            "speaking_language_label": student.get_speaking_language_display(),
            "first_fee_paid": student.first_fee_paid,
            "referral_teacher_id": student.referral_teacher_id,
            "referral_teacher_name": str(student.referral_teacher) if student.referral_teacher else "",
            "referral_student_id": student.referral_student_id,
            "referral_student_name": str(student.referral_student) if student.referral_student else "",
            "status_effective_date": str(student.status_effective_date) if student.status_effective_date else "",
            "salary_class_mode": student.salary_class_mode,
            "salary_class_mode_label": student.get_salary_class_mode_display(),
            "half_month_salary_amount": str(student.half_month_salary_amount or 0),
            "is_night_class": any(_is_night_time(item.get("time_slot")) for item in schedule_data["schedules"]),
        },
    }


def account_payload_for_user(user):
    if user.role == User.Role.TEACHER:
        try:
            return teacher_account_payload(user.teacher_profile)
        except TeacherProfile.DoesNotExist:
            return {
                **user_basic_payload(user),
                "teacher_profile": None,
            }

    if user.role == User.Role.STUDENT:
        try:
            return student_account_payload(user.student_profile)
        except StudentProfile.DoesNotExist:
            return {
                **user_basic_payload(user),
                "student_profile": None,
            }

    return user_basic_payload(user)


def sync_student_subjects(student, subjects):
    """
    Sync active subjects for a student.

    This accepts different frontend shapes:
    - {"subject": "Nazira Quran"}
    - {"display_name": "Nazira Quran"}
    - {"name": "Nazira Quran"}
    - "Nazira Quran"
    """
    if not isinstance(subjects, list):
        return

    StudentSubject.objects.filter(student=student).update(is_active=False)

    for item in subjects:
        if isinstance(item, dict):
            raw_subject = (
                item.get("subject")
                or item.get("display_name")
                or item.get("displayName")
                or item.get("name")
                or ""
            )
            custom_subject_name = str(item.get("custom_subject_name", "") or "").strip()
            notes = str(item.get("notes", "") or "").strip()
        else:
            raw_subject = item
            custom_subject_name = ""
            notes = ""

        subject = normalize_subject(raw_subject)

        if not subject:
            continue

        if subject == "Other" and not custom_subject_name:
            custom_subject_name = "Other"

        obj, _created = StudentSubject.objects.get_or_create(
            student=student,
            subject=subject,
            custom_subject_name=custom_subject_name,
            defaults={
                "notes": notes,
                "is_active": True,
            },
        )

        obj.notes = notes
        obj.is_active = True
        obj.save()


class CreateAccountSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=["coordinator", "teacher", "student"])

    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128, write_only=True)
    email = serializers.EmailField(required=False, allow_blank=True)

    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)

    father_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    address = serializers.CharField(required=False, allow_blank=True)
    joining_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    zoom_link = serializers.URLField(required=False, allow_blank=True)

    teacher_id = serializers.IntegerField(required=False, allow_null=True)

    time_slot = serializers.TimeField(required=False, allow_null=True)
    duration_minutes = serializers.IntegerField(required=False, min_value=30, max_value=60)
    class_days = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        allow_empty=True,
    )

    assigned_subjects = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        allow_empty=True,
    )
    student_type = serializers.ChoiceField(
        choices=StudentProfile.StudentType.choices,
        required=False,
        default=StudentProfile.StudentType.TRIAL_STUDENT,
    )
    class_status = serializers.ChoiceField(
        choices=StudentProfile.ClassStatus.choices,
        required=False,
        default=StudentProfile.ClassStatus.RUNNING,
    )
    speaking_language = serializers.ChoiceField(
        choices=StudentProfile.SpeakingLanguage.choices,
        required=False,
        default=StudentProfile.SpeakingLanguage.URDU,
    )
    first_fee_paid = serializers.BooleanField(required=False, default=False)
    # referral_teacher_id remains accepted for backward compatibility only.
    referral_teacher_id = serializers.IntegerField(required=False, allow_null=True)
    referral_student_id = serializers.IntegerField(required=False, allow_null=True)
    previous_teacher_id = serializers.IntegerField(required=False, allow_null=True)
    not_counted_class = serializers.BooleanField(required=False, allow_null=True)

    def validate_username(self, value):
        value = value.strip()

        if not value:
            raise serializers.ValidationError("Username is required.")

        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("This username already exists.")

        return value

    def validate_password(self, value):
        if not value or len(value) < 6:
            raise serializers.ValidationError("Password must be at least 6 characters.")
        return value

    def validate(self, attrs):
        role = attrs.get("role")

        if role == "student":
            teacher_id = attrs.get("teacher_id")

            if not teacher_id:
                raise serializers.ValidationError({
                    "teacher_id": "teacher_id is required for student accounts."
                })

            if not TeacherProfile.objects.filter(id=teacher_id).exists():
                raise serializers.ValidationError({
                    "teacher_id": "Selected teacher does not exist."
                })

            request_user = self.context.get("request_user")
            department = getattr(request_user, "department", None) if request_user else None

            referral_student_id = attrs.get("referral_student_id")
            if referral_student_id:
                referral_students = StudentProfile.objects.select_related("teacher", "user").filter(
                    id=referral_student_id,
                    user__is_active=True,
                )
                if department:
                    referral_students = referral_students.filter(department=department)
                if not referral_students.exists():
                    raise serializers.ValidationError({
                        "referral_student_id": "Selected referring student does not exist in this department."
                    })

            previous_teacher_id = attrs.get("previous_teacher_id")
            if attrs.get("student_type") == StudentProfile.StudentType.TRANSFERRED_FROM_TEACHER:
                if not previous_teacher_id:
                    raise serializers.ValidationError({
                        "previous_teacher_id": "Select the teacher this student was transferred from."
                    })
                previous_teachers = TeacherProfile.objects.filter(id=previous_teacher_id)
                if department:
                    previous_teachers = previous_teachers.filter(department=department)
                if not previous_teachers.exists():
                    raise serializers.ValidationError({
                        "previous_teacher_id": "Selected previous teacher does not exist in this department."
                    })
                if int(previous_teacher_id) == int(teacher_id):
                    raise serializers.ValidationError({
                        "previous_teacher_id": "Previous teacher and assigned teacher must be different."
                    })

            # New students always begin as Running unless the dedicated
            # Not Counted Class rule applies. Class Status is intentionally not
            # exposed in the Add Student card.
            attrs["class_status"] = StudentProfile.ClassStatus.RUNNING

            if (
                attrs.get("first_fee_paid")
                and attrs.get("student_type", StudentProfile.StudentType.TRIAL_STUDENT)
                == StudentProfile.StudentType.TRIAL_STUDENT
            ):
                attrs["student_type"] = StudentProfile.StudentType.OLD_STUDENT

            today = timezone.localdate()
            last_day = calendar.monthrange(today.year, today.month)[1]
            auto_not_counted = (last_day - today.day) <= 4
            requested_not_counted = attrs.get("not_counted_class")
            if requested_not_counted is True or (requested_not_counted is None and auto_not_counted):
                attrs["class_status"] = StudentProfile.ClassStatus.NOT_COUNTED

        return attrs

    def create(self, validated_data):
        role = validated_data["role"]

        creator = self.context.get("request_user")
        institution = getattr(creator, "institution", None) if creator else None
        department = getattr(creator, "department", None) if creator else None

        user = User.objects.create(
            username=validated_data["username"].strip(),
            email=validated_data.get("email", "").strip(),
            first_name=validated_data.get("first_name", "").strip(),
            last_name=validated_data.get("last_name", "").strip(),
            role=role,
            institution=institution,
            department=department,
            is_active=True,
        )
        user.set_password(validated_data["password"])
        user.save()

        if institution and department:
            UserDepartmentRole.objects.get_or_create(
                user=user,
                institution=institution,
                department=department,
                role=role,
                defaults={"is_active": True},
            )

        if role == "coordinator":
            return account_payload_for_user(user)

        if role == "teacher":
            teacher = TeacherProfile.objects.create(
                user=user,
                institution=institution,
                department=department,
                father_name=validated_data.get("father_name", "").strip(),
                phone=validated_data.get("phone", "").strip(),
                address=validated_data.get("address", "").strip(),
                joining_date=validated_data.get("joining_date"),
                notes=validated_data.get("notes", "").strip(),
                zoom_link=validated_data.get("zoom_link", "").strip(),
            )
            return account_payload_for_user(teacher.user)

        teacher = TeacherProfile.objects.get(id=validated_data["teacher_id"])

        referral_student = None
        referral_teacher = None
        referral_student_id = validated_data.get("referral_student_id")
        if referral_student_id:
            referral_student = StudentProfile.objects.select_related("teacher").get(id=referral_student_id)
            # Salary credit is frozen to the referring student's teacher at the
            # time of enrollment, while the visible referral source remains the
            # student selected by the administrator.
            referral_teacher = referral_student.teacher
        elif validated_data.get("referral_teacher_id"):
            # Backward-compatible API support. New frontend requests use
            # referral_student_id instead.
            referral_teacher = TeacherProfile.objects.get(id=validated_data["referral_teacher_id"])

        previous_teacher = None
        previous_teacher_id = validated_data.get("previous_teacher_id")
        if previous_teacher_id:
            previous_teacher = TeacherProfile.objects.get(id=previous_teacher_id)

        student = StudentProfile.objects.create(
            user=user,
            institution=institution,
            department=department,
            teacher=teacher,
            phone=validated_data.get("phone", "").strip(),
            notes=validated_data.get("notes", "").strip(),
            student_type=validated_data.get("student_type", StudentProfile.StudentType.TRIAL_STUDENT),
            class_status=validated_data.get("class_status", StudentProfile.ClassStatus.RUNNING),
            speaking_language=validated_data.get("speaking_language", StudentProfile.SpeakingLanguage.URDU),
            first_fee_paid=bool(validated_data.get("first_fee_paid", False)),
            referral_teacher=referral_teacher,
            referral_student=referral_student,
            status_effective_date=timezone.localdate(),
            salary_class_mode=StudentProfile.SalaryClassMode.STANDARD,
            half_month_salary_amount=0,
        )

        _student_history(
            student=student,
            event_type=StudentClassHistory.EventType.ENROLLED,
            actor=creator,
            new_teacher=teacher,
            new_student_type=student.student_type,
            new_class_status=student.class_status,
            notes="Student account created.",
            effective_date=timezone.localdate(),
        )

        if previous_teacher and previous_teacher.id != teacher.id:
            _student_history(
                student=student,
                event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
                actor=creator,
                previous_teacher=previous_teacher,
                new_teacher=teacher,
                previous_student_type=StudentProfile.StudentType.OLD_STUDENT,
                new_student_type=StudentProfile.StudentType.TRANSFERRED_FROM_TEACHER,
                previous_class_status=StudentProfile.ClassStatus.RUNNING,
                new_class_status=student.class_status,
                notes=f"Student transferred from {previous_teacher} during enrollment.",
                effective_date=timezone.localdate(),
            )

        sync_student_subjects(student, validated_data.get("assigned_subjects", []))

        sync_student_schedules(
            student=student,
            teacher=teacher,
            time_slot=validated_data.get("time_slot"),
            class_days=validated_data.get("class_days", []),
            duration_minutes=validated_data.get("duration_minutes", 30),
        )
        _sync_schedule_activity_for_status(student)

        return account_payload_for_user(student.user)

class UpdateAccountSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, required=False)
    password = serializers.CharField(max_length=128, required=False, write_only=True)
    email = serializers.EmailField(required=False, allow_blank=True)

    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)

    father_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    address = serializers.CharField(required=False, allow_blank=True)
    joining_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    zoom_link = serializers.URLField(required=False, allow_blank=True)

    teacher_id = serializers.IntegerField(required=False, allow_null=True)
    transfer_to_teacher_id = serializers.IntegerField(required=False, allow_null=True)

    time_slot = serializers.TimeField(required=False, allow_null=True)
    duration_minutes = serializers.IntegerField(required=False, min_value=30, max_value=60)
    class_days = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        allow_empty=True,
    )

    assigned_subjects = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        allow_empty=True,
    )
    student_type = serializers.ChoiceField(choices=StudentProfile.StudentType.choices, required=False)
    class_status = serializers.ChoiceField(choices=StudentProfile.ClassStatus.choices, required=False)
    speaking_language = serializers.ChoiceField(choices=StudentProfile.SpeakingLanguage.choices, required=False)
    first_fee_paid = serializers.BooleanField(required=False)

    def validate(self, attrs):
        transfer_to_teacher_id = attrs.get("transfer_to_teacher_id")
        if transfer_to_teacher_id:
            user = self.context["user"]
            student = getattr(user, "student_profile", None)
            queryset = TeacherProfile.objects.filter(id=transfer_to_teacher_id)
            if student and student.department_id:
                queryset = queryset.filter(department_id=student.department_id)
            target = queryset.first()
            if not target:
                raise serializers.ValidationError({
                    "transfer_to_teacher_id": "Selected target teacher does not exist in this department."
                })
            if student and target.id == student.teacher_id:
                raise serializers.ValidationError({
                    "transfer_to_teacher_id": "Select a different teacher for the transfer."
                })
        if attrs.get("student_type") == StudentProfile.StudentType.TRANSFERRED_TO_TEACHER and not transfer_to_teacher_id:
            raise serializers.ValidationError({
                "transfer_to_teacher_id": "Select the teacher who will receive this student."
            })

        requested_class_status = attrs.get("class_status")
        controlled_dropped_statuses = {
            StudentProfile.ClassStatus.OLD_DROPPED,
            StudentProfile.ClassStatus.TRIAL_DROPPED,
            StudentProfile.ClassStatus.OLD_DROPPED_OTHER,
        }

        if requested_class_status in controlled_dropped_statuses:
            raise serializers.ValidationError({
                "class_status": (
                    "Dropped status is controlled by attendance/drop workflow "
                    "and cannot be set manually."
                )
            })

        context_user = self.context.get("user")
        context_student = getattr(
            context_user,
            "student_profile",
            None,
        )

        if (
            context_student
            and context_student.class_status in controlled_dropped_statuses
            and requested_class_status is not None
            and requested_class_status != context_student.class_status
        ):
            raise serializers.ValidationError({
                "class_status": (
                    "A dropped student cannot be reactivated from the ordinary "
                    "account editor. Use the controlled rejoin workflow."
                )
            })

        return attrs

    def validate_username(self, value):
        value = value.strip()
        user = self.context["user"]

        if not value:
            raise serializers.ValidationError("Username is required.")

        exists = User.objects.filter(username__iexact=value).exclude(id=user.id).exists()

        if exists:
            raise serializers.ValidationError("This username already exists.")

        return value

    def validate_password(self, value):
        if value and len(value) < 6:
            raise serializers.ValidationError("Password must be at least 6 characters.")
        return value

    @transaction.atomic
    def update(self, user, validated_data):
        if "username" in validated_data:
            user.username = validated_data["username"].strip()

        if "email" in validated_data:
            user.email = validated_data["email"].strip()

        if "first_name" in validated_data:
            user.first_name = validated_data["first_name"].strip()

        if "last_name" in validated_data:
            user.last_name = validated_data["last_name"].strip()

        if "is_active" in validated_data:
            user.is_active = validated_data["is_active"]

        if validated_data.get("password"):
            user.set_password(validated_data["password"])

        user.save()

        if user.role == User.Role.COORDINATOR:
            return account_payload_for_user(user)

        if user.role == User.Role.TEACHER:
            teacher, _created = TeacherProfile.objects.get_or_create(user=user)

            for field in [
                "father_name",
                "phone",
                "address",
                "joining_date",
                "notes",
                "zoom_link",
            ]:
                if field in validated_data:
                    setattr(teacher, field, validated_data[field])

            teacher.save()

        if user.role == User.Role.STUDENT:
            student = user.student_profile
            actor = self.context.get("request_user")
            previous_teacher = student.teacher
            previous_student_type = student.student_type
            previous_class_status = student.class_status
            previous_fee_paid = student.first_fee_paid
            desired_class_status = validated_data.pop(
                "class_status",
                None,
            )
            teacher = student.teacher
            transfer_to_teacher_id = validated_data.pop("transfer_to_teacher_id", None)

            if transfer_to_teacher_id:
                teacher = TeacherProfile.objects.get(id=transfer_to_teacher_id)
                student.teacher = teacher
                # The destination teacher sees this class as Transferred In.
                # The source teacher receives a distinct Transferred Out outcome
                # through the teacher-transfer history event.
                validated_data.pop("student_type", None)
                student.student_type = StudentProfile.StudentType.TRANSFERRED_FROM_TEACHER
            elif "teacher_id" in validated_data and validated_data["teacher_id"]:
                teacher = TeacherProfile.objects.get(id=validated_data["teacher_id"])
                student.teacher = teacher
                if teacher.id != previous_teacher.id and "student_type" not in validated_data:
                    student.student_type = StudentProfile.StudentType.TRANSFERRED_FROM_TEACHER

            if "phone" in validated_data:
                student.phone = validated_data["phone"].strip()

            if "notes" in validated_data:
                student.notes = validated_data["notes"].strip()

            for field in [
                "student_type",
                "speaking_language",
                "first_fee_paid",
            ]:
                if field in validated_data:
                    value = validated_data[field]
                    if field == "student_type" and value == StudentProfile.StudentType.TRANSFERRED_TO_TEACHER:
                        continue
                    setattr(student, field, value)

            if (
                validated_data.get("first_fee_paid")
                and student.student_type == StudentProfile.StudentType.TRIAL_STUDENT
            ):
                student.student_type = StudentProfile.StudentType.OLD_STUDENT

            if (
                previous_class_status == StudentProfile.ClassStatus.ON_LEAVE
                and desired_class_status == StudentProfile.ClassStatus.RUNNING
                and "student_type" not in validated_data
            ):
                student.student_type = StudentProfile.StudentType.RETURNED_FROM_LEAVE

            if (
                teacher.id != previous_teacher.id
                or student.student_type != previous_student_type
            ):
                student.status_effective_date = timezone.localdate()

            student.institution = student.institution or getattr(user, "institution", None)
            student.department = student.department or getattr(user, "department", None)
            student.save()

            if teacher.id != previous_teacher.id:
                _student_history(
                    student=student,
                    event_type=StudentClassHistory.EventType.TEACHER_TRANSFER,
                    actor=actor,
                    previous_teacher=previous_teacher,
                    new_teacher=teacher,
                    previous_student_type=previous_student_type,
                    new_student_type=student.student_type,
                    previous_class_status=previous_class_status,
                    new_class_status=student.class_status,
                    notes="Class transferred to another teacher.",
                    effective_date=timezone.localdate(),
                )

            if (
                desired_class_status is not None
                and desired_class_status != previous_class_status
            ):
                sync_student_state_history(
                    student=student,
                    effective_date=timezone.localdate(),
                    desired_class_status=desired_class_status,
                    desired_student_type=previous_student_type,
                    actor=actor,
                    note="Class status changed from account editor.",
                )
                student.refresh_from_db()

            if student.student_type != previous_student_type:
                _student_history(
                    student=student,
                    event_type=StudentClassHistory.EventType.STUDENT_TYPE_CHANGED,
                    actor=actor,
                    previous_teacher=previous_teacher,
                    new_teacher=teacher,
                    previous_student_type=previous_student_type,
                    new_student_type=student.student_type,
                    previous_class_status=previous_class_status,
                    new_class_status=student.class_status,
                    effective_date=timezone.localdate(),
                )

            if student.first_fee_paid and not previous_fee_paid:
                _student_history(
                    student=student,
                    event_type=StudentClassHistory.EventType.FIRST_FEE_RECEIVED,
                    actor=actor,
                    new_teacher=teacher,
                    previous_student_type=previous_student_type,
                    new_student_type=student.student_type,
                    previous_class_status=previous_class_status,
                    new_class_status=student.class_status,
                    effective_date=timezone.localdate(),
                )

            _sync_schedule_activity_for_status(student)

            if "assigned_subjects" in validated_data:
                sync_student_subjects(student, validated_data.get("assigned_subjects", []))

            if "time_slot" in validated_data or "class_days" in validated_data or "duration_minutes" in validated_data:
                existing_schedule = student.schedules.filter(is_active=True).order_by("time_slot", "id").first()

                time_slot = validated_data.get("time_slot")
                if not time_slot and existing_schedule:
                    time_slot = existing_schedule.time_slot

                duration_minutes = validated_data.get("duration_minutes", None)
                if duration_minutes is None and existing_schedule:
                    duration_minutes = getattr(existing_schedule, "duration_minutes", 30) or 30
                if duration_minutes is None:
                    duration_minutes = 30

                class_days = validated_data.get("class_days", None)
                if class_days is None:
                    class_days = [
                        item.weekday
                        for item in student.schedules.filter(is_active=True).order_by("weekday", "id")
                    ]

                sync_student_schedules(
                    student=student,
                    teacher=teacher,
                    time_slot=time_slot,
                    class_days=class_days,
                    duration_minutes=duration_minutes,
                )

        return account_payload_for_user(user)
