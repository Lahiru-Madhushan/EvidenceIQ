import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock, Hourglass, Sparkles } from 'lucide-react'

// Planning assumptions, shown to the reader under the result - an estimate is only
// honest if the reader can see what it rests on.
const MANUAL_MIN_PER_ABSTRACT = 1 // one reviewer reading one title + abstract
const REVIEWERS = 2 // dual independent screening, the Cochrane norm
const FLAGGED_SHARE = 0.2 // papers the agents send to a human
const SHORTLIST_SHARE = 0.1 // papers both agents include, which you sign off
const SECONDS_PER_DECISION = 35

const STOPS = [100, 250, 500, 1000, 2000, 3500, 5000]

function hours(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = minutes / 60
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`
}

/**
 * "The challenge", made personal: drag to the size of your own search and see what
 * manual dual screening costs against reading only what the agents flag. The point of
 * the page is time, so the page lets the reader measure it.
 */
export default function ChallengeSection() {
  const [step, setStep] = useState(3)
  const papers = STOPS[step]

  const manual = papers * MANUAL_MIN_PER_ABSTRACT * REVIEWERS
  const withIq = (papers * (FLAGGED_SHARE + SHORTLIST_SHARE) * SECONDS_PER_DECISION) / 60
  const saved = manual - withIq
  const days = saved / 60 / 7.5
  const ratio = Math.max(withIq / manual, 0.04)

  return (
    <section className="relative overflow-hidden bg-[#f6f8fb] py-20 sm:py-24">
      <div className="mx-auto max-w-[1100px] px-6 sm:px-10">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-blue">The challenge</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-brand-black sm:text-4xl">
            Screening is where reviews stall
          </h2>
          <p className="mt-4 text-neutral-600">
            A single search can return thousands of papers, and good practice is for two people
            to read every one. See what that costs for a search your size.
          </p>
        </div>

        <div className="mt-12 overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-card">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="border-b border-slate-100 p-6 sm:p-8 lg:border-b-0 lg:border-r">
              <label htmlFor="papers-slider" className="text-sm font-semibold text-brand-black">
                Papers returned by your search
              </label>
              <p className="mt-3 text-5xl font-extrabold tabular-nums tracking-tight text-brand-black">
                {papers.toLocaleString()}
              </p>
              <input
                id="papers-slider"
                type="range"
                min={0}
                max={STOPS.length - 1}
                step={1}
                value={step}
                onChange={(event) => setStep(Number(event.target.value))}
                aria-valuetext={`${papers} papers`}
                className="mt-6 w-full cursor-pointer accent-brand-blue"
              />
              <div className="mt-1 flex justify-between text-[11px] font-medium text-neutral-400">
                <span>100</span>
                <span>5,000</span>
              </div>

              <div className="mt-8 rounded-2xl bg-gradient-to-br from-emerald-50 to-white p-5 ring-1 ring-inset ring-emerald-100">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.1em] text-emerald-700">
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Your time back
                </p>
                <p className="mt-2 text-4xl font-extrabold tabular-nums text-emerald-700">{hours(saved)}</p>
                <p className="mt-1 text-sm text-emerald-800">
                  about <strong>{days < 1 ? 'a day' : `${Math.round(days)} working days`}</strong> of screening
                </p>
              </div>
            </div>

            <div className="p-6 sm:p-8">
              <p className="text-sm font-semibold text-brand-black">Researcher time spent screening</p>

              <Bar
                icon={Hourglass}
                label="Manual dual screening"
                value={hours(manual)}
                width={100}
                tone="bg-gradient-to-r from-slate-300 to-slate-400"
                text="text-slate-700"
              />
              <Bar
                icon={Clock}
                label="With EvidenceIQ"
                value={hours(withIq)}
                width={ratio * 100}
                tone="bg-gradient-to-r from-brand-blue to-hero-cyan"
                text="text-brand-blue"
              />

              <ul className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  ['Agents read', 'every title and abstract, twice'],
                  ['You read', `the ~${Math.round(papers * FLAGGED_SHARE).toLocaleString()} they flag`],
                  ['You sign off', `the ~${Math.round(papers * SHORTLIST_SHARE).toLocaleString()} shortlisted`],
                ].map(([title, body]) => (
                  <li key={title} className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-sm font-bold text-brand-black">{title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-neutral-600">{body}</p>
                  </li>
                ))}
              </ul>

              <Link
                to="/register"
                className="group mt-8 inline-flex items-center gap-2 text-sm font-bold text-brand-blue"
              >
                Try it on your own question
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.4} />
              </Link>
            </div>
          </div>

          <p className="border-t border-slate-100 bg-slate-50/70 px-6 py-3 text-[11px] leading-relaxed text-neutral-500 sm:px-8">
            Estimate, not a guarantee: manual screening at 1 minute per abstract by two
            reviewers; with EvidenceIQ, you check the ~20% of papers the agents flag and the ~10%
            they shortlist at ~35 seconds each. Your numbers depend on your question.
          </p>
        </div>
      </div>
    </section>
  )
}

function Bar({ icon: Icon, label, value, width, tone, text }) {
  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Icon className="h-4 w-4 text-neutral-400" strokeWidth={2} />
          {label}
        </span>
        <span className={`text-lg font-extrabold tabular-nums ${text}`}>{value}</span>
      </div>
      <div className="mt-2 h-4 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone} transition-[width] duration-500 ease-out`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}
