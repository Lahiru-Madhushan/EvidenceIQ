import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  FileSearch,
  ListChecks,
  PlayCircle,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react'

const TRUST_POINTS = [
  'Two independent AI opinions on every paper',
  'Evidence quoted from the abstract',
  'You make every final call',
]

/**
 * The landing hero. Says the one thing that sets EvidenceIQ apart - agents do the
 * reading, a second model checks the first, and the researcher only sees what needs
 * them - and shows it happening, rather than a static screenshot of a dashboard.
 */
export default function Hero() {
  return (
    <section
      id="home"
      className="relative overflow-hidden bg-gradient-to-br from-hero-navy via-hero-deep to-hero-blue text-white"
    >
      <Backdrop />

      <div className="relative mx-auto grid max-w-[1280px] grid-cols-[minmax(0,1fr)] items-center gap-14 px-6 pb-20 pt-14 sm:px-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:pb-28 lg:pt-20">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-blue-100 ring-1 ring-inset ring-white/20 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-amber-300" strokeWidth={2.2} />
            AI-powered systematic review screening
          </span>

          <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-[60px]">
            Screen a thousand papers.
            <br />
            <span className="bg-gradient-to-r from-amber-200 via-white to-sky-200 bg-clip-text text-transparent">
              Read only the ones that need you.
            </span>
          </h1>

          <p className="mt-6 max-w-[540px] text-lg leading-relaxed text-blue-100">
            Four AI agents turn your question into a protocol, search PubMed, screen every
            paper and independently double-check each decision — with the evidence quoted. You
            review the flagged few and sign off.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              to="/register"
              className="group inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 font-bold text-hero-deep shadow-xl shadow-black/20 transition-all hover:-translate-y-0.5 hover:shadow-2xl"
            >
              Start free — no card needed
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.4} />
            </Link>
            <a
              href="#demo"
              className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 font-semibold text-white ring-1 ring-inset ring-white/30 transition-colors hover:bg-white/10"
            >
              <PlayCircle className="h-5 w-5" strokeWidth={2} />
              See it in action
            </a>
          </div>

          <ul className="mt-8 grid gap-2.5 sm:grid-cols-1">
            {TRUST_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-2.5 text-sm text-blue-100">
                <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-emerald-300" strokeWidth={2.2} />
                {point}
              </li>
            ))}
          </ul>
        </div>

        <AgentRun />
      </div>

      {/* Soft fade into the white page below. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-black/5" />
    </section>
  )
}

const AGENTS = [
  { icon: ListChecks, name: 'Agent 1 · Criteria', out: 'Protocol ready — adults, RCTs, 2015–2024', tone: 'from-violet-400 to-indigo-500' },
  { icon: FileSearch, name: 'Agent 2 · Retrieval', out: '1,284 papers found on PubMed', tone: 'from-sky-400 to-blue-500' },
  { icon: ScanSearch, name: 'Agent 3 · Screening', out: 'Draft decision: INCLUDE', tone: 'from-amber-300 to-orange-500' },
  { icon: ShieldCheck, name: 'Agent 4 · Verification', out: 'Independent check agrees — evidence quoted', tone: 'from-emerald-300 to-emerald-500' },
]

/**
 * An illustrative screening run: each agent lights up in turn, on a loop. Pure CSS
 * (staggered animation delays), so it costs nothing and stops for reduced motion.
 */
function AgentRun() {
  return (
    <div className="relative mx-auto w-full max-w-[520px]" aria-label="Example of the four agents screening a paper">
      <div className="absolute -inset-6 rounded-[2rem] bg-sky-400/20 blur-3xl" aria-hidden="true" />

      <div className="relative rounded-3xl bg-white/[0.08] p-5 shadow-2xl shadow-black/30 ring-1 ring-inset ring-white/20 backdrop-blur-xl sm:p-6">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70 motion-reduce:hidden" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            Screening run
          </p>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-blue-100">
            Example
          </span>
        </div>

        <div className="mt-4 rounded-2xl bg-white p-4 text-brand-black shadow-lg">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">Paper 184 of 1,284</p>
          <p className="mt-1 text-sm font-semibold leading-snug">
            Effects of the DASH diet on blood pressure in adults with stage 1 hypertension: a
            randomised controlled trial
          </p>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            …we randomised{' '}
            <mark className="rounded bg-emerald-100 px-0.5 text-emerald-900 underline decoration-emerald-500 decoration-2 underline-offset-2">
              120 adults aged 40–65 with stage 1 hypertension
            </mark>{' '}
            to a DASH diet…
          </p>
        </div>

        <ol className="relative mt-4 space-y-2">
          <span aria-hidden="true" className="absolute bottom-5 left-[19px] top-5 w-px bg-gradient-to-b from-white/40 to-white/5" />
          {AGENTS.map(({ icon: Icon, name, out, tone }, i) => (
            <li
              key={name}
              className="agent-step relative flex items-center gap-3 rounded-2xl px-1 py-1.5"
              style={{ animationDelay: `${i * 1.2}s` }}
            >
              <span className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${tone} text-white shadow-lg`}>
                <Icon className="h-5 w-5" strokeWidth={2.1} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{name}</span>
                <span className="block truncate text-xs text-blue-100">{out}</span>
              </span>
              <CheckCircle2 className="agent-check h-5 w-5 shrink-0 text-emerald-300" style={{ animationDelay: `${i * 1.2}s` }} strokeWidth={2.2} />
            </li>
          ))}
        </ol>

        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-amber-400/15 p-3 ring-1 ring-inset ring-amber-300/40">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-hero-navy">
            <UserCheck className="h-5 w-5" strokeWidth={2.2} />
          </span>
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">You decide.</span>{' '}
            <span className="text-blue-100">Nothing is included until you approve it.</span>
          </p>
        </div>
      </div>

      <div className="absolute -right-3 -top-4 hidden rounded-2xl bg-white px-3.5 py-2.5 text-brand-black shadow-xl sm:block animate-float-slow">
        <p className="text-[11px] font-semibold text-neutral-500">Every paper</p>
        <p className="text-sm font-bold">2 AI opinions</p>
      </div>
      <div className="absolute -bottom-5 -left-4 hidden rounded-2xl bg-white px-3.5 py-2.5 text-brand-black shadow-xl sm:block animate-float-slow [animation-delay:1.5s]">
        <p className="text-[11px] font-semibold text-neutral-500">PRISMA diagram</p>
        <p className="text-sm font-bold">Built for you</p>
      </div>
    </div>
  )
}

function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-hero-cyan/25 blur-3xl animate-glow-pulse" />
      <div className="absolute -bottom-40 right-0 h-[30rem] w-[30rem] rounded-full bg-indigo-500/25 blur-3xl" />
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse at 60% 40%, black, transparent 75%)',
        }}
      />
    </div>
  )
}
