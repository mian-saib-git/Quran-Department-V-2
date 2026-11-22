# IVS Academy — Phase 2C1 Results: Daily Lesson Reports API & Consumer Optimization

**Date:** 2026-11-17  
**Scope:** Server-side pagination and historical search/filtering on `GET /api/academy/daily-lesson-reports/` and incremental loading in `CoordinatorLessons.tsx` and `TeacherPortal.tsx`.  
**Database Schema / Migrations / Salary & Tuition Logic / UI Design:** Unchanged.

---

## 1. Phase 2B Smoke-Test Findings

- **Local API Smoke Check (`APIClient` against local PostgreSQL):**
  - Coordinator (`ahmadali`): `/api/auth/context/` (`200`), `/api/academy/dashboard/` (`200`), `/api/auth/notifications/` (`200`).
  - Teacher (`ivs_mehboob`): `/api/auth/context/` (`200`), `/api/academy/dashboard/` (`200`), `/api/academy/lesson-permissions/?is_active=true` (`200`), `/api/academy/lesson-access-requests/?status=pending` (`200`), `/api/academy/lessons/` (`200`), `/api/academy/daily-lesson-reports/` (`200`).
  - Student (`ivq1010`): `/api/auth/context/` (`200`), `/api/academy/dashboard/` (`200`), `/api/academy/attendance/?scope=dashboard&page=1&page_size=500` (`200`).
- **Frontend Regression & Build Verification:** `tsc --noEmit`, `vite build`, and `14/14` Node tests (`tests/attendance_editor_incremental_update.test.ts`, `tests/phase2b_polling_and_ws.test.ts`) passed.
- **Browser Runtime Limitation:** Interactive browser tooling (live WebSocket connection counts in DevTools, interactive click-through of tabs, background tab visibility in a live browser) is **not available** in this CLI environment and is therefore not claimed as browser-verified.

---

## 2. Root Cause of the Large Daily Lesson Reports Response

1. **`DailyLessonReportListCreateView.get` (`backend/academy/views.py`):** Returned **all** `DailyLessonReport` rows for the department/teacher/student with nested `subject_entries` in a single unpaginated JSON array. For Coordinator (`3,192` reports), Python serialization + JSON encoding accounted for **`~1,451 ms`** of the `1,638.4 ms` total response time and produced **`2,634.2 KB` (2.63 MB)**.
2. **Consumers (`CoordinatorLessons.tsx`, `TeacherPortal.tsx`):** Both components called `getDailyLessonReports()` with no pagination and relied solely on client-side filtering/searching.

---

## 3. Files Modified / Added

1. `backend/academy/views.py` (`DailyLessonReportListCreateView.get`)
   - Added deterministic server-side pagination (`page` default `1`, `page_size` default `50`, max `200`, validated positive integers returning `400` on invalid input).
   - Sliced the ordered queryset (`-date`, `-updated_at`, `-id`) in SQL **before** `.prefetch_related("subject_entries")` so only the `<= 50` rows on the current page are prefetched and serialized.
   - Added backend filtering across all historical records: `search` (student/teacher name & username, notes, subject, topic_summary, remarks), `date`, `date_from`, `date_to`, `subject`, `progress_status`, alongside existing `student_id`, `teacher_id`, `month`, `year`.
2. `services/djangoApiService.ts`
   - Updated `getDailyLessonReports(params?, options?)` to pass pagination/filter params and optional `AbortSignal`, returning `DailyLessonReportPageResponse` (`count`, `page`, `page_size`, `total_pages`, `next`, `previous`, `results`).
3. `components/CoordinatorLessons.tsx`
   - Initial load requests `page: 1, page_size: 50`.
   - Filter/search changes (`search` debounced `250 ms`, dropdowns/dates immediate) query the backend with `AbortController` + epoch guard so searches cover **all** historical reports without stale overwrites.
   - Expanding a student (`selectedStudentId`) fetches up to `200` reports for that `student_id` when older pages exist.
   - Added `"Load older reports (X of Y loaded)"` button to append subsequent pages cleanly.
4. `components/TeacherPortal.tsx`
   - Initial load requests `page: 1, page_size: 50`.
   - Changing `historyStudentFilter` queries the backend with `student_id`.
   - Selecting `(studentId, lessonDate)` on the lesson form checks the backend if the date is not in the loaded page.
   - Added `"Load older reports (X of Y loaded)"` button in the History tab.
5. `backend/academy/tests/test_daily_lesson_reports_pagination.py` *(added)*
   - 4 Django tests covering pagination completeness/ordering, backend search/filtering, invalid parameters/empty sets, department isolation, and new report visibility at top of page 1.
6. `tests/phase2c1_daily_lesson_reports.test.ts` *(added)*
   - 3 frontend regression tests verifying pagination, `AbortController`/epoch guards, backend search/filter wiring, and `"Load older reports"` support.

---

## 4. API Contract Changes & Backward Compatibility

- **Before:** `{ "count": <int>, "results": [...] }` (all rows).
- **After:** `{ "count": <int>, "page": <int>, "page_size": <int>, "total_pages": <int>, "next": <int|null>, "previous": <int|null>, "results": [...] }` (default `page=1, page_size=50`, max `200`).
- **Consumer Coverage:** Repository-wide `git grep` confirmed `CoordinatorLessons.tsx` and `TeacherPortal.tsx` (via `djangoApiService.ts`) are the **only** callers of `/api/academy/daily-lesson-reports/`; both were updated together.

---

## 5. Before-and-After Measurements (Local PostgreSQL, `APIClient`)

| Role (User) | Records Returned (Before -> After) | Total Available (`count`) | Payload Size (Before -> After) | Response Time (Before -> After) | SQL Queries (Time) |
|---|---|---:|---:|---:|---|
| Coordinator (`ahmadali`) | `3,192 -> 50` | `3,192` | `2,634.2 KB -> 39.7 KB` (**-98.5%**) | `1,638.4 ms -> 493.0 ms` (page 1) / **`56.5 ms`** (page 2, **-96.5%**) | `5` (`63.0 ms` p1 / `16.0 ms` p2) |
| Coordinator (`search=ivq`) | N/A -> `50` | `3,159` | `39.7 KB` | `728.4 ms` | `5` (`703.0 ms`, full-history `ILIKE`) |
| Teacher (`ivs_safiullah`) | `335 -> 50` | `335` | `283.3 KB -> 41.2 KB` (**-85.5%**) | `178.2 ms -> 68.7 ms` (**-61.4%**) | `8` (`31.0 ms`) |
| Student (`ivq1036`) | `19 -> 19` | `19` | `14.5 KB -> 14.6 KB` | `41.1 ms -> 36.7 ms` | `8` (`15.0 ms`) |

---

## 6. Permission, Department Isolation & Historical Completeness Verification

- Department scoping (`department=department`) and role scoping (`is_department_manager`, `teacher=teacher`, `student=student`) remain unchanged and are applied before `count()` and slicing.
- Verified in `test_daily_lesson_reports_pagination`:
  - Iterating `page=1..3` (`page_size=2`) returns all `5` Department A reports with `0` duplicates, `0` missing rows, and `0` Department B leaks.
  - Searching `Topic 0` finds the oldest report even when `page_size=2` would otherwise exclude it from page 1.
  - Newly created reports appear at `results[0]` on page 1.

---

## 7. Automated Test Results

- `backend\venv\Scripts\python.exe backend\manage.py check`: **Passed** (`0` issues).
- `backend\venv\Scripts\python.exe backend\manage.py test academy.tests.test_daily_lesson_reports_pagination --keepdb`: **Passed** (`Ran 4 tests in 26.073s - OK`).
- `npm run typecheck`: **Passed** (`0` errors).
- `node --experimental-strip-types --test tests/attendance_editor_incremental_update.test.ts tests/phase2b_polling_and_ws.test.ts tests/phase2c1_daily_lesson_reports.test.ts`: **Passed** (`17/17` tests in `801.0 ms`).
- `npm run build`: **Passed** (`1m 28s`).

---

## 8. Remaining Risks

- **Broad `search` `ILIKE` on large datasets:** `Coordinator search=ivq` took `703.0 ms` in SQL due to `icontains` across joined `subject_entries` and `User` name columns (acceptable for interactive debounced search, but could benefit from trigram/GIN indexes in a future DB phase if dataset grows 10x).
- **Filter dropdown options in `CoordinatorLessons.tsx`:** `monthOptions`, `teacherOptions`, and `studentOptions` are derived from loaded `allLessons`, so before loading older pages, those dropdowns reflect loaded pages + `lessons` (while `search` and date inputs filter all history on the server).

---

## 9. Rollback Instructions

To revert Phase 2C1:
```powershell
git checkout -- backend/academy/views.py services/djangoApiService.ts components/CoordinatorLessons.tsx components/TeacherPortal.tsx
Remove-Item backend/academy/tests/test_daily_lesson_reports_pagination.py, tests/phase2c1_daily_lesson_reports.test.ts
```
