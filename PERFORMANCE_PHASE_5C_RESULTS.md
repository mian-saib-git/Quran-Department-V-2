# PERFORMANCE_PHASE_5C_RESULTS.md

## 1. Fresh Baseline Lighthouse Measurements
Measured against the post-Phase-5B-V Vite production build (`dist/`) served locally with `/api/*` and `/ws/*` proxied to Django (`127.0.0.1:5000`), using Chrome Lighthouse (`3` runs per mobile screen, median reported; `1` representative desktop run per screen):

| Screen / Route | Form Factor | Cache | Score | FCP | LCP | SI | TBT | CLS | Main Thread | Bootup | Unused JS | JS Transfer / Resource |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Login (`/`) | Mobile | Cold | 80 | 2,258 ms | 4,837 ms | 2,258 ms | 65 ms | 0 | 1,403 ms | 221 ms | 204 KB | 397 / 396 KB |
| Login (`/`) | Mobile | Warm | 100 | 629 ms | 1,095 ms | 725 ms | 48 ms | 0 | 1,170 ms | 186 ms | 204 KB | 0 / 396 KB |
| Quran Coordinator (`#dashboard`) | Mobile | Warm | 88 | 760 ms | 2,403 ms | 1,476 ms | 386 ms | 0 | 1,839 ms | 544 ms | 165 KB | 0 / 396 KB |
| Quran Teacher (`#dashboard`) | Mobile | Warm | 97 | 639 ms | 639 ms | 1,514 ms | 199 ms | 0 | 1,637 ms | 531 ms | 214 KB | 0 / 519 KB |
| Quran Student (`#dashboard`) | Mobile | Warm | 60 | 627 ms | 627 ms | 1,208 ms | 1,947 ms | 0.254 | 5,148 ms | 3,345 ms | 769 KB | 0 / 3,726 KB |
| Tuition Coordinator (`#dashboard`) | Mobile | Warm | 93 | 634 ms | 634 ms | 907 ms | 324 ms | 0 | 3,042 ms | 1,171 ms | 368 KB | 0 / 755 KB |
| Platform Admin (`#platform-admin`) | Mobile | Warm | 97 | 631 ms | 631 ms | 990 ms | 181 ms | 0 | 1,144 ms | 327 ms | 191 KB | 0 / 396 KB |
| Login (`/`) | Desktop | Warm | 96 | 616 ms | 1,112 ms | 806 ms | 120 ms | 0 | 1,344 ms | 186 ms | 204 KB | 0 / 396 KB |
| Quran Coordinator (`#dashboard`) | Desktop | Warm | 83 | 746 ms | 746 ms | 1,345 ms | 342 ms | 0 | 2,119 ms | 566 ms | 165 KB | 0 / 396 KB |

---

## 2. Initial JavaScript Dependency Analysis
Using `esbuild` metafile splitting on `index.tsx`, the baseline `index` bundle (`405.72 KB` raw / `112.89 KB` gzip in Vite) contained:
- `react-dom-client.production.js`: `172.8 KB`
- `App.tsx`: `73.7 KB`
- `components/LoginScreen.tsx`: `17.7 KB`
- `components/ClassCard.tsx` (via `CoordinatorLiveClassesSection.tsx`): `15.4 KB`
- `components/dashboard/CoordinatorDashboardInsights.tsx`: `8.0 KB`
- `components/MaintenanceScreen.tsx`: `5.1 KB`
- `components/FeatureLockedModal.tsx`: `4.2 KB`
- `components/GlobalNoticeCenter.tsx`: `4.0 KB`
- `services/storageService.ts`: `4.0 KB`
- `components/dashboard/DashboardPrimitives.tsx`: `3.3 KB`
- `components/dashboard/CoordinatorDashboardKpis.tsx`: `2.7 KB`
- `components/dashboard/CoordinatorLiveClassesSection.tsx`: `2.6 KB`

---

## 3. Actual Root Cause of Startup Blocking
1. **Unauthenticated & Non-Coordinator Routes Downloaded Coordinator Dashboard & Conditional Modules**: `App.tsx` eagerly imported `CoordinatorDashboardKpis`, `CoordinatorLiveClassesSection` (which pulls in `ClassCard.tsx`), `CoordinatorDashboardInsights`, `MaintenanceScreen`, `FeatureLockedModal`, and `GlobalNoticeCenter` at the top level. Every Login, Teacher, Student, Tuition, and Platform Admin user downloaded and evaluated these modules unnecessarily (`204 KB` unused JS on Login).
2. **Remaining Structural Root**: `App.tsx` itself (`73.7 KB`) still houses Coordinator-only modals, CSV import, and state handlers inline, which accounts for the remaining unused JS on Login and non-Coordinator portals.

---

## 4. Optimization Options Considered
| Option | Assessment | Decision |
|---|---|---|
| Full `App.tsx` Coordinator extraction / rewrite | High impact, but violates Phase 5C rule ("Do not perform a complete `App.tsx` rewrite"). | Deferred to Phase 5D |
| Arbitrary `manualChunks` splitting | Risk of waterfall chunk requests without reducing total parse work. | Rejected |
| **Lazy-load Coordinator dashboard sections + conditional modals/screens in `App.tsx`** | Contained, low-risk change using existing `React.lazy` + `Suspense` pattern; removes `~53 KB` raw JS (`ClassCard`, dashboard panels, modals, notices, maintenance) from `index-*.js`. | **Selected** |

---

## 5. Selected Change and Justification
Converted 6 eager imports in `App.tsx` to `React.lazy(...)` wrapped in `<Suspense>`, and gated `FeatureLockedModal` (`{lockedFeature && ...}`) and `GlobalNoticeCenter` (`{platformNotices.length > 0 && ...}`) so their chunks are not even fetched unless active:
- `CoordinatorDashboardKpis` (`2.74 KB` chunk)
- `CoordinatorLiveClassesSection` + `ClassCard` (`18.12 KB` chunk)
- `CoordinatorDashboardInsights` (`8.15 KB` chunk)
- `MaintenanceScreen` (`5.08 KB` chunk)
- `FeatureLockedModal` (`4.54 KB` chunk)
- `GlobalNoticeCenter` (`4.20 KB` chunk)

---

## 6. Exact Files Modified
- **`App.tsx`**: Converted the 6 imports above to `React.lazy` and wrapped their render sites in `<Suspense>` (with conditional `{lockedFeature && ...}` and `{platformNotices.length > 0 && ...}` guards).
- **`tests/phase4c_live_classes_extraction.test.ts`**, **`tests/phase4d_dashboard_kpis_extraction.test.ts`**, **`tests/phase4e_dashboard_insights_extraction.test.ts`**: Updated the 3 import-syntax string checks from `from "./components/dashboard/..."` to `import("./components/dashboard/...")`.
- **`tests/phase5c_startup_bundle_lazy.test.ts`** (new): Added 3 tests verifying lazy imports, conditional `<Suspense>` gating, and `esbuild` metafile exclusion of all 7 modules from `index.js`.
- **`components/SchedulingTab.tsx`, `services/storageService.ts`, backend code**: Unchanged.

---

## 7. Before-and-After Lighthouse Results (Median of 3 Runs on Mobile)
| Screen / Route | Form Factor | Cache | Score (Before → After) | FCP | LCP | TBT | Unused JS | JS Resource / Transfer |
|---|---|---|---:|---:|---:|---:|---:|---:|
| **Login (`/`)** | Mobile | Cold | 80 → **82** (+2) | 2,258 → **2,256 ms** | 4,837 → **4,534 ms** (-303 ms) | 65 → **27 ms** (-58.5%) | 204 → **166 KB** (-38 KB) | 397 → **353 KB** transfer |
| **Login (`/`)** | Mobile | Warm | 100 → **100** | 629 → **629 ms** | 1,095 → **1,096 ms** | 48 → **32 ms** (-33.3%) | 204 → **166 KB** | 396 → **352 KB** |
| **Quran Coord (`#dashboard`)** | Mobile | Warm | 88 → **92** (+4) | 760 → **641 ms** (-119 ms) | 2,403 → **2,163 ms** (-240 ms) | 386 → **327 ms** (-59 ms) | 165 → **139 KB** (-26 KB) | 396 → **384 KB** |
| **Quran Teacher (`#dashboard`)** | Mobile | Warm | 97 → **97** | 639 → 640 ms | 639 → 640 ms | 199 → 203 ms | 214 → **178 KB** (-36 KB) | 519 → **475 KB** (-44 KB) |
| **Quran Student (`#dashboard`)** | Mobile | Warm | 60 → **60** | 627 → 632 ms | 627 → 632 ms | 1,947 → 1,965 ms | 769 → **734 KB** (-35 KB) | 3,726 → **3,683 KB** |
| **Tuition Coord (`#dashboard`)** | Mobile | Warm | 93 → **94** (+1) | 634 → 634 ms | 634 → 634 ms | 324 → **300 ms** (-24 ms) | 368 → **336 KB** (-32 KB) | 755 → **714 KB** (-41 KB) |
| **Platform Admin (`#platform-admin`)** | Mobile | Warm | 97 → **100** (+3) | 631 → 636 ms | 631 → 636 ms | 181 → **67 ms** (-63.0%) | 191 → **159 KB** (-32 KB) | 396 → **352 KB** (-44 KB) |
| **Login (`/`)** | Desktop | Warm | 96 → **97** (+1) | 616 → 616 ms | 1,112 → 1,118 ms | 120 → **83 ms** (-30.8%) | 204 → **166 KB** | 396 → **352 KB** |

---

## 8. Main-Thread and Bundle-Size Comparison
- **Vite `index` bundle**: `405.72 KB` raw (`112.89 KB` gzip) → **`352.43 KB` raw** (**-53.29 KB**, **-13.1%**).
- **Split lazy chunks**: `CoordinatorLiveClassesSection` (`18.12 KB`), `CoordinatorDashboardInsights` (`8.15 KB`), `MaintenanceScreen` (`5.08 KB`), `FeatureLockedModal` (`4.54 KB`), `GlobalNoticeCenter` (`4.20 KB`), `CoordinatorDashboardKpis` (`2.74 KB`).
- **Login Cold Bootup Time**: `221 ms → 189 ms` (-14.5%).
- **Platform Admin Main-Thread Time**: `1,144 ms → 988 ms` (-13.6%).

---

## 9. Desktop and Mobile Browser Verification
- All 6 screens rendered cleanly under Lighthouse Chrome mobile (`390x844`) and desktop (`1350x940`) runs with `CLS = 0` on Login, Quran Coordinator, Quran Teacher, Tuition Coordinator, and Platform Admin.
- Local Lighthouse HTML and JSON artifacts are preserved in `C:\Users\iqrav\.gemini\antigravity\brain\06af655a-4a70-44cb-be7b-79279cd12a1d\scratch\lighthouse-5c\` (`baseline/` and `after/`).

---

## 10. Functional Regression Results
- Temporary QA accounts (`qa_5c_*`, 6 users) were used for Lighthouse runs and deleted cleanly afterward.
- Phase 5A/5A-V state deduplication, Phase 5B/5B-V `SchedulingTab` 2D virtualization, WebSocket protocol, and department isolation were untouched.

---

## 11. Scheduling Verification Preflight
- Verified `QA_5BV` users in Django DB: `0` leftover records.
- Confirmed why `persistedAfterReload` was `false` in Phase 5B-V: `services/storageService.ts` `saveState` intentionally updates local cache only (`// Do not POST the full state here`) while `SchedulingTab` preserves edits across offscreen scrolling (`visibleAfterScrollBack = true`) with `0 px` row gaps/overlaps.

---

## 12. Existing Frontend Test Results
- `npm run typecheck`: **Passed** (`tsc --noEmit`, exit code `0`).
- `npm run build`: **Passed** (`vite build`).
- `node --test tests\*.test.ts`: **105 passed, 0 failed, 0 skipped** (102 existing tests + 3 new tests in `tests/phase5c_startup_bundle_lazy.test.ts`).
- `backend/manage.py check`: **Passed** (`System check identified no issues (0 silenced)`).

---

## 13. Remaining Startup Performance Issues
1. **`App.tsx` Monolith (`73.7 KB` in `index-*.js`)**: Coordinator-only modals, CSV import, and state handlers still live inside `App.tsx`, leaving `166 KB` of unused JS on Login and `159–178 KB` on Platform Admin / Teacher.
2. **Quran Student 3D Lanyard (`3.31 MB` JS + Rapier WASM)**: Causes `1,965 ms` mobile TBT and `0.254` CLS on `#dashboard` when the deferred 3D canvas initializes.
3. **CSS Bundle (`289.38 KB` raw / `39.13 KB` gzip)**: Loaded synchronously on initial boot.

---

## 14. Safe Phase-Specific Rollback Instructions
To revert only Phase 5C without disturbing Phases 2A–5B-V:
1. Revert the `React.lazy` / `<Suspense>` hunks in `App.tsx` back to synchronous imports for the 6 components.
2. Restore the 3 `from "./components/dashboard/..."` assertions in `tests/phase4c_live_classes_extraction.test.ts`, `tests/phase4d_dashboard_kpis_extraction.test.ts`, and `tests/phase4e_dashboard_insights_extraction.test.ts`.
3. Delete `tests/phase5c_startup_bundle_lazy.test.ts` and `PERFORMANCE_PHASE_5C_RESULTS.md`, then run `npm run build`.

---

## 15. Recommendation for Phase 5D
Extract the Quran Coordinator shell (sidebar, dashboard, modals, CSV import) from `App.tsx` into a lazy-loaded `QuranCoordinatorPortal.tsx` (matching `TeacherPortal`, `StudentPortal`, `TuitionCoordinatorPortal`, and `PlatformAdmin`) so `App.tsx` becomes a thin auth/role router and `index-*.js` drops by another `~55–65 KB` on Login and non-Coordinator portals.
