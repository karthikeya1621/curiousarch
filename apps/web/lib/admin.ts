import { notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";

/**
 * Who may open the admin pages (currently /admin/usage): the emails listed
 * in `ADMIN_EMAILS` (comma-separated, case-insensitive). Deliberately NO
 * default — if the variable is unset nobody is an admin, so a missing
 * config fails closed rather than open. This is an operator's view of every
 * user's spend, so it's an allow-list of identities, not a role any user can
 * end up holding.
 */
export function parseAdminEmails(value: string | undefined = process.env.ADMIN_EMAILS): string[] {
  return (value ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Also requires the email to be CONFIRMED on the Supabase account: a
 * signed-up-but-unverified address is just a string someone typed, and must
 * never be enough to read every user's data.
 */
export function isAdminUser(user: Pick<User, "email" | "email_confirmed_at"> | null | undefined, admins = parseAdminEmails()): boolean {
  if (!user?.email || !user.email_confirmed_at) return false;
  return admins.includes(user.email.toLowerCase());
}

/**
 * For a server component: resolves the verified signed-in user if they're an
 * admin, otherwise a plain 404 — the page's existence isn't revealed to
 * anyone else. (proxy.ts has already required a login by this point;
 * this is the authorization step on top of it.) Uses `getUser()`, which
 * verifies the session with Supabase rather than trusting the cookie.
 */
export async function requireAdmin(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdminUser(user)) notFound();
  return user;
}
