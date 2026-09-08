import { Layers, CheckCircle2, XCircle, Clock } from 'lucide-react'

// `hint` carries the percentage line under each number. Kept as a prop rather than
// computed here so the caller decides what a percentage is *of*.
const CARDS = [
  { key: 'total', label: 'Total Papers', icon: Layers, tone: 'text-brand-blue bg-blue-50' },
  { key: 'included', label: 'Included', icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50' },
  { key: 'excluded', label: 'Excluded', icon: XCircle, tone: 'text-red-600 bg-red-50' },
  { key: 'needsReview', label: 'Needs Review', icon: Clock, tone: 'text-amber-600 bg-amber-50' },
]

export default function StatCards({ stats }) {
  const total = stats.total || 0
  const percent = (value) => (total ? `${Math.round((value / total) * 100)}% of total` : '--')

  const hints = {
    total: 'Retrieved from PubMed',
    included: percent(stats.included),
    excluded: percent(stats.excluded),
    needsReview: percent(stats.needsReview),
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {CARDS.map(({ key, label, icon: Icon, tone }) => (
        <div key={key} className="rounded-2xl border border-neutral-100 bg-white p-5">
          <div className="flex items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
              <Icon className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-neutral-500">{label}</p>
              <p className="mt-0.5 text-2xl font-bold tabular-nums text-brand-black">
                {stats[key].toLocaleString()}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400">{hints[key]}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
