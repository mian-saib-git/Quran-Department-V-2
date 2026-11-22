# PERFORMANCE_PHASE_5D_RESULTS.md

## Status: **BLOCKED** (Scheduling Save-Persistence Defect Confirmed in Task 1 Gate)

Per Phase 5D instructions:
> *"Do not begin Attendance optimization if the Scheduling verification identifies a serious functional defect."*
> *"If Scheduling persistence verification fails, create the report with a clear BLOCKED status and stop without changing Attendance."*

No Attendance, Scheduling, or backend code was modified in Phase 5D.

---

## 1. Scheduling Persistence Verification Outcome
**FAIL — Scheduling modal edits, additions, and deletions do not persist to Django.**

Executed the end-to-end Task 1 browser test against the Vite production build (`dist/`) + live Django (`127.0.0.1:5000`) using a disposable QA Quran Coordinator (`qa_5d_qcoord`) and a disposable QA Student (`qa_5d_sched_s`, `__QA_5D_SCHED__`, assigned to `ClassSchedule` at `03:30`):

| Step | Observed Result |
|---|---|
| Initial slot in `Scheduling` | `03:30` |
| Edit student `timeSlot` to `04:00` → click `Save Changes` | UI moved student to `04:00` (`slotImmediatelyAfterSave: "04:00"`) |
| HTTP mutation requests (`POST`/`PUT`/`PATCH`/`DELETE`) fired on save | **`[]` (0 requests)** |
| Full browser reload (`page.reload()`) | Reverted to **`03:30`** (`slotAfterReload: "03:30"`) |
| Independent browser context (fresh `localStorage`) | Showed **`03:30`** (`slotInIndependentContext: "03:30"`) |

Both temporary QA accounts (`qa_5d_qcoord`, `qa_5d_sched_s`) and the disposable `ClassSchedule` record were deleted cleanly afterward (`deleted = 4` objects).

---

## 2. Exact Root Cause & Backend Persistence Mechanism
1. **Frontend (`App.tsx` + `services/storageService.ts`)**:
   - `SchedulingTab.tsx` delegates cell clicks to `App.tsx` (`class-details` modal → `add-student`, `edit-student`, `removeStudentFromClass`, `deleteClass`).
   - `saveStudent` (`App.tsx:2444–2510`), `removeStudentFromClass` (`App.tsx:2512–2535`), and `deleteClass` (`App.tsx:2537–2560`) mutate React state (`setAppState`) only.
   - `App.tsx:1616–1626` debounces (`1,500 ms`) a call to `saveState(appState)` in `services/storageService.ts:255–268`.
   - `saveState()` writes to `localStorage` (`saveCache(normalized)`) and returns early without making any HTTP request:
     ```ts
     // Attendance is already saved directly through markAttendanceInDjango()
     // and deleteAttendanceInDjango(). Do not POST the full state here.
     return;
     ```
2. **Backend (`backend/academy/views.py`)**:
   - `AcademyStateView.post` (`backend/academy/views.py:4729`) exists and accepts `{ teachers, students, attendance }`, **and** `CoordinatorAccounts.tsx` persists individual student schedule edits via `updateCoordinatorAccount` (`/api/auth/accounts/<id>/`).
   - However, **neither** endpoint is called by `App.tsx`'s `SchedulingTab` modal handlers (`saveStudent`, `removeStudentFromClass`, `deleteClass`).
   - Moreover, `SchedulingTab`'s modal header/buttons present `"Save Changes"` / `"Add Student"` with no indication that edits are temporary/local-only.

---

## 3. Affected Data & User Workflows
- **Affected Workflows**:
  1. `Scheduling` → click cell → `Edit` student (changing `timeSlot`, `teacherId`, `name`, or `classDays`) → `Save Changes`
  2. `Scheduling` → click cell → `+` (`Add student`) → `Add Student`
  3. `Scheduling` → click cell → `Remove` student (`removeStudentFromClass`)
  4. `Scheduling` → click cell → `Delete Class` (`deleteClass`)
- **Impact**: Changes appear saved in the active tab and `localStorage` cache, but silently disappear on full page reload (`loadInitialState` overwrites state from `GET /api/academy/state/`) and never reach other users or sessions.

---

## 4. Expected Backend Persistence Contract
To fix this safely in a dedicated scheduling-persistence fix phase (without re-enabling monolithic `POST /api/academy/state/` full-state overwrites):
- **Editing an existing student's schedule** (`modalMode === "edit-student"` with a numeric/DB student ID): Persist via `updateCoordinatorAccount(userId, { teacher_id, time_slot, class_days, ... })` (`PATCH /api/auth/accounts/<id>/`) or a dedicated scheduling mutation endpoint, then refresh/reconcile state from the server response and surface any validation/permission errors before closing the modal.
- **Adding/removing/deleting schedules**: Either wire to the authoritative account/schedule API endpoints with explicit loading/error handling, or clearly restrict/redirect `SchedulingTab` edits to the authoritative `Accounts & Enrollment` flow if ad-hoc timetable creation without account credentials is not permitted.

---

## 5. Independent-Session Verification Result
- Verified in a separate Playwright browser context (`ctx2`, empty `localStorage`): student remained at `03:30` because Django's `ClassSchedule` (`id=9481`) was never mutated.

---

## 6. Attendance Performance Baseline & Optimization Status
- **Not Started (Stopped at Task 1 Gate)**: Per Phase 5D instructions, Attendance profiling and optimization were **not** executed because Task 1 identified a blocking Scheduling persistence defect.
- All Phase 2A–5C-V code, tests (`107/107`), and `dist/` build remain completely untouched.

---

## 7. Exact Source Changes
- **None** (no application or test files were modified in Phase 5D).
- Created `PERFORMANCE_PHASE_5D_RESULTS.md` documenting the `BLOCKED` gate outcome.

---

## 8. TypeScript, Build, and Test Status
- Baseline remains the verified post-Phase-5C-V state (`107/107` frontend tests passing, `npm run typecheck` passing, `npm run build` passing, `backend/manage.py check` passing). No source files were altered in Phase 5D.

---

## 9. Safe Phase-Specific Rollback
- No code rollback required (zero source changes made). Delete `PERFORMANCE_PHASE_5D_RESULTS.md` if desired.

---

## 10. Recommendation for Next Step
1. **Fix Scheduling Modal Persistence** (dedicated small fix phase): Wire `App.tsx` `saveStudent` (`edit-student` / `add-student`), `removeStudentFromClass`, and `deleteClass` to authoritative backend API mutations (e.g., `updateCoordinatorAccount` / schedule endpoints) with proper loading/error feedback, and re-run the Phase 5D Task 1 independent-context persistence gate.
2. **Resume Attendance Optimization** once Task 1 passes.
