# IVS Academy: Phase 5F-FIX — Tuition Dashboard Layout and Lag Correction Results

## 1. Executive Summary

Phase 5F-FIX diagnosed and fixed the Tuition Student Dashboard desktop layout and clipping regressions while preserving the 3D Student ID Lanyard, Phase 5A–5F optimizations, animations, attendance, assignments, and scheduling workflows.

- **Layout Root Cause (Pre-existing CSS architecture, NOT caused by Phase 5F)**: `components/tuition/lanyard/Lanyard.css` applied `padding-right: 302px !important` to the entire `.student-portal-scroll.lanyard-stage-active` scroll container at `@media (min-width: 1024px)`. Even though the 3D Lanyard is only `270px x 400px` at the top-right (`top: 0; right: 16px`), the entire dashboard height lost `302px` of horizontal space, leaving an empty `302px` strip down the right side of the page and squeezing `My Subjects`, `Attendance`, `Up Next`, and `MetricCard`s.
- **Card Overlap & Clipping Root Cause**: Inside that squeezed `553px` width (`1173x1270`), `OverviewTab` placed `Live Now` and `Up Next` in `sm:grid-cols-2` (`269px` per card), and `ScheduleCard` nested `sm:grid-cols-[118px_minmax(0,1fr)]`, leaving only `107px` for subject, teacher, date, and countdown text. Similarly, at `1280x800`, `xl:grid-cols-4` squeezed the 4 `MetricCard`s inside the `302px`-reserved top section, truncating labels and details.
- **Performance Investigation**: Verified `apiCount: 6` (no duplicate `/api/tuition/` polling), `rafHidden: 0 FPS` (Phase 5F idle-frame optimization intact), and `rafVisible: 61 FPS`. The only desktop runtime CPU spike (`longTaskMaxMs: 140–151 ms` before, `128–136 ms` after) is the one-time Rapier3D WASM + WebGL initialization at `1,800 ms`. Capped desktop `dpr` at `1.5` (from `1.8`) and raised the idle `rot.y` sleep threshold from `0.002` to `0.015` in `Lanyard.tsx` to reduce desktop GPU fillrate and settle time.

---

## 2. Git Checkpoint & Baseline Preservation

- **Base `HEAD`**: `42c763df7abfae5c1bdbfd3dde15620ab861a152`
- **Non-destructive checkpoint created**: `c4bdca5c46a80f9f3d932ed70f6b36c451b5608f`
- All Phase 5A–5F optimizations (including Phase 5C-V CLS reservation and Phase 5F 3D idle-frame pause) remain intact.

---

## 3. Exact Code Changes

### 3.1 `components/tuition/lanyard/Lanyard.css`
- Scoped the full-container desktop `padding-right: 302px !important` rule to `.sp-page-scroll.lanyard-stage-active` (preserving Quran `StudentPortal`).
- For Tuition Student (`student-portal-scroll`), moved the `302px` desktop right reservation to `.student-portal-scroll.lanyard-stage-active .tuition-lanyard-top-reserve`, so only the top section beside the `400px`-tall Lanyard reserves `302px`, while all cards below (`My Subjects`, `Attendance`, etc.) expand to full width.

### 3.2 `components/tuition/TuitionStudentPortal.tsx`
- Applied `tuition-lanyard-top-reserve` to the top sections of `OverviewTab`, `AttendanceTab`, `AssignmentsTab`, and `ScheduleTab`.
- Updated `Live Now` / `Up Next` grid in `OverviewTab` from `sm:grid-cols-2` / `xl:grid-cols-2` to `2xl:grid-cols-2` so `SpotlightCard`s stack cleanly at `1024px–1440px` beside the Lanyard.
- Updated `OverviewTab` `MetricCard` grid from `xl:grid-cols-4` to `sm:grid-cols-2 2xl:grid-cols-4` and removed `truncate` on `MetricCard` `detail` text (`leading-snug` instead), eliminating `1280x800` and `1440x900` truncation.
- Updated `ScheduleCard` (`min-w-0`, `flex-wrap` for teacher/date metadata, `break-words` for subject/class titles) to prevent narrow-column overlap and clipping.
- Preserved `${studentCardVisible ? "lanyard-stage-active" : ""}` class binding so Hide/Show ID Card dynamically restores full width.

### 3.3 `components/tuition/lanyard/Lanyard.tsx`
- Capped desktop `dpr` at `1.5` (from `1.8`) to reduce GPU fillrate cost.
- Raised `rot.y` sleep threshold from `0.002` to `0.015` so the 3D card settles faster into `0 FPS` idle state.

### 3.4 `tests/phase5f_fix_tuition_layout.test.ts`
- Added 3 regression tests verifying:
  1. `Lanyard.css` scopes desktop `302px` reservation to `.sp-page-scroll.lanyard-stage-active` and `.student-portal-scroll.lanyard-stage-active .tuition-lanyard-top-reserve`.
  2. `TuitionStudentPortal.tsx` applies `tuition-lanyard-top-reserve` to top sections, stacks `SpotlightCard`s below `2xl`, and uses `sm:grid-cols-2 2xl:grid-cols-4` for `MetricCard`s.
  3. `ScheduleCard` uses `flex-wrap` and `break-words` to prevent overlap/truncation.

---

## 4. Responsive Layout Verification (Before vs After)

Measured via Playwright against the production `dist/` build using a populated Tuition Student session (`2` enrollments, `2` schedules including `Up Next` on Thursday `5:00 PM`):

| Viewport | `innerContentWidth` (Before → After) | `upNextCardWidth` (Before → After) | `clippedCount` (Before → After) | `horizontalOverflow` |
|---|---|---|---|---|
| `1173x1270` | `553px` → `823px` | `269px` → `521px` | `4` → `0` | `false` |
| `1280x800` | N/A → `930px` | N/A → `628px` | `9` → `0` | `false` |
| `1440x900` | N/A → `1090px` | N/A → `788px` | `5` → `0` | `false` |
| `1024x768` | N/A → `674px` | N/A → `372px` | `6` → `2` (minor `MetricCard` wrap at 1024px) | `false` |
| `768x1024` | N/A → `720px` | N/A → `720px` | `1` → `0` | `false` |
| `390x844` | `358px` → `358px` | `358px` → `358px` | `0` → `0` | `false` |

### Other Tuition Portals (Unaffected)
- `TuitionCoordinatorPortal`: `hasLanyardStageActive: false`, `horizontalOverflow: false`, `mainContentWidth: 1065`
- `TuitionTeacherPortal`: `hasLanyardStageActive: false`, `horizontalOverflow: false`, `mainContentWidth: 887`

---

## 5. Performance & Lag Verification (3-Run Comparison at `1173x1270`)

| Metric | Before (3 runs) | After (3 runs) |
|---|---|---|
| `usableMs` | `994–1,038 ms` | `974–1,025 ms` |
| `tabSwitchMs` | `411–430 ms` | `415–477 ms` |
| `rafVisible` | `61 FPS` | `61 FPS` |
| `rafHidden` | `0 FPS` | `0 FPS` |
| `heapMB` | `12.3–13.7 MB` | `12.9–13.9 MB` (final run: `12.9–13.7 MB`) |
| `longTaskCount` | `3` | `3–4` |
| `longTaskMaxMs` | `140–151 ms` | `128–136 ms` |
| `apiCount` | `6` | `6` |

---

## 6. Dev & Production Functional Verification

Verified with Playwright (`1280x800`) against both `http://localhost:3000/#dashboard` (Vite dev server) and `dist/` (`http://127.0.0.1:4181/#dashboard`):

- **Overview cards** (`Live Now`, `Up Next`, `Active subjects`, `My Subjects`, `Attendance`): Rendered cleanly on both dev and prod.
- **3D ID Card (`Lanyard`)**: WebGL `<canvas>` (`270px` wide) rendered, pointer drag interaction succeeded, and Hide/Show toggle dynamically toggled `.lanyard-stage-active` on `.student-portal-scroll`.
- **Navigation & Logout**: Switching to `Attendance`, `Assignments`, and `Schedule` tabs succeeded; `Logout` cleared `quran_academy_session_v2`.
- **Errors**: `0` page errors on both dev and prod; `0` console errors on Vite dev server (`http://localhost:3000`).

---

## 7. Automated Regression Checks

- `node --test tests/*.test.ts`: **125 / 125 passed** (`0` failed, `0` skipped)
- `npm run check` (`tsc --noEmit` + `vite build`): **Passed** (exit code `0`)
- `cd backend; python manage.py check`: **Passed** (`System check identified no issues (0 silenced)`)

---

## 8. QA Cleanup & Next Step

- All disposable QA records (`qa_5f_fix_*` users, profiles, roles, enrollments, and schedules) were deleted from localdev PostgreSQL (`Remaining qa_5f_fix_ users: 0`).
- **Phase 5F-FIX is complete and stopped for manual review. Phase 5G has NOT been started.**
