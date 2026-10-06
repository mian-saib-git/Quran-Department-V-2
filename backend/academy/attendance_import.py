from __future__ import annotations

import calendar
import csv
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Iterable


ATTENDANCE_CODE_MAP = {
    "P": ("present", "present"),
    "SA": ("absent", "present"),
    "SL": ("leave", "present"),
    "TA": ("present", "absent"),
    "TL": ("present", "leave"),
}
OFF_CODES = {"OFF", "OF"}


@dataclass(frozen=True)
class ParsedAttendanceCell:
    row_number: int
    student_name: str
    admission_number: str
    class_time: str
    schedule_text: str
    attendance_date: date
    source_code: str
    student_status: str
    teacher_status: str


@dataclass(frozen=True)
class ParsedStudentRow:
    row_number: int
    student_name: str
    admission_number: str
    class_time: str
    schedule_text: str


@dataclass
class MonthlyAttendanceParseResult:
    source_path: str
    teacher_name: str
    month_start: date
    students: list[ParsedStudentRow] = field(default_factory=list)
    attendance_cells: list[ParsedAttendanceCell] = field(default_factory=list)
    off_cells: int = 0
    blank_cells: int = 0
    invalid_cells: list[str] = field(default_factory=list)
    summary_counts: Counter = field(default_factory=Counter)

    @property
    def month_label(self) -> str:
        return self.month_start.strftime("%B %Y")


class AttendanceCsvFormatError(ValueError):
    pass


def normalize_code(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").strip().upper())


def normalize_name(value: str) -> str:
    value = (value or "").strip().casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def strip_leading_teacher_number(value: str) -> str:
    return re.sub(r"^\s*\d+\s*[-.:)]?\s*", "", (value or "").strip())


def normalize_time(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""

    cleaned = raw.replace(";", ":")
    cleaned = re.sub(r"\s+", " ", cleaned).strip().upper()

    for fmt in ("%I:%M %p", "%I:%M%p", "%H:%M", "%I %p", "%I%p"):
        try:
            return datetime.strptime(cleaned, fmt).strftime("%H:%M")
        except ValueError:
            continue

    return ""


def _find_label(rows: list[list[str]], label: str) -> tuple[int, int]:
    target = normalize_name(label)
    for row_index, row in enumerate(rows):
        for col_index, cell in enumerate(row):
            if normalize_name(cell) == target:
                return row_index, col_index
    raise AttendanceCsvFormatError(f"Could not find required label: {label}")


def _next_nonempty(row: list[str], start_index: int) -> str:
    for cell in row[start_index + 1 :]:
        if (cell or "").strip():
            return cell.strip()
    return ""


def _parse_month_start(value: str) -> date:
    value = (value or "").strip()
    formats = (
        "%d-%b-%Y",
        "%d-%B-%Y",
        "%Y-%m-%d",
        "%d/%m/%Y",
        "%m/%d/%Y",
    )
    for fmt in formats:
        try:
            return datetime.strptime(value, fmt).date().replace(day=1)
        except ValueError:
            continue
    raise AttendanceCsvFormatError(f"Could not parse Month Start Date: {value!r}")


def _find_attendance_header(rows: list[list[str]]) -> int:
    for row_index, row in enumerate(rows):
        normalized = [normalize_name(cell) for cell in row]
        if "student" in normalized and "time" in normalized:
            return row_index
    raise AttendanceCsvFormatError("Could not find attendance header row containing Time and student.")


def _column_index(header: list[str], *names: str) -> int:
    normalized = [normalize_name(cell) for cell in header]
    for name in names:
        target = normalize_name(name)
        if target in normalized:
            return normalized.index(target)
    raise AttendanceCsvFormatError(f"Missing required column: {' / '.join(names)}")


def _find_day_columns(header: list[str], month_start: date) -> dict[int, int]:
    days_in_month = calendar.monthrange(month_start.year, month_start.month)[1]
    expected_day = 1
    day_columns: dict[int, int] = {}

    # The real day columns appear after the summary column P. Starting at the
    # rightmost P avoids confusing the summary counters with day values.
    normalized = [normalize_code(cell) for cell in header]
    try:
        scan_from = max(i for i, value in enumerate(normalized) if value == "P") + 1
    except ValueError:
        scan_from = 0

    for col_index in range(scan_from, len(header)):
        cell = (header[col_index] or "").strip()

        # Real teacher sheets use zero-padded headings (01, 02, ...), while
        # some exported variants use 1, 2, .... Treat both forms identically.
        try:
            numeric_day = int(cell)
        except (TypeError, ValueError):
            numeric_day = None

        if numeric_day == expected_day:
            day_columns[expected_day] = col_index
            expected_day += 1
            if expected_day > days_in_month:
                break
        elif day_columns:
            # Once the sequence starts, unrelated columns mean the format is
            # no longer the monthly day block.
            break

    if len(day_columns) != days_in_month:
        raise AttendanceCsvFormatError(
            f"Expected day columns 1-{days_in_month}, found {len(day_columns)}."
        )

    return day_columns


def parse_monthly_attendance_csv(path: str | Path) -> MonthlyAttendanceParseResult:
    source = Path(path)
    if not source.exists():
        raise AttendanceCsvFormatError(f"CSV file not found: {source}")

    with source.open("r", encoding="utf-8-sig", errors="replace", newline="") as handle:
        rows = list(csv.reader(handle))

    if not rows:
        raise AttendanceCsvFormatError("CSV file is empty.")

    teacher_row_index, teacher_col_index = _find_label(rows, "TEACHER NAME")
    teacher_name = _next_nonempty(rows[teacher_row_index], teacher_col_index)
    if not teacher_name:
        raise AttendanceCsvFormatError("Teacher name is blank.")

    month_row_index, month_col_index = _find_label(rows, "Month Start Date")
    month_value = _next_nonempty(rows[month_row_index], month_col_index)
    month_start = _parse_month_start(month_value)

    header_index = _find_attendance_header(rows)
    header = rows[header_index]
    time_col = _column_index(header, "Time")
    number_col = _column_index(header, "No")
    student_col = _column_index(header, "student")
    admission_col = _column_index(header, "Admission#", "Admission")
    days_col = _column_index(header, "Days")
    day_columns = _find_day_columns(header, month_start)

    result = MonthlyAttendanceParseResult(
        source_path=str(source),
        teacher_name=teacher_name,
        month_start=month_start,
    )

    for row_index in range(header_index + 1, len(rows)):
        row = rows[row_index]

        def get_cell(col: int) -> str:
            if col >= len(row):
                return ""
            return (row[col] or "").strip()

        row_number_value = get_cell(number_col)
        student_name = get_cell(student_col)

        # Student rows in this sheet are numbered consecutively. The first
        # non-student section (salary/lesson plan/etc.) therefore ends parsing.
        if not row_number_value.isdigit():
            if result.students:
                break
            continue

        if not student_name:
            result.invalid_cells.append(
                f"CSV row {row_index + 1}: numbered student row has no student name."
            )
            continue

        admission_number = get_cell(admission_col)
        raw_time = get_cell(time_col)
        class_time = normalize_time(raw_time)
        schedule_text = get_cell(days_col)

        parsed_student = ParsedStudentRow(
            row_number=row_index + 1,
            student_name=student_name,
            admission_number=admission_number,
            class_time=class_time,
            schedule_text=schedule_text,
        )
        result.students.append(parsed_student)

        for day, col_index in day_columns.items():
            raw_code = get_cell(col_index)
            code = normalize_code(raw_code)
            attendance_date = date(month_start.year, month_start.month, day)

            if not code:
                result.blank_cells += 1
                continue

            if code in OFF_CODES:
                result.off_cells += 1
                result.summary_counts["OFF"] += 1
                continue

            mapping = ATTENDANCE_CODE_MAP.get(code)
            if not mapping:
                result.invalid_cells.append(
                    f"CSV row {row_index + 1}, {attendance_date.isoformat()}, "
                    f"student {student_name!r}: unknown attendance code {raw_code!r}."
                )
                result.summary_counts["INVALID"] += 1
                continue

            if not class_time:
                result.invalid_cells.append(
                    f"CSV row {row_index + 1}, student {student_name!r}: "
                    f"invalid/blank class time {raw_time!r}."
                )
                result.summary_counts["INVALID"] += 1
                continue

            student_status, teacher_status = mapping
            result.attendance_cells.append(
                ParsedAttendanceCell(
                    row_number=row_index + 1,
                    student_name=student_name,
                    admission_number=admission_number,
                    class_time=class_time,
                    schedule_text=schedule_text,
                    attendance_date=attendance_date,
                    source_code=code,
                    student_status=student_status,
                    teacher_status=teacher_status,
                )
            )
            result.summary_counts[code] += 1
            result.summary_counts[f"student_{student_status}"] += 1
            result.summary_counts[f"teacher_{teacher_status}"] += 1

    if not result.students:
        raise AttendanceCsvFormatError("No student attendance rows were found.")

    return result
