from dataclasses import dataclass

from django.db import transaction
from django.db.models import Q
from django.db.models.deletion import ProtectedError

from academy.models import (
    Attendance,
    ClassSchedule,
    DailyLessonReport,
    DailyLessonSubjectEntry,
    Lesson,
    LessonAccessPermission,
    LessonAccessRequest,
    MonthlyLessonPlan,
    MonthlyLessonSummary,
    StudentProfile,
    StudentSubject,
    TeacherProfile,
)

from .models import Department, Institution, User, UserDepartmentRole


@dataclass
class AccountDeletionSummary:
    deleted_accounts: int = 0
    preserved_accounts: int = 0


def _department_candidate_users(department):
    return (
        User.objects.filter(
            Q(department_id=department.id)
            | Q(department_roles__department_id=department.id)
            | Q(teacher_profile__department_id=department.id)
            | Q(student_profile__department_id=department.id)
        )
        .distinct()
        .order_by("id")
    )


def _institution_candidate_users(institution):
    return (
        User.objects.filter(
            Q(institution_id=institution.id)
            | Q(department__institution_id=institution.id)
            | Q(department_roles__institution_id=institution.id)
            | Q(teacher_profile__institution_id=institution.id)
            | Q(teacher_profile__department__institution_id=institution.id)
            | Q(student_profile__institution_id=institution.id)
            | Q(student_profile__department__institution_id=institution.id)
        )
        .distinct()
        .order_by("id")
    )


def _has_external_department_scope(user, department):
    if user.department_id and user.department_id != department.id:
        return True

    if user.institution_id and user.institution_id != department.institution_id:
        return True

    return UserDepartmentRole.objects.filter(user=user, is_active=True).exclude(
        department_id=department.id
    ).exists()


def _has_external_institution_scope(user, institution):
    if user.institution_id and user.institution_id != institution.id:
        return True

    if user.department_id:
        external_primary = Department.objects.filter(id=user.department_id).exclude(
            institution_id=institution.id
        ).exists()
        if external_primary:
            return True

    return UserDepartmentRole.objects.filter(user=user, is_active=True).exclude(
        institution_id=institution.id
    ).exists()


def _can_delete_scoped_user(user, actor, *, department=None, institution=None):
    if user.id == actor.id or user.is_superuser:
        return False

    if user.role == User.Role.PLATFORM_ADMIN:
        return False

    if department is not None:
        if user.role == User.Role.INSTITUTION_ADMIN:
            return False
        return not _has_external_department_scope(user, department)

    if institution is not None:
        return not _has_external_institution_scope(user, institution)

    return False


def _scope_filter(*, department=None, institution=None):
    if department is not None:
        return Q(department_id=department.id)

    return Q(institution_id=institution.id) | Q(
        department__institution_id=institution.id
    )


def _delete_scoped_academy_data(*, department=None, institution=None):
    scope = _scope_filter(department=department, institution=institution)

    # Delete leaf/detail records first. This prevents protected teacher/user
    # references from blocking account cleanup later in the transaction.
    model_order = (
        LessonAccessRequest,
        LessonAccessPermission,
        DailyLessonSubjectEntry,
        Attendance,
        ClassSchedule,
        Lesson,
        DailyLessonReport,
        MonthlyLessonPlan,
        MonthlyLessonSummary,
        StudentSubject,
    )

    deleted_rows = 0
    for model in model_order:
        deleted_count, _details = model.objects.filter(scope).delete()
        deleted_rows += deleted_count

    return deleted_rows


def _delete_user_account(user):
    """Delete a scoped account and all Quran profile dependencies."""
    if user.role == User.Role.STUDENT:
        try:
            student = user.student_profile
        except StudentProfile.DoesNotExist:
            student = None

        if student:
            Attendance.objects.filter(student=student).delete()
            StudentSubject.objects.filter(student=student).delete()
            ClassSchedule.objects.filter(student=student).delete()
            LessonAccessRequest.objects.filter(student=student).delete()
            LessonAccessPermission.objects.filter(student=student).delete()
            DailyLessonReport.objects.filter(student=student).delete()
            MonthlyLessonPlan.objects.filter(student=student).delete()
            MonthlyLessonSummary.objects.filter(student=student).delete()
            Lesson.objects.filter(student=student).delete()

    elif user.role == User.Role.TEACHER:
        try:
            teacher = user.teacher_profile
        except TeacherProfile.DoesNotExist:
            teacher = None

        if teacher:
            students = list(
                StudentProfile.objects.filter(teacher=teacher).select_related("user")
            )

            for student in students:
                Attendance.objects.filter(student=student).delete()
                StudentSubject.objects.filter(student=student).delete()
                ClassSchedule.objects.filter(student=student).delete()
                LessonAccessRequest.objects.filter(student=student).delete()
                LessonAccessPermission.objects.filter(student=student).delete()
                DailyLessonReport.objects.filter(student=student).delete()
                MonthlyLessonPlan.objects.filter(student=student).delete()
                MonthlyLessonSummary.objects.filter(student=student).delete()
                Lesson.objects.filter(student=student).delete()
                student.delete()

            Attendance.objects.filter(teacher=teacher).delete()
            ClassSchedule.objects.filter(teacher=teacher).delete()
            LessonAccessRequest.objects.filter(teacher=teacher).delete()
            LessonAccessPermission.objects.filter(teacher=teacher).delete()
            DailyLessonReport.objects.filter(teacher=teacher).delete()
            MonthlyLessonPlan.objects.filter(teacher=teacher).delete()
            MonthlyLessonSummary.objects.filter(teacher=teacher).delete()
            Lesson.objects.filter(teacher=teacher).delete()

    user.delete()


def _delete_candidate_accounts(user_ids):
    summary = AccountDeletionSummary()

    for user_id in user_ids:
        try:
            with transaction.atomic():
                user = User.objects.get(id=user_id)
                _delete_user_account(user)
            summary.deleted_accounts += 1
        except (User.DoesNotExist, ProtectedError):
            summary.preserved_accounts += 1

    return summary


@transaction.atomic
def permanently_delete_department(department, actor):
    candidate_users = list(_department_candidate_users(department))
    delete_user_ids = [
        user.id
        for user in candidate_users
        if _can_delete_scoped_user(user, actor, department=department)
    ]
    preserved_before_delete = len(candidate_users) - len(delete_user_ids)

    academy_rows = _delete_scoped_academy_data(department=department)

    department_id = department.id
    department_name = department.name
    institution_id = department.institution_id
    department.delete()

    account_summary = _delete_candidate_accounts(delete_user_ids)
    account_summary.preserved_accounts += preserved_before_delete

    return {
        "id": department_id,
        "name": department_name,
        "institution_id": institution_id,
        "academy_rows_deleted": academy_rows,
        "accounts_deleted": account_summary.deleted_accounts,
        "accounts_preserved": account_summary.preserved_accounts,
    }


@transaction.atomic
def permanently_delete_institution(institution, actor):
    candidate_users = list(_institution_candidate_users(institution))
    delete_user_ids = [
        user.id
        for user in candidate_users
        if _can_delete_scoped_user(user, actor, institution=institution)
    ]
    preserved_before_delete = len(candidate_users) - len(delete_user_ids)

    department_count = institution.departments.count()
    academy_rows = _delete_scoped_academy_data(institution=institution)

    institution_id = institution.id
    institution_name = institution.name
    institution.delete()

    account_summary = _delete_candidate_accounts(delete_user_ids)
    account_summary.preserved_accounts += preserved_before_delete

    return {
        "id": institution_id,
        "name": institution_name,
        "departments_deleted": department_count,
        "academy_rows_deleted": academy_rows,
        "accounts_deleted": account_summary.deleted_accounts,
        "accounts_preserved": account_summary.preserved_accounts,
    }
