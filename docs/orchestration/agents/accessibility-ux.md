# Specialist brief: Accessibility & UX

Shared context and rules: [../README.md](../README.md). Output format: [../REPORT-TEMPLATE.md](../REPORT-TEMPLATE.md).

**Mission:** audit the UI code against WCAG 2.2 AA and for UX defects. Read-only; no paid calls; you are reading code, not driving a browser (do not start servers; a driver exists at `apps/web/.claude/skills/run-web` for the orchestrator's later browser check).

## Review at least

`app/login/page.tsx`, `components/LoginHero.tsx`, `EmptyStateAside.tsx`, `ProseInput.tsx`, `GuestBanner.tsx`, `Workspace.tsx`, `AccountMenu.tsx`, `NewProjectButton.tsx`, `ProjectsCard.tsx`, `Modal.tsx`, `ConfirmDialog.tsx`, `ChatWidget.tsx` / `ProjectChat.tsx`, `FailureSidebar.tsx` / `FindingPanel.tsx`, `FlowDiagram.tsx` / `ComponentNode.tsx`, `app/globals.css`, `app/layout.tsx`, `app/privacy`, `app/terms`.

- Keyboard operability and visible focus; focus management in modals and popovers (trap, restore, Escape).
- Accessible names for icon-only buttons; form labels; error association (`aria-describedby`, `role="alert"`, `aria-live` for async errors and the trial banner).
- Contrast in BOTH themes for the class combinations actually used (for example slate-400 on white and on slate-900); reason with the real Tailwind v4 palette values.
- Heading hierarchy (the login hero `h1` vs the Workspace header), landmarks, `lang`, reduced motion, touch targets (at least 24px).
- Responsive behaviour at about 360px (overflow, the fixed 280px Google button inside the card, the chat popup).
- Disabled controls that explain themselves only through `title` (the disabled New project button).
- Empty, error and loading states; stale or inconsistent copy ("archsim" vs "CuriousArch").

## Done when

A ranked list of verified findings with the exact class/attribute change where possible, plus areas found sound.
