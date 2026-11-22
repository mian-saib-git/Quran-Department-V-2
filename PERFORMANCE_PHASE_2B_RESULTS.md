# IVS Academy — Phase 2B Results: Frontend API Polling and Loading Optimization

**Date:** 2026-11-17  
**Scope:** Frontend-only polling, WebSocket coordination, and initial/tab-switch loading optimizations.  
**Backend / Schema / UI Design:** Unchanged.

---

## 1. Exact Files Modified / Added

1. `hooks/useAcademyWS.ts` *(modified)*
   - Tracks `hasConnectedOnce` so `"connected"` WebSocket events carry `isReconnect: boolean` (`false` on initial connect, `true` on subsequent reconnects; reset on `disconnectAcademyWS(true)`).
   - Exports `isAcademyWSConnected()` and `subscribeAcademyWSStatus(listener)` so polling hooks react to WebSocket connect/disconnect without opening extra sockets.
2. `hooks/useVisibilityPolling.ts` *(added)*
   - Shared visibility-aware and WebSocket-aware polling hook:
     - Pauses intervals completely when `document.visibilityState === "hidden"`.
     - Revalidates on returning to visibility if `Date.now() - lastRunAt >= staleOnVisibleMs` or if WebSocket is disconnected.
     - Uses `connectedIntervalMs` when WS is connected and `disconnectedIntervalMs` when WS is disconnected.
     - Guards against overlapping ticks with `inFlightRef` and cleans up timers/listeners on unmount.
3. `components/TeacherPortal.tsx` *(modified)*
   - Split `loadDashboard` into:
     - `loadCoreDashboard(silent)`: essential `getDjangoDashboard()`, `getLessonPermissions({ is_active: true })`, `getLessonAccessRequests({ status: "pending" })` with `coreInFlightRef` overlap protection.
     - `loadSecondaryLessons()`: `getLessons()` and `getDailyLessonReports()` loaded independently on mount, WS `lesson_saved`, manual refresh, or WS reconnect (not polled every tick).
     - `loadAuthFeatures()`: `getAuthContext()` loaded on mount and manual/reconnect refresh (not polled every tick).
   - Replaced the `12,000 ms` 6-endpoint `setInterval` with `useVisibilityPolling` (`connectedIntervalMs: 120_000`, `disconnectedIntervalMs: 45_000`, `staleOnVisibleMs: 30_000`).
   - Added `type === "connected" && Boolean(data.isReconnect)` handler to revalidate on WS reconnect without duplicating initial mount.
4. `components/StudentPortal.tsx` *(modified)*
   - Replaced `15,000 ms` `setInterval` with `useVisibilityPolling` (`connectedIntervalMs: 120_000`, `disconnectedIntervalMs: 45_000`, `staleOnVisibleMs: 30_000`).
   - Added `inFlightRef` overlap guard in `loadDashboard`.
   - Changed WS `"connected"` trigger to `type === "connected" && Boolean(event?.isReconnect)` to eliminate duplicate initial mount fetch.
5. `components/tuition/TuitionStudentPortal.tsx` & `components/tuition/TuitionTeacherPortal.tsx` *(modified)*
   - Replaced `30,000 ms` `setInterval` with `useVisibilityPolling` (`connectedIntervalMs: 120_000`, `disconnectedIntervalMs: 45_000`, `staleOnVisibleMs: 30_000`).
   - Added `inFlightRef` overlap guard in `loadPortal`.
   - Changed WS `"connected"` trigger to `type === "connected" && Boolean(event?.isReconnect)`.
6. `components/NotificationBell.tsx` *(modified)*
   - Removed the duplicate `new WebSocket(...)` connection; now subscribes to the shared `useAcademyWS` singleton for `notification_created` and `connected` (`isReconnect`).
   - Replaced the `30,000 ms` `setInterval` with `useVisibilityPolling` (`connectedIntervalMs: 120_000`, `disconnectedIntervalMs: 30_000`, `staleOnVisibleMs: 30_000`).
7. `hooks/useCompleteAttendance.ts` *(modified)*
   - Preserves loaded attendance rows in state when `enabled` toggles across tab switches (`Overview -> Attendance -> Overview -> Attendance`) for the same `key`, while still clearing and re-fetching when `key` changes or `reload()` is called.
8. `App.tsx` & `services/storageService.ts` *(modified)*
   - `App.tsx`: Replaced the `60,000 ms` maintenance `setInterval` with `useVisibilityPolling` (`connectedIntervalMs: 180_000`, `disconnectedIntervalMs: 60_000`, `staleOnVisibleMs: 60_000`); skipped `/api/academy/state/` in `loadInitialState` for `teacher`, `student`, and `tuition` sessions (which render their own dedicated portals).
   - `services/storageService.ts`: Removed unused `lastSyncedAttendanceJson = JSON.stringify(...)` and skipped redundant `readCache()` when `hasAuthToken()` is true.
9. `tests/phase2b_polling_and_ws.test.ts` *(added)*
   - 7 regression tests verifying polling intervals, visibility/overlap guards, WS `isReconnect` coordination, single WebSocket in `NotificationBell`, `useCompleteAttendance` cache preservation, and `App.tsx` role skip.

---

## 2. Root Cause of Each Unnecessary Request

1. **TeacherPortal 12s 6-endpoint polling:** `TeacherPortal.tsx` unconditionally polled `dashboard/`, `lessons/`, `daily-lesson-reports/`, `lesson-permissions/`, `lesson-access-requests/`, and `auth/context/` every 12s on desktop regardless of tab visibility or WS health.
2. **Duplicate initial fetch on WS `"connected"`:** `StudentPortal`, `TuitionStudentPortal`, and `TuitionTeacherPortal` all called `loadDashboard()`/`loadPortal()` on mount and immediately called it a second time when `useAcademyWS` emitted `"connected"`.
3. **Duplicate WebSocket + 30s poll in `NotificationBell`:** `NotificationBell.tsx` opened a second `WebSocket` connection to `/ws/academy/` alongside `useAcademyWS`.
4. **Tab-switch attendance re-fetches:** `useCompleteAttendance` cleared `result.rows` whenever `enabled` became `true` again after switching tabs.
5. **Unneeded `/api/academy/state/` on non-coordinator logins:** `App.tsx` fetched the `502.7 KB` `/api/academy/state/` payload for `teacher`, `student`, and `tuition` sessions even though those portals never read `appState`.

---

## 3. Polling Intervals Before vs. After (with Rationale)

| Component / Resource | Before (Desktop) | After (WS Connected, Visible) | After (WS Disconnected, Visible) | Hidden Tab | Rationale |
|---|---:|---:|---:|---:|---|
| `TeacherPortal` core (`dashboard`, `permissions`, `requests`) | 12s (6 endpoints) | **120s** (3 endpoints) | **45s** (3 endpoints) | **Paused (0)** | Real-time updates arrive via `useAcademyWS`; 120s is a safety net, 45s covers WS outage. |
| `TeacherPortal` secondary (`lessons`, `daily-lesson-reports`, `auth/context`) | 12s | **Mount / WS event / manual / reconnect** | **Mount / manual / reconnect** | **Paused (0)** | `daily-lesson-reports` is ~180 KB; updated via `lesson_saved` WS event and mutations. |
| `StudentPortal` (`dashboard`) | 15s + dup WS connect | **120s** | **45s** | **Paused (0)** | Updated via `useAcademyWS` (`attendance_marked`, `lesson_saved`, `academy_update`). |
| `TuitionStudentPortal` & `TuitionTeacherPortal` | 30s + dup WS connect | **120s** | **45s** | **Paused (0)** | Updated via `useAcademyWS` (`tuition_*_updated`, `attendance_marked`). |
| `NotificationBell` | 30s + 2nd WebSocket | **120s** (shared WS) | **30s** (shared WS) | **Paused (0)** | `notification_created` arrives over shared `useAcademyWS`. |
| `App.tsx` maintenance check | 60s | **180s** | **60s** | **Paused (0)** | `maintenance_updated` also arrives over `useAcademyWS`. |

---

## 4. Network Measurements (Calculated from Exact Intervals & Phase 1/2A Measured Payload Sizes)

*Limitation: Interactive browser DevTools 5-minute network capture was not available in this CLI environment; the 5-minute request counts and byte volumes below are analytically derived from the exact `setInterval` rates and the locally measured endpoint payload sizes from Phase 1/2A.*

| Scenario (5-Minute Window) | Requests Before | Requests After | Reduction | Notes |
|---|---:|---:|---:|---|
| **Teacher Portal (visible, idle, WS connected)** | `6 + (25 × 6) = 156` | `6 + (2 × 3) = 12` | **-92.3%** | Eliminates ~`4.5 MB` of `daily-lesson-reports` polls (at `179.7 KB`/poll) + `25` redundant `auth/context` & `dashboard` polls. |
| **Teacher Portal (hidden tab, 5 min)** | `150` | **0** | **-100%** | Polling paused while `document.visibilityState === "hidden"`; revalidates once on return if stale (`>= 30s`). |
| **Student Portal (visible, idle, WS connected)** | `2 + 20 = 22` | `1 + 2 = 3` | **-86.4%** | Eliminates duplicate initial WS `"connected"` fetch + 18 polls. |
| **Tuition Teacher / Student Portals (visible, idle)** | `2 + 10 = 12` | `1 + 2 = 3` | **-75.0%** | Eliminates duplicate initial WS `"connected"` fetch + 8 polls. |
| **Tab Switch (`Overview -> Attendance -> Overview -> Attendance`)** | Re-fetches all attendance pages on every switch | **0** on return | **-100% repeat** | `useCompleteAttendance` preserves cached rows for unchanged `key`. |
| **WebSocket Connections per User** | `2` (`useAcademyWS` + `NotificationBell`) | **1** (`useAcademyWS` only) | **-50%** | `NotificationBell` shares `useAcademyWS`. |
| **Non-Coordinator Initial Login (`Teacher`/`Student`/`Tuition`)** | Includes `502.7 KB` `/api/academy/state/` | **0** `/api/academy/state/` | **-502.7 KB** | Skipped in `App.tsx` `loadInitialState`. |

---

## 5. Test & Build Results

- `npm run typecheck` (`tsc --noEmit`): **Passed** (0 errors).
- `npm run build` (`vite build`): **Passed** in `46.70s` (`3675` modules transformed).
- `node --experimental-strip-types --test tests/attendance_editor_incremental_update.test.ts tests/phase2b_polling_and_ws.test.ts`: **Passed** (`14/14` tests passed in `431.0 ms`).

---

## 6. Confirmation of Preserved Functionality & Remaining Limitations

- **Preserved:** Manual refresh buttons, WS real-time updates (`attendance_marked`, `lesson_saved`, `permission_granted`, `permission_disabled`, `request_reviewed`, `tuition_*_updated`, `notification_created`, `maintenance_updated`), WS reconnect revalidation (`isReconnect`), department isolation, and session expiry handling remain intact.
- **Remaining Limitations (Deferred to Later Phases):**
  - Root-level 1-second `clockNow` `setInterval` in `TeacherPortal`, `StudentPortal`, `TuitionStudentPortal`, and `TuitionTeacherPortal` still re-renders portal trees every second (UI component isolation planned separately).
  - Eager `Lanyard` 3D import (`3.34 MB` chunk) in Student portals is unchanged in Phase 2B.
  - Live browser DevTools waterfall / LCP / FCP measurements were not captured in this CLI environment.

---

## 7. Rollback Instructions

To revert Phase 2B cleanly:
```powershell
git checkout -- App.tsx hooks/useAcademyWS.ts hooks/useCompleteAttendance.ts components/NotificationBell.tsx components/TeacherPortal.tsx components/StudentPortal.tsx components/tuition/TuitionStudentPortal.tsx components/tuition/TuitionTeacherPortal.tsx services/storageService.ts
Remove-Item hooks/useVisibilityPolling.ts, tests/phase2b_polling_and_ws.test.ts
```
