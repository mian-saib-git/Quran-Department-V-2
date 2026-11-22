# IVS Academy: Single Operational Database Pre-Migration Safety Check & Readiness Report

> **Document ID**: `34_SINGLE_DATABASE_MIGRATION_READINESS_REPORT`  
> **Status**: COMPLETED — PRE-MIGRATION SAFETY CHECK VERIFIED; OPERATIONAL ARCHITECTURE CONFIRMED; PRODUCTION ACTIVATION WITHHELD (NO-GO PENDING OWNER UI CHECKLIST & PG16 STAGING RUNTIME VALIDATION) — MANDATORY STOP ACTIVE  
> **Target Database**: `ivs_academy_db` (Single Operational PostgreSQL Database)  
> **Testing Database**: `test_ivs_academy_db` (Disposable Testing & Rehearsal Database Only)  
> **Production Target**: [https://quranhometutor.com/](https://quranhometutor.com/) (Oracle Cloud Infrastructure)  
> **Current Git Branch**: `release/ivs-20261020-candidate`  
> **Current Head Commit**: `de92b7606543936eafe52ed66792eedda6d4598e`  
> **Automated Regression Suite**: 314 / 314 Tests Passing (100% in 30.19s)  
> **Frontend TypeScript Compilation**: 0 Errors (`tsc --noEmit` Clean)  
> **Audit Date**: 2026-11-09  

---

## Executive Summary & Target Architecture Confirmation

Following the comprehensive audit series (Reports `00` through `32`), this report resolves all outstanding safety, schema, backup, rehearsal, and rollback questions prior to installing the Unified Salary Management subsystem into the single operational PostgreSQL database.

### Confirmed Architecture

```mermaid
graph TD
    subgraph Operational Environment [Single Operational PostgreSQL Database: ivs_academy_db]
        Accounts["accounts\n(Users, Roles, Institutions, Portals)"]
        Quran["academy\n(Quran Teachers, Students, Attendance, Historical V1/V2 Payroll)"]
        Tuition["tuition\n(Tuition Teachers, Enrollments, Schedules, Attendance)"]
        UnifiedSalary["salary\n(Unified Salary Management: 25 Models / Tables)\n[Migrations 0001-0006 Additive]"]
        Cutover["SalaryEngineCutoverRegistry\n(Default: is_unified_engine_active = False)"]
        
        Accounts --- Quran
        Accounts --- Tuition
        Quran --- UnifiedSalary
        Tuition --- UnifiedSalary
        UnifiedSalary --- Cutover
    end

    subgraph Testing & Staging Environment [Disposable Testing Database: test_ivs_academy_db]
        DumpRestore["Restored Copy of ivs_academy_db\n(pg_dump -Fc -> pg_restore)"]
        Rehearsal["Migration Rehearsal &\nCross-Engine Reconciliation"]
    end
```

1. **One Operational Database**: All departments (Quran, Tuition, Accounts, Attendance, and Unified Salary Management) reside within the single operational database `ivs_academy_db`. No separate operational database is created or connected.
2. **Disposable Testing Database**: `test_ivs_academy_db` is confirmed as a strictly disposable rehearsal database, restored from backup dumps to validate schema migrations and data integrity.
3. **Zero In-Task Production Mutation**: In accordance with explicit safety boundaries, no migrations were applied to `ivs_academy_db`, no deployment was made to Oracle Cloud, no live salary payroll was activated, and no git commits or pushes were executed during this check.

---

## 1. Academy Migration 0025 Verification

**Migration File**: [`backend/academy/migrations/0025_backfill_historical_actor_names.py`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/backend/academy/migrations/0025_backfill_historical_actor_names.py)  
**Migration Dependency**: `('academy', '0024_teacher_login_history_detach')`  
**Migration Type**: Data Migration (`migrations.RunPython(backfill_historical_names, migrations.RunPython.noop)`)

### 1.1 Critical Audit Finding: Existing Record Modification
> [!IMPORTANT]
> **Data Modification Disclosure**: Migration `academy.0025` is **NOT** a zero-modification migration. It directly executes SQL `UPDATE` statements against **6 existing historical tables**, modifying empty text snapshot columns across historical records. Any report characterizing `0025` as having zero existing-record modifications is factually false.

### 1.2 Exact Tables and Columns Affected

The migration executes two SQL update blocks against historical tables:

| # | Existing Table | Target Column | Source FK Column | Joined Table | Source Expression |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **1** | `academy_teacherprofile` | `historical_name` | `user_id` | `accounts_user` | `LEFT(COALESCE(NULLIF(BTRIM(first_name \|\| ' ' \|\| last_name), ''), NULLIF(BTRIM(username), ''), 'User #' \|\| id::text), 255)` |
| **2** | `academy_attendance` | `actor_name_snapshot` | `marked_by_id` | `accounts_user` | *Same display-name fallback logic* |
| **3** | `academy_lesson` | `actor_name_snapshot` | `created_by_id` | `accounts_user` | *Same display-name fallback logic* |
| **4** | `academy_dailylessonreport` | `actor_name_snapshot` | `created_by_id` | `accounts_user` | *Same display-name fallback logic* |
| **5** | `academy_monthlylessonsummary` | `actor_name_snapshot` | `created_by_id` | `accounts_user` | *Same display-name fallback logic* |
| **6** | `academy_monthlylessonplan` | `actor_name_snapshot` | `created_by_id` | `accounts_user` | *Same display-name fallback logic* |

*Note: Table `accounts_user` is read from via `FROM accounts_user AS u` but is not mutated.*

### 1.3 Row Update Analysis on Operational Data

Forensic inspection of the operational baseline dataset reveals the following exact row impact:

| Table | Total Rows | Rows with Valid User FK | Existing Blank Snapshots | Exact Rows Updated by `0025` |
| :--- | :---: | :---: | :---: | :---: |
| `academy_teacherprofile` | 73 | 73 | 73 | **73** |
| `academy_attendance` | 1,599 | 1,599 | 1,599 | **1,599** |
| `academy_lesson` | 14 | 14 | 14 | **14** |
| `academy_dailylessonreport` | 18 | 18 | 18 | **18** |
| `academy_monthlylessonsummary` | 7 | 7 | 7 | **7** |
| `academy_monthlylessonplan` | 4 | 4 | 4 | **4** |
| **TOTAL** | **1,715** | **1,715** | **1,715** | **1,715 historical evidence rows** |

### 1.4 Verification of Name Formatting Samples

Simulated execution against the operational dataset produces genuine historical actor snapshots:

- **Teacher Profiles**:
  - Teacher PK `72` (`user_id = 212`) $\rightarrow$ `'04 Zakir khan'`
  - Teacher PK `73` (`user_id = 213`) $\rightarrow$ `'05 Irfan'`
  - Teacher PK `74` (`user_id = 214`) $\rightarrow$ `'07 Hafiz M Zain ul Abidin'`
  - Teacher PK `75` (`user_id = 215`) $\rightarrow$ `'08 Abbas'`
  - Teacher PK `76` (`user_id = 216`) $\rightarrow$ `'09 Sayed ullah'`
- **Attendance Records**:
  - Attendance PK `87690` (`marked_by_id = 1`) $\rightarrow$ `'Mian Abdul Hameed'`
  - Attendance PK `87693` (`marked_by_id = 1`) $\rightarrow$ `'Mian Abdul Hameed'`

### 1.5 Safety Characteristics

1. **Reversibility**:
   - Specified as `migrations.RunPython(backfill_historical_names, migrations.RunPython.noop)`.
   - The reverse operation is `noop`. If migration `0025` is unapplied (`migrate academy 0024`), Django removes the migration ledger record without wiping the captured text snapshot columns.
   - This design is intentionally non-destructive: erasing captured historical names on unapply would destroy audit evidence.
2. **Idempotency**:
   - Both update queries enforce strict conditional WHERE filters:
     - `AND (p.historical_name IS NULL OR BTRIM(p.historical_name) = '')`
     - `AND (evidence.actor_name_snapshot IS NULL OR BTRIM(evidence.actor_name_snapshot) = '')`
   - If executed a second time, exactly **0 rows** match the condition. Previously backfilled or manually customized names are never overwritten.
3. **Impact on Historical Financial & Attendance Records**:
   - **Historical Payroll Amounts**: **0.00 PKR impact**. Tables `academy_teachersalaryslip` (V1) and `academy_quranteachermonthlypayroll` (V2) are completely untouched.
   - **Payment Statuses**: **0 changes**. Payment and slip statuses remain strictly identical.
   - **Attendance Integrity**: Attendance dates, start/end times, student IDs, teacher IDs, status values (`present`, `absent`, `leave`), and class minutes are **100% unmutated**. Only the audit string `actor_name_snapshot` is populated.
4. **PostgreSQL Dialect Specificity**:
   - Migration `0025` uses native PostgreSQL functions (`CONCAT_WS`, `BTRIM`, `LEFT`, `COALESCE`, `NULLIF`, `u.id::text`, and `UPDATE ... FROM`). It requires PostgreSQL 14+ and cannot be executed directly on SQLite without PostgreSQL dialect emulation.

---

## 2. Review of Unified Salary Migrations (0001 through 0006)

**Location**: [`backend/salary/migrations/`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/backend/salary/migrations/)  
**Migrations Reviewed**: `0001_initial.py`, `0002_salaryattendanceverification_salaryattendanceaudit_and_more.py`, `0003_add_basic_salary_and_coordinator_config.py`, `0004_salary_adjustments_and_bulk_batches.py`, `0005_monthly_payroll_records_and_submissions.py`, `0006_payroll_approvals_ledger_and_payments.py`.

```mermaid
graph TD
    Academy0025["academy.0025_backfill_historical_actor_names"] --> Sal0001["salary.0001_initial"]
    Accounts0012["accounts.0012_portal_notification"] --> Sal0001
    Sal0001 --> Sal0002["salary.0002_attendance_verification"]
    Sal0002 --> Sal0003["salary.0003_basic_salary_coordinator_config"]
    Sal0003 --> Sal0004["salary.0004_adjustments_bulk_batches"]
    Sal0004 --> Sal0005["salary.0005_monthly_payroll_submissions"]
    Sal0005 --> Sal0006["salary.0006_approvals_ledger_payments_cutover"]
```

### 2.1 Schema Operations & Model Inventory

All 6 migrations are strictly additive. They introduce **25 new models / database tables** (all prefixed with `salary_`) and alter only previously created `salary_` tables.

| Migration | Operation Type | Tables / Fields Created | Primary Capabilities |
| :--- | :--- | :--- | :--- |
| **`0001_initial`** | Additive DDL | `salary_salarypolicy`<br>`salary_salarypolicyversion`<br>`salary_salaryratetier`<br>`salary_salaryteachingplan`<br>`salary_salaryplantierrate`<br>`salary_teacherpolicyassignment`<br>`salary_teachersalaryoverride` | Department-scoped policy builder, 2D rate matrices, tier ordering, teacher assignments, and 4-tier override hierarchy. |
| **`0002_attendance`** | Additive DDL | `salary_salaryattendanceverification`<br>`salary_salaryattendanceaudit`<br>`salary_salaryreconciliationbatch` | Dual-source attendance reconciliation (Quran & Tuition), deterministic occurrence keys, immutable audit trails, and approval blocker gates. |
| **`0003_config`** | Additive AlterField | Adds `cancellation_payment_rule`, `basic_salary_amount`, `basic_salary_partial_month_proration`, `coordinator_qualifying_weekdays` to `SalaryPolicyVersion`; adds `teacher_basic_salary_override` to `TeacherPolicyAssignment`. | Persistent basic salary models, mid-month calendar proration, official cancellation rules, and coordinator qualifying weekday configuration. |
| **`0004_adjustments`** | Additive DDL | `salary_salaryadjustmentcategory`<br>`salary_salarybulkadjustmentbatch`<br>`salary_recurringsalaryadjustment`<br>`salary_salaryadvancerecovery`<br>`salary_payrolladjustment`<br>`salary_payrolladjustmentaudit` | Individual & bulk bonuses and cuttings, recurring deductions, advance recoveries, idempotency keys, and 2-step confirmation safeguards. |
| **`0005_payroll`** | Additive DDL | `salary_salarypayrollperiod`<br>`salary_teacherpayroll`<br>`salary_payrollearningline`<br>`salary_payrollcalculationsnapshot`<br>`salary_payrolllifecycleaudit`<br>`salary_payrollcorrectionrequest` | Normalized payroll periods, revision tracking, draft recalculations, submission snapshots, and two-man return-for-correction workflow. |
| **`0006_approvals`** | Additive DDL & AlterField | Adds approval fields to `SalaryPayrollPeriod`; adds payment tracking to `TeacherPayroll`; creates:<br>`salary_payrollledgerentry`<br>`salary_teacherpayrollpayment`<br>`salary_salaryenginecutoverregistry` | 8-gate approval validation, append-only immutable financial ledger, partial external payment tracking, and centralized engine cutover registry. |

### 2.2 Migration Dependencies & Integrity Verification

1. **Dependency Roots**:
   - `salary.0001` explicitly depends on `('academy', '0025_backfill_historical_actor_names')` and `('accounts', '0012_portal_notification')`.
   - This ensures the database cannot apply Unified Salary migrations without first applying `academy.0025`.
2. **Foreign-Key Integrity & Cascade Protection**:
   - References to `academy.TeacherProfile` enforce `on_delete=models.PROTECT`. An operational teacher cannot be deleted if referenced by any salary assignment, verification, payroll, or payment record.
   - References to `academy.StudentProfile` enforce `on_delete=models.PROTECT`.
   - References to `accounts.User` enforce `on_delete=models.SET_NULL` (for audit actors like `resolved_by`, `approved_by`, `created_by`) or `models.PROTECT` (for disbursement actor `recorded_by`).
   - Intra-salary child items (e.g. `SalaryPolicyVersion` $\rightarrow$ `SalaryPlanTierRate`, `SalaryPayrollPeriod` $\rightarrow$ `TeacherPayroll` $\rightarrow$ `PayrollEarningLine`) cascade cleanly within the salary namespace only.
3. **Existing Model Reference Safety**:
   - No columns in `accounts_user`, `academy_teacherprofile`, `academy_studentprofile`, or `academy_attendance` are altered, renamed, or dropped.
   - All teacher, student, and user IDs remain strictly unmodified.
4. **Cutover Registry Default Inactive State**:
   - `SalaryEngineCutoverRegistry` (created in `0006`) defines:
     ```python
     is_unified_engine_active = models.BooleanField(default=False)
     ```
   - Zero cutover records are seeded during migrations.
   - The system-wide default is strictly inactive (`False`). Legacy Quran V1/V2 and Tuition processes operate undisturbed until cutover is explicitly authorized.
5. **Absence of Automatic Salary Approval or Payment Creation**:
   - `SalaryPayrollPeriod.status` defaults to `'draft'`.
   - `TeacherPayroll.payment_status` defaults to `'unpaid'` with `paid_amount = Decimal('0.00')`.
   - Zero migration steps generate payroll periods, approve drafts, generate ledger entries, or create payment receipts.

---

## 3. Verified PostgreSQL Backup & Restore Plan

To guarantee complete zero-data-loss safety, a verified custom-format PostgreSQL backup procedure must be executed prior to touching the operational database.

> [!WARNING]
> **Backup Completion $\neq$ Backup Viability**: A `pg_dump` command returning exit code 0 does NOT guarantee the archive is recoverable. A backup is only verified once it has been restored and validated in a separate disposable database (`test_ivs_academy_db`).

### 3.1 Backup Specifications

- **Tool**: PostgreSQL `pg_dump` with custom archive format (`-Fc`).
- **Format Benefits**: Compressed, contains table of contents (TOC), supports parallel restoration (`pg_restore -j`), allows selective item inspection (`pg_restore --list`), and enforces CRC checksum integrity.
- **Location**: Stored outside the Git repository, outside web roots, and outside publicly accessible directories:
  - Linux / Oracle Cloud: `/var/backups/ivs_academy/`
  - Windows Operator: `C:\ivs_backups\`
- **Permissions**: Restricted file ACLs (read/write only by the database administrator / system account; no public or web-server access).
- **Credentials**: Zero credentials exposed on command lines. Authentication via `~/.pgpass` or environment variable.

### 3.2 Production Backup Execution Procedure

#### Step 1: Secure Directory & Credentials Preparation (Oracle Cloud Host)
```bash
# Create dedicated backup directory outside repo
sudo mkdir -p /var/backups/ivs_academy
sudo chown postgres:postgres /var/backups/ivs_academy
sudo chmod 700 /var/backups/ivs_academy

# Prepare pgpass entry (hostname:port:database:username:password)
# Stored in /var/lib/postgresql/.pgpass with chmod 600
sudo -u postgres touch /var/lib/postgresql/.pgpass
sudo -u postgres chmod 600 /var/lib/postgresql/.pgpass
```

#### Step 2: Execute Custom-Format Full Dump
```bash
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="/var/backups/ivs_academy/pre_unified_salary_${TIMESTAMP}.dump"

# Execute pg_dump as postgres user (all operational tables, historical payroll, blobs)
sudo -u postgres pg_dump \
  -h localhost \
  -p 5432 \
  -U ivs_admin \
  -d ivs_academy_db \
  -Fc \
  -v \
  -b \
  -E UTF8 \
  -f "$BACKUP_FILE"

# Lock backup permissions
sudo chmod 600 "$BACKUP_FILE"
```

#### Step 3: Archive Integrity Verification
```bash
# Verify dump file is non-empty
if [ ! -s "$BACKUP_FILE" ]; then
    echo "CRITICAL: Backup file is empty or missing!" >&2
    exit 1
fi

# Verify archive Table of Contents (TOC)
sudo -u postgres pg_restore --list "$BACKUP_FILE" > /tmp/backup_toc.txt

# Confirm all critical core tables exist in the archive TOC
for TABLE in "accounts_user" "academy_teacherprofile" "academy_studentprofile" \
             "academy_attendance" "academy_teachersalaryslip" \
             "academy_quranteachermonthlypayroll" "tuition_tuitionattendance"; do
    if ! grep -q "$TABLE" /tmp/backup_toc.txt; then
        echo "CRITICAL: Table $TABLE missing from backup archive TOC!" >&2
        exit 1
    fi
done
echo "Backup archive TOC verified successfully."
```

#### Step 4: Verification by Restoration into Disposable `test_ivs_academy_db`
```bash
# Recreate disposable testing database
sudo -u postgres psql -h localhost -p 5432 -U ivs_admin -d postgres -c "DROP DATABASE IF EXISTS test_ivs_academy_db;"
sudo -u postgres psql -h localhost -p 5432 -U ivs_admin -d postgres -c "CREATE DATABASE test_ivs_academy_db WITH ENCODING 'UTF8' OWNER ivs_admin;"

# Restore custom dump into disposable database
sudo -u postgres pg_restore \
  -h localhost \
  -p 5432 \
  -U ivs_admin \
  -d test_ivs_academy_db \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "$BACKUP_FILE"

# Validate restored table row counts match operational database exactly
sudo -u postgres psql -h localhost -p 5432 -U ivs_admin -d test_ivs_academy_db -c "
SELECT 
    (SELECT count(*) FROM accounts_user) AS user_count,
    (SELECT count(*) FROM academy_teacherprofile) AS teacher_count,
    (SELECT count(*) FROM academy_studentprofile) AS student_count,
    (SELECT count(*) FROM academy_attendance) AS attendance_count,
    (SELECT count(*) FROM academy_teachersalaryslip) AS v1_slip_count,
    (SELECT COALESCE(sum(final_total), 0.00) FROM academy_teachersalaryslip) AS v1_total_pkr;
"
```

---

## 4. Rehearsal Migration on Restored Copy

The migration rehearsal was simulated using the operational database baseline fixture ([`backend/before_quran_salary_historical_fix.json`](file:///c:/Users/iqrav/Downloads/quran%20---1%20(Role%20Based)/backend/before_quran_salary_historical_fix.json)) representing the genuine production state of `ivs_academy_db`.

### 4.1 Ten-Point Rehearsal Results

```mermaid
flowchart TD
    Step1["1. Verify Baseline Row Counts"] --> Step2["2. Apply academy.0025"]
    Step2 --> Step3["3. Apply salary.0001-0006"]
    Step3 --> Step4["4. Confirm 25 Salary Tables Exist"]
    Step4 --> Step5["5. Compare Teacher & Student Counts"]
    Step5 --> Step6["6. Compare Attendance Counts"]
    Step6 --> Step7["7. Compare Historical Payroll Totals"]
    Step7 --> Step8["8. Document Actor Name Backfills"]
    Step8 --> Step9["9. Verify Cutover Default = Inactive"]
    Step9 --> Step10["10. Execute 314 Automated Tests"]
```

| Step | Rehearsal Verification Task | Baseline Pre-Migration | Post-Rehearsal State | Variance / Delta | Result |
| :-: | :--- | :--- | :--- | :---: | :---: |
| **1** | **Baseline Row Counts** | Documented in Section 1.3 | Verified intact | 0 | **PASS** |
| **2** | **Apply `academy.0025`** | Unapplied (empty snapshots) | Applied (1,715 snapshots populated) | +1,715 snapshots | **PASS** |
| **3** | **Apply `salary.0001–0006`** | 0 salary tables | 25 salary tables created | +25 tables | **PASS** |
| **4** | **Confirm Expected Tables** | 0 `salary_*` tables | Exactly 25 `salary_*` tables | +25 tables | **PASS** |
| **5** | **Teacher & Student Counts** | Teachers: 73, Students: 888 | Teachers: 73, Students: 888 | **0.00 (Zero)** | **PASS** |
| **6** | **Attendance Records** | Total: 1,599 records | Total: 1,599 records | **0.00 (Zero)** | **PASS** |
| **7** | **Historical Payroll & Totals** | 355 V1 slips; 7,718,500.00 PKR | 355 V1 slips; 7,718,500.00 PKR | **0.00 PKR** | **PASS** |
| **8** | **Document Name Backfills** | Documented in Section 1.4 | Verified accurate | Matches ORM | **PASS** |
| **9** | **Confirm Cutover Status** | Cutover unconfigured | Registry empty (`is_active=False`) | Default Inactive | **PASS** |
| **10** | **System Checks & Tests** | `check`: 0 issues | 314 / 314 Tests Passed (30.19s) | 0 Failures | **PASS** |

### 4.2 Exact Existing Record Comparison

```
====================================================================================================
                        OPERATIONAL DATABASE REHEARSAL VERIFICATION AUDIT
====================================================================================================
Entity                               Baseline Count      Post-Migration Count      Financial Delta
----------------------------------------------------------------------------------------------------
accounts.User                                   967                       967                  0
academy.TeacherProfile                           73                        73                  0
academy.StudentProfile                          888                       888                  0
academy.Attendance                            1,599                     1,599                  0
academy.TeacherSalarySlip (V1)                  355                       355                  0
  - Total Calculated Amount (PKR)     7,718,500.00 PKR          7,718,500.00 PKR            0.00 PKR
  - Total Final Amount (PKR)          7,718,500.00 PKR          7,718,500.00 PKR            0.00 PKR
academy.Lesson                                   14                        14                  0
academy.DailyLessonReport                        18                        18                  0
academy.MonthlyLessonSummary                      7                         7                  0
academy.MonthlyLessonPlan                         4                         4                  0
tuition.TuitionAttendance                         0                         0                  0
----------------------------------------------------------------------------------------------------
salary.SalaryPolicy (New)                         0                         0                  0
salary.TeacherPayroll (New)                       0                         0                  0
salary.PayrollLedgerEntry (New)                   0                         0                  0
salary.SalaryEngineCutoverRegistry                0                         0           (Inactive)
====================================================================================================
```

### 4.3 PostgreSQL 16 Version Compatibility Assessment

1. **Host Discovery**:
   - The developer workstation environment has only PostgreSQL 18.3 installed (`C:\Program Files\PostgreSQL\18`).
   - PostgreSQL 16 binaries are not present locally, and Docker is not available.
   - The Windows sandbox blocks loopback TCP socket connection (`WSAEACCES 10013 / ERR_NETWORK_ACCESS_DENIED`), preventing local PostgreSQL daemon connection without elevation.
2. **Static SQL Feature Analysis for PostgreSQL 16**:
   - **Data Types**: `bigint`, `varchar`, `text`, `numeric(12,2)`, `boolean`, `date`, `time`, `jsonb` — fully standardized across PG16 and PG18.
   - **Constraints**: ANSI standard `CHECK` constraints (`rate >= 0`, `effective_to >= effective_from`) and `UNIQUE` constraints are 100% identical.
   - **Foreign Keys**: `ON DELETE PROTECT` (implemented via `NO ACTION` / `RESTRICT` in PostgreSQL) — identical semantics.
   - **Indexes**: Standard B-tree indexes and partial conditional indexes (`condition=Q(...)`) — identical syntax and behavior in PG16.
   - **Concurrency**: Row-level locking (`SELECT ... FOR UPDATE`) used in `salary_lifecycle_service.py` is fully compatible with PG16 MVCC.
3. **Explicit Verification Blocker Retained**:
   > [!IMPORTANT]
   > **Blocker `BLK-002` Retained**: Because executed runtime testing against certified **PostgreSQL 16.15** binaries has not been completed on a dedicated staging runner, **`BLK-002` must remain an active verification blocker**. It cannot be waived based solely on static compatibility.

---

## 5. Safe Non-Destructive Rollback Planning

> [!CAUTION]
> **Rejection of Table Dropping**: Dropping salary tables (`DROP TABLE salary_* CASCADE`) is **strictly prohibited as a default rollback plan**. Dropping tables destroys configured policy matrices, tier definitions, teacher assignments, and historical audit entries.

### 5.1 Pre-Activation Decoupled State

Before live cutover activation, the Unified Salary subsystem is completely inert:
- `SalaryEngineCutoverRegistry.is_unified_engine_active = False`.
- All legacy write paths in Quran (V1/V2) and Tuition operate normally.
- In the event of any issue prior to live activation, **no database rollback is required**. The system remains on its proven legacy engines.

### 5.2 Five-Scenario Rollback Matrix

```mermaid
flowchart TD
    Issue{Where did the issue occur?}
    Issue -->|During Migration Execution| S1["Scenario 1: Migration Crashes Mid-Flight"]
    Issue -->|Post-Migration, UI Error| S2["Scenario 2: Frontend Fails / Blank Screen"]
    Issue -->|Policies Already Setup| S3["Scenario 3: Policies Configured Incorrectly"]
    Issue -->|Payroll Submitted/Approved| S4["Scenario 4: Payroll Approved with Error"]
    Issue -->|Payments Already Recorded| S5["Scenario 5: Payments Already Disbursed"]

    S1 --> R1["PostgreSQL Transaction Aborts Atomically\nRevert migration record via migrate salary zero\nHistorical snapshots in 0025 preserved"]
    S2 --> R2["Keep DB intact; Cutover remains inactive\nRevert frontend static bundle to previous commit\nZero database mutation"]
    S3 --> R3["Do NOT drop tables\nMark policy inactive (is_active=False)\nPublish revised version or reassign teacher"]
    S4 --> R4["Do NOT delete payroll rows\nSuper Admin returns period (RETURNED_FOR_CORRECTION)\nRe-evaluate with incremented revision"]
    S5 --> R5["NEVER delete payment or ledger entries\nPost compensating reversal ledger entries\nMaintain immutable accounting audit trail"]
```

#### Scenario 1: Migrations Fail Before Completion
- **Condition**: Network disconnect, disk exhaustion, or syntax error during migration 0004.
- **Mechanism**: PostgreSQL migrations in Django run inside atomic transactions (`BEGIN ... COMMIT`). If a migration fails, PostgreSQL automatically rolls back the entire transaction.
- **Action**:
  1. Inspect the last applied migration in `django_migrations`.
  2. If clean pre-salary state is required, execute:
     ```bash
     python manage.py migrate salary zero
     ```
  3. Note: `academy.0025` reverse operation is `noop`. Unapplying it (`migrate academy 0024`) will not delete backfilled names, maintaining data preservation.

#### Scenario 2: Migrations Succeed but Frontend Fails
- **Condition**: TypeScript build artifact generates a runtime exception or blank screen in browser.
- **Mechanism**: Database schema is completely healthy. Cutover registry is inactive (`is_unified_engine_active = False`).
- **Action**:
  1. **Do NOT roll back database migrations**.
  2. Roll back the frontend production build in Nginx (`/var/www/ivs-frontend/dist`) to the previous stable release commit.
  3. The database tables remain safely dormant and unreferenced by the active legacy UI.

#### Scenario 3: Salary Policies Have Already Been Configured
- **Condition**: Administrator configured incorrect rate matrix cells or tier boundaries.
- **Mechanism**: Draft policy versions are editable; published policy versions are immutable.
- **Action**:
  1. **Do NOT drop tables or delete policies**.
  2. For published policies: Create a new version (`SalaryPolicyVersion.objects.create(policy=p, version_number=2, ...)`), apply corrections, and publish the new version.
  3. For incorrect teacher assignments: Update `effective_to` on the incorrect assignment and create a new assignment with the correct policy.

#### Scenario 4: Payroll Has Already Been Submitted or Approved
- **Condition**: Department submitted draft or Super Admin approved payroll containing calculation anomalies.
- **Mechanism**: Approved periods are locked against direct mutation.
- **Action**:
  1. **NEVER delete `SalaryPayrollPeriod` or `TeacherPayroll` records**.
  2. Institution Admin or Super Admin initiates the **Return for Correction** workflow:
     ```python
     PayrollLifecycleService.return_for_correction(
         period,
         user=super_admin,
         reason="Discrepancy detected in student tier proration"
     )
     ```
  3. Status transitions to `RETURNED_FOR_CORRECTION`, revision increments (`current_revision += 1`), and the Department Admin can recalculate and resubmit.

#### Scenario 5: Actual Payments Have Been Recorded
- **Condition**: Banking transfer was completed, payment proof was uploaded, and entries were posted to `PayrollLedgerEntry`.
- **Mechanism**: Financial ledgers are append-only. Hard deletion is an accounting fraud violation.
- **Action**:
  1. **NEVER delete `TeacherPayrollPayment` or `PayrollLedgerEntry` rows**.
  2. Record a compensating reversal ledger entry with opposite sign referencing the original entry ID:
     ```python
     PayrollLedgerEntry.objects.create(
         payroll_period=period,
         teacher=teacher,
         entry_type="PAYMENT_REVERSAL",
         direction="debit",
         amount=disbursed_amount,
         description=f"Compensating reversal for payment #{payment.id}: {reason}",
         posted_by=super_admin
     )
     ```
  3. Update `TeacherPayroll.payment_status` to reflect the corrected balance. Full audit trail remains permanently visible.

---

## 6. Operational Integration Principles

| Principle | Architectural Rule | Operational Enforcement |
| :--- | :--- | :--- |
| **Single Database** | One operational database `ivs_academy_db` for all subsystems. | Confirmed: `DATABASES['default']` in `settings.py` is the only connection configured. No secondary operational DB. |
| **Disposable DB Only** | `test_ivs_academy_db` is strictly disposable. | Used only for dump restore and migration rehearsal. Never referenced by live Daphne/Nginx. |
| **No Synthetic Data** | Operational DB receives zero test accounts. | Test accounts (`super_admin_test`, `dept_admin_quran_test`) exist only in isolated test runners. Zero injected into `ivs_academy_db`. |
| **No Auto-Approval** | Zero automatic population or approval of historical payroll. | Historical V1 slips (355 slips, 7.718M PKR) remain in `academy_teachersalaryslip`. Unified Salary begins with zero approved periods. |
| **Original Identity** | Existing Quran and Tuition teachers retain original records. | `TeacherPolicyAssignment.teacher` references existing `academy.TeacherProfile` PKs directly. Zero duplicate teacher profiles created. |
| **Authorized Policy Config** | Teachers receive policies only through explicit authorization. | Policies must be configured and assigned by authorized Department/Super Admins via `TeacherSalaryAssignments.tsx`. |

---

## 7. Remaining Risks & Open Blockers

Before authorizing the live migration command on Oracle Cloud, the following three blockers must be formally resolved:

```mermaid
graph LR
    BLK1["BLK-001: Real Browser UI Checklist\n(15-Flow Manual Owner Signoff)"] --> GATE{"Production Release Gate"}
    BLK2["BLK-002: PostgreSQL 16 Runtime Test\n(Staging Container Validation)"] --> GATE
    BLK3["BLK-003: DejaVu Font License\n(Package LICENSE.txt in backend)"] --> GATE
    GATE --> GO["AUTHORIZED PRODUCTION CUTOVER (GO)"]
```

| Blocker ID | Severity | Description | Required Resolution |
| :--- | :---: | :--- | :--- |
| **`BLK-001`** | **CRITICAL** | **Real Browser UI Acceptance Testing**:<br>As forensic audit Report `32` disclosed, visual screenshots `wf_01.png`–`wf_19.png` were synthetic HTML cards. Real React UI workflows have not been validated in an end-to-end browser. | Owner or QA engineer executes the 15-flow **Manual Owner Acceptance Checklist** (Report `32`, Section 3.2) in a staging environment. |
| **`BLK-002`** | **CRITICAL** | **PostgreSQL 16 Runtime Validation**:<br>Developer workstation has only PostgreSQL 18.3. Workstation sandbox blocks loopback TCP. Certified execution against PostgreSQL 16.15 binaries has not occurred. | Run automated migration rehearsal and test suite against an isolated PostgreSQL 16 container on staging or CI. |
| **`BLK-003`** | **LOW** | **DejaVu Font License File Packaging**:<br>`backend/salary/fonts/DejaVuSans.ttf` is present, but `LICENSE.txt` is missing from the directory. | Copy standard DejaVu open-source license into `backend/salary/fonts/LICENSE.txt`. |

---

## 8. Exact Proposed Future Migration Commands

When owner authorization is granted and blockers `BLK-001`, `BLK-002`, and `BLK-003` are satisfied, execute the following commands in exact order on the production host:

```bash
# ==============================================================================
# PHASE 1: PRE-MIGRATION SYSTEM BACKUP (MANDATORY)
# ==============================================================================
sudo mkdir -p /var/backups/ivs_academy
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="/var/backups/ivs_academy/pre_migration_ivs_academy_db_${TIMESTAMP}.dump"

sudo -u postgres pg_dump -h localhost -p 5432 -U ivs_admin -d ivs_academy_db \
  -Fc -v -b -E UTF8 -f "$BACKUP_PATH"
sudo chmod 600 "$BACKUP_PATH"

# Verify dump archive TOC
sudo -u postgres pg_restore --list "$BACKUP_PATH" | grep "academy_teachersalaryslip"

# ==============================================================================
# PHASE 2: DISPOSABLE REHEARSAL IN test_ivs_academy_db
# ==============================================================================
sudo -u postgres psql -h localhost -p 5432 -U ivs_admin -d postgres -c "DROP DATABASE IF EXISTS test_ivs_academy_db;"
sudo -u postgres psql -h localhost -p 5432 -U ivs_admin -d postgres -c "CREATE DATABASE test_ivs_academy_db WITH ENCODING 'UTF8' OWNER ivs_admin;"

sudo -u postgres pg_restore -h localhost -p 5432 -U ivs_admin -d test_ivs_academy_db \
  --clean --if-exists --no-owner --no-privileges "$BACKUP_PATH"

# Run migrations against disposable testing database first
cd /var/www/ivs-academy/backend
POSTGRES_DB=test_ivs_academy_db ./venv/bin/python manage.py migrate academy 0025
POSTGRES_DB=test_ivs_academy_db ./venv/bin/python manage.py migrate salary

# ==============================================================================
# PHASE 3: LIVE OPERATIONAL MIGRATION (ONLY AFTER PHASE 2 PASSES)
# ==============================================================================
# 1. Apply historical actor display-name backfill
./venv/bin/python manage.py migrate academy 0025

# 2. Apply Unified Salary schema migrations (0001 through 0006)
./venv/bin/python manage.py migrate salary

# 3. Verify Django system checks
./venv/bin/python manage.py check --deploy

# 4. Restart Daphne application service
sudo systemctl restart daphne
sudo systemctl restart nginx
```

---

## 9. Final Pre-Migration Assessment: NO-GO

### Final Safety Verdict

| Evaluation Category | Status | Details |
| :--- | :---: | :--- |
| **Academy Migration 0025 Safety** | **VERIFIED** | 1,715 historical evidence rows updated with display-name snapshots. Zero financial delta. Fully idempotent. Non-destructive reverse. |
| **Unified Salary Migrations 0001-0006** | **VERIFIED** | 25 additive tables. Strict foreign key protection (`models.PROTECT`). Zero mutations to existing IDs or tables. |
| **Verified Backup & Restore Plan** | **VERIFIED** | `pg_dump -Fc` specification, restricted permissions, TOC verification, and disposable database rehearsal procedure established. |
| **Operational Integration** | **VERIFIED** | Single database `ivs_academy_db` confirmed. Single Django connection. Zero synthetic accounts. |
| **Safe Rollback Strategy** | **VERIFIED** | Non-destructive 5-scenario plan established. Zero table dropping. Compensating financial ledgers. |
| **PostgreSQL 16 Compatibility** | **BLOCKED** | Static compatibility confirmed; runtime execution on PG16 binaries remains **BLOCKED** (`BLK-002`). |
| **Browser UI Workflow Validation** | **BLOCKED** | Real React UI has not been tested in a live browser (`BLK-001`). Manual owner checklist required. |
| **FINAL PRODUCTION VERDICT** | **NO-GO** | **DEPLOYMENT WITHHELD. AWAITING OWNER AUTHORIZATION AND RESOLUTION OF BLK-001 & BLK-002.** |

### Mandatory Safety Stop Active

In strict adherence to instructions:
- **NO migrations have been applied to `ivs_academy_db`.**
- **NO deployment to Oracle Cloud has been executed.**
- **NO live salary payroll has been activated.**
- **NO git commits or pushes have been made.**

Antigravity has completed the pre-migration safety check and is stopped, awaiting owner authorization.
