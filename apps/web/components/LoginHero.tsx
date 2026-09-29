import { Logo } from "./Logo";
import { Wordmark } from "./Wordmark";

const STEPS = [
  { n: "1", title: "Describe it", body: "Plain English. Mention the scale you hope for." },
  { n: "2", title: "Watch it grow", body: "Start small, then raise users and traffic tier by tier." },
  { n: "3", title: "Fix what breaks", body: "See the failure, pick a fix, re-simulate the result." },
];

/**
 * The brand half of the login page: name and mark top-left, a headline that says what the product does,
 * and a small architecture drawing whose one failing node tells the story (a database that runs out of
 * connections at 10K users). Decorative only - hidden from assistive tech and from small screens, where
 * the sign-in card leads and a compact brand header replaces it (see login/page.tsx).
 *
 * `lg:h-screen lg:overflow-y-auto`: this panel's own content (headline + paragraph + diagram + the step
 * list) can be taller than a laptop viewport. Without a height cap, the two-column grid row in
 * login/page.tsx stretches to fit it, dragging the sign-in card down with it (it then centers against
 * this panel's height, not the screen's) and pushing the Terms/Privacy line off the bottom of the
 * visible page. Capped to one viewport and scrolling independently, it can never do that; on a short
 * screen this panel itself scrolls instead, which is the one side where that's an acceptable tradeoff
 * (decorative, not the form the user needs to reach).
 */
export function LoginHero() {
  return (
    <section className="relative hidden overflow-x-hidden bg-slate-950 text-slate-100 lg:flex lg:h-screen lg:flex-col lg:justify-center lg:gap-8 lg:overflow-y-auto lg:px-12 lg:py-8">
      {/* dot grid + soft glow: texture without competing with the text */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(rgb(148 163 184 / 0.18) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse at 60% 55%, black 20%, transparent 75%)",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />

      <div className="relative flex items-center gap-3">
        <Logo className="h-7 w-auto text-white" />
        <Wordmark className="text-xl text-white" />
      </div>

      <div className="relative">
        <h1 className="max-w-md text-2xl font-semibold leading-[1.2] tracking-tight xl:text-3xl">
          See where your system breaks <span className="text-amber-400">before your users do.</span>
        </h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
          Describe an architecture in plain English. CuriousArch draws it, grows the traffic, and shows what fails first and why.
        </p>

        <BreakingDiagram className="mt-6 w-full max-w-sm" />
      </div>

      <ol className="relative grid max-w-xl grid-cols-3 gap-6 text-sm">
        {STEPS.map((s) => (
          <li key={s.n}>
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-700 text-[11px] text-slate-400">{s.n}</span>
            <p className="mt-1.5 text-[13px] font-medium text-slate-200">{s.title}</p>
            <p className="mt-0.5 text-xs leading-snug text-slate-400">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Users → Gateway → Service → (Cache, Database); the database is the node that fails at scale. */
export function BreakingDiagram({ className }: { className?: string }) {
  const node = "fill-slate-900 stroke-slate-700";
  const label = "fill-slate-300 text-[13px] font-medium";
  return (
    <svg viewBox="0 0 540 330" className={className} aria-hidden fill="none">
      {/* traces */}
      <g className="stroke-slate-600" strokeWidth="1.5">
        <path d="M140 163 H195" />
        <path d="M325 163 H380" />
        <path d="M445 140 V76" />
      </g>
      <path d="M445 186 V250" className="stroke-amber-500" strokeWidth="1.5" />
      {/* traffic flowing along the traces */}
      <g className="stroke-slate-300 login-flow" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 12">
        <path d="M140 163 H195" />
        <path d="M325 163 H380" />
        <path d="M445 140 V76" />
      </g>
      <path d="M445 186 V250" className="stroke-amber-400 login-flow" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 12" />

      {/* nodes */}
      <rect x="10" y="140" width="130" height="46" rx="12" className={node} />
      <text x="75" y="168" textAnchor="middle" className={label}>Users</text>
      <text x="75" y="130" textAnchor="middle" className="fill-slate-500 text-[11px]">10K</text>

      <rect x="195" y="140" width="130" height="46" rx="12" className={node} />
      <text x="260" y="168" textAnchor="middle" className={label}>Gateway</text>

      <rect x="380" y="140" width="130" height="46" rx="12" className={node} />
      <text x="445" y="168" textAnchor="middle" className={label}>Service</text>

      <rect x="380" y="30" width="130" height="46" rx="12" className={node} />
      <text x="445" y="58" textAnchor="middle" className={label}>Cache</text>

      {/* the failing node */}
      <rect x="380" y="250" width="130" height="46" rx="12" className="login-fail fill-amber-500/10 stroke-amber-500" strokeWidth="1.5" />
      <text x="445" y="278" textAnchor="middle" className="fill-amber-300 text-[13px] font-medium">Database</text>
      <g transform="translate(150 262)">
        <rect width="200" height="24" rx="12" className="fill-amber-500/15 stroke-amber-500/50" />
        <text x="100" y="16" textAnchor="middle" className="fill-amber-300 text-[11px]">connection pool exhausted</text>
      </g>
      <path d="M350 274 H380" className="stroke-amber-500/60" strokeWidth="1.5" strokeDasharray="2 3" />
    </svg>
  );
}
