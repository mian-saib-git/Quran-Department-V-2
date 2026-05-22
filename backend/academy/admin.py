from django.contrib import admin

from .models import (
    TeacherProfile,
    StudentProfile,
    StudentSubject,
    ClassSchedule,
    Attendance,
    Lesson,
    DailyLessonReport,
    DailyLessonSubjectEntry,
    LessonAccessPermission,
    LessonAccessRequest,
    MonthlyLessonPlan,
    MonthlyLessonSummary,
)


class StudentSubjectInline(admin.TabularInline):
    model = StudentSubject
    extra = 1
    fields = ("subject", "custom_subject_name", "is_active", "notes")


class DailyLessonSubjectEntryInline(admin.TabularInline):
    model = DailyLessonSubjectEntry
    extra = 0
    fields = ("subject", "topic_summary", "progress_status", "remarks", "sort_order")
    ordering = ("sort_order", "id")


@admin.register(TeacherProfile)
class TeacherProfileAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "phone", "joining_date", "zoom_link")
    search_fields = ("user__username", "user__first_name", "user__last_name", "phone")

    def name(self, obj):
        return obj.user.get_full_name() or obj.user.username


@admin.register(StudentProfile)
class StudentProfileAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "teacher", "phone")
    list_filter = ("teacher",)
    search_fields = ("user__username", "user__first_name", "user__last_name", "phone")
    inlines = [StudentSubjectInline]

    def name(self, obj):
        return obj.user.get_full_name() or obj.user.username


@admin.register(StudentSubject)
class StudentSubjectAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "subject", "custom_subject_name", "is_active", "updated_at")
    list_filter = ("subject", "is_active")
    search_fields = (
        "student__user__username",
        "student__user__first_name",
        "student__user__last_name",
        "subject",
        "custom_subject_name",
    )


@admin.register(ClassSchedule)
class ClassScheduleAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "teacher", "weekday", "time_slot", "is_active")
    list_filter = ("weekday", "is_active", "teacher")
    search_fields = (
        "student__user__username",
        "student__user__first_name",
        "student__user__last_name",
        "teacher__user__username",
        "teacher__user__first_name",
        "teacher__user__last_name",
    )


@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = ("id", "entity_type", "teacher", "student", "date", "status", "marked_by")
    list_filter = ("entity_type", "status", "date")
    search_fields = (
        "teacher__user__username",
        "teacher__user__first_name",
        "teacher__user__last_name",
        "student__user__username",
        "student__user__first_name",
        "student__user__last_name",
    )


@admin.register(Lesson)
class LessonAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "teacher", "date", "subject", "topic_summary", "progress_status")
    list_filter = ("subject", "progress_status", "date", "teacher")
    search_fields = (
        "student__user__username",
        "student__user__first_name",
        "student__user__last_name",
        "teacher__user__username",
        "teacher__user__first_name",
        "teacher__user__last_name",
        "subject",
        "topic_summary",
    )


@admin.register(DailyLessonReport)
class DailyLessonReportAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "teacher", "date", "created_by", "updated_at")
    list_filter = ("date", "teacher")
    search_fields = (
        "student__user__username",
        "student__user__first_name",
        "student__user__last_name",
        "teacher__user__username",
        "teacher__user__first_name",
        "teacher__user__last_name",
        "notes",
    )
    inlines = [DailyLessonSubjectEntryInline]


@admin.register(LessonAccessPermission)
class LessonAccessPermissionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "teacher",
        "student",
        "lesson_date",
        "subject",
        "access_type",
        "is_active",
        "granted_by",
        "updated_at",
    )
    list_filter = ("access_type", "is_active", "lesson_date", "teacher")
    search_fields = (
        "teacher__user__username",
        "teacher__user__first_name",
        "teacher__user__last_name",
        "student__user__username",
        "student__user__first_name",
        "student__user__last_name",
        "subject",
        "reason",
    )


@admin.register(LessonAccessRequest)
class LessonAccessRequestAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "teacher",
        "student",
        "lesson_date",
        "subject",
        "request_type",
        "status",
        "reviewed_by",
        "updated_at",
    )
    list_filter = ("request_type", "status", "lesson_date", "teacher")
    search_fields = (
        "teacher__user__username",
        "teacher__user__first_name",
        "teacher__user__last_name",
        "student__user__username",
        "student__user__first_name",
        "student__user__last_name",
        "subject",
        "reason",
        "coordinator_note",
    )
    readonly_fields = ("reviewed_at",)


@admin.register(MonthlyLessonPlan)
class MonthlyLessonPlanAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "teacher", "month", "year", "subject", "status", "updated_at")
    list_filter = ("year", "month", "status", "subject", "teacher")
    search_fields = (
        "student__user__username",
        "student__user__first_name",
        "student__user__last_name",
        "teacher__user__username",
        "teacher__user__first_name",
        "teacher__user__last_name",
        "subject",
        "plan_text",
    )


@admin.register(MonthlyLessonSummary)
class MonthlyLessonSummaryAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "teacher", "month", "year", "subject", "source", "updated_at")
    list_filter = ("year", "month", "source", "subject", "teacher")
    search_fields = (
        "student__user__username",
        "student__user__first_name",
        "student__user__last_name",
        "teacher__user__username",
        "teacher__user__first_name",
        "teacher__user__last_name",
        "subject",
        "summary_text",
    )
