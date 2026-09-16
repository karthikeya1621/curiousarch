---
name: run-web
description: Build, run, and drive archsim's Next.js web app (apps/web). Use when asked to start the web app, take a screenshot of it, click through its UI, or verify a UI change actually works in the browser.
---

`apps/web` is a Next.js 16 App Router app (Turbopack) in an npm-workspaces
monorepo, consuming `@archsim/engine` (`packages/engine`) as a sibling
workspace package. It's driven headlessly via a small Playwright REPL driver
at `.claude/skills/run-web/driver.mjs` — piped a script over stdin, not
typed interactively.

All paths below are relative to `apps/web/` (the monorepo root is one level
up).

## Prerequisites

```bash
cd apps/web
npx playwright install --with-deps chromium
```

`--with-deps` installs any OS-level shared libraries headless Chromium
needs (apt packages on Linux); on macOS it's a no-op beyond the browser
download itself. `playwright` is already a devDependency here — only the
browser binary needs a separate install, and it's cached machine-wide
(`~/Library/Caches/ms-playwright` on macOS), so this is a no-op on repeat
runs.

## Setup

From the **monorepo root** (not `apps/web`) — this is an npm workspace,
and `npm install` only produces one correct lockfile/symlink set when run
from root:

```bash
npm install
```

## Run (agent path)

Start the dev server from the monorepo root, poll until it actually
serves (don't `sleep` a fixed guess — Turbopack's first compile can take a
few seconds), then pipe a script into the driver:

```bash
# from the monorepo root
lsof -ti:3000 -sTCP:LISTEN | xargs -r kill   # free the port if a stale server is still up
rm -rf apps/web/.next
npm run dev > /tmp/nextdev.log 2>&1 &
disown
i=0; until curl -sf http://localhost:3000 >/dev/null 2>&1 || [ $i -ge 30 ]; do sleep 1; i=$((i+1)); done
```

Then, from `apps/web/`:

```bash
SCREENSHOT_DIR=/tmp/shots node .claude/skills/run-web/driver.mjs <<'EOF'
launch http://localhost:3000
wait-text Checkout / order placement
ss 01-initial
click-card-badge PostgreSQL
wait-text possible failure
ss 02-indicator-open
click-text connection pool halves
wait-text Per-component utilization
ss 03-failure-selected
quit
EOF
```

Screenshots land in `$SCREENSHOT_DIR` (default `/tmp/shots/`). Stop the
server afterwards the same way: `lsof -ti:3000 -sTCP:LISTEN | xargs -r kill`.

`macOS note`: `timeout` and `tmux` are GNU/Linux tools not present by
default on macOS — the polling loop above avoids `timeout`, and the whole
script is piped as one heredoc rather than typed via `tmux send-keys`,
which also works fine (see Gotchas) and needs no extra tooling either way.

### Driver commands

| command | what it does |
|---|---|
| `launch [url]` | launch headless Chromium, navigate, wait ~500ms for hydration to settle (default url `http://localhost:3000`) |
| `ss [name]` | full-page screenshot → `$SCREENSHOT_DIR/<name>.png` |
| `click <css-sel>` | click via Playwright's normal click pipeline |
| `click-text <text>` | click the first `button`/`a`/`[role=button]` whose text is or contains `<text>` |
| `click-card-badge <text>` | archsim-specific — see Gotchas: click the failure-count badge on the `ComponentCard` whose title contains `<text>` |
| `set-input <css-sel> <value>` | set a controlled `<input>` (number or range) to `<value>` and fire React's `onChange` — see Gotchas |
| `wait <css-sel>` | wait up to 10s for a selector |
| `wait-text <text>` | wait up to 10s for `document.body.innerText` to contain `<text>` |
| `text [css-sel]` | print `innerText` of the selector (or `document.body`) |
| `eval <js>` | evaluate an expression in the page, print the JSON result |
| `quit` | close the browser, exit |

## Run (human path)

```bash
npm run dev   # from monorepo root; serves http://localhost:3000
```

## Test

```bash
npm test          # from monorepo root — runs packages/engine's vitest suite
npm run typecheck # both workspaces; apps/web's script runs `next typegen` first (see Gotchas)
```

`apps/web` has no test suite of its own yet — `npm test` currently only
exercises `packages/engine`.

---

## Gotchas

- **The default AI-agent tools on this machine don't include `tmux` or GNU
  `timeout`.** Don't assume either is available. Pipe the whole driver
  script as one heredoc (shown above) instead of `tmux send-keys`-ing
  commands one at a time, and poll with a manual `until ...; do sleep 1;
  done` loop instead of wrapping commands in `timeout`.

- **Piping a whole script into the driver races unless commands are
  explicitly serialized.** Node's `readline` fires a `'line'` event for
  every buffered line as soon as it's read — it does **not** wait for an
  async line handler's promise to resolve before firing the next one. A
  naive `rl.on('line', async (line) => { await run(line) })` runs every
  command concurrently against a browser that usually hasn't launched yet.
  The driver here chains each line onto a single promise
  (`queue = queue.then(() => processLine(line))`) so commands run strictly
  in the order they were written. If you rewrite this driver from scratch,
  keep that queue — it's the difference between "launch; click; screenshot"
  working and every command failing with "launch first."

- **A click right after `wait-text` can silently no-op — hydration hasn't
  finished.** `wait-text` checks `document.body.innerText`, which is
  present in Next's server-rendered HTML *before* React finishes
  hydrating and attaching client-side click handlers. Clicking
  immediately after the text appears sometimes hits a button with no
  listener yet — the click call succeeds (no error) but nothing happens,
  and it's intermittent, not consistently reproducible. The driver's
  `launch` command waits an extra ~500ms after `networkidle` for this
  reason; don't remove it as "probably unnecessary."

- **Piped (non-TTY) stdin closes the `readline` interface as soon as the
  heredoc ends — before queued commands finish.** The `close` event
  handler must `await` the same command queue before calling
  `process.exit()`, or the tail of a piped script silently never runs.
  Relatedly, calling `rl.prompt()` after the interface has internally
  closed (which happens as soon as stdin ends, not when your `close`
  handler runs) logs a spurious "readline was closed" — guarded here with
  `if (!rl.closed) rl.prompt()`.

- **Tailwind utility classes aren't unique enough to target one card by
  CSS selector, and button text alone is ambiguous** (multiple
  `ComponentCard`s can show the same badge number). `click-card-badge`
  works around this by finding the element with both `.rounded-lg` and
  `.shadow-sm` classes whose `textContent` contains the given text —
  that combination is unique to `ComponentCard` in this app (the baseline
  summary and the failure/fix panels use `rounded-lg` without
  `shadow-sm`). If `SystemDashboard.tsx`'s card styling changes, this
  selector needs updating alongside it.

- **Neither `click` nor Playwright's own `.fill()` reliably drives
  `ControlPanel`'s number/range inputs.** They're React-controlled — React
  patches the element instance's `value` setter to track state, so setting
  `el.value` directly and dispatching `input` (what `.fill()` does under
  the hood for non-text input types, and what any hand-rolled `eval` tends
  to do) never reaches `onChange`. `set-input` works around this by
  calling the *prototype's* original `value` setter (via
  `Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')`)
  before dispatching `input`/`change` — the standard React-compatible
  trick. Confirmed working for both a plain number input
  (`connectionPoolSize`) and the traffic `<input type="range">`.

- **`apps/web`'s own `tsc --noEmit` fails with `Cannot find name
  'LayoutProps'` unless Next's route types exist first.** `LayoutProps` is
  an ambient type Next.js generates into `.next/types/`, which only exists
  after `next dev`/`next build`/`next typegen` has run once. A clean
  checkout has no `.next/`, so a bare `tsc --noEmit` fails there even
  though it might pass locally if you'd already run the dev server. Fixed
  by `apps/web/package.json`'s `typecheck` script running `next typegen`
  first — don't strip that back to a bare `tsc --noEmit`.

## Troubleshooting

- **`ERROR: launch first` on every command in a piped script**: the
  readline race described above — confirm the driver's `queue` chaining
  is intact (not reverted to a bare `async` line handler).
- **`TIMEOUT waiting for text: ...` on a click that should have worked**:
  likely the hydration race — re-run; if it's consistent (not
  intermittent), check the actual button label matches exactly (labels
  in this app are lowercase mid-sentence, e.g. "connection pool halves",
  not "Connection Pool Halves" — `click-text` matching is case-sensitive).
- **`Cannot find name 'LayoutProps'` when running `tsc --noEmit`
  directly** (bypassing the `npm run typecheck` script): run
  `npx next typegen` first, or just use `npm run typecheck` instead of
  invoking `tsc` directly.
- **Next.js dev-mode floating "N" badge appears in every screenshot**:
  that's Next's own dev-tools indicator overlay, not part of the app —
  harmless, ignore it in screenshots.
