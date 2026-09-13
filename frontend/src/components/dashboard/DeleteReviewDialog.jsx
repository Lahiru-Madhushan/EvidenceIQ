import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react'

import { deleteReview, getReviewFootprint } from '../../lib/reviewsApi'

/**
 * Confirms deleting a review, after saying plainly what goes with it.
 *
 * Deleting a review cascades to its papers and to their paper_events, so an accepted
 * deletion also erases every screening decision and the audit trail behind it. That is
 * not recoverable, so the dialog loads the real counts first and shows them rather than
 * asking "are you sure?" about an unspecified amount of work.
 *
 * Where the researcher has actually decided on papers, confirming also requires typing
 * the word - the friction is proportionate to what is lost. A review nobody has worked
 * through yet only needs one click.
 */
export default function DeleteReviewDialog({ review, onClose, onDeleted }) {
  const [footprint, setFootprint] = useState(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    let cancelled = false
    getReviewFootprint(review.id)
      .then((result) => {
        if (!cancelled) setFootprint(result)
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [review.id])

  // Escape closes, as long as the delete is not already in flight.
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape' && !deleting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleting, onClose])

  const needsTyping = (footprint?.decisions ?? 0) > 0
  const canDelete = !loading && !deleting && (!needsTyping || typed.trim().toLowerCase() === 'delete')

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await deleteReview(review.id)
      onDeleted(review)
    } catch (deleteError) {
      setError(deleteError.message)
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-review-title"
        className="w-full max-w-[520px] rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <Trash2 className="h-5 w-5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h2 id="delete-review-title" className="text-lg font-semibold text-brand-black">
                Delete this review?
              </h2>
              <p className="mt-1 line-clamp-2 text-sm text-neutral-500">
                {review.research_question}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            aria-label="Close"
            className="rounded-lg p-1 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-brand-black disabled:opacity-50"
          >
            <X className="h-5 w-5" strokeWidth={1.9} />
          </button>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
            <p>{error}</p>
          </div>
        ) : null}

        {loading ? (
          <p className="mt-5 flex items-center gap-2 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            Checking what this review contains…
          </p>
        ) : footprint ? (
          <div className="mt-5 rounded-xl border border-red-100 bg-red-50/60 p-4">
            <p className="text-sm font-medium text-red-900">This cannot be undone.</p>
            <ul className="mt-2 space-y-1 text-sm text-red-900/90">
              <li>
                <strong className="tabular-nums">{footprint.papers}</strong> paper
                {footprint.papers === 1 ? '' : 's'} and everything the agents concluded
                about them
              </li>
              <li>
                <strong className="tabular-nums">{footprint.decisions}</strong> decision
                {footprint.decisions === 1 ? '' : 's'} you made, and the notes you wrote
              </li>
              <li>The full audit history for those papers</li>
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-red-900/80">
              Audit records normally cannot be deleted, but they are removed along with
              the papers they belong to. There is no way to recover them afterwards.
            </p>
          </div>
        ) : null}

        {needsTyping ? (
          <label className="mt-4 block">
            <span className="text-sm text-brand-black">
              Type <strong>delete</strong> to confirm
            </span>
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              disabled={deleting}
              autoFocus
              className="mt-2 w-full rounded-lg border border-neutral-200 px-3.5 py-2.5 text-sm text-brand-black focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:opacity-60"
            />
          </label>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-brand-black transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            Keep review
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.9} />
            ) : (
              <Trash2 className="h-4 w-4" strokeWidth={1.9} />
            )}
            {deleting ? 'Deleting…' : 'Delete review'}
          </button>
        </div>
      </div>
    </div>
  )
}
