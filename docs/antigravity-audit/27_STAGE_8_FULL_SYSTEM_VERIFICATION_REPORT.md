# IVS Unified Salary Management: Stage 8 Comprehensive System Verification & Financial Reconciliation Report

**Document ID:** `27_STAGE_8_FULL_SYSTEM_VERIFICATION_REPORT.md`  
**Phase:** Stage 8 — Comprehensive Testing, PostgreSQL Validation & Financial Reconciliation  
**Date:** November 5, 2026  
**Status:** COMPLETE (Full Independent System Verification Complete — Staged for Owner Review)  
**Branch:** `release/ivs-20261020-candidate`  
**Head Commit:** `de92b76 fix(frontend): prevent localhost API and WebSocket URLs in production`  
**Operating System:** Windows (PowerShell Shell Environment)  
**Target Environment:** Isolated Sandbox Environment (Zero connection to production DB or Oracle Cloud)

---

## 1. Executive Summary & Verification Scorecard

Stage 8 provides an exhaustive, independent architectural, mathematical, and security verification of Unified Salary Management (Stages 1 through 7B). This audit rigorously establishes whether the replacement payroll engine is safe for a future controlled rollout.

### System Verification Scorecard:

| Verification Category | Status | Scope & Execution Summary |
|---|:---:|---|
| **Automated Test Suite (278 Tests)** | **PASSED** | 278/278 automated test cases discovered, executed, and passed (0 failures, 0 errors, 0 skips) in 76.37s. Zero mock financial calculations. |
| **Frontend TypeScript Verification** | **PASSED** | `npm run typecheck` (`tsc --noEmit`) completed with 0 errors. |
| **Frontend Production Compilation** | **PASSED** | `npm run build` (Vite v6.4.4) bundled cleanly with 0 errors in 38.82s. |
| **Business-Rule Verification** | **PASSED** | 5-level override precedence, 2D rate matrices, tiers, weekly teaching plans, lesson plan bonuses, substitute earnings, official cancellations, and basic salary agreements verified against independent calculations. |
| **Individual & Bulk Adjustments** | **PASSED** | Discretionary bonuses, cuttings, recurring instructions, salary advance recovery ceilings, and bulk batch atomic operations verified: $\text{Gross} + \text{Additions} - \text{Cuttings} = \text{Net}$. |
| **Payroll Lifecycle & Governance** | **PASSED** | Full state machine verified (`DRAFT` $\rightarrow$ `PENDING_APPROVAL` $\rightarrow$ `RETURNED_FOR_CORRECTION` $\rightarrow$ `APPROVED` $\rightarrow$ `PAID`). Two-man return rule enforced. Immutability locked. Append-only ledger idempotency verified. |
| **Security & RBAC Enforcement** | **PASSED** | Strict department isolation, cross-institution denial, role permissions, and ID spoofing prevention verified at database and API layers. |
| **PostgreSQL Live Database Testing** | **BLOCKED** | Safe disposable PostgreSQL environment is unavailable on local host. Per owner directive, connecting to existing production/development databases or Oracle Cloud is forbidden. Documented as **BLOCKED** rather than falsely claimed. |
| **Browser Functional UI Testing** | **INCOMPLETE / NOT TESTED** | Automated browser execution harness (Playwright/Cypress) is not installed in the repository. Full manual verification checklist provided. |
| **PDF Slip Generation** | **FAILED (DEFECT)** | PDF binary structure and financial content verified, but **UnicodeEncodeError defect identified**: non-Latin1 teacher/entity names (Arabic/Urdu) trigger HTTP 500 crash due to Latin-1 stream encoding. |
| **Calculation Engine Reliability** | **WARNING (N+1)** | High query count detected (1,607 queries for a single teacher monthly preview) caused by iterative database evaluations inside the occurrence resolution loop. |
| **Legacy Double-Processing Safeguards** | **PARTIAL / PREREQUISITE** | New Unified engine guard (`SalaryEngineCutoverRegistry`) verified active. However, legacy V1 (`TeacherSalarySlip`) and V2 (`QuranTeacherMonthlyPayroll`) write endpoints currently lack reverse cutover checks, creating a double-processing risk during Stage 9. |

---

## 2. Test Suite Execution & Discovery Audit

### Test Execution Metrics:
- **Exact Execution Command:**
  ```powershell
  backend\venv\Scripts\python.exe backend/salary/tests/run_tests.py
  ```
- **Execution Environment:** Windows, Python 3.12.10, Django 5.x, SQLite in-memory (`file:memorydb_default?mode=memory&cache=shared`).
- **Discovery Count:** 278 test cases discovered across 9 test suites.
- **Exit Code:** `0` (Success).
- **Execution Time:** 76.370 seconds.
- **Result Summary:** **278 Passed, 0 Failed, 0 Errors, 0 Skipped**.

### Breakdown by Test Module:
1. `salary.tests.test_policy_models` (Stage 1 Foundation): **18/18 PASSED**  
   - Validates department scoping, code uniqueness, tier boundary checks, matrix constraints, and published immutability.
2. `salary.tests.test_policy_api` (Stage 2 Policy Builder REST API): **17/17 PASSED**  
   - Validates department scoping, cross-department/cross-institution denial (HTTP 403), unauthorized role rejection, and published policy protection.
3. `salary.tests.test_assignments_and_overrides` (Stage 3 Assignments & Overrides): **25/25 PASSED**  
   - Validates teacher policy assignment overlapping rejection, 4 override scopes, deterministic precedence resolver, and preview API.
4. `salary.tests.test_attendance_verification` (Stage 4 Attendance Verification): **28/28 PASSED**  
   - Validates reconciliation scanning, auto-matching, resolution types, append-only audit trail, and approval blocker readiness gate.
5. `salary.tests.test_salary_calculation` (Stage 5 Calculation Engine): **40/40 PASSED**  
   - Validates 2D rate matrices (5-day, 4-day, 3-day, 2-day plans), tiers 1-3, week-start partitioning, qualifying weeks, and substitute isolation.
6. `salary.tests.test_salary_corrections_stage_5a` (Stage 5A Calculation Edge Cases): **38/38 PASSED**  
   - Validates 5-level precedence hierarchy, basic salary models, mid-month proration, duplicate bonus deduplication, and cancellation payment rules.
7. `salary.tests.test_cuttings_and_bonuses_stage_6` (Stage 6 Adjustments & Bulk Batches): **36/36 PASSED**  
   - Validates individual and bulk bonuses, percentage calculations, advance salary recoveries, exclusion tables, batch idempotency, and gross-to-net reconciliation.
8. `salary.tests.test_monthly_payroll_stage_7a` (Stage 7A Monthly Payroll Records): **36/36 PASSED**  
   - Validates draft creation, old-vs-new recalculation previews, revision tracking, submission snapshot locking, and department isolation.
9. `salary.tests.test_payroll_approvals_stage_7b` (Stage 7B Approvals & Payments): **40/40 PASSED**  
   - Validates two-man correction requests, approval gates, approved/paid period immutability, append-only ledger idempotency, and external payment disbursements.

### Assertion & Mocking Audit:
- **Assertion Validity:** Zero tests use trivial tautological assertions (e.g. `assert True`). Every test asserts model state in the database, API response payloads, HTTP status codes, or explicit exception raises (`assertRaises(ValidationError)`).
- **Zero Financial Mocking:** Calculations execute using real database queries against synthetic database rows. Zero calculation math is replaced with static test mocks.
- **Negative & Security Test Coverage:** Over 35% of the test assertions explicitly test failure paths: HTTP 403 Forbidden on spoofed departments/institutions, validation errors on invalid tiers or negative rates, and blocker triggers on unverified attendance or unactivated cutover registries.

---

## 3. PostgreSQL Migration & Schema Validation

### Status: **BLOCKED (Documented per Owner Mandate)**

### Safe Environment Assessment:
- Local PostgreSQL service is not running or available on standard local ports.
- Neither `psql` nor `docker` CLI binaries are present in the local Windows environment.
- **Explicit Prohibition Respected:** In strict adherence to owner instructions:
  > *"Do not read `.env`, connect to Oracle Cloud, or access existing production/development databases. Do not create or connect to an external database without authorization. If a safe disposable PostgreSQL environment is unavailable, document PostgreSQL validation as blocked rather than claiming it passed."*
- Consequently, PostgreSQL live database execution is recorded as **BLOCKED** and has not been executed against live or external infrastructure.

### Static Schema & Migration Dependency Analysis:
All 6 salary migrations were statically analyzed:
1. `0001_initial.py`: Foundation policy models, tiers, plans, matrix cells, assignments, and overrides.
   - Dependencies: `accounts.Department`, `accounts.Institution`, `academy.TeacherProfile`, `academy.StudentProfile`.
2. `0002_salaryattendanceverification_salaryattendanceaudit_and_more.py`: Attendance verification, reconciliation batches, and audit models.
3. `0003_add_basic_salary_and_coordinator_config.py`: Basic salary configuration, proration choices, and coordinator qualifying weekdays.
4. `0004_salary_adjustments_and_bulk_batches.py`: Individual adjustments, recurring instructions, advance recoveries, and bulk batches.
5. `0005_monthly_payroll_records_and_submissions.py`: Monthly payroll periods, teacher payrolls, earning lines, snapshots, and lifecycle audits.
6. `0006_payroll_approvals_ledger_and_payments.py`: Immutable ledger entries, payment disbursements, correction requests, and cutover registry.

**Migration Reversibility Verification:**
- All 6 migrations are strictly additive.
- Zero existing legacy tables (`academy_teachersalaryslip`, `academy_quranteachermonthlypayroll`, `academy_attendance`, `tuition_tuitionattendance`) are dropped, altered, or renamed.
- Backward rollback (`python manage.py migrate salary zero`) is structurally clean and dependency-safe because no external core apps foreign-key into `salary.*` models.

---

## 4. Complete Salary Business-Rule Verification

Independent synthetic scenarios were executed and evaluated against the pure mathematical specification.

### 1. Five-Level Rate Precedence Resolution:
Verified deterministically via [backend/salary/resolver.py](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/backend/salary/resolver.py):
- **Level 1 (Student-Specific):** Override of PKR 135.00 for Student 1 took immediate precedence over plan, teacher, coordinator, and policy defaults.
- **Level 2 (Teaching-Plan-Specific):** Upon deactivating student override, resolved to Plan 5_DAY override rate of PKR 120.00.
- **Level 3 (Teacher-Wide):** Upon deactivating plan override, resolved to teacher-wide rate of PKR 110.00.
- **Level 4 (Coordinator Day):** Evaluated on Sunday (`2026-03-08`), successfully resolved to Sunday coordinator rate of PKR 150.00.
- **Level 5 (Policy Default Rate):** Evaluated on Monday (`2026-03-02`), successfully resolved to base 2D matrix rate of PKR 90.00 (Tier 2: 16-19 students, 5_DAY plan).

### 2. Department Separation:
- Quran classes evaluate Quran class schedules, student enrollments, daily lesson reports, and Quran policies.
- Tuition classes evaluate `TuitionEnrollment`, `TuitionSchedule`, and tuition policies. Zero cross-department schedule bleed occurred.

### 3. Student Count Tiers:
- Tested Tier 1 (1–15 students), Tier 2 (16–19 students), and Tier 3 (20+ unbounded).
- Active student count accurately evaluated from active class schedules on class date. When schedules had 1 student, Tier 1 rate (PKR 80.00) was applied. When 18 students had active schedules, Tier 2 rate (PKR 90.00) was applied.

### 4. Lesson Plan Bonus Independence:
- Lesson plan bonuses (PKR 10.00 per class taught) require verified completed lesson report evidence.
- Bonuses are earned independently of weekly minimum qualification thresholds.

### 5. Official Cancellations & Teacher Absence:
- Configured cancellation rules (`paid_always`, `teacher_available_only`, `unpaid`) verified.
- Teacher absence without duplicate deduction: absence records generate PKR 0.00 earnings; cuttings are not automatically duplicated on absence rows unless explicitly entered as discretionary adjustments.

### 6. Basic Salary Compensation Models:
- Basic-only policy: PKR 30,000 agreement verified.
- Combo policy: Basic salary (PKR 15,000) + Per-class earnings verified.
- Mid-month calendar-day proration verified.

---

## 5. Individual & Bulk Adjustment Verification

Adjustments were tested across all modes:
1. **Individual Bonus:** Confirmed performance bonus of PKR 500.00 credited to Teacher 1.
2. **Individual Cutting:** Confirmed disciplinary deduction of PKR 200.00 debited from Teacher 1.
3. **Advance Recovery:** Advance of PKR 5,000 scheduled for monthly recovery of PKR 1,000. Exactly PKR 1,000 deducted; remaining balance tracked immutably.
4. **Bulk Department Bonus:** Batch created for PKR 300.00 for all eligible department teachers. Exactly 1 adjustment entry generated per teacher.
5. **Idempotency Protection:** Re-submitting bulk batch with identical `idempotency_key` safely blocked.
6. **Gross-to-Net Mathematical Proof:**
   $$\text{Gross (2,200.00)} + \text{Additions (800.00)} - \text{Cuttings (1,200.00)} = \text{Net (1,800.00)}$$
   Verified with 0.00 difference.

---

## 6. Payroll Lifecycle & Approvals State Machine

```
[DRAFT] ──► [PENDING_APPROVAL] ──► [APPROVED] ──► [PAID]
   ▲                 │
   │ Return Auth     │ Correction Request
   └────────── [RETURNED_FOR_CORRECTION]
```

### Verified Transitions:
1. **Draft Creation:** Initial draft created with complete calculation snapshots (`DRAFT`).
2. **Submission Snapshot & Locking:** Submitted by Department Admin (`PENDING_APPROVAL`). Direct draft editing locked. Immutable submission snapshot captured.
3. **Two-Man Correction Request:**
   - Department Admin requested correction for recitation bonus.
   - Self-approval attempt by Department Admin blocked: `ValidationError: A Department Admin cannot authorize their own correction request.`
   - Review by Institution Admin approved the return (`RETURNED_FOR_CORRECTION`).
4. **Resubmission:** Department Admin resubmitted with updated notes (`PENDING_APPROVAL`).
5. **Approval Gates Validation:**
   - Attempted final approval while `SalaryEngineCutoverRegistry` was inactive: blocked with `ValidationError: Final payroll approval BLOCKED: Unified Salary engine is not authorized for live approval for Quran Department (2026-03).`
   - Registry activated for test period. Final approval executed by Institution Admin (`APPROVED`).
6. **Approved Payroll Immutability:** Direct mutation attempt (`net_total += 500.00`) rejected by `SalaryPayrollPeriod.clean()`: `Financial totals and period parameters of approved/paid payroll are immutable.`
7. **Immutable Ledger Posting:** Itemized `PayrollLedgerEntry` rows created: Credits (PKR 3,000.00) - Debits (PKR 1,200.00) = Net PKR 1,800.00, perfectly matching stored `TeacherPayroll.net_salary`.
8. **Disbursement Recording:**
   - Partial payment: PKR 1,000 recorded; status transitioned to `partially_paid`.
   - Overpayment attempt: PKR 900 attempted when balance was PKR 800; correctly rejected.
   - Final payment: PKR 800 recorded; teacher status transitioned to `paid`.
   - Once all teachers paid, overall department period transitioned to `PAID`.

---

## 7. Legacy Double-Processing Safeguards & Cutover Plan

### Architectural Analysis:
The repository contains three coexisting salary engines:
1. **Salary V1:** `TeacherSalarySlip` (Legacy Quran & Tuition draft/processed slips).
2. **Salary V2:** `QuranTeacherMonthlyPayroll` + `PayrollLedgerEntry` (Quran-only department approval workspace).
3. **Unified Salary Management:** `SalaryPayrollPeriod` + `TeacherPayroll` + `PayrollLedgerEntry` (Multi-department foundation).

### Active Safety Guard in Unified Engine:
`PayrollLifecycleService.assert_cutover_and_legacy_guard()`:
- Blocks Unified approval if `SalaryEngineCutoverRegistry.is_unified_engine_active` is `False`.
- Blocks Unified approval if legacy V1 records (`TeacherSalarySlip.status == "processed"`) exist for that department and month.
- Blocks Unified approval if legacy V2 records (`QuranTeacherMonthlyPayroll.status in ["approved", "paid"]`) exist for that department and month.

### Critical Cutover Gap Identified:
> [!WARNING]
> **One-Way Protection Gap:** While the Unified engine inspects legacy tables before approving, **legacy V1 and V2 endpoints do not inspect `SalaryEngineCutoverRegistry`**.
> If Unified Salary is activated for a department and approves a payroll period, a legacy administrator could still theoretically open Salary V1 or V2 and calculate, approve, or disburse conflicting payroll for that same period.

### Explicit Stage 9 Cutover Enforcement Plan:
To achieve true, leak-free double-processing protection during Stage 9:
1. **Add Reverse Cutover Guard to Legacy V1:** In `backend/academy/views.py` (`TeacherSalarySlip` write views), add a preflight check:
   ```python
   if is_unified_salary_engine_active(teacher.department, year, month):
       raise PermissionDenied("Salary processing for this department and period has been cut over to Unified Salary Management.")
   ```
2. **Add Reverse Cutover Guard to Legacy V2:** In `backend/academy/salary_v2_api.py` (review, approve, and payment endpoints), add:
   ```python
   if is_unified_salary_engine_active(department, year, month):
       return Response({"error": "Payroll for this department and period is managed by Unified Salary Management."}, status=403)
   ```
3. **Frontend Cutover Routing:** In `components/TeacherSalaryManagement.tsx`, update role and department routing so that when `is_unified_active` is true, legacy tabs are rendered read-only or hidden.

---

## 8. PDF Salary Slip Verification

### Verified Characteristics:
- Generated valid PDF-1.4 binary stream with `%PDF-1.4` header, `/Catalog`, `/Pages`, `/Page`, Helvetica font resources, `/XRef` table, and `%%EOF` marker.
- Correctly formatted itemized earnings: basic salary, regular classes taught, lesson bonuses, substitute earnings, cancellation pay, individual bonuses, and bulk batches.
- Correctly formatted deductions: individual cuttings, bulk cuttings, and advance recoveries.
- Correctly renders approval badge and disbursement transaction records.
- Automatically renders diagonal `DRAFT PREVIEW - NOT APPROVED` watermark on unapproved periods; watermark is cleanly omitted once approved.

### Defect Identified: UnicodeEncodeError
- **Defect Description:** The PDF content stream is encoded directly via `.encode("latin1")` in [backend/salary/pdf_service.py](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/backend/salary/pdf_service.py#L342).
- **Reproduction:** When a teacher profile (e.g. `محمد طارق`), approver name, or notes string contains Arabic, Urdu, or non-Latin-1 characters, generating the salary slip crashes:
  ```python
  UnicodeEncodeError: 'latin-1' codec can't encode characters in position 488-491: ordinal not in range(256)
  ```
- **Severity:** Medium (P2). Blocks salary slip downloads for any teacher or administrator with native non-Latin-1 names.
- **Proposed Correction:** In `_escape_pdf_text`, normalize and transliterate non-Latin1 text using standard NFKD decomposition, or replace unencodable characters with ASCII transliterations (or ASCII fallback) prior to stream encoding.

---

## 9. Browser-Based Functional UI Testing

### Status: **INCOMPLETE / NOT TESTED (Manual Verification Checklist Provided)**

### Reason:
No browser test automation framework (Playwright, Cypress, Puppeteer) is installed in this repository, and no live isolated web server / disposable database was launched. Claiming browser automation passed would violate audit integrity.

### Comprehensive Manual UI Verification Checklist:
For owner staging validation in a local development browser (`npm run dev` + `python manage.py runserver`):
- [ ] **Salary Policy Builder (`/salary/policies`):**
  - [ ] Log in as Department Admin. Verify rate matrix displays plans on Y-axis and tiers on X-axis.
  - [ ] Edit cell rate. Verify live draft update. Publish version and verify cells become read-only.
- [ ] **Teacher Salary Assignments (`/salary/assignments`):**
  - [ ] Assign policy to teacher.
  - [ ] Add Level 1 student override and Level 4 coordinator day override.
  - [ ] Open Rate Preview modal; confirm winning rate and precedence level match expectations.
- [ ] **Attendance Verification (`/salary/attendance`):**
  - [ ] Run monthly reconciliation scan.
  - [ ] Confirm auto-matched classes appear green. Unmarked classes flagged with resolution drawer.
- [ ] **Monthly Salary Preview (`/salary/preview`):**
  - [ ] Verify summary cards for regular classes, bonuses, substitutes, and adjustments.
  - [ ] Verify attendance readiness blocker warnings display when classes are unverified.
- [ ] **Cuttings & Adjustments Workspace (`/salary/adjustments`):**
  - [ ] Create individual bonus and cutting.
  - [ ] Create bulk bonus with teacher exclusion. Confirm exclusion prevents adjustment.
- [ ] **Payroll Approvals & Payments (`/salary/approvals`):**
  - [ ] Log in as Department Admin: Click "Submit Department Payroll". Verify status changes to Pending Approval.
  - [ ] Click "Request Return for Correction". Verify reason modal opens.
  - [ ] Log in as Institution Admin: Approve return for correction.
  - [ ] Resubmit as Department Admin.
  - [ ] Log in as Institution Admin: Click "Run Preflight Blockers". Confirm green checks. Click "Final Approve".
  - [ ] Click "Record Payment". Input reference number, amount, upload receipt image. Confirm partial and full paid states.
  - [ ] Click "Download Salary Slip (PDF)". Confirm PDF downloads cleanly.

---

## 10. Security & Permission Testing

| Security Scenario | Expected Result | Verified Result | Status |
|---|---|---|:---:|
| **Tuition Admin access to Quran Payroll** | HTTP 403 / Access Denied | `IsSalaryPolicyAdminOrReadOnly` returned `False` | **PASSED** |
| **Institution B Admin access to Institution A** | HTTP 403 / Access Denied | Cross-institution object access denied (`False`) | **PASSED** |
| **Teacher role accessing Admin endpoints** | HTTP 403 Forbidden | `has_permission` returned `False` | **PASSED** |
| **Coordinator role accessing Admin endpoints** | HTTP 403 Forbidden | `has_permission` returned `False` | **PASSED** |
| **Self-Approval of Correction Request** | Rejection | `ValidationError: A Department Admin cannot authorize their own correction request.` | **PASSED** |
| **Overpayment via External Payment API** | Rejection | `ValidationError: Overpayment prevented: Payment amount PKR 900.00 exceeds remaining unpaid balance of PKR 800.00.` | **PASSED** |
| **Direct Mutation of Approved Payroll** | Rejection | `ValidationError: Financial totals and period parameters of approved/paid payroll are immutable.` | **PASSED** |
| **Unapproved Payroll Payment Recording** | Rejection | `ValidationError: Payments can only be recorded against approved payroll.` | **PASSED** |

---

## 11. Performance & Reliability Evaluation

### Query Count Measurement:
- Single teacher calculation preview query count: **1,607 database queries**.
- Root Cause: [backend/salary/calculation_engine.py](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/backend/salary/calculation_engine.py) performs iterative queries per occurrence inside the loop:
  - `ClassSchedule.objects.filter(...)` per class date.
  - `StudentClassHistory.objects.filter(...)` per class date.
  - `TeacherSalaryOverride.objects.filter(...)` for each override level per class date.
- Impact: While in-memory SQLite executed this in ~0.8s, over a network connection to PostgreSQL, 50 teachers with 20 classes each would generate ~80,000 queries, introducing significant latency during monthly draft generation.
- Recommendation for Stage 9 Optimization: Batch prefetch all active teacher assignments, published rate matrices, schedules, and active overrides into memory prior to the occurrence loop, reducing queries from $\mathcal{O}(N \times \text{classes})$ to $\mathcal{O}(1)$ bulk queries per department.

---

## 12. Financial Reconciliation Table

The following synthetic cases were reconciled independently against the owner's agreed business rules:

| Synthetic Test Case | Expected Gross | Actual Gross | Expected Additions | Actual Additions | Expected Cuttings | Actual Cuttings | Expected Net | Actual Net | Delta | Result |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **1. Standard 5-Day Tier 2 (22 Classes + 22 Bonuses)** | PKR 2,200.00 | PKR 2,200.00 | PKR 0.00 | PKR 0.00 | PKR 0.00 | PKR 0.00 | PKR 2,200.00 | PKR 2,200.00 | PKR 0.00 | **MATCH** |
| **2. Teacher-Specific Basic Salary (PKR 30,000 Agreement)** | PKR 30,000.00 | PKR 30,000.00 | PKR 0.00 | PKR 0.00 | PKR 0.00 | PKR 0.00 | PKR 30,000.00 | PKR 30,000.00 | PKR 0.00 | **MATCH** |
| **3. Full Adjustments (Gross 2,200 + 800 Additions - 1,200 Cuttings)** | PKR 2,200.00 | PKR 2,200.00 | PKR 800.00 | PKR 800.00 | PKR 1,200.00 | PKR 1,200.00 | PKR 1,800.00 | PKR 1,800.00 | PKR 0.00 | **MATCH** |
| **4. Basic (15,000) + Per-Class Combo (20 Classes @ Rs 80)** | PKR 16,600.00 | PKR 16,600.00 | PKR 0.00 | PKR 0.00 | PKR 0.00 | PKR 0.00 | PKR 16,600.00 | PKR 16,600.00 | PKR 0.00 | **MATCH** |
| **5. Advance Recovery (PKR 5,000 advance, PKR 1,000 installment)** | PKR 2,200.00 | PKR 2,200.00 | PKR 0.00 | PKR 0.00 | PKR 1,000.00 | PKR 1,000.00 | PKR 1,200.00 | PKR 1,200.00 | PKR 0.00 | **MATCH** |

**Zero financial discrepancies detected across all synthetic cases.**

---

## 13. Defect & Observation Register

### Defect 1: PDF Unicode Encoding Crash (`DEF-001`)
- **Severity:** Medium (P2)
- **Affected File:** `backend/salary/pdf_service.py:342`
- **Reproduction:** Generate salary slip for a teacher whose name contains Arabic or Urdu characters (`محمد طارق`).
- **Impact:** System throws HTTP 500 `UnicodeEncodeError: 'latin-1' codec can't encode characters`.
- **Proposed Correction:** Transliterate or safely normalize non-Latin1 strings using `unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii')` prior to PDF stream generation.

### Observation 1: Calculation Engine N+1 Query Density (`OBS-001`)
- **Severity:** Low (Architectural / Performance)
- **Affected File:** `backend/salary/calculation_engine.py`
- **Impact:** 1,607 queries per teacher monthly preview. Not a blocker for correctness, but creates database latency for departments with 50+ teachers.
- **Proposed Optimization:** Stage 9 prefetch refactoring to load schedules, historical student counts, and overrides in bulk.

### Observation 2: Unidirectional Cutover Guard (`OBS-002`)
- **Severity:** High (Rollout Prerequisite)
- **Affected Files:** `backend/academy/views.py`, `backend/academy/salary_v2_api.py`
- **Impact:** Unified Salary guards against legacy V1/V2 records, but legacy V1/V2 does not guard against Unified Salary.
- **Remediation Plan:** Implement reverse checks on legacy write endpoints prior to Stage 9 live cutover.

---

## 14. Deployment Prerequisites for Stage 9

Before any live rollout, pilot cutover, or production deployment occurs in Stage 9:
1. **Fix DEF-001 (PDF Unicode Handling):** Ensure salary slips render safely for all Urdu and Arabic teacher names.
2. **Implement Reverse Legacy Cutover Guards:** Ensure legacy endpoints return HTTP 403 if a cutover registry entry is active.
3. **Execute PostgreSQL Migrations on Staging:** Run `python manage.py migrate salary` on a dedicated staging PostgreSQL instance.
4. **Conduct End-to-End Browser Staging Smoke Tests:** Follow the Section 9 checklist in a live staging environment.
5. **Obtain Explicit Owner Cutover Sign-Off:** Confirm initial department pilot scope and target payroll month.

---

## 15. Git Working Tree & Compliance Verification

- **Current Git Branch:** `release/ivs-20261020-candidate`
- **Working Tree Cleanliness:**
  - `App.tsx` preserved with coordinator blank screen fix strictly intact.
  - Zero modifications to legacy salary models (`academy_teachersalaryslip`, `academy_quranteachermonthlypayroll`).
  - Zero `.env` inspection or external network connections performed.
  - Zero production database mutations.

---

## 16. Mandatory Stop Confirmation

**STAGE 8 IS COMPLETE. WORK IS FORMALLY HALTED.**
- No production migrations have been applied.
- No live bank transfers or live payroll disbursements have been initiated.
- No legacy salary code or records have been deleted.
- Stage 9 has not been started.
- Awaiting owner review and authorization.
