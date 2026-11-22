# AI Project Context & Engineering Reference Manual

> **Document ID**: `AI_PROJECT_CONTEXT`  
> **Status**: INITIAL BASELINE (Phase 1 Complete — Sections will expand across Phases 2–8)  
> **Target Audience**: Antigravity AI Agents, Architects & Core Engineers  
> **Repository Target**: `quran----1-Role-Based-` (Branch: `release/ivs-20261020-candidate`)  
> **Production Target**: [https://quranhometutor.com/](https://quranhometutor.com/)  
> **Last Updated**: 2026-11-02  

---

## 1. System Mission & Core Domain

The **IVS Qur'an Academy Manager** (also referred to as *IVS Schedule Viewer*) is an enterprise educational operations platform managing two distinct academic branches:
1. **Quran Department** (`academy` backend app): Qur'an reading, Tajweed, and Hifz management with specialized lesson progress (Surah/Ayah tracking, Sabaq/Sabqi/Manzil), teacher compensation based on student attendance hours, and immutable salary proof generation.
2. **Tuition Department** (`tuition` backend app): Academic school tutoring across multiple subjects, grade levels, and multi-student classes, featuring interactive 3D WebGL student ID cards.

Both departments run on a unified Django 5 backend and React 19 single-page frontend with strict multi-department and role-based boundaries.

---

## 2. Foundational Architecture & Conventions

```
+--------------------------------------------------------------------------+
|                        BROWSER SINGLE PAGE APP                           |
|                       React 19 + TypeScript + Vite                       |
|                                                                          |
|  [Hash Routing: #dashboard, #scheduling, #attendance, #reports, #salary] |
|                                                                          |
|  +--------------------------+-----------------------+------------------+ |
|  |   PlatformAdmin Portal   | Quran Dept Portals    | Tuition Portals  | |
|  |  (SuperAdmin dashboard)  | (Coord, Teach, Stud)  | (Coord, Teach, S)| |
|  +--------------------------+-----------------------+------------------+ |
+--------------------------------------------------------------------------+
             | REST HTTP                               | WebSocket
             v                                         v
+-----------------------------+       +------------------------------------+
|  Django REST API (5.2.14)   |       |   Daphne ASGI Server (/ws/academy/)|
|  - accounts (Auth & RBAC)   |       |   - Real-time attendance updates   |
|  - academy (Quran ops)      |       |   - Notification broadcasts        |
|  - tuition (Tuition ops)    |       |   - Heartbeat & channel layers     |
+-----------------------------+       +------------------------------------+
             |                                         |
             +--------------------+--------------------+
                                  |
                   +------------------------------+
                   |    PostgreSQL Database       |
                   |    44 Django Migrations      |
                   +------------------------------+
```

### 2.1 Critical Conventions
- **No Client-side React Router**: Navigation uses hash fragments (`window.location.hash`), monitored via `hashchange` event listeners in `App.tsx`.
- **Custom User Model**: Backend enforces `AUTH_USER_MODEL = "accounts.User"`. All relations to users MUST reference `settings.AUTH_USER_MODEL` or `accounts.User`.
- **Two Distinct APIs**:
  - Quran operations: `services/djangoApiService.ts` -> `/api/academy/*` and `/api/auth/*`
  - Tuition operations: `services/tuitionApiService.ts` -> `/api/tuition/*`
- **Dynamic CORS Middleware**: Custom middleware in `backend/accounts/middleware.py` resolves CORS origins dynamically alongside standard Django CORS headers.
- **WebSocket Auth**: Channels authentication passes JWT access tokens via URL query string (`/ws/academy/?token=...`) intercepted by `JWTAuthMiddleware` in `backend/academy/middleware.py`.

---

## 3. High-Priority Preservation Directives (DO NOT BREAK)

Before modifying any code in future phases, the following production workflows MUST be protected:

1. **Salary V2 & Audit Proofs**:
   - Quran teacher payroll is computed dynamically from verified attendance sessions and class schedule durations.
   - Once payroll is marked `locked`, it is legally frozen in `payroll_source_locks.py`.
   - Modifying past attendance for locked months is strictly forbidden.
   - Files to inspect: [backend/academy/salary_v2_service.py](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/backend/academy/salary_v2_service.py), [backend/academy/payroll_source_locks.py](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/backend/academy/payroll_source_locks.py).

2. **Attendance History & Session Dual-Records**:
   - The attendance model supports both Teacher sessions and Student sessions with separate status fields (`status` for student, `teacher_attendance_status` for teacher).
   - Files to inspect: [backend/academy/models.py](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/backend/academy/models.py), [backend/academy/attendance_v2_api.py](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/backend/academy/attendance_v2_api.py).

3. **Multi-Department Boundaries**:
   - Quran coordinators MUST NEVER see, mutate, or lock Tuition department data, and vice versa.
   - Features locked by Department Admins or Platform Admins are broadcast via `services/featureAccess.ts` and validated server-side.
   - Files to inspect: [backend/accounts/models.py](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/backend/accounts/models.py), [App.tsx:1138](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/App.tsx#L1138).

4. **Teacher Retirement & Detachment**:
   - Retiring a teacher detaches their login credential without deleting historical schedules, attendance, or payroll slips (`teacher_retirement_service.py`).
   - Files to inspect: [backend/accounts/teacher_retirement_service.py](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/backend/accounts/teacher_retirement_service.py).

---

## 4. Repository Navigation Map for AI Agents

When working on a specific domain, refer to this exact file dispatch map:

| Task / Domain | Primary Frontend Files | Primary Backend Files |
| :--- | :--- | :--- |
| **Authentication & User Profiles** | `services/sessionService.ts`<br>`services/authenticatedRequest.ts`<br>`components/CoordinatorAccounts.tsx` | `backend/accounts/views.py`<br>`backend/accounts/models.py`<br>`backend/accounts/serializers.py` |
| **Class Scheduling** | `components/SchedulingTab.tsx`<br>`components/ClassCard.tsx`<br>`constants.ts` | `backend/academy/views.py`<br>`backend/academy/models.py`<br>`backend/academy/schedule_history_service.py` |
| **Attendance Tracking** | `components/AttendanceEditor.tsx`<br>`hooks/useAcademyWS.ts`<br>`services/attendancePaging.ts` | `backend/academy/attendance_v2_api.py`<br>`backend/academy/models.py`<br>`backend/academy/consumers.py` |
| **Salary V2 & Payroll** | `components/TeacherSalaryManagement.tsx`<br>`components/salary/*`<br>`components/QuranSalaryProofModal.tsx` | `backend/academy/salary_v2_service.py`<br>`backend/academy/salary_v2_api.py`<br>`backend/academy/payroll_source_locks.py` |
| **Academic Tuition Dept** | `components/tuition/*`<br>`services/tuitionApiService.ts` | `backend/tuition/views.py`<br>`backend/tuition/models.py`<br>`backend/tuition/serializers.py` |
| **Platform Administration & Notices** | `components/PlatformAdmin.tsx`<br>`components/platform/*`<br>`components/GlobalNoticeCenter.tsx` | `backend/accounts/platform_admin_api.py`<br>`backend/accounts/platform_communications_api.py` |

---

## 5. Known Environmental Constraints

1. **Python Sandbox Execution on Windows**:
   - The Windows Python sandbox environment may block long-running interactive or unmocked database operations. All checks must run non-interactively.
   - Virtualenv path: `backend/venv/Scripts/python.exe`.
2. **Localhost URL Guard in Production**:
   - Commit `de92b7606` enforced strict checks preventing fallback to `localhost:5000` or `ws://localhost:5000` when running under `quranhometutor.com`. All API URLs must resolve dynamically from browser origin or explicitly injected env vars.
3. **Pylance / VS Code Path Configuration**:
   - `pyrightconfig.json` is configured to point extra paths to `backend` and `backend/venv/Lib/site-packages`.

---

## 6. Frontend Architectural Baseline (Phase 2 Additions)

### 6.1 Routing & Portals
- **No React Router**: Routing relies on `window.location.hash`, managed by `tabFromHash()` in `App.tsx:1450`.
- **Seven Top-Level Portals**:
  1. `PlatformAdmin` (`role === "platform_admin"` or `is_superuser`)
  2. `TuitionCoordinatorPortal` (`department_type === "tuition"` + coordinator roles)
  3. `TuitionTeacherPortal` (`department_type === "tuition"` + `role === "teacher"`)
  4. `TuitionStudentPortal` (`department_type === "tuition"` + `role === "student"`)
  5. `TeacherPortal` (`department_type === "academy"` + `role === "teacher"`)
  6. `StudentPortal` (`department_type === "academy"` + `role === "student"`)
  7. Quran Coordinator Workspace (embedded in `App.tsx` for `academy` coordinator roles)
- **Coordinator Tab Locks**:
  - Main Admin feature flags (`tabFeatureKey`) control department-level availability.
  - Per-coordinator tab toggles (`coordinatorTabAccess`) allow Department Admins to hide enabled tabs.
  - `#teacher-salary` is strictly unavailable to `coordinator` role (`session?.role === "coordinator"` check blocks access).
- **Salary V2 UI Bifurcation**:
  - `department_admin` renders modern `DepartmentSalaryV2Workspace`.
  - `institution_admin` and `super_admin` render `LegacyTeacherSalaryManagement`.

### 6.2 Key Discovered Deficiencies & Orphaned Assets
- `FE-001`: `TuitionPendingPortal.tsx` imported via `lazy` in `App.tsx:82` but never rendered anywhere.
- `FE-002`: `TeacherCard.tsx` (79 lines) is completely orphaned (superseded by `ClassCard.tsx`).
- `FE-003`: Dead JSX block for `platform-admin` inside `App.tsx:4681-4685`.
- `FE-004`: `TuitionStudentPortal.tsx` Assignments tab is an explicit placeholder (`<AssignmentsTab>`).
- `FE-006`: `/#settings` direct URL navigation is intercepted and falls back to `/#dashboard`. Settings is an inlined modal.

---

---

## 7. Backend & API Route Baseline (Phase 3 Additions)

### 7.1 Backend Middleware Pipeline & Security
1. `DynamicCorsMiddleware`: Custom middleware dynamically validating origins against database `PlatformSetting` before standard CORS.
2. `MaintenanceAwareJWTAuthentication`: SimpleJWT authentication (8-hour token lifetime, rotation, blacklisting) that traps requests during scheduled maintenance windows (`PlatformMaintenanceWindow`) with HTTP 423 `MaintenanceModeException`.
3. `AcademyConsumer` WebSocket Layer: Daphne ASGI mounted at `/ws/academy/` with user-specific (`user_{id}`), role-specific (`role_{role}`), and `global` broadcast groups.

### 7.2 API Endpoint Inventory (86 Total)
- `accounts` (`/api/auth/*`): 39 routes covering JWT login, token refresh, dynamic context (`/api/auth/context/`), coordinator account management, teacher retirement transfer/archival, and platform admin tools.
- `academy` (`/api/academy/*`): 25 routes covering teachers, students, temporal class schedules, Attendance V2 sessions (`/api/academy/attendance/v2/session/`), Salary V1 slips, Salary V2 double-entry payroll (`/api/academy/salary/v2/payroll/`), and daily lesson reports.
- `tuition` (`/api/tuition/*`): 22 routes covering class levels, subjects, standard slots, teacher capabilities, student enrollments, weekly schedules, and session attendance.

---

## 8. Database Architecture & Business Workflows Baseline (Phase 4 Additions)

### 8.1 Reconciled Migration & Model Topology
- **Active Django Migrations**: Exactly **44 active migration files** (25 in `academy`, 12 in `accounts`, 7 in `tuition`). The earlier reported 47 count included the three `__init__.py` package initializers.
- **Active Django Models**: Exactly **45 concrete models** + **1 abstract model** (`tuition.models.DepartmentScopedModel`) = **46 total model classes** across the codebase (14 in `accounts`, 21 in `academy`, 11 in `tuition`).
- **Relational Field Cardinality**: 157 relations (59 `CASCADE`, 80 `SET_NULL`, 18 `PROTECT`).

### 8.2 Critical Domain & Financial Lifecycles
1. **Teacher Retirement & Login Deletion**:
   - `teacher_retirement_readiness` blocks retirement until assigned students and active classes equal 0.
   - `transfer_student_before_teacher_retirement` checks non-overlapping schedule slots across all 7 days (`Asia/Karachi` timezone).
   - `delete_teacher_login_permanently` nulls `TeacherProfile.user`, snapshots historical author names onto attendance and lessons, validates Django `Collector` cascading relations against an explicit whitelist, and deletes `User` while retaining the `TeacherProfile` record.
2. **Student Drop Streak & Rejoin Engine**:
   - 3 consecutive scheduled absences trigger an automated `QuranStudentDropEvent`, setting `class_status = OLD_DROPPED` and halting salary eligibility.
   - Rejoining via Salary V2 restores schedules and automatically creates a `QuranSalaryAdjustment` (credit) if the student dropped in an already-finalized prior month.
3. **Financial Source Locking (`payroll_source_locks.py`)**:
   - Once monthly payroll reaches `PENDING_SUPER_ADMIN`, `APPROVED`, or `PAID`, all mutations to teacher session attendance, student attendance, schedule history, and student drop states are rejected with HTTP 423.
4. **Salary V2 Double-Entry Ledger**:
   - 7-stage state machine: `CALCULATING` -> `DEPARTMENT_REVIEW` -> `PENDING_SUPER_ADMIN` -> `APPROVED` -> `PAID` (with `REJECTED` and `REOPENED` branches).
   - Itemized double-entry entries in `QuranSalaryLedgerEntry` and approved adjustments in `QuranSalaryAdjustment`.

### 8.3 Key Architectural Deficiencies Identified in Phase 4
- `DB-001` (P1 - High): Quran `ClassSchedule` lacks database-level unique/overlap constraints (enforced only at app level).
- `DB-002` (P1 - High): `StudentProfile.user` has `CASCADE` deletion, risking complete destruction of student academic history if `User` is deleted without a guarded service.
- `DB-003` (P1 - High): Absence of structural multi-tenant / cross-department database constraints.
- `DB-004` (P2 - Medium): `TuitionAttendance` unique constraint flaw for student attendance (NULL teacher allows duplicate records).
- `DB-005` (P2 - Medium): Dual coexisting salary schemas (V1 `TeacherSalarySlip` vs V2 `QuranTeacherMonthlyPayroll`).
- `WF-001` (P1 - High): Legacy import and direct ORM mutation paths could bypass Salary V2 source locks (Narrowed in Phase 5: web import views strictly enforce locks via `attendance_import_payroll.py`).
- `WF-002` (P2 - Medium): Teacher retirement student transfer has rigid zero-tolerance slot overlap requirements.
- `WF-003` (P2 - Medium): Tuition department completely lacks automated salary and payroll accounting.
- `MIG-001` (P1 - High): 5 irreversible data migrations using `RunPython.noop` on reverse.
- `MIG-002` (P2 - Medium): Tightly coupled triangular inter-app migration dependency graph (`accounts` <-> `tuition` <-> `academy`).

---

## 9. Authentication, RBAC & Security Baseline (Phase 5 Additions)

### 9.1 Authentication & Session Architecture
1. **Stateless JWT with Stateful User Validation**: Uses DRF SimpleJWT with 8-hour access tokens and 7-day refresh tokens. While the token is stateless, `MaintenanceAwareJWTAuthentication` queries PostgreSQL on every request (`User.objects.get(id=user_id)`). This guarantees that account deactivation (`user.is_active=False`) and login deletion immediately invalidate all active access tokens.
2. **Dynamic Context-Driven RBAC**: Permissions and roles are NOT embedded in JWT claims. User roles, department associations, and coordinator tab locks are dynamically loaded on each request from `accounts.User`, `accounts.UserDepartmentRole`, and `accounts.CoordinatorTabAccess`.
3. **Application-Level Multi-Tenancy**: Tenant isolation relies on application-level query scoping (`filter(department=...)`, `filter(institution=...)`).

### 9.2 Key Security Findings Identified in Phase 5
- `SEC-001` (P1 - High): WebSocket broadcaster fanout lacks multi-tenant scoping; all connected users join `global` and `role_<role>`, receiving cross-tenant notification events.
- `SEC-002` (P1 - High): WebSocket connection passes access token via URL query string (`?token=...`) exposing it in proxy access logs; `JWTAuthMiddleware` fails to verify `user.is_active`.
- `SEC-003` (P2 - Medium): Absence of server-side JWT blacklist/revocation endpoint on user logout (`clearSession()` is client-only).
- `SEC-004` (P2 - Medium): Incomplete server-side enforcement of coordinator tab locks on Quran academic APIs (enforced on accounts and attendance report sessions, but omitted on lessons and attendance v2).
- `SEC-005` (P1 - High): Tuition permanent account deletion (`DELETE /api/tuition/accounts/<id>/?permanent=true`) performs hard `user.delete()` on students, triggering destructive CASCADE deletion of student profiles and academic history (`DB-002` follow-up).
- `SEC-006` (P2 - Medium): Missing `SECURE_PROXY_SSL_HEADER` in Django settings under TLS-terminating reverse proxy.
- `SEC-007` (P3 - Low): Frontend AI Assistant uses raw browser `fetch` directly, bypassing session token auto-renewal on token expiry.

---

## 10. Infrastructure, Deployment & Operations Baseline (Phase 6 Additions)

### 10.1 Application Deployment Topology
- **Hosting Assumptions**: Reported to run on Oracle Cloud Infrastructure (OCI) Ubuntu Linux VM (`quranhometutor.com`).
- **Web & Application Routing**:
  - Nginx reverse proxy (unversioned on VM) terminates TLS on port 443 and multiplexes:
    - `/` and static assets -> Prebuilt React 19 bundle (`dist/`).
    - `/api/` -> Daphne ASGI application server on `127.0.0.1:8000`.
    - `/ws/` -> Daphne ASGI application server with WebSocket upgrades.
  - Commit `de92b760` enforces same-origin resolution: `API_BASE = window.location.origin`, `WS_BASE = wss://${window.location.host}`.
- **ASGI Process Architecture**: Daphne (`daphne==4.2.3`) is the primary server handling unified HTTP and WebSocket traffic through `config.asgi.application`.
- **Channel Layer**: Controlled by `DJANGO_CHANNEL_LAYER`. Defaults to `InMemoryChannelLayer` unless explicitly set to `"redis"`. (Multi-worker Daphne requires Redis; otherwise cross-process notifications fail).
- **Database Engine**: PostgreSQL via `psycopg2-binary==2.9.12`. No connection pooling (`CONN_MAX_AGE = 0`).

### 10.2 Backup & Disaster Recovery Architecture
- **Engine**: Implemented in `backend/accounts/platform_backups.py` and invoked via `/api/auth/platform/backups/`.
- **Format**: PostgreSQL custom-format (`pg_dump -Fc --compress=6`), verified with `pg_restore --list`, tracked with SHA-256 checksums in `PlatformBackup` model.
- **Restoration**: CLI command `python manage.py restore_platform_backup --backup-id <id> --confirm <filename>`, which automatically generates an atomic pre-restore backup before executing `pg_restore`.
- **Retention**: Automated FIFO pruning retaining between 1 and 50 backups (default: 10).
- **Single Point of Failure**: All backups are written strictly to local disk `backend/platform_backups/`. Zero off-site sync (no S3/OCI Object Storage).

### 10.3 Key Infrastructure Findings Identified in Phase 6
- `INF-001` (P1 - High): Absence of automated CI/CD pipelines, automated deployments, and rollback procedures.
- `INF-002` (P1 - High): Production reverse proxy (Nginx) configuration is completely unversioned.
- `INF-003` (P1 - High): Absence of process manager configuration (systemd service definitions for Daphne missing).
- `INF-004` (P1 - High): Disaster recovery single point of failure (backups stored on local VM disk with zero off-site replication).
- `INF-005` (P1 - High): Hardcoded `CSRF_TRUSTED_ORIGINS` in `settings.py:128` omits `https://quranhometutor.com`, blocking Django Admin authentication in production.
- `INF-006` (P2 - Medium): Default in-memory channel layer vulnerability in multi-process/multi-worker ASGI deployment.
- `INF-007` (P2 - Medium): Lack of log rotation on `backend/logs/django.log` (unbounded disk growth risk).
- `INF-008` (P2 - Medium): Absence of unauthenticated liveness/readiness health check endpoint for load balancers.
- `INF-009` (P3 - Low): Undocumented environment variables in `backend/.env.example` template (only 4 of 15 documented).
- `INF-010` (P3 - Low): Absence of media files storage configuration (`MEDIA_ROOT` / `MEDIA_URL`).
- `INF-011` (P3 - Low): Lack of PostgreSQL connection pooling / `CONN_MAX_AGE` configuration.




---

## 11. End-to-End Integration, Testing & Master Findings Baseline (Phase 7 Additions)

### 11.1 Reconciled Full-Stack Architecture
1. **Frontend-to-Backend Routing Map**:
   - Reconciled 90 active frontend client calls to 86 registered Django URL patterns and 118 method/action-specific operations.
   - Identified 85 active matched routes and 1 legacy snapshot fallback (`/api/academy/state/`).
2. **Quality Engineering & Test Topology**:
   - Frontend: 0% automated test coverage (zero test files, configs, or test runners).
   - Backend: 6 test files containing 44 test methods (`accounts` retirement/deletion, `academy` rules/pagination).
   - `tuition/` application (4,523 lines of views) has **0 tests** (`MASTER-005`).
3. **Master Findings Register (MASTER-001 through MASTER-026)**:
   - Deduplicated all prior findings (`FE-*`, `BE-*`, `DB-*`, `WF-*`, `MIG-*`, `SEC-*`, `INF-*`) into 26 canonical master issues.
   - Critical high-severity risks:
     - `MASTER-001` (P1 - High): Tuition student deletion executes `user.delete()` triggering catastrophic CASCADE deletion of `TuitionAttendance` rows (`SEC-005` / `DB-002`).
     - `MASTER-002` (P1 - High): Multi-tenant broadcast fanout leaks operational timetable and teacher metadata across institutions (`SEC-001`).
     - `MASTER-003` (P1 - High): JWT tokens in WebSocket URLs logged in plaintext by Nginx (`SEC-002`).
     - `MASTER-004` (P1 - High): Dual decoupled salary engines V1 vs V2 coexist without synchronization (`FE-005` / `BE-002`).
     - `MASTER-005` (P1 - High): Complete absence of automated tests in `backend/tuition/` (`BE-001`).
     - `MASTER-006` (P1 - High): Zero automated tests for the 28,000+ line React 19 frontend.
     - `MASTER-007` (P1 - High): Local-only database backups create disaster recovery single point of failure (`INF-004`).
     - `MASTER-008` (P1 - High): Production Nginx reverse proxy configuration unversioned (`INF-002`).
     - `MASTER-009` (P1 - High): Daphne systemd service definitions missing from repository (`INF-003`).
     - `MASTER-010` (P1 - High): Production CSRF configuration blocks Django Admin logins (`INF-005`).
     - `MASTER-011` (P1 - High): Cross-department teacher scheduling collisions unhedged at database level (`DB-003`).
4. **Corrected Historical Misconceptions**:
   - `WF-001`: Proved that attendance web imports and CLI commands strictly enforce `assert_import_unlocked`.
   - `FE-007`: Proved `App.tsx` contains mutation version stamping and catch rollback to prevent optimistic state corruption.
   - `BE-005`: Proved `/api/academy/assistant/` is actively invoked by `services/geminiService.ts:171`.

---

## 12. Final Engineering Roadmap & Implementation Register (Phase 8 Baseline)

### 12.1 Implementation Strategy & Architecture Signoff
The audit concluded with the formulation of [`15_DEVELOPMENT_ROADMAP.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/15_DEVELOPMENT_ROADMAP.md), breaking remediation into 20 discrete, independently approvable and testable engineering packages (`PKG-01` through `PKG-20`):

1. **Milestone 1: Immediate Stabilization & Critical Risk Remediation**
   - `PKG-01`: Tuition Student Deletion Soft-Archival & CASCADE Protection (`MASTER-001` - P1)
   - `PKG-02`: Production CSRF Trusted Origins Configuration (`MASTER-010` - P1)
   - `PKG-03`: WebSocket Multi-Tenant Isolation & Group Scoping (`MASTER-002` - P1)
   - `PKG-04`: WebSocket Authentication Hardening & Log Masking (`MASTER-003` - P1)
   - `PKG-05`: Unauthenticated Health & Liveness Probe Endpoint (`MASTER-018` - P2)

2. **Milestone 2: Quality Engineering & Test Harness**
   - `PKG-06`: Tuition Logging Integration & Rotating File Handler (`MASTER-015`, `MASTER-019` - P2)
   - `PKG-07`: Tuition Department Automated Backend Test Harness (`MASTER-005` - P1)
   - `PKG-08`: Frontend Testing Harness Setup (Vitest + RTL) (`MASTER-006` - P1)

3. **Milestone 3: Security & Authorization Hardening**
   - `PKG-09`: Backend Token Revocation & Explicit Logout Blacklist (`MASTER-013` - P2)
   - `PKG-10`: Backend Coordinator Tab Permission Enforcement (`MASTER-012` - P2)
   - `PKG-11`: Tuition Attendance Student Unique Constraint Fix (`MASTER-016` - P2)

4. **Milestone 4: DevOps, Reliability & Infrastructure**
   - `PKG-12`: Version-Controlled Deployment & Service Configurations (`MASTER-008`, `MASTER-009`, `MASTER-022` - P1)
   - `PKG-13`: Off-Site Database Backup Replication Strategy (`MASTER-007` - P1)
   - `PKG-14`: Multi-Process ASGI Redis Channel Layer Verification (`MASTER-014` - P2)

5. **Milestone 5: Core Architectural Consolidation**
   - `PKG-15`: Cross-Department Teacher Schedule Conflict Check (`MASTER-011` - P1)
   - `PKG-16`: Salary V1 Deprecation & Salary V2 Unified Consolidation (`MASTER-004` - P1)

6. **Milestone 6: Code Cleanliness, Settings & Monolith Refactoring**
   - `PKG-17`: Frontend Cleanups: Vite Defines, Dead Code, Assistant Auth (`MASTER-021`, `MASTER-023`, `MASTER-026` - P3)
   - `PKG-18`: Production Settings Hardening: Media Roots & Connection Pooling (`MASTER-024`, `MASTER-025` - P3)
   - `PKG-19`: Academy & Tuition Monolithic View Modularization (`MASTER-020` - P2)
   - `PKG-20`: Tuition Assignments Tab Resolution (`MASTER-017` - P2)

### 12.2 First Execution Recommendation
The highest priority package for immediate implementation is **`PKG-01`** (Tuition Student Deletion Soft-Archival & CASCADE Protection) to eliminate the catastrophic data-loss vulnerability on `TuitionAttendance`. All implementations remain strictly paused pending user approval.
   - `INF-008`: Reconciled health endpoints; proved all existing health endpoints require authentication.
