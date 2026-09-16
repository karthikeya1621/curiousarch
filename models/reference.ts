/**
 * Three reference systems, hand-modelled BEFORE the engine was trusted.
 *
 * These exist to be an oracle. The expected failure points were written down
 * from operational experience first; the engine has to reproduce them. If the
 * engine and the hand-model disagree, the engine is wrong until proven
 * otherwise.
 *
 * Numbers here are deliberately round so they can be checked on paper.
 */

import { param } from "../src/types.js";
import type { SystemModel } from "../src/types.js";

/**
 * 1. URL shortener — read-dominated, cache-fronted.
 *
 * Hand-model: cache absorbs 95%, so Postgres sees 5% of traffic. Pool of 100
 * at 8ms/query sustains 100/0.008 = 12,500 qps, so the DB caps the system at
 * roughly 250,000 RPS. The cache itself, at ~10us busy time per op (see
 * cpuTimeMs), sustains 1/0.00001 = 100,000 RPS — well above the service.
 * The service is the real limit: 20 instances x 50 concurrency = 1,000
 * servers at 15ms = 66,667 RPS.
 */
export const urlShortener: SystemModel = {
  id: "url-shortener",
  name: "URL shortener",
  workload: { rps: 10_000, payloadKb: 1 },
  components: [
    {
      id: "gw",
      label: "API Gateway",
      kind: "gateway",
      maxRps: param(100_000, "rps", "default", "ALB default account ceiling."),
    },
    {
      id: "svc",
      label: "Redirect service",
      kind: "service",
      instances: param(20, "count", "stated", "Current ASG size."),
      concurrencyPerInstance: param(50, "count", "default", "Node event-loop slots."),
      serviceTimeMs: param(15, "ms", "inferred", "Lookup plus 302 render."),
    },
    {
      id: "cache",
      label: "Redis",
      kind: "cache",
      hitRate: param(0.95, "ratio", "inferred", "Hot links dominate reads."),
      hitLatencyMs: param(1, "ms", "default", "Same-AZ Redis round trip."),
      cpuTimeMs: param(0.01, "ms", "default", "~10us per-op busy time, typical for a simple in-memory GET."),
      ttlSeconds: param(300, "s", "stated", "Five-minute TTL."),
      keyspaceHotSet: param(10_000, "count", "inferred", "Actively hit links."),
    },
    {
      id: "db",
      label: "PostgreSQL",
      kind: "database",
      connectionPoolSize: param(100, "count", "stated", "Pool max."),
      queryTimeMs: param(8, "ms", "inferred", "Indexed primary-key lookup."),
      writeRatio: param(0.02, "ratio", "inferred", "Creates are rare."),
      readReplicas: param(0, "count", "stated", "None."),
      replicaApplyRate: param(0, "ops", "default", "No replicas."),
    },
  ],
  edges: [
    { from: "gw", to: "svc", callsPerRequest: 1 },
    { from: "svc", to: "cache", callsPerRequest: 1 },
    { from: "cache", to: "db", callsPerRequest: 1 },
  ],
};

/**
 * 2. Checkout — write-heavy, uncached, pool-bound.
 *
 * Hand-model: no cache, so every request is a 25ms write against a pool of 40.
 * Capacity is 40/0.025 = 1,600 RPS. This one should exhaust its pool early and
 * loudly; it is the canonical example from the concept doc.
 */
export const checkout: SystemModel = {
  id: "checkout",
  name: "Checkout / order placement",
  workload: { rps: 500 },
  components: [
    {
      id: "gw",
      label: "API Gateway",
      kind: "gateway",
      maxRps: param(50_000, "rps", "default", "Account ceiling."),
    },
    {
      id: "svc",
      label: "Order service",
      kind: "service",
      instances: param(8, "count", "stated", "Current deployment."),
      concurrencyPerInstance: param(25, "count", "default", "Thread pool."),
      serviceTimeMs: param(40, "ms", "inferred", "Validation plus payment call."),
    },
    {
      id: "db",
      label: "PostgreSQL (primary)",
      kind: "database",
      connectionPoolSize: param(40, "count", "stated", "PgBouncer absent."),
      queryTimeMs: param(25, "ms", "inferred", "Multi-row transactional write."),
      writeRatio: param(0.9, "ratio", "stated", "Order inserts dominate."),
      readReplicas: param(2, "count", "stated", "Two read replicas."),
      replicaApplyRate: param(800, "ops", "inferred", "Single-threaded apply."),
    },
  ],
  edges: [
    { from: "gw", to: "svc", callsPerRequest: 1 },
    { from: "svc", to: "db", callsPerRequest: 1 },
  ],
};

/**
 * 3. Media upload — async fan-out through a queue.
 *
 * Hand-model: the API returns as soon as the job is enqueued, so end-to-end
 * synchronous latency must exclude the workers entirely. Consumers drain at
 * 12/2.0s = 6 jobs/sec, so anything above 6 RPS fills a 100k queue steadily.
 */
export const mediaUpload: SystemModel = {
  id: "media-upload",
  name: "Media upload with async processing",
  workload: { rps: 50 },
  components: [
    {
      id: "gw",
      label: "API Gateway",
      kind: "gateway",
      maxRps: param(10_000, "rps", "default", "Account ceiling."),
    },
    {
      id: "api",
      label: "Upload API",
      kind: "service",
      instances: param(6, "count", "stated", "Current deployment."),
      concurrencyPerInstance: param(20, "count", "default", "Worker threads."),
      serviceTimeMs: param(30, "ms", "inferred", "Accept and enqueue."),
    },
    {
      id: "queue",
      label: "SQS",
      kind: "queue",
      capacity: param(100_000, "messages", "default", "Retention-bounded."),
      consumers: param(12, "count", "stated", "Worker pool size."),
      consumerServiceTimeMs: param(2_000, "ms", "inferred", "Transcode per file."),
    },
    {
      id: "db",
      label: "PostgreSQL",
      kind: "database",
      connectionPoolSize: param(30, "count", "stated", "Pool max."),
      queryTimeMs: param(10, "ms", "inferred", "Metadata write."),
      writeRatio: param(1, "ratio", "stated", "Workers only write."),
      readReplicas: param(0, "count", "stated", "None."),
      replicaApplyRate: param(0, "ops", "default", "No replicas."),
    },
  ],
  edges: [
    { from: "gw", to: "api", callsPerRequest: 1 },
    { from: "api", to: "queue", callsPerRequest: 1 },
    { from: "queue", to: "db", callsPerRequest: 1 },
  ],
};

export const referenceModels = [urlShortener, checkout, mediaUpload];
