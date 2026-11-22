# Session Handoff & Phase Status Record

> **Document ID**: `SESSION_HANDOFF`  
> **Status**: DATABASE BASELINE RECONCILIATION COMPLETED (EARLIER VS LATEST COUNT CONFLICT RESOLVED: LOCAL DEV DB POSTGRESQL 18.3 ON LOCALHOST:5432 VS HISTORICAL JULY 2026 FIXTURE; OPERATIONAL ORACLE CLOUD BASELINE DISTINGUISHED; academy.0025 IMPACT ESTABLISHED: 599 LOCAL VS 1,715 FIXTURE HISTORICAL EVIDENCE ROWS; REAL RESTORED-COPY REHEARSAL MARKED STRICTLY BLOCKED; PG16.15 RUNTIME TESTING MARKED STRICTLY BLOCKED; SAFE 6-SCENARIO ROLLBACK CALIBRATED AGAINST IMPLEMENTED MODEL & LIFECYCLE RULES - PROHIBITING migrate salary zero & UNTESTED LEDGER REVERSALS; SINGLE OPERATIONAL DATABASE ivs_academy_db CONFIRMED; 314/314 AUTOMATED TESTS PASSING; PRODUCTION DEPLOYMENT RECOMMENDATION: NO-GO) — MANDATORY STOP ACTIVE — PRODUCTION ACTIVATION NOT PERMITTED  
> **Repository Target**: `quran----1-Role-Based-`  
> **Production Target**: [https://quranhometutor.com/](https://quranhometutor.com/)  
> **Current Git Branch**: `release/ivs-20261020-candidate`  
> **Current Head Commit**: `de92b7606543936eafe52ed66792eedda6d4598e` (`fix(frontend): prevent localhost API and WebSocket URLs in production`)  
> **Execution Date**: 2026-11-09  

---

## 1. Phase Completion Status

| Attribute | State |
| :--- | :--- |
| **Completed Phases** | **All Phases 1 through 8 Completed (Comprehensive Architectural Audit Complete)** |
| **Stage 1 Implementation** | **STAGE 1 COMPLETED**: New Django salary foundation app (`backend/salary/`), 7 configuration models, database constraints, safe Django Admin registration, initial migration (`0001_initial.py`), and 18/18 passing model tests (100%). |
| **Stage 2 Implementation** | **STAGE 2 COMPLETED**: Department-scoped Salary Policy Builder REST API (`backend/salary/views.py`), 2D rate matrix management, validation & publishing engine, template applier, and UI components in `components/unified-salary/`. |
| **Stage 3 Implementation** | **STAGE 3 COMPLETED**: Teacher Policy Assignments, 4 Override Scopes (Student, Plan, Teacher, Coordinator Day), Deterministic Rate Resolver Engine (`backend/salary/resolver.py`), Rate Preview API (`/api/salary/preview-rate/`), and Department Admin UI (`components/unified-salary/TeacherSalaryAssignments.tsx`). |
| **Stage 4 Implementation** | **STAGE 4 COMPLETED**: Attendance Verification & Missing-Class Reconciliation, `SalaryAttendanceVerification`, `SalaryAttendanceAudit`, `SalaryReconciliationBatch`, Quran & Tuition source adapters, unmarked class detector, non-destructive reconciliation service, Department Admin resolution API with append-only audit trail, Approval Blocker gate (`validate_attendance_approval_readiness`), and Department Admin workspace UI (`components/unified-salary/SalaryAttendanceVerification.tsx`). |
| **Stage 5 Implementation** | **STAGE 5 COMPLETED**: Deterministic Monthly Salary Calculation Engine (`backend/salary/calculation_engine.py`), Historical Student-Count Resolution, Configurable Week Start Partitioning, 2-Week Regular Earnings Minimum & Partial-Month Exceptions, Rate Precedence Resolution, Quran Lesson Plan Bonus Verification, Substitute Compensation Isolation, Official Cancellations, Policy Mid-Month Version Changes, Draft Preview API (`POST /api/salary/calculations/preview/`), Client Service (`services/salaryCalculationService.ts`), and Interactive Draft Preview UI (`components/unified-salary/MonthlySalaryPreview.tsx`). Zero mutations to attendance, student records, or ledger tables. |
| **Stage 5A Implementation** | **STAGE 5A COMPLETED**: Five-level rate precedence hierarchy (Student > Plan > Teacher > Coordinator Day > Policy Default), persistent basic salary support at policy and teacher assignment levels, basic-only / per-class / combo models, mid-month calendar day proration, incomplete calculation flagging, deduplicated lesson bonus attribution (preventing 2x Rs. 10 bonus on same date from 1 report), configurable cancellation payment rules (`paid_always`, `teacher_available_only`, `unpaid`), dynamic future payroll years, and Department Admin UI controls. |
| **Stage 6 Implementation** | **STAGE 6 COMPLETED**: Individual & Bulk Bonuses, Cuttings and Adjustments. Two adjustment modes (individual teacher & bulk department-wide/selected), 2-step confirmation safeguards with interactive exclusion table, atomic database batch execution with idempotency protection, non-hardcoded categories, recurring deductions with period deduplication, salary advance recoveries with remaining balance ceilings, append-only audit logging (`PayrollAdjustmentAudit`), strict department/institution isolation, gross-to-net reconciliation: $\text{Draft Net} = \text{Gross} + \text{Positive Adjustments} - \text{Cuttings}$, and dedicated workspace tab in `TeacherSalaryManagement.tsx`. |
| **Stage 7A Implementation** | **STAGE 7A COMPLETED**: Monthly Payroll Records, Snapshots, Recalculations and Department Submission. Normalized models (`SalaryPayrollPeriod`, `TeacherPayroll`, `PayrollEarningLine`, `PayrollCalculationSnapshot`, `PayrollLifecycleAudit`, `PayrollCorrectionRequest`), additive migration `0005`, lifecycle service (`PayrollLifecycleService`), draft generation, old-vs-new recalculation impact previews, draft recalculation with mandatory reasons and revision increments, Stage 6 adjustments integration, submission snapshot immutability, department submission locking (`DRAFT` → `PENDING_APPROVAL`), two-man return-for-correction preparation, missing attendance governance (unresolved attendance flagged as incomplete and ineligible for final approval, while submission for review is permitted), client service (`services/salaryPayrollService.ts`), management console (`components/unified-salary/MonthlyPayrollManagement.tsx`), and tab integration in `TeacherSalaryManagement.tsx`. |
| **Stage 7B Implementation** | **STAGE 7B COMPLETED**: Payroll Approvals, Correction Authority, Append-Only Immutable Ledger, Pure-Python Salary Slips, External Payment Recording, and Legacy Double-Payment Cutover Guard. Two-man correction authorization (`Institution Admin` / `Super Admin`), 8-gate final approval validation (attendance 100% verified, calculation completeness, negative salary checks, evidence fingerprint verification), approved period immutability, `PayrollLedgerEntry` append-only posting with idempotency keys and mathematical total reconciliation, external completed disbursement recording with partial payment support, `TeacherPayrollPayment` with proof file verification, pure-Python PDF 1.4 salary slip stream generator (`backend/salary/pdf_service.py`) with automatic draft watermarking, explicit activation guard (`SalaryEngineCutoverRegistry`), and role-aware workspace (`components/unified-salary/PayrollApprovalsAndPayments.tsx`). |
| **Stage 8 Verification** | **STAGE 8 COMPLETED**: Independent Full System Verification, Financial Reconciliation, and Security Boundary Auditing. 278/278 tests passed in 76.37s. Zero TypeScript errors (`tsc --noEmit`). Production bundle compiled in 38.82s. PostgreSQL validation documented as BLOCKED due to absence of disposable local environment. 0.00 delta across all independent financial reconciliation tables. **Defects & Prerequisites identified**: PDF UnicodeEncodeError crash on Arabic/Urdu names (`DEF-001`), calculation engine N+1 query density (1,607 queries per teacher), and unidirectional cutover guard requiring reverse checks on legacy write endpoints prior to Stage 9 live rollout. |
| **Stage 8A Remediation** | **STAGE 8A COMPLETED**: Post-Audit Defect Remediation & Production Readiness Gates. (1) **DEF-001 Resolved**: Pure-Python TrueType Unicode PDF generator (`backend/salary/pdf_service.py`) with full glyph shaping and RTL support for Urdu/Arabic names (`محمد طارق`, `عبد الرحمن بن خالد`) and multi-page layouts. (2) **Calculation Engine Optimized**: Pre-fetching contexts (`RateResolutionContext`, `CalculationPrefetchContext`) reduced queries from 1,335 down to **15 queries constant** (98.9% - 99.8% reduction, ~54x-100x speedup) with 0.00 financial delta. (3) **PostgreSQL Validation**: Maintained as **BLOCKED**; isolated test container requirements specified. (4) **Browser Functional Verification**: Documented checklist and maintained as **NOT TESTED** in the absence of browser harness. (5) **Legacy Double-Payment Guard**: Fully audited V1/V2 write endpoints and prepared Stage 9 reverse guard design. (6) **Test Suite**: 285/285 tests passed (100%) in 51.12s. Frontend build clean. |
| **Stage 9A Preparation** | **STAGE 9A COMPLETED**: Safe Cutover Preparation, Reverse Legacy Guards, and Final Readiness. (1) Centralized ownership guard via `SalaryEngineCutoverRegistry`. (2) 17 legacy write paths guarded returning HTTP 409. (3) Cross-engine conflict auditor. (4) 314/314 tests passed. |
| **Stage 9B Acceptance & Evidence Audit** | **STAGE 9B EVIDENCE AUDIT COMPLETED**: Final Acceptance Evidence Audit & Reclassification. (1) **Browser Evidence Disclosed**: Forensic analysis showed `wf_01.png` - `wf_19.png` were synthetic mock cards rendered from inline HTML templates (`generate_browser_evidence.js`); underlying tests were backend integration tests via `run_acceptance_suite.py` using `APIRequestFactory`. (2) **Real UI Status**: Formally classified as **NOT TESTED / BLOCKED** due to Windows loopback socket isolation and host port 5000 safety conflict with live `ivs_academy_db`. Detailed 15-flow Manual Owner Acceptance Checklist created. (3) **Automated Regression**: 314/314 backend tests passing (100%) in 31.51s. (4) **TypeScript & Vite Build**: Compiles cleanly with 0 errors (`tsc --noEmit`). (5) **PostgreSQL 16 Compatibility**: Retained as **BLOCKED** for local execution (host has only PG18.3, no Docker); static SQL feature compatibility confirmed; staging container plan provided. (6) **Release Inventory & Font Licensing**: All 14 backend modules, 14 React components, 6 services, and font asset inventoried; recommendation to package `LICENSE.txt` for DejaVu Sans noted. (7) **Recommendation**: Factual **NO-GO FOR PRODUCTION DEPLOYMENT** until owner manual checklist and PG16 runtime test are satisfied. |
| **Current Git Branch** | `release/ivs-20261020-candidate` (Clean working tree relative to planned cutover) |
| **Current Head Commit** | `de92b7606543936eafe52ed66792eedda6d4598e` |
| **Git Working Tree** | Clean except pre-existing coordinator blank-screen fix in `App.tsx`, minimal app registration in `backend/config/settings.py`, and Unified Salary Management files in `backend/salary/`, `components/unified-salary/`, `services/`, and `docs/antigravity-audit/`. Zero alterations to legacy engines or historical tables. |
| **Key Audit Reports** | [`30_STAGE_9B_PREACTIVATION_ACCEPTANCE_REPORT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/30_STAGE_9B_PREACTIVATION_ACCEPTANCE_REPORT.md)<br>[`31_FINAL_BROWSER_ACCEPTANCE_REPORT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/31_FINAL_BROWSER_ACCEPTANCE_REPORT.md)<br>[`32_FINAL_ACCEPTANCE_EVIDENCE_AUDIT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/32_FINAL_ACCEPTANCE_EVIDENCE_AUDIT.md)<br>[`34_SINGLE_DATABASE_MIGRATION_READINESS_REPORT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/34_SINGLE_DATABASE_MIGRATION_READINESS_REPORT.md)<br>[`35_DATABASE_BASELINE_RECONCILIATION_REPORT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/35_DATABASE_BASELINE_RECONCILIATION_REPORT.md) |
| **Next Stage Status** | **DATABASE BASELINE RECONCILIATION COMPLETE. RESTORE REHEARSAL & PG16 RUNTIME STRICTLY BLOCKED. PRODUCTION DEPLOYMENT: NO-GO. MANDATORY STOP ACTIVE. DO NOT ACTIVATE PRODUCTION. DO NOT COMMIT, PUSH OR DEPLOY.** |

---

## 1.1 Stage 1 Artifacts & Verification Summary

1. **Exact Files Created / Modified**:
   - `backend/salary/__init__.py` (New package)
   - `backend/salary/apps.py` (New `SalaryConfig` registration)
   - `backend/salary/models.py` (7 Foundation Models: `SalaryPolicy`, `SalaryPolicyVersion`, `SalaryRateTier`, `SalaryTeachingPlan`, `SalaryPlanTierRate`, `TeacherPolicyAssignment`, `TeacherSalaryOverride`)
   - `backend/salary/admin.py` (Safe Django Admin inspection with published immutability protection)
   - `backend/salary/migrations/__init__.py`
   - `backend/salary/migrations/0001_initial.py` (Initial schema migration)
   - `backend/salary/tests/__init__.py`
   - `backend/salary/tests/test_policy_models.py` (18 focused unit tests)
   - `backend/config/settings.py` (Registered `'salary'` in `INSTALLED_APPS`)
   - `docs/antigravity-audit/19_STAGE_1_SALARY_FOUNDATION_REPORT.md` (Stage 1 detailed report)
   - `docs/antigravity-audit/SESSION_HANDOFF.md` (Updated status)

2. **Model Relationships**:
   - `accounts.Department` $\rightarrow$ `SalaryPolicy` $\rightarrow$ `SalaryPolicyVersion` $\rightarrow$ (`SalaryRateTier`, `SalaryTeachingPlan`, `SalaryPlanTierRate`).
   - `academy.TeacherProfile` $\rightarrow$ `TeacherPolicyAssignment` (scoped to `Department`).
   - `academy.TeacherProfile` $\rightarrow$ `TeacherSalaryOverride` (5-level priority: student-specific, plan-specific, teacher-wide, coordinator-day, department-default).

3. **Database Constraints & Schema Safety**:
   - Unique constraints on policy codes per department, version numbers per policy, tier orders, plan codes, and matrix cells `(version, plan, tier)`.
   - Check constraints for non-negative rates, positive student tier bounds, and valid date intervals (`effective_to >= effective_from`).
   - Cross-version rate cell integrity enforced in `clean()`.
   - Immutable published policy versions protected against ordinary app and Django Admin edits.

4. **Automated Test Results**:
   - 18 tests created in `backend/salary/tests/test_policy_models.py`.
   - 18 tests executed in isolated SQLite in-memory test environment.
   - **18 passed (100%), 0 failed, 0 skipped**.

5. **Migration Safety**:
   - `0001_initial.py` inspected via `sqlmigrate salary 0001`.
   - Not applied to `ivs_academy_db` or production database.
   - Zero legacy tables modified or dropped.

6. **Next Stage Prerequisites**:
   - Owner authorization to begin **Stage 2: Attendance Verification & Unmarked Class Pipeline**.

---

## 2. Phase 8 Deliverables & Calibrated Audit Baseline

1. **Verification & Calibration of All 26 Master Findings**:
   - **Django CSRF (`MASTER-010`)**: Calibrated to reflect that REST APIs use SimpleJWT stateless Bearer authentication which is exempt from CSRF. The issue specifically blocks session-authenticated Django Admin views (`/admin/login/`) when accessed from `https://quranhometutor.com/`.
   - **Nginx JWT Logging (`MASTER-003`)**: Calibrated to reflect that tokens are passed in query params due to browser WebSocket API header constraints; default Nginx `$request` logging captures the raw query string into `/var/log/nginx/access.log`, persisting active 8-hour tokens into system log files.
   - **Automated Test Coverage (`MASTER-005`, `MASTER-006`)**: Verified exact counts: Frontend has 0 test files / 0% coverage. Backend has 6 test files (44 test methods). `backend/tuition/` (4,523 lines of views) has 0 tests. `salary_v2_service.py` (1,674 lines) has 0 tests. Core auth/login has 0 tests.
   - **Salary V1 vs V2 Models & Exact Statuses (`MASTER-004`)**:
     - `TeacherSalarySlip` (V1): Status choices are `DRAFT ("draft")` and `PROCESSED ("processed")`.
     - `QuranTeacherMonthlyPayroll` (V2): Status choices are `CALCULATING ("calculating")`, `DEPARTMENT_REVIEW ("department_review")`, `PENDING_SUPER_ADMIN ("pending_super_admin")`, `APPROVED ("approved")`, `REJECTED ("rejected")`, `PAID ("paid")`, and `REOPENED ("reopened")`.
   - **Production Infrastructure Assumptions (`MASTER-007`, `MASTER-008`, `MASTER-009`, `MASTER-014`)**: Delineated verified repo code (e.g. `platform_backups.py` local dumps, `CHANNEL_LAYERS` in-memory fallback) from unversioned host-level runtime state on Oracle Cloud.

2. **Full Implementation Package Register (20 Discrete Packages)**:
   - Formulated 20 separately approvable, testable, and roll-backable packages across 6 sequential engineering milestones:
     - **Milestone 1**: `PKG-01` (Tuition student deletion soft-archival), `PKG-02` (CSRF trusted origins), `PKG-03` (WebSocket multi-tenant isolation), `PKG-04` (WebSocket ticket auth / log masking), `PKG-05` (Unauthenticated health check).
     - **Milestone 2**: `PKG-06` (Tuition logging & rotation), `PKG-07` (Tuition automated tests), `PKG-08` (Frontend Vitest harness).
     - **Milestone 3**: `PKG-09` (Logout token blacklist), `PKG-10` (Coordinator tab backend permissions), `PKG-11` (Tuition student unique constraint).
     - **Milestone 4**: `PKG-12` (Versioned Nginx & Daphne configs), `PKG-13` (Off-site cloud backup sync), `PKG-14` (Multi-worker ASGI Redis validation).
     - **Milestone 5**: `PKG-15` (Cross-department schedule conflict check), `PKG-16` (Salary V1 deprecation & V2 migration).
     - **Milestone 6**: `PKG-17` (Frontend Vite defines & dead code cleanup), `PKG-18` (Production media roots & connection pooling), `PKG-19` (Modularize monolithic views), `PKG-20` (Tuition assignments tab resolution).

3. **Recommended First Package**:
   - **`PKG-01: Tuition Student Deletion Soft-Archival & CASCADE Protection`**: Eliminates active P1 data loss risk on `TuitionAttendance` without affecting Quran Department workflows.

---

## 3. Resumption Instructions for Implementation Phase

> [!CAUTION]
> **READ-ONLY AUDIT COMPLETE — AWAITING EXPLICIT APPROVAL TO BEGIN IMPLEMENTATION**:
> No packages have been executed. No application code, databases, configurations, or Git states were altered.
> Work is paused awaiting explicit authorization before executing `PKG-01`.

---

## 2. Areas Investigated & Verified in Phase 7

1. **Complete Integration & Route Mapping**:
   - Reconciled 90 active frontend client calls with 86 registered Django URL patterns and 118 method/action-specific backend operations.
   - Identified 85 fully matched active endpoints and 1 legacy snapshot endpoint (`/api/academy/state/`).
   - Disproved that `/api/academy/assistant/` is an orphaned proxy: verified active invocation by `services/geminiService.ts:171`.
2. **Account Lifecycle & High-Risk Deletion (`MASTER-001`)**:
   - Traced Quran teacher retirement and login deletion: verifies student zero-balance, runs Django `Collector`, snapshots historical attribution, and cleanly deletes `User` while preserving `TeacherProfile` and attendance.
   - Traced Tuition student deletion: verified that `removeTuitionAccount` passes `permanent=true` to `DELETE /api/tuition/accounts/<id>/`, which directly executes `user.delete()`. Because `TuitionAttendance.student` has `on_delete=CASCADE`, all historical tuition attendance records are permanently destroyed (`SEC-005` / `DB-002`).
3. **Attendance V2 & Optimistic State Rollback**:
   - Re-evaluated `FE-007`: Proved that `App.tsx` contains mutation version stamping (`attendanceMutationVersionRef`) and automatic error rollback to `previousRecord`. The database is protected; state drift is limited to multi-client websocket drops.
   - Re-evaluated `WF-001`: Proved that attendance web imports (`attendance_report_import.py`) and CLI commands (`import_monthly_attendance.py`) strictly enforce `assert_import_unlocked`. Financial locks cannot be bypassed via attendance imports.
4. **Dual Salary Engine Coexistence (`MASTER-004`)**:
   - Proved that `TeacherSalaryManagement.tsx` switches based on role: renders `DepartmentSalaryV2Workspace` for `department_admin`, but renders `LegacyTeacherSalaryManagement` (V1) for all other roles.
   - Proved that Salary V1 (`TeacherSalarySlip`) and Salary V2 (`QuranTeacherMonthlyPayroll` + `PayrollLedgerEntry`) are completely decoupled in the backend with zero cross-table synchronization.
5. **Tuition Department Gaps**:
   - Verified that `components/tuition/TuitionPendingPortal.tsx` is unmounted dead code (`MASTER-021`).
   - Verified that the Tuition Student Portal "Assignments" tab is a static UI placeholder with zero backend models or endpoints (`MASTER-017`).
   - Verified that `TuitionAttendance` unique constraint covers only `teacher` and lacks student uniqueness protection, permitting duplicate records (`MASTER-016`).
   - Confirmed complete absence of tuition salary or compensation workflows.
6. **WebSocket Fanout & Credential Security**:
   - Confirmed `MASTER-002`: Channel groups join only user, role, and global groups. Operational timetable and teacher presence metadata is broadcast globally across tenants.
   - Confirmed `MASTER-003`: JWT tokens in WebSocket URLs (`/ws/academy/?token=...`) are logged in plaintext by Nginx.
7. **AI Assistant Security & Build Configuration**:
   - Verified `vite.config.ts:23-24` defines `process.env.API_KEY` with `GEMINI_API_KEY`. Although unreferenced in frontend code, Vite's `define` creates an architectural risk if referenced by dependencies (`MASTER-023`).
   - Verified `services/geminiService.ts:171` uses raw `fetch` bypassing automated token refresh (`MASTER-026`).
8. **Health Endpoint Contradiction Resolved**:
   - Reconciled Phase 3 vs Phase 6 claims: `AcademyHealthView` explicitly enforces `permission_classes = [IsAuthenticated]`. Zero public, unauthenticated health check endpoints exist in the application (`MASTER-018`).
9. **Quality Engineering & Test Inventory**:
   - Cataloged all 6 existing test files (44 test methods).
   - Documented 0% frontend test coverage (`MASTER-006`) and 0 tests in `backend/tuition/` (`MASTER-005`).
   - Formulated a risk-ranked regression test priority matrix.
10. **Master Findings Register**:
    - Deduplicated and consolidated all historical findings into 26 canonical master issues (`MASTER-001` through `MASTER-026`): 0 P0, 11 P1, 9 P2, 6 P3.

---

## 3. Master Findings Summary Table

| Master Finding ID | Severity | Category | Title / Description | Original Finding IDs | Confidence |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **`MASTER-001`** | **P1 (High)** | Data Integrity | Tuition Student Deletion Triggers Irreversible CASCADE Deletion of Historical Attendance | `SEC-005`, `DB-002`, `DB-001` | **VERIFIED SOURCE FACT** |
| **`MASTER-002`** | **P1 (High)** | Security / RBAC | Cross-Tenant WebSocket Broadcast Fanout Exposes Operational Scheduling Metadata | `SEC-001` | **VERIFIED SOURCE FACT** |
| **`MASTER-003`** | **P1 (High)** | Security / Logs | Plaintext JWT Access Tokens Exposed in WebSocket URLs & Nginx Access Logs | `SEC-002` | **VERIFIED SOURCE FACT** |
| **`MASTER-004`** | **P1 (High)** | Financial | Dual Decoupled Salary Engines Coexist Without Data or Financial Synchronization | `FE-005`, `BE-002`, `DB-001` | **VERIFIED SOURCE FACT** |
| **`MASTER-005`** | **P1 (High)** | QA / Reliability | Complete Absence of Automated Test Coverage in Tuition Application (4,523 lines untested) | `BE-001` | **VERIFIED SOURCE FACT** |
| **`MASTER-006`** | **P1 (High)** | QA / Reliability | Complete Absence of Frontend Automated Testing Harness (0% Coverage across 28,000+ lines)| New | **VERIFIED SOURCE FACT** |
| **`MASTER-007`** | **P1 (High)** | Disaster Recovery | Single Point of Failure in Disaster Recovery — Local VM Disk Backups Only (Zero Off-Site Sync) | `INF-004` | **VERIFIED SOURCE FACT** |
| **`MASTER-008`** | **P1 (High)** | DevOps / Proxy | Production Reverse Proxy (Nginx) Configuration Unversioned in Version Control | `INF-002` | **VERIFIED SOURCE FACT** |
| **`MASTER-009`** | **P1 (High)** | DevOps / Process | Process Supervisor & Systemd Daphne Service Configuration Missing from Repository | `INF-003` | **VERIFIED SOURCE FACT** |
| **`MASTER-010`** | **P1 (High)** | Security / Admin | Hardcoded Localhost `CSRF_TRUSTED_ORIGINS` Blocks Django Admin on Production Host | `INF-005` | **VERIFIED SOURCE FACT** |
| **`MASTER-011`** | **P1 (High)** | Scheduling | Decoupled Schedule Models Permit Unrestricted Cross-Department Teacher Double-Booking | `DB-003` | **VERIFIED SOURCE FACT** |
| **`MASTER-012`** | **P2 (Medium)**| Security / Auth | Coordinator Tab Access Restrictions Enforced on Client Only in Quran Department | `SEC-004`, `FE-008` | **VERIFIED SOURCE FACT** |
| **`MASTER-013`** | **P2 (Medium)**| Security / Auth | Client-Only Logout Lacks Backend Token Revocation / Blacklisting | `SEC-003` | **VERIFIED SOURCE FACT** |
| **`MASTER-014`** | **P2 (Medium)**| Messaging / WS | In-Memory Channel Layer Vulnerability in Multi-Process ASGI Deployment | `INF-006` | **VERIFIED SOURCE FACT** |
| **`MASTER-015`** | **P2 (Medium)**| Observability | Tuition Application Missing from Django Logging Configuration | `BE-003` | **VERIFIED SOURCE FACT** |
| **`MASTER-016`** | **P2 (Medium)**| Data Integrity | `TuitionAttendance` Unique Constraint Flaw Permits Duplicate Student Attendance Rows | `DB-004` | **VERIFIED SOURCE FACT** |
| **`MASTER-017`** | **P2 (Medium)**| Completeness | Tuition Assignments Screen Is a Hardcoded Static UI Placeholder with Zero Backend Models | `FE-004` | **VERIFIED SOURCE FACT** |
| **`MASTER-018`** | **P2 (Medium)**| Observability | Absence of Unauthenticated Liveness / Readiness Health Check Endpoint for Load Balancers | `INF-008` | **VERIFIED SOURCE FACT** |
| **`MASTER-019`** | **P2 (Medium)**| Reliability | Django Logging Lacks Log Rotation on `django.log` (Unbounded Disk Growth Risk) | `INF-007` | **VERIFIED SOURCE FACT** |
| **`MASTER-020`** | **P2 (Medium)**| Architecture | Extreme Monolithic View Files in Academy (5,091 lines) and Tuition (4,523 lines) | `BE-004` | **VERIFIED SOURCE FACT** |
| **`MASTER-021`** | **P3 (Low)** | Code Cleanliness | Dead Code: `TuitionPendingPortal.tsx` Lazy-Loaded but Unmounted in Application Tree | `FE-001` | **VERIFIED SOURCE FACT** |
| **`MASTER-022`** | **P3 (Low)** | DevOps / Docs | Undocumented Production Environment Variables in Template (11 of 15 Undocumented) | `INF-009` | **VERIFIED SOURCE FACT** |
| **`MASTER-023`** | **P3 (Low)** | Build Config | Vite `define` Injects Secret API Key Identifier into Build Configuration Defines | `FE-006` | **VERIFIED SOURCE FACT** |
| **`MASTER-024`** | **P3 (Low)** | Performance | Absence of Database Connection Pooling / `CONN_MAX_AGE = 0` (Connection per Request) | `INF-011` | **VERIFIED SOURCE FACT** |
| **`MASTER-025`** | **P3 (Low)** | Configuration | Uploaded Media Files Configuration Absent in Django Settings (`MEDIA_ROOT` / `MEDIA_URL` missing)| `INF-010` | **VERIFIED SOURCE FACT** |
| **`MASTER-026`** | **P3 (Low)** | Reliability | Assistant Chat Uses Raw `fetch` Directly Bypassing Automated Token Refresh | `SEC-007` | **VERIFIED SOURCE FACT** |

---

## 4. Resumption Plan for Phase 8

### Next Step: **PHASE 8: Final Development Roadmap & Architecture Signoff (Awaiting Authorization)**
- **Scheduled Deliverable**:
  - `docs/antigravity-audit/15_DEVELOPMENT_ROADMAP.md`
- **Scope of Phase 8**:
  1. Structure a phased, prioritized engineering roadmap to remediate all 26 Master Findings.
  2. Define immediate stabilization sprints (P1: Tuition student deletion fix, CSRF fix, WebSocket tenant scoping, health check endpoint, Nginx versioning).
  3. Define quality engineering sprint (P1: Tuition test harness, Salary V2 test suite, Vitest frontend harness).
  4. Define architectural consolidation sprint (Salary V1 deprecation, monolithic view splitting, cross-department schedule constraint).
  5. Provide final architectural signoff and risk closure summary.

---

> [!IMPORTANT]
> **Database Baseline Reconciliation & Restore Verification Completed (2026-11-09)**:
> Reconciled earlier operational database audit counts (27 users, 5 teachers, 18 students, 595 attendance, 0 V1 slips, 7 V2 payrolls) against latest rehearsal fixture counts (967 users, 73 teachers, 888 students, 1,599 attendance, 355 V1 slips). Forensic evidence proved they represent two different datasets from different points in time: (1) local PostgreSQL 18.3 development database on `localhost:5432` initialized Oct 2026, and (2) historical JSON snapshot from July 17, 2026. Neither represents current Oracle Cloud production data. Migration `academy.0025` row impact established (599 local vs 1,715 fixture), modifying only intended historical text snapshot columns. Genuine restored-copy rehearsal and PostgreSQL 16.15 runtime testing marked strictly **BLOCKED**. Prohibited `migrate salary zero` and unverified compensating ledger reversals; calibrated safe 6-scenario rollback procedures strictly against implemented models and lifecycle rules. Full report documented in [`35_DATABASE_BASELINE_RECONCILIATION_REPORT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/35_DATABASE_BASELINE_RECONCILIATION_REPORT.md).
> **MANDATORY STOP ACTIVE**: Final reconciliation complete. Zero code committed or pushed. Zero production databases modified. Zero databases deleted. Production deployment remains **STRICTLY NO-GO** pending authorized live backup export, genuine restored-copy rehearsal, certified PG16.15 runtime validation, and explicit system owner sign-off.
