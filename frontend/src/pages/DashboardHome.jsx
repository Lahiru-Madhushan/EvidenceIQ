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
    <div className="flex h-screen flex-col bg-slate-50">
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
              onNewReview={() => navigate('/reviews/new')}
              onBrowse={() => navigate('/reviews')}
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

function WelcomeBanner({ name, onNewReview, onBrowse }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-blue-50/70 to-white p-6 sm:p-7">
      {/* Decorative only, and behind everything: the banner must read the same if it
          fails to paint. */}
      <PaperStackArt />

      <div className="relative max-w-xl">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-blue">
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
          Evidence drives better care
        </p>

        <h1 className="mt-2 text-2xl font-bold text-brand-black sm:text-3xl">
          {greeting()}
          {name ? `, ${name}` : ''}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          Four agents turn your question into evidence you can defend — one clarifies the
          criteria, one searches, and two screen every paper independently. You only read
          what genuinely needs a human.
        </p>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={onNewReview}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-blue-dark"
          >
            <FilePlus2 className="h-4 w-4" strokeWidth={2} />
            New Review
          </button>
          <button
            type="button"
            onClick={onBrowse}
            className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-brand-blue transition-colors hover:bg-blue-50"
          >
            <FolderOpen className="h-4 w-4" strokeWidth={2} />
            My Reviews
          </button>
        </div>
      </div>
    </section>
  )
}

/** Stacked papers under a magnifier, drawn rather than shipped as an image asset. */
function PaperStackArt() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 200"
      className="pointer-events-none absolute -right-4 top-0 hidden h-full w-[320px] opacity-90 md:block"
    >
      <circle cx="232" cy="96" r="88" fill="#2563eb" opacity="0.06" />
      <g transform="rotate(-8 190 110)">
        <rect x="150" y="48" width="78" height="104" rx="8" fill="#fff" stroke="#bfdbfe" />
        {[68, 84, 100, 116].map((y) => (
          <rect key={y} x="162" y={y} width="54" height="6" rx="3" fill="#dbeafe" />
        ))}
      </g>
      <g transform="rotate(7 250 100)">
        <rect x="222" y="40" width="78" height="104" rx="8" fill="#fff" stroke="#bfdbfe" />
        {[60, 76, 92, 108].map((y) => (
          <rect key={y} x="234" y={y} width="54" height="6" rx="3" fill="#dbeafe" />
        ))}
        <rect x="234" y="124" width="30" height="6" rx="3" fill="#93c5fd" />
      </g>
      <g stroke="#2563eb" strokeWidth="7" fill="none" strokeLinecap="round">
        <circle cx="203" cy="104" r="30" fill="#eff6ff" fillOpacity="0.9" />
        <line x1="225" y1="126" x2="243" y2="144" />
      </g>
    </svg>
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
    <section className="mt-5 rounded-2xl border border-neutral-100 bg-white p-5 sm:p-6">
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
    <div className="flex h-full flex-col rounded-xl border border-neutral-100 bg-white p-4 transition-colors hover:border-blue-200">
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
    <section className="min-w-0 rounded-2xl border border-neutral-100 bg-white p-5 lg:col-span-2">
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
    <section className="rounded-2xl border border-neutral-100 bg-white p-5">
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
    <section className="rounded-2xl border border-neutral-100 bg-white p-5">
      <h2 className="text-base font-bold text-brand-black">Quick actions</h2>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {actions.map(({ icon: Icon, label, hint, to }) => (
          <button
            key={label}
            type="button"
            onClick={() => navigate(to)}
            className="rounded-xl border border-neutral-100 bg-white p-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/50"
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
