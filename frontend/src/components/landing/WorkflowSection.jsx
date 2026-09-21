import { FileText, Database, Brain, ShieldCheck, ArrowRight } from 'lucide-react'

const STEPS = [
  {
    number: 1,
    title: 'Define criteria',
    description: 'Convert your research question and inclusion/exclusion criteria into clear, structured rules.',
    icon: FileText,
  },
  {
    number: 2,
    title: 'Retrieve research',
    description: 'Search PubMed and collect candidate papers and metadata.',
    icon: Database,
  },
  {
    number: 3,
    title: 'AI screening',
    description: 'Analyze papers against your structured protocol using advanced NLP and LLMs.',
    icon: Brain,
  },
  {
    number: 4,
    title: 'Verify decisions',
    description: 'Independently check screening decisions and identify potential errors.',
    icon: ShieldCheck,
  },
]

export default function WorkflowSection() {
  return (
    <section id="how-it-works" className="scroll-mt-24 bg-white py-16 sm:py-20">
      <div className="max-w-[1200px] mx-auto px-6 sm:px-10 text-center">
        <p className="text-xs font-semibold text-brand-blue tracking-wide mb-3">HOW EVIDENCEIQ WORKS</p>
        <h2 className="text-2xl sm:text-3xl font-bold text-brand-black mb-12">A simple, powerful workflow</h2>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {STEPS.map(({ number, title, description, icon: Icon }, i) => (
            <div key={title} className="relative flex flex-col text-left border border-neutral-100 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-brand-blue text-white text-xs font-bold shrink-0">
                  {number}
                </span>
                <Icon className="w-5 h-5 text-brand-blue" strokeWidth={1.8} />
              </div>
              <h3 className="font-semibold text-brand-black mb-1.5">{title}</h3>
              <p className="text-sm text-neutral-500 leading-relaxed">{description}</p>

              {i < STEPS.length - 1 && (
                <span className="hidden lg:flex absolute top-9 -right-4 items-center justify-center text-neutral-300">
                  <ArrowRight className="w-5 h-5" />
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
