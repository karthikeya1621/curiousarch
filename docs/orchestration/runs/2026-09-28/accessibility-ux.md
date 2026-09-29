# Accessibility & UX specialist report - run 1 (Sep 28 2026)

Read-only review of the working tree on top of 3015f46 (code only; nothing was seen in a browser). Status of each finding after the same-day fixes is in [ACTION-ITEMS.md](ACTION-ITEMS.md). Reproduced from the specialist's final message. **Most of this report is still open** (only the login email label and `role="alert"` on login errors were fixed).

Ranked findings (WCAG 2.2 AA plus UX). I confirmed each by reading code and line numbers. Where a claim depends on browser rendering I say "plausible". Nothing has been seen in a browser.

**[blocker] components/ComponentNode.tsx:29-31 - Component detail (the "click any node" feature) can't be opened by keyboard.**
Scenario: the node is a `div` with only `onClick`. React Flow 12.11.6 makes the node wrapper focusable (tabIndex 0, role group). Its key handler only selects the node on Enter or Space and never calls the inner `onClick` (`node_modules/@xyflow/react/dist/esm/index.js:2303`). The failure badge is a real button, so it is reachable. But traits, provenance and fix history are not, and ControlPanel.tsx:140 tells users to "Click any node".
Fix: pass `onNodeClick={(_, n) => openComponentDetail(n.data.component)}` to `<ReactFlow>` in FlowDiagram.tsx, and set `ariaLabel` on the nodes (for example "label, kind, N failures"). Also tell keyboard users in ControlPanel.tsx:140.
Confidence: confirmed by reading code.

**[blocker] components/Modal.tsx:24-47 (used by ConfirmDialog.tsx and ComponentDetailModal.tsx) - No focus management in any modal.**
Scenario: on open, focus stays on the trigger behind the backdrop and there is no focus trap, so Tab walks the page underneath. On close, focus is not restored. `Modal` has no `role`, `aria-modal` or label at all. ComponentDetailModal has none of these anywhere. ConfirmDialog puts `role="alertdialog"` on an inner div, but `aria-modal` there does not stop the page behind from being interactive. This affects the delete-project confirm, discard-changes confirm and restore confirm. Escape and backdrop click do work.
Fix: in `Modal`, save `document.activeElement`, then focus the first control (or the dialog itself with `tabIndex={-1}`) on open, trap Tab, and restore focus on close. Move `role="dialog" aria-modal="true"` and `aria-labelledby` to the panel div. Have ComponentDetailModal pass an id for its title. Alternatively use native `<dialog>.showModal()`, which gives all of this.
Confidence: confirmed by reading code.

**[major] components/ChatWidget.tsx:44-50, 53-71 - Chat popup loses focus on open and on close, and has no dialog semantics or Escape.**
Scenario: clicking "Ask AI" sets `open`, which makes the FAB `inert`. Nothing focuses the chat input, so focus drops to `<body>`. Closing makes the popup `inert`, and focus drops again. Escape does not close the popup; only the `/comp` listbox handles it. The popup has no `role` or label.
Fix: on open, `inputRef.focus()` (`ProjectChat` needs a focus prop or `autoFocus` on mount when open). On close, focus the FAB via a ref. Add `role="dialog" aria-label="Ask or change this system"` and an Escape handler.
Confidence: confirmed by reading code.

**[major] components/ProjectChat.tsx:168-195, 284, and components/ProseInput.tsx:113-116, plus other async status text - Almost no async result is announced to screen readers.**
Scenario: across `components/` and `app/` the only live regions are `GuestBanner` (`role="status"`) and `ReworkWarning` (`role="alert"`). These are silent:
- chat replies and "Thinking..."
- `chatError`
- ProseInput "Inferring..." and its error (a long-running build)
- the FailureSidebar loading and error boxes (44-57)
- the "Save failed" autosave button (AutoSaveIndicator.tsx:84)
- the Re-simulate error (ResimulateButton.tsx:117)
- FindingPanel's `askError` and `rationale`
- the login `error` (login/page.tsx:228) and the "Check {email}" confirmation (login/page.tsx:181)
Fix: the chat message list gets `role="log" aria-live="polite"`. Every error `<p>` gets `role="alert"`. Loading and confirmation boxes get `role="status"`. The build button area gets `aria-busy` plus a status region. These containers must be in the DOM before their content changes.
Confidence: confirmed by reading code.

**[major] components/GuestBanner.tsx:57-62 - The trial-limit message is a live region that is re-created, so it likely isn't announced.**
Scenario: `role="status"` sits on a `<div key={flash}>` that is remounted on every refused action, and the whole component returns `null` until `limited` loads. A region inserted with its text already inside usually isn't announced. So a guest who hits the limit gets a visual flash only, which is the moment that matters.
Fix: keep one persistent `<div role="status" aria-live="polite">` wrapper mounted from first render, and keep the `key={flash}` on an inner element (or trigger the flash by toggling a class). Put `role="alert"` on the error span at line 103.
Confidence: plausible (live-region insertion behaviour varies by screen reader).

**[major] app/login/page.tsx:188-195 and components/GuestBanner.tsx:85-93 - Email inputs have no label.**
Scenario: the only name is the placeholder "you@example.com", which vanishes on typing and has about 2.5:1 contrast in the login form. No `autoComplete`, `name` or `id` either. This fails 1.3.1, 3.3.2 and 4.1.2.
Fix: add `aria-label="Email address"` (or a visible label), `autoComplete="email"` and `name="email"` on the login input. Add an `aria-label` to the banner input too.
Confidence: confirmed by reading code.
*(Status: login input fixed; the GuestBanner input is still open.)*

**[major] components/FailureIndicator.tsx:37-38 - White text on amber-400 badge is about 1.7:1.**
Scenario: `text-white` on `bg-amber-400` (`#fbbf24`) is about 1.7:1, on amber-500 hover about 2.1:1, and on the open state amber-600 about 3.2:1. That is the main affordance for failures, and the number is unreadable in both themes. The accessible name is only the bare number, since `title` is an unreliable description.
Fix: `text-slate-900` on `bg-amber-400` / `hover:bg-amber-500` / open `bg-amber-500`. Add `aria-label={`${findings.length} possible failure(s) on ${nodeId}`}` and `aria-expanded={isOpen}`.
Confidence: confirmed by reading code (ratios computed from the Tailwind palette).

**[major] components/ResimulateButton.tsx:107 - The primary action, "Re-simulate", is white on cyan-600, about 3.7:1.**
Fix: `bg-cyan-700 enabled:hover:bg-cyan-800` (about 5.4:1).
Confidence: confirmed.

**[major] Light-theme text contrast: `text-slate-400` is 2.56:1 on white and about 2.45:1 on the page background `#f8fafc`.**
It has no dark variant and is used as real content, about 55 uses in 19 files. Worst offenders:
- Login: app/login/page.tsx:172, 175, 210, 224 and 235 (11px labels, the guest note, the Terms line), and the placeholder in login/page.tsx:193.
- Workspace: Workspace.tsx:106, ProseInput.tsx:87 (placeholder), :91 ("Try:") and :104 (counter), ProjectsCard.tsx:102, 104, 127, 139, and AutoSaveIndicator.tsx:77 (always visible in the header).
- Elsewhere: SystemDashboard.tsx:112, ComponentNode.tsx:46, TrafficNode.tsx:26, and ComponentDetailModal.tsx:63, 86, 97, 101, 116.
- Also LegalPage.tsx:17, ChatWidget and ProjectChat (`text-slate-400` in the "Removed" and "Thinking..." states), and AccountMenu.tsx:89 and 94.
Fix: use `text-slate-500 dark:text-slate-400` (4.76:1 on white, 4.6:1 on `#f8fafc`) for text. Keep `text-slate-400` only for decorative icons. Also `text-amber-600` needs about `text-amber-700` (ProseInput.tsx:104, ProjectChat.tsx:24), and `text-emerald-600` needs `text-emerald-700` (FindingPanel.tsx:113, ProjectChat.tsx:25). Those are 3.2:1 and 3.8:1 at 10-12px.
Confidence: confirmed (ratios computed).

**[major] components/LoginHero.tsx:52 and components/EmptyStateAside.tsx:30, 41 - `text-slate-500` on `bg-slate-950` is about 4.2:1 for 12-14px text.**
It fails AA for the hero step descriptions and the aside step text, and both screens are new.
Fix: `text-slate-400` (about 7.9:1 on slate-950).
Confidence: confirmed.

**[major] components/ControlPanel.tsx:38 and 35-36 - The tier buttons are about 20px tall and touching, and their disabled reason is only a `title`.**
Scenario: `px-2 py-0.5 text-xs` gives about 20px, with adjacent buttons touching, so the 24px target rule (2.5.8) fails. `disabled` buttons can't be focused and don't show `title` on touch. So the "Re-simulate at X first — scale up one step at a time" explanation (line 75) never reaches keyboard or mobile users, who just see dead options. It is `role="radio"` without arrow-key handling, which suggests keyboard behaviour it doesn't have.
Fix: `py-1` (24px) and a visible hint line under the control when any option is disabled. Use `aria-disabled` instead of `disabled` with `aria-describedby` pointing at that hint. Add arrow-key roving tabindex, or switch to a plain button group with `aria-pressed`.
Confidence: confirmed by reading code.

**[major] components/NewProjectButton.tsx:37-45, ResimulateButton.tsx:98 - Disabled buttons explain themselves only through `title`.**
Scenario: a `disabled` button is not focusable, and `title` doesn't show for keyboard or touch. That covers the free-plan "New project" (one project only) and "Re-simulate" (no changes yet). Users get no reason.
Fix: put the reason in visible text near the button, or use `aria-disabled="true"` with `aria-describedby` and a visually shown hint. Re-simulate's `ResimulateNotes` already shows what is pending, so a short muted line is enough there.
Confidence: confirmed by reading code.

**[major] components/Workspace.tsx:113-126 - The header likely overflows at about 360px.**
Scenario: the right cluster is `shrink-0`: "Saved Xm ago" (about 90px), "Version History" (about 140px, appears from 2 versions), the admin link, and the 32px avatar with 8px margin. The logo and wordmark on the left have no `min-w-0`. With the 312px content width, the two sides don't fit. The result is a squashed or wrapped wordmark or page-wide horizontal scroll. VersionHistory.tsx:48 then opens a `w-64 left-0` dropdown from mid-header, which can extend past the right edge.
Fix: `flex-wrap` on the header, hide the labels under `sm` (`<span className="hidden sm:inline">Version History</span>` and the autosave text), and use `right-0` (or `left-0 sm:left-0`) for the version dropdown on small screens.
Confidence: plausible (layout arithmetic).

**[major] app/login/page.tsx:144-149, 171-173 - The Google button is a fixed 280px inside a container that is only 236px wide at 360px.**
Scenario: the card is 312px, minus 2px border and 40px padding (`p-5`), minus 34px for the group (`p-4` plus border), leaves 236px. The comment assumes "344px inner", which only holds at about 432px and wider. Between about 360 and 430px the button pokes out of the grey group panel and the card padding by up to 22px per side. It does not cause page scroll, but it looks broken on the first screen a phone user sees.
Fix: compute the width from the container, for example `Math.min(280, googleButtonRef.current.parentElement!.clientWidth)` (GIS accepts 200-400), or drop the group's `p-4` at small sizes.
Confidence: plausible (layout arithmetic).

**[major] app/login/page.tsx:181-185 - Focus is lost after the magic link is sent.**
Scenario: submitting unmounts the form and the focused button, and focus returns to `<body>`. The success text is not announced (see the live-region finding). The error `<p>` at line 228 sits below the guest section and away from the field it belongs to. An invalid email gets no `aria-describedby`.
Fix: after `status === "sent"`, move focus to the confirmation via a ref with `tabIndex={-1}`, or render it inside a persistent `role="status"` container. Put the error next to the form with `id` plus `aria-describedby` on the input.
Confidence: confirmed by reading code.

**[minor] app/login/page.tsx:158-167 and components/LoginHero.tsx:37 - On small screens the login page has no `h1`.**
Scenario: the `h1` lives in the hero, which is `hidden` below `lg` (`display:none`). Small screens show a `div` and "Sign in" as an `h2`. The workspace `h1` is only the wordmark.
Fix: make the mobile brand block's tagline an `h1` or `sr-only h1`, and change the card title to `h2` under it only when both exist.
Confidence: confirmed by reading code.

**[minor] components/ChatWidget.tsx:42 - The infinite `animate-ping` ring on the FAB has no reduced-motion guard (2.2.2).**
The custom animations in globals.css do respect `prefers-reduced-motion`, but this Tailwind one doesn't.
Fix: `motion-safe:animate-ping` on the ring; `motion-safe:animate-pulse` at AutoSaveIndicator.tsx:80. GuestBanner.tsx:31 also uses `behavior: "smooth"` unconditionally, so use "auto" when reduced motion is set.
Confidence: confirmed.

**[minor] components/AccountMenu.tsx:65-105 and components/VersionHistory.tsx:38-78 - The two dropdowns lack the standard menu behaviour.**
Scenario: no `aria-expanded` or `aria-haspopup`, Escape does not close, focus doesn't move into the menu or return to the button, and Tab out leaves it open. It closes only on outside `mousedown`. The current version is shown by colour only (no `aria-current`). ProjectsCard.tsx:124-128 likewise shows the open project only through an icon (add `aria-current="true"`).
Fix: `aria-expanded={open}` and `aria-haspopup="menu"` (or `"true"`), an Escape handler that refocuses the button, and close on focus-out.
Confidence: confirmed.

**[minor] components/ProjectChat.tsx:231-274 - The `/comp` picker is not a proper combobox, and Enter sends during IME composition.**
Scenario: the `role="listbox"` options are buttons, but the input lacks `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`, so screen readers never hear the highlighted option. Line 269 submits on `e.key === "Enter"` with no `isComposing` check, so an IME user confirming a composition sends the half-typed message.
Fix: add the combobox attributes with ids on the options, and guard with `if (e.nativeEvent.isComposing) return;`.
Confidence: confirmed by reading code.

**[minor] components/SystemDashboard.tsx:63-77 - A heading is inside a button, and the disclosure has no state.**
Scenario: `<h2>` is nested in a `<button>` (invalid content model, and the heading is dropped from the outline). There is no `aria-expanded`. On the blank screen there is no heading between the `h1` and ProjectsCard's `h3` (ProjectsCard.tsx:86, ControlPanel.tsx:117), so the outline skips a level.
Fix: put the heading outside and the button inside it, or add `aria-expanded` to the button and change the `h3`s to `h2`.
Confidence: confirmed by reading code.

**[minor] app/globals.css:47-52 - The global `* { border-color }` rule beats every border-colour utility.**
Scenario: it is unlayered, and Tailwind v4 emits utilities inside `@layer utilities` (`node_modules/tailwindcss/index.css:1,948`), so unlayered rules always win. So `border-amber-*`, `border-rose-*`, `focus:border-*` and `hover:border-*` never apply. Affected: the critical-node border (ComponentNode.tsx:23-26, although the `ring` still shows), the rose error box (FailureSidebar.tsx:53), the amber banners, and every input focus border. Focus stays visible only because the global `:focus-visible` outline is also unlayered and overrides the `outline-none` in the class lists. That is accidental and fragile.
Fix: move both rules into `@layer base` (the `.dark *` rule too), and keep the `:focus-visible` rule in `@layer base`. Then the `outline-none` classes on inputs would win, so add `focus-visible:outline-2 focus-visible:outline-blue-500` (or drop `outline-none`) there.
Confidence: confirmed (layer order read from the installed package).

**[minor] app/globals.css - No `color-scheme` is set, so the dark theme still gets light native chrome.**
Scrollbars in the chat list, projects list and textarea, plus native form controls, stay light in dark mode.
Fix: `:root { color-scheme: light; } .dark { color-scheme: dark; }`.
Confidence: confirmed by grep (no `color-scheme` in `app/`, `components/` or `lib/`); rendering plausible.

**[minor] components/FlowDiagram.tsx:174-190 (mobile) - The canvas can trap touch and wheel scrolling.**
Scenario: at 360px the 440px-high canvas fills the viewport width, `panOnDrag` and `zoomOnScroll` default on, and `preventScrolling` defaults to true. A finger drag pans the canvas instead of scrolling the page, and the wheel zooms.
Fix: on small screens set `preventScrolling={false}`, `zoomOnScroll={false}`, and `panOnDrag={[1, 2]}`.
Confidence: plausible.

**[minor] components/ChatWidget.tsx:32 - The fixed chat button covers the bottom of the page.**
Scenario: `fixed bottom-5 right-5` with a `py-5` `main` and no bottom padding covers the last content (FailureSidebar) on short pages and phones.
Fix: `pb-24` on the workspace `main`.
Confidence: plausible.

**[minor] Text inputs are below 16px, so iOS Safari zooms the page on focus.**
That applies to ProjectChat.tsx:273, login/page.tsx:194, ProseInput.tsx:87 and GuestBanner.tsx:92 (12px). Zoom is not disabled in the viewport, so users can zoom back out, but it is jarring.
Fix: `text-base sm:text-sm` on those fields.
Confidence: plausible.

**[minor] components/AutoSaveIndicator.tsx:84 - "Save failed - retry" has no dark variant and is not announced.**
`text-rose-600` on slate-900 is about 3.8:1. A silent data-loss warning also needs `role="alert"` (see the live-region finding).
Fix: add `dark:text-rose-400` and `role="alert"`.
Confidence: confirmed.

**[minor] Logo.tsx:13 - Repeated brand announcement.**
The `Logo` SVG has `role="img" aria-label="CuriousArch"` and sits next to visible "CuriousArch" text, so it is read twice in Workspace.tsx:115-118, login/page.tsx:160-161 and LoginHero.tsx:32-33. Use `aria-hidden` when it accompanies the wordmark.
Confidence: confirmed.

**[low] No `error.tsx`, `global-error.tsx`, `not-found.tsx` or `loading.tsx` anywhere under `app/`.**
A render error or a bad URL shows Next's default pages, unbranded and outside the theme. Add branded ones (with a "Go to your projects" link).
Confidence: confirmed by find.
*(Status: error.tsx, global-error.tsx and not-found.tsx added; no loading.tsx.)*

**Checked and sound**
- `<html lang="en">` is set, and the viewport does not disable zoom.
- The dark-theme boot script and `.dark` variant work, and the theme control is labelled (ThemeToggle: `aria-label` on each option).
- Chat FAB and popup use `inert` correctly to keep the hidden one out of the tab order.
- Icon-only buttons are named: close, delete, account menu, chat close, remove-queued.
- No user-visible "archsim" copy remains (only internal storage keys and event names). `SITE_NAME` is used consistently.
- Login: form has `required`, `type="email"`, submit is guarded against double-send, and the guest option is hidden (not disabled) when unavailable. The guest button's disabled state is tied to the hCaptcha token.
- Glow and dot-grid decorations are `aria-hidden` and `pointer-events-none`. Login and the empty-state aside are decorative and hidden below `lg`, so mobile lays out one column.
- Focus ring stays visible (currently by cascade accident, see above). Reduced-motion is handled for `trial-flash`, `login-flow` and `login-fail`, and for chat scroll.
- ConfirmDialog has proper title/description ids, an explicit verb on each button, and Escape plus backdrop close.
- Legal pages have an `h1`, a `main` landmark and a readable column. Admin usage has a labelled `nav` with `aria-current`.
- ReworkWarning uses `role="alert"`. The ResimulateNotes toggle has `aria-expanded`. The chat close and remove buttons have correct names.

**Not checked**
- Anything rendered: real focus order, layout at 360px, the Google iframe, hCaptcha, React Flow keyboard behaviour in a real browser.
- `app/terms` in full (only `LegalPage` and the privacy header were read).
- The admin usage page beyond its header.
- Screen-reader behaviour of live regions (findings above are marked plausible where that matters).
