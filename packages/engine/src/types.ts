/**
 * Core model types.
 *
 * Design rule: every performance-relevant number a user could argue with lives
 * in `Parameter`, which carries its own provenance. The UI must be able to show
 * "we assumed 8ms because we guessed" vs "you told us 40ms". This is the single
 * most important shape in the codebase — it is what makes the model correctable
 * instead of a black box.
 */

export type Provenance = "stated" | "inferred" | "default";

export interface Parameter {
  value: number;
  unit: string;
  provenance: Provenance;
  /** Shown verbatim in the UI next to the value. Keep it one short sentence. */
  rationale: string;
}

export function param(
  value: number,
  unit: string,
  provenance: Provenance,
  rationale: string,
): Parameter {
  return { value, unit, provenance, rationale };
}

export function isParameter(value: unknown): value is Parameter {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "unit" in value &&
    "provenance" in value &&
    "rationale" in value
  );
}

export type ComponentKind =
  | "gateway"
  | "service"
  | "cache"
  | "database"
  | "queue";

interface BaseComponent {
  id: string;
  label: string;
  kind: ComponentKind;
}

/** Traffic entry point. Does no work; it just admits the offered load. */
export interface GatewayComponent extends BaseComponent {
  kind: "gateway";
  /** Hard admission ceiling, e.g. an ALB or API Gateway account limit. */
  maxRps: Parameter;
}

/** Stateless compute. Modelled as M/M/c where c = instances * concurrency. */
export interface ServiceComponent extends BaseComponent {
  kind: "service";
  instances: Parameter;
  /** Requests one instance handles at once (threads, event-loop slots). */
  concurrencyPerInstance: Parameter;
  /** Mean CPU/IO time per request, excluding downstream waits. */
  serviceTimeMs: Parameter;
}

/**
 * Cache-aside. Hits terminate here; misses flow downstream.
 *
 * `hitLatencyMs` and `cpuTimeMs` are deliberately separate. hitLatencyMs is
 * the round-trip a client observes — for a remote cache that is dominated by
 * network transit, not by the server actually doing work. cpuTimeMs is what
 * the (effectively single-threaded, per shard) cache server is busy for per
 * operation, which is what determines throughput capacity. Conflating the
 * two understates real cache capacity by orders of magnitude: a same-AZ
 * Redis round trip is commonly ~1ms, but the command itself typically
 * executes in single-digit microseconds, so a cache sized on hitLatencyMs
 * alone looks capacity-bound around 1,000 rps when real single-instance
 * Redis throughput is in the hundreds of thousands.
 */
export interface CacheComponent extends BaseComponent {
  kind: "cache";
  hitRate: Parameter;
  /** Round-trip time a client observes on a hit. Feeds latency, not capacity. */
  hitLatencyMs: Parameter;
  /** Server-side busy time per operation. Feeds capacity, not the latency figure. */
  cpuTimeMs: Parameter;
  /** Used for the thundering-herd check, not for steady-state throughput. */
  ttlSeconds: Parameter;
  /** Distinct hot keys. Small + short TTL = herd risk on expiry. */
  keyspaceHotSet: Parameter;
}

/** Connection-pooled datastore. c = pool size, service time = query time. */
export interface DatabaseComponent extends BaseComponent {
  kind: "database";
  connectionPoolSize: Parameter;
  queryTimeMs: Parameter;
  /** Write share of arriving traffic, used for the replication-lag check. */
  writeRatio: Parameter;
  /** 0 = no replicas; replicas serve reads and add lag risk. */
  readReplicas: Parameter;
  /** Sustained write ops/sec the replica stream can apply. */
  replicaApplyRate: Parameter;
}

/** Async buffer. Decouples arrival from consumption; can overflow over time. */
export interface QueueComponent extends BaseComponent {
  kind: "queue";
  /** Messages retained before the queue sheds load. */
  capacity: Parameter;
  consumers: Parameter;
  consumerServiceTimeMs: Parameter;
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
  /**
   * Calls to `to` per request arriving at `from`. 1 = pass-through,
   * 0.3 = only 30% of requests hit this path, 3 = fan-out of three.
   * Fan-out above 1 is what produces tail-at-scale amplification.
   */
  callsPerRequest: number;
}

export interface Workload {
  rps: number;
  /** Carried for downstream sizing work; not used by the queueing math yet. */
  payloadKb?: number;
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
  | "CONNECTION_POOL_EXHAUSTED"
  | "SERVICE_SATURATED"
  | "CACHE_SATURATED"
  | "GATEWAY_LIMIT_EXCEEDED"
  | "QUEUE_OVERFLOW"
  | "REPLICATION_LAG"
  | "THUNDERING_HERD"
  | "HIGH_UTILIZATION";

export type Severity = "critical" | "warning";

export interface Finding {
  code: FindingCode;
  severity: Severity;
  componentId: string;
  /**
   * The numbers behind the verdict. The UI renders these directly; an LLM may
   * only phrase them. Nothing here is ever model-generated.
   */
  evidence: Record<string, number | string>;
}

export interface ComponentResult {
  componentId: string;
  arrivalRps: number;
  /** Sustainable throughput before the queue grows without bound. */
  capacityRps: number;
  utilization: number;
  meanLatencyMs: number;
  p99LatencyMs: number;
  /** Mean requests resident in this component (Little's Law). */
  concurrentRequests: number;
  saturated: boolean;
}

export interface SimulationResult {
  modelId: string;
  workload: Workload;
  components: ComponentResult[];
  findings: Finding[];
  /** Sum of mean latency along the critical path. */
  endToEndMeanMs: number;
  endToEndP99Ms: number;
  healthy: boolean;
}
