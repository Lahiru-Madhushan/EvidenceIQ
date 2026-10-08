import Navbar from './Navbar'
import Footer from './Footer'

/**
 * The frame every public page outside the landing page shares: the same navbar and
 * footer, and a header in the landing sections' style (blue eyebrow, bold title), so
 * following a footer link feels like moving within one site rather than leaving it.
 */
export default function PageShell({ eyebrow, title, intro, children }) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Navbar />

      <header className="bg-gradient-to-b from-blue-50/70 to-white border-b border-neutral-100">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-10 py-14 sm:py-16">
          <p className="text-xs font-semibold text-brand-blue tracking-wide uppercase mb-3">{eyebrow}</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-brand-black max-w-3xl">{title}</h1>
          {intro ? (
            <p className="mt-4 text-base text-neutral-500 leading-relaxed max-w-2xl">{intro}</p>
          ) : null}
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-[1200px] mx-auto px-6 sm:px-10 py-12 sm:py-16">{children}</div>
      </main>

      <Footer />
    </div>
  )
}
