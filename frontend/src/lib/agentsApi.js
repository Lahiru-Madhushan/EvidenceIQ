/**
 * Calls the FastAPI backend's agent endpoints.
 *
 * Anything that runs an agent goes through here rather than through Supabase, because
 * only the backend holds the model credentials and the orchestration. Reads of data the
 * agents have already written go through Supabase directly (see reviewsApi.js), where
 * Row-Level Security scopes rows to the signed-in user for free.
 */

import { supabase } from './supabaseClient'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  'http://localhost:8000'

async function authHeaders() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()

  if (error) throw new Error('Unable to verify your login session.')
  if (!session?.access_token) throw new Error('Please log in again — your session expired.')

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  }
}

async function post(path, body, method = 'POST') {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: await authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // fetch only rejects on a network-level failure, so this really is "no server".
    throw new Error(
      `Cannot reach the EvidenceIQ backend at ${API_BASE_URL}. Is uvicorn running?`
    )
  }

  let data
  try {
    data = await response.json()
  } catch {
    throw new Error('The backend returned a response that was not JSON.')
  }

  if (!response.ok) {
    const error = new Error(
      typeof data?.detail === 'string' ? data.detail : 'The request failed.'
    )
    // The status, carried alongside the message. Callers have to tell a condition that
    // belongs to the whole run - a spent quota, an expired session - from one paper
    // failing, and the status says which; the message is prose that gets rewritten.
    // That is not hypothetical: reworded error text once turned "429, stop the run" into
    // "this paper failed, try the next", and the harvest screened every remaining paper
    // for a verification that could never follow.
    error.status = response.status
    error.retryAfter = Number(response.headers.get('Retry-After')) || null
    throw error
  }
  return data
}

/**
 * Agents 3 and 4 over every paper in a review that has not been screened yet.
 *
 * Papers already screened are skipped unless `rerun` is set — each paper costs two
 * model calls, so re-running the whole review by accident is expensive.
 *
 * Prefer screenPapers() then verifyDecisions() when you are showing progress: the
 * backend runs the two agents in phases, and this single call hides the boundary
 * between them, so a caller can only guess at when screening finished.
 */
export function runScreening(reviewId, { rerun = false } = {}) {
  return post(`/api/pipeline/review/${reviewId}${rerun ? '?rerun=true' : ''}`)
}

/** Agent 3 alone, over every unscreened paper. Returns when the pass is saved. */
export function screenPapers(reviewId, { rerun = false } = {}) {
  return post(`/api/pipeline/review/${reviewId}/screen${rerun ? '?rerun=true' : ''}`)
}

/** Agent 4 alone, over every screened paper still waiting for a second opinion. */
export function verifyDecisions(reviewId, { rerun = false } = {}) {
  return post(`/api/pipeline/review/${reviewId}/verify${rerun ? '?rerun=true' : ''}`)
}

/** Agents 3 and 4 over one stored paper, in one call. */
export function screenOnePaper(paperId) {
  return post(`/api/pipeline/paper/${paperId}`)
}

/**
 * Agent 3 alone, over one stored paper. Saves the draft decision and returns it.
 *
 * Paired with verifyOnePaper() below, this is what lets a caller run the two agents one
 * paper at a time and watch the hand-off between them. screenOnePaper() does both in a
 * single request, so it cannot report which of the two is currently working - the
 * response arrives only once both have finished.
 */
export function screenOnePaperDraft(paperId) {
  return post(`/api/screen/by-id/${paperId}`)
}

/**
 * Agent 4 alone, over one stored paper Agent 3 has already screened.
 *
 * Reads Agent 3's decision off the row rather than taking it from the caller, so what
 * gets verified is what was actually recorded. Returns 422 if the paper has not been
 * screened yet.
 */
export function verifyOnePaper(paperId) {
  return post(`/api/verify/by-id/${paperId}`)
}

/**
 * The whole chain: Agent 1 turns the criteria into a protocol and creates the review,
 * Agent 2 searches PubMed, then Agents 3 and 4 screen and verify what it found.
 *
 * Agent 1 may stop the chain by asking for clarification — the caller must check
 * `clarification_needed` rather than assuming a protocol came back.
 */
export function runFullChain({ researchQuestion, rawCriteria, query, maxResults = 10 }) {
  return post('/api/pipeline/full', {
    research_question: researchQuestion,
    raw_criteria: rawCriteria,
    query: query || undefined,
    max_results: maxResults,
  })
}

/**
 * Agent 1 on its own: creates the review and interprets the criteria.
 *
 * Used instead of runFullChain when the caller wants to show each agent's progress as
 * it happens - the full chain returns only once all four have finished, so it cannot
 * report which one is currently working.
 *
 * Answers with either a protocol or a clarifying question; check `status`.
 */
export function submitCriteria({ researchQuestion, rawCriteria }) {
  return post('/api/criteria/submit', {
    research_question: researchQuestion,
    raw_criteria: rawCriteria,
  })
}

/**
 * Changes a review's question or criteria, re-running Agent 1 over the result.
 *
 * Like starting a review, this can come back with `status: 'clarification_needed'`
 * instead of a protocol. It also reports `stale_screened_count` - papers screened
 * against the protocol that has just been replaced.
 */
export function updateReview(reviewId, { researchQuestion, rawCriteria }) {
  return post(`/api/criteria/${reviewId}`, {
    research_question: researchQuestion,
    raw_criteria: rawCriteria,
  }, 'PUT')
}

/**
 * Recomputes a review's stored status from its papers.
 *
 * Called after a decision changes whether every paper has been ruled on. The write lives
 * in the backend because `reviews.status` is not the researcher's column to set, and
 * deriving it in one place keeps the rule from drifting between callers.
 */
export function refreshReviewStatus(reviewId) {
  return post(`/api/reviews/${reviewId}/status`)
}

/** Answers Agent 1's clarifying question and finalises the protocol. */
export function answerClarification(reviewId, answer) {
  return post('/api/criteria/clarify', { review_id: reviewId, answer })
}

/** Agent 2 on its own, for adding more papers to an existing review. */
export function retrievePapers({ reviewId, query, maxResults = 20, page = 1, yearFrom, yearTo }) {
  const payload = {
    review_id: reviewId,
    query,
    max_results: maxResults,
    page_size: maxResults,
    // The API reads its offset as (page - 1) * page_size, so a caller walking through
    // results must hold page_size steady between calls or the offset moves under it.
    page,
  }
  // Omitted rather than sent as null: the API validates the pair only when present,
  // and an unset year should mean "no bound", not "year null".
  if (yearFrom) payload.year_from = Number(yearFrom)
  if (yearTo) payload.year_to = Number(yearTo)
  return post('/api/retrieval/search', payload)
}

/**
 * Ask a question about one paper, answered only from that paper.
 *
 * The answer carries `grounded`: false means the paper does not cover the question,
 * which is a real answer rather than a failure, and the UI shows it differently.
 * `quotes` are verbatim spans the server has already checked against the paper text.
 */
export function askPaper(paperId, question, history = []) {
  return post(`/api/papers/${paperId}/chat`, { question, history })
}

/** The short orientation shown above the chat thread. Costs no model call. */
export function getPaperSummary(paperId) {
  return post(`/api/papers/${paperId}/summary`, undefined, 'GET')
}
