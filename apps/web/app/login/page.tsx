import { guestTrialOpen } from "../../lib/trial/server";
import { trialConfig } from "../../lib/trial/policy";
import { LoginForm } from "./LoginForm";

// The guest budget can change through the day - never let this page be built once and frozen with a
// stale answer. This does NOT replace the client-side recheck in LoginForm.tsx (kept deliberately, for the
// rare case the budget changes in the few seconds between this render and hydration) - it runs alongside
// it. guestTrialOpen() has its own short cache for exactly this reason: called directly rather than through
// the CDN-cached /api/trial/status route, it would otherwise hit Supabase on every single page view.
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
