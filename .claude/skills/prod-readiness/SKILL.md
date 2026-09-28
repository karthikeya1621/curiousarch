---
name: prod-readiness
description: Run the multi-agent production-readiness review of CuriousArch - six read-only specialist agents (security, correctness, performance/cost, accessibility/UX, tests/CI, ops/deploy) in parallel, then the orchestrator verifies findings, fixes, and reports. Use when asked to make the code production ready, run a launch review, or audit before a release.
---

Follow `docs/orchestration/README.md` exactly; the briefs are in `docs/orchestration/agents/` and the report format in `docs/orchestration/REPORT-TEMPLATE.md`.

1. **Baseline.** Run `git status`, `npm run typecheck`, `npm test`. Note the commit. State the launch context (free or paid, audience) - it goes into every brief.
2. **Fan out.** In ONE message, launch six `general-purpose` agents in the background, one per file in `docs/orchestration/agents/`. Each prompt = the brief's text + the shared rules from the README (read-only, no paid calls, no secrets, verified claims only, `apps/web/AGENTS.md` note) + the launch context. Do not do the specialists' work yourself while they run.
3. **Triage.** When all six report, merge into one ledger. Re-read the cited lines for every finding before accepting it; mark `fix now` / `fix later` / `won't fix` / `false positive`. Security, data loss and money default to `fix now`.
4. **Fix.** Serially, smallest first, by you. No parallel writers on one tree (use `isolation: "worktree"` and disjoint files if parallel work is unavoidable). Mutation-check every new test. Judgment stays with the AI; code enforces structural validity only.
5. **Verify.** typecheck, `npm run lint --workspace web`, `npm test`, `next build` in `apps/web`; browser check for UI changes (`run-web` skill).
6. **Report.** Append the run to "Runs" in `docs/orchestration/README.md` (date, commit, findings by severity, fixed, deferred, gate results, go/no-go). Update test counts in `CONTEXT.md`, `README.md`, `plans/PLAN-4.md`. Commit and push only when the owner says so, and never echo secrets.

If agents cannot be launched (tooling refusal), say so, and do a single-agent pass through the same six briefs in order instead of pretending the fan-out ran.
