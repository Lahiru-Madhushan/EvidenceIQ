import { useEffect, useState } from 'react'
import { Bot, Loader2, ShieldCheck, UserRound } from 'lucide-react'

import { CheckStatusBadge, DecisionBadge, SourceTag } from './Badges'
import { getPaperEvents } from '../../lib/reviewsApi'

/**
 * One paper's full audit history: every agent run and every human decision, newest
 * first.
 *
 * This reads `paper_events`, not the `papers` columns the Details tab shows. The
 * difference is the whole point of the table: `papers` holds only the current state, so
 * a re-run of Agent 4 overwrites the previous verdict and the evidence behind it. The
 * events keep both, which is what makes a superseded decision inspectable instead of
 * merely gone.
 *
 * The rows are append-only in the database (SELECT and INSERT policies, no UPDATE or
 * DELETE), so nothing here offers to edit or remove one.
 */
export default function HistoryTab({ paper }) {
  const [events, setEvents] = useState(null)
  const [error, setError] = useState(null)

  // No reset of state here: PaperPanel mounts this with key={paper.id}, so selecting a
  // different paper remounts it and the initial state is already the right one.
  useEffect(() => {
    let cancelled = false

    getPaperEvents(paper.id)
      .then((rows) => {
        if (!cancelled) setEvents(rows)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message)
      })

    return () => {
      cancelled = true
    }
  }, [paper.id])

  if (error) {
    return (
      <p className="m-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
        {error}
      </p>
    )
  }

  if (events === null) {
    return (
      <p className="flex items-center justify-center gap-2 p-8 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        Loading this paper&rsquo;s history&hellip;
      </p>
    )
  }

  if (events.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-neutral-500">
          Nothing has happened to this paper yet.
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">
          Each agent run and each decision you make is recorded here, permanently.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4">
      <p className="mb-3 text-[11px] leading-relaxed text-neutral-500">
        Every agent run and every decision, newest first. These entries cannot be edited
        or deleted.
      </p>

      <ol className="space-y-0">
        {events.map((event, index) => (
          <Entry key={event.id} event={event} last={index === events.length - 1} />
        ))}
      </ol>
    </div>
  )
}

// Who did it, in the researcher's vocabulary rather than the database's.
const ACTORS = {
  agent_3: { label: 'Screening Agent', sub: 'Agent 3', icon: Bot, tone: 'text-brand-blue bg-blue-50' },
  agent_4: { label: 'Verification Agent', sub: 'Agent 4', icon: ShieldCheck, tone: 'text-violet-700 bg-violet-50' },
  researcher: { label: 'You', sub: null, icon: UserRound, tone: 'text-emerald-700 bg-emerald-50' },
}

const ACTIONS = {
  screened: 'screened this paper',
  verified: 'verified the screening',
  approved: 'approved this paper',
  overridden: 'excluded this paper',
}

function Entry({ event, last }) {
  const actor = ACTORS[event.actor] ?? {
    label: event.actor,
    sub: null,
    icon: Bot,
    tone: 'text-neutral-600 bg-neutral-100',
  }
  const Icon = actor.icon

  return (
    <li className="flex gap-3">
      {/* The rail: an icon per entry, joined by a line that stops at the last one. */}
      <div className="flex shrink-0 flex-col items-center">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${actor.tone}`}>
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        {!last ? <span className="w-px flex-1 bg-neutral-200" /> : null}
      </div>

      <div className={`min-w-0 flex-1 ${last ? 'pb-1' : 'pb-4'}`}>
        <p className="text-sm text-brand-black">
          <span className="font-semibold">{actor.label}</span>
          {actor.sub ? (
            <span className="ml-1.5 text-[11px] text-neutral-400">{actor.sub}</span>
          ) : null}{' '}
          <span className="text-neutral-600">{ACTIONS[event.action] ?? event.action}</span>
        </p>
        <p className="mt-0.5 text-[11px] text-neutral-400">{when(event.created_at)}</p>

        <Detail event={event} />
      </div>
    </li>
  )
}

/** An absolute timestamp - an audit trail is read long after "2 hours ago" means anything. */
function when(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value ?? '')
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/**
 * What the event actually recorded.
 *
 * Each actor writes a different `detail` shape, so each is rendered on its own terms
 * rather than dumped as JSON. Every field is optional: these rows may have been written
 * by an older version of the pipeline, and an audit log must still render what it has.
 */
function Detail({ event }) {
  const detail = event.detail
  if (!detail || typeof detail !== 'object') return null

  // `note` is the key the writer actually uses (reviewsApi.recordDecision and
  // pipeline.record_verification both call it that); the longer names are accepted
  // too so a row written by an earlier version still renders.
  const note = detail.note ?? detail.researcher_note ?? detail.verification_note

  if (event.actor === 'researcher') {
    return (
      <div className="mt-2 space-y-2">
        {/* What the agents had concluded at the moment of the decision - an override
            is only meaningful next to the recommendation it overrode. */}
        {detail.verified_decision ? (
          <p className="text-[11px] text-neutral-500">
            Agents recommended <span className="font-semibold">{detail.verified_decision}</span>
            {detail.confidence ? ` at ${detail.confidence} confidence` : ''}.
          </p>
        ) : null}

        {note ? (
          <p className="whitespace-pre-wrap rounded-lg bg-neutral-50 p-2.5 text-xs leading-relaxed text-neutral-700">
            {note}
          </p>
        ) : (
          <p className="text-xs italic text-neutral-400">No note given.</p>
        )}
      </div>
    )
  }

  if (event.action === 'screened') {
    return (
      <div className="mt-2 space-y-2">
        {detail.decision ? <DecisionBadge value={detail.decision} /> : null}
        {detail.reason ? (
          <p className="text-xs leading-relaxed text-neutral-600">{detail.reason}</p>
        ) : null}
      </div>
    )
  }

  if (event.action === 'verified') {
    return (
      <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {detail.verified_decision ? <DecisionBadge value={detail.verified_decision} /> : null}
          {detail.confidence ? (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-neutral-600">
              {detail.confidence}
            </span>
          ) : null}
          {detail.agreement === false ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              Disagreed with Agent 3
            </span>
          ) : null}
        </div>

        {note ? (
          <p className="text-xs leading-relaxed text-neutral-600">{note}</p>
        ) : null}

        {/* The snapshot that makes this worth keeping: `papers.checks` holds only the
            latest run, so this is the only surviving record of what a superseded
            decision was actually based on. */}
        {Array.isArray(detail.checks) && detail.checks.length > 0 ? (
          <ul className="space-y-1.5 rounded-lg border border-neutral-100 bg-neutral-50/70 p-2.5">
            {detail.checks.map((check, index) => (
              <li key={index}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-neutral-700">
                    {check?.criterion}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <SourceTag value={check?.source} />
                    <CheckStatusBadge value={check?.status} />
                  </span>
                </div>
                {check?.evidence ? (
                  <p className="mt-1 border-l-2 border-neutral-200 pl-2 text-[11px] italic leading-relaxed text-neutral-500">
                    &ldquo;{check.evidence}&rdquo;
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }

  return null
}
