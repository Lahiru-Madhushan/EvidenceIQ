/**
 * Reads and writes the reviews / papers / paper_events tables directly.
 *
 * Row-Level Security scopes every query below to the signed-in user, so none of these
 * functions filter by owner — the database does it. That is also why these run against
 * Supabase rather than the backend: the backend connects as `postgres`, which bypasses
 * RLS and has to re-check ownership by hand.
 *
 * See docs/database-guide.html, sections 9 and 10.
 */

import { supabase } from './supabaseClient'

// Everything the dashboard renders. Selected explicitly rather than with `*` so a new
// column on the table cannot quietly start shipping extra data to the browser.
const PAPER_COLUMNS = [
  'id',
  'pmid',
  'title',
  'abstract',
  'journal',
  'year',
  'publication_types',
  'draft_decision',
  'draft_reason',
  'screened_at',
  'verified_decision',
  'confidence',
  'agreement',
  'needs_human_review',
  'verification_note',
  'checks',
  'issues',
  'verified_at',
  'researcher_status',
  'researcher_note',
  'researcher_decided_at',
].join(', ')

function unwrap({ data, error }, what) {
  if (error) throw new Error(`Could not load ${what}: ${error.message}`)
  return data
}

export async function listReviews() {
  return unwrap(
    await supabase
      .from('reviews')
      .select('id, research_question, raw_criteria, protocol, status, created_at')
      .order('created_at', { ascending: false }),
    'your reviews'
  )
}

/**
 * Papers across every review the user owns, for the dashboard's cross-review counts.
 *
 * Capped: the dashboard only needs totals and a short "needs you" list, and a researcher
 * with several thousand papers should not pull all of them to render four numbers. The
 * cap means the counts are "of your most recent papers", which is why the dashboard
 * links into each review rather than presenting itself as a complete tally.
 */
export async function listRecentPapers(limit = 500) {
  return unwrap(
    await supabase
      .from('papers')
      .select(
        'id, review_id, pmid, title, screened_at, verified_decision, draft_decision, ' +
          'confidence, agreement, needs_human_review, researcher_status'
      )
      .order('retrieved_at', { ascending: false })
      .limit(limit),
    'your papers'
  )
}

/**
 * How many papers each review holds, and how many have been screened.
 *
 * One query that pulls two small columns and groups them here, rather than a count
 * query per review - a list of twenty reviews would otherwise mean forty round trips.
 * RLS scopes it to the caller's own papers.
 */
export async function getPaperCountsByReview() {
  const rows = unwrap(
    await supabase.from('papers').select('review_id, screened_at, researcher_status'),
    'your paper counts'
  )

  const counts = {}
  for (const row of rows ?? []) {
    const entry = (counts[row.review_id] ??= { total: 0, screened: 0, decided: 0 })
    entry.total += 1
    if (row.screened_at) entry.screened += 1
    if (row.researcher_status) entry.decided += 1
  }
  return counts
}

export async function getReview(reviewId) {
  return unwrap(
    await supabase
      .from('reviews')
      .select('id, research_question, raw_criteria, protocol, status, created_at')
      .eq('id', reviewId)
      .single(),
    'this review'
  )
}

export async function getPapers(reviewId) {
  return unwrap(
    await supabase
      .from('papers')
      .select(PAPER_COLUMNS)
      .eq('review_id', reviewId)
      // Papers the agents disagreed on, or were unsure about, come first: that is the
      // queue order a researcher actually wants, not insertion order.
      .order('needs_human_review', { ascending: false })
      .order('retrieved_at', { ascending: true }),
    'the papers in this review'
  )
}

/**
 * What deleting a review would destroy.
 *
 * Fetched before the confirmation is shown rather than after, because the cascade is
 * wider than the word "review" suggests: reviews → papers → paper_events are all
 * ON DELETE CASCADE, so the papers and their whole audit history go too.
 *
 * Counts only — `head: true` asks Postgres for the count without returning any rows.
 */
export async function getReviewFootprint(reviewId) {
  const [papers, decisions] = await Promise.all([
    supabase
      .from('papers')
      .select('id', { count: 'exact', head: true })
      .eq('review_id', reviewId),
    supabase
      .from('papers')
      .select('id', { count: 'exact', head: true })
      .eq('review_id', reviewId)
      .not('researcher_status', 'is', null),
  ])

  if (papers.error || decisions.error) {
    throw new Error(
      `Could not check what this review contains: ${
        (papers.error ?? decisions.error).message
      }`
    )
  }
  return { papers: papers.count ?? 0, decisions: decisions.count ?? 0 }
}

/**
 * Deletes a review, and with it every paper and audit event beneath it.
 *
 * There is no soft delete and no undo. Note that paper_events has no DELETE policy -
 * nobody can delete an audit row directly - but a foreign-key cascade is executed by the
 * database itself and is not subject to RLS, so removing the review does remove its
 * history. The caller must make that clear before asking for confirmation.
 */
export async function deleteReview(reviewId) {
  const { error } = await supabase.from('reviews').delete().eq('id', reviewId)
  if (error) throw new Error(`Could not delete this review: ${error.message}`)
}

/** One paper's full history, newest first — every agent run and every human decision. */
export async function getPaperEvents(paperId) {
  return unwrap(
    await supabase
      .from('paper_events')
      .select('id, actor, action, detail, created_at')
      .eq('paper_id', paperId)
      .order('id', { ascending: false }),
    'this paper’s history'
  )
}

/**
 * Records the researcher's final call, and logs it.
 *
 * `status` is 'approved', 'overridden' or 'maybe'. The paper_events insert is what
 * makes "who approved or overrode what, and when" answerable later — papers holds only
 * the current value, so without the event a changed mind erases the previous one.
 *
 * The event is written after the update and is not transactional with it: if the insert
 * fails the decision still stands, and the caller is told the trail is incomplete rather
 * than having the decision silently rolled back.
 */
export async function recordDecision(paper, status, note = null) {
  const decidedAt = new Date().toISOString()

  const { error: updateError } = await supabase
    .from('papers')
    .update({
      researcher_status: status,
      researcher_note: note,
      researcher_decided_at: decidedAt,
    })
    .eq('id', paper.id)

  if (updateError) throw new Error(`Could not save your decision: ${updateError.message}`)

  // 'maybe' means "come back to it" — not a decision, and the guide's action vocabulary
  // has no word for it. Logging it as `approved` would put something false in an audit
  // log, so parking a paper updates its status without claiming a decision was made.
  if (status === 'maybe') return { decidedAt, auditWarning: null }

  const { error: eventError } = await supabase.from('paper_events').insert({
    paper_id: paper.id,
    actor: 'researcher',
    // The vocabulary the database's CHECK constraint allows.
    action: status === 'overridden' ? 'overridden' : 'approved',
    detail: {
      researcher_status: status,
      note,
      // What the agents had said at the moment the human decided, so the log explains
      // what the decision was made against even after a later re-run changes it.
      draft_decision: paper.draft_decision,
      verified_decision: paper.verified_decision,
      agreement: paper.agreement,
      confidence: paper.confidence,
    },
  })

  return {
    decidedAt,
    auditWarning: eventError
      ? 'Your decision was saved, but it could not be added to the audit log.'
      : null,
  }
}
