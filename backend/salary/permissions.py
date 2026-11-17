"""Unified Salary Management Permissions.

Enforces department scoping, institution isolation, and strict role boundaries:
- Department Admins: full CRUD for their own department's salary policies and drafts.
- Institution Admins: read-only access for policies in their institution.
- Super Admins / Platform Admins: read-only access across institutions.
- Teachers, students, coordinators: No access (HTTP 403 Forbidden).
"""
from rest_framework.permissions import BasePermission, SAFE_METHODS
from accounts.models import User, UserDepartmentRole, Department


def is_user_department_admin_for_department(user, department_id):
    """Check if the user has active Department Admin role for the given department."""
    if not user or not user.is_authenticated:
        return False
    try:
        dept_id = int(department_id) if department_id is not None else None
    except (ValueError, TypeError):
        return False
    if not dept_id:
        return False

    # Primary department check
    if getattr(user, "role", "") == User.Role.DEPARTMENT_ADMIN and user.department_id == dept_id:
        return True

    # Secondary roles check
    return UserDepartmentRole.objects.filter(
        user=user,
        department_id=dept_id,
        role=UserDepartmentRole.Role.DEPARTMENT_ADMIN,
        is_active=True,
    ).exists()


def get_authorized_department_id_for_user(user, requested_department_id=None):
    """
    Returns the department_id that the user is authorized to act on.
    - Department Admin: verified against their primary or assigned department roles.
    - Institution Admin: verified against their assigned institution's departments.
    - Super Admin / Platform Admin: verified against existing active departments.
    - Teacher, Student, Coordinator: strictly returns None (denied).
    Prevents cross-department and cross-institution spoofing.
    """
    if not user or not user.is_authenticated:
        return None

    role = str(getattr(user, "role", "") or "").lower()
    if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
        return None

    is_super = getattr(user, "is_superuser", False) or role == User.Role.PLATFORM_ADMIN
    is_inst = role == User.Role.INSTITUTION_ADMIN

    if requested_department_id:
        try:
            req_id = int(requested_department_id)
        except (ValueError, TypeError):
            return None

        if is_super:
            if Department.objects.filter(id=req_id, is_active=True).exists():
                return req_id
            return None

        if is_inst:
            if user.institution_id and Department.objects.filter(id=req_id, institution_id=user.institution_id, is_active=True).exists():
                return req_id
            return None

        if is_user_department_admin_for_department(user, req_id):
            return req_id
        return None

    # Fallback to default department if no requested_department_id was provided:
    if getattr(user, "role", "") == User.Role.DEPARTMENT_ADMIN and user.department_id:
        return user.department_id

    first_role = (
        UserDepartmentRole.objects.filter(
            user=user,
            role=UserDepartmentRole.Role.DEPARTMENT_ADMIN,
            is_active=True,
        )
        .values_list("department_id", flat=True)
        .first()
    )
    if first_role:
        return first_role

    if is_inst and user.institution_id:
        first_inst_dept = (
            Department.objects.filter(institution_id=user.institution_id, is_active=True)
            .values_list("id", flat=True)
            .first()
        )
        if first_inst_dept:
            return first_inst_dept

    if is_super:
        first_dept = Department.objects.filter(is_active=True).values_list("id", flat=True).first()
        return first_dept

    return None


class IsSalaryPolicyAdminOrReadOnly(BasePermission):
    """
    Department Admin can create, edit, clone, and publish for their own department.
    Institution Admin & Super Admin have read-only access within their scope.
    Teachers, students, and coordinators are strictly denied.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        if getattr(user, "is_superuser", False):
            return True

        role = str(getattr(user, "role", "") or "").lower()

        # Reject teachers, students, coordinators completely
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            return False

        if request.method in SAFE_METHODS:
            # Super Admin / Platform Admin
            if getattr(user, "is_superuser", False) or role == User.Role.PLATFORM_ADMIN:
                return True
            # Institution Admin
            if role == User.Role.INSTITUTION_ADMIN:
                return True
            # Department Admin
            if role == User.Role.DEPARTMENT_ADMIN or UserDepartmentRole.objects.filter(
                user=user, role=UserDepartmentRole.Role.DEPARTMENT_ADMIN
            ).exists():
                return True
            return False

        # Write operations: Department Admin, Institution Admin (scoped), or Super Admin
        if getattr(user, "is_superuser", False) or role == User.Role.PLATFORM_ADMIN:
            return True
        if role == User.Role.INSTITUTION_ADMIN:
            return bool(user.institution_id)
        if role == User.Role.DEPARTMENT_ADMIN:
            return bool(user.department_id)
        return UserDepartmentRole.objects.filter(
            user=user, role=UserDepartmentRole.Role.DEPARTMENT_ADMIN, is_active=True
        ).exists()

    def has_object_permission(self, request, view, obj):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        if getattr(user, "is_superuser", False):
            return True

        dept = getattr(obj, "department", None)
        if dept is None and hasattr(obj, "policy"):
            dept = obj.policy.department
        elif dept is None and hasattr(obj, "policy_version"):
            dept = obj.policy_version.policy.department
        elif dept is None and hasattr(obj, "teaching_plan"):
            dept = obj.teaching_plan.policy_version.policy.department

        if not dept:
            return False

        role = str(getattr(user, "role", "") or "").lower()

        # Reject teachers, students, coordinators
        if role in {User.Role.TEACHER, User.Role.STUDENT, User.Role.COORDINATOR}:
            return False

        if request.method in SAFE_METHODS:
            if getattr(user, "is_superuser", False) or role == User.Role.PLATFORM_ADMIN:
                return True
            if role == User.Role.INSTITUTION_ADMIN:
                return user.institution_id is not None and user.institution_id == dept.institution_id
            if is_user_department_admin_for_department(user, dept.id):
                return True
            return False

        # Write operations: MUST be Department Admin of this exact department, Institution Admin of this institution, or Super Admin
        if getattr(user, "is_superuser", False) or role == User.Role.PLATFORM_ADMIN:
            return True
        if role == User.Role.INSTITUTION_ADMIN:
            return user.institution_id is not None and user.institution_id == dept.institution_id
        return is_user_department_admin_for_department(user, dept.id)
