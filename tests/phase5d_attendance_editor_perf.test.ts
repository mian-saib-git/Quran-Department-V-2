import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

test("1. AttendanceEditor uses shared Intl.Collator and avoids localeCompare in hot sort paths", () => {
  const src = read("components/AttendanceEditor.tsx");
  assert.equal(src.includes("new Intl.Collator()"), true, "must instantiate shared Intl.Collator");
  assert.equal(src.includes("localeCompare("), false, "must not call per-comparison localeCompare()");
});

test("2. AttendanceEditor decouples structural teacherBucketsBase from recordsForDate and statusFilter", () => {
  const src = read("components/AttendanceEditor.tsx");
  const bucketsStart = src.indexOf("const teacherBucketsBase = useMemo(");
  const cardsComment = src.indexOf("// Attach live attendance statuses");
  assert.ok(bucketsStart > 0 && cardsComment > bucketsStart, "teacherBucketsBase must precede teacherCards");

  const bucketsBlock = src.slice(bucketsStart, cardsComment);
  assert.equal(bucketsBlock.includes("debouncedSearch"), true, "teacherBucketsBase must use debouncedSearch");
  assert.equal(bucketsBlock.includes("recordsForDate"), false, "teacherBucketsBase must not depend on recordsForDate");
  assert.equal(bucketsBlock.includes("statusFilter"), false, "teacherBucketsBase must not depend on statusFilter");
});

test("3. AttendanceEditor defers studentsBase and filteredStudents when entityFilter is teachers", () => {
  const src = read("components/AttendanceEditor.tsx");
  const studentsBaseStart = src.indexOf("const studentsBase = useMemo(");
  const filteredStart = src.indexOf("const filteredStudents = useMemo(");
  assert.ok(studentsBaseStart > 0 && filteredStart > studentsBaseStart);

  const studentsBaseBlock = src.slice(studentsBaseStart, studentsBaseStart + 250);
  const filteredBlock = src.slice(filteredStart, filteredStart + 250);
  assert.equal(studentsBaseBlock.includes('if (entityFilter !== "students") return [];'), true);
  assert.equal(filteredBlock.includes('if (entityFilter !== "students") return [];'), true);
});

test("4. AttendanceEditor memoizes StatusButtonsLight and preserves coverage validation", () => {
  const src = read("components/AttendanceEditor.tsx");
  assert.equal(src.includes("const StatusButtonsLight = React.memo("), true);
  assert.equal(src.includes("export function getCoverageValidationState("), true);
  assert.equal(src.includes("export function reconcileCoverageAssignments("), true);
  assert.equal(src.includes("Confirm attendance & coverage"), true);
});
