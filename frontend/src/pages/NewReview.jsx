import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  FileText,
  Info,
  Layers,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  Play,
  Search,
  Settings2,
  Sparkles,
  Target,
} from 'lucide-react'

import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import { useAuth } from '../context/AuthContext'
import PipelineProgress from '../components/dashboard/PipelineProgress'
import {
  answerClarification,
  retrievePapers,
  screenPapers,
  verifyDecisions,
  submitCriteria,
} from '../lib/agentsApi'
import { ROUTE_FOR_NAV_KEY } from '../lib/navigation'

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
  'Be clear and specific about your population, intervention, and outcomes.',
  'Mention study types (e.g. RCT, cohort).',
  'Specify a date range if it matters.',
  'Add exclusion criteria to reduce irrelevant results.',
]

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
    maxResults: 10,
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

  // Set when Agent 1 stops the chain rather than guessing at an ambiguous term.
  const [clarification, setClarification] = useState(null)
  const [answer, setAnswer] = useState('')

  // Drives the "Ns elapsed" line on the running step. One timer for the whole card,
  // and only while something is actually running.
  const [now, setNow] = useState(() => Date.now())
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

  /** Agents 2, 3 and 4, once a review exists with a protocol. */
  async function runRest(reviewId) {
    startStep('retrieval', 'Retrieving and processing papers from PubMed…')
    log('Starting PubMed search', 'active')

    const retrieved = await retrievePapers({
      reviewId,
      query: form.query || form.researchQuestion,
      maxResults: form.maxResults,
      yearFrom: form.yearFrom,
      yearTo: form.yearTo,
    })
    const saved = retrieved.saved_count ?? 0
    finishStep('retrieval', {
      facts: [`${retrieved.total_found ?? 0} found`, `${saved} saved`],
    })
    log(`Retrieved ${saved} paper(s) from PubMed`)

    if (saved === 0) {
      // Nothing to screen is a real outcome, not a failure - say so instead of leaving
      // two steps spinning forever.
      setStep('screening', { status: 'pending', waitingOn: 'No papers to screen' })
      setStep('verification', { status: 'pending', waitingOn: 'No papers to verify' })
      log('No papers matched the search', 'error')
      return
    }

    // Two calls, because the agents really do run one after the other: Agent 3 screens
    // every paper before Agent 4 looks at any of them. Verification is a review of a
    // completed screening pass, so showing both rows spinning at once would describe a
    // state the backend never occupies.
    startStep('screening', `Screening ${saved} paper(s) against your protocol…`)
    log('Screening papers against the protocol', 'active')

    const screened = await screenPapers(reviewId)

    finishStep('screening', {
      facts: [`${screened.included} included`, `${screened.excluded} excluded`],
      note: screened.failed > 0 ? `${screened.failed} paper(s) could not be screened.` : null,
    })
    log(`Screened ${screened.included + screened.excluded} of ${screened.total} papers`)

    // A screening pass that stopped early has nothing more for Agent 4 to check, and
    // the reason is already known - say it once rather than letting the next call
    // rediscover it paper by paper.
    if (screened.stopped_reason) {
      setStep('verification', { status: 'blocked', waitingOn: screened.stopped_reason })
      log(screened.stopped_reason, 'error')
      return
    }

    startStep('verification', 'Independently re-checking each screening decision…')
    log('Verifying screening decisions', 'active')

    const verified = await verifyDecisions(reviewId)

    finishStep('verification', {
      facts: [
        `${verified.complete} verified`,
        verified.disagreements > 0
          ? `${verified.disagreements} disagreement(s)`
          : 'no disagreements',
      ],
      note:
        verified.verification_failed > 0
          ? `${verified.verification_failed} paper(s) were screened but not verified.`
          : null,
    })
    if (verified.stopped_reason) {
      log(verified.stopped_reason, 'error')
    }
    if (verified.disagreements > 0) {
      log(`${verified.disagreements} paper(s) need your decision`, 'active')
    }
  }

  async function handleStart(event) {
    event.preventDefault()
    setError(null)
    setSteps({})
    setActivity([])
    setStage('running')

    startStep('criteria', 'Interpreting your inclusion and exclusion criteria…')
    log('Sending your criteria to Agent 1', 'active')

    try {
      const result = await submitCriteria(form)

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

      await runRest(result.review_id)
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

    setError(null)
    setStage('running')
    startStep('criteria', 'Re-interpreting with your answer…')
    log('Sending your answer to Agent 1', 'active')

    try {
      const finalised = await answerClarification(clarification.reviewId, answer.trim())
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

      await runRest(clarification.reviewId)
      navigate(`/reviews/${clarification.reviewId}`)
    } catch (resumeError) {
      setError(resumeError.message)
      setStage('clarifying')
    }
  }

  function handleNav(key) {
    const route = ROUTE_FOR_NAV_KEY[key]
    if (route) navigate(route)
  }

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  const field =
    'w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-3 text-sm text-brand-black placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30 disabled:opacity-60'

  return (
    <div className="flex h-screen flex-col bg-neutral-50">
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

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="min-w-0">
                <h1 className="text-3xl font-bold text-brand-black">New Review</h1>
                <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-neutral-500">
                  Describe your research question and criteria in plain English. EvidenceIQ
                  turns them into a screening protocol, searches PubMed, and screens every
                  result twice.
                </p>

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
                {stage !== 'form' ? (
                  <PipelineProgress steps={steps} activity={activity} now={now} />
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
                      title="Research question"
                      hint="The question your review is trying to answer."
                    >
                      <input
                        value={form.researchQuestion}
                        onChange={(event) => update('researchQuestion', event.target.value)}
                        maxLength={QUESTION_LIMIT}
                        placeholder={`e.g. ${EXAMPLE_QUESTION}`}
                        className={field}
                      />
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
                        title="Papers"
                        hint="Two model calls each."
                      >
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={form.maxResults}
                          onChange={(event) =>
                            update('maxResults', clampPapers(event.target.value))
                          }
                          className={field}
                        />
                        <p className="mt-2 text-xs text-neutral-400">
                          Number of papers to retrieve and screen.
                        </p>
                      </Step>
                    </div>

                    {showAdvanced ? (
                      <div className="rounded-2xl border border-neutral-100 bg-white p-4 sm:p-5">
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
                      <span className="block text-sm font-semibold text-brand-black">
                        Not sure how to write this?
                      </span>
                      {showHelp ? (
                        <span className="mt-1 block text-xs leading-relaxed text-neutral-600">
                          Write in plain English. Agent 1 will stop and ask about anything
                          ambiguous rather than guessing at what you meant.
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
                    What happens next?
                  </h2>
                  <ol className="mt-4 space-y-3">
                    {WHAT_HAPPENS.map(({ step, text }, index) => (
                      <li key={step} className="flex gap-3">
                        <span className="flex flex-col items-center">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold tabular-nums text-brand-blue ring-1 ring-inset ring-blue-100">
                            {step}
                          </span>
                          {index < WHAT_HAPPENS.length - 1 ? (
                            <span aria-hidden className="mt-1 w-px flex-1 bg-emerald-200" />
                          ) : null}
                        </span>
                        <span className="pb-1 text-xs leading-relaxed text-neutral-700">
                          {text}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="rounded-2xl border border-violet-100 bg-violet-50/40 p-5">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-brand-black">
                    <FileText className="h-[18px] w-[18px] text-violet-600" strokeWidth={1.9} />
                    Tips for better results
                  </h2>
                  <ul className="mt-4 space-y-3">
                    {TIPS.map((tip) => (
                      <li key={tip} className="flex gap-2.5">
                        <Check
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600"
                          strokeWidth={2.6}
                        />
                        <span className="text-xs leading-relaxed text-neutral-700">{tip}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </aside>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

/** One numbered field card. */
function Step({ number, icon: Icon, tone, title, hint, children }) {
  return (
    <section className="rounded-2xl border border-neutral-100 bg-white p-4 sm:p-5">
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
