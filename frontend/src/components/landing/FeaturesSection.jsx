import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  GitBranch,
  KeyRound,
  Lock,
  MessageSquareText,
  ScrollText,
  ShieldCheck,
  Split,
  Zap,
} from 'lucide-react'

/**
 * Features as a bento grid: each tile shows the feature working in miniature instead of
 * describing it beside an icon. Tiles are static illustrations of the real product
 * screens, so they cannot drift into promising something the app does not do.
 */
export default function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-24 bg-[#f6f8fb] py-20 sm:py-24">
      <div className="mx-auto max-w-[1200px] px-6 sm:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-blue">Features</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-brand-black sm:text-4xl">
              Built for evidence you can defend
            </h2>
          </div>
          <Link
            to="/docs"
            className="group inline-flex items-center gap-1.5 text-sm font-bold text-brand-blue"
          >
            Read the docs
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.4} />
          </Link>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-6">
          <Tile
            className="md:col-span-4"
            icon={ScrollText}
            iconTone="bg-emerald-50 text-emerald-600"
            title="Evidence you can see"
            body="Every criterion is checked against the abstract, and the exact words behind each verdict are quoted — and verified to really be there."
          >
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
              <p className="text-sm leading-relaxed text-slate-700">
                Methods: We randomised{' '}
                <mark className="rounded bg-emerald-100 px-0.5 text-emerald-900 underline decoration-emerald-500 decoration-2 underline-offset-2">
                  120 adults aged 40–65
                </mark>{' '}
                with stage 1 hypertension to a{' '}
                <mark className="rounded bg-emerald-100 px-0.5 text-emerald-900 underline decoration-emerald-500 decoration-2 underline-offset-2">
                  DASH diet for 12 weeks
                </mark>
                . Results: systolic pressure fell by 8.2 mmHg.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Chip ok>Population · PASS</Chip>
                <Chip ok>Intervention · PASS</Chip>
                <Chip>Follow-up · UNCLEAR</Chip>
              </div>
            </div>
          </Tile>

          <Tile
            className="md:col-span-2"
            icon={Split}
            iconTone="bg-amber-50 text-amber-600"
            title="Two opinions, not one"
            body="A second model checks the first without seeing its answer. Disagreements go straight to you."
          >
            <div className="flex items-center justify-between gap-2 rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
              <Verdict who="Agent 3" value="INCLUDE" ok />
              <span className="text-xs font-bold text-neutral-400">vs</span>
              <Verdict who="Agent 4" value="EXCLUDE" />
            </div>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              <CircleHelp className="h-3.5 w-3.5" strokeWidth={2.2} />
              Flagged for your decision
            </p>
          </Tile>

          <Tile
            className="md:col-span-2"
            icon={GitBranch}
            iconTone="bg-violet-50 text-violet-600"
            title="PRISMA diagram, done"
            body="Your flow diagram is drawn live from the review and exports as SVG or PNG."
          >
            <div className="space-y-1.5">
              {[
                ['Identified', '1,284', 'w-full'],
                ['Screened', '1,284', 'w-[92%]'],
                ['Verified', '1,240', 'w-[78%]'],
                ['Included', '38', 'w-[34%]'],
              ].map(([label, n, w]) => (
                <div key={label} className={`${w} flex items-center justify-between rounded-lg bg-violet-50 px-3 py-1.5 text-xs ring-1 ring-inset ring-violet-100`}>
                  <span className="font-medium text-violet-900">{label}</span>
                  <span className="font-bold tabular-nums text-violet-700">{n}</span>
                </div>
              ))}
            </div>
          </Tile>

          <Tile
            className="md:col-span-2"
            icon={Zap}
            iconTone="bg-orange-50 text-orange-600"
            title="Focus mode"
            body="Work through flagged papers one at a time, full screen, from the keyboard."
          >
            <div className="flex flex-wrap items-center gap-2">
              {[['A', 'include'], ['O', 'exclude'], ['J', 'next'], ['N', 'note']].map(([key, label]) => (
                <span key={key} className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
                  <kbd className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-bold text-brand-black shadow-[0_2px_0_rgb(203_213_225)]">
                    {key}
                  </kbd>
                  {label}
                </span>
              ))}
            </div>
          </Tile>

          <Tile
            className="md:col-span-2"
            icon={MessageSquareText}
            iconTone="bg-sky-50 text-sky-600"
            title="Ask any paper"
            body="Chat with a paper or an uploaded PDF. Answers come only from the document, with quotes."
          >
            <div className="space-y-2">
              <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-blue px-3 py-2 text-xs text-white">
                What was the follow-up period?
              </p>
              <p className="w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-xs text-slate-700">
                12 weeks — <span className="italic">“outcomes were measured at 12 weeks”</span>
              </p>
            </div>
          </Tile>

          <Tile
            className="md:col-span-6"
            icon={ShieldCheck}
            iconTone="bg-blue-50 text-brand-blue"
            title="Secure and accountable by design"
            body="Built to be audited, not just trusted."
            horizontal
          >
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                [Lock, 'Your reviews are yours', 'Every request is checked against its owner.'],
                [KeyRound, 'Prompt-injection guard', 'Abstracts are treated as data, never as instructions.'],
                [ScrollText, 'Full audit trail', 'Every agent and researcher action is logged.'],
                [CheckCircle2, 'Export or erase', 'Download all your data, or delete it, any time.'],
              ].map(([Icon, title, body]) => (
                <li key={title} className="rounded-2xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200">
                  <Icon className="h-5 w-5 text-brand-blue" strokeWidth={2} />
                  <p className="mt-2 text-sm font-bold text-brand-black">{title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-neutral-600">{body}</p>
                </li>
              ))}
            </ul>
          </Tile>
        </div>
      </div>
    </section>
  )
}

function Tile({ className = '', icon: Icon, iconTone, title, body, horizontal, children }) {
  return (
    <article
      className={`group flex flex-col rounded-3xl border border-slate-200/80 bg-white p-6 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover ${className}`}
    >
      <div className={horizontal ? 'sm:flex sm:items-center sm:gap-4' : ''}>
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconTone}`}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
        <div className={horizontal ? 'mt-4 sm:mt-0' : 'mt-4'}>
          <h3 className="text-lg font-bold text-brand-black">{title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">{body}</p>
        </div>
      </div>
      <div className="mt-5 flex-1">{children}</div>
    </article>
  )
}

function Chip({ ok, children }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${
        ok ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200'
      }`}
    >
      {children}
    </span>
  )
}

function Verdict({ who, value, ok }) {
  return (
    <div className="text-center">
      <p className="text-[11px] font-semibold text-neutral-500">{who}</p>
      <span
        className={`mt-1 inline-block rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${
          ok ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'
        }`}
      >
        {value}
      </span>
    </div>
  )
}
