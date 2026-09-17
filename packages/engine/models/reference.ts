/**
 * Three hand-modelled systems — the oracle for what a correct pattern match
 * looks like, same role these played before the architect-pivot, just in
 * trait terms now instead of numeric parameters.
 *
 * Deliberately spans the finding-severity spectrum: checkout starts with one
 * real critical finding, url-shortener with a different one, media-upload
 * with only warnings (healthy, but not risk-free) — the same "warnings
 * before failure" point PLAN-1.5 made originally still matters here.
 */

import { trait } from "../src/types.ts";
import type { SystemModel } from "../src/types.ts";

/**
 * 1. Checkout / order placement.
 *
 * Well-provisioned against instance/replica loss (multiple order-service
 * instances, a replicated database) but — like most real systems — was
 * never built with a circuit breaker between the service and its database.
 * That's a real, common gap, not a contrived one: CASCADING_FAILURE_RISK
 * fires from the start rather than needing a scenario to surface it.
 */
export const checkout: SystemModel = {
  id: "checkout",
  name: "Checkout / order placement",
  workload: { scale: trait("small", "stated", "A single-region order-placement API, not yet at wide scale.") },
  components: [
    {
      id: "gw",
      label: "API Gateway",
      kind: "gateway",
      hasRateLimiting: trait(true, "stated", "Requests pass through a rate-limited API gateway."),
    },
    {
      id: "svc",
      label: "Order service",
      kind: "service",
      instanceCount: trait("multiple", "stated", "Eight instances behind a load balancer."),
      hasCircuitBreaker: trait(false, "default", "No circuit breaker mentioned — the common default for a first build."),
    },
    {
      id: "db",
      label: "PostgreSQL (primary)",
      kind: "database",
      instanceCount: trait("has-replicas", "stated", "Two read replicas alongside the primary."),
      writeVolume: trait("high", "stated", "Order inserts dominate this endpoint's traffic."),
    },
  ],
  edges: [
    { from: "gw", to: "svc" },
    { from: "svc", to: "db" },
  ],
};

/**
 * 2. URL shortener.
 *
 * The classic cache-aside read path (gateway -> service -> cache ->
 * database) with a small, short-lived hot keyspace and no request
 * coalescing on refill — the textbook thundering-herd setup. A circuit
 * breaker on the redirect service keeps CASCADING_FAILURE_RISK from also
 * firing here, so the herd risk is the one thing on stage.
 */
export const urlShortener: SystemModel = {
  id: "url-shortener",
  name: "URL shortener",
  workload: { scale: trait("medium", "stated", "A popular consumer link shortener, moderate steady traffic.") },
  components: [
    {
      id: "gw",
      label: "API Gateway",
      kind: "gateway",
      hasRateLimiting: trait(true, "default", "Typical default for a public-facing gateway."),
    },
    {
      id: "svc",
      label: "Redirect service",
      kind: "service",
      instanceCount: trait("multiple", "stated", "Twenty instances handle redirect lookups."),
      hasCircuitBreaker: trait(true, "stated", "Calls to the cache and database are wrapped in a circuit breaker."),
    },
    {
      id: "cache",
      label: "Redis",
      kind: "cache",
      ttl: trait("short", "stated", "Five-minute TTL on cached redirects."),
      keyspaceSize: trait("small", "stated", "A small number of frequently hit short links dominate traffic."),
      hasStampedeProtection: trait(false, "default", "No request coalescing or refill locking mentioned."),
    },
    {
      id: "db",
      label: "PostgreSQL",
      kind: "database",
      instanceCount: trait("has-replicas", "stated", "Two read replicas serve cache-miss lookups."),
      writeVolume: trait("low", "stated", "Reads dominate; new short links are created rarely by comparison."),
    },
  ],
  edges: [
    { from: "gw", to: "svc" },
    { from: "svc", to: "cache" },
    { from: "cache", to: "db" },
  ],
};

/**
 * 3. Media upload with async processing.
 *
 * Healthy — every finding here is a warning, not a critical — but not
 * risk-free: no admission control, no dead-letter queue, and a fixed
 * worker pool that's already operating at large scale. The same point
 * this session's HIGH_UTILIZATION work made under the old numeric engine
 * (warnings must be visible on an otherwise-healthy system, or an all-red
 * UI trains people to ignore red) still has to hold here.
 */
export const mediaUpload: SystemModel = {
  id: "media-upload",
  name: "Media upload with async processing",
  workload: { scale: trait("large", "stated", "Upload service for roughly a million registered users.") },
  components: [
    {
      id: "gw",
      label: "API Gateway",
      kind: "gateway",
      hasRateLimiting: trait(false, "default", "No admission limit mentioned."),
    },
    {
      id: "api",
      label: "Upload API",
      kind: "service",
      instanceCount: trait("multiple", "stated", "Six instances accept and enqueue uploads."),
      hasCircuitBreaker: trait(false, "default", "No circuit breaker mentioned; the queue between it and processing is async anyway."),
    },
    {
      id: "queue",
      label: "Transcode queue",
      kind: "queue",
      hasDeadLetterQueue: trait(false, "default", "No dead-letter handling mentioned for messages that repeatedly fail."),
      consumerScaling: trait("fixed", "stated", "A fixed pool of transcoder workers."),
    },
    {
      id: "db",
      label: "Media metadata DB",
      kind: "database",
      instanceCount: trait("has-replicas", "stated", "Read replicas serve metadata lookups."),
      writeVolume: trait("low", "stated", "Metadata writes are small compared to the media itself."),
    },
  ],
  edges: [
    { from: "gw", to: "api" },
    { from: "api", to: "queue" },
    { from: "queue", to: "db" },
  ],
};

export const referenceModels: SystemModel[] = [checkout, urlShortener, mediaUpload];
