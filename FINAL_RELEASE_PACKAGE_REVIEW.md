# FINAL_RELEASE_PACKAGE_REVIEW.md — Local Release Packaging Preparation

> **Branch**: `release/ivs-20261020-candidate`  
> **Current Local & Live Ubuntu HEAD**: `42c763df7abfae5c1bdbfd3dde15620ab861a152`  
> **Non-Destructive Local Checkpoints**:
> - Phase 5G: `10dc2b2019cd907d466ed6bb86a6cea4cdd6f429` (`.ivs-backups/phase5g-checkpoint-20261120/`)
> - Final Phase: `d62b15003c357fd1d31b0c607e601d6feb8097f6` (`.ivs-backups/final-release-checkpoint-20261120/`)  
> **Live Ubuntu Host Status (Verified)**: `HEAD=42c763d`, all 4 services active, Nginx valid, Redis `PONG`, `0` pending migrations, HTTP `200`, `~80 GB` disk free.  
> **Action Status**: Review package only — **NO commit, push, deploy, or service restart executed.**

---

## 1. Exact Proposed File List (Explicit File-Level Staging Manifest)

### 1.1 Modified Tracked Files (`33` files)
**Frontend Core & Services (`7`)**:
- `App.tsx`
- `vite.config.ts`
- `hooks/useAcademyWS.ts`
- `hooks/useCompleteAttendance.ts`
- `services/djangoApiService.ts`
- `services/salaryAssignmentService.ts`
- `services/storageService.ts`

**Frontend Quran & Shared Components (`9`)**:
- `components/AttendanceEditor.tsx`
- `components/CoordinatorLessons.tsx`
- `components/NotificationBell.tsx`
- `components/PlatformAdmin.tsx`
- `components/ReportsTab.tsx`
- `components/SchedulingTab.tsx`
- `components/StudentPortal.tsx`
- `components/TeacherPortal.tsx`
- `components/unified-salary/TeacherSalaryAssignments.tsx`

**Frontend Tuition & Shared 3D Components (`7`)**:
- `components/tuition/TuitionAssistantChat.tsx`
- `components/tuition/TuitionAttendance.tsx`
- `components/tuition/TuitionCoordinatorPortal.tsx`
- `components/tuition/TuitionStudentPortal.tsx`
- `components/tuition/TuitionTeacherPortal.tsx`
- `components/tuition/lanyard/Lanyard.css`
- `components/tuition/lanyard/Lanyard.tsx`

**Backend Runtime (`8`)**:
- `backend/academy/attendance_v2_api.py`
- `backend/academy/urls.py` (routes `POST /api/academy/scheduling/`)
- `backend/academy/views.py` (`SchedulingMutationView`, pagination/N+1 optimizations)
- `backend/accounts/authentication.py`
- `backend/accounts/platform_communications.py`
- `backend/accounts/views.py`
- `backend/salary/serializers.py`
- `backend/salary/views.py`

**Backend Tests (`2`)**:
- `backend/academy/tests/test_attendance_pagination_and_import.py`
- `backend/salary/tests/test_salary_corrections_stage_5a.py`

### 1.2 New Untracked Runtime Files (`12` files)
- `components/LoginScreen.tsx`
- `components/QuranCoordinatorPortal.tsx`
- `components/dashboard/CoordinatorDashboardInsights.tsx`
- `components/dashboard/CoordinatorDashboardKpis.tsx`
- `components/dashboard/CoordinatorLiveClassesSection.tsx`
- `components/dashboard/DashboardPrimitives.tsx`
- `components/tuition/TuitionAiAvatar.tsx`
- `components/ui/LazyChunkErrorBoundary.tsx`
- `components/ui/LiveCountdown.tsx`
- `hooks/useMinuteNow.ts`
- `hooks/useVisibilityPolling.ts`
- `services/quranScheduleHelpers.ts`

### 1.3 New Untracked Automated Test Files (`30` files)
**Backend (`6`)**:
- `backend/academy/tests/test_daily_lesson_reports_pagination.py`
- `backend/academy/tests/test_dashboard_n_plus_one.py`
- `backend/academy/tests/test_scheduling_mutation_phase5d.py`
- `backend/academy/tests/test_teacher_session_attendance_v2.py`
- `backend/accounts/tests/test_authentication_phase3a.py`
- `backend/salary/tests/test_assignments_list_optimization.py`

**Frontend (`24`)**:
- `tests/attendance_editor_incremental_update.test.ts`
- `tests/phase2b_polling_and_ws.test.ts`
- `tests/phase2c1_daily_lesson_reports.test.ts`
- `tests/phase2c2_salary_assignments.test.ts`
- `tests/phase2d_bundle_lazy_loading.test.ts`
- `tests/phase2e_rendering_responsiveness.test.ts`
- `tests/phase4a_login_extraction.test.ts`
- `tests/phase4b_primitives_and_helpers.test.ts`
- `tests/phase4c_live_classes_extraction.test.ts`
- `tests/phase4d_dashboard_kpis_extraction.test.ts`
- `tests/phase4d_v2_ws_proxy.test.ts`
- `tests/phase4d_v3_state_and_ws.test.ts`
- `tests/phase4d_v4_lanyard_layout.test.ts`
- `tests/phase4e_dashboard_insights_extraction.test.ts`
- `tests/phase5a_state_loading_dedup.test.ts`
- `tests/phase5a_v_async_races.test.ts`
- `tests/phase5b_scheduling_virtualization.test.ts`
- `tests/phase5c_startup_bundle_lazy.test.ts`
- `tests/phase5c_v_lanyard_cls_defer.test.ts`
- `tests/phase5d_attendance_editor_perf.test.ts`
- `tests/phase5d_scheduling_persistence.test.ts`
- `tests/phase5e_coordinator_code_splitting.test.ts`
- `tests/phase5f_fix_tuition_layout.test.ts`
- `tests/phase5f_lanyard_performance.test.ts`

### 1.4 Optional Release Documentation Files (Recommended to Include)
- `FINAL_DEPLOYMENT_GATE.md`, `FINAL_RELEASE_READINESS_REPORT.md`, `FINAL_RELEASE_PACKAGE_REVIEW.md`, `PERFORMANCE_PHASE_5G_RESULTS.md`, `PERFORMANCE_PHASE_5F_FIX_RESULTS.md`, `SCHEDULING_PHASE_5D_PERSISTENCE_FIX.md`, `PERFORMANCE_PHASE_5D_ATTENDANCE_RESULTS.md` (and optionally the earlier `ARCHITECTURE_PHASE_*.md` / `PERFORMANCE_PHASE_*.md` reports).

---

## 2. Excluded Files (Must NOT Be Staged or Deployed)

- **Secrets & Local Env**: `.env.local`, `backend/.env`
- **Environments & Build Outputs**: `node_modules/`, `backend/venv/`, `dist/`
- **Local Checkpoints & Backups**: `.ivs-backups/`, `release-staging/`, `backend/platform_backups/`, `_update_work/`, `salary_payments/`
- **Audit / Diagnostic / Scratch Artifacts**: `docs/` (contains audit screenshots `evidence/wf_*.png`), `backend/*.json`, `backend/*.ps1`, `remaining_29_errors_update_20260714_015736.json`, `tuition_schedule_all_days_student_filter_20260714_012315_manifest.json`, `current-source-for-review.zip`, `dashboard-performance-partial.diff.txt`, `ivs_quran_clone_phase2_audit.txt`

---

## 3. Git Diff Summary & Migration Check

- **`git diff --check`**: **Passed** (`0` merge conflict markers, `0` whitespace errors).
- **Tracked Diff Stat**: `33 files changed, 2,964 insertions(+), 4,136 deletions(-)` (net `-1,172` lines, primarily from splitting `App.tsx` into `LoginScreen.tsx`, `QuranCoordinatorPortal.tsx`, and `components/dashboard/*`).
- **Backend Diff Stat**: `10` files (`613 insertions(+), 87 deletions(-)`), adding `SchedulingMutationView` (`POST /api/academy/scheduling/`), pagination/N+1 query optimizations, and the two test fixes.
- **Database Migrations**: **0** modified or untracked files in `backend/*/migrations/`. Since live Ubuntu is already on `42c763d` with `0` pending migrations, this release introduces **0** schema migrations.

---

## 4. Security and Secret Scan Results

- **Secret & Credential Scan** (`AIza*`, `sk-*`, `BEGIN PRIVATE KEY`, `QaPhase5G`): **0 matches** across all proposed frontend and backend files.
- **Hardcoded Localhost API URL Scan** (`127.0.0.1` / `localhost` in `services/*.ts`, `App.tsx`, `hooks/*.ts`): **0 matches**.
- **Disposable QA Records**: All 9 `qa_5g_*` localdev accounts were deleted (`{"cleaned_users": 9}`); none exist in the codebase.

---

## 5. Login Throttling Assessment & Correction

- **Technical Correction to Previous Report**:
  - Verified in `backend/venv/Lib/site-packages/rest_framework/throttling.py` (`BaseThrottle.get_ident`, lines 29–40): when `NUM_PROXIES` is `None` (unset), DRF does **not** split `X-Forwarded-For` to take the leftmost IP — it returns **the complete `HTTP_X_FORWARDED_FOR` header value** (`''.join(xff.split()) if xff else remote_addr`).
  - By contrast, `backend/accounts/platform_runtime.py` (`get_client_ip`, lines 184–188) splits `HTTP_X_FORWARDED_FOR` on `,` and returns the leftmost entry.
- **Implications & Recommendation**:
  1. Behind Nginx (`proxy_add_x_forwarded_for`), multiple users behind a shared school/office NAT IP produce the exact same `X-Forwarded-For` string and share the `20/hour` `AnonRateThrottle` bucket on `LoginView`. Conversely, a client sending a varying `X-Forwarded-For` header changes the complete string each request if Nginx appends rather than overwrites it.
  2. `LoginView` already enforces per-username brute-force lockout (`login_fail_{username}`, 5 failed attempts → 15-minute `HTTP 429` block), independent of `X-Forwarded-For`.
  3. **Packaging Decision**: Do **not** modify rate limits or `NUM_PROXIES` in this release package without first verifying Nginx's exact `proxy_set_header` lines on `/home/ubuntu/quran----1-Role-Based-`. Package as-is, and if shared-NAT `429`s occur in production, apply a small, tested follow-up (`ScopedRateThrottle` `login` + `NUM_PROXIES = 1` matching the verified Nginx hop count).

---

## 6. Release Commit and Tag Plan (Not Executed)

### 6.1 Local Commit & Tag Commands
```powershell
git add `
  App.tsx vite.config.ts `
  hooks/useAcademyWS.ts hooks/useCompleteAttendance.ts hooks/useMinuteNow.ts hooks/useVisibilityPolling.ts `
  services/djangoApiService.ts services/salaryAssignmentService.ts services/storageService.ts services/quranScheduleHelpers.ts `
  components/AttendanceEditor.tsx components/CoordinatorLessons.tsx components/LoginScreen.tsx `
  components/NotificationBell.tsx components/PlatformAdmin.tsx components/QuranCoordinatorPortal.tsx `
  components/ReportsTab.tsx components/SchedulingTab.tsx components/StudentPortal.tsx components/TeacherPortal.tsx `
  components/dashboard/CoordinatorDashboardInsights.tsx components/dashboard/CoordinatorDashboardKpis.tsx `
  components/dashboard/CoordinatorLiveClassesSection.tsx components/dashboard/DashboardPrimitives.tsx `
  components/tuition/TuitionAiAvatar.tsx components/tuition/TuitionAssistantChat.tsx `
  components/tuition/TuitionAttendance.tsx components/tuition/TuitionCoordinatorPortal.tsx `
  components/tuition/TuitionStudentPortal.tsx components/tuition/TuitionTeacherPortal.tsx `
  components/tuition/lanyard/Lanyard.css components/tuition/lanyard/Lanyard.tsx `
  components/ui/LazyChunkErrorBoundary.tsx components/ui/LiveCountdown.tsx `
  components/unified-salary/TeacherSalaryAssignments.tsx `
  backend/academy/attendance_v2_api.py backend/academy/urls.py backend/academy/views.py `
  backend/accounts/authentication.py backend/accounts/platform_communications.py backend/accounts/views.py `
  backend/salary/serializers.py backend/salary/views.py `
  backend/academy/tests/test_attendance_pagination_and_import.py `
  backend/academy/tests/test_daily_lesson_reports_pagination.py `
  backend/academy/tests/test_dashboard_n_plus_one.py `
  backend/academy/tests/test_scheduling_mutation_phase5d.py `
  backend/academy/tests/test_teacher_session_attendance_v2.py `
  backend/accounts/tests/test_authentication_phase3a.py `
  backend/salary/tests/test_assignments_list_optimization.py `
  backend/salary/tests/test_salary_corrections_stage_5a.py `
  tests/attendance_editor_incremental_update.test.ts tests/phase2b_polling_and_ws.test.ts `
  tests/phase2c1_daily_lesson_reports.test.ts tests/phase2c2_salary_assignments.test.ts `
  tests/phase2d_bundle_lazy_loading.test.ts tests/phase2e_rendering_responsiveness.test.ts `
  tests/phase4a_login_extraction.test.ts tests/phase4b_primitives_and_helpers.test.ts `
  tests/phase4c_live_classes_extraction.test.ts tests/phase4d_dashboard_kpis_extraction.test.ts `
  tests/phase4d_v2_ws_proxy.test.ts tests/phase4d_v3_state_and_ws.test.ts `
  tests/phase4d_v4_lanyard_layout.test.ts tests/phase4e_dashboard_insights_extraction.test.ts `
  tests/phase5a_state_loading_dedup.test.ts tests/phase5a_v_async_races.test.ts `
  tests/phase5b_scheduling_virtualization.test.ts tests/phase5c_startup_bundle_lazy.test.ts `
  tests/phase5c_v_lanyard_cls_defer.test.ts tests/phase5d_attendance_editor_perf.test.ts `
  tests/phase5d_scheduling_persistence.test.ts tests/phase5e_coordinator_code_splitting.test.ts `
  tests/phase5f_fix_tuition_layout.test.ts tests/phase5f_lanyard_performance.test.ts `
  FINAL_DEPLOYMENT_GATE.md FINAL_RELEASE_READINESS_REPORT.md FINAL_RELEASE_PACKAGE_REVIEW.md `
  PERFORMANCE_PHASE_5G_RESULTS.md PERFORMANCE_PHASE_5F_FIX_RESULTS.md `
  SCHEDULING_PHASE_5D_PERSISTENCE_FIX.md PERFORMANCE_PHASE_5D_ATTENDANCE_RESULTS.md

git diff --cached --stat
git commit -m "perf(quran): package phases 5A-5G optimizations, scheduling persistence, and release tests"
git tag -a v-quran-phase5g-rc1 -m "IVS Quran Academy Phase 5G Release Candidate"
```

### 6.2 Safe Transfer to Ubuntu (`/home/ubuntu/quran----1-Role-Based-`)
- Because live Ubuntu is already on `42c763d` (the exact parent commit of this release commit), transferring via `git push origin release/ivs-20261020-candidate --follow-tags` followed on Ubuntu by `git fetch --tags` and `git pull --ff-only origin release/ivs-20261020-candidate` (after verifying `git status -s` on Ubuntu) will fast-forward cleanly **without touching** untracked `backend/.env`, `backend/venv/`, `backend/platform_backups/`, or `dist/` until the build step runs.

---

## 7. Production Deployment Dependencies

- **Database Migrations**: `0` pending on live (`42c763d`), `0` new in this package.
- **Python / Node Packages**: `package.json` and `backend/requirements.txt` are unchanged since `42c763d`.
- **Build & Restart**: `npm run build` (updates `dist/`), `collectstatic --noinput` (if static changed), restart Daphne ASGI service, reload Nginx (`sudo systemctl reload nginx`).

---

## 8. Remaining Risks

1. **Shared-NAT Login Throttling (`20/hour` `AnonRateThrottle`)**: Monitored post-deploy; addressable via a small, tested `ScopedRateThrottle` + `NUM_PROXIES` follow-up once Nginx `X-Forwarded-For` config is confirmed.
2. **Deferred Tuition Lag**: `Tuition Admin` / `Tuition Coordinator` `Accounts` tab (`~5s` switch) remains deferred until post-release.
3. **Post-Deploy Smoke Verification**: Real-browser verification of Quran Coordinator Scheduling (`POST /api/academy/scheduling/`), Attendance, Salary preview, and `/ws/academy/` is required immediately after cutover.

---

**Package Status: READY FOR COMMIT REVIEW** — Stopping here for your approval before running `git add` / `git commit` / `git tag`.
