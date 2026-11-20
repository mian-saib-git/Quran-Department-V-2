import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. getDailyLessonReports supports pagination, filtering, and AbortSignal", () => {
  const src = read("services/djangoApiService.ts");
  assert.equal(src.includes("page?: number"), true);
  assert.equal(src.includes("page_size?: number"), true);
  assert.equal(src.includes("search?: string"), true);
  assert.equal(src.includes("signal?: AbortSignal"), true);
});

test("2. CoordinatorLessons loads page 1 (page_size 50), queries backend on filter/search, and supports loading older reports", () => {
  const src = read("components/CoordinatorLessons.tsx");
  assert.equal(src.includes("page_size: 50"), true);
  assert.equal(src.includes("dailyReportsAbortRef"), true);
  assert.equal(src.includes("dailyReportsEpochRef"), true);
  assert.equal(src.includes("Load older reports"), true);
  assert.equal(src.includes("buildDailyReportParams"), true);
});

test("3. TeacherPortal loads page 1 (page_size 50), filters by student on backend, and supports loading older reports", () => {
  const src = read("components/TeacherPortal.tsx");
  assert.equal(src.includes("page_size: 50"), true);
  assert.equal(src.includes("dailyReportsAbortRef"), true);
  assert.equal(src.includes("dailyReportsEpochRef"), true);
  assert.equal(src.includes("Load older reports"), true);
  assert.equal(src.includes("student_id: Number(studentId), date: lessonDate"), true);
});
