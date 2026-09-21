import { useEffect, useRef, useState } from 'react'
import { Download, FileSpreadsheet, Library } from 'lucide-react'

import { exportDecisions } from '../../lib/exportDecisions'

/**
 * Export the papers currently in the table as CSV or RIS.
 *
 * Deliberately exports what is on screen, filters and all, rather than the whole
 * review: the button sits inside the filter row, and an export that quietly ignored
 * the filter above it would be wrong in the one direction that matters - a reviewer
 * would believe they had sent the included papers and have sent everything. The count
 * is in the label for the same reason.
 */
export default function ExportMenu({ papers, review, disabled }) {
  const [open, setOpen] = useState(false)
  const wrapper = useRef(null)

  // Close on an outside click or Escape. A menu that can only be dismissed by picking
  // something from it is a trap, and this one is next to a destructive-looking action.
  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event) {
      if (!wrapper.current?.contains(event.target)) setOpen(false)
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const count = papers.length

  function choose(format) {
    exportDecisions(papers, review, format)
    setOpen(false)
  }

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        disabled={disabled || count === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-brand-black transition-colors hover:bg-neutral-50 disabled:opacity-50"
      >
        <Download className="h-4 w-4" strokeWidth={1.9} />
        Export
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1.5 w-[268px] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg"
        >
          <p className="border-b border-neutral-100 px-3 py-2 text-[11px] text-neutral-500">
            {count} paper{count === 1 ? '' : 's'} currently shown
          </p>

          <MenuItem
            icon={FileSpreadsheet}
            label="Decisions as CSV"
            hint="Every agent verdict, your decision and the evidence behind it. For a PRISMA appendix."
            onClick={() => choose('csv')}
          />
          <MenuItem
            icon={Library}
            label="Citations as RIS"
            hint="For Zotero, EndNote or Mendeley. The decision trail goes in the notes field."
            onClick={() => choose('ris')}
          />
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({ icon: Icon, label, hint, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-neutral-50"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand-blue" strokeWidth={1.9} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-brand-black">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500">{hint}</span>
      </span>
    </button>
  )
}
