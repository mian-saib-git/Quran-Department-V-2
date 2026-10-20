"""Teacher archive-readiness preview and audited student transfers."""
from django.db import transaction
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from academy.models import StudentProfile, TeacherProfile
from academy.payroll_source_locks import PayrollSourceLockedError
from academy.ws_notify import notify_global
from .models import User
from .teacher_retirement_service import (
    teacher_retirement_readiness, transfer_student_before_teacher_retirement,
    candidate_is_available, candidate_occupied_slots, TeacherRetirementSlotConflict,
)
from .views import (
    can_manage_department_accounts, coordinator_has_effective_tab_access,
    resolve_department_for_account_scope, user_is_in_same_account_scope,
)


class TeacherRetirementView(APIView):
    permission_classes = [IsAuthenticated]

    def _resolve(self, request, user_id):
        department = resolve_department_for_account_scope(request.user, "quran")
        if not department or not can_manage_department_accounts(request.user) or not coordinator_has_effective_tab_access(
            request.user, department, "tab_accounts_enrollment"
        ):
            return None, Response({"detail": "You cannot manage these accounts."}, status=403)
        user = User.objects.filter(pk=user_id, role=User.Role.TEACHER, archived_at__isnull=True).first()
        if not user or not user_is_in_same_account_scope(request.user, user, "quran"):
            return None, Response({"detail": "Teacher account not found."}, status=404)
        teacher = TeacherProfile.objects.select_related("user").filter(user=user, department=department).first()
        if not teacher:
            return None, Response({"detail": "Teacher profile not found in this department."}, status=404)
        return teacher, None

    def get(self, request, user_id):
        teacher, error = self._resolve(request, user_id)
        if error is not None:
            return error
        data = teacher_retirement_readiness(teacher)
        candidates = list(TeacherProfile.objects.select_related("user").filter(
            department=teacher.department, institution=teacher.institution,
            user__is_active=True, user__archived_at__isnull=True,
        ).exclude(pk=teacher.pk).order_by("user__first_name", "user__username", "pk"))
        # One timetable query per candidate in this management-only preview.
        slots_by_teacher = {item.pk: candidate_occupied_slots(item) for item in candidates}
        for student in data["students"]:
            student["available_teacher_ids"] = [
                item.pk for item in candidates
                if candidate_is_available(student["schedule"], slots_by_teacher[item.pk])
            ]
        data["destination_teachers"] = [
            {"id": candidate.pk, "name": candidate.user.get_full_name() or candidate.user.username}
            for candidate in candidates
        ]
        return Response(data)

    def post(self, request, user_id):
        teacher, error = self._resolve(request, user_id)
        if error is not None:
            return error
        # Optional batch: all student moves succeed together or none do.
        transfers = request.data.get("transfers")
        if transfers is not None:
            if not isinstance(transfers, list) or not transfers or len(transfers) > 250:
                return Response({"detail": "Choose between 1 and 250 students for transfer."}, status=400)
            try:
                pairs = [(int(item["student_id"]), int(item["destination_teacher_id"])) for item in transfers]
                if any(s <= 0 or t <= 0 for s, t in pairs) or len({s for s, _ in pairs}) != len(pairs):
                    raise ValueError("Duplicate or invalid student IDs")
            except (TypeError, ValueError, KeyError):
                return Response({"detail": "Each student needs one valid destination teacher."}, status=400)
            try:
                with transaction.atomic():
                    destination_ids = sorted({t for _, t in pairs})
                    candidates = {
                        item.pk: item for item in TeacherProfile.objects.select_related("user").filter(
                            pk__in=destination_ids, department=teacher.department,
                            institution=teacher.institution,
                        )
                    }
                    if len(candidates) != len(destination_ids):
                        raise ValueError("A selected destination teacher is no longer available in this department.")
                    # All relevant rows are locked in deterministic order before updates.
                    list(TeacherProfile.objects.select_for_update().filter(
                        pk__in=sorted({teacher.pk, *destination_ids}),
                    ).order_by("pk"))
                    results = [transfer_student_before_teacher_retirement(
                        teacher=teacher, student_id=student_id,
                        destination=candidates[target_id], actor=request.user,
                    ) for student_id, target_id in sorted(pairs)]
                    transaction.on_commit(lambda: notify_global("academy_update", {
                        "event": "account_updated", "message": "Students transferred",
                        "role": "student", "count": len(results),
                    }))
            except PayrollSourceLockedError as exc:
                return Response(exc.payload, status=409)
            except TeacherRetirementSlotConflict as exc:
                return Response({"detail": str(exc)}, status=409)
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=400)
            return Response({"detail": f"{len(results)} students transferred safely.", "transferred": results})

        try:
            student_id = int(request.data.get("student_id"))
            destination_id = int(request.data.get("destination_teacher_id"))
            if student_id <= 0 or destination_id <= 0:
                raise ValueError("Valid student and destination teacher IDs are required.")
        except (TypeError, ValueError):
            return Response({"detail": "Select a student and a destination teacher."}, status=400)
        destination = TeacherProfile.objects.select_related("user").filter(
            pk=destination_id, department=teacher.department,
        ).first()
        if not destination:
            return Response({"detail": "Choose a teacher in the same department."}, status=400)
        try:
            with transaction.atomic():
                result = transfer_student_before_teacher_retirement(
                    teacher=teacher, student_id=student_id, destination=destination, actor=request.user,
                )
                transaction.on_commit(lambda: notify_global("academy_update", {
                    "event": "account_updated", "message": "Student transferred",
                    "role": "student", "student_id": student_id,
                }))
        except PayrollSourceLockedError as exc:
            return Response(exc.payload, status=409)
        except TeacherRetirementSlotConflict as exc:
            return Response({"detail": str(exc)}, status=409)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"detail": "Student transferred. Previous schedules and salary evidence preserved.", **result})


class ArchivedTeacherListView(APIView):
    """Read-only list of archived teacher accounts in the caller's Quran department."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        department = resolve_department_for_account_scope(request.user, "quran")
        if not department or not can_manage_department_accounts(request.user) or not coordinator_has_effective_tab_access(
            request.user, department, "tab_accounts_enrollment"
        ):
            return Response({"detail": "You cannot view archived teachers."}, status=403)
        teachers = TeacherProfile.objects.select_related("user", "user__archived_by").filter(
            department=department, institution=department.institution,
            user__archived_at__isnull=False,
        ).order_by("-user__archived_at", "pk")[:500]
        return Response({"teachers": [
            {
                "id": teacher.user_id,
                "teacher_id": teacher.pk,
                "name": teacher.user.get_full_name() or teacher.user.username,
                "username": teacher.user.username,
                "archived_at": teacher.user.archived_at.isoformat(),
                "effective_date": (
                    teacher.user.archived_effective_date.isoformat()
                    if teacher.user.archived_effective_date else None
                ),
                "archived_by": (
                    teacher.user.archived_by.get_full_name() or teacher.user.archived_by.username
                    if teacher.user.archived_by_id else "Unknown"
                ),
            }
            for teacher in teachers
        ]})
