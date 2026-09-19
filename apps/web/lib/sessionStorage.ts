import type { AiFinding, SystemModel } from "@archsim/engine";
import { createClient } from "./supabase/client";

const TABLE = "projects";

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** True on an assistant message that actually changed the model — lets the UI distinguish it from a plain answer. */
  changed?: boolean;
}

/** A log entry, not a live-derived list — see store.ts's own comment on `appliedFixes`. */
export interface AppliedFixRecord {
  componentId: string;
  findingTitle: string;
  fixLabel: string;
  appliedAt: number;
}

/**
 * A fix the user has chosen but that hasn't been implemented yet — see
 * store.ts's own comment on `pendingFixes`. Carries enough of the
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

/** A checkpoint recorded on the initial build and every completed Re-simulate — see store.ts's own comment on `versions`. */
export interface Version {
  id: string;
  model: SystemModel;
  findings: AiFinding[];
  createdAt: number;
}

export interface SavedSession {
  model: SystemModel;
  history: SystemModel[];
  findings: AiFinding[];
  findingsStatus: "idle" | "loading" | "done";
  findingsError: string | null;
  canResimulate: boolean;
  /** True when the model changed (a raised tier) since `findings` was last actually computed for it. */
  findingsStale: boolean;
  chatMessages: ChatMessage[];
  appliedFixes: AppliedFixRecord[];
  pendingFixes: PendingFix[];
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
): Promise<{ id: string; savedAt: number } | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const withTimestamp: SavedSession = { ...session, savedAt: Date.now() };
  const row = {
    user_id: user.id,
    name: session.model.name,
    data: withTimestamp,
    updated_at: new Date().toISOString(),
  };

  try {
    if (id === null) {
      const { data, error } = await supabase.from(TABLE).insert(row).select("id").single();
      if (error || !data) return null;
      return { id: data.id as string, savedAt: withTimestamp.savedAt };
    }
    const { error } = await supabase.from(TABLE).update(row).eq("id", id).eq("user_id", user.id);
    if (error) return null;
    return { id, savedAt: withTimestamp.savedAt };
  } catch {
    return null;
  }
}

export async function loadProject(id: string): Promise<SavedSession | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("data")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data) return null;
    return data.data as SavedSession;
  } catch {
    return null;
  }
}

export async function listProjects(): Promise<ProjectSummary[] | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, name, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (error || !data) return null;
    return data.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      updatedAt: new Date(row.updated_at as string).getTime(),
    }));
  } catch {
    return null;
  }
}

export async function deleteProject(id: string): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  try {
    const { error } = await supabase.from(TABLE).delete().eq("id", id).eq("user_id", user.id);
    return !error;
  } catch {
    return false;
  }
}
