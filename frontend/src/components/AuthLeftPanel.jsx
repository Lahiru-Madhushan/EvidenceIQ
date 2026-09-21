import { Link } from 'react-router-dom'

import { FileText, Cpu, BarChart3, CheckCircle2, Search, FileCheck2, Share2 } from 'lucide-react'

const FEATURES = [
  { icon: FileText, label: 'Find relevant research' },
  { icon: Cpu, label: 'AI-powered screening' },
  { icon: BarChart3, label: 'Organize evidence' },
  { icon: CheckCircle2, label: 'Make clearer decisions' },
]

const WORKFLOW_STEPS = [
  { icon: Search, label: 'Identify' },
  { icon: FileCheck2, label: 'Screen' },
  { icon: BarChart3, label: 'Analyze' },
  { icon: Share2, label: 'Synthesize' },
]

function FeatureIcon({ icon: Icon }) {
  return (
    <span className="flex items-center justify-center w-9 h-9 shrink-0 rounded-full bg-brand-blue text-white shadow-md">
      <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
    </span>
  )
}

function ProcessPill({ label, icon: Icon }) {
  return (
    <div className="flex items-center gap-2 bg-white/15 backdrop-blur-sm text-white text-xs font-semibold px-3.5 py-2.5 rounded-full shadow-md ring-1 ring-white/10 whitespace-nowrap">
      <Icon className="w-3.5 h-3.5 text-sky-300 shrink-0" strokeWidth={2} />
      {label}
    </div>
  )
}

function ConnectorLines() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
      <g fill="none" stroke="#7dd3fc" strokeWidth="0.5" strokeDasharray="1.6 1.6" opacity="0.7">
        <path d="M46,38 C55,25 58,16 62,11" />
        <path d="M62,19 L62,25" />
        <path d="M62,33 L62,38" />
        <path d="M62,46 L62,51" />
        <path d="M62,59 C62,68 56,75 50,79" />
      </g>
      <circle cx="46" cy="38" r="1" fill="#7dd3fc" className="animate-pulse-node" />
      <circle cx="56" cy="22" r="0.8" fill="#ffffff" className="animate-pulse-node" style={{ animationDelay: '0.4s' }} />
      <circle cx="56" cy="76" r="0.8" fill="#ffffff" className="animate-pulse-node" style={{ animationDelay: '0.8s' }} />
      <circle cx="50" cy="79" r="1" fill="#7dd3fc" className="animate-pulse-node" style={{ animationDelay: '1.2s' }} />
    </svg>
  )
}

function Illustration() {
  return (
    <div className="relative w-full h-full hidden [@media(min-width:1280px)_and_(min-height:780px)]:block">
      <ConnectorLines />

      <div className="absolute" style={{ left: '2%', top: '8%', width: '48%', height: '58%' }}>
        <div className="absolute inset-0 rounded-2xl bg-white/10 translate-x-4 translate-y-4" />
        <div className="absolute inset-0 rounded-2xl bg-white/20 translate-x-2 translate-y-2" />
        <div className="absolute inset-0 rounded-2xl bg-white shadow-2xl shadow-black/20 p-4 flex flex-col">
          <div className="h-6 w-6 rounded-md bg-brand-blue mb-3" />
          <div className="h-2 w-full rounded-full bg-blue-100 mb-2" />
          <div className="h-2 w-5/6 rounded-full bg-blue-100 mb-2" />
          <div className="h-2 w-2/3 rounded-full bg-blue-100 mb-2" />
          <div className="h-2 w-4/5 rounded-full bg-neutral-100" />
        </div>
      </div>

      <div
        className="absolute flex flex-col justify-between items-end"
        style={{ right: '2%', top: '4%', width: '46%', height: '60%' }}
      >
        {WORKFLOW_STEPS.map((s) => (
          <ProcessPill key={s.label} {...s} />
        ))}
      </div>

      <div
        className="absolute flex items-center gap-3 bg-white rounded-2xl shadow-2xl shadow-black/20 px-4 py-3"
        style={{ left: '4%', bottom: '0%', width: '92%' }}
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full bg-brand-black text-white shrink-0">
          <CheckCircle2 className="w-[18px] h-[18px]" strokeWidth={2} />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-brand-black">Evidence</p>
          <p className="text-[11px] text-neutral-400">From research to insight</p>
        </div>
      </div>
    </div>
  )
}

function WaveDecoration() {
  return (
    <svg
      className="absolute bottom-0 left-0 w-full h-40 text-white/10 pointer-events-none"
      viewBox="0 0 400 160"
      preserveAspectRatio="none"
      fill="none"
    >
      <path d="M0 90 Q 100 40, 200 80 T 400 70 V160 H0 Z" fill="currentColor" />
      <path d="M0 110 Q 100 65, 200 100 T 400 90" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
      <path d="M0 130 Q 100 90, 200 120 T 400 112" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
    </svg>
  )
}

export default function AuthLeftPanel({ showBackground = true, showText = true }) {
  return (
    <div
      className={`relative h-full w-full overflow-hidden flex flex-col p-8 xl:p-10 ${
        showBackground ? 'bg-gradient-to-br from-brand-blue-dark via-brand-blue to-sky-400' : ''
      }`}
    >
      {showBackground && (
        <>
          <div
            className="absolute top-8 right-8 w-40 h-40 opacity-30 pointer-events-none"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.7) 1.5px, transparent 1.5px)',
              backgroundSize: '16px 16px',
            }}
          />
          <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-white/10 blur-3xl animate-glow-pulse" />
          <div className="absolute bottom-0 right-0 w-96 h-96 rounded-full bg-brand-black/20 blur-3xl" />
          <WaveDecoration />
        </>
      )}

      <div className={`relative z-10 shrink-0 ${showText ? '' : 'invisible'}`}>
        <Link to="/" aria-label="EvidenceIQ home" className="inline-block transition-opacity hover:opacity-80">
          <img src="/logo.png" alt="EvidenceIQ" className="h-14 w-auto" />
        </Link>
      </div>

      <div className="relative z-10 flex-1 min-h-0 flex flex-col justify-center gap-6 py-6 text-white">
        <div className={showText ? '' : 'invisible'}>
          <h2 className="text-4xl font-bold leading-tight mb-4">
            From Research
            <br />
            to <span className="text-sky-300">Clarity</span>
          </h2>
          <p className="text-white/80 max-w-sm">
            Screen systematic review literature in days, not weeks — with a
            transparent, human-approved AI workflow.
          </p>
        </div>

        <ul className={`space-y-3 shrink-0 ${showText ? '' : 'invisible'}`}>
          {FEATURES.map((f) => (
            <li key={f.label} className="flex items-center gap-3 text-sm text-white/90">
              <FeatureIcon icon={f.icon} />
              {f.label}
            </li>
          ))}
        </ul>

        <div className="flex-1 min-h-0 overflow-hidden">
          {showBackground && <Illustration />}
        </div>
      </div>

      <div className={`relative z-10 shrink-0 text-white/70 text-sm leading-snug ${showText ? '' : 'invisible'}`}>
        Better evidence.
        <br />
        Brighter decisions.
      </div>
    </div>
  )
}
