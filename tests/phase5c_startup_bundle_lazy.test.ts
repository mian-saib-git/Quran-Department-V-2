import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";

const appSrc = fs.readFileSync(path.join(process.cwd(), "App.tsx"), "utf8");
const portalSrc = fs.readFileSync(path.join(process.cwd(), "components/QuranCoordinatorPortal.tsx"), "utf8");

test("1. App.tsx and QuranCoordinatorPortal lazy-load Coordinator portal, dashboard sections, and conditional screens/modals", () => {
  assert.equal(appSrc.includes('import("./components/QuranCoordinatorPortal")'), true);
  assert.equal(/import\s+(?!type\b).*from\s+"\.\/components\/QuranCoordinatorPortal"/.test(appSrc), false);
  for (const mod of [
    "./dashboard/CoordinatorDashboardKpis",
    "./dashboard/CoordinatorLiveClassesSection",
    "./dashboard/CoordinatorDashboardInsights",
  ]) {
    assert.equal(portalSrc.includes(`import("${mod}")`), true, `Expected lazy import for ${mod}`);
    assert.equal(portalSrc.includes(`from "${mod}"`), false, `Unexpected eager import for ${mod}`);
  }
  for (const mod of [
    "./components/FeatureLockedModal",
    "./components/MaintenanceScreen",
    "./components/GlobalNoticeCenter",
  ]) {
    assert.equal(appSrc.includes(`import("${mod}")`), true, `Expected lazy import for ${mod}`);
    assert.equal(appSrc.includes(`from "${mod}"`), false, `Unexpected eager import for ${mod}`);
  }
});

test("2. Conditional modals and notices are gated behind state checks inside Suspense", () => {
  assert.equal(appSrc.includes("{lockedFeature && ("), true);
  assert.equal(appSrc.includes("{platformNotices.length > 0 && ("), true);
});

test("3. Entry bundle (index.tsx) excludes lazy-split Coordinator and conditional modules", () => {
  const res = esbuild.buildSync({
    entryPoints: [path.join(process.cwd(), "index.tsx")],
    bundle: true,
    splitting: true,
    format: "esm",
    outdir: "out_test_5c",
    minify: true,
    metafile: true,
    write: false,
    loader: { ".glb": "file", ".css": "empty" },
  });

  const entryOut = Object.entries(res.metafile.outputs).find(([k]) => k.endsWith("index.js"));
  assert.ok(entryOut, "Expected index.js entry output");
  const entryInputs = Object.keys(entryOut[1].inputs).map((p) => p.replace(/\\/g, "/"));

  for (const excluded of [
    "components/ClassCard.tsx",
    "components/dashboard/CoordinatorDashboardInsights.tsx",
    "components/dashboard/CoordinatorDashboardKpis.tsx",
    "components/dashboard/CoordinatorLiveClassesSection.tsx",
    "components/MaintenanceScreen.tsx",
    "components/FeatureLockedModal.tsx",
    "components/GlobalNoticeCenter.tsx",
  ]) {
    assert.equal(
      entryInputs.some((p) => p.endsWith(excluded)),
      false,
      `${excluded} must not be bundled into synchronous index.js`
    );
  }
});
