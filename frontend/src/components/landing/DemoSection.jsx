import { useState } from 'react'
import { ChevronLeft, ChevronRight, FileCheck, CheckCircle2 } from 'lucide-react'

const CRITERIA = [
  { label: 'Population', value: 'Adults' },
  { label: 'Intervention', value: 'Aerobic Exercise' },
  { label: 'Condition', value: 'Type 2 Diabetes' },
  { label: 'Study Type', value: 'Randomized Controlled Trial' },
]

export default function DemoSection() {
  const [index, setIndex] = useState(184)

  return (
    <section id="demo" className="relative scroll-mt-24 bg-blue-50/60 py-16 sm:py-20 overflow-hidden">
      <button
        type="button"
        onClick={() => setIndex((i) => Math.max(1, i - 1))}
        className="hidden lg:flex absolute left-6 top-1/2 -translate-y-1/2 items-center justify-center w-10 h-10 rounded-full bg-white shadow-md text-neutral-500 hover:text-brand-blue transition-colors z-10"
        aria-label="Previous example"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={() => setIndex((i) => Math.min(1000, i + 1))}
        className="hidden lg:flex absolute right-6 top-1/2 -translate-y-1/2 items-center justify-center w-10 h-10 rounded-full bg-white shadow-md text-neutral-500 hover:text-brand-blue transition-colors z-10"
        aria-label="Next example"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      <div className="max-w-[1200px] mx-auto px-6 sm:px-16">
        <div className="grid lg:grid-cols-[320px_1fr] gap-10 items-center">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-brand-black mb-3">
              See EvidenceIQ in action
            </h2>
            <p className="text-neutral-500 mb-6 leading-relaxed">
              Screen papers, review AI recommendations, and make the final decision.
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-2 bg-brand-blue text-white font-semibold rounded-lg px-5 py-2.5 hover:bg-brand-blue-dark transition-colors"
            >
              Explore Demo
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-neutral-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs text-neutral-400 font-medium">#{index} of 1,000</span>
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 rounded-full px-2.5 py-1">
                Confidence 92%
              </span>
            </div>

            <h3 className="font-semibold text-brand-black leading-snug mb-1">
              Effects of Aerobic Exercise on Glucose Control in Adults with Type 2 Diabetes
            </h3>
            <p className="text-xs text-neutral-400 mb-5">Smith J. et al. (2023) &middot; Journal of Clinical Medicine</p>

            <div className="grid sm:grid-cols-[1fr_240px] gap-6">
              <div className="space-y-3">
                {CRITERIA.map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-sm border-b border-neutral-50 pb-3 last:border-0">
                    <span className="flex items-center gap-2 text-neutral-500">
                      <FileCheck className="w-4 h-4 text-brand-blue" strokeWidth={1.8} />
                      {label}
                    </span>
                    <span className="flex items-center gap-1.5 font-medium text-brand-black">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2} />
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="bg-neutral-50 rounded-xl p-4">
                <p className="text-xs font-medium text-neutral-500 mb-2">AI Recommendation</p>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 bg-emerald-100 rounded-lg px-3 py-1.5 mb-3">
                  <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
                  INCLUDE
                </span>
                <p className="text-xs font-medium text-neutral-500 mb-1">Reason</p>
                <p className="text-xs text-neutral-500 leading-relaxed mb-4">
                  Study population and intervention satisfy all inclusion criteria.
                </p>
                <div className="flex gap-2">
                  <button className="flex-1 text-xs font-semibold text-brand-black border border-neutral-200 rounded-lg py-2 hover:bg-white transition-colors">
                    Override
                  </button>
                  <button className="flex-1 flex items-center justify-center gap-1 text-xs font-semibold text-white bg-brand-blue rounded-lg py-2 hover:bg-brand-blue-dark transition-colors">
                    <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2} />
                    Approve
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
