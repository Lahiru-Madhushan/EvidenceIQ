import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CircleHelp,
  CreditCard,
  FilePlus2,
  FolderOpen,
  LayoutDashboard,
  MessageSquareText,
  Settings,
  Sparkles,
  X,
} from 'lucide-react'
import { ROUTE_FOR_NAV_KEY } from '../../lib/navigation'
import { useSubscription } from '../../lib/subscriptionApi'
import { setShellUi, useShellUi, useWorkspace } from '../../lib/workspace'

// `soon` marks a destination that does not exist yet. Those items stay visible but are
// disabled rather than hidden: a greyed item with a "Soon" tag tells the user the
// feature is planned, where a dead link that silently does nothing just looks broken.
const SECTIONS = [
  {
    title: 'Workspace',
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, key: 'dashboard' },
      { label: 'New Review', icon: FilePlus2, key: 'new-review' },
      { label: 'My Reviews', icon: FolderOpen, key: 'my-reviews', badge: 'waiting' },
      { label: 'Quick Chat', icon: MessageSquareText, key: 'chat' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Subscription', icon: CreditCard, key: 'subscription' },
      { label: 'Settings', icon: Settings, key: 'settings' },
    ],
  },
]

/**
 * The app's left navigation. A fixed column from the lg breakpoint up; below it the
 * same content opens as a drawer from the menu button in the top bar, so small screens
 * are never left without a way to move between pages.
 */
export default function Sidebar({ active = 'dashboard', onNavigate }) {
  const navigate = useNavigate()
  const { navOpen } = useShellUi()

  function go(key) {
    setShellUi({ navOpen: false })
    if (onNavigate) onNavigate(key)
    else if (ROUTE_FOR_NAV_KEY[key]) navigate(ROUTE_FOR_NAV_KEY[key])
  }

  useEffect(() => {
    if (!navOpen) return
    const onKey = (event) => event.key === 'Escape' && setShellUi({ navOpen: false })
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navOpen])

  return (
    <>
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-slate-200/80 bg-white/80 backdrop-blur lg:flex">
        <SidebarBody active={active} onGo={go} onHelp={() => navigate('/support')} />
      </aside>

      {navOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={() => setShellUi({ navOpen: false })}
          />
          <aside className="animate-fade-up absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <img src="/logo.png" alt="EvidenceIQ" className="h-10 w-auto" />
              <button
                type="button"
                onClick={() => setShellUi({ navOpen: false })}
                aria-label="Close navigation"
                className="rounded-lg p-2 text-neutral-500 hover:bg-slate-100 hover:text-brand-black"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
            <SidebarBody active={active} onGo={go} onHelp={() => navigate('/support')} />
          </aside>
        </div>
      ) : null}
    </>
  )
}

function SidebarBody({ active, onGo, onHelp }) {
  const { waiting } = useWorkspace()
  const badges = { waiting: waiting.length }

  return (
    <>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-5">
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-400">
              {section.title}
            </p>
            <div className="space-y-1">
              {section.items.map(({ label, icon: Icon, key, soon, badge }) => {
                const isActive = key === active
                const count = badge ? badges[badge] : 0
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={soon}
                    onClick={() => onGo(key)}
                    aria-current={isActive ? 'page' : undefined}
                    title={soon ? `${label} is not available yet` : undefined}
                    className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-all ${
                      soon
                        ? 'cursor-not-allowed text-neutral-300'
                        : isActive
                          ? 'bg-gradient-to-r from-brand-blue to-blue-500 text-white shadow-glow'
                          : 'text-slate-600 hover:bg-slate-100/80 hover:text-brand-black'
                    }`}
                  >
                    <Icon
                      className={`h-[18px] w-[18px] shrink-0 transition-transform ${
                        isActive ? '' : 'group-hover:scale-110'
                      }`}
                      strokeWidth={2}
                    />
                    <span className="truncate">{label}</span>
                    {count > 0 ? (
                      <span
                        title={`${count} paper(s) waiting for your decision`}
                        className={`ml-auto min-w-[22px] rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums ${
                          isActive ? 'bg-white/25 text-white' : 'bg-amber-500 text-white'
                        }`}
                      >
                        {count > 99 ? '99+' : count}
                      </span>
                    ) : null}
                    {soon ? (
                      <span className="ml-auto shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                        Soon
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-2 p-3">
        <PlanCard onManage={() => onGo('subscription')} />
        <button
          type="button"
          onClick={onHelp}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-brand-black"
        >
          <CircleHelp className="h-[18px] w-[18px]" strokeWidth={2} />
          Help &amp; support
        </button>
      </div>
    </>
  )
}

/** The plan, and how much of this month's review allowance is used. */
function PlanCard({ onManage }) {
  const { plan, loading } = useSubscription()
  const { reviews } = useWorkspace()

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const used = reviews.filter((review) => new Date(review.created_at) >= monthStart).length
  const limit = Number(plan.features.reviews)
  const finite = Number.isFinite(limit) && limit > 0
  const percent = finite ? Math.min(100, Math.round((used / limit) * 100)) : 100
  const nearLimit = finite && used / limit >= 0.8

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-hero-navy via-hero-deep to-hero-blue p-4 text-white shadow-glow">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/10 blur-xl"
      />
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-blue-100">
        <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
        {loading ? 'Your plan' : `${plan.name} plan`}
      </p>
      <p className="mt-2 text-sm font-semibold">
        {finite ? `${used} of ${limit} reviews` : `${used} reviews`}
        <span className="font-normal text-blue-100"> this month</span>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${nearLimit ? 'bg-amber-300' : 'bg-white'}`}
          style={{ width: `${finite ? percent : 100}%` }}
        />
      </div>
      <button
        type="button"
        onClick={onManage}
        className="mt-3 w-full rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-inset ring-white/25 transition-colors hover:bg-white/25"
      >
        {plan.id === 'free' || nearLimit ? 'Upgrade plan' : 'Manage plan'}
      </button>
    </div>
  )
}
