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

/**
 * One icon per Component["kind"] (types.ts), used together in
 * ComponentNode so a node's role reads at a glance without leaning on
 * color alone.
 */

export function GatewayIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="11" width="18" height="7" rx="1.5" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <path d="M7 15h.01M12 15h.01M17 15h.01" />
    </svg>
  );
}

export function ServiceIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" />
    </svg>
  );
}

export function CacheIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M13 3 4 14h7l-1 7 9-11h-7l1-7z" />
    </svg>
  );
}

export function DatabaseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
      <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
    </svg>
  );
}

export function QueueIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}
