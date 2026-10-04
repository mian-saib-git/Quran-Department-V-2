from datetime import datetime, timedelta
from django.core.exceptions import (
    ObjectDoesNotExist,
    ValidationError as DjangoValidationError,
)
from django.db import transaction
from django.db.models import Q
from rest_framework import serializers

from accounts.models import (
    User,
    UserDepartmentRole,
)
from academy.models import (
    StudentProfile,
    TeacherProfile,
)

from .models import (
    TuitionClassLevel,
    TuitionEnrollment,
    TuitionSchedule,
    TuitionStandardSlot,
    TuitionSubject,
    TuitionTeacherAvailability,
    TuitionTeacherCapability,
)

from .constants import (
    CLASS_DURATION_MINUTES,
    OPERATING_WEEKDAYS,
)


def display_name(user):
    full_name = (
        f"{user.first_name} {user.last_name}"
    ).strip()

    return full_name or user.username


def user_has_tuition_membership(
    user,
    department,
):
    if not user or not department:
        return False

    if (
        user.department_id == department.id
        and user.is_active
    ):
        return True

    return UserDepartmentRole.objects.filter(
        user=user,
        department=department,
        is_active=True,
    ).exists()


def profile_user_queryset(
    department,
    role,
):
    return (
        User.objects
        .filter(
            role=role,
            institution_id=(
                department.institution_id
            ),
            is_active=True,
        )
        .filter(
            Q(department=department)
            | Q(
                department_roles__department=(
                    department
                ),
                department_roles__is_active=True,
            )
        )
        .distinct()
    )


def tuition_teacher_queryset(department):
    return (
        TeacherProfile.objects
        .select_related("user")
        .filter(
            user__in=profile_user_queryset(
                department,
                User.Role.TEACHER,
            )
        )
        .order_by(
            "user__first_name",
            "user__username",
            "id",
        )
    )


def tuition_student_queryset(department):
    return (
        StudentProfile.objects
        .select_related(
            "user",
            "teacher__user",
        )
        .filter(
            user__in=profile_user_queryset(
                department,
                User.Role.STUDENT,
            )
        )
        .order_by(
            "user__first_name",
            "user__username",
            "id",
        )
    )


def ensure_tuition_role_link(
    user,
    department,
    role,
    active=True,
):
    link, _created = (
        UserDepartmentRole.objects
        .update_or_create(
            user=user,
            institution=department.institution,
            department=department,
            role=role,
            defaults={
                "is_active": active,
            },
        )
    )

    return link


def sync_teacher_capabilities(
    teacher,
    department,
    subject_ids,
    notes="",
    replace=True,
):
    subject_ids = list(
        dict.fromkeys(subject_ids or [])
    )

    subjects = list(
        TuitionSubject.objects
        .filter(
            department=department,
            id__in=subject_ids,
            is_active=True,
        )
        .order_by("sort_order", "name")
    )

    if len(subjects) != len(subject_ids):
        raise serializers.ValidationError({
            "subject_ids":
            "One or more selected subjects are "
            "invalid for this Tuition Department."
        })

    active_ids = []

    for subject in subjects:
        capability, _created = (
            TuitionTeacherCapability.objects
            .update_or_create(
                department=department,
                teacher=teacher,
                subject=subject,
                defaults={
                    "institution":
                        department.institution,
                    "is_active": True,
                    "notes": notes,
                },
            )
        )

        active_ids.append(capability.id)

    if replace:
        (
            TuitionTeacherCapability.objects
            .filter(
                department=department,
                teacher=teacher,
            )
            .exclude(id__in=active_ids)
            .update(is_active=False)
        )

    return (
        TuitionTeacherCapability.objects
        .filter(
            department=department,
            teacher=teacher,
            is_active=True,
        )
        .select_related(
            "teacher__user",
            "subject",
        )
        .order_by(
            "subject__sort_order",
            "subject__name",
        )
    )


def tuition_account_payload(
    user,
    department,
):
    teacher = None
    student = None

    try:
        teacher = user.teacher_profile
    except ObjectDoesNotExist:
        pass

    try:
        student = user.student_profile
    except ObjectDoesNotExist:
        pass

    role_link = (
        UserDepartmentRole.objects
        .filter(
            user=user,
            department=department,
            role=user.role,
        )
        .first()
    )

    capability_rows = []

    if teacher:
        capability_rows = [
            {
                "id": item.id,
                "subject_id": item.subject_id,
                "subject_code":
                    item.subject.code,
                "subject_name":
                    item.subject.name,
                "is_active":
                    item.is_active,
                "notes":
                    item.notes,
            }
            for item in (
                TuitionTeacherCapability.objects
                .filter(
                    department=department,
                    teacher=teacher,
                )
                .select_related("subject")
                .order_by(
                    "subject__sort_order",
                    "subject__name",
                )
            )
        ]

    active_enrollment_count = 0

    if teacher:
        active_enrollment_count = (
            TuitionEnrollment.objects
            .filter(
                department=department,
                teacher=teacher,
                is_active=True,
            )
            .count()
        )

    if student:
        active_enrollment_count = (
            TuitionEnrollment.objects
            .filter(
                department=department,
                student=student,
                is_active=True,
            )
            .count()
        )

    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "full_name": display_name(user),
        "role": user.role,
        "global_is_active": user.is_active,
        "tuition_access_active": bool(
            user.is_active
            and (
                (
                    role_link
                    and role_link.is_active
                )
                or user.department_id
                == department.id
            )
        ),
        "institution_id":
            department.institution_id,
        "department_id":
            department.id,
        "teacher_profile": (
            {
                "id": teacher.id,
                "father_name":
                    teacher.father_name,
                "phone":
                    teacher.phone,
                "address":
                    teacher.address,
                "joining_date":
                    teacher.joining_date,
                "notes":
                    teacher.notes,
                "zoom_link":
                    teacher.zoom_link,
                "capabilities":
                    capability_rows,
            }
            if teacher
            else None
        ),
        "student_profile": (
            {
                "id": student.id,
                "phone": student.phone,
                "notes": student.notes,
                "legacy_primary_teacher_id":
                    student.teacher_id,
                "legacy_primary_teacher_name":
                    display_name(
                        student.teacher.user
                    ),
            }
            if student
            else None
        ),
        "active_enrollment_count":
            active_enrollment_count,
    }


def enrollment_payload(enrollment):
    schedule_start_time = (
        enrollment.schedule_start_time.strftime("%H:%M")
        if getattr(enrollment, "schedule_start_time", None)
        else ""
    )
    schedule_end_time = (
        enrollment.schedule_end_time.strftime("%H:%M")
        if getattr(enrollment, "schedule_end_time", None)
        else ""
    )

    active_schedules = []
    try:
        active_schedules = list(
            enrollment.schedules.filter(is_active=True).order_by("weekday", "start_time")
        )
    except Exception:
        active_schedules = []

    schedule_days = [item.weekday for item in active_schedules]

    return {
        "id": enrollment.id,
        "institution_id": enrollment.institution_id,
        "department_id": enrollment.department_id,
        "student_id": enrollment.student_id,
        "student_user_id": enrollment.student.user_id,
        "student_name": display_name(enrollment.student.user),
        "teacher_id": enrollment.teacher_id,
        "teacher_user_id": enrollment.teacher.user_id,
        "teacher_name": display_name(enrollment.teacher.user),
        "program_type": enrollment.program_type,
        "class_level_id": enrollment.class_level_id,
        "class_name": enrollment.display_class,
        "subject_id": enrollment.subject_id,
        "subject_name": enrollment.display_subject,
        "custom_class_name": enrollment.custom_class_name,
        "custom_subject_name": enrollment.custom_subject_name,
        "start_date": enrollment.start_date,
        "end_date": enrollment.end_date,
        "notes": enrollment.notes,
        "is_active": enrollment.is_active,
        "schedule_country": getattr(enrollment, "schedule_country", "PK") or "PK",
        "schedule_slot": getattr(enrollment, "schedule_slot", "") or "",
        "schedule_label": getattr(enrollment, "schedule_label", "") or "",
        "schedule_start_time": schedule_start_time,
        "schedule_end_time": schedule_end_time,
        "duration_minutes": getattr(enrollment, "duration_minutes", 40) or 40,
        "schedule_days": schedule_days,
        "active_schedule_count": len(active_schedules),
        "created_at": enrollment.created_at,
        "updated_at": enrollment.updated_at,
    }

class TuitionClassLevelSerializer(
    serializers.ModelSerializer
):
    class Meta:
        model = TuitionClassLevel
        fields = [
            "id",
            "code",
            "name",
            "board",
            "sort_order",
            "is_active",
        ]


class TuitionSubjectSerializer(
    serializers.ModelSerializer
):
    class Meta:
        model = TuitionSubject
        fields = [
            "id",
            "code",
            "name",
            "is_standard",
            "sort_order",
            "is_active",
        ]


class TuitionStandardSlotSerializer(
    serializers.ModelSerializer
):
    region_name = serializers.CharField(
        source="get_region_display",
        read_only=True,
    )

    class Meta:
        model = TuitionStandardSlot
        fields = [
            "id",
            "region",
            "region_name",
            "timezone_name",
            "label",
            "start_time",
            "end_time",
            "sort_order",
            "is_active",
        ]


class TuitionTeacherCapabilitySerializer(
    serializers.ModelSerializer
):
    teacher_name = serializers.SerializerMethodField()
    teacher_user_id = serializers.IntegerField(
        source="teacher.user_id",
        read_only=True,
    )
    subject_name = serializers.CharField(
        source="subject.name",
        read_only=True,
    )
    subject_code = serializers.CharField(
        source="subject.code",
        read_only=True,
    )

    class Meta:
        model = TuitionTeacherCapability
        fields = [
            "id",
            "teacher",
            "teacher_user_id",
            "teacher_name",
            "subject",
            "subject_code",
            "subject_name",
            "is_active",
            "notes",
            "available_schedule_slots",
            "created_at",
            "updated_at",
        ]

    def get_teacher_name(self, obj):
        return display_name(obj.teacher.user)


class TuitionCapabilityBulkSerializer(
    serializers.Serializer
):
    teacher_id = serializers.IntegerField()
    subject_ids = serializers.ListField(
        child=serializers.IntegerField(),
        allow_empty=True,
    )
    replace = serializers.BooleanField(
        required=False,
        default=True,
    )
    notes = serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
    )

    def validate_subject_ids(self, value):
        return list(dict.fromkeys(value))

    def validate(self, attrs):
        department = self.context["department"]

        teacher = (
            tuition_teacher_queryset(department)
            .filter(id=attrs["teacher_id"])
            .first()
        )

        if not teacher:
            raise serializers.ValidationError({
                "teacher_id":
                "The selected teacher does not "
                "have active Tuition access."
            })

        subject_ids = attrs.get(
            "subject_ids",
            [],
        )

        subject_count = (
            TuitionSubject.objects
            .filter(
                department=department,
                id__in=subject_ids,
                is_active=True,
            )
            .count()
        )

        if subject_count != len(subject_ids):
            raise serializers.ValidationError({
                "subject_ids":
                "One or more selected subjects "
                "are invalid."
            })

        attrs["teacher"] = teacher
        return attrs


class TuitionAccountCreateSerializer(
    serializers.Serializer
):
    mode = serializers.ChoiceField(
        choices=["create", "link_existing"],
        default="create",
    )

    existing_user_id = serializers.IntegerField(
        required=False,
        allow_null=True,
    )

    role = serializers.ChoiceField(
        choices=[
            User.Role.TEACHER,
            User.Role.STUDENT,
        ]
    )

    username = serializers.CharField(
        max_length=150,
        required=False,
        allow_blank=True,
    )

    password = serializers.CharField(
        max_length=128,
        required=False,
        allow_blank=True,
        write_only=True,
    )

    email = serializers.EmailField(
        required=False,
        allow_blank=True,
    )

    first_name = serializers.CharField(
        max_length=150,
        required=False,
        allow_blank=True,
    )

    last_name = serializers.CharField(
        max_length=150,
        required=False,
        allow_blank=True,
    )

    father_name = serializers.CharField(
        max_length=120,
        required=False,
        allow_blank=True,
    )

    phone = serializers.CharField(
        max_length=40,
        required=False,
        allow_blank=True,
    )

    address = serializers.CharField(
        required=False,
        allow_blank=True,
    )

    joining_date = serializers.DateField(
        required=False,
        allow_null=True,
    )

    notes = serializers.CharField(
        required=False,
        allow_blank=True,
    )

    zoom_link = serializers.URLField(
        required=False,
        allow_blank=True,
    )

    primary_teacher_id = serializers.IntegerField(
        required=False,
        allow_null=True,
    )

    subject_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        allow_empty=True,
    )

    def validate_subject_ids(self, value):
        return list(dict.fromkeys(value))

    def validate(self, attrs):
        department = self.context["department"]
        mode = attrs.get("mode", "create")
        role = attrs["role"]

        if mode == "link_existing":
            existing_user_id = attrs.get(
                "existing_user_id"
            )

            if not existing_user_id:
                raise serializers.ValidationError({
                    "existing_user_id":
                    "Select an existing account."
                })

            user = (
                User.objects
                .filter(
                    id=existing_user_id,
                    institution_id=(
                        department.institution_id
                    ),
                    role=role,
                )
                .first()
            )

            if not user:
                raise serializers.ValidationError({
                    "existing_user_id":
                    "The selected account does not "
                    "belong to this institution or "
                    "has the wrong role."
                })

            if user_has_tuition_membership(
                user,
                department,
            ):
                raise serializers.ValidationError({
                    "existing_user_id":
                    "This account is already linked "
                    "to the Tuition Department."
                })

            if (
                role == User.Role.TEACHER
                and not hasattr(
                    user,
                    "teacher_profile",
                )
            ):
                raise serializers.ValidationError({
                    "existing_user_id":
                    "The selected account has no "
                    "teacher profile."
                })

            if (
                role == User.Role.STUDENT
                and not hasattr(
                    user,
                    "student_profile",
                )
            ):
                raise serializers.ValidationError({
                    "existing_user_id":
                    "The selected account has no "
                    "student profile."
                })

            attrs["existing_user"] = user
            return attrs

        username = str(
            attrs.get("username", "")
            or ""
        ).strip()

        password = str(
            attrs.get("password", "")
            or ""
        )

        if not username:
            raise serializers.ValidationError({
                "username": "Username is required."
            })

        if User.objects.filter(
            username__iexact=username
        ).exists():
            raise serializers.ValidationError({
                "username":
                "This username already exists."
            })

        if len(password) < 6:
            raise serializers.ValidationError({
                "password":
                "Password must be at least "
                "6 characters."
            })

        if role == User.Role.STUDENT:
            teacher_id = attrs.get(
                "primary_teacher_id"
            )

            teacher = (
                tuition_teacher_queryset(department)
                .filter(id=teacher_id)
                .first()
            )

            if not teacher:
                raise serializers.ValidationError({
                    "primary_teacher_id":
                    "Select an active Tuition teacher."
                })

            attrs["primary_teacher"] = teacher

        subject_ids = attrs.get(
            "subject_ids",
            [],
        )

        if role == User.Role.TEACHER:
            subject_count = (
                TuitionSubject.objects
                .filter(
                    department=department,
                    id__in=subject_ids,
                    is_active=True,
                )
                .count()
            )

            if subject_count != len(subject_ids):
                raise serializers.ValidationError({
                    "subject_ids":
                    "One or more subjects are invalid."
                })

        return attrs

    @transaction.atomic
    def create(self, validated_data):
        department = self.context["department"]
        mode = validated_data.get(
            "mode",
            "create",
        )
        role = validated_data["role"]

        if mode == "link_existing":
            user = validated_data["existing_user"]

            if user.institution_id is None:
                user.institution = (
                    department.institution
                )

            if user.department_id is None:
                user.department = department

            user.save(
                update_fields=[
                    "institution",
                    "department",
                ]
            )

            ensure_tuition_role_link(
                user,
                department,
                role,
                active=True,
            )

            if role == User.Role.TEACHER:
                teacher = user.teacher_profile

                if "subject_ids" in validated_data:
                    sync_teacher_capabilities(
                        teacher,
                        department,
                        validated_data.get(
                            "subject_ids",
                            [],
                        ),
                    )

            return user

        user = User.objects.create(
            username=validated_data[
                "username"
            ].strip(),
            email=str(
                validated_data.get(
                    "email",
                    "",
                )
                or ""
            ).strip(),
            first_name=str(
                validated_data.get(
                    "first_name",
                    "",
                )
                or ""
            ).strip(),
            last_name=str(
                validated_data.get(
                    "last_name",
                    "",
                )
                or ""
            ).strip(),
            role=role,
            institution=department.institution,
            department=department,
            is_active=True,
        )

        user.set_password(
            validated_data["password"]
        )

        user.save()

        ensure_tuition_role_link(
            user,
            department,
            role,
            active=True,
        )

        if role == User.Role.TEACHER:
            teacher = TeacherProfile.objects.create(
                user=user,
                institution=department.institution,
                department=department,
                father_name=str(
                    validated_data.get(
                        "father_name",
                        "",
                    )
                    or ""
                ).strip(),
                phone=str(
                    validated_data.get(
                        "phone",
                        "",
                    )
                    or ""
                ).strip(),
                address=str(
                    validated_data.get(
                        "address",
                        "",
                    )
                    or ""
                ).strip(),
                joining_date=validated_data.get(
                    "joining_date"
                ),
                notes=str(
                    validated_data.get(
                        "notes",
                        "",
                    )
                    or ""
                ).strip(),
                zoom_link=str(
                    validated_data.get(
                        "zoom_link",
                        "",
                    )
                    or ""
                ).strip(),
            )

            sync_teacher_capabilities(
                teacher,
                department,
                validated_data.get(
                    "subject_ids",
                    [],
                ),
            )

        else:
            StudentProfile.objects.create(
                user=user,
                institution=department.institution,
                department=department,
                teacher=validated_data[
                    "primary_teacher"
                ],
                phone=str(
                    validated_data.get(
                        "phone",
                        "",
                    )
                    or ""
                ).strip(),
                notes=str(
                    validated_data.get(
                        "notes",
                        "",
                    )
                    or ""
                ).strip(),
            )

        return user


class TuitionAccountUpdateSerializer(
    serializers.Serializer
):
    username = serializers.CharField(
        max_length=150,
        required=False,
    )

    password = serializers.CharField(
        max_length=128,
        required=False,
        allow_blank=True,
        write_only=True,
    )

    email = serializers.EmailField(
        required=False,
        allow_blank=True,
    )

    first_name = serializers.CharField(
        max_length=150,
        required=False,
        allow_blank=True,
    )

    last_name = serializers.CharField(
        max_length=150,
        required=False,
        allow_blank=True,
    )

    tuition_access_active = (
        serializers.BooleanField(
            required=False
        )
    )

    father_name = serializers.CharField(
        max_length=120,
        required=False,
        allow_blank=True,
    )

    phone = serializers.CharField(
        max_length=40,
        required=False,
        allow_blank=True,
    )

    address = serializers.CharField(
        required=False,
        allow_blank=True,
    )

    joining_date = serializers.DateField(
        required=False,
        allow_null=True,
    )

    notes = serializers.CharField(
        required=False,
        allow_blank=True,
    )

    zoom_link = serializers.URLField(
        required=False,
        allow_blank=True,
    )

    subject_ids = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        allow_empty=True,
    )

    def validate_username(self, value):
        user = self.context["user"]
        value = value.strip()

        if not value:
            raise serializers.ValidationError(
                "Username is required."
            )

        exists = (
            User.objects
            .filter(
                username__iexact=value
            )
            .exclude(id=user.id)
            .exists()
        )

        if exists:
            raise serializers.ValidationError(
                "This username already exists."
            )

        return value

    def validate_password(self, value):
        if value and len(value) < 6:
            raise serializers.ValidationError(
                "Password must be at least "
                "6 characters."
            )

        return value

    def validate_subject_ids(self, value):
        return list(dict.fromkeys(value))

    def validate(self, attrs):
        department = self.context["department"]
        user = self.context["user"]

        if (
            attrs.get("tuition_access_active")
            is False
            and user.role == User.Role.TEACHER
        ):
            teacher = getattr(
                user,
                "teacher_profile",
                None,
            )

            if (
                teacher
                and TuitionEnrollment.objects
                .filter(
                    department=department,
                    teacher=teacher,
                    is_active=True,
                )
                .exists()
            ):
                raise serializers.ValidationError({
                    "tuition_access_active":
                    "Reassign or disable the "
                    "teacher's active enrollments "
                    "before removing Tuition access."
                })

        if (
            "subject_ids" in attrs
            and user.role != User.Role.TEACHER
        ):
            raise serializers.ValidationError({
                "subject_ids":
                "Subjects can only be assigned "
                "to teacher accounts."
            })

        subject_ids = attrs.get(
            "subject_ids",
            [],
        )

        subject_count = (
            TuitionSubject.objects
            .filter(
                department=department,
                id__in=subject_ids,
                is_active=True,
            )
            .count()
        )

        if subject_count != len(subject_ids):
            raise serializers.ValidationError({
                "subject_ids":
                "One or more selected subjects "
                "are invalid."
            })

        return attrs

    @transaction.atomic
    def update(self, user, validated_data):
        department = self.context["department"]

        for field in [
            "username",
            "email",
            "first_name",
            "last_name",
        ]:
            if field in validated_data:
                setattr(
                    user,
                    field,
                    str(
                        validated_data[field]
                        or ""
                    ).strip(),
                )

        password = validated_data.get(
            "password"
        )

        if password:
            user.set_password(password)

        access_active = validated_data.get(
            "tuition_access_active",
            None,
        )

        if access_active is not None:
            ensure_tuition_role_link(
                user,
                department,
                user.role,
                active=access_active,
            )

            if access_active:
                if user.institution_id is None:
                    user.institution = (
                        department.institution
                    )

                if user.department_id is None:
                    user.department = department

            elif user.department_id == department.id:
                user.department = None

        user.save()

        if user.role == User.Role.TEACHER:
            teacher = user.teacher_profile

            for field in [
                "father_name",
                "phone",
                "address",
                "joining_date",
                "notes",
                "zoom_link",
            ]:
                if field in validated_data:
                    setattr(
                        teacher,
                        field,
                        validated_data[field],
                    )

            if teacher.institution_id is None:
                teacher.institution = (
                    department.institution
                )

            teacher.save()

            if "subject_ids" in validated_data:
                sync_teacher_capabilities(
                    teacher,
                    department,
                    validated_data[
                        "subject_ids"
                    ],
                )

            if access_active is False:
                (
                    TuitionTeacherCapability.objects
                    .filter(
                        department=department,
                        teacher=teacher,
                    )
                    .update(is_active=False)
                )

        if user.role == User.Role.STUDENT:
            student = user.student_profile

            if "phone" in validated_data:
                student.phone = str(
                    validated_data["phone"]
                    or ""
                ).strip()

            if "notes" in validated_data:
                student.notes = str(
                    validated_data["notes"]
                    or ""
                ).strip()

            if student.institution_id is None:
                student.institution = (
                    department.institution
                )

            student.save()

            if access_active is False:
                enrollment_ids = list(
                    TuitionEnrollment.objects
                    .filter(
                        department=department,
                        student=student,
                    )
                    .values_list(
                        "id",
                        flat=True,
                    )
                )

                (
                    TuitionEnrollment.objects
                    .filter(id__in=enrollment_ids)
                    .update(is_active=False)
                )

                from .models import TuitionSchedule

                (
                    TuitionSchedule.objects
                    .filter(
                        department=department,
                        student=student,
                    )
                    .update(is_active=False)
                )

        return user


class TuitionEnrollmentWriteSerializer(
    serializers.Serializer
):
    program_type = serializers.ChoiceField(
        choices=TuitionEnrollment.ProgramType.choices
    )

    student_id = serializers.IntegerField()
    teacher_id = serializers.IntegerField()

    class_level_id = serializers.IntegerField(
        required=False,
        allow_null=True,
    )

    subject_id = serializers.IntegerField(
        required=False,
        allow_null=True,
    )

    custom_class_name = serializers.CharField(
        max_length=150,
        required=False,
        allow_blank=True,
    )

    custom_subject_name = serializers.CharField(
        max_length=150,
        required=False,
        allow_blank=True,
    )

    start_date = serializers.DateField()

    end_date = serializers.DateField(
        required=False,
        allow_null=True,
    )

    notes = serializers.CharField(
        required=False,
        allow_blank=True,
    )

    is_active = serializers.BooleanField(
        required=False,
        default=True,
    )

    schedule_country = serializers.CharField(
        max_length=12,
        required=False,
        allow_blank=True,
    )

    schedule_slot = serializers.CharField(
        max_length=40,
        required=False,
        allow_blank=True,
    )

    schedule_label = serializers.CharField(
        max_length=100,
        required=False,
        allow_blank=True,
    )

    schedule_start_time = serializers.TimeField(
        required=False,
        allow_null=True,
    )

    schedule_end_time = serializers.TimeField(
        required=False,
        allow_null=True,
    )

    duration_minutes = serializers.IntegerField(
        required=False,
        min_value=40,
        max_value=40,
    )

    schedule_days = serializers.ListField(
        child=serializers.CharField(max_length=20),
        required=False,
        allow_empty=False,
    )

    def validate(self, attrs):
        department = self.context["department"]
        instance = self.instance

        def current(name, default=None):
            if name in attrs:
                return attrs[name]

            if instance is not None:
                return getattr(instance, name)

            return default

        program_type = current(
            "program_type"
        )

        student_id = current(
            "student_id",
            getattr(
                instance,
                "student_id",
                None,
            ),
        )

        teacher_id = current(
            "teacher_id",
            getattr(
                instance,
                "teacher_id",
                None,
            ),
        )

        class_level_id = current(
            "class_level_id",
            getattr(
                instance,
                "class_level_id",
                None,
            ),
        )

        subject_id = current(
            "subject_id",
            getattr(
                instance,
                "subject_id",
                None,
            ),
        )

        custom_class_name = str(
            current(
                "custom_class_name",
                "",
            )
            or ""
        ).strip()

        custom_subject_name = str(
            current(
                "custom_subject_name",
                "",
            )
            or ""
        ).strip()

        start_date = current("start_date")
        end_date = current("end_date")
        is_active = current("is_active", True)

        student = (
            tuition_student_queryset(department)
            .filter(id=student_id)
            .first()
        )

        if not student:
            raise serializers.ValidationError({
                "student_id":
                "The selected student does not "
                "have active Tuition access."
            })

        teacher = (
            tuition_teacher_queryset(department)
            .filter(id=teacher_id)
            .first()
        )

        if not teacher:
            raise serializers.ValidationError({
                "teacher_id":
                "The selected teacher does not "
                "have active Tuition access."
            })

        class_level = None
        subject = None

        if (
            program_type
            == TuitionEnrollment.ProgramType.REGULAR
        ):
            class_level = (
                TuitionClassLevel.objects
                .filter(
                    department=department,
                    id=class_level_id,
                    is_active=True,
                )
                .first()
            )

            if not class_level:
                raise serializers.ValidationError({
                    "class_level_id":
                    "Select a valid class."
                })

            subject = (
                TuitionSubject.objects
                .filter(
                    department=department,
                    id=subject_id,
                    is_active=True,
                )
                .first()
            )

            if not subject:
                raise serializers.ValidationError({
                    "subject_id":
                    "Select a valid subject."
                })

            # A subject capability is activated automatically when the
            # enrollment is saved. It must not hide an otherwise free teacher
            # from Accounts & Enrollment.
            custom_class_name = ""
            custom_subject_name = ""

        else:
            if not custom_class_name:
                raise serializers.ValidationError({
                    "custom_class_name":
                    "Enter the crash-program "
                    "class or program name."
                })

            if not custom_subject_name:
                raise serializers.ValidationError({
                    "custom_subject_name":
                    "Enter the crash-program subject."
                })

            class_level = None
            subject = None

        if (
            start_date
            and end_date
            and end_date < start_date
        ):
            raise serializers.ValidationError({
                "end_date":
                "End date cannot be before "
                "the start date."
            })

        schedule_start_time = current(
            "schedule_start_time",
            getattr(instance, "schedule_start_time", None),
        )
        schedule_end_time = current(
            "schedule_end_time",
            getattr(instance, "schedule_end_time", None),
        )

        if schedule_start_time and not schedule_end_time:
            schedule_end_time = (
                datetime.combine(datetime.today(), schedule_start_time)
                + timedelta(minutes=CLASS_DURATION_MINUTES)
            ).time()
            attrs["schedule_end_time"] = schedule_end_time

        if is_active and schedule_start_time and schedule_end_time:
            unavailable_exists = (
                TuitionTeacherAvailability.objects
                .filter(
                    department=department,
                    teacher=teacher,
                    weekday__in=OPERATING_WEEKDAYS,
                    is_active=True,
                    start_time__lt=schedule_end_time,
                    end_time__gt=schedule_start_time,
                )
                .exists()
            )

            if unavailable_exists:
                raise serializers.ValidationError({
                    "teacher_id":
                    "This teacher is marked Not Available "
                    "for the selected lecture time."
                })

            busy_schedules = (
                TuitionSchedule.objects
                .filter(
                    department=department,
                    teacher=teacher,
                    weekday__in=OPERATING_WEEKDAYS,
                    is_active=True,
                    start_time__lt=schedule_end_time,
                    end_time__gt=schedule_start_time,
                )
            )

            if instance is not None:
                busy_schedules = busy_schedules.exclude(
                    enrollment_id=instance.id
                )

            if busy_schedules.exists():
                raise serializers.ValidationError({
                    "teacher_id":
                    "This teacher already has a class "
                    "during the selected lecture time."
                })

        duplicate_query = (
            TuitionEnrollment.objects
            .filter(
                department=department,
                student=student,
                is_active=True,
            )
        )

        if instance is not None:
            duplicate_query = (
                duplicate_query.exclude(
                    id=instance.id
                )
            )

        if is_active:
            if subject:
                duplicate_exists = (
                    duplicate_query.filter(
                        subject=subject
                    ).exists()
                )
            else:
                duplicate_exists = (
                    duplicate_query.filter(
                        subject__isnull=True,
                        custom_subject_name__iexact=(
                            custom_subject_name
                        ),
                    )
                    .exists()
                )

            if duplicate_exists:
                raise serializers.ValidationError({
                    "subject_id":
                    "This student already has an "
                    "active teacher for this subject."
                })

        attrs["student"] = student
        attrs["teacher"] = teacher
        attrs["class_level"] = class_level
        attrs["subject"] = subject
        attrs["custom_class_name"] = (
            custom_class_name
        )
        attrs["custom_subject_name"] = (
            custom_subject_name
        )

        return attrs

    def _ensure_teacher_capability(
        self,
        department,
        validated_data,
    ):
        teacher = validated_data.get("teacher")
        subject = validated_data.get("subject")

        if not teacher or not subject:
            return

        TuitionTeacherCapability.objects.update_or_create(
            department=department,
            teacher=teacher,
            subject=subject,
            defaults={
                "institution": department.institution,
                "is_active": True,
                "notes": (
                    "Automatically enabled from the "
                    "student enrollment card."
                ),
            },
        )

    def create(self, validated_data):
        department = self.context["department"]
        actor = self.context["actor"]

        validated_data.pop("student_id", None)
        validated_data.pop("teacher_id", None)
        validated_data.pop("class_level_id", None)
        validated_data.pop("subject_id", None)
        validated_data.pop("schedule_days", None)

        self._ensure_teacher_capability(
            department,
            validated_data,
        )

        enrollment = TuitionEnrollment(
            institution=department.institution,
            department=department,
            created_by=actor,
            updated_by=actor,
            **validated_data,
        )

        try:
            enrollment.save()
        except DjangoValidationError as error:
            raise serializers.ValidationError(
                getattr(error, "message_dict", {"detail": error.messages})
            )

        return enrollment

    def update(self, instance, validated_data):
        actor = self.context["actor"]
        department = self.context["department"]

        validated_data.pop("student_id", None)
        validated_data.pop("teacher_id", None)
        validated_data.pop("class_level_id", None)
        validated_data.pop("subject_id", None)
        validated_data.pop("schedule_days", None)

        self._ensure_teacher_capability(
            department,
            validated_data,
        )

        for field, value in validated_data.items():
            setattr(instance, field, value)

        instance.updated_by = actor

        try:
            instance.save()
        except DjangoValidationError as error:
            raise serializers.ValidationError(
                getattr(error, "message_dict", {"detail": error.messages})
            )

        return instance

