/**
 * The one AI call involved in applying a fix — and only for the one fix
 * that has genuine free parameters. `fixes.ts`'s UNCACHED_DATABASE_AT_SCALE
 * factory ships hardcoded safe defaults for a freshly-inserted cache's
 * `ttl`/`keyspaceSize`/`hasStampedeProtection`; this lets those three
 * values be chosen for the specific system instead, without touching what
 * the AI is or isn't trusted to decide.
 *
 * This is NOT a `fromProse`-style "build the model" call. The transform
 * itself (insert a cache, rewire the edges) is still entirely
 * `fixes.ts`'s hand-written decision, and the pattern engine still
 * recomputes findings on whatever comes out — if the AI's choice is a bad
 * combination, a real, computed THUNDERING_HERD_RISK finding says so;
 * nothing here asserts that anything is safe or unsafe. The AI only fills
 * in categorical values within a shape someone already decided is a valid
 * fix for this finding.
 *
 * Each field schema below is its own fresh z.object() (via a function
 * call, not a shared singleton) specifically so no object identity is
 * reused across fields — same reason schema.ts's `baseFields()` is a
 * function rather than a shared object. That sidesteps the
 * definitions-hoisting requirement `fromProse.ts` needs entirely, rather
 * than needing it and remembering to apply it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { SystemModel } from "../types.ts";

function proposedValueSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({
    rationale: z
      .string()
      .min(1, "One short sentence: why this value fits this specific system."),
    value: valueSchema,
  });
}

const CacheProposalSchema = z.object({
  ttl: proposedValueSchema(z.enum(["short", "long"])),
  keyspaceSize: proposedValueSchema(z.enum(["small", "large"])),
  hasStampedeProtection: proposedValueSchema(z.boolean()),
});

export type CacheProposal = z.infer<typeof CacheProposalSchema>;

const TOOL_NAME = "propose_cache_traits";
const DEFAULT_MODEL = "claude-sonnet-5";
/** A three-field categorical proposal is a much smaller generation than a
 * whole SystemModel — no reason to allow as long as fromProse's 90s. */
const DEFAULT_TIMEOUT_MS = 30_000;

const CACHE_PROPOSAL_PROMPT = `You are an experienced architect deciding the specific configuration for a NEW cache being added in front of a database, as the fix for a real, computed risk: the database sits directly on a synchronous request path with nothing absorbing repeat reads, at real scale.

You are given the rest of the system as JSON - its components, their traits, and the edges between them. Decide three things about the new cache, each a rough category, never a number:

- ttl: "short" or "long" - how long a cached value should live before refreshing.
- keyspaceSize: "small" or "large" - whether the hot set of frequently-read keys is small (a handful of records dominate traffic) or large (reads spread broadly).
- hasStampedeProtection: true or false - whether one expiry triggers one refill (protected) or every waiting request refills independently (a thundering-herd risk).

You are choosing real infrastructure, not describing this database's existing behavior - every value needs a rationale grounded in the SPECIFIC system you were given (its labels, its other traits, its scale), not a generic default. If the safest combination and the best-fitting combination differ, say so in the rationale and choose the one that actually fits this system.

One trap to avoid: "short" TTL + "small" keyspace + hasStampedeProtection: false is precisely the thundering-herd combination this whole exercise exists to avoid creating by accident. If you choose that exact combination, you are creating a new critical risk, not adding a fix - only choose it if the system genuinely calls for very fresh data on a narrow hot set, and if so, hasStampedeProtection must be true.

Output only the structured proposal. Do not add findings, recommendations, or commentary about anything besides these three values - the engine decides what's a risk, not you.`;

function buildToolInputSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(CacheProposalSchema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

function buildTool(): Anthropic.Tool {
  return {
    name: TOOL_NAME,
    description: "Propose specific configuration values for a newly-added cache.",
    strict: true,
    input_schema: buildToolInputSchema() as Anthropic.Tool.InputSchema,
  };
}

export interface ProposeCacheTraitsOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  client?: Anthropic;
}

/**
 * Single attempt, no repair-retry loop (unlike `fromProse`) — the caller
 * is expected to catch any failure (network, timeout, validation) and
 * fall back to `fixes.ts`'s hardcoded safe defaults. A flaky or slow AI
 * call should degrade to exactly today's deterministic behavior, never a
 * broken fix.
 */
export async function proposeCacheTraits(
  model: SystemModel,
  databaseComponentId: string,
  options: ProposeCacheTraitsOptions = {},
): Promise<CacheProposal> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!options.client && !apiKey) {
    throw new Error(
      "proposeCacheTraits requires an Anthropic API key. Set ANTHROPIC_API_KEY or pass { apiKey }.",
    );
  }

  const database = model.components.find((c) => c.id === databaseComponentId);
  if (!database || database.kind !== "database") {
    throw new Error(
      `proposeCacheTraits: "${databaseComponentId}" is not a database in this model.`,
    );
  }

  const client =
    options.client ?? new Anthropic({ apiKey, timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
  const modelName = options.model ?? DEFAULT_MODEL;

  const response = await client.messages.create({
    model: modelName,
    max_tokens: 1024,
    system: CACHE_PROPOSAL_PROMPT,
    tools: [buildTool()],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: `The database getting a new cache is "${databaseComponentId}" (${database.label}). Full system:\n\n${JSON.stringify(model, null, 2)}`,
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("proposeCacheTraits: the model responded without calling the tool.");
  }

  return CacheProposalSchema.parse(toolUse.input);
}
