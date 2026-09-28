# apps/web

Next.js App Router UI for archsim — the full loop: describe a system in
prose, get a diagram with AI-identified findings, apply fixes or chat
free-form to queue changes, Re-simulate to apply what's queued, save and reopen
multiple projects. Consumes `packages/engine` as a workspace package
(`@archsim/engine`). See the repo root's `README.md` and `CONTEXT.md` (an index into `docs/context/`) for
the product/architecture picture this app implements.

## Setup

From the **monorepo root**, not this directory — this is an npm workspace,
and `npm install` only produces one correct lockfile/symlink set when run
from root:

```bash
npm install
```

Create `apps/web/.env.local` (gitignored; copy [`.env.example`](.env.example), which lists every variable including the production and guest-trial ones, and see [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md) for going live) with:

- `ANTHROPIC_API_KEY` — required for every inference call (`fromProse`,
  `identifyFailures`, `reworkModel`, chat). Optional `AI_REASONING_MODEL`/
  `AI_UTILITY_MODEL` override the defaults (see
  `packages/engine/src/inference/structuredCall.ts`).
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase
  project credentials (`apps/web/lib/supabase/`), backing auth and the
  `projects` table.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — for the client-side Google Identity
  Services login (`apps/web/app/login/page.tsx`).

The app is gated by `proxy.ts`; without these, login won't work.

### AI usage tracking (optional)

Every AI call is recorded — user, project, the action that caused it (build,
Re-simulate, chat…), model, tokens (incl. cache reads/writes), cost, latency,
outcome, retries, and optionally the full prompt and response — so cost per
user/project/version can be answered from SQL. To turn it on:

1. Run [`db/ai-usage.sql`](db/ai-usage.sql) once in the Supabase SQL editor
   (idempotent). It creates `ai_calls`, `ai_call_payloads`,
   `ai_action_outcomes`, two rollup views (`ai_action_usage`,
   `ai_label_stats`) and a payload-purge function.
2. Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` (server-only — no
   `NEXT_PUBLIC_` prefix; it bypasses RLS, which is what lets only the server
   write usage rows). Without it tracking silently turns itself off and the
   AI calls are unaffected.
3. Optional: `AI_MODEL_PRICES` — JSON `{"<model id>": {"inputPerMTok": 3,
   "outputPerMTok": 15}}` (USD per million tokens), to override a default or
   add a model. The two default tiers (`AI_REASONING_MODEL`/`AI_UTILITY_MODEL`
   unset — Sonnet 5 and Haiku 4.5) are priced out of the box; a model this
   doesn't know the price of stores its tokens but a `null` cost rather than
   a guess (`cost_complete` is false in `ai_action_usage`).
4. Optional: `AI_USAGE_LOG_PAYLOADS=false` to keep metrics only. By default
   full prompts/responses are stored in `ai_call_payloads` (they contain
   users' architecture descriptions) — schedule
   `purge_ai_call_payloads()` (default 30 days) with pg_cron.

**Admin cost dashboard** — `/admin/usage`, for you only (admins also get a "Usage" link in the app header, drawn only after `/api/admin/status` confirms the caller is one). Set
`ADMIN_EMAILS=you@example.com` (comma-separated) in `.env.local`. It's an
allow-list with no default: unset means nobody gets in, and anyone else (or an
unconfirmed email) sees a 404 before any data is read. It needs the same
service-role key and reads everything through one SQL function
(`ai_admin_dashboard`, in `db/ai-usage.sql` — re-run the file if you set this
up before the dashboard existed). Shows, for the last 24h / 7 / 30 / 90 days:
total cost, cost per action and per user, cache savings, retry / failed /
truncated rates, spend that was paid for but never shown, cost per day, cost by
action and by step × model, top users and projects, the most expensive actions
(with the `action_id` that joins to a version), and recent failures.

Joining a version to its cost: each version stores the `actionId` of the
build/Re-simulate that produced it — `select * from ai_action_usage where
action_id = '<version.actionId>'`. The client also reports responses that were
paid for but never shown (project switched, superseded, withheld) into
`ai_action_outcomes` (`discarded_reasons` in the view). Code: `lib/usage/`,
`lib/usageClient.ts`, `app/admin/usage/`, and the `onCall` hook in the engine's
`runStructuredCall`.

## Run

```bash
npm run dev        # from the monorepo root — serves http://localhost:3000
```

## Test

```bash
npm test          # from the monorepo root — runs both workspaces' vitest suites
npm run typecheck # both workspaces; this app's script runs `next typegen` first
```

Tests here are unit-level only (the Zustand store in `lib/store/`, the
API routes under `app/api/`) — nothing drives the actual rendered app
end-to-end yet. For UI verification, see `.claude/skills/run-web/` (a
Playwright driver usable without a logged-in session) or exercise it
manually against a real login.

## Structure

```
app/                    App Router pages and API routes (one route per engine inference call)
app/login/              Magic-link + Google Identity Services login
app/auth/callback/      Supabase auth callback handler
proxy.ts           Gates every page behind a logged-in session
components/             UI — see FlowDiagram.tsx (the canvas), ChatWidget.tsx,
                        ProjectsCard.tsx, AutoSaveIndicator.tsx, AccountMenu.tsx
lib/store/               The Zustand store, split into domain slices (model, queue, chat, versions, project, selection) — index.ts composes them
lib/projectRoute.ts      `/project/<id>` <-> open-project sync rule (pure, tested)
components/Workspace.tsx The whole app UI, rendered from app/(app)/layout.tsx so `/` and `/project/<id>` share one instance
lib/sessionStorage.ts   Supabase-backed project persistence (save/load/list/delete)
lib/layout.ts           SystemModel -> React Flow nodes/edges via ELK.js
lib/limits.ts           Client-side description-length cap, mirrored server-side
lib/apiRoute.ts         Shared route plumbing: size guard + JSON parse + 502 mapping, used by all five API routes
components/kindStyle.ts The one icon + color map per component kind (diagram card and detail modal share it)
lib/theme.ts            Light/Dark/System theme toggle
```
