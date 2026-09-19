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
npm test          # runs packages/engine's test suite
npm run typecheck
npm run dev        # serves apps/web
```

See `plans/PLAN-0.md` through `PLAN-3.md` for the phased product plan, and
`CONTEXT.md` for AI-assisted development context.
