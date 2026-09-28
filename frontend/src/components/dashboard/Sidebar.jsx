import {
  CircleHelp,
  CreditCard,
  FilePlus2,
  FolderOpen,
  LayoutDashboard,
  MessageSquareText,
  Settings,
} from 'lucide-react'

// `soon` marks a destination that does not exist yet. Those items stay visible but are
// disabled rather than hidden: a greyed item with a "Soon" tag tells the user the
// feature is planned, where a dead link that silently does nothing just looks broken.
const NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, key: 'dashboard' },
  { label: 'New Review', icon: FilePlus2, key: 'new-review' },
  { label: 'My Reviews', icon: FolderOpen, key: 'my-reviews' },
  { label: 'Quick Chat', icon: MessageSquareText, key: 'chat' },
  { label: 'Subscription', icon: CreditCard, key: 'subscription' },
  { label: 'Settings', icon: Settings, key: 'settings' },
]

export default function Sidebar({ active = 'dashboard', onNavigate }) {
  return (
    <aside className="hidden lg:flex w-[200px] shrink-0 flex-col border-r border-neutral-100 bg-white">
      <nav className="flex-1 p-3 space-y-1">
        {NAV.map(({ label, icon: Icon, key, soon }) => {
          const isActive = key === active
          return (
            <button
              key={key}
              type="button"
              disabled={soon}
              onClick={() => onNavigate?.(key)}
              aria-current={isActive ? 'page' : undefined}
              title={soon ? `${label} is not available yet` : undefined}
              className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                soon
                  ? 'cursor-not-allowed text-neutral-300'
                  : isActive
                    ? 'bg-blue-50 text-brand-blue'
                    : 'text-neutral-600 hover:bg-neutral-50 hover:text-brand-black'
              }`}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.8} />
              <span className="truncate">{label}</span>
              {soon ? (
                <span className="ml-auto shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                  Soon
                </span>
              ) : null}
            </button>
          )
        })}
      </nav>

      <div className="m-3 rounded-xl border border-neutral-100 bg-neutral-50 p-4">
        <CircleHelp className="w-5 h-5 text-brand-blue mb-2" strokeWidth={1.8} />
        <p className="text-sm font-semibold text-brand-black">Need help?</p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          Check our documentation or contact support.
        </p>
        <button
          type="button"
          className="mt-3 w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-black hover:bg-neutral-50 transition-colors"
        >
          View Help
        </button>
      </div>
    </aside>
  )
}
