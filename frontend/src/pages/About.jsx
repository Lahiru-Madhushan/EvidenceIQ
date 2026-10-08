import { Link } from 'react-router-dom'
import { FileText, Database, Brain, ShieldCheck, UserCheck, Quote, Scale } from 'lucide-react'

import PageShell from '../components/landing/PageShell'

const PRINCIPLES = [
  {
    icon: UserCheck,
    title: 'Researchers decide',
    text: 'Agents draft and recommend. The decision that goes in your review is always yours to approve or override.',
  },
  {
    icon: Quote,
    title: 'Evidence, not assertion',
    text: 'Every criterion judgement quotes the passage that supports it, so you can check the reasoning in seconds.',
  },
  {
    icon: Scale,
    title: 'Two independent opinions',
    text: 'Screening and verification run on different models, so one model’s blind spot is not silently repeated.',
  },
]

const AGENTS = [
  { icon: FileText, label: 'Criteria' },
  { icon: Database, label: 'Retrieval' },
  { icon: Brain, label: 'Screening' },
  { icon: ShieldCheck, label: 'Verification' },
]

export default function About() {
  return (
    <PageShell
      eyebrow="About"
      title="Faster systematic reviews, without giving up rigour"
      intro="Screening thousands of abstracts by hand is the slowest, most error-prone stage of a systematic review. EvidenceIQ exists to take that load off researchers while keeping every decision transparent and theirs."
    >
      <div className="space-y-16">
        <section className="grid lg:grid-cols-2 gap-10 items-center">
          <div className="space-y-4 text-neutral-600 leading-relaxed">
            <h2 className="text-2xl font-bold text-brand-black">Our mission</h2>
            <p>
              Systematic reviews underpin clinical guidelines and policy, yet the screening stage can take a
              team weeks. Tired reviewers drift from their own criteria, and two reviewers rarely apply them
              the same way.
            </p>
            <p>
              EvidenceIQ makes the criteria explicit, applies them the same way to every paper, and shows its
              working — so researchers can spend their time on the judgement calls that need a human.
            </p>
            <p>EvidenceIQ began as a research-engineering project at SLIIT.</p>
          </div>

          <div className="rounded-2xl bg-gradient-to-br from-brand-blue to-hero-deep p-8 text-white">
            <p className="text-sm font-semibold text-white/70 mb-5">Four agents, one pipeline</p>
            <div className="grid grid-cols-2 gap-4">
              {AGENTS.map(({ icon: Icon, label }, i) => (
                <div key={label} className="rounded-xl bg-white/10 p-4">
                  <span className="text-xs text-white/60">Agent {i + 1}</span>
                  <Icon className="w-6 h-6 my-2" strokeWidth={1.8} />
                  <p className="font-semibold">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-brand-black mb-8">What we believe</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {PRINCIPLES.map(({ icon: Icon, title, text }) => (
              <div key={title}>
                <span className="flex items-center justify-center w-11 h-11 rounded-full bg-blue-50 text-brand-blue mb-4">
                  <Icon className="w-5 h-5" strokeWidth={1.8} />
                </span>
                <h3 className="font-semibold text-brand-black mb-1.5">{title}</h3>
                <p className="text-sm text-neutral-500 leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-neutral-100 p-8 sm:flex sm:items-center sm:justify-between gap-6">
          <div>
            <h2 className="text-lg font-bold text-brand-black">Want to know more?</h2>
            <p className="text-sm text-neutral-500 mt-1">See how a review runs end to end, or get in touch.</p>
          </div>
          <div className="mt-5 sm:mt-0 flex flex-col sm:flex-row gap-3 shrink-0">
            <Link
              to="/docs"
              className="inline-flex items-center justify-center rounded-lg border border-neutral-200 px-5 py-2.5 text-sm font-semibold text-brand-black hover:bg-neutral-50 transition-colors"
            >
              Read the docs
            </Link>
            <Link
              to="/contact"
              className="inline-flex items-center justify-center rounded-lg bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-blue-dark transition-colors"
            >
              Contact us
            </Link>
          </div>
        </section>
      </div>
    </PageShell>
  )
}
