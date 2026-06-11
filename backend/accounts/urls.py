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

urlpatterns = [
    path("login/", LoginView.as_view(), name="auth_login"),
    path("refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="auth_me"),
    path("context/", AuthContextView.as_view(), name="auth_context"),

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