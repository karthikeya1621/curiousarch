---
name: run-web
description: Build, run, and drive CuriousArch's Next.js web app (apps/web). Use when asked to start the web app, take a screenshot of it, click through its UI, or verify a UI change actually works in the browser.
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
click-node-badge PostgreSQL
wait-text Possible failures
ss 02-indicator-open
click-text the replica fails
wait-text FINDINGS: BASELINE VS. UNDER THIS FAILURE
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
| `launch [url]` | launch headless Chromium, navigate, wait ~500ms for hydration to settle (default url `http://localhost:3000`) — also auto-accepts any `window.confirm`/`alert` dialog (e.g. "New Project"'s reset confirmation), since Playwright otherwise auto-dismisses them |
| `reload` | reload the current page in the same browser context (unlike `launch`, a no-op once a browser exists) - use this to verify anything backed by localStorage, e.g. CuriousArch's saved-session restore |
| `resize <width> <height>` | resize the viewport - use for checking CuriousArch's responsive breakpoints (lg=1024px, xl=1280px) |
| `ss [name]` | full-page screenshot → `$SCREENSHOT_DIR/<name>.png` |
| `click <css-sel>` | click via Playwright's normal click pipeline |
| `type <css-sel> <text...>` | fill a controlled input/textarea via Playwright's real `fill()` — see Gotchas, a raw eval `el.value = x` doesn't register with React |
| `click-text <text>` | click the first `button`/`a`/`[role=button]` whose text is or contains `<text>` |
| `click-node-badge <text>` | CuriousArch-specific — see Gotchas: click the amber failure-count badge on the flow-diagram node whose text contains `<text>` |
| `wait <css-sel>` | wait up to 10s for a selector |
| `wait-text <text>` | wait up to 45s for `document.body.innerText` to contain `<text>` |
| `wait-gone <text>` | wait up to 45s for `document.body.innerText` to stop containing `<text>` — use for "Reviewing..." to actually detect findings finished loading, since the page header's own static copy permanently contains phrases like "possible failure" |
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

- **Button text alone is ambiguous for finding a specific node's failure
  badge** — every node with any scenarios renders the same kind of amber
  circular button, distinguished only by its count and its `title`
  attribute (which isn't part of `innerText`, so `wait-text`/`click-text`
  can't see it). `click-node-badge` works around this by finding the
  React-Flow-wrapped node (`.react-flow__node`) whose `textContent`
  contains the given text — the node's label or id is enough to
  disambiguate — then clicking the one `button[title*='possible failure']`
  inside it. `ControlPanel` is entirely `<button>`-based now too (a
  segmented toggle for enum traits, a switch for booleans) — plain
  `click-text` on the option label reaches those directly, no custom
  command needed.

- **`wait-text`/`click-text` see the rendered case, not the source JSX
  string.** Both read `innerText` (or its equivalent, `textContent` for
  matching), which reflects CSS `text-transform` — a heading written as
  `Findings: baseline vs. under this failure` but styled `uppercase`
  actually appears to the driver as `FINDINGS: BASELINE VS. UNDER THIS
  FAILURE`. Confirmed by hitting exactly this timeout while verifying this
  skill's own example script. If a `wait-text` you expect to match times
  out, check the element's classes for `uppercase`/`lowercase`/`capitalize`
  before assuming the text itself changed.

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
  intermittent), check the actual scenario/trait label matches exactly
  (labels in this app are lowercase mid-sentence, e.g. "the replica
  fails", not "The Replica Fails" — `click-text` matching is
  case-sensitive).
- **`Cannot find name 'LayoutProps'` when running `tsc --noEmit`
  directly** (bypassing the `npm run typecheck` script): run
  `npx next typegen` first, or just use `npm run typecheck` instead of
  invoking `tsc` directly.
- **Next.js dev-mode floating "N" badge appears in every screenshot**:
  that's Next's own dev-tools indicator overlay, not part of the app —
  harmless, ignore it in screenshots.
