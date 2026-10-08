import { Link } from 'react-router-dom'
import {
  Check,
  FileText,
  Lightbulb,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'

const FEATURES = [
  {
    icon: Search,
    tone: 'bg-blue-50 text-brand-blue',
    title: 'Find evidence faster',
    text: 'PubMed queries built from your own protocol',
  },
  {
    icon: FileText,
    tone: 'bg-violet-50 text-violet-600',
    title: 'Reliable, transparent process',
    text: 'Multi-agent screening, then independent verification',
  },
  {
    icon: Lightbulb,
    tone: 'bg-emerald-50 text-emerald-600',
    title: 'Save time, keep the rigour',
    text: 'From question to screened evidence in an afternoon',
  },
  {
    icon: Users,
    tone: 'bg-rose-50 text-rose-500',
    title: 'Built for researchers',
    text: 'Plain English in, evidence you can defend out',
  },
]

/**
 * Three numbers, each checkable against the code rather than the marketing.
 *
 * The obvious figures for a panel like this - papers indexed, hours saved, percent
 * faster - are ones nobody here has measured. A claim on the sign-in page is the first
 * thing the product says about itself, so these say only what is demonstrably true:
 * four agents run, every paper is screened twice, and no decision is final until a
 * human makes it.
 */
const STATS = [
  { value: '4', label: 'AI agents' },
  { value: '2×', label: 'Every paper screened' },
  { value: '100%', label: 'Decisions you approve' },
]

/**
 * The shell every signed-out page sits in.
 *
 * A full-height split: the product on the left, the form on the right. The left side
 * is hidden below `lg` rather than stacked - it is a page and a half of pitch, and
 * someone who opened this URL came to sign in.
 */
/**
 * `wide` gives the form column more room. Register needs it: four fields stacked in a
 * 420px card ran 892px tall, which is taller than the viewport on any 768px laptop, and
 * the whole point of this screen is that it does not scroll. Two columns of fields in a
 * wider card is what makes it fit.
 */
export default function AuthLayout({ title, subtitle, children, footer, legalFooter, panelTitle, panelText, wide }) {
  return (
    // h-screen with overflow-hidden: the page itself never scrolls, so the two sides
    // stay locked to the viewport the way the design intends. Each column then gets
    // its own overflow-y-auto as the safety valve - on a 650px-tall laptop Register's
    // six fields still have somewhere to go, and clipping the submit button off the
    // bottom of a fixed page would be far worse than a short scroll inside one panel.
    <div className={`h-screen overflow-hidden bg-white lg:grid ${wide ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)]' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]'}`}>
      <ShowcasePanel title={panelTitle} text={panelText} />

      {/* The tonal step is what separates the halves, so it is held flat and cool
          against the left panel's blue gradient. A matching gradient here closed the
          gap exactly where the left side is bluest and the seam disappeared. The form
          is lifted out of the wash in plain white; no divider rule is needed. */}
      <div className="flex h-full flex-col overflow-y-auto bg-slate-50/80 px-5 py-4 sm:px-8">
        <div className="flex shrink-0 items-center justify-between gap-3">
          {/* On phones the showcase panel is not rendered, so the logo lives here. */}
          <Link to="/" aria-label="EvidenceIQ home" className="lg:hidden">
            <img src="/logo.png" alt="EvidenceIQ" className="h-11 w-auto" />
          </Link>
          {footer ? <div className="ml-auto text-sm text-neutral-500">{footer}</div> : null}
        </div>

        <div className={`mx-auto flex w-full flex-1 flex-col justify-center py-5 ${wide ? 'max-w-[540px]' : 'max-w-[420px]'}`}>
          <div className="rounded-3xl border border-blue-100/80 bg-white p-6 shadow-sm">
            <h1 className="text-2xl font-bold tracking-tight text-brand-black">{title}</h1>
            {subtitle ? <p className="mt-1.5 text-sm text-neutral-500">{subtitle}</p> : null}

            <div className="mt-6">{children}</div>

            <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-neutral-400">
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.9} />
              Your session is encrypted end to end
            </p>
          </div>

          {legalFooter ? (
            <div className="mt-4 text-center text-xs leading-relaxed text-neutral-400">
              {legalFooter}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- showcase ----- */

function ShowcasePanel({ title, text }) {
  return (
    <div className="relative hidden h-full overflow-y-auto bg-gradient-to-br from-blue-50 via-white to-blue-100/70 px-10 py-9 lg:flex lg:flex-col xl:px-14">
      <DotGrid />

      <Link
        to="/"
        aria-label="EvidenceIQ home"
        className="relative w-fit transition-opacity hover:opacity-80"
      >
        <img src="/logo.png" alt="EvidenceIQ" className="h-16 w-auto" />
      </Link>

      <div className="relative my-auto grid gap-10 py-8 2xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)] 2xl:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
            <span aria-hidden="true" className="h-px w-6 bg-neutral-400" />
            AI-powered evidence synthesis
          </p>

          <h2 className="mt-4 text-4xl font-bold leading-[1.1] tracking-tight text-brand-black">
            {title ?? (
              <>
                Better Evidence.
                <br />
                <span className="text-brand-blue">Brighter Decisions.</span>
              </>
            )}
          </h2>

          <p className="mt-4 max-w-md text-sm leading-relaxed text-neutral-600">
            {text ??
              'EvidenceIQ helps researchers, clinicians and policymakers turn a pile of literature into answers they can defend — screened by four agents, approved by you.'}
          </p>

          <ul className="mt-7 space-y-3.5">
            {FEATURES.map(({ icon: Icon, tone, title: heading, text: detail }) => (
              <li key={heading} className="flex gap-3">
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.9} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-brand-black">{heading}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-neutral-500">
                    {detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <PipelineArt />
      </div>

      {/* Dropped below 700px of viewport height. The panel needs 700px to show
          everything, and on a 1366x768 laptop the choice is between cutting this row
          off mid-chip or leaving it out cleanly - the headline, the features and the
          form all matter more than the footer stats. */}
      <div className="relative flex flex-wrap items-end justify-between gap-6 [@media(max-height:699px)]:hidden">
        <p className="max-w-[230px] text-lg italic leading-snug text-brand-blue">
          Science towards a healthier tomorrow
          <span
            aria-hidden="true"
            className="mt-1.5 block h-1 w-40 rounded-full bg-gradient-to-r from-brand-blue to-transparent"
          />
        </p>

        <dl className="flex flex-wrap gap-3">
          {STATS.map(({ value, label }) => (
            <div
              key={label}
              className="rounded-2xl border border-white bg-white/80 px-4 py-2.5 text-center shadow-sm"
            >
              <dt className="sr-only">{label}</dt>
              <dd>
                <span className="block text-xl font-bold tabular-nums text-brand-black">
                  {value}
                </span>
                <span className="mt-0.5 block text-[11px] text-neutral-500">{label}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

/** The faint dotted field behind everything, so the panel is not flat. */
function DotGrid() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 opacity-40"
      style={{
        backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)',
        backgroundSize: '22px 22px',
        maskImage: 'radial-gradient(ellipse at 70% 45%, black, transparent 72%)',
        WebkitMaskImage: 'radial-gradient(ellipse at 70% 45%, black, transparent 72%)',
      }}
    />
  )
}

const PIPELINE_STEPS = [
  { label: 'Search', tone: 'bg-brand-blue' },
  { label: 'Screen', tone: 'bg-violet-500' },
  { label: 'Verify', tone: 'bg-emerald-500' },
  { label: 'Summarize', tone: 'bg-amber-500' },
]

/**
 * What the product does, as a picture: one review, the sources feeding it, and the
 * four steps it passes through.
 *
 * Built from elements rather than an exported image - it stays sharp at any size,
 * costs no download, and the step names are the same four the rest of the app uses,
 * so the picture cannot quietly drift out of date on its own.
 */
function PipelineArt() {
  // Shown only from 2xl. At 1280 it stole enough width to wrap every feature line
  // three deep, and a picture that squeezes the words is a bad trade.
  return (
    <div aria-hidden="true" className="relative hidden h-[380px] 2xl:block">
      <span className="absolute left-1/2 top-8 h-60 w-60 -translate-x-1/2 rounded-full border border-dashed border-blue-200" />

      <span className="absolute left-0 top-16 flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-3 py-2 shadow-sm">
        <FileText className="h-4 w-4 text-brand-blue" strokeWidth={2} />
        <span className="text-xs font-semibold text-brand-black">PubMed</span>
      </span>

      <span className="absolute right-6 top-2 flex items-center gap-2 rounded-xl border border-blue-100 bg-white px-3 py-2 shadow-sm">
        <Sparkles className="h-4 w-4 text-brand-blue" strokeWidth={2} />
        <span className="text-xs font-semibold text-brand-black">AI agents</span>
      </span>

      {/* The paper itself, with a sheet tucked behind it. */}
      <span className="absolute left-4 top-32 h-44 w-32 -rotate-6 rounded-2xl border border-slate-200/80 bg-white shadow-card shadow-sm" />
      <div className="absolute left-14 top-28 w-44 rounded-2xl border border-slate-200/80 bg-white shadow-card p-4 shadow-lg">
        <p className="text-center text-xs font-bold text-brand-black">Systematic Review</p>
        <span className="mt-3 block h-1.5 w-full rounded-full bg-slate-100" />
        <span className="mt-1.5 block h-1.5 w-4/5 rounded-full bg-slate-100" />
        <span className="mt-1.5 block h-1.5 w-full rounded-full bg-slate-100" />
        <span className="mt-1.5 block h-1.5 w-3/5 rounded-full bg-slate-100" />
        <span className="mt-3 flex items-end gap-1">
          <span className="h-4 w-3 rounded-sm bg-blue-200" />
          <span className="h-7 w-3 rounded-sm bg-brand-blue" />
          <span className="h-5 w-3 rounded-sm bg-blue-300" />
        </span>
      </div>

      {/* The disc it stands on. */}
      <span className="absolute left-12 top-[19rem] h-7 w-48 rounded-[100%] bg-gradient-to-r from-blue-200 via-brand-blue/45 to-blue-200 blur-[1px]" />

      <ul className="absolute right-0 top-28 space-y-2 rounded-2xl border border-slate-200/80 bg-white shadow-card p-3 shadow-lg">
        {PIPELINE_STEPS.map(({ label, tone }) => (
          <li key={label} className="flex items-center gap-2">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full ${tone}`}>
              <Check className="h-3 w-3 text-white" strokeWidth={3} />
            </span>
            <span className="text-xs font-semibold text-brand-black">{label}</span>
          </li>
        ))}
      </ul>

      <p className="absolute bottom-0 left-0 w-full text-center text-[11px] font-semibold uppercase leading-relaxed tracking-[0.15em] text-neutral-500">
        Trusted evidence.
        <br />
        Real-world impact.
      </p>
    </div>
  )
}
