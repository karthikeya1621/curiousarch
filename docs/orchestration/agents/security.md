# Specialist brief: Security

Shared context and rules: [../README.md](../README.md). Output format: [../REPORT-TEMPLATE.md](../REPORT-TEMPLATE.md).

**Mission:** find real security problems in CuriousArch before it goes public. Read-only; no paid calls; never print secrets.

**Launch context to paste in:** free product, guest trial (Supabase anonymous users, server-counted quota in SQL), free quota for signed-in accounts, no billing yet, deployed on Vercel.

## Review at least

- `apps/web/proxy.ts`: the login gate and its matcher. Which paths are public and should they be? Can a crafted path or header skip it?
- Every route in `apps/web/app/api/**` and `app/auth/callback`: authentication, input validation, body-size limits, error leakage.
- `apps/web/lib/trial/**` and `db/guest-trial.sql`: quota gate, fail-closed behaviour, IP hashing, `security definer` functions (`search_path`, grants and revokes), RLS with no policies.
- `db/projects.sql` and `db/ai-usage.sql`: row-level security; what can `anon` and `authenticated` read or write.
- `apps/web/lib/supabase/**` (service-role key use, browser vs server clients), `lib/admin.ts` (allow-list, confirmed email).
- `apps/web/lib/nextPath.ts`: open-redirect resistance for `?next=` and the cookie.
- `apps/web/lib/limits.ts`: what is validated on the model, queue and messages sent by the client; can an oversized or malformed model cause cost or a crash.
- Prompt-injection blast radius: user text reaches the model; what can the model's output do in the app (does any output reach the DOM, SQL, a URL, another user)?
- Cost-abuse vectors: quota bypass by reusing or omitting `actionId`, gating of findings/explain-fix, parallel requests, many guest accounts, signed-in users hammering AI routes (no rate limit beyond quota).
- `apps/web/next.config.ts` headers (no CSP yet: what is the realistic XSS surface, any `dangerouslySetInnerHTML`), `NEXT_PUBLIC_*` exposure, PII in logs, dependency risk visible in `package.json`.

## Done when

A ranked list of verified findings, each with a concrete exploit scenario and minimal fix, plus the areas found sound.
