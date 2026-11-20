import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";

const cwd = process.cwd();

function loadDjangoApiService() {
  if (!(globalThis as any).window) {
    (globalThis as any).window = {
      location: { hostname: "127.0.0.1", port: "4173", protocol: "http:", origin: "http://127.0.0.1:4173" },
      addEventListener: () => {},
      dispatchEvent: () => true,
    };
  }
  if (!(globalThis as any).localStorage) {
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  const res = esbuild.buildSync({
    entryPoints: [path.join(cwd, "services/djangoApiService.ts")],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
  });
  const req = createRequire(import.meta.url);
  const mod = { exports: {} as any };
  const fn = new Function("require", "module", "exports", res.outputFiles[0].text);
  fn(req, mod, mod.exports);
  return mod.exports;
}

test("1. updateStudentScheduleInDjango sends authoritative POST /api/academy/scheduling/ edit_student payload", async () => {
  const api = loadDjangoApiService();
  const calls: Array<{ url: string; init: any }> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        detail: "Schedule updated.",
        student: {
          id: "42",
          name: "Test Student",
          teacherId: "7",
          timeSlot: "04:00",
          classType: "2 days / week",
          classDays: ["Monday", "Saturday"],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as any;

  try {
    const res = await api.updateStudentScheduleInDjango({
      student_id: "42",
      teacher_id: "7",
      time_slot: "04:00",
      class_days: ["Monday", "Saturday"],
    });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/api/academy/scheduling/"));
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      action: "edit_student",
      student_id: 42,
      teacher_id: 7,
      time_slot: "04:00",
      class_days: ["Monday", "Saturday"],
    });
    assert.equal(res.student.timeSlot, "04:00");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("2. removeStudentFromClassInDjango and deleteClassSlotInDjango send expected payloads and surface server errors", async () => {
  const api = loadDjangoApiService();
  const calls: Array<{ url: string; body: any }> = [];
  const origFetch = globalThis.fetch;

  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({ detail: "Student removed from class slot.", student_id: "42", remaining_time_slot: "", removed_count: 2 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as any;

  try {
    const rm = await api.removeStudentFromClassInDjango({ student_id: "42", teacher_id: "7", time_slot: "04:00" });
    assert.equal(rm.remaining_time_slot, "");
    assert.deepEqual(calls[0].body, {
      action: "remove_student",
      student_id: 42,
      teacher_id: 7,
      time_slot: "04:00",
    });

    await api.deleteClassSlotInDjango({ teacher_id: "7", time_slot: "04:00" });
    assert.deepEqual(calls[1].body, {
      action: "delete_class",
      teacher_id: 7,
      time_slot: "04:00",
    });

    // Failure case (HTTP 403) must reject so caller keeps modal open
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ detail: "Scheduling is not available." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })) as any;

    await assert.rejects(
      () => api.updateStudentScheduleInDjango({ student_id: "42", teacher_id: "7", time_slot: "04:00", class_days: ["Monday"] }),
      /Scheduling is not available/
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("3. App.tsx awaits Django mutations, guards duplicate saves & stale scopes, and routes add-student to Accounts", () => {
  const appSrc = fs.readFileSync(path.join(cwd, "App.tsx"), "utf8");
  const portalSrc = fs.readFileSync(path.join(cwd, "components/QuranCoordinatorPortal.tsx"), "utf8");
  assert.equal(appSrc.includes("await updateStudentScheduleInDjango("), true);
  assert.equal(appSrc.includes("await removeStudentFromClassInDjango("), true);
  assert.equal(appSrc.includes("await deleteClassSlotInDjango("), true);
  assert.equal(appSrc.includes("if (scheduleSaving) return;"), true);
  assert.equal(appSrc.includes("if (stateScopeKeyRef.current !== scopeAtStart) return;"), true);
  assert.equal(portalSrc.includes("Account creation requires Accounts &amp; Enrollment"), true);
});
