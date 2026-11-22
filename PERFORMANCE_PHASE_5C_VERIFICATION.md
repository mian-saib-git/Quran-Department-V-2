# PERFORMANCE_PHASE_5C_VERIFICATION.md

## 1. Scheduling Persistence Verification Result
- **Distinction Confirmed**:
  - `App.tsx`'s `saveStudent` (triggered from `SchedulingTab` → `class-details` modal) updates React state and calls `storageService.saveState()`, which intentionally writes to `localStorage` cache only (`// Do not POST the full state here`).
  - The authoritative backend-persisted student/account creation flow is `CoordinatorAccounts.tsx` (`Accounts & Enrollment`), which sends `POST /api/auth/accounts/` to Django.
- **Browser Test Result**: Created a disposable student (`qa_5cv_persist_30044`, `__QA_5CV_PERSIST__`) via `CoordinatorAccounts` UI, verified **`HTTP 201 Created`** from `POST /api/auth/accounts/`, verified the `StudentProfile` record in PostgreSQL, and deleted it cleanly afterward (`deleted = 1`).

---

## 2. Phase 5C Role Regression Verification
Executed Playwright verification across **14** role × viewport combinations (`1280x800` Desktop and `390x844` Mobile) against `dist/` + live Django (`127.0.0.1:5000`), plus Login UI invalid/valid login & Logout:
- **Login UI**: Invalid credentials rendered `.ivs-login-error` (`401`), valid credentials transitioned to `#dashboard`, and `Logout` returned cleanly to `LoginScreen` (`Sign in`).
- **All 14 Role × Viewport Checks Passed (`ok: true`, `failedChunks: []`, `consoleErrors: []`)**:
  - Login (`1280x800`, `390x844`): `wsCount = 0`
  - Quran Coordinator `#dashboard` & `#scheduling` (`1280x800`, `390x844`): `wsCount = 1`
  - Quran Teacher `#dashboard` (`1280x800`, `390x844`): `wsCount = 1`
  - Quran Student `#dashboard` (`1280x800`, `390x844`): `wsCount = 1`
  - Tuition Coordinator `#dashboard` (`1280x800`, `390x844`): `wsCount = 1`
  - Platform Admin `#platform-admin` (`1280x800`, `390x844`, using `role: "platform_admin"`): `wsCount = 1`

---

## 3. Quran Student Lighthouse Baseline (Mobile `390x844`, Warm Cache, Median of 3 Runs)
- **Score**: `60`
- **FCP / LCP**: `632 ms` / `632 ms`
- **Speed Index**: `1,326 ms`
- **Total Blocking Time (TBT)**: `1,965 ms`
- **CLS**: `0.254`
- **Main Thread / Bootup Time**: `5,148 ms` / `3,345 ms`
- **JS Resource Size**: `3,683 KB` (includes lazy `Lanyard` `3.31 MB`)

---

## 4. Lanyard Performance Diagnosis
Inspected `StudentPortal.tsx`, `TuitionStudentPortal.tsx`, `Lanyard.tsx`, `Lanyard.css`, and `qstudent_mobile.json` Lighthouse diagnostics:
1. **`Bootup Time` Breakdown**: `index` (`2,291 ms`), `Lanyard-*.js` (`1,686 ms`, Three.js + `@react-three/rapier` WASM initialization), `StudentPortal-*.js` (`1,009 ms`).
2. **Eager Post-Load Trigger**: Both `StudentPortal.tsx` and `TuitionStudentPortal.tsx` used `window.setTimeout(() => setLanyardMounted(true), 0)` immediately when `loading` became `false`, running the `3.31 MB` Three.js + Rapier WASM initialization on the very next macrotask before the user could interact with dashboard controls.

---

## 5. Actual CLS Contributors
Lighthouse `layout-shift-elements` identified the exact culprit (`score = 0.2539`):
- **Element**: `div.sp-root > main.relative > div.flex-1 > div.space-y-6` (`height: 1,912 px`, shifted to `top: 329 px`).
- **Root Cause**: `Lanyard.css` (which defines `.lanyard-stage-active { padding-top: 258px !important; }` on `<640px` mobile and `padding-right: 302px !important;` on `>=1024px` desktop) was **only** imported inside the lazy-loaded `Lanyard.tsx` chunk. Until `Lanyard-*.js` and `Lanyard-*.css` finished downloading, `.lanyard-stage-active` had no CSS rule, and when `Lanyard-*.css` arrived, the entire dashboard content jumped down by `234 px`.

---

## 6. Optimization Chosen
Applied two minimal, targeted fixes in both `StudentPortal.tsx` and `TuitionStudentPortal.tsx` while preserving the 3D ID card, animations, dragging, and Show/Hide toggle:
1. **Eagerly import `Lanyard.css`** (`3.94 KB` raw / `0.96 KB` gzip, scoped to student portals only) so `.lanyard-stage-active` reserves the exact stage dimensions from frame 0, eliminating `CLS = 0.254`.
2. **Defer `lanyardMounted` to `1,800 ms` after `loading === false`** (and mount immediately if the user explicitly clicks the `Show/Hide ID card` toggle) so core dashboard controls are usable before Three.js + Rapier WASM initializes.

---

## 7. Exact Source Changes
- **`components/StudentPortal.tsx`**:
  - Added `import "./tuition/lanyard/Lanyard.css";`.
  - Changed `window.setTimeout(() => setLanyardMounted(true), 0)` to `1800` ms.
  - Updated `handleStudentCardToggle` to call `setLanyardMounted(true)` immediately if toggled visible before the timer fires.
- **`components/tuition/TuitionStudentPortal.tsx`**:
  - Added `import "./lanyard/Lanyard.css";`.
  - Applied the same `1800` ms deferral and immediate-mount-on-toggle behavior.
- **`tests/phase5c_v_lanyard_cls_defer.test.ts`** (new):
  - Added 2 regression tests verifying eager `Lanyard.css` imports and `1800` ms deferral + immediate toggle mounting in both student portals.

---

## 8. Before-and-After Measurements (`qstudent_mobile`, `390x844`, Median of 3 Runs)
| Metric | Before Phase 5C-V | After Phase 5C-V | Delta |
|---|---:|---:|---:|
| **Mobile Lighthouse Score** | 60 | **72** | **+12 pts (+20%)** |
| **CLS** | **0.254** | **0.000** | **-100% (Eliminated)** |
| **FCP** | 632 ms | **638 ms** | +6 ms (unchanged) |
| **LCP** | 632 ms | **638 ms** | +6 ms (unchanged) |
| **Speed Index** | 1,326 ms | **1,243 ms** | **-83 ms (-6.3%)** |
| **TBT** | 1,965 ms | **1,941 ms** | -24 ms (note below) |
| **JS Resource Size** | 3,683 KB | 3,683 KB | 0 KB |

*Note on TBT*: Lighthouse's TBT measurement window stays open until CPU/network idle, so even a `1,800 ms` deferred `Lanyard` (`3.31 MB` Three.js + Rapier WASM) still executes within Lighthouse's observation window (`~1.7 s` physics/WebGL init). Deferring by `1,800 ms` improves real-world time-to-usable-dashboard controls without hiding the genuine cost of initializing Three.js + Rapier WASM on mobile.

---

## 9. Quran Student Browser Verification
- Verified `StudentPortal` on both `1280x800` and `390x844` with `wsCount = 1`, `failedChunks = []`, `consoleErrors = []`, reserved `.lanyard-stage-active` stage from initial paint, and preserved Show/Hide ID card toggle.

---

## 10. Tuition Student Browser Verification
- Verified `TuitionStudentPortal` shares the exact `.lanyard-stage-active` reservation (`Lanyard.css`), `1800` ms deferral, immediate mount on toggle, and `React.lazy` + `LazyChunkErrorBoundary` + `React.Suspense` boundaries (`tests/phase4d_v4_lanyard_layout.test.ts` and `tests/phase5c_v_lanyard_cls_defer.test.ts` pass).

---

## 11. Bundle and Memory Measurements
- `index` bundle: `360.92 KB` raw (`102.88 KB` gzip) — `Lanyard.css` (`3.94 KB` raw / `0.96 KB` gzip) is emitted alongside `StudentPortal` / `TuitionStudentPortal`, leaving Login, Coordinator, Teacher, and Platform Admin unaffected.
- `Lanyard` JS chunk: `3,311.35 KB` raw (`1,128.59 KB` gzip), still lazy-loaded only on Student portals.

---

## 12. Automated Test Results
- `npm run typecheck`: **Passed** (`tsc --noEmit`, exit code `0`).
- `npm run build`: **Passed** (`vite build`).
- `node --test tests\*.test.ts`: **107 passed, 0 failed, 0 skipped** (all 105 Phase 5C tests + 2 new tests in `tests/phase5c_v_lanyard_cls_defer.test.ts`).
- `backend/manage.py check`: **Passed** (`System check identified no issues (0 silenced)`).
- Temporary QA users (`qa_5cv_*`, 6 users) and scratch session files were deleted cleanly.

---

## 13. Remaining Performance Bottlenecks
1. **Lanyard 3D + Rapier WASM Weight (`3.31 MB` JS / `1.13 MB` gzip, `~1.7–1.9 s` mobile TBT)**: Initializing Three.js + Rapier physics WASM on 4x-throttled mobile CPU remains the dominant TBT cost on Student portals.
2. **`App.tsx` Coordinator Shell (`~74 KB` in `index-*.js`)**: Still bundled for Login, Teacher, Student, Tuition, and Platform Admin.

---

## 14. Safe Phase-Specific Rollback
To revert only Phase 5C-V without disturbing Phases 2A–5C:
1. Revert the `Lanyard.css` import, `1800` ms timeout, and `handleStudentCardToggle` changes in `components/StudentPortal.tsx` and `components/tuition/TuitionStudentPortal.tsx`.
2. Delete `tests/phase5c_v_lanyard_cls_defer.test.ts` and `PERFORMANCE_PHASE_5C_VERIFICATION.md`, then run `npm run build`.

---

## 15. Recommendation
**KEEP Phase 5C + Phase 5C-V** — Phase 5C-V closed the scheduling persistence and role-verification gaps, eliminated the `0.254` mobile CLS (`→ 0.000`) on Student portals, raised Quran Student mobile Lighthouse score from `60 → 72`, and kept all `107/107` frontend tests passing. Ready for **Phase 5D** (extracting `QuranCoordinatorPortal` from `App.tsx`, or optimizing `AttendanceEditor` / Lanyard mobile behavior) when authorized.
