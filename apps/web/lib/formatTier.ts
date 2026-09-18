/** 100 -> "100", 10_000 -> "10K", 1_000_000 -> "1M", 1_000_000_000 -> "1B". */
export function formatTier(n: number): string {
  if (n >= 1_000_000_000) return `${n / 1_000_000_000}B`;
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}K`;
  return `${n}`;
}
