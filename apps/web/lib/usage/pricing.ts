/**
 * USD cost of a call, from its token counts. The token counts are what's
 * stored as the source of truth — cost is derived from them at write time
 * and stamped with `PRICE_VERSION`, so when prices change a SQL backfill can
 * recompute old rows instead of trusting a number that was right once.
 *
 * Only models whose price is actually known are listed. A model with no
 * entry gets `null` cost rather than a guess: a wrong dollar figure that
 * looks authoritative is worse than an obviously missing one. Add or
 * override prices without a deploy via `AI_MODEL_PRICES`, a JSON object of
 * `{ "<model id>": { "inputPerMTok": <usd>, "outputPerMTok": <usd> } }`
 * (USD per million tokens), e.g. for the reasoning model
 * (`AI_REASONING_MODEL`, default `claude-sonnet-5`) — set it from
 * Anthropic's pricing page.
 */

export const PRICE_VERSION = "2026-09-22";

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

const DEFAULT_PRICES: Record<string, ModelPrice> = {
  // The two tiers structuredCall.ts falls back to when AI_REASONING_MODEL /
  // AI_UTILITY_MODEL aren't set — which is every deployment unless someone
  // overrides them. Priced so a fresh setup shows real cost with no
  // AI_MODEL_PRICES at all; that var is then only for a price change or a
  // model swapped in via those two env vars.
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
};

// Prompt caching: writing a 5-minute ephemeral cache entry costs 1.25x the
// base input price, reading one costs 0.1x (structuredCall.ts marks the
// system prompt and tool as ephemeral breakpoints).
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export function loadPrices(overrides: string | undefined = process.env.AI_MODEL_PRICES): Record<string, ModelPrice> {
  const prices = { ...DEFAULT_PRICES };
  if (!overrides) return prices;
  try {
    const parsed = JSON.parse(overrides) as Record<string, Partial<ModelPrice>>;
    for (const [model, price] of Object.entries(parsed)) {
      if (
        typeof price?.inputPerMTok === "number" &&
        typeof price?.outputPerMTok === "number" &&
        price.inputPerMTok >= 0 &&
        price.outputPerMTok >= 0
      ) {
        prices[model] = { inputPerMTok: price.inputPerMTok, outputPerMTok: price.outputPerMTok };
      }
    }
  } catch {
    console.warn("[usage] AI_MODEL_PRICES is not valid JSON — ignoring it.");
  }
  return prices;
}

/**
 * `costUsd`: what the call cost. `cacheSavingsUsd`: what the cache reads
 * saved versus paying full input price for those tokens — the number that
 * says whether the prompt-caching setup is paying off. Both `null` when the
 * model's price is unknown or the call has no usage (a failed request).
 */
export function computeCost(
  model: string,
  usage: TokenUsage | undefined,
  prices: Record<string, ModelPrice>,
): { costUsd: number | null; cacheSavingsUsd: number | null } {
  const price = prices[model];
  if (!price || !usage) return { costUsd: null, cacheSavingsUsd: null };
  const perToken = { input: price.inputPerMTok / 1e6, output: price.outputPerMTok / 1e6 };
  const costUsd =
    usage.inputTokens * perToken.input +
    usage.cacheCreationInputTokens * perToken.input * CACHE_WRITE_MULTIPLIER +
    usage.cacheReadInputTokens * perToken.input * CACHE_READ_MULTIPLIER +
    usage.outputTokens * perToken.output;
  const cacheSavingsUsd = usage.cacheReadInputTokens * perToken.input * (1 - CACHE_READ_MULTIPLIER);
  return { costUsd, cacheSavingsUsd };
}
