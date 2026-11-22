import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. QuranDroppedLeave provides Confirm Drop, Confirm Leave, and Confirm Return controls", () => {
  const src = read("components/QuranDroppedLeave.tsx");
  assert.equal(src.includes("confirmQuranStudentDropLeaveReturn"), true);
  assert.equal(src.includes('"confirm_drop"'), true);
  assert.equal(src.includes('"confirm_leave"'), true);
  assert.equal(src.includes('"confirm_return"'), true);
  assert.equal(src.includes("requires_reassignment"), true);
  assert.equal(src.includes("ivs-refresh-state"), true);
  assert.equal(src.includes("getQuranBusinessTime"), true);
  assert.equal(src.includes("todayIsoDate"), false);
});

test("2. QuranCoordinatorPortal filters Live Now, Up Next, and counts using activeViewStudents", () => {
  const src = read("components/QuranCoordinatorPortal.tsx");
  assert.equal(src.includes("activeViewStudents"), true);
  assert.equal(src.includes("on_leave"), true);
  assert.equal(src.includes("old_dropped"), true);
  assert.equal(src.includes("trial_dropped"), true);
  assert.equal(src.includes("statusEffectiveDate"), true);
});

test("3. storageService preserves classStatus and statusEffectiveDate and App listens for ivs-refresh-state", () => {
  const storage = read("services/storageService.ts");
  assert.equal(storage.includes("classStatus:"), true);
  assert.equal(storage.includes("statusEffectiveDate:"), true);

  const app = read("App.tsx");
  assert.equal(app.includes("ivs-refresh-state"), true);
});

test("4. CoordinatorAccounts displays both login account status and academic class_status separately", () => {
  const src = read("components/CoordinatorAccounts.tsx");
  assert.equal(src.includes("academicStatusBadge"), true);
  assert.equal(src.includes("item.student_profile?.class_status"), true);
  assert.equal(src.includes("item.student_profile?.class_status_label"), true);
  assert.equal(src.includes("CONTROLLED_DROPPED_STATUSES"), true);
  assert.equal(src.includes("ivs-refresh-state"), true);
});
