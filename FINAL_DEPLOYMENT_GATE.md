# FINAL_DEPLOYMENT_GATE.md — Pre-Deployment Safety Gate

> **Phase**: Final Phase — Pre-Deployment Safety Gate  
> **Release Branch**: `release/ivs-20261020-candidate` (`HEAD`: `42c763d` — `feat(salary): add basic salary matrix, policy management and multi-department improvements`)  
> **Non-Destructive Local Checkpoints**:
> - Phase 5G Checkpoint: `10dc2b2019cd907d466ed6bb86a6cea4cdd6f429` (`.ivs-backups/phase5g-checkpoint-20261120/`)
> - Final Phase Checkpoint: `d62b15003c357fd1d31b0c607e601d6feb8097f6` (`.ivs-backups/final-release-checkpoint-20261120/`)  
> **Status**: **CONDITIONALLY READY** (All automated frontend and backend test suites now pass 100%; deployment is gated on user authorization to commit/tag, read-only Ubuntu host verification, and pre-cutover PostgreSQL backup.)

---

## 1. Executive Test & Verification Summary

All local verification suites were executed cleanly after the two Final-Phase test fixes (`test_salary_corrections_stage_5a.py` line 852 and `test_attendance_pagination_and_import.py` lines 62 & 131), using an isolated PostgreSQL test database (`test_ivs_phase5g_isolated`):

| Check / Suite | Command | Result | Duration / Scope |
|---|---|---|---|
| TypeScript | `npm run typecheck` | **PASSED** (`0` errors) | Full frontend codebase |
| Vite Production Build | `npm run build` | **PASSED** | `3,686` modules (`dist/assets/index-*.js` `307.65 kB` / `92.35 kB` gzip) |
| Frontend Unit Tests | `node --test tests/*.test.ts` | **125 / 125 PASSED** | `0` failed, `0` skipped (`7.34s`) |
| Django System Check | `manage.py check` | **PASSED** | `0` issues (`0` silenced) |
| Django Migrations Check | `manage.py makemigrations --check --dry-run` | **PASSED** | `No changes detected` |
| Django `academy` + `accounts` | `manage.py test academy accounts --settings=test_settings` | **36 / 36 PASSED** | Isolated DB (`test_ivs_phase5g_isolated`) |
| Django `salary` (Complete Suite) | `manage.py test salary --settings=test_settings` | **464 / 464 PASSED** | Isolated DB (`2,042.55s`) |

---

## 2. Login Throttling & Client-IP Assessment

- **Current Configuration**:
  - `backend/config/settings.py` (lines 143–150): `DEFAULT_THROTTLE_CLASSES` enables `AnonRateThrottle` (`20/hour`) and `UserRateThrottle` (`1000/hour`); `NUM_PROXIES` is **unset**.
  - `LoginView` (`backend/accounts/views.py`, lines 387–439): `permission_classes = [AllowAny]` inherits `AnonRateThrottle` (`20/hour` per client IP) **and** enforces per-username brute-force lockout (`login_fail_{username}`, 5 failed attempts → 15-minute `HTTP 429` block).
  - `backend/accounts/platform_runtime.py` (`get_client_ip`, lines 184–188) and DRF `SimpleRateThrottle.get_ident` (when `NUM_PROXIES` is unset) read the **leftmost** IP in `HTTP_X_FORWARDED_FOR` if present, falling back to `REMOTE_ADDR`.
- **Operational Risk Assessment**:
  1. **Shared NAT / School Office Risk**: `20/hour` across all unauthenticated endpoints (including `LoginView`) is tight for a shared school/office NAT IP when >20 legitimate staff or students log in within an hour (e.g., shift start), or if Nginx does not forward `X-Forwarded-For` (causing all traffic to share `127.0.0.1`).
  2. **Proxy Trust Boundary**: Do **not** blindly set `NUM_PROXIES` or raise limits until Nginx's actual proxy headers on `/home/ubuntu/quran----1-Role-Based-` are verified. If Nginx appends `$remote_addr` via `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` without stripping client-supplied headers, reading the leftmost IP is spoofable; `NUM_PROXIES = 1` should only be enabled after confirming a single-hop Nginx → Daphne boundary.
- **Smallest Safe Recommended Change (Post-Nginx Verification)**:
  - Preserve `login_fail_{username}` (5 failures / 15 min) unchanged.
  - Once Nginx's single-hop `X-Forwarded-For` / `X-Real-IP` header behavior is confirmed, add a dedicated `ScopedRateThrottle` (`throttle_scope = "login"`, e.g. `"login": "120/hour"`) on `LoginView` and set `NUM_PROXIES = 1` in `settings.py`.

---

## 3. Git Working Tree Audit & Exact Release Manifest

### 3.1 Included Runtime & Test Files (Phases 5A–5G + Final Phase)
- **Modified Tracked Files (`33`)**:
  - Frontend core: `App.tsx`, `vite.config.ts`, `hooks/useAcademyWS.ts`, `hooks/useCompleteAttendance.ts`, `services/djangoApiService.ts`, `services/salaryAssignmentService.ts`, `services/storageService.ts`
  - Quran components: `components/AttendanceEditor.tsx`, `components/CoordinatorLessons.tsx`, `components/NotificationBell.tsx`, `components/PlatformAdmin.tsx`, `components/ReportsTab.tsx`, `components/SchedulingTab.tsx`, `components/StudentPortal.tsx`, `components/TeacherPortal.tsx`, `components/unified-salary/TeacherSalaryAssignments.tsx`
  - Tuition & shared 3D components: `components/tuition/TuitionAssistantChat.tsx`, `components/tuition/TuitionAttendance.tsx`, `components/tuition/TuitionCoordinatorPortal.tsx`, `components/tuition/TuitionStudentPortal.tsx`, `components/tuition/TuitionTeacherPortal.tsx`, `components/tuition/lanyard/Lanyard.css`, `components/tuition/lanyard/Lanyard.tsx`
  - Backend runtime: `backend/academy/attendance_v2_api.py`, `backend/academy/urls.py` (`POST /api/academy/scheduling/`), `backend/academy/views.py` (`SchedulingMutationView`), `backend/accounts/authentication.py`, `backend/accounts/platform_communications.py`, `backend/accounts/views.py`, `backend/salary/serializers.py`, `backend/salary/views.py`
  - Backend tests: `backend/academy/tests/test_attendance_pagination_and_import.py`, `backend/salary/tests/test_salary_corrections_stage_5a.py`
- **New Untracked Runtime Components & Services**:
  - `components/LoginScreen.tsx`, `components/QuranCoordinatorPortal.tsx`, `components/dashboard/*`, `components/tuition/TuitionAiAvatar.tsx`, `components/ui/LazyChunkErrorBoundary.tsx`, `components/ui/LiveCountdown.tsx`, `hooks/useMinuteNow.ts`, `hooks/useVisibilityPolling.ts`, `services/quranScheduleHelpers.ts`
- **New Untracked Automated Tests**:
  - `tests/*.test.ts` (all Phase 2B–5F-FIX frontend unit tests)
  - `backend/academy/tests/test_daily_lesson_reports_pagination.py`, `test_dashboard_n_plus_one.py`, `test_scheduling_mutation_phase5d.py`, `test_teacher_session_attendance_v2.py`
  - `backend/accounts/tests/test_authentication_phase3a.py`
  - `backend/salary/tests/test_assignments_list_optimization.py`

### 3.2 Explicitly Excluded from Release Commit / Deployment
- Secrets & local env: `.env.local`, `backend/.env`
- Dependencies & build artifacts: `node_modules/`, `backend/venv/`, `dist/` (built on target or via artifact transfer)
- Backups, staging & scratch: `.ivs-backups/`, `release-staging/`, `backend/platform_backups/`, `_update_work/`, `backend/*.json`, `backend/*.ps1`, `remaining_29_errors_*.json`, `tuition_schedule_*.json`, `current-source-for-review.zip`, `dashboard-performance-partial.diff.txt`, `ivs_quran_clone_phase2_audit.txt`

---

## 4. Proposed Git Commands (Not Executed — For Review)

```powershell
# 1. Verify branch and clean diff
git branch --show-current
git status -s

# 2. Stage ONLY release runtime, test, and phase documentation files
git add App.tsx vite.config.ts hooks/ services/ components/ tests/ `
  backend/academy/ backend/accounts/ backend/salary/ `
  FINAL_RELEASE_READINESS_REPORT.md FINAL_DEPLOYMENT_GATE.md `
  PERFORMANCE_PHASE_5G_RESULTS.md PERFORMANCE_PHASE_5F_FIX_RESULTS.md `
  SCHEDULING_PHASE_5D_PERSISTENCE_FIX.md PERFORMANCE_PHASE_5D_ATTENDANCE_RESULTS.md

# 3. Review staged diff before committing
git diff --cached --stat

# 4. Create release commit and immutable tag
git commit -m "perf(quran): complete phases 5A-5G optimizations, scheduling persistence, and release gate"
git tag -a v-quran-phase5g-rc1 -m "Quran Academy Phase 5G Release Candidate"
```

---

## 5. Pending Database Migrations Analysis

- **Local Working Tree vs. `42c763d`**: `0` new migrations added in Phases 5A–5G (`makemigrations --check --dry-run` → `No changes detected`).
- **Production Pending Migrations Depend on Live Server Commit**: Never assume zero new local migrations means zero production migrations. Depending on which commit is currently live on `/home/ubuntu/quran----1-Role-Based-`, committed migrations on `release/ivs-20261020-candidate` may be pending:
  - Commit `42c763d`: `salary.0008`–`0010` (`SalaryPlanTierBasicSalary`, policy archiving)
  - Commit `6554b41`: `salary.0001`–`0007` (Unified Salary Management tables)
  - Commit `532a429`: `academy.0024`–`0025`, `accounts.0011`–`0012`
- Run `python manage.py showmigrations | grep "\[ \]"` and `python manage.py migrate --plan` on Ubuntu before applying any migration.

---

## 6. Read-Only Ubuntu Server Verification Commands

Target project path: `/home/ubuntu/quran----1-Role-Based-` (read-only; do **not** print `.env` secret values):

```bash
cd /home/ubuntu/quran----1-Role-Based-

# 1. Current deployed Git commit & status
git rev-parse HEAD && git log -n 5 --oneline && git status -s

# 2. Service health (Nginx, PostgreSQL, Redis, Daphne/ASGI)
sudo systemctl status nginx postgresql redis-server --no-pager
sudo systemctl list-units --type=service | grep -iE "daphne|ivs|quran|asgi|gunicorn"

# 3. Nginx config (API proxy, WebSocket /ws/ Upgrade, X-Forwarded-For, static root)
sudo nginx -t
sudo grep -rnE "server_name|root |alias |proxy_pass|Upgrade|Connection|X-Forwarded-For|X-Real-IP" /etc/nginx/sites-enabled/

# 4. Backend env keys (names only), Redis, DB & Django check
cut -d= -f1 backend/.env | grep -vE '^(#|$)'
redis-cli ping
./backend/venv/bin/python backend/manage.py check
./backend/venv/bin/python backend/manage.py showmigrations | grep "\[ \]" || echo "No pending migrations"

# 5. Disk space, staticfiles, and backup directory
df -h /home/ubuntu
ls -ld dist backend/staticfiles backend/platform_backups
ls -lh backend/platform_backups/ | tail -n 10
```

---

## 7. Deployment Sequence, Backup & Rollback Plan (Not Executed)

### 7.1 Pre-Deploy Backup & Release Identification
1. **Immutable Release Tag**: Confirm `v-quran-phase5g-rc1` commit SHA on `release/ivs-20261020-candidate`.
2. **Current Host Checkpoint**: On Ubuntu, record `LIVE_SHA=$(git rev-parse HEAD)` and tag `git tag pre-release-$(date +%F-%H%M)`.
3. **Verified PostgreSQL Backup**:
   ```bash
   pg_dump -Fc -h localhost -U ivs_admin -d ivs_academy_db -f /home/ubuntu/backups/ivs_pre_release_$(date +%F-%H%M).dump
   pg_restore --list /home/ubuntu/backups/ivs_pre_release_$(date +%F-%H%M).dump | head -n 20
   ```
4. **Frontend Artifact Backup**:
   ```bash
   tar -czf /home/ubuntu/backups/dist_pre_release_$(date +%F-%H%M).tar.gz -C /home/ubuntu/quran----1-Role-Based- dist
   ```

### 7.2 Deployment Order
1. Pull release tag (`git fetch --tags && git checkout v-quran-phase5g-rc1`).
2. Install/verify backend dependencies (`./backend/venv/bin/pip install -r backend/requirements.txt`).
3. Inspect pending migrations (`./backend/venv/bin/python backend/manage.py migrate --plan`); apply `./backend/venv/bin/python backend/manage.py migrate` if approved.
4. Build frontend (`npm ci && npm run typecheck && npm run build`) and collect static (`./backend/venv/bin/python backend/manage.py collectstatic --noinput`).
5. Validate Nginx (`sudo nginx -t`), restart Daphne ASGI service, and reload Nginx (`sudo systemctl reload nginx`).

### 7.3 Post-Deployment Smoke Checklist
1. **Login (`/`)**: Verify login works for Quran Coordinator, Quran Teacher, Quran Student, and Tuition Coordinator.
2. **Scheduling Persistence**: Edit a disposable test student slot → full browser reload → confirm `POST /api/academy/scheduling/` `200` and persisted slot → restore.
3. **Attendance & Coverage**: Mark & remove a disposable attendance record; verify substitute validation modal loads.
4. **Salary Preview**: Open Unified Salary preview (read-only) for Quran department.
5. **WebSocket**: Confirm `/ws/academy/` connects (`101 Switching Protocols`) and updates propagate across two sessions.
6. **Tuition Safety**: Confirm Tuition Coordinator/Teacher/Student route correctly with `0` console errors and `403` isolation on Quran endpoints.

### 7.4 Separate Rollback Plan
- **Frontend Rollback (Zero DB Impact)**: Extract `/home/ubuntu/backups/dist_pre_release_*.tar.gz` and run `sudo systemctl reload nginx`.
- **Backend Code Rollback (Preferred when schema is backward-compatible)**: `git checkout pre-release-*` and restart the Daphne service.
- **Database Rollback (Last Resort Only)**: Restoring an older `pg_dump` overwrites legitimate records created after deployment; use `python manage.py restore_platform_backup <backup_file>` only if a migration caused an unrecoverable compatibility failure.

---

## 8. Deferred Tuition Performance Issues

- **Explicitly Deferred (Not Modified in This Release)**:
  - `Tuition Admin` (`4,987 ms`) and `Tuition Coordinator` (`4,979 ms`) `Accounts` tab (`TuitionAccountsEnrollment`) switch latency.
  - Elevated mobile warm main-thread time on `Tuition Coordinator` (`3,108 ms`) and `Tuition Admin` (`2,721 ms`).
  - `Tuition Teacher` / `Tuition Coordinator` / `Tuition Admin` deeper architecture & rendering optimizations.
- **Tuition Functional Safety**: Verified `0` JS errors, `0` 5xx responses, intact `403` department isolation, and functional 3D Student ID Lanyard (`CLS = 0.019`).

---

## 9. Final Gate Decision

**Status: CONDITIONALLY READY** — All `125/125` frontend tests, `36/36` `academy`/`accounts` tests, and `464/464` `salary` tests pass. Ready to proceed once the user authorizes committing/tagging the release candidate, running the Section 6 read-only Ubuntu inspection, and taking the Section 7.1 PostgreSQL backup.
