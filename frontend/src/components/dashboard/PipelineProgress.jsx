import { Check, FileText, Lightbulb, Loader2, Search, ShieldCheck, SlidersHorizontal, Activity } from 'lucide-react'

/**
 * The live view of a review being built by the four agents.
 *
 * Everything shown here is measured, not simulated. The ring counts steps that have
 * actually finished; timestamps are recorded when each call starts and returns; the bar
 * on a running step is indeterminate on purpose, because an HTTP request to PubMed or to
 * a model reports no progress and a moving percentage would be an invention. Elapsed
 * time is shown instead - it is real, and it answers the same question ("is this stuck?").
 */

const AGENTS = [
  {
    key: 'criteria',
    name: 'Agent 1 — Criteria Analysis',
    blurb: 'Reading and understanding your inclusion and exclusion criteria.',
    icon: FileText,
    tone: 'bg-emerald-50 text-emerald-600',
  },
  {
    key: 'retrieval',
    name: 'Agent 2 — Literature Retrieval',
    blurb: 'Searching PubMed for relevant studies.',
    icon: Search,
    tone: 'bg-blue-50 text-brand-blue',
  },
  {
    key: 'screening',
    name: 'Agent 3 — Paper Screening',
    blurb: 'Evaluating retrieved papers against your inclusion and exclusion criteria.',
    icon: SlidersHorizontal,
    tone: 'bg-indigo-50 text-indigo-600',
  },
  {
    key: 'verification',
    name: 'Agent 4 — Decision Verification',
    blurb: 'Independently re-checking each screening decision before it reaches you.',
    icon: ShieldCheck,
    tone: 'bg-violet-50 text-violet-600',
  },
]

const STATUS_LABEL = {
  pending: 'Pending',
  running: 'In Progress',
  done: 'Completed',
  blocked: 'Needs you',
  failed: 'Failed',
}

const STATUS_STYLE = {
  pending: 'bg-neutral-100 text-neutral-500',
  running: 'bg-blue-100 text-brand-blue',
  done: 'bg-emerald-100 text-emerald-700',
  blocked: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-700',
}

function clockTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function PipelineProgress({ steps, activity, now }) {
  const completed = AGENTS.filter(({ key }) => steps[key]?.status === 'done').length
  const percent = Math.round((completed / AGENTS.length) * 100)

  return (
    <div className="mt-6 rounded-2xl border border-neutral-100 bg-gradient-to-b from-blue-50/40 to-white p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-4 px-1 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-brand-blue">
            <FileText className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-brand-black">AI Research Pipeline</h2>
            <p className="text-sm text-neutral-500">
              Your research workflow is running. Each paper is screened and verified before
              results are finalized.
            </p>
          </div>
        </div>
        <Ring completed={completed} total={AGENTS.length} percent={percent} />
      </header>

      <ol className="space-y-2.5">
        {AGENTS.map((agent, index) => (
          <StepRow
            key={agent.key}
            agent={agent}
            step={steps[agent.key] ?? { status: 'pending' }}
            isLast={index === AGENTS.length - 1}
            now={now}
          />
        ))}
      </ol>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <LiveActivity activity={activity} running={AGENTS.some(({ key }) => steps[key]?.status === 'running')} />
        <aside className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
          <div className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-blue text-white">
              <Lightbulb className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-black">Did you know?</p>
              <p className="mt-1 text-xs leading-relaxed text-neutral-600">
                Agent 4 never sees Agent 3&apos;s decision. It reaches its own conclusion
                from the abstract first, and the two are compared afterwards — so when
                they agree, two independent passes found the same thing.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Ring({ completed, total, percent }) {
  const radius = 26
  const circumference = 2 * Math.PI * radius
  return (
    <div className="flex shrink-0 items-center gap-3">
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
          <circle cx="32" cy="32" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-neutral-200" />
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - percent / 100)}
            className="text-brand-blue transition-[stroke-dashoffset] duration-500"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="text-sm font-bold tabular-nums text-brand-black">
            {completed}/{total}
          </span>
          <span className="mt-0.5 text-[10px] text-neutral-400">Steps</span>
        </div>
      </div>
      <div className="leading-tight">
        <p className="text-2xl font-bold tabular-nums text-brand-blue">{percent}%</p>
        <p className="text-xs text-neutral-500">Complete</p>
      </div>
    </div>
  )
}

function StepRow({ agent, step, isLast, now }) {
  const { icon: Icon, name, blurb, tone } = agent
  const status = step.status ?? 'pending'
  const isRunning = status === 'running'
  const isDone = status === 'done'

  return (
    <li className="flex gap-3">
      {/* The timeline rail. Purely decorative, so it is hidden from assistive tech. */}
      <div aria-hidden className="flex w-7 shrink-0 flex-col items-center pt-5">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors ${
            isDone
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : isRunning
                ? 'border-brand-blue bg-white text-brand-blue'
                : status === 'blocked' || status === 'failed'
                  ? 'border-amber-400 bg-white text-amber-500'
                  : 'border-neutral-200 bg-white text-neutral-300'
          }`}
        >
          {isDone ? (
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          ) : isRunning ? (
            <span className="h-2 w-2 animate-pulse rounded-full bg-brand-blue" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
          )}
        </span>
        {!isLast ? (
          <span
            className={`mt-1 w-0.5 flex-1 rounded-full ${
              isDone ? 'bg-emerald-200' : 'bg-neutral-200'
            }`}
          />
        ) : null}
      </div>

      <div
        className={`min-w-0 flex-1 rounded-2xl border bg-white p-4 transition-colors ${
          isRunning ? 'border-brand-blue/40 ring-1 ring-brand-blue/10' : 'border-neutral-100'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                isDone || isRunning ? tone : 'bg-neutral-50 text-neutral-300'
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <p
                className={`text-sm font-bold ${
                  isDone || isRunning ? 'text-brand-black' : 'text-neutral-400'
                }`}
              >
                {name}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">{blurb}</p>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <span
              className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[status]}`}
            >
              {STATUS_LABEL[status]}
            </span>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-400">
              {isDone && step.finishedAt ? `Today, ${clockTime(step.finishedAt)}` : null}
              {isRunning && step.startedAt ? (
                <>
                  Started {clockTime(step.startedAt)}
                  <br />
                  {elapsedLabel(step.startedAt, now)}
                </>
              ) : null}
              {status === 'pending' ? step.waitingOn ?? 'Not started' : null}
            </p>
          </div>
        </div>

        {/* Facts the agent actually returned, not a preview of what it might do. */}
        {step.facts?.length ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {step.facts.map((fact) => (
              <span
                key={fact}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
              >
                <Check className="h-3 w-3" strokeWidth={3} />
                {fact}
              </span>
            ))}
          </div>
        ) : null}

        {isRunning ? (
          <div className="mt-3">
            {/* Indeterminate: the request underneath reports no progress, so the bar
                shows that work is happening without claiming to know how much is left. */}
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full w-1/3 animate-pipeline-slide rounded-full bg-brand-blue" />
            </div>
            {step.detail ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
                <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.2} />
                {step.detail}
              </p>
            ) : null}
          </div>
        ) : null}

        {step.note && !isRunning ? (
          <p className="mt-2 text-xs text-neutral-500">{step.note}</p>
        ) : null}
      </div>
    </li>
  )
}

function elapsedLabel(startedAt, now) {
  const seconds = Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s elapsed`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`
}

function LiveActivity({ activity, running }) {
  return (
    <section className="rounded-2xl border border-neutral-100 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-brand-black">
          <Activity className="h-4 w-4 text-brand-blue" strokeWidth={2} />
          Live Activity
        </h3>
        {running ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-brand-blue">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-blue" />
            Processing…
          </span>
        ) : null}
      </div>

      <ul className="mt-3 space-y-2">
        {activity.length === 0 ? (
          <li className="text-xs text-neutral-400">Waiting to start…</li>
        ) : null}
        {activity.map((entry) => (
          <li key={entry.id} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-baseline gap-2">
              <span
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  entry.tone === 'error'
                    ? 'bg-red-500'
                    : entry.tone === 'active'
                      ? 'bg-brand-blue'
                      : 'bg-emerald-500'
                }`}
              />
              <span className="min-w-0 text-neutral-600">{entry.text}</span>
            </span>
            <span className="shrink-0 tabular-nums text-neutral-400">
              {clockTime(entry.at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
