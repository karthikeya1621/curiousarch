import { BreakingDiagram } from "./LoginHero";

const STEPS = [
  { title: "A diagram appears", body: "The components your system needs and how they connect." },
  { title: "Grow the traffic", body: "Raise users and requests tier by tier, starting small." },
  { title: "See what breaks first", body: "Pick a fix, Re-simulate, and watch the result." },
];

/**
 * The right half of the blank home screen: the same drawing as the login page (so the two screens read as
 * one product) and what happens after Build. Decorative and secondary - the describe box leads, and small
 * screens drop this entirely.
 */
export function EmptyStateAside() {
  return (
    <aside
      aria-hidden
      className="relative hidden overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-8 text-slate-100 lg:block"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(rgb(148 163 184 / 0.18) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse at 50% 40%, black 20%, transparent 75%)",
        }}
      />
      <div className="pointer-events-none absolute -right-16 -top-10 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />

      <p className="relative text-xs font-medium uppercase tracking-wide text-slate-500">What you&apos;ll see</p>
      <BreakingDiagram className="relative mt-4 w-full" />

      <ol className="relative mt-8 space-y-4 text-sm">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 text-xs text-slate-400">
              {i + 1}
            </span>
            <span>
              <span className="font-medium text-slate-200">{s.title}</span>
              <span className="block leading-snug text-slate-500">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
