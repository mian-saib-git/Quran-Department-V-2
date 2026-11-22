# IVS Academy — Phase 1 Performance Investigation Report

**Date:** 2026-11-17  
**Scope:** Investigation only (no application source code, database schema, or production data modified).  
**Stack:** React 19, TypeScript, Vite 6, Django, Django REST Framework, PostgreSQL, Django Channels (WebSockets).

---

## Executive Summary & Measurement Methodology

### What Was Directly Measured
1. **Production Build Artifacts (`dist/assets/`):** Exact file sizes of all compiled JS, CSS, and 3D assets.
2. **Source Code Inspection:** Static analysis of `App.tsx`, portals (`TeacherPortal.tsx`, `StudentPortal.tsx`, `TuitionStudentPortal.tsx`, `TuitionTeacherPortal.tsx`, `PlatformAdmin.tsx`), `AttendanceEditor.tsx`, `ReportsTab.tsx`, `NotificationBell.tsx`, hooks, services, and Django backend modules (`academy`, `accounts`, `salary`, `tuition`).
3. **Local PostgreSQL & Django Profiling (Read-Only):** Executed `APIClient` GET requests against the local PostgreSQL database (`1,265` Users, `129` Teachers, `1,157` Students, `5,438` ClassSchedules, `61,364` Attendance rows, `3,260` DailyLessonReports) using `CaptureQueriesContext` and `EXPLAIN ANALYZE`.

### Measurement Limitations
- **Interactive Browser Profiling:** Live browser DevTools network waterfalls, First Contentful Paint (FCP), Largest Contentful Paint (LCP), and React DevTools Profiler flamegraphs were **not** captured in this environment. Frontend render durations and browser waterfall timings are therefore **explicitly labeled as Estimates / Hypotheses** rather than observed browser measurements.

---

## Baseline Measurements

### 1. Production Bundle & Asset Baseline (`dist/assets/`)
| Asset | Size (KB) | Notes |
|---|---:|---|
| `Lanyard-BkYpJhrR.js` | **3,259.03** | Three.js + `@react-three/fiber` + `@react-three/drei` + `@react-three/rapier` + `meshline` (eagerly imported by Student portals) |
| `exceljs.min-CLXqOLuY.js` | 918.16 | Dynamically imported on export in `ReportsTab.tsx` / `TuitionReports.tsx` |
| `index-DWtOL0L4.js` | **393.86** | Initial main JS bundle (`App.tsx` + shared services) |
| `PlatformAdmin-gmHhMnSz.js` | 384.95 | Lazy-loaded Platform Admin chunk |
| `jspdf.es.min-C8piXa2S.js` | 381.43 | Dynamically imported on PDF export |
| `BarChart-C3wJSec0.js` | 317.78 | Recharts chunk (lazy-loaded with `ReportsTab` / `DashboardTimelineChart`) |
| `index-BF231Ns5.css` | **282.55** | Single global CSS bundle |
| `TuitionCoordinatorPortal-gU43lzKC.js` | 225.28 | Lazy-loaded Tuition Coordinator chunk |
| `TeacherPortal-Cbs_DlVv.js` | 126.30 | Lazy-loaded Quran Teacher Portal chunk |
| `StudentPortal-CHno8b5y.js` | 65.18 | Lazy-loaded Quran Student Portal chunk (triggers `Lanyard` 3.26 MB download on mount) |
| `ReportsTab-BFlS0pHq.js` | 69.99 | Lazy-loaded Reports chunk |
| `AttendanceEditor-778Ti7Gb.js` | 34.76 | Lazy-loaded Attendance Editor chunk |

### 2. Backend Endpoint Baseline (Local PostgreSQL, Read-Only `APIClient`)
| Role | Endpoint | Status | Total Time (ms) | SQL Queries | SQL Time (ms) | Payload Size (KB) |
|---|---|---:|---:|---:|---:|---:|
| Coordinator | `GET /api/auth/context/` | 200 | 309.7 | 7 | 47.0 | 1.5 |
| Coordinator | `GET /api/academy/dashboard/` | 200 | **379.8–630.8** | **164** | **171.0** | 90.1 |
| Coordinator | `GET /api/academy/state/?dashboard=true` | 200 | 300.6 | 7 | 31.0 | 174.6 |
| Coordinator | `GET /api/academy/state/` | 200 | 277.6 | 8 | 47.0 | **502.7** |
| Coordinator | `GET /api/academy/attendance/?page=1&page_size=500` | 200 | 271.5 | 4 | 94.0 | 223.0 |
| Coordinator | `GET /api/academy/daily-lesson-reports/` | 200 | **934.9** | 5 | 126.0 | **2,634.2** |
| Coordinator | `GET /api/auth/notifications/` | 200 | 11.5 | 3 | 0.0 | 0.1 |
| Teacher (busiest) | `GET /api/academy/dashboard/` | 200 | **309.7–355.0** | **172** | **173.0** | 82.1 |
| Teacher (busiest) | `GET /api/academy/daily-lesson-reports/` | 200 | 75.3 | 8 | 16.0 | 179.7 |
| Teacher (busiest) | `GET /api/academy/lessons/` | 200 | 15.9 | 7 | 0.0 | 0.2 |
| Student | `GET /api/academy/dashboard/` | 200 | 71.1 | **29** | 47.0 | 18.7 |
| Student | `GET /api/academy/attendance/?scope=dashboard&page=1&page_size=500` | 200 | 35.2 | 8 | 16.0 | 16.0 |
| Dept Admin | `GET /api/salary/assignments/?department_id=1` | 200 | 171.4 | 6 | 47.0 | **2,672.7** |
| Platform Admin | `GET /api/auth/platform/analytics/` | 200 | 190.9 | 24 | 157.0 | 3.1 |
| Coordinator | `GET /api/academy/attendance/report-sessions/?date_from=2026-11-01&date_to=2026-11-17` | **500** | — | — | — | — (`AttributeError` in `attendance_report_sessions_api.py:85`) |

---

## Task 5: Top 10 Highest-Priority Performance Findings

### Finding 1: Severe N+1 Queries in `DashboardView` (`164`–`172` SQL Queries per Request)
- **Exact Location:** `backend/academy/views.py` lines `271–322` (`student_payload`, `schedule_payload`), `880–1161` (`DashboardView.get`).
- **Cause:**
  1. `schedule_payload(schedule)` (lines `299–302`) executes `StudentSubject.objects.filter(student=student, is_active=True)` **for every schedule row**, ignoring `assigned_subjects_from_prefetch(student)` (and the `DashboardView` schedule querysets do not prefetch `student__assigned_subjects` despite comments at lines `919–922` and `980–986` claiming they do).
  2. `student_payload(student)` (lines `273–275`) executes `ClassSchedule.objects.filter(student=student).order_by("id").first()` **for every student**, even when `schedules` were already prefetched.
- **Evidence:** `CaptureQueriesContext` on `GET /api/academy/dashboard/`:
  - Coordinator: **164 queries** (`151` on `academy_studentsubject`), `379.8–630.8 ms`.
  - Busiest Teacher: **172 queries** (`128` on `academy_studentsubject`, `32` on `academy_classschedule`), `309.7–355.0 ms`.
  - Student: **29 queries**, `71.1 ms`.
- **Expected Benefit:** Reduces `DashboardView` from `164–172` SQL queries to **~6–10 queries** (estimated `70–85%` reduction in DB/API latency, especially impactful when combined with Teacher polling).
- **Risk:** Low. Read-only serialization change; must preserve exact JSON shape (`assigned_subjects`, `enrollment_date`).
- **Recommended Implementation:** Prefetch `student__assigned_subjects` with `to_attr="prefetched_active_subjects"` on schedule querysets, update `schedule_payload` to call `assigned_subjects_from_prefetch(student)`, and derive `first_schedule` in `student_payload` from prefetched schedules (with DB fallback only for single-object callers).
- **Required Tests:** Assert identical JSON payload for Coordinator, Teacher, and Student dashboards before/after, plus `assertNumQueries` regression tests (`<= 12` queries).

---

### Finding 2: Teacher Portal Polls 6 API Endpoints Every 12 Seconds (+ Duplicate WS/Clock Overhead)
- **Exact Location:** `components/TeacherPortal.tsx` lines `1068–1100` (`loadDashboard`, `useEffect`).
- **Cause:** `loadDashboard` fires **6 parallel HTTP requests** (`getDjangoDashboard()`, `getLessons()`, `getDailyLessonReports()`, `getLessonPermissions({ is_active: true })`, `getLessonAccessRequests({ status: "pending" })`, `getAuthContext()`), and `useEffect` schedules `window.setInterval(() => void loadDashboard(true), 12000)` on desktop (`60000 ms` on mobile `< 768px`), **without** checking `document.visibilityState === "hidden"` or suppressing polling when `useAcademyWS` is connected.
- **Evidence:** Confirmed directly in `TeacherPortal.tsx:1071-1078, 1096-1097`. This generates **30 HTTP requests/minute per active desktop teacher**, where `getDjangoDashboard()` alone currently executes **172 SQL queries**.
- **Expected Benefit:** Eliminates ~`80–90%` of background API and DB load from active teacher sessions; removes periodic UI/network contention.
- **Risk:** Low–Medium. Must keep WebSocket event handlers (`useAcademyWS`) and fallback polling when WS is disconnected so teachers never miss permission approvals or schedule changes.
- **Recommended Implementation:** Pause polling when `document.visibilityState === "hidden"`, increase fallback interval (e.g., `60s–120s`) when WS is connected, and avoid re-fetching `getAuthContext()` on every silent poll.
- **Required Tests:** Verify WS events (`permission_granted`, `attendance_marked`, `lesson_saved`, `academy_update`) still update UI immediately; verify fallback polling triggers on `visibilitychange` to `visible` and when WS is disconnected.

---

### Finding 3: Root-Level 1-Second Clock `setInterval` Re-Renders Entire Portal Trees Every Second
- **Exact Location:**
  - `components/TeacherPortal.tsx` lines `899, 1098` (`4,742` lines)
  - `components/StudentPortal.tsx` lines `698, 740` (`3,026` lines)
  - `components/tuition/TuitionStudentPortal.tsx` lines `617` (`1,635` lines)
  - `components/tuition/TuitionTeacherPortal.tsx` lines `316` (`1,174` lines)
- **Cause:** Top-level portal components store `clockNow` / `now` in root `useState` and call `setInterval(() => setClockNow(new Date()), 1000)`. Every second, React re-executes the entire 1,174–4,742-line component render function and reconciles the full portal DOM. Notably, `PlatformAdmin.tsx:240` (`PlatformClock`) and `IVSClockCard.tsx:31` already isolated this timer.
- **Evidence:** Direct code inspection (`git grep -n setInterval`). *(Estimated render cost: 5–25 ms main-thread work every 1,000 ms on low/mid-tier devices, causing input/scroll/tab-switch jank.)*
- **Expected Benefit:** Eliminates 60 full-portal React reconciliation cycles per minute per open tab.
- **Risk:** Very Low. UI clock display remains visually identical.
- **Recommended Implementation:** Extract clock display and `clockNow` state into a small isolated child component (or pass no `now` prop to `IVSClockCard`, which already manages its own `internalNow` timer).
- **Required Tests:** React component test / manual check verifying clock continues ticking every second while parent portal render count stays `0` per second.

---

### Finding 4: 3.26 MB 3D `Lanyard` Bundle Eagerly Imported on Student Portals
- **Exact Location:** `components/StudentPortal.tsx:37` and `components/tuition/TuitionStudentPortal.tsx:44` (`import Lanyard from "./tuition/lanyard/Lanyard"`).
- **Cause:** Static ES import of `Lanyard` forces Vite to download and initialize `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier` (physics WASM), and `meshline` (**`Lanyard-BkYpJhrR.js`: 3,259.03 KB**) immediately when `StudentPortal` or `TuitionStudentPortal` mounts.
- **Evidence:** Observed in `dist/assets/Lanyard-BkYpJhrR.js` (`3,259.03 KB`) and `StudentPortal.tsx:37`, `TuitionStudentPortal.tsx:44`.
- **Expected Benefit:** Removes **3.26 MB** of JS + WebGL/WASM initialization from the critical path of Student Portal initial load.
- **Risk:** Low. Preserves the 3D ID card feature completely when lazy-loaded or deferred until the card is toggled/visible.
- **Recommended Implementation:** Convert `Lanyard` to `React.lazy(() => import(...))` wrapped in `<Suspense>` (and optionally render only when expanded/visible or after initial portal hydration).
- **Required Tests:** Verify Student Portal initial chunk load excludes `Lanyard-*.js` until card is rendered, and verify front/back 3D card still renders and flips properly.

---

### Finding 5: `MaintenanceAwareJWTAuthentication` Runs 3 Extra SQL Queries on Every Authenticated Request
- **Exact Location:** `backend/accounts/authentication.py:13–45`, `backend/accounts/platform_communications.py:30–128`.
- **Cause:** On every authenticated request (except `/api/auth/context/` and `/api/auth/notices/active/`), `active_maintenance_for_user(user)` queries `accounts_department` (lazy FK on `user.department`), `accounts_userdepartmentrole`, and `accounts_platformmaintenancewindow` with **zero caching**. By contrast, `backend/accounts/platform_runtime.py:81–99` already caches `PlatformSetting` for 60s via `django.core.cache`.
- **Evidence:** Confirmed in `CaptureQueriesContext` (e.g., Teacher `/api/academy/lessons/` ran 7 queries, 4 of which were auth/maintenance lookups for an empty `Lesson` table).
- **Expected Benefit:** Eliminates 2–3 SQL queries from **100% of authenticated API requests** while keeping maintenance enforcement accurate.
- **Risk:** Low–Medium. Must invalidate cache immediately whenever `PlatformMaintenanceWindow` or `UserDepartmentRole` is saved/deleted.
- **Recommended Implementation:** Cache active maintenance windows (short TTL, e.g., 30–60s, invalidated on `PlatformMaintenanceWindow` save/delete) and cache/prefetch user department scope, or avoid querying `PlatformMaintenanceWindow` per-user when no active maintenance window exists globally.
- **Required Tests:** Test that enabling/disabling platform, institution, or department maintenance immediately returns HTTP `423` / `200` as expected, and verify auth query count drops.

---

### Finding 6: Unpaginated Multi-Megabyte API Payloads (`daily-lesson-reports/` & `salary/assignments/`)
- **Exact Location:**
  - `backend/academy/views.py:1921–1978` (`DailyLessonReportListCreateView.get`)
  - `backend/salary/views.py:1504–1560` & `backend/salary/serializers.py:400–435` (`TeacherPolicyAssignmentViewSet`, `TeacherPolicyAssignmentSerializer`)
  - `backend/academy/views.py:1171–1235` (`LessonListCreateView.get`)
- **Cause:**
  1. `DailyLessonReportListCreateView.get` returns all `DailyLessonReport` rows + nested `subject_entries` with no pagination.
  2. `TeacherPolicyAssignmentSerializer` includes `archived_policy_snapshot` (a full JSON policy/rate-matrix blob) on every row of an unpaginated list endpoint.
- **Evidence:** Measured in local PostgreSQL:
  - `GET /api/academy/daily-lesson-reports/` (Coordinator): **934.9 ms**, **2,634.2 KB (2.63 MB)** JSON.
  - `GET /api/salary/assignments/?department_id=1` (Dept Admin): **171.4 ms**, **2,672.7 KB (2.67 MB)** JSON.
- **Expected Benefit:** Reduces payload sizes by `80–95%` and cuts serialization + browser `JSON.parse()` time dramatically.
- **Risk:** Medium. Frontend consumers expecting all rows must either use pagination or opt into a lightweight list serializer (omitting `archived_policy_snapshot` unless requested).
- **Recommended Implementation:** Add optional/default pagination and date-range defaults on `daily-lesson-reports/`, and omit `archived_policy_snapshot` from the list serializer (or return it only when `policy` is null / on detail view).
- **Required Tests:** Verify `ReportsTab`, `TeacherPortal`, and `TeacherSalaryAssignments` still display all required rows and archived snapshot details without regression.

---

### Finding 7: Student & Tuition Portals Duplicate Initial Fetch on WebSocket `"connected"` Event + Poll Every 15–30s
- **Exact Location:**
  - `components/StudentPortal.tsx:735–772` (`15s` poll + `type === "connected"` triggers `loadDashboard(true)`)
  - `components/tuition/TuitionStudentPortal.tsx:614–637` (`30s` poll + `type === "connected"` triggers `loadPortal(true)`)
  - `components/tuition/TuitionTeacherPortal.tsx:313–335` (`30s` poll + `type === "connected"` triggers `loadPortal(true)`)
- **Cause:** On mount, `useEffect` calls `loadDashboard()` / `loadPortal()`. Milliseconds later, `useAcademyWS` connects and emits `{ type: "connected" }`, which triggers a **second** `loadDashboard(true)` / `loadPortal(true)`. Additionally, `StudentPortal` polls every `15s` on desktop regardless of tab visibility or WS health.
- **Evidence:** Direct code inspection of all three components.
- **Expected Benefit:** Cuts initial portal API requests in half and reduces unnecessary background polling.
- **Risk:** Very Low. Removing `"connected"` from the reload trigger only stops the redundant mount-time refetch (real update events remain subscribed).
- **Recommended Implementation:** Remove `type === "connected"` from the reload condition in all three portals, and add `document.visibilityState === "visible"` guard + WS-aware interval backoff.
- **Required Tests:** Verify portal loads once on mount and still auto-refreshes on `attendance_marked`, `lesson_saved`, and `tuition_*_updated` WS events.

---

### Finding 8: `useCompleteAttendance` Wipes Cache & Re-Fetches All Historical Pages on Every Tab Switch
- **Exact Location:** `hooks/useCompleteAttendance.ts:8–18`, `services/attendancePaging.ts:18–49`, `components/StudentPortal.tsx:800`, `components/TeacherPortal.tsx:1502`, `components/tuition/TuitionStudentPortal.tsx:651`, `components/tuition/TuitionTeacherPortal.tsx:346`.
- **Cause:** Portals pass `activeTab === "attendance"` as `enabled` to `useCompleteAttendance`. Switching from `attendance` to `overview` and back flips `enabled` (`true -> false -> true`), which re-runs `useEffect`, immediately executes `setResult({ key: "", rows: [], error: "" })`, and sequentially re-fetches **all** paginated attendance pages (`page_size=500`) from page 1.
- **Evidence:** Direct code inspection of `useCompleteAttendance.ts:8-18` and portal call sites.
- **Expected Benefit:** Eliminates repeated full-history attendance waterfalls and loading skeletons when switching tabs.
- **Risk:** Low. Must still invalidate/refresh when an attendance mutation or WS `attendance_marked` event occurs.
- **Recommended Implementation:** In `useCompleteAttendance`, avoid clearing `result.rows` when `enabled` toggles if `result.key === requestKey` already holds valid data (or keep a `loadedOnce` / stale-while-revalidate flag, invalidated by `reload()` or WS events).
- **Required Tests:** Switch `overview -> attendance -> overview -> attendance` and verify 0 duplicate `/api/academy/attendance/` requests on the second visit unless data changed.

---

### Finding 9: `App.tsx` Loads Full `/api/academy/state/` for Non-Coordinator Roles & on Tab Switches
- **Exact Location:** `App.tsx:1675–1710`, `App.tsx:1741–1749`, `services/storageService.ts:188–228`.
- **Cause:**
  1. `loadInitialState` only skips `/api/academy/state/` for `platform_admin` (`isMainAdminSession`). For `teacher`, `student`, and `tuition` roles, `isDashboardRequest` is `false`, so `App.tsx` fetches the **full 502.7 KB** `/api/academy/state/` even though `App.tsx` renders `<TeacherPortal />`, `<StudentPortal />`, or `<Tuition*Portal />` which fetch their own data.
  2. When a Coordinator leaves `dashboard` for any other tab, `App.tsx:1742` triggers `loadState(false)` (502.7 KB) + `saveState` serializes the full state to `localStorage` (`1500 ms` later).
  3. `storageService.ts:199` computes `lastSyncedAttendanceJson = JSON.stringify(normalized.attendance)` on every fetch and never reads it, and `readCache()` at line `205` synchronously parses `localStorage` even when `hasAuthToken()` is true and discards the result.
- **Evidence:** Measured `/api/academy/state/` = **502.7 KB**, `277.6 ms` on Coordinator; confirmed `App.tsx:1677-1710` does not skip `loadState` for `teacher`, `student`, or `tuition` roles.
- **Expected Benefit:** Saves ~`500 KB` + `277 ms` on every Teacher, Student, and Tuition login/refresh, and removes dead `JSON.parse`/`JSON.stringify` main-thread work.
- **Risk:** Low–Medium. Must verify no child component rendered for `teacher`/`student`/`tuition` reads `appState`.
- **Recommended Implementation:** Skip `loadState()` in `App.tsx` for `teacher`, `student`, and `tuition` sessions; remove unused `lastSyncedAttendanceJson` and eager `readCache()` in `storageService.ts`.
- **Required Tests:** Login as Quran Teacher, Quran Student, Tuition Coordinator/Teacher/Student and verify zero `/api/academy/state/` requests and 100% intact portal rendering.

---

### Finding 10: Duplicate WebSocket Connection in `NotificationBell.tsx` & Non-Sargable `Attendance` Pagination Queries
- **Exact Location:**
  - `components/NotificationBell.tsx:80–97` (opens a second `WebSocket` to `/ws/academy/` alongside `hooks/useAcademyWS.ts` + polls every 30s)
  - `backend/academy/attendance_pagination.py:38, 58, 67` (`updated_at__date__gte/lte`, per-page `Count("id")` `GROUP BY status`)
  - `backend/academy/models.py:656–660` (missing `(department_id, updated_at)` index on `Attendance`)
- **Cause:**
  1. `NotificationBell` creates its own `WebSocket` instead of subscribing to the shared `useAcademyWS` singleton.
  2. `attendance_page` runs `GROUP BY status` `Count("id")` on every page request (`EXPLAIN ANALYZE` shows a **Seq Scan of 61,364 rows** taking `23.69 ms` for department-wide counts), and `updated_at__date__gte/lte` prevents index usage on `updated_at`.
- **Evidence:** Direct code inspection + PostgreSQL `EXPLAIN ANALYZE` on `academy_attendance`.
- **Expected Benefit:** Halves WebSocket connections per user (`2 -> 1`) and speeds up `ReportsTab` / `AttendanceEditor` paginated queries.
- **Risk:** Low.
- **Recommended Implementation:** Route `NotificationBell` through `useAcademyWS`; replace `updated_at__date__gte/lte` with timezone-aware datetime bounds (`updated_at__gte` / `updated_at__lt`); skip redundant `status_counts` / `Max("id")` when `page > 1` with `snapshot` already provided (only if frontend doesn't require re-computing on page > 1).
- **Required Tests:** Verify live notifications still arrive in `NotificationBell`; verify `collectAttendancePages` snapshot consistency tests pass.

*(Additional incidental bug observed during profiling: `GET /api/academy/attendance/report-sessions/` raised `500 AttributeError` at `backend/academy/attendance_report_sessions_api.py:85` when `teacher.user` is `None`.)*

---

## Task 6: Phase 2 Preparation — First 5 Frontend Fixes (Priority Order)

Prioritized by **highest performance impact + lowest regression risk**:

### 1. Isolate 1-Second Clock Timers Out of Root Portal Components
- **Files to Change:** `components/TeacherPortal.tsx`, `components/StudentPortal.tsx`, `components/tuition/TuitionStudentPortal.tsx`, `components/tuition/TuitionTeacherPortal.tsx` (reusing `components/IVSClockCard.tsx` or a tiny `<PortalClock />` component).
- **Why Necessary:** Eliminates 60 full-portal React re-renders per minute on 1,174–4,742-line components.
- **Behavior Preservation:** `IVSClockCard` already has its own `internalNow` 1-second timer when `now` is omitted (`IVSClockCard.tsx:31-36`). Any other time string in the header moves into `<PortalClock />` with identical markup/classes.
- **Success Measurement:** React DevTools Profiler / render counter shows `0` root portal renders per second while idle; clock UI updates every second.
- **Rollback:** Revert the 4 portal files (isolated UI-only refactor, zero API/state impact).

### 2. Lazy-Load the 3.26 MB 3D `Lanyard` Component
- **Files to Change:** `components/StudentPortal.tsx`, `components/tuition/TuitionStudentPortal.tsx`.
- **Why Necessary:** Removes `Lanyard-BkYpJhrR.js` (**3,259.03 KB**) and Three.js/Rapier WASM initialization from initial Student Portal load.
- **Behavior Preservation:** Wrap `React.lazy(() => import(...))` in `<Suspense fallback={...}>` so the 3D student ID card renders identically when shown.
- **Success Measurement:** Vite build output + browser Network tab confirm `Lanyard-*.js` is not requested until the card is rendered; initial Student Portal JS download drops by ~3.26 MB.
- **Rollback:** Restore static `import Lanyard` in the 2 files.

### 3. Fix Teacher, Student, and Tuition Portal Polling + Duplicate WS `"connected"` Fetch
- **Files to Change:** `components/TeacherPortal.tsx`, `components/StudentPortal.tsx`, `components/tuition/TuitionStudentPortal.tsx`, `components/tuition/TuitionTeacherPortal.tsx`.
- **Why Necessary:** Stops Teacher Portal from firing 6 API calls every 12 seconds (including `172`-query `dashboard/`), stops background-tab polling, and removes duplicate mount-time fetches triggered by WS `"connected"`.
- **Behavior Preservation:** Keep all real-time `useAcademyWS` data event handlers (`attendance_marked`, `lesson_saved`, `permission_granted`, `academy_update`, `tuition_*_updated`) intact; retain a visibility-aware fallback poll (e.g., `60s`) and immediate refresh on `visibilitychange` when returning to a stale tab.
- **Success Measurement:** Network tab over a 2-minute idle session shows ~`85–90%` fewer background XHR/fetch requests and `1` initial dashboard load instead of `2`.
- **Rollback:** Restore the original `setInterval` values and `"connected"` handler.

### 4. Preserve `useCompleteAttendance` Cache Across Tab Switches
- **Files to Change:** `hooks/useCompleteAttendance.ts` (and verify call sites in `components/StudentPortal.tsx`, `components/TeacherPortal.tsx`, `components/tuition/TuitionStudentPortal.tsx`, `components/tuition/TuitionTeacherPortal.tsx`).
- **Why Necessary:** Prevents wiping loaded attendance rows and re-fetching all historical pages sequentially every time a user clicks away from and back to the `attendance` tab.
- **Behavior Preservation:** Only skip clearing/re-fetching when `result.key === requestKey` is already populated for the current key; explicit `reload()` (or key change when date range/filter changes) still clears and re-fetches identically.
- **Success Measurement:** Switching `Overview -> Attendance -> Overview -> Attendance` triggers `0` new `/api/academy/attendance/` requests on the second visit.
- **Rollback:** Revert `hooks/useCompleteAttendance.ts`.

### 5. Skip `loadState()` for Non-Coordinator Roles in `App.tsx` & Remove Dead Serialization in `storageService.ts`
- **Files to Change:** `App.tsx`, `services/storageService.ts`.
- **Why Necessary:** Stops fetching the **502.7 KB** `/api/academy/state/` payload on Teacher, Student, and Tuition portal logins, and removes dead `JSON.stringify` / redundant `readCache()` work on the main thread.
- **Behavior Preservation:** Only skip `loadState()` when the session role/department routes to `TeacherPortal`, `StudentPortal`, `Tuition*Portal`, or `PlatformAdmin` (none of which consume `appState`); Quran Coordinator/Admin behavior remains unchanged.
- **Success Measurement:** Network tab on Teacher/Student/Tuition login shows `0` requests to `/api/academy/state/`.
- **Rollback:** Revert the role guard in `App.tsx:1677` and `storageService.ts`.
