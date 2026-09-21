import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Minus, Sparkles } from 'lucide-react'

// The plans live in lib/plans.js: the Settings page reads the same list, and two
// copies would disagree the first time a limit changed.
import { BILLING, FEATURES, PLANS, annualSaving } from '../../lib/plans'

/**
 * The pricing section the navbar has always linked to.
 *
 * Two decisions shape the table below.
 *
 * The screening itself is identical on every plan. All four agents run, every decision
 * is independently verified, and every criterion carries its quoted evidence — on the
 * free plan as much as the paid ones. A systematic review is evidence for a clinical
 * claim, so selling a cheaper tier that checks papers less carefully would make the
 * price the reason a study was included. Plans differ in how much you can run, never in
 * how well it is run.
 *
 * The two paid plans therefore carry the same feature set and differ only in volume,
 * seats and support. That is what the table is for: every plan answers the same ordered
 * list of rows, so the cards line up and the real difference is easy to see.
 */

const ANNUAL_SAVING = annualSaving(PLANS)

/** A feature value: a tick, a dash, or a quantity like "200" or "Unlimited". */
function FeatureValue({ value, label }) {
  if (value === true) {
    return (
      <>
        <Check className="w-4 h-4 shrink-0 text-brand-blue" strokeWidth={2.4} aria-hidden="true" />
        <span className="sr-only">Included: </span>
        <span className="text-neutral-600">{label}</span>
      </>
    )
  }

  if (value === false) {
    return (
      <>
        <Minus className="w-4 h-4 shrink-0 text-neutral-300" strokeWidth={2.4} aria-hidden="true" />
        <span className="sr-only">Not included: </span>
        <span className="text-neutral-400 line-through decoration-neutral-200">{label}</span>
      </>
    )
  }

  return (
    <>
      <Check className="w-4 h-4 shrink-0 text-brand-blue" strokeWidth={2.4} aria-hidden="true" />
      <span className="text-neutral-600">
        <span className="font-semibold text-brand-black">{value}</span> · {label}
      </span>
    </>
  )
}

export default function PricingSection() {
  const [billing, setBilling] = useState('monthly')
  const { suffix } = BILLING[billing]

  return (
    <section id="pricing" className="scroll-mt-24 bg-neutral-50/60 py-16 sm:py-20">
      <div className="max-w-[1200px] mx-auto px-6 sm:px-10">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-brand-black">
            Plans that scale with your reading, not your standards
          </h2>
          <p className="mt-3 text-neutral-500 leading-relaxed">
            Every plan runs all four agents and verifies every decision independently. What
            changes is how much you can screen, not how carefully it is screened.
          </p>
        </div>

        <div className="mt-8 flex justify-center">
          <div
            role="radiogroup"
            aria-label="Billing period"
            className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white p-1"
          >
            {Object.entries(BILLING).map(([key, { label }]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={billing === key}
                onClick={() => setBilling(key)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  billing === key
                    ? 'bg-brand-blue text-white'
                    : 'text-neutral-600 hover:text-brand-black'
                }`}
              >
                {label}
                {key === 'annual' && (
                  <span
                    className={`ml-1.5 text-xs font-medium ${
                      billing === key ? 'text-blue-100' : 'text-brand-blue'
                    }`}
                  >
                    Save {ANNUAL_SAVING}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-3 items-start">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative flex h-full flex-col rounded-2xl bg-white p-6 sm:p-7 ${
                plan.highlighted
                  ? 'border-2 border-brand-blue shadow-lg shadow-blue-100/70 lg:-mt-3'
                  : 'border border-neutral-200'
              }`}
            >
              {plan.highlighted && (
                <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-brand-blue px-3 py-1 text-xs font-semibold text-white">
                  <Sparkles className="w-3 h-3" strokeWidth={2.4} aria-hidden="true" />
                  Most popular
                </span>
              )}

              <h3 className="text-lg font-bold text-brand-black">{plan.name}</h3>
              <p className="mt-1.5 text-sm text-neutral-500 leading-relaxed min-h-[2.75rem]">
                {plan.tagline}
              </p>

              <p className="mt-5 flex items-baseline gap-1.5">
                <span className="text-4xl font-bold tracking-tight text-brand-black">
                  ${plan.price[billing]}
                </span>
                <span className="text-sm text-neutral-500">
                  {plan.price[billing] === 0 ? 'forever' : suffix}
                </span>
              </p>
              {/* Kept its own line so the cards stay the same height on both tabs. */}
              <p className="mt-1 text-xs text-neutral-400 h-4">
                {billing === 'annual' && plan.price.annual > 0
                  ? `$${plan.price.annual * 12} per year`
                  : ''}
              </p>

              <Link
                to={plan.to}
                className={`mt-6 block rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
                  plan.highlighted
                    ? 'bg-brand-blue text-white hover:bg-brand-blue-dark'
                    : 'border border-neutral-200 text-brand-black hover:bg-neutral-50'
                }`}
              >
                {plan.cta}
              </Link>

              <ul className="mt-7 flex flex-col gap-3 text-sm">
                {FEATURES.map(({ key, label }) => (
                  <li key={key} className="flex items-start gap-2.5 leading-snug">
                    <FeatureValue value={plan.features[key]} label={label} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-neutral-500">
          Every plan includes the human-in-the-loop review screen — no decision is final until
          a researcher approves it.
        </p>
      </div>
    </section>
  )
}
