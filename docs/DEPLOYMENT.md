# Deploying CuriousArch

Target: Vercel (Next.js 16, Node 24 - pinned by `engines` in `apps/web/package.json`, and by `.nvmrc` for CI). Any Node host works the same way; only the "Vercel" steps differ.

## 1. Accounts and keys you need
- **Anthropic** API key. Set a **monthly spend limit** in the console before launch: it is the backstop behind the in-app free quota.
- **Supabase** project (Auth + Postgres).
- **Google Cloud** OAuth client (type Web) for Google sign-in.
- **An SMTP provider** (Resend, Postmark, SES...) for Supabase's auth email. Supabase's built-in mailer only delivers to your own team's addresses and is heavily rate-limited, so magic-link sign-in and the guest "Save my work" email would fail for real users without it.
- Optional: **hCaptcha** (bot check on guest sign-in).

## 2. Supabase setup (once)
1. SQL editor: paste and run `apps/web/db/setup-production.sql` once. It is `projects.sql` → `ai-usage.sql` → `guest-trial.sql` concatenated (each idempotent, so it is also how you apply a change to an existing project); keep it in sync by editing the source files and the combined file together. It also schedules the two 30-day purges with pg_cron; if the notice `pg_cron not scheduled` appears, enable the extension (Database → Extensions) and schedule them by hand (step 5).
2. Authentication → **Sign In / Providers**: enable Email (magic link), Google (paste the client ID/secret), and **Allow anonymous sign-ins** (click *Save changes*).
3. Authentication → **URL Configuration**: *Site URL* = your production origin; *Redirect URLs* must include `https://<your-domain>/auth/callback` (and `http://localhost:3000/auth/callback` for local).
4. Authentication → **Attack Protection**: if you turn the bot check on, enable hCaptcha and paste its **secret** here.
5. Retention: the script schedules `purge_ai_call_payloads()` and `purge_anonymous_users(30)` daily. Verify with `select jobname, schedule from cron.job;` (two rows). The privacy policy promises 30-day deletion of both, so this must be running.
6. Authentication → **SMTP Settings**: enter your provider's SMTP credentials, and add its SPF/DKIM records in your DNS (Namecheap). Test a magic link to an address outside your team.
7. Turn on database backups (Project Settings → Database) if your plan has them. A free-tier project also pauses after a week of inactivity; use a paid plan for anything public.

## 3. Google OAuth
Authorized JavaScript origins: `https://<your-domain>` (and `http://localhost:3000`). The sign-in button uses Google Identity Services directly, so no redirect URI is needed on Google's side. Publish the OAuth consent screen (**In production**), or only listed test users can sign in.

## 4. Vercel
1. Import the repo. **Root Directory: `apps/web`**, and enable *Include source files outside of the Root Directory* (the app imports the `packages/engine` workspace).
2. Framework preset: Next.js. Install: `npm ci` at the repo root is what Vercel runs for workspaces; build: `next build` (default).
3. Environment variables: everything in `apps/web/.env.example` (Production and Preview). Set `NEXT_PUBLIC_SITE_URL` to the final origin **before the first production build** (it is baked into canonical URLs and the sitemap). Launch with `TRIAL_ENABLED=true` (after running the SQL) and a long random `TRIAL_IP_SALT` (**required**: without it the trial refuses to run in production). With `TRIAL_ENABLED=false` guests get no access and every signed-in user is unlimited, so only the Anthropic spend limit protects you. With it on, every non-admin account gets the free quota (1 build, 1 Re-simulate, 5 chat messages, one project); guests are also held to `TRIAL_DAILY_BUDGET_USD` and a per-IP cap, and new signed-in accounts to `TRIAL_MEMBER_DAILY_BUDGET_USD`.
4. Attach the domain; HTTPS is automatic. At Namecheap (Advanced DNS): an `A` record for `@` to `76.76.21.21` and a `CNAME` for `www` to `cname.vercel-dns.com` (use the values Vercel shows), then pick the canonical host and redirect the other. Add both hosts to Supabase's redirect URLs and Google's authorized origins. The app sends a short HSTS (5 minutes); raise it in `next.config.ts` once every host on the domain is confirmed HTTPS.
5. Function region close to your Supabase region. The AI routes set `maxDuration = 300` (a build chains several model calls); if your plan caps functions lower, lower the constant in `app/api/*/route.ts` to the plan's limit.

## 5. After the first deploy
- `GET /api/health` returns `{"status":"ok"}`; point an uptime monitor at it.
- `/robots.txt` and `/sitemap.xml` load **without** logging in (the proxy excludes them); `/login` is indexable, everything else is `noindex`.
- Submit `https://<your-domain>/sitemap.xml` in Google Search Console and Bing Webmaster Tools.
- Paste the URL into a link-preview checker (or Slack/LinkedIn) to confirm the social card (`app/opengraph-image.png`).
- Sign in as yourself (is `ADMIN_EMAILS` set?) and open `/admin/usage`.
- Try the guest flow in a private window; confirm a second build shows the trial banner.

## Brand and SEO files
| What | File | Regenerate |
|---|---|---|
| Tab icon | `apps/web/app/icon.svg` | edit by hand |
| iOS icon, social cards, PWA icons | `app/apple-icon.png`, `app/opengraph-image.png`, `app/twitter-image.png`, `public/icon-192.png`, `public/icon-512.png` | `node scripts/generate-brand-assets.mjs` (in `apps/web`) |
| Names, tagline, description, origin | `apps/web/lib/site.ts` | edit; set `NEXT_PUBLIC_SITE_URL` |
| robots / sitemap / manifest | `app/robots.ts`, `app/sitemap.ts`, `app/manifest.ts` | code |

## Known gaps before charging money
- **Legal review of `/privacy` and `/terms`.** Both pages exist (plain-language drafts of what the code actually does: data collected, processors, 30-day prompt retention, guest IP hashing), but a lawyer should review them before you charge money, and you need to set `NEXT_PUBLIC_CONTACT_EMAIL`. In Google Cloud's OAuth consent screen, set the privacy and terms URLs to `https://<your-domain>/privacy` and `/terms`.
- **Content-Security-Policy** header (needs a nonce plus Google Sign-In and hCaptcha allowances; test in a browser).
- **A public landing page** would help search far more than the sign-in page can (today `/` redirects to `/login`).
- **Billing / credits** (billing that honours `withheld` outcomes is not built).
- **Live evaluation** of the flow against the final gate on a larger batch, a browser click-through of the UI, and a professional architecture review (see `CONTEXT.md`).
- Error monitoring (e.g. Sentry, or a webhook from `instrumentation.ts`'s `onRequestError`) and rate limiting beyond the free quota are not set up. Vercel keeps runtime logs only briefly; set the Anthropic low-balance alert.
- The trial SQL is not executed by any test (unit tests mock Supabase). Add a throwaway-Postgres CI job before relying on it for money: cases in `docs/orchestration/README.md`, run 1.
- A public `/api/health` only proves the server is up; it does not check Supabase or the Anthropic key.
