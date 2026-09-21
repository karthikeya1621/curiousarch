/**
 * The sidebar chat box's backing call, for an EXISTING project — never
 * builds a brand-new one, that's `fromProse` (blank canvas / "New
 * Project", a completely separate flow that never touches this file).
 *
 * One free-text message in; the AI itself decides whether it's a
 * QUESTION about the architecture (answered directly, model untouched)
 * or a REQUEST TO CHANGE it (implemented as an actual model update).
 * Two separate calls, not one, for the same reason `fromProse` splits
 * workload parameters into their own call: `SystemModelSchema` is
 * already right at strict mode's compiled-grammar ceiling (see
 * workloadParameters.ts's own comment), so a routing decision can't be
 * added as an extra field on that same schema without real risk of
 * tipping it over again. Instead, a small, separate "route" call
 * decides isQuestion/reply first; only when it decides this is a change
 * does a SECOND call run, reusing `fromProse.ts`'s exact
 * `SystemModelSchema`/`buildTool` unchanged — the same "produce a whole
 * updated topology" shape `reworkModel`/`applyAiFix` already use. A pure
 * question never reaches that second call at all.
 *
 * `findings`/`pendingFixes` (both optional): what the dashboard is
 * currently showing — the AI-generated findings from `identifyFailures.ts`
 * and any fixes the user has queued but not yet applied via Re-simulate.
 * Found live: without these, chat had to re-derive an answer from the raw
 * model alone, so "why did you flag X" could land on an answer that
 * didn't quite match the wording already on screen, and chat had zero
 * visibility into a fix the user had already decided to queue. Passed as
 * context only — chat never asserts a finding of its own, and disagreeing
 * with what's already displayed is a bug to notice, not something to
 * paper over by having chat just echo the display text back.
 *
 * The model (and findings/pendingFixes alongside it) is embedded in the
 * SYSTEM prompt here (not the user content, unlike every other inference
 * module) specifically so it's cacheable across a multi-message
 * conversation: as long as none of it has changed between two chat
 * messages, the system prompt string is byte-identical, so
 * structuredCall.ts's cache_control on `system` actually saves
 * reprocessing the (often large) model JSON, not just the small static
 * instructions. The moment any of it changes (a fix/tier-change happened
 * elsewhere, or a fix got queued), the system prompt naturally differs
 * and the cache misses once — correct, since the AI genuinely needs to
 * see the update.
 *
 * A second, sequential call — same as `reworkModel.ts` — always follows a
 * change: `extendedComponents.ts`'s `reviseExtendedComponents` re-evaluates
 * any of the 7 "extended" kinds this system has, since the base
 * `SystemModelSchema` call literally cannot represent them in its own
 * output. Found live while wiring in findings/pendingFixes context: this
 * step was missing entirely before, so a chat-driven change silently
 * dropped every extended component the system already had — the exact
 * same class of bug `reworkModel.ts` was fixed for earlier.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SystemModelSchema } from "./schema.ts";
import { buildTool } from "./fromProse.ts";
import { EXTENDED_KINDS, isExtendedComponent, reviseExtendedComponents } from "./extendedComponents.ts";
import { formatPendingFixes, type PendingFixInput } from "./reworkModel.ts";
import { runStructuredCall, UTILITY_MODEL, type StructuredCallOptions } from "./structuredCall.ts";
import type { AiFinding, Component, SystemModel } from "../types.ts";

// A fresh z.object() rather than a shared singleton — no reused object
// identity in this schema, so no $ref-hoisting gotcha (see fromProse.ts's
// own comment on that class of bug) applies here.
const RouteSchema = z.object({
  isQuestion: z.boolean(),
  reply: z
    .string()
    .min(
      1,
      "A plain-language answer (if a question), or a short one-sentence restatement of the change about to be made (if a change request).",
    ),
});

const ROUTE_TOOL_NAME = "route_chat_message";

function buildRouteToolInputSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(RouteSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function buildRouteTool(): Anthropic.Tool {
  return {
    name: ROUTE_TOOL_NAME,
    description: "Decide whether this message is a question or a change request, and respond accordingly.",
    strict: true,
    input_schema: buildRouteToolInputSchema() as Anthropic.Tool.InputSchema,
  };
}

function formatFindings(findings: AiFinding[]): string {
  if (findings.length === 0) return "";
  const lines = findings
    .map((f) => `- [${f.severity}] "${f.title}" on "${f.componentId}": ${f.explanation}`)
    .join("\n");
  return `\n\nThe dashboard is currently showing these findings - ground any answer about risk in them where they're relevant (matching what's already on screen, not re-deriving a differently-worded version of the same thing), and don't contradict one without a real reason to:\n${lines}`;
}

function buildRoutePrompt(model: SystemModel, findings: AiFinding[], pendingFixes: PendingFixInput[]): string {
  return `You are an experienced architect chatting with someone about a system architecture they are actively building - this is a LEARNING TOOL, so answers should be clear and plain-language, never jargon-heavy.

You may be continuing an earlier conversation - use any prior turns for context (e.g. a message like "why is that?" refers back to what you just said).

Decide, for the latest message:
- Is this a QUESTION about the architecture (asking "why", "what would happen if", "how does X work", or similar, without asking for an actual change)? If so, set isQuestion to true and put a clear, plain-language ANSWER in "reply", grounded in specifics from the actual model (real component names, real traits) rather than generic textbook language.
- Or is this a REQUEST TO CHANGE the architecture (asking to add, remove, replace, or reconfigure something)? If so, set isQuestion to false and put a short, one-sentence restatement of the change you are about to make in "reply" (e.g. "Adding a CDN in front of the API Gateway to absorb static asset traffic.").

If the message is ambiguous, prefer treating it as a question and explain what you'd need to know to make a specific change.

Output only the structured decision.

Current model:

${JSON.stringify(model)}${formatFindings(findings)}${formatPendingFixes(pendingFixes)}`;
}

function buildChangePrompt(model: SystemModel, findings: AiFinding[], pendingFixes: PendingFixInput[]): string {
  return `You are implementing a SPECIFIC architectural change the user just asked for, in plain English - a separate step already decided this message is a real change request, not a question, so your only job here is to genuinely implement it.

You may be continuing an earlier conversation - use any prior turns for context if the request refers back to something already discussed.

Modify the model to implement the request - flip the relevant trait(s), and/or add, remove, or rewire components as the request actually requires. Everything else about the system should stay exactly as it was unless the request specifically requires a change to it - do not use this as an opportunity to reconsider the whole system.

Some components in the model may be of an EXTENDED kind (${EXTENDED_KINDS.join(", ")}). These are handled entirely by a separate step, not by you: your own structured output must never include a component of one of these kinds, must never reuse one of their ids for anything (even a base-kind component that seems related), and must OMIT any edge whose "from" or "to" is one of their ids from your output - even though such an edge existed in the input, the separate step re-adds it correctly, so leaving it out here is correct, not a mistake.

This applies even when the user's request is specifically about one of these kinds (e.g. "add a CDN", "add a message broker", "remove the payment dependency") - in that case your own output for the base topology simply doesn't change on account of that part of the request at all, since the separate step is the one that implements it; only make a base-kind change here if some OTHER part of the same request genuinely calls for one. Do not refuse or explain this in your output - this is a structured-data call, not commentary.

Every OTHER edge from the input, between two components you're both keeping (neither one an extended kind), must still be present in your output exactly as it was, unless the request specifically requires removing it.

Rules, same as always:
- Every trait is a rough category (a boolean or a small set of choices), never a number.
- Beyond the extended kinds mentioned above (which you never emit yourself), you may only use the five base component kinds (gateway, service, cache, database, queue) - don't invent another new one.
- For anything that still conceptually exists, reuse its EXACT same component id - this is how the interface keeps track of what's the same thing, not a new one. Only mint a new id for a component this specific request genuinely adds.
- Keep the same top-level "id" and "name".
- Every trait needs a rationale and a provenance. A value you are changing specifically to implement this request is "inferred" - never "stated". "stated" is only for something that was already true and you're leaving unchanged.
- The model must remain a DAG - never create an edge back into a component that is upstream of it.

Output only the structured model. Do not add findings, recommendations, or commentary.

Current model:

${JSON.stringify(model)}${formatFindings(findings)}${formatPendingFixes(pendingFixes)}`;
}

export interface ChatWithProjectResult {
  isQuestion: boolean;
  reply: string;
  /** Present only when isQuestion is false — the actually-updated model. */
  model?: SystemModel;
  repaired: boolean;
}

export async function chatWithProject(
  model: SystemModel,
  message: string,
  history: Anthropic.MessageParam[] = [],
  findings: AiFinding[] = [],
  pendingFixes: PendingFixInput[] = [],
  options: StructuredCallOptions = {},
): Promise<ChatWithProjectResult> {
  const route = await runStructuredCall(
    buildRoutePrompt(model, findings, pendingFixes),
    message,
    RouteSchema,
    buildRouteTool(),
    // Classifying question-vs-change doesn't need Sonnet — see
    // structuredCall.ts's own comment on UTILITY_MODEL. The actual change
    // implementation below keeps the default (full reasoning) model.
    // `history` last: it's chatWithProject's own dedicated parameter, not
    // something `options` should be able to shadow.
    { model: UTILITY_MODEL, ...options, history },
    "chatWithProject:route",
  );

  if (route.data.isQuestion) {
    return { isQuestion: true, reply: route.data.reply, repaired: route.repaired };
  }

  const change = await runStructuredCall(
    buildChangePrompt(model, findings, pendingFixes),
    `Requested change: "${message}"`,
    SystemModelSchema,
    buildTool(),
    { ...options, history },
    "chatWithProject:change",
  );

  // Sequential, not parallel — same reason as reworkModel.ts: this needs
  // the freshly-produced base component ids to correctly wire the
  // extended components back in. Previous extended components come from
  // the INPUT model, not the change call's own output — that output can
  // never contain them (see buildChangePrompt above).
  const previousExtended: Component[] = model.components.filter(isExtendedComponent);
  const extended = await reviseExtendedComponents(
    previousExtended,
    change.data,
    options,
    `\n\nThe user specifically asked for this change just now: "${message}"`,
  );

  return {
    isQuestion: false,
    reply: route.data.reply,
    model: {
      ...change.data,
      components: [...change.data.components, ...extended.components],
      edges: [...change.data.edges, ...extended.edges],
      workload: { ...change.data.workload, users: model.workload.users, requests: model.workload.requests },
    },
    repaired: route.repaired || change.repaired,
  };
}
