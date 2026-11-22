from __future__ import annotations

import json

from django.core.management.base import BaseCommand, CommandError

from accounts.models import Department
from academy.schedule_consistency_audit import (
    apply_schedule_consistency_cleanup,
    apply_verification_cleanup,
    run_schedule_consistency_audit,
)


class Command(BaseCommand):
    help = (
        "Read-only schedule consistency audit (dry-run by default). "
        "Use --apply --approved-ids 1,2,3 to apply guarded cleanup for approved student IDs."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--department-code",
            type=str,
            default="",
            help="Optional department code or type (e.g. quran).",
        )
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Apply guarded cleanup for --approved-ids (never modifies paid payrolls).",
        )
        parser.add_argument(
            "--approved-ids",
            type=str,
            default="",
            help="Comma-separated StudentProfile IDs approved for schedule cleanup when --apply is set.",
        )
        parser.add_argument(
            "--approved-verification-ids",
            type=str,
            default="",
            help="Comma-separated SalaryAttendanceVerification IDs approved for guarded pending-row cleanup when --apply is set.",
        )

    def handle(self, *args, **options):
        from django.db.models import Q

        dept = None
        code = (options.get("department_code") or "").strip()
        if code:
            dept = Department.objects.filter(
                Q(code__iexact=code) | Q(department_type__iexact=code)
            ).first()
            if not dept:
                raise CommandError(f"Department '{code}' not found.")

        report = run_schedule_consistency_audit(department=dept)
        self.stdout.write(json.dumps(report, indent=2, default=str))

        if not options.get("apply"):
            self.stdout.write(self.style.SUCCESS("Dry-run complete. No database records modified."))
            return

        raw_ids = (options.get("approved_ids") or "").strip()
        raw_vids = (options.get("approved_verification_ids") or "").strip()
        if not raw_ids and not raw_vids:
            raise CommandError(
                "--apply requires --approved-ids and/or --approved-verification-ids."
            )

        if raw_ids:
            try:
                approved_ids = [int(part.strip()) for part in raw_ids.split(",") if part.strip()]
            except ValueError as exc:
                raise CommandError("--approved-ids must be comma-separated integers.") from exc

            result = apply_schedule_consistency_cleanup(
                approved_student_ids=approved_ids,
                department=dept,
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Guarded schedule cleanup applied to {len(result['applied_students'])} student(s), "
                    f"{result['changes']} change(s)."
                )
            )

        if raw_vids:
            try:
                approved_vids = [int(part.strip()) for part in raw_vids.split(",") if part.strip()]
            except ValueError as exc:
                raise CommandError("--approved-verification-ids must be comma-separated integers.") from exc

            v_result = apply_verification_cleanup(
                approved_verification_ids=approved_vids,
                department=dept,
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Guarded verification cleanup removed {len(v_result['deleted_ids'])} row(s), "
                    f"skipped {len(v_result['skipped'])}."
                )
            )
