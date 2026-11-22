# Unified Salary Management — Stage 1 Implementation Report

> **Document ID**: `19_STAGE_1_SALARY_FOUNDATION_REPORT`  
> **Status**: STAGE 1 COMPLETED (FOUNDATION CONFIGURATION SCHEMA & TESTS)  
> **Repository Target**: `quran----1-Role-Based-`  
> **Application Target**: `backend/salary/`  
> **Source-of-Truth Blueprint**: [`18_UNIFIED_SALARY_MANAGEMENT_BLUEPRINT.md`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/docs/antigravity-audit/18_UNIFIED_SALARY_MANAGEMENT_BLUEPRINT.md)  
> **Execution Date**: 2026-11-03  
> **Test Status**: 18/18 Automated Model Tests Passing (100%)  
> **Migration Status**: Generated & Inspected (`0001_initial.py`), Isolated Verification, Unapplied to Non-Disposable Databases  

---

## 1. Executive Summary

In accordance with owner authorization for **Stage 1 Only**, the isolated new Django salary application (`backend/salary/`) and its foundational configuration models have been successfully created.

Stage 1 establishes the configuration foundation required for future department-scoped payroll calculation without modifying any legacy payroll calculation logic, historical ledgers, active migrations, or user-facing interfaces.

### Core Objectives Achieved:
1. **Isolated Application Structure**: Created `backend/salary/` with `apps.py`, `models.py`, `admin.py`, initial migration, and unit test suite.
2. **Seven Foundation Configuration Models**: Implemented `SalaryPolicy`, `SalaryPolicyVersion`, `SalaryRateTier`, `SalaryTeachingPlan`, `SalaryPlanTierRate`, `TeacherPolicyAssignment`, and `TeacherSalaryOverride`.
3. **Database Constraints & Model Validation**: Added PostgreSQL-compatible composite unique constraints, check constraints, date range interval validations, department consistency checks, and published version immutability protections.
4. **Precision Guarantee**: Enforced exact `DecimalField(max_digits=12, decimal_places=2)` across all rate fields to eliminate floating-point drift.
5. **Safe Django Admin Registration**: Registered all 7 models with locked-down change and delete permissions for published versions.
6. **Automated Verification**: Created and executed 18 comprehensive automated tests in a safe, isolated test runner with 100% pass rate.
7. **Strict Non-Destructive Boundaries**: Zero alterations to Salary V1 (`TeacherSalarySlip`), Salary V2 (`QuranTeacherMonthlyPayroll`), attendance models, or frontend code (`App.tsx` coordinator blank-screen fix preserved).

---

## 2. Implemented Models & Relational Schema

### Model 1: `SalaryPolicy`
- **Purpose**: Department-scoped policy container.
- **Fields**:
  - `institution`: ForeignKey to `accounts.Institution` (CASCADE).
  - `department`: ForeignKey to `accounts.Department` (CASCADE).
  - `code`: CharField(max_length=60, db_index=True) (e.g. `QURAN_STANDARD_2026`, `TUITION_SECONDARY_2026`).
  - `name`: CharField(max_length=120).
  - `description`: TextField(blank=True).
  - `policy_type`: CharField(choices: `standard`, `hifz`, `custom`).
  - `compensation_model`: CharField(choices: `per_class`, `basic`, `basic_plus_per_class`).
  - `is_active`: BooleanField(default=True, db_index=True).
  - Audit metadata: `created_by`, `created_at`, `updated_at`.
- **Database Constraints**: `UniqueConstraint(fields=["department", "code"], name="unique_department_salary_policy_code")`.
- **Validation**: Ensures department belongs to the specified institution.

### Model 2: `SalaryPolicyVersion`
- **Purpose**: Effective-dated, immutable policy version container.
- **Fields**:
  - `policy`: ForeignKey to `SalaryPolicy` (CASCADE).
  - `version_number`: PositiveIntegerField.
  - `status`: CharField(choices: `draft`, `published`, `archived`, default=`draft`).
  - `effective_from`: DateField(db_index=True).
  - `effective_to`: DateField(null=True, blank=True, db_index=True).
  - `week_start_day`: CharField(choices: `monday` through `sunday`, default=`monday`).
  - `min_qualifying_weeks`: PositiveSmallIntegerField(default=2).
  - `lesson_plan_bonus_per_class`: DecimalField(max_digits=10, decimal_places=2, default=10.00).
  - `substitute_rate_per_class`: DecimalField(max_digits=10, decimal_places=2, default=80.00).
  - `cancellation_rate_per_class`: DecimalField(max_digits=10, decimal_places=2, default=80.00).
  - `requires_completed_lesson_for_bonus`: BooleanField(default=True).
  - `notes`: TextField(blank=True).
  - Audit metadata: `published_at`, `published_by`, `created_at`, `updated_at`.
- **Database Constraints**:
  - `UniqueConstraint(fields=["policy", "version_number"], name="unique_policy_version_number")`.
  - `CheckConstraint(check=Q(effective_to__isnull=True) | Q(effective_to__gte=F("effective_from")), name="check_valid_policy_version_dates")`.
- **Application Validation**:
  - Non-overlapping date ranges across published versions of the same policy.
  - Complete contiguous tier validation on publication.
  - Immutability enforcement: published versions reject modification of parameters or rate structures.

### Model 3: `SalaryRateTier`
- **Purpose**: Student-count tiers (horizontal axis of rate matrix).
- **Fields**:
  - `policy_version`: ForeignKey to `SalaryPolicyVersion` (CASCADE).
  - `tier_name`: CharField(max_length=60) (e.g. `1–15`, `16–19`, `20+`).
  - `min_students`: PositiveIntegerField(default=1).
  - `max_students`: PositiveIntegerField(null=True, blank=True). Null represents an unbounded tier ($\infty$).
  - `sort_order`: PositiveSmallIntegerField(default=1).
- **Database Constraints**:
  - `UniqueConstraint(fields=["policy_version", "sort_order"], name="unique_policy_version_tier_order")`.
  - `CheckConstraint(check=Q(min_students__gte=1), name="check_min_students_positive")`.
  - `CheckConstraint(check=Q(max_students__isnull=True) | Q(max_students__gte=F("min_students")), name="check_tier_min_lte_max")`.
- **Application Validation**: Prevents overlapping ranges within sibling tiers; validates contiguous sequence on publication.

### Model 4: `SalaryTeachingPlan`
- **Purpose**: Weekly teaching arrangements (vertical axis of rate matrix).
- **Fields**:
  - `policy_version`: ForeignKey to `SalaryPolicyVersion` (CASCADE).
  - `plan_code`: CharField(max_length=40) (e.g. `5_days`, `4_days`, `3_days`, `2_days`, `coordinator_special`).
  - `plan_name`: CharField(max_length=100).
  - `days_per_week`: PositiveSmallIntegerField(null=True, blank=True).
  - `is_coordinator_special`: BooleanField(default=False).
  - `sort_order`: PositiveSmallIntegerField(default=1).
- **Database Constraints**: `UniqueConstraint(fields=["policy_version", "plan_code"], name="unique_policy_version_plan_code")`.
- **Application Validation**: Protected against modification/deletion when policy version is published.

### Model 5: `SalaryPlanTierRate`
- **Purpose**: Two-dimensional rate matrix cell (Teaching Plan × Student Tier $\rightarrow$ PKR Rate).
- **Fields**:
  - `policy_version`: ForeignKey to `SalaryPolicyVersion` (CASCADE).
  - `teaching_plan`: ForeignKey to `SalaryTeachingPlan` (CASCADE).
  - `rate_tier`: ForeignKey to `SalaryRateTier` (CASCADE).
  - `rate_per_class`: DecimalField(max_digits=12, decimal_places=2).
- **Database Constraints**:
  - `UniqueConstraint(fields=["policy_version", "teaching_plan", "rate_tier"], name="unique_plan_tier_rate_entry")`.
  - `CheckConstraint(check=Q(rate_per_class__gte=Decimal("0.00")), name="check_positive_rate_per_class")`.
- **Application Validation**: Enforces version integrity: `teaching_plan` and `rate_tier` must belong to the same `policy_version`. Protected against edits once version is published.

### Model 6: `TeacherPolicyAssignment`
- **Purpose**: Effective-dated assignment of a salary policy to a teacher within a department.
- **Fields**:
  - `department`: ForeignKey to `accounts.Department` (CASCADE).
  - `teacher`: ForeignKey to `academy.TeacherProfile` (PROTECT).
  - `policy`: ForeignKey to `SalaryPolicy` (PROTECT).
  - `effective_from`: DateField(db_index=True).
  - `effective_to`: DateField(null=True, blank=True, db_index=True).
  - `is_active`: BooleanField(default=True, db_index=True).
  - Audit metadata: `assigned_by`, `assigned_at`, `notes`.
- **Database Constraints**: `CheckConstraint(check=Q(effective_to__isnull=True) | Q(effective_to__gte=F("effective_from")), name="check_valid_assignment_dates")`.
- **Application Validation**:
  - Teacher must belong to the assignment department (`teacher.department_id == department_id`).
  - Policy must belong to the assignment department (`policy.department_id == department_id`).
  - Prevents ambiguous overlapping active assignments for the same teacher and department.

### Model 7: `TeacherSalaryOverride`
- **Purpose**: Effective-dated rate overrides implementing the 5-level precedence hierarchy.
- **Fields**:
  - `department`: ForeignKey to `accounts.Department` (CASCADE).
  - `teacher`: ForeignKey to `academy.TeacherProfile` (PROTECT).
  - `override_level`: CharField(choices: `student_specific`, `plan_specific`, `teacher_wide`, `coordinator_day`).
  - `salary_policy`: ForeignKey to `SalaryPolicy` (null=True, blank=True, SET_NULL).
  - `student`: ForeignKey to `academy.StudentProfile` (null=True, blank=True, PROTECT).
  - `teaching_plan`: ForeignKey to `SalaryTeachingPlan` (null=True, blank=True, PROTECT).
  - `qualifying_weekday`: CharField(null=True, blank=True, choices: `monday` through `sunday`).
  - `rate_per_class`: DecimalField(max_digits=12, decimal_places=2).
  - `effective_from`: DateField(db_index=True).
  - `effective_to`: DateField(null=True, blank=True, db_index=True).
  - `is_active`: BooleanField(default=True, db_index=True).
  - `reason`: TextField(mandatory business justification).
  - Audit metadata: `created_by`, `created_at`, `updated_at`.
- **Database Constraints**:
  - `CheckConstraint(check=Q(rate_per_class__gte=Decimal("0.00")), name="check_positive_override_rate")`.
  - `CheckConstraint(check=Q(effective_to__isnull=True) | Q(effective_to__gte=F("effective_from")), name="check_valid_override_dates")`.
- **Application Validation**:
  - Mandatory reason required.
  - Cross-department consistency: teacher, student, policy, and teaching plan must belong to the override department.
  - Required targets enforced per level (`student` required for level 1; `teaching_plan` required for level 2; `qualifying_weekday` for coordinator day).
  - Overlap prevention for active overrides of equal scope and precedence.

---

## 3. Migration Report

- **Generated Migration File**: `backend/salary/migrations/0001_initial.py`
- **Dependencies**:
  - `('academy', '0025_backfill_historical_actor_names')`
  - `('accounts', '0012_portal_notification')`
  - `settings.AUTH_USER_MODEL`
- **Schema Impact Summary**:
  - Creates 7 new tables: `salary_salarypolicy`, `salary_salarypolicyversion`, `salary_salaryratetier`, `salary_salaryteachingplan`, `salary_salaryplantierrate`, `salary_teacherpolicyassignment`, `salary_teachersalaryoverride`.
  - Creates 5 unique constraints and 8 check constraints.
  - Zero modifications to legacy tables (`academy_teachersalaryslip`, `academy_quranteachermonthlypayroll`, etc.).
  - Zero circular dependencies.
- **Application Status**: Verified via `sqlmigrate salary 0001`. In strict compliance with Section 8, migration was **not applied to `ivs_academy_db` or any non-disposable database**.

---

## 4. Automated Test Verification

All 18 required test scenarios were implemented in `backend/salary/tests/test_policy_models.py` and executed using an isolated SQLite in-memory test runner:

| # | Test Name | Target Invariant | Result |
|---|---|---|:---:|
| 1 | `test_01_department_scoped_policy_creation` | Policy creation, department scoping, compensation model | **PASS** |
| 2 | `test_02_duplicate_policy_code_rejection` | Unique constraint per department, cross-department code reuse allowed | **PASS** |
| 3 | `test_03_policy_version_effective_dates` | `effective_to >= effective_from` validation | **PASS** |
| 4 | `test_04_seven_configurable_week_starts` | All 7 weekdays supported (`monday`..`sunday`), invalid rejected | **PASS** |
| 5 | `test_05_nonoverlapping_published_policy_versions` | Overlapping published versions for same policy rejected | **PASS** |
| 6 | `test_06_tier_boundary_validation` | `min <= max`, overlapping sibling tiers rejected | **PASS** |
| 7 | `test_07_unbounded_upper_tier` | Unbounded final tier (`max_students=None`, 20+) contiguous validation | **PASS** |
| 8 | `test_08_teaching_plan_creation` | Plan codes, days per week, coordinator special flag, unique code | **PASS** |
| 9 | `test_09_two_dimensional_rate_matrix_uniqueness` | Composite unique constraint `(version, plan, tier)` | **PASS** |
| 10 | `test_10_reference_quran_rate_precision` | Reference Quran 2D matrix (80–250 PKR) exact decimal precision | **PASS** |
| 11 | `test_11_cross_policy_version_rate_cell_rejection` | Foreign version plan/tier rejection | **PASS** |
| 12 | `test_12_teacher_policy_department_consistency` | Cross-department teacher assignment rejection | **PASS** |
| 13 | `test_13_teacher_assignment_date_overlap_rejection` | Active assignment date overlap rejection | **PASS** |
| 14 | `test_14_teacher_specific_override_validation` | Level prerequisites, non-negative rate, mandatory reason | **PASS** |
| 15 | `test_15_cross_department_override_rejection` | Tuition student / Quran teacher cross-override rejection | **PASS** |
| 16 | `test_16_published_policy_immutability` | Published version parameter, tier, plan, rate edit/delete rejection | **PASS** |
| 17 | `test_17_django_admin_restrictions_on_published_policy_edits` | Admin `get_readonly_fields`, `has_change_permission`, `has_delete_permission` | **PASS** |
| 18 | `test_18_existing_application_model_references_remain_valid` | Existing `TeacherProfile`, `StudentProfile`, `Department` integrity | **PASS** |

**Execution Summary**:
- Tests created: 18
- Tests executed: 18
- Tests passed: 18 (100%)
- Tests failed: 0
- Tests skipped: 0

---

## 5. Known Limitations & Architectural Invariants

1. **Database vs Application-Level Enforcement**:
   - Unique and check constraints (`unique_plan_tier_rate_entry`, `check_positive_rate_per_class`, `check_valid_policy_version_dates`, etc.) are enforced by PostgreSQL at the database level.
   - Dynamic cross-table integrity (e.g., verifying that a `SalaryPlanTierRate` does not reference a plan belonging to a different `policy_version`, or teacher-department match) is enforced via Django `clean()` and `save()`. Direct SQL `UPDATE` queries bypassing Django ORM will not execute `clean()`.
   - Date range overlap checks across arbitrary historical intervals are validated transactionally at the application level via `date_intervals_overlap()`. PostgreSQL exclusion constraints (`EXCLUDE USING gist`) require the `btree_gist` extension; the application-level validation avoids requiring unverified PostgreSQL extensions on Oracle Cloud while maintaining 100% integrity through Django.

2. **Published Policy Immutability**:
   - In Django Admin and application code, published versions are strictly read-only except for transitioning to `archived`.
   - Attempting to modify configuration parameters or delete rate rows raises a `ValidationError`.

---

## 6. Verification Against Protected Scopes

- [x] Salary V1 services untouched (`academy/salary_service.py`, `TeacherSalarySlip`).
- [x] Salary V2 services untouched (`academy/salary_v2_service.py`, `QuranTeacherMonthlyPayroll`).
- [x] Legacy migrations untouched.
- [x] Coordinator blank-screen fix in `App.tsx` preserved.
- [x] No frontend code touched.
- [x] No salary endpoints exposed.
- [x] No production database connection or deployment attempted.
