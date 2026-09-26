/**
 * A live reliability check of the flow that matters most: build a system from
 * prose, ask for one change through chat, Re-simulate to apply it, and check
 * the result against invariants that don't need a person to judge. It calls
 * the real model and COSTS MONEY (~$0.15 per scenario), so it is not part of
 * `npm test`. Run it after changing a prompt or a check:
 *
 *   set -a; . ../../apps/web/.env.local; set +a   # or export ANTHROPIC_API_KEY
 *   npm run eval:live                              # every scenario
 *   EVAL_SET=large npm run eval:live               # bigger systems (small | large | flows | all; default small)
 *   EVAL_SET=flows npm run eval:live               # multi-step flows: scale steps keep extended components, a chat conversation queues nothing spurious
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
import { atLowestTier } from "../src/inference/startMinimal.ts";
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
        // Above the lowest tier the AI sets the baseline protections from the tier group, so only the lowest tier is held to "nothing switches on unasked".
        if (atLowestTier(m.workload) && /^has[A-Z]/.test(k) && trait?.value === true && before?.value === false && !PROTECTION_WORDS.test(asked)) bad.push(`unrequested protection ${c.id}.${k}`);
        // With a request queued, a value it asked for IS stated (by the user); only a change nobody asked for may not claim it.
        if (asked === "" && trait?.provenance === "stated" && before && JSON.stringify(trait.value) !== JSON.stringify(before.value)) bad.push(`changed trait marked stated ${c.id}.${k}`);
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
/** Hard stop: the run aborts once the calls made so far cost more than this (USD). */
const BUDGET = Number(process.env.EVAL_BUDGET ?? "1.0");
let spentSoFar = 0;

type CallRecord = { label: string; outcome: string; error?: string; model: string; usage?: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number } };

/** Options to hand to the engine, plus a way to turn the calls it made into an Outcome. */
function track() {
  const calls: { label: string; outcome: string; error?: string; cost: number | null }[] = [];
  const options = {
    onCall: (r: CallRecord) => {
      const cost = computeCost(r.model, r.usage, PRICES).costUsd;
      calls.push({ label: r.label, outcome: r.outcome, error: r.error, cost });
      spentSoFar += cost ?? 0;
      if (spentSoFar > BUDGET) {
        console.log(`\nBUDGET GUARD: $${spentSoFar.toFixed(4)} spent, over the $${BUDGET.toFixed(2)} limit - aborting.`);
        process.exit(3);
      }
    },
  } as never;
  const finish = (name: string, lines: string[], problems: string[]): Outcome => {
    const failed = calls.filter((c) => c.outcome !== "ok");
    for (const f of failed) lines.push(`retry: ${f.label} — ${(f.error ?? f.outcome).slice(0, 200)}`);
    const sum = (cs: typeof calls) => cs.reduce((t, c) => t + (c.cost ?? 0), 0);
    return { name, lines, problems, failedAttempts: failed.length, calls: calls.length, costUsd: sum(calls), wastedUsd: sum(failed), unpriced: calls.filter((c) => c.cost === null).length };
  };
  return { options, finish };
}

async function run(s: Scenario): Promise<Outcome> {
  const { options, finish } = track();
  const lines: string[] = [];
  const problems: string[] = [];

  const { model: base } = await fromProse(s.prose, options);
  const buildIssues = invariants(base, null, "", true);
  lines.push(`build: ${base.components.length} components, ${base.edges.length} edges`);
  problems.push(...buildIssues.map((i) => `build: ${i}`));

  const chat = await chatWithProject(base, s.change, [], [], [], [], options);
  lines.push(`chat: ${chat.isQuestion ? `treated as a question — ${chat.reply.slice(0, 120)}` : `queued — ${(chat.instruction ?? "").slice(0, 120)}`}`);
  if (chat.isQuestion) {
    // Not queuing is right when the build already satisfies the request (the AI said "you already have one").
    const alreadyTrue = s.expect(base, base) === null;
    lines.push(alreadyTrue ? "note: the build already had what was asked for, so nothing to queue" : "");
    if (!alreadyTrue) problems.push("chat did not queue the requested change, and the build does not have it");
  } else {
    const { model: after } = await reworkModel(base, [], [{ request: s.change, instruction: chat.instruction ?? s.change }], options);
    lines.push(`rework: ${after.components.length} components, ${after.edges.length} edges`);
    const effect = s.expect(after, base);
    if (effect) problems.push(`change not applied: ${effect}`);
    problems.push(...invariants(after, base, s.change, s.gone ?? false).map((i) => `rework: ${i}`));
  }
  return finish(s.name, lines, problems);
}

const EXTENDED = new Set(["external-dependency", "load-balancer", "message-broker", "cdn", "object-storage", "scheduled-job", "config-store"]);
const STALE_WORDING = /starting tier|at launch|launch tier|launch baseline/i;

/**
 * The gap that let a real project lose six components: scale a system that has
 * extended components UP THE LADDER with nothing queued, and check none vanish,
 * no reason still talks about a starting tier, and (informationally) what the AI
 * did with instance counts and protections.
 */
async function runScaleKeepsExtended(): Promise<Outcome> {
  const { options, finish } = track();
  const lines: string[] = [];
  const problems: string[] = [];
  const prose = "A media platform: an API gateway behind a load balancer, a catalog service and an account service, a PostgreSQL database, uploaded recordings stored in object storage, video served through a CDN, subscriptions charged through a third-party payment provider, and a nightly job that builds reports.";
  let { model } = await fromProse(prose, options);
  const extendedIds = model.components.filter((c) => EXTENDED.has(c.kind)).map((c) => c.id);
  lines.push(`build: ${model.components.length} components, ${extendedIds.length} extended (${extendedIds.join(", ")})`);
  problems.push(...invariants(model, null, "", true).map((i) => `build: ${i}`));
  if (extendedIds.length === 0) problems.push("build produced no extended components, so the scale steps prove nothing");

  for (const tier of [10_000, 1_000_000]) {
    const before = model;
    const scaled = { ...model, workload: { ...model.workload, users: { ...model.workload.users!, tier } } };
    ({ model } = await reworkModel(scaled, [], [], options));
    const ids = new Set(model.components.map((c) => c.id));
    const lost = extendedIds.filter((id) => !ids.has(id));
    if (lost.length) problems.push(`at ${tier.toLocaleString()} users these extended components vanished: ${lost.join(", ")}`);
    const baseLost = before.components.filter((c) => !EXTENDED.has(c.kind) && !ids.has(c.id)).map((c) => c.id);
    if (baseLost.length) problems.push(`at ${tier.toLocaleString()} users these base components vanished: ${baseLost.join(", ")}`);
    const stale = model.components.flatMap((c) =>
      Object.entries(c as unknown as Record<string, { rationale?: string }>)
        .filter(([, t]) => t && typeof t === "object" && typeof t.rationale === "string" && STALE_WORDING.test(t.rationale))
        .map(([k]) => `${c.id}.${k}`),
    );
    if (stale.length) problems.push(`at ${tier.toLocaleString()} users these rationales still talk about a starting tier: ${stale.join(", ")}`);
    problems.push(...invariants(model, before, "", false).filter((i) => !i.startsWith("changed trait marked stated")).map((i) => `at ${tier.toLocaleString()}: ${i}`));
    const counts = model.components.filter((c) => "instanceCount" in c).map((c) => `${c.id}=${(c as unknown as { instanceCount: { value: string } }).instanceCount.value}`).join(", ");
    lines.push(`${tier.toLocaleString()} users: ${model.components.length} components; instance counts: ${counts}`);
  }
  return finish("F-scale-keeps-extended", lines, problems);
}

/**
 * The other gap: a conversation. A request that is already true, an answer
 * ("No."), a request about something absent and an acknowledgement must queue
 * NOTHING; only the real change at the end is queued.
 */
async function runChatConversation(): Promise<Outcome> {
  const { options, finish } = track();
  const lines: string[] = [];
  const problems: string[] = [];
  const { model } = await fromProse("An e-commerce platform: a catalog service, a cart service and an order service behind a gateway, a product database, and a call to a third-party payment provider at checkout.", options);
  const history: { role: "user" | "assistant"; content: string }[] = [];
  const queued: { request: string; instruction: string }[] = [];
  const turns: [string, boolean][] = [
    ["Add a third-party payment provider.", false],
    ["No.", false],
    ["Remove the search service.", false],
    ["No. Ignore it", false],
    ["Add rate limiting on the gateway.", true],
  ];
  for (const [message, shouldQueue] of turns) {
    const c = await chatWithProject(model, message, history as never, [], [], queued, options);
    const didQueue = !c.isQuestion;
    lines.push(`"${message}" -> ${didQueue ? "QUEUED" : "answered"}: ${c.reply.slice(0, 100)}`);
    if (didQueue !== shouldQueue) problems.push(`"${message}" was ${didQueue ? "queued" : "not queued"} but should ${shouldQueue ? "" : "not "}have been`);
    if (didQueue) queued.push({ request: message, instruction: c.instruction ?? message });
    history.push({ role: "user", content: message }, { role: "assistant", content: c.reply });
  }
  return finish("F-chat-conversation", lines, problems);
}

const only = process.env.EVAL_ONLY;
const set = process.env.EVAL_SET ?? "small";
type Job = { name: string; go: () => Promise<Outcome> };
const asJobs = (list: Scenario[]): Job[] => list.map((s) => ({ name: s.name, go: () => run(s) }));
const FLOWS: Job[] = [
  { name: "F-scale-keeps-extended", go: runScaleKeepsExtended },
  { name: "F-chat-conversation", go: runChatConversation },
];
const pool: Job[] = set === "large" ? asJobs(LARGE) : set === "flows" ? FLOWS : set === "all" ? [...asJobs(SCENARIOS), ...asJobs(LARGE), ...FLOWS] : asJobs(SCENARIOS);
const selected = pool.filter((j) => !only || j.name.includes(only));
const results = await Promise.allSettled(selected.map((j) => j.go()));

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
