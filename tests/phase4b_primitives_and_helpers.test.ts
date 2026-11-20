import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. quranScheduleHelpers exports all extracted pure scheduling/formatting helpers", () => {
  const src = read("services/quranScheduleHelpers.ts");
  for (const sym of [
    "export const WEEKDAYS",
    "export const uuid",
    "export const getNextTimeSlot",
    "export const timeSlotToMinutes",
    "export const studentDurationMinutes",
    "export const isStudentLiveNow",
    "export const minutesUntilStudentClass",
    "export const formatTime12",
    "export const classTypeFromDayCount",
    "export const defaultDaysFromClassType",
    "export const generateStudentId",
  ]) {
    assert.equal(src.includes(sym), true, `Missing export: ${sym}`);
  }
  assert.equal(src.includes("../App"), false, "Must not introduce a circular import to App.tsx");
});

test("2. DashboardPrimitives exports all extracted presentation components without circular imports", () => {
  const src = read("components/dashboard/DashboardPrimitives.tsx");
  for (const name of [
    "TopbarClock",
    "DashboardBackdrop",
    "TwoDigitBadge",
    "SoftChip",
    "CopyPill",
    "TimePill",
    "TabLoading",
    "DepartmentWorkspaceLoading",
  ]) {
    assert.equal(src.includes(`export function ${name}(`), true, `Missing export ${name}`);
  }
  assert.equal(src.includes("../../App"), false);
  assert.equal(src.includes("../App"), false);
});

test("3. App.tsx imports extracted primitives and helpers with no duplicate definitions", () => {
  const appSrc = read("App.tsx");
  assert.equal(appSrc.includes('from "./components/dashboard/DashboardPrimitives"'), true);
  assert.equal(appSrc.includes('from "./services/quranScheduleHelpers"'), true);
  assert.equal(appSrc.includes('import IVSClockCard from "./components/IVSClockCard"'), false);
  for (const removed of [
    "function TopbarClock(",
    "function DashboardBackdrop(",
    "function TwoDigitBadge(",
    "function SoftChip(",
    "function CopyPill(",
    "function TimePill(",
    "function TabLoading(",
    "function DepartmentWorkspaceLoading(",
    "const formatTime12 =",
    "const timeSlotToMinutes =",
    "const generatePin =",
  ]) {
    assert.equal(appSrc.includes(removed), false, `Duplicate definition still in App.tsx: ${removed}`);
  }
});
