from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    LoginView,
    MeView,
    CoordinatorAccountListCreateView,
    CoordinatorAccountDetailView,
)

urlpatterns = [
    path("login/", LoginView.as_view(), name="auth_login"),
    path("refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="auth_me"),

    path("accounts/", CoordinatorAccountListCreateView.as_view(), name="coordinator_accounts"),
    path("accounts/<int:user_id>/", CoordinatorAccountDetailView.as_view(), name="coordinator_account_detail"),
]