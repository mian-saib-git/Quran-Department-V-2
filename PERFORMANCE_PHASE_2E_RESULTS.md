# IVS Academy — Phase 2E Results: React Rendering and UI Responsiveness Optimization

**Date:** 2026-11-17  
**Scope:** Eliminating root-level 1-second clock re-renders, isolating second-level countdowns, deferring heavy report search filtering, and memoizing sorted teacher lists in `AttendanceEditor`.  
**Visual Design / Backend / Schema / Business Logic:** Unchanged.

---

## 1. Identified React Rendering Bottlenecks

1. **Root-Level 1-Second Clock State Updates Across 4 Portals:**
   - `TeacherPortal.tsx` (`4,787` lines), `StudentPortal.tsx` (`3,035` lines), `TuitionStudentPortal.tsx` (`1,661` lines), and `TuitionTeacherPortal.tsx` (`1,185` lines) each ran a `window.setInterval(..., 1000)` updating `clockNow` / `now` in root component state.
   - This forced **60 full-portal React renders per minute** while idle — even though `IVSClockCard` already owns its own internal 1-second timer when `now` is omitted, and all schedule `isLive`/`isUpcoming` checks only change at minute boundaries (`HH:MM:00`).
2. **Second-Level Countdown Precision in Tuition Portals:**
   - `TuitionStudentPortal.tsx` and `TuitionTeacherPortal.tsx` display `Starts in XXm YYs` countdown badges. Updating the root portal every second for this badge re-rendered the entire portal; isolating it into `<LiveCountdown />` (`React.memo`) preserves exact 1-second countdown precision without re-rendering the parent portal.
3. **Reports Search Input Responsiveness (`ReportsTab.tsx`):**
   - `reportSearch` directly drove `normalizedReportSearch` synchronously on every keystroke, causing immediate re-filtering and re-aggregation of large report tables during typing.
4. **Inline Array Sorting in `AttendanceEditor.tsx`:**
   - `appState.teachers.slice().sort(...)` ran inline inside JSX on every render of `AttendanceEditor.tsx` (while `recordsForDate`, `teacherCards`, `filteredStudents`, `summary`, and `modalSessions` were already memoized and incremental row updates were already in place).

---

## 2. Exact Files Modified / Added

1. `hooks/useMinuteNow.ts` *(added)*
   - Aligns updates to `:00` second boundaries (`60_000 - (Date.now() % 60_000) + 25`) so schedule transitions (`isLive` / `isUpcoming` / `currentTime`) happen at the exact minute boundary while reducing root portal clock updates from `60/min` to `1/min`. Cleans up `clearTimeout` on unmount.
2. `components/ui/LiveCountdown.tsx` *(added)*
   - `React.memo` component that owns its own 1-second `setInterval` solely for the `Starts in ...` countdown badge in Tuition portals, cleaning up on unmount.
3. `components/TeacherPortal.tsx` & `components/StudentPortal.tsx` *(modified)*
   - Replaced root 1s `setInterval` + `clockNow` state with `useMinuteNow()`.
   - Removed `now={clockNow}` from `<IVSClockCard compact />` / `<ClockCard />` so `IVSClockCard` runs its isolated 1s timer without re-rendering the parent portal.
4. `components/tuition/TuitionStudentPortal.tsx` & `components/tuition/TuitionTeacherPortal.tsx` *(modified)*
   - Replaced root 1s `setInterval` + `now` state with `useMinuteNow()`.
   - Updated `PortalClock` to render `<IVSClockCard compact />` (self-contained 1s timer).
   - Replaced inline `countdownLabel(timing.secondsUntil)` with `<LiveCountdown targetTimeMs={timing.start.getTime()} prefix="Starts in " />`.
5. `components/ReportsTab.tsx` *(modified)*
   - Added `useDeferredValue(reportSearch)` for `normalizedReportSearch` so search typing remains non-blocking while table filtering defers cleanly.
6. `components/AttendanceEditor.tsx` *(modified)*
   - Memoized `sortedTeachers` with `useMemo` instead of sorting `appState.teachers` inline on every render (preserving all existing incremental `updateRows` and coverage validation behavior).
7. `tests/phase2e_rendering_responsiveness.test.ts` *(added)*
   - Regression tests verifying clock isolation, `LiveCountdown` isolation & cleanup, `useMinuteNow` minute-boundary scheduling math & cleanup, `ReportsTab` deferred search, and `AttendanceEditor` memoization.

---

## 3. Before-and-After Render Characteristics

*Limitation: Live React DevTools Profiler flamegraphs / browser commit-duration captures were not available in this CLI environment. The idle render frequency reduction below is directly derived from the removed `1,000 ms` `setInterval` calls vs. minute-aligned `useMinuteNow` updates.*

| Portal / Component | Root Idle Renders Before | Root Idle Renders After | Visual Clock / Countdown Precision |
|---|---:|---:|---|
| `TeacherPortal` (`4,787` lines) | **60 / min** (`1,000 ms` interval) | **1 / min** (minute-aligned) | `IVSClockCard` still ticks every **1s** (isolated) |
| `StudentPortal` (`3,035` lines) | **60 / min** (`1,000 ms` interval) | **1 / min** (minute-aligned) | `IVSClockCard` still ticks every **1s** (isolated) |
| `TuitionStudentPortal` (`1,661` lines) | **60 / min** (`1,000 ms` interval) | **1 / min** (minute-aligned) | `IVSClockCard` & `LiveCountdown` still tick every **1s** (isolated) |
| `TuitionTeacherPortal` (`1,185` lines) | **60 / min** (`1,000 ms` interval) | **1 / min** (minute-aligned) | `IVSClockCard` & `LiveCountdown` still tick every **1s** (isolated) |

---

## 4. Verification Results

- `npm run typecheck` (`tsc --noEmit`): **Passed** (`0` errors).
- `npm run build` (`vite build`): **Passed** (`40.66s`, `3679` modules transformed).
- `node --experimental-strip-types --test tests/attendance_editor_incremental_update.test.ts tests/phase2b_polling_and_ws.test.ts tests/phase2c1_daily_lesson_reports.test.ts tests/phase2c2_salary_assignments.test.ts tests/phase2d_bundle_lazy_loading.test.ts tests/phase2e_rendering_responsiveness.test.ts`: **Passed** (`28/28` tests passed in `987.9 ms`).

---

## 5. Remaining Performance Opportunities & Risks

- **Browser Profiling Not Available:** Actual React commit durations (ms), browser main-thread TBT, and live interaction timings should be spot-checked in Chrome DevTools React Profiler when running the UI interactively.
- **Large Monolithic JSX Files:** `App.tsx` (`5,580` lines), `TeacherPortal.tsx` (`4,787` lines), and `ReportsTab.tsx` (`3,820` lines) still contain large inline tab JSX blocks; tab-level subcomponent extraction remains a clean future maintainability improvement.

---

## 6. Rollback Instructions

To revert Phase 2E:
```powershell
git checkout -- components/TeacherPortal.tsx components/StudentPortal.tsx components/tuition/TuitionStudentPortal.tsx components/tuition/TuitionTeacherPortal.tsx components/ReportsTab.tsx components/AttendanceEditor.tsx
Remove-Item hooks/useMinuteNow.ts, components/ui/LiveCountdown.tsx, tests/phase2e_rendering_responsiveness.test.ts
```
