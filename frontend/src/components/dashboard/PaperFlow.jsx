import {
  AlertTriangle,
  ArrowRight,
  Check,
  Loader2,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react'

import { PHASE } from '../../lib/harvest'

/**
 * The live view of one paper moving through Agents 3 and 4.
 *
 * Everything here is measured. The pipeline runs a paper through screening and then
 * verification before fetching the next, so at any moment exactly one agent is working
 * on exactly one paper - and that is what this shows, rather than a phase label that
 * would be true of a page of twenty papers at once.
 *
 * The counter is the part a researcher actually watches. It counts papers ACCEPTED BY
 * BOTH agents against the target they asked for, because that is what the run is
 * chasing and what makes it stop.
 */

const STAGES = [
  {
    phase: PHASE.RETRIEVING,
    label: 'Agent 2',
    name: 'Retrieving',
    icon: Search,
    active: 'bg-blue-500 text-white ring-blue-200',
    idle: 'bg-blue-50 text-brand-blue',
  },
  {
    phase: PHASE.SCREENING,
    label: 'Agent 3',
    name: 'Screening',
    icon: SlidersHorizontal,
    active: 'bg-indigo-500 text-white ring-indigo-200',
    idle: 'bg-indigo-50 text-indigo-600',
  },
  {
    phase: PHASE.VERIFYING,
    label: 'Agent 4',
    name: 'Verifying',
    icon: ShieldCheck,
    active: 'bg-violet-500 text-white ring-violet-200',
    idle: 'bg-violet-50 text-violet-600',
  },
]

export default function PaperFlow({ live, feed, onStop, stopping }) {
  if (!live) return null

  const {
    phase,
    current,
    confirmed,
    target,
    screened,
    verified,
    failed,
    fetched,
    totalFound,
    queued,
    budget,
  } = live

  const percent = target > 0 ? Math.min(100, Math.round((confirmed / target) * 100)) : 0
  const runningPhase = phase && phase !== PHASE.IDLE ? phase : null

  return (
    <section className="mt-4 rounded-2xl border border-slate-200/80 bg-white shadow-card p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-brand-black">Papers in progress</h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            Each paper goes through Agent 3, then Agent 4, before the next one starts.
            The run stops the moment {target} paper(s) have been accepted by both.
          </p>
        </div>
        {/* Gone once the run has stopped: `stopped` is set only on the result the loop
            returns, so its presence is what distinguishes a finished run from a live
            one that happens to be between papers. */}
        {onStop && !live.stopped ? (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            className="shrink-0 rounded-lg border border-neutral-200 px-3.5 py-2 text-xs font-semibold text-brand-black transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:text-neutral-400"
          >
            {stopping ? 'Stopping…' : 'Stop after this paper'}
          </button>
        ) : null}
      </header>

      {/* --- The target counter, and what it cost to get there --------------------- */}
      <div className="mt-4 rounded-xl border border-neutral-100 bg-neutral-50/70 p-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-neutral-600">
            <strong className="text-lg font-bold tabular-nums text-brand-black">
              {confirmed}
            </strong>
            <span className="text-neutral-400"> / {target}</span>{' '}
            accepted by both agents
          </p>
          <p className="text-xs tabular-nums text-neutral-500">
            {screened} screened · {verified} verified
            {failed > 0 ? ` · ${failed} failed` : ''} · {fetched} retrieved
            {totalFound > 0 ? ` of ${totalFound}` : ''}
            {queued > 0 ? ` · ${queued} queued` : ''}
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200">
          <div
            className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
        {/* The screening budget is the other end this run can finish at, so it is shown
            rather than only appearing in the sentence that explains the stop. */}
        <p className="mt-1.5 text-[11px] text-neutral-400">
          Screening budget: {screened} of {budget} papers used
        </p>
      </div>

      {/* --- Which agent is working, right now ------------------------------------ */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {STAGES.map((stage, index) => {
          const isActive = runningPhase === stage.phase
          const Icon = stage.icon
          return (
            <div key={stage.phase} className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                  isActive ? `${stage.active} ring-4` : stage.idle
                } ${isActive ? '' : 'opacity-60'}`}
              >
                {isActive ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
                ) : (
                  <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
                )}
                {stage.label}
                <span className="font-normal">{stage.name}</span>
              </span>
              {index < STAGES.length - 1 ? (
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-neutral-300" strokeWidth={2} />
              ) : null}
            </div>
          )
        })}
      </div>

      {/* --- The paper currently in flight ---------------------------------------- */}
      {current ? (
        <div className="mt-3 rounded-xl border border-brand-blue/30 bg-blue-50/40 p-3.5 ring-1 ring-brand-blue/10">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-blue text-[10px] font-bold text-white">
              {current.rank ?? '·'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-brand-black">
                {current.title || `PMID ${current.pmid}`}
              </p>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                PMID {current.pmid}
                {current.year ? ` · ${current.year}` : ''}
                {current.journal ? ` · ${current.journal}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <DecisionChip
                  agent="Agent 3"
                  decision={current.draft?.decision}
                  pending={runningPhase === PHASE.SCREENING}
                />
                <DecisionChip
                  agent="Agent 4"
                  decision={current.verification?.verified_decision}
                  pending={runningPhase === PHASE.VERIFYING}
                />
                {current.error ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                    <AlertTriangle className="h-3 w-3" strokeWidth={2.4} />
                    {current.error}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* --- What the two agents concluded, newest first -------------------------- */}
      {feed.length > 0 ? (
        <ol className="mt-3 space-y-1.5">
          {feed.map((entry) => (
            <li
              key={entry.pmid}
              className="flex items-start justify-between gap-3 rounded-lg border border-neutral-100 px-3 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-neutral-700">
                  {entry.title || `PMID ${entry.pmid}`}
                </span>
                <span className="text-[11px] text-neutral-400">PMID {entry.pmid}</span>
              </span>
              <OutcomeBadge entry={entry} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

/**
 * One agent's verdict on the paper in flight.
 *
 * Shown separately per agent rather than as a single combined result, because the whole
 * point of the second pass is that the two are reached independently - and while Agent 4
 * is still thinking, Agent 3's answer is already known and worth showing.
 */
function DecisionChip({ agent, decision, pending }) {
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
        {agent} deciding…
      </span>
    )
  }
  if (!decision) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-neutral-50 px-2 py-0.5 text-[11px] font-medium text-neutral-400">
        {agent} waiting
      </span>
    )
  }
  const included = decision === 'INCLUDE'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        included ? 'bg-emerald-50 text-emerald-700' : 'bg-neutral-100 text-neutral-600'
      }`}
    >
      {included ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : (
        <X className="h-3 w-3" strokeWidth={3} />
      )}
      {agent} {included ? 'Include' : 'Exclude'}
    </span>
  )
}

/**
 * The joint outcome, using the same four buckets the rest of the app uses.
 *
 * `accepted` is deliberately both agents saying INCLUDE, not `agreement` - the agents
 * also agree when they both say EXCLUDE, and that is not a paper the researcher asked
 * for. See lib/outcomes.js.
 */
function OutcomeBadge({ entry }) {
  if (entry.error) {
    return (
      <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
        Failed
      </span>
    )
  }
  if (!entry.verification) {
    return (
      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        Unverified
      </span>
    )
  }
  const draft = entry.draft?.decision
  const verified = entry.verification?.verified_decision
  if (draft !== verified) {
    return (
      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
        Disagreed
      </span>
    )
  }
  if (verified === 'INCLUDE') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        <Check className="h-3 w-3" strokeWidth={3} />
        Accepted
      </span>
    )
  }
  return (
    <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
      Rejected
    </span>
  )
}
