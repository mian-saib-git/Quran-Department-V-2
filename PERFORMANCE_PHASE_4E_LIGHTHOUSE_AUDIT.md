# PERFORMANCE_PHASE_4E_LIGHTHOUSE_AUDIT.md

## 1. Test Environment and Methodology
- **Build Under Test**: **Vite production build (`dist/`)** served locally via a Node static + HTTP/WS reverse-proxy server at `http://127.0.0.1:4173` forwarding `/api/*` and `/ws/*` to Django (`127.0.0.1:5000`) connected to local PostgreSQL (`ivs_academy_localdev`, `1,157` students, `131` teachers).
- **Lighthouse Methodology**: Chrome Lighthouse (`13.x` in scratch `perf-tools`, zero permanent project dependencies added) executed against `http://127.0.0.1:4173` across **48 runs** (16 screen/viewport combinations × 3 runs each; **median** values reported). Authenticated runs used `disableStorageReset: true` with pre-authenticated `localStorage` session (`quran_academy_session_v2`), which reflects **warm-cache asset loading** (`Immutable` `/assets/*` cache headers).
- **SPA & Runtime Profiling Methodology**: Playwright (`playwright-core`) + Chrome DevTools Protocol (`Performance.getMetrics`, `PerformanceObserver` for `longtask`, network request/response byte & duplicate tracking, `requestAnimationFrame` scroll frame timing, and Playwright traces).
- **Data Hygiene**: Temporary synthetic localdev QA accounts (`qa_perf_*`) were used for authenticated runs and deleted immediately afterward; temporary session token files were removed. No passwords, JWTs, cookies, or personal student data are stored in this report.
- **Artifact Directory**:
  - Lighthouse JSON/HTML reports (48 runs × 2 formats = 96 files) & `lighthouse-summary.json`: `C:\Users\iqrav\.gemini\antigravity\brain\4679d8ce-2845-423f-8a78-de5fdcd4189b\scratch\perf-reports\lighthouse\`
  - Playwright traces: `C:\Users\iqrav\.gemini\antigravity\brain\4679d8ce-2845-423f-8a78-de5fdcd4189b\scratch\perf-reports\traces\`

---

## 2. Screen and Route Inventory
| Role / Portal | Screen / Tab | Hash / Entry | Access / Implementation |
|---|---|---|---|
| Public / Auth | Login | `/` | `LoginScreen.tsx` |
| Quran Coordinator | Dashboard (KPIs, Insights, Live/Up Next) | `#dashboard` | `App.tsx` + `components/dashboard/*` |
| Quran Coordinator | Scheduling | `#scheduling` | `SchedulingTab.tsx` (lazy) |
| Quran Coordinator | Attendance | `#attendance` | `AttendanceEditor.tsx` (lazy) |
| Quran Coordinator | Accounts & Enrollment | `#accounts` | `CoordinatorAccounts.tsx` (lazy) |
| Quran Coordinator | Lessons Control | `#lessons` | `CoordinatorLessons.tsx` (lazy) |
| Quran Coordinator | Reports | `#reports` | `ReportsTab.tsx` (lazy) |
| Quran Coordinator | Dropped & Leave | `#dropped-leave` | `QuranDroppedLeave.tsx` (lazy) |
| Dept / Platform Admin | Teacher Salary (7 Unified Stages) | `#teacher-salary` | `TeacherSalaryManagement.tsx` (lazy) |
| Quran Teacher | Overview, Classes, Write Lesson, Monthly, Attendance, Salary, History | `#dashboard` (internal `Tab`) | `TeacherPortal.tsx` (lazy) |
| Quran Student | Overview, Attendance, Lessons, Schedule + 3D Lanyard | `#dashboard` (internal `Tab`) | `StudentPortal.tsx` (lazy) + `Lanyard.tsx` (lazy) |
| Tuition Coordinator | Dashboard, Accounts, Scheduling, Attendance, Reports | `#dashboard` (internal `Tab`) | `TuitionCoordinatorPortal.tsx` (lazy) |
| Tuition Teacher | Overview, Classes, Attendance | `#dashboard` (internal `PortalTab`) | `TuitionTeacherPortal.tsx` (lazy) |
| Tuition Student | Overview, Attendance, Assignments, Schedule + 3D Lanyard | `#dashboard` (internal `PortalTab`) | `TuitionStudentPortal.tsx` (lazy) |
| Platform Admin | Overview, Institutions, Salary Approvals, Portal Admins, Communications, Backups, App Settings, System Health, Audit Logs | `#platform-admin` | `PlatformAdmin.tsx` (lazy) |

---

## 3. Desktop Lighthouse Results (Median of 3 Runs, `1350x940`)
| Screen | Score | FCP | LCP | Speed Index | TBT | CLS | Main Thread |
|---|---:|---:|---:|---:|---:|---:|---:|
| Login (`/`) | **97** (95–99) | 210 ms | 431 ms | 892 ms | 144 ms | 0 | 1,423 ms |
| Quran Coordinator `#dashboard` | **99** (98–100) | 224 ms | 455 ms | 847 ms | 85 ms | 0 | 1,226 ms |
| Quran Coordinator `#scheduling` | **99** (97–100) | 221 ms | 402 ms | 773 ms | 107 ms | 0 | 1,300 ms |
| Quran Coordinator `#attendance` | **99** (98–99) | 233 ms | 485 ms | 926 ms | 102 ms | 0 | 1,184 ms |
| Quran Coordinator `#reports` | **98** (96–99) | 197 ms | 401 ms | 825 ms | 113 ms | 0 | 1,140 ms |
| Quran Coordinator `#teacher-salary` | **100** (100–100) | 197 ms | 360 ms | 687 ms | 43 ms | 0 | 1,045 ms |
| Quran Teacher `#dashboard` | **99** (99–100) | 251 ms | 515 ms | 866 ms | 87 ms | 0 | 1,175 ms |
| Quran Student `#dashboard` | **99** (96–100) | 230 ms | 472 ms | 854 ms | 85 ms | 0 | 1,266 ms |
| Platform Admin `#platform-admin` | **98** (96–100) | 222 ms | 444 ms | 828 ms | 122 ms | 0 | 1,131 ms |
| Tuition Coordinator `#dashboard` | **100** (100–100) | 200 ms | 394 ms | 774 ms | 67 ms | 0 | 1,049 ms |

*Note: Lighthouse navigation audits measure initial shell/HTML+JS boot; for hash-based SPAs, tab transitions after initial load are measured separately in Section 5 via Playwright + CDP.*

---

## 4. Mobile Lighthouse Results (Median of 3 Runs, `390x844`, 4x CPU Throttling)
| Screen | Score | FCP | LCP | Speed Index | TBT | CLS | Main Thread |
|---|---:|---:|---:|---:|---:|---:|---:|
| Login (`/`) | **73** (72–77) | 654 ms | 1,327 ms | 2,193 ms | **1,082 ms** | 0 | 6,391 ms |
| Quran Coordinator `#dashboard` | **73** (73–76) | 846 ms | 1,412 ms | 2,274 ms | **1,715 ms** | 0 | 5,526 ms |
| Quran Coordinator `#scheduling` | **75** (73–77) | 740 ms | 1,335 ms | 2,169 ms | **1,353 ms** | 0 | 6,178 ms |
| Quran Teacher `#dashboard` | **81** (75–83) | 758 ms | 1,290 ms | 1,717 ms | **785 ms** | 0 | 5,208 ms |
| Quran Student `#dashboard` | **77** (75–79) | 757 ms | 1,364 ms | 1,897 ms | **1,126 ms** | 0 | 5,096 ms |
| Platform Admin `#platform-admin` | **77** (74–80) | 809 ms | 1,297 ms | 1,764 ms | **1,083 ms** | 0 | 4,500 ms |

**Key Lighthouse Diagnostic Finding**:
- Even on the unauthenticated **Login** screen, mobile TBT is **1,082 ms** (`mainThreadMs = 6,391 ms`) because `index-DikIPZmh.js` (`395 KB` uncompressed / `112.48 KB` gzip) is parsed and evaluated synchronously on startup, with **`203 KB` (~51%) unused JavaScript** on initial load (`bootup-time`: `865–1,333 ms` for `index-DikIPZmh.js` on mobile 4x CPU).

---

## 5. SPA Navigation Measurements (Playwright + CDP, `1280x800`)
| Role | Transition / Screen | Transition Time | DOM Nodes | JS Heap | Long Tasks (Total / Max) | API Requests Fired |
|---|---|---:|---:|---:|---|---|
| Quran Coordinator | Initial `#dashboard` (`977` students, `77` teachers) | 3,644 ms | 5,529 | 8.9 MB | — | 4 (`174 KB`) |
| Quran Coordinator | Expand Insights (Phase 4E + lazy `DashboardTimelineChart`) | 1,261 ms | 5,813 | 13.7 MB | 3 (`486 ms` / `382 ms`) | 0 |
| Quran Coordinator | Tab → `Scheduling` | **7,460 ms** | **28,726** | **43.8 MB** | 5 (`470 ms` / `141 ms`) | 1 (`/api/academy/state/`) |
| Quran Coordinator | Tab → `Attendance` | 1,913 ms | 518 | **48.2 MB** | 4 (`751 ms` / **502 ms**) | 2 (`/api/academy/state/`, `/api/academy/attendance/`) |
| Quran Coordinator | Tab → `Accounts & Enrollment` | 1,597 ms | 575 | 8.8 MB | 1 (`83 ms` / `83 ms`) | 2 |
| Quran Coordinator | Tab → `Lessons Control` | 1,843 ms | 626 | 9.8 MB | 2 (`216 ms` / `129 ms`) | 5 |
| Quran Coordinator | Tab → `Reports` | 1,337 ms | 404 | 10.2 MB | 1 (`98 ms` / `98 ms`) | 1 |
| Dept Admin | Tab → `Teacher Salary` | 1,149 ms | 425 | 9.4 MB | 3 (`280 ms` / `155 ms`) | 3 |
| Dept Admin | Salary Stage 3 (`Teacher Assignments`) | 1,793 ms | 470 | 10.3 MB | 1 (`74 ms` / `74 ms`) | 2 |
| Quran Teacher | Initial `#dashboard` | 2,441 ms | 112 | 2.7 MB | — | 1 |
| Quran Teacher | Tab → `Classes` (initial data settle) | 12,396 ms | 233 | 5.0 MB | 1 (`67 ms` / `67 ms`) | 8 |
| Quran Teacher | Tab → `Write Lesson` / `History` / `Overview` | 756–912 ms | 231–323 | 5.4–5.8 MB | 0–1 (`0–111 ms`) | 0 |
| Quran Student | Initial `#dashboard` (incl. lazy 3D Lanyard) | 15,407 ms | 316 | 13.5 MB | — | — |
| Quran Student | Tab → `Attendance` / `Lessons` / `Schedule` / `Overview` | 622–875 ms | 216–316 | 13.0–16.1 MB | 0–1 (`0–57 ms`) | 0–1 |
| Platform Admin | Initial `#platform-admin` | 8,422 ms | 947 | 12.3 MB | — | 4 |
| Platform Admin | Tab → `Institutions` / `Salary Approvals` / `Overview` | 1,015–1,155 ms | 307–391 | 11.9–14.6 MB | 1–2 (`51–181 ms`) | 0–1 |
| Tuition Coordinator | Initial `#dashboard` | 13,718 ms | 740 | 9.6 MB | — | 5 |

---

## 6. React Rendering Findings
- **Dashboard (`#dashboard`)**: Expanding Phase 4E `CoordinatorDashboardInsights` only adds `+284` DOM nodes (`5,529 → 5,813`) and `0` API calls. The `382 ms` max long task occurs once on first expand when `DashboardTimelineChart` + Recharts `BarChart` (`325.41 kB`) parses.
- **Root-level state & heavy tabs**: When switching from `#dashboard` (`isPartial: true`) to `#scheduling`, `App.tsx` triggers `loadState(false)` (`/api/academy/state/`), fetching the full `501 KB` payload in `3,052 ms` and re-rendering the entire root tree with `977` students and `77` teachers.
- **Idle Clock Isolation**: Verified Phase 2E `useMinuteNow` + `IVSClockCard` kept idle dashboard re-renders quiet; no 1-second root-level long tasks observed.

---

## 7. Scheduling Matrix Analysis (`#scheduling`)
- **Measured**: **7,460 ms** transition time, **28,726 DOM nodes** (nearly 19× the 1,500-node Lighthouse threshold), JS heap jumped from `13.7 MB → 43.8 MB`, **5 long tasks totaling 470 ms**.
- **Scroll Check**: On desktop (`1280x800`), programmatic scrolling across 30 animation frames had only `1` frame `>32 ms` (`maxFrameMs: 38 ms`), meaning once mounted, composited scrolling is acceptable on fast desktop, **but** initial mount/unmount and full-matrix React reconciliation (`28,726` nodes) is the single largest DOM & memory spike in the application.
- **Conclusion**: Virtualization (windowing time slots/rows) or paginated/filtered-by-default matrix rendering **is warranted** for `#scheduling` at `~1,000+` students.

---

## 8. Attendance Performance Analysis (`#attendance`)
- **Measured**: Transition time `1,913 ms`, DOM drops cleanly to `518` nodes, **but** JS heap peaked at `48.2 MB` and produced a **502 ms max long task** (`751 ms` total long tasks).
- **Root Cause**: Switching from `#dashboard` still observed `/api/academy/state/` firing alongside `/api/academy/attendance/?date=2026-11-18&scope=state&page=1&page_size=500`, plus `AttendanceEditor` processing `977` student rows + `77` teacher rows synchronously on mount.

---

## 9. Salary and Lesson History Analysis
- **Lessons Control (`#lessons`)**: Phase 2C-1 pagination is actively effective — `/api/academy/daily-lesson-reports/?page=1&page_size=50` returned **40 KB in 830 ms**, keeping DOM at `626` nodes and heap at `9.8 MB`.
- **Teacher Salary (`#teacher-salary`)**: Lazy-loaded (`10.77 kB` shell); Stage 3 (`Teacher Assignments`) loaded `/api/salary/assignments/?page=1&page_size=50` in **1,203 ms (29 KB)** with only `470` DOM nodes and `10.3 MB` heap. Phase 2C-2 payload optimizations are confirmed effective.

---

## 10. Student Lanyard Analysis (`StudentPortal`)
- **Initial Load vs Deferred Chunk**: Phase 2D lazy-loading is intact — `Lanyard-C53AiMS1.js` (`3,234 KB` raw / `1,128.57 KB` gzip), `Lanyard-CMPSGgm-.css` (`4 KB`), and `card-BfBsTJX8.glb` (`5 KB`) load asynchronously after initial render.
- **Memory & Interaction**: After Lanyard mounts, JS heap settles at `13.5 MB` (vs `2.7–5.0 MB` on TeacherPortal without 3D). Subsequent tab switches (`Attendance`, `Lessons`, `Schedule`, `Overview`) complete in `552–875 ms` with `0–1` minor long tasks (`<=57 ms`), confirming the 3D canvas does not block SPA tab navigation on desktop.
- **Risk**: `3.23 MB` raw JS (`1.13 MB` gzip) + Rapier WASM + WebGL remains heavy on low-end mobile devices and contributes to `networkidle` stretching to `15.4 s`.

---

## 11. API and WebSocket Observations
| Endpoint | Status | Payload Size | Latency | Observation |
|---|---:|---:|---:|---|
| `GET /api/auth/context/` | 200 | 1 KB | 559 ms | Fast; Phase 3A auth optimization effective |
| `GET /api/academy/state/?dashboard=true` | 200 | **173 KB** | **1,553 ms** | Main Coordinator dashboard boot bottleneck |
| `GET /api/academy/state/` | 200 | **501 KB** | **3,052 ms** | **Major bottleneck** — fired on leaving `#dashboard`; observed re-firing across tab switches |
| `GET /api/academy/daily-lesson-reports/?page=1&page_size=50` | 200 | 40 KB | 830 ms | Pagination effective |
| `GET /api/salary/assignments/?page=1&page_size=50` | 200 | 29 KB | 1,203 ms | Pagination effective |
| `GET /api/salary/policies/` | 200 | <1 KB | 624 ms | Fast |
| `WS /ws/academy/` | Connected | — | — | Single shared WebSocket verified on Coordinator |

**Observed Issue**: When navigating across Coordinator tabs (`Scheduling` → `Attendance` → `Accounts` → `Lessons` → `Reports`), `/api/academy/state/` was triggered on **every** tab transition in the Playwright trace because `appState.isPartial` remained true or re-triggered before settling.

---

## 12. Comparison with Previous Performance Phases (2A–3A)
- **Phase 2A (`DashboardView` N+1)**: Confirmed effective on `/api/academy/state/?dashboard=true` (`173 KB` in `1.55 s` for `977` students), though full `/api/academy/state/` remains `501 KB / 3.05 s`.
- **Phase 2B (Polling & Single WS)**: Confirmed single `ws://.../ws/academy/` connection and zero duplicate polling bursts during tab switches.
- **Phase 2C-1 & 2C-2 (Lessons & Salary Pagination)**: Confirmed measurable payload reductions (`40 KB` lessons, `29 KB` salary assignments).
- **Phase 2D (Code Splitting)**: Confirmed `Lanyard` (`3.23 MB`) and `BarChart` (`325 KB`) are deferred out of `index` (`404.63 KB`). However, `index` itself still bundles all of `App.tsx` (`~4,171` lines), leaving `203 KB` unused JS on initial boot.
- **Phase 2E (Clock Isolation)**: Confirmed zero 1-second long-task churn when idle.
- **Phase 3A (Auth Queries)**: Confirmed `/api/auth/context/` is `1 KB / 559 ms`.

---

## 13. Ranked Performance Bottlenecks
1. **Critical — Coordinator Scheduling Matrix DOM Explosion (`28,726` DOM nodes, `7.46 s` transition, `43.8 MB` heap)**: Rendering all `977` students across all time slots into the DOM simultaneously.
2. **High — Mobile Main-Thread Boot & Unused JS (`72–81` Mobile Lighthouse, `785–1,715 ms` TBT, `203 KB` unused JS in `index`)**: `App.tsx` (`404.63 KB` raw / `112.48 KB` gzip) is parsed synchronously on every route, including Login and Student/Teacher portals.
3. **High — Full `/api/academy/state/` (`501 KB`, `3.05 s`) & Repeated Firing on Tab Switches**: Leaving `#dashboard` triggers a `501 KB / 3.05 s` fetch and was observed re-firing across subsequent tab switches.
4. **Medium — Coordinator Attendance Long Task (`502 ms` max long task, `48.2 MB` heap peak)**: Synchronous processing of `~1,000` student records on `#attendance` mount.
5. **Medium — Student 3D Lanyard Weight (`3.23 MB` JS + Rapier WASM)**: Lazy-loaded, so desktop interaction is smooth, but adds `~10 MB` heap and heavy mobile CPU/network cost when mounted.

---

## 14. Complete Results Matrix
| Role | Screen | Viewport | LH Score (Med) | LCP | TBT | CLS | Initial Load | SPA Nav | API Reqs | Main Issue | Status |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| Public | Login (`/`) | Desktop | 97 | 431 ms | 144 ms | 0 | — | — | — | None | **VERIFIED** |
| Public | Login (`/`) | Mobile | 73 | 1,327 ms | 1,082 ms | 0 | — | — | — | `index` JS boot (`203 KB` unused) | **VERIFIED** |
| Quran Coord | `#dashboard` | Desktop | 99 | 455 ms | 85 ms | 0 | 3,644 ms | 1,261 ms (Insights) | 4 | `173 KB` state payload (`1.55 s`) | **VERIFIED** |
| Quran Coord | `#dashboard` | Mobile | 73 | 1,412 ms | 1,715 ms | 0 | — | — | — | Mobile JS boot TBT | **VERIFIED** |
| Quran Coord | `#scheduling` | Desktop | 99 | 402 ms | 107 ms | 0 | — | 7,460 ms | 1 | **28,726 DOM nodes** + `501 KB` state | **VERIFIED** |
| Quran Coord | `#scheduling` | Mobile | 75 | 1,335 ms | 1,353 ms | 0 | — | — | — | Mobile JS boot + matrix DOM | **VERIFIED** |
| Quran Coord | `#attendance` | Desktop | 99 | 485 ms | 102 ms | 0 | — | 1,913 ms | 2 | **502 ms** long task, `48.2 MB` heap | **VERIFIED** |
| Quran Coord | `#accounts` | Desktop | — | — | — | — | — | 1,597 ms | 2 | Re-triggers `/api/academy/state/` | **VERIFIED (SPA)** |
| Quran Coord | `#lessons` | Desktop | — | — | — | — | — | 1,843 ms | 5 | Re-triggers `/api/academy/state/` | **VERIFIED (SPA)** |
| Quran Coord | `#reports` | Desktop | 98 | 401 ms | 113 ms | 0 | — | 1,337 ms | 1 | `Recharts` + `/api/academy/state/` | **VERIFIED** |
| Dept Admin | `#teacher-salary` | Desktop | 100 | 360 ms | 43 ms | 0 | — | 1,149 ms / 1,793 ms | 3 / 2 | Clean (`29 KB` assignments) | **VERIFIED** |
| Quran Teacher | Overview / Tabs | Desktop | 99 | 515 ms | 87 ms | 0 | 2,441 ms | 756–912 ms | 1–8 | Teacher initial data settle | **VERIFIED** |
| Quran Teacher | Overview | Mobile | 81 | 1,290 ms | 785 ms | 0 | — | — | — | Mobile JS boot TBT | **VERIFIED** |
| Quran Student | Overview + Lanyard | Desktop | 99 | 472 ms | 85 ms | 0 | 15,407 ms | 622–875 ms | — | `3.23 MB` lazy Lanyard + `13.5 MB` heap | **VERIFIED** |
| Quran Student | Overview + Lanyard | Mobile | 77 | 1,364 ms | 1,126 ms | 0 | — | — | — | Mobile JS boot + 3D weight | **VERIFIED** |
| Platform Admin | `#platform-admin` | Desktop | 98 | 444 ms | 122 ms | 0 | 8,422 ms | 1,015–1,155 ms | 4 | Clean | **VERIFIED** |
| Platform Admin | `#platform-admin` | Mobile | 77 | 1,297 ms | 1,083 ms | 0 | — | — | — | Mobile JS boot TBT | **VERIFIED** |
| Tuition Coord | `#dashboard` | Desktop | 100 | 394 ms | 67 ms | 0 | 13,718 ms | — | 5 | Synthetic 0-row dept; sub-tabs not clicked | **PARTIAL** |
| Tuition Teacher | All Tabs | — | — | — | — | — | — | — | — | No Tuition Teacher profile in localdev | **NOT VERIFIED** |
| Tuition Student | All Tabs | — | — | — | — | — | — | — | — | No Tuition Student profile in localdev | **NOT VERIFIED** |

---

## 15. Recommended Corrective Phases & Screens Not Tested
- **Recommended Phase 4F / 4G (Architecture)**: Continue extracting `App.tsx` Coordinator shell/modals and split `App.tsx` coordinator-only code into a lazy-loaded `QuranCoordinatorPortal` chunk so Login, Student, Teacher, Tuition, and Platform Admin do not download `203 KB+` of Coordinator UI code.
- **Recommended Phase 5A (Scheduling Virtualization)**: Virtualize or paginate `SchedulingTab.tsx` to cut `28,726` DOM nodes down to `<2,000` visible nodes.
- **Recommended Phase 5B (State Fetch Guard & Slimming)**: Fix the `appState.isPartial` / `loadState(false)` guard in `App.tsx` so `/api/academy/state/` (`501 KB`) does not re-fire across every non-dashboard tab switch, and consider endpoint-specific data instead of monolithic state.
- **Screens Not Tested**: Tuition Teacher and Tuition Student portals had no seeded profiles in `ivs_academy_localdev` (`Tuition users: 1` total); Tuition Coordinator sub-tabs (`Accounts`, `Scheduling`, `Attendance`, `Reports`) were not clicked in the SPA script due to sidebar label mismatch.
