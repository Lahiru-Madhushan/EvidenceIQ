import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  FilePlus2,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Search,
  Trash2,
  User,
} from 'lucide-react'

import DeleteReviewDialog from '../components/dashboard/DeleteReviewDialog'
import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import { useAuth } from '../context/AuthContext'
import { getPaperCountsByReview, listReviews } from '../lib/reviewsApi'
import { PROGRESS_FILTERS, reviewProgress } from '../lib/reviewProgress'
import { ROUTE_FOR_NAV_KEY } from '../lib/navigation'

const PAGE_SIZE = 10

// Rotating tints for the numbered tile, so a long list stays scannable.
const TILE_TONES = [
  'bg-blue-50 text-brand-blue',
  'bg-neutral-100 text-neutral-500',
  'bg-emerald-50 text-emerald-600',
  'bg-violet-50 text-violet-600',
  'bg-amber-50 text-amber-600',
]

const SORT_LABELS = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  papers: 'Most papers',
}

export default function Reviews() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const [reviews, setReviews] = useState([])
  const [countsByReview, setCountsByReview] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)

  useEffect(() => {
    Promise.all([listReviews(), getPaperCountsByReview()])
      .then(([loadedReviews, loadedCounts]) => {
        setReviews(loadedReviews ?? [])
        setCountsByReview(loadedCounts ?? {})
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false))
  }, [])

  // Derived once and reused by the badges, the filters and the counts, so a card can
  // never disagree with the pill that claims to contain it.
  const progressById = useMemo(() => {
    const map = {}
    for (const review of reviews) {
      const counts = countsByReview[review.id]
      map[review.id] = reviewProgress(review, counts, counts?.decided ?? 0)
    }
    return map
  }, [reviews, countsByReview])

  const statusCounts = useMemo(() => {
    const tally = { all: reviews.length }
    for (const { key } of PROGRESS_FILTERS) {
      if (key !== 'all') {
        tally[key] = reviews.filter((r) => progressById[r.id]?.filter === key).length
      }
    }
    return tally
  }, [reviews, progressById])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matched = reviews.filter((review) => {
      const matchesFilter = filter === 'all' || progressById[review.id]?.filter === filter
      const matchesQuery =
        !needle ||
        review.research_question?.toLowerCase().includes(needle) ||
        review.raw_criteria?.toLowerCase().includes(needle)
      return matchesFilter && matchesQuery
    })

    const compare =
      sort === 'papers'
        ? (a, b) => (countsByReview[b.id]?.total ?? 0) - (countsByReview[a.id]?.total ?? 0)
        : sort === 'oldest'
          ? (a, b) => a.created_at.localeCompare(b.created_at)
          : (a, b) => b.created_at.localeCompare(a.created_at)
    return [...matched].sort(compare)
  }, [reviews, countsByReview, progressById, query, filter, sort])

  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const pageItems = visible.slice(pageStart, pageStart + PAGE_SIZE)

  function handleNav(key) {
    const route = ROUTE_FOR_NAV_KEY[key]
    if (route) navigate(route)
  }

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div className="flex h-screen flex-col bg-neutral-50">
      <TopBar user={user} onSignOut={handleSignOut} />

      <div className="flex min-h-0 flex-1">
        <Sidebar active="my-reviews" onNavigate={handleNav} />

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-brand-blue">
                  <FolderOpen className="h-6 w-6" strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold text-brand-black">My Reviews</h1>
                  <p className="mt-0.5 text-sm text-neutral-500">
                    Each review is one research question, its protocol, and the papers
                    screened against it.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate('/reviews/new')}
                className="flex shrink-0 items-center gap-2 rounded-xl bg-brand-blue px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-blue-dark"
              >
                <Plus className="h-4 w-4" strokeWidth={2.4} />
                New Review
              </button>
            </header>

            {error ? (
              <div
                role="alert"
                className="mt-6 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
                <p>{error}</p>
              </div>
            ) : null}

            {notice ? (
              <div
                role="status"
                className="mt-6 flex items-start justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
              >
                <p>{notice}</p>
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  className="shrink-0 font-medium underline-offset-2 hover:underline"
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {!loading && reviews.length > 0 ? (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <div className="relative min-w-[240px] flex-1">
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-neutral-400"
                    strokeWidth={1.8}
                  />
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setPage(1)
                    }}
                    placeholder="Search reviews..."
                    aria-label="Search reviews"
                    className="w-full rounded-xl border border-neutral-200 bg-white py-3 pl-10 pr-4 text-sm placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {PROGRESS_FILTERS.map(({ key, label }) => {
                    const isActive = filter === key
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setFilter(key)
                          setPage(1)
                        }}
                        aria-pressed={isActive}
                        className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-colors ${
                          isActive
                            ? 'border-brand-blue/30 bg-blue-50 text-brand-blue'
                            : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        {label}
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                            isActive
                              ? 'bg-white text-brand-blue'
                              : 'bg-neutral-100 text-neutral-500'
                          }`}
                        >
                          {statusCounts[key] ?? 0}
                        </span>
                      </button>
                    )
                  })}

                  <label className="relative">
                    <span className="sr-only">Sort reviews</span>
                    <ArrowUpDown
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
                      strokeWidth={1.9}
                    />
                    <select
                      value={sort}
                      onChange={(event) => setSort(event.target.value)}
                      className="appearance-none rounded-xl border border-neutral-200 bg-white py-2.5 pl-9 pr-8 text-sm font-medium text-brand-black focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                    >
                      {Object.entries(SORT_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            ) : null}

            {loading ? (
              <div className="mt-16 text-center">
                <Loader2
                  className="mx-auto h-7 w-7 animate-spin text-brand-blue"
                  strokeWidth={1.8}
                />
                <p className="mt-3 text-sm text-neutral-500">Loading your reviews…</p>
              </div>
            ) : reviews.length === 0 && !error ? (
              <EmptyState onNewReview={() => navigate('/reviews/new')} />
            ) : visible.length === 0 ? (
              <div className="mt-8 rounded-2xl border border-dashed border-neutral-200 bg-white p-12 text-center">
                <p className="text-sm text-neutral-500">
                  No reviews match {query.trim() ? `“${query.trim()}”` : 'this filter'}.
                </p>
              </div>
            ) : (
              <>
                <ul className="mt-5 grid gap-3">
                  {pageItems.map((review, index) => (
                    <ReviewCard
                      key={review.id}
                      review={review}
                      index={pageStart + index}
                      counts={countsByReview[review.id]}
                      progress={progressById[review.id]}
                      onOpen={() => navigate(`/reviews/${review.id}`)}
                      onDelete={() => setDeleting(review)}
                    />
                  ))}
                </ul>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pb-4">
                  <p className="text-sm text-neutral-500">
                    Showing {pageItems.length} of {visible.length} review
                    {visible.length === 1 ? '' : 's'}
                  </p>

                  {totalPages > 1 ? (
                    <nav aria-label="Pagination" className="flex items-center gap-1.5">
                      <PageButton
                        onClick={() => setPage(safePage - 1)}
                        disabled={safePage === 1}
                        label="Previous page"
                      >
                        <ChevronLeft className="h-4 w-4" strokeWidth={2} />
                      </PageButton>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((number) => (
                        <button
                          key={number}
                          type="button"
                          onClick={() => setPage(number)}
                          aria-current={number === safePage ? 'page' : undefined}
                          className={`h-9 min-w-9 rounded-lg px-2 text-sm font-medium tabular-nums transition-colors ${
                            number === safePage
                              ? 'bg-brand-blue text-white'
                              : 'border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                          }`}
                        >
                          {number}
                        </button>
                      ))}
                      <PageButton
                        onClick={() => setPage(safePage + 1)}
                        disabled={safePage === totalPages}
                        label="Next page"
                      >
                        <ChevronRight className="h-4 w-4" strokeWidth={2} />
                      </PageButton>
                    </nav>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </main>
      </div>

      {deleting ? (
        <DeleteReviewDialog
          review={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(removed) => {
            setDeleting(null)
            setReviews((rows) => rows.filter((row) => row.id !== removed.id))
            setNotice('Review deleted.')
          }}
        />
      ) : null}
    </div>
  )
}

function ReviewCard({ review, index, counts, progress, onOpen, onDelete }) {
  const protocol = review.protocol ?? {}
  const chips = [protocol.population, protocol.condition, protocol.intervention].filter(
    Boolean
  )
  const screened = counts?.screened ?? 0
  const total = counts?.total ?? 0

  return (
    <li className="group rounded-2xl border border-neutral-100 bg-white transition-all hover:border-brand-blue/40 hover:shadow-sm">
      <div className="flex gap-4 p-4 sm:p-5">
        <div
          className={`flex h-[68px] w-[68px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl ${
            TILE_TONES[index % TILE_TONES.length]
          }`}
        >
          <FileText className="h-5 w-5" strokeWidth={1.8} />
          <span className="text-xs font-bold tabular-nums">
            {String(index + 1).padStart(2, '0')}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="block w-full text-left">
            <h2 className="text-base font-bold leading-snug text-brand-black group-hover:text-brand-blue">
              {review.research_question}
            </h2>
          </button>

          {chips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600"
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-neutral-400">
              {progress?.key === 'needs_you'
                ? 'Agent 1 is waiting on your answer before it can build a protocol.'
                : 'No protocol yet — Agent 1 has not finished.'}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-neutral-500">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.9} />
              Created {new Date(review.created_at).toLocaleDateString()}
            </span>
            <span className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" strokeWidth={1.9} />
              {screened} of {total} paper{total === 1 ? '' : 's'} screened
            </span>
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" strokeWidth={1.9} />
              You
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end justify-between gap-3">
          <div className="text-right">
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${progress?.tone ?? ''}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${progress?.dot ?? ''}`} />
              {progress?.label}
            </span>
            {/* The label alone cannot separate "just started" from "nearly done", so the
                count that decides it is printed underneath. */}
            {progress?.detail ? (
              <p className="mt-1 text-[11px] text-neutral-400">{progress.detail}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onOpen}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-brand-black transition-colors hover:bg-neutral-50"
            >
              <Eye className="h-4 w-4" strokeWidth={1.9} />
              View
            </button>
            <span aria-hidden className="h-5 w-px bg-neutral-200" />
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete review: ${review.research_question}`}
              title="Delete review"
              className="rounded-lg border border-transparent p-2 text-neutral-300 transition-colors hover:border-red-100 hover:bg-red-50 hover:text-red-600 focus-visible:text-red-600 group-hover:text-neutral-400"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}

function PageButton({ onClick, disabled, label, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function EmptyState({ onNewReview }) {
  return (
    <div className="mt-10 rounded-2xl border border-dashed border-neutral-200 bg-white p-10 text-center">
      <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-brand-blue">
        <FilePlus2 className="h-6 w-6" strokeWidth={1.7} />
      </span>
      <h2 className="text-lg font-semibold text-brand-black">No reviews yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-500">
        Start one by entering your research question and your inclusion and exclusion
        criteria. EvidenceIQ will turn them into a protocol, search PubMed, and screen
        every result against it.
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
  )
}
