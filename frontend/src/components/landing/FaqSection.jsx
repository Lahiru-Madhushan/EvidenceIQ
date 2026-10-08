import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Plus } from 'lucide-react'

// The questions a careful researcher asks before trusting a screening tool, answered
// plainly - including what the tool does not do.
const FAQS = [
  {
    q: 'Does the AI decide which papers go into my review?',
    a: 'No. The agents recommend and explain; only you can approve or exclude a paper, and nothing counts as included until you do. Every decision is recorded in the paper’s audit trail.',
  },
  {
    q: 'How do I know a decision is right?',
    a: 'Each paper is judged twice, by two different AI models that never see each other’s answer. Every criterion comes with a quote from the abstract that is checked to really be there. Where the models disagree or are unsure, the paper is sent to you.',
  },
  {
    q: 'Which databases does it search?',
    a: 'PubMed, through the National Library of Medicine’s official E-utilities API. The exact query that ran is reported back to you, so it can go straight into your PRISMA methods.',
  },
  {
    q: 'Is my data private?',
    a: 'Your reviews are visible only to your account, and every request is checked against its owner. EvidenceIQ processes published abstracts, not patient data. You can export or permanently erase everything from your settings.',
  },
  {
    q: 'Can I take my results elsewhere?',
    a: 'Yes. Export decisions as CSV for your appendix or RIS for Zotero, EndNote and Mendeley, and download your PRISMA flow diagram as SVG or PNG.',
  },
  {
    q: 'Is it free to try?',
    a: 'Yes. The Free plan runs all four agents with full verification — enough to complete a real review. Paid plans add volume, export and team seats.',
  },
]

export default function FaqSection() {
  const [open, setOpen] = useState(0)

  return (
    <section id="faq" className="scroll-mt-24 bg-white py-20 sm:py-24">
      <div className="mx-auto grid max-w-[1100px] gap-10 px-6 sm:px-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-blue">Questions</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-brand-black sm:text-4xl">
            Trust, but verify
          </h2>
          <p className="mt-4 text-neutral-600">
            The questions researchers ask before they hand screening to an AI — answered plainly.
          </p>
          <Link to="/faq" className="group mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-brand-blue">
            All questions
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.4} />
          </Link>
        </div>

        <ul className="space-y-3">
          {FAQS.map(({ q, a }, i) => {
            const isOpen = open === i
            return (
              <li
                key={q}
                className={`overflow-hidden rounded-2xl border transition-colors ${
                  isOpen ? 'border-blue-200 bg-blue-50/40 shadow-card' : 'border-slate-200/80 bg-white'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-${i}`}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                >
                  <span className="font-semibold text-brand-black">{q}</span>
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all ${
                      isOpen ? 'rotate-45 bg-brand-blue text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    <Plus className="h-4 w-4" strokeWidth={2.4} />
                  </span>
                </button>
                <div
                  id={`faq-${i}`}
                  className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                    isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  }`}
                >
                  <p className="overflow-hidden px-5 text-sm leading-relaxed text-neutral-600">
                    <span className="block pb-5">{a}</span>
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
