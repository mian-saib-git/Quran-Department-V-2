"""Read-only comparison of imported student/teacher attendance with Salary V2 eligibility."""
from collections import Counter, defaultdict
from datetime import date
import re

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Prefetch, Q
from django.utils import timezone

from academy.models import Attendance, StudentProfile, TeacherProfile, QuranTeacherMonthlyPayroll
from academy.salary_v2_service import (
    _history_queryset, _schedule_queryset, build_student_daily_states,
    _is_real_scheduled_date, _base_status_is_salary_active,
    _payroll_dates_for_student, _earned_payroll_dates_for_student, month_bounds,
)


class Command(BaseCommand):
    help = "Read-only: diagnose why CSV attendance may not earn Salary V2 units."

    def add_arguments(self, parser):
        parser.add_argument("--year", type=int, required=True)
        parser.add_argument("--month", type=int, required=True)
        group = parser.add_mutually_exclusive_group(required=True)
        group.add_argument("--teacher-id", type=int)
        group.add_argument("--teacher-contains")

    def handle(self, *args, **opts):
        start, end = month_bounds(opts["year"], opts["month"])
        teachers = TeacherProfile.objects.select_related("user", "department").all()
        if opts.get("teacher_id"):
            teachers = teachers.filter(pk=opts["teacher_id"])
        else:
            teachers = teachers.filter(
                Q(user__username__icontains=opts["teacher_contains"])
                | Q(user__first_name__icontains=opts["teacher_contains"])
                | Q(user__last_name__icontains=opts["teacher_contains"])
            )
        chosen = list(teachers[:3])
        if len(chosen) != 1:
            raise CommandError(
                f"Expected exactly one teacher, found {len(chosen)}. Use --teacher-id."
            )
        teacher = chosen[0]
        attendance_qs = Attendance.objects.filter(date__range=(start, end))
        teacher_rows = list(attendance_qs.filter(
            entity_type=Attendance.EntityType.TEACHER, teacher=teacher
        ))
        student_rows = list(attendance_qs.filter(
            entity_type=Attendance.EntityType.STUDENT, teacher=teacher
        ))
        teacher_sessions = {(a.date, a.class_key): a for a in teacher_rows}
        by_student = defaultdict(list)
        for row in student_rows:
            if row.student_id:
                by_student[row.student_id].append(row)
        students = list(StudentProfile.objects.filter(
            pk__in=list(by_student)
        ).select_related("user", "teacher__user").prefetch_related(
            Prefetch("class_history", queryset=_history_queryset(), to_attr="salary_v2_history"),
            Prefetch("schedules", queryset=_schedule_queryset(), to_attr="salary_v2_schedules"),
        ))
        counts = Counter()
        self.stdout.write(f"TEACHER: {teacher} (id={teacher.id})   MONTH: {start:%Y-%m}")
        self.stdout.write("READ ONLY: no attendance, schedule, or payroll data will be changed.")
        self.stdout.write(f"Teacher session attendance: {len(teacher_rows)}")
        self.stdout.write(f"Student attendance attributed to teacher: {len(student_rows)}")
        self.stdout.write(f"Matched student profiles: {len(students)}")
        self.stdout.write(f"Unmatched (no linked student): {sum(not row.student_id for row in student_rows)}")
        for student in students:
            schedules = student.salary_v2_schedules
            states = build_student_daily_states(student, start, end)
            corroborated = set()
            student_counts = Counter()
            for row in by_student[student.id]:
                if row.status not in {Attendance.Status.PRESENT, Attendance.Status.ABSENT, Attendance.Status.LEAVE}:
                    continue
                matched = bool(
                    re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", row.class_key or "")
                    and (row.date, row.class_key) in teacher_sessions
                )
                scheduled = _is_real_scheduled_date(schedules, row.date)
                state = states[row.date]
                student_counts["scheduled_attendance" if scheduled else "unscheduled_attendance"] += 1
                if matched:
                    corroborated.add(row.date)
                    student_counts["confirmed_teacher_session"] += 1
                else:
                    student_counts["missing_matching_teacher_session"] += 1
                if not state["enrolled"]:
                    student_counts["before_profile_enrollment"] += 1
                if not _base_status_is_salary_active(state["class_status"]):
                    student_counts["inactive_class_status"] += 1
                if state["teacher_id"] != row.teacher_id:
                    student_counts["historical_teacher_differs_from_profile_state"] += 1
            dates = _payroll_dates_for_student(
                states, schedules, start, end, confirmed_session_dates=corroborated
            )
            student_status_by_date = {
                row.date: row.status for row in by_student[student.id]
            }
            payable = len(_earned_payroll_dates_for_student(
                dates, schedules, corroborated, student_status_by_date,
                min(end, timezone.localdate()),
            ))
            counts.update(student_counts)
            counts["candidate_payable_units"] += payable
            self.stdout.write(
                f"  student {student.id}: {student} | student rows={len(by_student[student.id])}"
                f" | confirmed sessions={len(corroborated)} | candidate salary units={payable}"
            )
        self.stdout.write("DIAGNOSTIC COUNTS:")
        for key in (
            "scheduled_attendance", "unscheduled_attendance",
            "confirmed_teacher_session", "missing_matching_teacher_session",
            "before_profile_enrollment", "inactive_class_status",
            "historical_teacher_differs_from_profile_state", "candidate_payable_units",
        ):
            self.stdout.write(f"  {key}: {counts[key]}")
        department_id = teacher.department_id or getattr(teacher.user, "department_id", None)
        payroll = QuranTeacherMonthlyPayroll.objects.filter(
            teacher=teacher, department_id=department_id,
            year=opts["year"], month=opts["month"],
        ).first()
        if payroll:
            self.stdout.write(
                f"SAVED PAYROLL: status={payroll.status} normal={payroll.normal_earnings}"
                f" final={payroll.final_total} last_calculated={payroll.calculated_at}"
            )
            self.stdout.write("Salary page shows SAVED totals: importing alone never recalculates payroll.")
        else:
            self.stdout.write("No saved payroll for this teacher/month.")
        self.stdout.write(
            "Candidate units are a diagnostic, not a payment promise."
            " Rates, drop/rejoin history, coverage, and approval rules still apply."
        )
