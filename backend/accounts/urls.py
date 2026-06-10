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
)

urlpatterns = [
    path("login/", LoginView.as_view(), name="auth_login"),
    path("refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="auth_me"),
    path("context/", AuthContextView.as_view(), name="auth_context"),

    path("platform/departments/", PlatformDepartmentListView.as_view(), name="platform_departments"),
    path("platform/features/", PlatformFeatureListView.as_view(), name="platform_features"),
    path("platform/departments/<int:department_id>/features/", PlatformDepartmentFeatureView.as_view(), name="platform_department_features"),

    path("accounts/", CoordinatorAccountListCreateView.as_view(), name="coordinator_accounts"),
    path("accounts/<int:user_id>/", CoordinatorAccountDetailView.as_view(), name="coordinator_account_detail"),
]