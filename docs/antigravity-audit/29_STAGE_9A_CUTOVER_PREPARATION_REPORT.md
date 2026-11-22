# IVS Unified Salary Management — Stage 9A: Safe Cutover Preparation, Reverse Legacy Guards and Final Readiness

> **Audit Framework**: Comprehensive Architectural Audit & Permanent Technical Reference  
> **Production Target**: [https://quranhometutor.com/](https://quranhometutor.com/)  
> **Repository**: `quran----1-Role-Based-` (Current branch: `release/ivs-20261020-candidate`, Base commit: `de92b7606543936eafe52ed66792eedda6d4598e`)  
> **Author**: Antigravity Senior Software Architect & Engineering Audit Team  
> **Date**: 2026-11-09  
> **Status**: **STAGE 9A COMPLETE — PENDING DISPOSABLE POSTGRESQL & BROWSER GATES**

---

## 1. Executive Summary & Direction Compliance

Stage 9A is the pre-activation readiness phase authorized to establish bidirectional, strict cutover safety guards between the new **Unified Salary Management Engine** (`salary` app) and the two legacy salary engines:
1. **Salary V1**: Legacy `TeacherSalarySlip` in `backend/academy/salary_service.py` and `backend/academy/quran_management_api.py`.
2. **Salary V2**: Legacy `QuranTeacherMonthlyPayroll` in `backend/academy/salary_v2_service.py` and `backend/academy/salary_v2_api.py`.

### Non-Negotiable Objective
> **Before Unified Salary is enabled for any real department and payroll month, both the new system and the legacy systems must enforce the same department-and-period ownership rule. There must be no path allowing the same teacher's payroll to be independently approved or paid through two engines.**

### Strict Scope Boundaries
- **Zero Live Database Mutations**: Neither `ivs_academy_db`, Oracle Cloud, nor any external databases were contacted or modified.
- **No Production Activation**: All cutover registry entries remain in synthetic, isolated memory. No department or period is activated in production.
- **Preserved Working Tree Integrity**: All unrelated working-tree modifications, particularly the coordinator tab blank-screen guard in `App.tsx`, were strictly preserved.
- **Zero Git State Violations**: No `git restore`, `reset`, `pull`, `merge`, `commit`, or `push` commands were run.
- **Clean Execution Gate**: 314 out of 314 automated tests passing (100%). Frontend Vite build compiles cleanly with 0 TypeScript errors.

---

## 2. Centralized Salary Engine Ownership Guard Architecture

Authoritative ownership is determined by a single centralized source of truth:
```
(Institution, Department, Payroll Year, Payroll Month) -> Applicable Salary Engine (LEGACY_V1_V2 vs UNIFIED)
```

### 2.1 The Cutover Registry (`SalaryEngineCutoverRegistry`)
Located in `backend/salary/models.py`, `SalaryEngineCutoverRegistry` enforces strict uniqueness:
```python
class SalaryEngineCutoverRegistry(models.Model):
    department = models.ForeignKey("accounts.Department", on_delete=models.CASCADE)
    year = models.PositiveIntegerField()
    month = models.PositiveIntegerField()
    is_unified_active = models.BooleanField(default=False)
    activated_at = models.DateTimeField(null=True, blank=True)
    activated_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["department", "year", "month"],
                name="unique_salary_cutover_per_dept_period"
            )
        ]
```
Convenience properties provide institutional context and authoritative engine resolution:
- `.institution`: Resolves to `department.institution`.
- `.applicable_salary_engine`: Returns `"UNIFIED"` when `is_unified_active=True`, otherwise `"LEGACY_V1_V2"`.

### 2.2 Reusable Server-Side Guard Service (`backend/salary/cutover_guard.py`)
To prevent ad-hoc checks or view-level bypasses, all ownership resolution is centralized in `backend/salary/cutover_guard.py`:
- `is_unified_salary_active(department, year, month)`: Checks persisted registry state.
- `get_salary_engine_for_period(department, year, month)`: Returns `"UNIFIED"` or `"LEGACY_V1_V2"`.
- `assert_legacy_salary_write_permitted(department, year, month, operation_name)`: Raises `LegacySalaryMutationDeniedError` if Unified is active.
- `check_legacy_write_guard(department, year, month, operation_name)`: Returns a standard DRF `Response(..., status=409)` for direct view interception.
- `assert_bulk_legacy_write_permitted(department, periods, operation_name)`: Atomically validates all affected periods in a bulk operation.
- `assert_unified_salary_write_permitted(department, year, month, operation_name)`: Prevents Unified operations from finalizing or paying on legacy-owned periods.

---

## 3. Inventory and Protection of All Legacy Write Paths

A comprehensive scan of DRF views, service functions, management commands, and background triggers was conducted. All legacy write paths are guarded at service and API boundaries:

| # | Subsystem / File | Entry Point / Function | Protected Action | Guard Implementation |
|---|---|---|---|---|
| 1 | **Salary V1 Service** (`salary_service.py`) | `calculate_teacher_salary` | Calculation / draft generation | `assert_legacy_salary_write_permitted(..., "calculate_teacher_salary (V1)")` |
| 2 | **Salary V1 Service** (`salary_service.py`) | `refresh_salary_slip` | Slip refresh mutation | `assert_legacy_salary_write_permitted(..., "refresh_salary_slip (V1)")` |
| 3 | **Salary V1 API** (`quran_management_api.py`) | `QuranSalaryDashboardView.get` | Auto-refresh on slip read | Conditional: returns historical slips without mutation when Unified is active |
| 4 | **Salary V1 API** (`quran_management_api.py`) | `QuranSalaryDashboardView.patch` | Slip finalization / update | `check_legacy_write_guard(..., "update_salary_slip (V1)")` -> HTTP 409 |
| 5 | **Salary V2 Service** (`salary_v2_service.py`) | `calculate_department_payrolls` | Bulk department calculation | `assert_legacy_salary_write_permitted(..., "calculate_department_payrolls (V2)")` |
| 6 | **Salary V2 Service** (`salary_v2_service.py`) | `calculate_teacher_payroll` | Teacher calculation | `assert_legacy_salary_write_permitted(..., "calculate_teacher_payroll (V2)")` |
| 7 | **Salary V2 API** (`salary_v2_api.py`) | `QuranTeacherMonthlyPayrollViewSet` (Action: `calculate`) | Trigger calculation | `check_legacy_write_guard(..., "calculate_payrolls (V2)")` -> HTTP 409 |
| 8 | **Salary V2 API** (`salary_v2_api.py`) | `QuranTeacherMonthlyPayrollViewSet` (Action: `propose_adjustment`) | Create proposed adjustment | `check_legacy_write_guard(..., "propose_adjustment (V2)")` -> HTTP 409 |
| 9 | **Salary V2 API** (`salary_v2_api.py`) | `QuranTeacherMonthlyPayrollViewSet` (Action: `approve_adjustment`) | Approve adjustment | `check_legacy_write_guard(..., "approve_adjustment (V2)")` -> HTTP 409 |
| 10 | **Salary V2 API** (`salary_v2_api.py`) | `QuranTeacherMonthlyPayrollViewSet` (Action: `reject_adjustment`) | Reject adjustment | `check_legacy_write_guard(..., "reject_adjustment (V2)")` -> HTTP 409 |
| 11 | **Salary V2 API** (`salary_v2_api.py`) | `QuranTeacherMonthlyPayrollViewSet` (Action: `submit`) | Department submission | `check_legacy_write_guard(..., "submit_payroll (V2)")` -> HTTP 409 |
| 12 | **Salary V2 API** (`salary_v2_api.py`) | `QuranTeacherMonthlyPayrollViewSet` (Action: `approve`) | Super Admin approval | `check_legacy_write_guard(..., "approve_payroll (V2)")` -> HTTP 409 |
| 13 | **Salary V2 API** (`salary_v2_api.py`) | `QuranTeacherMonthlyPayrollViewSet` (Action: `reject`) | Super Admin rejection | `check_legacy_write_guard(..., "reject_payroll (V2)")` -> HTTP 409 |
| 14 | **Salary V2 API** (`salary_v2_api.py`) | `QuranTeacherMonthlyPayrollViewSet` (Action: `mark_paid`) | Mark payroll paid / disburse | `check_legacy_write_guard(..., "mark_paid_payroll (V2)")` -> HTTP 409 |
| 15 | **Salary V2 API** (`salary_v2_api.py`) | `QuranTeacherMonthlyPayrollViewSet` (Action: `reopen`) | Reopen payroll | `check_legacy_write_guard(..., "reopen_payroll (V2)")` -> HTTP 409 |
| 16 | **Student Rejoin Service** (`student_rejoin_service.py`) | `rejoin_student_drop` | Drop streak retroactive adjustment | `assert_bulk_legacy_write_permitted(department, affected_months, ...)` -> StudentRejoinError |
| 17 | **Management Command** (`recalculate_imported_salary.py`) | `Command.handle` | Batch recalculation of legacy slips | Checks cutover per slip; skips and logs warning if Unified active |

---

## 4. Cross-Engine Pre-Activation Conflict Auditor

Implemented in `backend/salary/conflict_audit.py` and exposed via `GET /api/salary/cutover-audit/` (`backend/salary/views.py`), the `CrossEngineConflictAuditor` is a strictly read-only, non-destructive validation engine.

### Audit Checks
1. **Salary V1 Slips**: Identifies existing `TeacherSalarySlip` records. Flags approved/paid slips as blocking conflicts.
2. **Salary V2 Payrolls**: Scans `QuranTeacherMonthlyPayroll`. Flags `APPROVED` and `PAID` records as blocking conflicts.
3. **Unified Drafts & Submissions**: Scans existing Unified `TeacherPayroll` and `SalaryPayrollPeriod` states.
4. **Teacher Identity Collisions**: Detects teachers existing simultaneously across legacy records and current department roster.
5. **Unresolved Attendance**: Detects `SalaryAttendanceVerification` records with status `PENDING` or `CONFLICTED`.
6. **Incomplete Calculation Evidence**: Checks for missing calculation snapshots.
7. **Policy Assignments**: Ensures all active department teachers have valid `TeacherPolicyAssignment` records.
8. **Cutover Consistency**: Validates that registry state aligns with intended operational state.

### Safety Guarantee
The auditor **never mutates, deletes, or settles records**. If any conflict is found, it returns `status: "BLOCKED"` with a structured breakdown of blocking entities and recommended resolution steps.

---

## 5. Comprehensive Automated Test Matrix (23 Scenarios)

The test suite in `backend/salary/tests/test_stage_9a_cutover_guards.py` covers all 23 scenarios required by the Stage 9A blueprint using synthetic data:

| Scenario # | Test Method Name | Description | Status |
|---|---|---|---|
| **1** | `test_01_legacy_period_v1_operation_permitted_under_existing_rules` | Legacy period: V1 calculation & slip updates succeed normally. | **PASSED** |
| **2** | `test_02_legacy_period_v2_operation_permitted_under_existing_rules` | Legacy period: V2 generation & approval succeed normally. | **PASSED** |
| **3** | `test_03_legacy_period_unified_final_approval_rejected` | Legacy period: Unified final approval & payment recording are blocked. | **PASSED** |
| **4** | `test_04_unified_owned_period_v1_generation_rejected` | Unified-owned period: V1 slip generation is blocked with HTTP 409 / exception. | **PASSED** |
| **5** | `test_05_unified_owned_period_v1_finalization_rejected` | Unified-owned period: V1 PATCH update is blocked with HTTP 409. | **PASSED** |
| **6** | `test_06_unified_owned_period_v2_generation_rejected` | Unified-owned period: V2 calculation is blocked with HTTP 409. | **PASSED** |
| **7** | `test_07_unified_owned_period_v2_approval_rejected` | Unified-owned period: V2 submit & approve are blocked with HTTP 409. | **PASSED** |
| **8** | `test_08_unified_owned_period_v2_disbursement_rejected` | Unified-owned period: V2 `mark_paid` disbursement is blocked with HTTP 409. | **PASSED** |
| **9** | `test_09_unified_owned_period_v2_reopening_rejected` | Unified-owned period: V2 reopening is blocked with HTTP 409. | **PASSED** |
| **10** | `test_10_unified_owned_period_approval_follows_normal_readiness_checks` | Unified-owned period: Unified approval follows normal policy and readiness checks. | **PASSED** |
| **11** | `test_11_historical_legacy_salary_reads_remain_available` | Historical legacy salary reads remain accessible via API without mutating. | **PASSED** |
| **12** | `test_12_other_department_remains_unaffected` | Activation in Dept A has zero effect on Dept B (Dept B remains legacy). | **PASSED** |
| **13** | `test_13_earlier_period_remains_unaffected` | Activation in March 2026 leaves February 2026 legacy operations unaffected. | **PASSED** |
| **14** | `test_14_later_period_remains_unaffected_unless_explicitly_activated` | Activation in March 2026 leaves April 2026 legacy operations unaffected. | **PASSED** |
| **15** | `test_15_cross_institution_registry_spoofing_rejected` | Institution Admin from Inst A cannot view or activate Dept in Inst B. | **PASSED** |
| **16** | `test_16_duplicate_activation_attempts_rejected` | Duplicate activation raises `CutoverActivationError` / handles idempotently. | **PASSED** |
| **17** | `test_17_unauthorized_registry_mutation_rejected` | Department Admin and unauthorized roles cannot activate or deactivate cutover. | **PASSED** |
| **18** | `test_18_existing_approved_legacy_payroll_creates_activation_conflict` | Existing approved V2 payroll blocks cutover activation. | **PASSED** |
| **19** | `test_19_existing_paid_legacy_payroll_creates_activation_conflict` | Existing paid V1 slip blocks cutover activation. | **PASSED** |
| **20** | `test_20_concurrent_legacy_and_unified_requests_cannot_both_succeed` | Conflicting operations between engines maintain transactional exclusion. | **PASSED** |
| **21** | `test_21_retry_and_idempotency_protection` | Repeated activation or deactivation requests remain idempotent. | **PASSED** |
| **22** | `test_22_no_real_external_payment_initiated` | Payment recording records internal ledger audit only; no external API touched. | **PASSED** |
| **23** | `test_23_legacy_financial_records_remain_unchanged_in_non_activation` | Legacy slips and payroll rows are byte-for-byte unmodified when cutover is inactive. | **PASSED** |
| **24** | `test_conflict_auditor_detects_blocking_legacy_payroll` | Conflict auditor flags legacy approved/paid records as BLOCKED. | **PASSED** |
| **25** | `test_conflict_auditor_detects_missing_policy_assignment` | Conflict auditor flags unassigned teachers as BLOCKED. | **PASSED** |
| **26** | `test_conflict_auditor_detects_unresolved_attendance` | Conflict auditor flags unverified/conflicted attendance as BLOCKED. | **PASSED** |
| **27** | `test_conflict_audit_api_endpoint_permissions` | Cutover audit endpoint permissions strictly enforce RBAC isolation. | **PASSED** |
| **28** | `test_student_rejoin_blocked_when_period_unified_owned` | Student drop rejoin streak mutation blocked when affected period is Unified-owned. | **PASSED** |
| **29** | `test_recalculate_imported_salary_command_blocked_when_period_unified_owned` | Recalculate imported salary management command skips Unified-owned slips. | **PASSED** |

---

## 6. Full Financial Regression & Test Suite Status

The complete Unified Salary Management test suite was executed via `backend/salary/tests/run_tests.py`:
- **Total Test Cases**: 314
- **Passed**: 314 (100%)
- **Failed**: 0
- **Errors**: 0
- **Duration**: ~23.6 seconds

```
Ran 314 tests in 23.630s
OK
Total failures: 0
```

Frontend compilation was verified with `npm run build`:
- **Modules Transformed**: 3,673
- **Vite Production Chunks**: Built cleanly in 31.6s
- **TypeScript Errors**: 0

---

## 7. PostgreSQL Test Requirement: BLOCKED

### Gate Status: **BLOCKED**

### Reason
- Neither local PostgreSQL (`localhost:5432`), `psql`, nor `docker` is provisioned or running on the local host environment.
- All connections to external or production databases (`ivs_academy_db`, Oracle Cloud) are strictly prohibited under Stage 9A direction.
- Consequently, multi-worker concurrency tests and PostgreSQL-specific locking semantics (`FOR UPDATE SKIP LOCKED`, PostgreSQL migration chains) cannot be run on this host without a dedicated disposable database environment.

### Proposed Disposable PostgreSQL Test Setup
When disposable infrastructure is made available by the owner, execute:
1. **Container Initialization**:
   ```bash
   docker run --name ivs-test-postgres -e POSTGRES_DB=ivs_disposable_test -e POSTGRES_USER=ivs_user -e POSTGRES_PASSWORD=disposable_secret -p 5432:5432 -d postgres:16-alpine
   ```
2. **Environment Configuration**: Set `DATABASE_URL=postgres://ivs_user:disposable_secret@localhost:5432/ivs_disposable_test` in `.env.test`.
3. **Apply Full Migration Chain**:
   ```bash
   python backend/manage.py migrate
   ```
4. **Run Concurrency & Idempotency Suite**:
   Execute multi-threaded stress tests for:
   - Simultaneous final approvals on same department/period.
   - Concurrent bulk adjustment confirmations.
   - Race conditions between legacy write and Unified activation.
   - External payment reference unique constraint collision under concurrency.

---

## 8. Browser End-to-End Verification: NOT TESTED

### Gate Status: **NOT TESTED**

### Reason
- Headless browser automation (Playwright/Cypress/Selenium) is not configured in this development environment.
- Live interactive browser testing must be conducted with synthetic test accounts on a running staging instance.

### 17-Point Manual Browser Execution Checklist
Before activating Stage 9B, an authorized operator must execute the following end-to-end verification checklist using synthetic accounts:

- [ ] **1. Salary Policy Creation**: Department Admin logs in, navigates to Salary Settings, creates a draft policy with 2D rate matrix tiers, and publishes it.
- [ ] **2. Salary Policy Assignment**: Assign the published policy to 3 synthetic teachers with effective dates.
- [ ] **3. Attendance Verification**: Complete attendance verification for the test month with required audit reasons.
- [ ] **4. Monthly Salary Preview**: Generate draft preview; verify calculation breakdown reflects 5-level rate hierarchy.
- [ ] **5. Individual Bonus/Cutting**: Add an individual bonus and cutting to Teacher 1; verify preview updates immediately.
- [ ] **6. Bulk Bonus**: Create a bulk bonus batch for all department teachers; stage preview, then idempotently confirm.
- [ ] **7. Bulk Cutting**: Create a bulk cutting batch; confirm application across all eligible teachers.
- [ ] **8. Draft Payroll Generation**: Department Admin triggers monthly payroll generation; confirm calculation snapshots are recorded.
- [ ] **9. Recalculation Impact Diff**: Modify an attendance record; trigger recalculation; verify delta diff preview modal displays exact differences.
- [ ] **10. Department Submission**: Department Admin submits payroll; verify department editing becomes locked.
- [ ] **11. Correction Request**: Institution Admin requests a correction with notes; verify state shifts to `CORRECTION_REQUESTED`.
- [ ] **12. Correction Resolution**: Super Admin reviews and accepts/rejects correction request.
- [ ] **13. Final Approval (Test Ownership Mode)**: Super Admin executes final approval; confirm immutable payroll records freeze.
- [ ] **14. Unicode Salary Slip PDF Generation**: Download salary slip PDF; verify Urdu (`قاری احمد`), Arabic, and English render with proper RTL shaping.
- [ ] **15. External Payment Recording**: Record payment with fictional reference `TEST-TXN-001`; verify ledger entry created.
- [ ] **16. Legacy Rejection Under Unified Ownership**: In simulated Unified-owned period, attempt legacy V1 PATCH and V2 approval; verify UI shows HTTP 409 conflict error banner.
- [ ] **17. Legacy Permitted Under Legacy Ownership**: Switch to legacy-owned period; confirm legacy V1/V2 operations execute without interference.

---

## 9. Unicode PDF Final Acceptance

Verification confirmed pure-Python TrueType Unicode salary slip generation (`backend/salary/slip_generator.py`):
- **Font Stack**: Embedded `DejaVuSans.ttf` and `DejaVuSans-Bold.ttf`.
- **RTL Shaping**: Integrated bidirectional reordering (`arabic_reshaper` + `python-bidi`).
- **Character Coverage**: Verified with Urdu teacher names (e.g., `قاری محمد احمد`), Arabic honorifics, and mixed English-Urdu descriptions.
- **Financial Details**: Verifies base earnings, tiers, attendance summaries, cuttings, bonuses, and approved snapshot hashes.
- **Zero Headless Chromium Dependency**: Eliminates external browser binary requirements or headless renderer crashes.

---

## 10. Stage 9B Activation and Rollout Blueprint

When Stage 9B is formally authorized:
1. **Pre-Cutover Conflict Audit**:
   Run `GET /api/salary/cutover-audit/?department_id=<DEPT>&year=<YYYY>&month=<MM>`.
   Must return `status: "READY"` with 0 unresolved conflicts.
2. **Selective Department Pilot**:
   Activate a single pilot Quran department for the current open payroll month via Super Admin endpoint:
   `POST /api/salary/engine-cutover/` (`department_id`, `year`, `month`, `is_unified_active: true`).
3. **Bidirectional Safety Verification**:
   - Confirm legacy UI for that pilot department and month displays "Managed by Unified Salary" banner.
   - Confirm legacy mutation attempts are rejected with HTTP 409 `LEGACY_SALARY_MUTATION_DENIED`.
4. **Emergency Rollback Procedure**:
   If an unexpected issue arises prior to final approval:
   - Super Admin calls `POST /api/salary/engine-cutover/` with `is_unified_active: false`.
   - Engine cutover registry logs deactivation with audit timestamp and actor.
   - Legacy engine immediately regains write authority for that department and month.

---

## 11. Final Readiness Verdict

| Gate | Requirement | Status | Verdict |
|---|---|---|---|
| **1. Regression Tests** | All 314 automated tests passing | **PASSED** | Fully verified (100% pass rate) |
| **2. Reverse Cutover Guards** | Legacy V1/V2 write paths strictly guarded | **PASSED** | 17 write paths guarded; 29/29 tests passed |
| **3. Conflict Audit Service** | Read-only pre-activation scanner | **PASSED** | Complete audit checks across V1, V2, and Unified |
| **4. Frontend Integrity** | TypeScript build & coordinator guard | **PASSED** | Vite build clean; coordinator fix preserved |
| **5. Unicode PDF Slips** | RTL Urdu/Arabic rendering without external binary | **PASSED** | Pure-Python TrueType engine verified |
| **6. PostgreSQL Validation** | Isolated PostgreSQL schema & concurrency | **BLOCKED** | Host lacks local PostgreSQL / Docker |
| **7. Browser End-to-End** | 17-point UI workflow test | **NOT TESTED** | Requires staging deployment / synthetic accounts |

### Production Readiness Sign-Off
**STAGE 9A IS COMPLETE.** Code-level cutover safety, reverse legacy protections, and cross-engine conflict auditing are fully implemented, verified, and inert. In accordance with owner direction, production activation remains strictly prohibited until Stage 9B authorization, disposable PostgreSQL validation, and manual browser verification are completed.
