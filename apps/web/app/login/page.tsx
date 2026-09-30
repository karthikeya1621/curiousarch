import { guestTrialOpen } from "../../lib/trial/server";
import { trialConfig } from "../../lib/trial/policy";
import { LoginForm } from "./LoginForm";

// The guest budget can change through the day - never let this page be built once and frozen with a
// stale answer. Same total load on Supabase as before: this replaces the client-side fetch that used to
// run after mount, at the same frequency, just earlier (before the HTML is sent) instead of after.
export const dynamic = "force-dynamic";

/**
 * A Server Component on purpose: `guestTrialOpen()` runs before any HTML is sent, so the guest option
 * (or its absence) is in the FIRST markup the browser gets. The interactive page used to decide this
 * with a client-side fetch in a `useEffect`, which meant the whole "or just look around" section popped
 * in a beat after everything else had already rendered - one of the layout shifts on this page. All the
 * client-only bits (Google Identity Services, the email form, the guest button) live in LoginForm.tsx.
 */
export default async function LoginPage() {
  const [available, config] = await Promise.all([guestTrialOpen(), Promise.resolve(trialConfig())]);
  return <LoginForm initialGuest={{ available, captcha: config.captcha }} />;
}
