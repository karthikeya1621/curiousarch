import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * For use in Server Components, Route Handlers, and Server Actions — reads
 * and writes the auth cookie via `next/headers`. `setAll` is wrapped in a
 * try/catch because a Server Component can call this too (needed to read
 * the session) but can't write cookies; proxy.ts is what actually
 * refreshes the cookie on every request, so a no-op here in that context
 * is safe, not a bug.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — middleware refreshes the
            // session cookie instead.
          }
        },
      },
    },
  );
}
