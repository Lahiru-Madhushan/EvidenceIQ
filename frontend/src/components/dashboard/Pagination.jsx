import { ChevronLeft, ChevronRight } from 'lucide-react'

// Renders first pages, an ellipsis, then the last page - so 54 pages does not become
// 54 buttons.
function pageList(current, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (current <= 4) return [1, 2, 3, 4, 5, '...', totalPages]
  if (current >= totalPages - 3) {
    return [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }
  return [1, '...', current - 1, current, current + 1, '...', totalPages]
}

export default function Pagination({ page, totalPages, rangeLabel, onChange }) {
  if (totalPages <= 1) {
    return <p className="text-sm text-neutral-500">{rangeLabel}</p>
  }

  const button = 'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm transition-colors'

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-neutral-500">{rangeLabel}</p>

      <nav className="flex items-center gap-1" aria-label="Pagination">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page === 1}
          aria-label="Previous page"
          className={`${button} text-neutral-500 hover:bg-neutral-50 disabled:opacity-40 disabled:hover:bg-transparent`}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {pageList(page, totalPages).map((entry, index) =>
          entry === '...' ? (
            <span key={`gap-${index}`} className="px-1 text-sm text-neutral-400">
              ...
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onChange(entry)}
              aria-current={entry === page ? 'page' : undefined}
              className={`${button} ${
                entry === page
                  ? 'bg-brand-blue font-semibold text-white'
                  : 'text-brand-black hover:bg-neutral-50'
              }`}
            >
              {entry}
            </button>
          )
        )}

        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page === totalPages}
          aria-label="Next page"
          className={`${button} text-neutral-500 hover:bg-neutral-50 disabled:opacity-40 disabled:hover:bg-transparent`}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </nav>
    </div>
  )
}
