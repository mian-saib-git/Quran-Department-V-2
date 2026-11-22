# IVS Qur'an Academy Manager — Complete Testing, Reliability & Failure Mode Audit

> **Document ID**: `13_TESTING_RELIABILITY`  
> **Phase**: Phase 7 — Complete End-to-End Integration, Missing Routes, Functional Gaps, Testing, Reliability & Master Findings Audit  
> **Repository Target**: `quran----1-Role-Based-`  
> **Current Audited Branch**: `release/ivs-20261020-candidate`  
> **Audited Commit Baseline**: `de92b7606543936eafe52ed66792eedda6d4598e`  
> **Author**: Antigravity Quality Assurance Architect, Systems Reliability Engineer & Full-Stack Security Auditor  
> **Audit Execution Date**: 2026-11-03  
> **Audit Status**: VERIFIED (Exhaustive static inspection of all test suites, failure recovery paths, transactions, concurrency hazards, and unhedged workflows)

---

## 1. Executive Summary & Quality Engineering Baseline

This document provides the definitive quality engineering assessment of the IVS Qur'an Academy Manager. The audit static analysis evaluated existing automated test coverage across all frontend and backend components, mapped untested critical business paths, and performed a systematic failure mode and recovery analysis.

### 1.1 High-Level Testing Findings
1. **Frontend Automated Testing**: **0% Coverage**. Zero test frameworks (Jest, Vitest, Cypress, Playwright, React Testing Library) are installed, configured, or present in version control. The entire 28,000+ line React 19 / TypeScript UI is unhedged by automated tests.
2. **Backend Automated Testing**: **Severely Segmented Coverage**. Exactly **6 test files** containing **44 test methods** exist in the repository.
   - `backend/tuition/` (4,523 lines of views and 1,349 lines of models) contains **0 test files**.
   - `backend/academy/salary_v2_service.py` (1,674 lines of financial ledger calculations) contains **0 unit tests**.
   - Core authentication, login, token refresh, and password reset workflows contain **0 automated tests**.
   - The tested areas are concentrated exclusively in teacher retirement (`accounts`), substitute availability rules (`academy`), legacy imported salary caps (`academy`), and attendance pagination boundaries.

---

## 2. Comprehensive Inventory of Existing Automated Tests

Every test file, test class, and test method present in the repository was cataloged by inspecting source code without runtime execution.

| Test File Path | Test Framework | Test Class | Methods Count | Scenarios Tested | Security & Boundary Scenarios | Coverage Limitations |
| :--- | :--- | :--- | :---: | :--- | :--- | :--- |
| `backend/accounts/tests/test_teacher_retirement.py` | Django `TestCase` | `TeacherRetirementWorkflowTests` | **14** | Student transfers, empty teacher retirement, batch transfers, back-to-back timetable slots. | Blocks self-transfer, cross-department transfers, inactive teacher destinations, and midnight slot wraps. | Covers Quran teacher transfers; does not cover Tuition accounts or student archival. |
| `backend/accounts/tests/test_teacher_login_deletion.py` | Django `TestCase` | `TeacherLoginHardDeleteTests` | **2** | Hard deletion of teacher login while preserving historical attendance and profile records. | Asserts `TeacherRetirementBlocked` if active students remain assigned; runs Django `Collector`. | Tests single isolated teacher deletion; does not test concurrent deletions or superuser deletion. |
| `backend/accounts/notification_tests.py` | Django `TestCase` | `NotificationAccessTests` | **6** | Portal notification inbox pagination, marking as read, single clearing, and bulk clearing. | Asserts cross-user recipient isolation, unauthenticated rejection (401), and revoked coordinator tab filtering. | In-memory DB tests only; does not test ASGI WebSocket notification push delivery. |
| `backend/academy/tests/test_imported_salary_rules.py` | Django `SimpleTestCase` | `ConfirmedHistoricalSessionsTests`<br>`FullCalendarSalaryCapTests`<br>`ImportSourceLocksTests` | **12** | Corroborating attendance sessions, 5-unit weekly caps, 28/29/30/31 day calendar blocks. | Asserts that locked teacher/student source periods block salary recalculation. | Tests pure Python arithmetic in `salary_service.py` (V1); does not test Salary V2 or ledger entries. |
| `backend/academy/tests/test_attendance_pagination_and_import.py` | Django `TestCase` | `AttendancePaginationTests`<br>`QuranImportSafetyTests`<br>`TuitionAttendancePaginationTests` | **7** | Paginating 4,000+ attendance records, monthly CSV imports, rollback on late failure. | Enforces bounded page size (max 500), prevents cross-department row leakage in pagination. | Tests bulk pagination; does not test Attendance V2 session attendance or substitute booking. |
| `backend/academy/substitute_availability_rules_test.py` | Python `unittest.TestCase` | `SubstituteAvailabilityRulesTests` | **3** | Slot release rules when scheduled teacher is present, absent, or student is absent. | Asserts teacher must be marked present to be released as a substitute. | Pure function unit tests; does not test DB queries, locks, or overlapping bookings. |

**Total Existing Automated Tests: 6 Files | 8 Test Classes | 44 Test Methods**

---

## 3. Critical Missing Test Scenarios

The following matrix identifies essential business workflows and security invariants that currently have zero automated test coverage.

### 3.1 Authentication, Identity & RBAC Test Gaps
- **User Login & Credential Validation**: No test asserts that invalid passwords or non-existent usernames return 401 Unauthorized.
- **Disabled Account Login**: No test verifies that accounts with `is_active=False` or retired teachers are blocked at the JWT endpoint.
- **Token Refresh & Rotation**: No test verifies that `TokenRefreshView` successfully rotates refresh tokens and blacklists the previous token.
- **Token Expiry & Rejection**: No test verifies that an expired access token is rejected across protected API endpoints.
- **Client-Side Logout Token Validity**: No test asserts the security vulnerability that JWT tokens remain valid after client logout (`SEC-003`).
- **Cross-Institution Isolation**: No test asserts that an `institution_admin` from Institution A cannot query, update, or delete records in Institution B.
- **Coordinator Tab Permission Bypass**: No test asserts that a coordinator with `is_visible=False` for `#dropped-leave` is blocked from calling `/api/academy/dropped-leave/` (`SEC-004`).

### 3.2 Attendance V2 & Substitute Coverage Test Gaps
- **Teacher Session Creation**: No test verifies transactional creation of session attendance records via `/api/academy/teacher-session-attendance-v2/`.
- **Substitute Conflict Detection**: No test asserts that assigning a substitute teacher who is already booked in another class at the same time raises HTTP 400.
- **Payroll Lock Conflict (`HTTP 409`)**: No automated integration test simulates an attendance edit against a paid payroll period and asserts HTTP 409 Conflict.
- **Attendance Version Stamping & Rollback**: No frontend test asserts that `App.tsx` rolls back `previousRecord` upon server failure.
- **Concurrent Session Submissions**: No test asserts database row-level locking behavior (`select_for_update`) when two coordinators mark the same session simultaneously.

### 3.3 Salary V2 & Payroll Lifecycle Test Gaps
- **Minute-Level Calculation Accuracy**: Zero tests verify that Salary V2 correctly calculates hourly base rates, substitute coverage minutes, and deductions.
- **Immutable Ledger Entry Creation**: Zero tests verify that approving an adjustment creates a balanced `PayrollLedgerEntry`.
- **Approval Workflow State Machine**: Zero tests verify the multi-tier transition from `DRAFT` $\rightarrow$ `SUBMITTED` $\rightarrow$ `APPROVED` $\rightarrow$ `PAID`.
- **Unauthorized Status Modification**: No test verifies that a coordinator or teacher cannot execute `approve` or `mark_paid` actions.
- **Paid Payroll Immutability**: No test verifies that a paid payroll cannot be modified, deleted, or reopened by a non-superuser.
- **Proof Generation Invariants**: Zero tests verify the arithmetic consistency of `QuranSalaryV2ProofView`.

### 3.4 Tuition Department Test Gaps (Complete Absence)
- **Zero App Tests (`BE-001`)**: All 4,523 lines of views in `backend/tuition/views.py` have zero unit or integration tests.
- **Destructive Deletion Cascade (`SEC-005`)**: No test verifies that student deletion destroys attendance records.
- **Duplicate Student Attendance Submissions (`DB-004`)**: No test verifies that multiple student attendance records can be inserted for the same date due to the missing unique constraint.
- **Cross-Department Schedule Collision (`DB-003`)**: No test verifies that a teacher can be double-booked across Quran and Tuition timetable matrices.
- **Timetable Matrix Generation**: Zero tests verify slot calculations across varying timezones (`Asia/Karachi` vs UTC).

---

## 4. Failure Mode, Concurrency & Reliability Analysis

Every major subsystem was analyzed for failure handling, user impact, and recovery behavior under operational anomalies.

| Workflow / Subsystem | Failure Condition | Existing Source Handling | User-Facing Impact | Recovery Behavior | Missing Test Coverage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Authentication** | Access token expires while user is active on screen. | `authenticatedRequest.ts` automatically attempts `POST /api/auth/refresh/`. | Transparent to user if refresh succeeds; redirects to login if refresh fails. | Seamless retry on next request via queued promise pattern. | Token refresh race condition test with concurrent requests. |
| **AI Assistant Chat** | Access token expires during assistant chat. | `services/geminiService.ts:171` uses raw `fetch` bypassing `authenticatedRequest`. | Error banner: *"Assistant API failed with status 401"*. | User must manually reload page or trigger another API call to refresh token. | Assistant token expiry handling test (`SEC-007`). |
| **Attendance V2 Save** | Database conflict or locked payroll period (`HTTP 409`). | Catch block in `App.tsx:2366` checks version and restores `previousRecord`. | UI immediately snaps back to previous attendance state; toast error displayed. | Local state matches database; coordinator must request payroll unlock. | Rollback assertion test in frontend test harness. |
| **Attendance Import** | Excel/CSV file contains validation errors or locked dates. | `attendance_report_import.py:793` aborts entire import inside `@transaction.atomic`. | UI displays exact error count and row numbers; 0 rows imported. | Clean database rollback; zero partial imports persisted. | Covered by `test_account_transaction_rolls_back_on_a_late_failure`. |
| **Teacher Retirement** | Destination teacher has overlapping schedule conflict. | `TeacherRetirementView` returns HTTP 400 with conflicting student IDs. | Transfer modal highlights conflicting destination slot in red. | Coordinator must pick a different teacher or reschedule slot. | Covered by `test_batch_detects_two_planned_classes_at_same_destination_slot`. |
| **Tuition Student Deletion** | Coordinator clicks delete on student profile. | `TuitionAccountDetailView` executes `user.delete()` inside transaction. | Account deleted immediately; historical attendance silently purged. | **UNRECOVERABLE DATA LOSS**: Requires full PostgreSQL database backup restoration. | Deletion cascade protection test (`SEC-005`). |
| **Salary V2 Action** | Platform admin rejects payroll with missing reason. | `QuranSalaryV2PayrollView` returns HTTP 400 Bad Request. | Error modal indicates reason is mandatory for rejection. | Payroll status remains unchanged; admin provides required note. | Salary V2 rejection validation test. |
| **WebSocket Connection** | Network disconnects or Daphne restarts. | `useAcademyWS.ts` and `NotificationBell.tsx` implement exponential backoff reconnection. | Real-time bell badge and live updates pause; reconnects automatically. | Reconnects on network restore; does not auto-refetch historical missed events. | Disconnect & resynchronization test. |
| **Multi-Worker Daphne** | `DJANGO_CHANNEL_LAYER` is unset, defaulting to `InMemoryChannelLayer`. | Messages sent on Worker 1 never reach clients connected to Worker 2 (`INF-006`). | Inconsistent live updates; some users see changes instantly, others only on reload. | Requires setting `DJANGO_CHANNEL_LAYER=redis` on host. | Cross-process notification integration test. |
| **Platform Backup** | Local disk runs out of space during `pg_dump`. | `platform_backups.py` catches subprocess error and records failure in DB. | Platform admin sees backup marked as "Failed"; temporary file deleted. | System remains stable, but zero off-site backups exist (`INF-004`). | Disk exhaustion & backup failure recovery test. |

---

## 5. Concurrency & Transactional Boundary Audit

### 5.1 Database Locking Invariants
1. **Pessimistic Row Locking (`select_for_update`)**:
   - `accounts/teacher_login_deletion_service.py:29-32`: Uses `User.objects.select_for_update()` and `TeacherProfile.objects.select_for_update()`.
   - `academy/attendance_v2_api.py:1540-1544`: Uses `TeacherProfile.objects.select_for_update(of=("self",))` on all involved teacher IDs before validating substitute bookings.
   - `academy/quran_management_api.py:509`: Uses `TeacherSalarySlip.objects.select_for_update()` before updating salary slips.
   - **Conclusion**: Core financial and deletion operations properly enforce pessimistic concurrency controls against race conditions.

2. **Absence of Connection Pooling (`INF-011`)**:
   - `backend/config/settings.py` omits `CONN_MAX_AGE` (defaults to 0).
   - Under heavy concurrent load (e.g. 100+ teachers marking session attendance at 10:00 AM), Django creates and destroys a PostgreSQL connection per HTTP request, introducing CPU and TCP port exhaustion overhead.

---

## 6. Risk-Ranked Future Regression Test Priority Matrix

The following matrix provides the definitive implementation priority for future automated testing in Phase 8.

| Module / Workflow | Business Criticality | Existing Automated Tests | Primary Missing Test Scenarios | Regression Risk | Remediation Priority |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Tuition Student Deletion (`SEC-005`)** | **Critical** | **0** | Protect student profiles against hard deletion; assert attendance records survive deletion. | **Extreme** | **P0 (Immediate)** |
| **Salary V2 Calculation & Ledger** | **Critical** | **0** | Verify minute-level substitute compensation, ledger entries, and status state machine. | **High** | **P1 (High)** |
| **Authentication & Token Rotation** | **Critical** | **0** | Verify refresh token rotation, disabled account blocking, and backend logout revocation. | **High** | **P1 (High)** |
| **Attendance V2 Session & Locks** | **High** | **0** | Verify atomic session marking, substitute conflict blocking, and HTTP 409 payroll locks. | **High** | **P1 (High)** |
| **Cross-Tenant Isolation** | **Critical** | **0** | Assert multi-institution and multi-department data boundaries across all API views. | **High** | **P1 (High)** |
| **Tuition Enrollment & Matrix** | **High** | **0** | Verify class level durations, availability overlap checks, and timetable matrix reads. | **Medium** | **P2 (Medium)** |
| **Tuition Student Attendance** | **Medium** | **1** (Pagination only) | Add unique constraint and test duplicate student attendance rejection (`DB-004`). | **Medium** | **P2 (Medium)** |
| **Frontend Component Integration** | **Medium** | **0** | Install Vitest / React Testing Library; test form validation and optimistic rollbacks. | **Medium** | **P2 (Medium)** |
| **Platform Backups & Health** | **Medium** | **0** | Test automated backup creation, SHA-256 verification, and unauthenticated health check. | **Low** | **P3 (Low)** |

---

## 7. Runtime Verification Limitations

Because this audit was conducted under strictly enforced read-only safety constraints:
1. Existing test files were analyzed via static AST and regex inspection without running `pytest` or `python manage.py test`.
2. Actual test pass/fail status against the current PostgreSQL database schema remains **UNVERIFIED**.
3. Real-world network latency, database connection pooling behavior, and Redis pub/sub delivery under concurrent Daphne processes require authorized staging verification in Phase 8.
