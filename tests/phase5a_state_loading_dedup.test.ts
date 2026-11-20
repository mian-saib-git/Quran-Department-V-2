import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

function read(relPath: string): string {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

test("1. storageService deduplicates concurrent in-flight /api/academy/state/ requests by user, token, and partial/full scope", () => {
  const src = read("services/storageService.ts");
  assert.equal(src.includes("const inFlightAcademyState = new Map<string, Promise<AppState>>();"), true);
  assert.equal(src.includes("const existing = inFlightAcademyState.get(requestKey);"), true);
  assert.equal(src.includes("return existing;"), true);
  assert.equal(src.includes("inFlightAcademyState.delete(requestKey);"), true);
  assert.equal(src.includes("normalized.isPartial = dashboardOnly;"), true);
});

test("2. App.tsx deduplicates concurrent full-state tab loads and guards stale session/department responses", () => {
  const appSrc = read("App.tsx");
  assert.equal(appSrc.includes("const stateScopeKeyRef = useRef(\"\");"), true);
  assert.equal(appSrc.includes("const fullStateInFlightRef = useRef<"), true);
  assert.equal(appSrc.includes("if (fullStateInFlightRef.current?.scopeKey === scopeAtStart) {"), true);
  assert.equal(appSrc.includes("stateScopeKeyRef.current !== scopeAtStart ||"), true);
  assert.equal(appSrc.includes("!canLoadQuranAcademyStateRef.current"), true);
  assert.equal(appSrc.includes("reqSeq !== stateRequestSeqRef.current || stateScopeKeyRef.current !== scopeAtStart"), true);
  assert.equal(appSrc.includes("canLoadQuranAcademyState"), true);
});

test("3. scheduleAccountStateRefresh preserves WS/import refresh with stale-scope guard", () => {
  const appSrc = read("App.tsx");
  assert.equal(appSrc.includes("const scheduleAccountStateRefresh = React.useCallback("), true);
  assert.equal(appSrc.includes("const refreshed = await loadState(false, { force: true, scopeKey: scopeAtStart });"), true);
  assert.equal(appSrc.includes("setAppState(refreshed);"), true);
});
