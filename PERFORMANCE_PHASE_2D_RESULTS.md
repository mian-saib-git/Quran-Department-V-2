# IVS Academy — Phase 2D Results: JavaScript Bundle and Initial Page Loading Optimization

**Date:** 2026-11-17  
**Scope:** Frontend code splitting, lazy loading of 3D Lanyard and heavy portal sub-tabs/panels, and chunk error boundaries.  
**Visual Design / Backend / Schema / Business Logic:** Unchanged.

---

## 1. Main Startup Bottlenecks & Heavy Dependencies Identified

1. **3D Lanyard (`Lanyard-*.js`, `3,337.25 kB` raw / `1,139.10 kB` gzip):**
   - `components/StudentPortal.tsx` and `components/tuition/TuitionStudentPortal.tsx` statically imported `Lanyard` (`three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/rapier`, `meshline`). This forced every student login to download and initialize **3.34 MB** of 3D/WASM JS before rendering the portal.
2. **Tuition Coordinator Portal (`230.68 kB` + eager `lottie-react` `317.33 kB`):**
   - `components/tuition/TuitionCoordinatorPortal.tsx` statically imported all 7 sub-tabs/modals (`TuitionAccountsEnrollment`, `TuitionAttendance`, `TuitionReports`, `TuitionScheduling`, `TuitionInsightsPanel`, `TuitionDepartmentSettingsModal`, `TuitionAssistantChat`), and `TuitionAssistantChat.tsx` statically imported `lottie-react` (`317.33 kB`) even though `TuitionAiAvatar` was rendered in the sidebar.
3. **Platform Admin (`394.19 kB` + eager Recharts `325.41 kB`):**
   - `components/PlatformAdmin.tsx` statically imported `PlatformAnalyticsOverview` (which imports `recharts`), `PlatformCommunicationsPanel`, `PlatformSalaryApprovals`, and `DepartmentSettings`.
4. **Teacher Portal (`131.01 kB`):**
   - `components/TeacherPortal.tsx` statically imported `TeacherSalarySelfService`, which is only needed when opening the Salary tab.
5. **Already Lazy-Loaded (Verified):**
   - `App.tsx` already lazy-loaded all major role portals and Quran Coordinator tabs; `ReportsTab.tsx`, `TuitionReports.tsx`, and `salaryV2Pdf.ts` already dynamically imported `exceljs` (`940.20 kB`) and `jspdf` (`390.59 kB`).
   - `index-*.css` (`289.36 kB` raw / `39.13 kB` gzip) is a single Tailwind + custom theme stylesheet; left untouched per Phase 2D rules (no broad CSS refactor).

---

## 2. Exact Files Modified / Added

1. `components/ui/LazyChunkErrorBoundary.tsx` *(added)*
   - Error boundary protecting lazy-loaded chunks against network or WebGL initialization failures without crashing the host portal.
2. `components/StudentPortal.tsx` & `components/tuition/TuitionStudentPortal.tsx` *(modified)*
   - Converted `Lanyard` to `React.lazy(...)` wrapped in `<LazyChunkErrorBoundary fallback={null}>` and `<React.Suspense fallback={null}>`.
   - Deferred `lanyardMounted` via `setTimeout(..., 0)` until `loading === false` and `studentCardVisible === true`, so the student's overview, schedules, and stats render immediately without waiting for `3.31 MB` of Three.js/Rapier WASM.
3. `components/tuition/TuitionAiAvatar.tsx` *(added)* & `components/tuition/TuitionAssistantChat.tsx` *(modified)*
   - Extracted `TuitionAiAvatar` into its own module and lazy-loaded `lottie-react` inside it, decoupling `TuitionAssistantChat` (`12.52 kB`) and `lottie-react` (`317.33 kB`) from `TuitionCoordinatorPortal`.
4. `components/tuition/TuitionCoordinatorPortal.tsx` *(modified)*
   - Converted `TuitionAccountsEnrollment`, `TuitionAttendance`, `TuitionReports`, `TuitionScheduling`, `TuitionInsightsPanel`, `TuitionDepartmentSettingsModal`, and `TuitionAssistantChat` to `React.lazy(...)` with `<LazyChunkErrorBoundary>` and `<React.Suspense>`.
   - Conditionally mounts `TuitionAssistantChat` only when `tuitionAssistantOpen` is `true`.
5. `components/PlatformAdmin.tsx` *(modified)*
   - Converted `DepartmentSettings`, `PlatformCommunicationsPanel`, `PlatformAnalyticsOverview`, and `PlatformSalaryApprovals` to `React.lazy(...)` with `<LazyChunkErrorBoundary>` and `<React.Suspense>`.
6. `components/TeacherPortal.tsx` *(modified)*
   - Converted `TeacherSalarySelfService` to `React.lazy(...)` with `<LazyChunkErrorBoundary>` and `<React.Suspense>`.
7. `tests/phase2d_bundle_lazy_loading.test.ts` *(added)*
   - 5 regression tests verifying all lazy imports, error boundaries, and deferred Lanyard mounting.

---

## 3. Bundle Sizes Before vs. After (`vite build`)

| Chunk / Asset | Before (Raw / Gzip) | After (Raw / Gzip) | Change |
|---|---:|---:|---|
| `index-*.js` (main entry) | `404.44 kB` / `111.75 kB` | `404.35 kB` / `111.72 kB` | Unchanged (entry already lazy-loads portals) |
| `index-*.css` (main CSS) | `289.34 kB` / `39.12 kB` | `289.36 kB` / `39.13 kB` | Unchanged |
| `TuitionCoordinatorPortal-*.js` | `230.68 kB` / `56.00 kB` | **`36.26 kB` / `9.48 kB`** | **-84.3% raw (-83.1% gzip)** |
| `PlatformAdmin-*.js` | `394.19 kB` / `98.50 kB` | **`236.83 kB` / `63.05 kB`** | **-39.9% raw (-36.0% gzip)** |
| `TeacherPortal-*.js` | `131.01 kB` / `30.55 kB` | **`120.39 kB` / `27.80 kB`** | **-8.1% raw (-9.0% gzip)** |
| `Lanyard-*.js` (3D bundle) | `3,337.25 kB` / `1,139.10 kB` (eager on student mount) | `3,311.32 kB` / `1,128.57 kB` (**deferred post-paint**) | **-3.31 MB** removed from initial student render path |
| Newly split Tuition sub-chunks | Bundled in `TuitionCoordinatorPortal` | `TuitionAccountsEnrollment` (`88.35 kB`), `TuitionReports` (`52.96 kB`), `TuitionScheduling` (`23.92 kB`), `TuitionAssistantChat` (`12.52 kB`), `TuitionInsightsPanel` (`8.31 kB`), `TuitionDepartmentSettingsModal` (`6.93 kB`), `TuitionAttendance` (`6.00 kB`) | Loaded on demand per tab/modal |
| Newly split Admin & Teacher chunks | Bundled in `PlatformAdmin` / `TeacherPortal` | `PlatformAnalyticsOverview` (`99.97 kB`), `PlatformCommunicationsPanel` (`23.44 kB`), `PlatformSalaryApprovals` (`21.11 kB`), `DepartmentSettings` (`16.39 kB`), `TeacherSalarySelfService` (`11.40 kB`) | Loaded on demand per tab/modal |

---

## 4. Impact by Role (Initial Portal Load)

- **Student / Tuition Student:** Initial portal renders from `StudentPortal` (`67.39 kB` / `15.51 kB` gzip) or `TuitionStudentPortal` (`48.95 kB` / `13.35 kB` gzip) without blocking on `Lanyard` (`3,311.32 kB` / `1,128.57 kB` gzip). `Lanyard` streams in asynchronously after initial dashboard data paints.
- **Tuition Coordinator:** Initial portal JS drops from `230.68 kB` (+ `317.33 kB` `lottie-react`) to **`36.26 kB` (`9.48 kB` gzip)** for the portal shell + `TuitionInsightsPanel` (`8.31 kB`) on dashboard.
- **Platform Admin:** Initial portal JS drops from `394.19 kB` to **`236.83 kB` (`63.05 kB` gzip)** (`PlatformAnalyticsOverview` `99.97 kB` loads for the Overview tab, while Communications, Salary Approvals, and Department Settings only load when opened).
- **Quran Teacher:** Initial portal JS drops from `131.01 kB` to **`120.39 kB` (`27.80 kB` gzip)** (`TeacherSalarySelfService` `11.40 kB` only loads when opening Salary).
- **Quran Coordinator / Department Admin:** Main `index-*.js` (`404.35 kB` / `111.72 kB` gzip) and lazy-loaded Quran tabs remain intact.

---

## 5. Browser Metrics & Limitations

- **Browser Tooling Limitation:** Interactive browser DevTools / Lighthouse / Playwright profiling (LCP, INP, TBT, main-thread execution time, live network waterfalls on slow 3G/mid-range devices) was **not** available in this CLI environment. Build-size and gzip transfer comparisons above are exact `vite build` measurements; runtime TBT/LCP improvements are expected from removing 3.31 MB of Three.js/Rapier WASM and 157–194 kB of sub-tab JS from initial synchronous evaluation, but are not directly browser-measured here.
- **Lanyard Visual Behavior:** Because `studentCardVisible` defaults to `true`, `Lanyard` still appears automatically on the Student Portal overview immediately after initial portal data loads, with a brief async load rather than blocking initial portal render.

---

## 6. TypeScript, Build & Regression Test Results

- `npm run typecheck` (`tsc --noEmit`): **Passed** (`0` errors).
- `npm run build` (`vite build`): **Passed** (`53.00s`, `3677` modules transformed).
- `node --experimental-strip-types --test tests/attendance_editor_incremental_update.test.ts tests/phase2b_polling_and_ws.test.ts tests/phase2c1_daily_lesson_reports.test.ts tests/phase2c2_salary_assignments.test.ts tests/phase2d_bundle_lazy_loading.test.ts`: **Passed** (`24/24` tests passed in `874.7 ms`).

---

## 7. Remaining Performance Opportunities

- **`App.tsx` (`404.35 kB` main entry, `5,580` lines):** Splitting Quran Coordinator's inline Dashboard JSX and Login view out of `App.tsx` into lazy-loaded components would further shrink the initial `index-*.js` bundle for all non-coordinator roles.
- **`PlatformAdmin.tsx` (`236.83 kB`):** Splitting the inline Institutions/Departments/Audit/Backups tabs out of `PlatformAdmin.tsx` would reduce its chunk size further.
- **`index.css` (`289.36 kB` raw / `39.13 kB` gzip):** Auditing unused custom CSS classes in a dedicated CSS phase.

---

## 8. Rollback Instructions

To revert Phase 2D:
```powershell
git checkout -- components/StudentPortal.tsx components/tuition/TuitionStudentPortal.tsx components/tuition/TuitionCoordinatorPortal.tsx components/tuition/TuitionAssistantChat.tsx components/PlatformAdmin.tsx components/TeacherPortal.tsx
Remove-Item components/ui/LazyChunkErrorBoundary.tsx, components/tuition/TuitionAiAvatar.tsx, tests/phase2d_bundle_lazy_loading.test.ts
```
