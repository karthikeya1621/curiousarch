/**
 * The sidebar chat box's backing call, for an EXISTING project — never
 * builds a brand-new one, that's `fromProse` (blank canvas / "New
 * Project", a completely separate flow that never touches this file).
 *
 * One free-text message in; the AI itself decides whether it's a
 * QUESTION about the architecture (answered directly) or a REQUEST TO
 * CHANGE it. A change is NOT implemented here: the reply restates it and
 * an `instruction` is returned for the caller to QUEUE, exactly like a fix
 * the user picks from a finding — the model on screen doesn't move until
 * Re-simulate, which is the one deliberate (and billed) step that rebuilds
 * the architecture (see reworkModel.ts, which receives every queued
 * instruction). This is one small structured call now; it used to be up to
 * three (route, a full-model rewrite, an extended-component revision), all
 * spent immediately and then again by the rework that followed.
 *
 * Nothing is lost by deferring:
 *  - `instruction` is written to stand alone — real component ids, and any
 *    "it"/"that" resolved against the conversation and against changes
 *    already queued — so it still means the same thing at Re-simulate time,
 *    long after the message has scrolled out of the (windowed) `history`.
 *    The caller stores the user's verbatim `message` beside it too.
 *  - `pendingChanges` (with `findings`/`pendingFixes`) are shown to this
 *    call as context, marked as decided-but-not-yet-in-the-model, so a
 *    follow-up ("now put a cache behind that CDN") builds on a queued change
 *    instead of contradicting or duplicating it, and a question about the
 *    system can mention what's queued.
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
 * The model (and findings/queued items alongside it) is embedded in the
 * SYSTEM prompt here (not the user content, unlike every other inference
 * module) specifically so it's cacheable across a multi-message
 * conversation: as long as none of it has changed between two chat
 * messages, the system prompt string is byte-identical, so
 * structuredCall.ts's cache_control on `system` actually saves
 * reprocessing the (often large) model JSON, not just the small static
 * instructions. The moment any of it changes (a fix/tier-change happened
 * elsewhere, or something got queued), the system prompt naturally differs
 * and the cache misses once — correct, since the AI genuinely needs to
 * see the update.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { formatPendingChanges, formatPendingFixes, type PendingChangeInput, type PendingFixInput } from "./reworkModel.ts";
import { runStructuredCall, UTILITY_MODEL, type StructuredCallOptions } from "./structuredCall.ts";
import type { AiFinding, SystemModel } from "../types.ts";

// A fresh z.object() rather than a shared singleton — no reused object
// identity in this schema, so no $ref-hoisting gotcha (see fromProse.ts's
// own comment on that class of bug) applies here.
const RouteSchema = z.object({
  isQuestion: z.boolean(),
  reply: z
    .string()
    .min(
      1,
      "A short, plain-spoken answer (if a question) written as running prose, never markdown or a list — or a one-sentence restatement of the change being queued (if a change request).",
    ),
  instruction: z
    .string()
    .describe(
      'For a change request: one complete, self-contained instruction for the architect who will apply it later, naming real component ids from the model and resolving any "it"/"that"/"the new one" against the conversation and the already-queued changes. For a question: an empty string.',
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
    description:
      "Decide whether this message is a question or a change request, and respond accordingly. A change request is queued for later, not applied now.",
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

function buildRoutePrompt(
  model: SystemModel,
  findings: AiFinding[],
  pendingFixes: PendingFixInput[],
  pendingChanges: PendingChangeInput[],
): string {
  return `You are an experienced architect chatting with someone about a system architecture they are actively building - this is a LEARNING TOOL, so answers should be clear and plain-language, never jargon-heavy.

You may be continuing an earlier conversation - use any prior turns for context (e.g. a message like "why is that?" refers back to what you just said).

The model below is the system as of the last simulation. Fixes and changes the user has already queued (if any are listed after it) are DECIDED but are NOT in that model yet - they are applied together the next time the user clicks Re-simulate. Treat queued items as part of the plan: mention them where relevant, build on them, and never contradict or duplicate one.

A request to look at, review, analyze, or find gaps/risks/improvements in the CURRENT architecture is always answerable directly and immediately from the model below - that model IS the current one, so nothing about reviewing what already exists is ever waiting on a Re-simulate (only a request to CHANGE something needs one, since that's the one step that actually updates the model). If an earlier turn in this conversation said something was being added or changed that you don't actually see reflected in the model below, trust the model below, not what was said earlier - the earlier change may never have actually landed. Say so plainly (e.g. "I don't see that in the current architecture") instead of asking the user to re-simulate as if it were still pending; asking someone to click a button that won't produce something they already believe exists just wastes their time without explaining why.

"reply" is read aloud in a chat bubble, not rendered as a document - it has no markdown support at all, so any "**bold**", heading, or "1. / 2. / 3." list shows up as literal asterisks and numbers, not formatting. Write it the way you'd actually say it out loud to someone sitting next to you: plain sentences, no markdown, no headings, no numbered or bulleted lists - if you have several points, fold them into one or two short paragraphs instead of itemizing them. Keep it tight, usually 2-4 sentences; go longer only when the question genuinely can't be answered honestly in less. If you're tempted to write more than a short paragraph, that's a sign to pick the single most useful thing to say and say only that, not to organize everything you could say into a structured list.

Decide, for the latest message:
- Is this a QUESTION about the architecture (asking "why", "what would happen if", "how does X work", or similar, without asking for an actual change)? If so, set isQuestion to true, put a clear, plain-spoken ANSWER in "reply" per the style rule above, grounded in specifics from the actual model (real component names, real traits) rather than generic textbook language, and set "instruction" to an empty string.
- Or is this a REQUEST TO CHANGE the architecture (asking to add, remove, replace, or reconfigure something)? If so, set isQuestion to false and:
  - put a short, one-sentence restatement of the change in "reply", in the future tense since it is applied on Re-simulate (e.g. "Adding a CDN in front of the API Gateway to absorb static asset traffic.");
  - put ONE complete, self-contained instruction in "instruction": what to change, on which components (use their real ids from the model, or from a queued change if the request builds on one), and any detail the user gave. It must make sense to someone who never saw this conversation - replace "it", "that", "the new one" and similar with what they refer to. If the request cancels or reverses a queued change, say so explicitly.

If the message is ambiguous, prefer treating it as a question and explain what you'd need to know to make a specific change.

Output only the structured decision.

Current model:

${JSON.stringify(model)}${formatFindings(findings)}${formatPendingFixes(pendingFixes)}${formatPendingChanges(pendingChanges)}`;
}

export interface ChatWithProjectResult {
  isQuestion: boolean;
  reply: string;
  /**
   * Present only when isQuestion is false: the self-contained instruction to
   * queue (never empty — falls back to the user's own message if the AI left
   * it blank). The model itself is NOT changed here.
   */
  instruction?: string;
  repaired: boolean;
}

export async function chatWithProject(
  model: SystemModel,
  message: string,
  history: Anthropic.MessageParam[] = [],
  findings: AiFinding[] = [],
  pendingFixes: PendingFixInput[] = [],
  pendingChanges: PendingChangeInput[] = [],
  options: StructuredCallOptions = {},
): Promise<ChatWithProjectResult> {
  const route = await runStructuredCall(
    buildRoutePrompt(model, findings, pendingFixes, pendingChanges),
    message,
    RouteSchema,
    buildRouteTool(),
    // Classifying question-vs-change and restating it doesn't need Sonnet —
    // see structuredCall.ts's own comment on UTILITY_MODEL. `history` last:
    // it's chatWithProject's own dedicated parameter, not something
    // `options` should be able to shadow.
    { model: UTILITY_MODEL, ...options, history },
    "chatWithProject:route",
  );

  if (route.data.isQuestion) {
    return { isQuestion: true, reply: route.data.reply, repaired: route.repaired };
  }

  return {
    isQuestion: false,
    reply: route.data.reply,
    // Never queue an empty instruction (strict mode can't require non-empty
    // for a change but "" for a question without a conditional).
    instruction: route.data.instruction.trim() || message,
    repaired: route.repaired,
  };
}
