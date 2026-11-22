# IVS Academy — Phase 2C2 Results: Salary Assignment API Loading Optimization

**Date:** 2026-11-17  
**Scope:** Lightweight list serialization and database column deferral on `GET /api/salary/assignments/` (`TeacherPolicyAssignmentViewSet`), optional pagination, and stale-response cancellation in `TeacherSalaryAssignments.tsx`.  
**Salary Calculations / Policy Matrices / Financial Records / Schema / Migrations / UI Design:** Unchanged.

---

## 1. Root Cause of the Large Assignment Response

1. **Unconditional `archived_policy_snapshot` in list serialization (`backend/salary/serializers.py`):** `TeacherPolicyAssignmentSerializer` serialized `archived_policy_snapshot` (the full JSON snapshot of the policy, versions, rate tiers, teaching plans, and rate matrix) on **every** row of `GET /api/salary/assignments/`.
2. **Database payload & frontend usage:** On the local PostgreSQL database (`department_id=1`, `78` assignments, all `78` with non-null `archived_policy_snapshot`):
   - Average row size was **`37,583.8` bytes** (median **`37,584.0`** bytes, max **`37,597`** bytes), of which **`36,930.0` bytes (`~98.3%`)** was `archived_policy_snapshot`.
   - Repository-wide `git grep` confirmed **no** frontend component reads `archived_policy_snapshot` from `/api/salary/assignments/` (`TeacherPolicyAssignment` in `services/salaryAssignmentService.ts` did not even declare it). Only `backend/salary/calculation_engine.py`, `backend/salary/resolver.py`, and ORM tests read `assignment.archived_policy_snapshot` directly from the model.

---

## 2. Exact Source Files Modified / Added

1. `backend/salary/serializers.py` *(modified)*
   - Added `TeacherPolicyAssignmentListSerializer(TeacherPolicyAssignmentSerializer)` preserving every list field (`id`, `department`, `department_name`, `teacher`, `teacher_name`, `policy`, `policy_code`, `policy_name`, `policy_snapshot_name`, `policy_snapshot_code`, `effective_from`, `effective_to`, `is_active`, `basic_salary_override`, `basic_salary_eligibility`, `notes`, `assigned_by`, `assigned_by_name`, `assigned_at`) while omitting `archived_policy_snapshot`.
2. `backend/salary/views.py` (`TeacherPolicyAssignmentViewSet`) *(modified)*
   - `get_serializer_class`: uses `TeacherPolicyAssignmentListSerializer` for `action == "list"` unless `?include_snapshot=true`/`1` is explicitly passed; uses full `TeacherPolicyAssignmentSerializer` for `retrieve`, `create`, `update`, `partial_update`, and `include_snapshot=true`.
   - `get_queryset`: defers `archived_policy_snapshot` (`qs.defer("archived_policy_snapshot")`) on `list` unless `include_snapshot=true` so PostgreSQL skips reading the 37 KB JSON column per row.
   - `list`: supports optional DB-level pagination (`?page=1&page_size=50`, max `200`, `400` on invalid input) while preserving the plain JSON array response when `page`/`page_size` are omitted.
3. `services/salaryAssignmentService.ts` *(modified)*
   - Added `AbortSignal` support to `fetchTeacherAssignments(...)` and added `fetchTeacherAssignmentDetail(assignmentId)` for on-demand full detail retrieval (including `archived_policy_snapshot`).
4. `components/unified-salary/TeacherSalaryAssignments.tsx` *(modified)*
   - Added `detailsAbortRef` and `detailsEpochRef` in `loadTeacherDetails` so rapid teacher switching aborts/ignores stale responses.
5. `backend/salary/tests/test_assignments_list_optimization.py` *(added)*
   - Verifies list omits `archived_policy_snapshot`, detail & `?include_snapshot=true` preserve it (including for archived policies), optional pagination works, invalid page params return `400`, and cross-department access returns `[]`.
6. `tests/phase2c2_salary_assignments.test.ts` *(added)*
   - Verifies `fetchTeacherAssignmentDetail`, `AbortSignal` support, and stale-response guards in `TeacherSalaryAssignments.tsx`.

---

## 3. New and Existing API Contracts

- **`GET /api/salary/assignments/?department_id=<id>` (default list):** Returns JSON array of lightweight assignment objects (all 19 summary/override/eligibility/snapshot-name fields; `archived_policy_snapshot` omitted).
- **`GET /api/salary/assignments/?department_id=<id>&include_snapshot=true`:** Returns JSON array with full `archived_policy_snapshot` (100% identical to prior contract).
- **`GET /api/salary/assignments/?department_id=<id>&page=1&page_size=20`:** Returns `{ count, page, page_size, total_pages, next, previous, results }`.
- **`GET /api/salary/assignments/<id>/` (detail):** Returns full `TeacherPolicyAssignmentSerializer` including `archived_policy_snapshot`.

---

## 4. Before-and-After Measurements (Local PostgreSQL, `department_id=1`, `78` Rows)

| Endpoint / Mode | Payload Size Before | Payload Size After | SQL Queries (Before -> After) | Cold Time (Before -> After) | Warm Time (Before -> After) |
|---|---:|---:|---:|---:|---:|
| `GET /api/salary/assignments/?department_id=1` (all 78 rows) | **2,672.7 KB** | **44.8 KB** (**-98.3%**) | `6` -> `6` | `604.7 ms -> 459.0 ms` (SQL `140 ms -> 78 ms`) | **`216.5 ms -> 40.2 ms`** (**-81.4%**) |
| `GET /api/salary/assignments/?department_id=1&page=1&page_size=20` | N/A | **11.6 KB** (`20` rows) | `7` | — | — |
| `GET /api/salary/assignments/1/` (detail) | — | **34.2 KB** (full snapshot) | `5` | — | **`20.3 ms`** |

---

## 5. Financial Correctness, Snapshot Preservation & Isolation Verification

- **Automated Field-by-Field Comparison:** Compared all `78` rows of `GET /api/salary/assignments/?department_id=1` against the pre-edit baseline JSON:
  - All `19` non-snapshot fields matched **100% identically (`True`)** across all `78` rows.
  - `GET /api/salary/assignments/1/` matched the pre-edit baseline row **100% identically (`True`)**, including `archived_policy_snapshot`.
- **Calculation & Payroll Integrity:** `backend/salary/calculation_engine.py`, `backend/salary/resolver.py`, `backend/salary/payroll_service.py`, and `TeacherPolicyAssignment.archived_policy_snapshot` database records were **not modified**.
- **Department Isolation:** Verified in `test_assignments_list_optimization`: `Department B` admin querying `department_id=dept_a` receives `[]`.

---

## 6. Automated Test Results

- `backend\venv\Scripts\python.exe backend\manage.py check`: **Passed** (`0` issues).
- `backend\venv\Scripts\python.exe backend\manage.py test salary.tests.test_assignments_list_optimization --keepdb`: **Passed** (`Ran 2 tests in 11.822s - OK`).
- `npm run typecheck`: **Passed** (`0` errors).
- `node --experimental-strip-types --test tests/phase2c2_salary_assignments.test.ts tests/teacher_salary_assignments_roster.test.ts tests/multi_department_salary.test.ts`: **Passed** (`17/17` tests in `626.7 ms`).
- `npm run build`: **Passed** (`1m 1s`).
- Existing salary suites (`test_assignments_and_overrides`, `test_policy_deletion_eligibility`, `test_salary_calculation`): **Passed** (`101/101` existing tests passed in `task-403`; the 2 errors in `task-403` were from the pre-fix version of `test_assignments_list_optimization`, which subsequently passed `2/2` in `task-430`).

---

## 7. Unresolved Issues / Limitations

- Interactive browser profiling of `TeacherSalaryAssignments.tsx` was not available in this CLI environment.
- `TeacherSalaryAssignments.tsx` still loads assignments per selected teacher (`teacher_id=<id>`), which is already scoped to one teacher at a time; pagination was added on the backend for any future bulk-table view.

---

## 8. Rollback Instructions

To revert Phase 2C2:
```powershell
git checkout -- backend/salary/serializers.py backend/salary/views.py services/salaryAssignmentService.ts components/unified-salary/TeacherSalaryAssignments.tsx
Remove-Item backend/salary/tests/test_assignments_list_optimization.py, tests/phase2c2_salary_assignments.test.ts
```
