You are optimizing an existing production-style React/Vite + Django app.

READ `PROJECT.md` FIRST. Treat it as the source of truth for optimization history, completed work, metrics, safety rules, and next step.

GOAL
Improve performance only. Business logic is already working. Preserve behavior, permissions, attendance semantics, payroll/salary lifecycle, department isolation, and UI meaning.

RULES
- Do not rewrite working architecture unless measurement proves it is necessary.
- Do not touch unrelated dirty/staged files.
- Never use broad `git restore`, `git reset`, `git clean`, or mass formatting.
- Inspect before editing.
- Prefer small patches.
- Optimize measured bottlenecks only.
- Use production build results, not Vite dev performance.
- Keep heavy libraries out of initial bundles via lazy/dynamic import.
- Avoid repeated `.find/.filter` inside render loops; build memoized maps/indexes where useful.
- Reduce API payloads and N+1 queries without changing data correctness.
- Do not cache partial state as full state.
- Preserve WebSocket correctness.
- Do not optimize another page until the current stage is validated.

WORKFLOW
1. Read `PROJECT.md`.
2. Inspect only files needed for the current stage.
3. Measure current bottleneck.
4. State the top 1–3 causes in a few lines.
5. Implement the smallest safe fix.
6. Run:
   - `npm run build`
   - `cd backend && python manage.py check`
   - `git diff --check`
7. Run relevant regression checks.
8. Measure again.
9. Update `PROJECT.md`:
   - files changed
   - what changed
   - before/after metrics
   - tests
   - remaining bottleneck
   - exact next step

CURRENT TASK
Follow the `Current Next Step` in `PROJECT.md`. Do not start later stages early.

OUTPUT STYLE
Be concise. Do not repeat project history already in `PROJECT.md`.
At the end return only:
- changes made
- measurements before/after
- validation results
- remaining issue
- exact next step

## CONTINUOUS PROJECT CHECKPOINTING
PROJECT.md is persistent project memory.

After EVERY meaningful code change, discovered issue, validation result, measurement, or completed sub-step:
1. update PROJECT.md immediately
2. record what changed and the result
3. record the exact next step
4. only then continue working

Do not postpone PROJECT.md updates until session end.

If context/token budget becomes low, stop new work and update PROJECT.md first.

A new Codex session must be able to continue using only:
- PROJECT.md
- CODEX_OPTIMIZATION_PROMPT.md
- repository contents
