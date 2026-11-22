# PERFORMANCE_PHASE_5A_VERIFICATION.md

## 1. Verification Objective & Verdict
**Recommendation: CORRECT & KEEP**

Phase 5A-V exercised real asynchronous race conditions (deferred promises with out-of-order resolution and Playwright browser network interception against the Vite `dist/` production build) on the Phase 5A state deduplication implementation.

**Two genuine race-condition gaps were discovered during Phase 5A-V and fixed with minimal targeted corrections:**
1. **Out-of-order response overwrite & lost WS invalidations**:
   - When a WS `academy_update` arrived while a tab-leave `loadState(false)` was already in flight, `scheduleAccountStateRefresh` previously called `loadState()` without bypassing `inFlightAcademyState`, which could coalesce onto the older pre-mutation promise.
   - Furthermore, if an older in-flight request resolved *after* a newer WS refresh had already committed (`v3`), it could overwrite `v3` with `v1` because `scopeKey` hadn't changed.
   - Consecutive WS invalidations arriving while `accountStateRefreshRunning.current === true` were dropped instead of scheduling one trailing refresh.
2. **Department-scope key in `inFlightAcademyState`**:
   - Added `scopeKey` (`userId:deptId:canLoad`) to `loadState(dashboardOnly, { force, scopeKey })` so switching departments while a request is pending never shares an in-flight promise across departments.

---

## 2. Corrections Implemented in Phase 5A-V
1. **`services/storageService.ts`**:
   - Added `LoadStateOptions = { force?: boolean; scopeKey?: string }` to `loadState` and `fetchAcademyState`.
   - `requestKey` now includes `scopePart` (`${userId}:${token}:${scopePart}:${partial|full}`).
   - `options.force === true` bypasses `inFlightAcademyState.get(requestKey)` while still cleaning up only its own promise reference in `.finally()`.
2. **`App.tsx`**:
   - Added `stateRequestSeqRef = useRef(0)` (monotonic sequence counter incremented on every `loadInitialState`, tab-leave `loadState(false)`, and `scheduleAccountStateRefresh`). Late out-of-order responses with `reqSeq !== stateRequestSeqRef.current` are discarded.
   - Added `accountStateRefreshPending = useRef(false)` so consecutive WS invalidations during an active refresh queue one trailing `scheduleAccountStateRefresh()` instead of being dropped.
   - `scheduleAccountStateRefresh` calls `loadState(false, { force: true, scopeKey: scopeAtStart })`.
3. **`tests/phase5a_v_async_races.test.ts`** (new):
   - 5 asynchronous deferred-promise & out-of-order race tests.
4. **`tests/phase5a_state_loading_dedup.test.ts`**:
   - Updated 2 string assertions to match the `LoadStateOptions` and `stateRequestSeqRef` additions.

---

## 3. Executed Asynchronous & Browser Scenarios

### A. Deferred-Promise & Out-of-Order Race Suite (`tests/phase5a_v_async_races.test.ts`)
| # | Scenario | Method | Result |
|---|---|---|---|
| 1 | Rapid tab navigation (`4` concurrent tab-leave calls while in-flight) | Deferred promise counting network calls | **PASS** — `1` network call issued (`4 → 1` preserved), state settled to `v1`, `isPartial=false` |
| 2 | Switching departments (`Dept 1` → `Dept 3`) while `Dept 1` full-state is pending | Separate deferred promises resolved out-of-order (`Dept 3` first, `Dept 1` second) | **PASS** — `2` distinct scoped requests; late `Dept 1` response ignored; `Dept 3` preserved |
| 3 | WS invalidation during in-flight full-state + 2nd consecutive WS update | 3 deferred promises (`initialReq` v1, `wsReq1` v2, `wsReq2` v3) resolved with `initialReq` arriving last | **PASS** — WS bypassed `initialReq` (`force:true`), trailing `wsReq2` fired after `wsReq1`, late `v1` discarded, final state `v3` |
| 4 | Logout / user switch (`u1` → `u2`) while `u1` pending + `u2` HTTP 500 failure + token refresh + retry | Deferred promises with rejection + token change + late `u1` resolution | **PASS** — 500 kept `isPartial=true` for recovery, token refresh + retry succeeded, late `u1` response discarded |
| 5 | Source contract check (`scopeKey`, `force: true`, `accountStateRefreshPending`) | Source verification | **PASS** |

### B. Playwright Browser Network-Interception Suite (`dist/` via `http://127.0.0.1:4173`)
Executed with `qa_5av_qcoord` (deleted after test) using `page.route("**/api/academy/state/**", ...)`:
| # | Scenario | Observed Browser Result |
|---|---|---|
| 1 | **Rapid Navigation with 1,200 ms artificial delay**: `#dashboard` → `Scheduling` → `Attendance` → `Accounts` → `Lessons` → `Reports` (150 ms apart) | `BROWSER_TEST_1_RAPID: partial=1, full=1` (**PASS** — 4→1 reduction preserved under real 1.2s network delay) |
| 2 | **Failed Request Recovery**: First `/api/academy/state/` fulfilled with `HTTP 500`, then switched to `Attendance` | `BROWSER_TEST_2_RECOVERY: fullAttempt=2` (**PASS** — recovered cleanly on next tab switch) |
| 3 | **Logout While Pending**: Held `/api/academy/state/` pending, clicked `Logout`, then released pending response | `BROWSER_TEST_3_LOGOUT_RACE: stillOnLogin=true` (**PASS** — UI remained on `LoginScreen`, no data leakage) |

---

## 4. Verification Results (After Final Edits)
- `npm run typecheck` (`tsc --noEmit`): **Passed** (exit code `0`).
- `node --test tests\*.test.ts`: **95 passed, 0 failed, 0 skipped** (all 90 existing tests + 5 new async race tests in `tests/phase5a_v_async_races.test.ts`).
- `npm run build` (`vite build`): **Passed** (`✓ built in 24.33s`).
- `backend/manage.py check`: **Passed** (`System check identified no issues (0 silenced)`).

---

## 5. Final Recommendation
**KEEP** (with the Phase 5A-V corrections). The `4 → 1` rapid-navigation reduction is preserved, stale out-of-order responses across departments, users, and WS updates are now strictly rejected via `scopeKey` + `stateRequestSeqRef`, and consecutive WS invalidations are guaranteed to run a trailing refresh. Ready to proceed to Phase 5B (Scheduling matrix virtualization) when authorized.
