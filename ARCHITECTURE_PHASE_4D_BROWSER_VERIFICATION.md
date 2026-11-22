# ARCHITECTURE PHASE 4D-V: Browser Regression and Functional Verification

## 1. Test Environment

- **Frontend Dev Server**: Vite listening on `http://localhost:3000/` (proxying `/api` to `http://127.0.0.1:5000`).
- **Backend Server**: Django running on `127.0.0.1:5000` connected to local PostgreSQL (`ivs_academy_localdev`).
- **Test Accounts**: Temporary localdev `qa_phase4dv_*` accounts were used during browser testing and deleted immediately afterward (`CLEANED: (9, {'accounts.UserDepartmentRole': 4, 'academy.StudentProfile': 1, 'accounts.User': 4})`). No passwords, JWT tokens, session cookies, or private student data are included in this report.

---

## 2. Browser Testing Tools Used

- Built-in `browser` subagent (`webview_browser` / Playwright-backed webview).
- **Host-Verified Evidence**:
  - `visited_origins`: `http://localhost:3000`
  - `blocked_origins`: `none`
  - `latest_screenshot`: `final_step_32.png` (showing `DepartmentWorkspaceLoading` skeleton shell).

---

## 3. Tested Roles and Workflows

| Role / Portal | Status | Notes |
|---|---|---|
| Unauthenticated (`LoginScreen`, Phase 4A) | **PASS** | Loaded at `1280x800`, tested password toggle, remember-me checkbox, invalid login (`401` + error banner), and valid login (`200`). |
| Quran Coordinator (`#dashboard`, Phases 4B–4D) | **PARTIAL PASS** | Verified `TopbarClock`, `DashboardBackdrop`, `DepartmentWorkspaceLoading`, all 4 `CoordinatorDashboardKpis` cards, and `CoordinatorLiveClassesSection` (`Live Now` + `Up Next` cards). Blocked on `OP_TIMEOUT` before expanding Insights, switching tabs, or logging out. |
| Quran Coordinator (other tabs & mobile) | **NOT RUN (BLOCKED)** | `webview_browser` became unresponsive (`OP_TIMEOUT`) after `#dashboard` / `#scheduling` data load. |
| Teacher (`TeacherPortal`) | **NOT RUN (BLOCKED)** | Second browser subagent hit `OP_TIMEOUT` on all webview IPC calls. |
| Student (`StudentPortal`) | **NOT RUN (BLOCKED)** | Blocked by `webview_browser` `OP_TIMEOUT`. |
| Tuition Coordinator (`TuitionCoordinatorPortal`) | **NOT RUN (BLOCKED)** | Blocked by `webview_browser` `OP_TIMEOUT`. |

---

## 4. Desktop and Mobile Verification Results

- **Desktop (`1280x800`)**:
  - `LoginScreen` rendered cleanly with expected layout and controls.
  - Coordinator `#dashboard` rendered `TopbarClock` (`06:20 PM`, `Tuesday | Nov 17`), `CoordinatorDashboardKpis` 4-column grid, and `CoordinatorLiveClassesSection` 2-column grid (`Live Now` and `Up Next`).
  - `DepartmentWorkspaceLoading` skeleton rendered cleanly in `final_step_32.png`.
- **Mobile (`390x844`)**: **NOT VERIFIED** due to `webview_browser` `OP_TIMEOUT`.

---

## 5. Login and Navigation Results

- **Initial Load (`http://localhost:3000/`)**: HTTP `200`, 50 requests (`200`/`304`), **0 failed requests**, **0 console errors**.
- **Password Visibility Toggle**: Verified `aria-label` toggled `"Show password"` → `"Hide password"` → `"Show password"` and input `type` toggled `"password"` → `"text"` → `"password"`.
- **Remember Me**: Checkbox toggled `false` → `true`.
- **Invalid Credentials**: `POST /api/auth/login/` returned `401 Unauthorized` and rendered `"Invalid username or password."`.
- **Valid Login**: `POST /api/auth/login/` returned `200` and navigated to `http://localhost:3000/#dashboard`.
- **Post-Login API Calls**: `GET /api/auth/context/`, `GET /api/academy/state/?dashboard=true`, `GET /api/auth/notifications/?page=1`, and `GET /api/auth/notices/active/` all returned HTTP `200`.

---

## 6. Attendance and Scheduling Checks

- **KPI Summary Cards (`CoordinatorDashboardKpis`, Phase 4D)**:
  - `Students`: **977**
  - `Teachers`: **77**
  - `Live Now`: **34** (`06:00 PM`)
  - `Up Next`: **68** (`06:30 PM`)
- **Live Now & Up Next (`CoordinatorLiveClassesSection`, Phase 4C)**:
  - `Live Now` rendered `34 classes` with active class cards (`6:00 PM – 6:30 PM`, `5 days / week`, `11 min left`) and independent Student/Teacher attendance buttons (`Present`, `Absent`, `Leave`, `Unmark`).
  - `Up Next` rendered upcoming class cards (`6:30 PM – 7:00 PM`, `11 min`).
- **Interactive Attendance Mutation / Coverage / `#scheduling` Grid**: **NOT VERIFIED** due to `OP_TIMEOUT`.

---

## 7. Salary and Lesson History Checks

- **NOT VERIFIED** in browser due to `webview_browser` `OP_TIMEOUT`.

---

## 8. WebSocket and Polling Checks

- **Observed WebSocket Console Error**: On opening `http://localhost:3000/#scheduling`, the browser logged:
  `WS: Connection error [object Event] (http://localhost:3000/hooks/useAcademyWS.ts:149)`
- Reconnection, background-tab pause/resume, and notification bell updates were **not** exercised due to `OP_TIMEOUT`.

---

## 9. Browser Performance Measurements

- `performance.getEntriesByType('navigation')[0]` and LCP entries could **not** be collected because `page.evaluate` / direct `window` access is unsupported in the `webview_browser` sandbox.
- Initial `LoginScreen` load completed 50 requests with 0 errors.
- After loading `#dashboard` (977 students, 77 teachers, 102 rendered class cards) and `#scheduling`, the webview became unresponsive (`OP_TIMEOUT`).

---

## 10. Console and Network Errors

- **LoginScreen**: 0 console errors, 0 failed network requests.
- **Coordinator `#dashboard` initial APIs**: 0 failed HTTP requests (`200 OK` on `/api/auth/context/`, `/api/academy/state/?dashboard=true`, `/api/auth/notifications/?page=1`, `/api/auth/notices/active/`).
- **Coordinator `#scheduling` tab**: 1 console error (`WS: Connection error [object Event]` at `hooks/useAcademyWS.ts:149`).

---

## 11. Automated Test Results

Executed after browser verification (with no source code changes):
- `backend/manage.py check`: **System check identified no issues (0 silenced).**
- `tsc --noEmit`: **Passed** (exit code 0, 0 errors).
- `node --test tests\*.test.ts`: **72 / 72 tests passed** (0 failures), covering Phases 2A–2E and 4A–4D.
- `vite build`: Last verified at end of Phase 4D (`✓ 3684 modules transformed`, `✓ built in 59.54s`, `index-DAkmIrHN.js: 404.62 kB │ gzip: 112.42 kB`).

---

## 12. Discovered Defects and Their Severity

1. **Medium — WebSocket Connection Error on `http://localhost:3000` Dev Server**:
   - **Observed**: `WS: Connection error [object Event] (http://localhost:3000/hooks/useAcademyWS.ts:149)` when opening `#scheduling`.
   - **Likely Cause**: `vite.config.ts` proxies `/api` to `http://127.0.0.1:5000`, and either `/ws` is not proxied in `vite.config.ts` or the local backend on port 5000 is running WSGI rather than ASGI/Daphne.
2. **Environment Blocker — `webview_browser` `OP_TIMEOUT`**:
   - **Observed**: After `#dashboard` (977 students) and `#scheduling` loaded, `webview_browser` timed out (`OP_TIMEOUT`) on all subsequent calls across both subagent sessions, preventing completion of the remaining portal and mobile checks.

---

## 13. Unverified Workflows and Limitations (Manual Verification Checklist)

Because `webview_browser` timed out, the following items remain unverified in a live browser and should be checked manually before Phase 4E:

- [ ] Expand **Insights** `<details>` on Coordinator `#dashboard` and verify `Today's Attendance` P/A/L/U counts and `Timeline Today` hover/pinned popup.
- [ ] Verify Coordinator `#dashboard` at **390x844** mobile width (KPI grid, class cards, mobile drawer).
- [ ] Navigate Coordinator tabs: **Scheduling**, **Attendance**, **Accounts & Enrollment**, **Lessons Control**, **Reports**, and **Logout**.
- [ ] Exercise **TeacherPortal**, **StudentPortal**, **TuitionCoordinatorPortal**, **TuitionTeacherPortal**, and **TuitionStudentPortal** login/logout and core views.
- [ ] Verify WebSocket connection when running Daphne/ASGI (or check `/ws` proxy in `vite.config.ts`) and test background-tab polling pause/resume.

---

## 14. Final Recommendation

**BLOCKED** (for full interactive browser sign-off).

While `LoginScreen` (Phase 4A), `DashboardPrimitives` (Phase 4B), `CoordinatorLiveClassesSection` (Phase 4C), `CoordinatorDashboardKpis` (Phase 4D), `tsc --noEmit`, and all 72 automated tests passed, full interactive verification of the remaining tabs, mobile viewport, and Teacher/Student/Tuition portals was blocked by `webview_browser` `OP_TIMEOUT`, and a WebSocket connection error (`hooks/useAcademyWS.ts:149`) was observed on `http://localhost:3000/`. Complete the manual checklist above (and verify the local `/ws` setup) before proceeding to Phase 4E.
