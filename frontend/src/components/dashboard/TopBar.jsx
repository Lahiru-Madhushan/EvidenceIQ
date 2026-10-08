import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CreditCard,
  LogOut,
  Menu,
  Search,
  Settings,
} from 'lucide-react'
import CommandPalette from './CommandPalette'
import { setShellUi, useWorkspace } from '../../lib/workspace'

/** Closes a popover on an outside click or Escape. */
function useDismiss(open, setOpen) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    function onPointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, setOpen])
  return ref
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export default function TopBar({ user, onSignOut }) {
  const email = user?.email ?? ''
  const name = user?.user_metadata?.full_name || email
  const initial = (name || '?').charAt(0).toUpperCase()
  const avatar = user?.user_metadata?.avatar_url || null

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useDismiss(menuOpen, setMenuOpen)

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-3 backdrop-blur-md sm:px-5">
      <button
        type="button"
        onClick={() => setShellUi({ navOpen: true })}
        aria-label="Open navigation"
        className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-brand-black lg:hidden"
      >
        <Menu className="h-5 w-5" strokeWidth={2} />
      </button>

      <Link to="/dashboard" aria-label="EvidenceIQ dashboard" className="shrink-0">
        <img src="/logo.png" alt="EvidenceIQ" className="h-12 w-auto sm:h-14" />
      </Link>

      {/* Looks like a search box, opens the command palette: one place to find any
          review, paper or page, from the mouse or with Ctrl/⌘ K. */}
      <button
        type="button"
        onClick={() => setShellUi({ paletteOpen: true })}
        className="group mx-auto hidden w-full max-w-md items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2 text-left text-sm text-neutral-400 transition-all hover:border-brand-blue/40 hover:bg-white hover:shadow-card md:flex"
      >
        <Search className="h-[18px] w-[18px] shrink-0 group-hover:text-brand-blue" strokeWidth={2} />
        <span className="flex-1 truncate">Search reviews, papers, PMIDs…</span>
        <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-neutral-500">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={() => setShellUi({ paletteOpen: true })}
          aria-label="Search"
          className="rounded-full p-2 text-slate-600 transition-colors hover:bg-slate-100 md:hidden"
        >
          <Search className="h-5 w-5" strokeWidth={2} />
        </button>

        <Inbox />

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-slate-100"
          >
            {avatar ? (
              <img src={avatar} alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-white" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand-blue to-hero-cyan text-sm font-bold text-white ring-2 ring-white">
                {initial}
              </span>
            )}
            <span className="hidden min-w-0 text-left sm:block">
              <span className="block max-w-[160px] truncate text-sm font-semibold leading-tight text-brand-black">
                {name}
              </span>
              {name !== email ? (
                <span className="block max-w-[160px] truncate text-xs leading-tight text-neutral-500">
                  {email}
                </span>
              ) : null}
            </span>
            <ChevronDown className="h-4 w-4 text-neutral-400" strokeWidth={2} />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="animate-scale-in absolute right-0 z-40 mt-2 w-60 origin-top-right rounded-2xl border border-slate-200/80 bg-white p-1.5 shadow-card-hover"
            >
              <div className="border-b border-slate-100 px-3 py-2.5">
                <p className="truncate text-sm font-semibold text-brand-black">{name}</p>
                <p className="truncate text-xs text-neutral-500">{email}</p>
              </div>
              {[
                { to: '/settings', icon: Settings, label: 'Settings' },
                { to: '/subscription', icon: CreditCard, label: 'Subscription' },
                { to: '/support', icon: CircleHelp, label: 'Help & support' },
              ].map(({ to, icon: Icon, label }) => (
                <Link
                  key={to}
                  to={to}
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-brand-black transition-colors hover:bg-slate-50"
                >
                  <Icon className="h-4 w-4 text-neutral-500" strokeWidth={1.9} />
                  {label}
                </Link>
              ))}
              <div className="my-1 border-t border-slate-100" />
              <button
                type="button"
                role="menuitem"
                onClick={onSignOut}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.9} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      <CommandPalette />
    </header>
  )
}

/** The bell: papers across every review that are waiting for the researcher. */
function Inbox() {
  const navigate = useNavigate()
  const { waiting } = useWorkspace()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, setOpen)

  const reviewsWaiting = new Set(waiting.map((paper) => paper.review_id)).size

  function openPaper(paper) {
    setOpen(false)
    navigate(`/reviews/${paper.review_id}?paper=${paper.id}`)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={
          waiting.length ? `${waiting.length} paper(s) waiting for your decision` : 'Notifications'
        }
        aria-expanded={open}
        className="relative rounded-full p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-brand-black"
      >
        <Bell className="h-5 w-5" strokeWidth={2} />
        {waiting.length > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold tabular-nums text-white ring-2 ring-white">
            {waiting.length > 9 ? '9+' : waiting.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="animate-scale-in absolute right-0 z-40 mt-2 w-[min(380px,calc(100vw-1.5rem))] origin-top-right overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card-hover">
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-amber-50 to-white px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-brand-black">Waiting for you</p>
              <p className="text-xs text-neutral-500">
                {waiting.length
                  ? `${waiting.length} flagged paper(s) across ${reviewsWaiting} review(s)`
                  : 'Flagged papers appear here'}
              </p>
            </div>
          </div>

          {waiting.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" strokeWidth={2} />
              </span>
              <p className="mt-3 text-sm font-semibold text-brand-black">You&apos;re all caught up</p>
              <p className="mt-1 text-xs text-neutral-500">
                No paper is waiting on a decision from you.
              </p>
            </div>
          ) : (
            <ul className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto">
              {waiting.slice(0, 8).map((paper) => (
                <li key={paper.id}>
                  <button
                    type="button"
                    onClick={() => openPaper(paper)}
                    className="group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-medium leading-snug text-brand-black group-hover:text-brand-blue">
                        {paper.title}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-neutral-500">
                        {paper.agreement === false ? 'Agents disagreed · ' : ''}
                        {paper.review?.research_question ?? 'Review'}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-neutral-300 group-hover:text-brand-blue" strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {waiting.length > 8 ? (
            <p className="border-t border-slate-100 px-4 py-2.5 text-center text-xs text-neutral-500">
              and {waiting.length - 8} more — open a review&apos;s Needs review tab
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
