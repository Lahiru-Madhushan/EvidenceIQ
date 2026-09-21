import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

import { useScrollSpy } from '../../lib/useScrollSpy'

// Every item now points at a section on this page, Home included - it used to be a
// route link to '/', which reloaded the landing page you were already reading instead
// of taking you back to the top of it.
const NAV_LINKS = [
  { label: 'Home', id: 'home' },
  { label: 'How It Works', id: 'how-it-works' },
  { label: 'Features', id: 'features' },
  { label: 'Pricing', id: 'pricing' },
  { label: 'About', id: 'about' },
]

// Defined once, outside the component: the hook depends on this array, and rebuilding
// it every render would tear down and reattach the scroll listener every render too.
const SECTION_IDS = NAV_LINKS.map((link) => link.id)

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const active = useScrollSpy(SECTION_IDS)

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
              href={`#${link.id}`}
              aria-current={active === link.id ? 'true' : undefined}
              className={`text-sm font-medium transition-colors pb-0.5 border-b-2 ${
                active === link.id
                  ? 'text-brand-blue border-brand-blue'
                  : 'text-neutral-600 border-transparent hover:text-brand-black'
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
              href={`#${link.id}`}
              onClick={() => setOpen(false)}
              aria-current={active === link.id ? 'true' : undefined}
              className={`text-sm font-medium pt-4 border-l-2 pl-3 -ml-3 transition-colors ${
                active === link.id
                  ? 'text-brand-blue border-brand-blue'
                  : 'text-neutral-600 border-transparent hover:text-brand-black'
              }`}
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
