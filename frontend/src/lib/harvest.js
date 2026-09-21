import { retrievePapers, screenPapers, verifyDecisions } from './agentsApi'
import { getPapers } from './reviewsApi'
import { isConfirmed } from './outcomes'

/**
 * Keep retrieving and screening until enough papers have been accepted by BOTH agents.
 *
 * The researcher asks for a number of usable papers, not a number of papers to look at.
 * How many have to be read to find ten good ones is not something anyone can know in
 * advance - it depends on the question and the protocol - so the loop below discovers it
 * by running rounds until the target is met or a limit stops it.
 *
 * Three properties of the existing API make this safe to build by composition rather
 * than as a new endpoint:
 *
 *   - Retrieval upserts on (review_id, pmid), so re-fetching overlapping pages cannot
 *     duplicate a paper.
 *   - The screening phase only touches rows with no screened_at, and verification only
 *     rows with no verified_at, so calling them each round costs nothing for papers
 *     already done.
 *   - Each phase reports stopped_reason, so a spent quota ends the harvest with an
 *     explanation instead of spinning.
 *
 * It runs in the browser rather than the server on purpose. A harvest is minutes of
 * work - the verification agent is limited to a few papers a minute - and a single HTTP
 * request that long would time out at the orchestrator's own 120s ceiling with nothing
 * to show. Driven from here, every round commits and reports before the next begins.
 */

export const STOP = {
  /** Got what was asked for. */
  TARGET_REACHED: 'target-reached',
  /** PubMed has no more papers matching the query. */
  SOURCE_EXHAUSTED: 'source-exhausted',
  /** Hit the round cap - the acceptance rate was too low to reach the target cheaply. */
  ROUND_LIMIT: 'round-limit',
  /** Hit the cap on how many papers may be screened chasing the target. */
  SCREEN_LIMIT: 'screen-limit',
  /** A quota ran out, or the session expired. The reason carries the detail. */
  BLOCKED: 'blocked',
  /** The researcher asked to stop. */
  CANCELLED: 'cancelled',
}

// Caps. A loop that spends someone's model quota needs an end it cannot argue with,
// and these bound the worst case before it starts rather than after.
const MAX_ROUNDS = 6
const MIN_BATCH = 5
// Matches VERIFY_BATCH_MAX on the server: a larger page would be refused anyway.
const MAX_BATCH = 50
// What fraction of screened papers both agents accept. Only a starting guess, used to
// size the page; if the real rate is lower the loop simply runs more rounds.
const ASSUMED_ACCEPT_RATE = 0.5

/**
 * How many papers to pull per round - decided once, then held for the whole harvest.
 *
 * Deliberately not re-tuned each round. The API paginates by page number, so the offset
 * it reads is (page - 1) * page_size; changing the size between rounds moves that offset
 * under us and silently skips the papers in the gap. A fixed size pages cleanly, and the
 * loop adapts by running more rounds instead.
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

/** The most papers worth screening in pursuit of `target` confirmed ones. */
export function screeningBudget(target) {
  return Math.min(100, Math.max(20, target * 10))
}

/**
 * Run the harvest.
 *
 * `onRound` is called after every completed round with the running totals, so a caller
 * can show progress while this is still going. `shouldContinue` is checked at the top of
 * each round; returning false ends the harvest cleanly rather than abandoning a round
 * halfway and leaving papers screened but unverified.
 */
export async function harvestConfirmed({
  reviewId,
  query,
  target,
  yearFrom,
  yearTo,
  onRound,
  shouldContinue,
  // Injectable so the loop can be exercised without spending a model quota. A harvest
  // decides how many papers get screened, so its stopping conditions are worth being
  // able to test directly rather than by running one.
  api = { retrievePapers, screenPapers, verifyDecisions, getPapers },
}) {
  const batchSize = planBatchSize(target)
  const budget = screeningBudget(target)

  let round = 0
  let page = 0
  let fetched = 0
  let totalFound = 0
  let confirmed = 0
  let screened = 0
  let blockedReason = null

  const state = () => ({
    round,
    confirmed,
    target,
    screened,
    fetched,
    totalFound,
    batchSize,
    budget,
    blockedReason,
  })

  const finish = (stopped) => ({ ...state(), stopped })

  while (true) {
    if (confirmed >= target) return finish(STOP.TARGET_REACHED)
    if (shouldContinue && !shouldContinue()) return finish(STOP.CANCELLED)
    if (round >= MAX_ROUNDS) return finish(STOP.ROUND_LIMIT)
    if (screened >= budget) return finish(STOP.SCREEN_LIMIT)

    round += 1
    page += 1

    const retrieved = await api.retrievePapers({
      reviewId,
      query,
      maxResults: batchSize,
      page,
      yearFrom,
      yearTo,
    })
    totalFound = retrieved.total_found ?? totalFound
    const returned = retrieved.returned_count ?? 0
    fetched += returned

    // No papers came back, so there is nothing new to screen and the next page would
    // be emptier still.
    if (returned === 0) return finish(STOP.SOURCE_EXHAUSTED)

    // Both phases skip work already done, so these only cost model calls for the
    // papers this round actually added.
    const screenSummary = await api.screenPapers(reviewId)
    blockedReason = screenSummary.stopped_reason ?? null

    if (!blockedReason) {
      const verifySummary = await api.verifyDecisions(reviewId)
      blockedReason = verifySummary.stopped_reason ?? null
    }

    // Counted from the review itself rather than from this round's summary: the target
    // is a total for the whole review, and earlier rounds contribute to it.
    const papers = await api.getPapers(reviewId)
    confirmed = papers.filter(isConfirmed).length
    screened = papers.filter((paper) => paper.draft_decision != null).length

    onRound?.(state())

    if (blockedReason) return finish(STOP.BLOCKED)
    if (totalFound > 0 && fetched >= totalFound) return finish(STOP.SOURCE_EXHAUSTED)
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
    case STOP.ROUND_LIMIT:
      return (
        `Stopped after ${screened} papers with ${confirmed} of ${target} confirmed. ` +
        'Few papers are matching the protocol, so broaden the criteria or the query.'
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
