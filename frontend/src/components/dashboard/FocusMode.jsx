import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  PartyPopper,
  ShieldAlert,
  StickyNote,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { DecisionBadge } from './Badges'
import { reviewReasons } from '../../lib/reviewReasons'

const PUBMED_URL = 'https://pubmed.ncbi.nlm.nih.gov'

const STATUS_MARK = {
  PASS: 'bg-emerald-100/90 text-emerald-950 decoration-emerald-500',
  FAIL: 'bg-red-100/90 text-red-950 decoration-red-500',
  UNCLEAR: 'bg-amber-100/80 text-amber-950 decoration-amber-500',
}

/**
 * Splits an abstract into plain text and the spans the Verification Agent quoted as
 * evidence, so the quotes can be highlighted where they actually occur. Only exact
 * (case-insensitive) matches are marked: a highlight is a claim that these words are in
 * the abstract, and a fuzzy match could mark words the agent never quoted.
 */
function highlightEvidence(abstract, checks) {
  const text = abstract ?? ''
  const lower = text.toLowerCase()
  const ranges = []
  for (const check of checks ?? []) {
    const quote = (check.evidence ?? '').trim()
    if (quote.length < 6) continue
    const at = lower.indexOf(quote.toLowerCase())
    if (at < 0) continue
    const end = at + quote.length
    if (ranges.some((r) => at < r.end && end > r.start)) continue
    ranges.push({ start: at, end, status: check.status, criterion: check.criterion })
  }
  ranges.sort((a, b) => a.start - b.start)

  const parts = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) parts.push({ text: text.slice(cursor, range.start) })
    parts.push({ text: text.slice(range.start, range.end), ...range })
    cursor = range.end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return { parts, matched: ranges.length }
}

/**
 * Focus mode: the flagged papers, one at a time, full screen.
 *
 * Screening is a run of near-identical small decisions, and the table-plus-panel layout
 * spends most of the screen on things that are not the decision. This puts the paper,
 * the reasons it was flagged and the agents' evidence in one column, with the two
 * buttons and the keyboard doing the rest. The queue is fixed when the session opens,
 * so deciding a paper does not reshuffle what comes next.
 */
export default function FocusMode({ papers, queueIds, review, onDecide, onClose }) {
  const [ids] = useState(() => queueIds)
  const [index, setIndex] = useState(0)
  const [decisions, setDecisions] = useState({})
  const [note, setNote] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  const [startedAt] = useState(() => Date.now())
  const [elapsed, setElapsed] = useState(0)

  const byId = useMemo(() => Object.fromEntries(papers.map((p) => [p.id, p])), [papers])
  const done = Object.keys(decisions).length
  const finished = ids.length > 0 && done >= ids.length
  const paper = byId[ids[index]]

  function go(step) {
    setNote('')
    setNoteOpen(false)
    setIndex((i) => Math.min(Math.max(i + step, 0), ids.length - 1))
  }

  function decide(status) {
    if (!paper) return
    onDecide(paper.id, status, note.trim() || null)
    const next = { ...decisions, [paper.id]: status }
    setDecisions(next)
    setNote('')
    setNoteOpen(false)
    // On to the next paper not yet decided this session, wrapping round once.
    const order = [...ids.slice(index + 1), ...ids.slice(0, index)]
    const target = order.find((id) => !next[id])
    if (target) setTimeout(() => setIndex(ids.indexOf(target)), 180)
    else setElapsed(Math.round((Date.now() - startedAt) / 1000))
  }

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    function onKey(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'Escape') {
        if (noteOpen) setNoteOpen(false)
        else onClose()
        return
      }
      if (event.target.closest?.('input, textarea, select')) return
      if (finished) return
      const key = event.key.toLowerCase()
      const actions = {
        a: () => decide('approved'),
        o: () => decide('overridden'),
        j: () => go(1),
        arrowright: () => go(1),
        k: () => go(-1),
        arrowleft: () => go(-1),
        n: () => setNoteOpen(true),
      }
      if (actions[key]) {
        event.preventDefault()
        actions[key]()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const percent = ids.length ? Math.round((done / ids.length) * 100) : 0

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#f4f7fb]" role="dialog" aria-modal="true" aria-label="Focus mode">
      {/* Header: where you are, and the way out. */}
      <header className="relative shrink-0 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-amber-500/30">
            <Zap className="h-[18px] w-[18px] fill-white" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-brand-black">Focus mode</p>
            <p className="truncate text-xs text-neutral-500">{review?.research_question}</p>
          </div>
          <p className="hidden text-sm font-semibold tabular-nums text-brand-black sm:block">
            {done} <span className="font-normal text-neutral-500">of {ids.length} decided</span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-brand-black transition-colors hover:bg-slate-50"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
            <span className="hidden sm:inline">Exit</span>
            <kbd className="hidden rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500 sm:inline">Esc</kbd>
          </button>
        </div>
        <div className="h-1 bg-slate-100">
          <div
            className="h-full bg-gradient-to-r from-brand-blue via-violet-500 to-emerald-500 transition-[width] duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>
      </header>

      {finished ? (
        <Celebration
          decisions={decisions}
          seconds={elapsed}
          onClose={onClose}
        />
      ) : paper ? (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div key={paper.id} className="animate-fade-up mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
              <PaperCard paper={paper} position={index + 1} total={ids.length} decided={decisions[paper.id]} />
            </div>
          </main>

          {/* Action bar: the decision, always in the same place. */}
          <footer className="shrink-0 border-t border-slate-200/80 bg-white/95 backdrop-blur">
            <div className="mx-auto max-w-3xl px-4 py-3 sm:px-6">
              {noteOpen ? (
                <div className="mb-3 flex items-start gap-2">
                  <StickyNote className="mt-2.5 h-4 w-4 shrink-0 text-brand-blue" strokeWidth={2} />
                  <textarea
                    autoFocus
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={2}
                    placeholder="Why this decision? Saved with Approve or Override."
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/25"
                  />
                </div>
              ) : null}
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => go(-1)}
                  disabled={index === 0}
                  aria-label="Previous paper"
                  className="hidden rounded-xl border border-slate-200 bg-white p-3 text-slate-600 sm:block transition-colors hover:bg-slate-50 disabled:opacity-40"
                >
                  <ArrowLeft className="h-5 w-5" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => setNoteOpen((open) => !open)}
                  aria-label="Add a note"
                  className={`rounded-xl border p-2.5 transition-colors sm:p-3 ${
                    noteOpen || note
                      ? 'border-brand-blue/40 bg-blue-50 text-brand-blue'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <StickyNote className="h-5 w-5" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => decide('overridden')}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-red-200 bg-white px-2 py-3 sm:px-4 text-sm font-bold text-red-700 transition-all hover:-translate-y-0.5 hover:border-red-300 hover:bg-red-50"
                >
                  <XCircle className="h-5 w-5" strokeWidth={2.2} />
                  Exclude
                  <kbd className="hidden rounded bg-red-100 px-1.5 text-[11px] sm:inline">O</kbd>
                </button>
                <button
                  type="button"
                  onClick={() => decide('approved')}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-2 py-3 sm:px-4 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:brightness-105"
                >
                  <CheckCircle2 className="h-5 w-5" strokeWidth={2.2} />
                  Include
                  <kbd className="hidden rounded bg-white/25 px-1.5 text-[11px] sm:inline">A</kbd>
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  disabled={index === ids.length - 1}
                  aria-label="Skip to next paper"
                  className="rounded-xl border border-slate-200 bg-white p-2.5 sm:p-3 text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
                >
                  <ArrowRight className="h-5 w-5" strokeWidth={2} />
                </button>
              </div>
              <p className="mt-2 hidden text-center text-[11px] text-neutral-500 sm:block">
                <b>A</b> include · <b>O</b> exclude · <b>J</b>/<b>K</b> or arrows to move · <b>N</b> note ·{' '}
                <b>Esc</b> exit — every decision is saved as you go
              </p>
            </div>
          </footer>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-neutral-500">
          Nothing in the queue.
        </div>
      )}
    </div>,
    document.body
  )
}

function PaperCard({ paper, position, total, decided }) {
  const reasons = reviewReasons(paper)
  const { parts, matched } = highlightEvidence(paper.abstract, paper.checks)
  const checks = paper.checks ?? []

  return (
    <article className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-card">
      <div className="border-b border-slate-100 bg-gradient-to-br from-amber-50/80 via-white to-white p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-brand-black px-2.5 py-1 text-[11px] font-bold tabular-nums text-white">
            {position} / {total}
          </span>
          {reasons.map(({ key, label, tone, help }) => (
            <span key={key} title={help} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${tone}`}>
              {label}
            </span>
          ))}
          {decided ? (
            <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
              decided === 'approved' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
            }`}>
              <Check className="h-3 w-3" strokeWidth={3} />
              {decided === 'approved' ? 'Included' : 'Excluded'}
            </span>
          ) : null}
        </div>

        <h2 className="mt-4 text-xl font-bold leading-snug tracking-tight text-brand-black sm:text-2xl">
          {paper.title}
        </h2>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-neutral-500">
          {paper.journal ? <span className="font-medium text-slate-700">{paper.journal}</span> : null}
          {paper.year ? <span>· {paper.year}</span> : null}
          <a
            href={`${PUBMED_URL}/${paper.pmid}/`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-brand-blue hover:underline"
          >
            · PMID {paper.pmid}
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
          </a>
        </p>

        <p className="mt-4 rounded-xl bg-white/80 px-3.5 py-2.5 text-sm leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200">
          <ShieldAlert className="mr-1.5 inline h-4 w-4 -translate-y-px" strokeWidth={2} />
          {reasons[0].help}
        </p>
      </div>

      <div className="grid gap-px bg-slate-100 sm:grid-cols-3">
        <Verdict label="Agent 3 · Screening" value={paper.draft_decision} sub={paper.draft_reason} />
        <Verdict label="Agent 4 · Verification" value={paper.verified_decision} sub={paper.verification_note} />
        <div className="bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">Confidence</p>
          <p className={`mt-1.5 text-lg font-bold ${
            paper.confidence === 'LOW' ? 'text-red-600' : paper.confidence === 'MEDIUM' ? 'text-amber-600' : paper.confidence === 'HIGH' ? 'text-emerald-600' : 'text-neutral-400'
          }`}>
            {paper.confidence ?? 'Pending'}
          </p>
          <p className="mt-0.5 text-xs text-neutral-500">
            {checks.filter((c) => c.status === 'UNCLEAR').length} criteria unresolved
          </p>
        </div>
      </div>

      <section className="p-5 sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">Abstract</h3>
          {matched ? (
            <p className="flex items-center gap-2 text-[11px] text-neutral-500">
              Agent 4&apos;s quoted evidence is highlighted
              <span className="h-2.5 w-2.5 rounded-sm bg-emerald-200" /> pass
              <span className="h-2.5 w-2.5 rounded-sm bg-red-200" /> fail
            </p>
          ) : null}
        </div>
        {paper.abstract && !/^abstract not available\.?$/i.test(paper.abstract.trim()) ? (
          <p className="mt-3 text-[15px] leading-[1.8] text-slate-700">
            {parts.map((part, i) =>
              part.status ? (
                <mark
                  key={i}
                  title={part.criterion}
                  className={`rounded px-0.5 underline decoration-2 underline-offset-4 ${STATUS_MARK[part.status] ?? STATUS_MARK.UNCLEAR}`}
                >
                  {part.text}
                </mark>
              ) : (
                <span key={i}>{part.text}</span>
              )
            )}
          </p>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-neutral-500">
            PubMed has no abstract for this paper. Open it on PubMed to judge from the full
            record, or exclude it if the title alone rules it out.
          </p>
        )}
      </section>

      {checks.length ? (
        <section className="border-t border-slate-100 p-5 sm:p-7">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">
            Criteria, as Agent 4 checked them
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {checks.map((check) => (
              <li key={check.criterion} className="flex items-start gap-2.5 rounded-xl bg-slate-50 p-3">
                {check.status === 'PASS' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.2} />
                ) : check.status === 'FAIL' ? (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" strokeWidth={2.2} />
                ) : (
                  <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" strokeWidth={2.2} />
                )}
                <span className="text-sm leading-snug text-slate-700">{check.criterion}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}

function Verdict({ label, value, sub }) {
  return (
    <div className="bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">{label}</p>
      <div className="mt-1.5">
        <DecisionBadge value={value} emptyLabel="Pending" />
      </div>
      {sub ? <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-neutral-500">{sub}</p> : null}
    </div>
  )
}

const CONFETTI_COLORS = ['#2563eb', '#38a8ff', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444']

// A fixed scatter rather than Math.random: the same confetti on every render, and no
// impure call during render. Good enough to look random at a glance.
const scatter = (i, k) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return x - Math.floor(x)
}
const PIECES = Array.from({ length: 90 }, (_, i) => ({
  left: scatter(i, 1) * 100,
  delay: scatter(i, 2) * 0.8,
  duration: 2.4 + scatter(i, 3) * 1.6,
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  size: 6 + scatter(i, 4) * 6,
  round: scatter(i, 5) > 0.6,
}))

function Celebration({ decisions, seconds, onClose }) {
  const values = Object.values(decisions)
  const included = values.filter((v) => v === 'approved').length
  const excluded = values.length - included
  const pieces = PIECES
  const time = seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden p-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {pieces.map((piece, i) => (
          <span
            key={i}
            className="animate-confetti absolute top-0 block"
            style={{
              left: `${piece.left}%`,
              width: piece.size,
              height: piece.round ? piece.size : piece.size * 0.45,
              background: piece.color,
              borderRadius: piece.round ? '9999px' : '2px',
              animationDelay: `${piece.delay}s`,
              animationDuration: `${piece.duration}s`,
            }}
          />
        ))}
      </div>

      <div className="animate-scale-in relative w-full max-w-md rounded-3xl border border-slate-200/80 bg-white p-8 text-center shadow-card-hover">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/30">
          <PartyPopper className="h-8 w-8" strokeWidth={2} />
        </span>
        <h2 className="mt-5 text-2xl font-bold tracking-tight text-brand-black">Queue cleared!</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          You decided every flagged paper in this session. Each decision is saved and in the
          paper&apos;s audit trail.
        </p>
        <div className="mt-6 grid grid-cols-3 gap-2">
          <Figure value={included} label="Included" tone="text-emerald-600" />
          <Figure value={excluded} label="Excluded" tone="text-red-600" />
          <Figure value={time} label="Time" tone="text-brand-blue" />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-blue to-blue-500 px-5 py-3 text-sm font-bold text-white shadow-glow transition-all hover:brightness-110"
        >
          Back to the review
          <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
        </button>
      </div>
    </div>
  )
}

function Figure({ value, label, tone }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-2 py-3">
      <p className={`text-xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-medium text-neutral-500">{label}</p>
    </div>
  )
}
