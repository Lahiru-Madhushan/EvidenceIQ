import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FilePlus2, Pencil, Play, Search, SlidersHorizontal } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import StatCards from '../components/dashboard/StatCards'
import PapersTable from '../components/dashboard/PapersTable'
import PaperPanel from '../components/dashboard/PaperPanel'
import Pagination from '../components/dashboard/Pagination'

const TABS = ['Overview', 'Papers', 'Screening', 'Results', 'Settings']
const PAGE_SIZE = 20

// TODO: load from Supabase once Agent 1 writes protocols and Agent 2 inserts papers.
//
//   const { data: review } = await supabase
//     .from('reviews').select('*').eq('id', reviewId).single()
//
//   const { data: papers } = await supabase
//     .from('papers')
//     .select('id, pmid, title, year, draft_decision, verified_decision, confidence,
//              agreement, needs_human_review, researcher_status, verification_note,
//              checks, issues')
//     .eq('review_id', reviewId)
//
// Row-Level Security scopes both queries to the signed-in user automatically, so there
// is no need to filter by owner here. See docs/database-guide.html.

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const [review] = useState(null)
  const [papers, setPapers] = useState([])

  const [tab, setTab] = useState('Papers')
  const [query, setQuery] = useState('')
  const [decisionFilter, setDecisionFilter] = useState('all')
  const [confidenceFilter, setConfidenceFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const [panelTab, setPanelTab] = useState('details')
  const [checkedIds, setCheckedIds] = useState(() => new Set())

  // Derived from the rows themselves, so the cards stay correct as data arrives.
  // A paper is "excluded" once the researcher overrides it, not when Agent 4 says so -
  // the counts follow the human decision, matching researcher_status in the database.
  const stats = useMemo(
    () => ({
      total: papers.length,
      included: papers.filter((paper) => paper.researcher_status === 'approved').length,
      excluded: papers.filter((paper) => paper.researcher_status === 'overridden').length,
      needsReview: papers.filter((paper) => paper.researcher_status == null).length,
    }),
    [papers]
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return papers.filter((paper) => {
      const matchesQuery =
        !needle ||
        paper.title?.toLowerCase().includes(needle) ||
        paper.pmid?.includes(needle)
      const matchesDecision =
        decisionFilter === 'all' || paper.verified_decision === decisionFilter
      const matchesConfidence =
        confidenceFilter === 'all' || paper.confidence === confidenceFilter
      return matchesQuery && matchesDecision && matchesConfidence
    })
  }, [papers, query, decisionFilter, confidenceFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE)
  const selectedPaper = papers.find((paper) => paper.id === selectedId) ?? null

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

  // TODO: PATCH papers.researcher_status and append a paper_events row.
  function handleDecide(id, status) {
    setPapers((previous) =>
      previous.map((paper) =>
        paper.id === id
          ? {
              ...paper,
              researcher_status: status,
              researcher_decided_at: new Date().toISOString(),
            }
          : paper
      )
    )
  }

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  const filterSelect =
    'rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-brand-black focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:opacity-50'

  return (
    <div className="flex h-screen flex-col bg-neutral-50">
      <TopBar user={user} onSignOut={handleSignOut} />

      <div className="flex min-h-0 flex-1">
        <Sidebar active="dashboard" />

        <main className="min-w-0 flex-1 overflow-y-auto">
          {review === null ? (
            <NoReviewYet name={user?.user_metadata?.full_name || user?.email} />
          ) : (
            <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="mb-3 flex items-center gap-1.5 text-sm text-brand-blue hover:underline"
              >
                <ArrowLeft className="h-4 w-4" strokeWidth={2} />
                Back to Reviews
              </button>

              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-2xl font-bold text-brand-black">{review.title}</h1>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      Active
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-500">{review.research_question}</p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-brand-black transition-colors hover:bg-neutral-50"
                  >
                    <Pencil className="h-4 w-4" strokeWidth={1.9} />
                    Edit Review
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-blue-dark"
                  >
                    <Play className="h-4 w-4" strokeWidth={1.9} />
                    Run Screening
                  </button>
                </div>
              </div>

              <div className="mt-6 flex gap-6 overflow-x-auto border-b border-neutral-200">
                {TABS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setTab(name)}
                    className={`-mb-px whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
                      tab === name
                        ? 'border-brand-blue text-brand-blue'
                        : 'border-transparent text-neutral-500 hover:text-brand-black'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>

              <div className="mt-6">
                <StatCards stats={stats} />
              </div>

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
                  emptyMessage={
                    papers.length === 0
                      ? 'No papers retrieved yet. Run screening to search PubMed.'
                      : 'No papers match these filters.'
                  }
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
            </div>
          )}
        </main>

        <PaperPanel
          paper={selectedPaper}
          tab={panelTab}
          onTabChange={setPanelTab}
          onDecide={handleDecide}
        />
      </div>
    </div>
  )
}

function NoReviewYet({ name }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-brand-blue">
          <FilePlus2 className="h-6 w-6" strokeWidth={1.7} />
        </span>
        <h1 className="text-xl font-semibold text-brand-black">
          {name ? `Welcome, ${name}` : 'Welcome'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-500">
          You have no reviews yet. Start one by entering your research question and your
          inclusion and exclusion criteria, and EvidenceIQ will search PubMed and screen
          the results for you.
        </p>
        <button
          type="button"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-blue px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-blue-dark"
        >
          <FilePlus2 className="h-4 w-4" strokeWidth={1.9} />
          New Review
        </button>
      </div>
    </div>
  )
}
