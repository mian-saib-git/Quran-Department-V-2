import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. Lanyard.css keeps lanyard z-index below drawers/modals and reserves non-overlapping desktop/mobile stages", () => {
  const css = read("components/tuition/lanyard/Lanyard.css");
  assert.equal(css.includes("z-index: 70"), false, "Lanyard must not use z-index: 70 above drawers/modals");
  assert.equal(css.includes("z-index: 20;"), true);
  assert.equal(css.includes("width: 270px;"), true);
  assert.equal(css.includes("padding-right: 302px !important;"), true);
  assert.equal(css.includes("padding-top: 268px !important;"), true);
  assert.equal(css.includes("pointer-events: none;"), true);
});

test("2. StudentPortal isolates main stacking context, elevates topbar, and reserves lanyard stage padding", () => {
  const src = read("components/StudentPortal.tsx");
  assert.equal(src.includes('ref={portalSurfaceRef} className="relative isolate z-0'), true);
  assert.equal(src.includes("sp-topbar relative z-30"), true);
  assert.equal(src.includes('${studentCardVisible ? "lanyard-stage-active" : ""}'), true);
});

test("3. TuitionStudentPortal isolates lanyard container, elevates header, and reserves lanyard stage padding", () => {
  const src = read("components/tuition/TuitionStudentPortal.tsx");
  assert.equal(src.includes('ref={portalSurfaceRef} className="relative isolate z-0'), true);
  assert.equal(src.includes('<header className="z-30'), true);
  assert.equal(src.includes('${studentCardVisible ? "lanyard-stage-active" : ""}'), true);
});

test("4. Lanyard.tsx computes pointer NDC from canvas bounds for accurate dragging in docked stage", () => {
  const src = read("components/tuition/lanyard/Lanyard.tsx");
  assert.equal(
    src.includes("const source = currentState.gl.domElement || eventSource?.current;"),
    true
  );
});

test("5. Phase 2D lazy-loading and error boundary integration for Lanyard remain intact", () => {
  for (const file of [
    "components/StudentPortal.tsx",
    "components/tuition/TuitionStudentPortal.tsx",
  ]) {
    const src = read(file);
    assert.equal(src.includes("React.lazy("), true, `${file} must keep React.lazy for Lanyard`);
    assert.equal(src.includes("LazyChunkErrorBoundary"), true, `${file} must keep LazyChunkErrorBoundary`);
    assert.equal(src.includes("React.Suspense"), true, `${file} must keep React.Suspense`);
    assert.equal(src.includes("lanyardMounted"), true, `${file} must keep deferred lanyardMounted`);
  }
});
