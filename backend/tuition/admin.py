from django.contrib import admin

from .models import (
    TuitionAuditLog,
    TuitionClassLevel,
    TuitionDepartmentConfig,
    TuitionEnrollment,
    TuitionSchedule,
    TuitionStandardSlot,
    TuitionSubject,
    TuitionTeacherAvailability,
    TuitionTeacherCapability,
)


@admin.register(TuitionDepartmentConfig)
class TuitionDepartmentConfigAdmin(
    admin.ModelAdmin
):
    list_display = [
        "department",
        "default_timezone",
        "operating_start",
        "operating_end",
        "class_duration_minutes",
    ]


@admin.register(TuitionClassLevel)
class TuitionClassLevelAdmin(
    admin.ModelAdmin
):
    list_display = [
        "name",
        "board",
        "department",
        "sort_order",
        "is_active",
    ]

    list_filter = [
        "board",
        "is_active",
        "department",
    ]

    search_fields = [
        "name",
        "code",
    ]


@admin.register(TuitionSubject)
class TuitionSubjectAdmin(
    admin.ModelAdmin
):
    list_display = [
        "name",
        "department",
        "is_standard",
        "is_active",
    ]

    list_filter = [
        "is_standard",
        "is_active",
        "department",
    ]

    search_fields = [
        "name",
        "code",
    ]


@admin.register(TuitionStandardSlot)
class TuitionStandardSlotAdmin(
    admin.ModelAdmin
):
    list_display = [
        "region",
        "label",
        "start_time",
        "end_time",
        "timezone_name",
        "is_active",
    ]

    list_filter = [
        "region",
        "is_active",
        "department",
    ]


@admin.register(TuitionTeacherCapability)
class TuitionTeacherCapabilityAdmin(
    admin.ModelAdmin
):
    list_display = [
        "teacher",
        "subject",
        "department",
        "is_active",
    ]

    list_filter = [
        "subject",
        "is_active",
        "department",
    ]

    search_fields = [
        "teacher__user__username",
        "teacher__user__first_name",
        "teacher__user__last_name",
        "subject__name",
    ]


@admin.register(TuitionEnrollment)
class TuitionEnrollmentAdmin(
    admin.ModelAdmin
):
    list_display = [
        "student",
        "display_class",
        "display_subject",
        "teacher",
        "program_type",
        "is_active",
    ]

    list_filter = [
        "program_type",
        "is_active",
        "department",
    ]

    search_fields = [
        "student__user__username",
        "student__user__first_name",
        "teacher__user__username",
        "teacher__user__first_name",
        "custom_class_name",
        "custom_subject_name",
    ]


@admin.register(TuitionTeacherAvailability)
class TuitionTeacherAvailabilityAdmin(
    admin.ModelAdmin
):
    list_display = [
        "teacher",
        "weekday",
        "start_time",
        "end_time",
        "timezone_name",
        "is_active",
    ]

    list_filter = [
        "weekday",
        "is_active",
        "department",
    ]


@admin.register(TuitionSchedule)
class TuitionScheduleAdmin(
    admin.ModelAdmin
):
    list_display = [
        "student",
        "teacher",
        "weekday",
        "start_time",
        "end_time",
        "timezone_name",
        "is_active",
    ]

    list_filter = [
        "weekday",
        "timezone_name",
        "is_active",
        "department",
    ]

    search_fields = [
        "student__user__username",
        "student__user__first_name",
        "teacher__user__username",
        "teacher__user__first_name",
    ]


@admin.register(TuitionAuditLog)
class TuitionAuditLogAdmin(
    admin.ModelAdmin
):
    list_display = [
        "action",
        "target_model",
        "target_id",
        "actor",
        "created_at",
    ]

    list_filter = [
        "action",
        "department",
        "created_at",
    ]

    readonly_fields = [
        "institution",
        "department",
        "actor",
        "action",
        "target_model",
        "target_id",
        "before_data",
        "after_data",
        "created_at",
    ]
