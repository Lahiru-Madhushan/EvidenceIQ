import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  CheckCircle2,
  CreditCard,
  Crown,
  ExternalLink,
  Info,
  Loader2,
  Lock,
  Minus,
  Receipt,
  RefreshCw,
  X,
} from 'lucide-react'

import Sidebar from '../components/dashboard/Sidebar'
import TopBar from '../components/dashboard/TopBar'
import { useAuth } from '../context/AuthContext'
import { ROUTE_FOR_NAV_KEY } from '../lib/navigation'
import { BILLING, FEATURES, PLANS, annualSaving } from '../lib/plans'
import {
  cancelCheckout,
  confirmCheckout,
  listPayments,
  startCheckout,
  useSubscription,
} from '../lib/subscriptionApi'

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

/** What one payment for this plan and period charges: annual is paid up front. */
function chargeOf(plan, period) {
  return priceOf(plan, period) * (period === 'annual' ? 12 : 1)
}

function money(cents, currency = 'usd') {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

const NOTICE_TONES = {
  success: {
    box: 'border-emerald-100 bg-emerald-50 text-emerald-800',
    hover: 'hover:bg-emerald-100',
    Icon: CheckCircle2,
  },
  info: { box: 'border-blue-100 bg-blue-50 text-blue-800', hover: 'hover:bg-blue-100', Icon: Info },
  error: { box: 'border-red-100 bg-red-50 text-red-700', hover: 'hover:bg-red-100', Icon: AlertTriangle },
}

/**
 * The researcher has just come back from Stripe: find out what happened.
 *
 * Stripe's redirect carries only a session id - not proof of anything - so the backend
 * asks Stripe directly, and only its answer changes the plan. Runs once per return; the
 * query string is then cleared so a reload does not ask again.
 */
function useCheckoutReturn({ onSubscription, onNotice, onSettled }) {
  const [params, setParams] = useSearchParams()
  const handled = useRef(false)
  const outcome = params.get('checkout')
  const sessionId = params.get('session_id')
  const paymentId = params.get('payment_id')

  useEffect(() => {
    if (!outcome || handled.current) return
    handled.current = true
    setParams({}, { replace: true })

    if (outcome === 'success' && sessionId) {
      onNotice({ tone: 'info', text: 'Confirming your payment with Stripe…' })
      confirmCheckout(sessionId)
        .then(({ payment, subscription }) => {
          onSubscription(subscription)
          const name = PLANS.find((plan) => plan.id === payment.plan_id)?.name ?? 'your plan'
          if (payment.status === 'paid') {
            onNotice({
              tone: 'success',
              text: `Payment received: ${money(payment.amount_cents, payment.currency)} for the ${name} plan. Thank you!`,
            })
          } else if (payment.status === 'pending') {
            onNotice({
              tone: 'info',
              text: 'Stripe has not confirmed this payment yet. Your plan will update as soon as it does.',
            })
          } else {
            onNotice({
              tone: 'error',
              text:
                payment.failure_reason ||
                'The payment did not go through, so your plan has not changed.',
            })
          }
        })
        .catch((error) =>
          onNotice({ tone: 'error', text: `Could not confirm your payment: ${error.message}` })
        )
        .finally(onSettled)
    } else if (outcome === 'cancelled' && paymentId) {
      cancelCheckout(paymentId)
        .then((payment) =>
          onNotice(
            payment.status === 'paid'
              ? { tone: 'success', text: 'Your payment had already gone through, so your plan is active.' }
              : { tone: 'info', text: 'Checkout cancelled. You have not been charged.' }
          )
        )
        .catch(() => onNotice({ tone: 'info', text: 'Checkout cancelled. You have not been charged.' }))
        .finally(onSettled)
    }
  }, [outcome, sessionId, paymentId, setParams, onSubscription, onNotice, onSettled])
}

function usePayments() {
  const [payments, setPayments] = useState(null)
  const [error, setError] = useState(null)

  const reload = useCallback(() => {
    listPayments()
      .then((rows) => {
        setPayments(rows)
        setError(null)
      })
      .catch((loadError) => setError(loadError.message))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { payments, error, reload }
}

/**
 * Subscription: the plan you are on, the plans you could be on, a way to pay for one,
 * and the record of what you have paid.
 *
 * Paid plans are prepaid per period through Stripe Checkout: the card is entered on
 * Stripe's own page, and the plan changes only once the backend has confirmed the
 * payment with Stripe. Moving to Free needs no payment and applies at once.
 */
export default function Subscription() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { subscription, plan: current, loading, error, change, replace } = useSubscription()
  const { payments, error: paymentsError, reload: reloadPayments } = usePayments()

  // Null until the user touches the toggle, so it follows the saved billing period.
  const [periodChoice, setPeriodChoice] = useState(null)
  const period = periodChoice ?? subscription?.billing ?? 'monthly'

  const [pending, setPending] = useState(null)
  const [notice, setNotice] = useState(null)

  const currentBilling = current.id === 'free' ? 'monthly' : (subscription?.billing ?? 'monthly')

  useCheckoutReturn({ onSubscription: replace, onNotice: setNotice, onSettled: reloadPayments })

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

            {notice ? <Notice notice={notice} onDismiss={() => setNotice(null)} /> : null}

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
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" strokeWidth={2} />
                Payments are handled by Stripe: your card details go to Stripe, never to
                EvidenceIQ. Paid plans are prepaid for 30 days or a year and do not renew
                automatically. Plan limits are shown for reference and are not enforced yet.
              </p>
            </section>

            <PaymentHistory payments={payments} error={paymentsError} />

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
            if (pending.plan.id !== 'free') {
              // Off to Stripe. This page is left behind, so there is nothing to reset.
              const { checkout_url: url } = await startCheckout(pending.plan.id, pending.period)
              window.location.assign(url)
              return
            }
            const saved = await change(pending.plan.id, pending.period)
            setPending(null)
            setPeriodChoice(null)
            const name = PLANS.find((plan) => plan.id === saved.plan_id)?.name ?? 'your new plan'
            setNotice({ tone: 'success', text: `You're now on the ${name} plan.` })
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
  const expired = subscription?.status === 'expired'
  const lapsed = PLANS.find((candidate) => candidate.id === subscription?.expired_plan_id)

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
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${
                  expired
                    ? 'bg-amber-50 text-amber-700 ring-amber-100'
                    : 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                }`}
              >
                {subscription?.status ?? 'active'}
              </span>
            ) : null}
          </p>
          <p className="mt-1 max-w-md text-sm text-neutral-600">{plan.tagline}</p>
          {expired && lapsed ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              Your {lapsed.name} plan ended on {formatDate(subscription.expired_at)}. Buy it again
              below to pick up where you left off.
            </p>
          ) : null}
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
          {renews ? `Paid until ${renews}` : 'Never expires'}
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

  // A paid plan is prepaid, so the current one can be bought again to add time.
  const renewable = isCurrent && plan.id !== 'free'

  let action = null
  if (renewable) action = `Add ${period === 'annual' ? 'a year' : '30 days'}`
  else if (isCurrent) action = 'Current plan'
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
        disabled={disabled || (isCurrent && !renewable)}
        className={`mt-5 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
          isCurrent
            ? 'bg-white text-brand-blue ring-1 ring-brand-blue/30 enabled:hover:bg-blue-50'
            : upgrade || samePlan
              ? 'bg-brand-blue text-white shadow-sm hover:bg-brand-blue-dark disabled:opacity-50'
              : 'border border-neutral-200 bg-white text-brand-black hover:bg-neutral-50 disabled:opacity-50'
        }`}
      >
        {renewable ? (
          <RefreshCw className="h-4 w-4" strokeWidth={2} />
        ) : isCurrent ? (
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
  const paid = to.id !== 'free'
  const renewing = paid && from.id === to.id && fromBilling === billing
  const charge = chargeOf(to, billing)

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
            {renewing
              ? `Add time to your ${to.name} plan?`
              : from.id === to.id
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

        {paid ? (
          <div className="mt-4 rounded-xl border border-neutral-100 bg-slate-50 p-3 text-xs text-neutral-600">
            <p className="flex items-center justify-between gap-3 text-sm">
              <span>Due today</span>
              <span className="font-bold text-brand-black">${charge}.00</span>
            </p>
            <p className="mt-1.5">
              {renewing
                ? `Adds ${billing === 'annual' ? '365' : '30'} days after your current period ends.`
                : `${billing === 'annual' ? '365' : '30'} days of ${to.name}, starting as soon as the payment is confirmed. It does not renew automatically.`}
            </p>
            <p className="mt-2 flex items-start gap-1.5 text-neutral-500">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" strokeWidth={2} />
              You&rsquo;ll pay on Stripe&rsquo;s secure page. Test mode: card 4242 4242 4242 4242,
              any future date and any CVC.
            </p>
          </div>
        ) : (
          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-neutral-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-blue" strokeWidth={2} />
            Moving to Free applies as soon as you confirm. Time left on a paid plan is not refunded.
          </p>
        )}

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
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : paid ? (
              <CreditCard className="h-4 w-4" strokeWidth={2} />
            ) : null}
            {saving
              ? paid
                ? 'Opening checkout…'
                : 'Saving…'
              : paid
                ? `Pay $${charge} with Stripe`
                : 'Confirm change'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- notice ----- */

function Notice({ notice, onDismiss }) {
  const tone = NOTICE_TONES[notice.tone] ?? NOTICE_TONES.info
  const { Icon } = tone
  return (
    <p
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-medium ${tone.box}`}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
      {notice.text}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className={`ml-auto rounded p-0.5 ${tone.hover}`}
      >
        <X className="h-4 w-4" strokeWidth={2} />
      </button>
    </p>
  )
}

/* ---------------------------------------------------------- payment history ----- */

const PAYMENT_STATUS = {
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  pending: 'bg-blue-50 text-blue-700 ring-blue-100',
  failed: 'bg-red-50 text-red-700 ring-red-100',
  cancelled: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
  expired: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
}

function PaymentHistory({ payments, error }) {
  return (
    <section className="rounded-2xl border border-neutral-100 bg-white p-5">
      <h2 className="flex items-center gap-2 text-base font-bold text-brand-black">
        <Receipt className="h-4 w-4 text-brand-blue" strokeWidth={2} />
        Payment history
      </h2>

      {error ? (
        <p className="mt-3 text-sm text-red-700">Could not load your payments: {error}</p>
      ) : payments === null ? (
        <Loader2 className="mt-4 h-5 w-5 animate-spin text-neutral-400" />
      ) : payments.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">
          No payments yet. When you buy a plan, each payment and its receipt appear here.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-xs text-neutral-500">
                <th className="py-2 pr-4 font-semibold">Date</th>
                <th className="py-2 pr-4 font-semibold">Plan</th>
                <th className="py-2 pr-4 font-semibold">Amount</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold">Card</th>
                <th className="py-2 font-semibold">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => {
                const name = PLANS.find((plan) => plan.id === payment.plan_id)?.name ?? payment.plan_id
                return (
                  <tr key={payment.id} className="border-b border-neutral-50 last:border-0">
                    <td className="py-2.5 pr-4 text-xs text-neutral-700">
                      {formatDate(payment.paid_at ?? payment.created_at)}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-neutral-700">
                      <span className="font-semibold text-brand-black">{name}</span>{' '}
                      <span className="text-neutral-500">· {BILLING[payment.billing]?.label ?? payment.billing}</span>
                      {payment.status === 'paid' && payment.period_end ? (
                        <span className="block text-[11px] text-neutral-400">
                          {formatDate(payment.period_start)} – {formatDate(payment.period_end)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-4 text-xs font-semibold text-brand-black">
                      {money(payment.amount_cents, payment.currency)}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span
                        title={payment.failure_reason ?? undefined}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ${
                          PAYMENT_STATUS[payment.status] ?? PAYMENT_STATUS.cancelled
                        }`}
                      >
                        {payment.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-xs capitalize text-neutral-700">
                      {payment.card_last4 ? `${payment.card_brand ?? 'Card'} •••• ${payment.card_last4}` : '—'}
                    </td>
                    <td className="py-2.5 text-xs">
                      {payment.receipt_url ? (
                        <a
                          href={payment.receipt_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-brand-blue hover:underline"
                        >
                          View
                          <ExternalLink className="h-3 w-3" strokeWidth={2} />
                        </a>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
