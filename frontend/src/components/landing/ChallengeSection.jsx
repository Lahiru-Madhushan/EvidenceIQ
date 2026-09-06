import { Layers, Clock, AlertTriangle } from 'lucide-react'

const CHALLENGES = [
  {
    title: 'Thousands of papers',
    description: 'Searching databases can return hundreds or thousands of potentially relevant studies.',
    icon: Layers,
  },
  {
    title: 'Time-consuming screening',
    description: 'Manually reviewing papers against inclusion and exclusion criteria can take weeks.',
    icon: Clock,
  },
  {
    title: 'Inconsistent decisions',
    description: 'Ambiguous criteria can lead to inconsistent screening decisions over time.',
    icon: AlertTriangle,
  },
]

export default function ChallengeSection() {
  return (
    <section className="bg-neutral-50 py-16 sm:py-20">
      <div className="max-w-[1100px] mx-auto px-6 sm:px-10 text-center">
        <p className="text-xs font-semibold text-brand-blue tracking-wide mb-3">THE CHALLENGE</p>
        <h2 className="text-2xl sm:text-3xl font-bold text-brand-black mb-3">
          Systematic reviews can be slow and overwhelming
        </h2>
        <p className="text-neutral-500 max-w-xl mx-auto mb-12">
          Researchers face thousands of papers, time-consuming screening, and inconsistent decisions.
        </p>

        <div className="grid sm:grid-cols-3 gap-10">
          {CHALLENGES.map(({ title, description, icon: Icon }) => (
            <div key={title} className="flex flex-col items-center">
              <span className="flex items-center justify-center w-14 h-14 rounded-full bg-white shadow-sm text-brand-blue mb-4">
                <Icon className="w-6 h-6" strokeWidth={1.8} />
              </span>
              <h3 className="font-semibold text-brand-black mb-2">{title}</h3>
              <p className="text-sm text-neutral-500 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
