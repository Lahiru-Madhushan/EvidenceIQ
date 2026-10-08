import { Link } from 'react-router-dom'
import { BookOpen, CircleHelp, Mail, ArrowRight } from 'lucide-react'

import PageShell from '../components/landing/PageShell'
import { PLANS } from '../lib/plans'
import { SUPPORT_EMAIL } from '../lib/site'

const CHANNELS = [
  {
    icon: BookOpen,
    title: 'Documentation',
    text: 'Step-by-step guides to running a review, reading results and exporting.',
    to: '/docs',
    cta: 'Read the docs',
  },
  {
    icon: CircleHelp,
    title: 'FAQ',
    text: 'Short answers to the questions we hear most often.',
    to: '/faq',
    cta: 'Browse the FAQ',
  },
  {
    icon: Mail,
    title: 'Contact support',
    text: 'Something not working? Send us a message and we will get back to you.',
    to: '/contact',
    cta: 'Send a message',
  },
]

const TROUBLESHOOTING = [
  {
    problem: 'A review is taking a long time',
    fix: 'Screening continues until your target number of papers has been accepted by both agents, so a strict question or narrow criteria can mean many papers are screened. Progress is shown live on the review page, and you can cancel and start again with broader criteria.',
  },
  {
    problem: 'Very few papers were retrieved',
    fix: 'Try a broader PubMed query, remove the publication-year limit under the advanced options, or leave the query blank to search with your research question.',
  },
  {
    problem: 'I cannot see the export option',
    fix: 'Export is part of the Researcher and Lab plans. You can change plan under Subscription once signed in.',
  },
  {
    problem: 'My verification link has expired',
    fix: 'Request a new one from the verification screen, or sign in with Google instead.',
  },
]

export default function Support() {
  return (
    <PageShell
      eyebrow="Support"
      title="How can we help?"
      intro="Find an answer yourself in a minute, or reach a person when you need one."
    >
      <div className="space-y-14">
        <div className="grid md:grid-cols-3 gap-5">
          {CHANNELS.map(({ icon: Icon, title, text, to, cta }) => (
            <Link
              key={title}
              to={to}
              className="group flex flex-col border border-neutral-100 rounded-2xl p-6 hover:border-brand-blue/40 hover:shadow-sm transition"
            >
              <span className="flex items-center justify-center w-11 h-11 rounded-full bg-blue-50 text-brand-blue mb-4">
                <Icon className="w-5 h-5" strokeWidth={1.8} />
              </span>
              <h2 className="font-semibold text-brand-black mb-1.5">{title}</h2>
              <p className="text-sm text-neutral-500 leading-relaxed flex-1">{text}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand-blue">
                {cta}
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>

        <section>
          <h2 className="text-xl font-bold text-brand-black mb-4">Common problems</h2>
          <div className="grid md:grid-cols-2 gap-5">
            {TROUBLESHOOTING.map(({ problem, fix }) => (
              <div key={problem} className="rounded-2xl bg-neutral-50 p-5">
                <p className="font-semibold text-sm text-brand-black mb-1.5">{problem}</p>
                <p className="text-sm text-neutral-600 leading-relaxed">{fix}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold text-brand-black mb-4">Support on your plan</h2>
          <div className="overflow-hidden rounded-2xl border border-neutral-100">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-5 py-4 border-b border-neutral-100 last:border-b-0"
              >
                <span className="font-semibold text-sm text-brand-black">{plan.name}</span>
                <span className="text-sm text-neutral-600">{plan.features.support}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-neutral-500">
            Email us directly at{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-brand-blue hover:underline">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </PageShell>
  )
}
