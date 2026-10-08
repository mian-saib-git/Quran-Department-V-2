from __future__ import annotations

from collections import Counter, defaultdict
from difflib import get_close_matches
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from academy.attendance_import import (
    AttendanceCsvFormatError,
    normalize_name,
    parse_monthly_attendance_csv,
    strip_leading_teacher_number,
)
from academy.models import Attendance, ClassSchedule, StudentProfile, TeacherProfile
from academy.attendance_import_payroll import assert_import_unlocked, import_scope, AttendanceImportPayrollLocked


class Command(BaseCommand):
    help = (
        "Import one teacher's monthly attendance CSV. Dry-run is the default; "
        "pass --commit to write changes."
    )

    def add_arguments(self, parser):
        parser.add_argument("csv_path", help="Path to the teacher monthly attendance CSV file.")
        parser.add_argument(
            "--commit",
            action="store_true",
            help="Write attendance to the database. Without this flag, no database changes are made.",
        )
        parser.add_argument(
            "--marked-by",
            dest="marked_by",
            help="Coordinator username to record as marked_by. Defaults to an active coordinator.",
        )
        parser.add_argument(
            "--teacher-id",
            type=int,
            help="Optional TeacherProfile ID. Use only if teacher-name matching is ambiguous.",
        )
        parser.add_argument(
            "--student-map",
            action="append",
            default=[],
            metavar="CSV_NAME=STUDENT_ID",
            help=(
                "Explicitly map one CSV student name to a StudentProfile ID. "
                "May be supplied multiple times. Useful for historical students whose "
                "current database name or teacher has changed."
            ),
        )
        parser.add_argument(
            "--allow-unmatched-students",
            action="store_true",
            help=(
                "Allow unmatched historical student rows to be skipped on the student side "
                "while still importing the teacher/session attendance from those rows. "
                "Default behavior remains strict and blocks the import."
            ),
        )

    def handle(self, *args, **options):
        csv_path = Path(options["csv_path"]).expanduser()
        commit = bool(options["commit"])
        allow_unmatched_students = bool(options.get("allow_unmatched_students"))

        try:
            parsed = parse_monthly_attendance_csv(csv_path)
        except AttendanceCsvFormatError as exc:
            raise CommandError(str(exc)) from exc

        teacher = self._resolve_teacher(parsed.teacher_name, options.get("teacher_id"))
        actor = self._resolve_actor(options.get("marked_by"))

        students_by_csv_row = {}
        unmatched_students: list[str] = []
        unmatched_row_numbers: set[int] = set()
        errors: list[str] = list(parsed.invalid_cells)
        warnings: list[str] = []

        teacher_students = list(
            StudentProfile.objects.filter(teacher=teacher)
            .select_related("user", "teacher__user")
            .order_by("id")
        )
        all_students = list(
            StudentProfile.objects.select_related("user", "teacher__user").order_by("id")
        )
        explicit_student_map = self._parse_student_map(options.get("student_map") or [], all_students)

        for parsed_student in parsed.students:
            student, match_error, match_warning = self._resolve_student(
                parsed_student,
                teacher_students,
                all_students,
                explicit_student_map,
            )
            if match_error:
                if allow_unmatched_students:
                    unmatched_students.append(parsed_student.student_name)
                    unmatched_row_numbers.add(parsed_student.row_number)
                    warnings.append(
                        f"Student {parsed_student.student_name}: no safe database match. "
                        "Student attendance for this CSV row will be skipped, but teacher/session "
                        "attendance from the row will still be processed. "
                        "Unmatched student attendance CANNOT produce teacher salary."
                    )
                    continue
                errors.append(match_error)
                continue
            students_by_csv_row[parsed_student.row_number] = student
            if match_warning:
                warnings.append(match_warning)
            warnings.extend(self._schedule_warnings(parsed_student, student))

        # Student attendance requires a matched StudentProfile. Teacher/session
        # attendance does not. For matched students we also preserve the historical
        # teacher + class time on the student attendance row so reports remain
        # correct even after the student later changes teacher or schedule.
        student_intents = {}
        teacher_intents = {}
        counts = Counter()

        for cell in parsed.attendance_cells:
            student = students_by_csv_row.get(cell.row_number)
            if student:
                student_key = (student.id, cell.attendance_date)
                existing_student_intent = student_intents.get(student_key)
                student_value = (student, cell.student_status, cell)
                if existing_student_intent and existing_student_intent[1] != cell.student_status:
                    errors.append(
                        f"Conflicting student attendance for {student} on {cell.attendance_date}: "
                        f"{existing_student_intent[1]} vs {cell.student_status}."
                    )
                else:
                    student_intents[student_key] = student_value

            teacher_key = (teacher.id, cell.attendance_date, cell.class_time)
            existing_teacher_intent = teacher_intents.get(teacher_key)

            if existing_teacher_intent is None:
                existing_teacher_intent = {
                    "status": cell.teacher_status,
                    "cell": cell,
                    "student_ids": set(),
                    "unmatched_names": set(),
                }
                teacher_intents[teacher_key] = existing_teacher_intent
            elif existing_teacher_intent["status"] != cell.teacher_status:
                errors.append(
                    f"Conflicting teacher attendance for {teacher} on {cell.attendance_date} "
                    f"at {cell.class_time}: {existing_teacher_intent['status']} vs {cell.teacher_status}. "
                    f"Check CSV rows {existing_teacher_intent['cell'].row_number} and {cell.row_number}."
                )

            if student:
                existing_teacher_intent["student_ids"].add(student.id)
            else:
                existing_teacher_intent["unmatched_names"].add(cell.student_name)

        student_actions = self._preview_student_actions(teacher, student_intents)
        teacher_actions = self._preview_teacher_actions(teacher, teacher_intents)

        for action in student_actions.values():
            counts[f"student_{action}"] += 1
        for action in teacher_actions.values():
            counts[f"teacher_{action}"] += 1

        self._print_report(
            parsed=parsed,
            teacher=teacher,
            actor=actor,
            students_matched=len(students_by_csv_row),
            unmatched_students=unmatched_students,
            allow_unmatched_students=allow_unmatched_students,
            student_intents=student_intents,
            teacher_intents=teacher_intents,
            counts=counts,
            warnings=warnings,
            errors=errors,
            commit=commit,
        )

        if errors:
            raise CommandError(
                f"Import blocked: {len(errors)} validation error(s). No database changes were made."
            )

        if not commit:
            self.stdout.write(self.style.SUCCESS("DRY RUN PASSED. No database changes were made."))
            self.stdout.write("Re-run the same command with --commit after reviewing the preview.")
            return

        with transaction.atomic():
            existing_students = {
                (item.student_id, item.date): item
                for item in Attendance.objects.filter(
                    entity_type=Attendance.EntityType.STUDENT,
                    student_id__in={key[0] for key in student_intents},
                    date__in={key[1] for key in student_intents},
                )
            }

            for key, (student, status_value, cell) in student_intents.items():
                existing = existing_students.get(key)
                department, institution = import_scope(teacher, student)
                if existing is None:
                    assert_import_unlocked(teacher=teacher, target_date=cell.attendance_date,
                                           class_key=cell.class_time, student=student)
                    Attendance.objects.create(
                        entity_type=Attendance.EntityType.STUDENT,
                        teacher=teacher,
                        student=student,
                        date=cell.attendance_date,
                        class_key=cell.class_time,
                        status=status_value,
                        marked_by=actor,
                        department=department,
                        institution=institution,
                    )
                    continue

                changes = {}
                if existing.teacher_id != teacher.id:
                    changes["teacher_id"] = teacher.id
                if (existing.class_key or "") != cell.class_time:
                    changes["class_key"] = cell.class_time
                if existing.status != status_value:
                    changes["status"] = status_value

                if existing.department_id is None and department is not None:
                    changes["department_id"] = department.id
                if existing.institution_id is None and institution is not None:
                    changes["institution_id"] = institution.id
                if changes:
                    assert_import_unlocked(teacher=teacher, target_date=cell.attendance_date,
                                           class_key=cell.class_time, student=student)
                    # Metadata backfills intentionally use QuerySet.update() so
                    # the original marked_by and updated_at audit values are not
                    # rewritten merely because historical relationships are added.
                    Attendance.objects.filter(pk=existing.pk).update(**changes)

            all_student_ids = set()
            for intent in teacher_intents.values():
                all_student_ids.update(intent["student_ids"])
            students_by_id = {
                item.id: item
                for item in StudentProfile.objects.filter(id__in=all_student_ids)
            }

            existing_teachers = {
                (item.teacher_id, item.date, item.class_key): item
                for item in Attendance.objects.filter(
                    entity_type=Attendance.EntityType.TEACHER,
                    teacher=teacher,
                    date__in={key[1] for key in teacher_intents},
                    class_key__in={key[2] for key in teacher_intents},
                )
            }

            for key, intent in teacher_intents.items():
                _teacher_id, attendance_date, class_time = key
                direct_student = self._direct_teacher_session_student(
                    intent,
                    students_by_id,
                )
                existing = existing_teachers.get(key)

                department, institution = import_scope(teacher)
                if existing is None:
                    assert_import_unlocked(teacher=teacher, target_date=attendance_date,
                                           class_key=class_time)
                    Attendance.objects.create(
                        entity_type=Attendance.EntityType.TEACHER,
                        teacher=teacher,
                        student=direct_student,
                        date=attendance_date,
                        class_key=class_time,
                        status=intent["status"],
                        marked_by=actor,
                        department=department,
                        institution=institution,
                    )
                    continue

                changes = {}
                desired_student_id = direct_student.id if direct_student else None
                if existing.student_id != desired_student_id:
                    changes["student_id"] = desired_student_id
                if existing.status != intent["status"]:
                    changes["status"] = intent["status"]

                if existing.department_id is None and department is not None:
                    changes["department_id"] = department.id
                if existing.institution_id is None and institution is not None:
                    changes["institution_id"] = institution.id
                if changes:
                    assert_import_unlocked(teacher=teacher, target_date=attendance_date,
                                           class_key=class_time)
                    Attendance.objects.filter(pk=existing.pk).update(**changes)

        self.stdout.write(self.style.SUCCESS("IMPORT COMMITTED SUCCESSFULLY."))
        self.stdout.write(
            f"Student attendance records processed: {len(student_intents)} | "
            f"Teacher/session records processed: {len(teacher_intents)}"
        )

    def _resolve_teacher(self, csv_teacher_name: str, teacher_id: int | None):
        queryset = TeacherProfile.objects.select_related("user")
        if teacher_id:
            try:
                return queryset.get(id=teacher_id)
            except TeacherProfile.DoesNotExist as exc:
                raise CommandError(f"TeacherProfile id={teacher_id} was not found.") from exc

        targets = {
            normalize_name(csv_teacher_name),
            normalize_name(strip_leading_teacher_number(csv_teacher_name)),
        }
        targets.discard("")

        matches = []
        for teacher in queryset.order_by("id"):
            candidates = {
                normalize_name(str(teacher)),
                normalize_name(teacher.user.username),
                normalize_name(teacher.user.get_full_name()),
                normalize_name(strip_leading_teacher_number(str(teacher))),
                normalize_name(strip_leading_teacher_number(teacher.user.get_full_name())),
            }
            if targets & candidates:
                matches.append(teacher)

        if not matches:
            raise CommandError(
                f"Could not match CSV teacher {csv_teacher_name!r} to a TeacherProfile. "
                "Use --teacher-id if the database name is different."
            )
        if len(matches) > 1:
            ids = ", ".join(str(item.id) for item in matches)
            raise CommandError(
                f"Teacher name {csv_teacher_name!r} matched multiple teachers ({ids}). "
                "Re-run with --teacher-id <id>."
            )
        return matches[0]

    def _resolve_actor(self, username: str | None):
        User = get_user_model()
        coordinators = User.objects.filter(role="coordinator", is_active=True)

        if username:
            try:
                return coordinators.get(username=username)
            except User.DoesNotExist as exc:
                raise CommandError(
                    f"Active coordinator username {username!r} was not found."
                ) from exc

        actor = coordinators.filter(is_superuser=True).order_by("id").first()
        if not actor:
            actor = coordinators.order_by("id").first()
        if not actor:
            raise CommandError(
                "No active coordinator exists to use as marked_by. Pass --marked-by USERNAME."
            )
        return actor

    def _parse_student_map(self, raw_items, all_students):
        by_id = {student.id: student for student in all_students}
        result = {}

        for raw in raw_items:
            if "=" not in raw:
                raise CommandError(
                    f"Invalid --student-map {raw!r}. Expected CSV_NAME=STUDENT_ID."
                )
            csv_name, student_id_raw = raw.rsplit("=", 1)
            csv_name = csv_name.strip()
            student_id_raw = student_id_raw.strip()
            if not csv_name or not student_id_raw.isdigit():
                raise CommandError(
                    f"Invalid --student-map {raw!r}. Expected CSV_NAME=STUDENT_ID."
                )
            student_id = int(student_id_raw)
            student = by_id.get(student_id)
            if not student:
                raise CommandError(
                    f"--student-map {raw!r} refers to missing StudentProfile id={student_id}."
                )
            key = normalize_name(csv_name)
            if key in result and result[key].id != student.id:
                raise CommandError(
                    f"Multiple --student-map values were supplied for {csv_name!r}."
                )
            result[key] = student
        return result

    def _resolve_student(
        self,
        parsed_student,
        teacher_students,
        all_students,
        explicit_student_map,
    ):
        admission = (parsed_student.admission_number or "").strip()
        name_target = normalize_name(parsed_student.student_name)

        explicit = explicit_student_map.get(name_target)
        if explicit:
            warning = (
                f"Student {parsed_student.student_name}: explicitly mapped to "
                f"id={explicit.id} name={explicit} (current teacher: {explicit.teacher})."
            )
            return explicit, None, warning

        # Admission number is the strongest match when it is the student's username.
        # Search the whole database because historical students may now belong to a
        # different teacher.
        if admission:
            admission_matches = [
                student
                for student in all_students
                if student.user.username.strip().casefold() == admission.casefold()
            ]
            if len(admission_matches) == 1:
                student = admission_matches[0]
                warning = None
                if teacher_students and student.teacher_id != teacher_students[0].teacher_id:
                    warning = (
                        f"Student {parsed_student.student_name}: matched by admission/username "
                        f"to id={student.id}, currently assigned to {student.teacher}; "
                        "historical CSV teacher will still be used for teacher attendance."
                    )
                return student, None, warning
            if len(admission_matches) > 1:
                return None, (
                    f"CSV row {parsed_student.row_number}: admission {admission!r} matched "
                    "multiple students."
                ), None

        def exact_matches(pool):
            matches = []
            for student in pool:
                candidate_names = {
                    normalize_name(str(student)),
                    normalize_name(student.user.get_full_name()),
                    normalize_name(student.user.username),
                }
                if name_target in candidate_names:
                    matches.append(student)
            return matches

        # Prefer an exact match under the CSV teacher.
        name_matches = exact_matches(teacher_students)
        if len(name_matches) == 1:
            return name_matches[0], None, None
        if len(name_matches) > 1:
            ids = ", ".join(str(item.id) for item in name_matches)
            return None, (
                f"CSV row {parsed_student.row_number}: student {parsed_student.student_name!r} "
                f"matched multiple students under the CSV teacher ({ids})."
            ), None

        # Safe historical-name convenience: if a current student under this teacher
        # has a shorter name whose complete tokens are contained in the CSV name
        # (e.g. 'Sahil' vs 'Sahil khan'), accept it only when unique.
        target_tokens = set(name_target.split())
        contained = []
        for student in teacher_students:
            candidate = normalize_name(str(student))
            candidate_tokens = set(candidate.split())
            if candidate_tokens and candidate_tokens < target_tokens:
                contained.append(student)
        if len(contained) == 1:
            student = contained[0]
            return student, None, (
                f"Student {parsed_student.student_name}: matched to current CSV-teacher student "
                f"id={student.id} name={student} by unique contained-name match."
            )

        # Historical students may have moved to another teacher. Only accept a
        # unique exact name match globally. Never fuzzy-match across teachers.
        global_exact = exact_matches(all_students)
        if len(global_exact) == 1:
            student = global_exact[0]
            return student, None, (
                f"Student {parsed_student.student_name}: exact historical match found globally "
                f"as id={student.id}, currently assigned to {student.teacher}."
            )
        if len(global_exact) > 1:
            ids = ", ".join(str(item.id) for item in global_exact)
            return None, (
                f"CSV row {parsed_student.row_number}: student {parsed_student.student_name!r} "
                f"matched multiple students globally ({ids}). Use --student-map CSV_NAME=ID."
            ), None

        known_names = [str(student) for student in teacher_students]
        suggestions = get_close_matches(parsed_student.student_name, known_names, n=3, cutoff=0.6)
        suggestion_text = f" Possible current-teacher matches: {', '.join(suggestions)}." if suggestions else ""
        return None, (
            f"CSV row {parsed_student.row_number}: could not safely match historical student "
            f"{parsed_student.student_name!r}."
            f"{suggestion_text} Use --student-map {parsed_student.student_name!r}=<student_id> "
            "only after confirming the identity."
        ), None

    def _schedule_warnings(self, parsed_student, student):
        warnings = []
        if not parsed_student.class_time:
            return warnings

        schedules = ClassSchedule.objects.filter(student=student, is_active=True)
        if not schedules.exists():
            warnings.append(
                f"Student {student}: no active ClassSchedule found; CSV attendance will still be used as source of truth."
            )
            return warnings

        time_matches = [
            schedule
            for schedule in schedules
            if schedule.time_slot.strftime("%H:%M") == parsed_student.class_time
        ]
        if not time_matches:
            warnings.append(
                f"Student {student}: CSV time {parsed_student.class_time} does not match current active schedule; "
                "CSV attendance will still be used as source of truth."
            )
        return warnings

    def _direct_teacher_session_student(self, intent, students_by_id):
        """
        A teacher session can contain multiple students. Only store a direct
        teacher-attendance -> student FK when the CSV session resolves to one
        matched student and contains no unmatched historical student. Reports
        can still aggregate all matched students from student attendance rows.
        """
        student_ids = set(intent.get("student_ids") or set())
        unmatched_names = set(intent.get("unmatched_names") or set())

        if len(student_ids) != 1 or unmatched_names:
            return None

        return students_by_id.get(next(iter(student_ids)))

    def _preview_student_actions(self, teacher, intents):
        actions = {}
        if not intents:
            return actions

        student_ids = {key[0] for key in intents}
        dates = {key[1] for key in intents}
        existing = {
            (item.student_id, item.date): item
            for item in Attendance.objects.filter(
                entity_type=Attendance.EntityType.STUDENT,
                student_id__in=student_ids,
                date__in=dates,
            )
        }

        for key, (_student, status_value, cell) in intents.items():
            item = existing.get(key)
            if not item:
                actions[key] = "create"
                continue

            metadata_matches = (
                item.teacher_id == teacher.id
                and (item.class_key or "") == cell.class_time
            )

            if item.status == status_value and metadata_matches:
                actions[key] = "unchanged"
            else:
                actions[key] = "update"

        return actions

    def _preview_teacher_actions(self, teacher, intents):
        actions = {}
        if not intents:
            return actions

        dates = {key[1] for key in intents}
        class_keys = {key[2] for key in intents}

        all_student_ids = set()
        for intent in intents.values():
            all_student_ids.update(intent["student_ids"])
        students_by_id = {
            item.id: item
            for item in StudentProfile.objects.filter(id__in=all_student_ids)
        }

        existing = {
            (item.teacher_id, item.date, item.class_key): item
            for item in Attendance.objects.filter(
                entity_type=Attendance.EntityType.TEACHER,
                teacher=teacher,
                date__in=dates,
                class_key__in=class_keys,
            )
        }

        for key, intent in intents.items():
            item = existing.get(key)
            direct_student = self._direct_teacher_session_student(
                intent,
                students_by_id,
            )
            direct_student_id = direct_student.id if direct_student else None

            if not item:
                actions[key] = "create"
            elif (
                item.status == intent["status"]
                and item.student_id == direct_student_id
            ):
                actions[key] = "unchanged"
            else:
                actions[key] = "update"

        return actions

    def _print_report(
        self,
        *,
        parsed,
        teacher,
        actor,
        students_matched,
        unmatched_students,
        allow_unmatched_students,
        student_intents,
        teacher_intents,
        counts,
        warnings,
        errors,
        commit,
    ):
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("=== MONTHLY ATTENDANCE IMPORT PREVIEW ==="))
        self.stdout.write(f"CSV: {parsed.source_path}")
        self.stdout.write(f"Teacher in CSV: {parsed.teacher_name}")
        self.stdout.write(f"Matched teacher: id={teacher.id} name={teacher}")
        self.stdout.write(f"Month: {parsed.month_label}")
        self.stdout.write(f"Marked by: {actor.username}")
        self.stdout.write(f"Mode: {'COMMIT' if commit else 'DRY RUN'}")
        self.stdout.write("")
        self.stdout.write(f"Student rows found: {len(parsed.students)}")
        self.stdout.write(f"Students matched: {students_matched}")
        self.stdout.write(f"Unmatched students: {len(unmatched_students)}")
        if unmatched_students:
            self.stdout.write(f"  Skipped student attendance for: {', '.join(unmatched_students)}")
            if allow_unmatched_students:
                self.stdout.write(
                    "  Teacher/session attendance from those rows is still included because "
                    "--allow-unmatched-students is active."
                )
        self.stdout.write(f"Attendance cells parsed: {len(parsed.attendance_cells)}")
        self.stdout.write(f"OFF/OF cells skipped: {parsed.off_cells}")
        self.stdout.write(f"Blank cells ignored: {parsed.blank_cells}")
        self.stdout.write("")
        self.stdout.write("Source code totals:")
        for code in ("P", "SA", "SL", "TA", "TL"):
            self.stdout.write(f"  {code}: {parsed.summary_counts.get(code, 0)}")
        self.stdout.write("")
        self.stdout.write("Calculated attendance:")
        self.stdout.write(f"  Student Present: {parsed.summary_counts.get('student_present', 0)}")
        self.stdout.write(f"  Student Absent:  {parsed.summary_counts.get('student_absent', 0)}")
        self.stdout.write(f"  Student Leave:   {parsed.summary_counts.get('student_leave', 0)}")
        self.stdout.write(f"  Teacher Present: {parsed.summary_counts.get('teacher_present', 0)}")
        self.stdout.write(f"  Teacher Absent:  {parsed.summary_counts.get('teacher_absent', 0)}")
        self.stdout.write(f"  Teacher Leave:   {parsed.summary_counts.get('teacher_leave', 0)}")
        self.stdout.write("")
        self.stdout.write(f"Unique student/date records: {len(student_intents)}")
        self.stdout.write(f"Unique teacher/date/time records: {len(teacher_intents)}")
        self.stdout.write("Database actions:")
        self.stdout.write(
            f"  Student create={counts['student_create']} update={counts['student_update']} "
            f"unchanged={counts['student_unchanged']}"
        )
        self.stdout.write(
            f"  Teacher create={counts['teacher_create']} update={counts['teacher_update']} "
            f"unchanged={counts['teacher_unchanged']}"
        )

        if warnings:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING(f"Warnings ({len(warnings)}):"))
            for warning in warnings[:50]:
                self.stdout.write(f"  - {warning}")
            if len(warnings) > 50:
                self.stdout.write(f"  ... {len(warnings) - 50} more warning(s)")

        if errors:
            self.stdout.write("")
            self.stdout.write(self.style.ERROR(f"Errors ({len(errors)}):"))
            for error in errors[:100]:
                self.stdout.write(f"  - {error}")
            if len(errors) > 100:
                self.stdout.write(f"  ... {len(errors) - 100} more error(s)")
