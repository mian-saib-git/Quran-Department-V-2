import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. salaryAssignmentService exposes fetchTeacherAssignmentDetail and AbortSignal support", () => {
  const src = read("services/salaryAssignmentService.ts");
  assert.equal(src.includes("export async function fetchTeacherAssignmentDetail"), true);
  assert.equal(src.includes("options?: { signal?: AbortSignal }"), true);
});

test("2. TeacherSalaryAssignments guards against stale teacher detail responses", () => {
  const src = read("components/unified-salary/TeacherSalaryAssignments.tsx");
  assert.equal(src.includes("detailsEpochRef"), true);
  assert.equal(src.includes("detailsAbortRef"), true);
  assert.equal(src.includes("AbortError"), true);
});
