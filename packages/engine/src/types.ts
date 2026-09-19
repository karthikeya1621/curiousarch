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
 * findings reason over rough shape and category (single instance? short
 * TTL? no rate limiting?), never over a magnitude an LLM had no way to
 * actually measure.
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

export type ComponentKind =
  | "gateway"
  | "service"
  | "cache"
  | "database"
  | "queue"
  | "external-dependency"
  | "load-balancer"
  | "message-broker"
  | "cdn"
  | "object-storage"
  | "scheduled-job"
  | "config-store";

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

/**
 * The 7 "extended" kinds below — everything past `QueueComponent` — are
 * proposed by a genuinely separate structured call
 * (`inference/extendedComponents.ts`), never the main topology call
 * `fromProse`/`reworkModel` use. `SystemModelSchema` (the topology
 * schema) was already documented as sitting right at Anthropic's
 * strict-mode compiled-grammar size limit before these existed — see
 * `inference/workloadParameters.ts`'s own comment — so they could not be
 * added to that same discriminated union. They still live on this one
 * `Component` union, since the model itself doesn't care which call
 * produced a component.
 */

/** Something outside your own system's control — a payment/auth provider, any third-party API. */
export interface ExternalDependencyComponent extends BaseComponent {
  kind: "external-dependency";
  hasTimeout: Trait<boolean>;
  /** Degrades gracefully, or does its outage become yours? */
  hasFallback: Trait<boolean>;
}

/** Pure traffic distribution across instances — distinct from `gateway`, which admits/rejects but doesn't distribute. */
export interface LoadBalancerComponent extends BaseComponent {
  kind: "load-balancer";
  instanceCount: Trait<"single" | "multiple">;
  /** Without this, traffic keeps routing to instances that are already dead. */
  hasHealthChecks: Trait<boolean>;
}

/** Fan-out pub/sub — many independent consumer groups, not the point-to-point delivery a `queue` models. */
export interface MessageBrokerComponent extends BaseComponent {
  kind: "message-broker";
  /** Without this, one malformed message can silently break every subscriber, not just one worker. */
  hasSchemaValidation: Trait<boolean>;
  consumerScaling: Trait<"fixed" | "auto">;
}

/** Edge cache in front of an origin. */
export interface CdnComponent extends BaseComponent {
  kind: "cdn";
  /** A shared layer that absorbs a spike before it ever reaches the origin. */
  hasOriginShield: Trait<boolean>;
}

/** Blob/object storage — distinct from `database`, which is connection-pooled and query-oriented. */
export interface ObjectStorageComponent extends BaseComponent {
  kind: "object-storage";
  /** Without this, an accidental delete or overwrite is permanent. */
  hasVersioning: Trait<boolean>;
}

/** Cron-style background processor, outside any request path. */
export interface ScheduledJobComponent extends BaseComponent {
  kind: "scheduled-job";
  /** Without this, an overrunning job overlaps its own next run. */
  hasLocking: Trait<boolean>;
  /** Without this, a retried or overlapping run double-processes (duplicate charges, duplicate emails). */
  isIdempotent: Trait<boolean>;
}

/** Feature flags / secrets manager / remote config — a control-plane dependency every request may need. */
export interface ConfigStoreComponent extends BaseComponent {
  kind: "config-store";
  /** Without this, the config service's own outage takes down everything that reads from it. */
  hasLocalFallback: Trait<boolean>;
}

export type Component =
  | GatewayComponent
  | ServiceComponent
  | CacheComponent
  | DatabaseComponent
  | QueueComponent
  | ExternalDependencyComponent
  | LoadBalancerComponent
  | MessageBrokerComponent
  | CdnComponent
  | ObjectStorageComponent
  | ScheduledJobComponent
  | ConfigStoreComponent;

export interface Edge {
  from: string;
  to: string;
}

/**
 * `users`/`requests` are always both structurally present in the AI's own
 * output (see `WorkloadSchema`); the UI only renders a control for
 * whichever has `included: true` (one or both, driven by what the
 * description actually establishes). Optional here only because a handful
 * of hand-written fixtures (models/reference.ts) predate workload modelling
 * entirely and don't set either.
 */
export interface Workload {
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

/**
 * Guardrails, not just a UX nicety — a system with no upper bound on size
 * costs more per Build/Re-simulate the bigger it gets (more trait objects,
 * more rationale text, more tokens generated), and a large enough one
 * risks hitting the same output-length truncation `structuredCall.ts`'s
 * own comment documents. Enforced in two places, same pattern as every
 * other rule here: the AI is told the limit in its prompt (`prompt.ts`,
 * `reworkModel.ts`, `inference/extendedComponents.ts`), and
 * `SystemModelSchema`/`extendedComponents.ts` reject going over it rather
 * than trusting the prompt alone. Client-safe (like `USER_TIERS` above)
 * so the web app can warn before a Re-simulate that's already close.
 */
export const MAX_BASE_COMPONENTS = 15;
export const MAX_EXTENDED_COMPONENTS = 6;
export const MAX_TOTAL_COMPONENTS = MAX_BASE_COMPONENTS + MAX_EXTENDED_COMPONENTS;

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
 * The web app's only source of findings: an AI call given the current
 * model (see inference/identifyFailures.ts). `code`/`title` are AI-chosen,
 * not a closed enum — deliberately, per the explicit product decision to
 * let this "think like a senior architect" rather than being limited to a
 * fixed catalogue.
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

export type Severity = "critical" | "warning";
