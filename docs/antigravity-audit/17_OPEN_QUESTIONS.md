# Open Technical Questions & Operational Uncertainties

> **Document ID**: `17_OPEN_QUESTIONS`  
> **Status**: ACTIVE & TRACKED  
> **Current Phase**: Phase 7 Completed (Complete End-to-End Integration, Missing Routes, Functional Gaps, Testing, Reliability & Master Findings Audit)  
> **Repository Target**: `quran----1-Role-Based-`  
> **Production Reference**: [https://quranhometutor.com/](https://quranhometutor.com/)  
> **Last Updated**: 2026-11-03  

---

## 1. Overview

This document tracks unresolved architectural questions, deployment unknowns, and production configurations that cannot be established purely from static source code analysis. Items are investigated, verified, or escalated across sequential audit phases.

---

## 2. Infrastructure & Deployment Uncertainties

| Item ID | Category | Question / Uncertainty | Source Evidence / Context | Severity / Impact | Target Phase | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Q-INF-01** | Hosting & Web Server | Is Daphne running directly on the Oracle Linux host, or is it managed via systemd / Docker / Supervisord? | `backend/config/asgi.py`, `PROJECT.md` mention Oracle server, but no service definitions exist in repo. | Medium | Phase 6 | **RESOLVED (Static)**: Daphne ASGI confirmed (`daphne==4.2.3`); process supervisor files NOT FOUND in repo (`INF-003` / `MASTER-009`). Requires host check. |
| **Q-INF-02** | Nginx Reverse Proxy | What is the exact Nginx configuration routing HTTP and WebSocket (`/ws/*`) traffic on `quranhometutor.com`? | Code comments in `settings.py:205` mention SSL certificate on Oracle server. Reverse proxy configs NOT FOUND in repo (`INF-002` / `MASTER-008`). | High | Phase 6 | **RESOLVED (Static)**: Flow inferred from client same-origin design. Production config unversioned on host. |
| **Q-INF-03** | Redis Channel Layer | Is Redis actively running in production, or is production running on the `InMemoryChannelLayer` fallback? | `settings.py:173` defaults to `InMemoryChannelLayer` unless `DJANGO_CHANNEL_LAYER=redis`. Log warnings confirm connection failures (`INF-006` / `MASTER-014`). | High | Phase 6 | **RESOLVED (Static)**: Code supports both; default is in-memory. Host runtime check needed to verify active production layer. |
| **Q-INF-04** | SSL & HSTS Policy | In `settings.py`, `SECURE_SSL_REDIRECT = False` when `DEBUG = False`. Is SSL redirection handled exclusively by Nginx? Is `SECURE_PROXY_SSL_HEADER` configured in production? | `backend/config/settings.py:206`. Finding `SEC-006` and `BE-006`. | High | Phase 6 | **RESOLVED (Static)**: Confirmed absent in repo. Setting redirect in Django causes infinite loop without proxy SSL header. |
| **Q-INF-05** | Production CSRF Blocking | When will `CSRF_TRUSTED_ORIGINS` be updated to include `https://quranhometutor.com` so Django Admin works in production? | Finding `INF-005` / `MASTER-010`: `settings.py:128` hardcodes localhost origins only. | High | Phase 6 / 8 | **RESOLVED (Phase 8)**: Remediation plan specified in `PKG-02` (`15_DEVELOPMENT_ROADMAP.md`). |
| **Q-INF-06** | Off-Site Backup Replication | Does the production server execute an out-of-band sync (e.g. OCI CLI) to push `backend/platform_backups/` off the VM? | Finding `INF-004` / `MASTER-007`: Backups are stored only on local VM disk. | Critical | Phase 6 / 8 | OPEN (Requires Host Verification / Plan in `PKG-13`) |

---

## 3. Database & Migration State Uncertainties

| Item ID | Category | Question / Uncertainty | Source Evidence / Context | Severity / Impact | Target Phase | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Q-DAT-01** | Production Migrations | Have all 44 migrations (`academy:0025`, `accounts:0012`, `tuition:0007`) been applied to the live PostgreSQL database? | Static migration count reconciled to 44 (excluding `__init__.py`). Live production schema state remains unverified in read-only audit. | Critical | Phase 4 | **RESOLVED (Static)** |
| **Q-DAT-02** | Legacy SQLite Data | Have all legacy SQLite records been fully migrated via `import_legacy_sqlite.py`, or are there legacy tables still queried? | `README.md` references SQLite API, but `settings.py` references PostgreSQL. | Medium | Phase 6 | OPEN (Requires Host DB Check) |
| **Q-DAT-03** | Automated Backups | Is `restore_platform_backup.py` executed manually or on a scheduled cron? Where are production dumps stored? | `backend/accounts/platform_backups.py` writes to `backend/platform_backups/`. | Medium | Phase 6 | OPEN (Requires Host Cron Check) |

---

## 4. Backend Architecture & Integration Questions

| Item ID | Category | Question / Uncertainty | Source Evidence / Context | Severity / Impact | Target Phase | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Q-BE-01** | AI Proxy Bypass | Why does frontend `AssistantChat.tsx` call Gemini client-side rather than using backend `GeminiAssistantView`? | `services/geminiService.ts:171` calls `${DJANGO_API_BASE}/api/academy/assistant/` with `Bearer` token. Frontend DOES use backend proxy, but uses raw `fetch` bypassing auto-refresh (`SEC-007` / `MASTER-026`). | Medium | Phase 5 / 7 | **RESOLVED (Phase 7)** |
| **Q-BE-02** | Missing Tuition Logging | Why is the `tuition` application omitted from `settings.LOGGING["loggers"]`? | `backend/config/settings.py:247-258` configures file handlers for `academy` and `accounts`, but omits `tuition`. Tuition errors only log to console (`BE-003` / `MASTER-015`). | Low | Phase 6 / 7 | **RESOLVED (Phase 7)** |
| **Q-BE-03** | Zero Tuition Automated Tests | What is the strategy to prevent regressions in `tuition` given 0 unit tests exist for its 4,523 lines of views? | `tuition/` directory contains 0 test files; all existing tests are in `accounts/` and `academy/` (`BE-001` / `MASTER-005`). | High | Phase 7 | **RESOLVED (Phase 7)**: Documented as P1 gap in `13_TESTING_RELIABILITY.md`. |
| **Q-SEC-01** | WebSocket Cross-Tenant Leakage | When will `AcademyConsumer` channel groups be refactored to isolate events by institution and department? | Finding `SEC-001` / `MASTER-002`: Connected clients join `global` and `role_<role>`. | High | Phase 6 / 8 | **RESOLVED (Phase 8)**: Remediation plan specified in `PKG-03` (`15_DEVELOPMENT_ROADMAP.md`). |

---

## 5. Business Logic & Payroll Uncertainties

| Item ID | Category | Question / Uncertainty | Source Evidence / Context | Severity / Impact | Target Phase | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Q-BIZ-01** | Salary V1 vs V2 | Is Legacy Salary (`salary_service.py`) still active anywhere, or is Salary V2 (`salary_v2_service.py`) exclusively authoritative? | Dual endpoints coexist in backend and are partitioned by role in frontend (`FE-005` / `MASTER-004`). | Critical | Phase 3 / 7 | **RESOLVED (Phase 7)**: Fully mapped in `11_INTEGRATION_ROUTE_GAPS.md`. |
| **Q-BIZ-02** | Locked Payroll Invalidation | If an attendance record for a past locked month is modified via direct API call, does `payroll_source_locks.py` block it at the DB trigger level or application layer? | `backend/academy/payroll_source_locks.py` (983 lines). Application-layer atomic lock. | Critical | Phase 3 / 5 | **RESOLVED (Phase 3)** |
| **Q-BIZ-03** | Teacher Multi-Slot Overlap | How does the scheduler handle teacher availability when slots overlap across Quran and Tuition departments? | Separate models: `ClassSchedule` (Quran) vs `TuitionSchedule` (Tuition). Zero cross-table unique constraints (`DB-003` / `MASTER-011`). | High | Phase 4 / 7 | **RESOLVED (Phase 7)** |

---

## 6. Resolution Log

| Item ID | Resolution Summary | Verified Artifact / Evidence | Phase Resolved |
| :--- | :--- | :--- | :--- |
| **Q-FND-01** | **All Quran Coordinator Workspace tabs audited**: 8 reachable tabs (`#dashboard`, `#scheduling`, `#attendance`, `#accounts`, `#dropped-leave`, `#teacher-salary`, `#lessons`, `#reports`). `#settings` is intercepted and falls back to `#dashboard` (modal only). `#platform-admin` is only reachable via early return for superusers. `#teacher-salary` is permanently hidden/locked for role `coordinator`. | [`04_FRONTEND_NAVIGATION_ROUTES.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/04_FRONTEND_NAVIGATION_ROUTES.md) | Phase 2 |
| **Q-FND-02** | **3D WebGL Bundle isolated**: `Lanyard.tsx` (827 lines) is mounted strictly inside `TuitionStudentPortal.tsx`. It has zero bundle or runtime impact on the Quran Department or administrative workspaces. Identified static risk `FE-009`. | [`03_FRONTEND_ARCHITECTURE.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/03_FRONTEND_ARCHITECTURE.md#FE-009) | Phase 2 |
| **Q-FND-03** | **Production API Base verified**: `services/authenticatedRequest.ts` uses `const API_BASE = window.location.origin;`. Commit `de92b76` prevented localhost fallback in production, ensuring relative origin resolution. | [`services/authenticatedRequest.ts:8`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/services/authenticatedRequest.ts#L8) | Phase 2 |
| **Q-BIZ-01** | **Dual Salary Engine Coexistence verified**: Both Salary V1 (`salary_service.py`, `quran_management_api.py`) and Salary V2 (`salary_v2_service.py`, `salary_v2_api.py`) are fully active in the backend. V1 manages `TeacherSalarySlip` records via `/api/academy/teacher-salary/`, while V2 manages `QuranTeacherMonthlyPayroll` and immutable ledger entries via `/api/academy/teacher-salary-v2/`. Fully cataloged as `MASTER-004`. | [`11_INTEGRATION_ROUTE_GAPS.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/11_INTEGRATION_ROUTE_GAPS.md) | Phase 3 / 7 |
| **Q-BIZ-02** | **Application-Level Financial Source Locking verified**: `payroll_source_locks.py` enforces locks in Django Python code inside `@transaction.atomic` blocks before any attendance, schedule, or student state modification is executed. There are no PostgreSQL DB-level triggers; enforcement is 100% application-layer. | [`05_BACKEND_ARCHITECTURE.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/05_BACKEND_ARCHITECTURE.md#section-63) | Phase 3 |
| **Q-DAT-01** | **Migration Count Discrepancy Reconciled**: Reconciled the 44 vs 47 count discrepancy. Exactly 44 active `.py` migration files exist across `academy` (25), `accounts` (12), and `tuition` (7). The 47 count included the three `__init__.py` files. | [`07_DATABASE_ARCHITECTURE.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/07_DATABASE_ARCHITECTURE.md#section-21) | Phase 4 |
| **Q-BIZ-03** | **Zero Cross-Department Overlap Enforcement**: Verified that `ClassSchedule` (Quran) and `TuitionSchedule` (Tuition) are stored in completely decoupled database tables with zero cross-table unique constraints or overlap detection queries. Cataloged as `MASTER-011`. | [`11_INTEGRATION_ROUTE_GAPS.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/11_INTEGRATION_ROUTE_GAPS.md) | Phase 4 / 7 |
| **Q-BE-01** | **AI Proxy Backend Invocation Verified**: Traced `services/geminiService.ts:171`. Confirmed that `askGeminiAssistant` invokes `${DJANGO_API_BASE}/api/academy/assistant/` with `Bearer` token; it does not bypass the backend proxy. However, it uses raw browser `fetch` rather than `authenticatedRequest.ts`, leading to potential unhandled 401s on token expiry (`MASTER-026`). | [`11_INTEGRATION_ROUTE_GAPS.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/11_INTEGRATION_ROUTE_GAPS.md) | Phase 5 / 7 |
| **Q-INF-01** | **Daphne ASGI Server Verified / Supervisor Missing**: ASGI entrypoint verified in `config/asgi.py` (`daphne==4.2.3`). However, systemd unit files are NOT FOUND in repository (`MASTER-009`). Must be verified directly on Oracle host. | [`10_INFRASTRUCTURE_DEPLOYMENT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/10_INFRASTRUCTURE_DEPLOYMENT.md) | Phase 6 |
| **Q-INF-02** | **Nginx Routing Model Reconstructed**: Reverse proxy configurations are NOT FOUND in repo (`MASTER-008`). Routing architecture was reconstructed from frontend same-origin client configuration (`window.location.origin` / `host`). | [`10_INFRASTRUCTURE_DEPLOYMENT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/10_INFRASTRUCTURE_DEPLOYMENT.md) | Phase 6 |
| **Q-INF-03** | **Dual Channel Layer Configuration Verified**: `settings.py:173-197` implements conditional Redis configuration. If `DJANGO_CHANNEL_LAYER` is unset, it silently falls back to `InMemoryChannelLayer`, causing cross-process broadcast partition (`MASTER-014`). | [`10_INFRASTRUCTURE_DEPLOYMENT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/10_INFRASTRUCTURE_DEPLOYMENT.md) | Phase 6 |
| **Q-INF-04** | **Proxy Trust Discrepancy Verified**: Verified that `SECURE_SSL_REDIRECT = False` and `SECURE_PROXY_SSL_HEADER` is completely absent. Enabling SSL redirect in Django will trigger infinite redirect loops under Nginx TLS termination. | [`10_INFRASTRUCTURE_DEPLOYMENT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/10_INFRASTRUCTURE_DEPLOYMENT.md) | Phase 6 |
| **Q-DAT-03** | **Backup & Disaster Recovery Workflow Audited**: Backups are generated via `platform_backups.py` using `pg_dump -Fc` with SHA-256 and verified via `pg_restore --list`. Restoration is performed via CLI `restore_platform_backup.py`. Single point of failure identified: backups reside 100% on local VM disk with zero off-site sync (`MASTER-007`). | [`10_INFRASTRUCTURE_DEPLOYMENT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/10_INFRASTRUCTURE_DEPLOYMENT.md) | Phase 6 |
| **Q-BE-02** | **Tuition App Logging Omission Verified**: Verified in `backend/config/settings.py:247-258`. Handlers are only configured for `academy` and `accounts`. Tuition logs fall back to `root` (console only at WARNING level), leaving zero records in `django.log` (`MASTER-015`). | [`10_INFRASTRUCTURE_DEPLOYMENT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/10_INFRASTRUCTURE_DEPLOYMENT.md) | Phase 6 / 7 |
| **Q-BE-03** | **Zero Tuition Tests Audited**: Confirmed 0 test files exist for `backend/tuition/` (4,523 lines of views). Cataloged as `MASTER-005` in `14_MASTER_FINDINGS.md`. | [`13_TESTING_RELIABILITY.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/13_TESTING_RELIABILITY.md) | Phase 7 |
| **Health Check Contradiction** | **Reconciled Health Endpoints**: Phase 3 catalog incorrectly noted `AllowAny` for `AcademyHealthView`. Verified `AcademyHealthView` explicitly requires `IsAuthenticated` and `PlatformSystemHealthView` requires `IsSuperUser \| IsPlatformAdmin`. Zero public health endpoints exist (`MASTER-018`). | [`11_INTEGRATION_ROUTE_GAPS.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/11_INTEGRATION_ROUTE_GAPS.md) | Phase 7 |
