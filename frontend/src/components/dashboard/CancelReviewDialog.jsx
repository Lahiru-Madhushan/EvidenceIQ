import { useEffect } from 'react'
import { Ban, Save, Trash2, X } from 'lucide-react'

/**
 * Confirms cancelling a review while its agents are running.
 *
 * Two different things can be meant by "cancel": stop spending quota but keep what has
 * been screened, or throw the whole review away. They are offered side by side, with
 * what each keeps said plainly, rather than guessed. Before any paper has been screened
 * there is nothing to keep, so only discarding is offered.
 */
export default function CancelReviewDialog({ screened, canKeep, onKeep, onDiscard, onClose }) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cancel-review-title"
        className="w-full max-w-[500px] rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <Ban className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h2 id="cancel-review-title" className="text-lg font-semibold text-brand-black">
                Cancel this review?
              </h2>
              <p className="mt-1 text-sm text-neutral-500">
                The agents stop straight away. No more papers are fetched or screened.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-brand-black"
          >
            <X className="h-5 w-5" strokeWidth={1.9} />
          </button>
        </div>

        <div className="mt-5 space-y-2.5">
          {canKeep ? (
            <button
              type="button"
              onClick={onKeep}
              className="flex w-full items-start gap-3 rounded-xl border border-brand-blue/30 bg-blue-50/50 p-3.5 text-left transition-colors hover:bg-blue-50"
            >
              <Save className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" strokeWidth={2} />
              <span>
                <span className="block text-sm font-semibold text-brand-black">
                  Stop and keep results
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-neutral-600">
                  {screened > 0
                    ? `The ${screened} paper${screened === 1 ? '' : 's'} screened so far stay in the review. `
                    : 'The review stays saved. '}
                  A paper caught mid-check may be left without its second opinion.
                </span>
              </span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={onDiscard}
            className="flex w-full items-start gap-3 rounded-xl border border-red-200 bg-red-50/60 p-3.5 text-left transition-colors hover:bg-red-50"
          >
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-red-600" strokeWidth={2} />
            <span>
              <span className="block text-sm font-semibold text-red-700">
                Cancel and delete review
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-red-800/80">
                Deletes this review and everything screened so far. This cannot be undone.
                Your question and criteria stay in the form.
              </span>
            </span>
          </button>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-brand-black transition-colors hover:bg-neutral-50"
          >
            Keep running
          </button>
        </div>
      </div>
    </div>
  )
}
