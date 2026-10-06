# IVS Performance Optimization Project

## Objective
Optimize speed, bundle size, rendering, API payloads, and database/query performance across the IVS application **without changing working business logic, permissions, attendance behavior, salary/payroll behavior, lifecycle rules, or UI meaning**.

## Operating Rules
1. Read this file before every optimization session.
2. Make small, measurable changes only.
3. Preserve unrelated staged/unstaged work.
4. Never run broad `git restore`, `git reset`, `git clean`, or mass formatting.
5. Do not redesign working features unless performance requires it.
6. Prefer lazy loading, memoized indexes, smaller API payloads, pagination, and query optimization before visual simplification.
7. Validate after every stage:
   - `npm run build`
   - `cd backend && python manage.py check`
   - `git diff --check`
   - manual regression test
   - Lighthouse / payload / query measurement when relevant.
8. Do not claim an improvement without measurement.
9. Update this file after every completed change.

---

## Current Baseline / Completed Work

### Stage 1 — Quran Coordinator Dashboard
**Status: Complete**

Completed:
- Production main JS reduced from about **3.97 MB to ~384 KB**.
- Main gzip reduced from about **1.30 MB to ~106 KB**.
- Lighthouse Performance improved from about **6 to 68–69**.
- FCP improved to about **0.8 s**.
- LCP improved to about **0.8 s**.
- TBT improved to about **210 ms**.
- Speed Index improved to about **2.0 s**.
- Remaining major metric: **CLS ~0.446**.
- `StudentPortal` lazy-loaded.
- `TeacherPortal` lazy-loaded.
- `SchedulingTab` lazy-loaded.
- Heavy Student Portal 3D/Lanyard stack isolated into its own ~3.3 MB lazy chunk.
- Recharts removed from initial Dashboard bundle.
- Dashboard timeline chart lazy-loaded only when Insights is opened.
- AI/Lottie startup work deferred.
- Dashboard state endpoint supports lightweight `?dashboard=true`.
- Dashboard attendance payload limited to today's attendance.
- Normal full-state attendance limits preserved.
- Teacher-subject N+1 backend query reduced via precomputed mapping.
- Dashboard teacher/student attendance lookups use maps instead of repeated `.find()`.
- Teacher multi-slot attendance fallback bug fixed.
- Partial Dashboard state prevented from replacing normal full cache.
- Production reload TDZ errors fixed.
- Production build passes.
- Django system check passes.
- Hard refresh on `/#dashboard` works.
- Real signed-in Dashboard Lighthouse validation on 2026-10-06:
  - Performance: **61**
  - FCP: **0.8 s**
  - LCP: **1.7 s**
  - TBT: **540 ms**
  - CLS: **0**
  - Speed Index: **4.6 s**
- Real signed-in Dashboard diagnostics captured:
  - Render-blocking requests estimated savings: **430 ms**
  - Improve image delivery estimated savings: **115 KiB**
  - Optimize DOM size flagged.
  - Network dependency tree flagged.
  - 3rd parties flagged.
  - Minimize main-thread work: **3.5 s**
  - Reduce unused JavaScript estimated savings: **85 KiB**
  - Reduce unused CSS estimated savings: **32 KiB**
  - Avoid long main-thread tasks: **8 long tasks**
  - Long task culprits include `index.es-CYmOC0z_.js` at **279 ms**, `index-B3tRnhTn.js` at **279 ms**, **97 ms**, **65 ms**, and **50 ms**, page root at **55 ms**, unattributable work at **458 ms** and **342 ms**, and `_lighthouse-eval.js` at **104 ms**.
- No Dashboard regressions were reported with the real signed-in validation.

Remaining:
- Stage 1A CLS work is complete, but Dashboard optimization is reopened as **Stage 1B** for real signed-in Lighthouse Performance >= 90.
- Current real signed-in Dashboard baseline: Performance ~61, FCP 1.2 s, LCP 2.9 s, TBT 440 ms, CLS 0, Speed Index 2.7 s.
- Stage 1B targets: Performance >= 90, FCP <= 1.0-1.2 s, LCP < 2.5 s, TBT < 200 ms preferred, CLS stays 0 / < 0.10, Speed Index <= 2.5 s.
- Highest-impact measured bottlenecks: `/api/academy/state/?dashboard=true` about 12.4 s and 452 KB, `/api/auth/notices/active/` about 9.8 s, `/api/auth/context/` about 3.2 s, main-thread work about 6.8 s, `index.es-CYmOC0z_.js` about 3.6 s CPU / 543 ms evaluation, `index-B3tRnhTn.js` about 1.0 s CPU / 803 ms evaluation, LCP render delay about 3.64 s, AssistantChat/Lottie/`ai-bot.json` in the initial dependency chain, coordinator icon about 116 KB for about 80px display, Google Fonts/CSS render-blocking.
- Stage 2 Attendance is paused until Stage 1B is complete or an external/environment limitation is documented.

---

## Optimization Roadmap

### Stage 2 — Attendance
**Status: Paused while Stage 1B Dashboard Lighthouse optimization is active.**

Targets:
- Coordinator attendance editor.
- Attendance V2.
- Mark/unmark responsiveness.
- Historical attendance loading.
- WebSocket-triggered refreshes.
- Large list/table rendering.
- Repeated filters/finds.
- API payload size and pagination.

Do not change attendance correctness or session/class-key semantics.

Pre-optimization inspection and baseline on 2026-10-06:
- `/#attendance` renders `AttendanceEditor` through a lazy route and currently relies on full `loadState(false)` app state rather than a date-scoped attendance payload.
- `AttendanceEditor` builds date/status maps client-side, filters/sorts scheduled students, derives teacher cards for all matching students before slicing to `PAGE_SIZE = 20`, and computes summary counts from the derived full lists.
- Relevant backend paths inspected: `AcademyStateView.get`, `AttendanceListCreateView.get`, attendance V2 teacher-session endpoints, and attendance URL routes.
- Mocked production Attendance baseline fixture: **60 teachers**, **900 students**, **2,000 attendance records**, `/api/academy/state/` JSON about **859 KB**.
- Production baseline, unthrottled: DOMContentLoaded **580 ms**, load **745 ms**, FP **632 ms**, FCP **784 ms**, LCP **784 ms**, CLS **0**, long tasks **0**, approximate TBT **0 ms**, DOM nodes **804**.
- Production baseline, 4x CPU throttle: DOMContentLoaded **373 ms**, load **536 ms**, FP **336 ms**, FCP **716 ms**, LCP **716 ms**, CLS **0**, long tasks **2**, approximate TBT **114 ms**, DOM nodes **804**.
- Attendance route resources in the baseline: main JS **106,310 B encoded**, Attendance lazy chunk **7,903 B encoded**, CSS **36,381 B encoded**.

Top 1-3 bottlenecks to address first:
- Largest measured risk is Attendance loading the full academy state through `/api/academy/state/`, including up to 2,000 attendance rows, for a page that primarily needs date-scoped attendance.
- Client derivation does repeated full-list work before pagination, especially teacher-card/session grouping, repeated status lookups, and summary counting over all filtered records.
- Attendance V2 teacher-session detail calls are deferred until marking teacher absence/leave; they should be measured during the first interactive optimization pass before changing them.

First optimization candidate:
- Add or route a date-scoped Attendance payload for the Attendance page so initial Attendance loading does not depend on the full historical attendance slice, while preserving full-state cache correctness and all class-key/session semantics.

### Stage 3 — Accounts & Enrollment
Targets:
- `CoordinatorAccounts`.
- Teacher/student list rendering.
- Search/filter cost.
- Account edit refreshes.
- Enrollment/drop/rejoin/history loading.
- Pagination or virtualization only if measurement justifies it.

### Stage 4 — Scheduling / Live Classes
Targets:
- Teacher × time-slot grid.
- Precompute schedule indexes.
- Avoid repeated student filtering per cell.
- Scroll/render performance.
- Mobile rendering.
- Avoid full-state reload after local mutations where safe.

### Stage 5 — Lessons / Reports / Exports
Targets:
- `CoordinatorLessons`.
- `ReportsTab`.
- Keep ExcelJS, jsPDF, html2canvas, export helpers out of normal startup.
- Load export libraries only on export action.
- Paginate histories.
- Remove backend N+1 queries.
- Reduce oversized report/lesson responses.

### Stage 6 — Salary / Platform Admin
Targets:
- Teacher Salary Management.
- Salary V2 workspace.
- Salary approvals.
- Platform Admin.
- Lazy-load proof/PDF/export functionality.
- Paginate histories and large datasets.
- Preserve all payroll lifecycle and locking rules.

### Stage 7 — Teacher / Student / Tuition Portals
Targets:
- Teacher Portal.
- Student Portal.
- Tuition Coordinator.
- Tuition Teacher.
- Tuition Student.
- Tuition Pending.
- Keep portal bundles isolated.
- Student 3D Lanyard should load only when actually needed/visible if further optimization is required.

### Stage 8 — Shared Backend / Database
Audit:
- N+1 queries.
- Serializer size.
- Repeated `.count()`.
- Missing pagination.
- Duplicate API requests.
- `select_related` / `prefetch_related`.
- Query indexes only when supported by measured query patterns.
- Response times and SQL query counts before/after.

### Stage 9 — Global Frontend Pass
Audit:
- Fonts.
- global CSS.
- expensive backdrop blur/shadows.
- image loading.
- Suspense fallbacks.
- WebSocket refresh strategy.
- cache behavior.
- layout shifts.
- dead imports.
- mobile performance.
- accessibility regressions.

---

## Standard Stage Workflow
For every stage:

1. **Measure**
   - Lighthouse where relevant.
   - bundle chunks.
   - API payload size.
   - request duration.
   - SQL query count if backend-heavy.

2. **Find top 2–3 bottlenecks**
   - Do not optimize everything at once.

3. **Patch**
   - Smallest safe change.
   - Preserve behavior and permissions.

4. **Validate**
   - build
   - Django check
   - diff check
   - manual feature test

5. **Measure again**
   - Record before/after.

6. **Update this file**
   - Mark completed work.
   - Record metrics.
   - Add remaining issues.

---

## Session Handoff Format
At the end of every Codex session, update this section:

### Last Session
- Date: 2026-10-06
- Stage: Stage 1B Dashboard Lighthouse reopened; Stage 2 Attendance paused.
- Files changed: `PROJECT.md`
- Changes made: Paused Stage 2 Attendance, deferred AssistantChat/Lottie/`ai-bot.json` until assistant user intent, and reduced the Dashboard API `dashboard=true` response shape while preserving full-state behavior.
- Before metrics: Current real signed-in Dashboard baseline: Performance ~61, FCP 1.2 s, LCP 2.9 s, TBT 440 ms, CLS 0, Speed Index 2.7 s.
- After metrics: Production build after patch: main `index-CFfVeRDt.js` 386.37 kB / gzip 106.31 kB, Lottie `index.es-am4I8YPo.js` 317.33 kB / gzip 82.14 kB, `AssistantChat-Dy6b8D2b.js` 21.95 kB / gzip 7.26 kB. Mocked production Dashboard startup under 4x CPU throttle loaded no `ai-bot.json`, no AssistantChat chunk, and no Lottie chunk before user intent; after clicking the AI button, AssistantChat, `ai-bot.json`, and Lottie loaded and the assistant panel appeared. Dashboard API shape estimate dropped from 517,989 B raw to 211,398 B raw on a 60-teacher/900-student fixture.
- Tests run: `npm run build` passed after sandbox-denied first attempt was rerun outside sandbox; `python manage.py check` still blocked by missing local Python 3.12 target; `git diff --check -- App.tsx backend\academy\views.py PROJECT.md` passed with line-ending warnings; production Dashboard browser probes passed for deferred AI assets, assistant-open behavior, minimal payload rendering, and CLS 0.
- Known regressions: None reported; CLS is already 0 and must not regress.
- Remaining bottlenecks: Real Dashboard API timing/payload needs remeasurement, auth/notices startup latency remains, main app render work remains, LCP render delay remains, coordinator image size remains, and Google Fonts/CSS remain render-blocking.
- Exact next step: Run real signed-in production Lighthouse and network timing for Dashboard; if `/api/academy/state/?dashboard=true` is still a top bottleneck, measure query count with a repaired Python runtime, otherwise proceed to auth/context and notices startup.

---

## Current Next Step
Continue **Stage 1B Dashboard Lighthouse optimization** with real validation:
1. run a real signed-in production Dashboard Lighthouse/network pass on the same profile/settings;
2. record Performance, FCP, LCP, TBT, CLS, Speed Index, startup resource chain, and `/api/academy/state/?dashboard=true`, `/api/auth/context/`, `/api/auth/notices/active/` timings/payloads;
3. if Dashboard API remains the largest bottleneck, repair Python/runtime or use a working backend shell to measure query count and response construction cost;
4. if API improves enough, move to auth/context and notices startup latency;
5. keep CLS at 0 and checkpoint `PROJECT.md` before any further patch.

---

## Mandatory Continuous Checkpoint Rule

`PROJECT.md` is the persistent source of truth for this optimization project.

Do NOT wait until the end of the session to update it.

After every meaningful step, immediately update `PROJECT.md` before continuing.

A meaningful step includes:
- code changed
- file added/removed
- optimization applied
- bug discovered
- bug fixed
- build/test/check completed
- Lighthouse/API/query measurement completed
- regression discovered
- decision made not to pursue an optimization
- stage/sub-stage completed
- next action changed

Each checkpoint should record only what is necessary:

### Checkpoint
- Stage:
- Sub-step:
- Files changed:
- Change:
- Result:
- Validation:
- Metrics:
- Known issue:
- Next exact step:

Keep checkpoints concise.

If the session/token limit is close, STOP new coding work and update `PROJECT.md` first.

Before ending for ANY reason:
1. update `PROJECT.md`
2. record current repository state relevant to the task
3. record unfinished work
4. record the exact next command/action
5. ensure another fresh session can continue without needing chat history

Never rely on conversation memory as the only record of completed optimization work.

---

## Session Checkpoints

### Checkpoint
- Stage: Stage 1 Dashboard CLS
- Sub-step: Preflight after reading optimization prompt and project handoff.
- Files changed: `PROJECT.md`
- Change: Confirmed Current Next Step is Stage 1 CLS; found existing dirty/staged work across app/backend, so edits must stay limited to Dashboard performance files.
- Result: Proceeding to locate Lighthouse layout-shift evidence and Dashboard render/CSS sources before code changes.
- Validation: Not run yet.
- Metrics: Existing baseline in this file remains Lighthouse Performance ~68-69, CLS ~0.446, TBT ~210 ms.
- Known issue: Worktree contains unrelated dirty/staged files that must be preserved.
- Next exact step: Locate Lighthouse artifacts or rerun production Lighthouse if no usable report exists, then inspect only the CLS culprit files.

### Checkpoint
- Stage: Stage 1 Dashboard CLS
- Sub-step: CLS culprit inspection.
- Files changed: `PROJECT.md`
- Change: No saved Lighthouse artifact found in the repo; inspected Dashboard render path in `App.tsx` and related Dashboard CSS.
- Result: Likely CLS culprit is Dashboard rendering from `INITIAL_STATE` after feature context loads but before `loadState()` hydration completes, then reflowing when real students/classes/attendance arrive.
- Validation: Not run yet.
- Metrics: No new Lighthouse run yet; baseline remains CLS ~0.446.
- Known issue: Local Lighthouse CLI is not installed; Chrome exists at `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- Next exact step: Patch Dashboard content to show a layout-sized skeleton while `!hydrated`, then run production build/checks and rerun browser CLS measurement if possible.

### Checkpoint
- Stage: Stage 1 Dashboard CLS
- Sub-step: Dashboard hydration skeleton patch.
- Files changed: `App.tsx`, `PROJECT.md`
- Change: Dashboard route now renders a `PageSkeleton` with `delayMs={0}` while `hydrated` is false, preserving layout-sized content until academy state finishes loading.
- Result: Empty `INITIAL_STATE` Dashboard no longer renders before real students/classes/attendance arrive.
- Validation: Not run yet.
- Metrics: Measurement pending.
- Known issue: Need production validation and CLS measurement.
- Next exact step: Run `npm run build`, `cd backend && python manage.py check`, and `git diff --check`.

### Checkpoint
- Stage: Stage 1 Dashboard CLS
- Sub-step: Required validation pass.
- Files changed: `PROJECT.md`
- Change: Ran production build and backend check attempt after hydration skeleton patch.
- Result: `npm run build` passed when rerun outside the sandbox after sandbox access-denied errors; `python manage.py check` could not run because `backend/venv` points to missing `C:\Users\iqrav\AppData\Local\Programs\Python\Python312\python.exe`.
- Validation: `npm run build` passed; `git diff --check` passed with line-ending warnings only; Django check blocked by missing Python runtime.
- Metrics: Build output: main `index-ChxJ-DPs.js` 384.61 kB, gzip 105.97 kB; CSS 274.09 kB, gzip 36.37 kB; Dashboard timeline lazy chunk 1.27 kB, gzip 0.76 kB.
- Known issue: Need a working Python runtime/venv to run Django system check.
- Next exact step: Start production preview and collect Dashboard CLS measurement/regression evidence, or fix local Python runtime before backend validation if available.

### Checkpoint
- Stage: Stage 1 Dashboard CLS
- Sub-step: Production CLS probe after hydration skeleton patch.
- Files changed: `PROJECT.md`
- Change: Started production preview on `http://127.0.0.1:4174/` and used headless Chrome with mocked coordinator auth/state responses to measure the Dashboard boot path.
- Result: CLS improved target not met; measured CLS was 0.2745, with the recorded layout-shift source being the whole app shell appearing after the small centered "Loading department workspace" screen.
- Validation: Browser probe rendered the Dashboard with 18 mocked students, 8 teachers, and 14 class cards.
- Metrics: CLS 0.2745 in mocked production Dashboard boot; skeleton was gone after hydration and Dashboard data rendered.
- Known issue: The permission-loading screen does not reserve sidebar/header/content layout, causing shell-level shift before Dashboard data hydration.
- Next exact step: Replace the centered department-loading screen with an app-shell-shaped loading skeleton, then rebuild and rerun the CLS probe.

### Checkpoint
- Stage: Stage 1 Dashboard CLS
- Sub-step: Department workspace loading shell patch.
- Files changed: `App.tsx`, `PROJECT.md`
- Change: Added `DepartmentWorkspaceLoading` and replaced the centered feature-context loading card with a sidebar/header/content skeleton matching the eventual Quran workspace geometry.
- Result: App shell space is reserved before feature context completes.
- Validation: Not run after this patch yet.
- Metrics: Measurement pending.
- Known issue: Need rebuild and repeat CLS probe.
- Next exact step: Run `npm run build`, rerun the production preview if needed, and repeat the mocked Dashboard CLS probe.

### Checkpoint
- Stage: Stage 1 Dashboard CLS
- Sub-step: Production build after loading shell patch.
- Files changed: `PROJECT.md`
- Change: Rebuilt frontend after adding the app-shell-shaped loading state.
- Result: `npm run build` passed.
- Validation: Production build passed.
- Metrics: Main `index-B3tRnhTn.js` 386.27 kB, gzip 106.31 kB; CSS 274.11 kB, gzip 36.38 kB; Dashboard timeline lazy chunk 1.27 kB, gzip 0.76 kB.
- Known issue: Django check still blocked by missing Python runtime.
- Next exact step: Rerun the mocked production Dashboard CLS probe against the rebuilt preview.

### Checkpoint
- Stage: Stage 1 Dashboard CLS
- Sub-step: Final mocked production CLS validation.
- Files changed: `PROJECT.md`
- Change: Reran the mocked coordinator Dashboard boot probe against rebuilt production preview on `http://127.0.0.1:4174/`.
- Result: CLS probe passed with no layout-shift entries; Dashboard rendered expected mocked data and class cards.
- Validation: `git diff --check` passed with CRLF warnings only.
- Metrics: CLS 0.0000; 18 mocked students, 8 teachers, 14 class cards; skeleton not visible after hydration.
- Known issue: Full signed-in Lighthouse and Django system check remain blocked by missing local Lighthouse CLI/live backend Python runtime.
- Next exact step: Fix `backend/venv`/Python, run `python manage.py check`, then run real signed-in production Lighthouse on `/#dashboard`.

### Checkpoint
- Stage: Stage 1 Dashboard completion / Stage 2 Attendance handoff
- Sub-step: Real signed-in Dashboard validation recorded.
- Files changed: `PROJECT.md`
- Change: Recorded real signed-in Dashboard Lighthouse results, marked Stage 1 complete, and moved Current Next Step to Stage 2 Attendance pre-optimization only.
- Result: CLS is confirmed below target at 0; no Dashboard regressions were reported.
- Validation: Real signed-in Lighthouse provided by user; local `python manage.py check` still blocked by missing Python runtime.
- Metrics: Performance 61; FCP 0.8 s; LCP 1.7 s; TBT 540 ms; CLS 0; Speed Index 4.6 s; render-blocking estimate 430 ms; image delivery estimate 115 KiB; unused JS estimate 85 KiB; unused CSS estimate 32 KiB; main-thread work 3.5 s; 8 long tasks.
- Known issue: Concrete Django check pass/fail was not provided; local venv remains broken.
- Next exact step: Inspect Attendance page/source and relevant API paths, establish production baseline, identify top 1-3 bottlenecks, and checkpoint before any Attendance optimization.

### Checkpoint
- Stage: Stage 2 Attendance
- Sub-step: Pre-optimization inspection and production baseline.
- Files changed: `PROJECT.md`
- Change: Inspected `AttendanceEditor`, Attendance route wiring, full-state loading, attendance list/create API, Attendance V2 teacher-session API, and URL routes; recorded mocked production baseline and top bottlenecks.
- Result: Stage 2 is ready for the first optimization, but no Attendance code has been changed yet.
- Validation: Production preview Attendance probe completed with mocked coordinator auth/state responses; Django check still blocked by missing Python runtime.
- Metrics: Fixture used 60 teachers, 900 students, 2,000 attendance records, and about 859 KB `/api/academy/state/` JSON. Unthrottled: DOMContentLoaded 580 ms, load 745 ms, FCP/LCP 784 ms, CLS 0, long tasks 0, approximate TBT 0 ms, DOM nodes 804. 4x CPU throttle: DOMContentLoaded 373 ms, load 536 ms, FCP/LCP 716 ms, CLS 0, long tasks 2, approximate TBT 114 ms, DOM nodes 804. Route resources: main JS 106,310 B encoded, Attendance chunk 7,903 B encoded, CSS 36,381 B encoded.
- Known issue: Attendance still loads full academy state with the capped historical attendance slice instead of a date-scoped initial attendance payload.
- Next exact step: Implement the date-scoped Attendance payload/loading change as the first optimization, then validate and remeasure before touching repeated client derivation.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Reopen Dashboard performance and pause Attendance.
- Files changed: `PROJECT.md`
- Change: Paused Stage 2 Attendance, recorded the new real signed-in Dashboard baseline/targets, and made initial JS/main-thread inspection the active next step.
- Result: Dashboard optimization is active again; no Stage 1B code has been changed yet.
- Validation: Not run yet.
- Metrics: Current real signed-in Dashboard baseline is Performance ~61, FCP 1.2 s, LCP 2.9 s, TBT 440 ms, CLS 0, Speed Index 2.7 s. Measured startup bottlenecks include dashboard state ~12.4 s / 452 KB, notices ~9.8 s, auth context ~3.2 s, main-thread work ~6.8 s, `index.es-CYmOC0z_.js` ~3.6 s CPU / 543 ms eval, and `index-B3tRnhTn.js` ~1.0 s CPU / 803 ms eval.
- Known issue: AssistantChat, Lottie, and `ai-bot.json` appear in the initial Dashboard dependency chain; the exact import/chunk cause still needs inspection.
- Next exact step: Inspect production chunk contents and source imports for `index.es-CYmOC0z_.js`, main index, AssistantChat, Lottie, and `ai-bot.json`, then checkpoint the discovery before editing.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Initial JS / Assistant-Lottie startup inspection.
- Files changed: `PROJECT.md`
- Change: Inspected `dist/assets/index.es-CYmOC0z_.js`, `dist/assets/index-B3tRnhTn.js`, `dist/assets/AssistantChat-C9tlAPri.js`, `dist/index.html`, `App.tsx`, and `components/AssistantChat.tsx`.
- Result: `index.es-CYmOC0z_.js` is the `lottie-react` / `lottie-web` vendor chunk. The main index chunk contains the app shell, React/runtime, auth/state startup, Dashboard code, lazy import map, the top-level `ai-bot.json` idle fetch, and the always-mounted lazy `AssistantChat` boundary. `AssistantChat` returns null while closed, but its chunk still loads because the component is rendered whenever `ai_assistant` is enabled.
- Validation: Read-only inspection only.
- Metrics: Existing built asset sizes: main `index-B3tRnhTn.js` 386,272 B, Lottie `index.es-CYmOC0z_.js` 317,333 B, `AssistantChat-C9tlAPri.js` 21,946 B, `dist/ai-bot.json` 36,585 B.
- Known issue: Dashboard startup currently fetches `ai-bot.json` from a top-level idle effect and can load the Lottie vendor chunk from the sidebar icon before the assistant is used.
- Next exact step: Patch `App.tsx` so AssistantChat is mounted only when open and AI animation assets load only after assistant-button user intent, preserving the locked/open assistant behavior.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Initial JS / Assistant-Lottie startup patch.
- Files changed: `App.tsx`, `PROJECT.md`
- Change: Removed the top-level idle `ai-bot.json` fetch from Dashboard startup, added an AI asset intent flag, triggers animation loading from AI button hover/focus/click only, and gates the lazy `AssistantChat` boundary until the assistant has been opened at least once.
- Result: Expected Dashboard startup no longer requests `ai-bot.json`, `AssistantChat` chunk, or the Lottie vendor chunk before assistant user intent; chat state should remain mounted after first open/close.
- Validation: Not run yet.
- Metrics: Before patch real baseline: Performance ~61, FCP 1.2 s, LCP 2.9 s, TBT 440 ms, CLS 0, Speed Index 2.7 s; built asset sizes before rebuild: Lottie chunk 317,333 B, AssistantChat chunk 21,946 B, `ai-bot.json` 36,585 B.
- Known issue: Need production build and Dashboard startup remeasurement to confirm the chunks/JSON leave the initial network/dependency chain.
- Next exact step: Run `npm run build`, attempt Django check if local Python allows, run `git diff --check`, then remeasure production Dashboard startup and assistant-open behavior.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Production build after Assistant/Lottie startup patch.
- Files changed: `PROJECT.md`
- Change: Ran `npm run build`; first sandboxed attempt failed on Vite config access, rerun outside sandbox passed.
- Result: Production frontend build passed.
- Validation: `npm run build` passed with the existing `lottie-web` eval warning and large lazy chunk warnings.
- Metrics: Main chunk `index-CFfVeRDt.js` 386.37 kB / gzip 106.31 kB; Lottie chunk `index.es-am4I8YPo.js` 317.33 kB / gzip 82.14 kB; Assistant chunk `AssistantChat-Dy6b8D2b.js` 21.95 kB / gzip 7.26 kB; CSS 274.11 kB / gzip 36.38 kB.
- Known issue: Build success does not prove the Lottie/Assistant chunks are out of the Dashboard startup chain; browser remeasurement is still required.
- Next exact step: Run Django check if local Python allows, run `git diff --check`, then run production Dashboard browser probe for startup resources and assistant-open behavior.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Django check attempt after Assistant/Lottie startup patch.
- Files changed: `PROJECT.md`
- Change: Attempted `python manage.py check` from `backend`.
- Result: Django check could not run locally.
- Validation: Blocked by environment: `backend/venv` still points to missing `C:\Users\iqrav\AppData\Local\Programs\Python\Python312\python.exe`.
- Metrics: Not applicable.
- Known issue: Need a working Python runtime/venv before Django validation can pass locally.
- Next exact step: Run `git diff --check`, then run production Dashboard browser probe for startup resources and assistant-open behavior.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Diff whitespace check after Assistant/Lottie startup patch.
- Files changed: `PROJECT.md`
- Change: Ran `git diff --check -- App.tsx PROJECT.md`.
- Result: Diff whitespace check passed.
- Validation: Passed with the existing line-ending warning for `App.tsx`.
- Metrics: Not applicable.
- Known issue: Raw `App.tsx` diff stat is noisy because of line-ending normalization; inspect ignore-EOL diff before final handoff.
- Next exact step: Inspect ignore-EOL diff, then run production Dashboard browser probe for startup resources and assistant-open behavior.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Production Dashboard browser probe after Assistant/Lottie startup patch.
- Files changed: `PROJECT.md`
- Change: Ran production preview on `http://127.0.0.1:4174/` and used headless Chrome with mocked signed-in coordinator auth/state/notices responses under 4x CPU throttle.
- Result: Targeted startup dependency fix passed. Dashboard startup no longer loaded `ai-bot.json`, `AssistantChat`, or the Lottie vendor chunk. Clicking the AI button loaded `AssistantChat-Dy6b8D2b.js`, `/ai-bot.json`, and `index.es-am4I8YPo.js`, and the assistant panel appeared.
- Validation: Browser probe rendered Dashboard, found the AI button, verified no assistant panel before click, clicked the AI button, and verified the assistant panel after click. `git diff --check -- App.tsx PROJECT.md` had passed earlier with the existing line-ending warning.
- Metrics: Startup under mocked production / 4x CPU throttle: DOMContentLoaded 1470 ms, load 1472 ms, FP 1368 ms, FCP 2876 ms, LCP 4364 ms, CLS 0, long tasks 6, approximate TBT 592 ms, DOM nodes 2302. Startup interesting resources: only main `index-CFfVeRDt.js` at encoded 106,313 B. After click resources: `AssistantChat-Dy6b8D2b.js` encoded 7,263 B, `/ai-bot.json` encoded 4,136 B, `index.es-am4I8YPo.js` encoded 82,143 B.
- Known issue: Mocked 4x CPU timing still shows main app render/evaluation work as the remaining initial-JS bottleneck; real signed-in Lighthouse still needs to confirm score impact.
- Next exact step: Inspect remaining main chunk/Dashboard render CPU cost before moving to Dashboard API work.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Move from initial Assistant/Lottie startup work to Dashboard API inspection.
- Files changed: `PROJECT.md`
- Change: Confirmed no usable local Python runner is available for backend query-count measurement (`py -3` reports no suitable runtime; `python` resolves to broken `backend/venv` target).
- Result: Initial Assistant/Lottie startup optimization is validated for the dependency chain; continuing to the next ordered bottleneck, Dashboard API, with static inspection first because local Django measurement is blocked.
- Validation: `py -3 --version` failed with no suitable runtime; `python --version` failed with missing `C:\Users\iqrav\AppData\Local\Programs\Python\Python312\python.exe`; `where python` points to `backend\venv\Scripts\python.exe`.
- Metrics: Real measured API bottleneck from user remains `/api/academy/state/?dashboard=true` about 12.4 s and 452 KB.
- Known issue: Backend query count/response timing cannot be measured locally until Python is repaired; code inspection can still identify unnecessary Dashboard payload fields and obvious repeated queries.
- Next exact step: Inspect `AcademyStateView.get`, serializers, and related Dashboard state construction to explain the 452 KB payload and identify the smallest safe payload/query fix.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Dashboard API static inspection.
- Files changed: `PROJECT.md`
- Change: Inspected `AcademyStateView.get`, `storageService.normalizeState`, Dashboard render usage, `ClassCard`, and `AssistantChat` context usage.
- Result: `?dashboard=true` already limits attendance to today, but still computes teacher `subjects` by scanning all active `StudentSubject` rows and sends many student lifecycle/payroll fields that `normalizeState()` drops for Dashboard partial state. Dashboard and AssistantChat use teacher id/name, student id/name/teacherId/timeSlot/classType/classDays/loginId, and attendance fields.
- Validation: Static inspection only; local query counting remains blocked by missing Python.
- Metrics: User-measured API bottleneck remains `/api/academy/state/?dashboard=true` about 12.4 s and 452 KB.
- Known issue: Need validate with real backend once Python/runtime is available; local mock can only validate frontend shape.
- Next exact step: Patch `AcademyStateView.get` so `dashboard=true` skips teacher subject aggregation and returns minimal Dashboard student/teacher fields while preserving the full-state response.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Dashboard API payload/query patch.
- Files changed: `backend/academy/views.py`, `PROJECT.md`
- Change: Updated `AcademyStateView.get` so `dashboard=true` skips the all-active-subject teacher aggregation and returns minimal Dashboard teacher/student fields; non-dashboard full-state rows keep the existing fields and teacher subjects.
- Result: Expected Dashboard API response should be smaller and avoid the `StudentSubject` scan on the lightweight Dashboard state path while preserving Dashboard-visible data and full-state behavior.
- Validation: Not run yet.
- Metrics: Before patch real API baseline from user: `/api/academy/state/?dashboard=true` about 12.4 s and 452 KB.
- Known issue: Local Python is unavailable, so Django query count and real endpoint timing cannot be measured locally.
- Next exact step: Run frontend build, attempt Django check, run diff check, and use local mocked payload comparison to estimate Dashboard JSON size reduction.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Production build after Dashboard API payload patch.
- Files changed: `PROJECT.md`
- Change: Ran `npm run build` after the Dashboard API patch.
- Result: Production frontend build passed; frontend chunk sizes unchanged because the patch was backend-only.
- Validation: `npm run build` passed with the existing `lottie-web` eval warning and large lazy chunk warnings.
- Metrics: Main `index-CFfVeRDt.js` 386.37 kB / gzip 106.31 kB; CSS 274.11 kB / gzip 36.38 kB; Lottie chunk `index.es-am4I8YPo.js` 317.33 kB / gzip 82.14 kB.
- Known issue: Backend runtime validation still pending and likely blocked by missing Python.
- Next exact step: Attempt Django check, run diff check, and estimate Dashboard JSON size reduction.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Backend validation attempts after Dashboard API payload patch.
- Files changed: `PROJECT.md`
- Change: Ran `python manage.py check` and `git diff --check -- App.tsx backend\academy\views.py PROJECT.md`.
- Result: Django check remains blocked by the missing local Python target; diff whitespace check passed.
- Validation: `python manage.py check` failed before Django startup with `No Python at "C:\Users\iqrav\AppData\Local\Programs\Python\Python312\python.exe"`; `git diff --check` passed with line-ending warnings for `App.tsx` and `backend/academy/views.py`.
- Metrics: Not applicable.
- Known issue: Raw diff stats are noisy because touched files have existing line-ending normalization warnings and prior uncommitted changes.
- Next exact step: Estimate Dashboard JSON size reduction from old/new response shapes, then run a mocked production Dashboard regression probe.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Dashboard API payload size estimate.
- Files changed: `PROJECT.md`
- Change: Compared old/new Dashboard response shapes with a local 60-teacher, 900-student, 240-attendance fixture.
- Result: Minimal Dashboard shape substantially reduces raw JSON by removing fields the Dashboard partial-state normalizer drops and by omitting teacher subjects on the dashboard path.
- Validation: Local Node size calculation only; not a live backend measurement.
- Metrics: Old estimated raw JSON 517,989 B / gzip 17,543 B; new estimated raw JSON 211,398 B / gzip 15,453 B; estimated raw reduction 306,591 B (~59%). User-measured real endpoint before patch was about 452 KB and 12.4 s.
- Known issue: Real signed-in backend payload/time and query count still need measurement once the backend can run.
- Next exact step: Run a mocked production Dashboard render using the minimal payload shape to validate frontend compatibility.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Mocked production Dashboard regression after Dashboard API payload patch.
- Files changed: `PROJECT.md`
- Change: Ran a production-browser Dashboard probe with the minimal Dashboard payload shape that the patched endpoint returns.
- Result: Dashboard rendered successfully with the minimal teacher/student fields; CLS stayed at 0; assistant assets still did not load before user intent.
- Validation: Browser probe found Dashboard content and the AI button, with API calls to auth context, dashboard state, and notices.
- Metrics: Probe result: ready true, CLS 0, DOM nodes 736, startup had no `ai-bot.json`, no AssistantChat chunk, and no Lottie chunk.
- Known issue: This is a mocked frontend compatibility check, not a real backend timing or query-count measurement.
- Next exact step: Clean up preview/browser helpers, run final diff check, then obtain real signed-in Dashboard Lighthouse and real `/api/academy/state/?dashboard=true` timing/payload to decide whether to continue to auth/notices startup.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Final diff/status check for this pass.
- Files changed: `PROJECT.md`
- Change: Ran `git diff --check -- App.tsx backend\academy\views.py PROJECT.md` and checked scoped status.
- Result: Diff whitespace check passed; `App.tsx` and `backend/academy/views.py` remain `MM` because they had pre-existing dirty/staged changes and were touched for this pass; `PROJECT.md` remains untracked.
- Validation: `git diff --check` passed with line-ending warnings for `App.tsx` and `backend/academy/views.py`.
- Metrics: Not applicable.
- Known issue: No real signed-in post-patch Lighthouse/API timing has been run yet; Python/Django check remains blocked locally.
- Next exact step: Stop preview/browser helpers, then run real signed-in Dashboard Lighthouse/network validation on the same profile/settings.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Local helper cleanup.
- Files changed: `PROJECT.md`
- Change: Stopped the Vite production preview helper and closed the headless Chrome debugging helper.
- Result: No local preview/browser helper remains intentionally running from this pass.
- Validation: Preview session received Ctrl+C; Chrome debugging endpoint closed through CDP.
- Metrics: Not applicable.
- Known issue: Real signed-in post-patch Lighthouse/API timing still needs to be run externally or with a live signed-in browser/backend.
- Next exact step: Run real signed-in Dashboard Lighthouse/network validation on the same profile/settings and update `PROJECT.md` with the new Performance, FCP, LCP, TBT, CLS, Speed Index, API timings, and payload sizes.


### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Render-blocking font and decorative image cleanup.
- Files changed: `index.html`, `App.tsx`.
- Change: Removed external Google Fonts from the critical path and replaced `/coordinator-icon.png` with the existing lightweight Lucide `Users2` icon.
- Before metrics: FCP 1.8s; LCP 2.2s; TBT 0ms; CLS 0; Speed Index 2.7s.
- Before findings: Google Fonts ~640ms render-blocking; coordinator PNG ~115.7 KiB with ~114.6 KiB estimated saving.
- Validation: Pending production build and Lighthouse.
- Known issue: Dashboard/auth/notices API latency remains for later measurement.
- Next exact step: Build, verify Dashboard visually, rerun real signed-in Lighthouse, and record post-patch metrics.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Latest real signed-in validation.
- Metrics: FCP 0.5s; LCP 1.8s; TBT 410ms; CLS 0.211; Speed Index 2.3s.
- Result: FCP/LCP remain strong, but CLS regressed from 0 to 0.211 and TBT remains high.
- Lighthouse CLS culprit: main application shell `<main class="flex-1 flex flex-col h-screen overflow-hidden relative">` with repeated shifts; sidebar nav also contributes a small amount.
- Remaining findings: coordinator-icon.png still loads at ~115.7 KiB; main JS has ~38 KiB unused; CSS ~32 KiB unused; Dashboard API remains on critical dependency chain.
- Decision: Fix CLS regression before further backend/API optimization.
- Next exact step: inspect loading shell, hydrated Dashboard transition, sidebar geometry, and live coordinator role-icon source before editing.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Sidebar CLS + role image cleanup validated.
- Metrics: FCP 0.4s; LCP 2.1s; TBT 380ms; CLS 0; Speed Index 0.9s.
- Result: CLS restored to 0. Coordinator PNG warning removed. Dashboard sidebar no longer shifts main content when expanding.
- Validation: npm run build PASS; python manage.py check PASS; git diff --check PASS except existing LF/CRLF warnings.
- Main remaining frontend bottleneck: TBT 380ms and ~38 KiB unused JS in initial main bundle.
- Decision: Keep layout/backend unchanged for now. Inspect synchronous App/Dashboard startup work and initial bundle contents before the next patch.
- Next exact step: inspect App.tsx imports, synchronous hooks/array transforms, and decorative Dashboard rendering.

### Checkpoint
- Stage: Stage 1B Dashboard Lighthouse
- Sub-step: Main-bundle source-map analysis.
- Main entry: index-Bw4iNiQj.js ~386 KB raw / ~106 KB gzip.
- Largest app-owned source-map entries: App.tsx ~204.8 KB; djangoApiService.ts ~70.1 KB; ClassCard.tsx ~30.7 KB.
- Decision: Do not optimize React framework code, ClassCard, or backend yet.
- Likely next safe target: move non-startup conditional UI out of App.tsx to reduce initial parse/evaluation cost.
- Next exact step: inspect modal/settings/notice imports and djangoApiService imports before editing.

### Checkpoint
- Stage: Stage 1B Dashboard / Reports regression.
- Issue: Reports filter panel overlaid the expanded sidebar.
- Root cause: Reports filter container used `z-50` while the fixed sidebar uses `z-40`.
- Change: Lowered Reports filter container from `z-50` to `z-20`.
- Result expected: sidebar remains above Reports content without changing sidebar geometry or reintroducing CLS.
- Files changed: `components/ReportsTab.tsx`.
- Next step: visually verify Reports dropdowns, filter minimize/open behavior, and sidebar overlay.
