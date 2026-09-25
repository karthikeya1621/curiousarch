import { cleanModelIdentity, unwrapIdentityText, type AiFinding, type SystemModel } from "@archsim/engine";
import { createClient } from "./supabase/client";

const TABLE = "projects";

/**
 * The signed-in user's id, read from the LOCAL session — no network call.
 * This used to be `auth.getUser()`, which round-trips to Supabase's Auth
 * server on every call: each autosave paid for that request in series
 * before its own write, and list/load/delete each paid it too.
 *
 * `getSession()` isn't server-verified, and that's fine HERE specifically:
 * the id is only used to tag an insert and to narrow a select/update, and
 * the `projects` table's row-level security (`auth.uid() = user_id`) is what
 * actually enforces ownership server-side — a tampered local session can
 * still only reach rows the real JWT is allowed to. (middleware.ts keeps
 * using the verified `getUser()` for the page/API gate, where an unverified
 * claim would not be acceptable.)
 */
async function currentUserId(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user.id ?? null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /**
   * On an assistant reply that was a change REQUEST (not a plain answer):
   * which queued change it is and where that stands — "queued" until the next
   * Re-simulate applies it ("applied"), or "removed" if the user took it back
   * out of the queue (or restored a version, which discards the queue).
   */
  change?: { id: string; status: "queued" | "applied" | "removed" };
  /** Legacy: set by the old chat, which changed the model immediately. Rendered as an applied change. */
  changed?: boolean;
}

/**
 * A change the user asked for in chat, waiting for Re-simulate — see
 * lib/store/slices/queueSlice.ts's comment on `pendingChanges`. `request` is their exact words
 * and `instruction` the self-contained restatement written when they sent it
 * (see chatWithProject.ts): both go to the AI at Re-simulate time.
 */
export interface PendingChatChange {
  id: string;
  request: string;
  instruction: string;
  queuedAt: number;
}

/** A log entry, not a live-derived list — see lib/store/slices/queueSlice.ts's comment on `appliedFixes`. */
export interface AppliedFixRecord {
  componentId: string;
  findingTitle: string;
  fixLabel: string;
  appliedAt: number;
}

/**
 * A fix the user has chosen but that hasn't been implemented yet — see
 * lib/store/slices/queueSlice.ts's comment on `pendingFixes`. Carries enough of the
 * original finding/fix to describe it precisely to the AI at
 * Re-simulate time, since by then the finding that produced it may no
 * longer be in `findings` at all (findings only refresh on Re-simulate).
 */
export interface PendingFix {
  componentId: string;
  findingCode: string;
  findingTitle: string;
  fixId: string;
  fixLabel: string;
  fixTradeoff: string;
  queuedAt: number;
}

/** A checkpoint recorded on the initial build and every completed Re-simulate — see lib/store/slices/versionsSlice.ts's comment on `versions`. */
export interface Version {
  id: string;
  model: SystemModel;
  findings: AiFinding[];
  createdAt: number;
  /**
   * The user action (a build or a Re-simulate) that produced this version —
   * the join key from a version to its AI calls and cost (`ai_calls.action_id`).
   * Absent on a version recorded before usage tracking.
   */
  actionId?: string;
}

export interface SavedSession {
  model: SystemModel;
  findings: AiFinding[];
  findingsStatus: "idle" | "loading" | "done";
  findingsError: string | null;
  canResimulate: boolean;
  /** See lib/store/slices/modelSlice.ts's doc comment on `parametersChangedSinceResimulate` — persisted so reopening a project doesn't lose the "parameters changed" note while leaving `canResimulate` itself restored. */
  parametersChangedSinceResimulate: boolean;
  /** See lib/store/slices/modelSlice.ts's doc comment on `chatChangeSinceResimulate` — same reasoning, persisted for the same reason. */
  chatChangeSinceResimulate: boolean;
  /** See lib/store/slices/modelSlice.ts's doc comment on `baselineModel`. Optional: absent on a project saved before it existed. */
  baselineModel?: SystemModel | null;
  /** True when the model changed (a raised tier) since `findings` was last actually computed for it. */
  findingsStale: boolean;
  chatMessages: ChatMessage[];
  appliedFixes: AppliedFixRecord[];
  pendingFixes: PendingFix[];
  /** Optional: absent on a project saved before chat changes were queued. */
  pendingChanges?: PendingChatChange[];
  versions: Version[];
  savedAt: number;
}

/**
 * One row per project, not per user — `id` addresses a specific project;
 * `null` means "not saved yet," which inserts a new row instead of
 * updating one. Every access is wrapped in try/catch: a logged-out user,
 * a network hiccup, or an RLS rejection all degrade to "nothing
 * saved/restored," not a crash — same contract this had when it was
 * backed by localStorage instead of Postgres.
 *
 * `name` is denormalized from `session.model.name` on every save so
 * `listProjects` can list titles without pulling and parsing the full
 * `data` JSONB for every row.
 */
export async function saveProject(
  id: string | null,
  session: Omit<SavedSession, "savedAt">,
  // The id to give a project on its FIRST insert (`id` null) instead of a
  // database-generated one — see `draftProjectId` in lib/store/slices/projectSlice.ts: AI usage was
  // already filed under it before the project existed.
  newId?: string,
): Promise<{ id: string; savedAt: number } | null> {
  const supabase = createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;

  const withTimestamp: SavedSession = { ...session, savedAt: Date.now() };
  const row = {
    user_id: userId,
    name: session.model.name,
    data: withTimestamp,
    updated_at: new Date().toISOString(),
  };

  try {
    if (id === null) {
      const { data, error } = await supabase
        .from(TABLE)
        .insert((newId ? { id: newId, ...row } : row) as Record<string, unknown>)
        .select("id")
        .single();
      if (error || !data) return null;
      return { id: data.id as string, savedAt: withTimestamp.savedAt };
    }
    const { error } = await supabase.from(TABLE).update(row).eq("id", id).eq("user_id", userId);
    if (error) return null;
    return { id, savedAt: withTimestamp.savedAt };
  } catch {
    return null;
  }
}

/**
 * Projects saved before the engine started cleaning model identity can carry a
 * JSON-wrapped `name` (`{"value":"…"}`) in the working model, the baseline and
 * every version. Cleaned as they're read, so nothing needs a database
 * migration; the next save writes the clean text back, and the projects list
 * (whose `name` column was denormalized from it) heals with it.
 */
export function healSession(session: SavedSession): SavedSession {
  return {
    ...session,
    model: cleanModelIdentity(session.model),
    baselineModel: session.baselineModel ? cleanModelIdentity(session.baselineModel) : session.baselineModel,
    versions: (session.versions ?? []).map((v) => ({ ...v, model: cleanModelIdentity(v.model) })),
  };
}

export async function loadProject(id: string): Promise<SavedSession | null> {
  const supabase = createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("data")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return healSession(data.data as SavedSession);
  } catch {
    return null;
  }
}

export async function listProjects(): Promise<ProjectSummary[] | null> {
  const supabase = createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, name, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error || !data) return null;
    return data.map((row) => ({
      id: row.id as string,
      name: unwrapIdentityText(row.name as string, "name"),
      updatedAt: new Date(row.updated_at as string).getTime(),
    }));
  } catch {
    return null;
  }
}

export async function deleteProject(id: string): Promise<boolean> {
  const supabase = createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return false;

  try {
    const { error } = await supabase.from(TABLE).delete().eq("id", id).eq("user_id", userId);
    return !error;
  } catch {
    return false;
  }
}
