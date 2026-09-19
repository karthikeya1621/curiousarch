import type { AiFinding, SystemModel } from "@archsim/engine";

const STORAGE_KEY = "archsim:session";

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
 * A single slot, not a list — there's no project picker yet (a "New
 * project" button is planned separately), so saving just overwrites
 * whatever was here before. Every access is wrapped in try/catch:
 * localStorage can throw in a private window or when site data is
 * blocked, and that's never worth failing a save/restore over — the app
 * degrades to "nothing to restore," not a crash.
 */
export function saveSession(session: Omit<SavedSession, "savedAt">): SavedSession | null {
  const withTimestamp: SavedSession = { ...session, savedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withTimestamp));
    return withTimestamp;
  } catch {
    return null;
  }
}

export function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedSession;
  } catch {
    return null;
  }
}
