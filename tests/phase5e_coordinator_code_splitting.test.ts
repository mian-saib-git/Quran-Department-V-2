import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("1. App.tsx lazy-loads QuranCoordinatorPortal below the React import", () => {
  const appSrc = read("App.tsx");
  const reactImportIdx = appSrc.indexOf('from "react";');
  const lazyIdx = appSrc.indexOf('const QuranCoordinatorPortal = lazy(() => import("./components/QuranCoordinatorPortal"))');
  assert.ok(reactImportIdx > 0, "React import must exist");
  assert.ok(lazyIdx > reactImportIdx, "QuranCoordinatorPortal lazy() must appear after React import");
  assert.equal(/import\s+(?!type\b).*from\s+"\.\/components\/QuranCoordinatorPortal"/.test(appSrc), false);
});

test("2. QuranCoordinatorPortal.tsx has no circular import, no duplicate state-fetching/WS, and safe lazy ordering", () => {
  const portalSrc = read("components/QuranCoordinatorPortal.tsx");
  const reactImportIdx = portalSrc.indexOf('from "react";');
  const firstLazyIdx = portalSrc.indexOf("lazy(");
  assert.ok(reactImportIdx > 0 && firstLazyIdx > reactImportIdx, "React import must precede lazy() calls");
  assert.equal(portalSrc.includes("../App"), false, "Must not import App.tsx");
  assert.equal(portalSrc.includes("useAcademyWS"), false, "Must not open duplicate WebSocket subscriptions");
  assert.equal(portalSrc.includes("loadState("), false, "Must not duplicate academy state loading");
});

test("3. Entry bundle (index.tsx) excludes QuranCoordinatorPortal and Coordinator-only modules", () => {
  const res = esbuild.buildSync({
    entryPoints: [path.join(ROOT, "index.tsx")],
    bundle: true,
    splitting: true,
    format: "esm",
    outdir: "out_test_5e",
    minify: true,
    metafile: true,
    write: false,
    loader: { ".glb": "file", ".css": "empty" },
  });

  const entryOut = Object.entries(res.metafile.outputs).find(([k]) => k.endsWith("index.js"));
  assert.ok(entryOut, "Expected index.js entry output");
  const entryInputs = Object.keys(entryOut[1].inputs).map((p) => p.replace(/\\/g, "/"));

  for (const excluded of [
    "components/QuranCoordinatorPortal.tsx",
    "components/NotificationBell.tsx",
    "components/ui/SkeletonLoaders.tsx",
    "components/SchedulingTab.tsx",
    "components/AttendanceEditor.tsx",
    "components/CoordinatorAccounts.tsx",
    "components/ReportsTab.tsx",
  ]) {
    assert.equal(
      entryInputs.some((p) => p.endsWith(excluded)),
      false,
      `${excluded} must be excluded from synchronous entry index.js`
    );
  }
});

test("4. App.tsx preserves authoritative role and department routing before QuranCoordinatorPortal", () => {
  const appSrc = read("App.tsx");
  assert.equal(appSrc.includes("if (!session) {"), true);
  assert.equal(appSrc.includes("if (isPlatformAdmin) {"), true);
  assert.equal(appSrc.includes('effectiveDepartmentRole === "teacher"'), true);
  assert.equal(appSrc.includes('effectiveDepartmentRole === "student"'), true);
  assert.equal(appSrc.includes("isTuitionDepartment"), true);
});
