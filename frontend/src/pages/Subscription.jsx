import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  CheckCircle2,
  CreditCard,
  Crown,
  Info,
  Loader2,
  Minus,
  RefreshCw,
  X,
} from 'lucide-react'

import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import { useAuth } from '../context/AuthContext'
import { ROUTE_FOR_NAV_KEY } from '../lib/navigation'
import { BILLING, FEATURES, PLANS, annualSaving } from '../lib/plans'
import { useSubscription } from '../lib/subscriptionApi'

const ANNUAL_SAVING = annualSaving(PLANS)

// Position in PLANS decides upgrade versus downgrade, so adding a plan in the right
// place is all it takes for the buttons to read correctly.
const RANK = Object.fromEntries(PLANS.map((plan, index) => [plan.id, index]))

function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function priceOf(plan, period) {
  return plan.price[period] ?? plan.price.monthly
}

/**
 * Subscription: the plan you are on, the plans you could be on, and a way to switch.
 *
 * No payment is taken - billing is not connected yet - so a change is recorded by the
 * backend immediately. The page says so wherever it asks for a decision, so nobody
 * believes they have been charged, or that they have paid for something.
 */
export default function Subscription() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { subscription, plan: current, loading, error, change } = useSubscription()

  // Null until the user touches the toggle, so it follows the saved billing period.
  const [periodChoice, setPeriodChoice] = useState(null)
  const period = periodChoice ?? subscription?.billing ?? 'monthly'

  const [pending, setPending] = useState(null)
  const [notice, setNotice] = useState(null)

  const currentBilling = current.id === 'free' ? 'monthly' : (subscription?.billing ?? 'monthly')

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <TopBar user={user} onSignOut={signOut} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          active="subscription"
          onNavigate={(key) => {
            const route = ROUTE_FOR_NAV_KEY[key]
            if (route) navigate(route)
          }}
        />

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1180px] space-y-5 px-4 py-6 sm:px-6">
            <header className="flex flex-wrap items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 ring-1 ring-amber-100">
                <Crown className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-brand-black">Subscription</h1>
                <p className="mt-0.5 text-sm text-neutral-500">
                  See what your plan includes, compare the others, and switch whenever you like.
                </p>
              </div>
            </header>

            {error ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
                Could not load your subscription: {error}
              </p>
            ) : null}

            {notice ? (
              <p
                role="status"
                className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-medium text-emerald-800"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2} />
                {notice}
                <button
                  type="button"
                  onClick={() => setNotice(null)}
                  aria-label="Dismiss"
                  className="ml-auto rounded p-0.5 text-emerald-700 hover:bg-emerald-100"
                >
                  <X className="h-4 w-4" strokeWidth={2} />
                </button>
              </p>
            ) : null}

            <CurrentPlan
              plan={current}
              subscription={subscription}
              billing={currentBilling}
              loading={loading}
            />

            <section className="rounded-2xl border border-neutral-100 bg-white p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-brand-black">Available plans</h2>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    Every plan runs all four agents and verifies every decision. Plans differ
                    in how much you can run, not how well it is run.
                  </p>
                </div>
                <PeriodToggle value={period} onChange={setPeriodChoice} />
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {PLANS.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    period={period}
                    current={current}
                    currentBilling={currentBilling}
                    disabled={loading || Boolean(error)}
                    onChoose={() => setPending({ plan, period })}
                  />
                ))}
              </div>

              <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-neutral-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" strokeWidth={2} />
                Billing is not connected yet, so switching plans is free and takes effect
                immediately. Plan limits are shown for reference and are not enforced yet.
              </p>
            </section>

            <ComparisonTable current={current} />
          </div>
        </main>
      </div>

      {pending ? (
        <ConfirmChange
          from={current}
          fromBilling={currentBilling}
          to={pending.plan}
          period={pending.period}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const saved = await change(pending.plan.id, pending.period)
            setPending(null)
            setPeriodChoice(null)
            const name = PLANS.find((plan) => plan.id === saved.plan_id)?.name ?? 'your new plan'
            setNotice(`You're now on the ${name} plan.`)
          }}
        />
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------- current plan ----- */

function CurrentPlan({ plan, subscription, billing, loading }) {
  const price = priceOf(plan, billing)
  const since = formatDate(subscription?.started_at)
  const renews = formatDate(subscription?.renews_at)

  const facts = [
    { label: 'Reviews per month', value: plan.features.reviews },
    { label: 'Papers per review', value: plan.features.papers },
    { label: 'Team members', value: plan.features.seats },
    { label: 'Support', value: plan.features.support },
  ]

  return (
    <section className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/80 via-white to-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Your current plan
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-2xl font-bold text-brand-black">
              {loading ? <Loader2 className="h-6 w-6 animate-spin text-neutral-400" /> : plan.name}
            </span>
            {!loading ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold capitalize text-emerald-700 ring-1 ring-emerald-100">
                {subscription?.status ?? 'active'}
              </span>
            ) : null}
          </p>
          <p className="mt-1 max-w-md text-sm text-neutral-600">{plan.tagline}</p>
        </div>

        <div className="text-right">
          <p className="text-3xl font-bold text-brand-black">
            {price === 0 ? 'Free' : `$${price}`}
          </p>
          <p className="text-xs text-neutral-500">
            {price === 0 ? 'forever' : BILLING[billing].suffix}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-neutral-600">
        <span className="flex items-center gap-1.5">
          <CreditCard className="h-3.5 w-3.5 text-brand-blue" strokeWidth={2} />
          {plan.id === 'free' ? 'No billing' : `${BILLING[billing].label} billing`}
        </span>
        {since ? (
          <span className="flex items-center gap-1.5">
            <CalendarClock className="h-3.5 w-3.5 text-brand-blue" strokeWidth={2} />
            On this plan since {since}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5">
          <RefreshCw className="h-3.5 w-3.5 text-brand-blue" strokeWidth={2} />
          {renews ? `Renews ${renews}` : 'Never expires'}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {facts.map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-white px-3 py-2.5 ring-1 ring-neutral-100">
            <dt className="text-[11px] text-neutral-500">{label}</dt>
            <dd className="mt-0.5 truncate text-sm font-bold text-brand-black">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/* ----------------------------------------------------------------- plan cards ----- */

function PeriodToggle({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-xl bg-slate-100 p-1">
      {Object.entries(BILLING).map(([key, { label }]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            value === key ? 'bg-white text-brand-black shadow-sm' : 'text-neutral-500 hover:text-brand-black'
          }`}
        >
          {label}
          {key === 'annual' && ANNUAL_SAVING ? (
            <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
              Save {ANNUAL_SAVING}%
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

function PlanCard({ plan, period, current, currentBilling, disabled, onChoose }) {
  const price = priceOf(plan, period)
  const samePlan = plan.id === current.id
  const isCurrent = samePlan && (plan.id === 'free' || period === currentBilling)
  const upgrade = RANK[plan.id] > RANK[current.id]

  let action = null
  if (isCurrent) action = 'Current plan'
  else if (samePlan) action = `Switch to ${BILLING[period].label.toLowerCase()} billing`
  else action = `${upgrade ? 'Upgrade' : 'Downgrade'} to ${plan.name}`

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-5 ${
        isCurrent
          ? 'border-brand-blue bg-blue-50/40 ring-1 ring-brand-blue/30'
          : plan.highlighted
            ? 'border-brand-blue/30 bg-white'
            : 'border-neutral-200 bg-white'
      }`}
    >
      {isCurrent ? (
        <span className="absolute -top-2.5 left-5 rounded-full bg-brand-blue px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          Your plan
        </span>
      ) : plan.highlighted ? (
        <span className="absolute -top-2.5 left-5 rounded-full bg-amber-400 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
          Most popular
        </span>
      ) : null}

      <h3 className="text-lg font-bold text-brand-black">{plan.name}</h3>
      <p className="mt-1 min-h-[2.5rem] text-xs leading-relaxed text-neutral-500">{plan.tagline}</p>

      <p className="mt-3">
        <span className="text-3xl font-bold text-brand-black">${price}</span>
        <span className="ml-1 text-xs text-neutral-500">
          {price === 0 ? 'forever' : BILLING[period].suffix}
        </span>
      </p>
      <p className="h-4 text-[11px] text-neutral-400">
        {period === 'annual' && price > 0 ? `$${price * 12} per year` : ''}
      </p>

      <ul className="mt-4 flex-1 space-y-2">
        {FEATURES.map(({ key, label }) => {
          const value = plan.features[key]
          if (value === false) return null
          return (
            <li key={key} className="flex items-start gap-2 text-xs text-neutral-700">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" strokeWidth={2.4} />
              <span>
                {label}
                {value !== true ? (
                  <span className="ml-1 font-semibold text-brand-black">{value}</span>
                ) : null}
              </span>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        onClick={onChoose}
        disabled={disabled || isCurrent}
        className={`mt-5 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
          isCurrent
            ? 'bg-white text-brand-blue ring-1 ring-brand-blue/30'
            : upgrade || samePlan
              ? 'bg-brand-blue text-white shadow-sm hover:bg-brand-blue-dark disabled:opacity-50'
              : 'border border-neutral-200 bg-white text-brand-black hover:bg-neutral-50 disabled:opacity-50'
        }`}
      >
        {isCurrent ? (
          <Check className="h-4 w-4" strokeWidth={2.4} />
        ) : samePlan ? (
          <RefreshCw className="h-4 w-4" strokeWidth={2} />
        ) : upgrade ? (
          <ArrowUp className="h-4 w-4" strokeWidth={2.2} />
        ) : (
          <ArrowDown className="h-4 w-4" strokeWidth={2.2} />
        )}
        {action}
      </button>
    </div>
  )
}

/* ---------------------------------------------------------- comparison table ----- */

function ComparisonTable({ current }) {
  return (
    <section className="rounded-2xl border border-neutral-100 bg-white p-5">
      <h2 className="text-base font-bold text-brand-black">Compare plans</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-100 text-xs text-neutral-500">
              <th className="py-2 pr-4 font-semibold">Feature</th>
              {PLANS.map((plan) => (
                <th
                  key={plan.id}
                  className={`px-3 py-2 text-center font-semibold ${
                    plan.id === current.id ? 'text-brand-blue' : ''
                  }`}
                >
                  {plan.name}
                  {plan.id === current.id ? (
                    <span className="block text-[10px] font-medium">Your plan</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map(({ key, label }) => (
              <tr key={key} className="border-b border-neutral-50 last:border-0">
                <td className="py-2.5 pr-4 text-xs text-neutral-700">{label}</td>
                {PLANS.map((plan) => {
                  const value = plan.features[key]
                  return (
                    <td
                      key={plan.id}
                      className={`px-3 py-2.5 text-center text-xs ${
                        plan.id === current.id ? 'bg-blue-50/50' : ''
                      }`}
                    >
                      {value === true ? (
                        <Check
                          className="mx-auto h-4 w-4 text-brand-blue"
                          strokeWidth={2.4}
                          aria-label="Included"
                        />
                      ) : value === false ? (
                        <Minus
                          className="mx-auto h-4 w-4 text-neutral-300"
                          strokeWidth={2.4}
                          aria-label="Not included"
                        />
                      ) : (
                        <span className="font-semibold text-brand-black">{value}</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------ confirm dialog ----- */

function ConfirmChange({ from, fromBilling, to, period, onClose, onConfirm }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const downgrade = RANK[to.id] < RANK[from.id]
  const billing = to.id === 'free' ? 'monthly' : period
  const price = priceOf(to, billing)
  const oldPrice = priceOf(from, fromBilling)

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  async function confirm() {
    setSaving(true)
    setError(null)
    try {
      await onConfirm()
    } catch (saveError) {
      setError(saveError.message)
      setSaving(false)
    }
  }

  const lost = downgrade
    ? FEATURES.filter(({ key }) => from.features[key] !== false && to.features[key] === false)
    : []

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-plan-title"
        className="w-full max-w-[480px] rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="change-plan-title" className="text-lg font-semibold text-brand-black">
            {from.id === to.id
              ? `Switch to ${BILLING[billing].label.toLowerCase()} billing?`
              : `${downgrade ? 'Downgrade' : 'Upgrade'} to ${to.name}?`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-brand-black disabled:opacity-50"
          >
            <X className="h-5 w-5" strokeWidth={1.9} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl border border-neutral-100 p-3">
            <p className="text-[11px] text-neutral-500">Now</p>
            <p className="font-bold text-brand-black">{from.name}</p>
            <p className="text-xs text-neutral-500">
              {oldPrice === 0 ? 'Free' : `$${oldPrice} ${BILLING[fromBilling].suffix}`}
            </p>
          </div>
          <div className="rounded-xl border border-brand-blue/30 bg-blue-50/50 p-3">
            <p className="text-[11px] text-neutral-500">After</p>
            <p className="font-bold text-brand-blue">{to.name}</p>
            <p className="text-xs text-neutral-500">
              {price === 0 ? 'Free' : `$${price} ${BILLING[billing].suffix}`}
            </p>
          </div>
        </div>

        {downgrade ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
            <p className="font-semibold">Your limits go down straight away.</p>
            <p className="mt-1">
              {to.features.reviews} reviews a month and {to.features.papers} papers per review.
              {lost.length ? ` You'll lose: ${lost.map(({ label }) => label).join(', ')}.` : ''}
            </p>
          </div>
        ) : null}

        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-neutral-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" strokeWidth={2} />
          No payment is taken — billing isn&rsquo;t connected yet. The change applies as soon as
          you confirm.
        </p>

        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-red-100 bg-red-50 p-2.5 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-brand-black transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-blue-dark disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
            {saving ? 'Saving…' : 'Confirm change'}
          </button>
        </div>
      </div>
    </div>
  )
}
