import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  FilePlus2,
  Loader2,
  Pencil,
  Play,
  MessageCircleQuestion,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  answerClarification,
  refreshReviewStatus,
  runScreening,
  screenOnePaperDraft,
  updateReview,
  verifyOnePaper,
} from '../lib/agentsApi'
import { getPapers, getReview, recordDecision } from '../lib/reviewsApi'
import { ROUTE_FOR_NAV_KEY } from '../lib/navigation'
import { reviewProgress } from '../lib/reviewProgress'
import { isConfirmed, isUnverified } from '../lib/outcomes'
import { needsDecision } from '../lib/reviewReasons'
import { refreshWorkspace } from '../lib/workspace'
import NeedsReviewQueue from '../components/dashboard/NeedsReviewQueue'
import DeleteReviewDialog from '../components/dashboard/DeleteReviewDialog'
import ExportMenu from '../components/dashboard/ExportMenu'
import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import StatCards from '../components/dashboard/StatCards'
import PapersTable from '../components/dashboard/PapersTable'
import PaperPanel from '../components/dashboard/PaperPanel'
import Pagination from '../components/dashboard/Pagination'

// Approved and Excluded list the RESEARCHER's decisions only - what a human actually
// signed off, not what the agents recommended. That is the distinction the schema makes
// too: no agent writes a final decision, only a draft and a recommendation.
//
// The old Screening / Results / Settings tabs are gone: all three rendered the same
// table, and a tab that does nothing is worse than no tab.
// 'Confirmed' is the agents' shortlist; 'Approved' is the researcher's own decision.
// They are deliberately different lists, and the captions under each say so.
// 'Needs review' is the researcher's work queue: flagged by the agents, not yet decided.
const NEEDS_REVIEW = 'Needs review'
const TABS = ['Overview', NEEDS_REVIEW, 'Papers', 'Confirmed', 'Approved', 'Excluded']

// Which tab each stat card opens, so the numbers on the cards lead somewhere.
const TAB_FOR_STAT = {
  total: 'Papers',
  confirmed: 'Confirmed',
  needsReview: NEEDS_REVIEW,
}
const PAGE_SIZE = 20

/**
 * Where a paper currently stands.
 *
 * The researcher's decision wins if they have made one; until then the paper sits under
 * the agents' recommendation, with Agent 4's verified call taking precedence over Agent
 * 3's draft. Returns null for a paper no agent has screened yet - that is "not decided",
 * which is different from "excluded", and it must not be counted as either.
 */
function verdictOf(paper) {
  if (paper.researcher_status === 'approved') return 'INCLUDE'
  if (paper.researcher_status === 'overridden') return 'EXCLUDE'
  return paper.verified_decision ?? paper.draft_decision ?? null
}

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { reviewId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const linkedPaperId = searchParams.get('paper')

  const [review, setReview] = useState(null)
  const [papers, setPapers] = useState([])
  const [loading, setLoading] = useState(Boolean(reviewId))
  const [error, setError] = useState(null)
  const [screening, setScreening] = useState(false)
  const [notice, setNotice] = useState(null)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Opens on Overview: it answers "where is this up to and what needs me?", which is
  // what someone returning to a review wants before a list of 300 rows.
  const [tab, setTab] = useState('Overview')
  const [query, setQuery] = useState('')
  const [decisionFilter, setDecisionFilter] = useState('all')
  const [confidenceFilter, setConfidenceFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const [panelTab, setPanelTab] = useState('details')
  const [checkedIds, setCheckedIds] = useState(() => new Set())
  // Papers with a Verify click in flight, so each row can show its own spinner while
  // others stay clickable.
  const [verifyingIds, setVerifyingIds] = useState(() => new Set())

  const load = useCallback(async () => {
    // `loading` already starts false without a reviewId, so there is nothing to unset.
    if (!reviewId) return
    try {
      setError(null)
      // Both in flight at once: the papers query does not depend on the review.
      const [loadedReview, loadedPapers] = await Promise.all([
        getReview(reviewId),
        getPapers(reviewId),
      ])
      setReview(loadedReview)
      setPapers(loadedPapers ?? [])
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }, [reviewId])

  useEffect(() => {
    load()
  }, [load])

  // `?paper=<id>` - sent by the notification inbox and the command palette - opens that
  // paper, in the Needs review tab when it is waiting on the researcher. The parameter is
  // then dropped so a reload or a Back does not keep reopening it.
  useEffect(() => {
    if (!linkedPaperId || papers.length === 0) return
    const target = papers.find((paper) => paper.id === linkedPaperId)
    if (target) {
      setSelectedId(target.id)
      setPanelTab('details')
      setTab(needsDecision(target) ? NEEDS_REVIEW : 'Papers')
      setPage(1)
    }
    setSearchParams({}, { replace: true })
  }, [linkedPaperId, papers, setSearchParams])

  async function handleRunScreening() {
    setScreening(true)
    setError(null)
    setNotice(null)
    try {
      const summary = await runScreening(reviewId)
      await load()

      if (summary.total === 0) {
        setNotice(
          summary.skipped > 0
            ? `Every paper has already been screened. ${summary.skipped} skipped.`
            : 'There was nothing to screen.'
        )
      } else {
        // Surfaced rather than hidden: a failed paper is one the researcher would
        // otherwise assume had been screened.
        const parts = [`Screened ${summary.complete} of ${summary.total} papers`]
        if (summary.disagreements > 0) {
          parts.push(`${summary.disagreements} disagreement(s) between Agent 3 and Agent 4`)
        }
        if (summary.verification_failed > 0) {
          parts.push(`${summary.verification_failed} could not be verified`)
        }
        if (summary.failed > 0) parts.push(`${summary.failed} failed`)
        setNotice(`${parts.join(' · ')}.`)
      }
    } catch (runError) {
      setError(runError.message)
    } finally {
      setScreening(false)
    }
  }

  // Derived from the rows themselves, so the cards stay correct as data arrives.
  // Included/excluded follow the agents' recommendation until the researcher decides,
  // then follow the researcher - a paper they overrode is excluded whatever Agent 4 said.
  // "Needs review" is the queue: undecided papers the agents flagged.
  const stats = useMemo(
    () => ({
      total: papers.length,
      included: papers.filter((paper) => verdictOf(paper) === 'INCLUDE').length,
      excluded: papers.filter((paper) => verdictOf(paper) === 'EXCLUDE').length,
      needsReview: papers.filter(needsDecision).length,
      // The shortlist: both agents independently said INCLUDE. Not the same as the
      // Included card above, which follows Agent 4 alone and falls back to Agent 3's
      // draft when Agent 4 never ran.
      confirmed: papers.filter(isConfirmed).length,
      unverified: papers.filter(isUnverified).length,
    }),
    [papers]
  )

  // Shown on the tabs themselves, so the two lists are countable without opening them.
  // These count the researcher's own decisions, so they are deliberately NOT the same
  // as the Included/Excluded cards above - those follow the agents until a human
  // decides. The captions inside each tab say so, because two different numbers for
  // similar-sounding words on one screen would otherwise read as a bug.
  const tabCounts = useMemo(
    () => ({
      [NEEDS_REVIEW]: papers.filter(needsDecision).length,
      Papers: papers.length,
      Confirmed: papers.filter(isConfirmed).length,
      Approved: papers.filter((paper) => paper.researcher_status === 'approved').length,
      Excluded: papers.filter((paper) => paper.researcher_status === 'overridden').length,
    }),
    [papers]
  )

  // Same derivation the reviews list uses, so the two pages never disagree about where
  // a review has got to.
  const progress = useMemo(
    () =>
      review
        ? reviewProgress(
            review,
            {
              total: papers.length,
              screened: papers.filter((p) => p.screened_at).length,
            },
            papers.filter((p) => p.researcher_status != null).length
          )
        : null,
    [review, papers]
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return papers.filter((paper) => {
      // Approved and Excluded are the RESEARCHER's decisions, not the agents'
      // recommendations - a paper Agent 4 wants to include is not "approved" until a
      // human says so. Papers parked as 'maybe' appear in neither, which is the point
      // of having a third value.
      const matchesTab =
        tab === NEEDS_REVIEW
          ? needsDecision(paper)
          : tab === 'Confirmed'
          ? isConfirmed(paper)
          : tab === 'Approved'
            ? paper.researcher_status === 'approved'
            : tab === 'Excluded'
              ? paper.researcher_status === 'overridden'
              : true
      const matchesQuery =
        !needle ||
        paper.title?.toLowerCase().includes(needle) ||
        paper.pmid?.includes(needle)
      const matchesDecision =
        decisionFilter === 'all' || paper.verified_decision === decisionFilter
      const matchesConfidence =
        confidenceFilter === 'all' || paper.confidence === confidenceFilter
      return matchesTab && matchesQuery && matchesDecision && matchesConfidence
    })
  }, [papers, tab, query, decisionFilter, confidenceFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE)
  const selectedPaper = papers.find((paper) => paper.id === selectedId) ?? null

  // The review queue, in the same order as the table, so "Next" in the panel walks the
  // researcher through the flagged papers without returning to the list each time.
  const queue = useMemo(() => papers.filter(needsDecision), [papers])
  const queueIndex = queue.findIndex((paper) => paper.id === selectedId)
  const nextInQueue =
    (queueIndex >= 0 ? queue[queueIndex + 1] ?? queue[0] : queue[0]) ?? null
  const prevInQueue =
    queueIndex > 0 ? queue[queueIndex - 1] : queueIndex === 0 ? queue[queue.length - 1] : null
  const openFromQueue = (paper) => () => {
    setSelectedId(paper.id)
    setPanelTab('details')
  }
  const queueNav = {
    remaining: queue.length,
    position: queueIndex >= 0 ? queueIndex + 1 : null,
    next: nextInQueue && nextInQueue.id !== selectedId ? openFromQueue(nextInQueue) : null,
    prev: prevInQueue && prevInQueue.id !== selectedId ? openFromQueue(prevInQueue) : null,
  }

  const rangeLabel = filtered.length
    ? `Showing ${pageStart + 1}-${pageStart + visible.length} of ${filtered.length} papers`
    : 'No papers yet'

  function handleSelectPaper(paper, requestedTab) {
    setSelectedId(paper.id)
    if (requestedTab) setPanelTab(requestedTab)
  }

  function handleToggleRow(id) {
    setCheckedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleToggleAll(checked) {
    setCheckedIds((previous) => {
      const next = new Set(previous)
      visible.forEach((paper) => (checked ? next.add(paper.id) : next.delete(paper.id)))
      return next
    })
  }

  /**
   * Runs the agents on one paper that has no verified decision yet.
   *
   * Agent 4 checks Agent 3's recorded draft, so a paper never screened gets its draft
   * first. One screened but stopped before verification (a spent quota, a cancelled
   * run) only needs Agent 4, so its draft is not paid for twice.
   */
  async function handleVerifyPaper(paper) {
    const mark = (on) =>
      setVerifyingIds((previous) => {
        const next = new Set(previous)
        if (on) next.add(paper.id)
        else next.delete(paper.id)
        return next
      })

    mark(true)
    setError(null)
    setNotice(null)
    try {
      if (paper.draft_decision == null) await screenOnePaperDraft(paper.id)
      const result = await verifyOnePaper(paper.id)
      setPapers((await getPapers(reviewId)) ?? [])

      const decision = result?.verified_decision
      const title = paper.title?.length > 60 ? `${paper.title.slice(0, 57)}…` : paper.title
      setNotice(
        decision
          ? `Verified “${title}”: Agent 4 says ${decision}.`
          : `Verified “${title}”.`
      )
    } catch (verifyError) {
      // A draft may have been saved before Agent 4 failed; reload so the row shows it.
      getPapers(reviewId)
        .then((rows) => setPapers(rows ?? []))
        .catch(() => {})
      setError(verifyError.message)
    } finally {
      mark(false)
    }
  }

  async function handleDecide(id, status, note = null) {
    const paper = papers.find((row) => row.id === id)
    if (!paper) return

    const previous = papers
    // Applied locally first so the panel responds immediately, and rolled back below if
    // the write fails - a decision that silently did not save would be worse than a slow
    // button. An empty note keeps whatever was written before rather than blanking it.
    const savedNote = note ?? paper.researcher_note ?? null
    setPapers((rows) =>
      rows.map((row) =>
        row.id === id
          ? {
              ...row,
              researcher_status: status,
              researcher_note: savedNote,
              researcher_decided_at: new Date().toISOString(),
            }
          : row
      )
    )

    try {
      const { auditWarning } = await recordDecision(paper, status, savedNote)
      setNotice(auditWarning)
      // The sidebar badge and the inbox count papers waiting across every review.
      refreshWorkspace()

      // Only when this decision could have flipped "every paper decided" either way -
      // the endpoint is idempotent, but there is no reason to call it on every click.
      const decidedNow = previous.filter(
        (row) => (row.id === id ? status : row.researcher_status) != null
      ).length
      const wasComplete = review?.status === 'complete'
      const isComplete = papers.length > 0 && decidedNow === papers.length
      if (wasComplete !== isComplete) {
        const refreshed = await refreshReviewStatus(reviewId)
        setReview((current) => (current ? { ...current, status: refreshed.status } : current))
      }
    } catch (decideError) {
      setPapers(previous)
      setError(decideError.message)
    }
  }

  async function handleReviewSaved(result) {
    setEditing(false)
    setError(null)
    await load()

    const messages = ['Criteria updated — Agent 1 rebuilt the protocol.']
    if (result.stale_screened_count > 0) {
      messages.push(
        `${result.stale_screened_count} paper(s) were screened against the previous ` +
          'protocol. Run screening again to re-check them.'
      )
    }
    setNotice(messages.join(' '))
  }

  function handleNav(key) {
    const route = ROUTE_FOR_NAV_KEY[key]
    if (route) navigate(route)
  }

  // No navigation here: signOut sets the flag that sends ProtectedRoute to the landing
  // page (see AuthContext). Navigating as well only adds a duplicate history entry, so
  // that Back appears to do nothing once.
  async function handleSignOut() {
    await signOut()
  }

  const filterSelect =
    'rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-brand-black focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:opacity-50'

  return (
    <div className="app-canvas flex h-screen flex-col">
      <TopBar user={user} onSignOut={handleSignOut} />

      <div className="flex min-h-0 flex-1">
        <Sidebar active="my-reviews" onNavigate={handleNav} />

        <main className="min-w-0 flex-1 overflow-y-auto">
          {loading ? (
            <LoadingState />
          ) : review === null ? (
            <NoReviewYet
              name={user?.user_metadata?.full_name || user?.email}
              error={error}
              onNewReview={() => navigate('/reviews/new')}
            />
          ) : (
            <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
              <button
                type="button"
                onClick={() => navigate('/reviews')}
                className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 text-sm font-medium text-neutral-500 transition-colors hover:bg-white hover:text-brand-blue"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2} />
                My Reviews
              </button>

              <ReviewHero
                review={review}
                progress={progress}
                total={papers.length}
                decided={papers.filter((paper) => paper.researcher_status != null).length}
                screening={screening}
                onDelete={() => setConfirmDelete(true)}
                onEdit={() => setEditing(true)}
                onRun={handleRunScreening}
              />

              {/* A segmented control rather than underlined text: the tabs are the main
                  way around a review, so they are drawn as controls, not as a caption. */}
              <div className="mt-5 overflow-x-auto pb-1">
                <div
                  role="tablist"
                  aria-label="Review sections"
                  className="inline-flex min-w-full gap-1 rounded-2xl border border-slate-200/80 bg-white p-1 shadow-card sm:min-w-0"
                >
                  {TABS.map((name) => {
                    const active = tab === name
                    const urgent = name === NEEDS_REVIEW && tabCounts[name] > 0
                    return (
                      <button
                        key={name}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => {
                          setTab(name)
                          setPage(1)
                        }}
                        className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold transition-all sm:flex-none ${
                          active
                            ? 'bg-brand-black text-white shadow-sm'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-brand-black'
                        }`}
                      >
                        {name}
                        {tabCounts[name] !== undefined ? (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                              urgent
                                ? 'bg-amber-500 text-white'
                                : active
                                  ? 'bg-white/20 text-white'
                                  : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {tabCounts[name]}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>

              {error ? <Banner tone="error" message={error} onDismiss={() => setError(null)} /> : null}
              {notice ? <Banner tone="info" message={notice} onDismiss={() => setNotice(null)} /> : null}

              <div className="mt-6">
                <StatCards
                  stats={stats}
                  activeKey={Object.keys(TAB_FOR_STAT).find((key) => TAB_FOR_STAT[key] === tab)}
                  onSelect={(key) => {
                    setTab(TAB_FOR_STAT[key])
                    setPage(1)
                  }}
                  selectable={Object.keys(TAB_FOR_STAT)}
                />
              </div>

              {tab === 'Overview' ? (
                <Overview
                  review={review}
                  papers={papers}
                  onOpenPaper={(paper) => {
                    setTab(NEEDS_REVIEW)
                    setPage(1)
                    setSelectedId(paper.id)
                    setPanelTab('details')
                  }}
                  onOpenQueue={() => {
                    setTab(NEEDS_REVIEW)
                    setPage(1)
                  }}
                />
              ) : (
              <>
              {tab === NEEDS_REVIEW ? (
                <p className="mt-5 rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-sm leading-relaxed text-amber-900">
                  <strong className="font-semibold">Your queue.</strong> The agents flagged
                  these papers because they disagreed, were unsure, found suspicious wording,
                  or had no abstract to read. Open one to see why, then approve or override
                  it — use <strong className="font-semibold">Next</strong> in the panel to
                  move straight to the following paper.
                </p>
              ) : null}
              {tab === 'Confirmed' ? (
                <p className="mt-5 text-sm text-neutral-500">
                  Papers <strong className="font-semibold text-brand-black">both agents
                  independently accepted</strong> — Agent 3 screened them in and Agent 4
                  reached the same answer on its own. This is the shortlist to read, not a
                  final decision: approve them below to make them yours.
                  {stats.unverified > 0 ? (
                    <>
                      {' '}
                      <span className="text-amber-700">
                        {stats.unverified} paper(s) are still waiting on Agent 4 and cannot
                        appear here until it has checked them.
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}
              {tab === 'Approved' || tab === 'Excluded' ? (
                <p className="mt-5 text-sm text-neutral-500">
                  {tab === 'Approved'
                    ? 'Papers you approved. The agents’ recommendations are in the Papers tab — a paper only counts as included once you approve it.'
                    : 'Papers you excluded by overriding the agents, or by rejecting what they recommended.'}
                </p>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-neutral-400" strokeWidth={1.8} />
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setPage(1)
                    }}
                    disabled={papers.length === 0}
                    placeholder="Search papers by title, PMID, or keyword..."
                    className="w-full rounded-lg border border-neutral-200 bg-white py-2.5 pl-10 pr-4 text-sm placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:opacity-50"
                  />
                </div>

                <select
                  value={decisionFilter}
                  onChange={(event) => {
                    setDecisionFilter(event.target.value)
                    setPage(1)
                  }}
                  disabled={papers.length === 0}
                  aria-label="Filter by decision"
                  className={filterSelect}
                >
                  <option value="all">All decisions</option>
                  <option value="INCLUDE">Include</option>
                  <option value="EXCLUDE">Exclude</option>
                </select>

                <select
                  value={confidenceFilter}
                  onChange={(event) => {
                    setConfidenceFilter(event.target.value)
                    setPage(1)
                  }}
                  disabled={papers.length === 0}
                  aria-label="Filter by confidence"
                  className={filterSelect}
                >
                  <option value="all">All confidence</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                </select>

                <button
                  type="button"
                  disabled={papers.length === 0}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-brand-black transition-colors hover:bg-neutral-50 disabled:opacity-50"
                >
                  <SlidersHorizontal className="h-4 w-4" strokeWidth={1.9} />
                  More filters
                </button>

                {/* `filtered`, not `papers`: the export must match the table the reader
                    is looking at, filters and search included. */}
                <ExportMenu
                  papers={filtered}
                  review={review}
                  disabled={papers.length === 0}
                />
              </div>

              <div className="mt-4">
                <PapersTable
                  papers={visible}
                  startIndex={pageStart + 1}
                  selectedId={selectedId}
                  selectedIds={checkedIds}
                  onSelectPaper={handleSelectPaper}
                  onToggleRow={handleToggleRow}
                  onToggleAll={handleToggleAll}
                  verifyingIds={verifyingIds}
                  onVerify={handleVerifyPaper}
                  emptyMessage={emptyMessage(tab, papers.length)}
                />
              </div>

              <div className="mt-4 pb-4">
                <Pagination
                  page={safePage}
                  totalPages={totalPages}
                  rangeLabel={rangeLabel}
                  onChange={(next) => setPage(Math.min(Math.max(next, 1), totalPages))}
                />
              </div>
              </>
              )}
            </div>
          )}
        </main>

        <PaperPanel
          paper={selectedPaper}
          tab={panelTab}
          onTabChange={setPanelTab}
          onDecide={handleDecide}
          onClose={() => setSelectedId(null)}
          queue={queueNav}
        />

        {confirmDelete && review ? (
          <DeleteReviewDialog
            review={review}
            onClose={() => setConfirmDelete(false)}
            onDeleted={() => navigate('/reviews')}
          />
        ) : null}

        {editing && review ? (
          <EditReviewDialog
            review={review}
            paperCount={papers.filter((paper) => paper.screened_at).length}
            onClose={() => setEditing(false)}
            onSaved={handleReviewSaved}
          />
        ) : null}
      </div>
    </div>
  )
}

/** What the empty table should say, which depends on why it is empty. */
function emptyMessage(tab, totalPapers) {
  if (totalPapers === 0) return 'No papers retrieved yet. Run screening to search PubMed.'
  if (tab === 'Approved') {
    return 'You have not approved any papers yet. Open a paper in the Papers tab and choose Approve.'
  }
  if (tab === 'Excluded') {
    return 'You have not excluded any papers yet. Open a paper in the Papers tab and choose Override.'
  }
  if (tab === NEEDS_REVIEW) {
    return 'Nothing is waiting on you — every flagged paper has a decision.'
  }
  return 'No papers match these filters.'
}

/**
 * The Overview answers "where is this review up to, and what needs me?".
 *
 * It leads with the papers waiting on the researcher, then the protocol and agreement
 * figures - the totals are already in the cards above, and the flagged papers are the
 * only ones where the researcher's attention changes the outcome.
 */
function Overview({ review, papers, onOpenPaper, onOpenQueue }) {
  const screened = papers.filter((paper) => paper.screened_at).length
  const verified = papers.filter((paper) => paper.verified_at).length
  const disagreements = papers.filter((paper) => paper.agreement === false)
  const decided = papers.filter((paper) => paper.researcher_status != null).length
  const lowConfidence = papers.filter((paper) => paper.confidence === 'LOW').length
  const withIssues = papers.filter((paper) => (paper.issues?.length ?? 0) > 0)

  const protocol = review?.protocol

  return (
    <div className="mt-6 grid gap-4 pb-4 lg:grid-cols-2">
      {/* First, because it is the only part of the page that needs the researcher to act. */}
      <NeedsReviewQueue papers={papers} onOpenPaper={onOpenPaper} onOpenTable={onOpenQueue} />
      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-card p-5 lg:col-span-2">
        <h2 className="text-sm font-semibold text-brand-black">
          Screening protocol
          <span className="ml-2 font-normal text-neutral-400">from Agent 1</span>
        </h2>
        {protocol ? (
          <>
            <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
              <ProtocolItem label="Population" value={protocol.population} />
              <ProtocolItem label="Condition" value={protocol.condition} />
              <ProtocolItem label="Intervention" value={protocol.intervention} />
              <ProtocolItem
                label="Published"
                value={
                  protocol.date_range
                    ? `${protocol.date_range.from}–${protocol.date_range.to}`
                    : null
                }
              />
            </dl>
            {protocol.excludes?.length ? (
              <div className="mt-4">
                <p className="text-xs font-medium text-neutral-500">Excluded</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {protocol.excludes.map((term) => (
                    <span
                      key={term}
                      className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-100"
                    >
                      {term}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">
            Agent 1 has not produced a protocol for this review yet.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-card p-5">
        <h2 className="text-sm font-semibold text-brand-black">Pipeline progress</h2>
        <div className="mt-4 grid gap-3">
          <ProgressRow label="Retrieved by Agent 2" value={papers.length} total={papers.length} />
          <ProgressRow label="Screened by Agent 3" value={screened} total={papers.length} />
          <ProgressRow label="Verified by Agent 4" value={verified} total={papers.length} />
          <ProgressRow label="Decided by you" value={decided} total={papers.length} />
        </div>
        {verified < screened ? (
          <p className="mt-3 text-xs text-amber-700">
            {screened - verified} paper(s) were screened but not verified — re-run
            screening to finish them.
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-card p-5">
        <h2 className="text-sm font-semibold text-brand-black">Agent agreement</h2>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          Agent 4 re-checks every paper without being shown Agent 3&apos;s answer, so where
          they agree, two independent passes reached the same conclusion.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Figure
            label="Agreed"
            value={papers.filter((paper) => paper.agreement === true).length}
            tone="text-emerald-700 bg-emerald-50"
          />
          <Figure
            label="Disagreed"
            value={disagreements.length}
            tone="text-amber-700 bg-amber-50"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Figure label="Low confidence" value={lowConfidence} tone="text-neutral-600 bg-neutral-50" />
          <Figure
            label="Flagged in text"
            value={withIssues.length}
            tone="text-neutral-600 bg-neutral-50"
          />
        </div>
      </section>

    </div>
  )
}

function ProtocolItem({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-brand-black">{value || '—'}</dd>
    </div>
  )
}

function ProgressRow({ label, value, total }) {
  const percent = total ? Math.round((value / total) * 100) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-neutral-600">{label}</span>
        <span className="tabular-nums font-medium text-brand-black">
          {value}
          <span className="text-neutral-400"> / {total}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
        <div
          className="h-full rounded-full bg-brand-blue transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function Figure({ label, value, tone }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 ${tone}`}>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs">{label}</p>
    </div>
  )
}

/**
 * Editing a review means re-running Agent 1, which is why this is a dialog and not an
 * inline field: the change is not "rename a title", it replaces the rules every later
 * agent screens against, and can come back asking a question instead of succeeding.
 */
function EditReviewDialog({ review, paperCount, onClose, onSaved }) {
  const [question, setQuestion] = useState(review.research_question ?? '')
  const [criteria, setCriteria] = useState(review.raw_criteria ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [clarification, setClarification] = useState(null)
  const [answer, setAnswer] = useState('')

  const changed =
    question.trim() !== (review.research_question ?? '').trim() ||
    criteria.trim() !== (review.raw_criteria ?? '').trim()

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const result = await updateReview(review.id, {
        researchQuestion: question.trim(),
        rawCriteria: criteria.trim(),
      })

      if (result.status === 'clarification_needed') {
        // The edit is saved, but the review now has no protocol until this is answered.
        setClarification(result)
        return
      }
      onSaved(result)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleAnswer(event) {
    event.preventDefault()
    if (!answer.trim()) return
    setSaving(true)
    setError(null)
    try {
      const result = await answerClarification(review.id, answer.trim())
      if (result.status !== 'ready') {
        setClarification({ ...result, stale_screened_count: clarification.stale_screened_count })
        setAnswer('')
        return
      }
      onSaved({ ...result, stale_screened_count: clarification.stale_screened_count })
    } catch (answerError) {
      setError(answerError.message)
    } finally {
      setSaving(false)
    }
  }

  const field =
    'w-full rounded-lg border border-neutral-200 bg-white px-3.5 py-2.5 text-sm text-brand-black placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:opacity-60'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-review-title"
        className="w-full max-w-[640px] rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="edit-review-title" className="text-lg font-semibold text-brand-black">
            Edit review
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-brand-black"
          >
            <X className="h-5 w-5" strokeWidth={1.9} />
          </button>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
            <p>{error}</p>
          </div>
        ) : null}

        {clarification ? (
          <form onSubmit={handleAnswer} className="mt-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <MessageCircleQuestion className="h-4 w-4" strokeWidth={1.9} />
                Agent 1 needs one thing cleared up
              </p>
              <p className="mt-2 text-sm leading-relaxed text-amber-900">
                {clarification.question}
              </p>
              {clarification.ambiguous_term ? (
                <p className="mt-1.5 text-xs text-amber-700">
                  Ambiguous term: <strong>{clarification.ambiguous_term}</strong>
                </p>
              ) : null}
              <p className="mt-2 text-xs text-amber-700">
                Your edits are saved, but this review has no protocol until you answer —
                screening cannot run.
              </p>
            </div>

            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="e.g. type 2 diabetes only"
              disabled={saving}
              className={`${field} mt-4`}
            />

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-brand-black transition-colors hover:bg-neutral-50"
              >
                Answer later
              </button>
              <button
                type="submit"
                disabled={saving || !answer.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-blue-dark disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} /> : null}
                Continue
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSave} className="mt-4">
            <label className="block">
              <span className="text-sm font-medium text-brand-black">Research question</span>
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                disabled={saving}
                className={`${field} mt-2`}
              />
            </label>

            <label className="mt-4 block">
              <span className="text-sm font-medium text-brand-black">
                Inclusion and exclusion criteria
              </span>
              <span className="mt-0.5 block text-xs text-neutral-500">
                Agent 1 re-reads these and rebuilds the protocol. If anything is ambiguous
                it will stop and ask rather than guess.
              </span>
              <textarea
                value={criteria}
                onChange={(event) => setCriteria(event.target.value)}
                rows={6}
                disabled={saving}
                className={`${field} mt-2`}
              />
            </label>

            {changed && paperCount > 0 ? (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
                <span>
                  {paperCount} paper(s) in this review were screened against the current
                  protocol. Changing the criteria does not undo those decisions — re-run
                  screening afterwards to bring them up to date.
                </span>
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-brand-black transition-colors hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !changed || !question.trim() || !criteria.trim()}
                title={changed ? undefined : 'Nothing has changed yet.'}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-blue-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} /> : null}
                {saving ? 'Asking Agent 1…' : 'Save and re-run Agent 1'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function StatusPill({ progress }) {
  if (!progress) return null
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${progress.tone}`}
      title={progress.detail}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${progress.dot}`} />
      {progress.label}
    </span>
  )
}

/**
 * The top of a review: what is being asked, under which rules, how far the researcher
 * has got, and the three things they can do to it. The ring is the researcher's own
 * progress (papers decided), not the agents' - that is what "done" means for a review.
 */
function ReviewHero({ review, progress, total, decided, screening, onDelete, onEdit, onRun }) {
  const protocol = review.protocol
  const chips = protocol
    ? [
        protocol.population && { label: 'Population', value: protocol.population },
        protocol.condition && { label: 'Condition', value: protocol.condition },
        protocol.intervention && { label: 'Intervention', value: protocol.intervention },
        protocol.date_range && {
          label: 'Published',
          value: `${protocol.date_range.from}–${protocol.date_range.to}`,
        },
      ].filter(Boolean)
    : []

  return (
    <section className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-card">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_220px_at_0%_0%,rgb(37_99_235/0.08),transparent_70%)]"
      />
      <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:p-6">
        <ProgressRing value={decided} total={total} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill progress={progress} />
            {review.created_at ? (
              <span className="text-xs text-neutral-500">
                Created {new Date(review.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            ) : null}
          </div>
          <h1 className="mt-2 text-xl font-bold leading-snug tracking-tight text-brand-black sm:text-2xl">
            {review.research_question}
          </h1>
          {chips.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {chips.map(({ label, value }) => (
                <span
                  key={label}
                  className="inline-flex max-w-full items-center gap-1 truncate rounded-lg bg-slate-100/80 px-2.5 py-1 text-xs text-slate-700"
                >
                  <span className="font-semibold text-slate-500">{label}</span>
                  <span className="truncate">{value}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-amber-700">
              Agent 1 has not produced a protocol for this review yet.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-stretch">
          <button
            type="button"
            onClick={onRun}
            disabled={screening || total === 0}
            title={
              total === 0
                ? 'Retrieve some papers first — there is nothing to screen.'
                : 'Run Agent 3 and Agent 4 over every unscreened paper'
            }
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-blue to-blue-500 px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
          >
            {screening ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <Play className="h-4 w-4" strokeWidth={2} />
            )}
            {screening ? 'Screening…' : 'Run screening'}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-brand-black transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <Pencil className="h-4 w-4" strokeWidth={2} />
              Edit
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label="Delete this review"
              title="Delete review"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-neutral-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function ProgressRing({ value, total }) {
  const percent = total ? Math.round((value / total) * 100) : 0
  const radius = 34
  const circumference = 2 * Math.PI * radius
  return (
    <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:gap-1.5">
      <div className="relative h-[84px] w-[84px]">
        <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="42" cy="42" r={radius} fill="none" stroke="currentColor" strokeWidth="8" className="text-slate-100" />
          <circle
            cx="42"
            cy="42"
            r={radius}
            fill="none"
            stroke="url(#review-ring)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - percent / 100)}
            className="transition-[stroke-dashoffset] duration-700"
          />
          <defs>
            <linearGradient id="review-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums text-brand-black">
          {percent}%
        </span>
      </div>
      <p className="text-xs text-neutral-500 sm:text-center">
        <span className="font-semibold text-brand-black tabular-nums">{value}</span> of{' '}
        <span className="tabular-nums">{total}</span>
        <span className="block">decided by you</span>
      </p>
    </div>
  )
}

function Banner({ tone, message, onDismiss }) {
  const isError = tone === 'error'
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`mt-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${
        isError
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-blue-200 bg-blue-50 text-blue-800'
      }`}
    >
      {isError ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
      ) : null}
      <p className="min-w-0 flex-1">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 font-medium underline-offset-2 hover:underline"
      >
        Dismiss
      </button>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="text-center">
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-brand-blue" strokeWidth={1.8} />
        <p className="mt-3 text-sm text-neutral-500">Loading your review…</p>
      </div>
    </div>
  )
}

function NoReviewYet({ name, error, onNewReview }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-brand-blue">
          <FilePlus2 className="h-6 w-6" strokeWidth={1.7} />
        </span>
        <h1 className="text-xl font-semibold text-brand-black">
          {name ? `Welcome, ${name}` : 'Welcome'}
        </h1>
        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          You have no reviews yet. Start one by entering your research question and your
          inclusion and exclusion criteria, and EvidenceIQ will search PubMed and screen
          the results for you.
        </p>
        <button
          type="button"
          onClick={onNewReview}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-blue px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-blue-dark"
        >
          <FilePlus2 className="h-4 w-4" strokeWidth={1.9} />
          New Review
        </button>
      </div>
    </div>
  )
}
