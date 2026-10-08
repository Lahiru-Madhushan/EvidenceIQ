/**
 * A small, shared snapshot of the signed-in researcher's workspace for the app shell.
 *
 * The sidebar badge, the notification inbox and the command palette all need the same
 * thing - the reviews, and which papers are waiting on the researcher - and all three
 * are mounted on every page. Loaded once and shared, rather than three components each
 * querying on every navigation. The snapshot is refreshed when it is older than
 * STALE_MS or when a page calls `refreshWorkspace()` after changing something.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { listRecentPapers, listReviews } from './reviewsApi'
import { needsDecision } from './reviewReasons'

const STALE_MS = 30_000

let state = { status: 'idle', reviews: [], papers: [], waiting: [], loadedAt: 0, error: null }
let inflight = null
const listeners = new Set()

function emit(next) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

export function refreshWorkspace() {
  if (inflight) return inflight
  if (state.status === 'idle') emit({ status: 'loading' })
  inflight = Promise.all([listReviews(), listRecentPapers()])
    .then(([reviews, papers]) => {
      const byId = Object.fromEntries((reviews ?? []).map((review) => [review.id, review]))
      const waiting = (papers ?? [])
        .filter(needsDecision)
        .map((paper) => ({ ...paper, review: byId[paper.review_id] ?? null }))
      emit({
        status: 'ready',
        reviews: reviews ?? [],
        papers: papers ?? [],
        waiting,
        loadedAt: Date.now(),
        error: null,
      })
    })
    .catch((error) => emit({ status: state.loadedAt ? 'ready' : 'error', error: error.message }))
    .finally(() => {
      inflight = null
    })
  return inflight
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The shared workspace snapshot; loads it on first use and when it has gone stale. */
export function useWorkspace() {
  const snapshot = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    if (Date.now() - state.loadedAt > STALE_MS) refreshWorkspace()
  }, [])
  return snapshot
}

/* ------------------------------------------------------------ shell UI state ----- */

// Open/closed state of the shell's overlays, shared between the top bar (which opens
// them) and the sidebar / palette (which render them). Module state rather than a
// context provider so every page's existing <TopBar/> and <Sidebar/> work unchanged.
let ui = { navOpen: false, paletteOpen: false }
const uiListeners = new Set()

export function setShellUi(next) {
  ui = { ...ui, ...next }
  uiListeners.forEach((listener) => listener())
}

export function useShellUi() {
  return useSyncExternalStore(
    (listener) => {
      uiListeners.add(listener)
      return () => uiListeners.delete(listener)
    },
    () => ui
  )
}
