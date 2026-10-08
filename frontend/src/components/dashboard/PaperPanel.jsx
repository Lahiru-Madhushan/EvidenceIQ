import { useEffect, useState } from 'react'
import {
  ArrowRight,
  FileText,
  ExternalLink,
  Check,
  CheckCircle2,
  ClipboardCheck,
  X,
  ShieldAlert,
  StickyNote,
} from 'lucide-react'
import { needsDecision, reviewReasons } from '../../lib/reviewReasons'
import { CheckStatusBadge, ConfidenceBadge, DecisionBadge, SourceTag } from './Badges'
import ChatTab from './ChatTab'
import HistoryTab from './HistoryTab'

const PUBMED_URL = 'https://pubmed.ncbi.nlm.nih.gov'

/**
 * `queue` ({ remaining, position, next }) drives the review-queue bar: how many flagged
 * papers are left and a Next button, so the researcher can work through them from here.
 * `onClose` deselects the paper; below the xl breakpoint the panel is a slide-over drawer
 * and needs a way out, since there is no room for it beside the table.
 */
export default function PaperPanel({ paper, tab, onTabChange, onDecide, onClose, queue }) {
  if (!paper) {
    return (
      <aside className="hidden w-[380px] shrink-0 border-l border-neutral-100 bg-white xl:block">
        <div className="flex h-full items-center justify-center p-8 text-center">
          <div>
            <FileText className="mx-auto mb-3 h-8 w-8 text-neutral-300" strokeWidth={1.5} />
            <p className="text-sm text-neutral-500">
              Select a paper to see its verification details.
            </p>
          </div>
        </div>
      </aside>
    )
  }

  const tabs = [
    { key: 'details', label: 'Details' },
    { key: 'chat', label: 'Quick Chat' },
    { key: 'history', label: 'History' },
  ]

  return (
    <>
    {/* Backdrop for the drawer on smaller screens; the side-by-side layout needs none. */}
    <div
      aria-hidden="true"
      onClick={onClose}
      className="fixed inset-0 z-30 bg-black/30 xl:hidden"
    />
    <aside
      aria-label="Paper details"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[420px] shrink-0 flex-col border-l border-neutral-100 bg-white shadow-2xl xl:static xl:z-auto xl:w-[380px] xl:max-w-none xl:shadow-none"
    >
      {queue && queue.remaining > 0 ? <QueueBar paper={paper} queue={queue} /> : null}

      <div className="flex shrink-0 items-stretch border-b border-neutral-100">
        {tabs.map(({ key, label, soon }) => (
          <button
            key={key}
            type="button"
            disabled={soon}
            onClick={() => onTabChange(key)}
            title={soon ? `${label} is not available yet` : undefined}
            className={`flex-1 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              soon
                ? 'cursor-not-allowed border-transparent text-neutral-300'
                : tab === key
                  ? 'border-brand-blue text-brand-blue'
                  : 'border-transparent text-neutral-500 hover:text-brand-black'
            }`}
          >
            {label}
            {soon ? (
              <span className="ml-1.5 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                Soon
              </span>
            ) : null}
          </button>
        ))}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close paper details"
            title="Close"
            className="shrink-0 px-3 text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-brand-black"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'chat' ? (
          /* Keyed by paper: opening a different paper must start a new thread rather
             than carry the previous paper's questions into it. */
          <ChatTab key={paper.id} paper={paper} />
        ) : tab === 'history' ? (
          <HistoryTab key={paper.id} paper={paper} />
        ) : (
          <DetailsTab paper={paper} onDecide={onDecide} onNext={queue?.next} onPrev={queue?.prev} onClose={onClose} />
        )}
      </div>
    </aside>
    </>
  )
}

/** "Review queue · 2 of 7 · Next" - always visible while flagged papers remain. */
function QueueBar({ paper, queue }) {
  const inQueue = queue.position != null
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-100 bg-amber-50/80 px-4 py-2">
      <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-amber-900">
        <ClipboardCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span className="truncate">
          {inQueue
            ? `Review queue · ${queue.position} of ${queue.remaining}`
            : paper.needs_human_review && paper.researcher_status != null
              ? `Decided · ${queue.remaining} still need you`
              : `${queue.remaining} paper(s) need your decision`}
        </span>
      </p>
      {queue.next ? (
        <button
          type="button"
          onClick={queue.next}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
        >
          {inQueue ? 'Next' : 'Go to next'}
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
        </button>
      ) : null}
    </div>
  )
}

/** Why the agents handed this paper to a human, in words the researcher can act on. */
function ReasonsCallout({ paper }) {
  const reasons = reviewReasons(paper)
  return (
    <section className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
        <ClipboardCheck className="h-3.5 w-3.5" strokeWidth={2} />
        Why this needs you
      </p>
      <ul className="mt-2 space-y-2">
        {reasons.map(({ key, label, help, tone }) => (
          <li key={key} className="flex items-start gap-2">
            <span
              className={`mt-px inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone}`}
            >
              {label}
            </span>
            <span className="text-xs leading-relaxed text-neutral-700">{help}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function PaperHeader({ paper }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-brand-blue">
        <FileText className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold leading-snug text-brand-black">{paper.title}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-neutral-400">
          PMID: {paper.pmid} &middot; {paper.year}
          <a
            href={`${PUBMED_URL}/${paper.pmid}/`}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on PubMed"
            className="text-brand-blue hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
          </a>
        </p>
      </div>
    </div>
  )
}

function DetailsTab({ paper, onDecide, onNext, onPrev, onClose }) {
  const decided = paper.researcher_status != null

  // Reset whenever a different paper is selected, otherwise a note typed for one paper
  // would still be in the box when the next is opened and get saved against it.
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  useEffect(() => {
    setNote('')
    setShowNote(false)
  }, [paper.id])

  function decide(status) {
    onDecide(paper.id, status, note.trim() || null)
    setNote('')
    setShowNote(false)
  }

  // Keyboard screening: A approve, O override, J/K next/previous flagged paper, N note,
  // Esc close. Ignored while typing, so a note can contain any letter. Lives here rather
  // than in the page so a shortcut decision carries the note exactly as the buttons do.
  useEffect(() => {
    function onKey(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      // Focus mode, the search palette and dialogs own the keyboard while they are open.
      if (document.querySelector('[aria-modal="true"]')) return
      const key = event.key.toLowerCase()
      const actions = {
        a: () => decide('approved'),
        o: () => decide('overridden'),
        j: onNext,
        k: onPrev,
        n: () => setShowNote(true),
        escape: onClose,
      }
      const action = actions[key]
      if (!action) return
      event.preventDefault()
      action()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  return (
    <div className="space-y-5 p-4">
      <PaperHeader paper={paper} />

      {needsDecision(paper) ? <ReasonsCallout paper={paper} /> : null}

      <div className="grid grid-cols-3 gap-2 rounded-xl border border-neutral-100 bg-neutral-50/70 p-3 text-center">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">Draft</p>
          <div className="mt-1">
            <DecisionBadge value={paper.draft_decision} emptyLabel="Pending" />
          </div>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">Verified</p>
          <div className="mt-1">
            <DecisionBadge value={paper.verified_decision} emptyLabel="Pending" />
          </div>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">Confidence</p>
          <div className="mt-1">
            <ConfidenceBadge value={paper.confidence} />
          </div>
        </div>
      </div>

      {paper.agreement === false && (
        <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          <ShieldAlert className="h-4 w-4 shrink-0" strokeWidth={1.9} />
          <p>
            <strong>Disagreement.</strong> Agent 3 and Agent 4 reached different conclusions.
            Your decision is final.
          </p>
        </div>
      )}

      {paper.issues?.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-800">
          <p className="mb-1 font-semibold">Flagged during verification</p>
          <ul className="list-disc space-y-1 pl-4">
            {paper.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {/* The evidence trail. This is what makes a decision explainable rather than just a
          label: every row either cites the abstract or says the abstract was silent. */}
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Verification checks
        </h4>
        {/* Null until Agent 4 has run - an unverified paper is in the review queue too. */}
        {!paper.checks?.length ? (
          <p className="rounded-lg border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
            Agent 4 has not checked this paper yet, so there is no criterion-by-criterion
            evidence. Verify it from the table, or decide from the abstract on PubMed.
          </p>
        ) : null}
        <ul className="space-y-2">
          {(paper.checks ?? []).map((check) => (
            <li key={check.criterion} className="rounded-lg border border-neutral-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-brand-black">{check.criterion}</p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <SourceTag value={check.source} />
                  <CheckStatusBadge value={check.status} />
                </div>
              </div>
              {check.evidence ? (
                <p className="mt-1.5 border-l-2 border-neutral-200 pl-2 text-xs italic leading-relaxed text-neutral-500">
                  &ldquo;{check.evidence}&rdquo;
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-neutral-400">
                  The abstract does not state this.
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {paper.verification_note && (
        <section>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Verification note
          </h4>
          <p className="text-xs leading-relaxed text-neutral-600">{paper.verification_note}</p>
        </section>
      )}

      {/* The note the researcher left last time, shown above the buttons so it is read
          before the decision is revisited - that is the whole reason for recording it. */}
      {paper.researcher_note ? (
        <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-blue">
            <StickyNote className="h-3.5 w-3.5" strokeWidth={2} />
            Your note
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-brand-black">
            {paper.researcher_note}
          </p>
          {paper.researcher_decided_at ? (
            <p className="mt-2 text-[11px] text-neutral-500">
              {paper.researcher_status === 'overridden' ? 'Overridden' : 'Approved'} on{' '}
              {new Date(paper.researcher_decided_at).toLocaleDateString()}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="sticky bottom-0 -mx-4 border-t border-neutral-100 bg-white px-4 pb-1 pt-3">
        {decided && paper.needs_human_review ? (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-inset ring-emerald-200">
            <span className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
              {paper.researcher_status === 'approved' ? 'Approved' : 'Excluded'} — saved
            </span>
            {onNext ? (
              <button
                type="button"
                onClick={onNext}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                Next paper
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            ) : (
              <span className="font-medium">Queue cleared</span>
            )}
          </div>
        ) : null}
        <p className="mb-2 text-[11px] text-neutral-400">
          {decided
            ? `You marked this paper as ${paper.researcher_status}.`
            : 'The AI recommends; you decide. Nothing counts until you choose.'}
        </p>

        {showNote ? (
          /* Framed, labelled and cancellable. A bare textarea gave no way back out
             and never said where the text was going - and it goes nowhere until a
             decision is made, since onDecide is what persists it. */
          <div className="mb-2 rounded-lg border border-brand-blue/40 bg-blue-50/40 p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor={`note-${paper.id}`}
                className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-blue"
              >
                <StickyNote className="h-3.5 w-3.5" strokeWidth={2} />
                Your note
              </label>
              <button
                type="button"
                onClick={() => {
                  setNote('')
                  setShowNote(false)
                }}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-neutral-500 transition-colors hover:bg-white hover:text-brand-black"
              >
                <X className="h-3 w-3" strokeWidth={2.2} />
                Cancel
              </button>
            </div>

            <textarea
              id={`note-${paper.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              autoFocus
              placeholder={
                paper.agreement === false
                  ? 'Why are you siding with one agent over the other?'
                  : 'Why this decision? (optional)'
              }
              className="w-full resize-y rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-brand-black placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
            />

            {/* The one thing that was not discoverable: typing a note does nothing on
                its own, and switching papers throws it away. Say so here rather than
                let it be learned by losing one. */}
            <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500">
              {note.trim()
                ? 'Attached when you choose Approve or Override below.'
                : 'Saved with your decision — choose Approve or Override below.'}
            </p>
          </div>
        ) : (
          // A full-width tinted button rather than a text link: this sits directly
          // above Approve/Override, and as 12px blue text it read as a caption on
          // those buttons instead of an action of its own. Dashed and secondary so
          // it still defers to Approve - it is optional, not unimportant. Recording
          // *why* a decision was made is the one thing the audit trail cannot
          // reconstruct later, so it has to be visible at the moment of deciding.
          <button
            type="button"
            onClick={() => setShowNote(true)}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-brand-blue/50 bg-blue-50/70 px-3 py-2 text-sm font-semibold text-brand-blue transition-colors hover:border-brand-blue hover:bg-blue-50"
          >
            <StickyNote className="h-4 w-4" strokeWidth={2} />
            {paper.researcher_note ? 'Replace your note' : 'Add a note'}
          </button>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => decide('approved')}
            aria-keyshortcuts="A"
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
              paper.researcher_status === 'approved'
                ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
                : 'bg-gradient-to-r from-brand-blue to-blue-500 text-white shadow-glow hover:brightness-110'
            }`}
          >
            <Check className="h-4 w-4" strokeWidth={2.4} />
            {paper.researcher_status === 'approved' ? 'Approved' : 'Approve'}
            <kbd className="ml-1 rounded bg-white/20 px-1 text-[10px] font-bold">A</kbd>
          </button>
          <button
            type="button"
            onClick={() => decide('overridden')}
            aria-keyshortcuts="O"
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors ${
              paper.researcher_status === 'overridden'
                ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                : 'border-slate-200 bg-white text-brand-black hover:border-red-200 hover:bg-red-50 hover:text-red-700'
            }`}
          >
            <X className="h-4 w-4" strokeWidth={2.4} />
            {paper.researcher_status === 'overridden' ? 'Excluded' : 'Override'}
            <kbd className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-bold text-slate-500">O</kbd>
          </button>
        </div>
        <p className="mt-2 hidden items-center justify-center gap-3 text-[11px] text-neutral-500 sm:flex">
          <span><Kbd>J</Kbd>/<Kbd>K</Kbd> next / previous</span>
          <span><Kbd>N</Kbd> note</span>
          <span><Kbd>Esc</Kbd> close</span>
        </p>
      </div>
    </div>
  )
}

function Kbd({ children }) {
  return (
    <kbd className="mx-0.5 rounded border border-slate-200 bg-slate-50 px-1 py-px text-[10px] font-bold text-slate-600">
      {children}
    </kbd>
  )
}
