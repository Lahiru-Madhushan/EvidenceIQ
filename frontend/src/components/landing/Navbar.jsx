import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

import { useScrollSpy } from '../../lib/useScrollSpy'

// Section items (`id`) point at a section of the landing page, Home included - it used
// to be a route link to '/', which reloaded the landing page you were already reading
// instead of taking you back to the top of it. About (`to`) is a page of its own; it
// used to scroll to the footer, which said nothing about the company.
const NAV_LINKS = [
  { label: 'Home', id: 'home' },
  { label: 'How It Works', id: 'how-it-works' },
  { label: 'Features', id: 'features' },
  { label: 'Pricing', id: 'pricing' },
  { label: 'FAQ', id: 'faq' },
  { label: 'About', to: '/about' },
]

// Defined once, outside the component: the hook depends on this array, and rebuilding
// it every render would tear down and reattach the scroll listener every render too.
const SECTION_IDS = NAV_LINKS.filter((link) => link.id).map((link) => link.id)

/**
 * The same nav serves the landing page and the pages the footer links to. On the
 * landing page a section item is a plain fragment link and the highlight follows the
 * scroll; anywhere else it is a route back to that section of the landing page, and the
 * highlight marks the page you are on.
 */
function NavItem({ link, onLanding, isActive, className, onClick }) {
  const props = {
    onClick,
    'aria-current': isActive ? (link.to ? 'page' : 'true') : undefined,
    className,
    children: link.label,
  }
  if (link.to) return <Link to={link.to} {...props} />
  if (onLanding) return <a href={`#${link.id}`} {...props} />
  return <Link to={`/#${link.id}`} {...props} />
}

export default function Navbar() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const onLanding = pathname === '/'
  const spied = useScrollSpy(SECTION_IDS)

  const isActive = (link) => (link.to ? pathname === link.to : onLanding && spied === link.id)

  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-md border-b border-slate-200/70">
      <nav className="max-w-[1280px] mx-auto flex items-center justify-between px-6 sm:px-10 py-3.5">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <img src="/logo.png" alt="EvidenceIQ" className="h-16 w-auto" />
        </Link>

        <div className="hidden lg:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <NavItem
              key={link.label}
              link={link}
              onLanding={onLanding}
              isActive={isActive(link)}
              className={`text-sm font-medium transition-colors pb-0.5 border-b-2 ${
                isActive(link)
                  ? 'text-brand-blue border-brand-blue'
                  : 'text-neutral-600 border-transparent hover:text-brand-black'
              }`}
            />
          ))}
        </div>

        <div className="hidden lg:flex items-center gap-3">
          <Link
            to="/login"
            className="text-sm font-semibold text-brand-black border border-slate-200 rounded-xl px-4 py-2.5 hover:bg-slate-50 transition-colors"
          >
            Log in
          </Link>
          <Link
            to="/register"
            className="text-sm font-semibold text-white bg-gradient-to-r from-brand-blue to-blue-500 rounded-xl px-4 py-2.5 shadow-glow hover:brightness-110 transition-all"
          >
            Start free
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
            <NavItem
              key={link.label}
              link={link}
              onLanding={onLanding}
              isActive={isActive(link)}
              onClick={() => setOpen(false)}
              className={`text-sm font-medium pt-4 border-l-2 pl-3 -ml-3 transition-colors ${
                isActive(link)
                  ? 'text-brand-blue border-brand-blue'
                  : 'text-neutral-600 border-transparent hover:text-brand-black'
              }`}
            />
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
