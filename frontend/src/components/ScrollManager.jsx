import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Puts the reader where a link said it would.
 *
 * The router swaps pages without touching the scroll position, so a footer link clicked
 * at the bottom of one page used to open the next page at its bottom too. And a link to
 * a landing section from another page (`/#pricing`) arrives before that section exists
 * in the document, so the browser's own fragment jump has nothing to land on.
 *
 * A change of page lands instantly - gliding the whole length of the previous page is
 * motion with no information in it. A jump within the same page keeps the smooth
 * scroll from index.css, for the same reason the landing nav uses it.
 */
export default function ScrollManager() {
  const { pathname, hash, key } = useLocation()
  const previousPath = useRef(pathname)

  // Keyed on `key` as well: following the same fragment link twice is a new navigation
  // that leaves pathname and hash unchanged, and should still bring the section back.
  useEffect(() => {
    const samePage = previousPath.current === pathname
    previousPath.current = pathname
    const behavior = samePage ? 'smooth' : 'instant'

    if (!hash) {
      if (!samePage) window.scrollTo({ top: 0, behavior })
      return
    }

    // One frame later, so the page that owns the section has rendered it.
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ behavior })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pathname, hash, key])

  return null
}
