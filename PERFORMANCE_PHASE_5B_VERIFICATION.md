# PERFORMANCE_PHASE_5B_VERIFICATION.md

## 1. Source Review
Inspected `components/SchedulingTab.tsx` and its Phase 5B diff:
- **Windowing math**: `computeHorizontalRange` (`TEACHER_COL_WIDTH = 238`, `TIME_COL_WIDTH = 132`, `OVERSCAN_COLS = 2`), `computeVerticalRange` (`OVERSCAN_ROWS = 3`), and `estimateSlotRowHeight` (`109 / 136 / 174 / 196`).
- **Scroll & resize**: `ResizeObserver` on `scrollRef` with `ro.disconnect()` cleanup on unmount; `requestAnimationFrame` scroll coalescing with `cancelAnimationFrame(rafIdRef.current)` cleanup on unmount; `setScrollPos` only fires when `[startRow..endRow, startCol..endCol]` actually changes.
- **Reference stability**: `EMPTY_STUDENTS` module-level constant and `onCellClickRef` + `stableOnCellClick` keep `ScheduleCell` memoization intact.
- **Clamping**: `scrollLeft` clamps when `teachers.length` shrinks.

---

## 2. Full Matrix Coverage Results
Executed Playwright sweep across the full 48-slot × 76-teacher matrix against `dist/` + live Django (`127.0.0.1:5000`, `976` students, `76` teachers):
- **Time slots**: `48 / 48` visited (`12:00 AM` through `11:30 PM`), `0` missing, `0` duplicates.
- **Teacher columns**: `76 / 76` visited (`01` through `76`), `0` missing, `0` duplicates.
- **Counts & details**: Student badge (`976`) and cell student cards matched the authoritative `/api/academy/state/` payload.

---

## 3. Variable-Height Testing
Measured rendered row heights and adjacent row geometry across all 48 slots:
- **Empty row height**: `109 px` (`min = 109`, `max = 109`).
- **Populated row height**: `121–162 px`.
- **Adjacent row gap**: `0 px` (`maxRowGap = 0`).
- **Adjacent row overlap**: `0 px` (`maxRowOverlap = 0`).
- **Sticky alignment**: `maxTheadDelta = 0 px`, `maxTimeDelta = 0 px` across vertical and horizontal sweeps.

---

## 4. Offscreen Cell Verification
- Scrolled to the far-right / bottom-most cell (`rowIndex = 47`, `11:30 PM`, last teacher column), opened the empty cell modal (`0 students in this class`), and verified interactive access.
- Scrolled away to `(0, 0)` (unmounting the bottom-right cell) and scrolled back to `(scrollHeight, scrollWidth)`: verified the edited student remained rendered in `row47` (`visibleAfterScrollBack = true`).

---

## 5. Scheduling Edit / Save / Refresh Results
- Added a disposable student (`__QA_5BV_TEMP_STUDENT__`) via the `class-details` → `Add student` modal in `row47`:
  - **Before Phase 5B-V fix**: Saving a student while scrolled to the bottom triggered a `1,320 px` upward scroll jump (`scrollTop: 6659 → 5339`).
  - **After Phase 5B-V fix**: `row47` stayed in view immediately after submit (`inBody: true`, `modalOpen: false`, `row47Text` included `__QA_5BV_TEMP_STUDENT__`) and remained visible after scrolling to `(0, 0)` and back (`visibleAfterScrollBack: true`).
  - **Note on persistence**: `App.tsx`'s `saveStudent` updates `appState.students` in React state and triggers `saveState` (note: in this localdev setup, `persistedAfterReload` was `false` because `App.tsx` student creation in `class-details` does not persist standalone student profiles to Django `/api/academy/state/` — this is existing `App.tsx` behavior unrelated to `SchedulingTab.tsx`, and `0` temporary records were left in the database).

---

## 6. Scroll and Resize Results
Tested fast vertical, horizontal, and diagonal scrolling, scroll-to-end-and-back, viewport resizing & orientation flips (`1280x800` → `1024x768` → `768x1024` → `390x844` → `844x390` → `1280x800`), and 3 rapid `Scheduling` ↔ `Attendance` round-trips:
- `resizeObserverErrors`: `[]` (`0` loop errors)
- `consoleErrors`: `[]` (`0` errors)
- `extraReqsDuringRapid`: `0` additional `/api/academy/state/` requests (Phase 5A/5A-V preserved).

---

## 7. Department Isolation Verification
- Verified `App.tsx` (`canLoadQuranAcademyState`, `scopeKey`, `stateRequestSeqRef`) and `services/storageService.ts` (`inFlightAcademyState`) were completely untouched by Phase 5B and Phase 5B-V.
- Verified `SchedulingTab` only consumes `viewAppState` scoped by department/role in `App.tsx`.

---

## 8. Before-and-After Performance Measurements (Median of 3 Runs, `dist/`)
| Viewport | Metric | Phase 5B Baseline (Pre-Opt) | Phase 5B-V (Post-Fix) | Delta |
|---|---|---:|---:|---:|
| **Desktop (`1280x800`)** | DOM Nodes (`*`) | 28,380 | **868** | **-96.9%** |
| | JS Heap | 34.85 MB | **6.37 MB** | **-81.7%** |
| | Warm Transition (0 API calls) | 760 ms | **169 ms** | **-77.8%** |
| | Warm Long Tasks (Total / Max) | 441 / 433 ms | **0 / 0 ms** | **-100%** |
| | H-Scroll Avg Frame | 17.6 ms | **16.7 ms** | Smooth |
| **Tablet (`768x1024`)** | DOM Nodes (`*`) | 28,380 | **734** | **-97.4%** |
| | JS Heap | 34.14 MB | **6.60 MB** | **-80.7%** |
| | Warm Transition (0 API calls) | 749 ms | **149 ms** | **-80.1%** |
| | Warm Long Tasks (Total / Max) | 504 / 433 ms | **0 / 0 ms** | **-100%** |
| **Mobile (`390x844`)** | DOM Nodes (`*`) | 28,380 | **633** | **-97.8%** |
| | JS Heap | 36.10 MB | **7.68 MB** | **-78.7%** |
| | Warm Transition (0 API calls) | 1,070 ms | **549 ms** | **-48.7%** |
| | Warm Long Tasks (Total / Max) | 385 / 385 ms | **0 / 0 ms** | **-100%** |
| | V-Scroll / H-Scroll `>32ms` Frames | 12/19 / 15/19 | **0/19 / 0/19** | **0 jank** |
| **All Viewports** | Browser Console Errors | 0 | **0** | Clean |

---

## 9. Bugs Discovered
1. **Scroll-Position Jump on Student Save Near Bottom**: `useEffect(() => { measuredRowHeightsRef.current = {}; ... }, [students])` wiped all 48 measured row heights whenever `students` updated, momentarily shrinking `scrollHeight` to estimated heights and forcing the browser to clamp `scrollTop` upward (`6659 → 5339`, a `1,320 px` jump).
2. **Out-of-Bounds `scrollTop` Fallthrough in `computeVerticalRange`**: When `scrollTop >= totalHeight`, `foundStart` remained `false`, causing `computeVerticalRange` to return `startRow = 0, endRow = 47` (all 48 rows) instead of clamping to the bottom window.

---

## 10. Exact Corrections Made (`components/SchedulingTab.tsx`)
1. **Preserved `measuredRowHeightsRef` across `[students]` updates**: Removed the full-reset `useEffect`, relying on `useLayoutEffect` (keyed on `[..., students, maxStudentsPerSlot]`) to re-measure only currently visible rows whose actual height differs by `> 1 px` from `measuredRowHeightsRef.current[idx] ?? estimateSlotRowHeight(...)`.
2. **Clamped `effectiveTop` in `computeVerticalRange`**: Clamped `effectiveTop = Math.min(Math.max(0, scrollTop), Math.max(0, totalHeight - effectiveViewport))` so out-of-bounds `scrollTop` values always window the bottom slice cleanly.

---

## 11. Automated Regression Results
- `npm run typecheck`: **Passed** (`tsc --noEmit`, exit code `0`).
- `npm run build`: **Passed** (`vite build`, `SchedulingTab` chunk `16.23 kB` / `4.52 kB` gzip).
- `node --test tests\*.test.ts`: **102 passed, 0 failed, 0 skipped** (all 100 Phase 5B tests + 2 new Phase 5B-V tests in `tests/phase5b_scheduling_virtualization.test.ts` covering out-of-bounds `scrollTop` clamping, unmount cleanup, and `measuredRowHeightsRef` preservation).
- `backend/manage.py check`: **Passed** (`System check identified no issues (0 silenced)`).
- Temporary QA user `qa_5bv_qcoord` and scratch session files were deleted.

---

## 12. Safe Phase-Specific Rollback Instructions
To revert Phase 5B + 5B-V without disturbing Phases 2A–5A-V:
1. `git checkout -- components/SchedulingTab.tsx`
2. Delete `tests/phase5b_scheduling_virtualization.test.ts`, `PERFORMANCE_PHASE_5B_RESULTS.md`, and `PERFORMANCE_PHASE_5B_VERIFICATION.md`.
3. Rebuild with `npm run build`.

---

## 13. Final Recommendation
**CORRECT & KEEP** — With the Phase 5B-V `measuredRowHeightsRef` preservation and `computeVerticalRange` `effectiveTop` clamping fixes applied, Phase 5B's 2D Scheduling matrix windowing is verified across all 48 time slots, 76 teachers, variable row heights, offscreen edits, viewport resizes, and rapid tab switches, reducing DOM nodes by `96.9–97.8%` (`28,380 → 633–868`) and JS heap by `78.7–81.7%` with `0` long tasks and `0` console errors.
