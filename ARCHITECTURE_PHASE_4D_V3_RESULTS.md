# ARCHITECTURE_PHASE_4D_V3_RESULTS.md

## 1. Root Cause of the Unnecessary Quran State Request
- **Observed Symptom**: When a Tuition Coordinator logged in, `App.tsx` triggered `GET /api/academy/state/?dashboard=true`, returning `HTTP 403 Forbidden` (`"Quran department assignment is required."`).
- **Confirmed Root Cause**:
  1. `POST /api/auth/login/` (`auth_payload` in `backend/accounts/views.py`) returns `user` without `department` or `department_type`. Department metadata (`department`, `roles`, `features`, `coordinator_tabs`) is only returned asynchronously by `GET /api/auth/context/` (`loadFeatureContext()` in `App.tsx`).
  2. `loadInitialState()` in `App.tsx` previously ran in a `useEffect` depending only on `[session]` and read `(session as any)?.user?.department?.department_type || (session as any)?.department?.department_type || ""`. Because `session.user.department` was `undefined`, `sessionDepartmentType` evaluated to `""`, so `sessionDepartmentType === "tuition"` was `false`. Any coordinator (`sessionRole === "coordinator"`), including Tuition Coordinators, immediately triggered `loadState(isDashboardRequest)` (`GET /api/academy/state/?dashboard=true`) before `/api/auth/context/` resolved.
  3. Additionally, `scheduleAccountStateRefresh()` (triggered by WebSocket `academy_update` / `account_created` / `account_updated` / `account_deleted` events and `ivs-import-finished`) and the tab-leave `useEffect` (`effectiveActiveTab !== "dashboard" && appState.isPartial`) only checked `!isMainAdminSession(session)`, without verifying active Quran Coordinator authorization.

## 2. Exact Files Changed
- **Modified**:
  - `App.tsx`:
    - Moved authoritative `activeDepartment`, `activeDepartmentType`, `isTuitionDepartment`, `sessionRoleForDepartment`, `activeDepartmentIdForRole`, `activeDepartmentRoleAssignments`, `activeDepartmentRoleAssignment`, and `effectiveDepartmentRole` resolution above the state-loading effects (removing the duplicate declaration block).
    - Added `canLoadQuranAcademyState` (`session && !isMainAdminSession(session) && featureContextLoaded && activeDepartmentType === "quran" && ["coordinator", "department_admin", "institution_admin"].includes(effectiveDepartmentRole)`) and synced `canLoadQuranAcademyStateRef.current`.
    - Updated `loadInitialState` to wait for `featureContextLoaded`, reset `appState` to `INITIAL_STATE` for non-Quran/non-coordinator/superadmin workspaces, and depend on `[session, featureContextLoaded, canLoadQuranAcademyState, activeDepartmentIdForRole]`.
    - Guarded `scheduleAccountStateRefresh` and the tab-leave `loadState(false)` effect with `canLoadQuranAcademyState`.
    - Updated all remaining logout handlers (`TeacherPortal`, `StudentPortal`, Coordinator desktop and mobile logout buttons) to call `disconnectAcademyWS(true)`.
  - `hooks/useAcademyWS.ts`:
    - Captured each `WebSocket` instance in a local `const socket = new WebSocket(url)` and guarded `onopen`, `onmessage`, `onerror`, and `onclose` with `if (ws !== socket) return;` so stale/superseded sockets cannot mutate the module-level `ws` singleton or stop the active socket's heartbeat.
    - Handled `manualClose` / superseded `CONNECTING` sockets in `onopen` and only called `activeSocket.close(1000, "Manual disconnect")` immediately in `disconnectAcademyWS(true)` when `activeSocket.readyState === WebSocket.OPEN`.
- **Added**:
  - `tests/phase4d_v3_state_and_ws.test.ts` (5 targeted regression tests).
  - `ARCHITECTURE_PHASE_4D_V3_RESULTS.md` (this report).
- **Preserved / Untouched**:
  - `Lanyard` layout/component, business rules, database schemas, migrations, backend permissions, and all 75 existing frontend tests.

## 3. Department-Specific State-Loading Strategy
- **Single Authoritative Gate**: Quran academy state (`/api/academy/state/`) is gated by `canLoadQuranAcademyState`, which relies exclusively on the existing `/api/auth/context/` resolution (`authContext`, `featureContextLoaded`, `activeDepartmentType`, `effectiveDepartmentRole`) — no second department-detection mechanism was introduced.
- **State Isolation**:
  - While `featureContextLoaded` is `false`, `App.tsx` renders `<DepartmentWorkspaceLoading />` and `loadInitialState` waits without issuing `/api/academy/state/`.
  - For Tuition (`activeDepartmentType === "tuition"`), non-Quran departments, Teachers, Students, and Platform Admins, `appState` is reset to `INITIAL_STATE` and `hydrated` is set to `true` without calling `loadState()`.
  - WebSocket-triggered refreshes (`scheduleAccountStateRefresh`) and tab-leave full-state upgrades (`appState.isPartial`) are also gated by `canLoadQuranAcademyState`.

## 4. Before-and-After API Request Measurements
| Metric | Before (Phase 4D-V2) | After (Phase 4D-V3) |
|---|---:|---:|
| Tuition Coordinator `/api/academy/state/` requests | `1` (`GET /api/academy/state/?dashboard=true`) | **`0`** |
| Tuition Coordinator unexpected HTTP 403 responses | `1` (`"Quran department assignment is required."`) | **`0`** |
| Tuition Teacher `/api/academy/state/` requests | N/A (not verified in V2) | **`0`** |
| Tuition Student `/api/academy/state/` requests | N/A (not verified in V2) | **`0`** |
| Multi-dept user in Tuition `/api/academy/state/` requests | N/A | **`0`** |
| Quran Coordinator `/api/academy/state/?dashboard=true` on `#dashboard` | `1` (HTTP 200) | **`1` (HTTP 200)** |
| Quran Coordinator `/api/academy/state/` when leaving `#dashboard` | `1` (HTTP 200) | **`1` (HTTP 200)** |

## 5. HTTP 403 Verification
- **Tuition Coordinator (`qa_phase4dv3_tuition`)**: `0` HTTP 403 responses across Login, Dashboard, Accounts & Enrollment, Scheduling, Attendance, Reports, and Logout.
- **Multi-Department User switched to Tuition (`qa_phase4dv3_multidept`)**: `0` HTTP 403 responses across Login, Tuition Dashboard, and Logout.
- **Quran Coordinator (`qa_phase4dv3_coord`)**: `0` HTTP 403 responses in isolated single-session navigation across Dashboard, Scheduling, Attendance, Accounts, Lessons Control, Reports, and Logout. *(Note: During an initial parallel run where two browser tabs shared `localhost:3000` `localStorage`, concurrent logins briefly overwrote the shared session token; once isolated, 0 HTTP 403s occurred.)*

## 6. Multi-Department Isolation Verification
- Tested `qa_phase4dv3_multidept` (assigned to both Quran Department `id=1` and Tuition Department `id=2`):
  1. **Active Department = Quran (`id=1`)**: Loaded Quran Coordinator Dashboard (`Students: 976`, `Teachers: 76`, `Live Now: 10`, `Up Next: 14`), `GET /api/academy/state/?dashboard=true` returned HTTP `200`, `0` HTTP 403/5xx errors, `0` WS errors, clean Logout.
  2. **Switched Active Department = Tuition (`id=2`)**: Loaded `Tuition Department · Tuition Coordinator Panel` (`Students: 1`, `Teachers: 1`, `Coordinators: 2`), hit `/api/tuition/dashboard/?department_id=2` and `/api/tuition/attendance/?department_id=2&date=2026-11-18&page=1&page_size=500` (HTTP `200`), **`0` `/api/academy/state/` requests**, **`0` HTTP 403/5xx errors**, **`0` WS errors**, and no stale Quran data displayed.

## 7. WebSocket Error Investigation
- **Inspected**: `hooks/useAcademyWS.ts`, `App.tsx` logout/session handlers, `backend/academy/consumers.py`, Vite `/ws` proxy, and Daphne ASGI logs.
- **Findings**:
  1. `App.tsx` calls `useAcademyWS()` at the root, keeping `listeners.size >= 1` for the entire app lifetime.
  2. **Confirmed Lifecycle Defects**:
     - **Stale Socket Callback Race (`hooks/useAcademyWS.ts`)**: `onopen`, `onmessage`, `onerror`, and `onclose` did not check `ws === socket`, allowing a closing/superseded WebSocket's asynchronous `onclose` to set `ws = null` and `stopHeartbeat()` on a newly opened socket during logout/re-login.
     - **Premature `CONNECTING` Close (`hooks/useAcademyWS.ts`)**: `disconnectAcademyWS(true)` called `ws.close(1000, ...)` even when `readyState === WebSocket.CONNECTING`, which triggers browser `"closed before connection is established"` errors.
     - **Incomplete Logout Disconnect (`App.tsx`)**: Coordinator logout buttons called `disconnectAcademyWS()` (`force = false`, which is a no-op while `App` is mounted), and `TeacherPortal` / `StudentPortal` `onLogout` did not call `disconnectAcademyWS(true)`.
  3. **Attendance Tab Re-test**: On live re-verification across `#dashboard` -> `#scheduling` -> `#attendance` -> `#accounts` -> `#lessons` -> `#reports` -> Logout, **zero** `WS: Connection error` events occurred on `#attendance` or any other tab.

## 8. Confirmed WebSocket Correction
- Added `const socket = new WebSocket(url)` identity guards (`if (ws !== socket) return;`) across `onopen`, `onmessage`, `onerror`, and `onclose` in `hooks/useAcademyWS.ts`.
- Updated `disconnectAcademyWS(true)` to only call `activeSocket.close(1000, "Manual disconnect")` immediately when `activeSocket.readyState === WebSocket.OPEN` (detaching `CONNECTING` sockets so `onopen` closes them cleanly when superseded/manually closed).
- Updated all portal logout handlers in `App.tsx` to call `disconnectAcademyWS(true)`.
- Verified live WebSocket protocol via Vite `/ws` proxy (`ws://localhost:3000/ws/academy/`): `WS OPEN` -> `{"type": "connected", ...}` -> `{"type": "ping"}` -> `{"type": "pong"}` -> clean close `1000`, and confirmed Daphne logs `WebSocket HANDSHAKING /ws/academy/`, `WebSocket CONNECT /ws/academy/`, and `WebSocket DISCONNECT /ws/academy/`.

## 9. Browser Verification Results by Role
All temporary QA accounts (`qa_phase4dv3_coord`, `qa_phase4dv3_tuition`, `qa_phase4dv3_tuition_teacher`, `qa_phase4dv3_tuition_student`, `qa_phase4dv3_multidept`) were deleted after testing.

- **Quran Coordinator (`qa_phase4dv3_coord`)**: **PASS**
  - `#dashboard` (`Students: 976`, `Teachers: 76`, Insights `Today's Attendance` & `Timeline Today`), `#scheduling` (976-student matrix), `#attendance` (75 teachers / 831 sessions), `#accounts`, `#lessons` (Pending Requests: 35, Lessons: 56), `#reports`, and Logout all verified.
  - Zero `WS: Connection error` on `#attendance` and all other tabs; zero 5xx errors.
  - *(Observation: `tab_teacher_salary` is not enabled in `coordinator_tabs` for this coordinator account, and `#scheduling` matrix DOM size caused Playwright `OP_TIMEOUT` on subsequent actions while sitting on `#scheduling`.)*
- **Tuition Coordinator (`qa_phase4dv3_tuition`)**: **PASS**
  - Verified Dashboard, Accounts & Enrollment, Scheduling, Attendance, Reports, and Logout.
  - `0` `/api/academy/state/` requests, `0` HTTP 403/4xx/5xx responses, `0` WS/console errors.
- **Tuition Teacher (`qa_phase4dv3_tuition_teacher`)**: **PASS (State Isolation) / QA Profile Note**
  - Verified Tuition Teacher Portal (`Overview`, `Total Classes`, `Attendance`) and Logout with `0` `/api/academy/state/` requests and `0` WS/console errors. *(Temporary QA user had no `TuitionTeacherCapability` record, so `/api/tuition/teacher-portal/` returned expected 404/403 empty-profile responses.)*
- **Tuition Student (`qa_phase4dv3_tuition_student`)**: **PASS (State Isolation) / QA Profile Note**
  - Verified Tuition Student Portal (`Overview`, `Attendance`, `Assignments`, `Schedule`) and Logout with `0` `/api/academy/state/` requests, `0` HTTP 403 responses, and `0` WS/console errors. *(Temporary QA user had no `TuitionEnrollment` record, so `/api/tuition/student-portal/` returned expected 404; Logout required `{ force: true }` due to the pre-existing 3D Lanyard overlay.)*
- **Multi-Department User (`qa_phase4dv3_multidept`)**: **PASS**
  - Verified both Quran (`id=1`) and Tuition (`id=2`) department contexts with clean state isolation and zero errors.

## 10. TypeScript and Build Results
- `npm run typecheck` (`tsc --noEmit`): **Passed** (exit code `0`).
- `npm run build` (`vite build`): **Passed** (`3684 modules transformed`, built in `4m 6s`, `dist/` generated cleanly).

## 11. Automated Test Results
- `node --test tests\*.test.ts`: **80 passed, 0 failed, 0 skipped** (all 75 existing tests preserved + 5 new tests in `tests/phase4d_v3_state_and_ws.test.ts`).
- `.\backend\venv\Scripts\python.exe backend\manage.py check`: **Passed** (`System check identified no issues (0 silenced).`).

## 12. Remaining Defects
1. **Student 3D Lanyard Overlay (Deferred by Phase Scope)**: As noted in the phase brief, the 3D Lanyard overlay in Student portals overlaps KPI cards / mobile drawer / Logout button (`force: true` needed in Playwright) and was intentionally not modified in Phase 4D-V3.
2. **Large `#scheduling` Matrix DOM**: The 976-student `#scheduling` matrix DOM can still trigger `webview_browser` `OP_TIMEOUT` if automated actions are chained while sitting on `#scheduling`.

## 13. Phase-Specific Rollback Instructions
To revert only Phase 4D-V3 changes without disturbing earlier phases:
1. Restore `App.tsx` and `hooks/useAcademyWS.ts` to the pre-Phase-4D-V3 checkpoint (`pre_phase4d_v3.patch` or revert the Phase 4D-V3 hunks in `App.tsx` and `hooks/useAcademyWS.ts`).
2. Delete `tests/phase4d_v3_state_and_ws.test.ts` and `ARCHITECTURE_PHASE_4D_V3_RESULTS.md`.
(Do NOT run `git checkout -- .` or `git reset --hard`, as uncommitted work from earlier phases is in the working tree.)

## 14. Final Recommendation
**READY FOR PHASE 4E**
