# PLAN-4.md — Validate

**Goal:** confirm the loop produces real insight for someone who is not the
builder, and get an honest read on whether the AI-generated-findings bet
(`identifyFailures.ts`, accepted knowingly — see `CONTEXT.md`'s "Findings
are AI-generated" — but never measured at volume) is actually holding up.

**Prerequisite:** none. Everything this phase needs already exists: auth,
persistence, multi-project support, 12 component kinds, cost guardrails,
360 passing tests. This is the next thing to do, not blocked on anything.

This phase deliberately comes before PLAN-5 (shippable, monetized) for the
same reason the old plans ordered it that way: a free tier and billing on
top of a loop nobody outside the builder has used yet is optimizing the
wrong variable.

---

## 4.1 — Get a real outside user

Find at least 3-5 people who are not the builder — ideally people who've
actually operated a production system, since they're the ones who can tell
a correct-sounding finding from an actually-correct one. Sit with them (or
watch a recording) while they:

- Describe a system they've actually worked on, in their own words.
- React to the diagram and findings without being told what to expect.
- Try applying a fix, chatting to correct something, moving the workload
  slider, and Re-simulating.

**Acceptance:** for each session, answer plainly — did this produce a
moment of "oh, that's a real risk I'd forgotten about," or did it read as
a diagram with opinions attached? Write down the actual reaction, not a
summary that already assumes the tool worked.

## 4.2 — Spot-check finding quality at volume

`identifyFailures.ts` has no computed guarantee behind it — see
`CONTEXT.md`'s "Bugs already found and fixed" for why that's a different
kind of risk than the deleted pattern engine had. This is the audit that
was never done after the engine was deleted.

- Run `fromProse` on 15-20 varied descriptions (mix of the three reference
  systems' shape and genuinely novel ones, including at least a few that
  should exercise each of the 7 extended kinds).
- For each resulting model, have a human (the builder is fine here, unlike
  4.1) review every finding: does it name a real, checkable mechanism
  tied to specific traits in the model, or does it just sound plausible?
- Separately: does it MISS anything a senior engineer would flag looking
  at the same model? (The false-negative case has no test today at all —
  a free-form call can simply never mention a real risk category, and
  nothing would catch that.)

**Acceptance:** a written tally — X% of findings name a real, traceable
mechanism; list every finding that didn't, and every risk a reviewer
caught that the AI missed. This is the number that tells you whether the
bet in "Findings are AI-generated" is working, not just accepted.

## 4.3 — Automated UI/e2e coverage

All 360 tests today are unit-level (engine inference logic, `apps/web`'s
store and API routes) — nothing drives the actual rendered app. The
`.claude/skills/run-web` Playwright driver already proves this is possible
without a logged-in session; a real login-gated flow still needs either a
test account or a mocked auth layer to automate.

- At minimum: build → see findings → apply a fix → Re-simulate → see the
  diagram update, as one automated flow.
- Cover the thing this session's own bug-fix relied on manual verification
  for: moving the workload tier slider does NOT trigger a save or a canvas
  redraw, only Re-simulate does.

**Acceptance:** this flow runs in CI (or at least on-demand, if there's no
CI yet — see PLAN-5), not just via an agent's one-off Playwright session.

## 4.4 — Decide on `applyAiFix.ts` — DONE (deleted)

**Decision:** deleted, along with its test and `server.ts` export. Wiring it
up would have contradicted the deliberate design (a fix is queued and
implemented together with everything else at Re-simulate — one billed,
reviewable step — and chat changes now queue the same way). The store's
matching `applyFix` action, which nothing called any more, went with it.

A real, tested AI function (`packages/engine/src/inference/applyAiFix.ts`)
that nothing in `apps/web` currently calls — fixes are applied by queueing
+ Re-simulate, or via chat, instead. Either:

- Wire it up (a fix's "Apply" action calls it directly instead of queueing,
  trading one Re-simulate-batched call for an immediate per-fix one), or
- Delete it, following this session's own precedent for orphaned
  AI-facing code (`proposeCacheTraits.ts`).

**Acceptance:** it's one or the other, not both existing indefinitely.
This is a small decision; the point is making it deliberately rather than
by default.

---

## What would make you stop or change course

- 4.1 sessions consistently produce "diagram with opinions," not insight.
  That's the loop's core value proposition failing, not a tuning problem —
  don't proceed to PLAN-5 on a loop that doesn't clear this bar.
- 4.2's audit finds a systematic failure mode (not occasional noise) — a
  whole risk category the AI reliably misses, or a plausible-sounding
  fabrication pattern. That's grounds to revisit whether "AI-generated, no
  verification" was the right call, not just to tune the prompt again.
