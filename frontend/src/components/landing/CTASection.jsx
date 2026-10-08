import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2 } from 'lucide-react'

export default function CTASection() {
  return (
    <section className="bg-white px-4 pb-20 sm:px-10">
      <div className="relative mx-auto max-w-[1200px] overflow-hidden rounded-[2rem] bg-gradient-to-br from-hero-navy via-hero-deep to-hero-blue px-6 py-16 text-center text-white shadow-[0_30px_60px_-30px_rgb(6_69_181/0.7)] sm:py-20">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-hero-cyan/30 blur-3xl animate-glow-pulse" />
          <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-indigo-400/30 blur-3xl" />
          <div
            className="absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage: 'radial-gradient(rgb(255 255 255) 1.2px, transparent 1.2px)',
              backgroundSize: '22px 22px',
              maskImage: 'radial-gradient(ellipse at center, black, transparent 70%)',
            }}
          />
        </div>

        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-5xl">
            Your next review, in an afternoon
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-blue-100">
            Bring a research question. Leave with a screened, verified shortlist and a PRISMA
            diagram — and every decision still yours.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/register"
              className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-7 py-3.5 font-bold text-hero-deep shadow-xl shadow-black/20 transition-all hover:-translate-y-0.5 sm:w-auto"
            >
              Create free account
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.4} />
            </Link>
            <Link
              to="/login"
              className="inline-flex w-full items-center justify-center rounded-xl px-7 py-3.5 font-semibold text-white ring-1 ring-inset ring-white/30 transition-colors hover:bg-white/10 sm:w-auto"
            >
              Log in
            </Link>
          </div>
          <p className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-blue-100">
            {['Free plan, no card', 'All four agents included', 'Export anytime'].map((item) => (
              <span key={item} className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" strokeWidth={2.2} />
                {item}
              </span>
            ))}
          </p>
        </div>
      </div>
    </section>
  )
}
