import type { ReactNode } from "react";

/**
 * The one card shell used across the dashboard, sidebar, and panels — same
 * border/radius/shadow everywhere instead of each component picking its
 * own. `padding="none"` for containers (like FlowDiagram) that manage their
 * own inner spacing.
 */
export function Card({
  children,
  className = "",
  padding = "md",
}: {
  children: ReactNode;
  className?: string;
  padding?: "none" | "sm" | "md";
}) {
  const pad = padding === "none" ? "" : padding === "sm" ? "p-4" : "p-5";
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 ${pad} ${className}`}
    >
      {children}
    </div>
  );
}
