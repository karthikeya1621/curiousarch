export type Theme = "light" | "dark" | "system";

const THEME_KEY = "archsim:theme";

const listeners = new Set<() => void>();

/**
 * Lets React read the theme via `useSyncExternalStore` (ThemeToggle.tsx)
 * instead of copying it into state from an effect. Notified by `setTheme`
 * in this tab, and by the `storage` event when another tab changes it.
 */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The single source of truth for "should .dark be on <html> right now" — used by both the boot script (inlined, can't import this) and everything after hydration, so they never disagree. */
export function resolveIsDark(theme: Theme): boolean {
  return theme === "dark" || (theme === "system" && prefersDark());
}

export function getTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Private window or blocked site data — falls through to "system".
  }
  return "system";
}

/** Persists the choice and applies it immediately — ThemeToggle.tsx doesn't need to also touch the DOM itself. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Best-effort — the class still gets applied for this session even
    // if it can't be remembered for the next one.
  }
  document.documentElement.classList.toggle("dark", resolveIsDark(theme));
  listeners.forEach((listener) => listener());
}
