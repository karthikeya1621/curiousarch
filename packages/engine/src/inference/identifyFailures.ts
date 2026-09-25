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

const AiFixSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  tradeoff: z.string().min(1, "What this costs — money, complexity, or risk. Never omitted."),
});

const AiFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["critical", "warning"]),
  componentId: z.string().min(1),
  title: z.string().min(1),
  explanation: z.string().min(1, "One or two plain sentences. No jargon — this is a learning tool."),
  fixes: z.array(AiFixSchema).min(1),
});

const IdentifyFailuresResponseSchema = z.object({
  findings: z.array(AiFindingSchema),
});

const TOOL_NAME = "emit_failures";

/** The kinds that have an `instanceCount` trait — the only components an instance-count finding can be about. */
const INSTANCE_COUNT_KINDS = new Set<string>(["service", "database", "load-balancer"]);
const INSTANCE_COUNT_CODE = /SINGLE_POINT|SINGLE_INSTANCE|NO_REPLICA|REDUNDAN|INSTANCE_COUNT|MORE_INSTANCES/i;
const INSTANCE_COUNT_TITLE =
  /\b(single|one|only one)\s+(instance|replica|node|server|copy)\b|\bsingle point of failure\b|\bno (replicas?|redundancy)\b|\bwithout (a )?(replicas?|redundancy)\b|\b(more|multiple|additional|second)\s+instances?\b/i;

/**
 * Drops any finding that is only "this runs as a single instance / has no
 * replicas / needs more instances". Asked for by the product owner: it was by
 * far the most common finding, and acting on it (queue the fix, Re-simulate)
 * spent a full billed call to change one trait — which Re-simulate now sets
 * itself when the scale calls for it (reworkModel.ts), so it's never
 * something to report.
 *
 * The prompt already says so, but a prompt is a request and the model's
 * habit here is strong, so this is the deterministic half. Scoped to the
 * kinds that HAVE an instance count: "X is a single point of failure" said of
 * an external dependency is a different risk (no fallback) and stays. Matched
 * on the code and the title only — never the explanation, where a finding
 * about something else can perfectly well mention instances in passing.
 */
export function dropInstanceCountFindings(findings: AiFinding[], model: Pick<SystemModel, "components">): AiFinding[] {
  const kindOf = new Map(model.components.map((c) => [c.id, c.kind as string]));
  return findings.filter((f) => {
    if (!INSTANCE_COUNT_KINDS.has(kindOf.get(f.componentId) ?? "")) return true;
    return !(INSTANCE_COUNT_CODE.test(f.code) || INSTANCE_COUNT_TITLE.test(f.title));
  });
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

Instance counts are not findings. Every component's instanceCount trait (how many copies of a service, load balancer or database run) is adjusted automatically when the system is re-simulated at a larger scale, so whether something runs as one copy or several, or whether a database has replicas, is never a risk to report - however it would be worded. Report risks that come from the OTHER traits and from the shape of the topology.

Only report a risk you can point to something CONCRETE in the model for - a specific trait, a specific topology shape, a specific combination of the two. Don't invent a risk that isn't actually grounded in what's in front of you, and don't pad the list to look thorough. If the system is genuinely healthy at its current scale, say so by returning an empty findings list rather than manufacturing something to report.

Output only the structured findings list. Do not add any other commentary.`;

function buildToolInputSchema(): Record<string, unknown> {
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
    input_schema: buildToolInputSchema() as Anthropic.Tool.InputSchema,
  };
}

export async function identifyFailures(
  model: SystemModel,
  options: StructuredCallOptions = {},
): Promise<AiFinding[]> {
  const result = await runStructuredCall(
    IDENTIFY_FAILURES_PROMPT,
    JSON.stringify(model),
    IdentifyFailuresResponseSchema,
    buildTool(),
    options,
    "identifyFailures",
  );
  const fromAi = dropMisattributedFindings(dropInstanceCountFindings(result.data.findings, model), model);
  return mergeLintFindings(fromAi, lintTopology(model));
}
