/**
 * The plans, and what each one includes.
 *
 * Lives here rather than inside the pricing section because two places now answer the
 * same question - the landing page sells the plans, and Settings tells you which one
 * you are on. Two copies of this list would disagree the first time a limit changed,
 * and the copy that disagreed would be the one a paying user was reading.
 *
 * The screening itself is identical on every plan: all four agents run, every decision
 * is independently verified, and every criterion carries its quoted evidence, on the
 * free plan as much as the paid ones. Plans differ in how much you can run, never in
 * how well it is run.
 */

export const BILLING = {
  monthly: { label: 'Monthly', suffix: '/month' },
  annual: { label: 'Annual', suffix: '/month, billed yearly' },
}

// Every plan answers each of these, in this order, so the columns stay comparable.
export const FEATURES = [
  { key: 'reviews', label: 'Reviews per month' },
  { key: 'papers', label: 'Papers per review' },
  { key: 'pipeline', label: 'All four agents (criteria, retrieval, screening, verification)' },
  { key: 'verification', label: 'Independent second opinion on every decision' },
  { key: 'evidence', label: 'Quoted evidence for every criterion' },
  { key: 'export', label: 'Export decisions (CSV / RIS)' },
  { key: 'history', label: 'Full audit history per paper' },
  { key: 'priority', label: 'Priority processing queue' },
  { key: 'seats', label: 'Team members' },
  { key: 'support', label: 'Support' },
]

// Prices are set per period rather than derived from a discount factor. Deriving them
// produces figures nobody would ship - a sixth off $29 is $24.17 a month - so each one
// is chosen, and the saving shown to the reader is measured back from the two numbers.
export const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: { monthly: 0, annual: 0 },
    tagline: 'Enough to run a real review and see the whole pipeline work.',
    cta: 'Start free',
    to: '/register',
    features: {
      reviews: '3',
      papers: '25',
      pipeline: true,
      verification: true,
      evidence: true,
      export: false,
      history: false,
      priority: false,
      seats: '1',
      support: 'Community',
    },
  },
  {
    id: 'researcher',
    name: 'Researcher',
    price: { monthly: 29, annual: 24 },
    tagline: 'For a postgraduate or clinician running reviews through the year.',
    cta: 'Choose Researcher',
    to: '/register',
    highlighted: true,
    features: {
      reviews: '50',
      papers: '200',
      pipeline: true,
      verification: true,
      evidence: true,
      export: true,
      history: true,
      priority: true,
      seats: '5',
      support: 'Email, 1 business day',
    },
  },
  {
    id: 'lab',
    name: 'Lab',
    price: { monthly: 99, annual: 82 },
    tagline: 'For a research group or department screening together.',
    cta: 'Choose Lab',
    to: '/register',
    features: {
      reviews: 'Unlimited',
      papers: '500',
      pipeline: true,
      verification: true,
      evidence: true,
      export: true,
      history: true,
      priority: true,
      seats: 'Unlimited',
      support: 'Priority, with onboarding',
    },
  },
]

/** The largest saving any plan offers, so the toggle can advertise it honestly. */
export function annualSaving(plans = PLANS) {
  const rates = plans
    .filter((plan) => plan.price.monthly > 0)
    .map((plan) => 1 - plan.price.annual / plan.price.monthly)
  return rates.length ? Math.round(Math.max(...rates) * 100) : 0
}

/**
 * The plan this account is on.
 *
 * There is no billing system yet: no subscriptions table, no payment provider, nothing
 * that could make this anything but Free. Reading it through one function means the
 * Settings page states a fact rather than a guess, and means there is exactly one place
 * to change when billing does arrive.
 */
export function planForUser(user) {
  const claimed = user?.user_metadata?.plan
  return PLANS.find((plan) => plan.id === claimed) ?? PLANS[0]
}
