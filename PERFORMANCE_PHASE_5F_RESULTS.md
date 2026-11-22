# PERFORMANCE_PHASE_5F_RESULTS.md

## 1. Original 3D Architecture
Both `components/StudentPortal.tsx` (Quran Student) and `components/tuition/TuitionStudentPortal.tsx` (Tuition Student) share the lazy-loaded 3D Student ID card component `components/tuition/lanyard/Lanyard.tsx` and its stylesheet `Lanyard.css`.
- Phase 5C-V already imported `Lanyard.css` eagerly (reserving `.lanyard-stage-active` space to eliminate `CLS = 0.254`), deferred `lanyardMounted` by `1,800 ms` (or immediate mount on clicking the ID Card toggle), and wrapped `<Lanyard />` in `LazyChunkErrorBoundary` + `React.Suspense`.
- Inside `Lanyard.tsx`, `<Canvas>` mounted `@react-three/fiber`, `@react-three/drei` (`Environment`, `Lightformer`, `useGLTF`, `useTexture`), `@react-three/rapier` (`Physics`, `RigidBody`, `BallCollider`, `CuboidCollider`, `useRopeJoint`, `useSphericalJoint`), `meshline` (`MeshLineGeometry`, `MeshLineMaterial`), `three`, and `card.glb` (`5.37 kB`).

---

## 2. Fresh Mobile and Desktop Baseline (Before Phase 5F)
Captured against `dist/` with local Django (`127.0.0.1:5000`) and disposable QA Student accounts (`qa_5f_qstudent`, `qa_5f_tstudent`):

### Mobile Lighthouse (`390x844`, 4x CPU Throttling, Median of 3 Runs)
| Portal | Score | FCP / LCP | TBT (Cold Run 1) | TBT (Median) | CLS | Bootup | Main Thread |
|---|---:|---:|---:|---:|---:|---:|---:|
| Quran Student (`#dashboard`) | **72** | 668 ms | 6,860 ms | **2,005 ms** | 0 | 3,282 ms | 5,369 ms |
| Tuition Student (`#dashboard`) | **73** | 660 ms | 6,063 ms | **1,763 ms** | 0.019 | 2,899 ms | 4,727 ms |

### Runtime 3D Profiling (`1280x800` 1x CPU & `390x844` 4x CPU)
| Configuration | Usable Controls | Canvas Appear | Reshow | Visible rAF/s | **Hidden rAF/s** | Heap (Mounted → Cycles) | Max Long Task |
|---|---:|---:|---:|---:|---:|---:|---:|
| Quran Student Desktop (`1280x800`) | 1,259 ms | 1,836 ms | 56 ms | 60.5 | **60.5** | 13.1 → 15.0 MB | 1,135 ms |
| Quran Student Mobile (`390x844`, 4x) | 1,507 ms | 2,595 ms | 140 ms | 60.0 | **60.5** | 14.6 → 15.6 MB | 384 ms |
| Tuition Student Desktop (`1280x800`) | 1,025 ms | 2,571 ms | 85 ms | 60.5 | **61.0** | 14.9 → 16.7 MB | 142 ms |
| Tuition Student Mobile (`390x844`, 4x) | 1,477 ms | 2,384 ms | 83 ms | 60.5 | **60.5** | 13.3 → 14.6 MB | 350 ms |

---

## 3. JS Bundle / Dependency Analysis
`esbuild` metafile analysis of `components/tuition/lanyard/Lanyard.tsx` (`3,315,644 B` minified JS; Vite `Lanyard-*.js` total `3,258.99 KiB` raw / `1,112.14 KiB` gzip):
- `@dimforge/rapier3d-compat`: **`2,238,225 B` (`67.5%`)** — embeds base64-encoded Rapier3D WASM inside JS.
- `three`: **`731,801 B` (`22.1%`)**
- `@react-three/fiber`: **`152,671 B` (`4.6%`)**
- `three-stdlib`: **`102,853 B` (`3.1%`)**
- `@react-three/rapier`: **`23,202 B` (`0.7%`)**
- `@monogrid/gainmap-js`: **`17,122 B` (`0.5%`)**
- `components/tuition/lanyard/Lanyard.tsx`: **`14,584 B`**
- `meshline`: **`12,121 B`**
- `@react-three/drei`: **`7,691 B`**

---

## 4. Confirmed 3D Performance Bottleneck
1. **Continuous 60 FPS Simulation While Hidden or Backgrounded**: `<Canvas>` defaulted to `frameloop="always"` and `<Physics>` had no `paused` prop. Even after clicking **Hide student ID card** (`interactive === false`) or switching browser tabs, WebGL rendering, Rapier physics stepping, and `useFrame` ran at **60.5–61.0 FPS** continuously.
2. **Per-Frame Idle `MeshLine` Buffer & Array Allocations**: Every `useFrame` tick unconditionally called `curve.getPoints(42..88)` + `band.current.geometry.setPoints(...)` (allocating 42–88 `Vector3` objects and uploading a WebGL vertex buffer at 60 FPS even when the card was completely settled) and allocated `[j1, j2, j3].forEach(...)` closures. Also `card.current.setAngvel(...)` ran unconditionally even when `Math.abs(rot.y) <= 0.002`, preventing clean physics sleep.
3. **Oversized `Environment` PMREM Cubemap**: `<Environment blur={0.72}>` rendered a `256×256` cubemap across multiple frames for 4 static `Lightformer`s.
4. **Undisposed Procedural `CanvasTexture`**: `buildRibbonTexture()` (`180×1200` `THREE.CanvasTexture`) was never `.dispose()`d on unmount.
5. **Startup Bundle Size**: `67.5%` (`2.24 MB`) of `Lanyard` is `@dimforge/rapier3d-compat` WASM-in-JS, which drives the `~1.8–2.0 s` warm mobile Lighthouse TBT (`~6–7 s` cold) during initial parse/WASM compilation.

---

## 5. Optimization Alternatives Considered
- **Replacing Rapier physics with a custom spring-damper**: Would remove `2.24 MB` (`@dimforge/rapier3d-compat`), but would alter 3D rope/card physics behavior and violate Phase 5F's rule against replacing the 3D/physics engine or removing physics features.
- **Increasing the `1,800 ms` defer**: Explicitly forbidden (would only game Lighthouse without improving real interaction).
- **Pause-when-hidden + Settled `MeshLine` skip + Single-frame low-res `Environment` + Texture disposal**: Zero visual/physics regression, eliminates 100% of hidden-card/hidden-tab 60 FPS CPU/GPU work, cuts idle `MeshLine` WebGL uploads, reduces PMREM cubemap shading 16× on mobile, and frees GPU textures on unmount.

---

## 6. Selected Change and Justification
Implemented the contained lifecycle, frame-loop, and GPU-resource optimizations inside `components/tuition/lanyard/Lanyard.tsx`:
1. Added `visibilitychange` listener (`isPageVisible`) and `simulationActive = interactive && isPageVisible`.
2. Passed `frameloop={simulationActive ? "always" : "never"}` to `<Canvas>` and `paused={!simulationActive}` to `<Physics>`.
3. Added `frames={1} resolution={isMobile ? 64 : 128}` to `<Environment>`.
4. Added `processedBandTexture.dispose()` cleanup `useEffect` on unmount.
5. Added settled-ribbon check (`isRibbonSettled` via `lastRibbonHook`, `lastRibbonJ3`, `ribbonSettledFramesRef`) to skip `curve.getPoints()` + `setPoints()` when settled, replaced per-frame `.forEach()` array allocations with `stepJoint()`, and gated `setAngvel()` on `Math.abs(rot.y) > 0.002`.

---

## 7. Exact Files Modified
- `components/tuition/lanyard/Lanyard.tsx` (contained lifecycle, frameloop/physics pause, settled `MeshLine` skip, `Environment` PMREM optimization, and `CanvasTexture` disposal)
- `tests/phase5f_lanyard_performance.test.ts` (new, 4 regression tests)

---

## 8. Before-and-After Lighthouse Results (Mobile `390x844`, 4x CPU, Median of 3 Runs)
| Portal | Score (Before → After) | TBT (Before → After) | Main Thread (Before → After) | CLS |
|---|---|---|---|---:|
| Quran Student (`#dashboard`) | `72` → **`72`** | `2,005` → **`1,987 ms`** | `5,369` → **`5,224 ms` (-145 ms)** | `0` → **`0`** |
| Tuition Student (`#dashboard`) | `73` → **`73`** | `1,763` → `1,819 ms` | `4,727` → `4,747 ms` | `0.019` → `0.019` |

*Honest Assessment*: Startup mobile Lighthouse TBT remains `~1.8–2.0 s` because `@dimforge/rapier3d-compat` (`2.24 MB` WASM-in-JS) still parses and compiles once on initial Lanyard mount (which is preserved intentionally to keep Rapier3D physics intact). The primary runtime win is eliminating ongoing 60 FPS background CPU/GPU work when hidden/backgrounded and idle buffer uploads.

---

## 9. CPU and Memory Comparisons (Runtime Profiler)
| Configuration | Hidden rAF/s (Before → After) | Heap After 5× Cycles (Before → After) | Reshow Latency (Before → After) |
|---|---:|---:|---:|
| Quran Student Desktop (`1280x800`) | `60.5` → **`0` (-100%)** | `15.0` → **`13.9 MB` (-1.1 MB)** | `56` → `60 ms` |
| Quran Student Mobile (`390x844`, 4x) | `60.5` → **`0` (-100%)** | `15.6` → `15.9 MB` | `140` → **`96 ms` (-44 ms)** |
| Tuition Student Desktop (`1280x800`) | `61.0` → **`0` (-100%)** | `16.7` → **`14.2 MB` (-2.5 MB)** | `85` → **`55 ms` (-30 ms)** |
| Tuition Student Mobile (`390x844`, 4x) | `60.5` → **`0` (-100%)** | `14.6` → **`13.9 MB` (-0.7 MB)** | `83` → `107 ms` |

---

## 10. 3D Initialization Measurements
- Dashboard controls (`Show/Hide student ID card` button) remain usable in **`984–1,295 ms`** (Desktop) and **`1,511–1,693 ms`** (Mobile 4x CPU), **before** the `1,800 ms` deferred Lanyard mount.
- Lanyard `<canvas>` appears at `1,855–1,864 ms` on Desktop and `2,393–2,607 ms` on Mobile 4x CPU (`Lanyard` chunks: `3,259.77 KiB` raw / `1,112.41 KiB` gzip).

---

## 11. Quran Student Browser Verification
Verified `qa_5f_qstudent` across `1280x800`, `768x1024`, and `390x844` on `dist/`:
- `overflow: false`, `dragWorked: true`, `hideAriaHidden: true`, `showAriaHidden: true`, `logoutWorked: true`, `pageErrors: []`, `webglErrors: []`.

---

## 12. Tuition Student Browser Verification
Verified `qa_5f_tstudent` across `1280x800`, `768x1024`, and `390x844` on `dist/`:
- `overflow: false`, `dragWorked: true`, `hideAriaHidden: true`, `showAriaHidden: true`, `logoutWorked: true`, `pageErrors: []`, `webglErrors: []`.

---

## 13. Dragging, Show/Hide, and Animation Verification
- Pointer drag over the `<canvas>` bounding box completed cleanly across all 6 portal × viewport runs.
- Clicking **Hide student ID card** sets `aria-hidden="true"` and drops rAF/physics simulation to **`0 FPS`**; clicking **Show student ID card** restores `aria-hidden="false"` and replays the drop animation within `55–107 ms`.

---

## 14. WebGL Cleanup and Lifecycle Results
- `canvasCount: 1` after 5× Hide/Show cycles across all 4 profiled configurations (no duplicate WebGL contexts or duplicate physics worlds).
- `processedBandTexture.dispose()` frees the procedural `180×1200` `CanvasTexture` on unmount.
- Disposable QA accounts (`qa_5f_qstudent`, `qa_5f_tstudent`, `qa_5f_qteacher_tmp`) were deleted after testing.

---

## 15. TypeScript and Production Build Results
- `npm run typecheck` (`tsc --noEmit`): **Passed** (exit code `0`).
- `npm run build` (`vite build`): **Passed** (exit code `0`, 3,686 modules transformed).
- `backend/manage.py check`: **Passed** (`System check identified no issues (0 silenced)`).

---

## 16. Frontend Regression Tests
- `node --test tests/*.test.ts`: **122 / 122 passed** (`0` failed, `0` skipped — 118 existing + 4 new in `tests/phase5f_lanyard_performance.test.ts`).

---

## 17. Remaining Performance Issues
- `@dimforge/rapier3d-compat` (`2.24 MB` raw WASM-in-JS) remains the dominant driver of initial Lanyard chunk download and mobile `~1.8–2.0 s` TBT (`~6–7 s` cold). Reducing this further would require either replacing Rapier3D with a lightweight kinematic/spring solver or loading WASM externally with streaming instantiation.

---

## 18. Safe Phase-Specific Rollback
To revert only Phase 5F without touching Phases 5A–5E:
```powershell
git checkout -- components/tuition/lanyard/Lanyard.tsx
Remove-Item tests/phase5f_lanyard_performance.test.ts, PERFORMANCE_PHASE_5F_RESULTS.md
```

---

## 19. Manual User Verification Requirements
Manual check on a real device/browser is recommended to confirm the 3D feel:
- [ ] **Quran Student (Desktop & Mobile)**: Confirm dashboard controls are usable immediately, 3D ID card drops smoothly after ~1.8 s, dragging feels responsive, **Hide/Show ID card** pauses/resumes cleanly, and drawer/Logout work.
- [ ] **Tuition Student (Desktop & Mobile)**: Confirm Tuition branding/card appearance, dragging, **Hide/Show ID card**, tab switching, and Logout work cleanly.

---

## 20. Recommendation for the Original Phase 5G
Proceed to **Phase 5G** only after manual verification of the 3D Lanyard feel above. If further mobile Student Lighthouse gains are desired in a future phase, evaluate replacing `@dimforge/rapier3d-compat` (`2.24 MB`) with a lightweight analytic pendulum/spring solver behind the same `Lanyard` props.
