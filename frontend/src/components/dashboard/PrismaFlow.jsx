import { useRef } from 'react'
import { Download, GitBranch } from 'lucide-react'

/**
 * A PRISMA 2020-style flow diagram for one review, drawn from its live counts.
 *
 * Every systematic review has to publish one, and researchers usually redraw it by hand
 * from numbers scattered across their notes. Here the counts already exist, so the
 * diagram is generated - and exported as SVG or PNG for the manuscript. The boxes follow
 * PRISMA's identification -> screening -> included structure, with the AI-assisted
 * stages named honestly rather than presented as human screening.
 */
function prismaCounts(papers) {
  const identified = papers.length
  const screened = papers.filter((p) => p.screened_at).length
  const verified = papers.filter((p) => p.verified_at || p.verified_decision).length
  const agentsExcluded = papers.filter(
    (p) => p.draft_decision === 'EXCLUDE' && p.verified_decision === 'EXCLUDE' && p.researcher_status !== 'approved'
  ).length
  const decided = papers.filter((p) => p.researcher_status != null).length
  const excludedByYou = papers.filter((p) => p.researcher_status === 'overridden').length
  const included = papers.filter((p) => p.researcher_status === 'approved').length
  return {
    identified,
    notScreened: identified - screened,
    screened,
    notVerified: screened - verified,
    verified,
    agentsExcluded,
    decided,
    awaiting: Math.max(verified - decided, 0),
    excludedByYou,
    included,
  }
}

const W = 760
const H = 560
const MAIN_X = 150
const MAIN_W = 300
const SIDE_X = 500
const SIDE_W = 240
const BOX_H = 64

const PHASES = [
  { label: 'Identification', y: 20, h: 84, color: '#2563eb' },
  { label: 'Screening', y: 124, h: 280, color: '#7c3aed' },
  { label: 'Included', y: 424, h: 116, color: '#059669' },
]

function Box({ x, y, w, title, n, tone }) {
  const tones = {
    main: { fill: '#ffffff', stroke: '#cbd5e1', text: '#0f172a', n: '#2563eb' },
    side: { fill: '#f8fafc', stroke: '#e2e8f0', text: '#334155', n: '#64748b' },
    warn: { fill: '#fffbeb', stroke: '#fcd34d', text: '#78350f', n: '#b45309' },
    good: { fill: '#ecfdf5', stroke: '#6ee7b7', text: '#064e3b', n: '#047857' },
  }[tone]
  return (
    <g>
      <rect x={x} y={y} width={w} height={BOX_H} rx="12" fill={tones.fill} stroke={tones.stroke} strokeWidth="1.5" />
      <text x={x + 16} y={y + 26} fontSize="13" fontWeight="600" fill={tones.text}>
        {title}
      </text>
      <text x={x + 16} y={y + 48} fontSize="13" fill={tones.n}>
        <tspan fontWeight="700">n = {n}</tspan>
      </text>
    </g>
  )
}

function Arrow({ x1, y1, x2, y2 }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94a3b8" strokeWidth="1.6" markerEnd="url(#prisma-arrow)" />
}

export default function PrismaFlow({ papers, review }) {
  const svgRef = useRef(null)
  const c = prismaCounts(papers)
  const rows = [30, 140, 240, 340, 450]
  const mid = MAIN_X + MAIN_W / 2

  function serialize() {
    const node = svgRef.current.cloneNode(true)
    node.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    node.setAttribute('width', W)
    node.setAttribute('height', H)
    return new XMLSerializer().serializeToString(node)
  }

  function save(blob, ext) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `prisma-flow-${(review?.research_question ?? 'review').slice(0, 40).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${ext}`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function downloadSvg() {
    save(new Blob([serialize()], { type: 'image/svg+xml' }), 'svg')
  }

  function downloadPng() {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = W * 2
      canvas.height = H * 2
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => blob && save(blob, 'png'), 'image/png')
    }
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialize())}`
  }

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
            <GitBranch className="h-5 w-5" strokeWidth={2} />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-brand-black">PRISMA flow diagram</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
              Generated live from this review — it updates as you decide. Ready for your
              manuscript.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={downloadSvg}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-brand-black transition-colors hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
            SVG
          </button>
          <button
            type="button"
            onClick={downloadPng}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-black px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
            PNG
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl bg-slate-50/60 p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="mx-auto block w-full min-w-[560px] max-w-[760px]"
          role="img"
          aria-label={`PRISMA flow: ${c.identified} identified, ${c.screened} screened, ${c.included} included`}
          fontFamily="Plus Jakarta Sans Variable, Plus Jakarta Sans, Segoe UI, Arial, sans-serif"
        >
          <defs>
            <marker id="prisma-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
            </marker>
          </defs>
          <rect x="0" y="0" width={W} height={H} fill="#ffffff" />

          {PHASES.map((phase) => (
            <g key={phase.label}>
              <rect x="16" y={phase.y} width="34" height={phase.h} rx="10" fill={phase.color} opacity="0.12" />
              <text
                x={33}
                y={phase.y + phase.h / 2}
                fontSize="12"
                fontWeight="700"
                fill={phase.color}
                textAnchor="middle"
                transform={`rotate(-90 33 ${phase.y + phase.h / 2})`}
              >
                {phase.label}
              </text>
            </g>
          ))}

          <Box x={MAIN_X} y={rows[0]} w={MAIN_W} title="Records identified (PubMed)" n={c.identified} tone="main" />
          <Box x={MAIN_X} y={rows[1]} w={MAIN_W} title="Screened · Agent 3 (title/abstract)" n={c.screened} tone="main" />
          <Box x={MAIN_X} y={rows[2]} w={MAIN_W} title="Independently verified · Agent 4" n={c.verified} tone="main" />
          <Box x={MAIN_X} y={rows[3]} w={MAIN_W} title="Assessed by the researcher" n={c.decided} tone="main" />
          <Box x={MAIN_X} y={rows[4]} w={MAIN_W} title="Studies included in review" n={c.included} tone="good" />

          <Box x={SIDE_X} y={rows[1]} w={SIDE_W} title="Not yet screened" n={c.notScreened} tone="side" />
          <Box x={SIDE_X} y={rows[2]} w={SIDE_W} title="Excluded — both agents agreed" n={c.agentsExcluded} tone="side" />
          <Box x={SIDE_X} y={rows[3]} w={SIDE_W} title="Excluded by the researcher" n={c.excludedByYou} tone="side" />
          <Box x={SIDE_X} y={rows[4]} w={SIDE_W} title="Awaiting your decision" n={c.awaiting} tone="warn" />

          {rows.slice(0, -1).map((y, i) => (
            <Arrow key={y} x1={mid} y1={y + BOX_H} x2={mid} y2={rows[i + 1] - 2} />
          ))}
          {rows.slice(1).map((y) => (
            <Arrow key={`s${y}`} x1={MAIN_X + MAIN_W} y1={y + BOX_H / 2} x2={SIDE_X - 2} y2={y + BOX_H / 2} />
          ))}

          <text x={MAIN_X} y={H - 8} fontSize="10.5" fill="#94a3b8">
            AI-assisted screening (EvidenceIQ). Final inclusion decided by the researcher. Report the
            executed search query alongside this diagram.
          </text>
        </svg>
      </div>
    </section>
  )
}
