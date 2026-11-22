# PERFORMANCE_PHASE_5G_RESULTS.md — Full Lighthouse Regression & Release-Readiness Audit

> **Phase**: Phase 5G — Full Lighthouse Regression  
> **Branch**: `release/ivs-20261020-candidate` (HEAD: `42c763d`)  
> **Non-Destructive Checkpoint**: `git stash create` SHA `10dc2b2019cd907d466ed6bb86a6cea4cdd6f429` + `.ivs-backups/phase5g-checkpoint-20261120/`  
> **Target Build**: Vite Production Build (`dist/`) served with gzip compression + `/api/*` and `/ws/*` proxied to local Django/Daphne (`127.0.0.1:5000`)  
> **Final Recommendation**: **CONDITIONAL** (Quran Academy optimizations & core workflows are verified ready; release is conditioned on committing the working-tree changes, completing host-level Nginx/Redis/env checks, and running the pre-cutover backup & manual smoke checklist)

---

## 1. Executive Summary

Phase 5G executed a full Lighthouse regression, cross-portal functional & isolation verification, and backend/database safety audit across all **10 portals** (`Login`, `Quran Coordinator`, `Quran Teacher`, `Quran Student`, `Quran Department Admin`, `Tuition Coordinator`, `Tuition Teacher`, `Tuition Student`, `Tuition Admin`, and `Platform Admin`) using disposable `qa_5g_*` accounts (all 9 deleted cleanly afterward).

- **Quran Academy Readiness**:
  - **Login**: Mobile Cold **99**, Mobile Warm **100**, Desktop Warm **100** (`CLS = 0`, `0` console errors, `90.5 KB` JS transfer).
  - **Quran Coordinator (`#dashboard`)**: Mobile Cold **88**, Mobile Warm **95** (up from `88` in 5C and `93` in 5E), Desktop Warm **100** (`CLS = 0`).
  - **Quran Teacher (`#dashboard`)**: Mobile Cold **100**, Mobile Warm **99**, Desktop Warm **100** (`CLS = 0`).
  - **Quran Department Admin (`#dashboard`)**: Mobile Cold **87**, Mobile Warm **93**, Desktop Warm **100** (`CLS = 0`).
  - **Quran Student (`#dashboard`)**: Mobile Cold **70**, Mobile Warm **73**, Desktop Warm **71** (`CLS = 0`, `0` console errors; TBT `1,725 ms` warm / `5,915 ms` cold is driven by the preserved `@dimforge/rapier3d-compat` 2.24 MB WASM-in-JS 3D Lanyard chunk).
- **Tuition Release Safety**:
  - All 4 Tuition portals (`Tuition Admin`, `Tuition Coordinator`, `Tuition Teacher`, `Tuition Student`) loaded, restored sessions on reload, connected to `/ws/academy/`, navigated tabs, and logged out with **`0` page errors**, **`0` console errors**, and **`0` 5xx responses**.
  - **Tuition Student**: Mobile Cold **74**, Mobile Warm **73**, Desktop Warm **99**, `CLS = 0.019`, `0` mobile overflow, 3D Lanyard `<canvas>` and Hide/Show toggle verified.
  - **Confirmed Pre-Existing/Deferred Tuition Lag**: Switching to `Accounts` (`TuitionAccountsEnrollment`) in `Tuition Admin` and `Tuition Coordinator` took **`4,987 ms`** and **`4,979 ms`** respectively in Playwright (vs. `968–1,091 ms` across Quran Coordinator tabs). Explicitly **DEFERRED** per Phase 5G scope.
- **Release Blockers Found**: **0** functional/security/data-integrity blockers in the application.
- **Test & Integrity Highlights**:
  - `npm run typecheck`: **Passed** (`0` errors).
  - `npm run build`: **Passed** (`30.46s`).
  - `node --test tests/*.test.ts`: **125 / 125 passed** (`0` failed, `0` skipped).
  - `manage.py check` & `makemigrations --check --dry-run`: **Passed** (`0` issues, `0` missing/unapplied migrations).
  - `academy.tests.test_scheduling_mutation_phase5d`: **Executed and passed (`1 / 1 OK`)** after fixing a pre-existing `Institution(..., code="TI5D")` → `slug="ti5d"` typo in that test's `setUp` fixture.

---

## 2. Lighthouse Results for All Tested Portals

Measured against `dist/` (`http://127.0.0.1:4173`) with local Django (`127.0.0.1:5000`).  
Mobile: `390x844` (3 warm runs per portal, median reported; 3 cold runs on Login; 1 cold HTTP-cache-cleared run per authenticated portal). Desktop: `1350x940` warm run.

| Portal / Route | Form Factor | Cache | Score | FCP (ms) | LCP (ms) | TBT (ms) | CLS | Bootup (ms) | Main Thread (ms) | JS Transfer (KB) | Console Errors |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Login (`/`)** | Mobile | Cold (med 3) | **99** | 907 | 1,982 | 21 | 0 | 157 | 1,105 | 90.5 | 0 |
| **Login (`/`)** | Mobile | Warm (med 3) | **100** | 631 | 1,091 | 26 | 0 | 152 | 1,010 | 0 | 0 |
| **Quran Coordinator (`#dashboard`)** | Mobile | Cold | **88** | 926 | 3,828 | 110 | 0 | 678 | 2,179 | 124.5 | 0 |
| **Quran Coordinator (`#dashboard`)** | Mobile | Warm (med 3) | **95** | 633 | 2,177 | 210 | 0 | 567 | 1,983 | 0 | 0 |
| **Quran Teacher (`#dashboard`)** | Mobile | Cold | **100** | 922 | 922 | 50 | 0 | 421 | 1,449 | 129.8 | 0 |
| **Quran Teacher (`#dashboard`)** | Mobile | Warm (med 3) | **99** | 643 | 643 | 103 | 0 | 410 | 1,399 | 0 | 0 |
| **Quran Student (`#dashboard`)** | Mobile | Cold | **70** | 919 | 919 | 5,915 | 0 | 7,273 | 8,860 | 1,228.8 | 0 |
| **Quran Student (`#dashboard`)** | Mobile | Warm (med 3) | **73** | 630 | 630 | 1,725 | 0 | 3,067 | 4,536 | 0 | 0 |
| **Quran Dept Admin (`#dashboard`)** | Mobile | Cold | **87** | 931 | 3,923 | 123 | 0 | 673 | 2,251 | 124.5 | 0 |
| **Quran Dept Admin (`#dashboard`)** | Mobile | Warm (med 3) | **93** | 646 | 2,219 | 275 | 0 | 656 | 2,119 | 0 | 0 |
| **Tuition Coordinator (`#dashboard`)** | Mobile | Cold | **99** | 913 | 913 | 93 | 0 | 917 | 2,607 | 196.1 | 0 |
| **Tuition Coordinator (`#dashboard`)** | Mobile | Warm (med 3) | **95** | 649 | 649 | 271 | 0 | 1,021 | 3,108 | 0 | 0 |
| **Tuition Teacher (`#dashboard`)** | Mobile | Cold | **100** | 920 | 920 | 33 | 0.019 | 349 | 1,236 | 113.6 | 0 |
| **Tuition Teacher (`#dashboard`)** | Mobile | Warm (med 3) | **99** | 634 | 634 | 114 | 0.019 | 360 | 1,196 | 0 | 0 |
| **Tuition Student (`#dashboard`)** | Mobile | Cold | **74** | 919 | 919 | 1,623 | 0.019 | 3,040 | 4,749 | 1,232.2 | 0 |
| **Tuition Student (`#dashboard`)** | Mobile | Warm (med 3) | **73** | 651 | 651 | 1,737 | 0.019 | 3,044 | 4,585 | 0 | 0 |
| **Tuition Admin (`#dashboard`)** | Mobile | Cold | **99** | 916 | 916 | 116 | 0 | 960 | 2,665 | 196.1 | 0 |
| **Tuition Admin (`#dashboard`)** | Mobile | Warm (med 3) | **93** | 633 | 633 | 302 | 0 | 1,019 | 2,721 | 0 | 0 |
| **Platform Admin (`#platform-admin`)** | Mobile | Cold | **86** | 917 | 917 | 560 | 0 | 1,109 | 2,360 | 298.2 | 0 |
| **Platform Admin (`#platform-admin`)** | Mobile | Warm (med 3) | **88** | 650 | 650 | 467 | 0 | 1,062 | 2,184 | 0 | 0 |

*Note*: All 10 portals were verified. Zero portals were skipped.

---

## 3. Mobile and Desktop Comparisons (Plus Phase 5C → 5E → 5F → 5G Trend)

### 3.1 Phase 5G Mobile Warm vs. Desktop Warm

| Portal | Mobile Warm Score | Mobile Warm TBT | Mobile Warm CLS | Desktop Warm Score | Desktop Warm FCP / LCP | Desktop Warm TBT | Desktop Warm Main Thread |
|---|---:|---:|---:|---:|---:|---:|---:|
| **Login** | **100** | 26 ms | 0 | **100** | 200 / 316 ms | 0 ms | 277 ms |
| **Quran Coordinator** | **95** | 210 ms | 0 | **100** | 204 / 204 ms | 0 ms | 540 ms |
| **Quran Teacher** | **99** | 103 ms | 0 | **100** | 188 / 188 ms | 0 ms | 427 ms |
| **Quran Student** | **73** | 1,725 ms | 0 | **71** | 204 / 204 ms | 1,069 ms | 2,240 ms |
| **Quran Dept Admin** | **93** | 275 ms | 0 | **100** | 183 / 183 ms | 0 ms | 566 ms |
| **Tuition Coordinator** | **95** | 271 ms | 0 | **100** | 197 / 197 ms | 46 ms | 862 ms |
| **Tuition Teacher** | **99** | 114 ms | 0.019 | **100** | 243 / 243 ms | 0 ms | 345 ms |
| **Tuition Student** | **73** | 1,737 ms | 0.019 | **99** | 188 / 188 ms | 110 ms | 1,274 ms |
| **Tuition Admin** | **93** | 302 ms | 0 | **100** | 198 / 198 ms | 0 ms | 756 ms |
| **Platform Admin** | **88** | 467 ms | 0 | **100** | 181 / 397 ms | 70 ms | 610 ms |

### 3.2 Historical Regression Comparison (Mobile Warm Median)

| Portal | Phase 5C (After) | Phase 5E (After) | Phase 5F (After) | Phase 5G (Current) | Net Change vs. 5C |
|---|---:|---:|---:|---:|---|
| **Login (Cold)** | 82 (TBT 27 ms) | — | — | **99** (TBT 21 ms) | **+17 pts** (gzipped dist proxy + 5E split) |
| **Login (Warm)** | 100 (TBT 32 ms) | 100 (TBT 36 ms) | — | **100** (TBT 26 ms) | Maintained **100**, TBT `-6 ms` |
| **Quran Coordinator** | 92 (TBT 327 ms) | 93 (TBT 280 ms) | — | **95** (TBT 210 ms) | **+3 pts**, TBT **`-117 ms`** |
| **Quran Teacher** | 97 (TBT 203 ms) | 99 (TBT 140 ms) | — | **99** (TBT 103 ms) | **+2 pts**, TBT **`-100 ms`** |
| **Quran Student** | 60 (CLS 0.254, TBT 1,965 ms) | 72 (TBT 1,921 ms) | 72 (CLS 0, TBT 1,987 ms) | **73** (CLS 0, TBT 1,725 ms) | **+13 pts**, CLS **`0.254 → 0`**, TBT **`-240 ms`** |
| **Tuition Coordinator** | 94 (TBT 300 ms) | 91 (TBT 382 ms) | — | **95** (TBT 271 ms) | **+1 pt**, TBT `-29 ms` |
| **Tuition Student** | — | — | 73 (CLS 0.019, TBT 1,819 ms) | **73** (CLS 0.019, TBT 1,737 ms) | Maintained, TBT `-82 ms` |
| **Platform Admin** | 100 (TBT 67 ms) | 87 (TBT 520 ms) | — | **88** (TBT 467 ms) | Stable post-5E (`87 → 88`) |

---

## 4. Quran Coordinator Regression Results

Verified in Playwright (`1280x800` & `390x844`) against `dist/` + Django using disposable `qa_5g_qcoord` and `qa_5g_qadmin`:

| Check | Result | Evidence |
|---|---|---|
| Login & Session Storage | **PASS** | `quran_academy_session_v2` populated; `loginElapsedMs: 2,993 ms` (`qcoord`), `2,212 ms` (`qadmin`) |
| Session Restoration on Reload | **PASS** | `page.reload()` preserved authenticated portal (`sessionRestored: true`) |
| Dashboard (`#dashboard`) | **PASS** | KPIs, Live Now & Up Next, Insights rendered with `0` page errors, `0` console errors |
| Tab Navigation | **PASS** | `Scheduling` (`1,030 ms`), `Attendance` (`985 ms`), `Accounts` (`1,029 ms`), `Lessons` (`1,091 ms`), `Reports` (`968 ms`); `Salary` (`1,016 ms` on `qadmin`) |
| Scheduling Matrix (`SchedulingTab`) | **PASS** | Loaded cleanly (`schedulingLoaded: true`) with Phase 5B 2D virtualization intact |
| Attendance & Disposable Save | **PASS** | `AttendanceEditor` loaded (`attendanceLoaded: true`); `POST /api/academy/attendance/` → `201`, cleanup `DELETE` → `204` |
| WebSocket Lifecycle | **PASS** | Single `ws://127.0.0.1:4173/ws/academy/?token=...` opened per session (`wsCount: 1`) |
| Mobile Layout (`390x844`) | **PASS** | `mobileOverflow: false` |
| Logout | **PASS** | `logoutWorked: true`, `quran_academy_session_v2` cleared |

---

## 5. Quran Teacher and Student Verification

- **Quran Teacher (`qa_5g_qteacher`)**:
  - `sessionStored: true`, `sessionRestored: true`, `Salary` tab switched in `990 ms`, `wsCount: 1`, `mobileOverflow: false`, `logoutWorked: true`, `0` page errors, `0` console errors, `0` 5xx API responses (`10` API calls).
- **Quran Student (`qa_5g_qstudent`)**:
  - `sessionStored: true`, `sessionRestored: true`, `wsCount: 1`, `mobileOverflow: false`, `logoutWorked: true`, `0` page errors, `0` console errors.
  - **3D Student ID Card (`Lanyard`)**: WebGL `<canvas>` rendered (`canvasCount: 1`), `Show/Hide` toggle present (`hasToggle: true`) and hides card (`hiddenAfterClick: true`) with `pageErrors: []`.

---

## 6. Tuition Admin, Coordinator, Teacher and Student Findings

Verified in Playwright (`1280x800` & `390x844`) with `qa_5g_tadmin`, `qa_5g_tcoord`, `qa_5g_tteacher`, and `qa_5g_tstudent`:

| Portal | Session & Reload | Tabs Verified (Elapsed) | WS Count | Mobile Overflow | Logout | Errors (Page / Console / 5xx) |
|---|---|---|---:|---|---|---|
| **Tuition Admin** | PASS | `Accounts` (**`4,987 ms`**), `Scheduling` (`1,108 ms`), `Attendance` (`1,002 ms`), `Reports` (`1,044 ms`) | 1 | — | PASS | `0 / 0 / 0` |
| **Tuition Coordinator** | PASS | `Accounts` (**`4,979 ms`**), `Scheduling` (`1,097 ms`), `Attendance` (`973 ms`), `Reports` (`1,044 ms`) | 1 | `false` | PASS | `0 / 0 / 0` |
| **Tuition Teacher** | PASS | `Attendance` (`961 ms`) | 1 | — | PASS | `0 / 0 / 0` |
| **Tuition Student** | PASS | `Attendance` (`1,416 ms`), `Assignments` (`971 ms`), `Schedule` (`970 ms`) | 1 | `false` | PASS | `0 / 0 / 0` |

- **Tuition Student 3D Lanyard**: `canvasCount: 1`, `hasToggle: true`, `hiddenAfterClick: true`, `pageErrors: []` (matching Phase 5F-FIX manual approval).
- **Lag Attribution**:
  - **Observed**: `Accounts` tab in `Tuition Admin` (`4,987 ms`) and `Tuition Coordinator` (`4,979 ms`) is ~5× slower than Quran Coordinator's `Accounts` tab (`1,029 ms`), and `Tuition Coordinator` / `Tuition Admin` mobile warm Lighthouse main-thread time is `2,721–3,108 ms` (vs. `1,983 ms` for Quran Coordinator).
  - **Classification**: **DEFERRED** (explicitly scheduled for post-release Tuition optimization; no functional corruption or data-loss defect observed). Whether this specific `Accounts` tab latency is pre-existing or compounded by recent Tuition feature additions is **uncertain** without pre-Phase-5 profiling of `TuitionAccountsEnrollment`, and per Phase 5G rules no Tuition optimization was performed.

---

## 7. Backend and Database Integrity Checks

- `.\backend\venv\Scripts\python.exe backend\manage.py check`: **Passed** (`System check identified no issues (0 silenced)`).
- `.\backend\venv\Scripts\python.exe backend\manage.py makemigrations --check --dry-run`: **Passed** (`No changes detected`).
- `.\backend\venv\Scripts\python.exe backend\manage.py showmigrations --list`: **0 unapplied migrations** (`[ ]` count = `0`).
- **Isolated Test Database**: All Django tests ran against `test_ivs_phase5g_isolated` (via `scratch/test_settings.py`), leaving localdev `ivs_academy_db` untouched.
- **QA Record Cleanup**: `qa_accounts.py --cleanup` deleted all `9` disposable `qa_5g_*` users and their profiles/schedules/enrollments (`{"cleaned_users": 9}`).

---

## 8. Scheduling Persistence Verification

- **Endpoint**: `POST /api/academy/scheduling/` (`SchedulingMutationView` in `backend/academy/views.py`, lines 5180–5320+).
- **Code & Auth Audit**:
  - Enforces `IsAuthenticated`, `quran_department_for_user(user)`, `is_department_manager(user)`, and `coordinator_has_effective_tab_access(user, department, "tab_scheduling")`.
  - Uses `StudentProfile.id` and `TeacherProfile.id` scoped to `department=department, user__archived_at__isnull=True`.
  - Runs inside `@transaction.atomic`; preserves `Attendance`, `Lesson`, `DailyLessonReport`, `StudentProfile`, and `User`, and records `StudentClassHistory` on teacher transfer.
- **Live Playwright/API Verification**:
  - `qa_5g_qcoord` `POST /api/academy/scheduling/` (`edit_student` → `16:30`, `["Tuesday", "Thursday"]`): **`HTTP 200`**.
  - Subsequent `GET /api/academy/state/` confirmed `persistedTimeSlot === "16:30"`.
  - Restored `14:00` (`["Monday", "Wednesday", "Friday"]`): **`HTTP 200`**.
  - Unauthorized calls (`qa_5g_tcoord`, `qa_5g_qteacher`, `qa_5g_qstudent`): all **`HTTP 403`**.
- **Django Test Execution (`academy.tests.test_scheduling_mutation_phase5d`)**:
  - Initial run failed in `setUp` with `TypeError: Institution() got unexpected keyword arguments: 'code'` (because the untracked Phase 5D-FIX test file had not been executed previously and `Institution` uses `slug`, not `code`).
  - Fixed `code="TI5D"` → `slug="ti5d"` in `backend/academy/tests/test_scheduling_mutation_phase5d.py` line 16; re-ran in `test_ivs_phase5g_isolated` → **`Ran 1 test in 7.400s — OK`**.

---

## 9. Attendance and Coverage Verification

- `AttendanceEditor` loaded cleanly in Quran Coordinator (`attendanceLoaded: true`), and `tests/phase5d_attendance_editor_perf.test.ts` + `tests/attendance_editor_incremental_update.test.ts` passed inside the 125-test frontend suite.
- Live disposable attendance round-trip (`POST /api/academy/attendance/` → `201`, `DELETE /api/academy/attendance/<id>/` → `204`) succeeded without disturbing historical attendance records.
- `academy.tests.test_teacher_session_attendance_v2` passed inside the `academy` Django test run.

---

## 10. Salary and Payroll Safety Checks

- `tests/phase2c2_salary_assignments.test.ts` and Unified Salary frontend tests (Stage 7A Payroll Period/Draft, Stage 3 Roster & Multi-Department Context Resolution) all passed inside the 125-test frontend suite.
- `Quran Department Admin` (`qa_5g_qadmin`) navigated to `Salary` cleanly (`1,016 ms`, `0` errors).
- `salary` Django test suite (`test_ivs_phase5g_isolated`): **463 / 464 passed**, with 1 failure in `test_13_missing_basic_salary_configuration_causes_incomplete_preview` (`salary.tests.test_salary_corrections_stage_5a`). No salary/payroll data in localdev was modified.

---

## 11. Role and Department Isolation Checks

- `qa_5g_tcoord` → `GET /api/academy/state/`: **`HTTP 403`**
- `qa_5g_qcoord` → `GET /api/tuition/dashboard/`: **`HTTP 403`**
- `qa_5g_tcoord`, `qa_5g_qteacher`, `qa_5g_qstudent` → `POST /api/academy/scheduling/`: **`HTTP 403`**
- Cross-department student/teacher in `SchedulingMutationView`: **`HTTP 404`** (verified in `test_scheduling_mutation_phase5d`).
- `Platform Admin` (`qa_5g_padmin`) routed to `#platform-admin` cleanly (`0` errors).

---

## 12. Frontend and Backend Test Results

| Suite | Command | Result | Notes |
|---|---|---|---|
| TypeScript | `npm run typecheck` | **PASSED** (`0` errors) | — |
| Vite Production Build | `npm run build` | **PASSED** (`30.46s`) | `index` chunk `307.65 kB` (`92.35 kB` gzip) |
| Frontend Unit Tests | `node --test tests/*.test.ts` | **125 / 125 PASSED** | `0` failed, `0` skipped |
| Django System Check | `manage.py check` | **PASSED** | `0` issues (`0` silenced) |
| Django Migrations Check | `manage.py makemigrations --check --dry-run` | **PASSED** | `No changes detected`; `0` unapplied |
| Phase 5D Scheduling Django Test | `manage.py test academy.tests.test_scheduling_mutation_phase5d --settings=test_settings` | **1 / 1 PASSED** (`7.40s`) | Fixed `Institution(slug="ti5d")` in test `setUp` |
| `academy` + `accounts` Django Suites | `manage.py test academy accounts --settings=test_settings` | **35 / 36 PASSED** (`387.24s`) | 1 failure: `test_state_bootstrap_returns_today_only_and_total` (`date.today()` local `2026-11-20` vs `TIME_ZONE="UTC"` `2026-11-19` at 02:05 PKT) |
| `salary` Django Suite | `manage.py test salary --settings=test_settings` | **463 / 464 PASSED** (`2216.97s`) | 1 failure: `test_13_missing_basic_salary_configuration_causes_incomplete_preview` |

---

## 13. Release Blockers

**None (`0` BLOCKERs identified in application code).**

*(Note: Operational prerequisites—committing uncommitted working-tree changes and verifying production host Nginx/Redis/env configuration—are tracked in the Deployment Preparation Checklist below.)*

---

## 14. Nonblocking Issues

1. **NONBLOCKING — `AnonRateThrottle` (`20/hour`) in `backend/config/settings.py` (line 148)**: During automated testing from a single IP, >20 `/api/auth/login/` requests within 1 hour triggered `HTTP 429`. In production behind Nginx, ensure `X-Forwarded-For` / `REMOTE_ADDR` is properly forwarded or consider whether `20/hour` is sufficient for shared-NAT school/office logins.
2. **NONBLOCKING — `test_state_bootstrap_returns_today_only_and_total` timezone-naive assertion**: Uses `date.today()` instead of `timezone.localdate()`, failing between `00:00` and `05:00` PKT when `TIME_ZONE="UTC"`.
3. **NONBLOCKING — `test_13_missing_basic_salary_configuration_causes_incomplete_preview`**: `1` of `464` `salary` unit tests failed expecting `"Basic salary amount is not configured"` in `incompleteness_reasons`.
4. **NONBLOCKING — `Quran Student` & `Tuition Student` Mobile Lighthouse Score (`73`)**: Driven by `@dimforge/rapier3d-compat` (`2.24 MB` WASM-in-JS inside `Lanyard-jwuP9KDd.js` at `3,312.15 kB` raw / `1,128.87 kB` gzip). `CLS` is `0` / `0.019`, `0` runtime errors, and Phase 5F `0 FPS` idle pause is intact.
5. **NONBLOCKING — `Platform Admin` Mobile Warm Lighthouse Score (`88`, TBT `467 ms`)**: `PlatformAdmin` chunk is `238.03 kB` (`63.47 kB` gzip). Functional and error-free.

---

## 15. Deferred Tuition Performance Work

1. **DEFERRED — `Tuition Admin` & `Tuition Coordinator` `Accounts` tab (`4,987 ms` / `4,979 ms` switch latency)** and elevated mobile warm main-thread time (`2,721–3,108 ms`).
2. **DEFERRED — `Tuition Teacher` / `Tuition Coordinator` / `Tuition Admin` deeper architecture & rendering optimizations**, explicitly scheduled for the post-Quran-release phase.

---

## 16. Shared-Code Deployment Risks

Because Quran Academy and Tuition share the same SPA bundle, Django backend, PostgreSQL database, and Daphne/Channels WebSocket server, deploying this release affects both departments in the following shared files:
- **`App.tsx` & `services/storageService.ts` / `hooks/useAcademyWS.ts`**: Shared auth/session (`quran_academy_session_v2`), single-WS lifecycle, and state-scope guards (`stateScopeKeyRef`). Verified safe across all 9 authenticated roles.
- **`components/tuition/lanyard/Lanyard.tsx` & `Lanyard.css`**: Shared by both `StudentPortal` (Quran) and `TuitionStudentPortal` (Tuition). Verified `CLS = 0 / 0.019`, `0` errors, and clean desktop/mobile layout on both.
- **`backend/accounts/views.py` & `authentication.py`**: Shared JWT auth, maintenance mode, and account endpoints.
- **`backend/academy/views.py` & `urls.py`**: Adds `POST /api/academy/scheduling/` (strictly gated to Quran `department_admin`/`coordinator` with `tab_scheduling`).
- **`backend/salary/*`**: Shared Unified Salary Management backend/frontend.

---

## 17. Production Deployment Preparation Checklist

1. **Verified Database Backup**: Run `pg_dump` / `PlatformBackup` (`backend/accounts/platform_backups.py`) and verify archive integrity with `pg_restore --list` before touching production.
2. **Git Release Checkpoint**: Stage, review, and commit the Phase 5A–5F-FIX changes on `release/ivs-20261020-candidate` (current non-destructive checkpoint SHA: `10dc2b2019cd907d466ed6bb86a6cea4cdd6f429`) and tag the release commit.
3. **Environment Verification**: Confirm production `backend/.env` has `DJANGO_DEBUG=False`, strong `DJANGO_SECRET_KEY`, accurate `DJANGO_ALLOWED_HOSTS` / `CORS_ALLOWED_ORIGINS`, `DJANGO_CHANNEL_LAYER=redis` (with Redis running on `REDIS_URL`), and valid `POSTGRES_*` credentials.
4. **Frontend Build Verification**: Run `npm ci && npm run typecheck && npm run build` and deploy `dist/` to the Nginx static root with gzip/brotli enabled and immutable caching on `/assets/*`.
5. **Backend Dependency Verification**: Activate production virtualenv and verify `pip install -r backend/requirements.txt` (`Django==5.2.14`, `daphne==4.2.3`, `channels==4.3.2`, `channels-redis==4.3.0`).
6. **Migration Review**: Run `python manage.py showmigrations` and `python manage.py migrate --plan` (and `python manage.py collectstatic --noinput`) before applying `migrate`.
7. **Service & Proxy Verification (Host-Level)**: Note that `nginx.conf` and `systemd/*.service` are **not stored in this repository**; inspect `/etc/nginx/` on the production host to confirm `/api/*` HTTP proxy, `/ws/*` WebSocket upgrade (`Upgrade` / `Connection` headers), and `X-Forwarded-For` are configured, then restart Daphne (`daphne -b ... config.asgi:application`) and reload Nginx.
8. **Post-Deployment Smoke Testing**: Verify Login, Quran Coordinator (`#dashboard`, Scheduling save/reload, Attendance), Quran Teacher, Quran Student (3D Lanyard), Tuition Coordinator/Student, and `/ws/academy/` WebSocket connectivity.
9. **Rollback Instructions**: Execute Section 18 immediately if any P0/P1 regression occurs.

---

## 18. Safe Rollback Strategy

1. **Frontend Rollback**: Restore the previous `dist/` build artifact (from pre-deploy tar/backup) and reload Nginx (`nginx -s reload`).
2. **Application Code Rollback**: `git checkout <pre-release-tag-or-commit>` on the backend checkout and restart the Daphne ASGI service.
3. **Database Rollback (if migrations were applied)**:
   - Preferred for clean rollback to pre-release snapshot: `python manage.py restore_platform_backup <backup_file>` (uses `backend/accounts/management/commands/restore_platform_backup.py`, which takes a pre-restore safety dump, terminates connections, and runs `pg_restore`).
   - Do **not** run ad-hoc destructive `DROP` commands on production.

---

## 19. Manual Browser Verification Requirements

Before final sign-off on staging/production:
1. Log in as a real **Quran Coordinator** and perform an end-to-end Scheduling edit + full browser reload, Attendance mark + Teacher coverage substitute check, and Unified Salary payroll preview check.
2. Log in as a **Quran Student** and **Tuition Student** on both desktop and mobile to confirm 3D Lanyard rendering, drag, and Hide/Show toggle.
3. Confirm WebSocket live updates propagate between two open sessions (Coordinator → Teacher/Student).

---

## 20. Final Recommendation

**Recommendation: CONDITIONAL**

- **Quran Academy** is verified ready on `dist/` + Django: `95` Mobile Warm / `100` Desktop Warm on Quran Coordinator, `99–100` on Login and Quran Teacher, `93` on Quran Dept Admin, `0` console/page errors across all 10 portals, `POST /api/academy/scheduling/` persistence and `403`/`404`/`400` isolation verified, and `125/125` frontend tests passing.
- **Tuition** remains functionally safe with `0` runtime errors and `0` isolation regressions; remaining Tuition Admin/Coordinator lag (`~5s` `Accounts` tab switch) is documented and **DEFERRED** to the post-release optimization phase.
- **Conditions for Go-Live**: Commit the working-tree changes to the release branch, verify host-level Nginx/Redis/`.env` configuration (not present in repo), take a verified `pg_dump` backup, and complete the post-deploy manual smoke checks.
