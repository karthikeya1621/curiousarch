"use client";

import { useState } from "react";
import { ProjectChat } from "./ProjectChat";
import { ChatIcon } from "./icons";

/**
 * Floating popup instead of a persistent third grid column — frees the
 * canvas up to a full two-column layout (Controls + Dashboard) while
 * keeping chat one click away. Starts closed on every mount (a fresh page
 * load or project switch): unread state/badges aren't worth the
 * complexity for a feature that's meant to be quick, on-demand Q&A, not
 * an always-open conversation.
 *
 * Both the FAB and the panel stay mounted at all times, cross-fading via
 * opacity/scale instead of an early-return swap — a hard unmount/mount
 * can't be transitioned with CSS, and this is meant to read as the panel
 * growing out of the button's corner, not a jump cut. `pointer-events-none`
 * is what actually stops the invisible one from swallowing clicks meant
 * for whatever's on top of it (both sit at the same fixed position,
 * scaled/faded but still full-size in the layout); `inert` on top of that
 * keeps its buttons out of the tab order while it's invisible.
 */
export function ChatWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        inert={open}
        className={
          "fixed bottom-5 right-5 z-40 origin-bottom-right transition-all duration-200 ease-out " +
          (open ? "pointer-events-none scale-90 opacity-0" : "scale-100 opacity-100")
        }
      >
        {/* Continuous, abstract, not tied to any real event — this is
            purely "an AI lives here," not a notification/unread signal
            (see the file doc comment on why this widget has no unread
            state at all). Two Tailwind-default animations, no custom
            keyframes: an outward `animate-ping` ring for motion, plus a
            static blurred gradient behind it for an ambient glow. */}
        <span className="absolute inset-0 rounded-full bg-cyan-400 opacity-75 animate-ping" />
        <span className="absolute -inset-1 rounded-full bg-linear-to-br from-cyan-500 to-blue-500 opacity-30 blur-md" />
        <button
          onClick={() => setOpen(true)}
          className="relative flex h-12 items-center gap-2 rounded-full bg-slate-900 px-5 text-white shadow-lg transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          <ChatIcon className="h-5 w-5" />
          <span className="text-sm font-medium">Ask AI</span>
        </button>
      </div>

      <div
        inert={!open}
        // `overflow-hidden` is the actual fix for a long reply pushing the
        // panel off-screen with no way to scroll to it: without it, if
        // ProjectChat's own content (header + description + however much
        // the message list needs) ever added up to more than this
        // max-height, the excess just rendered past this box's edge
        // uncontrolled — not clipped, not scrollable, since nothing here
        // was cropping it. `overflow-hidden` here is only the backstop;
        // the real fix is ProjectChat's own root filling this box via
        // `flex-1 min-h-0` and confining ALL of its own overflow to just
        // the message list (see that file's own comment).
        className={
          "fixed bottom-5 right-5 z-40 flex max-h-[min(70vh,640px)] w-96 max-w-[calc(100vw-2.5rem)] origin-bottom-right flex-col overflow-hidden transition-all duration-200 ease-out " +
          (open ? "scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0")
        }
      >
        <ProjectChat onClose={() => setOpen(false)} />
      </div>
    </>
  );
}
