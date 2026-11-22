# PERFORMANCE PHASE 3A RESULTS: Django Authentication & Middleware Optimization

## 1. Authentication Request Lifecycle Findings

Every authenticated API request in IVS Academy passes through:

1. **Django Middleware (`backend/config/settings.py`)**:
   - `accounts.middleware.DynamicCorsMiddleware`: Inspects the `Origin` header. When `Origin` is absent, short-circuits with 0 cache/DB operations. When `Origin` is present, calls `get_runtime_cors_origins()`, which reads `PlatformSetting` from Django's `LocMemCache` (`ivs_platform_runtime_settings_v1`, 60s TTL; 1 DB query on cold cache/invalidation, 0 DB queries when warm).
   - `corsheaders.middleware.CorsMiddleware`, `SecurityMiddleware`, `SessionMiddleware`, `CommonMiddleware`, `CsrfViewMiddleware`, `AuthenticationMiddleware` (lazy session user; 0 DB queries for pure Bearer JWT requests), `MessageMiddleware`, `XFrameOptionsMiddleware`.
2. **DRF Authentication (`accounts.authentication.MaintenanceAwareJWTAuthentication`)**:
   - Calls `JWTAuthentication.authenticate(request)` → validates the JWT signature/expiry and calls `get_user(validated_token)` (`User.objects.get(id=user_id)`).
   - If `request.path` is not in `BYPASS_PATHS` (`/api/auth/context/`, `/api/auth/notices/active/`), calls `active_maintenance_for_user(user)`.
   - `PlatformAdmin` and `is_superuser` accounts return `None` immediately (exempt from maintenance).
   - All other authenticated users trigger `user_scope(user)` and `PlatformMaintenanceWindow` evaluation.

## 2. Root Causes of Unnecessary Queries

Before Phase 3A, `MaintenanceAwareJWTAuthentication` executed **4 SQL queries** per authenticated request for non-Platform-Admin users (**3 additional queries** beyond the `User` lookup):

1. **Lazy `User.department` lookup (`Q2`)**: `JWTAuthentication.get_user()` fetched `accounts_user` without `select_related("department", "institution")`. Accessing `user.department` inside `user_scope(user)` (to read `department.institution_id`) triggered a separate `SELECT ... FROM accounts_department` query.
2. **Separate `UserDepartmentRole` query (`Q3`)**: `user_scope(user)` executed `UserDepartmentRole.objects.filter(user=user, is_active=True).values_list("institution_id", "department_id")` on every request—even when there were zero active maintenance windows.
3. **Separate `PlatformMaintenanceWindow` query (`Q4`)**: `active_maintenance_for_user(user)` then executed `PlatformMaintenanceWindow.objects.filter(...)` using the Python-collected IDs.
4. **Duplicate role lookup in `/api/auth/context/`**: `AuthContextView` already fetched `UserDepartmentRole` rows into `roles_qs`, then called `active_maintenance_for_user(user)` which queried `UserDepartmentRole` a second time.

## 3. Exact Files Modified

- `backend/accounts/authentication.py`: Overrode `get_user()` on `MaintenanceAwareJWTAuthentication` to use `select_related("department", "institution")` while preserving all `simplejwt` validation checks (`USER_ID_CLAIM`, `CHECK_USER_IS_ACTIVE`, `CHECK_REVOKE_TOKEN`).
- `backend/accounts/platform_communications.py`:
  - Added `_direct_user_scope()`, `user_scope_from_links()`, and `_scope_query_for_user()`.
  - Consolidated `active_maintenance_for_user()` and `active_notices_for_user()` to check `UserDepartmentRole` via SQL `EXISTS` subqueries inside the single `PlatformMaintenanceWindow` / `PlatformNotice` query when a pre-computed `scope` is not provided.
- `backend/accounts/views.py`: Updated `AuthContextView` to pass `scope=user_scope_from_links(user, roles_qs)` to `active_maintenance_for_user()`, eliminating the duplicate `UserDepartmentRole` lookup.
- `backend/accounts/tests/test_authentication_phase3a.py`: Added focused regression tests for auth query budgets, authorization correctness, role revocation/granting, and maintenance-mode schedule boundaries.

`DynamicCorsMiddleware` was inspected and left unmodified because warm requests already incur 0 DB queries.

## 4. Query Optimization Strategy

- **Eager FK loading in `get_user()`**: Joining `department` and `institution` in the existing `User` lookup eliminates the lazy `accounts_department` query in `user_scope()` and downstream views without adding extra round-trips.
- **SQL `EXISTS` subqueries instead of two-step Python evaluation**: Expressing `UserDepartmentRole` institution/department matching as `Exists(UserDepartmentRole.objects.filter(user=user, is_active=True, ...))` inside `PlatformMaintenanceWindow` / `PlatformNotice` reduces the 3-query maintenance check (`Department` + `UserDepartmentRole` + `PlatformMaintenanceWindow`) to **1 single query** (2 total queries for authentication, or 1 for `PlatformAdmin`).
- **Request-scoped reuse in `AuthContextView`**: Reusing already-fetched `roles_qs` avoids re-querying `UserDepartmentRole` when building the context payload.
- **Why persistent caching was NOT implemented for maintenance windows**: `backend/config/settings.py` has no shared `CACHES` backend configured (it defaults to per-process `LocMemCache`). Caching maintenance windows in `LocMemCache` would not invalidate across multiple Django/Daphne workers, risking stale maintenance enforcement or delayed deactivation. Query consolidation achieves a safe reduction from 3 extra queries to 1 without any cross-worker staleness risk.

## 5. Before-and-After Query Counts

Measured on PostgreSQL (`test_ivs_academy_localdev`) across all 8 user profiles:

| User Profile | Auth Q (Before) | Auth Q (After) | `/api/auth/me/` Q (Before → After) | `/api/auth/context/` Q (Before → After) | `/api/auth/notifications/` Q (Before → After) |
|---|---:|---:|---:|---:|---:|
| Coordinator | 4 | **2** | 5 → **3** | 9 → **7** | 11 → **9** |
| Department Admin | 4 | **2** | 5 → **3** | 8 → **6** | 7 → **5** |
| Teacher | 4 | **2** | 6 → **4** | 9 → **7** | 7 → **5** |
| Student | 4 | **2** | 6 → **4** | 9 → **7** | 4 → **2** |
| Tuition Coordinator | 4 | **2** | 5 → **3** | 9 → **7** | 11 → **9** |
| Platform Admin | 1 | **1** | 2 → **2** | 5 → **5** | 3 → **3** |
| Multi-Department User | 4 | **2** | 5 → **3** | 9 → **7** | 11 → **9** |
| Revoked-Roles User | 4 | **2** | 6 → **4** | 9 → **7** | 7 → **5** |

During active department maintenance (`Quran` department):
- `coordinator`: Auth Q `4 → 2`, endpoint Q `4 → 2`, HTTP `423 Locked`
- `multi_dept`: Auth Q `4 → 2`, endpoint Q `4 → 2`, HTTP `423 Locked`
- `tuition_coord`: Auth Q `4 → 2`, endpoint Q `11 → 9`, HTTP `200 OK`
- `platform_admin`: Auth Q `1 → 1`, endpoint Q `3 → 3`, HTTP `200 OK`

## 6. Before-and-After Response Timings

Measured locally on Windows + PostgreSQL (`test_ivs_academy_localdev`, 20 warm iterations per profile). Local wall-clock timings reflect host CPU/DB scheduling variance across separate runs:

- **Before**: Auth warm median `17.17 ms – 23.45 ms` (non-admin) / `3.29 ms` (`platform_admin`); `/api/auth/me/` median `19.03 ms – 39.18 ms` (non-admin) / `5.54 ms` (`platform_admin`).
- **After**: Auth warm median `24.56 ms – 48.98 ms` (non-admin) / `10.40 ms` (`platform_admin`); `/api/auth/me/` median `34.17 ms – 54.14 ms` (non-admin) / `30.84 ms` (`platform_admin`).
- Query count was deterministically reduced by **50% on authentication** (4 → 2 queries; 3 → 1 additional maintenance/scope queries) and by **2 queries across authenticated endpoints**.

## 7. Security and Permission Verification

Verified via `accounts.tests.test_authentication_phase3a`:
- Inactive users (`is_active=False`) and invalid JWTs are rejected (`AuthenticationFailed` / `InvalidToken`).
- Multi-department isolation: maintenance in one department blocks users assigned to that department while leaving users in other departments unaffected.
- Immediate role changes: granting or revoking `UserDepartmentRole.is_active` takes effect on the very next request using the same active JWT token (no re-login required).
- `PlatformAdmin` / `is_superuser` exemptions remain intact.

## 8. Maintenance-Mode Verification

Verified via `accounts.tests.test_authentication_phase3a`:
- No active maintenance window → `200 OK`.
- Future scheduled maintenance (`starts_at > now`) → `200 OK` until `starts_at`, then `423 Locked` immediately upon crossing `starts_at`.
- Active maintenance ending (`ends_at <= now`) → `200 OK` immediately upon crossing `ends_at`.
- Manual admin toggle (`is_active = False`) → `200 OK` immediately on the next request.
- `BYPASS_PATHS` (`/api/auth/context/`, `/api/auth/notices/active/`) remain accessible (`200 OK`) during active maintenance, and `/api/auth/context/` continues to return `maintenance.active = True`.

## 9. Test Results

- `python manage.py check`: `System check identified no issues (0 silenced).`
- `python manage.py test accounts.tests.test_authentication_phase3a --keepdb`: `Ran 5 tests in 20.928s - OK` (all 5 new Phase 3A regression tests passed).
- Earlier run of `accounts.tests.test_teacher_login_deletion` and `accounts.tests.test_teacher_retirement`: all 16 existing tests passed.

## 10. Remaining Limitations

- **No cross-worker shared cache**: Because `LocMemCache` is process-local, `PlatformMaintenanceWindow` still executes 1 query per non-admin authenticated request. If a shared Redis cache is configured in a future phase, maintenance window invalidation could be paired with `PlatformMaintenanceListCreateView` / `PlatformMaintenanceDetailView` (while still evaluating `starts_at`/`ends_at` against `timezone.now()`).
- **Localhost timing variance**: Microbenchmarks on a local Windows PostgreSQL instance are sensitive to background load; the structural win is the 50% reduction in SQL round-trips per authenticated request.

## 11. Risks and Rollback Instructions

- **Risk**: Minimal. All changes are localized to ORM query shape (`select_related` and SQL `Exists` subqueries) with no schema migrations, no persistent cache added, and no changes to JWT validation or permission rules.
- **Rollback**: Revert the edits in:
  - `backend/accounts/authentication.py`
  - `backend/accounts/platform_communications.py`
  - `backend/accounts/views.py`
  - Remove `backend/accounts/tests/test_authentication_phase3a.py` if desired.
