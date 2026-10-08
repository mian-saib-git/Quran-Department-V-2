from __future__ import annotations

import csv
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Iterable

from django.db import transaction

from .attendance_import import normalize_name, normalize_time, strip_leading_teacher_number
from .models import Attendance, StudentProfile, TeacherProfile
from .attendance_import_payroll import assert_import_unlocked, import_scope, AttendanceImportPayrollLocked


REPORT_REQUIRED_COLUMNS = {
    "date",
    "class time",
    "teacher",
    "student",
    "type",
    "status",
}


@dataclass(frozen=True)
class ParsedReportRow:
    row_number: int
    attendance_date: date
    class_time: str
    teacher_name: str
    student_name: str
    entity_type: str
    status: str


@dataclass
class AttendanceReportParseResult:
    source_path: str
    rows: list[ParsedReportRow] = field(default_factory=list)
    unmarked_rows: int = 0
    blank_rows: int = 0
    warnings: list[str] = field(default_factory=list)
    invalid_rows: list[str] = field(default_factory=list)

    @property
    def date_min(self) -> date | None:
        return min((row.attendance_date for row in self.rows), default=None)

    @property
    def date_max(self) -> date | None:
        return max((row.attendance_date for row in self.rows), default=None)

    @property
    def date_label(self) -> str:
        if not self.date_min:
            return "No dated rows"
        if self.date_min == self.date_max:
            return self.date_min.isoformat()
        return f"{self.date_min.isoformat()} to {self.date_max.isoformat()}"


class AttendanceReportFormatError(ValueError):
    pass


def _normalized_header(row: list[str]) -> list[str]:
    return [normalize_name(cell) for cell in row]


def _parse_date(value: str) -> date:
    raw = (value or "").strip()
    for fmt in (
        "%Y-%m-%d",
        "%d-%b-%Y",
        "%d-%B-%Y",
        "%m/%d/%Y",
        "%d/%m/%Y",
    ):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise AttendanceReportFormatError(f"Could not parse attendance date {raw!r}.")


def _normalize_status(value: str) -> str:
    normalized = normalize_name(value)
    aliases = {
        "present": "present",
        "p": "present",
        "absent": "absent",
        "a": "absent",
        "leave": "leave",
        "l": "leave",
        "unmarked": "unmarked",
        "not marked": "unmarked",
        "not_marked": "unmarked",
    }
    return aliases.get(normalized, "")


def _normalize_entity_type(value: str) -> str:
    normalized = normalize_name(value)
    if normalized in {"teacher", "student"}:
        return normalized
    return ""


def _clean_student_name(value: str) -> str:
    raw = (value or "").strip()
    if raw in {"—", "–", "-", "--", "n/a", "N/A"}:
        return ""
    return raw


def detect_attendance_csv_format(path: str | Path) -> str:
    """Return 'monthly', 'report', or 'unknown' without mutating anything."""
    source = Path(path)
    with source.open("r", encoding="utf-8-sig", errors="replace", newline="") as handle:
        rows = list(csv.reader(handle))

    if not rows:
        return "unknown"

    # Export/report format is a normalized row table. Search the first few rows
    # in case a spreadsheet tool inserted one leading blank row.
    for row in rows[:8]:
        header = set(_normalized_header(row))
        if REPORT_REQUIRED_COLUMNS.issubset(header):
            return "report"

    # Monthly teacher template contains these labels anywhere near the top.
    flattened = {normalize_name(cell) for row in rows[:20] for cell in row if (cell or "").strip()}
    if "teacher name" in flattened and "month start date" in flattened:
        return "monthly"

    return "unknown"


def parse_attendance_report_csv(path: str | Path) -> AttendanceReportParseResult:
    source = Path(path)
    if not source.exists():
        raise AttendanceReportFormatError(f"CSV file not found: {source}")

    with source.open("r", encoding="utf-8-sig", errors="replace", newline="") as handle:
        rows = list(csv.reader(handle))

    if not rows:
        raise AttendanceReportFormatError("CSV file is empty.")

    header_index = None
    header = None
    for idx, row in enumerate(rows[:20]):
        normalized = _normalized_header(row)
        if REPORT_REQUIRED_COLUMNS.issubset(set(normalized)):
            header_index = idx
            header = normalized
            break

    if header_index is None or header is None:
        raise AttendanceReportFormatError(
            "Could not find exported attendance-report columns: "
            "Date, Class Time, Teacher, Student, Type, Status."
        )

    col = {name: header.index(name) for name in REPORT_REQUIRED_COLUMNS}
    result = AttendanceReportParseResult(source_path=str(source))

    for idx in range(header_index + 1, len(rows)):
        raw = rows[idx]
        if not any((cell or "").strip() for cell in raw):
            result.blank_rows += 1
            continue

        def cell(name: str) -> str:
            pos = col[name]
            if pos >= len(raw):
                return ""
            return (raw[pos] or "").strip()

        row_number = idx + 1
        try:
            attendance_date = _parse_date(cell("date"))
        except AttendanceReportFormatError as exc:
            result.invalid_rows.append(f"CSV row {row_number}: {exc}")
            continue

        teacher_name = cell("teacher")
        if not teacher_name:
            result.invalid_rows.append(f"CSV row {row_number}: Teacher is blank.")
            continue

        entity_type = _normalize_entity_type(cell("type"))
        if not entity_type:
            result.invalid_rows.append(
                f"CSV row {row_number}: Type must be Teacher or Student, got {cell('type')!r}."
            )
            continue

        status_value = _normalize_status(cell("status"))
        if not status_value:
            result.invalid_rows.append(
                f"CSV row {row_number}: Status must be Present, Absent, Leave, or Unmarked; "
                f"got {cell('status')!r}."
            )
            continue

        if status_value == "unmarked":
            result.unmarked_rows += 1
            continue

        raw_time = cell("class time")
        class_time = normalize_time(raw_time)
        if raw_time and not class_time:
            result.invalid_rows.append(
                f"CSV row {row_number}: invalid Class Time {raw_time!r}."
            )
            continue

        if entity_type == "teacher" and not class_time:
            result.warnings.append(
                f"CSV row {row_number}: teacher attendance has no Class Time; "
                "it will use the blank session key."
            )

        result.rows.append(
            ParsedReportRow(
                row_number=row_number,
                attendance_date=attendance_date,
                class_time=class_time,
                teacher_name=teacher_name,
                student_name=_clean_student_name(cell("student")),
                entity_type=entity_type,
                status=status_value,
            )
        )

    if not result.rows and not result.invalid_rows:
        raise AttendanceReportFormatError("No importable attendance rows were found.")

    # A report filename often includes the selected filter range. If the actual
    # Date column disagrees, make it explicit that Date is authoritative.
    filename_match = re.search(
        r"(\d{4}-\d{2}-\d{2})_to_(\d{4}-\d{2}-\d{2})",
        source.name,
    )
    if filename_match and result.date_min and result.date_max:
        try:
            named_start = datetime.strptime(filename_match.group(1), "%Y-%m-%d").date()
            named_end = datetime.strptime(filename_match.group(2), "%Y-%m-%d").date()
        except ValueError:
            named_start = named_end = None
        if named_start and named_end:
            if result.date_min < named_start or result.date_max > named_end:
                result.warnings.append(
                    "Filename suggests date range "
                    f"{named_start.isoformat()} to {named_end.isoformat()}, but the CSV Date column "
                    f"contains {result.date_label}. Import uses the Date column, not the filename."
                )

    return result


def _teacher_candidates(teacher: TeacherProfile) -> set[str]:
    return {
        normalize_name(str(teacher)),
        normalize_name(teacher.user.username),
        normalize_name(teacher.user.get_full_name()),
        normalize_name(strip_leading_teacher_number(str(teacher))),
        normalize_name(strip_leading_teacher_number(teacher.user.get_full_name())),
    }


def _resolve_teacher(name: str, teachers: list[TeacherProfile]):
    targets = {
        normalize_name(name),
        normalize_name(strip_leading_teacher_number(name)),
    }
    targets.discard("")
    matches = [teacher for teacher in teachers if targets & _teacher_candidates(teacher)]
    if len(matches) == 1:
        return matches[0], None
    if not matches:
        return None, f"Could not match report teacher {name!r} inside your Quran department."
    ids = ", ".join(str(item.id) for item in matches)
    return None, f"Teacher {name!r} matched multiple teachers ({ids})."


def _student_exact_matches(name_target: str, pool: Iterable[StudentProfile]):
    matches = []
    for student in pool:
        candidates = {
            normalize_name(str(student)),
            normalize_name(student.user.get_full_name()),
            normalize_name(student.user.username),
        }
        if name_target in candidates:
            matches.append(student)
    return matches


def _resolve_student(
    student_name: str,
    teacher: TeacherProfile,
    teacher_students: list[StudentProfile],
    all_students: list[StudentProfile],
):
    if not student_name:
        return None, None, None

    target = normalize_name(student_name)

    local_exact = _student_exact_matches(target, teacher_students)
    if len(local_exact) == 1:
        return local_exact[0], None, None
    if len(local_exact) > 1:
        ids = ", ".join(str(item.id) for item in local_exact)
        return None, f"Student {student_name!r} matched multiple students under {teacher} ({ids}).", None

    # Same safe convenience used by the monthly importer: allow one shorter
    # current name fully contained in the exported historical name.
    target_tokens = set(target.split())
    contained = []
    for student in teacher_students:
        candidate = normalize_name(str(student))
        candidate_tokens = set(candidate.split())
        if candidate_tokens and candidate_tokens < target_tokens:
            contained.append(student)
    if len(contained) == 1:
        student = contained[0]
        return student, None, (
            f"Student {student_name}: matched to current {teacher} student "
            f"id={student.id} name={student} by unique contained-name match."
        )

    global_exact = _student_exact_matches(target, all_students)
    if len(global_exact) == 1:
        student = global_exact[0]
        warning = None
        if student.teacher_id != teacher.id:
            warning = (
                f"Student {student_name}: exact historical match found globally as id={student.id}, "
                f"currently assigned to {student.teacher}; report teacher {teacher} is retained historically."
            )
        return student, None, warning
    if len(global_exact) > 1:
        ids = ", ".join(str(item.id) for item in global_exact)
        return None, f"Student {student_name!r} matched multiple students globally ({ids}).", None

    return None, f"Could not safely match historical student {student_name!r} for teacher {teacher}.", None


def import_attendance_report_csv(
    parsed: AttendanceReportParseResult,
    *,
    allowed_teachers: Iterable[TeacherProfile],
    allowed_students: Iterable[StudentProfile],
    actor,
    commit: bool,
    allow_unmatched_students: bool,
):
    teachers = list(allowed_teachers)
    students = list(allowed_students)
    students_by_teacher: dict[int, list[StudentProfile]] = defaultdict(list)
    for student in students:
        students_by_teacher[student.teacher_id].append(student)

    errors = list(parsed.invalid_rows)
    warnings = list(parsed.warnings)

    teacher_cache: dict[str, TeacherProfile] = {}
    student_cache: dict[tuple[int, str], StudentProfile | None] = {}
    unmatched_names: set[str] = set()

    student_intents = {}
    teacher_intents = {}
    source_counts = Counter()

    for row in parsed.rows:
        teacher_key_name = normalize_name(row.teacher_name)
        teacher = teacher_cache.get(teacher_key_name)
        if teacher is None:
            teacher, error = _resolve_teacher(row.teacher_name, teachers)
            if error:
                errors.append(f"CSV row {row.row_number}: {error}")
                continue
            teacher_cache[teacher_key_name] = teacher

        source_counts[f"{row.entity_type}_{row.status}"] += 1

        student = None
        if row.student_name:
            student_cache_key = (teacher.id, normalize_name(row.student_name))
            if student_cache_key in student_cache:
                student = student_cache[student_cache_key]
            else:
                student, student_error, student_warning = _resolve_student(
                    row.student_name,
                    teacher,
                    students_by_teacher.get(teacher.id, []),
                    students,
                )
                if student_warning:
                    warnings.append(student_warning)
                if student_error:
                    if allow_unmatched_students:
                        unmatched_names.add(f"{teacher}: {row.student_name}")
                        warnings.append(
                            f"CSV row {row.row_number}: {student_error} "
                            "The row will continue without a student relationship because "
                            "Allow unmatched historical students is enabled."
                        )
                        student_cache[student_cache_key] = None
                    else:
                        errors.append(f"CSV row {row.row_number}: {student_error}")
                        student_cache[student_cache_key] = None
                        continue
                else:
                    student_cache[student_cache_key] = student

        if row.entity_type == "student":
            if not row.student_name:
                errors.append(f"CSV row {row.row_number}: Student is blank for a Student attendance row.")
                continue
            if student is None:
                # With allow-unmatched enabled, skip only the student-side record.
                if allow_unmatched_students:
                    continue
                continue

            key = (student.id, row.attendance_date)
            existing_intent = student_intents.get(key)
            value = {
                "student": student,
                "teacher": teacher,
                "status": row.status,
                "class_time": row.class_time,
                "row_number": row.row_number,
            }
            if existing_intent:
                if existing_intent["status"] != row.status:
                    errors.append(
                        f"Conflicting Student attendance for {student} on {row.attendance_date}: "
                        f"{existing_intent['status']} vs {row.status}."
                    )
                elif existing_intent["teacher"].id != teacher.id:
                    errors.append(
                        f"Conflicting historical teachers for {student} on {row.attendance_date}: "
                        f"{existing_intent['teacher']} vs {teacher}."
                    )
                elif (existing_intent["class_time"] or "") != (row.class_time or ""):
                    errors.append(
                        f"Conflicting class times for {student} on {row.attendance_date}: "
                        f"{existing_intent['class_time'] or '(blank)'} vs {row.class_time or '(blank)'}."
                    )
            else:
                student_intents[key] = value
            continue

        # Teacher attendance is keyed by historical teacher + date + class time.
        key = (teacher.id, row.attendance_date, row.class_time)
        intent = teacher_intents.get(key)
        if intent is None:
            intent = {
                "teacher": teacher,
                "status": row.status,
                "student_ids": set(),
                "unmatched_names": set(),
                "row_numbers": [],
            }
            teacher_intents[key] = intent
        elif intent["status"] != row.status:
            errors.append(
                f"Conflicting Teacher attendance for {teacher} on {row.attendance_date} "
                f"at {row.class_time or '(blank)'}: {intent['status']} vs {row.status}."
            )
        intent["row_numbers"].append(row.row_number)
        if student:
            intent["student_ids"].add(student.id)
        elif row.student_name:
            intent["unmatched_names"].add(row.student_name)

    # If a teacher row did not name its student, use matching historical student
    # rows at the same teacher/date/time to recover the relationship safely.
    for (_student_id, attendance_date), student_intent in student_intents.items():
        teacher = student_intent["teacher"]
        class_time = student_intent["class_time"]
        teacher_key = (teacher.id, attendance_date, class_time)
        intent = teacher_intents.get(teacher_key)
        if intent is not None:
            intent["student_ids"].add(student_intent["student"].id)

    student_ids = {key[0] for key in student_intents}
    student_dates = {key[1] for key in student_intents}
    existing_students = {
        (item.student_id, item.date): item
        for item in Attendance.objects.filter(
            entity_type=Attendance.EntityType.STUDENT,
            student_id__in=student_ids,
            date__in=student_dates,
        )
    } if student_intents else {}

    all_teacher_ids = {key[0] for key in teacher_intents}
    teacher_dates = {key[1] for key in teacher_intents}
    class_keys = {key[2] for key in teacher_intents}
    existing_teachers = {
        (item.teacher_id, item.date, item.class_key): item
        for item in Attendance.objects.filter(
            entity_type=Attendance.EntityType.TEACHER,
            teacher_id__in=all_teacher_ids,
            date__in=teacher_dates,
            class_key__in=class_keys,
        )
    } if teacher_intents else {}

    students_by_id = {student.id: student for student in students}

    def direct_student_id(intent):
        ids = set(intent.get("student_ids") or set())
        unmatched = set(intent.get("unmatched_names") or set())
        if len(ids) == 1 and not unmatched:
            return next(iter(ids))
        return None

    counts = Counter()

    for key, intent in student_intents.items():
        existing = existing_students.get(key)
        if existing is None:
            counts["student_create"] += 1
            continue
        desired = (
            intent["teacher"].id,
            intent["class_time"] or "",
            intent["status"],
        )
        current = (
            existing.teacher_id,
            existing.class_key or "",
            existing.status,
        )
        counts["student_unchanged" if desired == current else "student_update"] += 1

    for key, intent in teacher_intents.items():
        existing = existing_teachers.get(key)
        desired_student_id = direct_student_id(intent)
        if existing is None:
            counts["teacher_create"] += 1
            continue
        desired = (intent["status"], desired_student_id)
        current = (existing.status, existing.student_id)
        counts["teacher_unchanged" if desired == current else "teacher_update"] += 1

    output_lines = []
    output_lines.append("")
    output_lines.append("=== ATTENDANCE REPORT CSV IMPORT PREVIEW ===")
    output_lines.append(f"CSV: {parsed.source_path}")
    output_lines.append("Detected format: exported attendance report")
    output_lines.append(f"Date rows: {parsed.date_label}")
    output_lines.append(f"Teachers found: {len(teacher_cache)}")
    output_lines.append(f"Mode: {'COMMIT' if commit else 'DRY RUN'}")
    output_lines.append("")
    output_lines.append(f"Importable source rows: {len(parsed.rows)}")
    output_lines.append(f"Unmarked rows ignored: {parsed.unmarked_rows}")
    output_lines.append(f"Unique student/date records: {len(student_intents)}")
    output_lines.append(f"Unique teacher/date/time records: {len(teacher_intents)}")
    output_lines.append("")
    output_lines.append("Database actions:")
    output_lines.append(
        f"  Student create={counts['student_create']} update={counts['student_update']} "
        f"unchanged={counts['student_unchanged']}"
    )
    output_lines.append(
        f"  Teacher create={counts['teacher_create']} update={counts['teacher_update']} "
        f"unchanged={counts['teacher_unchanged']}"
    )

    if source_counts:
        output_lines.append("")
        output_lines.append("Source row totals:")
        for entity in ("student", "teacher"):
            for status_value in ("present", "absent", "leave"):
                output_lines.append(
                    f"  {entity.title()} {status_value.title()}: "
                    f"{source_counts.get(f'{entity}_{status_value}', 0)}"
                )

    if unmatched_names:
        output_lines.append("")
        output_lines.append("PAYROLL WARNING: unmatched students have NO student-side attendance and cannot earn salary from those rows.")
        output_lines.append(f"Unmatched historical students ({len(unmatched_names)}):")
        for name in sorted(unmatched_names):
            output_lines.append(f"  - {name}")

    if warnings:
        output_lines.append("")
        output_lines.append(f"Warnings ({len(warnings)}):")
        for warning in warnings[:100]:
            output_lines.append(f"  - {warning}")
        if len(warnings) > 100:
            output_lines.append(f"  ... {len(warnings) - 100} more warning(s)")

    if errors:
        output_lines.append("")
        output_lines.append(f"Errors ({len(errors)}):")
        for error in errors[:150]:
            output_lines.append(f"  - {error}")
        if len(errors) > 150:
            output_lines.append(f"  ... {len(errors) - 150} more error(s)")

    if errors:
        return {
            "success": False,
            "detail": f"Import blocked: {len(errors)} validation error(s). No database changes were made.",
            "output": "\n".join(output_lines),
            "date_label": parsed.date_label,
            "teacher_count": len(teacher_cache),
        }

    if not commit:
        output_lines.append("")
        output_lines.append("DRY RUN PASSED. No database changes were made.")
        return {
            "success": True,
            "detail": "Preview passed. No database changes were made.",
            "output": "\n".join(output_lines),
            "date_label": parsed.date_label,
            "teacher_count": len(teacher_cache),
        }

    with transaction.atomic():
        for key, intent in student_intents.items():
            existing = existing_students.get(key)
            department, institution = import_scope(intent["teacher"], intent["student"])
            if existing is None:
                assert_import_unlocked(teacher=intent["teacher"], target_date=key[1],
                                       class_key=intent["class_time"], student=intent["student"])
                Attendance.objects.create(
                    entity_type=Attendance.EntityType.STUDENT,
                    teacher=intent["teacher"],
                    student=intent["student"],
                    date=key[1],
                    class_key=intent["class_time"] or "",
                    status=intent["status"],
                    marked_by=actor,
                    department=department,
                    institution=institution,
                )
                continue

            changes = {}
            if existing.teacher_id != intent["teacher"].id:
                changes["teacher_id"] = intent["teacher"].id
            if (existing.class_key or "") != (intent["class_time"] or ""):
                changes["class_key"] = intent["class_time"] or ""
            if existing.status != intent["status"]:
                changes["status"] = intent["status"]
            if existing.department_id is None and department is not None:
                changes["department_id"] = department.id
            if existing.institution_id is None and institution is not None:
                changes["institution_id"] = institution.id
            if changes:
                assert_import_unlocked(teacher=intent["teacher"], target_date=key[1],
                                       class_key=intent["class_time"], student=intent["student"])
                Attendance.objects.filter(pk=existing.pk).update(**changes)

        for key, intent in teacher_intents.items():
            existing = existing_teachers.get(key)
            desired_student_id = direct_student_id(intent)
            department, institution = import_scope(intent["teacher"])
            if existing is None:
                assert_import_unlocked(teacher=intent["teacher"], target_date=key[1], class_key=key[2])
                Attendance.objects.create(
                    entity_type=Attendance.EntityType.TEACHER,
                    teacher=intent["teacher"],
                    student=students_by_id.get(desired_student_id) if desired_student_id else None,
                    date=key[1],
                    class_key=key[2] or "",
                    status=intent["status"],
                    marked_by=actor,
                    department=department,
                    institution=institution,
                )
                continue

            changes = {}
            if existing.student_id != desired_student_id:
                changes["student_id"] = desired_student_id
            if existing.status != intent["status"]:
                changes["status"] = intent["status"]
            if existing.department_id is None and department is not None:
                changes["department_id"] = department.id
            if existing.institution_id is None and institution is not None:
                changes["institution_id"] = institution.id
            if changes:
                assert_import_unlocked(teacher=intent["teacher"], target_date=key[1], class_key=key[2])
                Attendance.objects.filter(pk=existing.pk).update(**changes)

    output_lines.append("")
    output_lines.append("IMPORT COMMITTED SUCCESSFULLY.")
    output_lines.append(
        f"Student attendance records processed: {len(student_intents)} | "
        f"Teacher/session records processed: {len(teacher_intents)}"
    )

    return {
        "success": True,
        "detail": "Attendance imported successfully.",
        "output": "\n".join(output_lines),
        "date_label": parsed.date_label,
        "teacher_count": len(teacher_cache),
    }
