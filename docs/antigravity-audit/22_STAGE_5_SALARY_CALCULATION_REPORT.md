# Unified Salary Management — Stage 5 Implementation Report

> **Document ID**: `22_STAGE_5_SALARY_CALCULATION_REPORT`  
> **Status**: STAGE 5 COMPLETED (DETERMINISTIC MONTHLY SALARY CALCULATION AND DRAFT EARNINGS PREVIEW)  
> **Repository Target**: `quran----1-Role-Based-`  
> **Backend Package**: `backend/salary/`  
> **Calculation Engine**: `backend/salary/calculation_engine.py`  
> **API Endpoint**: `POST /api/salary/calculations/preview/`  
> **Frontend Components**: `components/unified-salary/MonthlySalaryPreview.tsx`  
> **Execution Date**: 2026-11-03  
> **Test Status**: 138/138 Total Automated Tests Passing (100% across Stage 1 Models, Stage 2 Policy API, Stage 3 Assignments/Overrides, Stage 4 Attendance Verification, and Stage 5 Calculation Engine)  
> **Database Status**: Zero Additive Migrations to Non-Disposable Databases (Pure Calculation & Audit Preview; Verified in Isolated Memory DB)  

---

## 1. Executive Summary

In strict accordance with owner authorization for **Stage 5 Only**, the stateless, deterministic monthly salary calculation engine and draft earnings preview have been implemented, tested, and integrated.

Stage 5 strictly adheres to clean architectural boundaries:
- **Stateless & Pure Calculation**: Evaluates earnings explaining every rupee using verified source evidence (Stage 4) and published effective-dated policies (Stage 1–3).
- **Prohibited Actions Strictly Avoided**:
  - Does NOT generate payable payroll records.
  - Does NOT approve payroll or record ledger disbursements.
  - Does NOT record payments or mark records as paid.
  - Does NOT implement manual cuttings or arbitrary penalties.
  - Does NOT mutate teacher attendance, student enrollments, or historical payroll.
  - Preserves all pre-existing changes, including the coordinator permission blank-screen fix in `App.tsx`.

---

## 2. Calculation Engine Architecture (`calculation_engine.py`)

The pure calculation engine is housed in `backend/salary/calculation_engine.py` and structured into modular, deterministic components:

### 2.1 Historical Student-Count Resolution (`resolve_historical_student_count`)
Salary rate tiers depend on the total active students assigned to a teacher on each class date. The engine resolves active students historically rather than from current snapshot rosters:
1. **Enrollment Start**: Student must be admitted on or before the class date (`admission_date <= class_date`).
2. **Confirmed Drops**: Evaluates `StudentProfile.is_dropped` (checking `class_status in {OLD_DROPPED, TRIAL_DROPPED, OLD_DROPPED_OTHER}`). If dropped and `status_effective_date <= class_date`, the student is excluded from the count. A pending coordinator drop review or student absence does NOT reduce the count.
3. **Teacher Transfers**: Queries `StudentClassHistory` for `transfer_type == 'TEACHER_TRANSFER'` with `effective_date <= class_date`. If transferred away from Teacher A to Teacher B, Teacher A's count drops on `effective_date` and Teacher B's count rises on `effective_date`.
4. **Distinct Student Counting**: Each active student is counted exactly once, even when that student has multiple weekly class schedules.
5. **Department Adaptation**:
   - Quran: Evaluates `ClassSchedule` and `StudentProfile`.
   - Tuition: Evaluates `TuitionEnrollment` (`start_date`, `end_date`, `is_active`) and `TuitionSchedule`.
6. **No Retroactive Rate Application**: A teacher with 15 students through Nov 14 (Tier 2: Rs. 80) and 16 students starting Nov 15 (Tier 3: Rs. 90) receives Rs. 80 for earlier classes and Rs. 90 for subsequent classes.

### 2.2 Configurable Weekly Partitioning & Eligibility Engine
- **Configurable Week Start**: Partitioning calendar months supports all 7 weekdays (`SalaryPolicyVersion.week_start_day`, 0=Monday through 6=Sunday; default Monday).
- **Partial Weeks**: Handles partial start and partial end weeks cleanly.
- **Two-Week Regular Earning Minimum**: Ongoing students must have at least 2 qualifying weeks in the payroll month. A week qualifies if at least one verified scheduled class occurred (taught, student absence with verified teacher availability, or payable official cancellation).
  - 0 or 1 qualifying week &rarr; Rs. 0.00 regular earnings (with auditable disqualification reason).
  - &ge; 2 qualifying weeks &rarr; 100% of regular class earnings paid at full matrix rate. No arbitrary 50% deductions.
  - **No 20-Class Cap**: Every qualifying class is compensated.
- **Partial-Month Exceptions**:
  - Mid-month new enrollments (`admission_date >= first_day_of_month`).
  - Confirmed drops/departures (`status_effective_date`).
  - Mid-month teacher transfers.
  - Receiving teacher with only 1 week after a genuine transfer qualifies for the transfer exception and is paid prorated earnings.
- **Teaching Plan Changes**: When a student transitions from a 3-day to a 5-day plan, eligible weeks do not reset; weeks containing classes from both plans count once toward monthly eligibility, and each individual class is priced at the plan rate effective on its own date.
- **Cross-Month Independence**: A week spanning month boundaries qualifies independently in both months based only on classes occurring within each respective calendar month. Classes are never paid twice.

### 2.3 Compensation Components
1. **Regular Class Earnings**:
   - Resolves effective teaching plan and active student count tier.
   - Evaluates rates using the 4-level precedence hierarchy:
     1. Student-specific override (`precedence_level = 1`)
     2. Teaching-plan override (`precedence_level = 2`)
     3. Teacher-wide override (`precedence_level = 3`)
     4. Base Plan-Tier Matrix Rate (`precedence_level = 4`)
2. **Basic Monthly Salary**:
   - Strictly evaluated from saved policy configuration.
   - **Data Model Gap Analysis**: `SalaryPolicy.compensation_model` supports `basic` and `basic_plus_per_class`, but neither `SalaryPolicyVersion` nor `TeacherPolicyAssignment` contains a `basic_salary_amount` column.
   - The engine returns `0.00` and emits an auditable configuration gap message rather than faking an unsaved rate.
3. **Lesson Plan Bonus (Quran)**:
   - Configurable per policy version (Reference: Rs. 10/class).
   - Requires verified `class_taught` + completed `DailyLessonReport` matching teacher, student, and date.
   - Strictly excluded for student absence, teacher absence, or substitute classes.
   - Remains payable independently of the 2-week regular earnings minimum.
4. **Substitute Compensation**:
   - Configurable per policy version (Reference: Rs. 80/class).
   - Paid independently to the substitute teacher.
   - Original teacher receives Rs. 0.00 for the missed class.
   - Substitute coverage does not modify the substitute's regular active-student count tier.
   - No substitute lesson plan bonus.
5. **Official Cancellations**:
   - Paid cancellations earn `cancellation_rate_per_class` and count toward weekly qualification.
   - Unpaid cancellations yield Rs. 0.00 with auditable notes.
   - No lesson plan bonus for cancellations.
6. **Mid-Month Policy Version Changes**:
   - Stamped per occurrence using `get_effective_version(class_date)`, preventing retroactive rate bleeding across version effective dates.

---

## 3. Backend API Implementation

- **Endpoint**: `POST /api/salary/calculations/preview/`
- **Request Serializer**: `SalaryCalculationPreviewRequestSerializer`
  - Parameters: `department_id`, `year`, `month`, optional `teacher_id`.
- **View**: `SalaryCalculationPreviewView` in `backend/salary/views.py`
  - RBAC: `IsAuthenticated`, `IsSalaryPolicyAdminOrReadOnly`.
  - Department Scoping: Enforces `get_authorized_department_id_for_user()`. Non-admins (teachers, coordinators, students) receive `HTTP 403 Forbidden`. Cross-institution requests receive `HTTP 403 Forbidden`.
- **Response**: Contains department-wide summary, department warning list, calculation completeness flag, and itemized teacher previews with student timelines, weekly eligibility tables, itemized class earning lines, and unresolved occurrences.

---

## 4. Frontend Implementation

### 4.1 Client Service (`services/salaryCalculationService.ts`)
- TypeScript interfaces matching calculation engine payload:
  - `ClassEarningLine`
  - `WeeklyStudentEligibility`
  - `StudentMonthlyEligibility`
  - `StudentCountTimelineEntry`
  - `TeacherSalaryPreview`
  - `DepartmentSalaryCalculationSummary`
  - `DepartmentSalaryPreviewResponse`
- Exported API function: `fetchSalaryCalculationPreview()`.

### 4.2 Workspace Component (`components/unified-salary/MonthlySalaryPreview.tsx`)
- **Period & Department Context**: Controls for Year (2024–2027), Month (Jan–Dec), Teacher filter dropdown, and Calculate/Refresh button.
- **Mandatory Statutory Banner**: Explains that calculation is draft-only and not approved or payable.
- **Completeness & Warning Alert**: Displays department warnings (incomplete reconciliation scans, pending attendance, conflicted evidence).
- **6 KPI Metric Cards**: Gross Draft, Regular Classes, Lesson Bonuses, Substitute Pay, Cancellations, and Total Class Count.
- **Teacher Accordions & Subviews**:
  - Overview badge, gross total, policy version, and active students.
  - Subview Tab 1: **Itemized Class Occurrence Lines** (Date, Time, Student, Outcome, Plan & Tier, Applied Rate, Override Reason, Weekly Status, Regular, Bonus, Substitute, Total PKR, Zero Payment Reason).
  - Subview Tab 2: **Weekly Student Eligibility Breakdown** (Student, Qualified badge, Eligible vs Required weeks, Exception notes, Week 1..N breakdown tags).
  - Subview Tab 3: **Student Count Timeline** (Historical daily active-student count and tier cards).
- **Navigation Integration**: Registered in `components/TeacherSalaryManagement.tsx` under `"Monthly Salary Preview (Stage 5)"` tab.

---

## 5. Automated Test Verification Results

All 52 targeted calculation test cases in `backend/salary/tests/test_salary_calculation.py` passed:

| Category | Tests | Status |
| :--- | :--- | :--- |
| **Historical Student Count Resolution** (Enrollment, drops, transfers, no-retroactive rates) | 6 | **PASS (100%)** |
| **Weekly Partitioning & Eligibility** (7 weekdays, partial weeks, 2-week rule, exceptions) | 8 | **PASS (100%)** |
| **Precedence Hierarchy & Rate Resolution** (Student, plan, teacher, matrix rates) | 5 | **PASS (100%)** |
| **Absence & Attendance Outcomes** (Student absent, teacher absent, no pay) | 4 | **PASS (100%)** |
| **Lesson Plan Bonus Evaluation** (Completed report, student absent, teacher absent, substitute) | 5 | **PASS (100%)** |
| **Substitute Compensation** (Covered class, substitute pay, tier isolation) | 5 | **PASS (100%)** |
| **Official Cancellations** (Paid vs unpaid closures, weekly qualification) | 3 | **PASS (100%)** |
| **Policy Version Changes Mid-Month** (Non-retroactive rate boundary resolution) | 2 | **PASS (100%)** |
| **No 20-Class Salary Cap Verification** (>20 classes compensated fully) | 2 | **PASS (100%)** |
| **Basic Salary Handling & Configuration Gap Reporting** | 2 | **PASS (100%)** |
| **API Endpoint, Department Scoping & RBAC** (Non-admin denial, cross-institution, filters) | 6 | **PASS (100%)** |
| **Completeness Gates & Unresolved Occurrences** (Pending attendance flags calculation incomplete) | 4 | **PASS (100%)** |
| **TOTAL STAGE 5 CALCULATION TESTS** | **52** | **PASS (100%)** |

### Complete Test Suite Summary
- `salary.tests.test_policy_models`: 18/18 PASS
- `salary.tests.test_policy_api`: 18/18 PASS
- `salary.tests.test_assignments_and_overrides`: 18/18 PASS
- `salary.tests.test_attendance_verification`: 32/32 PASS
- `salary.tests.test_salary_calculation`: 52/52 PASS
- **Overall Total**: **138/138 Automated Tests Passing (100%)**

### Frontend Verification
- TypeScript Check: `npm run typecheck` &rarr; **Zero errors (Exit Code 0)**.
- Production Build: `npm run build` &rarr; **Built clean in 37.53s (Exit Code 0)**.

---

## 6. Schema Limitation & Recommendations for Future Stages

1. **Basic Monthly Salary Storage**:
   - `SalaryPolicy.compensation_model` allows configuring `basic` or `basic_plus_per_class`.
   - However, neither `SalaryPolicyVersion` nor `TeacherPolicyAssignment` contains a `basic_salary_amount: DecimalField` column.
   - Recommended additive migration for a future stage: Add `basic_salary_amount` to `TeacherPolicyAssignment` with optional department-level default on `SalaryPolicyVersion`.
2. **Next Steps (Stage 6+)**:
   - Implement formal payroll generation from verified calculation previews.
   - Implement approval workflow (Department Review &rarr; Super Admin Approval).
   - Implement ledger posting and payment recording.
