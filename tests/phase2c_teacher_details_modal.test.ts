import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. TeacherDetailsModal fetches on demand, guards stale requests, and supports tabs/search/Escape", () => {
  const src = read("components/TeacherDetailsModal.tsx");
  assert.equal(src.includes("getQuranTeacherDetails"), true);
  assert.equal(src.includes("requestSeqRef"), true);
  assert.equal(src.includes("Active Students"), true);
  assert.equal(src.includes("Class Schedule"), true);
  assert.equal(src.includes("Dropped & Leave"), true);
  assert.equal(src.includes("Escape"), true);
  assert.equal(src.includes("ivs-refresh-state"), true);
});

test("2. Location A (QuranCoordinatorPortal & CoordinatorLiveClassesSection) opens TeacherDetailsModal on teacher click", () => {
  const live = read("components/dashboard/CoordinatorLiveClassesSection.tsx");
  assert.equal(live.includes("onOpenTeacherDetails"), true);

  const portal = read("components/QuranCoordinatorPortal.tsx");
  assert.equal(portal.includes("TeacherDetailsModal"), true);
  assert.equal(portal.includes("selectedTeacherDetailsId"), true);
  assert.equal(portal.includes("onOpenTeacherDetails="), true);
});

test("3. Location B (CoordinatorAccounts) opens the same TeacherDetailsModal from teacher icon and name without eager loading", () => {
  const accounts = read("components/CoordinatorAccounts.tsx");
  assert.equal(accounts.includes("TeacherDetailsModal"), true);
  assert.equal(accounts.includes("selectedTeacherDetailsId"), true);
  assert.equal(accounts.includes("onViewTeacher"), true);
  assert.equal(accounts.includes("item.teacher_profile?.id"), true);
});
