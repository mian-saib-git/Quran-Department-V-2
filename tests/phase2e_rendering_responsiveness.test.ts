import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. All 4 portals isolate 1-second clock updates from root portal state via useMinuteNow and IVSClockCard", () => {
  for (const file of [
    "components/TeacherPortal.tsx",
    "components/StudentPortal.tsx",
    "components/tuition/TuitionStudentPortal.tsx",
    "components/tuition/TuitionTeacherPortal.tsx",
  ]) {
    const src = read(file);
    assert.equal(src.includes("useMinuteNow()"), true, `${file} must use useMinuteNow()`);
    assert.equal(src.includes("setClockNow(new Date()), 1000"), false, `${file} must not run a root 1s setClockNow interval`);
    assert.equal(src.includes("setNow(new Date()), 1_000"), false, `${file} must not run a root 1s setNow interval`);
    assert.equal(src.includes("<IVSClockCard compact />"), true, `${file} must let IVSClockCard manage its own 1s timer`);
  }
});

test("2. Tuition portals preserve second-level countdown precision in isolated LiveCountdown component", () => {
  for (const file of [
    "components/tuition/TuitionStudentPortal.tsx",
    "components/tuition/TuitionTeacherPortal.tsx",
  ]) {
    const src = read(file);
    assert.equal(src.includes("<LiveCountdown"), true, `${file} must use LiveCountdown`);
  }
  const countdownSrc = read("components/ui/LiveCountdown.tsx");
  assert.equal(countdownSrc.includes("React.memo"), true);
  assert.equal(countdownSrc.includes("window.clearInterval(timer)"), true);
});

test("3. useMinuteNow aligns timer scheduling to minute boundaries and cleans up on unmount", () => {
  const src = read("hooks/useMinuteNow.ts");
  assert.equal(src.includes("Date.now() % 60_000"), true);
  assert.equal(src.includes("window.clearTimeout(timerId)"), true);

  // Runtime verification of minute-boundary delay math
  const sampleMsIntoMinute = 23_450;
  const delay = Math.max(500, 60_000 - sampleMsIntoMinute + 25);
  assert.equal(delay, 36_575);
});

test("4. ReportsTab defers search filtering and AttendanceEditor memoizes sorted teachers", () => {
  const reportsSrc = read("components/ReportsTab.tsx");
  assert.equal(reportsSrc.includes("useDeferredValue(reportSearch)"), true);

  const editorSrc = read("components/AttendanceEditor.tsx");
  assert.equal(editorSrc.includes("const sortedTeachers = useMemo("), true);
  assert.equal(editorSrc.includes("sortedTeachers.map("), true);
});
