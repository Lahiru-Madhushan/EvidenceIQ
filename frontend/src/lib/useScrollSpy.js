import { useEffect, useState } from 'react'

/**
 * Which of the given sections the reader is currently looking at.
 *
 * Position-based rather than IntersectionObserver-based, and deliberately so. These
 * sections are wildly different heights - the hero is most of a screen, the footer is a
 * fraction of one - and with an observer the answer to "which section am I in" depends
 * on how much of each happens to be visible, so a tall section keeps the highlight
 * while a short one scrolls past without ever claiming it. Asking instead which section
 * heading has most recently passed under the navbar gives one answer, always, and it is
 * the same answer the reader would give.
 *
 * @param ids   section element ids, in the order they appear down the page
 * @param offset how far below the top of the viewport the line sits. Should match the
 *        sticky header's height, so a section counts as current exactly when its
 *        heading clears the header rather than when it touches the top of the window.
 */
export function useScrollSpy(ids, offset = 100) {
  const [active, setActive] = useState(ids[0])

  useEffect(() => {
    let frame = 0

    function measure() {
      frame = 0

      // The last section whose top has passed the line wins. Walking forwards and
      // overwriting means the deepest match is the one left standing.
      let current = ids[0]
      for (const id of ids) {
        const element = document.getElementById(id)
        if (element && element.getBoundingClientRect().top <= offset) current = id
      }

      // At the very bottom the final section may be too short to ever reach the line -
      // a footer below a tall pricing table never does. Nothing else can be current
      // once the page cannot scroll further, so the last section takes it.
      const scrolledToEnd =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      if (scrolledToEnd) current = ids[ids.length - 1]

      setActive(current)
    }

    // Coalesced into one measurement per frame: scroll fires far more often than the
    // page repaints, and every handler here reads layout.
    function onScroll() {
      if (!frame) frame = window.requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [ids, offset])

  return active
}
