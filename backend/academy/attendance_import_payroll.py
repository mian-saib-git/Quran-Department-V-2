"""Shared salary-source safety checks for both attendance CSV importers.

Importing attendance is a payroll-source mutation, just like manually marking
attendance.  These checks run inside the same database transaction as writes.
"""
from django.core.management.base import CommandError

from .payroll_source_locks import (
    student_attendance_payroll_lock_payload,
    teacher_session_payroll_lock_payload,
)


class AttendanceImportPayrollLocked(CommandError):
    pass


def import_scope(teacher, student=None):
    department = (
        getattr(teacher, "department", None)
        or getattr(getattr(teacher, "user", None), "department", None)
        or (getattr(student, "department", None) if student else None)
        or (getattr(getattr(student, "user", None), "department", None) if student else None)
    )
    institution = (
        getattr(teacher, "institution", None)
        or getattr(getattr(teacher, "user", None), "institution", None)
        or (getattr(department, "institution", None) if department else None)
    )
    return department, institution


def assert_import_unlocked(*, teacher, target_date, class_key, student=None):
    department, _ = import_scope(teacher, student)
    teacher_lock = teacher_session_payroll_lock_payload(
        department=department,
        teacher=teacher,
        target_date=target_date,
        class_key=class_key or "",
    )
    if teacher_lock:
        raise AttendanceImportPayrollLocked(teacher_lock.get(
            "detail", "Teacher payroll is locked for this imported attendance date."
        ))

    if student is not None:
        student_lock = student_attendance_payroll_lock_payload(
            student=student,
            target_date=target_date,
            department=department,
        )
        if student_lock:
            raise AttendanceImportPayrollLocked(student_lock.get(
                "detail", "Student payroll is locked for this imported attendance date."
            ))
