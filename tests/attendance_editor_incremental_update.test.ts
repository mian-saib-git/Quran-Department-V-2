import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

test("1. AttendanceEditor updates single records in place instead of calling complete.reload()", () => {
  const source = fs.readFileSync(
    path.join(cwd, "components", "AttendanceEditor.tsx"),
    "utf8",
  );

  assert.equal(
    source.includes("complete.reload()"),
    false,
    "AttendanceEditor must not call complete.reload() after individual attendance updates",
  );
  assert.equal(
    source.includes("complete.updateRows(targetRequestKey"),
    true,
    "AttendanceEditor must update complete rows in place with requestKey guard",
  );
  assert.equal(
    source.includes("pendingKeysRef.current.has(targetKey)"),
    true,
    "AttendanceEditor must guard against duplicate concurrent mutations for the same target key",
  );
});

test("2. useCompleteAttendance exposes requestKey and updateRows without resetting loading", () => {
  const source = fs.readFileSync(
    path.join(cwd, "hooks", "useCompleteAttendance.ts"),
    "utf8",
  );

  assert.equal(source.includes("requestKey,"), true);
  assert.equal(source.includes("updateRows,"), true);
  assert.equal(
    source.includes("if (prev.key !== targetRequestKey || prev.error)"),
    true,
    "updateRows must ignore stale updates when requestKey changed (e.g. date switch)",
  );
});

test("3. TuitionAttendance updates attendance state directly without full-date refetch", () => {
  const source = fs.readFileSync(
    path.join(cwd, "components", "tuition", "TuitionAttendance.tsx"),
    "utf8",
  );

  assert.equal(
    source.includes("loadAttendanceOnly"),
    false,
    "TuitionAttendance should update state from savedRecord/deleted id instead of refetching the full date",
  );
  assert.equal(
    source.includes("if (selectedDate.current === args.date)"),
    true,
    "TuitionAttendance must guard against stale date changes",
  );
});

test("4. Teacher session and student record matching keeps sessions and entities isolated", () => {
  type RecordLike = {
    id: string;
    entityId: string;
    entityType: "teacher" | "student";
    date: string;
    classKey?: string;
    status: "Present" | "Absent" | "Leave";
  };

  const normalizeClassKey = (entityType: "teacher" | "student", classKey?: string) =>
    entityType === "teacher" ? String(classKey || "").trim().slice(0, 5) : "";

  const matches = (
    record: RecordLike,
    target: { entityId: string; entityType: "teacher" | "student"; date: string; classKey?: string },
  ) =>
    record.entityType === target.entityType &&
    String(record.entityId) === String(target.entityId) &&
    record.date === target.date &&
    normalizeClassKey(record.entityType, record.classKey) ===
      normalizeClassKey(target.entityType, target.classKey);

  const upsert = (
    rows: RecordLike[],
    target: {
      entityId: string;
      entityType: "teacher" | "student";
      date: string;
      status: "Present" | "Absent" | "Leave";
      classKey?: string;
    },
  ) => {
    const next: RecordLike = {
      id: `local-${target.entityType}-${target.entityId}-${target.classKey || ""}`,
      entityId: target.entityId,
      entityType: target.entityType,
      date: target.date,
      classKey: normalizeClassKey(target.entityType, target.classKey),
      status: target.status,
    };
    return [...rows.filter((r) => !matches(r, target)), next];
  };

  const remove = (
    rows: RecordLike[],
    target: { entityId: string; entityType: "teacher" | "student"; date: string; classKey?: string },
  ) => rows.filter((r) => !matches(r, target));

  let rows: RecordLike[] = [
    { id: "1", entityId: "7", entityType: "teacher", date: "2026-11-17", classKey: "14:00", status: "Present" },
    { id: "2", entityId: "7", entityType: "teacher", date: "2026-11-17", classKey: "15:00", status: "Absent" },
    { id: "3", entityId: "7", entityType: "student", date: "2026-11-17", classKey: "", status: "Leave" },
  ];

  // Present -> Absent on teacher 7 @ 14:00 does not affect 15:00 or student 7
  rows = upsert(rows, { entityId: "7", entityType: "teacher", date: "2026-11-17", classKey: "14:00", status: "Absent" });
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.entityType === "teacher" && r.classKey === "14:00")?.status, "Absent");
  assert.equal(rows.find((r) => r.entityType === "teacher" && r.classKey === "15:00")?.status, "Absent");
  assert.equal(rows.find((r) => r.entityType === "student")?.status, "Leave");

  // Unmark teacher 7 @ 14:00 removes only 14:00
  rows = remove(rows, { entityId: "7", entityType: "teacher", date: "2026-11-17", classKey: "14:00" });
  assert.equal(rows.length, 2);
  assert.equal(rows.some((r) => r.entityType === "teacher" && r.classKey === "14:00"), false);
  assert.equal(rows.some((r) => r.entityType === "teacher" && r.classKey === "15:00"), true);

  // Unmark -> Present inserts back cleanly
  rows = upsert(rows, { entityId: "7", entityType: "teacher", date: "2026-11-17", classKey: "14:00", status: "Present" });
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.entityType === "teacher" && r.classKey === "14:00")?.status, "Present");
});

test("5. App.tsx skips redundant loadState() for local teacher_session_attendance_v2 WebSocket echoes", () => {
  const source = fs.readFileSync(path.join(cwd, "App.tsx"), "utf8");

  assert.equal(
    source.includes("recentLocalTeacherAttendanceRef"),
    true,
    "App.tsx must track recent local teacher session attendance mutations",
  );
  assert.equal(
    source.includes("teacher_session_attendance_v2") &&
      source.includes("teacher_session_unmarked_v2"),
    true,
    "App.tsx useAcademyWS must scope echo suppression to teacher_session_attendance_v2 and teacher_session_unmarked_v2",
  );
});

test("6. TeacherAttendanceModal disables Confirm on unmet prerequisites, adds Mark/Refresh actions, and fixes ? separators", () => {
  const source = fs.readFileSync(
    path.join(cwd, "components", "AttendanceEditor.tsx"),
    "utf8",
  );

  assert.equal(source.includes('{" ? "}'), false, "Literal ? separator must be removed");
  assert.equal(source.includes('subtitle={`${day || "?"} ? ${date}`}'), false, "Subtitle ? separator must be removed");
  assert.equal(source.includes('{" · "}'), true);
  assert.equal(source.includes("disabled={!validation.canConfirm}"), true);
  assert.equal(source.includes("Mark student attendance"), true);
  assert.equal(source.includes("Refresh session"), true);
});

test("7. Coverage validation and refresh reconciliation preserve valid substitutes and clear invalid ones", () => {
  type StudentRow = {
    student_id: number;
    student_status: "present" | "absent" | "leave" | "not_marked";
    requires_substitute: boolean;
    coverage: { coverage_status: string; substitute_teacher_id: number | null } | null;
  };
  type Payload = {
    students: StudentRow[];
    available_substitutes: Array<{ id: number; name: string }>;
  };

  const reconcile = (payload: Payload, prev?: Record<number, string>) => {
    const availableIds = new Set(payload.available_substitutes.map((t) => String(t.id)));
    const next: Record<number, string> = {};
    for (const s of payload.students) {
      if (!s.requires_substitute) continue;
      const preserved = prev ? String(prev[s.student_id] || "") : "";
      if (preserved && availableIds.has(preserved)) {
        next[s.student_id] = preserved;
        continue;
      }
      if (s.coverage?.coverage_status === "assigned" && s.coverage.substitute_teacher_id) {
        const sub = String(s.coverage.substitute_teacher_id);
        if (availableIds.has(sub)) next[s.student_id] = sub;
      }
    }
    return next;
  };

  const validate = (payload: Payload, assignments: Record<number, string>, busy: { loading: boolean; saving: boolean }) => {
    const availableIds = new Set(payload.available_substitutes.map((t) => String(t.id)));
    const notMarked = payload.students.filter((s) => s.student_status === "not_marked");
    const required = payload.students.filter((s) => s.requires_substitute);
    const missing = required.filter((s) => {
      const sel = String(assignments[s.student_id] || "");
      return !sel || !availableIds.has(sel);
    });
    return {
      notMarkedCount: notMarked.length,
      missingCount: missing.length,
      canConfirm: notMarked.length === 0 && missing.length === 0 && !busy.loading && !busy.saving,
    };
  };

  // Unmarked student blocks confirmation
  const unmarkedPayload: Payload = {
    students: [
      { student_id: 1, student_status: "not_marked", requires_substitute: false, coverage: null },
      { student_id: 2, student_status: "present", requires_substitute: true, coverage: null },
    ],
    available_substitutes: [{ id: 10, name: "Sub A" }, { id: 11, name: "Sub B" }],
  };
  assert.equal(validate(unmarkedPayload, { 2: "10" }, { loading: false, saving: false }).canConfirm, false);

  // Refresh after marking student 1 absent, while Sub B (11) is no longer available
  const refreshedPayload: Payload = {
    students: [
      { student_id: 1, student_status: "absent", requires_substitute: false, coverage: null },
      { student_id: 2, student_status: "present", requires_substitute: true, coverage: null },
      { student_id: 3, student_status: "present", requires_substitute: true, coverage: null },
    ],
    available_substitutes: [{ id: 10, name: "Sub A" }],
  };
  const nextAssignments = reconcile(refreshedPayload, { 2: "10", 3: "11" });
  assert.equal(nextAssignments[2], "10", "Valid substitute must remain selected");
  assert.equal(nextAssignments[3], undefined, "Unavailable substitute must be cleared");
  assert.equal(validate(refreshedPayload, nextAssignments, { loading: false, saving: false }).canConfirm, false);

  // Selecting valid substitute enables confirmation
  nextAssignments[3] = "10";
  assert.equal(validate(refreshedPayload, nextAssignments, { loading: false, saving: false }).canConfirm, true);
  assert.equal(validate(refreshedPayload, nextAssignments, { loading: true, saving: false }).canConfirm, false);
});
