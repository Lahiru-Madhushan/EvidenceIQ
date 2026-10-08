import { Layers, CheckCircle2, XCircle, Clock, ShieldCheck, ChevronRight } from 'lucide-react'

// `hint` carries the percentage line under each number. Kept as a prop rather than
// computed here so the caller decides what a percentage is *of*.
const CARDS = [
  { key: 'total', label: 'Total Papers', icon: Layers, tone: 'text-brand-blue bg-blue-50' },
  { key: 'included', label: 'Included', icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50' },
  // The shortlist both agents reached independently. Sits next to Included on
  // purpose: the gap between the two numbers is the papers only one agent has seen.
  { key: 'confirmed', label: 'Confirmed by both', icon: ShieldCheck, tone: 'text-violet-600 bg-violet-50' },
  { key: 'excluded', label: 'Excluded', icon: XCircle, tone: 'text-red-600 bg-red-50' },
  { key: 'needsReview', label: 'Needs Review', icon: Clock, tone: 'text-amber-600 bg-amber-50' },
]

/**
 * `selectable` lists the cards that open a tab; `onSelect(key)` is called when one is
 * clicked and `activeKey` marks the card whose tab is showing. A card with somewhere to
 * go is a button, so the number is also the way to the papers behind it.
 */
export default function StatCards({ stats, selectable = [], onSelect, activeKey }) {
  const total = stats.total || 0
  const percent = (value) => (total ? `${Math.round((value / total) * 100)}% of total` : '--')

  const hints = {
    total: 'Retrieved from PubMed',
    included: percent(stats.included),
    confirmed: stats.unverified
      ? `${stats.unverified} still unverified`
      : percent(stats.confirmed),
    excluded: percent(stats.excluded),
    needsReview: stats.needsReview ? 'Waiting for your decision' : 'Nothing waiting on you',
  }

  return (
    // Sized by the space it is given, not the window: with the paper panel open the
    // column is far narrower than the screen, and five cards in it crushed every label.
    <div className="@container">
    <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @4xl:grid-cols-5">
      {CARDS.map(({ key, label, icon: Icon, tone }) => {
        const clickable = Boolean(onSelect) && selectable.includes(key)
        const urgent = key === 'needsReview' && stats.needsReview > 0
        const active = clickable && activeKey === key

        const content = (
          <div className="flex flex-col items-start gap-2 @md:flex-row @md:gap-3">
            <span
              className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}
            >
              <Icon className="h-5 w-5" strokeWidth={1.9} />
              {urgent ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75 motion-reduce:hidden" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
                </span>
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-neutral-500">{label}</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-brand-black">
                {(stats[key] ?? 0).toLocaleString()}
              </p>
              <p className={`mt-0.5 text-xs ${urgent ? 'font-medium text-amber-700' : 'text-neutral-400'}`}>
                {hints[key]}
              </p>
            </div>
            {clickable ? (
              <ChevronRight
                className="mt-1 hidden h-4 w-4 shrink-0 text-neutral-300 transition-transform @md:block group-hover:translate-x-0.5 group-hover:text-brand-blue"
                strokeWidth={2}
              />
            ) : null}
          </div>
        )

        const frame = `rounded-2xl border p-4 text-left shadow-card ${
          active
            ? 'border-brand-blue bg-blue-50/40 ring-1 ring-brand-blue/30'
            : urgent
              ? 'border-amber-200 bg-gradient-to-br from-amber-50/80 to-white'
              : 'border-slate-200/80 bg-white'
        }`

        return clickable ? (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-pressed={active}
            className={`group ${frame} transition-all hover:-translate-y-0.5 hover:shadow-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40`}
          >
            {content}
          </button>
        ) : (
          <div key={key} className={frame}>
            {content}
          </div>
        )
      })}
    </div>
    </div>
  )
}
