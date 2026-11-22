import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { filterSubstituteTeachers } from "../services/substituteSearch.ts";

const cwd = process.cwd();

test("1. filterSubstituteTeachers matches by teacher name and ID", () => {
  const teachers = [
    { id: 12, name: "Qari Ahmad" },
    { id: 45, name: "Ustadh Bilal" },
    { id: 120, name: "Hafiz Salman" },
  ];

  assert.deepEqual(
    filterSubstituteTeachers(teachers, "").map((t) => t.id),
    [12, 45, 120],
  );

  assert.deepEqual(
    filterSubstituteTeachers(teachers, "bilal").map((t) => t.id),
    [45],
  );

  assert.deepEqual(
    filterSubstituteTeachers(teachers, "12").map((t) => t.id),
    [12, 120],
  );

  assert.deepEqual(
    filterSubstituteTeachers(teachers, "#45").map((t) => t.id),
    [45],
  );

  assert.deepEqual(
    filterSubstituteTeachers(teachers, "id:120").map((t) => t.id),
    [120],
  );

  assert.deepEqual(filterSubstituteTeachers(teachers, "nonexistent"), []);
});

test("2. filterSubstituteTeachers handles large teacher lists without Busy/Available grouping", () => {
  const largeRoster = Array.from({ length: 250 }, (_, idx) => ({
    id: idx + 1,
    name: `Teacher ${idx + 1}`,
  }));

  const matches = filterSubstituteTeachers(largeRoster, "249");
  assert.deepEqual(matches, [{ id: 249, name: "Teacher 249" }]);
});

test("3. AttendanceEditor and ClassCard both use SubstituteTeacherSelect without legacy <select> or Busy/Available categories", () => {
  const editorSource = fs.readFileSync(
    path.join(cwd, "components", "AttendanceEditor.tsx"),
    "utf8",
  );
  const classCardSource = fs.readFileSync(
    path.join(cwd, "components", "ClassCard.tsx"),
    "utf8",
  );
  const selectSource = fs.readFileSync(
    path.join(cwd, "components", "SubstituteTeacherSelect.tsx"),
    "utf8",
  );

  assert.equal(editorSource.includes("<SubstituteTeacherSelect"), true);
  assert.equal(classCardSource.includes("<SubstituteTeacherSelect"), true);
  assert.equal(editorSource.includes("available_substitutes.map"), false);
  assert.equal(classCardSource.includes("available_substitutes.map"), false);

  assert.equal(selectSource.includes("Busy"), false);
  assert.equal(selectSource.includes("Available"), false);
  assert.equal(selectSource.includes('role="combobox"'), true);
  assert.equal(selectSource.includes('role="listbox"'), true);
  assert.equal(selectSource.includes("Clear substitute teacher selection"), true);
});
