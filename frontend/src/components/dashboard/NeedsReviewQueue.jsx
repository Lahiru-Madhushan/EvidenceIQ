import { useMemo, useState } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Inbox,
} from 'lucide-react'
import { DecisionBadge } from './Badges'
import { REASONS, needsDecision, reviewReasons } from '../../lib/reviewReasons'

const PUBMED_URL = 'https://pubmed.ncbi.nlm.nih.gov'
const PREVIEW = 5

// The coloured edge on each card follows its headline reason, so the queue can be
// scanned by colour before a single title is read.
const ACCENT = {
  disagreed: 'bg-amber-400',
  flagged: 'bg-red-400',
  low: 'bg-orange-400',
  noAbstract: 'bg-slate-400',
  unverified: 'bg-violet-400',
  other: 'bg-neutral-300',
}

/**
 * The researcher's work queue: papers the agents flagged and nobody has decided yet.
 *
 * Built to answer three questions at a glance - how much is left, why is each paper
 * here, and what did the two agents actually say - so the researcher can choose where
 * to start instead of opening papers one by one to find out.
 */
export default function NeedsReviewQueue({ papers, onOpenPaper, onOpenTable, onFocus }) {
  const [reason, setReason] = useState('all')
  const [expanded, setExpanded] = useState(false)

  const { pending, flaggedTotal, counts } = useMemo(() => {
    const flagged = papers.filter((paper) => paper.needs_human_review)
    const waiting = flagged.filter(needsDecision).map((paper) => ({
      paper,
      reasons: reviewReasons(paper),
    }))
    const tally = {}
    for (const { reasons } of waiting) {
      for (const { key } of reasons) tally[key] = (tally[key] ?? 0) + 1
    }
    return { pending: waiting, flaggedTotal: flagged.length, counts: tally }
  }, [papers])

  const resolved = flaggedTotal - pending.length
  const percent = flaggedTotal ? Math.round((resolved / flaggedTotal) * 100) : 0

  const shown =
    reason === 'all' ? pending : pending.filter(({ reasons }) => reasons.some((r) => r.key === reason))
  const visible = expanded ? shown : shown.slice(0, PREVIEW)

  if (pending.length === 0) {
    return (
      <section className="flex items-start gap-4 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50/80 to-white p-5 lg:col-span-2">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
          {flaggedTotal > 0 ? (
            <CheckCircle2 className="h-5 w-5" strokeWidth={2} />
          ) : (
            <Inbox className="h-5 w-5" strokeWidth={1.9} />
          )}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-brand-black">
            {flaggedTotal > 0 ? 'All caught up' : 'Nothing needs your decision'}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-neutral-600">
            {flaggedTotal > 0
              ? `You have decided all ${flaggedTotal} paper(s) the agents flagged. The rest of the review is in the Papers tab.`
              : 'Papers appear here when the agents disagree, are unsure, find suspicious wording, or have no abstract to read.'}
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-amber-100 bg-white lg:col-span-2">
      <div className="bg-gradient-to-r from-amber-50 via-amber-50/50 to-white px-5 pb-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <ClipboardCheck className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold text-brand-black">
                Needs your decision
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold tabular-nums text-white">
                  {pending.length}
                </span>
              </h2>
              <p className="mt-0.5 text-sm text-neutral-600">
                The agents asked a human to look at these. Nothing counts as included until
                you decide.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => (onFocus ? onFocus() : onOpenPaper(shown[0]?.paper ?? pending[0].paper))}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
          >
            Start reviewing
            <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-neutral-600">
              {resolved} of {flaggedTotal} flagged paper(s) decided
            </span>
            <span className="tabular-nums text-neutral-500">{percent}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-amber-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-500 transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by reason">
          <ReasonChip
            active={reason === 'all'}
            onClick={() => setReason('all')}
            label="All"
            count={pending.length}
          />
          {REASONS.filter(({ key }) => counts[key]).map(({ key, label, help }) => (
            <ReasonChip
              key={key}
              active={reason === key}
              onClick={() => setReason(reason === key ? 'all' : key)}
              label={label}
              count={counts[key]}
              title={help}
            />
          ))}
        </div>
      </div>

      <ul className="divide-y divide-neutral-100">
        {visible.map(({ paper, reasons }) => (
          <QueueItem
            key={paper.id}
            paper={paper}
            reasons={reasons}
            onOpen={() => onOpenPaper(paper)}
          />
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 bg-neutral-50/60 px-5 py-3">
        {shown.length > PREVIEW ? (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="text-sm font-medium text-brand-blue hover:underline"
          >
            {expanded ? 'Show fewer' : `Show all ${shown.length}`}
          </button>
        ) : (
          <span className="text-xs text-neutral-500">
            Showing {shown.length} of {pending.length}
          </span>
        )}
        <button
          type="button"
          onClick={onOpenTable}
          className="inline-flex items-center gap-1 text-sm font-medium text-neutral-600 hover:text-brand-blue"
        >
          Open as a table
          <ChevronRight className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </section>
  )
}

function ReasonChip({ active, onClick, label, count, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'bg-brand-black text-white'
          : 'bg-white text-neutral-600 ring-1 ring-inset ring-neutral-200 hover:bg-neutral-50 hover:text-brand-black'
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 tabular-nums ${
          active ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-500'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

function QueueItem({ paper, reasons, onOpen }) {
  const headline = reasons[0]
  const showAgents = paper.draft_decision != null || paper.verified_decision != null

  return (
    <li className="group relative">
      <span
        aria-hidden="true"
        className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${ACCENT[headline.key] ?? ACCENT.other}`}
      />
      <div className="flex flex-col gap-3 px-5 py-4 transition-colors group-hover:bg-neutral-50/70 sm:flex-row sm:items-center">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left focus:outline-none">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-brand-black group-hover:text-brand-blue">
            {paper.title || 'Untitled paper'}
          </p>
          <p className="mt-1 truncate text-xs text-neutral-500">
            PMID {paper.pmid}
            {paper.year ? ` · ${paper.year}` : ''}
            {paper.journal ? ` · ${paper.journal}` : ''}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {reasons.map(({ key, label, help, tone }) => (
              <span
                key={key}
                title={help}
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone}`}
              >
                {label}
              </span>
            ))}
          </div>

          <p className="mt-2 text-xs leading-relaxed text-neutral-500">{headline.help}</p>
        </button>

        <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
          {showAgents ? (
            <div
              className="flex items-center gap-1.5 text-[11px] text-neutral-400"
              aria-label={`Agent 3 said ${paper.draft_decision ?? 'nothing'}, Agent 4 said ${paper.verified_decision ?? 'nothing'}`}
            >
              <span className="font-medium">A3</span>
              <DecisionBadge value={paper.draft_decision} emptyLabel="Pending" />
              <ArrowRight className="h-3 w-3" strokeWidth={2} />
              <span className="font-medium">A4</span>
              <DecisionBadge value={paper.verified_decision} emptyLabel="Pending" />
            </div>
          ) : null}

          <div className="flex items-center gap-1.5">
            <a
              href={`${PUBMED_URL}/${paper.pmid}/`}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open PMID ${paper.pmid} on PubMed`}
              title="Open on PubMed"
              className="rounded-lg p-2 text-neutral-400 transition-colors hover:bg-blue-50 hover:text-brand-blue"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.8} />
            </a>
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm font-medium text-brand-black transition-colors hover:border-brand-blue hover:text-brand-blue"
            >
              Review
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}
