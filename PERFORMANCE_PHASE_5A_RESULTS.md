# PERFORMANCE_PHASE_5A_RESULTS.md

## 1. Confirmed Root Cause
Browser network tracing (`SCENARIO_B_RAPID`) against the Vite production build (`dist/` at `http://127.0.0.1:4173`) confirmed why `GET /api/academy/state/` (`501 KB`, `~1.3–3.5 s`) fired repeatedly across Quran Coordinator tab transitions:
1. **Un-deduplicated `useEffect` on `effectiveActiveTab` while `appState.isPartial === true`**:
   - Initial `#dashboard` load calls `loadState(true)` (`GET /api/academy/state/?dashboard=true`, `173 KB`), setting `appState.isPartial = true`.
   - When the user leaves `#dashboard` (e.g., clicks `Scheduling`), the `useEffect` in `App.tsx` calls `loadState(false)` (`GET /api/academy/state/`, `501 KB`).
   - Because `loadState(false)` takes `~1.3–3.5 s` to complete, `appState.isPartial` remains `true` while it is in flight. If the user clicks `Attendance`, `Accounts`, or `Lessons` before the first `loadState(false)` resolves, `effectiveActiveTab` changes and the `useEffect` fires a **new concurrent `GET /api/academy/state/` (`501 KB`) on every tab switch** (4 concurrent `501 KB` requests = `2,004 KB` in `SCENARIO_B_RAPID`).
2. **No In-Flight Request Deduplication in `storageService.ts`**:
   - `fetchAcademyState(dashboardOnly)` had no in-flight promise map, so concurrent callers (`loadInitialState`, tab-leave `useEffect`, or `scheduleAccountStateRefresh`) each opened a separate HTTP request.
3. **Missing Stale-Scope Guard**:
   - The tab-leave `useEffect`, `loadInitialState`, and `scheduleAccountStateRefresh` did not verify that `session?.user?.id`, `activeDepartmentIdForRole`, and `canLoadQuranAcademyState` were still the same when the async `loadState()` resolved.

---

## 2. Original State-Loading Lifecycle
1. `loadInitialState()` (`App.tsx`) waits for `featureContextLoaded` and `canLoadQuranAcademyState`, then calls `loadState(requestedTab === "dashboard")`.
   - On `#dashboard`: fetches `/api/academy/state/?dashboard=true` (`173 KB`, `isPartial = true`).
   - On any other hash: fetches `/api/academy/state/` (`501 KB`, `isPartial = false`).
2. Leaving `#dashboard` triggers `useEffect` (`[canLoadQuranAcademyState, effectiveActiveTab, appState.isPartial]`) → calls `loadState(false)` without checking if a full-state request is already in flight.
3. `scheduleAccountStateRefresh()` (triggered by WebSocket `academy_update` / `account_*` or `ivs-import-finished`) debounces `500 ms` and calls `loadState()`.

---

## 3. Exact Changes Made
1. **`services/storageService.ts`**:
   - Added `inFlightAcademyState = new Map<string, Promise<AppState>>()` keyed by `${loadSession()?.user?.id || "anon"}:${getSavedAccessToken()}:${dashboardOnly ? "partial" : "full"}`.
   - Concurrent `fetchAcademyState()` calls for the same user, token, and `dashboardOnly` flag share the same in-flight promise, which is removed from the map in `.finally()`.
2. **`App.tsx`**:
   - Added `stateScopeKeyRef` (`${session?.user?.id || 0}:${activeDepartmentIdForRole}:${canLoadQuranAcademyState ? 1 : 0}`) and `fullStateInFlightRef`.
   - In `loadInitialState()`: resets `fullStateInFlightRef.current = null` on scope entry and checks `stateScopeKeyRef.current !== scopeAtStart` before calling `setAppState(loaded)`.
   - In the tab-leave `useEffect`: skips firing a duplicate `loadState(false)` if `fullStateInFlightRef.current?.scopeKey === scopeAtStart`, and verifies `stateScopeKeyRef.current === scopeAtStart && canLoadQuranAcademyStateRef.current` before calling `setAppState(loaded)`.
   - In `scheduleAccountStateRefresh()`: captures `scopeAtStart` before `await loadState()` and skips `setAppState(refreshed)` if the user or department changed mid-flight.
3. **`tests/phase5a_state_loading_dedup.test.ts`**:
   - Added 3 targeted tests verifying `storageService.ts` in-flight deduplication, `App.tsx` concurrent full-state deduplication and stale-scope guards, and `scheduleAccountStateRefresh` preservation.

---

## 4. New State-Loading Behavior
- **Initial `#dashboard`**: Fetches `?dashboard=true` (`173 KB`, `isPartial = true`).
- **First transition off `#dashboard` (even during rapid multi-tab clicking)**: Fires **exactly 1** `GET /api/academy/state/` (`501 KB`). Subsequent tab clicks while it is in flight reuse/await the in-flight load rather than firing duplicates.
- **Once `isPartial === false`**: Switching among `Scheduling`, `Attendance`, `Accounts`, `Lessons`, `Reports`, `Dashboard`, and returning to `Scheduling` makes **0** additional `/api/academy/state/` requests.
- **Data Freshness & Invalidation**: `inFlightAcademyState` is cleared immediately when the request settles, so WebSocket `academy_update`, `ivs-import-finished`, manual refresh, and department/user switches always fetch fresh state.

---

## 5. Before-and-After Request Counts (Quran Coordinator, `dist/` via `http://127.0.0.1:4173`)
| Scenario | Metric | Before Phase 5A | After Phase 5A | Delta |
|---|---|---:|---:|---:|
| **Settled Navigation** (`Dashboard` → `Scheduling` → `Attendance` → `Accounts` → `Lessons` → `Reports` → `Dashboard` → `Scheduling`) | Partial state (`?dashboard=true`) | 1 (`173 KB`) | 1 (`173 KB`) | 0 |
| **Settled Navigation** | Full state (`/api/academy/state/`) | 1 (`501 KB`) | 1 (`501 KB`) | 0 |
| **Rapid Tab Navigation** (`Dashboard` → `Scheduling` → `Attendance` → `Accounts` → `Lessons` → `Reports`, ~250–400 ms per tab) | Partial state (`?dashboard=true`) | 1 (`173 KB`) | 1 (`173 KB`) | 0 |
| **Rapid Tab Navigation** | Full state (`/api/academy/state/`) | **4** (`2,004 KB`) | **1** (`501 KB`) | **-3 requests (-75%)** |
| **Rapid Tab Navigation** | Total academy state bytes | **2,177 KB** | **674 KB** | **-1,503 KB (-69%)** |

---

## 6. Network Transfer Reduction
- **Rapid Coordinator tab navigation**: Reduced `/api/academy/state/` transfer from **2,177 KB** (`173 + 4×501 KB`) down to **674 KB** (`173 + 1×501 KB`), saving **1,503 KB (~1.47 MB)** and eliminating 3 redundant `~2.7–3.4 s` Django full-state serializations per navigation burst.
- **Repeated visits** (`Reports` → `Dashboard` → `Scheduling`): **0** `/api/academy/state/` requests on return to `Scheduling` (full state already hydrated).

---

## 7. Tab Navigation Timings (Measured in `SCENARIO_B_RAPID`, `dist/`)
| Transition | Before Phase 5A | After Phase 5A | Notes |
|---|---:|---:|---|
| Initial `#dashboard` settle | 3,710 ms | 4,312 ms | `?dashboard=true` (`173 KB`) |
| `Dashboard` → `Scheduling` | 3,736 ms | 3,758 ms | First full state (`501 KB`) + matrix render |
| `Scheduling` → `Attendance` | 356 ms (fired extra `501 KB`) | 416 ms (**0** state reqs) | `Attendance` endpoint only |
| `Attendance` → `Accounts` | 281 ms (fired extra `501 KB`) | 363 ms (**0** state reqs) | `/api/auth/accounts/` only |
| `Accounts` → `Lessons` | 294 ms (fired extra `501 KB`) | 264 ms (**0** state reqs) | Paginated lessons only |
| `Lessons` → `Reports` | 300 ms | 296 ms (**0** state reqs) | Local state |

---

## 8. Data Freshness Verification
- `inFlightAcademyState` only deduplicates **concurrent** in-flight promises; it never caches completed responses across time.
- WebSocket `academy_update`, `account_created`, `account_updated`, `account_deleted`, and `ivs-import-finished` still call `scheduleAccountStateRefresh()` → `loadState()` to fetch fresh full state.
- `loadEditorAttendance` (used by `AttendanceEditor`) and `saveState` (for local student/teacher mutations) remain untouched.
- `stateScopeKeyRef` prevents an in-flight response from an old session or old department from overwriting a newer session or department.

---

## 9. Multi-Department Isolation Verification
- Preserved `canLoadQuranAcademyState` (`activeDepartmentType === "quran"`, coordinator/department_admin/institution_admin role check) and `INITIAL_STATE` clearing for Tuition, Teacher, Student, and Platform Admin workspaces.
- `requestKey` includes `user.id` and `getSavedAccessToken()`, and `stateScopeKeyRef` includes `user.id` and `activeDepartmentIdForRole`, guaranteeing zero cross-user or cross-department promise sharing or state leakage.

---

## 10. WebSocket Behavior
- Single shared `WS /ws/academy/` connection preserved (`useAcademyWS`).
- `scheduleAccountStateRefresh` still triggers debounced (`500 ms`) full-state refresh on valid `academy_update` events while skipping local `teacher_session_attendance_v2` echoes.

---

## 11. TypeScript and Build Results
- `npm run typecheck` (`tsc --noEmit`): **Passed** (exit code `0`).
- `npm run build` (`vite build`): **Passed** (`✓ built in 2m 44s`); `index-BOz3BfXU.js` (`405.42 kB | gzip: 112.71 kB`).

---

## 12. Regression Test Results
- `node --test tests\*.test.ts`: **90 passed, 0 failed, 0 skipped** (all 87 previous tests including `phase4d_v3_state_and_ws.test.ts` + 3 new tests in `tests/phase5a_state_loading_dedup.test.ts`).
- Django system check (`backend/manage.py check`): **Passed** (`System check identified no issues (0 silenced)`). No backend files were modified; `manage.py test` was not run interactively because `test_ivs_academy_localdev` already exists on this local instance.

---

## 13. Remaining Performance Issues
- **Scheduling Matrix DOM Size**: `#scheduling` still renders **28,726 DOM nodes** (`~5.6–7.5 s` full render) for `977` students.
- **Monolithic `/api/academy/state/` Payload**: The first non-dashboard tab visit still fetches a `501 KB` (`~1.3–3.5 s`) payload once per session/department.
- **Mobile Main-Thread Boot (`index` bundle)**: `405.42 KB` main bundle still causes `~785–1,715 ms` mobile Lighthouse TBT.

---

## 14. Safe Phase-Specific Rollback Procedure
To revert only Phase 5A without disturbing Phases 2A–4E:
1. Revert the Phase 5A hunks in `services/storageService.ts` (`inFlightAcademyState`) and `App.tsx` (`stateScopeKeyRef`, `fullStateInFlightRef`).
2. Delete `tests/phase5a_state_loading_dedup.test.ts` and `PERFORMANCE_PHASE_5A_RESULTS.md`.

---

## 15. Recommendation for Phase 5B
**READY FOR PHASE 5B (Scheduling Matrix Virtualization / Windowing)**: Now that redundant concurrent `/api/academy/state/` requests are eliminated, optimize `SchedulingTab.tsx` to virtualize or paginate/window time slots and student rows so DOM nodes drop from `28,726` to `<2,000`.
