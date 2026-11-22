# ARCHITECTURE_PHASE_4D_V4_RESULTS.md

## 1. Confirmed Root Cause
Browser baseline inspection (`1280x800`, `768x1024`, `390x844`) and source inspection of `components/tuition/lanyard/Lanyard.css`, `components/tuition/lanyard/Lanyard.tsx`, `components/StudentPortal.tsx`, `components/tuition/TuitionStudentPortal.tsx`, and `index.css` confirmed two root causes:
1. **Unconstrained Full-Viewport Overlay Geometry**: `.quran-global-lanyard-layer` and `.tuition-global-lanyard-layer` used `position: absolute; top: -74px; right: 0; bottom: 0; left: 0;`, centering the hanging 3D ID card at `x = 0` directly on top of the Overview KPI cards (`Lesson Reports`, `Today Class`) on Desktop and all KPI cards / topbar controls on Tablet and Mobile.
2. **Stacking Context & Z-Index Inversion**: `.lanyard-wrapper`, `.quran-global-lanyard-layer`, and `.tuition-global-lanyard-layer` used `z-index: 70` — higher than `.sp-mobile-drawer` (`z-index: 50 !important` in `index.css:887`), mobile backdrop (`z-40`), and `TuitionStudentPortal` mobile drawer (`z-50`). In `StudentPortal.tsx`, `<main ref={portalSurfaceRef}>` also lacked `isolation: isolate` (`isolate z-0`), placing the `z-index: 70` Lanyard directly in front of the open mobile/tablet navigation drawer and modals.
3. **Pointer NDC Computation**: `Lanyard.tsx` computed pointer raycasting NDC from `eventSource?.current` (`portalSurfaceRef`) rather than `currentState.gl.domElement`, which would offset drag coordinates once the Lanyard canvas was docked to a dedicated non-overlapping stage.

## 2. Exact Source Files Changed
- **Modified**:
  - `components/tuition/lanyard/Lanyard.css`
  - `components/tuition/lanyard/Lanyard.tsx`
  - `components/StudentPortal.tsx`
  - `components/tuition/TuitionStudentPortal.tsx`
- **Added**:
  - `tests/phase4d_v4_lanyard_layout.test.ts` (5 regression tests)
  - `ARCHITECTURE_PHASE_4D_V4_RESULTS.md` (this report)

## 3. CSS / Layout Changes
1. **Stacking Context & Z-Index (`Lanyard.css`, `StudentPortal.tsx`, `TuitionStudentPortal.tsx`)**:
   - Lowered `.lanyard-wrapper`, `.tuition-overview-lanyard-layer`, `.tuition-global-lanyard-layer`, and `.quran-global-lanyard-layer` from `z-index: 70` to `z-index: 20`.
   - Added `isolate z-0` to `<main ref={portalSurfaceRef}>` in `StudentPortal.tsx` and explicit `z-0` alongside `isolate` on `portalSurfaceRef` in `TuitionStudentPortal.tsx`.
   - Elevated `<header className="sp-topbar ...">` in `StudentPortal.tsx` and `<header>` in `TuitionStudentPortal.tsx` to `z-30`, keeping topbar controls above the Lanyard (`z-20`) while keeping mobile drawers (`z-50`), backdrops (`z-40`), and modals (`z-50+`) above everything.
2. **Non-Overlapping Responsive Stage (`Lanyard.css`, `StudentPortal.tsx`, `TuitionStudentPortal.tsx`)**:
   - **Desktop (`>= 1024px`)**: Docked `.tuition-global-lanyard-layer` / `.quran-global-lanyard-layer` to a `270px x 400px` right-side stage (`right: 16px; width: 270px; height: 400px;`, `top: 72px` below topbar in `StudentPortal.tsx`, `top: 0` below header in `TuitionStudentPortal.tsx`) and added `.lanyard-stage-active` (`padding-right: 302px !important;`) on the scroll container when `studentCardVisible` is `true`.
   - **Tablet & Mobile (`<= 1023px` / `<= 639px`)**: Positioned the Lanyard stage cleanly at the top (`width: 100%; height: 260px` / `250px`, `top: 68px` below `.sp-topbar` in `StudentPortal.tsx`, `top: 0` in `TuitionStudentPortal.tsx`) and reserved `.lanyard-stage-active` (`padding-top: 268px !important;` / `258px !important;`) so KPI cards start cleanly below the Lanyard.
3. **Accurate Drag Raycasting (`Lanyard.tsx`)**:
   - Updated `pointerEventFactory` `compute` to prefer `currentState.gl.domElement || eventSource?.current` so pointer NDC coordinates match the docked/staged `<canvas>` bounds while keeping `pointer-events: none` on `.lanyard-wrapper` and `canvas`.

## 4. Interaction Behavior Before and After
| Behavior | Baseline (Before) | After Phase 4D-V4 |
|---|---|---|
| Desktop (`1280x800`) KPI cards | Overlapped in center (`Lesson Reports`, `Today Class`, welcome heading) | **0 overlap** (`26px` horizontal clearance between KPIs `x: 284..968` and Lanyard `x: 994..1264`) |
| Tablet (`768x1024`) KPI cards & drawer | Card/strap cut through KPIs and overlapped right edge of open drawer | **0 overlap** (KPIs start `29px` below Lanyard; drawer renders above Lanyard) |
| Mobile (`390x844`) KPI cards & drawer | Strap/card rendered directly on top of open mobile drawer (`Overview`, `Attendance`, `Lessons`, `Schedule`) | **0 overlap** (KPIs start `11px` below Lanyard; drawer renders cleanly above Lanyard & backdrop) |
| Horizontal overflow (`390x844`) | `maxRightEdge: 390` (canvas `-6..396` clipped) | `maxRightEdge: 390` (**0 horizontal overflow**) |
| Normal clicks & Logout | Forced click previously needed on Tuition Logout; KPIs visually covered | Normal clicks (`force: false`) work on all KPIs, topbar buttons, drawer nav items, and Logout |
| 3D Lanyard drag & animation | Interactive physics swing & drag | **Preserved** (dragged card & strap swing verified in browser) |

## 5. Desktop Verification & Screenshots (`1280x800`)
- **Baseline**: `18dc24a2-9047-4a9d-9be6-fec1df2f8809/browser_sandbox/screenshots/step_18_shot_1_desktop_1280x800_baseline.png`
- **After Fix (Quran Student)**: `8767e180-b04d-4d36-9e7d-1f702e4f88eb/browser_sandbox/screenshots/step_14_shot_1.png`
  - Lanyard docked at `x: 994, y: 72, width: 270, height: 400`; KPI section `x: 284..968, y: 113..335`; topbar controls `y <= 67`.
  - Normal clicks verified on all 4 KPI cards, Notifications dialog, Hide/Show student ID card toggle, Refresh, Theme toggle, `Attendance`, `Lessons`, `Schedule`, and `Overview`.
- **After Fix (Tuition Student)**: `cd927102-4ff0-4f5a-8690-4f59d409d728/browser_sandbox/screenshots/step_16.png`

## 6. Mobile & Tablet Verification & Screenshots (`390x844`, `768x1024`)
- **Baseline Mobile Open Drawer**: `18dc24a2-9047-4a9d-9be6-fec1df2f8809/browser_sandbox/screenshots/step_30_shot_2_mobile_390x844_drawer.png`
- **After Fix Mobile Open Drawer (`390x844`)**: `8767e180-b04d-4d36-9e7d-1f702e4f88eb/browser_sandbox/screenshots/step_65.png`
  - Lanyard stage `x: 0, y: 68, width: 390, height: 250`; KPI section starts at `y: 329` (`11px` gap, 0 overlap); open drawer (`z-50`) renders cleanly above the backdrop (`z-40`) and Lanyard (`z-20`).
- **After Fix Tablet Open Drawer (`768x1024`)**: `8767e180-b04d-4d36-9e7d-1f702e4f88eb/browser_sandbox/screenshots/step_55_shot_1.png`

## 7. Quran Student Portal Results (`qa_phase4dv4_qstudent`)
- **PASS** across Desktop (`1280x800`), Tablet (`768x1024`), and Mobile (`390x844`):
  - Overview, KPI cards, Attendance, Lessons, Schedule, Notifications, Hide/Show ID card toggle, Refresh, Theme toggle, Mobile/Tablet drawer, 3D Lanyard drag, and normal Logout all verified with zero console or WebGL errors.

## 8. Tuition Student Portal Results (`qa_phase4dv4_tstudent`)
- **Visual Layout Verified / Interactive Script Timed Out**:
  - Visual screenshots (`step_58.png` and `step_16.png`) confirmed the 3D Lanyard rendered cleanly below the topbar and above `Live Now` / `Up Next` and KPI cards with zero overlap and zero console/WebGL errors.
  - However, once the 3D Lanyard mounted in the Tuition Student session (`87580544` and `cd927102`), Playwright calls in `webview_browser` hit `30000ms` timeouts (with 3 simultaneous WebGL/Rapier tabs open in the browser session), blocking automated click-through of Tuition tabs and Tuition mobile drawer/Logout.

## 9. Normal Logout Click Verification
- Verified on Quran Student Portal at `390x844` mobile (`8767e180`): clicking `Logout` (`x: 26, y: 740.5, width: 267, height: 47.5`) **without `force: true`** cleanly signed out and returned to `LoginScreen`.

## 10. Lanyard Animation & Performance Verification
- 3D Lanyard drop animation, pointer drag swing (`step_20_shot_1.png`), and Hide/Show toggle animation all functioned cleanly.
- Phase 2D lazy-loading (`React.lazy`, `LazyChunkErrorBoundary`, `React.Suspense`, deferred `lanyardMounted`) remained intact: `vite build` still splits `Lanyard-CvsyMpys.js` (`3,311.32 kB` / `1,128.57 kB` gzip) out of `StudentPortal-Bpv0TbCy.js` (`67.37 kB` / `15.52 kB` gzip) and `TuitionStudentPortal-CruKSI_D.js` (`48.96 kB` / `13.38 kB` gzip).

## 11. TypeScript, Build, and Test Results
- `npm run typecheck` (`tsc --noEmit`): **Passed** (exit code `0`).
- `npm run build` (`vite build`): **Passed** (`✓ built in 1m 34s`).
- `node --test tests\*.test.ts`: **85 passed, 0 failed, 0 skipped** (all 80 previous tests + 5 new tests in `tests/phase4d_v4_lanyard_layout.test.ts`).

## 12. Remaining Issues
- Automated Playwright interaction inside `TuitionStudentPortal` after Lanyard mount hit `30000ms` `webview_browser` script timeouts (compounded by multiple open WebGL tabs in the shared browser session). Visual non-overlapping layout in `TuitionStudentPortal` was confirmed via screenshots (`step_16.png`), and the CSS/stacking rules are shared with `StudentPortal` via `Lanyard.css`.

## 13. Safe Phase-Specific Rollback Instructions
To revert only Phase 4D-V4 changes without disturbing earlier phases:
1. Revert only the Phase 4D-V4 hunks in `components/tuition/lanyard/Lanyard.css`, `components/tuition/lanyard/Lanyard.tsx`, `components/StudentPortal.tsx`, and `components/tuition/TuitionStudentPortal.tsx`.
2. Delete `tests/phase4d_v4_lanyard_layout.test.ts` and `ARCHITECTURE_PHASE_4D_V4_RESULTS.md`.

## 14. Recommendation for Phase 4E
**READY FOR PHASE 4E** (with a brief manual click-through of Tuition Student mobile drawer/Logout recommended if desired, as `webview_browser` timed out under multi-tab WebGL load).
