import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. App.tsx waits for authoritative authContext before loading Quran academy state", () => {
  const src = read("App.tsx");
  assert.equal(src.includes("if (!featureContextLoaded)"), true);
  assert.equal(src.includes('activeDepartmentType === "quran"'), true);
  assert.equal(src.includes("const canLoadQuranAcademyState = Boolean("), true);
  assert.equal(
    src.includes("[session, featureContextLoaded, canLoadQuranAcademyState, activeDepartmentIdForRole]"),
    true,
    "loadInitialState must re-evaluate when authContext department or role changes"
  );
});

test("2. App.tsx clears appState for Tuition, non-coordinator, and superadmin workspaces to prevent state leakage", () => {
  const src = read("App.tsx");
  assert.equal(src.includes('if (!isDashboardRole || sessionDepartmentType === "tuition")'), true);
  assert.equal(src.includes("if (!canLoadQuranAcademyState)"), true);
  assert.equal(
    src.includes("setAppState(INITIAL_STATE);"),
    true,
    "Non-Quran or logged-out workspaces must reset appState to INITIAL_STATE"
  );
});

test("3. App.tsx guards WebSocket-triggered and tab-leave academy state refreshes with canLoadQuranAcademyState", () => {
  const src = read("App.tsx");
  assert.equal(src.includes("canLoadQuranAcademyStateRef.current = canLoadQuranAcademyState;"), true);
  assert.equal(
    src.includes("!canLoadQuranAcademyStateRef.current"),
    true,
    "scheduleAccountStateRefresh must block unauthorized WS-triggered loadState() calls"
  );
  assert.equal(
    src.includes('if (canLoadQuranAcademyState && effectiveActiveTab !== "dashboard" && appState.isPartial)'),
    true,
    "Leaving dashboard must only fetch full Quran state when canLoadQuranAcademyState is true"
  );
});

test("4. App.tsx forces WebSocket disconnect on all portal logout handlers", () => {
  const src = read("App.tsx");
  assert.equal(
    src.includes("disconnectAcademyWS()"),
    false,
    "Logout handlers must pass force=true to disconnectAcademyWS(true)"
  );
  const matches = src.match(/disconnectAcademyWS\(true\)/g) || [];
  assert.equal(
    matches.length >= 9,
    true,
    `Expected at least 9 forced disconnectAcademyWS(true) calls across portals/auth error handlers, found ${matches.length}`
  );
});

test("5. useAcademyWS guards stale socket callbacks and handles CONNECTING close cleanly", () => {
  const src = read("hooks/useAcademyWS.ts");
  assert.equal(src.includes("const socket = new WebSocket(url);"), true);
  assert.equal(src.includes("if (ws !== socket || manualClose)"), true);
  assert.equal(src.includes("if (ws !== socket) return;"), true);
  assert.equal(src.includes("activeSocket.readyState === WebSocket.OPEN"), true);
});
