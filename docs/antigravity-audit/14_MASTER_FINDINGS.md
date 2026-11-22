# IVS Qur'an Academy Manager — Complete Master Findings Register & Defect Reconciliation

> **Document ID**: `14_MASTER_FINDINGS`  
> **Phase**: Phase 7 — Complete End-to-End Integration, Missing Routes, Functional Gaps, Testing, Reliability & Master Findings Audit  
> **Repository Target**: `quran----1-Role-Based-`  
> **Current Audited Branch**: `release/ivs-20261020-candidate`  
> **Audited Commit Baseline**: `de92b7606543936eafe52ed66792eedda6d4598e`  
> **Author**: Antigravity Senior Software Architect, Security Reviewer & Lead QA Auditor  
> **Audit Execution Date**: 2026-11-03  
> **Audit Status**: VERIFIED (Consolidated master register with stable IDs, evidence categorization, and root-cause tracing)

---

## 1. Executive Findings Overview & Audit Scope

This document represents the unified, deduplicated master findings register for the IVS Qur'an Academy Manager codebase, consolidating all architectural, security, database, workflow, infrastructure, and integration discoveries from Phases 1 through 7.

### 1.1 Findings Count by Severity

| Severity Level | Definition | Master Findings Count |
| :--- | :--- | :---: |
| **P0 (Critical)** | Active unhedged data destruction, credential compromise, or unauthenticated remote compromise. | **0** |
| **P1 (High)** | Severe data loss risk upon coordinator action, cross-tenant metadata leakage, unversioned infrastructure, single points of failure, or critical test absences. | **11** |
| **P2 (Medium)** | Functional gaps, client-only authorization checks, missing log configurations, database constraint flaws, or unauthenticated health check absences. | **9** |
| **P3 (Low)** | Maintainability risks, dead code, template omissions, build configuration hazards, or connection reuse optimizations. | **6** |
| **Total Master Findings** | Deduplicated canonical defects & architectural risks | **26** |

---

## 2. Evidence Categorization & Confidence Methodology

Every claim in this register is strictly classified according to the following evidentiary hierarchy:
- **VERIFIED SOURCE FACT**: Directly established by static source code, models, serializers, or configurations.
- **SOURCE-SUPPORTED RISK**: A credible, demonstrable failure path established by source logic, but unexecuted at runtime.
- **INFERRED**: Architecturally plausible based on surrounding patterns, without complete runtime evidence.
- **UNVERIFIED**: Requires live staging execution, host CLI inspection, or production database access.
- **HISTORICALLY REPORTED**: Originating from previous audit phases and subsequently re-evaluated.
- **PRODUCTION UNKNOWN**: Operates exclusively on remote Oracle Cloud infrastructure outside version control.

---

## 3. Master Findings Inventory (P1 High Severity)

---

### `MASTER-001`: Tuition Student Deletion Triggers Irreversible CASCADE Deletion of Historical Attendance
- **Original Finding IDs**: `SEC-005`, `DB-002`, `DB-001`
- **Category**: Data Integrity / Destructive Workflow
- **Severity**: **P1 (High)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/tuition/`, `components/tuition/TuitionAccountsEnrollment.tsx`
- **Source Evidence**:
  - `components/tuition/TuitionAccountsEnrollment.tsx:956`: Passes `permanent = true` to `removeTuitionAccount`.
  - `services/tuitionApiService.ts:252`: Issues `DELETE /api/tuition/accounts/<id>/?permanent=true`.
  - `backend/tuition/views.py:810-903` (`TuitionAccountDetailView`): Directly executes `user.delete()`.
  - `backend/tuition/models.py:1213-1218` (`TuitionAttendance`):
    ```python
    student = models.ForeignKey("academy.StudentProfile", on_delete=models.CASCADE)
    ```
- **Technical Impact**: Deleting an account in the Tuition Department invokes `user.delete()`. Because `StudentProfile.user` has `on_delete=CASCADE` and `TuitionAttendance.student` has `on_delete=CASCADE`, all historical tuition attendance records are immediately and permanently destroyed in PostgreSQL.
- **Safeguards Present**: Confirmation dialog in browser UI only; zero server-side archival or soft-delete safeguards.
- **Contrast**: The Quran Department uses `accounts/account_archive_service.py` to archive accounts and retain historical attendance.
- **Remediation Direction**: Implement soft-archival for tuition accounts, change `TuitionAttendance.student` to `on_delete=models.PROTECT` or `SET_NULL`, and remove direct `user.delete()` calls.

---

### `MASTER-002`: Cross-Tenant WebSocket Broadcast Fanout Exposes Operational Scheduling Metadata
- **Original Finding IDs**: `SEC-001`
- **Category**: Security / Multi-Tenancy Boundary
- **Severity**: **P1 (High)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/academy/consumers.py`, `backend/academy/ws_notify.py`
- **Source Evidence**:
  - `backend/academy/consumers.py:18-27`: Users only join `user_<id>`, `role_<role>`, and `global`. No institution or department groups exist.
  - `backend/academy/ws_notify.py:15-16`:
    ```python
    def notify_global(event_type: str, data: dict):
        _send("global", {"type": event_type, **data})
    ```
  - `backend/academy/attendance_v2_api.py:2015-2024`: Sends `teacher_id`, `class_key`, `date`, `status`, and `department_id` to `"global"`.
- **Technical Impact**: Connected clients from any institution receive real-time push events containing operational timetable keys, teacher attendance statuses, and department IDs of other institutions.
- **Remediation Direction**: Add `institution_<id>` and `department_<id>` channel groups to `AcademyConsumer.connect()`; route all departmental events exclusively to scoped groups.

---

### `MASTER-003`: Plaintext JWT Access Tokens Exposed in WebSocket URLs & Nginx Access Logs
- **Original Finding IDs**: `SEC-002`
- **Category**: Security / Credential Logging
- **Severity**: **P1 (High)**
- **Confidence**: **VERIFIED SOURCE FACT (Code) / SOURCE-SUPPORTED RISK (Logs)**
- **Affected Module**: `hooks/useAcademyWS.ts`, `components/NotificationBell.tsx`, `services/websocketService.ts`, `backend/academy/middleware.py`
- **Source Evidence**:
  - `components/NotificationBell.tsx:89`: `new WebSocket(`${socketBase}/ws/academy/?token=${encodeURIComponent(token)}`);`
  - `backend/academy/middleware.py:24-28`: Extracts `token` from `scope['query_string']` and validates via `AccessToken(token)`.
  - Browser WebSocket API limitation: Standard browser `WebSocket()` does not support custom HTTP headers (e.g. `Authorization: Bearer <token>`).
- **Technical Impact & Precise Scope**: Because tokens are passed in the URL query string, standard Nginx proxy logging using the default `combined` format records the raw `$request` URI (`GET /ws/academy/?token=eyJ... HTTP/1.1`). SimpleJWT access tokens have an 8-hour lifetime (`ACCESS_TOKEN_LIFETIME = timedelta(hours=8)`). If access logs are stored unencrypted, read by non-root system users, or forwarded to external log aggregators, active user credentials remain exposed for up to 8 hours.
- **Remediation Direction**: Configure Nginx with a custom log format that strips query parameters for `/ws/` requests, or implement a short-lived (e.g. 60-second) single-use WebSocket ticket exchange pattern via a POST endpoint.

---

### `MASTER-004`: Dual Decoupled Salary Engines Coexist Without Data or Financial Synchronization
- **Original Finding IDs**: `FE-005`, `BE-002`, `DB-001`
- **Category**: Financial Integrity / Business Logic
- **Severity**: **P1 (High)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/academy/salary_service.py`, `backend/academy/salary_v2_service.py`, `components/TeacherSalaryManagement.tsx`
- **Source Evidence**:
  - `components/TeacherSalaryManagement.tsx:1965-1978`: Renders `DepartmentSalaryV2Workspace` if `role === "department_admin"`, but renders `LegacyTeacherSalaryManagement` (V1) for all other roles (`institution_admin`, `coordinator`).
  - `backend/academy/salary_service.py`: Operates exclusively on `TeacherSalarySlip` (`academy.models.TeacherSalarySlip`) with status choices:
    - `DRAFT ("draft")`
    - `PROCESSED ("processed")`
  - `backend/academy/salary_v2_service.py` & `salary_v2_models.py:103-113`: Operates exclusively on `QuranTeacherMonthlyPayroll` with exact status choices:
    - `CALCULATING ("calculating")`
    - `DEPARTMENT_REVIEW ("department_review")`
    - `PENDING_SUPER_ADMIN ("pending_super_admin")`
    - `APPROVED ("approved")`
    - `REJECTED ("rejected")`
    - `PAID ("paid")`
    - `REOPENED ("reopened")`
    and associated `PayrollLedgerEntry` audit records.
  - Both engines have zero cross-table foreign keys or synchronization mechanisms.
- **Technical Impact**: Department admins and institution admins interact with completely different financial engines and data models. A salary slip processed in V1 does not generate or update V2 payroll records, and payroll approved in V2 is invisible in V1. Formulas for substitute minutes, rate tiers, deductions, and bonus approvals differ between engines, creating financial discrepancy risks.
- **Remediation Direction**: Plan a controlled deprecation of Salary V1; migrate all historical `TeacherSalarySlip` records into V2 payroll ledgers; unify frontend routing strictly to Salary V2 across all roles.

---

### `MASTER-005`: Complete Absence of Automated Test Coverage in Tuition Application
- **Original Finding IDs**: `BE-001`
- **Category**: Quality Engineering / Reliability
- **Severity**: **P1 (High)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/tuition/`
- **Source Evidence**: `backend/tuition/` directory contains **0 test files**.
- **Technical Impact**: 4,523 lines of views and 1,349 lines of models in `tuition` operate with zero test regression gates. Modifying tuition enrollment, timetable slot generation, or attendance logic risks undetected functional breakdowns.
- **Remediation Direction**: Implement comprehensive Django `TestCase` suites covering tuition foundation, enrollment, scheduling matrix, attendance, and account lifecycle.

---

### `MASTER-006`: Complete Absence of Frontend Automated Testing Harness
- **Original Finding IDs**: New in Phase 7
- **Category**: Quality Engineering / Reliability
- **Severity**: **P1 (High)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: Frontend (`components/`, `services/`, `hooks/`, `App.tsx`)
- **Source Evidence**: No test configurations (`vitest.config.ts`, `jest.config.js`) or test files (`*.test.tsx`, `*.spec.ts`) exist anywhere in the repository.
- **Technical Impact**: The entire 28,000+ line React 19 UI relies 100% on manual developer testing. Regressions in state mutations, optimistic rollbacks, or authentication token refreshes cannot be caught before deployment.
- **Remediation Direction**: Configure Vitest and React Testing Library; create integration tests for core authentication, attendance marking, and salary views.

---

### `MASTER-007`: Single Point of Failure in Disaster Recovery — Local VM Disk Backups Only
- **Original Finding IDs**: `INF-004`
- **Category**: Infrastructure / Disaster Recovery
- **Severity**: **P1 (High)**
- **Confidence**: **VERIFIED SOURCE FACT (Repo) / PRODUCTION UNKNOWN (Host)**
- **Affected Module**: `backend/accounts/platform_backups.py`
- **Source Evidence**: `platform_backups.py:53` writes `pg_dump` archives strictly to `BASE_DIR / "platform_backups"`. No remote cloud storage sync (S3/OCI Object Storage/rsync) exists in version control.
- **Technical Impact**: If the Oracle Cloud VM disk experiences hardware corruption, filesystem failure, or accidental deletion, all local database backups are lost simultaneously with the primary database.
- **Remediation Direction**: Implement automated off-site synchronization of `platform_backups` to encrypted object storage.

---

### `MASTER-008`: Production Reverse Proxy (Nginx) Configuration Unversioned in Version Control
- **Original Finding IDs**: `INF-002`
- **Category**: Infrastructure / Deployment
- **Severity**: **P1 (High)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: Repository Root / Infrastructure
- **Source Evidence**: Nginx configuration files (`nginx.conf`, `/etc/nginx/sites-available/`) are **NOT FOUND** anywhere in the repository.
- **Technical Impact**: Production routing, TLS configuration, static asset caching, and WebSocket upgrade proxy rules exist only as untracked mutable state on the host server. The environment cannot be reproduced deterministically in disaster recovery.
- **Remediation Direction**: Add a version-controlled `deploy/nginx/` directory containing production site configuration templates.

---

### `MASTER-009`: Process Supervisor & Systemd Daphne Service Configuration Missing
- **Original Finding IDs**: `INF-003`
- **Category**: Infrastructure / Process Management
- **Severity**: **P1 (High)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: Repository Root / Infrastructure
- **Source Evidence**: Systemd unit files (`*.service`) or supervisor configurations are **NOT FOUND** in the repository.
- **Technical Impact**: The Daphne ASGI process manager configuration is untracked. Process restart policies, environment variable injection, and worker counts are unversioned.
- **Remediation Direction**: Add versioned systemd service files (`deploy/systemd/daphne.service`) to the repository.

---

### `MASTER-010`: Hardcoded Localhost `CSRF_TRUSTED_ORIGINS` Blocks Django Admin on Production Host
- **Original Finding IDs**: `INF-005`
- **Category**: Security / Configuration
- **Severity**: **P1 (High)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/config/settings.py:128-134`
- **Source Evidence**:
  - `backend/config/settings.py:128-133`:
    ```python
    CSRF_TRUSTED_ORIGINS = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    ```
- **Technical Impact & Accurate Boundaries**:
  - **Does NOT block REST API calls**: The application's REST endpoints use Django Rest Framework with `MaintenanceAwareJWTAuthentication` (`Authorization: Bearer <token>`). SimpleJWT stateless token authentication does not trigger Django's `CsrfViewMiddleware`.
  - **DOES block Django Admin & Session-based forms**: Django 4.2+ strictly validates the `Origin` header against `CSRF_TRUSTED_ORIGINS` for all session-authenticated POST requests. Accessing the Django Admin dashboard (`https://quranhometutor.com/admin/login/`) from the production domain results in an immediate `HTTP 403 Forbidden` (`CSRF verification failed. Request aborted`). Superusers and server administrators cannot log into the standard Django administrative panel in production.
- **Remediation Direction**: In `backend/config/settings.py`, allow `CSRF_TRUSTED_ORIGINS` to be overridden via environment variable (`os.getenv("CSRF_TRUSTED_ORIGINS")`) and include `https://quranhometutor.com`, `https://www.quranhometutor.com` in production configurations.

---

### `MASTER-011`: Decoupled Schedule Models Permit Unrestricted Cross-Department Teacher Double-Booking
- **Original Finding IDs**: `DB-003`
- **Category**: Database Architecture / Scheduling Integrity
- **Severity**: **P1 (High)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/academy/models.py`, `backend/tuition/models.py`
- **Source Evidence**:
  - Quran schedules are stored in `academy.models.ClassSchedule`.
  - Tuition schedules are stored in `tuition.models.TuitionSchedule`.
  - Neither model has a cross-table constraint or validation query checking the other table.
- **Technical Impact**: A teacher can be scheduled to teach a Quran class and a Tuition class at the exact same weekday and hour without database rejection, causing unresolved schedule collisions.
- **Remediation Direction**: Implement a shared schedule validation service or cross-department availability check before saving schedule records.

---

## 4. Master Findings Inventory (P2 Medium Severity)

---

### `MASTER-012`: Coordinator Tab Access Restrictions Enforced on Client Only in Quran Department
- **Original Finding IDs**: `SEC-004`, `FE-008`
- **Category**: Security / Authorization
- **Severity**: **P2 (Medium)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/academy/views.py`, `backend/accounts/views.py`
- **Source Evidence**:
  - `accounts.models.CoordinatorTabAccess` configures tab visibility.
  - `backend/academy/views.py` contains **zero references** to `CoordinatorTabAccess`.
  - Endpoints like `/api/academy/dropped-leave/` and `/api/academy/lessons/` check only `IsCoordinator`.
- **Technical Impact**: If a coordinator has `#dropped-leave` or `#lessons` revoked in `CoordinatorTabAccess`, the tab is hidden in the UI, but direct API calls to `/api/academy/dropped-leave/` succeed without restriction.
- **Remediation Direction**: Implement an object-level permission class in `academy` that inspects `CoordinatorTabAccess` before allowing coordinator access to sensitive views.

---

### `MASTER-013`: Client-Only Logout Lacks Backend Token Revocation / Blacklisting
- **Original Finding IDs**: `SEC-003`
- **Category**: Security / Authentication
- **Severity**: **P2 (Medium)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `services/djangoApiService.ts:955`, `backend/accounts/urls.py`
- **Source Evidence**:
  - `services/djangoApiService.ts:955`: `logoutFromDjango()` only calls `clearSession()` in `localStorage`.
  - No logout or token blacklist endpoint is registered in `backend/accounts/urls.py`, despite `rest_framework_simplejwt.token_blacklist` being in `INSTALLED_APPS`.
- **Technical Impact**: If an access token or refresh token is captured before logout, it remains completely valid until natural expiration, even after the user explicitly logs out.
- **Remediation Direction**: Expose SimpleJWT's `TokenBlacklistView` at `/api/auth/logout/`; update `djangoApiService.logoutFromDjango()` to send the refresh token to the blacklist endpoint.

---

### `MASTER-014`: In-Memory Channel Layer Vulnerability in Multi-Process ASGI Deployment
- **Original Finding IDs**: `INF-006`
- **Category**: Infrastructure / Real-Time Messaging
- **Severity**: **P2 (Medium)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/config/settings.py:173-197`
- **Source Evidence**: Defaults to `InMemoryChannelLayer` unless `DJANGO_CHANNEL_LAYER="redis"`.
- **Technical Impact**: If Daphne runs with multiple worker processes or instances without Redis, WebSocket notifications published on Worker 1 will not reach clients connected to Worker 2, causing silent state synchronization failures across users.
- **Remediation Direction**: Require Redis channel layer in production; assert `DJANGO_CHANNEL_LAYER="redis"` in production configuration checks.

---

### `MASTER-015`: Tuition Application Missing from Django Logging Configuration
- **Original Finding IDs**: `BE-003`
- **Category**: Observability / Logging
- **Severity**: **P2 (Medium)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/config/settings.py:247-258`
- **Source Evidence**: `LOGGING['loggers']` explicitly defines loggers for `academy` and `accounts`, but completely omits `tuition`.
- **Technical Impact**: Errors and exceptions occurring in the Tuition Department fall back to root logger and are emitted only to console at `WARNING` level, leaving zero trace in `backend/logs/django.log`.
- **Remediation Direction**: Add a `tuition` entry to `LOGGING['loggers']` pointing to the file and console handlers.

---

### `MASTER-016`: `TuitionAttendance` Unique Constraint Flaw Permits Duplicate Student Attendance
- **Original Finding IDs**: `DB-004`
- **Category**: Database Architecture / Data Integrity
- **Severity**: **P2 (Medium)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/tuition/models.py:1234-1237`
- **Source Evidence**:
  - The unique constraint is: `["department", "entity_type", "teacher", "date", "class_key"]`.
  - There is **no constraint** on `["department", "entity_type", "student", "date", "class_key"]`.
- **Technical Impact**: When student attendance is marked with a null teacher, PostgreSQL permits duplicate rows for the same student on the same date and class key.
- **Remediation Direction**: Add a conditional `models.UniqueConstraint` for `entity_type == "student"` covering `department`, `student`, `date`, and `class_key`.

---

### `MASTER-017`: Tuition Assignments Screen Is a Hardcoded Static UI Placeholder
- **Original Finding IDs**: `FE-004`
- **Category**: Functional Completeness
- **Severity**: **P2 (Medium)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `components/tuition/TuitionStudentPortal.tsx:1296-1298`
- **Source Evidence**: Tab renders static text: *"Assignments will appear here when the assignment workflow is added."* No backend models or endpoints exist.
- **Technical Impact**: Students and teachers see an active "Assignments" tab in the portal that has zero functional backing.
- **Remediation Direction**: Either implement the assignment submission and grading backend module or hide the tab until development is authorized.

---

### `MASTER-018`: Absence of Unauthenticated Liveness / Readiness Health Check Endpoint
- **Original Finding IDs**: `INF-008`
- **Category**: Infrastructure / Observability
- **Severity**: **P2 (Medium)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/academy/views.py:761`, `backend/accounts/platform_admin_api.py:348`
- **Source Evidence**: `AcademyHealthView` requires `IsAuthenticated`; `PlatformSystemHealthView` requires `IsSuperUser | IsPlatformAdmin`. Zero public health endpoints exist.
- **Technical Impact**: Cloud load balancers (OCI Load Balancer) or external uptime monitors cannot probe service liveness without generating valid JWT tokens, complicating automated failover and health tracking.
- **Remediation Direction**: Create a lightweight, unauthenticated `GET /api/health/` returning `{"status": "ok"}` with database connectivity check.

---

### `MASTER-019`: Django Logging Lacks Log Rotation on `django.log`
- **Original Finding IDs**: `INF-007`
- **Category**: Infrastructure / Reliability
- **Severity**: **P2 (Medium)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/config/settings.py:236-241`
- **Source Evidence**: Uses `logging.FileHandler` instead of `logging.handlers.RotatingFileHandler`.
- **Technical Impact**: Log file grows indefinitely, risking host disk exhaustion over extended production operation.
- **Remediation Direction**: Switch to `RotatingFileHandler` with `maxBytes=50_000_000` (50MB) and `backupCount=5`.

---

### `MASTER-020`: Extreme Monolithic View Files in Academy and Tuition
- **Original Finding IDs**: `BE-004`
- **Category**: Maintainability / Architecture
- **Severity**: **P2 (Medium)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/academy/views.py` (5,091 lines), `backend/tuition/views.py` (4,523 lines)
- **Technical Impact**: High cognitive load, merge conflict frequency, and regression risk due to disparate domains (attendance, lessons, salary, dashboard) living in single multi-thousand-line files.
- **Remediation Direction**: Split monolithic view files into modular view packages (`academy/views/attendance.py`, `academy/views/lessons.py`, etc.).

---

## 5. Master Findings Inventory (P3 Low Severity)

---

### `MASTER-021`: Dead Code: `TuitionPendingPortal.tsx` Unmounted in Application Tree
- **Original Finding IDs**: `FE-001`
- **Category**: Maintainability / Codebase Cleanliness
- **Severity**: **P3 (Low)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `components/tuition/TuitionPendingPortal.tsx`, `App.tsx:82`
- **Source Evidence**: Lazy-loaded in `App.tsx:82`, but never referenced or rendered anywhere in the JSX tree.
- **Remediation Direction**: Remove the orphaned file or mount it to handle pending user account states.

---

### `MASTER-022`: Undocumented Production Environment Variables in Template
- **Original Finding IDs**: `INF-009`
- **Category**: Documentation / DevOps
- **Severity**: **P3 (Low)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/.env.example`
- **Source Evidence**: `backend/.env.example` documents only 4 variables, while the backend codebase references 15 variables.
- **Remediation Direction**: Update `.env.example` to document all 15 variables with secure defaults.

---

### `MASTER-023`: Vite `define` Injects Secret API Key Identifier into Build Configuration Defines
- **Original Finding IDs**: `FE-006`
- **Category**: Security / Build Configuration
- **Severity**: **P3 (Low)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `vite.config.ts:23-24`
- **Source Evidence**: Defines `process.env.API_KEY` and `process.env.GEMINI_API_KEY`. No application code currently references it.
- **Remediation Direction**: Remove the `define` block from `vite.config.ts`, as all AI requests are proxied via the Django backend.

---

### `MASTER-024`: Absence of Database Connection Pooling / `CONN_MAX_AGE = 0`
- **Original Finding IDs**: `INF-011`
- **Category**: Performance / Database
- **Severity**: **P3 (Low)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/config/settings.py`
- **Source Evidence**: `DATABASES['default']` omits `CONN_MAX_AGE`.
- **Technical Impact**: Connection opened and closed per HTTP request, increasing database connection overhead under load.
- **Remediation Direction**: Set `CONN_MAX_AGE = 600` (10 minutes) in production settings.

---

### `MASTER-025`: Uploaded Media Files Configuration Absent in Django Settings
- **Original Finding IDs**: `INF-010`
- **Category**: Infrastructure / Settings
- **Severity**: **P3 (Low)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `backend/config/settings.py`
- **Source Evidence**: `MEDIA_ROOT` and `MEDIA_URL` are not defined.
- **Remediation Direction**: Add `MEDIA_ROOT` and `MEDIA_URL` definitions to support user avatars and uploaded documents.

---

### `MASTER-026`: Assistant Chat Uses Raw `fetch` Bypassing Automated Token Refresh
- **Original Finding IDs**: `SEC-007`
- **Category**: Reliability / Frontend
- **Severity**: **P3 (Low)**
- **Confidence**: **VERIFIED SOURCE FACT**
- **Affected Module**: `services/geminiService.ts:171`
- **Source Evidence**: Invokes `fetch` directly with `getAccessToken()` rather than using `authenticatedRequest`.
- **Remediation Direction**: Refactor `geminiService.ts` to call the assistant API via `authenticatedRequest`.

---

## 6. Complete Cross-Reference Table to Earlier Findings

| Master Finding ID | Canonical Title | Original Finding IDs | Reconciled Severity | Final Status |
| :--- | :--- | :--- | :---: | :--- |
| **`MASTER-001`** | Tuition Student Deletion CASCADE Data Loss | `SEC-005`, `DB-002`, `DB-001` | **P1 (High)** | **CONFIRMED** |
| **`MASTER-002`** | Cross-Tenant WebSocket Broadcast Fanout | `SEC-001` | **P1 (High)** | **CONFIRMED** |
| **`MASTER-003`** | Plaintext JWT Tokens in WebSocket URL & Logs | `SEC-002` | **P1 (High)** | **CONFIRMED** |
| **`MASTER-004`** | Dual Decoupled Salary Engines Coexistence | `FE-005`, `BE-002`, `DB-001` | **P1 (High)** | **CONFIRMED** |
| **`MASTER-005`** | Absence of Automated Tests in Tuition App | `BE-001` | **P1 (High)** | **CONFIRMED** |
| **`MASTER-006`** | Zero Frontend Automated Testing Harness | New | **P1 (High)** | **CONFIRMED** |
| **`MASTER-007`** | Local VM Disk Backups Only (Single Point of Failure) | `INF-004` | **P1 (High)** | **CONFIRMED** |
| **`MASTER-008`** | Unversioned Production Nginx Reverse Proxy Config | `INF-002` | **P1 (High)** | **CONFIRMED** |
| **`MASTER-009`** | Missing Process Supervisor / Systemd Unit Files | `INF-003` | **P1 (High)** | **CONFIRMED** |
| **`MASTER-010`** | `CSRF_TRUSTED_ORIGINS` Excludes Production Domain | `INF-005` | **P1 (High)** | **CONFIRMED** |
| **`MASTER-011`** | Decoupled Schedule Models Permit Teacher Double-Booking| `DB-003` | **P1 (High)** | **CONFIRMED** |
| **`MASTER-012`** | Coordinator Tab Restrictions Enforced on Client Only | `SEC-004`, `FE-008` | **P2 (Medium)** | **CONFIRMED** |
| **`MASTER-013`** | Client-Only Logout Lacks Backend Token Revocation | `SEC-003` | **P2 (Medium)** | **CONFIRMED** |
| **`MASTER-014`** | In-Memory Channel Layer Vulnerability in ASGI | `INF-006` | **P2 (Medium)** | **CONFIRMED** |
| **`MASTER-015`** | Tuition App Missing from Django Logging Config | `BE-003` | **P2 (Medium)** | **CONFIRMED** |
| **`MASTER-016`** | `TuitionAttendance` Constraint Flaw (Duplicate Students)| `DB-004` | **P2 (Medium)** | **CONFIRMED** |
| **`MASTER-017`** | Tuition Assignments Tab Is Static UI Placeholder | `FE-004` | **P2 (Medium)** | **CONFIRMED** |
| **`MASTER-018`** | Absence of Unauthenticated Health Check Endpoint | `INF-008` | **P2 (Medium)** | **CONFIRMED** |
| **`MASTER-019`** | Lack of Log Rotation on `django.log` | `INF-007` | **P2 (Medium)** | **CONFIRMED** |
| **`MASTER-020`** | Monolithic View Files in Academy and Tuition | `BE-004` | **P2 (Medium)** | **CONFIRMED** |
| **`MASTER-021`** | Dead Code: `TuitionPendingPortal.tsx` Unmounted | `FE-001` | **P3 (Low)** | **CONFIRMED** |
| **`MASTER-022`** | Undocumented Environment Variables in `.env.example` | `INF-009` | **P3 (Low)** | **CONFIRMED** |
| **`MASTER-023`** | Vite `define` Injects API Key into Build Defines | `FE-006` | **P3 (Low)** | **CONFIRMED** |
| **`MASTER-024`** | Lack of Connection Pooling (`CONN_MAX_AGE = 0`) | `INF-011` | **P3 (Low)** | **CONFIRMED** |
| **`MASTER-025`** | Absence of `MEDIA_ROOT` / `MEDIA_URL` Settings | `INF-010` | **P3 (Low)** | **CONFIRMED** |
| **`MASTER-026`** | Assistant Chat Bypasses Token Auto-Refresh | `SEC-007` | **P3 (Low)** | **CONFIRMED** |

---

## 7. Reconciled & Disproven Prior Claims

The following historical claims from earlier audit phases were disproven or narrowed by Phase 7 source evidence:

1. **`WF-001` (Attendance Imports Bypass Payroll Locks)**:
   - **Disproven**: Source code verification proves that both web imports (`attendance_report_import.py:817`) and management command imports (`import_monthly_attendance.py:212`) strictly invoke `assert_import_unlocked`. Financial locks cannot be bypassed via attendance imports.
2. **`FE-007` (Attendance In-Memory State Silent DB Corruption)**:
   - **Narrowed**: `App.tsx` contains mutation version stamping (`attendanceMutationVersionRef`) and automatic catch rollback to `previousRecord`. The database is protected; client drift is limited to websocket broadcast drops.
3. **`BE-005` (AI Assistant Endpoint Is an Orphaned Proxy)**:
   - **Disproven**: `services/geminiService.ts:171` actively invokes `/api/academy/assistant/`. It is not an orphaned endpoint.
4. **`INF-008` (Health Endpoint Contradiction)**:
   - **Reconciled**: `AcademyHealthView` has `permission_classes = [IsAuthenticated]`. Zero unauthenticated health check endpoints exist in the application.
