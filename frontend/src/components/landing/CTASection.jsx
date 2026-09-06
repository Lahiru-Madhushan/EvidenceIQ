import { Link } from 'react-router-dom'

export default function CTASection() {
  return (
    <section id="pricing" className="relative bg-brand-blue overflow-hidden">
      <div
        className="absolute top-0 left-0 w-56 h-56 opacity-20 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.8) 1.5px, transparent 1.5px)',
          backgroundSize: '18px 18px',
        }}
      />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-white/10 blur-3xl pointer-events-none" />

      <div className="relative max-w-[800px] mx-auto px-6 py-16 sm:py-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
          Ready to turn research into evidence?
        </h2>
        <p className="text-white/80 mb-8">
          Join EvidenceIQ and start your systematic review today.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/register"
            className="inline-flex items-center justify-center bg-white text-brand-blue font-semibold rounded-lg px-6 py-3 hover:bg-white/90 transition-colors w-full sm:w-auto"
          >
            Create Free Account
          </Link>
          <Link
            to="/login"
            className="inline-flex items-center justify-center border border-white/40 text-white font-semibold rounded-lg px-6 py-3 hover:bg-white/10 transition-colors w-full sm:w-auto"
          >
            Log in
          </Link>
        </div>
      </div>
    </section>
  )
}
