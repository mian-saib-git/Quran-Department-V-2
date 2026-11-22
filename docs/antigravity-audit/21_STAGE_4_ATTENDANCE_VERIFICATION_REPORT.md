# Unified Salary Management — Stage 4 Implementation Report

> **Document ID**: `21_STAGE_4_ATTENDANCE_VERIFICATION_REPORT`  
> **Status**: STAGE 4 COMPLETED (ATTENDANCE VERIFICATION AND MISSING-CLASS RECONCILIATION)  
> **Repository Target**: `quran----1-Role-Based-`  
> **Backend Package**: `backend/salary/`  
> **Frontend Components**: `components/unified-salary/`  
> **Execution Date**: 2026-11-03  
> **Test Status**: 86/86 Total Automated Tests Passing (100% across Stage 1 Models, Stage 2 API, Stage 3 Assignments/Overrides, and Stage 4 Attendance Verification)  
> **Database Status**: Additive Migration Created (`0002_*.py`) — Unapplied to Non-Disposable Databases (Tested Exclusively in Isolated Disposable Memory Database)  

---

## 1. Executive Summary

In strict accordance with owner authorization for **Stage 4 Only**, the attendance verification, missing-class reconciliation pipeline, audit logging subsystem, and payroll approval blocker service have been successfully implemented and verified.

Stage 4 establishes reliable, department-scoped, evidence-backed attendance records that the future Stage 5 salary engine can use safely without mutating historical attendance tables, without generating draft/final payroll, without posting ledger entries, and without altering legacy Salary V1 (`TeacherSalarySlip`) or Salary V2 (`QuranTeacherMonthlyPayroll`).

### Core Objectives Achieved:
1. **Department-Specific Source Adapters**:
   - `QuranAttendanceAdapter`: Resolves schedules (`ClassSchedule`), session attendance (`Attendance`), substitute coverage/cancellations (`QuranClassCoverage`), student drops (`StudentProfile.is_dropped`), and teacher transfers (`StudentClassHistory`).
   - `TuitionAttendanceAdapter`: Resolves tuition schedules (`TuitionSchedule`), enrollments (`TuitionEnrollment`), subject capabilities (`TuitionTeacherCapability`), and tutor/student attendance (`TuitionAttendance`).
2. **Deterministic Unmarked Class Detector**:
   - Classifies scheduled occurrences into 7 evidence-backed outcomes (`class_taught`, `student_absent_teacher_available`, `informed_student_leave`, `teacher_absent`, `substitute_class`, `official_cancellation`, `not_applicable_superseded`).
   - Automatically excludes future scheduled classes from overdue queues using authoritative local timezone (`Asia/Karachi`).
   - Flags past occurrences lacking verified teacher or student evidence as `PENDING`.
3. **Attendance Verification Storage & Audit Trail**:
   - Added `SalaryAttendanceVerification` with deterministic `occurrence_key` preventing duplicate records for the same scheduled student/class occurrence.
   - Implemented `SalaryAttendanceAudit`: an append-only audit trail capturing previous and new status, actor identity, mandatory business reason, timestamps, and evidence snapshots.
   - Implemented `SalaryReconciliationBatch`: tracks reconciliation scan completeness per department and payroll period.
4. **Strict Department Admin Verification Authority**:
   - Resolving pending attendance is strictly restricted to active Department Admins of the occurrence's specific department.
   - Institution Admins, Super Admins, Platform Admins, Coordinators, and Teachers are strictly denied resolution authority (`HTTP 403 Forbidden`).
5. **Payroll Approval Blocker Service**:
   - Implemented `assert_attendance_ready_for_final_approval(department, year, month)` and `validate_attendance_approval_readiness`.
   - Blocks future final payroll approval if reconciliation has not run, if any pending verifications exist, or if conflicting source evidence is detected.
6. **Department Admin User Interface**:
   - Built `components/unified-salary/SalaryAttendanceVerification.tsx` featuring period picker, KPI summary cards, Approval Readiness Gate banner, filter/search controls, occurrences queue table, "Review & Resolve" modal with mandatory reason, and append-only audit drawer.
   - Integrated tab: `"Attendance Verification (Stage 4)"` in `components/TeacherSalaryManagement.tsx`.

---

## 2. Mandatory Stage 3 Preflight Verification

Before implementing Stage 4, all 10 preflight items were executed and verified:
1. **Git State**: Recorded branch `release/ivs-20261020-candidate`, HEAD commit `de92b7606543936eafe52ed66792eedda6d4598e`.
2. **Pre-existing Changes Preserved**: Preserved minimal app registration in `backend/config/settings.py` and `backend/config/urls.py`.
3. **Foundation Models**: Confirmed all 7 models exist in `backend/salary/models.py`.
4. **Migration Consistency**: Checked `0001_initial.py` consistency against current model state.
5. **Department Scoping**: Confirmed Stage 2 and Stage 3 endpoints enforce strict department scoping.
6. **Concurrent Publication Locking**: Verified row-level locking on `SalaryPolicy` via `select_for_update()`.
7. **Line Endings**: Verified clean, scoped changes in `TeacherSalaryManagement.tsx`.
8. **Coordinator Blank-Screen Fix**: Verified coordinator tab permissions and no-access fallback in `App.tsx` remain completely intact.
9. **Automated Suite Baseline**: Ran all 54 existing tests in isolated memory runner: **54/54 Passed (100%)**.

---

## 3. Source Evidence Mapping (Quran vs Tuition)

### 3.1 Quran Department Source Resolution

| Business Condition | Primary Source Table | Secondary Verification Table | Resolution Determination |
| :--- | :--- | :--- | :--- |
| **Scheduled Class** | `academy_classschedule` (`weekday`, `time_slot`, `effective_from`, `effective_to`) | `academy_studentprofile` (`is_dropped`, `status_effective_date`), `academy_studentclasshistory` (`TEACHER_TRANSFER`) | Establishes scheduled class occurrence identity `quran:sched_<id>:<date>`. |
| **Class Taught** | `academy_attendance` (`entity_type='teacher'`, `status='present'`, `class_key=HH:MM`) | `academy_attendance` (`entity_type='student'`, `status='present'`) | `VERIFIED` &rarr; `class_taught` (`teacher_available=True`, `student='present'`). |
| **Student Absent (Teacher Avail.)** | `academy_attendance` (`entity_type='teacher'`, `status='present'`) | `academy_attendance` (`entity_type='student'`, `status='absent'`) | `VERIFIED` &rarr; `student_absent_teacher_available` (`teacher_available=True`). |
| **Informed Student Leave** | `academy_attendance` (`entity_type='teacher'`, `status='present'`) | `academy_attendance` (`entity_type='student'`, `status='leave'`) | `VERIFIED` &rarr; `informed_student_leave` (`teacher_available=True`). |
| **Teacher Absent** | `academy_attendance` (`entity_type='teacher'`, `status='absent'`) | `academy_quranclasscoverage` (no substitute assigned) | `VERIFIED` &rarr; `teacher_absent` (`teacher_available=False`). |
| **Substitute Covered** | `academy_quranclasscoverage` (`coverage_status='assigned'`, `substitute_teacher`) | `academy_attendance` (substitute session attendance) | `VERIFIED` &rarr; `substitute_class` (`teacher_available=False`, `substitute_teacher=<id>`). |
| **Official Cancellation** | `academy_quranclasscoverage` (`coverage_status='cancelled'`, `reason`) | Administrative holiday/cancellation record | `VERIFIED` &rarr; `official_cancellation` (`is_cancelled=True`). |
| **Missing Evidence** | No teacher or student row for past scheduled occurrence | N/A | `PENDING` &rarr; Requires Department Admin review. |

### 3.2 Tuition Department Source Resolution

| Business Condition | Primary Source Table | Secondary Verification Table | Resolution Determination |
| :--- | :--- | :--- | :--- |
| **Scheduled Class** | `tuition_tuitionschedule` (`weekday`, `start_time`, `is_active=True`) | `tuition_tuitionenrollment` (`is_active=True`, `start_date`, `end_date`), `tuition_tuitionteachercapability` | Establishes scheduled class occurrence identity `tuition:sched_<id>:<date>`. |
| **Class Taught** | `tuition_tuitionattendance` (`entity_type='teacher'`, `status='present'`) | `tuition_tuitionattendance` (`entity_type='student'`, `status='present'`) | `VERIFIED` &rarr; `class_taught` (`teacher_available=True`). |
| **Student Absent / Leave** | `tuition_tuitionattendance` (`entity_type='teacher'`, `status='present'`) | `tuition_tuitionattendance` (`entity_type='student'`, `status='absent'|'leave'`) | `VERIFIED` &rarr; `student_absent_teacher_available` or `informed_student_leave`. |
| **Teacher Absent** | `tuition_tuitionattendance` (`entity_type='teacher'`, `status='absent'`) | N/A | `VERIFIED` &rarr; `teacher_absent` (`teacher_available=False`). |
| **Missing Evidence** | No teacher attendance recorded for past class | N/A | `PENDING` &rarr; Requires Department Admin review. |

---

## 4. Unmarked Class Detector Logic & Edge Cases

The detector (`backend/salary/attendance_reconciler.py`) evaluates every candidate date in the target month:
1. **Future Class Exclusion**: Compares occurrence date and scheduled time against authoritative local time (`ZoneInfo("Asia/Karachi")`). Future classes are marked `is_future=True` and excluded from the overdue pending count.
2. **Student Drop Date**: If a student's status is `OLD_DROPPED`, `TRIAL_DROPPED`, or `OLD_DROPPED_OTHER`, occurrences strictly after `status_effective_date` are recognized as un-scheduled and skipped.
3. **Teacher Transfer Effective Date**: If a student was transferred to a new teacher on `effective_date`, schedules under the previous teacher are treated as superseded after that date.
4. **Mid-Month Enrollment**: Occurrences before `TuitionEnrollment.start_date` or `StudentClassHistory.ENROLLED` are excluded.
5. **Multiple Classes on Same Date**: Occurrences differentiate by `ClassSchedule.id` or `TuitionSchedule.id`, preventing duplicate key collisions when a student has more than one class on the same day.
6. **Locked Source Protection**: Historical periods with `APPROVED`, `PAID`, or `PENDING_SUPER_ADMIN` status in Salary V2 reject resolution attempts with HTTP 422.

---

## 5. Data Models and Migration

### 5.1 New Additive Models in `backend/salary/models.py`:
1. **`SalaryAttendanceVerification`**:
   - Scoped to `Department` and `Institution`.
   - Deterministic `occurrence_key` with `UniqueConstraint(department, occurrence_key)`.
   - Captures `teacher`, `student`, `class_date`, `scheduled_time`, raw attendance statuses, substitute teacher, cancellation details, verification status (`pending`, `verified`, `resolved`, `conflicted`), resolution type, determinations, and admin justifications.
2. **`SalaryAttendanceAudit`**:
   - Append-only audit record linked to `SalaryAttendanceVerification`.
   - Records `previous_status`, `new_status`, `previous_resolution`, `new_resolution`, `action`, `actor`, `reason`, `source_evidence_snapshot`, and timestamp.
3. **`SalaryReconciliationBatch`**:
   - Tracks batch execution and completeness per `(department, period_year, period_month)`.
   - Records total assessed, verified, pending, resolved, and conflicted counts.

### 5.2 Migration File Created:
- **`backend/salary/migrations/0002_salaryattendanceverification_salaryattendanceaudit_and_more.py`**:
  - Purely additive schema.
  - Zero modifications to legacy tables.
  - In strict compliance with Section 14, unapplied to non-disposable databases.

---

## 6. REST API Endpoints & Permissions

| Method | URL Path | View Action | Permission |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/salary/verifications/` | `SalaryAttendanceVerificationViewSet.list` | Dept Admin / Inst Admin / Super Admin (Scoped Read) |
| `GET` | `/api/salary/verifications/<id>/` | `SalaryAttendanceVerificationViewSet.retrieve` | Scoped Read (includes append-only audit trail) |
| `POST` | `/api/salary/verifications/<id>/resolve/` | `SalaryAttendanceVerificationViewSet.resolve` | **Department Admin Only** (Own Department Write Only) |
| `POST` | `/api/salary/verifications/preview/` | `AttendanceReconciliationPreviewView.post` | Scoped Read (Dry-run preview without DB writes) |
| `POST` | `/api/salary/verifications/reconcile/` | `AttendanceReconcileView.post` | **Department Admin Only** (Executes idempotent queue sync) |
| `GET` | `/api/salary/verifications/summary/` | `AttendanceVerificationSummaryView.get` | Scoped Read (KPI counts & readiness status) |
| `GET` | `/api/salary/verifications/readiness/` | `AttendanceApprovalReadinessView.get` | Scoped Read (Detailed approval blocking diagnostics) |

---

## 7. Automated Test Results

A dedicated automated test suite (`backend/salary/tests/test_attendance_verification.py`) was executed in the isolated SQLite in-memory runner alongside Stages 1, 2, and 3:

| # | Test Name | Invariant Tested | Result |
|---|---|---|:---:|
| 1 | `test_01_quran_past_class_missing_attendance` | Unmarked Quran past class flagged as pending review | **PASS** |
| 2 | `test_02_tuition_past_class_missing_attendance` | Unmarked Tuition past class flagged as pending review | **PASS** |
| 3 | `test_03_future_class_excluded_from_overdue` | Future class excluded from overdue pending queue | **PASS** |
| 4 | `test_04_student_attended_and_teacher_taught` | Teacher present and student present verified as class taught | **PASS** |
| 5 | `test_05_informed_leave_with_teacher_available` | Student leave with teacher present verified | **PASS** |
| 6 | `test_06_uninformed_absence_with_teacher_available` | Student absence with teacher present verified | **PASS** |
| 7 | `test_07_teacher_absent` | Teacher absent without substitute verified as missed class | **PASS** |
| 8 | `test_08_substitute_class` | Covered substitute class attributed to replacement | **PASS** |
| 9 | `test_09_payable_cancellation_evidence` | Official gazetted holiday cancellation verified | **PASS** |
| 10 | `test_10_unpaid_cancellation_evidence` | Unapproved cancellation marked as cancelled without policy rate | **PASS** |
| 11 | `test_11_mid_month_enrollment` | Occurrences before mid-month enrollment excluded | **PASS** |
| 12 | `test_12_student_transfer_effective_date` | Occurrences under old teacher excluded after transfer date | **PASS** |
| 13 | `test_13_confirmed_student_drop` | Occurrences after confirmed drop date excluded | **PASS** |
| 14 | `test_14_teaching_plan_change` | Schedule change effective date boundaries respected | **PASS** |
| 15 | `test_15_superseded_occurrence_not_duplicated` | Superseded schedule occurrences not duplicated | **PASS** |
| 16 | `test_16_two_classes_on_same_date` | Two classes on same date differentiated by schedule ID | **PASS** |
| 17 | `test_17_idempotent_reconciliation` | Repeated scan preserves existing admin resolutions without duplicating | **PASS** |
| 18 | `test_18_concurrent_duplicate_prevention` | DB UniqueConstraint blocks duplicate occurrence insertion | **PASS** |
| 19 | `test_19_unauthorized_teacher_resolution` | Teacher denied resolution authority (403 Forbidden) | **PASS** |
| 20 | `test_20_unauthorized_coordinator_resolution` | Coordinator denied resolution authority (403 Forbidden) | **PASS** |
| 21 | `test_21_unauthorized_institution_admin_resolution` | Institution Admin denied resolution authority (403 Forbidden) | **PASS** |
| 22 | `test_22_unauthorized_super_admin_resolution` | Super Admin denied resolution authority without explicit authorization (403) | **PASS** |
| 23 | `test_23_cross_department_access_denial` | Tuition admin denied resolution of Quran occurrence (403 Forbidden) | **PASS** |
| 24 | `test_24_cross_institution_access_denial` | Foreign admin denied resolution across institutions (403 Forbidden) | **PASS** |
| 25 | `test_25_spoofed_department_identifier` | Spoofed department ID in reconciliation rejected (403 Forbidden) | **PASS** |
| 26 | `test_26_mandatory_resolution_reason` | Empty resolution reason rejected (400 Bad Request) | **PASS** |
| 27 | `test_27_audit_history_preservation` | Append-only audit record created on resolution with actor and reason | **PASS** |
| 28 | `test_28_pending_count_accuracy` | Summary API returns exact pending count | **PASS** |
| 29 | `test_29_incomplete_reconciliation_blocks_readiness` | Incomplete/missing scan blocks payroll approval readiness | **PASS** |
| 30 | `test_30_readiness_passes_when_all_verified` | Approval readiness passes only after completed scan with 0 pending | **PASS** |
| 31 | `test_31_locked_historical_data_protected` | Locked/approved Salary V2 period blocks attendance resolution (422) | **PASS** |
| 32 | `test_32_no_legacy_payroll_modification` | Reconciliation causes zero mutations to Salary V1/V2 tables | **PASS** |

### Suite Total:
- Stage 1 Models: **18/18 Passed (100%)**
- Stage 2 API: **18/18 Passed (100%)**
- Stage 3 Assignments & Overrides: **18/18 Passed (100%)**
- Stage 4 Attendance Verification: **32/32 Passed (100%)**
- **Grand Total Unified Salary Tests**: **86/86 Passed (100%)**
- **TypeScript Typecheck (`npm run typecheck`)**: **0 Errors (100% Type-Safe)**
- **Vite Production Build (`npm run build`)**: **Built Successfully (0 Errors)**

---

## 8. Frontend Implementation

1. **`services/salaryVerificationService.ts`**:
   - Full TypeScript types and API client methods (`fetchVerifications`, `fetchVerificationDetail`, `resolveVerification`, `previewReconciliation`, `runReconciliation`, `fetchVerificationSummary`, `fetchApprovalReadiness`).
2. **`components/unified-salary/SalaryAttendanceVerification.tsx`**:
   - Period picker (Month & Year).
   - Real-time KPI stat cards: Total Assessed, Verified, Pending, Admin Resolved, Conflicted.
   - Final Payroll Approval Gate Banner: clearly displays whether final approval is currently BLOCKED or PERMITTED, listing all active blocking invariants.
   - Reconcile Attendance action button with live progress indicator.
   - Search & filtering by teacher, student, and verification status.
   - Queue table with raw attendance status badges (`T: present`, `S: absent`, etc.) and substitute/cancellation indicators.
   - Interactive "Review & Resolve" modal with evidence-backed resolution types and mandatory reason validation.
   - Interactive append-only audit history drawer.
3. **`components/TeacherSalaryManagement.tsx`**:
   - Integrated tab: `"Attendance Verification (Stage 4)"` accessible to Department Admins alongside Stage 2 and Stage 3 tabs.

---

## 9. Protected Application Invariants

- [x] Salary V1 services untouched (`academy/salary_service.py`, `TeacherSalarySlip`).
- [x] Salary V2 services untouched (`academy/salary_v2_service.py`, `QuranTeacherMonthlyPayroll`).
- [x] Legacy payroll source locks enforced (`teacher_session_payroll_lock_payload`).
- [x] Zero financial ledger entries or monthly salary calculations generated.
- [x] Coordinator blank-screen fix in `App.tsx` preserved.
- [x] Safe in-memory testing exclusively; non-disposable databases untouched.
