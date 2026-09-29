---
name: e2e-live-guest
description: Run a real, money-spending guest-trial smoke test against the LIVE deployed site (not localhost) - try-as-guest, build a tiny system, confirm the diagram renders, build again, confirm the trial-limit banner. Use only when explicitly asked to test the live/production site's guest flow.
---

Drives the production site with the same Playwright REPL driver `run-web` uses (`apps/web/.claude/skills/run-web/driver.mjs`), just pointed at the live origin instead of `localhost:3000`. No local dev server, no build - it is testing what is already deployed.

**This spends real money** (real Anthropic API calls, counted against the live guest daily budget) **and creates a real guest account and project** in production (cleaned up by the scheduled purge job after ~30 days). Only run this when the user has explicitly asked to test the live site, and tell them the live URL and rough cost before the first run of a session.

## Prerequisites
Same as `run-web`: `cd apps/web && npx playwright install --with-deps chromium` (no-op if already installed).

## Run

From `apps/web/`, with `LIVE_URL` set to the real origin (ask the user if unknown - do not guess a domain):

```bash
SCREENSHOT_DIR=/tmp/shots node .claude/skills/run-web/driver.mjs <<EOF
launch ${LIVE_URL}/login
wait-text Try it as a guest
ss 01-login
click-text Try it as a guest
wait-text Describe the system you want to build
ss 02-guest-landed
type textarea a tiny url shortener for 100 users
click-text Build model
wait-text Possible failures
ss 03-build-done
click-text Build model
wait-text free build
ss 04-trial-limit
quit
EOF
```

Run it in small chunks (2-4 lines at a time) rather than one long heredoc when the user wants to see progress mid-run - `Read` each screenshot immediately after it's taken and show it before issuing the next chunk, instead of batching the whole script and reporting only at the end.

## What each screenshot proves
- `01-login`: the live login page rendered, guest option visible (budget not exhausted, `TRIAL_ENABLED=true` reached the server).
- `02-guest-landed`: `signInAnonymously` succeeded against the real Supabase project; the blank-state builder rendered for a real anonymous session.
- `03-build-done`: a real `/api/infer` call round-tripped through the live Anthropic key, the trial quota was reserved and recorded, and findings came back.
- `04-trial-limit`: the second build was refused by the live `trial_reserve` SQL (quota exhausted) and the client showed the banner - the actual money-safety mechanism, working in production, not just in unit tests.

## After running
Report: whether each screenshot showed what it should, and the actual cost (`select cost_usd from ai_calls order by created_at desc limit 5;` via the Supabase tool, if connected) - never estimate silently when the real number is checkable. Do not repeat the run to "double check" - each repeat spends money and consumes one more guest account/day-cap slot for real users.

## Gotchas
- `type textarea ...` fills the first `<textarea>` on the page - the build description box is the only one on the blank-state screen, so no more specific selector is needed.
- The Google Identity Services script logs a console 403 on any origin it isn't configured for; harmless, ignore it (see `run-web`'s own gotchas).
- If `wait-text Try it as a guest` times out, the guest option is hidden - the live daily budget is likely already spent, not a driver bug. Check `/api/trial/status` directly (`curl ${LIVE_URL}/api/trial/status`) before assuming the test is broken.
