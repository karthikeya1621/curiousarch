/**
 * A live reliability check of the flow that matters most: build a system from
 * prose, ask for one change through chat, Re-simulate to apply it, and check
 * the result against invariants that don't need a person to judge. It calls
 * the real model and COSTS MONEY (~$0.15 per scenario), so it is not part of
 * `npm test`. Run it after changing a prompt or a check:
 *
 *   set -a; . ../../apps/web/.env.local; set +a   # or export ANTHROPIC_API_KEY
 *   npm run eval:live                              # every scenario
 *   EVAL_SET=large npm run eval:live               # bigger systems (small | large | all; default small)
 *   EVAL_ONLY=shortener npm run eval:live          # names containing this
 *
 * Exit code is non-zero when any scenario breaks an invariant or fails to make
 * the requested change, so it can gate a release. Failed attempts (retries) are
 * reported separately: they cost money but are not, by themselves, a failure.
 * It is a smoke test with a small sample, not a measure of correctness.
 * The cost of every scenario (and the share wasted on failed attempts) is
 * printed at the end, from the token usage of each call at the prices in
 * apps/web/lib/usage/pricing.ts.
 */

import { chatWithProject, fromProse, reworkModel } from "../src/server.ts";
import { lintTopology } from "../src/inference/lintTopology.ts";
import { computeCost, loadPrices } from "../../../apps/web/lib/usage/pricing.ts";
import type { SystemModel } from "../src/types.ts";

type Scenario = {
  name: string;
  prose: string;
  change: string;
  /** null when the change is present. `gone` ids are expected to disappear (a replaced component). */
  expect: (m: SystemModel, prev: SystemModel) => string | null;
  gone?: boolean;
};

const has = (m: SystemModel, kind: string) => m.components.some((c) => c.kind === kind);
const grew = (m: SystemModel, p: SystemModel) => (m.components.length > p.components.length ? null : "component count did not grow");

const SCENARIOS: Scenario[] = [
  { name: "shortener+cdn", prose: "A URL shortener: users create short links and visitors get redirected. Reads far outnumber writes.", change: "Add a CDN in front of the redirect path.", expect: (m) => (has(m, "cdn") ? null : "no cdn added") },
  { name: "checkout+queue", prose: "An e-commerce checkout: customers place orders, pay through a third-party payment provider, and inventory is reserved.", change: "Put a message queue between the order service and inventory reservation.", expect: (m) => (has(m, "queue") || has(m, "message-broker") ? null : "no queue added") },
  { name: "chat+ratelimit", prose: "A WhatsApp-like chat app: users send one-to-one and group messages that are delivered in real time and stored.", change: "Add rate limiting on the gateway.", expect: (m) => (m.components.some((c) => c.kind === "gateway" && (c as { hasRateLimiting?: { value: boolean } }).hasRateLimiting?.value === true) ? null : "gateway rate limiting not on") },
  { name: "ride+notify", prose: "A ride-hailing app: riders request rides, drivers are matched by location, and trips are tracked.", change: "Add a notification service that sends push notifications when a driver is matched.", expect: (m, p) => (m.components.length > p.components.length && m.components.some((c) => /notif/i.test(c.id + c.label)) ? null : "no notification component") },
  { name: "search+cache", prose: "A web search engine: a crawler collects pages, an indexer builds the index, and users query it.", change: "Add a cache in front of the query service.", expect: (m, p) => (has(m, "cache") && m.components.length > p.components.length ? null : "no cache added") },
  { name: "video+storage", prose: "A YouTube-like video site: users upload videos, which are transcoded, and viewers stream them.", change: "Store the uploaded videos in object storage.", expect: (m) => (has(m, "object-storage") ? null : "no object storage") },
  { name: "payments+fallback", prose: "A checkout that calls a third-party payment provider to charge cards.", change: "Give the payment provider a timeout and a fallback.", expect: (m) => (m.components.some((c) => c.kind === "external-dependency" && (c as { hasTimeout?: { value: boolean } }).hasTimeout?.value === true) ? null : "timeout not set") },
  { name: "feed+remove", prose: "A social media feed: users post, follow others, and read a timeline. Timelines are cached.", change: "Remove the cache.", expect: (m) => (has(m, "cache") ? "cache still present" : null), gone: true },
];

/** Bigger systems: long descriptions naming many parts, where the component cap and the extended step get pushed. */
const LARGE: Scenario[] = [
  { name: "L-netflix+search", prose: "A Netflix-like streaming service: subscribers browse a catalog, search titles, get personalised recommendations, and stream video adaptively from a global CDN. Content is ingested, transcoded into many bitrates and stored. Billing handles subscriptions and payments through a third-party processor, user profiles and watch history are stored, and an analytics pipeline consumes playback events.", change: "Add a dedicated search service with its own search index.", expect: (m, p) => (m.components.length > p.components.length && m.components.some((c) => /search/i.test(c.id + c.label)) ? null : "no search component added") },
  { name: "L-uber+surge", prose: "An Uber-like ride platform: riders request trips, a matching service pairs them with nearby drivers using live location updates, a pricing service computes fares and surge, a trip service tracks state, payments charge cards through a third-party provider, maps and routing are provided by an external service, and notifications go out by push and SMS. Trip history and driver profiles are stored.", change: "Add a surge pricing cache in front of the pricing service.", expect: (m, p) => (has(m, "cache") && m.components.length > p.components.length ? null : "no cache added") },
  { name: "L-amazon+queue", prose: "An Amazon-like marketplace: shoppers browse a product catalog, search, keep a cart, and check out; orders reserve inventory, charge cards through a third-party payment provider and are fulfilled by a shipping service. Sellers manage listings, reviews and ratings are stored, product images live in object storage behind a CDN, and recommendations are computed nightly by a scheduled job.", change: "Put a message queue between the order service and fulfilment.", expect: (m) => (has(m, "queue") || has(m, "message-broker") ? null : "no queue added") },
  { name: "L-twitter+limit", prose: "A Twitter-like social network: users post short messages with media, follow others, and read a home timeline built by fan-out on write; a search service indexes posts, a notification service alerts users, direct messages are stored separately, trending topics are computed continuously, and media is stored in object storage served through a CDN.", change: "Add rate limiting on the API gateway and a circuit breaker on the timeline service.", expect: (m) => (m.components.some((c) => c.kind === "gateway" && (c as { hasRateLimiting?: { value: boolean } }).hasRateLimiting?.value === true) ? null : "gateway rate limiting not on") },
  { name: "L-slack+remove", prose: "A Slack-like workplace chat: workspaces and channels, real-time message delivery over websockets, message history and search, file uploads to object storage, presence tracking in a cache, threaded replies, notifications by email and push, integrations calling third-party webhooks, and an admin audit log.", change: "Remove the presence cache.", expect: (m) => (has(m, "cache") ? "cache still present" : null), gone: true },
];

/** The unrequested-protection check only fires when the request doesn't mention protections at all. */
const PROTECTION_WORDS = /rate|limit|breaker|fallback|timeout|health|check|dead|shield|version|lock|validat|stampede|cache|ttl/i;

function invariants(m: SystemModel, prev: SystemModel | null, asked: string, allowGone: boolean): string[] {
  const bad: string[] = [];
  const ids = m.components.map((c) => c.id);
  if (new Set(ids).size !== ids.length) bad.push("duplicate ids");
  const known = new Set(ids);
  const seen = new Set<string>();
  for (const e of m.edges) {
    if (!known.has(e.from) || !known.has(e.to)) bad.push(`dangling edge ${e.from}->${e.to}`);
    const key = `${e.from}>${e.to}`;
    if (seen.has(key)) bad.push(`duplicate edge ${key}`);
    seen.add(key);
  }
  if (/[{}]/.test(m.name) || /[{}]/.test(m.id)) bad.push(`wrapped id/name: ${m.name}`);
  for (const f of lintTopology(m)) bad.push(`lint ${f.code}@${f.componentId}`);
  const text = JSON.stringify(m.components).toLowerCase();
  for (const w of ["placeholder", "lorem", "tbd"]) if (text.includes(w)) bad.push(`banned word ${w}`);
  if (prev) {
    for (const c of m.components) {
      const old = prev.components.find((p) => p.id === c.id) as Record<string, unknown> | undefined;
      if (!old) continue;
      for (const [k, v] of Object.entries(c as unknown as Record<string, unknown>)) {
        const trait = v as { value?: unknown; provenance?: string } | null;
        const before = old[k] as { value?: unknown } | undefined;
        if (/^has[A-Z]/.test(k) && trait?.value === true && before?.value === false && !PROTECTION_WORDS.test(asked)) bad.push(`unrequested protection ${c.id}.${k}`);
        if (trait?.provenance === "stated" && before && JSON.stringify(trait.value) !== JSON.stringify(before.value)) bad.push(`changed trait marked stated ${c.id}.${k}`);
      }
    }
    if (!allowGone) {
      const gone = prev.components.filter((p) => !m.components.some((c) => c.id === p.id)).map((c) => c.id);
      if (gone.length) bad.push(`ids lost: ${gone.join(",")}`);
    }
  }
  return bad;
}

type Outcome = { name: string; lines: string[]; problems: string[]; failedAttempts: number; calls: number; costUsd: number; wastedUsd: number; unpriced: number };

const PRICES = loadPrices();

async function run(s: Scenario): Promise<Outcome> {
  const calls: { label: string; outcome: string; error?: string; cost: number | null }[] = [];
  const options = { onCall: (r: { label: string; outcome: string; error?: string; model: string; usage?: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number } }) =>
      calls.push({ label: r.label, outcome: r.outcome, error: r.error, cost: computeCost(r.model, r.usage, PRICES).costUsd }) } as never;
  const lines: string[] = [];
  const problems: string[] = [];

  const { model: base } = await fromProse(s.prose, options);
  const buildIssues = invariants(base, null, "", true);
  lines.push(`build: ${base.components.length} components, ${base.edges.length} edges`);
  problems.push(...buildIssues.map((i) => `build: ${i}`));

  const chat = await chatWithProject(base, s.change, [], [], [], [], options);
  lines.push(`chat: ${chat.isQuestion ? `treated as a question — ${chat.reply.slice(0, 120)}` : `queued — ${(chat.instruction ?? "").slice(0, 120)}`}`);
  if (chat.isQuestion) {
    problems.push("chat did not queue the requested change");
  } else {
    const { model: after } = await reworkModel(base, [], [{ request: s.change, instruction: chat.instruction ?? s.change }], options);
    lines.push(`rework: ${after.components.length} components, ${after.edges.length} edges`);
    const effect = s.expect(after, base);
    if (effect) problems.push(`change not applied: ${effect}`);
    problems.push(...invariants(after, base, s.change, s.gone ?? false).map((i) => `rework: ${i}`));
  }
  const failed = calls.filter((c) => c.outcome !== "ok");
  for (const f of failed) lines.push(`retry: ${f.label} — ${(f.error ?? f.outcome).slice(0, 200)}`);
  const failedAttempts = failed.length;
  const sum = (cs: typeof calls) => cs.reduce((t, c) => t + (c.cost ?? 0), 0);
  return { name: s.name, lines, problems, failedAttempts, calls: calls.length, costUsd: sum(calls), wastedUsd: sum(failed), unpriced: calls.filter((c) => c.cost === null).length };
}

const only = process.env.EVAL_ONLY;
const set = process.env.EVAL_SET ?? "small";
const pool = set === "large" ? LARGE : set === "all" ? [...SCENARIOS, ...LARGE] : SCENARIOS;
const selected = pool.filter((s) => !only || s.name.includes(only));
const results = await Promise.allSettled(selected.map(run));

let broken = 0;
let failedAttempts = 0;
for (const [i, r] of results.entries()) {
  console.log(`\n=== ${selected[i]!.name} ===`);
  if (r.status === "rejected") {
    broken++;
    console.log(`  ERROR: ${String(r.reason).slice(0, 300)}`);
    continue;
  }
  for (const l of r.value.lines) console.log(`  ${l}`);
  console.log(`  calls: ${r.value.calls}, failed attempts: ${r.value.failedAttempts}`);
  failedAttempts += r.value.failedAttempts;
  if (r.value.problems.length) {
    broken++;
    for (const p of r.value.problems) console.log(`  PROBLEM: ${p}`);
  } else console.log("  ok");
}
let totalCost = 0;
let totalWasted = 0;
console.log("\nCost per scenario:");
for (const [i, r] of results.entries()) {
  if (r.status === "rejected") {
    console.log(`  ${selected[i]!.name.padEnd(20)} (errored — cost unknown)`);
    continue;
  }
  totalCost += r.value.costUsd;
  totalWasted += r.value.wastedUsd;
  const note = r.value.unpriced ? `  (${r.value.unpriced} call(s) at an unpriced model)` : "";
  console.log(`  ${r.value.name.padEnd(20)} $${r.value.costUsd.toFixed(4)}  (wasted on failed attempts: $${r.value.wastedUsd.toFixed(4)})${note}`);
}
console.log(`  ${"TOTAL".padEnd(20)} $${totalCost.toFixed(4)}  (wasted: $${totalWasted.toFixed(4)})`);
console.log(`\n${selected.length - broken}/${selected.length} scenarios clean; ${failedAttempts} failed attempts (retries) in total`);
process.exit(broken === 0 ? 0 : 1);
