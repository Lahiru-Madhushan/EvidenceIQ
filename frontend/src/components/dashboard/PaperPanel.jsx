import { useEffect, useState } from 'react'
import {
  FileText,
  Info,
  Send,
  ExternalLink,
  Check,
  X,
  ShieldAlert,
  StickyNote,
} from 'lucide-react'
import { CheckStatusBadge, ConfidenceBadge, DecisionBadge, SourceTag } from './Badges'

const PUBMED_URL = 'https://pubmed.ncbi.nlm.nih.gov'

// Static prompts, not data - they seed the input box, nothing more.
const SUGGESTED_QUESTIONS = [
  'What was the intervention?',
  'What were the main outcomes?',
  'What was the study design?',
  'What are the key limitations?',
]

export default function PaperPanel({ paper, tab, onTabChange, onDecide }) {
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

  // Chat is disabled until it has a backend to talk to. Left visible so the feature
  // reads as planned rather than missing, but not clickable - a tab that opens onto
  // suggestion chips that do nothing is worse than one that says "not yet".
  const tabs = [
    { key: 'details', label: 'Paper Details' },
    { key: 'chat', label: 'Chat with Paper', soon: true },
  ]

  return (
    <aside className="hidden w-[380px] shrink-0 flex-col border-l border-neutral-100 bg-white xl:flex">
      <div className="flex shrink-0 border-b border-neutral-100">
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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Details is the only reachable tab while chat is disabled, so it is rendered
            unconditionally rather than trusting `tab` to still be valid. */}
        <DetailsTab paper={paper} onDecide={onDecide} />
      </div>
    </aside>
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

function DetailsTab({ paper, onDecide }) {
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

  return (
    <div className="space-y-5 p-4">
      <PaperHeader paper={paper} />

      <div className="grid grid-cols-3 gap-2 rounded-xl border border-neutral-100 bg-neutral-50/70 p-3 text-center">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">Draft</p>
          <div className="mt-1">
            <DecisionBadge value={paper.draft_decision} />
          </div>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-neutral-400">Verified</p>
          <div className="mt-1">
            <DecisionBadge value={paper.verified_decision} />
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
        <ul className="space-y-2">
          {paper.checks.map((check) => (
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
        <p className="mb-2 text-[11px] text-neutral-400">
          {decided
            ? `You marked this paper as ${paper.researcher_status}.`
            : 'The AI recommends; you decide. Nothing counts until you choose.'}
        </p>

        {showNote ? (
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            autoFocus
            placeholder={
              paper.agreement === false
                ? 'Why are you siding with one agent over the other?'
                : 'Why this decision? (optional)'
            }
            className="mb-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-black placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowNote(true)}
            className="mb-2 flex items-center gap-1.5 text-xs font-medium text-brand-blue hover:underline"
          >
            <StickyNote className="h-3.5 w-3.5" strokeWidth={2} />
            {paper.researcher_note ? 'Replace your note' : 'Add a note'}
          </button>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => decide('approved')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-blue px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-blue-dark"
          >
            <Check className="h-4 w-4" strokeWidth={2.2} />
            Approve
          </button>
          <button
            type="button"
            onClick={() => decide('overridden')}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-brand-black transition-colors hover:bg-neutral-50"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
            Override
          </button>
        </div>
      </div>
    </div>
  )
}

// NOTE: presentational only. "Chat with Paper" is a retrieval-augmented Q&A feature that
// is not part of the four-agent system. Nothing here calls an LLM and no messages are
// stored yet - the thread is empty until a real chat backend exists.
//
// Kept, but currently unrendered: the tab above is disabled until that backend exists.
// Deleting it would only mean rewriting the same markup when the feature lands.
// eslint-disable-next-line no-unused-vars
function ChatTab({ paper }) {
  const [draft, setDraft] = useState('')

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 p-4">
        <PaperHeader paper={paper} />

        <div className="flex gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-relaxed text-neutral-600">
          <Info className="h-4 w-4 shrink-0 text-brand-blue" strokeWidth={1.9} />
          <p>
            This chat uses the full text of the paper (when available) to answer your
            questions with citations. Verify important information yourself.
          </p>
        </div>

        <p className="py-6 text-center text-sm text-neutral-400">
          Ask a question to start a conversation about this paper.
        </p>

        <div>
          <p className="mb-2 text-xs font-medium text-neutral-500">Suggested questions</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => setDraft(question)}
                className="rounded-full border border-neutral-200 px-3 py-1.5 text-xs text-brand-black transition-colors hover:border-brand-blue hover:text-brand-blue"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-auto border-t border-neutral-100 p-4">
        <div className="relative">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask a question about this paper..."
            className="w-full rounded-xl border border-neutral-200 py-2.5 pl-3.5 pr-11 text-sm placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
          />
          <button
            type="button"
            aria-label="Send message"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-brand-blue p-2 text-white transition-colors hover:bg-brand-blue-dark"
          >
            <Send className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
          AI-generated answers may contain errors. Always verify the information with the
          original paper.
        </p>
      </div>
    </div>
  )
}
