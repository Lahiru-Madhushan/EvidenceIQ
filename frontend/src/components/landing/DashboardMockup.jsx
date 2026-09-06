import {
  LayoutDashboard,
  FilePlus2,
  FileText,
  ScanSearch,
  BarChart3,
  Settings,
  Search,
  CheckCircle2,
  XCircle,
  Flag,
  Files,
  TrendingUp,
  ShieldCheck,
} from 'lucide-react'

const SIDEBAR_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, active: true },
  { label: 'New Review', icon: FilePlus2 },
  { label: 'Papers', icon: FileText },
  { label: 'Screening', icon: ScanSearch },
  { label: 'Reports', icon: BarChart3 },
  { label: 'Settings', icon: Settings },
]

const STATS = [
  { label: 'Included', value: '342', icon: CheckCircle2, color: 'text-emerald-500 bg-emerald-50' },
  { label: 'Excluded', value: '621', icon: XCircle, color: 'text-red-500 bg-red-50' },
  { label: 'Review needed', value: '37', icon: Flag, color: 'text-amber-500 bg-amber-50' },
  { label: 'Total papers', value: '1,000', icon: Files, color: 'text-brand-blue bg-blue-50' },
]

const PAPERS = [
  { title: 'Aerobic exercise and HbA1c levels...', decision: 'Include', confidence: '92%' },
  { title: 'Resistance training in type 2 diabetes...', decision: 'Exclude', confidence: '88%' },
  { title: 'Lifestyle interventions for diabetes...', decision: 'Review', confidence: '76%' },
]

const DECISION_STYLE = {
  Include: 'text-emerald-600 bg-emerald-50',
  Exclude: 'text-red-600 bg-red-50',
  Review: 'text-amber-600 bg-amber-50',
}

export default function DashboardMockup() {
  return (
    <div className="relative w-full max-w-[560px] mx-auto">
      <div className="rounded-2xl border border-neutral-200 shadow-2xl shadow-blue-900/10 bg-white overflow-hidden flex text-left">
        <div className="hidden sm:flex w-32 shrink-0 flex-col border-r border-neutral-100 py-4">
          <div className="px-4 mb-4 flex items-center gap-1.5">
            <img src="/logo.png" alt="" className="h-6 w-auto" />
          </div>
          <nav className="flex flex-col gap-0.5 px-2">
            {SIDEBAR_ITEMS.map(({ label, icon: Icon, active }) => (
              <div
                key={label}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-medium ${
                  active ? 'bg-blue-50 text-brand-blue' : 'text-neutral-500'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
                {label}
              </div>
            ))}
          </nav>
        </div>

        <div className="flex-1 min-w-0 p-4 sm:p-5">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 flex items-center gap-2 bg-neutral-50 border border-neutral-100 rounded-full px-3 py-1.5">
              <Search className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span className="text-[11px] text-neutral-400">Search papers, keywords...</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-6 h-6 rounded-full bg-brand-blue text-white text-[10px] font-semibold flex items-center justify-center">
                A
              </span>
              <div className="hidden md:block leading-tight">
                <p className="text-[11px] font-semibold text-brand-black">Dr. Amara Silva</p>
                <p className="text-[10px] text-neutral-400">Researcher</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-semibold text-brand-black">Review Progress</p>
            <span className="text-[11px] text-brand-blue font-medium">View all</span>
          </div>
          <div className="border border-neutral-100 rounded-xl p-3 mb-4">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-[12px] font-medium text-brand-black leading-snug">
                Effects of aerobic exercise on glucose control in adults with Type 2 diabetes
              </p>
              <span className="shrink-0 text-[10px] font-medium text-emerald-600 bg-emerald-50 rounded-full px-2 py-0.5 whitespace-nowrap">
                In Progress
              </span>
            </div>
            <p className="text-[10px] text-neutral-400 mb-2">Created on Sep 6, 2026</p>
            <div className="h-1.5 w-full rounded-full bg-neutral-100 overflow-hidden">
              <div className="h-full bg-brand-blue rounded-full" style={{ width: '78%' }} />
            </div>
            <p className="text-[10px] text-neutral-400 mt-1">78% screened</p>
          </div>

          <div className="grid grid-cols-4 gap-2 mb-4">
            {STATS.map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="border border-neutral-100 rounded-lg p-2 text-center">
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full mb-1 ${color}`}>
                  <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                </span>
                <p className="text-[12px] font-bold text-brand-black leading-none">{value}</p>
                <p className="text-[9px] text-neutral-400 leading-tight mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mb-2">
            <p className="text-[13px] font-semibold text-brand-black">Recent Papers</p>
            <span className="text-[11px] text-brand-blue font-medium">View all</span>
          </div>
          <div className="text-[10px]">
            <div className="grid grid-cols-[1fr_60px_50px_44px] gap-2 text-neutral-400 font-medium pb-1.5 border-b border-neutral-100">
              <span>Title</span>
              <span>AI Decision</span>
              <span>Confidence</span>
              <span>Action</span>
            </div>
            {PAPERS.map((p) => (
              <div
                key={p.title}
                className="grid grid-cols-[1fr_60px_50px_44px] gap-2 items-center py-1.5 border-b border-neutral-50 last:border-0"
              >
                <span className="text-brand-black truncate">{p.title}</span>
                <span className={`text-[9px] font-medium rounded-full px-1.5 py-0.5 text-center ${DECISION_STYLE[p.decision]}`}>
                  {p.decision}
                </span>
                <span className="text-neutral-500">{p.confidence}</span>
                <span className="text-brand-blue font-medium">Review</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="hidden sm:flex absolute -top-8 -right-10 items-center gap-2.5 bg-white rounded-xl shadow-xl border border-neutral-100 px-3 py-2.5 max-w-[150px] animate-float-slow">
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-brand-blue shrink-0">
          <TrendingUp className="w-4 h-4" strokeWidth={2} />
        </span>
        <p className="text-[11px] font-semibold text-brand-black leading-tight">Save weeks of manual work</p>
      </div>

      <div
        className="hidden sm:flex absolute -right-10 items-center gap-2.5 bg-white rounded-xl shadow-xl border border-neutral-100 px-3 py-2.5 max-w-[150px] animate-float-slow"
        style={{ top: '58%', animationDelay: '1s' }}
      >
        <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 text-brand-blue shrink-0">
          <ShieldCheck className="w-4 h-4" strokeWidth={2} />
        </span>
        <p className="text-[11px] font-semibold text-brand-black leading-tight">Reliable, transparent screening</p>
      </div>
    </div>
  )
}
