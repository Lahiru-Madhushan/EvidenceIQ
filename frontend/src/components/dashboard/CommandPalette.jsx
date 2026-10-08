import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CornerDownLeft,
  CreditCard,
  FileText,
  FilePlus2,
  FolderOpen,
  LayoutDashboard,
  MessageSquareText,
  Search,
  Settings,
  CircleHelp,
  ClipboardCheck,
} from 'lucide-react'
import { setShellUi, useShellUi, useWorkspace } from '../../lib/workspace'

const PAGES = [
  { label: 'Dashboard', hint: 'Overview of your workspace', to: '/dashboard', icon: LayoutDashboard },
  { label: 'New review', hint: 'Start a new research question', to: '/reviews/new', icon: FilePlus2, keywords: 'create start add' },
  { label: 'My reviews', hint: 'Every review you own', to: '/reviews', icon: FolderOpen },
  { label: 'Quick Chat', hint: 'Ask questions about a document', to: '/quick-chat', icon: MessageSquareText, keywords: 'pdf upload ask' },
  { label: 'Subscription', hint: 'Plan, usage and billing', to: '/subscription', icon: CreditCard, keywords: 'plan billing upgrade' },
  { label: 'Settings', hint: 'Profile and password', to: '/settings', icon: Settings, keywords: 'profile password account' },
  { label: 'Help & support', hint: 'Docs, FAQ and contact', to: '/support', icon: CircleHelp, keywords: 'docs faq' },
]

const LIMIT = { pages: 7, waiting: 4, reviews: 6, papers: 8 }

function matches(needle, ...fields) {
  if (!needle) return true
  const hay = fields.filter(Boolean).join(' ').toLowerCase()
  return needle.split(/\s+/).every((word) => hay.includes(word))
}

/**
 * Ctrl/⌘ K anywhere in the app: jump to any page, review or paper by typing.
 *
 * Mounted once per page inside the top bar. Searches the shared workspace snapshot
 * (reviews and the most recent papers), so opening it costs no request.
 */
export default function CommandPalette() {
  const navigate = useNavigate()
  const { paletteOpen } = useShellUi()
  const { reviews, papers, waiting } = useWorkspace()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef(null)

  useEffect(() => {
    function onKey(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setShellUi({ paletteOpen: true })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const close = () => {
    setShellUi({ paletteOpen: false })
    setQuery('')
    setCursor(0)
  }

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const reviewName = Object.fromEntries(reviews.map((r) => [r.id, r.research_question]))
    const out = []

    const waitingHits = waiting
      .filter((p) => matches(needle, p.title, p.pmid))
      .slice(0, LIMIT.waiting)
      .map((p) => ({
        id: `w-${p.id}`,
        icon: ClipboardCheck,
        tone: 'text-amber-600 bg-amber-50',
        label: p.title,
        hint: `Needs your decision · ${reviewName[p.review_id] ?? 'Review'}`,
        to: `/reviews/${p.review_id}?paper=${p.id}`,
      }))
    if (waitingHits.length) out.push({ title: 'Waiting for you', items: waitingHits })

    const reviewHits = reviews
      .filter((r) => matches(needle, r.research_question, r.protocol?.condition, r.protocol?.intervention))
      .slice(0, LIMIT.reviews)
      .map((r) => ({
        id: `r-${r.id}`,
        icon: FolderOpen,
        tone: 'text-brand-blue bg-blue-50',
        label: r.research_question,
        hint: [r.protocol?.condition, r.protocol?.intervention].filter(Boolean).join(' · ') || 'Review',
        to: `/reviews/${r.id}`,
      }))
    if (reviewHits.length) out.push({ title: 'Reviews', items: reviewHits })

    if (needle) {
      const waitingIds = new Set(waiting.map((p) => p.id))
      const paperHits = papers
        .filter((p) => !waitingIds.has(p.id) && matches(needle, p.title, p.pmid))
        .slice(0, LIMIT.papers)
        .map((p) => ({
          id: `p-${p.id}`,
          icon: FileText,
          tone: 'text-slate-600 bg-slate-100',
          label: p.title,
          hint: `PMID ${p.pmid} · ${reviewName[p.review_id] ?? 'Review'}`,
          to: `/reviews/${p.review_id}?paper=${p.id}`,
        }))
      if (paperHits.length) out.push({ title: 'Papers', items: paperHits })
    }

    const pageHits = PAGES.filter((p) => matches(needle, p.label, p.hint, p.keywords))
      .slice(0, LIMIT.pages)
      .map((p) => ({ id: `g-${p.to}`, icon: p.icon, tone: 'text-violet-600 bg-violet-50', label: p.label, hint: p.hint, to: p.to }))
    if (pageHits.length) out.push({ title: needle ? 'Pages' : 'Go to', items: pageHits })

    return out
  }, [query, reviews, papers, waiting])

  const flat = groups.flatMap((group) => group.items)
  const safeCursor = Math.min(cursor, Math.max(flat.length - 1, 0))

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${safeCursor}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [safeCursor])

  if (!paletteOpen) return null

  function choose(item) {
    if (!item) return
    close()
    navigate(item.to)
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((c) => Math.min(c + 1, flat.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(flat[safeCursor])
    } else if (event.key === 'Escape') {
      close()
    }
  }

  let index = -1
  // Portalled to <body>: the top bar uses backdrop-filter, which makes it the containing
  // block for fixed descendants, so rendered in place the overlay only covered the bar.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search EvidenceIQ">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={close} />
      <div className="animate-scale-in relative w-full max-w-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <Search className="h-5 w-5 shrink-0 text-brand-blue" strokeWidth={2} />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setCursor(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search reviews, papers, PMIDs or pages…"
            className="h-14 flex-1 bg-transparent text-base text-brand-black placeholder:text-neutral-400 focus:outline-none focus-visible:outline-none"
            aria-label="Search"
          />
          <kbd className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-neutral-500">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[min(440px,60vh)] overflow-y-auto p-2">
          {flat.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-neutral-500">
              Nothing matches “{query}”. Try a word from a title, or a PMID.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.title} className="mb-1">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400">
                  {group.title}
                </p>
                {group.items.map((item) => {
                  index += 1
                  const i = index
                  const active = i === safeCursor
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-index={i}
                      onMouseMove={() => setCursor(i)}
                      onClick={() => choose(item)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                        active ? 'bg-blue-50' : ''
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.tone}`}>
                        <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-semibold ${active ? 'text-brand-blue' : 'text-brand-black'}`}>
                          {item.label}
                        </span>
                        <span className="block truncate text-xs text-neutral-500">{item.hint}</span>
                      </span>
                      {active ? (
                        <ArrowRight className="h-4 w-4 shrink-0 text-brand-blue" strokeWidth={2} />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[11px] text-neutral-500">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border border-slate-200 bg-white px-1 font-semibold">↑</kbd>
            <kbd className="rounded border border-slate-200 bg-white px-1 font-semibold">↓</kbd>
            to move
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="flex items-center rounded border border-slate-200 bg-white px-1 font-semibold">
              <CornerDownLeft className="h-3 w-3" strokeWidth={2.2} />
            </kbd>
            to open
          </span>
          <span className="ml-auto">Searches your reviews and recent papers</span>
        </div>
      </div>
    </div>,
    document.body
  )
}
