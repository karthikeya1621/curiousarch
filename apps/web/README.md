# apps/web

Next.js App Router UI for archsim — the full loop: describe a system in
prose, get a diagram with AI-identified findings, apply fixes or chat
free-form to evolve it, Re-simulate to commit a change, save and reopen
multiple projects. Consumes `packages/engine` as a workspace package
(`@archsim/engine`). See the repo root's `README.md` and `CONTEXT.md` for
the product/architecture picture this app implements.

## Setup

From the **monorepo root**, not this directory — this is an npm workspace,
and `npm install` only produces one correct lockfile/symlink set when run
from root:

```bash
npm install
```

Create `apps/web/.env.local` (gitignored, no example file checked in) with:

- `ANTHROPIC_API_KEY` — required for every inference call (`fromProse`,
  `identifyFailures`, `reworkModel`, chat). Optional `AI_REASONING_MODEL`/
  `AI_UTILITY_MODEL` override the defaults (see
  `packages/engine/src/inference/structuredCall.ts`).
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase
  project credentials (`apps/web/lib/supabase/`), backing auth and the
  `projects` table.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — for the client-side Google Identity
  Services login (`apps/web/app/login/page.tsx`).

The app is gated by `middleware.ts`; without these, login won't work.

## Run

```bash
npm run dev        # from the monorepo root — serves http://localhost:3000
```

## Test

```bash
npm test          # from the monorepo root — runs both workspaces' vitest suites
npm run typecheck # both workspaces; this app's script runs `next typegen` first
```

Tests here are unit-level only (the Zustand store in `lib/store.ts`, the
API routes under `app/api/`) — nothing drives the actual rendered app
end-to-end yet. For UI verification, see `.claude/skills/run-web/` (a
Playwright driver usable without a logged-in session) or exercise it
manually against a real login.

## Structure

```
app/                    App Router pages and API routes (one route per engine inference call)
app/login/              Magic-link + Google Identity Services login
app/auth/callback/      Supabase auth callback handler
middleware.ts           Gates every page behind a logged-in session
components/             UI — see FlowDiagram.tsx (the canvas), ChatWidget.tsx,
                        ProjectsCard.tsx, AutoSaveIndicator.tsx, AccountMenu.tsx
lib/store.ts            The Zustand store — model, findings, chat, versions, projects
lib/sessionStorage.ts   Supabase-backed project persistence (save/load/list/delete)
lib/layout.ts           SystemModel -> React Flow nodes/edges via ELK.js
lib/limits.ts           Client-side description-length cap, mirrored server-side
lib/apiRoute.ts         Shared route plumbing: size guard + JSON parse + 502 mapping, used by all five API routes
components/kindStyle.ts The one icon + color map per component kind (diagram card and detail modal share it)
lib/theme.ts            Light/Dark/System theme toggle
```
