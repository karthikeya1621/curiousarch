import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/**
 * A service-role client — bypasses RLS, so it exists ONLY for the usage
 * tables (lib/usage/), which the browser must never be able to write: a
 * user who could insert or edit their own usage rows could hide what they
 * spent. Server-only by construction (the key has no NEXT_PUBLIC_ prefix, so
 * Next never ships it to a client bundle) — never import this from a
 * component or from anything under lib/store/.
 *
 * `null` when SUPABASE_SERVICE_ROLE_KEY isn't set: usage tracking then turns
 * itself off instead of failing the AI call it was only meant to observe.
 * Warns once so a missing key isn't silent.
 */
export function getAdminClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("[usage] SUPABASE_SERVICE_ROLE_KEY is not set — AI usage tracking is disabled.");
    cached = null;
    return cached;
  }
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}
