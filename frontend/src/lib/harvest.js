import {
  retrievePapers,
  screenOnePaperDraft,
  verifyOnePaper,
} from './agentsApi'
import { getPapers } from './reviewsApi'
import { isConfirmed } from './outcomes'

/**
 * Feed papers through Agent 3 then Agent 4, one paper at a time, until enough of them
 * have been accepted by both agents.
 *
 * The researcher asks for a number of usable papers, not a number of papers to look at.
 * How many have to be read to find ten good ones is not something anyone can know in
 * advance - it depends on the question and the protocol - so the loop below discovers it
 * by running papers through until the target is met or a limit stops it.
 *
 * WHY ONE PAPER AT A TIME, AND NOT IN PHASES
 *
 * This previously screened a whole page of papers, then verified the whole page. That
 * ordering exists in the backend for a good reason (see run_batch in
 * app/services/pipeline.py): the two agents have separate quotas, so finishing Agent 3's
 * pass before Agent 4 starts means a spent verification quota never costs the researcher
 * the screening work they already paid for.
 *
 * But it cannot stop on time. The target is a count of papers BOTH agents accepted, and
 * in phases that count is only knowable once the whole page has been verified - so
 * asking for 10 confirmed papers screened all 20 in the page even when the first 12
 * already contained 10 good ones. Every paper past the target was two model calls spent
 * on an answer nobody had asked for, against a daily budget of roughly 160 papers.
 *
 * Running a paper through both agents before fetching the next makes the running total
 * exact after every paper, so the loop stops on the paper that reaches the target and
 * not a page later. It also makes the hand-off observable, which is what lets the UI say
 * which agent is working right now rather than which phase is.
 *
 * What it gives up is the phase ordering's protection, and only partly: a paper is
 * either screened-and-verified or untouched, never left half-finished, because
 * verification follows its own screening immediately. A spent Agent 4 quota does strand
 * the one paper in flight with a draft and no second opinion. That is one paper rather
 * than a page, and the `unverified` outcome already exists to describe it.
 *
 * Three properties of the API make this safe to build by composition:
 *
 *   - Retrieval upserts on (review_id, pmid), so re-fetching overlapping pages cannot
 *     duplicate a paper.
 *   - Both per-paper endpoints write only their own agent's columns, through the same
 *     writers the batch pipeline uses, so the audit trail is identical either way.
 *   - A spent quota answers 429 on both, so the loop can tell "out of budget" apart
 *     from "this paper failed" and stop with an explanation instead of spinning.
 *
 * It runs in the browser rather than the server on purpose. A harvest is minutes of
 * work - the verification agent is limited to a few papers a minute - and a single HTTP
 * request that long would time out at the orchestrator's own 120s ceiling with nothing
 * to show. Driven from here, every paper commits and reports before the next begins.
 */

export const STOP = {
  /** Got what was asked for. */
  TARGET_REACHED: 'target-reached',
  /** PubMed has no more papers matching the query. */
  SOURCE_EXHAUSTED: 'source-exhausted',
  /** Hit the cap on how many papers may be screened chasing the target. */
  SCREEN_LIMIT: 'screen-limit',
  /** A quota ran out, or the session expired. The reason carries the detail. */
  BLOCKED: 'blocked',
  /** The researcher asked to stop. */
  CANCELLED: 'cancelled',
}

/** What the loop is doing right now, for the live view. */
export const PHASE = {
  RETRIEVING: 'retrieving',
  SCREENING: 'screening',
  VERIFYING: 'verifying',
  IDLE: 'idle',
}

// Caps. A loop that spends someone's model quota needs an end it cannot argue with,
// and these bound the worst case before it starts rather than after.
const MIN_BATCH = 5
// Matches VERIFY_BATCH_MAX on the server: a larger page would be refused anyway.
const MAX_BATCH = 50
// What fraction of screened papers both agents accept. Only a starting guess, used to
// size the page we fetch; if the real rate is lower the loop simply fetches another.
const ASSUMED_ACCEPT_RATE = 0.5

/**
 * How many papers to pull per PubMed page - decided once, then held for the whole run.
 *
 * Deliberately not re-tuned between pages. The API paginates by page number, so the
 * offset it reads is (page - 1) * page_size; changing the size between calls moves that
 * offset under us and silently skips the papers in the gap. A fixed size pages cleanly.
 *
 * Note this no longer decides how many papers get screened - the loop screens one at a
 * time and stops when the target is met, so a page is just how much is fetched ahead.
 */
export function planBatchSize(target) {
  const wanted = Math.ceil(target / ASSUMED_ACCEPT_RATE)
  return Math.min(MAX_BATCH, Math.max(MIN_BATCH, wanted))
}

/**
 * Roughly how many papers a target will cost to screen, for the form to quote up front.
 *
 * Only ever a guess - the real figure depends on how strict the protocol turns out to
 * be - but quoting it is what stops "10" reading as "10 papers will be screened", which
 * is what the field used to mean.
 */
export function estimatedToScreen(target) {
  return planBatchSize(target)
}

/**
 * `promise`, but rejecting with an AbortError the moment `signal` aborts.
 *
 * The request itself is not recalled - the server finishes the call it was given and
 * commits it, as it would if the tab were closed - but nothing waits for it, so a
 * cancel takes effect now rather than after a verification that may be queued behind
 * a rate limit for a minute or more.
 */
export function untilAborted(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

function abortError() {
  return new DOMException('The review was cancelled.', 'AbortError')
}

/** The most papers worth screening in pursuit of `target` confirmed ones. */
export function screeningBudget(target) {
  return Math.min(100, Math.max(20, target * 10))
}

/**
 * Both agents said INCLUDE about the paper just processed.
 *
 * Read off this run's own results rather than the stored row, so the count is exact the
 * instant a paper finishes. `isConfirmed` applies the same rule to a stored row.
 */
function acceptedByBoth(draft, verification) {
  return draft?.decision === 'INCLUDE' && verification?.verified_decision === 'INCLUDE'
}

// Statuses that describe the RUN rather than one paper, so the next paper already knows
// its own outcome. 429 is a spent quota - and with a fallback chain it means every model
// is spent, since the router only reports one once it has tried them all. 401 and 403 are
// the researcher's token: it is forwarded on every hop and a long harvest can outlive it,
// after which every remaining paper fails identically. Mirrors _RUN_WIDE_STATUS in
// app/services/pipeline.py, which makes the same distinction for the batch endpoints.
const RUN_WIDE_STATUS = new Set([401, 403, 429])

/**
 * Conditions that cannot come out differently for the next paper.
 *
 * Decided on the HTTP status, not on the wording. This used to match phrases in the
 * server's message, and that failed the first time a message was reworded: Agent 4's
 * quota error stopped containing the word "quota" (it now reads "the provider quoted no
 * reset time"), so a 429 was read as one paper's problem. The harvest then screened
 * every remaining paper in the review, spending Agent 3's budget on drafts whose
 * verification could never follow - the exact waste the quota gate exists to prevent.
 *
 * Prose is written for researchers and gets rewritten; the status is a contract.
 */
function isRunWide(error) {
  if (RUN_WIDE_STATUS.has(error?.status)) return true

  // No status means the request never reached the server - the client throws a plain
  // Error for a network-level failure and for an unusable session. Both are run-wide.
  if (error?.status === undefined) {
    const message = (error?.message ?? '').toLowerCase()
    return (
      message.includes('cannot reach') ||
      message.includes('session expired') ||
      message.includes('log in')
    )
  }
  return false
}

/**
 * Run the harvest.
 *
 * `onEvent` is called at every state change - a page fetched, an agent starting on a
 * paper, a paper finished - so a caller can show which agent is working right now and on
 * what. `shouldContinue` is checked between papers; returning false ends the harvest
 * cleanly, after the paper in flight has been through both agents rather than leaving it
 * screened but unverified.
 *
 * `signal` is the hard stop: aborting it ends the harvest at once, mid-paper if need be,
 * with STOP.CANCELLED. A paper caught between the agents is left screened but not
 * verified, which the next run resumes (see `resume` below).
 */
export async function harvestConfirmed({
  reviewId,
  query,
  target,
  yearFrom,
  yearTo,
  onEvent,
  shouldContinue,
  signal,
  // Injectable so the loop can be exercised without spending a model quota. A harvest
  // decides how many papers get screened, so its stopping conditions are worth being
  // able to test directly rather than by running one.
  api = { retrievePapers, screenOnePaperDraft, verifyOnePaper, getPapers },
}) {
  const batchSize = planBatchSize(target)
  const budget = screeningBudget(target)

  let page = 0
  let fetched = 0
  let totalFound = 0
  let confirmed = 0
  let screened = 0
  // Papers Agent 4 has returned a verdict on, which is not the same as `confirmed` -
  // a paper both agents rejected is verified but not accepted. The view needs the
  // difference to say whether Agent 4 has done anything yet.
  let verified = 0
  let failed = 0
  let blockedReason = null
  let current = null
  let phase = PHASE.IDLE

  // Papers fetched but not yet put through the agents, in the rank order Agent 2
  // returned them in. Ranking is computed at retrieval and never stored, so consuming
  // the response's own order is the only way the most relevant papers go first.
  let queue = []
  // Filled once the review's existing papers are read; declared here so a cancel that
  // lands before then can still report the run's state.
  let resume = []
  // Every pmid this run has already processed, so a page that overlaps the previous one
  // cannot feed the same paper through the agents twice.
  const processed = new Set()

  const state = () => ({
    page,
    phase,
    current,
    confirmed,
    target,
    screened,
    verified,
    failed,
    fetched,
    totalFound,
    queued: queue.length + resume.length,
    batchSize,
    budget,
    blockedReason,
  })

  const emit = () => onEvent?.(state())

  const finish = (stopped) => {
    phase = PHASE.IDLE
    return { ...state(), stopped }
  }

  // Every API call goes through here, so a cancel interrupts whichever one is waiting.
  const call = (fn, ...args) => untilAborted(fn(...args), signal)

  try {
    return await run()
  } catch (error) {
    if (signal?.aborted) return finish(STOP.CANCELLED)
    throw error
  }

  async function run() {
    // Papers already confirmed before this run started still count toward the target -
    // it is a total for the review, not for this run.
    const existing = await call(api.getPapers, reviewId)
    confirmed = existing.filter(isConfirmed).length
    screened = existing.filter((paper) => paper.draft_decision != null).length
    verified = existing.filter((paper) => paper.verified_decision != null).length
    for (const paper of existing) {
      if (paper.draft_decision != null && paper.pmid) processed.add(paper.pmid)
    }

    // Papers Agent 3 screened and Agent 4 never reached, finished before anything new is
    // fetched. They are the cheapest confirmations available - the screening call is
    // already paid for and committed, so each one costs a single verification instead of
    // two calls - and without this they are stranded: the loop marks every screened paper
    // as processed, so a later run would skip them and they would stay half-checked for
    // the life of the review. That is not a rare state. It is exactly what a run stopped
    // by a spent verification quota leaves behind, which is the most likely reason anyone
    // is running the harvest a second time.
    resume = existing
      .filter((paper) => paper.draft_decision != null && paper.verified_decision == null)
      .map((paper) => ({
        id: paper.id,
        pmid: paper.pmid,
        title: paper.title,
        year: paper.year,
        journal: paper.journal,
        rank: null,
        // Read off the row rather than re-screened. Agent 4 verifies what was actually
        // recorded, and re-running Agent 3 would both cost a call and risk verifying a
        // different decision from the one stored.
        draft: { decision: paper.draft_decision, reason: paper.draft_reason ?? '' },
      }))

    while (true) {
      if (confirmed >= target) return finish(STOP.TARGET_REACHED)
      if (shouldContinue && !shouldContinue()) return finish(STOP.CANCELLED)
      if (screened >= budget) return finish(STOP.SCREEN_LIMIT)

      // --- Fetch another page only once the current one is used up -------------------
      // Papers waiting on verification alone come first: they need one call rather than
      // two, so they reach the target sooner and for less.
      if (queue.length === 0 && resume.length === 0) {
        page += 1
        phase = PHASE.RETRIEVING
        current = null
        emit()

        const retrieved = await call(api.retrievePapers, {
          reviewId,
          query,
          maxResults: batchSize,
          page,
          yearFrom,
          yearTo,
        })
        totalFound = retrieved.total_found ?? totalFound
        const papers = retrieved.papers ?? []
        fetched += papers.length

        // No papers came back, so there is nothing new to screen and the next page would
        // be emptier still.
        if (papers.length === 0) return finish(STOP.SOURCE_EXHAUSTED)

        // The retrieval response carries pmids and rank but not the database ids the
        // per-paper endpoints address rows by, so the two are matched here. Keeping the
        // response's order is what preserves Agent 2's ranking through to screening.
        const rows = await call(api.getPapers, reviewId)
        const idByPmid = new Map(rows.map((row) => [row.pmid, row.id]))

        queue = papers
          .filter((paper) => !processed.has(paper.pmid) && idByPmid.has(paper.pmid))
          .map((paper) => ({
            id: idByPmid.get(paper.pmid),
            pmid: paper.pmid,
            title: paper.title,
            year: paper.publication_year,
            journal: paper.journal,
            rank: paper.rank,
          }))

        emit()

        // Every paper on this page had already been through the agents. The next page is
        // still worth trying - this one may simply have overlapped the last.
        if (queue.length === 0) {
          if (totalFound > 0 && fetched >= totalFound) return finish(STOP.SOURCE_EXHAUSTED)
          continue
        }
      }

      // --- One paper, through both agents in turn ------------------------------------
      const resuming = resume.length > 0
      const paper = resuming ? resume.shift() : queue.shift()
      processed.add(paper.pmid)

      let draft = resuming ? paper.draft : null
      let verification = null

      if (!resuming) {
        phase = PHASE.SCREENING
        current = { ...paper, draft: null, verification: null }
        emit()
      }

      try {
        if (!resuming) {
          draft = await call(api.screenOnePaperDraft, paper.id)
          screened += 1
        }
      } catch (error) {
        if (signal?.aborted) throw error
        // A quota, an expired session - conditions that belong to the run rather than to
        // this paper, so the next paper already knows its own outcome. The server answers
        // 429 for a spent budget and the message names the reset time, so it is passed
        // through rather than replaced.
        if (isRunWide(error)) {
          blockedReason = error.message
          return finish(STOP.BLOCKED)
        }
        failed += 1
        current = { ...paper, error: error.message }
        emit()
        continue
      }

      phase = PHASE.VERIFYING
      current = { ...paper, draft, verification: null }
      emit()

      try {
        verification = await call(api.verifyOnePaper, paper.id)
      } catch (error) {
        if (signal?.aborted) throw error
        if (isRunWide(error)) {
          blockedReason = error.message
          // The draft is committed and real; only the second opinion is missing. That is
          // the `unverified` outcome, not a failure.
          current = { ...paper, draft, verification: null }
          return finish(STOP.BLOCKED)
        }
        failed += 1
        current = { ...paper, draft, error: error.message }
        emit()
        continue
      }

      verified += 1
      if (acceptedByBoth(draft, verification)) confirmed += 1

      phase = PHASE.IDLE
      current = { ...paper, draft, verification }
      emit()

      if (
        queue.length === 0 &&
        resume.length === 0 &&
        totalFound > 0 &&
        fetched >= totalFound
      ) {
        return finish(STOP.SOURCE_EXHAUSTED)
      }
    }
  }
}

/** One sentence a researcher can read, explaining why the harvest ended where it did. */
export function explainStop(result) {
  const { stopped, confirmed, target, screened, totalFound, blockedReason } = result

  switch (stopped) {
    case STOP.TARGET_REACHED:
      return `Found ${confirmed} paper(s) accepted by both agents, from ${screened} screened.`
    case STOP.SOURCE_EXHAUSTED:
      return (
        `Only ${confirmed} of the ${target} requested could be confirmed - PubMed has ` +
        `${totalFound} paper(s) for this query and all of them have now been screened.`
      )
    case STOP.SCREEN_LIMIT:
      return (
        `Stopped at the ${screened}-paper limit with ${confirmed} of ${target} confirmed, ` +
        'to avoid spending the rest of the day’s model quota on one search.'
      )
    case STOP.BLOCKED:
      return blockedReason ?? 'The run stopped early.'
    case STOP.CANCELLED:
      return `Stopped at your request with ${confirmed} of ${target} confirmed.`
    default:
      return `${confirmed} of ${target} confirmed.`
  }
}
