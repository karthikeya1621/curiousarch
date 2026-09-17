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

export interface Workload {
  scale: Trait<ScaleTier>;
}

export interface SystemModel {
  id: string;
  name: string;
  components: Component[];
  edges: Edge[];
  workload: Workload;
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
