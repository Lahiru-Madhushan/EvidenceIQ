import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FilePlus2,
  FolderOpen,
  Layers,
  Loader2,
  MessageCircleQuestion,
  MessageSquareText,
  ScanSearch,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react'

import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import { useAuth } from '../context/AuthContext'
import { ROUTE_FOR_NAV_KEY } from '../lib/navigation'
import { reviewProgress } from '../lib/reviewProgress'
import { getPaperCountsByReview, listRecentPapers, listReviews } from '../lib/reviewsApi'

/**
 * The landing page after signing in.
 *
 * Deliberately not the review list - that is its own page. This answers the questions
 * you have before you pick a review: how much work is outstanding, which reviews are
 * blocked on me, and where did the two agents disagree. Everything on it is a way in to
 * something specific rather than a number for its own sake.
 *
 * On the palette: white carries the page, blue carries structure and anything
 * actionable, and the remaining colours are reserved for state that means something -
 * amber for "a human is blocking this", emerald for settled, violet for finished. A
 * colour used decoratively here would make the colours that report status unreadable.
 */
export default function DashboardHome() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const [reviews, setReviews] = useState([])
  const [papers, setPapers] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([listReviews(), listRecentPapers(), getPaperCountsByReview()])
      .then(([loadedReviews, loadedPapers, loadedCounts]) => {
        setReviews(loadedReviews ?? [])
        setPapers(loadedPapers ?? [])
        setCounts(loadedCounts ?? {})
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false))
  }, [])

  // Decided-per-review, so the badges below can tell "screening" from "ready for you".
  const decidedByReview = useMemo(() => {
    const map = {}
    for (const paper of papers) {
      if (paper.researcher_status) map[paper.review_id] = (map[paper.review_id] ?? 0) + 1
    }
    return map
  }, [papers])

  // One pass, so every review carries the same badge the Reviews page gives it. Two
  // places deriving "what stage is this at" separately is how they end up disagreeing.
  const staged = useMemo(
    () =>
      reviews.map((review) => ({
        review,
        progress: reviewProgress(
          review,
          counts[review.id],
          decidedByReview[review.id] ?? 0
        ),
      })),
    [reviews, counts, decidedByReview]
  )

  const stats = useMemo(() => {
    const screened = papers.filter((paper) => paper.screened_at).length
    return {
      reviews: reviews.length,
      papers: papers.length,
      screened,
      approved: papers.filter((paper) => paper.researcher_status === 'approved').length,
      decided: papers.filter((paper) => paper.researcher_status != null).length,
      awaitingYou: papers.filter(
        (paper) => paper.researcher_status == null && paper.needs_human_review
      ),
      disagreements: papers.filter((paper) => paper.agreement === false).length,
    }
  }, [reviews, papers])

  const firstName = (user?.user_metadata?.full_name || user?.email || '').split(/[\s@]/)[0]

  function open(reviewId) {
    navigate(`/reviews/${reviewId}`)
  }

  // No navigation here: signOut sets the flag that sends ProtectedRoute to the landing
  // page (see AuthContext). Navigating as well only adds a duplicate history entry, so
  // that Back appears to do nothing once.
  async function handleSignOut() {
    await signOut()
  }

  return (
    <div className="app-canvas flex h-screen flex-col">
      <TopBar user={user} onSignOut={handleSignOut} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          active="dashboard"
          onNavigate={(key) => {
            const route = ROUTE_FOR_NAV_KEY[key]
            if (route) navigate(route)
          }}
        />

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6">
            <WelcomeBanner
              name={firstName}
              reviews={reviews}
              waiting={stats.awaitingYou}
              decided={stats.decided}
              total={stats.papers}
              onNewReview={() => navigate('/reviews/new')}
              onBrowse={() => navigate('/reviews')}
              onFocus={(reviewId) => navigate(`/reviews/${reviewId}?focus=1`)}
            />

            {error ? (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
                <p>{error}</p>
              </div>
            ) : null}

            {loading ? (
              <div className="mt-20 text-center">
                <Loader2 className="mx-auto h-7 w-7 animate-spin text-brand-blue" strokeWidth={1.8} />
                <p className="mt-3 text-sm text-neutral-500">Loading your workspace&hellip;</p>
              </div>
            ) : reviews.length === 0 ? (
              <FirstRun onNewReview={() => navigate('/reviews/new')} />
            ) : (
              <>
                <StatRow stats={stats} />
                <Pipeline staged={staged} />

                {/* items-start, or the grid stretches both columns to the tallest
                    and the reviews list ends in a slab of empty card. */}
                <div className="mt-5 grid items-start gap-5 lg:grid-cols-3">
                  <RecentReviews
                    staged={staged.slice(0, 5)}
                    onOpen={open}
                    onBrowse={() => navigate('/reviews')}
                  />

                  {/* min-w-0: a grid item defaults to min-width:auto, so the nowrap
                      review titles inside set a floor the track cannot go below and the
                      whole grid grows past the viewport on a phone. */}
                  <div className="min-w-0 space-y-5">
                    <CurrentReview staged={staged} onOpen={open} />
                    <QuickActions navigate={navigate} />
                  </div>
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------- banner ----- */

/** "Good morning" beats "Welcome back" at 7am and costs nothing. */
function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

// Seconds a flagged paper takes a researcher on average: read the reasons, glance at the
// quoted evidence, decide. A planning figure for the banner, not a measurement.
const SECONDS_PER_PAPER = 35

/**
 * The first thing seen after signing in: who is here, what is waiting, and the one
 * button that starts on it. Dark and bold on purpose - it is the only element on the
 * page that asks for action, and everything below it is reference.
 */
function WelcomeBanner({ name, reviews, waiting, decided, total, onNewReview, onBrowse, onFocus }) {
  const byReview = {}
  for (const paper of waiting) byReview[paper.review_id] = (byReview[paper.review_id] ?? 0) + 1
  const queues = Object.entries(byReview)
    .map(([id, count]) => ({ review: reviews.find((r) => r.id === id), count }))
    .filter((entry) => entry.review)
    .sort((a, b) => b.count - a.count)
  const minutes = Math.max(1, Math.round((waiting.length * SECONDS_PER_PAPER) / 60))
  const percent = total ? Math.round((decided / total) * 100) : 0

  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-hero-navy via-hero-deep to-hero-blue p-6 text-white shadow-[0_20px_50px_-20px_rgb(6_69_181/0.6)] sm:p-8">
      <HeroBackdrop />

      <div className="relative grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-blue-100 ring-1 ring-inset ring-white/15">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
            Evidence drives better care
          </p>

          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            {greeting()}
            {name ? `, ${name}` : ''}
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-blue-100">
            {waiting.length > 0 ? (
              <>
                <strong className="font-semibold text-white">
                  {waiting.length} paper{waiting.length === 1 ? '' : 's'}
                </strong>{' '}
                across {queues.length} review{queues.length === 1 ? '' : 's'} need your judgement
                — about{' '}
                <strong className="font-semibold text-white">
                  {minutes} minute{minutes === 1 ? '' : 's'}
                </strong>{' '}
                of focused work. The agents did the rest.
              </>
            ) : (
              <>
                Nothing is waiting on you. Four agents clarify, search and screen every paper
                twice — start a new question whenever you are ready.
              </>
            )}
          </p>

          <div className="mt-6 flex flex-wrap gap-2.5">
            {queues.length > 0 ? (
              <button
                type="button"
                onClick={() => onFocus(queues[0].review.id)}
                className="group inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-bold text-hero-deep shadow-lg shadow-black/10 transition-all hover:-translate-y-0.5 hover:shadow-xl"
              >
                <Zap className="h-4 w-4 fill-amber-400 text-amber-500" strokeWidth={2} />
                Start focus session
                <ArrowRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  strokeWidth={2.4}
                />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onNewReview}
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-colors ${
                queues.length > 0
                  ? 'bg-white/10 text-white ring-1 ring-inset ring-white/25 hover:bg-white/20'
                  : 'bg-white text-hero-deep shadow-lg shadow-black/10 hover:bg-blue-50'
              }`}
            >
              <FilePlus2 className="h-4 w-4" strokeWidth={2} />
              New review
            </button>
            <button
              type="button"
              onClick={onBrowse}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-blue-100 transition-colors hover:bg-white/10 hover:text-white"
            >
              <FolderOpen className="h-4 w-4" strokeWidth={2} />
              My reviews
            </button>
          </div>
        </div>

        {/* Glass card: overall progress, and the queues biggest first. */}
        <div className="min-w-0 rounded-2xl bg-white/10 p-5 ring-1 ring-inset ring-white/15 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <HeroRing percent={percent} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-blue-200">
                Your decisions
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {decided}
                <span className="text-base font-medium text-blue-200"> / {total}</span>
              </p>
              <p className="text-xs text-blue-200">papers signed off by you</p>
            </div>
          </div>

          <div className="mt-4 space-y-1 border-t border-white/10 pt-4">
            {queues.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-blue-100">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" strokeWidth={2.2} />
                All caught up
              </p>
            ) : (
              queues.slice(0, 3).map(({ review, count }) => (
                <button
                  key={review.id}
                  type="button"
                  onClick={() => onFocus(review.id)}
                  title={`Focus on ${count} paper(s) in this review`}
                  className="group flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/10"
                >
                  <span className="flex h-7 min-w-7 items-center justify-center rounded-lg bg-amber-400 px-1.5 text-xs font-bold tabular-nums text-hero-navy">
                    {count}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-white">
                    {review.research_question}
                  </span>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-blue-200 opacity-0 transition-opacity group-hover:opacity-100"
                    strokeWidth={2}
                  />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function HeroRing({ percent }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(255 255 255 / 0.15)" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="#fbbf24"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - percent / 100)}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums">
        {percent}%
      </span>
    </div>
  )
}

/** Soft light and a faint grid behind the banner. Decorative, so hidden from readers. */
function HeroBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute -right-24 -top-24 h-72 w-72 animate-glow-pulse rounded-full bg-hero-cyan/30 blur-3xl" />
      <div className="absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-indigo-400/20 blur-3xl" />
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgb(255 255 255) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse at 70% 30%, black, transparent 70%)',
        }}
      />
    </div>
  )
}

/* --------------------------------------------------------------------- stats ----- */

function StatRow({ stats }) {
  const screenedShare = stats.papers ? Math.round((stats.screened / stats.papers) * 100) : 0
  const decidedShare = stats.papers ? Math.round((stats.decided / stats.papers) * 100) : 0

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat
        icon={FolderOpen}
        tone="bg-blue-50 text-brand-blue"
        label="Reviews"
        value={stats.reviews}
        hint="research questions"
      />
      <Stat
        icon={Layers}
        tone="bg-indigo-50 text-indigo-600"
        label="Papers"
        value={stats.papers}
        hint={`${stats.screened.toLocaleString()} screened`}
        bar={{ percent: screenedShare, className: 'bg-indigo-500' }}
      />
      <Stat
        icon={CheckCircle2}
        tone="bg-emerald-50 text-emerald-600"
        label="Approved by you"
        value={stats.approved}
        hint={`${stats.decided} decided in total`}
        bar={{ percent: decidedShare, className: 'bg-emerald-500' }}
      />
      <Stat
        icon={Clock}
        tone="bg-amber-50 text-amber-600"
        label="Waiting on you"
        value={stats.awaitingYou.length}
        hint={
          stats.disagreements > 0
            ? `${stats.disagreements} agent disagreement${stats.disagreements === 1 ? '' : 's'}`
            : 'agents agreed everywhere'
        }
        emphasis={stats.awaitingYou.length > 0}
      />
    </div>
  )
}

/**
 * One number, and what it is a number of.
 *
 * The bar is the share the hint describes, not decoration - a review with 240 of 309
 * papers screened is in a different state from one with 12, and the figure alone does
 * not say which. It is omitted where there is no whole for the part to be of.
 */
function Stat({ icon: Icon, tone, label, value, hint, bar, emphasis }) {
  return (
    <div
      className={`rounded-2xl border bg-white p-5 transition-shadow hover:shadow-sm ${
        emphasis ? 'border-amber-200' : 'border-neutral-100'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-5 w-5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-neutral-500">{label}</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-brand-black">
            {value.toLocaleString()}
          </p>
          <p className="mt-0.5 truncate text-xs text-neutral-400">{hint}</p>
        </div>
      </div>

      {bar && bar.percent > 0 ? (
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100"
          role="presentation"
        >
          <div
            className={`h-full rounded-full ${bar.className}`}
            style={{ width: `${Math.min(100, bar.percent)}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ pipeline ----- */

// Each stage names the progress keys that sit in it, so the explainer can also report
// where your reviews actually are. `complete` belongs to no stage - it is past the end.
const STAGES = [
  {
    n: 1,
    name: 'Clarification',
    agent: 'Agent 1',
    icon: MessageCircleQuestion,
    text: 'Reads your intent, asks about anything ambiguous, and fixes the inclusion and exclusion criteria.',
    outcome: 'Ensures the right question',
    keys: ['needs_you', 'draft'],
    ring: 'bg-blue-50 text-brand-blue',
    badge: 'bg-brand-blue',
    pill: 'bg-blue-50 text-brand-blue',
  },
  {
    n: 2,
    name: 'Retrieval',
    agent: 'Agent 2',
    icon: ScanSearch,
    text: 'Turns the protocol into PubMed queries and pulls back every candidate paper.',
    outcome: 'Finds the best evidence',
    keys: ['no_papers'],
    ring: 'bg-violet-50 text-violet-600',
    badge: 'bg-violet-600',
    pill: 'bg-violet-50 text-violet-700',
  },
  {
    n: 3,
    name: 'Screening',
    agent: 'Agent 3',
    icon: Layers,
    text: 'Reads every title and abstract against your criteria and drafts an include or exclude.',
    outcome: 'Filters out the irrelevant',
    keys: ['screening'],
    ring: 'bg-emerald-50 text-emerald-600',
    badge: 'bg-emerald-600',
    pill: 'bg-emerald-50 text-emerald-700',
  },
  {
    n: 4,
    name: 'Verification',
    agent: 'Agent 4',
    icon: ShieldCheck,
    text: 'Re-checks every draft independently, quotes its evidence, and flags what needs you.',
    outcome: 'Ensures trustworthy results',
    keys: ['ready'],
    ring: 'bg-amber-50 text-amber-600',
    badge: 'bg-amber-500',
    pill: 'bg-amber-50 text-amber-700',
  },
]

/**
 * What the four agents do - and, on the same card, how many of your reviews are sitting
 * at each one right now.
 *
 * The counts are what stop this being wallpaper. A static explainer is read once and
 * then ignored forever; the same four boxes carrying live numbers answer "where is my
 * work stuck" at a glance, and keep earning their space on the page.
 */
function Pipeline({ staged }) {
  const complete = staged.filter(({ progress }) => progress.key === 'complete').length

  return (
    <section className="mt-5 rounded-2xl border border-slate-200/80 bg-white shadow-card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold text-brand-black">How EvidenceIQ works</h2>
        <p className="text-xs text-neutral-500">
          {complete > 0
            ? `${complete} of your ${staged.length} reviews ${complete === 1 ? 'is' : 'are'} through all four stages.`
            : 'Your reviews move left to right.'}
        </p>
      </div>

      <ol className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] lg:items-stretch">
        {STAGES.map((stage, index) => (
          <li key={stage.n} className="contents">
            <Stage stage={stage} count={staged.filter(({ progress }) => stage.keys.includes(progress.key)).length} />
            {index < STAGES.length - 1 ? (
              <span className="hidden items-center justify-center px-1 lg:flex" aria-hidden="true">
                <ArrowRight className="h-4 w-4 text-neutral-300" strokeWidth={2.2} />
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

function Stage({ stage, count }) {
  const { icon: Icon } = stage
  return (
    <div className="flex h-full flex-col rounded-xl border border-slate-200/80 bg-white shadow-card p-4 transition-colors hover:border-blue-200">
      <div className="flex items-start justify-between gap-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${stage.badge}`}
        >
          {stage.n}
        </span>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${stage.ring}`}>
          <Icon className="h-4 w-4" strokeWidth={1.9} />
        </span>
      </div>

      <p className="mt-2.5 text-sm font-bold leading-snug text-brand-black">
        {stage.name}
        <span className="ml-1 font-medium text-neutral-400">({stage.agent})</span>
      </p>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-neutral-500">{stage.text}</p>

      {/* Blank rather than "0 reviews" - a row of zeroes reads as "nothing works" - but
          the line still occupies its height, so the pills below stay on one baseline
          across all four cards whether or not a stage happens to be busy. */}
      <p className="mt-2 min-h-4 text-[11px] font-medium text-neutral-500">
        {count > 0 ? `${count} review${count === 1 ? '' : 's'} here now` : ''}
      </p>

      <p className={`mt-1.5 inline-flex w-fit items-center rounded-lg px-2 py-1 text-[11px] font-semibold ${stage.pill}`}>
        {stage.outcome}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------- reviews ----- */

function when(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function RecentReviews({ staged, onOpen, onBrowse }) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-card p-5 lg:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-brand-black">Recent reviews</h2>
        <button
          type="button"
          onClick={onBrowse}
          className="text-xs font-semibold text-brand-blue hover:underline"
        >
          See all
        </button>
      </div>

      <ul className="mt-2 divide-y divide-neutral-100">
        {staged.map(({ review, progress }) => (
          <li key={review.id}>
            <button
              type="button"
              onClick={() => onOpen(review.id)}
              className="group flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-blue-50/50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-brand-blue">
                <FolderOpen className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-brand-black">
                  {review.research_question}
                </span>
                <span className="mt-0.5 block truncate text-xs text-neutral-500">
                  {progress.detail}
                </span>
              </span>

              <span
                className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline ${progress.tone}`}
              >
                {progress.label}
              </span>
              <span className="hidden shrink-0 text-xs text-neutral-400 lg:inline">
                {when(review.created_at)}
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-neutral-300 transition-colors group-hover:text-brand-blue"
                strokeWidth={2}
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The one review to pick up next.
 *
 * Ordered by who is blocking whom: a review waiting on your answer is stalled until you
 * act, one with papers ready to decide is waiting on you too but still progressing, and
 * screening runs without you. Showing the most recent review instead would often point
 * at the one with nothing to do.
 */
const PRIORITY = ['needs_you', 'ready', 'screening', 'no_papers', 'draft', 'complete']

function CurrentReview({ staged, onOpen }) {
  const next = [...staged].sort(
    (a, b) => PRIORITY.indexOf(a.progress.key) - PRIORITY.indexOf(b.progress.key)
  )[0]
  if (!next) return null

  const { review, progress } = next
  const blocking = progress.key === 'needs_you'

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold text-brand-black">Pick up where you left off</h2>
      </div>

      <div
        className={`mt-3 rounded-xl border p-4 ${
          blocking ? 'border-amber-200 bg-amber-50/70' : 'border-blue-100 bg-blue-50/60'
        }`}
      >
        <p
          className={`flex items-center gap-1.5 text-xs font-semibold ${
            blocking ? 'text-amber-800' : 'text-brand-blue'
          }`}
        >
          {blocking ? (
            <MessageCircleQuestion className="h-3.5 w-3.5" strokeWidth={2} />
          ) : (
            <Clock className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          {blocking ? 'Agent 1 is waiting on you' : progress.label}
        </p>
        <p className={`mt-1 text-xs leading-relaxed ${blocking ? 'text-amber-800' : 'text-neutral-600'}`}>
          {blocking
            ? 'Criteria were ambiguous, and screening cannot start until you answer.'
            : progress.detail}
        </p>

        <p className="mt-3 text-sm font-semibold leading-snug text-brand-black">
          {review.research_question}
        </p>

        <button
          type="button"
          onClick={() => onOpen(review.id)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark"
        >
          Continue
          <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------- actions ---- */

function QuickActions({ navigate }) {
  const actions = [
    { icon: FilePlus2, label: 'New Review', hint: 'Start a research question', to: '/reviews/new' },
    { icon: FolderOpen, label: 'My Reviews', hint: 'View and manage', to: '/reviews' },
    { icon: MessageSquareText, label: 'Quick Chat', hint: 'Ask about a paper', to: '/quick-chat' },
    { icon: SettingsIcon, label: 'Settings', hint: 'Profile and plan', to: '/settings' },
  ]

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-card p-5">
      <h2 className="text-base font-bold text-brand-black">Quick actions</h2>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {actions.map(({ icon: Icon, label, hint, to }) => (
          <button
            key={label}
            type="button"
            onClick={() => navigate(to)}
            className="rounded-xl border border-slate-200/80 bg-white shadow-card p-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/50"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-brand-blue">
              <Icon className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <span className="mt-2 block text-sm font-semibold text-brand-black">{label}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-neutral-500">{hint}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ first run ---- */

function FirstRun({ onNewReview }) {
  return (
    <>
      <div className="mt-5 rounded-2xl border border-dashed border-blue-200 bg-white p-10 text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-brand-blue">
          <FilePlus2 className="h-6 w-6" strokeWidth={1.7} />
        </span>
        <h2 className="text-lg font-bold text-brand-black">Start your first review</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-500">
          Enter your research question and your inclusion and exclusion criteria in plain
          English. EvidenceIQ turns them into a protocol, searches PubMed, and screens
          every result twice before anything reaches you.
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

      {/* The explainer earns its place here most of all: nothing has run yet, so this
          is the only thing on the page that says what is about to happen. */}
      <Pipeline staged={[]} />
    </>
  )
}
