import { Link } from 'react-router-dom'
import { ArrowRight, PlayCircle, CheckCircle2 } from 'lucide-react'
import DashboardMockup from './DashboardMockup'

const TRUST_POINTS = ['AI-assisted', 'Human-approved', 'Transparent decisions']

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-white">
      <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-blue-50 blur-3xl pointer-events-none" />
      <div className="absolute top-20 right-0 w-[28rem] h-[28rem] rounded-full bg-blue-50/60 blur-3xl pointer-events-none" />

      <div className="relative max-w-[1280px] mx-auto px-6 sm:px-10 pt-14 pb-20 lg:pt-20 lg:pb-28">
        <div className="grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <span className="inline-block text-xs font-semibold text-brand-blue bg-blue-50 rounded-full px-3 py-1.5 mb-6">
              AI-POWERED SYSTEMATIC REVIEW
            </span>

            <h1 className="text-4xl sm:text-5xl lg:text-[56px] font-extrabold text-brand-black leading-[1.05] tracking-tight mb-5">
              From Research
              <br />
              to <span className="text-brand-blue">Clarity</span>
            </h1>

            <p className="text-neutral-500 text-lg leading-relaxed max-w-[480px] mb-8">
              EvidenceIQ helps researchers find relevant literature, apply
              consistent screening criteria, and verify AI-assisted decisions while keeping the researcher in control.
            </p>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-8">
              <Link
                to="/register"
                className="inline-flex items-center gap-2 bg-brand-blue text-white font-semibold rounded-lg px-6 py-3 hover:bg-brand-blue-dark transition-colors shadow-lg shadow-blue-600/20"
              >
                Get Started Free
                <ArrowRight className="w-4 h-4" />
              </Link>
              <button
                type="button"
                className="inline-flex items-center gap-2 border border-neutral-200 text-brand-black font-semibold rounded-lg px-6 py-3 hover:bg-neutral-50 transition-colors"
              >
                <PlayCircle className="w-4 h-4" />
                Watch Demo
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {TRUST_POINTS.map((point) => (
                <span key={point} className="flex items-center gap-1.5 text-sm text-neutral-500">
                  <CheckCircle2 className="w-4 h-4 text-brand-blue" strokeWidth={2} />
                  {point}
                </span>
              ))}
            </div>
          </div>

          <DashboardMockup />
        </div>
      </div>
    </section>
  )
}
