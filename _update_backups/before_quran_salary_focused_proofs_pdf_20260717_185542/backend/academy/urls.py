from django.urls import path

from .quran_management_api import (
    DroppedLeaveStudentsView,
    QuranSalaryAuditView,
    QuranSalaryDashboardView,
    QuranSalarySettingsView,
)

from .views import (
    AcademyHealthView,
    DashboardView,
    LessonListCreateView,
    LessonDetailView,
    LessonAccessPermissionView,
    DailyLessonReportListCreateView,
    AcademyStateView,
    AttendanceListCreateView,
    AttendanceDeleteView,
    MonthlyLessonPlanListCreateView,
    MonthlyLessonPlanDetailView,
    MonthlyLessonSummaryView,
    GeminiAssistantView,
    LessonAccessRequestView,
LessonAccessRequestDetailView,
)

urlpatterns = [
    path("dropped-leave/", DroppedLeaveStudentsView.as_view(), name="academy_dropped_leave"),
    path("teacher-salary/", QuranSalaryDashboardView.as_view(), name="academy_teacher_salary"),
    path("teacher-salary/settings/", QuranSalarySettingsView.as_view(), name="academy_teacher_salary_settings"),
    path("teacher-salary/audit/", QuranSalaryAuditView.as_view(), name="academy_teacher_salary_audit"),

    path("health/", AcademyHealthView.as_view(), name="academy_health"),
    path("dashboard/", DashboardView.as_view(), name="academy_dashboard"),

    # Lessons API
    path("lessons/", LessonListCreateView.as_view(), name="academy_lessons"),
    path("lessons/<int:pk>/", LessonDetailView.as_view(), name="academy_lesson_detail"),

    path("lesson-access-requests/", LessonAccessRequestView.as_view(), name="lesson-access-requests"),
path("lesson-access-requests/<int:pk>/", LessonAccessRequestDetailView.as_view(), name="lesson-access-request-detail"),

    # One day lesson report with multiple subjects
    path(
        "daily-lesson-reports/",
        DailyLessonReportListCreateView.as_view(),
        name="academy_daily_lesson_reports",
    ),

    # Coordinator permission for teacher lesson write/edit access
    path(
        "lesson-permissions/",
        LessonAccessPermissionView.as_view(),
        name="academy_lesson_permissions",
    ),

    path("state/", AcademyStateView.as_view(), name="academy_state"),
    path("assistant/", GeminiAssistantView.as_view(), name="academy_assistant"),

    # Attendance API
    path("attendance/", AttendanceListCreateView.as_view(), name="academy_attendance"),
    path("attendance/<int:pk>/", AttendanceDeleteView.as_view(), name="academy_attendance_delete"),

    # Monthly Lesson Plan API
    path(
        "monthly-lesson-plans/",
        MonthlyLessonPlanListCreateView.as_view(),
        name="academy_monthly_lesson_plans",
    ),
    path(
        "monthly-lesson-plans/<int:pk>/",
        MonthlyLessonPlanDetailView.as_view(),
        name="academy_monthly_lesson_plan_detail",
    ),

    # Monthly Lesson Summary API
    path(
        "monthly-lesson-summary/",
        MonthlyLessonSummaryView.as_view(),
        name="academy_monthly_lesson_summary",
    ),
]