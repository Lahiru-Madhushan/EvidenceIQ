/**
 * What a review's badge should say.
 *
 * `reviews.status` only distinguishes Agent 1's outcome — it goes to "screening" as soon
 * as a protocol exists and stays there, so it cannot tell a review with nothing retrieved
 * apart from one the researcher has finished. The badge is derived from the papers
 * instead, and the backend recomputes the stored status from the same rules
 * (app/routers/reviews.py) so the two never disagree.
 *
 * `counts` is { total, screened } from getPaperCountsByReview, and `decided` the number
 * of papers the researcher has ruled on. Any of them may be missing while data loads.
 */
export function reviewProgress(review, counts = {}, decided = 0) {
  const total = counts.total ?? 0
  const screened = counts.screened ?? 0

  // Agent 1's states come first: until the criteria are interpreted, nothing about the
  // papers is meaningful.
  if (review.status === 'awaiting_clarification') {
    return {
      key: 'needs_you',
      filter: 'needs_you',
      label: 'Needs you',
      detail: 'Agent 1 asked a question',
      tone: 'bg-amber-50 text-amber-700',
      dot: 'bg-amber-500',
    }
  }

  if (!review.protocol) {
    return {
      key: 'draft',
      filter: 'not_started',
      label: 'Draft',
      detail: 'No protocol yet',
      tone: 'bg-neutral-100 text-neutral-600',
      dot: 'bg-neutral-400',
    }
  }

  if (total === 0) {
    return {
      key: 'no_papers',
      filter: 'not_started',
      label: 'No papers',
      detail: 'Nothing retrieved yet',
      tone: 'bg-neutral-100 text-neutral-600',
      dot: 'bg-neutral-400',
    }
  }

  if (screened < total) {
    return {
      key: 'screening',
      filter: 'screening',
      label: 'Screening',
      detail: `${screened} of ${total} screened`,
      tone: 'bg-emerald-50 text-emerald-700',
      dot: 'bg-emerald-500',
    }
  }

  if (decided < total) {
    return {
      key: 'ready',
      filter: 'ready',
      label: 'Ready for review',
      detail: `${total - decided} awaiting your decision`,
      tone: 'bg-blue-50 text-blue-700',
      dot: 'bg-blue-500',
    }
  }

  return {
    key: 'complete',
    filter: 'complete',
    label: 'Complete',
    detail: `all ${total} decided`,
    tone: 'bg-violet-50 text-violet-700',
    dot: 'bg-violet-500',
  }
}

// The filter buckets, in the order a review moves through them.
export const PROGRESS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'needs_you', label: 'Needs you' },
  { key: 'not_started', label: 'Not started' },
  { key: 'screening', label: 'Screening' },
  { key: 'ready', label: 'Ready for review' },
  { key: 'complete', label: 'Complete' },
]
