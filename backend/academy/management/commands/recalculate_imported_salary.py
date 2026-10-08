"""Preview or persist a single teacher's monthly Salary V2 recalculation.

Designed for use after diagnose_imported_salary. Preview runs the real Salary
V2 calculation and rolls the transaction back. No fake attendance is created.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from academy.models import QuranTeacherMonthlyPayroll, TeacherProfile
from academy.salary_v2_service import calculate_teacher_payroll, LOCKED_PAYROLL_STATUSES


class Command(BaseCommand):
    help = "Preview (default) or commit a Salary V2 recalculation for one teacher/month."

    def add_arguments(self, parser):
        parser.add_argument("--year", type=int, required=True)
        parser.add_argument("--month", type=int, required=True)
        group = parser.add_mutually_exclusive_group(required=True)
        group.add_argument("--teacher-id", type=int)
        group.add_argument("--teacher-contains")
        parser.add_argument("--commit", action="store_true", help="Persist the recalculation (dry-run is default).")

    @transaction.atomic
    def handle(self, *args, **opts):
        if opts["month"] not in range(1, 13) or opts["year"] not in range(2020, 2201):
            raise CommandError("Valid --year and --month are required.")
        teachers = TeacherProfile.objects.select_related("user", "department").all()
        if opts.get("teacher_id"):
            teachers = teachers.filter(pk=opts["teacher_id"])
        else:
            q = opts["teacher_contains"]
            teachers = teachers.filter(
                Q(user__username__icontains=q) | Q(user__first_name__icontains=q)
                | Q(user__last_name__icontains=q)
            )
        candidates = list(teachers[:3])
        if len(candidates) != 1:
            raise CommandError(f"Expected one teacher, matched {len(candidates)}. Use --teacher-id.")
        teacher = candidates[0]
        department = teacher.department or getattr(teacher.user, "department", None)
        if department is None:
            raise CommandError("Teacher has no department: payroll calculation cannot proceed.")
        existing = QuranTeacherMonthlyPayroll.objects.select_for_update().filter(
            teacher=teacher, department=department, year=opts["year"], month=opts["month"]
        ).first()
        if existing and existing.status in LOCKED_PAYROLL_STATUSES:
            raise CommandError(
                f"Payroll status={existing.status} is locked. Use the authorized reopen workflow first."
            )
        self.stdout.write(f"Teacher: {teacher} (id={teacher.id}) {opts['year']:04d}-{opts['month']:02d}")
        self.stdout.write(f"Mode: {'COMMIT' if opts['commit'] else 'PREVIEW, ROLLBACK'}")
        self.stdout.write(f"Before: status={existing.status if existing else '(none)'} "
                          f"normal={existing.normal_earnings if existing else '0.00'} "
                          f"final={existing.final_total if existing else '0.00'}")
        payroll = calculate_teacher_payroll(teacher, opts["year"], opts["month"])
        payroll.refresh_from_db()
        # Match the existing Salary V2 calculate endpoint's editable-state
        # transition; do not submit, approve or mark any payroll paid.
        editable_statuses = {
            QuranTeacherMonthlyPayroll.Status.CALCULATING,
            QuranTeacherMonthlyPayroll.Status.REJECTED,
            QuranTeacherMonthlyPayroll.Status.REOPENED,
        }
        if payroll.status in editable_statuses:
            payroll.status = QuranTeacherMonthlyPayroll.Status.DEPARTMENT_REVIEW
            payroll.save(update_fields=["status", "updated_at"])
        self.stdout.write(f"After:  status={payroll.status} normal={payroll.normal_earnings} "
                          f"substitute={payroll.substitute_earnings} "
                          f"deductions={payroll.deduction_total} final={payroll.final_total}")
        self.stdout.write("This recalculation respects payroll rates, coverage, drop events, and locks.")
        if not opts["commit"]:
            transaction.set_rollback(True)
            self.stdout.write(self.style.SUCCESS("PREVIEW COMPLETE: transaction rolled back, no database changes."))
        else:
            self.stdout.write(self.style.SUCCESS("RECALCULATION COMMITTED: refresh the Salary V2 screen."))
