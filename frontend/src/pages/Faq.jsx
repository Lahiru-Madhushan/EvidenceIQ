import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'

import PageShell from '../components/landing/PageShell'
import { PLANS, annualSaving } from '../lib/plans'

const free = PLANS[0].features

const GROUPS = [
  {
    heading: 'The product',
    items: [
      {
        q: 'What is EvidenceIQ?',
        a: 'An AI assistant for the screening stage of a systematic review. Four agents interpret your criteria, retrieve candidate papers from PubMed, screen each one, and independently verify every screening decision — while you keep the final say.',
      },
      {
        q: 'Which databases do you search?',
        a: 'PubMed. You can supply your own query or let your research question be used as the search, and narrow results by publication year.',
      },
      {
        q: 'Does the AI make the final inclusion decision?',
        a: 'No. Agents produce a draft and a recommendation; you approve or override each paper. Every decision is recorded with what the agents had concluded at the time.',
      },
      {
        q: 'Why are there two screening agents?',
        a: 'Agent 3 screens and Agent 4 verifies, each on a different model. A second, independent opinion catches errors a single model would repeat, and papers where they disagree are flagged for you.',
      },
      {
        q: 'How do I know why a paper was included or excluded?',
        a: 'Each criterion is judged separately, with the passage of the paper that supports the judgement quoted alongside it.',
      },
    ],
  },
  {
    heading: 'Plans and billing',
    items: [
      {
        q: 'Is the free plan a cut-down version?',
        a: `Not in quality. All four agents, verification and quoted evidence run on every plan. Free allows ${free.reviews} reviews a month of up to ${free.papers} papers each; paid plans raise those limits and add export, full history and team seats.`,
      },
      {
        q: 'Is there a discount for paying yearly?',
        a: `Yes — annual billing saves up to ${annualSaving()}% compared with paying monthly.`,
      },
      {
        q: 'Can I export my results?',
        a: 'On the Researcher and Lab plans you can download decisions as CSV and citations as RIS, ready for EndNote, Zotero or Mendeley.',
      },
    ],
  },
  {
    heading: 'Using the app',
    items: [
      {
        q: 'Can I stop a review that is running?',
        a: 'Yes. A running review can be cancelled from its page at any time.',
      },
      {
        q: 'What can I upload to Quick Chat?',
        a: 'One PDF, TXT, MD or CSV file at a time, up to 20 MB. Answers are quoted from your document; anything it does not cover is reported as missing.',
      },
      {
        q: 'I did not get my verification email.',
        a: 'Check your spam or promotions folder, then request a new link from the verification screen. Signing in with Google skips this step.',
      },
      {
        q: 'Who can see my reviews?',
        a: 'Only you. Every review is tied to your account and is not visible to other users.',
      },
    ],
  },
]

export default function Faq() {
  return (
    <PageShell
      eyebrow="FAQ"
      title="Frequently asked questions"
      intro="Quick answers about how EvidenceIQ screens papers, what each plan includes, and using the app."
    >
      <div className="max-w-3xl space-y-12">
        {GROUPS.map(({ heading, items }) => (
          <section key={heading}>
            <h2 className="text-lg font-bold text-brand-black mb-4">{heading}</h2>
            <div className="divide-y divide-neutral-100 border-y border-neutral-100">
              {items.map(({ q, a }) => (
                <details key={q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-brand-black hover:text-brand-blue [&::-webkit-details-marker]:hidden">
                    {q}
                    <ChevronDown className="w-4 h-4 shrink-0 text-neutral-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-3 text-sm text-neutral-600 leading-relaxed pr-8">{a}</p>
                </details>
              ))}
            </div>
          </section>
        ))}

        <div className="rounded-2xl bg-blue-50 p-6 sm:flex sm:items-center sm:justify-between gap-6">
          <div>
            <p className="font-semibold text-brand-black">Still have a question?</p>
            <p className="text-sm text-neutral-600 mt-1">We&apos;re happy to help.</p>
          </div>
          <Link
            to="/contact"
            className="mt-4 sm:mt-0 inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-blue-dark transition-colors"
          >
            Contact us
          </Link>
        </div>
      </div>
    </PageShell>
  )
}
