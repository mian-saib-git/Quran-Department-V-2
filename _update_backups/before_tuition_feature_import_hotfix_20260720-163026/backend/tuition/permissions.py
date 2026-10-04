from rest_framework.permissions import BasePermission

from accounts.models import (
    Department,
    DepartmentFeature,
    UserDepartmentRole,
)


MANAGER_ROLES = {
    "platform_admin",
    "institution_admin",
    "department_admin",
    "coordinator",
}


def resolve_tuition_department(
    user,
    department_id=None,
):
    if not user or not user.is_authenticated:
        return None

    role = str(
        getattr(user, "role", "") or ""
    ).lower()

    if department_id:
        query = Department.objects.filter(
            id=department_id,
            department_type="tuition",
            is_active=True,
        )

        if (
            role == "institution_admin"
            and getattr(
                user,
                "institution_id",
                None,
            )
        ):
            query = query.filter(
                institution_id=user.institution_id
            )

        if (
            user.is_superuser
            or role in {
                "platform_admin",
                "institution_admin",
            }
        ):
            return query.first()

        linked = (
            UserDepartmentRole.objects
            .filter(
                user=user,
                department_id=department_id,
                is_active=True,
                department__department_type=(
                    "tuition"
                ),
                department__is_active=True,
            )
            .select_related("department")
            .first()
        )

        if linked:
            return linked.department

        if (
            getattr(user, "department_id", None)
            == int(department_id)
        ):
            return query.first()

        return None

    direct_department = getattr(
        user,
        "department",
        None,
    )

    if (
        direct_department
        and direct_department.department_type
        == "tuition"
        and direct_department.is_active
    ):
        return direct_department

    role_link = (
        UserDepartmentRole.objects
        .filter(
            user=user,
            is_active=True,
            department__department_type=(
                "tuition"
            ),
            department__is_active=True,
        )
        .select_related(
            "department",
            "department__institution",
        )
        .first()
    )

    if role_link:
        return role_link.department

    if (
        user.is_superuser
        or role in {
            "platform_admin",
            "institution_admin",
        }
    ):
        query = Department.objects.filter(
            department_type="tuition",
            is_active=True,
        )

        if (
            role == "institution_admin"
            and getattr(
                user,
                "institution_id",
                None,
            )
        ):
            query = query.filter(
                institution_id=user.institution_id
            )

        return query.order_by("id").first()

    return None


def tuition_role_for_user(
    user,
    department,
):
    if not user or not department:
        return ""

    linked_role = (
        UserDepartmentRole.objects
        .filter(
            user=user,
            department=department,
            is_active=True,
        )
        .values_list("role", flat=True)
        .first()
    )

    if linked_role:
        return str(linked_role).lower()

    if (
        getattr(user, "department_id", None)
        == department.id
    ):
        return str(
            getattr(user, "role", "") or ""
        ).lower()

    return ""


def tuition_feature_enabled(
    user,
    feature_key,
    department=None,
):
    if not user or not user.is_authenticated:
        return False

    if user.is_superuser:
        return True

    department = (
        department
        or resolve_tuition_department(user)
    )

    if not department:
        return False

    feature = (
        Feature.objects
        .filter(
            key=feature_key,
            is_active=True,
            department_type="tuition",
        )
        .first()
    )

    if not feature:
        return False

    setting = (
        DepartmentFeature.objects
        .filter(
            department=department,
            feature=feature,
        )
        .first()
    )

    # Missing means "not configured yet", not "disabled". This keeps newly
    # created or partially migrated Tuition departments usable while preserving
    # every explicit Main Admin disable action.
    return True if setting is None else bool(setting.is_enabled)


class TuitionDepartmentAccessPermission(
    BasePermission
):
    message = (
        "You do not have access to an "
        "active Tuition Department."
    )

    def has_permission(self, request, view):
        department_id = (
            request.query_params.get(
                "department_id"
            )
            or request.data.get(
                "department_id"
            )
        )

        department = resolve_tuition_department(
            request.user,
            department_id=department_id,
        )

        if not department:
            return False

        request.tuition_department = department
        return True


class TuitionManagerPermission(
    BasePermission
):
    message = (
        "Only Tuition coordinators, department "
        "admins and SaaS managers can perform "
        "this action."
    )

    def has_permission(self, request, view):
        if request.user.is_superuser:
            return True

        department = getattr(
            request,
            "tuition_department",
            None,
        )

        role = tuition_role_for_user(
            request.user,
            department,
        )

        global_role = str(
            getattr(
                request.user,
                "role",
                "",
            )
            or ""
        ).lower()

        return bool(
            role in MANAGER_ROLES
            or global_role in {
                "platform_admin",
                "institution_admin",
            }
        )


class TuitionFeaturePermission(
    BasePermission
):
    message = (
        "This Tuition feature is disabled "
        "from the SaaS feature settings."
    )

    def has_permission(self, request, view):
        configured_keys = getattr(
            view,
            "feature_keys",
            None,
        )
        single_key = getattr(
            view,
            "feature_key",
            "",
        )

        if configured_keys:
            feature_keys = tuple(
                str(key).strip()
                for key in configured_keys
                if str(key).strip()
            )
        elif single_key:
            feature_keys = (str(single_key).strip(),)
        else:
            feature_keys = ()

        if not feature_keys:
            return True

        department = getattr(
            request,
            "tuition_department",
            None,
        )

        return any(
            tuition_feature_enabled(
                request.user,
                feature_key,
                department=department,
            )
            for feature_key in feature_keys
        )
