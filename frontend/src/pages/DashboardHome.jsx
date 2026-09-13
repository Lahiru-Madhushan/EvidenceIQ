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
  ScanSearch,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import { useAuth } from '../context/AuthContext'
import { ROUTE_FOR_NAV_KEY } from '../lib/navigation'
import { listReviews, listRecentPapers } from '../lib/reviewsApi'

/**
 * The landing page after signing in.
 *
 * Deliberately not the review list - that is its own page. This answers the questions
 * you have before you pick a review: how much work is outstanding, which reviews are
 * blocked on me, and where did the two agents disagree. Everything on it is a way in to
 * something specific, rather than a number for its own sake.
 */
export default function DashboardHome() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const [reviews, setReviews] = useState([])
  const [papers, setPapers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([listReviews(), listRecentPapers()])
      .then(([loadedReviews, loadedPapers]) => {
        setReviews(loadedReviews ?? [])
        setPapers(loadedPapers ?? [])
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false))
  }, [])

  const stats = useMemo(() => {
    const decided = papers.filter((paper) => paper.researcher_status != null)
    return {
      reviews: reviews.length,
      papers: papers.length,
      screened: papers.filter((paper) => paper.screened_at).length,
      approved: papers.filter((paper) => paper.researcher_status === 'approved').length,
      awaitingYou: papers.filter(
        (paper) => paper.researcher_status == null && paper.needs_human_review
      ),
      disagreements: papers.filter((paper) => paper.agreement === false).length,
      decided: decided.length,
    }
  }, [reviews, papers])

  const blocked = reviews.filter((review) => review.status === 'awaiting_clarification')
  const firstName = (user?.user_metadata?.full_name || user?.email || '').split(/[\s@]/)[0]

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
        <Sidebar active="dashboard" onNavigate={handleNav} />

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
            <Hero
              name={firstName}
              reviewCount={reviews.length}
              onNewReview={() => navigate('/reviews/new')}
              onBrowse={() => navigate('/reviews')}
            />

            {error ? (
              <div
                role="alert"
                className="mt-6 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
                <p>{error}</p>
              </div>
            ) : null}

            {loading ? (
              <div className="mt-16 text-center">
                <Loader2
                  className="mx-auto h-7 w-7 animate-spin text-brand-blue"
                  strokeWidth={1.8}
                />
                <p className="mt-3 text-sm text-neutral-500">Loading your workspace…</p>
              </div>
            ) : reviews.length === 0 ? (
              <FirstRun onNewReview={() => navigate('/reviews/new')} />
            ) : (
              <>
                <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Stat
                    icon={FolderOpen}
                    tone="text-brand-blue bg-blue-50"
                    label="Reviews"
                    value={stats.reviews}
                    hint="research questions"
                  />
                  <Stat
                    icon={Layers}
                    tone="text-indigo-600 bg-indigo-50"
                    label="Papers"
                    value={stats.papers}
                    hint={`${stats.screened} screened`}
                  />
                  <Stat
                    icon={CheckCircle2}
                    tone="text-emerald-600 bg-emerald-50"
                    label="Approved by you"
                    value={stats.approved}
                    hint={`${stats.decided} decided in total`}
                  />
                  <Stat
                    icon={Clock}
                    tone="text-amber-600 bg-amber-50"
                    label="Waiting on you"
                    value={stats.awaitingYou.length}
                    hint={
                      stats.disagreements > 0
                        ? `${stats.disagreements} agent disagreement(s)`
                        : 'agents agreed everywhere'
                    }
                  />
                </div>

                {blocked.length > 0 ? (
                  <section className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
                    <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <MessageCircleQuestion className="h-4 w-4" strokeWidth={1.9} />
                      Agent 1 is waiting on you
                    </h2>
                    <p className="mt-1 text-sm text-amber-900">
                      {blocked.length === 1 ? 'One review has' : `${blocked.length} reviews have`}{' '}
                      criteria that were ambiguous. Screening cannot start until you answer.
                    </p>
                    <ul className="mt-3 grid gap-2">
                      {blocked.map((review) => (
                        <li key={review.id}>
                          <button
                            type="button"
                            onClick={() => navigate(`/reviews/${review.id}`)}
                            className="flex w-full items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-left text-sm transition-colors hover:bg-amber-50"
                          >
                            <span className="min-w-0 truncate font-medium text-brand-black">
                              {review.research_question}
                            </span>
                            <ArrowRight
                              className="h-4 w-4 shrink-0 text-amber-600"
                              strokeWidth={2}
                            />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <div className="mt-4 grid gap-4 lg:grid-cols-5">
                  <NeedsYou
                    papers={stats.awaitingYou}
                    reviews={reviews}
                    onOpen={(paper) => navigate(`/reviews/${paper.review_id}`)}
                  />
                  <RecentReviews
                    reviews={reviews.slice(0, 5)}
                    onOpen={(review) => navigate(`/reviews/${review.id}`)}
                    onBrowse={() => navigate('/reviews')}
                  />
                </div>

                <HowItWorks />
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function Hero({ name, reviewCount, onNewReview, onBrowse }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-blue to-indigo-600 p-6 text-white sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-white/80">
            <Sparkles className="h-4 w-4" strokeWidth={2} />
            EvidenceIQ
          </p>
          <h1 className="mt-2 text-2xl font-bold sm:text-3xl">
            {name ? `Welcome back, ${name}` : 'Welcome back'}
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-white/85">
            Four agents work through your systematic review: one turns your criteria into
            exact rules, one searches PubMed, and two screen every paper independently —
            so you only read the ones that need a human.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={onNewReview}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-brand-blue transition-colors hover:bg-white/90"
          >
            <FilePlus2 className="h-4 w-4" strokeWidth={2} />
            New Review
          </button>
          {reviewCount > 0 ? (
            <button
              type="button"
              onClick={onBrowse}
              className="inline-flex items-center gap-2 rounded-lg bg-white/15 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-inset ring-white/30 transition-colors hover:bg-white/25"
            >
              <FolderOpen className="h-4 w-4" strokeWidth={2} />
              My Reviews
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function Stat({ icon: Icon, tone, label, value, hint }) {
  return (
    <div className="rounded-2xl border border-neutral-100 bg-white p-5">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}
        >
          <Icon className="h-5 w-5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-neutral-500">{label}</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-brand-black">
            {value.toLocaleString()}
          </p>
          <p className="mt-0.5 truncate text-xs text-neutral-400">{hint}</p>
        </div>
      </div>
    </div>
  )
}

function NeedsYou({ papers, reviews, onOpen }) {
  const titleFor = (reviewId) =>
    reviews.find((review) => review.id === reviewId)?.research_question ?? 'Review'

  return (
    <section className="rounded-2xl border border-neutral-100 bg-white p-5 lg:col-span-3">
      <h2 className="text-sm font-semibold text-brand-black">Needs your decision</h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        Papers where the agents disagreed, confidence was low, or the abstract looked
        suspicious. Everything else the agents settled between them.
      </p>

      {papers.length === 0 ? (
        <div className="mt-6 rounded-xl bg-emerald-50 px-4 py-5 text-center">
          <ShieldCheck
            className="mx-auto h-6 w-6 text-emerald-600"
            strokeWidth={1.8}
          />
          <p className="mt-2 text-sm font-medium text-emerald-800">You are all caught up</p>
          <p className="mt-0.5 text-xs text-emerald-700">
            Nothing is waiting on a human right now.
          </p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-100">
          {papers.slice(0, 5).map((paper) => (
            <li key={paper.id}>
              <button
                type="button"
                onClick={() => onOpen(paper)}
                className="w-full py-3 text-left transition-colors hover:bg-neutral-50"
              >
                <p className="line-clamp-2 text-sm font-medium text-brand-black">
                  {paper.title}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  <span className="truncate">{titleFor(paper.review_id)}</span>
                  {paper.agreement === false ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                      Agents disagreed
                    </span>
                  ) : null}
                  {paper.confidence === 'LOW' ? (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-neutral-600">
                      Low confidence
                    </span>
                  ) : null}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {papers.length > 5 ? (
        <p className="mt-3 text-xs text-neutral-400">
          and {papers.length - 5} more across your reviews.
        </p>
      ) : null}
    </section>
  )
}

function RecentReviews({ reviews, onOpen, onBrowse }) {
  return (
    <section className="rounded-2xl border border-neutral-100 bg-white p-5 lg:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-brand-black">Recent reviews</h2>
        <button
          type="button"
          onClick={onBrowse}
          className="text-xs font-medium text-brand-blue hover:underline"
        >
          See all
        </button>
      </div>

      <ul className="mt-3 divide-y divide-neutral-100">
        {reviews.map((review) => (
          <li key={review.id}>
            <button
              type="button"
              onClick={() => onOpen(review)}
              className="w-full py-3 text-left transition-colors hover:bg-neutral-50"
            >
              <p className="line-clamp-2 text-sm font-medium text-brand-black">
                {review.research_question}
              </p>
              <p className="mt-1 text-xs capitalize text-neutral-500">
                {(review.status ?? 'draft').replace(/_/g, ' ')}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

const PIPELINE = [
  { icon: MessageCircleQuestion, agent: 'Agent 1', text: 'Turns your criteria into exact rules, and asks if anything is ambiguous.' },
  { icon: ScanSearch, agent: 'Agent 2', text: 'Searches PubMed and pulls in every candidate paper.' },
  { icon: Layers, agent: 'Agent 3', text: 'Reads each abstract and drafts an include or exclude decision.' },
  { icon: ShieldCheck, agent: 'Agent 4', text: 'Re-checks every draft independently, and flags what needs you.' },
]

function HowItWorks() {
  return (
    <section className="mt-4 rounded-2xl border border-neutral-100 bg-white p-5">
      <h2 className="text-sm font-semibold text-brand-black">How a review runs</h2>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PIPELINE.map(({ icon: Icon, agent, text }) => (
          <li key={agent} className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-brand-blue">
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-brand-black">{agent}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function FirstRun({ onNewReview }) {
  return (
    <>
      <div className="mt-6 rounded-2xl border border-dashed border-neutral-200 bg-white p-10 text-center">
        <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-brand-blue">
          <FilePlus2 className="h-6 w-6" strokeWidth={1.7} />
        </span>
        <h2 className="text-lg font-semibold text-brand-black">Start your first review</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-neutral-500">
          Enter your research question and your inclusion and exclusion criteria in plain
          English. EvidenceIQ turns them into a protocol, searches PubMed, and screens
          every result twice before anything reaches you.
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
      <HowItWorks />
    </>
  )
}
