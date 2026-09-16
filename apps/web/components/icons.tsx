/**
 * Minimal inline icon set — no icon library dependency for a handful of
 * glyphs. Consistent 24x24 viewBox, 1.75 stroke, currentColor, matching a
 * generic Feather/Lucide style so they read as "one system" wherever used.
 */
type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function XCircleIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9.5 9.5l5 5m0-5l-5 5" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function AlertTriangleIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 9v4" />
      <path d="M12 16.5h.01" />
      <path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.28 2.25h17.8A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function UndoIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 10h11a5 5 0 0 1 0 10h-2" />
      <path d="M4 10l4-4M4 10l4 4" />
    </svg>
  );
}

export function ActivityIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </svg>
  );
}

export function SparklesIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  );
}
