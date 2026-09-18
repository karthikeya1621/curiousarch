/**
 * Core model types.
 *
 * Design rule: every rough judgment a user could argue with lives in
 * `Trait`, which carries its own provenance. The UI must be able to show
 * "we assumed no rate limiting because nothing was said" vs "you told us
 * this cache has stampede protection". This is the single most important
 * shape in the codebase — it is what makes the model correctable instead
 * of a black box, exactly as much for a boolean/enum judgment as it was
 * for a number.
 *
 * This is a categorical, not numeric, model — see PLAN's architect-pivot:
 * findings come from pattern-matching over rough shape and category
 * (single instance? short TTL? no rate limiting?), never from simulating
 * a magnitude an LLM had no way to actually measure.
 */

export type Provenance = "stated" | "inferred" | "default";

export interface Trait<T> {
  value: T;
  provenance: Provenance;
  /** Shown verbatim in the UI next to the value. Keep it one short sentence. */
  rationale: string;
}

export function trait<T>(
  value: T,
  provenance: Provenance,
  rationale: string,
): Trait<T> {
  return { value, provenance, rationale };
}

export function isTrait(value: unknown): value is Trait<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "provenance" in value &&
    "rationale" in value
  );
}

export type ComponentKind = "gateway" | "service" | "cache" | "database" | "queue";

interface BaseComponent {
  id: string;
  label: string;
  kind: ComponentKind;
}

/** Traffic entry point. Admits or rejects; does no work of its own. */
export interface GatewayComponent extends BaseComponent {
  kind: "gateway";
  /** Does anything shed load before it overwhelms what's downstream? */
  hasRateLimiting: Trait<boolean>;
}

/** Stateless compute. */
export interface ServiceComponent extends BaseComponent {
  kind: "service";
  /** The one thing that turns "it crashed" into "nothing noticed." */
  instanceCount: Trait<"single" | "multiple">;
  /** Guards this service's own synchronous calls to whatever is downstream. */
  hasCircuitBreaker: Trait<boolean>;
}

/** Cache-aside. Hits terminate here; misses flow downstream. */
export interface CacheComponent extends BaseComponent {
  kind: "cache";
  ttl: Trait<"short" | "long">;
  /** A small hot set behind a short TTL is exactly what herds. */
  keyspaceSize: Trait<"small" | "large">;
  /** Request coalescing / locking so one expiry doesn't fan out N refills. */
  hasStampedeProtection: Trait<boolean>;
}

/** Connection-pooled datastore. */
export interface DatabaseComponent extends BaseComponent {
  kind: "database";
  instanceCount: Trait<"single" | "has-replicas">;
  writeVolume: Trait<"low" | "high">;
}

/** Async buffer. Decouples arrival from consumption. */
export interface QueueComponent extends BaseComponent {
  kind: "queue";
  /** Without one, a single poison message blocks the pipeline forever. */
  hasDeadLetterQueue: Trait<boolean>;
  consumerScaling: Trait<"fixed" | "auto">;
}

export type Component =
  | GatewayComponent
  | ServiceComponent
  | CacheComponent
  | DatabaseComponent
  | QueueComponent;

export interface Edge {
  from: string;
  to: string;
}

export type ScaleTier = "small" | "medium" | "large" | "massive";

/**
 * `scale` is the ORIGINAL workload shape, read by the dormant deterministic
 * pattern engine (patterns.ts/fixes.ts/whatif.ts) and its own test suite —
 * that engine is deliberately left running and tested even though the web
 * app's primary flow no longer calls it (see CONTEXT.md / packages/engine/
 * README.md for why). Optional here — not required — for a very concrete
 * reason discovered live: `SystemModelSchema`'s compiled strict-mode
 * grammar was already close enough to Anthropic's size limit ("The
 * compiled grammar is too large... simplify your tool schemas") that
 * asking the AI to ALSO always produce `scale` alongside the new `users`/
 * `requests` fields tipped it over — a straight 400 on the request, not a
 * validation failure any repair retry could fix. `fromProse`/`reworkModel`
 * simply don't ask for `scale` anymore (removed from `WorkloadSchema`
 * entirely); every hand-written fixture in the dormant engine
 * (models/reference.ts, its tests, bin/sim.ts) still provides it exactly
 * as before and keeps compiling unchanged, since a required value is
 * always valid wherever an optional field is expected.
 *
 * `users`/`requests` are the NEW shape the AI-driven flow actually uses —
 * always both structurally present in the AI's own output (see
 * `WorkloadSchema`); the UI only renders a control for whichever has
 * `included: true` (one or both, driven by what the description actually
 * establishes). Optional on this base type for the same
 * dormant-engine-compatibility reason as `scale`.
 */
export interface Workload {
  scale?: Trait<ScaleTier>;
  users?: WorkloadDimensionValue;
  requests?: WorkloadDimensionValue;
}

/**
 * A "rough number" parameter — still a closed, discrete ladder the AI
 * picks a rung of, never a magnitude it computes. `target` is the
 * description's own stated ambition ("1M users") — display-only, never
 * read by anything that changes behavior; only `tier` drives what the AI
 * actually generates the architecture for. `included` is whether this
 * dimension is actually relevant to this system (shown as a control) —
 * always present rather than an optional field on `Workload` itself:
 * there are only ever exactly two possible dimensions by design, so a
 * fixed slot per dimension (with a flag) needs no array/union at all,
 * which matters live — see schema.ts's own comment on the compiled-
 * grammar-size limit an array-of-variants shape actually hit.
 *
 * `tier`/`target` are plain numbers here, not `Trait<number>` — the one
 * departure from this file's usual "every value carries a rationale"
 * rule. Deliberate, not an oversight: the live compiled-grammar-size
 * limit (schema.ts's own comment) left no room for four more nested
 * rationale/provenance objects, and the rationale here would always be
 * boilerplate anyway ("starting low, per the default" / "from your
 * description") — text the UI can render statically without needing the
 * AI to author it per instance.
 */
export interface WorkloadDimensionValue {
  included: boolean;
  tier: number;
  target: number;
}

/**
 * The closed tier ladders — client-safe (unlike `inference/
 * workloadParameters.ts`, which owns the AI-facing side of this and
 * re-exports these same arrays rather than redefining them) so the web
 * UI's tier controls read from the exact same source of truth the
 * inference layer validates against.
 */
export const USER_TIERS = [100, 10_000, 1_000_000, 100_000_000] as const;
export const REQUEST_TIERS = [1_000, 100_000, 10_000_000, 1_000_000_000] as const;

export interface SystemModel {
  id: string;
  name: string;
  components: Component[];
  edges: Edge[];
  workload: Workload;
}

/* ------------------------------------------------------------------ */
/* AI-generated findings and fixes                                     */
/* ------------------------------------------------------------------ */

/**
 * The new, primary source of findings for the web app: an AI call given
 * the current model, not a pattern match against it. `code`/`title` are
 * AI-chosen, not a closed enum like the old `FindingCode` — deliberately,
 * per the explicit product decision to let this "think like a senior
 * architect" rather than being limited to a fixed catalogue. See
 * inference/identifyFailures.ts.
 */
export interface AiFinding {
  code: string;
  severity: Severity;
  componentId: string;
  title: string;
  /** One or two plain sentences. No jargon — this is a learning tool. */
  explanation: string;
  fixes: AiFix[];
}

export interface AiFix {
  id: string;
  label: string;
  /** Shown immediately, never gated behind "Ask AI". */
  tradeoff: string;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export type FindingCode =
  | "SINGLE_POINT_OF_FAILURE"
  | "THUNDERING_HERD_RISK"
  | "CASCADING_FAILURE_RISK"
  | "UNBOUNDED_ADMISSION"
  | "QUEUE_NO_DEAD_LETTER"
  | "FIXED_SCALING_AT_SCALE"
  | "UNCACHED_DATABASE_AT_SCALE";

export type Severity = "critical" | "warning";

export interface Finding {
  code: FindingCode;
  severity: Severity;
  componentId: string;
  /**
   * The reasoning behind the verdict, in plain terms — which traits
   * combined to produce it. The UI renders these directly; an LLM may only
   * phrase them. Nothing here is ever model-generated.
   */
  evidence: Record<string, string>;
}

export interface SimulationResult {
  modelId: string;
  findings: Finding[];
  healthy: boolean;
}
