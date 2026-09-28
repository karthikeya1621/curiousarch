# Specialist brief: Operations & deployment readiness

Shared context and rules: [../README.md](../README.md). Output format: [../REPORT-TEMPLATE.md](../REPORT-TEMPLATE.md).

**Mission:** find what will bite in production operations. Read-only; no paid calls; never print `apps/web/.env.local` (list variable names only). Target: Vercel, root directory `apps/web`, the `packages/engine` workspace imported, Namecheap DNS; free product at launch.

## Check

1. **Env handling:** every `process.env` read in `apps/web` and `packages/engine` vs `apps/web/.env.example` and `docs/DEPLOYMENT.md`: missing or undocumented variables; read at module load vs request time; does a missing required variable fail loudly or degrade silently (`ANTHROPIC_API_KEY`, `SUPABASE_*`, `TRIAL_*`); `NEXT_PUBLIC_*` baked at build time.
2. **Vercel:** function duration limits vs the AI routes (is `maxDuration` set? plan limits), runtime and region, request-body limits, `after()` on Vercel for usage writes, whether the monorepo settings in `docs/DEPLOYMENT.md` match the real `package.json` / workspaces / `.nvmrc`, how the engine package resolves at build.
3. **Error surfaces:** `app/error.tsx`, `global-error.tsx`, `not-found.tsx`, loading states; what a user sees on an unhandled server error.
4. **Observability:** logging (PII, structure), no error monitoring, depth of `/api/health`, how an operator learns the Anthropic key is invalid or out of credit, Supabase is down, or the daily guest budget is exhausted.
5. **Data lifecycle:** `purge_ai_call_payloads` and `purge_anonymous_users` are functions that run only if scheduled; backups; account deletion.
6. **SEO/metadata:** `metadataBase`, canonical, robots, sitemap, manifest, JSON-LD in `app/login/layout.tsx`, OG images; login/privacy/terms indexable while the app is `noindex`.
7. **Docs accuracy:** `README.md`, `apps/web/README.md`, `CONTEXT.md`, `docs/DEPLOYMENT.md` vs the code.
8. **Repo hygiene:** files that should not ship (`public/logo-v5.svg` carries a C2PA blob; `.env*`, tsbuildinfo, `.next`), `.gitignore`, license, root scripts, Node pins, risky dependency versions.

## Done when

A ranked list with severity, production impact and minimal fix, plus a one-paragraph go/no-go for a first free launch.
