import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as esbuild from "esbuild";
import type { AppState, Student, Teacher } from "../types.ts";

let schedulingMod: any = null;

async function loadSchedulingTabModule() {
  if (!schedulingMod) {
    const res = esbuild.buildSync({
      stdin: {
        contents: `
          export * from "./components/SchedulingTab.tsx";
          export { TIME_SLOTS } from "./constants";
          export { ClassType } from "./types";
        `,
        resolveDir: process.cwd(),
        loader: "ts",
      },
      bundle: true,
      write: false,
      format: "cjs",
      platform: "node",
      external: ["react", "react-dom", "lucide-react"],
    });
    const req = createRequire(import.meta.url);
    const mod = { exports: {} as any };
    const fn = new Function("require", "module", "exports", res.outputFiles[0].text);
    fn(req, mod, mod.exports);
    schedulingMod = mod.exports;
  }
  return schedulingMod;
}

function makeTeachers(count: number): Teacher[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `T${i + 1}`,
    name: `${String(i + 1).padStart(2, "0")} Teacher ${i + 1}`,
    phone: "000",
    hourlyRate: 10,
    joinDate: "2026-01-01",
    status: "active",
  }));
}

function makeStudents(count: number, teachers: Teacher[], timeSlots: string[], fiveDay: any): Student[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `S${100000 + i}`,
    name: `Student ${i + 1}`,
    parentName: `Parent ${i + 1}`,
    parentPhone: "000",
    teacherId: teachers[i % teachers.length].id,
    timeSlot: timeSlots[i % timeSlots.length],
    classType: fiveDay,
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    monthlyFee: 50,
    status: "active",
  }));
}

test("1. Horizontal windowing conserves total column width across 0, start, middle, and clamped end", async () => {
  const { computeHorizontalRange, TEACHER_COL_WIDTH } = await loadSchedulingTabModule();
  const empty = computeHorizontalRange(0, 1280, 0);
  assert.equal(empty.endCol, -1);
  assert.equal(empty.leftSpacerWidth, 0);
  assert.equal(empty.rightSpacerWidth, 0);

  const totalCols = 80;
  for (const scrollLeft of [0, 1400, 9500, 999999]) {
    const r = computeHorizontalRange(scrollLeft, 1280, totalCols);
    assert.ok(r.startCol >= 0 && r.startCol <= r.endCol && r.endCol < totalCols);
    const visibleCount = r.endCol - r.startCol + 1;
    assert.equal(
      r.leftSpacerWidth + visibleCount * TEACHER_COL_WIDTH + r.rightSpacerWidth,
      totalCols * TEACHER_COL_WIDTH
    );
  }
});

test("2. Vertical windowing conserves total row height across variable-height slots", async () => {
  const { computeVerticalRange, estimateSlotRowHeight, TIME_SLOTS } = await loadSchedulingTabModule();
  const rowHeights = TIME_SLOTS.map((_: string, i: number) => estimateSlotRowHeight(i % 4));
  const totalHeight = rowHeights.reduce((a, b) => a + b, 0);

  for (const scrollTop of [0, 1200, 3500, 999999]) {
    const r = computeVerticalRange(scrollTop, 640, rowHeights);
    assert.ok(r.startRow >= 0 && r.startRow <= r.endRow && r.endRow < rowHeights.length);
    let visibleHeight = 0;
    for (let i = r.startRow; i <= r.endRow; i++) visibleHeight += rowHeights[i];
    assert.equal(r.topSpacerHeight + visibleHeight + r.bottomSpacerHeight, totalHeight);
  }
});

test("3. SchedulingTab renders empty dataset cleanly without crashing", async () => {
  const { SchedulingTab } = await loadSchedulingTabModule();
  const emptyState: AppState = { teachers: [], students: [], attendance: [] };
  const html = renderToStaticMarkup(
    React.createElement(SchedulingTab, {
      appState: emptyState,
      onCellClick: () => {},
    })
  );
  assert.ok(html.includes("Class Schedule Matrix"));
  assert.ok(html.includes("TIME"));
  assert.ok(html.includes(">0<"));
});

test("4. SchedulingTab renders windowed subset for 1,000 students and 80 teachers while preserving totals", async () => {
  const { SchedulingTab, TIME_SLOTS, ClassType } = await loadSchedulingTabModule();
  const teachers = makeTeachers(80);
  const students = makeStudents(1000, teachers, TIME_SLOTS, ClassType.FIVE_DAY);
  const state: AppState = { teachers, students, attendance: [] };

  const html = renderToStaticMarkup(
    React.createElement(SchedulingTab, {
      appState: state,
      onCellClick: () => {},
    })
  );

  // Preserves total student count badge
  assert.ok(html.includes(">1000<"));
  // Preserves first teacher header and first time slot
  assert.ok(html.includes("Teacher 1"));
  assert.ok(html.includes("12:00 AM"));
  // Does NOT render all 80 teacher columns or all 48 time slots into initial DOM
  assert.equal(html.includes("Teacher 80"), false);
  assert.equal(html.includes("11:30 PM"), false);

  const renderedCellCount = (html.match(/<td\b/g) || []).length;
  assert.ok(
    renderedCellCount > 20 && renderedCellCount < 250,
    `Expected windowed <td> count between 20 and 250, got ${renderedCellCount}`
  );
});

test("5. SchedulingTab preserves stable empty-array reference, callback ref, and zero new dependencies", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "components/SchedulingTab.tsx"), "utf8");
  assert.ok(src.includes("EMPTY_STUDENTS"));
  assert.ok(src.includes("onCellClickRef"));
  assert.ok(src.includes("requestAnimationFrame"));

  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(pkg.dependencies["@tanstack/react-virtual"], undefined);
  assert.equal(pkg.dependencies["react-window"], undefined);
  assert.equal(pkg.dependencies["react-virtualized"], undefined);
});

test("6. Out-of-bounds scrollTop clamps to bottom window without rendering all 48 rows", async () => {
  const { computeVerticalRange, estimateSlotRowHeight } = await loadSchedulingTabModule();
  const rowHeights = Array.from({ length: 48 }, (_, i) => estimateSlotRowHeight(i % 4));
  const r = computeVerticalRange(999999, 640, rowHeights);
  assert.equal(r.endRow, 47);
  assert.ok(r.startRow > 30, `Expected startRow near bottom (>30), got ${r.startRow}`);
});

test("7. SchedulingTab cleans up ResizeObserver and pending rAF on unmount and preserves row measurements across student updates", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "components/SchedulingTab.tsx"), "utf8");
  assert.ok(src.includes("ro.disconnect()"));
  assert.ok(src.includes("cancelAnimationFrame(rafIdRef.current)"));
  // Must NOT wipe measuredRowHeightsRef.current = {} on [students] update (prevents scrollTop jump)
  assert.equal(src.includes("measuredRowHeightsRef.current = {}"), false);
});
