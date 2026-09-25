# archsim

An architect-in-a-box for distributed systems. npm workspaces monorepo:

```
packages/engine/   Headless architecture-pattern engine — see packages/engine/README.md
apps/web/          Next.js App Router UI (the full loop: diagram, controls, fixes)
```

A system model is a rough architectural sketch — categorical traits, never
numbers (`instanceCount: "single"`, `hasCircuitBreaker: false`), built from a
prose description via an AI call. Architectural risk against that model —
single points of failure, thundering herds, cascading failures, unbounded
admission, and more — is identified by a separate, free-form AI call given
the model as context (`packages/engine/src/inference/identifyFailures.ts`),
not by a hand-written pattern catalogue; see `CONTEXT.md`'s "Why the pivot"
section for the numeric-queueing-engine history this superseded, and
`packages/engine/src/inference/identifyFailures.ts`'s own top comment for
why findings moved from computed to AI-generated. The engine has no UI
dependencies and can be used standalone; `apps/web` consumes it as a
workspace package (`@archsim/engine`).

```bash
npm install
npm test          # runs both workspaces' test suites (493 tests)
npm run typecheck
npm run dev        # serves apps/web
```

See `plans/PLAN-4.md` onward for the phased product plan (PLAN-0 through
PLAN-3 covered the work already shipped — auth, persistence, multi-project
support, the AI-generated-findings pivot — and were deleted rather than
kept as a stale roadmap; see git history if you need them), and
`CONTEXT.md` for AI-assisted development context.
