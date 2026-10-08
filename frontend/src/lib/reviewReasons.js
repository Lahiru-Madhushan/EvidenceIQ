/**
 * Why a paper is waiting on the researcher.
 *
 * `needs_human_review` is one boolean, but it is set for several different reasons, and
 * a researcher deciding a flagged paper needs to know which one: a disagreement asks
 * "which agent is right?", a missing abstract asks "is this worth fetching the full
 * text?", flagged text asks "was this paper trying to steer the screen?". Each reason
 * below is derived from columns the paper already carries, so nothing new is stored.
 */

import { isDisagreement, isUnverified } from './outcomes'

const PLACEHOLDER_ABSTRACT = /^abstract not available\.?$/i

function hasNoAbstract(paper) {
  const text = (paper.abstract ?? '').trim()
  return !text || PLACEHOLDER_ABSTRACT.test(text)
}

// Order is priority order: the first reason is the headline shown when space is short.
export const REASONS = [
  {
    key: 'disagreed',
    label: 'Agents disagreed',
    help: 'Agent 3 and Agent 4 reached different answers. Read the evidence and pick a side.',
    tone: 'bg-amber-50 text-amber-800 ring-amber-200',
    test: (paper) => isDisagreement(paper) || paper.agreement === false,
  },
  {
    key: 'flagged',
    label: 'Suspicious text',
    help: 'Wording in the title or abstract looked like an attempt to steer the AI.',
    tone: 'bg-red-50 text-red-700 ring-red-200',
    test: (paper) => (paper.issues?.length ?? 0) > 0,
  },
  {
    key: 'low',
    label: 'Low confidence',
    help: 'Several criteria could not be confirmed from the abstract.',
    tone: 'bg-orange-50 text-orange-700 ring-orange-200',
    test: (paper) => paper.confidence === 'LOW',
  },
  {
    key: 'noAbstract',
    label: 'No abstract',
    help: 'PubMed has no abstract for this paper, so the agents could not judge it.',
    tone: 'bg-slate-100 text-slate-700 ring-slate-200',
    test: hasNoAbstract,
  },
  {
    key: 'unverified',
    label: 'Not verified',
    help: 'Only Agent 3 has seen this paper; Agent 4 has not checked it yet.',
    tone: 'bg-violet-50 text-violet-700 ring-violet-200',
    test: isUnverified,
  },
]

const FALLBACK = {
  key: 'other',
  label: 'Flagged by the agents',
  help: 'The agents asked for a human to look at this paper.',
  tone: 'bg-neutral-100 text-neutral-700 ring-neutral-200',
}

/** Every reason that applies to this paper, most important first. Never empty. */
export function reviewReasons(paper) {
  const found = REASONS.filter((reason) => reason.test(paper))
  return found.length ? found : [FALLBACK]
}

/** Flagged by the agents and not yet decided by the researcher. */
export function needsDecision(paper) {
  return Boolean(paper.needs_human_review) && paper.researcher_status == null
}
