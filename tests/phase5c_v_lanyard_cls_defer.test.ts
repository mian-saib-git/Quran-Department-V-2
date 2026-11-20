import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. StudentPortal and TuitionStudentPortal import Lanyard.css eagerly to prevent CLS", () => {
  const quranSrc = read("components/StudentPortal.tsx");
  const tuitionSrc = read("components/tuition/TuitionStudentPortal.tsx");

  assert.equal(quranSrc.includes('import "./tuition/lanyard/Lanyard.css";'), true);
  assert.equal(tuitionSrc.includes('import "./lanyard/Lanyard.css";'), true);
});

test("2. Both student portals defer Lanyard mount cleanly and mount immediately on explicit toggle", () => {
  for (const file of [
    "components/StudentPortal.tsx",
    "components/tuition/TuitionStudentPortal.tsx",
  ]) {
    const src = read(file);
    assert.equal(src.includes("window.setTimeout(() => setLanyardMounted(true), 1800)"), true, file);
    assert.equal(src.includes("if (next && !lanyardMounted) setLanyardMounted(true);"), true, file);
  }
});
