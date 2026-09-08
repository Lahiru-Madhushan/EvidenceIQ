import { useEffect, useRef, useState } from 'react'
import { Search, Bell, ChevronDown, LogOut } from 'lucide-react'

export default function TopBar({ user, onSignOut }) {
  const email = user?.email ?? ''
  const name = user?.user_metadata?.full_name || email
  const initial = (name || '?').charAt(0).toUpperCase()

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-neutral-100 bg-white px-4 sm:px-6">
      <img src="/logo.png" alt="EvidenceIQ" className="h-11 w-auto shrink-0" />

      <div className="relative mx-auto hidden w-full max-w-md md:block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-neutral-400" strokeWidth={1.8} />
        <input
          type="search"
          placeholder="Search papers, PMIDs, or keywords..."
          className="w-full rounded-full border border-neutral-200 bg-white py-2 pl-10 pr-4 text-sm text-brand-black placeholder:text-neutral-400 focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/30"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          aria-label="Notifications"
          className="rounded-full p-2 text-neutral-500 hover:bg-neutral-50 hover:text-brand-black transition-colors"
        >
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-neutral-50 transition-colors"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-blue text-sm font-semibold text-white">
              {initial}
            </span>
            <span className="hidden max-w-[180px] truncate text-sm text-brand-black sm:block">{email}</span>
            <ChevronDown className="h-4 w-4 text-neutral-400" strokeWidth={2} />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-neutral-100 bg-white p-1.5 shadow-lg"
            >
              <div className="border-b border-neutral-100 px-3 py-2">
                <p className="truncate text-sm font-medium text-brand-black">{name}</p>
                <p className="truncate text-xs text-neutral-500">{email}</p>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={onSignOut}
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-brand-black hover:bg-neutral-50 transition-colors"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.8} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
