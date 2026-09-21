import { Search, Brain, FileText, MessageSquareText, UserCheck, ShieldCheck, ArrowRight } from 'lucide-react'

const FEATURES = [
  {
    title: 'Literature Retrieval',
    description: 'Search PubMed and identify relevant research efficiently.',
    icon: Search,
  },
  {
    title: 'Intelligent Screening',
    description: 'Analyze candidate papers against your criteria.',
    icon: Brain,
  },
  {
    title: 'Consistent Criteria',
    description: 'Convert vague criteria into explicit rules.',
    icon: FileText,
  },
  {
    title: 'Explainable Decisions',
    description: 'See why a paper was recommended for inclusion or exclusion.',
    icon: MessageSquareText,
  },
  {
    title: 'Human in Control',
    description: 'Researchers approve or override final decisions.',
    icon: UserCheck,
  },
  {
    title: 'Secure & Transparent',
    description: 'Your data and decisions are secure and traceable.',
    icon: ShieldCheck,
  },
]

export default function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-24 bg-white py-16 sm:py-20">
      <div className="max-w-[1200px] mx-auto px-6 sm:px-10">
        <div className="flex items-center justify-between mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-brand-black">
            Powerful features for modern researchers
          </h2>
          <a href="#" className="hidden sm:flex items-center gap-1 text-sm font-medium text-brand-blue hover:underline shrink-0">
            View all features
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
          {FEATURES.map(({ title, description, icon: Icon }) => (
            <div key={title}>
              <span className="flex items-center justify-center w-11 h-11 rounded-full bg-blue-50 text-brand-blue mb-4">
                <Icon className="w-5 h-5" strokeWidth={1.8} />
              </span>
              <h3 className="font-semibold text-brand-black mb-1.5">{title}</h3>
              <p className="text-sm text-neutral-500 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
