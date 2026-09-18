import type { AiFinding, SystemModel } from "@archsim/engine";

const STORAGE_KEY = "archsim:session";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface SavedSession {
  model: SystemModel;
  history: SystemModel[];
  findings: AiFinding[];
  findingsStatus: "idle" | "loading" | "done";
  findingsError: string | null;
  canResimulate: boolean;
  chatMessages: ChatMessage[];
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
