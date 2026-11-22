import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. ClassCard displays saved substitute name only from persisted attendanceToday, never unsaved dropdown", () => {
  const src = read("components/ClassCard.tsx");
  assert.equal(src.includes("attendanceToday?.substituteTeacherName"), true);
  assert.equal(src.includes("Substitute Teacher:"), true);
  assert.equal(src.includes("attendanceToday?.teacherId"), true);
  assert.equal(src.includes("studentStatus === AttendanceStatus.PRESENT"), true);
  assert.equal(src.includes("teacherStatus === AttendanceStatus.ABSENT"), true);
  assert.equal(src.includes("teacherStatus === AttendanceStatus.LEAVE"), true);
});

test("2. djangoApiService maps substitute_teacher_id and substitute_teacher_name onto AttendanceRecord", () => {
  const src = read("services/djangoApiService.ts");
  assert.equal(src.includes("substitute_teacher_id?: number | null;"), true);
  assert.equal(src.includes("substitute_teacher_name?: string | null;"), true);
  assert.equal(src.includes("substituteTeacherId:"), true);
  assert.equal(src.includes("substituteTeacherName:"), true);
});

test("3. App.tsx updates student substitute fields from saved session coverage and clears on unmark", () => {
  const src = read("App.tsx");
  assert.equal(src.includes("studentCoverageById"), true);
  assert.equal(src.includes("cov.substitute_teacher_name"), true);
  assert.equal(src.includes("clearedStudentIds"), true);
});

test("4. storageService.normalizeState preserves substituteTeacherId and substituteTeacherName across refresh", () => {
  const src = read("services/storageService.ts");
  assert.equal(src.includes("substituteTeacherId:"), true);
  assert.equal(src.includes("substituteTeacherName:"), true);
  assert.equal(src.includes("a?.substituteTeacherName ?? a?.substitute_teacher_name"), true);
});
