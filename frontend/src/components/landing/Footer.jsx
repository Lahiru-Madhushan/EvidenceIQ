import { Link } from 'react-router-dom'

import { FOOTER_COLUMNS } from '../../lib/site'

function LinkedinIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.38-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13ZM7.12 20.45H3.56V9h3.56v11.45Z" />
    </svg>
  )
}

function TwitterIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M18.9 3H21l-6.55 7.49L22.2 21h-6.03l-4.72-6.17L5.98 21H3.86l7.01-8.01L2.9 3h6.18l4.27 5.64L18.9 3Zm-1.06 16.17h1.17L7.2 4.75H5.94l11.9 14.42Z" />
    </svg>
  )
}

function GithubIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.48 2 2 6.58 2 12.21c0 4.5 2.87 8.32 6.84 9.67.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.51-3.5-.7-3.72-1.34-.13-.33-.68-1.34-1.16-1.62-.4-.22-.97-.75-.01-.77.9-.01 1.54.85 1.76 1.2 1.03 1.75 2.67 1.26 3.32.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.29-5.23-5.72 0-1.26.44-2.3 1.16-3.11-.12-.29-.5-1.48.11-3.08 0 0 .95-.31 3.12 1.19a10.6 10.6 0 0 1 2.84-.39c.96 0 1.93.13 2.84.39 2.17-1.5 3.12-1.19 3.12-1.19.61 1.6.23 2.79.11 3.08.72.81 1.16 1.84 1.16 3.11 0 4.44-2.69 5.43-5.25 5.71.42.37.78 1.08.78 2.19 0 1.58-.01 2.85-.01 3.24 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.21C22 6.58 17.52 2 12 2Z"
      />
    </svg>
  )
}

export default function Footer() {
  return (
    <footer className="bg-white border-t border-neutral-100">
      <div className="max-w-[1200px] mx-auto px-6 sm:px-10 py-14">
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-10 mb-10">
          <div className="lg:col-span-2">
            <Link to="/" className="inline-block">
              <img src="/logo.png" alt="EvidenceIQ" className="h-16 w-auto mb-3" />
            </Link>
          </div>

          {FOOTER_COLUMNS.map(({ heading, links }) => (
            <div key={heading}>
              <p className="text-sm font-semibold text-brand-black mb-3">{heading}</p>
              <ul className="space-y-2">
                {links.map(({ label, to }) => (
                  <li key={label}>
                    <Link to={to} className="text-sm text-neutral-500 hover:text-brand-blue transition-colors">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div>
            <p className="text-sm font-semibold text-brand-black mb-3">Follow us</p>
            <div className="flex items-center gap-3">
              <a href="#" aria-label="LinkedIn" className="text-neutral-400 hover:text-brand-blue transition-colors">
                <LinkedinIcon className="w-5 h-5" />
              </a>
              <a href="#" aria-label="Twitter" className="text-neutral-400 hover:text-brand-blue transition-colors">
                <TwitterIcon className="w-5 h-5" />
              </a>
              <a href="#" aria-label="GitHub" className="text-neutral-400 hover:text-brand-blue transition-colors">
                <GithubIcon className="w-5 h-5" />
              </a>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8 border-t border-neutral-100 text-xs text-neutral-400">
          <p>&copy; {new Date().getFullYear()} EvidenceIQ. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <a href="#" className="hover:text-brand-blue transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-brand-blue transition-colors">Terms of Service</a>
          </div>
        </div>
      </div>
    </footer>
  )
}
