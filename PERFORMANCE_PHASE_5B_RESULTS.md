# PERFORMANCE_PHASE_5B_RESULTS.md

## 1. Original Scheduling Architecture
- **Component**: `components/SchedulingTab.tsx` (lazy-loaded from `App.tsx` for Quran Coordinator / Department Admin when `effectiveActiveTab === "scheduling"`).
- **Grid Structure**:
  - **Rows**: 48 fixed 30-minute slots from `TIME_SLOTS` (`00:00` to `23:30` in `constants.ts`).
  - **Columns**: 1 sticky left `TIME` column (`min-w-[132px]`) + 1 column per teacher in `appState.teachers` (`76` active Quran teachers in localdev; `min-w-[238px]` header, `w-[238px] max-w-[238px]` cell).
  - **Grouping**: `studentsByTeacherAndSlot` (`useMemo` keyed on `students`) maps `` `${student.teacherId}__${student.timeSlot}` `` to a name-sorted `Student[]`.
  - **Sticky Elements**: `<thead className="sticky top-0 z-30">`, top-left `TIME` `<th>` (`sticky left-0 z-40`), and each row's `TimeCell` `<td>` (`sticky left-0 z-20`).
  - **Cell Interactions**: Clicking any `ScheduleCell` (populated or empty) invokes `onCellClick(teacherId, timeSlot, students)` in `App.tsx`, opening the `class-details` modal. `SchedulingTab` contains no internal search, filter, print, or export controls.

---

## 2. Fresh Performance Baseline
Measured against the Vite production build (`dist/`) served on `http://127.0.0.1` with `/api/*` and `/ws/*` proxied to local Django (`127.0.0.1:5000`, `976` students / `76` teachers in Quran Department), 3 runs per viewport (median reported):

| Viewport | Cold Transition (incl. API) | `/api/academy/state/` Wait | Warm Transition (0 API calls) | DOM Nodes (`*`) | CDP Nodes | `<td>`/`<th>` Cells | JS Heap | Warm Long Tasks (Total / Max) | V-Scroll Avg / Max | H-Scroll Avg / Max |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| Desktop (`1280x800`) | 1,178 ms | 970 ms | 760 ms | 28,380 | 51,862 | 3,773 | 34.85 MB | 441 ms / 433 ms | 16.7 / 16.8 ms | 17.6 / 33.3 ms |
| Tablet (`768x1024`) | 1,016 ms | 776 ms | 749 ms | 28,380 | 50,988 | 3,773 | 34.14 MB | 504 ms / 433 ms | 18.4 / 33.4 ms | 19.3 / 33.3 ms |
| Mobile (`390x844`) | 1,384 ms | 783 ms | 1,070 ms | 28,380 | 50,683 | 3,773 | 36.10 MB | 385 ms / 385 ms | 27.2 / 34.4 ms | 31.6 / 50.0 ms |

---

## 3. Confirmed Rendering Bottleneck
1. **Unwindowed 48 × 76 Matrix (`3,773` cells / `28,380` DOM nodes)**: Every time slot and every teacher column was mounted simultaneously into `<table>`, producing `28,380` DOM elements (`~51k` CDP nodes), a `385–433 ms` main-thread long task on warm mount, `~34–36 MB` JS heap, and `12–16/19` slow (`>32 ms`) scroll frames on mobile.
2. **Unstable Props on Empty Cells & Click Handler**: `studentsByTeacherAndSlot.get(key) ?? []` allocated a fresh `[]` per empty cell on every render, and `App.tsx` passed an inline `onCellClick` arrow function, defeating `React.memo` on `ScheduleCell`.

---

## 4. Optimization Options Considered
| Option | Assessment | Decision |
|---|---|---|
| Vertical-only row virtualization | Reduces `48` rows to `~11`, but still mounts all `76` teacher columns (`~836` cells, `~6,000` DOM nodes). | Rejected (exceeds `<2,000` DOM target) |
| Horizontal-only column virtualization | Reduces `76` columns to `~9`, but still mounts all `48` rows (`~432` cells, `~3,100` DOM nodes). | Rejected (exceeds `<2,000` DOM target) |
| External virtualization library (`@tanstack/react-virtual` / `react-window`) | Adds new npm dependency and complicates native `<table>` sticky `<thead>` + sticky `TimeCell` alignment. | Rejected (unnecessary dependency) |
| **Contained 2D table windowing (zero dependencies)** | Uses spacer `<tr>` (top/bottom) and spacer `<th>`/`<td>` (left/right) inside the existing `<table>`, preserving native sticky `<thead>` and `TimeCell`, fixed `238px` columns, and measured row heights. | **Selected** |

---

## 5. Chosen Implementation and Justification
Implemented **contained 2D windowing** directly inside `components/SchedulingTab.tsx` with zero new dependencies:
- **Horizontal windowing**: Exploits fixed `TEACHER_COL_WIDTH = 238` (`w-[238px] min-w-[238px] max-w-[238px]`) and `TIME_COL_WIDTH = 132` with `OVERSCAN_COLS = 2`.
- **Vertical windowing**: Estimates each of the `48` slot row heights from `maxStudentsPerSlot` (`estimateSlotRowHeight`), refines rendered row heights via `getBoundingClientRect().height` in `useLayoutEffect`, and pads offscreen rows with top/bottom spacer `<tr>`s (`OVERSCAN_ROWS = 3`).
- **Scroll & resize efficiency**: `ResizeObserver` tracks container dimensions, `requestAnimationFrame` coalesces `onScroll` events, and `setScrollPos` only triggers a React re-render when the visible `[startRow..endRow, startCol..endCol]` window actually changes.
- **Reference stability**: Added module-level `EMPTY_STUDENTS: Student[] = []` and `onCellClickRef` so `ScheduleCell` memoization remains intact, plus `scrollLeft` clamping when the teacher list shrinks.

---

## 6. Exact Source Changes
- **`components/SchedulingTab.tsx`**:
  - Added pure windowing helpers (`estimateSlotRowHeight`, `computeHorizontalRange`, `computeVerticalRange`, `TEACHER_COL_WIDTH`, `TIME_COL_WIDTH`, `OVERSCAN_ROWS`, `OVERSCAN_COLS`) and `EMPTY_STUDENTS`.
  - Stabilized `onCellClick` via `onCellClickRef` + `stableOnCellClick`.
  - Enforced `w-[238px] min-w-[238px] max-w-[238px]` on `TeacherHeader` `<th>` and `w-[132px] min-w-[132px]` on `TIME` `<th>`.
  - Added `ResizeObserver`, `rAF`-coalesced `handleScroll`, `rowRefs` height measurement, and `<table>` spacer `<th>`/`<td>`/`<tr>` rendering for `visibleTeachers` and `visibleSlots`.
- **`tests/phase5b_scheduling_virtualization.test.ts`** (new):
  - 5 regression tests covering horizontal width conservation, vertical height conservation, empty dataset rendering, 1,000-student / 80-teacher windowed rendering, and zero-dependency / stable-reference contracts.
- **`App.tsx`, `services/storageService.ts`, backend models/views**: Unchanged.

---

## 7. Before-and-After Measurements (Median of 3 Runs, `dist/`)
*(Note: Post-optimization runs used a pre-authenticated `localStorage` JWT session to avoid Django login rate-limiting on repeated runs; `coldTransitionMs` in after-runs reflects Scheduling transition after `#dashboard` settled, where full `/api/academy/state/` was either in flight or completing in parallel.)*

| Viewport | Metric | Before Phase 5B | After Phase 5B | Delta |
|---|---|---:|---:|---:|
| **Desktop (`1280x800`)** | DOM Nodes (`*`) | 28,380 | **868** | **-96.9%** |
| | CDP Nodes | 51,862 | **3,405** | **-93.4%** |
| | Rendered `<td>`/`<th>` Cells | 3,773 | **82** | **-97.8%** |
| | JS Heap | 34.85 MB | **6.60 MB** | **-81.1%** |
| | Warm Transition (0 API calls) | 760 ms | **194 ms** | **-74.5%** |
| | Warm Long Tasks (Total / Max) | 441 / 433 ms | **0 / 0 ms** | **-100%** |
| | V-Scroll / H-Scroll Avg Frame | 16.7 / 17.6 ms | 19.3 / **16.7 ms** | — |
| **Tablet (`768x1024`)** | DOM Nodes (`*`) | 28,380 | **734** | **-97.4%** |
| | CDP Nodes | 50,988 | **3,417** | **-93.3%** |
| | Rendered `<td>`/`<th>` Cells | 3,773 | **67** | **-98.2%** |
| | JS Heap | 34.14 MB | **6.95 MB** | **-79.6%** |
| | Warm Transition (0 API calls) | 749 ms | **151 ms** | **-79.8%** |
| | Warm Long Tasks (Total / Max) | 504 / 433 ms | **0 / 0 ms** | **-100%** |
| | V-Scroll / H-Scroll Avg Frame | 18.4 / 19.3 ms | **17.5 / 17.5 ms** | Smooth |
| **Mobile (`390x844`)** | DOM Nodes (`*`) | 28,380 | **633** | **-97.8%** |
| | CDP Nodes | 50,683 | **3,968** | **-92.2%** |
| | Rendered `<td>`/`<th>` Cells | 3,773 | **51** | **-98.6%** |
| | JS Heap | 36.10 MB | **8.21 MB** | **-77.3%** |
| | Warm Transition (0 API calls) | 1,070 ms | **455 ms** | **-57.5%** |
| | Warm Long Tasks (Total / Max) | 385 / 385 ms | **0 / 0 ms** | **-100%** |
| | V-Scroll Avg / `>32ms` Frames | 27.2 ms (`12/19`) | **16.7 ms (`0/19`)** | **-38.6% / 0 jank** |
| | H-Scroll Avg / `>32ms` Frames | 31.6 ms (`15/19`) | **16.7 ms (`0/19`)** | **-47.2% / 0 jank** |
| **All Viewports** | Browser Console Errors | 0 | **0** | Clean |

---

## 8. Browser Verification
Playwright interaction verification against `dist/` + live Django (`127.0.0.1:5000`, `976` students, `76` teachers):
- **Scroll geometry**: `scrollWidth = 18,220 px` (`132 + 76 × 238`), `scrollHeight = 7,699 px`.
- **Sticky headers & column**: At 50% vertical + horizontal scroll (`12:00 PM` visible), `theadDeltaTop = 0 px` and `timeDeltaLeft = 0 px`.
- **End & return**: Scrolling to bottom reached `11:30 PM`; returning to `(0, 0)` restored `12:00 AM`.
- **Cell modal**: Clicking a populated cell opened the `Class Details` modal (`in this class`) cleanly.
- **Tab switching & WS**: `Scheduling` → `Attendance` → `Scheduling` triggered **0** extra `/api/academy/state/` requests (`1` initial full-state request total), **1** `WS /ws/academy/` connection, and **0** console errors.

---

## 9. Scheduling Feature Equivalence
- All `48` time slots (`TIME_SLOTS`), all `76` teachers, and all `976` students remain accessible and intact.
- `TeacherHeader` preserves original 1-based numbering (`index={horizontalRange.startCol + idx}`) and name formatting.
- `ScheduleCell` preserves student counts, up to 2 student cards + `+N more` badge, hover `+` button on empty cells, and `onCellClick` modal editing.
- Authoritative student/teacher data remains in `App.tsx` (`viewAppState`), never stored inside virtualized row components.

---

## 10. Department Isolation and Permission Checks
- Phase 5A/5A-V `App.tsx` and `services/storageService.ts` guards (`canLoadQuranAcademyState`, `scopeKey`, `stateRequestSeqRef`, `inFlightAcademyState`) are completely untouched.
- `SchedulingTab` receives `viewAppState` already scoped by department and role in `App.tsx`.

---

## 11. TypeScript and Build Results
- `npm run typecheck` (`tsc --noEmit`): **Passed** (exit code `0`).
- `npm run build` (`vite build`): **Passed** (`✓ built in 23.72s`); `SchedulingTab` chunk is `16.20 kB` (`4.51 kB` gzip).
- `backend/manage.py check`: **Passed** (`System check identified no issues (0 silenced)`).

---

## 12. Full Frontend Test Results
- `node --test tests\*.test.ts`: **100 passed, 0 failed, 0 skipped** (all 95 existing tests + 5 new tests in `tests/phase5b_scheduling_virtualization.test.ts`).

---

## 13. Remaining Bottlenecks
1. **First Full `/api/academy/state/` Payload (`501 KB`, `~0.8–1.0 s` localdev)**: Still fetched once when leaving `#dashboard` (mitigated by Phase 5A/5A-V deduplication).
2. **Main `index` Bundle (`405.72 kB` / `112.87 kB` gzip)**: Coordinator shell in `App.tsx` still contributes to mobile Lighthouse TBT (`785–1,715 ms` from Phase 4E audit).
3. **Attendance Editor Synchronous Processing**: `#attendance` still processes `~1,000` student rows synchronously on mount (`502 ms` max long task in Phase 4E audit).

---

## 14. Safe Phase-Specific Rollback
To revert only Phase 5B without affecting Phases 2A–5A-V:
1. `git checkout -- components/SchedulingTab.tsx`
2. Delete `tests/phase5b_scheduling_virtualization.test.ts` and `PERFORMANCE_PHASE_5B_RESULTS.md`.
3. Rebuild with `npm run build`.

---

## 15. Recommendation for the Next Performance Phase
Proceed to **Phase 5C — `AttendanceEditor` Row Windowing / Incremental Rendering** or **Phase 4F — Lazy-Splitting `App.tsx` Coordinator Shell**, as `SchedulingTab` is now reduced from `28,380` DOM nodes (`760–1,070 ms` warm render, `34–36 MB` heap) down to `633–868` DOM nodes (`151–455 ms` warm render, `6.6–8.2 MB` heap) with `0` long tasks and `0` mobile scroll jank.
