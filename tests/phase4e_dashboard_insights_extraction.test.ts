import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. CoordinatorDashboardInsights preserves Insights, Today's Attendance, Timeline, and popup behavior without side effects", () => {
  const src = read("components/dashboard/CoordinatorDashboardInsights.tsx");

  assert.equal(src.includes("export const CoordinatorDashboardInsights"), true);
  assert.equal(
    src.includes('lazy(() => import("../DashboardTimelineChart"))'),
    true,
    "Must lazy-load DashboardTimelineChart"
  );

  // Collapsible details + header
  assert.equal(src.includes("<details"), true);
  assert.equal(src.includes("Insights"), true);
  assert.equal(src.includes("Attendance snapshot + timeline"), true);
  assert.equal(src.includes("Click to open"), true);

  // Today's Attendance summary (Teachers & Students P/A/L/U)
  assert.equal(src.includes("Today’s Attendance"), true);
  assert.equal(src.includes("Teachers + Students summary"), true);
  assert.equal(src.includes("todayAttendanceSummary.teachers.present"), true);
  assert.equal(src.includes("todayAttendanceSummary.teachers.absent"), true);
  assert.equal(src.includes("todayAttendanceSummary.teachers.leave"), true);
  assert.equal(src.includes("todayAttendanceSummary.teachers.unmarked"), true);
  assert.equal(src.includes("todayAttendanceSummary.students.present"), true);
  assert.equal(src.includes("todayAttendanceSummary.students.absent"), true);
  assert.equal(src.includes("todayAttendanceSummary.students.leave"), true);
  assert.equal(src.includes("todayAttendanceSummary.students.unmarked"), true);
  assert.equal(src.includes("P = Present, A = Absent, L = Leave, U = Unmarked"), true);

  // Timeline empty state, chart integration, and hover/pinned popup
  assert.equal(src.includes("Timeline Today"), true);
  assert.equal(src.includes("Now: {formatTime12(currentSlot)}"), true);
  assert.equal(src.includes("No classes found for today"), true);
  assert.equal(src.includes("<DashboardTimelineChart"), true);
  assert.equal(src.includes("timelinePopup.pinned"), true);
  assert.equal(src.includes("Pinned. Scroll this list."), true);
  assert.equal(src.includes("Click this bar to pin"), true);
  assert.equal(src.includes("No classes in this slot."), true);

  // No side effects, no network/WS subscriptions, no circular import
  assert.equal(src.includes("useEffect("), false, "Insights component must not introduce effects");
  assert.equal(src.includes("fetch("), false, "Insights component must not introduce API calls");
  assert.equal(src.includes("WebSocket"), false, "Insights component must not open WebSocket connections");
  assert.equal(src.includes("useAcademyWS"), false, "Insights component must not subscribe to WebSockets");
  assert.equal(src.includes("../../App"), false, "Must not introduce a circular import to App.tsx");
});

test("2. QuranCoordinatorPortal delegates Insights and Timeline to CoordinatorDashboardInsights without duplicate JSX", () => {
  const portalSrc = read("components/QuranCoordinatorPortal.tsx");
  const appSrc = read("App.tsx");

  assert.equal(
    portalSrc.includes('import("./dashboard/CoordinatorDashboardInsights")'),
    true
  );
  assert.equal(portalSrc.includes("<CoordinatorDashboardInsights"), true);

  // Authoritative attendance summary lives in QuranCoordinatorPortal
  assert.equal(portalSrc.includes("const todayAttendanceSummary = useMemo("), true);

  // Duplicate inline Insights / Timeline / Popup state & JSX removed from both
  assert.equal(appSrc.includes("DashboardTimelineChart"), false, "DashboardTimelineChart must not remain in App.tsx");
  assert.equal(portalSrc.includes("DashboardTimelineChart"), false, "DashboardTimelineChart must not remain in QuranCoordinatorPortal.tsx");
  assert.equal(portalSrc.includes("insightsOpen"), false, "insightsOpen state must be removed");
  assert.equal(portalSrc.includes("timelinePopup"), false, "timelinePopup state must be removed");
  assert.equal(portalSrc.includes("timelineCardRef"), false, "timelineCardRef must be removed");
  assert.equal(portalSrc.includes("Today’s Attendance"), false, "Duplicate Today's Attendance JSX must be removed");
  assert.equal(portalSrc.includes("Timeline Today"), false, "Duplicate Timeline Today JSX must be removed");
});
