import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowUpDown,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FilePlus2,
  FileText,
  FolderOpen,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TrendingUp,
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

/**
 * One palette per stage, used for the card's left edge, its numbered tile and its
 * filter dot at once.
 *
 * Keyed by the progress key rather than by list position. The old version tinted tiles
 * by index, which looked lively and meant nothing - two cards the same colour were
 * simply two cards next to each other. Tied to the stage instead, the colour is a
 * second channel for the badge, and a list can be read without reading any words.
 */
const STAGE_TONES = {
  needs_you: { edge: 'bg-amber-400', tile: 'bg-amber-50 text-amber-600', dot: 'bg-amber-500' },
  draft: { edge: 'bg-neutral-300', tile: 'bg-neutral-100 text-neutral-500', dot: 'bg-neutral-400' },
  no_papers: { edge: 'bg-neutral-300', tile: 'bg-neutral-100 text-neutral-500', dot: 'bg-neutral-400' },
  screening: { edge: 'bg-emerald-400', tile: 'bg-emerald-50 text-emerald-600', dot: 'bg-emerald-500' },
  ready: { edge: 'bg-brand-blue', tile: 'bg-blue-50 text-brand-blue', dot: 'bg-blue-500' },
  complete: { edge: 'bg-violet-400', tile: 'bg-violet-50 text-violet-600', dot: 'bg-violet-500' },
}
const FALLBACK_TONE = STAGE_TONES.draft

// The filter pills reuse the same dots, so the pill and the cards it reveals match.
const FILTER_DOTS = {
  all: 'bg-brand-blue',
  needs_you: STAGE_TONES.needs_you.dot,
  not_started: STAGE_TONES.draft.dot,
  screening: STAGE_TONES.screening.dot,
  ready: STAGE_TONES.ready.dot,
  complete: STAGE_TONES.complete.dot,
}

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

  // No navigation here: signOut sets the flag that sends ProtectedRoute to the landing
  // page (see AuthContext). Navigating as well only adds a duplicate history entry, so
  // that Back appears to do nothing once.
  async function handleSignOut() {
    await signOut()
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <TopBar user={user} onSignOut={handleSignOut} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          active="my-reviews"
          onNavigate={(key) => {
            const route = ROUTE_FOR_NAV_KEY[key]
            if (route) navigate(route)
          }}
        />

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6">
            <PageHeader onNewReview={() => navigate('/reviews/new')} />

            {error ? (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
                <p>{error}</p>
              </div>
            ) : null}

            {notice ? (
              <div
                role="status"
                className="mt-5 flex items-start justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
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
              <>
                <SummaryCards counts={statusCounts} />

                <div className="mt-5 flex flex-wrap items-center gap-3">
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

                  <label className="relative shrink-0">
                    <span className="sr-only">Sort reviews</span>
                    <ArrowUpDown
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
                      strokeWidth={1.9}
                    />
                    <select
                      value={sort}
                      onChange={(event) => setSort(event.target.value)}
                      className="appearance-none rounded-xl border border-neutral-200 bg-white py-3 pl-10 pr-9 text-sm font-semibold text-brand-black focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
                    >
                      {Object.entries(SORT_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {PROGRESS_FILTERS.map(({ key, label }) => {
                    const isActive = filter === key
                    const count = statusCounts[key] ?? 0
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setFilter(key)
                          setPage(1)
                        }}
                        aria-pressed={isActive}
                        // Empty buckets stay clickable but recede: hiding them would
                        // make the row jump around as work moves between stages.
                        className={`flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? 'border-brand-blue/40 bg-blue-50 text-brand-blue'
                            : count === 0
                              ? 'border-neutral-200 bg-white text-neutral-400 hover:bg-neutral-50'
                              : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                        }`}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${FILTER_DOTS[key]} ${count === 0 && !isActive ? 'opacity-40' : ''}`}
                        />
                        {label}
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                            isActive ? 'bg-white text-brand-blue' : 'bg-neutral-100 text-neutral-500'
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : null}

            {loading ? (
              <div className="mt-16 text-center">
                <Loader2 className="mx-auto h-7 w-7 animate-spin text-brand-blue" strokeWidth={1.8} />
                <p className="mt-3 text-sm text-neutral-500">Loading your reviews&hellip;</p>
              </div>
            ) : reviews.length === 0 && !error ? (
              <EmptyState onNewReview={() => navigate('/reviews/new')} />
            ) : visible.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-dashed border-neutral-200 bg-white p-12 text-center">
                <p className="text-sm text-neutral-500">
                  No reviews match {query.trim() ? `“${query.trim()}”` : 'this filter'}.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('')
                    setFilter('all')
                  }}
                  className="mt-3 text-sm font-semibold text-brand-blue hover:underline"
                >
                  Clear search and filters
                </button>
              </div>
            ) : (
              <>
                <ul className="mt-4 grid gap-3">
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

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
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

                <KeepBuilding onNewReview={() => navigate('/reviews/new')} />
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

/* -------------------------------------------------------------------- header ----- */

function PageHeader({ onNewReview }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-brand-blue">
          <FolderOpen className="h-6 w-6" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-brand-black">My Reviews</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            Each review is one research question, its protocol, and the papers screened
            against it.
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <SearchArt />
        <button
          type="button"
          onClick={onNewReview}
          className="flex items-center gap-2 rounded-xl bg-brand-blue px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-blue-dark"
        >
          <Plus className="h-4 w-4" strokeWidth={2.4} />
          New Review
        </button>
      </div>
    </header>
  )
}

/** Decorative, and hidden where it would crowd the buttons rather than shrunk to a smudge. */
function SearchArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 132 64" className="hidden h-16 w-[132px] xl:block">
      <g transform="rotate(-7 44 34)">
        <rect x="18" y="10" width="42" height="52" rx="5" fill="#fff" stroke="#bfdbfe" />
        {[20, 30, 40].map((y) => (
          <rect key={y} x="26" y={y} width="26" height="4" rx="2" fill="#dbeafe" />
        ))}
      </g>
      <g transform="rotate(6 66 32)">
        <rect x="46" y="6" width="42" height="52" rx="5" fill="#fff" stroke="#bfdbfe" />
        {[16, 26, 36].map((y) => (
          <rect key={y} x="54" y={y} width="26" height="4" rx="2" fill="#dbeafe" />
        ))}
        <rect x="54" y="46" width="14" height="4" rx="2" fill="#93c5fd" />
      </g>
      <g stroke="#2563eb" strokeWidth="4" fill="none" strokeLinecap="round">
        <circle cx="72" cy="38" r="15" fill="#eff6ff" fillOpacity="0.92" />
        <line x1="83" y1="49" x2="93" y2="59" />
      </g>
    </svg>
  )
}

/* ------------------------------------------------------------------ summary ------ */

/**
 * Four totals across the whole list.
 *
 * "Needs your input" folds two stages together on purpose: a review whose criteria were
 * ambiguous and one whose papers are screened and waiting are both stalled on the same
 * person, and separating them here would bury the number that says how much is on you.
 * The pills below still split them apart for anyone who wants that.
 */
function SummaryCards({ counts }) {
  const cards = [
    {
      label: 'Total reviews',
      value: counts.all ?? 0,
      icon: FileText,
      tone: 'bg-blue-50 text-brand-blue',
      wave: '#bfdbfe',
    },
    {
      label: 'In progress',
      value: counts.screening ?? 0,
      icon: RefreshCw,
      tone: 'bg-amber-50 text-amber-600',
      wave: '#fde68a',
      hint: 'being screened',
    },
    {
      label: 'Completed',
      value: counts.complete ?? 0,
      icon: CheckCircle2,
      tone: 'bg-emerald-50 text-emerald-600',
      wave: '#a7f3d0',
      hint: 'every paper decided',
    },
    {
      label: 'Needs your input',
      value: (counts.needs_you ?? 0) + (counts.ready ?? 0),
      icon: Clock,
      tone: 'bg-rose-50 text-rose-600',
      wave: '#fecdd3',
      hint: 'waiting on you',
    },
  ]

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ label, value, icon: Icon, tone, wave, hint }) => (
        <div
          key={label}
          className="relative min-w-0 overflow-hidden rounded-2xl border border-neutral-100 bg-white p-4"
        >
          {/* A shape, not a chart: it tints the card by category without pretending to
              plot anything. Real data would need a real axis. */}
          <svg
            aria-hidden="true"
            viewBox="0 0 200 60"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-9 w-full"
          >
            <path d="M0 42 C 40 14, 70 52, 110 30 S 170 8, 200 26 L200 60 L0 60 Z" fill={wave} opacity="0.35" />
          </svg>

          <div className="relative flex items-center gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
              <Icon className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-tight tabular-nums text-brand-black">
                {value}
              </p>
              <p className="truncate text-sm text-neutral-500">{label}</p>
            </div>
          </div>
          {hint ? (
            <p className="relative mt-2 truncate text-[11px] font-medium text-neutral-500">{hint}</p>
          ) : (
            <p className="relative mt-2 text-[11px] text-neutral-400">&nbsp;</p>
          )}
        </div>
      ))}
    </div>
  )
}

/* --------------------------------------------------------------------- card ------ */

function ReviewCard({ review, index, counts, progress, onOpen, onDelete }) {
  const protocol = review.protocol ?? {}
  const chips = [protocol.population, protocol.condition, protocol.intervention].filter(Boolean)
  const screened = counts?.screened ?? 0
  const total = counts?.total ?? 0
  const tone = STAGE_TONES[progress?.key] ?? FALLBACK_TONE

  return (
    <li className="group relative overflow-hidden rounded-2xl border border-neutral-100 bg-white transition-all hover:border-brand-blue/40 hover:shadow-sm">
      {/* The stage, as a colour, before a single word is read. */}
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${tone.edge}`} />

      {/* Wraps on a phone: keeping the badge and buttons in their own column there
          squeezed the question into four or five lines. Below sm they drop onto a row
          of their own and the title gets the full width. */}
      <div className="flex flex-wrap gap-4 py-4 pl-6 pr-4 sm:flex-nowrap sm:pl-7 sm:pr-5">
        <div
          className={`flex h-[62px] w-[62px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl ${tone.tile}`}
        >
          <FileText className="h-5 w-5" strokeWidth={1.8} />
          <span className="text-xs font-bold tabular-nums">
            {String(index + 1).padStart(2, '0')}
          </span>
        </div>

        <div className="min-w-0 flex-1 basis-[180px]">
          <button type="button" onClick={onOpen} className="block w-full text-left">
            <h2 className="text-base font-bold leading-snug text-brand-blue group-hover:underline">
              {review.research_question}
            </h2>
          </button>

          {chips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-neutral-600"
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

          {/* How far along, for the stages where that is a real question. A label
              cannot separate "just started" from "nearly done". */}
          {total > 0 && screened < total ? (
            <div className="mt-2.5 h-1.5 max-w-[320px] overflow-hidden rounded-full bg-neutral-100">
              <div
                className={`h-full rounded-full ${tone.edge}`}
                style={{ width: `${Math.round((screened / total) * 100)}%` }}
              />
            </div>
          ) : null}
        </div>

        <div className="flex w-full shrink-0 items-center justify-between gap-3 sm:w-auto sm:flex-col sm:items-end">
          <div className="text-right">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${progress?.tone ?? ''}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${progress?.dot ?? ''}`} />
              {progress?.label}
            </span>
            {progress?.detail ? (
              <p className="mt-1 text-[11px] text-neutral-400">{progress.detail}</p>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpen}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-brand-black transition-colors hover:bg-neutral-50"
            >
              <Eye className="h-4 w-4" strokeWidth={1.9} />
              View
            </button>
            <RowMenu review={review} onOpen={onOpen} onDelete={onDelete} />
          </div>
        </div>
      </div>
    </li>
  )
}

/**
 * The row's overflow menu.
 *
 * Delete used to be a bare bin icon on every row - one mis-click from destroying a
 * review and every paper and audit event under it. Behind a menu it takes a deliberate
 * second action, and the confirmation dialog still stands behind that.
 */
function RowMenu({ review, onOpen, onDelete }) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(event) {
      if (!wrapper.current?.contains(event.target)) setOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${review.research_question}`}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-500 transition-colors hover:bg-neutral-50"
      >
        <MoreVertical className="h-4 w-4" strokeWidth={2} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1.5 w-44 overflow-hidden rounded-xl border border-neutral-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onOpen()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-brand-black transition-colors hover:bg-neutral-50"
          >
            <Eye className="h-4 w-4" strokeWidth={1.9} />
            Open review
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.9} />
            Delete review
          </button>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ footers ------ */

function KeepBuilding({ onNewReview }) {
  return (
    <section className="relative mt-5 mb-4 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white p-5">
      <svg
        aria-hidden="true"
        viewBox="0 0 220 60"
        className="pointer-events-none absolute bottom-3 right-52 hidden h-14 w-[220px] lg:block"
      >
        <path
          d="M4 52 C 40 48, 58 22, 92 28 S 150 34, 186 8"
          fill="none"
          stroke="#93c5fd"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path d="M176 6 L190 5 L188 19" fill="none" stroke="#93c5fd" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-brand-blue ring-1 ring-blue-100">
            <TrendingUp className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <p className="text-base font-bold text-brand-black">Keep building evidence.</p>
            <p className="mt-0.5 text-sm text-neutral-600">
              Every review you finish is one more question answered from the literature
              rather than from memory.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onNewReview}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-brand-blue px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-blue-dark"
        >
          <Plus className="h-4 w-4" strokeWidth={2.4} />
          New Review
        </button>
      </div>
    </section>
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
    <div className="mt-8 rounded-2xl border border-dashed border-blue-200 bg-white p-10 text-center">
      <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-brand-blue">
        <FilePlus2 className="h-6 w-6" strokeWidth={1.7} />
      </span>
      <h2 className="text-lg font-bold text-brand-black">No reviews yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-500">
        Start one by entering your research question and your inclusion and exclusion
        criteria. EvidenceIQ will turn them into a protocol, search PubMed, and screen
        every result against it.
      </p>
      <button
        type="button"
        onClick={onNewReview}
        className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark"
      >
        <FilePlus2 className="h-4 w-4" strokeWidth={1.9} />
        New Review
      </button>
    </div>
  )
}
