import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. TeacherPortal separates core dashboard polling from secondary lesson/auth fetches", () => {
  const src = read("components/TeacherPortal.tsx");
  assert.equal(src.includes("useVisibilityPolling("), true);
  assert.equal(src.includes("12000"), false, "Legacy 12s polling interval must be removed");
  assert.equal(src.includes("coreInFlightRef"), true, "Must guard against overlapping core refreshes");
  assert.equal(src.includes("loadCoreDashboard"), true);
  assert.equal(src.includes("loadSecondaryLessons"), true);
  assert.equal(src.includes("loadAuthFeatures"), true);
  assert.equal(src.includes("Boolean((data as any).isReconnect)"), true);
});

test("2. StudentPortal and Tuition portals avoid duplicate initial WS connected reloads and use visibility polling", () => {
  for (const file of [
    "components/StudentPortal.tsx",
    "components/tuition/TuitionStudentPortal.tsx",
    "components/tuition/TuitionTeacherPortal.tsx",
  ]) {
    const src = read(file);
    assert.equal(src.includes("useVisibilityPolling("), true, `${file} must use useVisibilityPolling`);
    assert.equal(src.includes("inFlightRef"), true, `${file} must guard against overlapping refreshes`);
    assert.equal(src.includes("Boolean(event?.isReconnect)"), true, `${file} must only reload on WS reconnect, not initial connect`);
    assert.equal(src.includes('type === "connected" ||'), false, `${file} must not unconditionally reload on initial WS connected`);
  }
});

test("3. NotificationBell reuses shared useAcademyWS instead of opening a second WebSocket", () => {
  const src = read("components/NotificationBell.tsx");
  assert.equal(src.includes("new WebSocket("), false, "NotificationBell must not open a duplicate WebSocket");
  assert.equal(src.includes("useAcademyWS("), true);
  assert.equal(src.includes("useVisibilityPolling("), true);
});

test("4. useAcademyWS tracks isReconnect and exposes connection status subscribers", () => {
  const src = read("hooks/useAcademyWS.ts");
  assert.equal(src.includes("export function isAcademyWSConnected()"), true);
  assert.equal(src.includes("export function subscribeAcademyWSStatus("), true);
  assert.equal(src.includes("isReconnect: hasConnectedOnce"), true);
});

test("5. useVisibilityPolling pauses on hidden tabs, revalidates on visible, prevents overlap, and cleans up", () => {
  const src = read("hooks/useVisibilityPolling.ts");
  assert.equal(src.includes('document.visibilityState === "hidden"'), true);
  assert.equal(src.includes("inFlightRef.current"), true);
  assert.equal(src.includes('document.addEventListener("visibilitychange"'), true);
  assert.equal(src.includes('document.removeEventListener("visibilitychange"'), true);
  assert.equal(src.includes("window.clearInterval(timerId)"), true);
});

test("6. useCompleteAttendance preserves cached rows when enabled toggles across tab switches", () => {
  const src = read("hooks/useCompleteAttendance.ts");
  assert.equal(src.includes("loadedKeyRef.current === requestKey"), true);
  assert.equal(src.includes("loadedKeyRef.current = \"\""), true, "reload() must still clear loadedKeyRef");
});

test("7. App.tsx skips /api/academy/state/ for teacher, student, and tuition roles", () => {
  const src = read("App.tsx");
  assert.equal(src.includes('if (!isDashboardRole || sessionDepartmentType === "tuition")'), true);
  assert.equal(src.includes("useVisibilityPolling("), true);
});
