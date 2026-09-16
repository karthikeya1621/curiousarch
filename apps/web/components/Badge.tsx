import type { ReactNode } from "react";

/**
 * One pill component for every status/provenance/severity chip in the app.
 * Centralizing the tone→color mapping here is what keeps "critical" red and
 * "stated" blue consistent everywhere instead of drifting per component.
 */
const TONES = {
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  critical: "bg-rose-50 text-rose-700 ring-rose-600/20",
  warning: "bg-amber-50 text-amber-800 ring-amber-600/20",
  info: "bg-blue-50 text-blue-700 ring-blue-600/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
  neutral: "bg-slate-100 text-slate-600 ring-slate-500/10",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
