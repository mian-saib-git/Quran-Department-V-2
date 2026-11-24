import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. Quran CoordinatorAccounts uses server-side pagination, debounced search, AbortController, and counts", () => {
  const src = read("components/CoordinatorAccounts.tsx");
  assert.equal(src.includes("role: targetMode"), true);
  assert.equal(src.includes("page_size: PAGE_SIZE"), true);
  assert.equal(src.includes("new AbortController()"), true);
  assert.equal(src.includes("debouncedSearch"), true);
  assert.equal(src.includes("counts.coordinators"), true);
  assert.equal(src.includes("counts.teachers"), true);
  assert.equal(src.includes("counts.students"), true);
  assert.equal(src.includes("export: true"), true);
  assert.equal(src.includes("ensureTeacherOptions"), true);
  assert.equal(src.includes("lazy(() => import(\"./TeacherDetailsModal\"))"), true);
});

test("2. TuitionAccountsEnrollment defers scheduling matrix and options until modal open and paginates accounts", () => {
  const src = read("components/tuition/TuitionAccountsEnrollment.tsx");
  assert.equal(src.includes("getTuitionEnrollments"), false);
  assert.equal(src.includes("ensureOptions"), true);
  assert.equal(src.includes("ensureSchedulingMatrix"), true);
  assert.equal(src.includes("PAGE_SIZE = 25"), true);
  assert.equal(src.includes("new AbortController()"), true);
  assert.equal(src.includes("debouncedSearch"), true);
  assert.equal(src.includes("pagination.total_pages"), true);
});
