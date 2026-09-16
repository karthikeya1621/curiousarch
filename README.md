# archsim

A capacity simulator for distributed systems. npm workspaces monorepo:

```
packages/engine/   Headless capacity-simulation engine — see packages/engine/README.md
apps/web/          Next.js App Router UI (Phase 1, in progress)
```

The engine takes a system model and computes where it breaks — queueing math,
per-component capacity, findings, breaking-point search — plus a what-if/fix
exploration flow (relative scenario comparisons rather than absolute
forecasts; see `plans/PLAN-0.md`'s "Reframing: what-if over forecasting" for
why). It has no UI dependencies and can be used standalone; `apps/web`
consumes it as a workspace package (`@archsim/engine`).

```bash
npm install
npm test          # runs packages/engine's test suite
npm run typecheck
npm run dev        # serves apps/web
```

See `plans/PLAN-0.md` through `PLAN-3.md` for the phased product plan, and
`CONTEXT.md` for AI-assisted development context.
