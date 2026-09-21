"use client";

import { useSyncExternalStore } from "react";
import { getTheme, setTheme, subscribeTheme, type Theme } from "../lib/theme";
import { SunIcon, MoonIcon, MonitorIcon } from "./icons";

const OPTIONS: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
];

/**
 * Lives inside AccountMenu.tsx's dropdown — a display preference belongs
 * with account settings, not a separate header control. The current value
 * is read from localStorage as an external store (`useSyncExternalStore`,
 * with "system" as the server snapshot — the boot script in
 * app/layout.tsx already applied the right class before this ever renders,
 * so there's no flash either way), and a change is both persisted and
 * applied via lib/theme.ts's single `setTheme`.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, (): Theme => "system");

  return (
    <div className="flex items-center gap-0.5 rounded-md bg-slate-100 p-0.5 dark:bg-slate-700">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          aria-label={label}
          title={label}
          className={
            "flex flex-1 items-center justify-center rounded p-1.5 transition-colors " +
            (theme === value
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200")
          }
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
