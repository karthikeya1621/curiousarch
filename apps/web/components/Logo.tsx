import { useId } from "react";

/**
 * The Curious Arch mark (from public/logo-v5.svg, without its embedded C2PA provenance blob),
 * drawn inline so it follows the surrounding text colour in light and dark mode - an <img> can't
 * inherit `currentColor`. Mask ids are per-instance so two marks on one page don't clash.
 */
export function Logo({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const shape = `logo-shape-${uid}`;
  const mask = `logo-cutouts-${uid}`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 280" className={className} role="img" aria-label="CuriousArch">
      <defs>
        <path id={shape} d="M140 0 H420 A60 60 0 0 1 480 60 V220 A60 60 0 0 1 420 280 H140 A140 140 0 0 1 140 0 Z" />
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="480" height="280">
          <use href={`#${shape}`} fill="#fff" />
          <g stroke="#000" strokeWidth="24">
            <line x1="100" y1="140" x2="240" y2="140" />
            <line x1="240" y1="36" x2="240" y2="244" />
            <line x1="366" y1="140" x2="366" y2="290" />
          </g>
          <g fill="#000">
            <circle cx="240" cy="36" r="30" />
            <circle cx="240" cy="244" r="30" />
            <circle cx="100" cy="140" r="30" />
            <circle cx="366" cy="140" r="30" />
          </g>
          <g fill="#fff">
            <circle cx="240" cy="36" r="14" />
            <circle cx="240" cy="244" r="14" />
            <circle cx="100" cy="140" r="14" />
            <circle cx="366" cy="140" r="14" />
          </g>
        </mask>
      </defs>
      <use href={`#${shape}`} fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  );
}
