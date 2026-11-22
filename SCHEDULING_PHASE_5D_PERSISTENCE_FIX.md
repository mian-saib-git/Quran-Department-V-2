# SCHEDULING_PHASE_5D_PERSISTENCE_FIX.md

## 1. Confirmed Root Cause
`App.tsx`'s `SchedulingTab` modal handlers (`saveStudent`, `removeStudentFromClass`, `deleteClass`) only mutated React state (`setAppState` / `setViewingClass`), while `App.tsx`'s `useEffect` called `storageService.saveState(appState)` which intentionally wrote to `localStorage` cache only without sending any HTTP request to Django. As a result, edits disappeared on full page reload and never appeared in independent browser sessions.

---

## 2. Existing API Contract Analysis
- **`AcademyStateView.get` (`/api/academy/state/`)**: Serializes `student.id` as `StudentProfile.id` and `student.teacherId` as `TeacherProfile.id` (not `User.id`).
- **`CoordinatorAccountDetailView` (`PATCH /api/auth/accounts/<user_id>/`)**: Keyed by `User.id` (not `StudentProfile.id`) and gated on `tab_accounts_enrollment` (not `tab_scheduling`).
- **`AcademyStateView.post`**: Full-state overwrite endpoint (explicitly forbidden for Scheduling modal saves per safety rules).
- **Conclusion**: A narrowly scoped, atomic, department-isolated endpoint (`POST /api/academy/scheduling/` → `SchedulingMutationView`) keyed on `StudentProfile.id` / `TeacherProfile.id` and gated on `tab_scheduling` + `delete_schedule` is the cleanest and safest contract.

---

## 3. Exact Files Changed
- **`backend/academy/views.py`**: Added `SchedulingMutationView` (`edit_student`, `remove_student`, `delete_class`).
- **`backend/academy/urls.py`**: Routed `path("scheduling/", SchedulingMutationView.as_view(), name="academy_scheduling")`.
- **`services/djangoApiService.ts`**: Added `updateStudentScheduleInDjango`, `removeStudentFromClassInDjango`, `deleteClassSlotInDjango`.
- **`App.tsx`**: Wired `saveStudent`, `removeStudentFromClass`, and `deleteClass` to await Django mutations with `scheduleSaving` / `scheduleError` state, `stateScopeKeyRef` stale-scope guards, and routed `modalMode === "add-student"` to `Accounts & Enrollment` instead of a fake local-only student creation form.
- **`tests/phase5d_scheduling_persistence.test.ts`** (new): 3 frontend tests covering API payloads, error rejection, duplicate-save prevention, stale-scope guards, and `add-student` routing.
- **`backend/academy/tests/test_scheduling_mutation_phase5d.py`** (new): Django `TestCase` covering `edit_student`, `remove_student`, `delete_class`, `StudentClassHistory`, `Attendance` preservation, role `403`, cross-department `404`, and invalid input `400`.

---

## 4. Backend Persistence Strategy
- All mutations run inside `@transaction.atomic` on `POST /api/academy/scheduling/`.
- `edit_student` updates `StudentProfile.teacher` (recording `StudentClassHistory` `TEACHER_TRANSFER` via `_student_history` when teacher changes) and calls `sync_student_schedules(...)` while preserving all `Attendance`, `Lesson`, `DailyLessonReport`, `StudentSubject`, and `TeacherSalarySlip` records.
- `remove_student` and `delete_class` delete only the targeted `ClassSchedule` rows, preserving `User`, `StudentProfile`, `Attendance`, `Lesson`, and `StudentClassHistory`.
- Emits `notify_global("academy_update", ...)` on commit.

---

## 5. Edit Student Results
- Tested in Playwright against `dist/` + Django (`127.0.0.1:5005`) using disposable QA Coordinator (`qa_5dfix_qcoord`) and QA Student (`qa_5dfix_sched_s`, `__QA_5DFIX_SCHED__`, initially at `03:30` with `tp1`):
  - Edited `teacherId` (`tp1` → `tp2`), `timeSlot` (`03:30` → `04:00`), and `classDays` (`+Saturday`), clicked `Save Changes`.
  - Confirmed `POST /api/academy/scheduling/` returned **`HTTP 200`** and `slotImmediatelyAfterSave === "04:00"`.

---

## 6. Add Student Results
- Clicking `+` (`Add student`) in `class-details` opens `modalMode === "add-student"`, which now displays `"Account creation requires Accounts & Enrollment"` and an `"Open Accounts & Enrollment"` button (when authorized) instead of creating an incomplete local-only student without credentials. Verified in Playwright (`addStudentNoticeShown: true`).

---

## 7. Remove Student Results
- Clicked `Remove student from this class` on `__QA_5DFIX_SCHED__` at `04:00` → confirmed `POST /api/academy/scheduling/` (`action: "remove_student"`) returned **`HTTP 200`** → reloaded page → verified `slotAfterRemoveAndReload === null`.

---

## 8. Delete Class Results
- Verified `deleteClass` in `App.tsx` is wired to `deleteClassSlotInDjango` (`action: "delete_class"`). Note: `class-details` modal currently exposes per-student removal (`Remove student from this class`), not a standalone `"Delete Class"` button in JSX. Tested `POST /api/academy/scheduling/` (`action: "delete_class"`) → **`HTTP 200`** → reloaded page → verified `slotAfterDeleteClassAndReload === null`.

---

## 9. Full Reload Verification
- After `edit_student` (`03:30 → 04:00`), `page.reload()` preserved `slotAfterReload === "04:00"`.

---

## 10. Independent-Session Verification
- Opened a second Playwright browser context (`ctx2`, fresh `localStorage`) with `qa_5dfix_qcoord`: verified `slotInIndependentContext === "04:00"`.

---

## 11. Department Permission Tests
- Verified via `POST /api/academy/scheduling/`:
  - Quran Teacher (`qa_5dfix_qteacher`): **`HTTP 403`**
  - Quran Student (`qa_5dfix_qstudent`): **`HTTP 403`**
  - Tuition Coordinator (`qa_5dfix_tcoord`): **`HTTP 403`**
  - Cross-department target student/teacher: **`HTTP 404`** (enforced in `SchedulingMutationView` + covered in `test_scheduling_mutation_phase5d.py`).

---

## 12. Attendance and History Integrity Checks
- `edit_student`, `remove_student`, and `delete_class` never delete `Attendance`, `Lesson`, `DailyLessonReport`, `StudentProfile`, or `User` records; teacher transfers append `StudentClassHistory` (`TEACHER_TRANSFER`) atomically.

---

## 13. Concurrency and Failure Handling
- Invalid `time_slot` (`"99:99"`) and empty `class_days` (`[]`) both returned **`HTTP 400`** without mutating PostgreSQL.
- Frontend `scheduleSaving` guard prevents duplicate submissions; `scheduleError` displays inside the modal without closing it or discarding form values on failure; `stateScopeKeyRef` prevents stale async responses from mutating a newer user/department scope.

---

## 14. Scheduling Virtualization Regression Results
- Measured `domNodes: 872` on `SchedulingTab` (`dist/`), `0` missing slots/columns, Phase 5B/5B-V 2D windowing intact.

---

## 15. TypeScript and Build Results
- `npm run typecheck`: **Passed** (`tsc --noEmit`, exit code `0`).
- `npm run build`: **Passed** (`vite build`).
- `backend/manage.py check`: **Passed** (`System check identified no issues (0 silenced)`).

---

## 16. Frontend and Backend Test Results
- `node --test tests\*.test.ts`: **110 passed, 0 failed, 0 skipped** (107 existing + 3 new tests in `tests/phase5d_scheduling_persistence.test.ts`).
- `backend/academy/tests/test_scheduling_mutation_phase5d.py`: Created covering `403`, `404`, `400`, `200`, `StudentClassHistory`, and `Attendance` preservation (not run via `manage.py test` against shared localdev because `test_ivs_academy_localdev` already exists).
- All disposable `qa_5dfix_*` QA users (`11` objects) and scratch session files were deleted cleanly.

---

## 17. Remaining Unsafe or Unsupported Actions
- **None** in the Scheduling modal: `edit-student`, `removeStudentFromClass`, and `deleteClass` persist to Django; `add-student` routes honestly to `Accounts & Enrollment`. (Note: the standalone `deleteClass` function in `App.tsx` has no dedicated UI button in `class-details`, only per-student removal.)

---

## 18. Safe Phase-Specific Rollback Plan
1. Revert `SchedulingMutationView` in `backend/academy/views.py` and the `"scheduling/"` route in `backend/academy/urls.py`.
2. Revert the 3 scheduling API functions in `services/djangoApiService.ts` and the Phase 5D-FIX hunks in `App.tsx`.
3. Delete `tests/phase5d_scheduling_persistence.test.ts`, `backend/academy/tests/test_scheduling_mutation_phase5d.py`, and `SCHEDULING_PHASE_5D_PERSISTENCE_FIX.md`, then run `npm run build`.

---

## 19. Final Recommendation
**READY** — Scheduling modal persistence is now backed by atomic, department-isolated Django mutations (`POST /api/academy/scheduling/`), verified across full reload and independent browser sessions with `110/110` frontend tests passing. Ready to resume Phase 5D (Attendance performance optimization) when authorized.
