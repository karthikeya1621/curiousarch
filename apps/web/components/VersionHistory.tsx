"use client";

import { useAppStore } from "../lib/store";

/**
 * One checkpoint per initial build + completed Re-simulate (see store.ts's
 * own comment on `versions`) — renders nothing until there's more than
 * one to navigate between. Clicking a version enters read-only preview
 * (`previewVersion`); it never mutates anything on its own — see
 * PreviewBanner.tsx for the explicit Restore action.
 */
export function VersionHistory() {
  const versions = useAppStore((s) => s.versions);
  const previewVersionId = useAppStore((s) => s.previewVersionId);
  const previewVersion = useAppStore((s) => s.previewVersion);

  if (versions.length < 2) return null;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-slate-400">History:</span>
      <div className="flex items-center gap-1">
        {versions.map((v, i) => (
          <button
            key={v.id}
            onClick={() => previewVersion(v.id)}
            title={new Date(v.createdAt).toLocaleString()}
            className={
              "rounded-md px-2 py-1 text-xs font-medium transition-colors " +
              (previewVersionId === v.id
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-500 hover:bg-slate-100")
            }
          >
            V{i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
