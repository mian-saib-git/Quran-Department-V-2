import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Mirrors the exact Phase 5A / 5A-V in-flight deduplication + scope-key guard +
 * trailing WS refresh state machine in services/storageService.ts and App.tsx.
 */
function createStateController(fetcher: (opts: { dashboardOnly: boolean; scopeKey: string; token: string }) => Promise<any>) {
  const inFlight = new Map<string, Promise<any>>();
  let userId = "u1";
  let token = "tok1";
  let deptId = 1;
  let canLoad = true;
  let isPartial = true;
  let committedState: any = { version: 0, dept: 1, user: "u1" };

  let wsTimer: ReturnType<typeof setTimeout> | null = null;
  let wsRunning = false;
  let wsPending = false;
  let requestSeq = 0;
  let fullInFlight: { scopeKey: string; promise: Promise<any> } | null = null;

  const currentScopeKey = () => `${userId}:${deptId}:${canLoad ? 1 : 0}`;

  const loadState = (dashboardOnly: boolean, options?: { force?: boolean; scopeKey?: string }) => {
    const scopePart = options?.scopeKey ? String(options.scopeKey) : "";
    const key = `${userId}:${token}:${scopePart}:${dashboardOnly ? "partial" : "full"}`;
    if (!options?.force) {
      const existing = inFlight.get(key);
      if (existing) return existing;
    }
    const p = fetcher({ dashboardOnly, scopeKey: scopePart, token }).finally(() => {
      if (inFlight.get(key) === p) inFlight.delete(key);
    });
    inFlight.set(key, p);
    return p;
  };

  const onTabLeave = () => {
    if (!canLoad || !isPartial) return;
    const scopeAtStart = currentScopeKey();
    if (fullInFlight?.scopeKey === scopeAtStart) return;
    const reqSeq = ++requestSeq;
    const promise = loadState(false, { scopeKey: scopeAtStart });
    fullInFlight = { scopeKey: scopeAtStart, promise };
    return promise
      .then((loaded) => {
        if (reqSeq !== requestSeq || currentScopeKey() !== scopeAtStart || !canLoad) return;
        committedState = loaded;
        isPartial = false;
      })
      .catch(() => {})
      .finally(() => {
        if (fullInFlight?.promise === promise) fullInFlight = null;
      });
  };

  const scheduleWsRefresh = (delayMs = 5) => {
    if (!canLoad) return;
    if (wsTimer) clearTimeout(wsTimer);
    wsTimer = setTimeout(async () => {
      if (!canLoad) return;
      if (wsRunning) {
        wsPending = true;
        return;
      }
      const scopeAtStart = currentScopeKey();
      const reqSeq = ++requestSeq;
      wsRunning = true;
      wsPending = false;
      try {
        const refreshed = await loadState(false, { force: true, scopeKey: scopeAtStart });
        if (reqSeq !== requestSeq || currentScopeKey() !== scopeAtStart || !canLoad) return;
        committedState = refreshed;
        isPartial = false;
      } catch {
        // leave existing state intact
      } finally {
        wsRunning = false;
        if (wsPending && canLoad) {
          wsPending = false;
          scheduleWsRefresh(delayMs);
        }
      }
    }, delayMs);
  };

  return {
    getState: () => committedState,
    isPartial: () => isPartial,
    setScope: (next: { userId?: string; token?: string; deptId?: number; canLoad?: boolean; isPartial?: boolean }) => {
      if (next.userId !== undefined) userId = next.userId;
      if (next.token !== undefined) token = next.token;
      if (next.deptId !== undefined) deptId = next.deptId;
      if (next.canLoad !== undefined) canLoad = next.canLoad;
      if (next.isPartial !== undefined) isPartial = next.isPartial;
    },
    loadState,
    onTabLeave,
    scheduleWsRefresh,
  };
}

test("1. Rapid tab navigation deduplicates 4 concurrent full-state requests into 1", async () => {
  let networkCalls = 0;
  const d = deferred<any>();
  const ctrl = createStateController(() => {
    networkCalls++;
    return d.promise;
  });

  const p1 = ctrl.onTabLeave();
  const p2 = ctrl.onTabLeave();
  const p3 = ctrl.onTabLeave();
  const p4 = ctrl.onTabLeave();

  assert.equal(networkCalls, 1, "Rapid tab clicks while in-flight must issue only 1 network request");
  d.resolve({ version: 1, dept: 1, user: "u1" });
  await Promise.all([p1, p2, p3, p4]);
  assert.equal(ctrl.getState().version, 1);
  assert.equal(ctrl.isPartial(), false);
});

test("2. Switching departments while full-state request is pending ignores stale Dept 1 response", async () => {
  const dept1Deferred = deferred<any>();
  const dept3Deferred = deferred<any>();
  const calls: string[] = [];

  const ctrl = createStateController(({ scopeKey }) => {
    calls.push(scopeKey);
    return scopeKey.startsWith("u1:1:") ? dept1Deferred.promise : dept3Deferred.promise;
  });

  // Start Dept 1 full-state load
  const pDept1 = ctrl.onTabLeave();
  // Switch to Dept 3 while Dept 1 is still pending
  ctrl.setScope({ deptId: 3, isPartial: true });
  const pDept3 = ctrl.onTabLeave();

  assert.equal(calls.length, 2, "Different department scope must not reuse Dept 1 in-flight promise");

  // Dept 3 resolves first, then stale Dept 1 resolves later
  dept3Deferred.resolve({ version: 2, dept: 3, user: "u1" });
  await pDept3;
  assert.equal(ctrl.getState().dept, 3);

  dept1Deferred.resolve({ version: 1, dept: 1, user: "u1" });
  await pDept1;
  assert.equal(ctrl.getState().dept, 3, "Stale Dept 1 response must never overwrite Dept 3 data");
});

test("3. WS invalidation during in-flight full-state load + consecutive WS updates never lose latest data", async () => {
  const initialReq = deferred<any>();
  const wsReq1 = deferred<any>();
  const wsReq2 = deferred<any>();
  let callIdx = 0;

  const ctrl = createStateController(() => {
    callIdx++;
    if (callIdx === 1) return initialReq.promise;
    if (callIdx === 2) return wsReq1.promise;
    return wsReq2.promise;
  });

  // Initial full-state load starts
  const pInit = ctrl.onTabLeave();
  // WS invalidation arrives while initial request is still pending
  ctrl.scheduleWsRefresh(5);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(callIdx, 2, "WS refresh must bypass in-flight tab-leave promise via force:true");

  // Second consecutive WS invalidation arrives while wsReq1 is still running
  ctrl.scheduleWsRefresh(5);
  await new Promise((r) => setTimeout(r, 15));

  // Resolve in reverse / staggered order: initial arrives after wsReq1
  wsReq1.resolve({ version: 2, dept: 1, user: "u1" });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(callIdx, 3, "Trailing WS refresh must fire after wsReq1 finishes");

  wsReq2.resolve({ version: 3, dept: 1, user: "u1" });
  initialReq.resolve({ version: 1, dept: 1, user: "u1" });
  await pInit;
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(ctrl.getState().version, 3, "Latest WS state (v3) must be preserved");
});

test("4. Logout / user switch while request is pending discards old user data; failed request recovers cleanly", async () => {
  const userADef = deferred<any>();
  const failDef = deferred<any>();
  const userBDef = deferred<any>();
  let step = 0;

  const ctrl = createStateController(() => {
    step++;
    if (step === 1) return userADef.promise;
    if (step === 2) return failDef.promise;
    return userBDef.promise;
  });

  // User A starts request, then logs out and User B logs in
  const pA = ctrl.onTabLeave();
  ctrl.setScope({ userId: "u2", token: "tok2", isPartial: true });

  // User B's first attempt fails (500)
  const pBFail = ctrl.onTabLeave();
  failDef.reject(new Error("500 Internal Server Error"));
  await pBFail;
  assert.equal(ctrl.isPartial(), true, "Failed full-state request must leave isPartial=true for recovery");

  // User B retries on next tab switch (with token refresh)
  ctrl.setScope({ token: "tok2-refreshed" });
  const pBRetry = ctrl.onTabLeave();
  userBDef.resolve({ version: 10, dept: 1, user: "u2" });
  await pBRetry;
  assert.equal(ctrl.getState().user, "u2");

  // Late User A response arrives
  userADef.resolve({ version: 99, dept: 1, user: "u1" });
  await pA;
  assert.equal(ctrl.getState().user, "u2", "Late User A response must never overwrite User B");
});

test("5. Source verification: App.tsx and storageService.ts pass scopeKey and force:true for WS refresh", () => {
  const storageSrc = fs.readFileSync(path.join(process.cwd(), "services/storageService.ts"), "utf8");
  const appSrc = fs.readFileSync(path.join(process.cwd(), "App.tsx"), "utf8");
  assert.equal(storageSrc.includes("options?: LoadStateOptions"), true);
  assert.equal(storageSrc.includes("if (!options?.force)"), true);
  assert.equal(appSrc.includes("accountStateRefreshPending"), true);
  assert.equal(appSrc.includes("loadState(false, { force: true, scopeKey: scopeAtStart })"), true);
  assert.equal(appSrc.includes("loadState(false, { scopeKey: scopeAtStart })"), true);
});
