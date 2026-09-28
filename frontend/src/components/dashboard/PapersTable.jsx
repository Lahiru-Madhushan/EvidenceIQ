import { ExternalLink, FileText, Loader2, ShieldCheck, StickyNote } from 'lucide-react'
import { ConfidenceBadge, DecisionBadge, StatusBadge } from './Badges'

const PUBMED_URL = 'https://pubmed.ncbi.nlm.nih.gov'

export default function PapersTable({
  papers,
  startIndex,
  selectedId,
  selectedIds,
  onSelectPaper,
  onToggleRow,
  onToggleAll,
  verifyingIds = new Set(),
  onVerify,
  emptyMessage = 'No papers match these filters.',
}) {
  const allChecked = papers.length > 0 && papers.every((paper) => selectedIds.has(paper.id))

  return (
    // The table keeps its own horizontal scroll so the page body never scrolls sideways.
    <div className="overflow-x-auto rounded-2xl border border-neutral-100 bg-white">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-100 bg-neutral-50/70 text-left text-xs font-semibold text-neutral-500">
            <th scope="col" className="w-10 px-4 py-3">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(event) => onToggleAll(event.target.checked)}
                aria-label="Select all papers on this page"
                className="h-4 w-4 rounded border-neutral-300 accent-brand-blue"
              />
            </th>
            <th scope="col" className="w-10 px-2 py-3">#</th>
            <th scope="col" className="px-3 py-3">Title</th>
            <th scope="col" className="w-16 px-3 py-3">Year</th>
            <th scope="col" className="w-28 px-3 py-3">Draft<span className="block font-normal text-neutral-400">(Agent 3)</span></th>
            <th scope="col" className="w-28 px-3 py-3">Verified<span className="block font-normal text-neutral-400">(Agent 4)</span></th>
            <th scope="col" className="w-28 px-3 py-3">Confidence</th>
            <th scope="col" className="w-32 px-3 py-3">Status</th>
            <th scope="col" className="w-36 px-3 py-3">Actions</th>
          </tr>
        </thead>

        <tbody>
          {papers.map((paper, index) => {
            const isSelected = paper.id === selectedId
            return (
              <tr
                key={paper.id}
                onClick={() => onSelectPaper(paper)}
                className={`cursor-pointer border-b border-neutral-50 last:border-0 transition-colors ${
                  isSelected ? 'bg-blue-50/60' : 'hover:bg-neutral-50/70'
                }`}
              >
                <td className="px-4 py-4 align-top" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(paper.id)}
                    onChange={() => onToggleRow(paper.id)}
                    aria-label={`Select ${paper.title}`}
                    className="h-4 w-4 rounded border-neutral-300 accent-brand-blue"
                  />
                </td>

                <td className="px-2 py-4 align-top text-neutral-400 tabular-nums">{startIndex + index}</td>

                <td className="max-w-[320px] px-3 py-4 align-top">
                  <p className="font-medium leading-snug text-brand-blue">{paper.title}</p>
                  <p className="mt-1 text-xs text-neutral-400">PMID: {paper.pmid}</p>
                  {/* Shown inline so a reviewer can scan their own reasoning down the
                      list without opening every paper one at a time. */}
                  {paper.researcher_note ? (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs italic leading-relaxed text-neutral-500">
                      <StickyNote
                        className="mt-0.5 h-3 w-3 shrink-0 text-brand-blue"
                        strokeWidth={2}
                      />
                      <span className="line-clamp-2">{paper.researcher_note}</span>
                    </p>
                  ) : null}
                </td>

                <td className="px-3 py-4 align-top tabular-nums text-neutral-600">{paper.year ?? '--'}</td>
                <td className="px-3 py-4 align-top"><DecisionBadge value={paper.draft_decision} /></td>
                <td className="px-3 py-4 align-top"><DecisionBadge value={paper.verified_decision} /></td>
                <td className="px-3 py-4 align-top"><ConfidenceBadge value={paper.confidence} /></td>
                <td className="px-3 py-4 align-top"><StatusBadge value={paper.researcher_status} /></td>

                <td className="px-3 py-4 align-top" onClick={(event) => event.stopPropagation()}>
                  {/* Only on papers Agent 4 has not ruled on. A verified paper already
                      has its second opinion; re-running it would spend quota to repeat
                      one. */}
                  {onVerify && paper.verified_decision == null ? (
                    <button
                      type="button"
                      onClick={() => onVerify(paper)}
                      disabled={verifyingIds.has(paper.id)}
                      title={
                        paper.draft_decision == null
                          ? 'Screen with Agent 3, then verify with Agent 4'
                          : 'Verify with Agent 4'
                      }
                      className="mb-1.5 inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-blue-dark disabled:cursor-wait disabled:opacity-70"
                    >
                      {verifyingIds.has(paper.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                      ) : (
                        <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
                      )}
                      {verifyingIds.has(paper.id) ? 'Verifying…' : 'Verify'}
                    </button>
                  ) : null}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onSelectPaper(paper, 'details')}
                      aria-label={`View details for ${paper.title}`}
                      title="Paper details"
                      className="rounded-lg p-1.5 text-neutral-400 hover:bg-blue-50 hover:text-brand-blue transition-colors"
                    >
                      <FileText className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                    {/* Was the chat shortcut, which is dead while chat is disabled.
                        Repurposed as the note affordance: highlighted when a note
                        exists, and opening the panel is where notes are written. */}
                    <button
                      type="button"
                      onClick={() => onSelectPaper(paper, 'details')}
                      aria-label={
                        paper.researcher_note
                          ? `Your note on ${paper.title}`
                          : `Add a note to ${paper.title}`
                      }
                      title={paper.researcher_note || 'Add a note'}
                      className={`rounded-lg p-1.5 transition-colors hover:bg-blue-50 hover:text-brand-blue ${
                        paper.researcher_note ? 'text-brand-blue' : 'text-neutral-400'
                      }`}
                    >
                      <StickyNote className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                    <a
                      href={`${PUBMED_URL}/${paper.pmid}/`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open PMID ${paper.pmid} on PubMed`}
                      title="Open on PubMed"
                      className="rounded-lg p-1.5 text-neutral-400 hover:bg-blue-50 hover:text-brand-blue transition-colors"
                    >
                      <ExternalLink className="h-4 w-4" strokeWidth={1.8} />
                    </a>
                  </div>
                </td>
              </tr>
            )
          })}

          {papers.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-14 text-center text-sm text-neutral-400">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
