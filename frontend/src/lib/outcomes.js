/**
 * What the two agents jointly concluded about a paper.
 *
 * Every screened paper lands in exactly one of four states, and the difference between
 * them is the whole point of running a second agent:
 *
 *   confirmed   both agents independently said INCLUDE
 *   rejected    both agents independently said EXCLUDE
 *   disagreed   they reached different answers - this is the researcher's queue
 *   unverified  Agent 3 screened it, Agent 4 never got to it (a spent quota, an outage)
 *
 * The distinction that matters most is between `confirmed` and `unverified`. A paper
 * only Agent 3 has seen carries one opinion, not two, and presenting it alongside
 * papers that survived an independent check would quietly undo the reason Agent 4
 * exists.
 */

export const OUTCOME = {
  CONFIRMED: 'confirmed',
  REJECTED: 'rejected',
  DISAGREED: 'disagreed',
  UNVERIFIED: 'unverified',
  UNSCREENED: 'unscreened',
}

/**
 * Both agents independently said INCLUDE.
 *
 * Deliberately not `paper.agreement === true`: agreement is also true when both agents
 * agree to EXCLUDE, so that test would pull in every rejected paper in the review. And
 * deliberately not `verified_decision === 'INCLUDE'` alone, which ignores whether
 * Agent 3 ever agreed - that would count a disagreement as a confirmation.
 */
export function isConfirmed(paper) {
  return paper.draft_decision === 'INCLUDE' && paper.verified_decision === 'INCLUDE'
}

/** Screened by Agent 3, but Agent 4 never returned a verdict. Not a rejection. */
export function isUnverified(paper) {
  return paper.draft_decision != null && paper.verified_decision == null
}

/** The agents reached different conclusions, so a human has to settle it. */
export function isDisagreement(paper) {
  return (
    paper.draft_decision != null &&
    paper.verified_decision != null &&
    paper.draft_decision !== paper.verified_decision
  )
}

/** The single bucket a paper belongs to. Exhaustive, so counts always sum to the total. */
export function outcomeOf(paper) {
  if (paper.draft_decision == null) return OUTCOME.UNSCREENED
  if (paper.verified_decision == null) return OUTCOME.UNVERIFIED
  if (paper.draft_decision !== paper.verified_decision) return OUTCOME.DISAGREED
  return paper.verified_decision === 'INCLUDE' ? OUTCOME.CONFIRMED : OUTCOME.REJECTED
}

/** Count every bucket in one pass, so a dashboard can show them without five filters. */
export function tallyOutcomes(papers) {
  const counts = {
    [OUTCOME.CONFIRMED]: 0,
    [OUTCOME.REJECTED]: 0,
    [OUTCOME.DISAGREED]: 0,
    [OUTCOME.UNVERIFIED]: 0,
    [OUTCOME.UNSCREENED]: 0,
  }
  for (const paper of papers) counts[outcomeOf(paper)] += 1
  return counts
}
