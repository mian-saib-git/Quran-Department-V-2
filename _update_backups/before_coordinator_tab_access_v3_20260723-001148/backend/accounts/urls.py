from .self_profile_api import SelfProfileView
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    LoginView,
    MeView,
    AuthContextView,
    CoordinatorAccountListCreateView,
    CoordinatorAccountDetailView,
    PlatformDepartmentListView,
    PlatformFeatureListView,
    PlatformDepartmentFeatureView,
    PlatformInstitutionListCreateView,
    PlatformInstitutionDetailView,
    PlatformDepartmentListCreateView,
    PlatformDepartmentDetailView,
)

from .platform_admin_api import (
    PlatformPortalAdministratorListCreateView,
    PlatformPortalAdministratorDetailView,
    PlatformPortalAdministratorResetPasswordView,
    PlatformBackupListCreateView,
    PlatformBackupUploadView,
    PlatformBackupDownloadView,
    PlatformBackupDetailView,
    PlatformSettingsView,
    PlatformGeminiTestView,
    PlatformSystemHealthView,
    PlatformAuditLogListView,
)

from .platform_communications_api import (
    PlatformMaintenanceListCreateView,
    PlatformMaintenanceDetailView,
    PlatformNoticeListCreateView,
    PlatformNoticeDetailView,
    ActivePlatformNoticesView,
    DismissPlatformNoticeView,
)
from .platform_analytics_api import PlatformAnalyticsView

urlpatterns = [
    path("profile/", SelfProfileView.as_view(), name="auth_profile"),
    path("login/", LoginView.as_view(), name="auth_login"),
    path("refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="auth_me"),
    path("context/", AuthContextView.as_view(), name="auth_context"),


    path("platform/administrators/", PlatformPortalAdministratorListCreateView.as_view(), name="platform_administrators"),
    path("platform/administrators/<int:user_id>/", PlatformPortalAdministratorDetailView.as_view(), name="platform_administrator_detail"),
    path("platform/administrators/<int:user_id>/reset-password/", PlatformPortalAdministratorResetPasswordView.as_view(), name="platform_administrator_reset_password"),

    path("platform/backups/", PlatformBackupListCreateView.as_view(), name="platform_backups"),
    path("platform/backups/upload/", PlatformBackupUploadView.as_view(), name="platform_backup_upload"),
    path("platform/backups/<int:backup_id>/download/", PlatformBackupDownloadView.as_view(), name="platform_backup_download"),
    path("platform/backups/<int:backup_id>/", PlatformBackupDetailView.as_view(), name="platform_backup_detail"),

    path("platform/settings/", PlatformSettingsView.as_view(), name="platform_settings"),
    path("platform/settings/test-gemini/", PlatformGeminiTestView.as_view(), name="platform_settings_test_gemini"),
    path("platform/health/", PlatformSystemHealthView.as_view(), name="platform_health"),
    path("platform/audit-logs/", PlatformAuditLogListView.as_view(), name="platform_audit_logs"),
    path("platform/maintenance/", PlatformMaintenanceListCreateView.as_view(), name="platform_maintenance"),
    path("platform/maintenance/<int:maintenance_id>/", PlatformMaintenanceDetailView.as_view(), name="platform_maintenance_detail"),
    path("platform/notices/", PlatformNoticeListCreateView.as_view(), name="platform_notices"),
    path("platform/notices/<int:notice_id>/", PlatformNoticeDetailView.as_view(), name="platform_notice_detail"),
    path("platform/analytics/", PlatformAnalyticsView.as_view(), name="platform_analytics"),
    path("notices/active/", ActivePlatformNoticesView.as_view(), name="active_platform_notices"),
    path("notices/<int:notice_id>/dismiss/", DismissPlatformNoticeView.as_view(), name="dismiss_platform_notice"),

    path("platform/institutions/", PlatformInstitutionListCreateView.as_view(), name="platform_institutions"),
    path("platform/institutions/<int:institution_id>/", PlatformInstitutionDetailView.as_view(), name="platform_institution_detail"),
    path("platform/departments/create/", PlatformDepartmentListCreateView.as_view(), name="platform_department_create"),
    path("platform/departments/<int:department_id>/", PlatformDepartmentDetailView.as_view(), name="platform_department_detail"),
    path("platform/departments/", PlatformDepartmentListView.as_view(), name="platform_departments"),
    path("platform/features/", PlatformFeatureListView.as_view(), name="platform_features"),
    path("platform/departments/<int:department_id>/features/", PlatformDepartmentFeatureView.as_view(), name="platform_department_features"),

    path("accounts/", CoordinatorAccountListCreateView.as_view(), name="coordinator_accounts"),
    path("accounts/<int:user_id>/", CoordinatorAccountDetailView.as_view(), name="coordinator_account_detail"),
]