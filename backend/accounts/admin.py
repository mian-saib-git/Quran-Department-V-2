from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, CoordinatorTabAccess


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (
        ('Role', {'fields': ('role',)}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ('Role', {'fields': ('role',)}),
    )
    list_display = ('username', 'email', 'first_name', 'last_name', 'role', 'is_staff')
    list_filter = ('role', 'is_staff', 'is_superuser', 'is_active')


@admin.register(CoordinatorTabAccess)
class CoordinatorTabAccessAdmin(admin.ModelAdmin):
    list_display = ("coordinator", "department", "tab_key", "is_visible", "updated_by", "updated_at")
    list_filter = ("department", "is_visible", "tab_key")
    search_fields = ("coordinator__username", "coordinator__first_name", "coordinator__last_name", "department__name")
