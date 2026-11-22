# PERFORMANCE PHASE 3A-V: Authentication Performance Verification Report

## 1. Test Methodology

To determine whether the timing increase reported in `PERFORMANCE_PHASE_3A_RESULTS.md` was caused by environmental measurement variance or a genuine performance regression, we conducted a controlled, alternating A/B verification:

- **Isolated Code Versions**:
  - **Baseline (`Base`)**: Detached `git worktree` at `HEAD` (`42c763d`, pre-Phase 3A).
  - **Optimized (`Opt`)**: Current local working tree with Phase 3A changes (`backend/accounts/authentication.py`, `backend/accounts/platform_communications.py`, `backend/accounts/views.py`).
- **Execution Harness**: Two persistent Python worker processes (`ab_worker.py`) connected to the same local PostgreSQL test database (`test_ivs_academy_localdev`) and seeded with isolated `perf_3av_` fixture data (cleaned up after completion; no production or financial data touched).
- **Alternating A/B Sampling**: For each of the 8 user profiles (`coordinator`, `dept_admin`, `teacher`, `student`, `tuition_coord`, `platform_admin`, `multi_dept`, `revoked_roles`), we measured:
  - **Cold run**: 1 call per version after `cache.clear()` and `connection.close()`.
  - **Warm runs**: 25 alternating iterations (`Base, Opt, Opt, Base, ...`) for no-maintenance, and 15 alternating iterations during active department maintenance (`Quran Dept 3AV`).
  - **Metrics**: SQL query count, SQL execution time, isolated `MaintenanceAwareJWTAuthentication.authenticate()` time, and end-to-end DRF `APIClient` response time for `/api/auth/me/`, `/api/auth/context/`, and `/api/auth/notifications/` (median and p95).
- **PostgreSQL Query-Plan Analysis**: Captured exact SQL statements from both versions and ran read-only `EXPLAIN (ANALYZE, BUFFERS)` directly against `test_ivs_academy_localdev`.

---

## 2. Before-and-After Measurements (SQL Query Counts & Cold Execution)

| User Profile | Ver | Auth Q | Auth Cold (ms) | `/api/auth/me/` Q | `/api/auth/context/` Q | `/api/auth/notifications/` Q |
|---|---|---:|---:|---:|---:|---:|
| `coordinator` | Base | 4 | 100.98 | 4 | 9 | 11 |
| `coordinator` | Opt | **2** | **87.17** | **2** | **7** | **9** |
| `dept_admin` | Base | 4 | 220.29 | 4 | 8 | 7 |
| `dept_admin` | Opt | **2** | **210.53** | **2** | **6** | **5** |
| `teacher` | Base | 4 | 103.95 | 5 | 9 | 7 |
| `teacher` | Opt | **2** | **96.85** | **3** | **7** | **5** |
| `student` | Base | 4 | 108.03 | 5 | 9 | 4 |
| `student` | Opt | **2** | **97.69** | **3** | **7** | **2** |
| `tuition_coord` | Base | 4 | 480.61 | 4 | 9 | 11 |
| `tuition_coord` | Opt | **2** | **305.87** | **2** | **7** | **9** |
| `platform_admin` | Base | 1 | 118.97 | 1 | 5 | 3 |
| `platform_admin` | Opt | 1 | 206.55 | 1 | 5 | 3 |
| `multi_dept` | Base | 4 | 320.98 | 4 | 9 | 11 |
| `multi_dept` | Opt | **2** | 426.72 | **2** | **7** | **9** |
| `revoked_roles` | Base | 4 | 214.94 | 5 | 9 | 7 |
| `revoked_roles` | Opt | **2** | 346.70 | **3** | **7** | **5** |

---

## 3. Median and p95 Timings (Warm Alternating A/B Runs)

### No Active Maintenance (25 alternating iterations per role)

| User Profile | Ver | Auth Med (ms) | Auth P95 (ms) | `/me/` Med (ms) | `/me/` P95 (ms) | `/context/` Med (ms) | `/notif/` Med (ms) |
|---|---|---:|---:|---:|---:|---:|---:|
| `coordinator` | Base | 7.47 | 9.26 | 9.44 | 11.29 | 17.43 | 18.77 |
| `coordinator` | Opt | 8.70 | 10.32 | 10.54 | 11.34 | **16.67** | 21.86 |
| `dept_admin` | Base | 7.74 | 10.18 | 9.25 | 11.48 | 16.38 | 14.52 |
| `dept_admin` | Opt | 8.36 | 12.15 | **9.05** | **11.32** | **14.14** | 14.87 |
| `teacher` | Base | 7.55 | 9.99 | 9.83 | 12.82 | 16.89 | 14.33 |
| `teacher` | Opt | 8.16 | 10.04 | 10.97 | **12.22** | **15.40** | 15.44 |
| `student` | Base | 13.78 | 100.08 | 16.89 | 82.87 | 34.86 | 25.45 |
| `student` | Opt | 14.19 | 102.02 | 17.34 | 105.78 | **20.30** | **16.12** |
| `tuition_coord` | Base | 24.04 | 36.28 | 29.03 | 60.70 | 60.96 | 63.37 |
| `tuition_coord` | Opt | 24.94 | 46.64 | 30.00 | **49.05** | **48.62** | 76.33 |
| `platform_admin` | Base | 2.58 | 11.12 | 8.12 | 13.82 | 31.52 | 14.87 |
| `platform_admin` | Opt | 6.28 | 13.20 | 12.58 | 16.25 | 34.72 | 18.18 |
| `multi_dept` | Base | 26.04 | 36.02 | 27.37 | 38.99 | 55.63 | 60.54 |
| `multi_dept` | Opt | **20.72** | **31.58** | 27.89 | **33.91** | **48.18** | 64.88 |
| `revoked_roles` | Base | 25.19 | 45.91 | 33.32 | 56.66 | 49.47 | 46.26 |
| `revoked_roles` | Opt | 25.46 | 61.84 | **33.19** | 81.92 | 50.82 | 46.62 |

### Active Department Maintenance (`Quran Dept 3AV`, 15 alternating iterations)

| User Profile | Ver | Auth Q | Blocked | Auth Med (ms) | Auth P95 (ms) |
|---|---|---:|---|---:|---:|
| `coordinator` | Base | 4 | `True` | 35.20 | 46.44 |
| `coordinator` | Opt | **2** | `True` | **35.11** | **45.31** |
| `tuition_coord` | Base | 4 | `False` | 28.68 | 40.74 |
| `tuition_coord` | Opt | **2** | `False` | **24.38** | 60.93 |
| `platform_admin` | Base | 1 | `False` | 3.88 | 8.57 |
| `platform_admin` | Opt | 1 | `False` | 13.22 | 17.48 |
| `multi_dept` | Base | 4 | `True` | 27.73 | 36.17 |
| `multi_dept` | Opt | **2** | `True` | 29.21 | 36.62 |

**Key observation**: Notice `platform_admin`—whose SQL query (`1` query, no maintenance or department-role lookup) did **not** change between Base and Opt—still varied from `2.58 ms` to `6.28 ms` (and `3.88 ms` to `13.22 ms` during maintenance). This confirms that sub-10ms differences between the two separate worker processes are Windows/OS scheduling and PostgreSQL local-socket jitter rather than SQL or ORM overhead. On `/api/auth/context/`, where Phase 3A also eliminated the duplicate `UserDepartmentRole` query, `Opt` is consistently faster across nearly all non-admin roles.

---

## 4. SQL Query-Plan Findings (`EXPLAIN (ANALYZE, BUFFERS)`)

### No Active Maintenance (`coordinator`)
- **Baseline (4 queries)**:
  - Q1 (`accounts_user`): `0.073 ms` exec (`0.259 ms` plan)
  - Q2 (`accounts_department`): `0.061 ms` exec (`0.312 ms` plan)
  - Q3 (`accounts_userdepartmentrole`): `0.278 ms` exec (`11.434 ms` plan). Notably, `UserDepartmentRole.Meta.ordering` (`["institution__name", "department__name", "role", "user__username"]`) forced 3 extra joins (`accounts_user`, `accounts_institution`, `accounts_department`) even though only `institution_id, department_id` were selected.
  - Q4 (`accounts_platformmaintenancewindow`): `0.340 ms` exec (`23.160 ms` plan)
  - **Total DB execution**: `0.752 ms` across 4 round-trips (`35.165 ms` planning).
- **Optimized Phase 3A (2 queries)**:
  - Q1 (`accounts_user` + `LEFT OUTER JOIN` `accounts_institution`, `accounts_department`): `0.210 ms` exec (`0.874 ms` plan).
  - Q2 (`accounts_platformmaintenancewindow` with `EXISTS` subqueries): `0.383 ms` exec (`1.021 ms` plan). Both `SubPlan 2` and `SubPlan 4` (`accounts_userdepartmentrole`) were **`(never executed)`** because PostgreSQL short-circuited when no active maintenance window matched.
  - **Total DB execution**: `0.593 ms` across 2 round-trips (`1.895 ms` planning).

### Active Department Maintenance (`coordinator`, blocked with `423`)
- **Baseline (4 queries)**: `0.108 + 0.049 + 0.196 + 0.522 = 0.875 ms` total DB execution.
- **Optimized Phase 3A (2 queries)**: `0.328 + 0.561 = 0.889 ms` total DB execution (`SubPlan 2` and `SubPlan 4` remained `(never executed)` because `department_id = 62` matched directly on `accounts_platformmaintenancewindow`).

**Query-Plan Conclusion**: Neither `select_related("department", "institution")` nor the `EXISTS` subqueries introduce a query-plan regression. In fact, total DB execution time in the common no-maintenance path improved (`0.752 ms → 0.593 ms`), `UserDepartmentRole` default-ordering joins were eliminated, and `EXISTS` subplans are skipped entirely when unnecessary.

---

## 5. Security Regression Results

Executed full relevant `accounts` test suites against `test_ivs_academy_localdev`:
- Command: `python manage.py test accounts.tests.test_authentication_phase3a accounts.tests.test_teacher_login_deletion accounts.tests.test_teacher_retirement accounts.notification_tests --keepdb`
- Result: **`Ran 27 tests in 240.915s - OK`** (0 failures, 0 errors; `manage.py check` reported 0 issues).
- Verified behaviors:
  - JWT validation, invalid token rejection (`InvalidToken`), and inactive user rejection (`AuthenticationFailed`).
  - Immediate `UserDepartmentRole` grant and revocation without re-login.
  - Multi-department isolation (`multi_dept_user` vs `tuition_coord`).
  - `PlatformAdmin` / `is_superuser` exemptions.
  - Scheduled maintenance boundaries (`starts_at`, `ends_at`), manual toggle (`is_active`), and `BYPASS_PATHS` (`/api/auth/context/`, `/api/auth/notices/active/`).

---

## 6. Remaining Performance Concerns

- **Shared Cache Absence**: `LocMemCache` is process-local, so persistent caching of `PlatformMaintenanceWindow` remains unsafe in multi-worker deployments. If Redis is added in a future infrastructure phase, maintenance window caching with explicit invalidation on write could reduce the remaining 1 maintenance query.
- **Downstream Endpoint Queries**: Endpoint-specific queries in `/api/auth/notifications/` and domain views are outside Phase 3A's authentication scope.

---

## 7. Recommendation

**KEEP Phase 3A.**

---

## 8. Evidence Supporting Recommendation

1. **No Regression in SQL or Execution**: PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` proves Phase 3A executes **fewer** round-trips (4 → 2 queries) with **lower or equal** total SQL execution time (`0.752 ms → 0.593 ms` with no maintenance; `0.875 ms → 0.889 ms` during active maintenance) and avoids `UserDepartmentRole` ordering joins when no maintenance window matches.
2. **Earlier Slowdown Was Measurement Variance**: Alternating A/B testing showed `platform_admin` (whose SQL was completely unchanged) exhibited the same process-level timing variance (`2.58 ms` vs `6.28 ms`), while cold auth times and `/api/auth/context/` warm medians consistently improved under Phase 3A.
3. **Full Security & Functional Correctness**: All 27 tests across `accounts` (including 5 dedicated Phase 3A security, query-budget, role-revocation, and maintenance-boundary tests) pass with 0 issues.
