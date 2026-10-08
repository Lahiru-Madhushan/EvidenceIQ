import { Link } from 'react-router-dom'
import { Brain, Database, Download, FileText, MessageSquareText, ShieldCheck, UserCheck } from 'lucide-react'

import PageShell from '../components/landing/PageShell'

const AGENTS = [
  {
    icon: FileText,
    name: 'Agent 1 — Criteria interpretation',
    text: 'Turns your research question and free-text inclusion/exclusion criteria into explicit, structured rules that every later step screens against.',
  },
  {
    icon: Database,
    name: 'Agent 2 — Retrieval',
    text: 'Searches PubMed with your query (or your research question), collects titles, abstracts and metadata, and ranks candidates by relevance.',
  },
  {
    icon: Brain,
    name: 'Agent 3 — Screening',
    text: 'Reads each candidate against every criterion and drafts a decision, quoting the passage of the paper that supports each judgement.',
  },
  {
    icon: ShieldCheck,
    name: 'Agent 4 — Verification',
    text: 'Re-checks every screening decision independently, on a different model from Agent 3, and flags any paper where the two disagree.',
  },
]

const SECTIONS = [
  { id: 'getting-started', title: 'Getting started' },
  { id: 'new-review', title: 'Starting a review' },
  { id: 'pipeline', title: 'The four-agent pipeline' },
  { id: 'results', title: 'Reading the results' },
  { id: 'decisions', title: 'Approving and overriding' },
  { id: 'export', title: 'Exporting' },
  { id: 'quick-chat', title: 'Quick Chat' },
  { id: 'plans', title: 'Plans and limits' },
]

function Section({ id, title, children }) {
  return (
    <section id={id} className="scroll-mt-28">
      <h2 className="text-xl font-bold text-brand-black mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-neutral-600 leading-relaxed">{children}</div>
    </section>
  )
}

function Steps({ items }) {
  return (
    <ol className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-50 text-brand-blue text-xs font-bold shrink-0">
            {i + 1}
          </span>
          <span className="pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  )
}

export default function Docs() {
  return (
    <PageShell
      eyebrow="Documentation"
      title="Using EvidenceIQ"
      intro="Everything you need to run a systematic-review screen, from writing your criteria to exporting the papers you keep."
    >
      <div className="grid lg:grid-cols-[220px_1fr] gap-10 lg:gap-14">
        <nav aria-label="On this page" className="lg:sticky lg:top-28 lg:self-start">
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-3">On this page</p>
          <ul className="flex flex-wrap gap-2 lg:block lg:space-y-1">
            {SECTIONS.map(({ id, title }) => (
              <li key={id}>
                <Link
                  to={`#${id}`}
                  className="block text-sm text-neutral-600 hover:text-brand-blue rounded-lg border border-neutral-100 px-3 py-1.5 lg:border-0 lg:px-0 lg:py-1"
                >
                  {title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-12 min-w-0 max-w-3xl">
          <Section id="getting-started" title="Getting started">
            <Steps
              items={[
                <>
                  <Link to="/register" className="text-brand-blue hover:underline">Create an account</Link> with
                  your email, or sign in with Google.
                </>,
                'Confirm your email address from the link we send you. If it has not arrived, check your spam folder or resend it from the verification screen.',
                'Sign in and you land on your dashboard, where every review you run is listed.',
              ]}
            />
          </Section>

          <Section id="new-review" title="Starting a review">
            <p>Choose <strong className="text-brand-black">New Review</strong> in the sidebar and fill in:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <strong className="text-brand-black">Review details</strong> — your research question. Be specific
                about population, intervention and outcome.
              </li>
              <li>
                <strong className="text-brand-black">Inclusion and exclusion criteria</strong> — plain language is
                fine; Agent 1 turns it into structured rules.
              </li>
              <li>
                <strong className="text-brand-black">PubMed search</strong> (optional) — your own query. Leave it
                blank and your research question is used as the search.
              </li>
              <li>
                <strong className="text-brand-black">Papers to accept</strong> — how many papers both screening
                agents must accept (1–50). More are retrieved and screened as needed until that many pass.
              </li>
              <li>
                <strong className="text-brand-black">Publication years</strong> (advanced) — narrows the PubMed
                search only. Date limits you want screened against belong in your criteria.
              </li>
            </ul>
            <p>Start the review and the pipeline runs on its own. You can follow progress live, or cancel a running review at any time.</p>
          </Section>

          <Section id="pipeline" title="The four-agent pipeline">
            <div className="grid sm:grid-cols-2 gap-4 pt-1">
              {AGENTS.map(({ icon: Icon, name, text }) => (
                <div key={name} className="border border-neutral-100 rounded-2xl p-4">
                  <Icon className="w-5 h-5 text-brand-blue mb-2" strokeWidth={1.8} />
                  <p className="font-semibold text-brand-black text-sm mb-1">{name}</p>
                  <p className="text-sm text-neutral-500">{text}</p>
                </div>
              ))}
            </div>
            <p>
              Screening and verification always use two different models, so a mistake one model is prone to is
              not simply repeated by the other.
            </p>
          </Section>

          <Section id="results" title="Reading the results">
            <p>
              Open a review to see its papers with each agent&apos;s recommendation. Selecting a paper shows the
              criterion-by-criterion reasoning, the quoted evidence behind each judgement, and whether Agent 4
              agreed with Agent 3. Papers where the agents disagree are the ones most worth your attention.
            </p>
          </Section>

          <Section id="decisions" title="Approving and overriding">
            <p>
              No agent makes a final decision — they produce a draft and a recommendation. For each paper you
              choose <strong className="text-brand-black">Approve</strong> to accept the recommendation or{' '}
              <strong className="text-brand-black">Override</strong> to reverse it, optionally with a note. Every
              decision is kept in the paper&apos;s history alongside what the agents had concluded at the time.
            </p>
          </Section>

          <Section id="export" title="Exporting">
            <p className="flex gap-2">
              <Download className="w-4 h-4 text-brand-blue shrink-0 mt-0.5" />
              <span>
                From a review, use the export menu to download <strong className="text-brand-black">decisions as CSV</strong>{' '}
                for your PRISMA records, or <strong className="text-brand-black">citations as RIS</strong> for
                EndNote, Zotero or Mendeley. Export is included on the Researcher and Lab plans.
              </span>
            </p>
          </Section>

          <Section id="quick-chat" title="Quick Chat">
            <p className="flex gap-2">
              <MessageSquareText className="w-4 h-4 text-brand-blue shrink-0 mt-0.5" />
              <span>
                Upload a single PDF, TXT, MD or CSV file (up to 20 MB) and ask questions about it. Answers are
                quoted from your document, and anything the document does not cover is reported as missing
                rather than filled in from general knowledge.
              </span>
            </p>
          </Section>

          <Section id="plans" title="Plans and limits">
            <p className="flex gap-2">
              <UserCheck className="w-4 h-4 text-brand-blue shrink-0 mt-0.5" />
              <span>
                Every plan runs the same pipeline with the same verification and evidence. Plans differ only in
                how many reviews and papers you can run, export, history and team seats. See{' '}
                <Link to="/#pricing" className="text-brand-blue hover:underline">pricing</Link> for the full
                comparison, and manage your plan under <strong className="text-brand-black">Subscription</strong>{' '}
                once signed in.
              </span>
            </p>
            <p>
              Still stuck? Read the <Link to="/faq" className="text-brand-blue hover:underline">FAQ</Link> or{' '}
              <Link to="/support" className="text-brand-blue hover:underline">contact support</Link>.
            </p>
          </Section>
        </div>
      </div>
    </PageShell>
  )
}
