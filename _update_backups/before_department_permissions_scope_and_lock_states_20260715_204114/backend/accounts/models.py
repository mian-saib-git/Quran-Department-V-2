from django.contrib.auth.models import AbstractUser
from django.db import models


class Institution(models.Model):
    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    is_active = models.BooleanField(default=True)

    logo_url = models.URLField(blank=True)
    website = models.URLField(blank=True)
    notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self):
        return self.name


class Department(models.Model):
    class DepartmentType(models.TextChoices):
        QURAN = "quran", "Quran"
        TUITION = "tuition", "Tuition"
        GENERAL = "general", "General"

    institution = models.ForeignKey(
        Institution,
        on_delete=models.CASCADE,
        related_name="departments",
    )
    name = models.CharField(max_length=255)
    code = models.SlugField(max_length=80)
    department_type = models.CharField(
        max_length=50,
        choices=DepartmentType.choices,
        default=DepartmentType.GENERAL,
    )
    is_active = models.BooleanField(default=True)

    notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["institution__name", "name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["institution", "code"],
                name="unique_department_code_per_institution",
            )
        ]

    def __str__(self):
        return f"{self.institution.name} - {self.name}"


class Feature(models.Model):
    key = models.SlugField(max_length=120, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "name", "id"]

    def __str__(self):
        return self.name


class DepartmentFeature(models.Model):
    department = models.ForeignKey(
        Department,
        on_delete=models.CASCADE,
        related_name="feature_settings",
    )
    feature = models.ForeignKey(
        Feature,
        on_delete=models.CASCADE,
        related_name="department_settings",
    )
    is_enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["department__name", "feature__sort_order", "feature__name"]
        constraints = [
            models.UniqueConstraint(
                fields=["department", "feature"],
                name="unique_feature_setting_per_department",
            )
        ]

    def __str__(self):
        status = "Enabled" if self.is_enabled else "Disabled"
        return f"{self.department} - {self.feature} - {status}"


class User(AbstractUser):
    class Role(models.TextChoices):
        PLATFORM_ADMIN = "platform_admin", "Platform Admin"
        INSTITUTION_ADMIN = "institution_admin", "Institution Admin"
        DEPARTMENT_ADMIN = "department_admin", "Department Admin"
        COORDINATOR = "coordinator", "Coordinator"
        TEACHER = "teacher", "Teacher"
        STUDENT = "student", "Student"

    role = models.CharField(
        max_length=30,
        choices=Role.choices,
        default=Role.STUDENT,
    )

    # Primary assignment for the current/simple UI.
    # UserDepartmentRole below gives us future multi-department flexibility.
    institution = models.ForeignKey(
        Institution,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="users",
    )
    department = models.ForeignKey(
        Department,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="users",
    )

    def is_platform_admin(self):
        return self.role == self.Role.PLATFORM_ADMIN or self.is_superuser

    def is_institution_admin(self):
        return self.role == self.Role.INSTITUTION_ADMIN

    def is_department_admin(self):
        return self.role == self.Role.DEPARTMENT_ADMIN

    def is_coordinator(self):
        return self.role == self.Role.COORDINATOR

    def is_teacher(self):
        return self.role == self.Role.TEACHER

    def is_student(self):
        return self.role == self.Role.STUDENT


class UserDepartmentRole(models.Model):
    class Role(models.TextChoices):
        PLATFORM_ADMIN = "platform_admin", "Platform Admin"
        INSTITUTION_ADMIN = "institution_admin", "Institution Admin"
        DEPARTMENT_ADMIN = "department_admin", "Department Admin"
        COORDINATOR = "coordinator", "Coordinator"
        TEACHER = "teacher", "Teacher"
        STUDENT = "student", "Student"

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="department_roles",
    )
    institution = models.ForeignKey(
        Institution,
        on_delete=models.CASCADE,
        related_name="user_roles",
    )
    department = models.ForeignKey(
        Department,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="user_roles",
    )
    role = models.CharField(max_length=30, choices=Role.choices)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["institution__name", "department__name", "role", "user__username"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "institution", "department", "role"],
                name="unique_user_department_role",
            )
        ]

    def __str__(self):
        scope = self.department.name if self.department else self.institution.name
        return f"{self.user.username} - {scope} - {self.role}"