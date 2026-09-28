# Deploying CuriousArch

Target: Vercel (Next.js 16, Node 24 per `.nvmrc`). Any Node host works the same way; only the "Vercel" steps differ.

## 1. Accounts and keys you need
- **Anthropic** API key. Set a **monthly spend limit** in the console before launch: it is the backstop behind the in-app free quota.
- **Supabase** project (Auth + Postgres).
- **Google Cloud** OAuth client (type Web) for Google sign-in.
- Optional: **hCaptcha** (bot check on guest sign-in).

## 2. Supabase setup (once)
1. SQL editor, in this order (each is idempotent): `apps/web/db/projects.sql` → `apps/web/db/ai-usage.sql` → `apps/web/db/guest-trial.sql`.
2. Authentication → **Sign In / Providers**: enable Email (magic link), Google (paste the client ID/secret), and **Allow anonymous sign-ins** (click *Save changes*).
3. Authentication → **URL Configuration**: *Site URL* = your production origin; *Redirect URLs* must include `https://<your-domain>/auth/callback` (and `http://localhost:3000/auth/callback` for local).
4. Authentication → **Attack Protection**: if you turn the bot check on, enable hCaptcha and paste its **secret** here.
5. Schedule (Dashboard → Integrations → Cron, or pg_cron): `select purge_ai_call_payloads();` and `select public.purge_anonymous_users(30);` daily.
6. Turn on database backups (Project Settings → Database) if your plan has them.

## 3. Google OAuth
Authorized JavaScript origins: `https://<your-domain>` (and `http://localhost:3000`). The sign-in button uses Google Identity Services directly, so no redirect URI is needed on Google's side.

## 4. Vercel
1. Import the repo. **Root Directory: `apps/web`**, and enable *Include source files outside of the Root Directory* (the app imports the `packages/engine` workspace).
2. Framework preset: Next.js. Install: `npm ci` at the repo root is what Vercel runs for workspaces; build: `next build` (default).
3. Environment variables: everything in `apps/web/.env.example` (Production and Preview). Set `NEXT_PUBLIC_SITE_URL` to the final origin **before the first production build** (it is baked into canonical URLs and the sitemap). Start with `TRIAL_ENABLED=false` if you have not run `guest-trial.sql`.
4. Attach the domain; HTTPS is automatic (the app sends HSTS).
5. Function region close to your Supabase region; AI routes can run up to a minute, so use a plan/setting whose function timeout allows it (`maxDuration`).

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
- Error monitoring (e.g. Sentry) and rate limiting beyond the free quota are not set up.
