import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("1. Lanyard.css scopes desktop 302px reservation to Quran scroll or Tuition top-reserve", () => {
  const css = read("components/tuition/lanyard/Lanyard.css");
  assert.equal(css.includes(".sp-page-scroll.lanyard-stage-active"), true);
  assert.equal(css.includes(".student-portal-scroll.lanyard-stage-active .tuition-lanyard-top-reserve"), true);
});

test("2. TuitionStudentPortal applies tuition-lanyard-top-reserve to top sections and stacks SpotlightCards below 2xl", () => {
  const src = read("components/tuition/TuitionStudentPortal.tsx");
  assert.equal(src.includes("tuition-lanyard-top-reserve relative z-0 grid gap-4 2xl:grid-cols-2"), true);
  assert.equal(src.includes("tuition-lanyard-top-reserve grid gap-4 2xl:grid-cols-2"), true);
  assert.equal(src.includes("tuition-lanyard-top-reserve grid gap-4 sm:grid-cols-2 2xl:grid-cols-4"), true);
});

test("3. ScheduleCard prevents narrow teacher/date overlap and truncation", () => {
  const src = read("components/tuition/TuitionStudentPortal.tsx");
  assert.equal(src.includes("flex flex-wrap items-center gap-x-4 gap-y-2"), true);
  assert.equal(src.includes("break-words text-base font-black"), true);
});
