import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. CoordinatorDashboardKpis renders all 4 KPI cards without side effects or circular imports", () => {
  const src = read("components/dashboard/CoordinatorDashboardKpis.tsx");
  assert.equal(src.includes("export const CoordinatorDashboardKpis"), true);
  for (const label of ["Students", "Teachers", "Live Now", "Up Next"]) {
    assert.equal(src.includes(label), true, `Missing KPI label: ${label}`);
  }
  assert.equal(src.includes("{studentsCount}"), true);
  assert.equal(src.includes("{teachersCount}"), true);
  assert.equal(src.includes("{liveNowCount}"), true);
  assert.equal(src.includes("{upNextCount}"), true);
  assert.equal(src.includes("{formatTime12(currentSlot)}"), true);
  assert.equal(src.includes("{formatTime12(nextSlot)}"), true);
  assert.equal(src.includes("<DashboardBackdrop />"), true);
  assert.equal(src.includes("useEffect("), false, "Presentation component must not introduce effects");
  assert.equal(src.includes("useState("), false, "Presentation component must not introduce local state");
  assert.equal(src.includes("../../App"), false, "Must not introduce a circular import to App.tsx");
});

test("2. QuranCoordinatorPortal delegates KPI Summary Cards to CoordinatorDashboardKpis without duplicate JSX", () => {
  const portalSrc = read("components/QuranCoordinatorPortal.tsx");
  const appSrc = read("App.tsx");
  assert.equal(
    portalSrc.includes('import("./dashboard/CoordinatorDashboardKpis")'),
    true
  );
  assert.equal(portalSrc.includes("<CoordinatorDashboardKpis"), true);
  assert.equal(appSrc.includes("DashboardBackdrop"), false, "Unused DashboardBackdrop import must be removed from App.tsx");
  assert.equal(appSrc.includes("<Users "), false, "Unused Users icon must be removed from App.tsx");
  assert.equal(portalSrc.includes("text-emerald-600 mt-1"), false, "Duplicate Students KPI card must be removed");
  assert.equal(portalSrc.includes("text-blue-600 mt-1"), false, "Duplicate Teachers KPI card must be removed");
});
