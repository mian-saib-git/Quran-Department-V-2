"""Date-effective scheduled attendance report rows. No writes and no inferred attendance."""
from datetime import date, timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ClassSchedule, StudentClassHistory


class QuranAttendanceReportSessionsView(APIView):
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "head", "options"]

    def get(self, request):
        user = request.user
        role = str(getattr(user, "role", "") or "").lower()
        if not (getattr(user, "is_superuser", False) or role in {"coordinator", "department_admin", "institution_admin"}):
            return Response({"detail": "Reports manager access required."}, status=status.HTTP_403_FORBIDDEN)

        # Resolve only the user's assigned Quran department. Do not return
        # institution-wide schedules via a department-scoped report endpoint.
        department = getattr(user, "department", None)
        if department is None or str(getattr(department, "department_type", "")).lower() != "quran":
            return Response({"detail": "A Quran department assignment is required."}, status=status.HTTP_403_FORBIDDEN)

        if role == "coordinator":
            from accounts.views import coordinator_has_effective_tab_access
            if not coordinator_has_effective_tab_access(user, department, "tab_reports"):
                return Response({"detail": "Reports permission denied."}, status=status.HTTP_403_FORBIDDEN)

        try:
            start_date = date.fromisoformat(request.query_params.get("date_from", ""))
            end_date = date.fromisoformat(request.query_params.get("date_to", ""))
        except ValueError:
            return Response({"detail": "Use ISO dates for date_from and date_to."}, status=status.HTTP_400_BAD_REQUEST)
        if start_date > end_date or (end_date - start_date).days > 366:
            return Response({"detail": "Invalid date range or range exceeds 367 days."}, status=status.HTTP_400_BAD_REQUEST)

        # Historical reporting does not generate future unmarked rows.
        last_date = min(end_date, timezone.localdate())
        if last_date < start_date:
            return Response({"sessions": []})

        schedules = (ClassSchedule.objects
            .filter(department=department)
            .filter(Q(effective_from__isnull=True) | Q(effective_from__lte=last_date))
            .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=start_date))
            .filter(Q(effective_to__isnull=False) | Q(is_active=True))
            .select_related("teacher__user", "student__user")
            .order_by("student_id", "id"))

        # The effective_from field is absent in some legacy schedules.
        # Enrollment history prevents those schedules from generating sessions
        # before students enrolled. No history => do not invent an enrollment date.
        enrolled = {}
        for student_id, enrolled_date in (StudentClassHistory.objects
            .filter(student_id__in=schedules.values_list("student_id", flat=True))
            .filter(event_type=StudentClassHistory.EventType.ENROLLED)
            .values_list("student_id", "effective_date")
            .order_by("effective_date", "id")):
            enrolled.setdefault(student_id, enrolled_date)

        rows = []
        seen = set()
        for schedule in schedules:
            # Legacy schedules without an effective start date need an ENROLLED
            # event; otherwise their historical start cannot be established.
            if schedule.effective_from is None and schedule.student_id not in enrolled:
                continue
            lower = max(start_date, schedule.effective_from or enrolled[schedule.student_id])
            if schedule.student_id in enrolled:
                lower = max(lower, enrolled[schedule.student_id])
            upper = min(last_date, schedule.effective_to or last_date)
            if lower > upper:
                continue
            day = lower
            weekday = str(schedule.weekday).strip().lower()
            class_key = schedule.time_slot.strftime("%H:%M")
            teacher_user = schedule.teacher.user
            student_user = schedule.student.user
            teacher_name = (teacher_user.get_full_name().strip() or teacher_user.username)
            student_name = (student_user.get_full_name().strip() or student_user.username)
            while day <= upper:
                if day.strftime("%A").lower() == weekday:
                    key = (day, schedule.student_id, class_key)
                    if key not in seen:
                        seen.add(key)
                        rows.append({
                            "date": day.isoformat(),
                            "class_key": class_key,
                            "student_id": schedule.student_id,
                            "student_name": student_name,
                            "teacher_id": schedule.teacher_id,
                            "teacher_name": teacher_name,
                            "schedule_id": schedule.id,
                        })
                        if len(rows) > 25000:
                            return Response({"detail": "Too many sessions; narrow the report range."}, status=status.HTTP_400_BAD_REQUEST)
                day += timedelta(days=1)

        return Response({"sessions": rows})
