import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. Student portals lazy-load 3D Lanyard with LazyChunkErrorBoundary and deferred mount", () => {
  for (const file of [
    "components/StudentPortal.tsx",
    "components/tuition/TuitionStudentPortal.tsx",
  ]) {
    const src = read(file);
    assert.equal(src.includes("React.lazy("), true, `${file} must lazy-load Lanyard`);
    assert.equal(src.includes("LazyChunkErrorBoundary"), true, `${file} must wrap Lanyard in LazyChunkErrorBoundary`);
    assert.equal(src.includes("lanyardMounted"), true, `${file} must defer Lanyard mount until initial portal load completes`);
    assert.equal(src.includes('import Lanyard from'), false, `${file} must not statically import Lanyard`);
  }
});

test("2. TuitionCoordinatorPortal lazy-loads sub-tabs, modals, and assistant chat", () => {
  const src = read("components/tuition/TuitionCoordinatorPortal.tsx");
  for (const sym of [
    "TuitionAccountsEnrollment",
    "TuitionAttendance",
    "TuitionReports",
    "TuitionScheduling",
    "TuitionInsightsPanel",
    "TuitionDepartmentSettingsModal",
    "TuitionAssistantChat",
  ]) {
    assert.equal(src.includes(`const ${sym} = React.lazy`), true, `${sym} must be lazy-loaded`);
  }
  assert.equal(src.includes("TuitionAiAvatar"), true);
});

test("3. TuitionAiAvatar lazy-loads lottie-react", () => {
  const src = read("components/tuition/TuitionAiAvatar.tsx");
  assert.equal(src.includes('React.lazy(() => import("lottie-react"))'), true);
});

test("4. PlatformAdmin lazy-loads analytics, communications, salary approvals, and department settings", () => {
  const src = read("components/PlatformAdmin.tsx");
  for (const sym of [
    "DepartmentSettings",
    "PlatformCommunicationsPanel",
    "PlatformAnalyticsOverview",
    "PlatformSalaryApprovals",
  ]) {
    assert.equal(src.includes(`const ${sym} = React.lazy`), true, `${sym} must be lazy-loaded`);
  }
});

test("5. TeacherPortal lazy-loads TeacherSalarySelfService", () => {
  const src = read("components/TeacherPortal.tsx");
  assert.equal(src.includes('const TeacherSalarySelfService = React.lazy'), true);
});
