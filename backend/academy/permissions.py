from rest_framework.permissions import BasePermission, SAFE_METHODS


DEPARTMENT_MANAGER_ROLES = {"coordinator", "department_admin", "institution_admin"}


def is_department_manager(user):
    role = str(getattr(user, "role", "") or "").lower()
    return bool(
        user
        and user.is_authenticated
        and (
            getattr(user, "is_superuser", False)
            or role in DEPARTMENT_MANAGER_ROLES
        )
    )


class IsCoordinator(BasePermission):
    def has_permission(self, request, view):
        return is_department_manager(request.user)


class ReadOnlyForTeacherStudentCoordinatorCanWrite(BasePermission):
    """
    Department manager can create/update/delete.
    Teacher and student can only read.
    """
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False

        role = str(getattr(request.user, "role", "") or "").lower()

        if request.method in SAFE_METHODS:
            return role in ["coordinator", "department_admin", "institution_admin", "teacher", "student"] or bool(getattr(request.user, "is_superuser", False))

        return is_department_manager(request.user)
