import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("1. Lanyard pauses Canvas frameloop and Physics when hidden or backgrounded", () => {
  const src = read("components/tuition/lanyard/Lanyard.tsx");
  assert.equal(src.includes("visibilitychange"), true);
  assert.equal(src.includes("const simulationActive = interactive && isPageVisible;"), true);
  assert.equal(src.includes('frameloop={simulationActive ? "always" : "never"}'), true);
  assert.equal(src.includes("paused={!simulationActive}"), true);
});

test("2. Lanyard disposes procedural ribbon CanvasTexture and optimizes Environment PMREM", () => {
  const src = read("components/tuition/lanyard/Lanyard.tsx");
  assert.equal(src.includes("processedBandTexture.dispose()"), true);
  assert.equal(src.includes("<Environment frames={1} resolution={isMobile ? 64 : 128}"), true);
});

test("3. Lanyard skips redundant MeshLine setPoints uploads when ribbon is settled", () => {
  const src = read("components/tuition/lanyard/Lanyard.tsx");
  assert.equal(src.includes("isRibbonSettled"), true);
  assert.equal(src.includes("ribbonSettledFramesRef"), true);
});

test("4. Both Student portals preserve Phase 5C-V Lanyard.css, 1800ms defer, and LazyChunkErrorBoundary", () => {
  for (const file of ["components/StudentPortal.tsx", "components/tuition/TuitionStudentPortal.tsx"]) {
    const src = read(file);
    assert.equal(src.includes("Lanyard.css"), true, `${file} must import Lanyard.css`);
    assert.equal(src.includes("1800"), true, `${file} must preserve 1800ms defer`);
    assert.equal(src.includes("LazyChunkErrorBoundary"), true, `${file} must wrap Lanyard in LazyChunkErrorBoundary`);
  }
});
