import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  FileText,
  FolderOpen,
  Info,
  Layers,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react'

import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import { useAuth } from '../context/AuthContext'
import PipelineProgress from '../components/dashboard/PipelineProgress'
import PaperFlow from '../components/dashboard/PaperFlow'
import CancelReviewDialog from '../components/dashboard/CancelReviewDialog'
import { answerClarification, submitCriteria } from '../lib/agentsApi'
import {
  estimatedToScreen,
  explainStop,
  harvestConfirmed,
  PHASE,
  screeningBudget,
  untilAborted,
} from '../lib/harvest'
import { ROUTE_FOR_NAV_KEY } from '../lib/navigation'
import { useSubscription } from '../lib/subscriptionApi'
import { avatarUrl, displayName } from '../lib/profileApi'
import { deleteReview, listReviews } from '../lib/reviewsApi'

// Mirrors the limits the API validates, so the form stops you before the server does.
const QUESTION_LIMIT = 1000
const CRITERIA_LIMIT = 5000
const QUERY_LIMIT = 500

const EXAMPLE_QUESTION =
  'Does aerobic exercise improve glycemic control in adults with type 2 diabetes?'
const EXAMPLE_CRITERIA =
  'Include randomized controlled trials of aerobic exercise in adults aged 18 and over ' +
  'with type 2 diabetes only, published 2015 to 2026. Exclude animal studies, type 1 ' +
  'diabetes, and review articles.'

const WHAT_HAPPENS = [
  { step: 1, text: 'Your criteria are analyzed by Agent 1' },
  { step: 2, text: 'Relevant papers are searched in PubMed by Agent 2' },
  { step: 3, text: 'Papers are screened by Agent 3' },
  { step: 4, text: 'Decisions are verified by Agent 4' },
]

const TIPS = [
  'Be specific about population, intervention, comparison and outcome.',
  'Name the study types you want (e.g. RCT, cohort).',
  'Add the filters that matter — date range, language.',
  'Exclusions are as useful as inclusions, and cut the noise.',
]

// Three claims about the pipeline, each one true of the code that runs. PubMed is the
// only source Agent 2 searches, so the banner says PubMed rather than "and more".
const BANNER_POINTS = [
  {
    icon: Sparkles,
    tone: 'bg-blue-50 text-brand-blue',
    title: 'AI enhanced',
    text: 'Criteria become a protocol',
  },
  {
    icon: Database,
    tone: 'bg-emerald-50 text-emerald-600',
    title: 'PubMed search',
    text: 'Queries built from your protocol',
  },
  {
    icon: ShieldCheck,
    tone: 'bg-violet-50 text-violet-600',
    title: 'Evidence focused',
    text: 'Every decision independently checked',
  },
]

/** A step that is not running has still finished if it has produced something. */
function doneIf(count) {
  return count > 0 ? 'done' : 'pending'
}

/** A title short enough to sit on one line of a running status. */
function truncate(text, limit = 60) {
  if (!text) return 'this paper'
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/**
 * One activity line for a paper both agents have now answered on.
 *
 * Names what the two of them jointly concluded rather than only the final label, because
 * "both agents accepted" and "the agents disagreed" are different events to a researcher
 * and the second one is the queue they will have to work through.
 */
function describePaper(paper, event) {
  const title = truncate(paper.title, 48)
  if (paper.error) return `${title} — failed: ${paper.error}`

  const draft = paper.draft?.decision
  const verified = paper.verification?.verified_decision
  if (!verified) return `${title} — screened, awaiting verification`
  if (draft !== verified) return `${title} — agents disagreed, flagged for you`
  if (verified === 'INCLUDE') {
    return `${title} — accepted by both (${event.confirmed} of ${event.target})`
  }
  return `${title} — excluded by both`
}

function clampPapers(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 1
  return Math.min(50, Math.max(1, Math.round(number)))
}

/**
 * Starting a review runs all four agents, one call each.
 *
 * The backend also exposes /api/pipeline/full, which does the whole chain in one
 * request - but it only returns once every agent has finished, so it cannot say which
 * agent is working right now. Driving the steps from here is what makes the progress
 * view real rather than a guess, and it uses the same endpoints in the same order.
 */
export default function NewReview() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    researchQuestion: '',
    rawCriteria: '',
    query: '',
    // The number of papers BOTH agents must accept, not the number to retrieve.
    // The pipeline keeps retrieving and screening until it reaches this many.
    targetAccepted: 10,
    // Narrows Agent 2's PubMed search. Separate from the protocol's own date range,
    // which is what Agents 3 and 4 screen against.
    yearFrom: '',
    yearTo: '',
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showHelp, setShowHelp] = useState(true)

  const [stage, setStage] = useState('form') // form | running | clarifying
  const [steps, setSteps] = useState({})
  const [activity, setActivity] = useState([])
  const [error, setError] = useState(null)
  // The live state of the run: which agent is working, on which paper, and the running
  // totals toward the target. Updated on every event the loop emits, which is several
  // times per paper rather than once per page.
  const [live, setLive] = useState(null)
  // Papers that have finished both agents, newest first. Capped - this is a running
  // view, not the results table, and the review page shows all of them afterwards.
  const [feed, setFeed] = useState([])
  // Mirrors the `cancelled` ref for the button's own label. The ref is what the loop
  // reads between papers - it must see the latest value without waiting for a render -
  // but a ref cannot drive one, so the label needs state of its own.
  const [stopping, setStopping] = useState(false)
  // A ref, not state: the loop reads it between rounds and must see the latest value
  // without waiting for a re-render.
  const cancelled = useRef(false)

  // The hard stop, as opposed to `cancelled` above, which waits for the paper in flight.
  // Aborting it interrupts whichever agent call is being waited on.
  const abortRef = useRef(null)
  // What the researcher chose in the cancel dialog: 'keep' or 'discard'. Read once the
  // run has unwound, to decide between opening the review and deleting it.
  const cancelIntent = useRef(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [notice, setNotice] = useState(null)

  // Set when Agent 1 stops the chain rather than guessing at an ambiguous term.
  const [clarification, setClarification] = useState(null)
  const [answer, setAnswer] = useState('')

  // Drives the "Ns elapsed" line on the running step. One timer for the whole card,
  // and only while something is actually running.
  const [now, setNow] = useState(() => Date.now())

  // Only for the "your reviews" card in the rail. A failure here must not stop you
  // starting a review, so it is swallowed rather than surfaced as a page error.
  const [recent, setRecent] = useState([])
  useEffect(() => {
    listReviews()
      .then((rows) => setRecent(rows ?? []))
      .catch(() => setRecent([]))
  }, [])
  const running = stage === 'running'
  useEffect(() => {
    if (!running) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const activityId = useRef(0)

  function log(text, tone = 'done') {
    activityId.current += 1
    setActivity((previous) => [
      ...previous,
      { id: activityId.current, text, tone, at: new Date().toISOString() },
    ])
  }

  function setStep(key, patch) {
    setSteps((previous) => ({ ...previous, [key]: { ...previous[key], ...patch } }))
  }

  function startStep(key, detail) {
    setStep(key, { status: 'running', startedAt: new Date().toISOString(), detail })
  }

  function finishStep(key, { facts, note } = {}) {
    setStep(key, {
      status: 'done',
      finishedAt: new Date().toISOString(),
      facts,
      note,
      detail: null,
    })
  }

  const yearRangeInvalid =
    Boolean(form.yearFrom) && Boolean(form.yearTo) && Number(form.yearFrom) > Number(form.yearTo)

  const canSubmit =
    form.researchQuestion.trim().length > 2 && form.rawCriteria.trim().length > 2

  function update(field, value) {
    setForm((previous) => ({ ...previous, [field]: value }))
  }

  /** Agents 2, 3 and 4, once a review exists with a protocol.
   *
   * Papers are fed through one at a time - Agent 3, then Agent 4, then the next paper -
   * rather than a page through each agent in turn. The researcher asked for a number of
   * papers both agents accept, and only running a paper all the way through makes that
   * count exact after every paper, so the run stops on the one that reaches the target
   * instead of finishing the page it was in. See lib/harvest.js.
   *
   * The loop emits an event at every hand-off, which is what lets the view below name
   * the agent that is working right now and the paper it is working on.
   */
  async function runRest(reviewId, signal) {
    const target = form.targetAccepted
    cancelled.current = false

    startStep('retrieval', 'Retrieving papers from PubMed…')
    log(`Looking for ${target} paper(s) both agents accept`, 'active')

    // The pmid of the paper whose completion has already been logged, so the activity
    // log gets one line per paper rather than one per event.
    let lastLogged = null

    const result = await harvestConfirmed({
      reviewId,
      query: form.query || form.researchQuestion,
      target,
      yearFrom: form.yearFrom,
      yearTo: form.yearTo,
      shouldContinue: () => !cancelled.current,
      signal,
      onEvent: (event) => {
        setLive(event)

        // Each row is "running" only while that agent holds the paper. Between papers
        // the loop is briefly in no phase at all, so a row that is not running falls
        // back to whether it has produced anything yet - otherwise every row flickered
        // to Pending after each paper, which reads as the pipeline restarting.
        setStep('retrieval', {
          status: event.phase === PHASE.RETRIEVING ? 'running' : doneIf(event.fetched),
          detail:
            event.phase === PHASE.RETRIEVING
              ? `Fetching page ${event.page} from PubMed…`
              : null,
          facts: [`${event.fetched} retrieved`, `${event.totalFound} found`],
        })
        setStep('screening', {
          status: event.phase === PHASE.SCREENING ? 'running' : doneIf(event.screened),
          detail:
            event.phase === PHASE.SCREENING
              ? `Agent 3 reading “${truncate(event.current?.title)}”…`
              : null,
          facts: [`${event.screened} screened`],
        })
        setStep('verification', {
          status: event.phase === PHASE.VERIFYING ? 'running' : doneIf(event.verified),
          detail:
            event.phase === PHASE.VERIFYING
              ? `Agent 4 re-checking “${truncate(event.current?.title)}”…`
              : null,
          facts: [`${event.confirmed} of ${event.target} accepted by both`],
        })

        // A paper is finished when both agents have answered on it. Logged once, with
        // what the two of them jointly concluded.
        const paper = event.current
        const finished =
          paper && (paper.verification || paper.error) && paper.pmid !== lastLogged
        if (finished) {
          lastLogged = paper.pmid
          setFeed((previous) => [paper, ...previous].slice(0, 12))
          log(describePaper(paper, event), paper.error ? 'error' : 'done')
        }
      },
    })

    setLive(result)

    const shortfall = result.confirmed < result.target
    finishStep('retrieval', {
      facts: [`${result.totalFound} found`, `${result.fetched} retrieved`],
    })
    finishStep('screening', {
      facts: [`${result.screened} screened`, `${result.page} page(s) fetched`],
    })
    setStep('verification', {
      status: shortfall ? 'blocked' : 'done',
      finishedAt: new Date().toISOString(),
      detail: null,
      facts: [`${result.confirmed} accepted by both`, `target ${result.target}`],
      note: shortfall ? explainStop(result) : null,
      waitingOn: shortfall ? explainStop(result) : undefined,
    })

    log(explainStop(result), shortfall ? 'error' : 'done')
  }

  /** Back to an empty run, keeping the form as typed so it can be adjusted and re-run. */
  function resetToForm(message) {
    setStage('form')
    setSteps({})
    setActivity([])
    setFeed([])
    setLive(null)
    setStopping(false)
    setCancelling(false)
    setClarification(null)
    setAnswer('')
    setNotice(message)
  }

  /** A fresh abort controller and a cleared cancel choice, for a run about to start. */
  function beginRun() {
    const controller = new AbortController()
    abortRef.current = controller
    cancelIntent.current = null
    setCancelling(false)
    setNotice(null)
    return controller.signal
  }

  /**
   * Deletes the review if the researcher chose to discard it. True when that happened,
   * so the caller does not go on to open a review that no longer exists.
   */
  async function discardIfAsked(reviewId) {
    if (cancelIntent.current !== 'discard') return false
    try {
      if (reviewId) await deleteReview(reviewId)
      resetToForm('Review cancelled and deleted. Your question and criteria are still here.')
    } catch (deleteError) {
      resetToForm(null)
      setError(deleteError.message)
    }
    return true
  }

  function handleCancel(intent) {
    setCancelOpen(false)
    cancelIntent.current = intent
    cancelled.current = true
    setCancelling(true)

    // Nothing is running while Agent 1 waits for an answer, so act directly.
    if (stage === 'clarifying') {
      if (intent === 'discard') discardIfAsked(clarification.reviewId)
      else navigate(`/reviews/${clarification.reviewId}`)
      return
    }

    log(intent === 'discard' ? 'Cancelling and deleting this review…' : 'Stopping now…', 'error')
    abortRef.current?.abort()
  }

  async function handleStart(event) {
    event.preventDefault()
    const signal = beginRun()
    setError(null)
    setSteps({})
    setActivity([])
    // Cleared together: a second run must not show the first run's papers, and the
    // cancel flag must not survive into it or the new run stops on its first paper.
    setFeed([])
    setLive(null)
    setStopping(false)
    cancelled.current = false
    setStage('running')

    startStep('criteria', 'Interpreting your inclusion and exclusion criteria…')
    log('Sending your criteria to Agent 1', 'active')

    // Kept apart from the race below: if the run is cancelled while Agent 1 is still
    // working, the review it creates arrives afterwards and still has to be deleted.
    const pending = submitCriteria(form)
    try {
      let result
      try {
        result = await untilAborted(pending, signal)
      } catch (abortError) {
        if (!signal.aborted) throw abortError
        pending.then((late) => late?.review_id && deleteReview(late.review_id)).catch(() => {})
        resetToForm('Review cancelled. Your question and criteria are still here.')
        return
      }

      // Agent 1 refused to guess. This is the system working, not a failure - screening
      // against a protocol the researcher never confirmed would be confidently wrong.
      if (result.status !== 'ready') {
        setStep('criteria', { status: 'blocked', detail: null })
        log('Agent 1 needs a term clarified', 'error')
        setClarification({
          reviewId: result.review_id,
          term: result.ambiguous_term,
          question: result.question,
        })
        setStage('clarifying')
        return
      }

      finishStep('criteria', { facts: ['Criteria parsed', 'Ready for search'] })
      log('Criteria successfully processed')

      await runRest(result.review_id, signal)
      if (await discardIfAsked(result.review_id)) return
      navigate(`/reviews/${result.review_id}`)
    } catch (runError) {
      setError(runError.message)
      setStage('form')
    }
  }

  /** Picks the chain back up once Agent 1's question is answered. */
  async function handleAnswer(event) {
    event.preventDefault()
    if (!answer.trim()) return

    const signal = beginRun()
    const reviewId = clarification.reviewId
    setError(null)
    setStage('running')
    startStep('criteria', 'Re-interpreting with your answer…')
    log('Sending your answer to Agent 1', 'active')

    try {
      let finalised
      try {
        finalised = await untilAborted(answerClarification(reviewId, answer.trim()), signal)
      } catch (abortError) {
        if (!signal.aborted) throw abortError
        if (!(await discardIfAsked(reviewId))) navigate(`/reviews/${reviewId}`)
        return
      }
      if (finalised.status !== 'ready') {
        // Agent 1 is still not satisfied - ask the next question rather than pressing on.
        setStep('criteria', { status: 'blocked', detail: null })
        setClarification({
          reviewId: finalised.review_id,
          term: finalised.ambiguous_term,
          question: finalised.question,
        })
        setAnswer('')
        setStage('clarifying')
        return
      }

      finishStep('criteria', { facts: ['Criteria parsed', 'Ready for search'] })
      log('Criteria successfully processed')

      await runRest(reviewId, signal)
      if (await discardIfAsked(reviewId)) return
      navigate(`/reviews/${reviewId}`)
    } catch (resumeError) {
      setError(resumeError.message)
      setStage('clarifying')
    }
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

  const field =
    'w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-3 text-sm text-brand-black placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:opacity-60'

  return (
    <div className="app-canvas flex h-screen flex-col">
      <TopBar user={user} onSignOut={handleSignOut} />

      <div className="flex min-h-0 flex-1">
        <Sidebar active="new-review" onNavigate={handleNav} />

        <main className="min-w-0 flex-1 overflow-y-auto bg-gradient-to-b from-blue-50/40 to-neutral-50">
          <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
            <button
              type="button"
              onClick={() => navigate('/reviews')}
              className="mb-3 flex items-center gap-1.5 text-sm font-medium text-brand-blue hover:underline"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={2} />
              Back to Reviews
            </button>

            <HeroBanner />

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0">
                {error ? (
                  <div
                    role="alert"
                    className="mt-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
                    <p>{error}</p>
                  </div>
                ) : null}

                {/* Kept mounted while clarifying too, so finished steps and the activity
                    log stay on screen behind Agent 1's question. */}
                {notice && stage === 'form' ? (
                  <p
                    role="status"
                    className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2} />
                    {notice}
                  </p>
                ) : null}

                {stage !== 'form' ? (
                  <>
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white shadow-card px-4 py-3">
                      <p className="text-sm text-neutral-600">
                        {cancelling
                          ? 'Cancelling…'
                          : stage === 'clarifying'
                            ? 'Waiting for your answer before screening starts.'
                            : 'Your review is running. You can cancel it at any time.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setCancelOpen(true)}
                        disabled={cancelling}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Ban className="h-4 w-4" strokeWidth={2} />
                        {cancelling ? 'Cancelling…' : 'Cancel review'}
                      </button>
                    </div>

                    <PipelineProgress steps={steps} activity={activity} now={now} />
                    {cancelOpen ? (
                      <CancelReviewDialog
                        screened={live?.screened ?? 0}
                        // Before Agent 1 answers there is no review yet, so nothing to keep.
                        canKeep={stage === 'clarifying' || live !== null}
                        onKeep={() => handleCancel('keep')}
                        onDiscard={() => handleCancel('discard')}
                        onClose={() => setCancelOpen(false)}
                      />
                    ) : null}
                    {/* The per-paper view. A run keeps spending model quota until its
                        target is met, so anything that decides for itself how long to
                        keep going needs a way to be told to stop - here that takes
                        effect after the paper in flight has been through both agents,
                        so nothing is left screened but unverified. */}
                    <PaperFlow
                      live={live}
                      feed={feed}
                      stopping={stopping}
                      onStop={() => {
                        cancelled.current = true
                        setStopping(true)
                        log('Stopping after this paper…', 'active')
                      }}
                    />
                  </>
                ) : null}

                {stage === 'clarifying' ? (
                  <form
                    onSubmit={handleAnswer}
                    className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/60 p-5"
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                      <MessageCircleQuestion className="h-4 w-4" strokeWidth={1.9} />
                      Agent 1 needs one thing cleared up
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-amber-900">
                      {clarification.question}
                    </p>
                    {clarification.term ? (
                      <p className="mt-1.5 text-xs text-amber-700">
                        Ambiguous term: <strong>{clarification.term}</strong>
                      </p>
                    ) : null}

                    <input
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      placeholder="e.g. type 2 diabetes only"
                      className={`${field} mt-3`}
                    />
                    <button
                      type="submit"
                      disabled={!answer.trim()}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-blue-dark disabled:opacity-60"
                    >
                      Continue
                    </button>
                  </form>
                ) : null}

                {stage === 'form' ? (
                  <form onSubmit={handleStart} className="mt-5 grid gap-4">
                    <Step
                      number={1}
                      icon={FileText}
                      tone="bg-blue-50 text-brand-blue"
                      title="Review details"
                      hint="Tell us what you want to research and we will find the evidence."
                    >
                      <ProfileRow user={user} />

                      <label
                        htmlFor="research-question"
                        className="mb-1.5 mt-4 block text-xs font-semibold text-brand-black"
                      >
                        Research question <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="research-question"
                        value={form.researchQuestion}
                        onChange={(event) => update('researchQuestion', event.target.value)}
                        maxLength={QUESTION_LIMIT}
                        placeholder={`e.g. ${EXAMPLE_QUESTION}`}
                        className={field}
                      />
                      <p className="mt-1 text-right text-xs tabular-nums text-neutral-400">
                        {form.researchQuestion.length}/{QUESTION_LIMIT}
                      </p>
                      {/* Clicking fills the field — an example you can only read is a
                          worse example than one you can start from. */}
                      <button
                        type="button"
                        onClick={() => update('researchQuestion', EXAMPLE_QUESTION)}
                        className="mt-2.5 flex w-full items-start gap-2 rounded-xl bg-blue-50/70 px-3.5 py-2.5 text-left text-xs leading-relaxed text-neutral-600 transition-colors hover:bg-blue-50"
                      >
                        <Sparkles
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue"
                          strokeWidth={2}
                        />
                        <span>
                          <strong className="font-semibold text-brand-black">Example:</strong>{' '}
                          {EXAMPLE_QUESTION}
                        </span>
                      </button>
                    </Step>

                    <Step
                      number={2}
                      icon={ListChecks}
                      tone="bg-violet-50 text-violet-600"
                      title="Inclusion and exclusion criteria"
                      hint="Plain English is fine. Be specific — if a term is ambiguous, Agent 1 will stop and ask rather than guess."
                    >
                      <textarea
                        value={form.rawCriteria}
                        onChange={(event) => update('rawCriteria', event.target.value)}
                        rows={6}
                        maxLength={CRITERIA_LIMIT}
                        placeholder={`Describe what should be included and excluded…\ne.g. ${EXAMPLE_CRITERIA}`}
                        className={field}
                      />
                      <div className="mt-1.5 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => update('rawCriteria', EXAMPLE_CRITERIA)}
                          className="text-xs font-medium text-brand-blue hover:underline"
                        >
                          Use the example
                        </button>
                        <span
                          className={`text-xs tabular-nums ${
                            form.rawCriteria.length > CRITERIA_LIMIT * 0.9
                              ? 'text-amber-600'
                              : 'text-neutral-400'
                          }`}
                        >
                          {form.rawCriteria.length}/{CRITERIA_LIMIT}
                        </span>
                      </div>
                    </Step>

                    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_240px]">
                      <Step
                        number={3}
                        icon={Search}
                        tone="bg-emerald-50 text-emerald-600"
                        title="PubMed search (optional)"
                        hint="Defaults to your research question."
                      >
                        <input
                          value={form.query}
                          onChange={(event) => update('query', event.target.value)}
                          maxLength={QUERY_LIMIT}
                          placeholder="e.g. aerobic exercise type 2 diabetes randomized controlled trial"
                          className={field}
                        />
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-neutral-400">
                          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
                          Leave empty to use the research question automatically.
                        </p>
                      </Step>

                      <Step
                        number={4}
                        icon={Layers}
                        tone="bg-amber-50 text-amber-600"
                        title="Papers to accept"
                        hint="Screening continues until this many pass."
                      >
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={form.targetAccepted}
                          onChange={(event) =>
                            update('targetAccepted', clampPapers(event.target.value))
                          }
                          className={field}
                        />
                        <p className="mt-2 text-xs text-neutral-400">
                          How many papers <strong className="font-semibold text-neutral-500">both
                          agents</strong> must accept. More are retrieved and screened as
                          needed &mdash; usually about {estimatedToScreen(form.targetAccepted)},
                          and never more than {screeningBudget(form.targetAccepted)}.
                        </p>
                      </Step>
                    </div>

                    {showAdvanced ? (
                      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-card p-4 sm:p-5">
                        <p className="text-sm font-semibold text-brand-black">
                          Publication years
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                          Narrows Agent 2&apos;s PubMed search. Separate from the date range
                          in your criteria, which is what Agents 3 and 4 screen against.
                        </p>
                        <div className="mt-3 flex flex-wrap items-end gap-3">
                          <label className="text-xs text-neutral-500">
                            From
                            <input
                              type="number"
                              min={1800}
                              max={2100}
                              value={form.yearFrom}
                              onChange={(event) => update('yearFrom', event.target.value)}
                              placeholder="2015"
                              className={`${field} mt-1 w-28`}
                            />
                          </label>
                          <label className="text-xs text-neutral-500">
                            To
                            <input
                              type="number"
                              min={1800}
                              max={2100}
                              value={form.yearTo}
                              onChange={(event) => update('yearTo', event.target.value)}
                              placeholder="2026"
                              className={`${field} mt-1 w-28`}
                            />
                          </label>
                        </div>
                        {yearRangeInvalid ? (
                          <p className="mt-2 text-xs text-red-600">
                            The first year must not be after the second.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-4 pb-4">
                      <button
                        type="submit"
                        disabled={!canSubmit || yearRangeInvalid}
                        className="inline-flex items-center gap-2 rounded-xl bg-brand-blue px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-blue-dark disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <Play className="h-4 w-4" strokeWidth={2.2} />
                        Start review
                      </button>

                      <p className="flex items-center gap-1.5 text-xs text-neutral-500">
                        <Clock className="h-3.5 w-3.5" strokeWidth={1.9} />
                        This runs all four agents and can take a minute.
                      </p>

                      <button
                        type="button"
                        onClick={() => setShowAdvanced((open) => !open)}
                        aria-expanded={showAdvanced}
                        className="ml-auto flex items-center gap-1.5 text-xs font-medium text-neutral-500 transition-colors hover:text-brand-black"
                      >
                        <Settings2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                        Advanced options
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${
                            showAdvanced ? 'rotate-180' : ''
                          }`}
                          strokeWidth={2}
                        />
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>

              <aside className="grid content-start gap-4">
                <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                  <button
                    type="button"
                    onClick={() => setShowHelp((open) => !open)}
                    aria-expanded={showHelp}
                    className="flex w-full items-start gap-3 text-left"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-blue">
                      <Lightbulb className="h-[18px] w-[18px]" strokeWidth={1.9} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-brand-black">
                        Not sure how to write this?
                      </span>
                      {showHelp ? (
                        <span className="mt-1 block text-xs leading-relaxed text-neutral-600">
                          Write in plain English. Agent 1 stops and asks about anything
                          ambiguous rather than guessing at what you meant, so a rough
                          first attempt is a fine place to start.
                        </span>
                      ) : null}
                    </span>
                    <ChevronDown
                      className={`mt-1 h-4 w-4 shrink-0 text-neutral-400 transition-transform ${
                        showHelp ? 'rotate-180' : ''
                      }`}
                      strokeWidth={2}
                    />
                  </button>
                </section>

                <section className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-brand-black">
                    <Target className="h-[18px] w-[18px] text-emerald-600" strokeWidth={2} />
                    Quick tips
                  </h2>
                  <ol className="mt-4 space-y-3">
                    {TIPS.map((tip, index) => (
                      <li key={tip} className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold tabular-nums text-emerald-700 ring-1 ring-inset ring-emerald-100">
                          {index + 1}
                        </span>
                        <span className="text-xs leading-relaxed text-neutral-700">{tip}</span>
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="rounded-2xl border border-violet-100 bg-violet-50/40 p-5">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-brand-black">
                    <Layers className="h-[18px] w-[18px] text-violet-600" strokeWidth={1.9} />
                    What happens next
                  </h2>
                  <ol className="mt-4 space-y-3">
                    {WHAT_HAPPENS.map(({ step, text }, index) => (
                      <li key={step} className="flex gap-3">
                        <span className="flex flex-col items-center">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold tabular-nums text-violet-700 ring-1 ring-inset ring-violet-100">
                            {step}
                          </span>
                          {index < WHAT_HAPPENS.length - 1 ? (
                            <span aria-hidden className="mt-1 w-px flex-1 bg-violet-200" />
                          ) : null}
                        </span>
                        <span className="pb-1 text-xs leading-relaxed text-neutral-700">
                          {text}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>

                <YourReviews reviews={recent} onOpen={(id) => navigate(`/reviews/${id}`)} onBrowse={() => navigate('/reviews')} />
              </aside>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

/**
 * The page's banner, and three true statements about what starting a review does.
 *
 * Each claim is checkable against the pipeline: Agent 1 turns criteria into a protocol,
 * Agent 2 queries PubMed, Agents 3 and 4 screen independently. PubMed is the only
 * source that is actually searched, so the banner does not offer "and more".
 */
function HeroBanner() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-blue-50/60 to-white p-5 sm:p-6">
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-brand-blue ring-1 ring-blue-100">
            <FileText className="h-6 w-6" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-brand-black sm:text-3xl">New Review</h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-neutral-600">
              Describe your question and criteria in plain English. EvidenceIQ turns them
              into a screening protocol, searches PubMed, and screens every result twice.
            </p>
          </div>
        </div>

        <ReviewArt />
      </div>

      <div className="relative mt-5 grid gap-3 sm:grid-cols-3">
        {BANNER_POINTS.map(({ icon: Icon, tone, title, text }) => (
          <div
            key={title}
            className="flex items-center gap-2.5 rounded-xl border border-white bg-white/80 p-3"
          >
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-brand-black">{title}</span>
              <span className="mt-0.5 block truncate text-[11px] text-neutral-500">{text}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function ReviewArt() {
  return (
    <svg aria-hidden="true" viewBox="0 0 180 96" className="hidden h-24 w-[180px] shrink-0 lg:block">
      <g transform="rotate(-7 70 50)">
        <rect x="44" y="14" width="56" height="70" rx="6" fill="#fff" stroke="#bfdbfe" />
        {[26, 38, 50, 62] .map((y) => (
          <rect key={y} x="54" y={y} width="36" height="5" rx="2.5" fill="#dbeafe" />
        ))}
      </g>
      <g transform="rotate(6 108 46)">
        <rect x="84" y="8" width="56" height="70" rx="6" fill="#fff" stroke="#bfdbfe" />
        {[20, 32, 44, 56].map((y) => (
          <rect key={y} x="94" y={y} width="36" height="5" rx="2.5" fill="#dbeafe" />
        ))}
      </g>
      <g stroke="#2563eb" strokeWidth="5" fill="none" strokeLinecap="round">
        <circle cx="120" cy="56" r="20" fill="#eff6ff" fillOpacity="0.92" />
        <line x1="135" y1="71" x2="148" y2="84" />
      </g>
    </svg>
  )
}

/**
 * Who is running this review, and what their plan allows.
 *
 * The figures are the plan's allowances, not a usage meter - nothing counts reviews per
 * month yet, and "2 of 3 used" would be a number nobody is keeping. Stated as limits,
 * they are true; stated as consumption, they would not be.
 */
function ProfileRow({ user }) {
  const { plan } = useSubscription()
  const name = displayName(user)
  const avatar = avatarUrl(user)
  const initial = (name || '?').charAt(0).toUpperCase()

  const stats = [
    { icon: FileText, tone: 'text-brand-blue bg-blue-50', value: plan.features.reviews, label: 'Reviews per month' },
    { icon: Layers, tone: 'text-violet-600 bg-violet-50', value: plan.features.papers, label: 'Papers per review' },
    { icon: Bot, tone: 'text-emerald-600 bg-emerald-50', value: '4', label: 'AI agents' },
  ]

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-neutral-100 bg-slate-50/70 p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {avatar ? (
          <img src={avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-blue text-sm font-semibold text-white">
            {initial}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold text-brand-black">{name}</span>
          <span className="mt-0.5 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-brand-blue">
            {plan.name} plan
          </span>
        </span>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
        {stats.map(({ icon: Icon, tone, value, label }) => (
          <div key={label} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}>
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold tabular-nums text-brand-black">{value}</span>
              <span className="block truncate text-[10px] leading-tight text-neutral-500">{label}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The reviews you already have, so this page is not a dead end on a fresh account. */
function YourReviews({ reviews, onOpen, onBrowse }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold text-brand-black">
          <FolderOpen className="h-[18px] w-[18px] text-brand-blue" strokeWidth={1.9} />
          Your reviews
        </h2>
        {reviews.length > 0 ? (
          <button
            type="button"
            onClick={onBrowse}
            className="flex items-center gap-1 text-xs font-semibold text-brand-blue hover:underline"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        ) : null}
      </div>

      {reviews.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          No reviews yet. Start your first one and track its progress here.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {reviews.slice(0, 3).map((review) => (
            <li key={review.id}>
              <button
                type="button"
                onClick={() => onOpen(review.id)}
                className="w-full truncate rounded-lg px-2 py-2 text-left text-xs font-medium text-neutral-700 transition-colors hover:bg-blue-50/60 hover:text-brand-blue"
              >
                {review.research_question}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** One numbered field card. */
function Step({ number, icon: Icon, tone, title, hint, children }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-bold tabular-nums text-neutral-500">
          {number}
        </span>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-brand-black">{title}</h2>
          {hint ? (
            <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">{hint}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}
