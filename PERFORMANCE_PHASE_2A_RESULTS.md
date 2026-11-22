# IVS Academy — Phase 2A Results: `DashboardView` N+1 Query Optimization

**Date:** 2026-11-17  
**Scope:** Backend-only N+1 optimization in `DashboardView` (`backend/academy/views.py`), plus targeted regression tests (`backend/academy/tests/test_dashboard_n_plus_one.py`).  
**Schema / Migrations / Frontend:** Unchanged.

---

## 1. Root Cause of the N+1 Problem

In `backend/academy/views.py`:
1. **`schedule_payload(schedule)`** (previously lines `297–322`): Executed `StudentSubject.objects.filter(student=student, is_active=True)...` **inside the serialization loop for every `ClassSchedule` row**, ignoring `assigned_subjects_from_prefetch(student)`. Furthermore, `DashboardView.get` did not prefetch `student__assigned_subjects` on its `ClassSchedule` querysets (even though comments in `DashboardView` claimed it did).
2. **`student_payload(student)`** (previously lines `271–295`): Executed `ClassSchedule.objects.filter(student=student).order_by("id").first()` **for every `StudentProfile` row** solely to check whether the student had ever been scheduled (to determine `enrollment_date`), even when `schedules` were prefetched.
3. **Minor related queries in `DashboardView`:**
   - Teacher and Student branches executed both `attendance.count()` and `dict(attendance.order_by().values_list("status").annotate(total=Count("id")))` separately (`2` queries instead of deriving `attendance_total = sum(attendance_status_counts.values())`).
   - Student branch `schedules` queryset omitted `student__teacher__user` from `select_related()`.

---

## 2. Exact Source Files Changed

1. `backend/academy/views.py`
   - Imported `Exists, OuterRef` from `django.db.models` (line `19`).
   - Updated `student_payload(student)` to read `getattr(student, "has_any_schedule", None)` (annotated via `Exists(...)` in `DashboardView`), falling back to `ClassSchedule.objects.filter(student=student).exists()` only for callers without the annotation. This preserves exact behavior even when a student has only inactive schedules.
   - Updated `schedule_payload(schedule)` to call `assigned_subjects_from_prefetch(student)` instead of executing a per-schedule `StudentSubject.objects.filter(...)` query.
   - Parameterized `make_active_subjects_prefetch(lookup="assigned_subjects")` (default unchanged for backwards compatibility) so `ClassSchedule` querysets can pass `"student__assigned_subjects"`.
   - Updated `DashboardView.get` for:
     - **Coordinator / Department Admin:** Added `.prefetch_related(make_active_subjects_prefetch("student__assigned_subjects"))` to `ClassSchedule` queryset.
     - **Teacher:** Added `.annotate(has_any_schedule=Exists(ClassSchedule.objects.filter(student=OuterRef("pk"))))` to `students`, added `.prefetch_related(make_active_subjects_prefetch("student__assigned_subjects"))` to `schedules`, and derived `attendance_total = sum(attendance_status_counts.values())`.
     - **Student:** Added `.annotate(has_any_schedule=Exists(...))` to `student`, added `"student__teacher__user"` to `select_related` and `.prefetch_related(make_active_subjects_prefetch("student__assigned_subjects"))` to `schedules`, and derived `attendance_total = sum(attendance_status_counts.values())`.
2. `backend/academy/tests/test_dashboard_n_plus_one.py` *(new targeted regression test)*
   - Verifies `O(1)` query count scaling when increasing from `1` student/2 schedules to `10` students/19 schedules across Coordinator, Teacher, and Student dashboards.
   - Verifies department isolation, active-only subject filtering, and `enrollment_date` preservation for students with only inactive schedules.

---

## 3. Before-and-After Performance Measurements

Measured against the local PostgreSQL database (`1,265` Users, `129` Teachers, `1,157` Students, `5,438` ClassSchedules, `61,364` Attendance rows, `3,260` DailyLessonReports) using `APIClient` + `CaptureQueriesContext` and `MaintenanceAwareJWTAuthentication`:

| Role (User) | SQL Queries Before | SQL Queries After | Query Reduction | Total Time Before (ms) | Total Time After (ms) | SQL Time Before -> After (ms) | Payload Size (Before -> After) |
|---|---:|---:|---:|---:|---:|---:|---:|
| Coordinator (`ahmadali`) | **164** | **15** | **-90.9%** | 631.0 | 472.3 | 233.0 -> 94.0 | 90.1 KB -> 90.1 KB |
| Department Admin (`Admin`) | **166** | **17** | **-89.8%** | 375.6 | **139.1** | 155.0 -> 62.0 | 90.0 KB -> 90.0 KB |
| Teacher, busiest (`ivs_umair`) | **172** | **15** | **-91.3%** | 398.0 | **107.3** | 173.0 -> 47.0 | 82.1 KB -> 82.1 KB |
| Student (`ivq1025`) | **30** | **14** | **-53.3%** | 110.7 | **93.3** | 62.0 -> 47.0 | 26.6 KB -> 26.6 KB |

### Query Breakdown After Optimization
- **Coordinator (`15` queries):** `academy_classschedule` (2), `academy_attendance` (2), `academy_lesson` (2), `academy_studentsubject` (2), `academy_lessonaccesspermission` (2), `accounts_user` (1), `accounts_department` (1), `academy_teacherprofile` (1), `academy_studentprofile` (1), `academy_monthlylessonplan` (1). (`academy_studentsubject` dropped from **151** to **2**.)
- **Teacher (`15` queries):** `academy_classschedule` (3), `academy_attendance` (2), `academy_studentsubject` (2), `accounts_user` (1), `accounts_department` (1), `accounts_userdepartmentrole` (1), `accounts_platformmaintenancewindow` (1), `academy_teacherprofile` (1), `academy_lesson` (1), `academy_monthlylessonplan` (1), `academy_lessonaccesspermission` (1). (`academy_studentsubject` dropped from **128** to **2**; `academy_classschedule` dropped from **32** to **3**.)
- **Student (`14` queries):** Constant query count regardless of schedule count.

---

## 4. API Response Equivalence Results

Before editing `backend/academy/views.py`, baseline JSON responses were captured for all 4 roles (`coordinator`, `department_admin`, `teacher`, `student`). After the final edit, `before_data == after_data` was verified programmatically:
- Coordinator (`ahmadali`): **Exact JSON match (`True`)**
- Department Admin (`Admin`): **Exact JSON match (`True`)**
- Teacher (`ivs_umair`): **Exact JSON match (`True`)**
- Student (`ivq1025`): **Exact JSON match (`True`)**

---

## 5. Test Results

1. `backend\venv\Scripts\python.exe backend\manage.py check` -> **Passed** (`System check identified no issues (0 silenced).`)
2. `backend\venv\Scripts\python.exe backend\manage.py test academy.tests.test_dashboard_n_plus_one --keepdb` -> **Passed** (`Ran 1 test in 21.147s - OK`)
3. `backend\venv\Scripts\python.exe backend\manage.py test academy.tests.test_attendance_pagination_and_import --keepdb` -> **Passed** (`Ran 7 tests in 312.734s - OK`)

---

## 6. Security & Department Isolation Verification

- Every queryset in `DashboardView` retains its existing `department=department`, `teacher=teacher`, and `student=student` filters.
- `Prefetch("student__assigned_subjects", queryset=StudentSubject.objects.filter(is_active=True)...)` only fetches subjects for `student_id`s already scoped to the authorized `ClassSchedule` queryset.
- `Exists(ClassSchedule.objects.filter(student=OuterRef("pk")))` is evaluated per-student row on the already department-scoped `StudentProfile` queryset.
- No global or cross-department caching was introduced.
- Verified in `test_dashboard_n_plus_one`: Department B students, teachers, and schedules never appear in Department A responses or counts.

---

## 7. Remaining Risks & Bottlenecks

- **Authentication overhead (`MaintenanceAwareJWTAuthentication`):** 4 of the remaining 14–17 queries on `DashboardView` are per-request auth/maintenance queries (targeted for a later backend phase).
- **Coordinator `counts` & `attendance_status_counts`:** Coordinator `DashboardView` still executes 8 separate `.count()` queries and Teacher `attendance_status_counts` scans the teacher's `Attendance` rows (`~15–20 ms`).
- **Frontend Teacher Polling (Phase 2B/frontend):** Teacher Portal still polls `DashboardView` + 5 other endpoints every 12 seconds until the approved frontend phases are applied.

---

## 8. Rollback Instructions

To revert Phase 2A completely:
1. Restore `backend/academy/views.py`:
   ```powershell
   git checkout -- backend/academy/views.py
   ```
2. Remove the new test file if desired:
   ```powershell
   Remove-Item backend/academy/tests/test_dashboard_n_plus_one.py
   ```
