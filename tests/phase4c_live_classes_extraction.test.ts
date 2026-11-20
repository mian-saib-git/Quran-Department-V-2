import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. CoordinatorLiveClassesSection owns Live Now and Up Next presentation without side effects", () => {
  const src = read("components/dashboard/CoordinatorLiveClassesSection.tsx");
  assert.equal(src.includes("export const CoordinatorLiveClassesSection"), true);
  assert.equal(src.includes("Live Now"), true);
  assert.equal(src.includes("Up Next"), true);
  assert.equal(src.includes("No classes scheduled for {formatTime12(currentSlot)}"), true);
  assert.equal(src.includes("No classes scheduled for {formatTime12(nextSlot)}"), true);
  assert.equal(src.includes("isCurrentSession={isCurrentSession}"), true);
  assert.equal(src.includes("useEffect("), false, "Presentation component must not introduce effects");
  assert.equal(src.includes("useState("), false, "Presentation component must not introduce local state");
  assert.equal(src.includes("../../App"), false, "Must not introduce a circular import to App.tsx");
});

test("2. QuranCoordinatorPortal renders CoordinatorLiveClassesSection and removes duplicate inline Live Now / Up Next JSX", () => {
  const portalSrc = read("components/QuranCoordinatorPortal.tsx");
  const appSrc = read("App.tsx");
  assert.equal(
    portalSrc.includes('import("./dashboard/CoordinatorLiveClassesSection")'),
    true
  );
  assert.equal(portalSrc.includes("<CoordinatorLiveClassesSection"), true);
  assert.equal(appSrc.includes('from "./components/ClassCard"'), false, "Unused ClassCard import must be removed from App.tsx");
  assert.equal(portalSrc.includes("No classes scheduled for {formatTime12(currentSlot)}"), false, "Duplicate Live Now empty state must be removed");
  assert.equal(portalSrc.includes("No classes scheduled for {formatTime12(nextSlot)}"), false, "Duplicate Up Next empty state must be removed");
  assert.equal(portalSrc.includes("<ClassCard"), false, "Duplicate ClassCard rendering must be removed");
});
