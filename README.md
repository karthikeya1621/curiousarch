# archsim

An architect-in-a-box for distributed systems. npm workspaces monorepo:

```
packages/engine/   Headless architecture-pattern engine — see packages/engine/README.md
apps/web/          Next.js App Router UI (the full loop: diagram, controls, fixes)
```

The engine takes a rough system model — categorical traits, never numbers —
and computes real architectural risk against it: single points of failure,
thundering herds, cascading failures, unbounded admission, and more, via a
deterministic pattern catalogue (`packages/engine/src/patterns.ts`), plus a
what-if/fix exploration flow (flip a trait toward its riskier value, see what
breaks, pick a fix, see whether it actually resolved it). See `CONTEXT.md`'s
"Why the pivot" section for why this replaced an earlier numeric queueing
engine. It has no UI dependencies and can be used standalone; `apps/web`
consumes it as a workspace package (`@archsim/engine`).

```bash
npm install
npm test          # runs packages/engine's test suite
npm run typecheck
npm run dev        # serves apps/web
```

See `plans/PLAN-0.md` through `PLAN-3.md` for the phased product plan, and
`CONTEXT.md` for AI-assisted development context.
