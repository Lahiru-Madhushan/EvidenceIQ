// Small status pills shared by the papers table and the details panel.
// Colours are deliberate: INCLUDE/EXCLUDE read as green/red, but UNCLEAR is grey rather
// than red - "the abstract does not say" is not the same as "this failed".

const DECISION_STYLES = {
  INCLUDE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  EXCLUDE: 'bg-red-50 text-red-700 ring-red-200',
  UNCLEAR: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
}

const CONFIDENCE_STYLES = {
  HIGH: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  MEDIUM: 'bg-amber-50 text-amber-700 ring-amber-200',
  LOW: 'bg-red-50 text-red-700 ring-red-200',
}

const STATUS_STYLES = {
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  overridden: 'bg-red-50 text-red-700 ring-red-200',
  maybe: 'bg-blue-50 text-brand-blue ring-blue-200',
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
}

const STATUS_LABELS = {
  approved: 'Approved',
  overridden: 'Excluded',
  maybe: 'Maybe',
  pending: 'Needs Review',
}

const BASE = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset whitespace-nowrap'

// `emptyLabel` is for a decision an agent has not made yet: "Pending" is not a verdict,
// and showing UNCLEAR there read as if Agent 4 had looked and could not tell.
export function DecisionBadge({ value, emptyLabel }) {
  if (value == null && emptyLabel) {
    return (
      <span className={`${BASE} bg-white text-neutral-400 ring-neutral-200`}>
        {emptyLabel}
      </span>
    )
  }
  const label = value ?? 'UNCLEAR'
  return <span className={`${BASE} ${DECISION_STYLES[label] ?? DECISION_STYLES.UNCLEAR}`}>{label}</span>
}

export function ConfidenceBadge({ value }) {
  if (!value) return <span className="text-xs text-neutral-400">--</span>
  return <span className={`${BASE} ${CONFIDENCE_STYLES[value]}`}>{value}</span>
}

// researcher_status is null until the human decides; that reads as "Needs Review".
export function StatusBadge({ value }) {
  const key = value ?? 'pending'
  return <span className={`${BASE} ${STATUS_STYLES[key]}`}>{STATUS_LABELS[key]}</span>
}

export function CheckStatusBadge({ value }) {
  const styles = {
    PASS: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    FAIL: 'bg-red-50 text-red-700 ring-red-200',
    UNCLEAR: 'bg-neutral-100 text-neutral-600 ring-neutral-200',
  }
  return <span className={`${BASE} ${styles[value]}`}>{value}</span>
}

// rule = decided by deterministic code from PubMed metadata, no LLM involved.
export function SourceTag({ value }) {
  const isRule = value === 'rule'
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        isRule ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-brand-blue'
      }`}
      title={isRule ? 'Decided by a deterministic rule from PubMed metadata' : 'Decided by the LLM reading the abstract'}
    >
      {value}
    </span>
  )
}
