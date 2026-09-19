import { createBrowserClient } from "@supabase/ssr";

/**
 * One client per call, not a module-level singleton — createBrowserClient
 * is cheap and this avoids any risk of stale auth state surviving across
 * a sign-out/sign-in in the same tab.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
