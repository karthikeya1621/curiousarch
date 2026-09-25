# Client-facing components and edge direction

**Problem.** An edge means "caller → callee". For most components that reads
naturally, but for the ones a *client* reaches directly it comes out backwards.
On the Zoom project the model had `live-streaming-service → cdn`, which reads
as "the service calls the CDN". In reality clients hit the CDN, and the CDN
pulls from the origin (`cdn → live-streaming-service`). TURN/STUN has a milder
version: `meeting-service → turn-stun-service` (clients talk to TURN
directly). Found in a second-opinion review of the Zoom results.

## What already exists (this is smaller than it first looked)

The diagram already has a client node: the synthetic **Traffic** node
(`TRAFFIC_NODE_ID` in `apps/web/lib/layout.ts`), wired to every *root*
component — anything with no incoming edge. So **no schema change and no new
node kind is needed**. A client-facing component only has to be a root; the
Traffic node then attaches to it for free. The fix is to get the model to
draw CDN edges the right way round.

## Plan

1. **Prompt: CDN direction** (`extendedComponents.ts`, `KIND_GUIDE` and the
   propose/revise prompts). State that a CDN sits *in front of* its origin:
   clients reach it, it calls the origin, so the edge runs `cdn → origin`, and
   nothing calls the CDN. Same one-line note for any client-facing edge
   component. Cheap; prompt-only.
2. **Don't fight the "keep edge direction" rule.** REVISE_PROMPT says never
   reverse an existing edge. That is right in general, but it means existing
   projects keep the wrong CDN direction forever. The correction has to arrive
   as an explicit chosen fix (step 3), which the revise step already receives
   through `additionalContext` and which takes priority over "preserve".
3. **Lint rule** (`lintTopology.ts`): `CDN_BEHIND_ORIGIN` — a `cdn` with an
   incoming edge from a base component (or any component with an outgoing edge
   into a `cdn`). Fix text: "Reverse the connection so clients reach
   the CDN first and it pulls from "X"". Deterministic, free, and it repairs
   old projects one click at a time.
4. **Findings prompt** (`identifyFailures.ts`): one sentence that an edge into
   a CDN is a direction error, so an origin-shield or thundering-herd finding
   is reasoned about with the CDN on the request path. Optional once step 3
   exists.
5. **Tests.** Prompt wording pinned (as `fromProse.test.ts` does); lint cases
   (reversed CDN flagged, correct CDN quiet, fix text names the origin);
   `layout` already has root handling, so add one case that a CDN with only an
   outgoing edge gets a Traffic edge.

## Deliberately not doing: TURN/STUN

A TURN relay clients connect to directly would be a root with *no* edges at
all (nothing in the model calls it). That collides with `EDGE_REQUIREMENT`
("a component with no edge is a floating box, never correct"), which protects
against a real failure (stray, unwired components). Relaxing it for one kind
means either a per-kind exception list or letting the AI decide when a
component may float, both of which weaken a check that has earned its keep.
Keeping `meeting-service → turn-stun-service` (the service hands clients relay
credentials) is a defensible simplification. The meaningless `hasFallback`
flip on it is already addressed by the prompt change to `hasFallback`.

If this later matters, the cleaner route is a per-kind "client-facing" flag
that exempts a component from the edge requirement *and* makes it a root —
worth doing only if more client-facing kinds appear (a websocket edge tier, a
media server).

## Outcome

Implemented, with one change from the plan: the prompt wording alone did not fix the direction (a live Zoom-like build still drew the CDN backwards), so the flip is done in code in `sanitizeExtendedResponse` for both build and Re-simulate, with the lint rule as the backstop for projects not yet re-simulated. Live check after the change: `livestream-cdn -> livestream-service`, no lint findings.

## Risks

- The revise step could still re-emit the old direction from habit; the lint
  rule catches it, and a mutation check on the prompt test will show whether
  the wording is load-bearing.
- A reversed CDN edge changes the DAG shape; the CDN becomes a second root
  next to the gateway, so the diagram gains a second Traffic edge. That is the
  intended picture, but it is a visible change and should be looked at in a
  browser (I can't drive the logged-in UI).

## Verification

Unit tests as above, then one live Zoom-like build: the CDN should have no
incoming edge and an edge to the streaming service; the diagram should show
Traffic feeding both the gateway and the CDN.

## Size

About half a day, mostly tests. Steps 1 and 3 do nearly all of the work.
