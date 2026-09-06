import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

const NAV_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'About', href: '#about' },
]

export default function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-neutral-100">
      <nav className="max-w-[1280px] mx-auto flex items-center justify-between px-6 sm:px-10 py-3.5">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <img src="/logo.png" alt="EvidenceIQ" className="h-16 w-auto" />
        </Link>

        <div className="hidden lg:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`text-sm font-medium transition-colors pb-0.5 ${
                link.label === 'Home'
                  ? 'text-brand-blue border-b-2 border-brand-blue'
                  : 'text-neutral-600 hover:text-brand-black'
              }`}
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden lg:flex items-center gap-3">
          <Link
            to="/login"
            className="text-sm font-semibold text-brand-black border border-neutral-200 rounded-lg px-4 py-2 hover:bg-neutral-50 transition-colors"
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="text-sm font-semibold text-white bg-brand-blue rounded-lg px-4 py-2 hover:bg-brand-blue-dark transition-colors"
          >
            Sign up
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="lg:hidden text-brand-black p-2 -mr-2"
          aria-label="Toggle menu"
        >
          {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </nav>

      {open && (
        <div className="lg:hidden px-6 pb-6 flex flex-col gap-4 border-t border-neutral-100">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-neutral-600 hover:text-brand-black pt-4"
            >
              {link.label}
            </a>
          ))}
          <div className="flex flex-col gap-3 pt-2">
            <Link
              to="/login"
              className="text-sm font-semibold text-brand-black border border-neutral-200 rounded-lg px-4 py-2.5 text-center"
            >
              Log in
            </Link>
            <Link
              to="/register"
              className="text-sm font-semibold text-white bg-brand-blue rounded-lg px-4 py-2.5 text-center"
            >
              Sign up
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
