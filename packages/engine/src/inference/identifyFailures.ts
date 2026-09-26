/**
 * The web app's only source of findings: an AI call given the current
 * model, not a pattern match against one. This is the explicit, informed
 * product decision behind this file: "fully AI-generated, no need
 * verification... it should think how a human senior architect thinks" —
 * made after seeing the concrete downside (the Gemini-fabrication incident
 * CONTEXT.md documents under "Why the pivot") and choosing it anyway. The
 * deterministic pattern-matching engine this superseded (`patterns.ts`/
 * `solver.ts`/`whatif.ts`/`fixes.ts`) has since been deleted outright —
 * see git history for its final form.
 *
 * Called again after every model change (a fresh build, a rework, a fix
 * applied) — there's no separate "recompute" step; asking the AI is the
 * only recompute there is.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { runStructuredCall, type StructuredCallOptions } from "./structuredCall.ts";
import { lintTopology, mergeLintFindings } from "./lintTopology.ts";
import type { AiFinding, SystemModel } from "../types.ts";
import { atLowestTier } from "./startMinimal.ts";
import { graphFacts } from "./graphFacts.ts";

const AiFixSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  tradeoff: z.string().min(1, "What this costs — money, complexity, or risk. Never omitted."),
});

/**
 * The review areas the AI must decide on, one by one, before listing findings — the
 * same device as `proposeExtendedComponents`' per-kind decisions: it turns a
 * checklist-only answer into one that has actually looked at each area. Found by
 * comparing models: the deeper findings a bigger model produced (parallel event paths,
 * a hot leaderboard key, a request-path single point of failure) sit in areas the
 * checklist answer never visited.
 */
export const REVIEW_AREAS = [
  "data-integrity",
  "hot-keys-and-partitioning",
  "regional-latency",
  "shared-datastore-coupling",
  "duplicate-or-parallel-paths",
  "request-path-single-points",
  "cascading-failure",
  "durability-and-recovery",
] as const;

const AreaDecisionSchema = z.object({
  area: z.enum(REVIEW_AREAS),
  applies: z.boolean(),
  evidence: z.string().min(1),
});
export type AreaDecision = z.infer<typeof AreaDecisionSchema>;

const AiFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["critical", "warning"]),
  componentId: z.string().min(1),
  title: z.string().min(1),
  explanation: z.string().min(1, "One or two plain sentences. No jargon — this is a learning tool."),
  fixes: z.array(AiFixSchema).min(1),
  bitesAt: z.enum(["now", "larger-scale"]),
  aboutInstanceCount: z.boolean(),
  area: z.enum([...REVIEW_AREAS, "other"]),
  impact: z.enum(["high", "medium", "low"]),
});

const IdentifyFailuresResponseSchema = z
  .object({
    considered: z.array(AreaDecisionSchema),
    findings: z.array(AiFindingSchema),
  })
  .superRefine((val, ctx) => {
    for (const area of REVIEW_AREAS) {
      if (val.considered.filter((d) => d.area === area).length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"considered" needs exactly one entry for "${area}" - every one of the ${REVIEW_AREAS.length} areas must be decided.`,
          path: ["considered"],
        });
      }
    }
  });

/** The AI's per-area decisions must agree with the findings it listed. */
export function checkAreasMatchFindings(data: { considered: AreaDecision[]; findings: { area: string }[] }): string | null {
  const found = new Set(data.findings.map((f) => f.area));
  const missing = data.considered.filter((d) => d.applies && !found.has(d.area)).map((d) => d.area);
  const unexpected = [...found].filter((a) => a !== "other" && !data.considered.some((d) => d.area === a && d.applies));
  const parts: string[] = [];
  if (missing.length) parts.push(`you decided ${missing.join(", ")} applies but listed no finding in ${missing.length === 1 ? "that area" : "those areas"} - add ${missing.length === 1 ? "it" : "them"}, or set applies to false`);
  if (unexpected.length) parts.push(`you listed findings in ${unexpected.join(", ")} without deciding ${unexpected.length === 1 ? "it applies" : "they apply"} - set applies to true or use area "other"`);
  return parts.length ? `Your area decisions and your findings disagree: ${parts.join("; and ")}.` : null;
}

const IMPACT_ORDER = { high: 0, medium: 1, low: 2 } as const;
const SEVERITY_ORDER = { critical: 0, warning: 1 } as const;

/** Most important first: by the AI's own impact rank, then severity; otherwise the order it gave. */
export function rankFindings<F extends { impact?: string; severity: string }>(findings: F[]): F[] {
  const rank = (f: F) => (IMPACT_ORDER as Record<string, number>)[f.impact ?? "medium"] ?? 1;
  const sev = (f: F) => (SEVERITY_ORDER as Record<string, number>)[f.severity] ?? 1;
  return findings.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || sev(a.f) - sev(b.f) || a.i - b.i).map((x) => x.f);
}

const TOOL_NAME = "emit_failures";

/** The kinds that have an `instanceCount` trait — the only components an instance-count finding can be about. */
const INSTANCE_COUNT_KINDS = new Set<string>(["service", "database", "load-balancer"]);

/**
 * Drops a finding the AI itself flagged as "only about running more
 * instances / adding replicas" (`aboutInstanceCount`). Asked for by the product
 * owner: it was by far the most common finding, and acting on it (queue the
 * fix, Re-simulate) spent a full billed call to change one trait — which
 * Re-simulate now sets itself from the tier group (reworkModel.ts). The call is
 * the AI's, made per finding in its own output; this only reads it. It used to
 * be a list of regexes over the code and title, which was string-matching on
 * natural language. Scoped to the kinds that HAVE an instance count: "X is a
 * single point of failure" said of an external dependency is a different risk
 * (no fallback) and stays.
 */
export function dropInstanceCountFindings(findings: AiFinding[], model: Pick<SystemModel, "components">): AiFinding[] {
  const kindOf = new Map(model.components.map((c) => [c.id, c.kind as string]));
  return findings.filter((f) => !(f.aboutInstanceCount === true && INSTANCE_COUNT_KINDS.has(kindOf.get(f.componentId) ?? "")));
}

/**
 * At the lowest tier, drops findings the AI itself marked as biting only at a
 * larger scale (`bitesAt: "larger-scale"`): a 100-user system was being handed
 * "at scale" findings, and the review re-runs, so they return once the scale is
 * raised. Judged by the AI per finding, not by matching the code's wording.
 */
export function dropLargerScaleFindingsWhenSmall(findings: AiFinding[], workload: SystemModel["workload"]): AiFinding[] {
  return atLowestTier(workload) ? findings.filter((f) => f.bitesAt !== "larger-scale") : findings;
}

/** Finding codes about one kind's own traits, and the only kind they can be about. */
const KIND_SPECIFIC_CODES: { code: RegExp; kind: string }[] = [
  { code: /^EXTERNAL_DEPENDENCY_/, kind: "external-dependency" },
  { code: /^LB_/, kind: "load-balancer" },
];

/**
 * Drops a finding whose code names another kind's trait ("no load-balancer
 * health checks" raised on a gateway, which has no such trait). The prompt
 * says so, but found live: it was raised anyway, and the only way to close it
 * was to add a load balancer just to satisfy the finding. Deterministic half
 * of that prompt rule.
 */
export function dropMisattributedFindings(findings: AiFinding[], model: Pick<SystemModel, "components">): AiFinding[] {
  const kindOf = new Map(model.components.map((c) => [c.id, c.kind as string]));
  return findings.filter((f) =>
    KIND_SPECIFIC_CODES.every(({ code, kind }) => !code.test(f.code) || kindOf.get(f.componentId) === kind),
  );
}

const IDENTIFY_FAILURES_PROMPT = `You are a senior software architect reviewing a system design for real, concrete risks - the way you would in an actual design review, not a checklist exercise.

You are given the system as JSON: its components, their categorical traits (booleans and small categories, never precise numbers), the edges between them, and its workload (users and/or requests, each a rough scale rather than an exact number).

For each REAL risk you find, report:
- code: a short SCREAMING_SNAKE_CASE identifier. Reuse a well-known name if it genuinely fits (THUNDERING_HERD_RISK, CASCADING_FAILURE_RISK, UNBOUNDED_ADMISSION, QUEUE_NO_DEAD_LETTER, FIXED_SCALING_AT_SCALE, UNCACHED_DATABASE_AT_SCALE, EXTERNAL_DEPENDENCY_NO_FALLBACK - ONLY for a component whose kind is "external-dependency", never for an internal service or database, LB_NO_HEALTH_CHECKS - ONLY for a load-balancer) or invent a new one if the risk is real but doesn't match any of those - these are a starting vocabulary, not an exhaustive list. Think like an architect, not a lookup table.
- severity: "critical" (this will actually break something) or "warning" (a real risk, not yet a proven failure). Don't mark everything critical - that trains people to ignore critical.
- componentId: which component (by its id in the JSON) this risk is on.
- title: a short, plain label for the risk.
- explanation: ONE OR TWO SHORT SENTENCES in plain language, as if explaining it to someone learning system design for the first time. No unexplained jargon. Say what could actually go wrong, concretely, referencing this specific system - not a generic definition of the risk category.
- fixes: one or two concrete remediations, each with an id (a short kebab-case slug, unique within this finding), a label (what to do, plainly), and a tradeoff (what it costs - money, complexity, or a new risk - stated honestly in one sentence).

- bitesAt: "now" if this hurts or clearly threatens the system at its CURRENT scale, "larger-scale" if it only becomes a problem once the scale grows. Be honest: a system at its launch tier has few "now" risks. Findings marked "larger-scale" are held back until the scale is raised.
- aboutInstanceCount: true only when the entire concern is that something runs as a single instance, lacks replicas, or needs more copies; false for every other risk.

Instance counts are not findings. Every component's instanceCount trait (how many copies of a service, load balancer or database run) is adjusted automatically when the system is re-simulated at a larger scale, so whether something runs as one copy or several, or whether a database has replicas, is never a risk to report - however it would be worded. Report risks that come from the OTHER traits and from the shape of the topology.

Judge every risk at the system's CURRENT scale, the workload tiers in the JSON. A risk that only bites at a far larger scale than the current tier ("at scale" problems on a system serving a hundred users) is not a finding yet - the person raises the scale to meet those later. Say "critical" only for something that breaks at the current scale.

A component that exists to be another's standby (a secondary provider, a backup, a failover copy) is the fallback itself - never report "no fallback" on it.

A CDN is reached by clients first and pulls from its origin, so it has no incoming edges from other components; reason about it as sitting in front of the origin.

Only report a risk you can point to something CONCRETE in the model for - a specific trait, a specific topology shape, a specific combination of the two. Don't invent a risk that isn't actually grounded in what's in front of you, and don't pad the list to look thorough. If the system is genuinely healthy at its current scale, say so by returning an empty findings list rather than manufacturing something to report.

How to answer: FIRST decide, for EACH of the ${REVIEW_AREAS.length} review areas in "considered", whether a real risk in that area applies to THIS system (applies true or false) and give a short "evidence" - what in the diagram makes it apply, or why it does not:
- data-integrity: money or state moved twice or lost - retries without idempotency, a write and its event that can disagree, no reconciliation.
- hot-keys-and-partitioning: one key, row or shard taking a disproportionate share - a global leaderboard, a counter, a popular item.
- regional-latency: users far from where the work happens - one region, cross-region calls on the request path.
- shared-datastore-coupling: several components sharing one store, so one hurts all and it cannot scale or fail independently.
- duplicate-or-parallel-paths: the same work reaching a component two ways, or events fanned out redundantly.
- request-path-single-points: a component every request depends on that has no fallback, or a control-plane dependency needed at request time.
- cascading-failure: one slow or failing dependency dragging its callers down (no timeout, breaker or bulkhead).
- durability-and-recovery: data or work that cannot be recovered after a failure - no dead-letter handling, versioning or replay.
Then list findings, each with its "area" (one of those, or "other" for anything else) and an "impact" of high, medium or low - how much it matters to THIS system, not how common the pattern is. A finding in an area you marked as not applying is a contradiction.

You are also given "Facts from the diagram": things read off its structure (which stores several components share, how each queue or broker is wired, which components fan out widely, which parts are reached two ways). They are facts, not findings - decide what they mean at this scale.

Output only the structured decisions and findings list. Do not add any other commentary.`;

export function buildFindingsToolInputSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(IdentifyFailuresResponseSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function buildTool(): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: "Emit the failure points identified for this system.",
    strict: true,
    input_schema: buildFindingsToolInputSchema() as Anthropic.Tool.InputSchema,
  };
}

export async function identifyFailures(
  model: SystemModel,
  options: StructuredCallOptions = {},
): Promise<AiFinding[]> {
  const result = await runStructuredCall(
    IDENTIFY_FAILURES_PROMPT,
    `${JSON.stringify(model)}\n\nFacts from the diagram:\n${graphFacts(model)}`,
    IdentifyFailuresResponseSchema,
    buildTool(),
    {
      ...options,
      // A response with no decisions or ranking (older callers, canned test
      // responses) is read as: an area applies exactly when a finding names it.
      normalizeOutput: (raw) => {
        if (typeof raw !== "object" || raw === null) return raw;
        const r = raw as { findings?: unknown; considered?: unknown };
        const findings = (Array.isArray(r.findings) ? r.findings : []).map((f) => {
          const g = f as { area?: string; impact?: string };
          return { ...(f as object), area: g.area ?? "other", impact: g.impact ?? "medium" };
        });
        const named = new Set(findings.map((f) => (f as { area: string }).area));
        const considered = Array.isArray(r.considered)
          ? r.considered
          : REVIEW_AREAS.map((area) => ({ area, applies: named.has(area), evidence: named.has(area) ? "a finding names it" : "not applicable" }));
        return { ...(raw as object), considered, findings };
      },
      validateResult: (data) => checkAreasMatchFindings(data as { considered: AreaDecision[]; findings: { area: string }[] }),
    },
    "identifyFailures",
  );
  const fromAi = dropLargerScaleFindingsWhenSmall(
    dropMisattributedFindings(dropInstanceCountFindings(result.data.findings, model), model),
    model.workload,
  );
  return mergeLintFindings(rankFindings(fromAi), lintTopology(model));
}
