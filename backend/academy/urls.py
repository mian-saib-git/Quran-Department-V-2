from django.urls import path

from .views import (
    AcademyHealthView,
    DashboardView,
    LessonListCreateView,
    AcademyStateView,
    AttendanceListCreateView,
    AttendanceDeleteView,
    MonthlyLessonPlanListCreateView,
    MonthlyLessonPlanDetailView,
    MonthlyLessonSummaryView,
    GeminiAssistantView,
)

urlpatterns = [
    path("health/", AcademyHealthView.as_view(), name="academy_health"),
    path("dashboard/", DashboardView.as_view(), name="academy_dashboard"),
    path("lessons/", LessonListCreateView.as_view(), name="academy_lessons"),
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
    path(
        "monthly-lesson-summary/",
        MonthlyLessonSummaryView.as_view(),
        name="academy_monthly_lesson_summary",
    ),
]