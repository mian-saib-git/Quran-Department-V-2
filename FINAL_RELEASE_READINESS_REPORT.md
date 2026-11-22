# FINAL_RELEASE_READINESS_REPORT.md — IVS Academy Release Readiness & Integration Testing

> **Phase**: Final Phase — Release Readiness and Integration Testing  
> **Release Branch**: `release/ivs-20261020-candidate` (`HEAD`: `42c763d` — `feat(salary): add basic salary matrix, policy management and multi-department improvements`)  
> **Non-Destructive Local Checkpoints**:
> - Phase 5G Checkpoint: `10dc2b2019cd907d466ed6bb86a6cea4cdd6f429` (`.ivs-backups/phase5g-checkpoint-20261120/`)
> - Final Phase Checkpoint: `d62b15003c357fd1d31b0c607e601d6feb8097f6` (`.ivs-backups/final-release-checkpoint-20261120/`)  
> **Final Recommendation**: **CONDITIONAL** (Both outstanding backend test failures are resolved and verified in an isolated test database; `125/125` frontend tests and `60/60` targeted backend suites pass; `0` critical functional or payroll blockers remain. Release is conditioned on committing the working-tree changes, completing read-only Ubuntu host checks, taking a verified PostgreSQL backup, and running the post-deploy manual smoke checklist.)

---

## 1. Release Candidate Identification

- **Git Branch**: `release/ivs-20261020-candidate` (up to date with `origin/release/ivs-20261020-candidate` at `42c763d`).
- **Working Tree State**: Contains all Phase 5A through Phase 5G + Final Phase test-fix changes (`33` modified tracked files + new untracked runtime/test/doc files).
- **Merge Conflicts**: **None** (`git diff --check` clean, `0` conflict markers).
- **Hardcoded Localhost URLs**: **None** in `services/*.ts`, `App.tsx`, or `hooks/*.ts` (`Select-String` for `127.0.0.1|localhost` returned `0` matches).
- **Non-Deployable Artifacts Excluded from Deployment**:
  - `.ivs-backups/`, `release-staging/`, `backend/platform_backups/`, `docs/`, `*_RESULTS.md`, `PERFORMANCE_*.md`, `ARCHITECTURE_*.md`, `SCHEDULING_PHASE_5D_PERSISTENCE_FIX.md`
  - `backend/*.json`, `backend/*.ps1`, `remaining_29_errors_*.json`, `tuition_schedule_*.json`, `current-source-for-review.zip`, `dashboard-performance-partial.diff.txt`, `ivs_quran_clone_phase2_audit.txt`
  - `.env.local`, `backend/.env` (never overwrite production `.env`), `backend/venv/`, `node_modules/`
  - `tests/*.test.ts` and `backend/*/tests/test_*.py` (test suites, not runtime assets)

---

## 2. Salary Test Failure Root Cause and Outcome

- **Failing Test**: `salary.tests.test_salary_corrections_stage_5a.SalaryCorrectionsStage5ATests.test_13_missing_basic_salary_configuration_causes_incomplete_preview`
- **Investigation & Traceback**:
  - In `backend/salary/calculation_engine.py` (lines 1726–1779), commit `42c763d` upgraded basic salary calculation from a single scalar `SalaryPolicyVersion.basic_salary_amount` to a **2D Basic Salary Matrix (`SalaryPlanTierBasicSalary`: Teaching Plan × Student-Count Tier)** with `version.basic_salary_amount` retained as a legacy fallback.
  - When both the 2D `SalaryPlanTierBasicSalary` cell and `version.basic_salary_amount` (and `assignment.basic_salary_override`) are `None`, `calculation_engine.py` sets `missing_basic_matrix = True`, `basic_salary_earnings = Decimal("0.00")`, `is_calculation_complete = False`, and appends:
    `"Basic monthly salary matrix cell is missing for teacher {teacher_name} under policy '{policy.name}'."`
  - **Root Cause**: The Stage 5A test expectation (`"Basic salary amount is not configured" in r` at line 852 of `backend/salary/tests/test_salary_corrections_stage_5a.py`) predated commit `42c763d`'s 2D matrix error message. Payroll validation and calculation completeness were **not** weakened or broken.
- **Resolution & Verification**:
  - Updated line 852 of `backend/salary/tests/test_salary_corrections_stage_5a.py` to assert `"Basic monthly salary matrix cell is missing" in r`.
  - Re-ran in isolated test DB `test_ivs_phase5g_isolated`: **PASSED** (`24/24` in `salary.tests.test_salary_corrections_stage_5a`).

---

## 3. Academy Timezone Test Outcome

- **Failing Test**: `academy.tests.test_attendance_pagination_and_import.AttendancePaginationTests.test_state_bootstrap_returns_today_only_and_total`
- **Investigation & Traceback**:
  - `AcademyStateView` filters today's attendance using Django's `timezone.localdate()` (`TIME_ZONE = "UTC"` in `backend/config/settings.py`).
  - `AttendancePaginationTests` used Python's timezone-naive `date.today()` in `setUp` (line 62) and in the assertion (line 131). Between `00:00` and `05:00` PKT (`UTC+5`), `date.today()` (`2026-11-20`) differed from `timezone.localdate()` (`2026-11-19`).
- **Resolution & Verification**:
  - Updated `backend/academy/tests/test_attendance_pagination_and_import.py` lines 62 and 131 to use `timezone.localdate()` (matching `AcademyStateView`). Production attendance date semantics were **not** altered.
  - Re-ran in isolated test DB `test_ivs_phase5g_isolated`: **PASSED** (`36/36` across `academy` + `accounts`).

---

## 4. Login Throttling Assessment

- **Current Configuration**:
  - `backend/config/settings.py` (lines 143–150): `AnonRateThrottle` (`20/hour`) and `UserRateThrottle` (`1000/hour`) are enabled globally; `NUM_PROXIES` is **not set**.
  - `LoginView` (`backend/accounts/views.py`, lines 387–439): `permission_classes = [AllowAny]`, inherits `AnonRateThrottle` (`20/hour` per client IP) AND enforces per-username brute-force lockout (`login_fail_{username}`, 5 failed attempts → 15-minute `HTTP 429` block).
- **Production Risk Assessment**:
  - **Risk**: Because `LoginView` shares the global `20/hour` IP-based `AnonRateThrottle`, if >20 staff/students log in within 1 hour from a shared school/office NAT IP (or if Nginx does not forward `X-Forwarded-For`, causing all requests to appear as `127.0.0.1`), legitimate users with valid passwords will receive `HTTP 429 Too Many Requests` (observed in Phase 5G automated testing).
  - **Proxy IP Handling**: Without `NUM_PROXIES = 1` (or trusted proxy header handling), DRF `SimpleRateThrottle.get_ident()` reads the leftmost `X-Forwarded-For` entry if present.
- **Recommended Targeted Correction (Before or Immediately With Cutover)**:
  - Keep brute-force protection (`login_fail_{username}` 5 failures / 15 min) intact.
  - Add a dedicated `ScopedRateThrottle` (`throttle_scope = "login"`, e.g. `"login": "120/hour"` or `"30/min"`) on `LoginView` rather than `20/hour` shared `anon`, and set `NUM_PROXIES = 1` in `settings.py` alongside Nginx `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`.

---

## 5. Frontend Test Results

| Check | Command | Result | Scope |
|---|---|---|---|
| TypeScript | `npm run typecheck` | **PASSED** (`0` errors) | Full frontend codebase |
| Vite Production Build | `npm run build` | **PASSED** | `3,686` modules, `dist/assets/index-*.js` `307.65 kB` (`92.35 kB` gzip) |
| Frontend Unit Tests | `node --test tests/*.test.ts` | **125 / 125 PASSED** | `0` failed, `0` skipped (`26.15s`) |

---

## 6. Backend Test Results

All Django tests were executed against an isolated PostgreSQL test database (`test_ivs_phase5g_isolated` via `scratch/test_settings.py`), leaving localdev `ivs_academy_db` untouched.

| Suite / Command | Result | Status |
|---|---|---|
| `manage.py check` | `System check identified no issues (0 silenced)` | **PASSED** |
| `manage.py makemigrations --check --dry-run` | `No changes detected` | **PASSED** |
| `manage.py test academy accounts salary.tests.test_salary_corrections_stage_5a --settings=test_settings` | **60 / 60 PASSED** (`262.72s`) | **PASSED (Post-Fix)** |
| `manage.py test salary --settings=test_settings` (Phase 5G full run, prior to Stage 5A test string fix) | `463 / 464 PASSED` (`1` failure was `test_13_missing_basic_salary_configuration_causes_incomplete_preview`, now fixed & verified above) | **463/464 + 1/1 Fixed** *(full 464-test `salary` suite not re-run after the single test-assertion edit)* |

---

## 7. Quran Academy Integration Results

Verified in Phase 5G against `dist/` (`http://127.0.0.1:4173`) + local Django (`127.0.0.1:5000`) with `0` console/page errors and `0` 5xx responses across all Quran roles:
- **Logins & Routing**: `Quran Coordinator`, `Quran Department Admin`, `Quran Teacher`, and `Quran Student` all authenticated, restored sessions across `page.reload()`, opened 1 shared `/ws/academy/` WebSocket, and logged out cleanly (`quran_academy_session_v2` cleared).
- **Lighthouse Mobile Warm / Desktop Warm**: Login `100 / 100`, Quran Coordinator `95 / 100`, Quran Teacher `99 / 100`, Quran Dept Admin `93 / 100`, Quran Student `73 / 71` (`CLS = 0`).
- **Scheduling Persistence (`POST /api/academy/scheduling/`)**: `edit_student` persisted `16:30` across reload (`HTTP 200`, restored to `14:00`), rejected unauthorized roles (`403`), and passed `test_scheduling_mutation_phase5d` (`1/1 OK`).
- **Attendance & Coverage**: `AttendanceEditor` loaded cleanly; disposable `POST /api/academy/attendance/` (`201`) + `DELETE` (`204`) succeeded; `test_teacher_session_attendance_v2` passed inside `academy` suite.
- **Accounts, Lessons, Salary, Permissions**: Tab navigation (`968–1,091 ms`), `Salary` tab (`1,016 ms` on Dept Admin), and cross-department `403` isolation verified.

---

## 8. Tuition Functional Safety Results

Verified in Phase 5G against `dist/` + Django (`0` page errors, `0` console errors, `0` 5xx responses):
- **All 4 Tuition Portals**: `Tuition Admin`, `Tuition Coordinator`, `Tuition Teacher`, and `Tuition Student` logged in, restored sessions on reload, connected to `/ws/academy/`, navigated tabs, and logged out cleanly.
- **Department Isolation**: `qa_5g_tcoord` → `GET /api/academy/state/` returned `HTTP 403`; `qa_5g_qcoord` → `GET /api/tuition/dashboard/` returned `HTTP 403`.
- **Tuition Student 3D Lanyard**: `canvasCount: 1`, `hasToggle: true`, `hiddenAfterClick: true`, `CLS = 0.019`, `mobileOverflow: false`, Desktop Lighthouse `99`.
- **Deferred Performance Observation**: Switching to `Accounts` (`TuitionAccountsEnrollment`) in `Tuition Admin` (`4,987 ms`) and `Tuition Coordinator` (`4,979 ms`) remains slow and is explicitly **DEFERRED** to the post-release Tuition optimization phase.

---

## 9. Deployment File Manifest

### 9.1 Modified Tracked Files (`33` files on `release/ivs-20261020-candidate`)
- **Frontend Entry & Core**: `App.tsx`, `vite.config.ts`, `hooks/useAcademyWS.ts`, `hooks/useCompleteAttendance.ts`, `services/djangoApiService.ts`, `services/salaryAssignmentService.ts`, `services/storageService.ts`
- **Quran Components**: `components/AttendanceEditor.tsx`, `components/CoordinatorLessons.tsx`, `components/NotificationBell.tsx`, `components/PlatformAdmin.tsx`, `components/ReportsTab.tsx`, `components/SchedulingTab.tsx`, `components/StudentPortal.tsx`, `components/TeacherPortal.tsx`, `components/unified-salary/TeacherSalaryAssignments.tsx`
- **Tuition & Shared 3D Components**: `components/tuition/TuitionAssistantChat.tsx`, `components/tuition/TuitionAttendance.tsx`, `components/tuition/TuitionCoordinatorPortal.tsx`, `components/tuition/TuitionStudentPortal.tsx`, `components/tuition/TuitionTeacherPortal.tsx`, `components/tuition/lanyard/Lanyard.css`, `components/tuition/lanyard/Lanyard.tsx`
- **Backend Runtime**: `backend/academy/attendance_v2_api.py`, `backend/academy/urls.py`, `backend/academy/views.py`, `backend/accounts/authentication.py`, `backend/accounts/platform_communications.py`, `backend/accounts/views.py`, `backend/salary/serializers.py`, `backend/salary/views.py`
- **Backend Tests**: `backend/academy/tests/test_attendance_pagination_and_import.py`, `backend/salary/tests/test_salary_corrections_stage_5a.py`

### 9.2 New Runtime Source Files (Must Be Included in Release Commit)
- `components/LoginScreen.tsx`, `components/QuranCoordinatorPortal.tsx`, `components/dashboard/*`, `components/tuition/TuitionAiAvatar.tsx`, `components/ui/LazyChunkErrorBoundary.tsx`, `components/ui/LiveCountdown.tsx`, `hooks/useMinuteNow.ts`, `hooks/useVisibilityPolling.ts`, `services/quranScheduleHelpers.ts`

### 9.3 New Endpoint & Dependencies
- **New Endpoint**: `POST /api/academy/scheduling/` (`SchedulingMutationView` in `backend/academy/views.py`, routed in `backend/academy/urls.py`).
- **Dependency Changes**: None in uncommitted Phase 5A–5G changes (`package.json` / `backend/requirements.txt` unchanged since `42c763d`).

---

## 10. Required Database Migrations

- **Uncommitted Phase 5A–5G Changes**: **0** new migrations (`manage.py makemigrations --check --dry-run` → `No changes detected`; `manage.py showmigrations --list` → `0` unapplied locally).
- **Host Note**: When deploying `release/ivs-20261020-candidate` (`42c763d`) to Ubuntu, run `python manage.py showmigrations` and `python manage.py migrate --plan` on the host to confirm whether any committed migrations since the live server's current commit (e.g., `salary.0010_salaryplantierbasicsalary`, `academy.0025_*`, `accounts.0012_*`) still need to be applied.

---

## 11. Production Configuration Checklist (Read-Only Ubuntu Host Commands)

Target path: `/home/ubuntu/quran----1-Role-Based-` (do **not** print `.env` secret values):

```bash
cd /home/ubuntu/quran----1-Role-Based-

# 1. Existing Git release & status
git status -s && git log -n 5 --oneline

# 2. Service health (Daphne / Nginx / PostgreSQL / Redis)
sudo systemctl status nginx postgresql redis-server --no-pager
sudo systemctl list-units --type=service | grep -iE "daphne|ivs|quran|gunicorn"

# 3. Nginx configuration (API & WebSocket proxy + X-Forwarded-For)
sudo nginx -t
sudo grep -rnE "proxy_pass|Upgrade|Connection|X-Forwarded-For|root |alias " /etc/nginx/sites-enabled/

# 4. Backend environment keys (names only, no secrets)
cut -d= -f1 backend/.env | grep -vE '^(#|$)'

# 5. Redis / Channels & DB connectivity (no secret output)
redis-cli ping
./backend/venv/bin/python backend/manage.py check

# 6. Static files, disk space, and backup directory
ls -ld dist backend/staticfiles backend/platform_backups
df -h /home/ubuntu
ls -lh backend/platform_backups/ | tail -n 10
```

---

## 12. Backup and Rollback Plan

1. **Pre-Deploy PostgreSQL Backup**: Create a verified dump via `PlatformBackup` / `pg_dump -Fc` and validate with `pg_restore --list <backup.dump>`.
2. **Frontend Artifact Backup**: Archive the current live `dist/` directory (`tar -czf /home/ubuntu/backups/dist-pre-release-$(date +%F-%H%M).tar.gz dist/`).
3. **Code Checkpoint**: Tag the pre-deploy commit on the Ubuntu server (`git tag pre-release-$(date +%F-%H%M)`).
4. **Preferred Reversible Rollback**:
   - Restore previous `dist/` tar and run `sudo systemctl reload nginx`.
   - `git checkout <pre-release-tag>` on backend code and restart the Daphne service.
5. **Database Rollback (Last Resort Only)**:
   - Only if a schema/data migration breaks compatibility and cannot be fixed forward: use `python manage.py restore_platform_backup <backup_file>` (note: restoring an older snapshot overwrites records created after deployment).

---

## 13. Exact Proposed Ubuntu Deployment Steps (Not Executed)

1. Confirm final release artifact & commit working-tree changes on `release/ivs-20261020-candidate`.
2. Tag the release commit (`git tag -a v-quran-phase5g -m "Quran Academy Phase 5G release"`).
3. Run verified `pg_dump -Fc` backup + `pg_restore --list` check on Ubuntu.
4. Archive live `dist/` directory on Ubuntu.
5. Record current live `HEAD` commit/tag on Ubuntu for instant code rollback.
6. Pull release tag (`git fetch --tags && git checkout v-quran-phase5g`).
7. Install/verify backend dependencies (`./backend/venv/bin/pip install -r backend/requirements.txt`).
8. Inspect migrations (`./backend/venv/bin/python backend/manage.py showmigrations` and `migrate --plan`); apply `migrate` only if pending migrations are confirmed safe.
9. Build frontend (`npm ci && npm run typecheck && npm run build`) and run `collectstatic --noinput`.
10. Validate Nginx config (`sudo nginx -t`).
11. Restart Daphne ASGI service and reload Nginx (`sudo systemctl reload nginx`).
12. Post-deploy smoke test: Login (`/`), Quran Coordinator (`#dashboard`), Quran Teacher, Quran Student.
13. Scheduling persistence check: edit a disposable test student slot → reload → verify `200` and persistence → restore.
14. Attendance check: mark & delete a disposable attendance record.
15. Salary preview check: open Unified Salary preview (read-only) for Quran department.
16. WebSocket check: confirm `/ws/academy/` connects (`101 Switching Protocols`) and updates live across two sessions.

---

## 14. Remaining Blockers

- **Code / Payroll / Functional Blockers**: **0** (`BLOCKED` items = none).
- **Operational Prerequisites (Conditioning Go-Live)**:
  1. Commit the working-tree changes to `release/ivs-20261020-candidate` before tagging.
  2. Complete the Section 11 read-only Ubuntu host inspection (Nginx `/ws/` upgrade, `X-Forwarded-For`, Redis `DJANGO_CHANNEL_LAYER=redis`, `DJANGO_DEBUG=False`, and pending migration check).
  3. Address or accept the `AnonRateThrottle` (`20/hour`) risk for shared-NAT school logins (recommended: `ScopedRateThrottle` `login` + `NUM_PROXIES = 1`).

---

## 15. Deferred Tuition Optimization Work

- **DEFERRED**: `Tuition Admin` (`4,987 ms`) and `Tuition Coordinator` (`4,979 ms`) `Accounts` tab switch latency (`TuitionAccountsEnrollment`), plus elevated mobile warm main-thread work (`2,721–3,108 ms`), explicitly scheduled for the post-Quran-release optimization phase.

---

## 16. Manual Browser Verification Requirements

Before final production sign-off:
1. Real-browser login as **Quran Coordinator** → edit schedule + full reload, mark attendance + substitute coverage modal, open Unified Salary preview.
2. Real-browser check as **Quran Student** and **Tuition Student** on desktop and mobile to confirm 3D ID Lanyard rendering, drag, and Hide/Show toggle.
3. Confirm live WebSocket propagation across two open browser sessions.

---

## 17. Final Recommendation

**Recommendation: CONDITIONAL**

The Quran Academy application is verified ready (`125/125` frontend tests, `60/60` post-fix `academy`/`accounts`/Stage-5A `salary` backend tests, `0` console/page errors across all 10 portals, `POST /api/academy/scheduling/` verified, and Tuition shared safety confirmed). Proceed to deployment only after committing the release candidate, completing the Ubuntu host read-only inspection, taking a verified PostgreSQL backup, and executing the post-deploy manual smoke checklist.
