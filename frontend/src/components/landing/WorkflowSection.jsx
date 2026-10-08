import { FileSearch, ListChecks, ScanSearch, ShieldCheck, UserCheck } from 'lucide-react'

const STEPS = [
  {
    agent: 'Agent 1',
    title: 'Clarify the criteria',
    description: 'Turns your plain-English question into a structured protocol — and asks when something is ambiguous instead of guessing.',
    output: 'Structured protocol',
    icon: ListChecks,
    tone: 'from-violet-500 to-indigo-600',
    glow: 'shadow-violet-500/30',
  },
  {
    agent: 'Agent 2',
    title: 'Retrieve the literature',
    description: 'Builds a safe PubMed query from the protocol, pulls every candidate paper and ranks them.',
    output: 'Ranked candidates',
    icon: FileSearch,
    tone: 'from-sky-500 to-blue-600',
    glow: 'shadow-sky-500/30',
  },
  {
    agent: 'Agent 3',
    title: 'Screen every paper',
    description: 'Reads each title and abstract against your rules and drafts include or exclude, with a reason.',
    output: 'Draft decision + reason',
    icon: ScanSearch,
    tone: 'from-amber-400 to-orange-500',
    glow: 'shadow-amber-500/30',
  },
  {
    agent: 'Agent 4',
    title: 'Verify independently',
    description: 'A different AI model re-checks every paper without seeing the draft, quoting its evidence criterion by criterion.',
    output: 'Verdict + quoted evidence',
    icon: ShieldCheck,
    tone: 'from-emerald-400 to-emerald-600',
    glow: 'shadow-emerald-500/30',
  },
]

export default function WorkflowSection() {
  return (
    <section id="how-it-works" className="scroll-mt-24 bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-[1200px] px-6 sm:px-10">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-blue">How EvidenceIQ works</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-brand-black sm:text-4xl">
            Four agents. One researcher in charge.
          </h2>
          <p className="mt-4 text-neutral-600">
            Each agent does one job and hands a typed result to the next. Two of them judge every
            paper independently, so a mistake by one is caught by the other.
          </p>
        </div>

        <div className="relative mt-14">
          {/* The thread that joins the agents, behind the cards on wide screens. */}
          <div
            aria-hidden="true"
            className="absolute left-[10%] right-[10%] top-[34px] hidden h-0.5 bg-gradient-to-r from-violet-300 via-amber-300 to-emerald-300 lg:block"
          />

          <ol className="relative grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ agent, title, description, output, icon: Icon, tone, glow }) => (
              <li key={agent} className="group flex flex-col items-start lg:items-center lg:text-center">
                <span
                  className={`relative z-10 flex h-[68px] w-[68px] items-center justify-center rounded-2xl bg-gradient-to-br ${tone} text-white shadow-xl ${glow} ring-4 ring-white transition-transform group-hover:-translate-y-1`}
                >
                  <Icon className="h-7 w-7" strokeWidth={2} />
                </span>
                <div className="mt-5 w-full flex-1 rounded-2xl border border-slate-200/80 bg-white p-5 text-left shadow-card transition-shadow group-hover:shadow-card-hover">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-neutral-400">{agent}</p>
                  <h3 className="mt-1 text-lg font-bold text-brand-black">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-600">{description}</p>
                  <p className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200">
                    <span className="text-neutral-400">→</span>
                    {output}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="relative mt-8 overflow-hidden rounded-3xl bg-gradient-to-r from-amber-50 via-white to-emerald-50 p-6 ring-1 ring-inset ring-amber-200/70 sm:flex sm:items-center sm:gap-5 sm:p-7">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-black text-white shadow-lg">
              <UserCheck className="h-7 w-7" strokeWidth={2} />
            </span>
            <div className="mt-4 sm:mt-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-700">Then you</p>
              <h3 className="mt-1 text-xl font-bold text-brand-black">
                Decide what goes in your review
              </h3>
              <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-neutral-600">
                Papers where the agents disagree, are unsure or found suspicious wording come to you
                first, with the reasons and evidence side by side. No agent can make a final
                decision — every inclusion is yours, and every action is in the audit trail.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
