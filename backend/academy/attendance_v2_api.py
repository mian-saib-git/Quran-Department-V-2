from __future__ import annotations

from datetime import date, datetime

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import PlatformAuditLog

from .models import (
    Attendance,
    ClassSchedule,
    QuranClassCoverage,
    StudentProfile,
    TeacherProfile,
)

from .salary_v2_service import (
    build_department_month_context,
    decimal_text,
    teacher_rate_for_date,
)

from .ws_notify import notify_global


ATTENDANCE_MANAGER_ROLES = {
    "coordinator",
    "department_admin",
    "institution_admin",
}


def _quran_department(user):
    department = getattr(user, "department", None)

    if not department:
        return None

    if (
        str(
            getattr(
                department,
                "department_type",
                "",
            )
        ).lower()
        != "quran"
    ):
        return None

    return department


def _can_manage_attendance(user):
    role = str(
        getattr(user, "role", "") or ""
    ).lower()

    return bool(
        getattr(user, "is_superuser", False)
        or role in ATTENDANCE_MANAGER_ROLES
    )


def _profile_in_department(profile, department):
    return bool(
        profile
        and (
            profile.department_id == department.id
            or getattr(
                profile.user,
                "department_id",
                None,
            )
            == department.id
        )
    )


def _parse_date(value):
    try:
        parsed = datetime.strptime(
            str(value or "").strip(),
            "%Y-%m-%d",
        ).date()
    except (TypeError, ValueError):
        raise ValueError(
            "date must use YYYY-MM-DD format."
        )

    if parsed > timezone.localdate():
        raise ValueError(
            "Future attendance dates are not allowed."
        )

    return parsed


def _parse_class_key(value):
    raw = str(value or "").strip()

    try:
        session_time = datetime.strptime(
            raw,
            "%H:%M",
        ).time()
    except (TypeError, ValueError):
        raise ValueError(
            "class_key must use HH:MM format."
        )

    return raw, session_time


def _effective_schedule_queryset(
    *,
    department,
    target_date,
    session_time=None,
    teacher=None,
):
    weekday = target_date.strftime(
        "%A"
    ).lower()

    rows = ClassSchedule.objects.filter(
        department=department,
        weekday=weekday,
    )

    if teacher is not None:
        rows = rows.filter(
            teacher=teacher,
        )

    if session_time is not None:
        rows = rows.filter(
            time_slot=session_time,
        )

    rows = rows.filter(
        Q(effective_from__isnull=True)
        | Q(effective_from__lte=target_date)
    ).filter(
        Q(effective_to__isnull=True)
        | Q(effective_to__gte=target_date)
    )

    # Closed historical rows are valid inside their date range.
    # Inactive rows with no closing date are invalid legacy rows.
    rows = rows.exclude(
        is_active=False,
        effective_to__isnull=True,
    )

    return rows


def _session_rows(
    department,
    teacher,
    target_date,
    session_time,
):
    rows = (
        _effective_schedule_queryset(
            department=department,
            teacher=teacher,
            target_date=target_date,
            session_time=session_time,
        )
        .select_related(
            "student__user",
            "student__department",
            "student__institution",
            "teacher__user",
        )
        .order_by(
            "student_id",
            "-effective_from",
            "-id",
        )
    )

    # Defensive dedupe in case old schedule data ever overlaps.
    by_student = {}

    for row in rows:
        if row.student_id not in by_student:
            by_student[row.student_id] = row

    return list(
        by_student.values()
    )


def _student_attendance_map(
    student_ids,
    target_date,
):
    if not student_ids:
        return {}

    rows = Attendance.objects.filter(
        entity_type=Attendance.EntityType.STUDENT,
        student_id__in=student_ids,
        date=target_date,
    ).order_by(
        "student_id",
        "-updated_at",
        "-id",
    )

    result = {}

    for row in rows:
        if row.student_id not in result:
            result[row.student_id] = row

    return result


def _student_status_value(attendance):
    if attendance is None:
        return (
            QuranClassCoverage
            .StudentStatus
            .NOT_MARKED
        )

    if attendance.status == Attendance.Status.PRESENT:
        return (
            QuranClassCoverage
            .StudentStatus
            .PRESENT
        )

    if attendance.status == Attendance.Status.ABSENT:
        return (
            QuranClassCoverage
            .StudentStatus
            .ABSENT
        )

    if attendance.status == Attendance.Status.LEAVE:
        return (
            QuranClassCoverage
            .StudentStatus
            .LEAVE
        )

    return (
        QuranClassCoverage
        .StudentStatus
        .NOT_MARKED
    )


def _student_requires_substitute(student_status):
    return student_status not in {
        QuranClassCoverage.StudentStatus.ABSENT,
        QuranClassCoverage.StudentStatus.LEAVE,
    }


def _busy_teacher_ids(
    *,
    department,
    target_date,
    class_key,
    session_time,
):
    scheduled_ids = set(
        _effective_schedule_queryset(
            department=department,
            target_date=target_date,
            session_time=session_time,
        )
        .values_list(
            "teacher_id",
            flat=True,
        )
        .distinct()
    )

    unavailable_ids = set(
        Attendance.objects.filter(
            entity_type=Attendance.EntityType.TEACHER,
            date=target_date,
            class_key=class_key,
            status__in=[
                Attendance.Status.ABSENT,
                Attendance.Status.LEAVE,
            ],
        )
        .filter(
            Q(department=department)
            | Q(teacher__department=department)
            | Q(
                teacher__user__department=department
            )
        )
        .values_list(
            "teacher_id",
            flat=True,
        )
    )

    return scheduled_ids | unavailable_ids


def _available_substitutes(
    *,
    department,
    original_teacher,
    target_date,
    class_key,
    session_time,
):
    busy_ids = _busy_teacher_ids(
        department=department,
        target_date=target_date,
        class_key=class_key,
        session_time=session_time,
    )

    rows = (
        TeacherProfile.objects
        .select_related("user")
        .filter(
            Q(department=department)
            | Q(user__department=department)
        )
        .filter(
            user__is_active=True,
        )
        .exclude(
            id=original_teacher.id,
        )
        .exclude(
            id__in=busy_ids,
        )
        .distinct()
        .order_by(
            "user__first_name",
            "user__last_name",
            "user__username",
            "id",
        )
    )

    return list(rows)


def _coverage_payload(row):
    return {
        "id": row.id,
        "student_id": row.student_id,
        "student_name": str(row.student),
        "date": str(row.date),
        "class_key": row.class_key,
        "teacher_status": row.teacher_status,
        "student_status": row.student_status,
        "coverage_status": row.coverage_status,
        "original_teacher_id": (
            row.original_teacher_id
        ),
        "original_teacher_name": str(
            row.original_teacher
        ),
        "substitute_teacher_id": (
            row.substitute_teacher_id
        ),
        "substitute_teacher_name": (
            str(row.substitute_teacher)
            if row.substitute_teacher
            else ""
        ),
        "original_teacher_rate": decimal_text(
            row.original_teacher_rate
        ),
        "substitute_rate": decimal_text(
            row.substitute_rate
        ),
        "schedule_id": row.schedule_id,
        "teacher_attendance_id": (
            row.teacher_attendance_id
        ),
    }


def _build_session_payload(
    *,
    department,
    teacher,
    target_date,
    class_key,
    session_time,
):
    schedules = _session_rows(
        department,
        teacher,
        target_date,
        session_time,
    )

    student_ids = [
        row.student_id
        for row in schedules
    ]

    attendance_by_student = (
        _student_attendance_map(
            student_ids,
            target_date,
        )
    )

    coverages = (
        QuranClassCoverage.objects
        .select_related(
            "student__user",
            "original_teacher__user",
            "substitute_teacher__user",
        )
        .filter(
            department=department,
            original_teacher=teacher,
            date=target_date,
            class_key=class_key,
            student_id__in=student_ids,
        )
    )

    coverage_by_student = {
        row.student_id: row
        for row in coverages
    }

    teacher_attendance = (
        Attendance.objects
        .filter(
            entity_type=Attendance.EntityType.TEACHER,
            teacher=teacher,
            date=target_date,
            class_key=class_key,
        )
        .order_by(
            "-updated_at",
            "-id",
        )
        .first()
    )

    students = []

    for schedule in schedules:
        student = schedule.student
        student_attendance = (
            attendance_by_student.get(
                student.id
            )
        )

        student_status = (
            _student_status_value(
                student_attendance
            )
        )

        coverage = coverage_by_student.get(
            student.id
        )

        students.append({
            "student_id": student.id,
            "student_name": str(student),
            "schedule_id": schedule.id,
            "student_attendance_id": (
                student_attendance.id
                if student_attendance
                else None
            ),
            "student_status": student_status,
            "requires_substitute": (
                _student_requires_substitute(
                    student_status
                )
            ),
            "coverage": (
                _coverage_payload(coverage)
                if coverage
                else None
            ),
        })

    substitutes = _available_substitutes(
        department=department,
        original_teacher=teacher,
        target_date=target_date,
        class_key=class_key,
        session_time=session_time,
    )

    return {
        "department": {
            "id": department.id,
            "name": department.name,
        },
        "teacher": {
            "id": teacher.id,
            "name": str(teacher),
        },
        "date": str(target_date),
        "class_key": class_key,
        "teacher_attendance": (
            {
                "id": teacher_attendance.id,
                "status": teacher_attendance.status,
                "marked_by_id": (
                    teacher_attendance.marked_by_id
                ),
                "updated_at": (
                    teacher_attendance
                    .updated_at
                    .isoformat()
                ),
            }
            if teacher_attendance
            else None
        ),
        "students": students,
        "available_substitutes": [
            {
                "id": item.id,
                "name": str(item),
            }
            for item in substitutes
        ],
    }


def _audit(
    user,
    *,
    action,
    summary,
    attendance,
    details,
):
    try:
        PlatformAuditLog.objects.create(
            actor=user,
            category="quran_salary",
            action=action,
            summary=summary,
            target_type="teacher_attendance",
            target_id=str(attendance.id),
            target_label=str(attendance.teacher),
            details=details,
        )
    except Exception:
        pass



def reconcile_student_coverage(
    *,
    student,
    target_date,
    actor=None,
    student_status=None,
):
    """
    Reconcile existing teacher-absence coverage after a student's
    attendance is created, changed, or deleted.

    Rules:

    Student Absent / Leave:
      - substitute is no longer required
      - coverage -> NOT_REQUIRED
      - substitute earning is cleared

    Student Present / Not Marked:
      - an already valid ASSIGNED substitute remains assigned
      - otherwise coverage -> UNRESOLVED

    CANCELLED rows are historical and never reactivated.
    """

    if isinstance(target_date, str):
        try:
            target_date = date.fromisoformat(
                target_date
            )
        except ValueError:
            raise ValueError(
                "target_date must use YYYY-MM-DD."
            )

    if student_status is None:
        attendance = (
            Attendance.objects
            .filter(
                entity_type=(
                    Attendance
                    .EntityType
                    .STUDENT
                ),
                student=student,
                date=target_date,
            )
            .order_by(
                "-updated_at",
                "-id",
            )
            .first()
        )

        normalized_status = (
            _student_status_value(
                attendance
            )
        )
    else:
        raw = str(
            getattr(
                student_status,
                "value",
                student_status,
            )
            or ""
        ).strip().lower()

        mapping = {
            "present": (
                QuranClassCoverage
                .StudentStatus
                .PRESENT
            ),
            "absent": (
                QuranClassCoverage
                .StudentStatus
                .ABSENT
            ),
            "leave": (
                QuranClassCoverage
                .StudentStatus
                .LEAVE
            ),
            "not_marked": (
                QuranClassCoverage
                .StudentStatus
                .NOT_MARKED
            ),
            "not marked": (
                QuranClassCoverage
                .StudentStatus
                .NOT_MARKED
            ),
        }

        normalized_status = mapping.get(
            raw,
            QuranClassCoverage
            .StudentStatus
            .NOT_MARKED,
        )

    coverages = (
        QuranClassCoverage.objects
        .select_for_update()
        .select_related(
            "student__user",
            "original_teacher__user",
            "substitute_teacher__user",
            "teacher_attendance",
        )
        .filter(
            student=student,
            date=target_date,
            teacher_status__in=[
                QuranClassCoverage
                .TeacherStatus
                .ABSENT,
                QuranClassCoverage
                .TeacherStatus
                .LEAVE,
            ],
        )
        .exclude(
            coverage_status=(
                QuranClassCoverage
                .CoverageStatus
                .CANCELLED
            )
        )
    )

    changed = 0
    unresolved = 0
    not_required = 0
    assigned = 0

    for coverage in coverages:
        before = {
            "student_status":
                coverage.student_status,
            "coverage_status":
                coverage.coverage_status,
            "substitute_teacher_id":
                coverage.substitute_teacher_id,
            "substitute_rate":
                str(coverage.substitute_rate),
        }

        teacher_attendance = (
            coverage.teacher_attendance
        )

        # Defensive protection for stale historical rows.
        if (
            teacher_attendance is None
            or teacher_attendance.status
            not in {
                Attendance.Status.ABSENT,
                Attendance.Status.LEAVE,
            }
        ):
            coverage.coverage_status = (
                QuranClassCoverage
                .CoverageStatus
                .CANCELLED
            )

            coverage.student_status = (
                normalized_status
            )

            coverage.save(
                update_fields=[
                    "coverage_status",
                    "student_status",
                    "updated_at",
                ]
            )

            changed += 1
            continue

        coverage.student_status = (
            normalized_status
        )

        if normalized_status in {
            QuranClassCoverage
            .StudentStatus
            .ABSENT,
            QuranClassCoverage
            .StudentStatus
            .LEAVE,
        }:
            # The student did not attend.
            # No substitute earns for this student/session.
            coverage.coverage_status = (
                QuranClassCoverage
                .CoverageStatus
                .NOT_REQUIRED
            )

            coverage.substitute_teacher = None
            coverage.substitute_rate = 0

            not_required += 1

        else:
            # Present or Not Marked requires coverage.
            #
            # If an already assigned substitute remains attached,
            # preserve it. This avoids destroying a valid assignment
            # when Present changes to Not Marked or vice versa.
            if (
                coverage.coverage_status
                == QuranClassCoverage
                .CoverageStatus
                .ASSIGNED
                and coverage
                .substitute_teacher_id
            ):
                assigned += 1

            else:
                coverage.coverage_status = (
                    QuranClassCoverage
                    .CoverageStatus
                    .UNRESOLVED
                )

                coverage.substitute_teacher = None
                coverage.substitute_rate = 0

                unresolved += 1

        after = {
            "student_status":
                coverage.student_status,
            "coverage_status":
                coverage.coverage_status,
            "substitute_teacher_id":
                coverage.substitute_teacher_id,
            "substitute_rate":
                str(coverage.substitute_rate),
        }

        if before != after:
            coverage.save(
                update_fields=[
                    "student_status",
                    "coverage_status",
                    "substitute_teacher",
                    "substitute_rate",
                    "updated_at",
                ]
            )

            changed += 1

            if actor is not None:
                try:
                    PlatformAuditLog.objects.create(
                        actor=actor,
                        category="quran_salary",
                        action=(
                            "student_coverage_"
                            "reconciled_v2"
                        ),
                        summary=(
                            f"Coverage reconciled "
                            f"for {student} on "
                            f"{target_date}."
                        ),
                        target_type=(
                            "quran_class_coverage"
                        ),
                        target_id=str(
                            coverage.id
                        ),
                        target_label=(
                            f"{student} / "
                            f"{target_date} / "
                            f"{coverage.class_key}"
                        ),
                        details={
                            "before": before,
                            "after": after,
                            "teacher_id": (
                                coverage
                                .original_teacher_id
                            ),
                            "student_id": (
                                student.id
                            ),
                            "date": str(
                                target_date
                            ),
                            "class_key": (
                                coverage.class_key
                            ),
                        },
                    )
                except Exception:
                    pass

    return {
        "changed": changed,
        "unresolved": unresolved,
        "not_required": not_required,
        "assigned": assigned,
        "student_status": (
            normalized_status
        ),
    }


class QuranTeacherSessionAttendanceView(APIView):
    """
    Transactional teacher session attendance + substitute coverage API.

    GET:
      Load one real teacher session, student attendance states,
      existing coverage and available substitute teachers.

    POST:
      Save teacher Present/Absent/Leave.

      Present:
        no substitute coverage is required.

      Absent/Leave:
        student Present/Not Marked -> substitute is mandatory
        student Absent/Leave      -> no substitute is paid

      The full operation is atomic.
    """

    permission_classes = [IsAuthenticated]

    def _access(self, request):
        if not _can_manage_attendance(
            request.user
        ):
            return None, Response(
                {
                    "detail": (
                        "Only Quran attendance managers "
                        "can manage teacher sessions."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        department = _quran_department(
            request.user
        )

        if not department:
            return None, Response(
                {
                    "detail": (
                        "A Quran department assignment "
                        "is required."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        return department, None

    def _resolve_session(
        self,
        request,
        *,
        source,
    ):
        department, error = self._access(
            request
        )

        if error:
            return None, error

        try:
            teacher_id = int(
                source.get("teacher_id")
            )
        except (TypeError, ValueError):
            return None, Response(
                {
                    "detail": (
                        "teacher_id is required."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            target_date = _parse_date(
                source.get("date")
            )

            class_key, session_time = (
                _parse_class_key(
                    source.get("class_key")
                    or source.get("classKey")
                )
            )
        except ValueError as exc:
            return None, Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            teacher = (
                TeacherProfile.objects
                .select_related(
                    "user",
                    "department",
                    "institution",
                )
                .get(id=teacher_id)
            )
        except TeacherProfile.DoesNotExist:
            return None, Response(
                {"detail": "Teacher not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not _profile_in_department(
            teacher,
            department,
        ):
            return None, Response(
                {
                    "detail": (
                        "Teacher is outside your "
                        "Quran department."
                    )
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        schedules = _session_rows(
            department,
            teacher,
            target_date,
            session_time,
        )

        if not schedules:
            return None, Response(
                {
                    "detail": (
                        "No effective scheduled class "
                        "exists for this teacher, date "
                        "and time."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        return {
            "department": department,
            "teacher": teacher,
            "target_date": target_date,
            "class_key": class_key,
            "session_time": session_time,
            "schedules": schedules,
        }, None

    def get(self, request):
        session, error = self._resolve_session(
            request,
            source=request.query_params,
        )

        if error:
            return error

        payload = _build_session_payload(
            department=session["department"],
            teacher=session["teacher"],
            target_date=session["target_date"],
            class_key=session["class_key"],
            session_time=session["session_time"],
        )

        return Response(payload)

    @transaction.atomic
    def post(self, request):
        session, error = self._resolve_session(
            request,
            source=request.data,
        )

        if error:
            return error

        department = session["department"]
        teacher = session["teacher"]
        target_date = session["target_date"]
        class_key = session["class_key"]
        session_time = session["session_time"]
        schedules = session["schedules"]

        teacher_status = str(
            request.data.get("status") or ""
        ).strip().lower()

        if teacher_status not in {
            Attendance.Status.PRESENT,
            Attendance.Status.ABSENT,
            Attendance.Status.LEAVE,
        }:
            return Response(
                {
                    "detail": (
                        "status must be present, "
                        "absent, or leave."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        student_ids = [
            row.student_id
            for row in schedules
        ]

        schedule_by_student = {
            row.student_id: row
            for row in schedules
        }

        attendance_by_student = (
            _student_attendance_map(
                student_ids,
                target_date,
            )
        )

        student_status_by_id = {}

        for student_id in student_ids:
            student_status_by_id[
                student_id
            ] = _student_status_value(
                attendance_by_student.get(
                    student_id
                )
            )

        raw_assignments = (
            request.data.get(
                "coverage_assignments"
            )
            or []
        )

        if not isinstance(
            raw_assignments,
            list,
        ):
            return Response(
                {
                    "detail": (
                        "coverage_assignments "
                        "must be a list."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        assignments = {}

        for row in raw_assignments:
            if not isinstance(row, dict):
                return Response(
                    {
                        "detail": (
                            "Every coverage assignment "
                            "must be an object."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                student_id = int(
                    row.get("student_id")
                )

                substitute_id = int(
                    row.get(
                        "substitute_teacher_id"
                    )
                )
            except (TypeError, ValueError):
                return Response(
                    {
                        "detail": (
                            "Every coverage assignment "
                            "requires valid student_id "
                            "and substitute_teacher_id."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if student_id in assignments:
                return Response(
                    {
                        "detail": (
                            "Duplicate substitute "
                            f"assignment for student "
                            f"{student_id}."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            assignments[
                student_id
            ] = substitute_id

        if (
            teacher_status
            == Attendance.Status.PRESENT
            and assignments
        ):
            return Response(
                {
                    "detail": (
                        "Present teacher sessions "
                        "cannot contain substitute "
                        "assignments."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        substitute_objects = {}

        if teacher_status in {
            Attendance.Status.ABSENT,
            Attendance.Status.LEAVE,
        }:
            required_ids = {
                student_id
                for (
                    student_id,
                    student_status,
                )
                in student_status_by_id.items()
                if _student_requires_substitute(
                    student_status
                )
            }

            provided_ids = set(
                assignments.keys()
            )

            missing_ids = (
                required_ids
                - provided_ids
            )

            extra_ids = (
                provided_ids
                - required_ids
            )

            if missing_ids:
                return Response(
                    {
                        "detail": (
                            "A substitute teacher is "
                            "required for every "
                            "Present/Not Marked student."
                        ),
                        "missing_student_ids": sorted(
                            missing_ids
                        ),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if extra_ids:
                return Response(
                    {
                        "detail": (
                            "Substitute assignments "
                            "were supplied for students "
                            "who are Absent/Leave or "
                            "outside this session."
                        ),
                        "extra_student_ids": sorted(
                            extra_ids
                        ),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            substitute_ids = set(
                assignments.values()
            )

            candidates = {
                item.id: item
                for item in (
                    TeacherProfile.objects
                    .select_related(
                        "user",
                        "department",
                        "institution",
                    )
                    .filter(
                        id__in=substitute_ids
                    )
                )
            }

            available = {
                item.id: item
                for item in _available_substitutes(
                    department=department,
                    original_teacher=teacher,
                    target_date=target_date,
                    class_key=class_key,
                    session_time=session_time,
                )
            }

            for student_id, substitute_id in (
                assignments.items()
            ):
                substitute = candidates.get(
                    substitute_id
                )

                if not substitute:
                    return Response(
                        {
                            "detail": (
                                "One of the selected "
                                "substitute teachers "
                                "does not exist."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if not _profile_in_department(
                    substitute,
                    department,
                ):
                    return Response(
                        {
                            "detail": (
                                f"{substitute} is "
                                "outside this Quran "
                                "department."
                            )
                        },
                        status=status.HTTP_403_FORBIDDEN,
                    )

                if substitute.id == teacher.id:
                    return Response(
                        {
                            "detail": (
                                "The original teacher "
                                "cannot substitute "
                                "their own absence."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if substitute.id not in available:
                    return Response(
                        {
                            "detail": (
                                f"{substitute} is not "
                                "available at "
                                f"{class_key} on "
                                f"{target_date}."
                            )
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                substitute_objects[
                    student_id
                ] = substitute

        # Build one rate context for this department/month.
        rate_context = (
            build_department_month_context(
                department,
                target_date.year,
                target_date.month,
                request.user,
            )
        )

        (
            original_rate,
            original_class_count,
            original_policy,
        ) = teacher_rate_for_date(
            rate_context,
            teacher.id,
            target_date,
        )

        attendance, _created = (
            Attendance.objects
            .update_or_create(
                entity_type=(
                    Attendance
                    .EntityType
                    .TEACHER
                ),
                teacher=teacher,
                date=target_date,
                class_key=class_key,
                defaults={
                    "student": None,
                    "status": teacher_status,
                    "marked_by": request.user,
                    "department": department,
                    "institution": (
                        teacher.institution
                        or department.institution
                    ),
                },
            )
        )

        now = timezone.now()

        if (
            teacher_status
            == Attendance.Status.PRESENT
        ):
            (
                QuranClassCoverage.objects
                .filter(
                    department=department,
                    original_teacher=teacher,
                    date=target_date,
                    class_key=class_key,
                )
                .update(
                    coverage_status=(
                        QuranClassCoverage
                        .CoverageStatus
                        .CANCELLED
                    ),
                    teacher_attendance=attendance,
                    assigned_by=request.user,
                    assigned_at=now,
                )
            )

        else:
            stale = (
                QuranClassCoverage.objects
                .filter(
                    department=department,
                    original_teacher=teacher,
                    date=target_date,
                    class_key=class_key,
                )
                .exclude(
                    student_id__in=student_ids
                )
            )

            stale.update(
                coverage_status=(
                    QuranClassCoverage
                    .CoverageStatus
                    .CANCELLED
                ),
                substitute_teacher=None,
                substitute_rate=0,
                teacher_attendance=attendance,
                assigned_by=request.user,
                assigned_at=now,
            )

            for student_id in student_ids:
                student_status = (
                    student_status_by_id[
                        student_id
                    ]
                )

                requires_substitute = (
                    _student_requires_substitute(
                        student_status
                    )
                )

                substitute = (
                    substitute_objects.get(
                        student_id
                    )
                    if requires_substitute
                    else None
                )

                substitute_rate = 0
                substitute_class_count = 0
                substitute_policy = None

                if substitute:
                    (
                        substitute_rate,
                        substitute_class_count,
                        substitute_policy,
                    ) = teacher_rate_for_date(
                        rate_context,
                        substitute.id,
                        target_date,
                    )

                coverage_status = (
                    QuranClassCoverage
                    .CoverageStatus
                    .ASSIGNED
                    if substitute
                    else (
                        QuranClassCoverage
                        .CoverageStatus
                        .NOT_REQUIRED
                    )
                )

                (
                    QuranClassCoverage.objects
                    .update_or_create(
                        date=target_date,
                        student_id=student_id,
                        original_teacher=teacher,
                        defaults={
                            "department": department,
                            "class_key": class_key,
                            "schedule": (
                                schedule_by_student[
                                    student_id
                                ]
                            ),
                            "teacher_attendance": attendance,
                            "substitute_teacher": substitute,
                            "teacher_status": teacher_status,
                            "student_status": student_status,
                            "coverage_status": coverage_status,
                            "original_teacher_rate": (
                                original_rate
                            ),
                            "substitute_rate": (
                                substitute_rate
                            ),
                            "reason": "",
                            "assigned_by": request.user,
                            "assigned_at": now,
                        },
                    )
                )

        _audit(
            request.user,
            action=(
                "teacher_session_attendance_v2"
            ),
            summary=(
                f"{teacher} marked "
                f"{teacher_status} for "
                f"{target_date} {class_key}."
            ),
            attendance=attendance,
            details={
                "department_id": department.id,
                "date": str(target_date),
                "class_key": class_key,
                "teacher_status": teacher_status,
                "student_count": len(student_ids),
                "original_rate": decimal_text(
                    original_rate
                ),
                "original_class_count": (
                    original_class_count
                ),
                "original_policy_id": (
                    original_policy.id
                ),
                "substitute_assignments": [
                    {
                        "student_id": student_id,
                        "substitute_teacher_id": (
                            substitute.id
                        ),
                    }
                    for (
                        student_id,
                        substitute,
                    )
                    in substitute_objects.items()
                ],
            },
        )

        try:
            notify_global(
                "academy_update",
                {
                    "event": (
                        "teacher_session_attendance_v2"
                    ),
                    "department_id": (
                        department.id
                    ),
                    "teacher_id": teacher.id,
                    "date": str(target_date),
                    "class_key": class_key,
                    "status": teacher_status,
                },
            )
        except Exception:
            pass

        payload = _build_session_payload(
            department=department,
            teacher=teacher,
            target_date=target_date,
            class_key=class_key,
            session_time=session_time,
        )

        return Response(
            payload,
            status=status.HTTP_200_OK,
        )


    @transaction.atomic
    def delete(self, request):
        """
        Safely unmark one teacher session.

        Coverage rows are retained for audit but moved to CANCELLED,
        so they can never affect salary calculations.
        """
        session, error = self._resolve_session(
            request,
            source=request.query_params,
        )

        if error:
            return error

        department = session["department"]
        teacher = session["teacher"]
        target_date = session["target_date"]
        class_key = session["class_key"]
        session_time = session["session_time"]

        attendance = (
            Attendance.objects
            .select_for_update()
            .filter(
                entity_type=(
                    Attendance.EntityType.TEACHER
                ),
                teacher=teacher,
                date=target_date,
                class_key=class_key,
            )
            .order_by("-id")
            .first()
        )

        if attendance:
            attendance_id = attendance.id

            _audit(
                request.user,
                action="teacher_session_unmarked_v2",
                summary=(
                    f"{teacher} attendance unmarked "
                    f"for {target_date} {class_key}."
                ),
                attendance=attendance,
                details={
                    "department_id": department.id,
                    "teacher_id": teacher.id,
                    "date": str(target_date),
                    "class_key": class_key,
                    "previous_status": attendance.status,
                },
            )

            (
                QuranClassCoverage.objects
                .filter(
                    department=department,
                    original_teacher=teacher,
                    date=target_date,
                    class_key=class_key,
                )
                .update(
                    coverage_status=(
                        QuranClassCoverage
                        .CoverageStatus
                        .CANCELLED
                    ),
                    assigned_by=request.user,
                    assigned_at=timezone.now(),
                )
            )

            attendance.delete()
        else:
            attendance_id = None

            # Idempotent cleanup in case an old/manual attendance
            # deletion happened before this endpoint existed.
            (
                QuranClassCoverage.objects
                .filter(
                    department=department,
                    original_teacher=teacher,
                    date=target_date,
                    class_key=class_key,
                )
                .update(
                    coverage_status=(
                        QuranClassCoverage
                        .CoverageStatus
                        .CANCELLED
                    ),
                    assigned_by=request.user,
                    assigned_at=timezone.now(),
                )
            )

        try:
            notify_global(
                "academy_update",
                {
                    "event": (
                        "teacher_session_unmarked_v2"
                    ),
                    "department_id": department.id,
                    "teacher_id": teacher.id,
                    "date": str(target_date),
                    "class_key": class_key,
                    "attendance_id": attendance_id,
                },
            )
        except Exception:
            pass

        payload = _build_session_payload(
            department=department,
            teacher=teacher,
            target_date=target_date,
            class_key=class_key,
            session_time=session_time,
        )

        return Response(
            payload,
            status=status.HTTP_200_OK,
        )
