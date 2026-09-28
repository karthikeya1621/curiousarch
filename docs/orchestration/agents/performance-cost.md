# Specialist brief: Performance & cost

Shared context and rules: [../README.md](../README.md). Output format: [../REPORT-TEMPLATE.md](../REPORT-TEMPLATE.md).

**Mission:** find real performance and AI-cost problems. Read-only; no paid calls; never print secrets. Reasoning model is Sonnet 5 ($2 / $10 per MTok), utility model Haiku 4.5 ($1 / $5).

## Review at least

- **Bundle and load:** what ships on `/` and `/login` (elkjs, @xyflow/react, whether heavy code is lazily loaded, whether the login page pulls in the workspace), Google GSI and hCaptcha script loading, `next/font` usage, PNG sizes in `app/` and `public/`, caching headers on metadata routes. An existing build in `apps/web/.next` can be inspected for route sizes (do not rebuild).
- **Redundant network calls:** `/api/trial/me`, `/api/admin/status`, `/api/trial/status`, repeated project-list fetches. Count the Supabase auth round trips per AI request (`proxy.ts`, the route, `startUsage`, `reserveTrial` each call `getUser`) and propose consolidation.
- **Database:** `lib/sessionStorage.ts` queries (is the whole `data` jsonb fetched for the project list?), indexes, autosave frequency and payload size.
- **Rendering:** hot spots in the diagram and store selectors.
- **AI cost controls:** how many model calls a Build / Re-simulate / chat / findings makes (`packages/engine/src/inference/*.ts`), prompt sizes, prompt caching, `max_tokens`, input-size limits (`lib/limits.ts`), anything that lets one user action fan out into unbounded calls. Estimate cost per action only where the code supports the number.

## Done when

A ranked list of verified findings with evidence (numbers where possible) and a minimal fix each, plus areas found sound.
