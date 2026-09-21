/**
 * Export a review's screening decisions as CSV or RIS.
 *
 * Two formats because they answer two different questions, and neither substitutes for
 * the other:
 *
 *   CSV  the decision trail - what each agent said, what you decided, and why. This is
 *        what goes in a PRISMA appendix or a supervisor's inbox, so it carries the
 *        reasons and the evidence, not just the verdicts.
 *   RIS  the citations themselves, for Zotero/EndNote/Mendeley. A reference manager has
 *        nowhere to put "Agent 4 was UNCLEAR on population", so the trail is folded into
 *        the notes field rather than dropped.
 *
 * Everything here is a pure function over rows the caller already has. Nothing fetches,
 * so an export never shows a different set of papers from the table it was clicked on.
 */

import { outcomeOf } from './outcomes'

const PUBMED_URL = 'https://pubmed.ncbi.nlm.nih.gov'

// How the four joint outcomes read to someone who is not reading this codebase.
const OUTCOME_LABELS = {
  confirmed: 'Both agents: INCLUDE',
  rejected: 'Both agents: EXCLUDE',
  disagreed: 'Agents disagreed',
  unverified: 'Not verified (Agent 4 did not run)',
  unscreened: 'Not screened',
}

// researcher_status is null until the human decides, which is a real state, not a gap.
const STATUS_LABELS = {
  approved: 'Approved',
  overridden: 'Excluded (overridden)',
  maybe: 'Maybe',
}

function text(value) {
  if (value == null) return ''
  return String(value)
}

/** An ISO timestamp, kept sortable and unambiguous rather than localised. */
function stamp(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? text(value) : date.toISOString()
}

/** Collapse newlines: both formats treat a line break as a record boundary. */
function flatten(value) {
  return text(value).replace(/\s*\n+\s*/g, ' ').trim()
}

/**
 * One cell, quoted per RFC 4180 and defused against formula injection.
 *
 * The second part is not paranoia. Titles arrive from PubMed and notes are typed by
 * people, and Excel and Sheets execute any cell beginning =, +, - or @ on open. A paper
 * titled "=cmd|..." would otherwise run when a supervisor opens the export we told them
 * to trust. The leading apostrophe is the standard defusal: spreadsheets read it as
 * "this is text" and do not show it in the cell.
 */
function cell(value) {
  const raw = text(value)
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replace(/"/g, '""')}"`
}

/** "population: PASS (rule) — 'Published 2024'; condition: UNCLEAR (llm)" */
function summariseChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return ''
  return checks
    .map((check) => {
      const head = `${text(check?.criterion)}: ${text(check?.status)} (${text(check?.source) || 'llm'})`
      const evidence = flatten(check?.evidence)
      return evidence ? `${head} — “${evidence}”` : head
    })
    .join('; ')
}

// Column order runs left to right in the order the work happened: what the paper is,
// what Agent 3 said, what Agent 4 said, what the human concluded.
const COLUMNS = [
  ['PMID', (paper) => paper.pmid],
  ['Title', (paper) => flatten(paper.title)],
  ['Journal', (paper) => paper.journal],
  ['Year', (paper) => paper.year],
  ['Publication types', (paper) => (paper.publication_types || []).join('; ')],
  ['Agent 3 decision', (paper) => paper.draft_decision],
  ['Agent 3 reason', (paper) => flatten(paper.draft_reason)],
  ['Screened at', (paper) => stamp(paper.screened_at)],
  ['Agent 4 decision', (paper) => paper.verified_decision],
  ['Confidence', (paper) => paper.confidence],
  ['Agents agreed', (paper) => (paper.agreement == null ? '' : paper.agreement ? 'yes' : 'no')],
  ['Needs human review', (paper) => (paper.needs_human_review ? 'yes' : 'no')],
  ['Verification note', (paper) => flatten(paper.verification_note)],
  ['Criterion checks', (paper) => summariseChecks(paper.checks)],
  ['Issues', (paper) => (paper.issues || []).join('; ')],
  ['Verified at', (paper) => stamp(paper.verified_at)],
  ['Joint outcome', (paper) => OUTCOME_LABELS[outcomeOf(paper)] ?? ''],
  [
    'Your decision',
    (paper) => (paper.researcher_status ? STATUS_LABELS[paper.researcher_status] ?? paper.researcher_status : 'Not yet decided'),
  ],
  ['Your note', (paper) => flatten(paper.researcher_note)],
  ['Decided at', (paper) => stamp(paper.researcher_decided_at)],
  ['PubMed URL', (paper) => (paper.pmid ? `${PUBMED_URL}/${paper.pmid}/` : '')],
]

/**
 * The decision trail as CSV.
 *
 * CRLF line endings and a UTF-8 BOM, both for Excel: without the BOM it reads the file
 * as the system codepage and mangles every quoted span that contains an en dash or a
 * curly quote - which, since the evidence spans are quoted verbatim from papers, is
 * most of them.
 */
export function toCsv(papers) {
  const header = COLUMNS.map(([label]) => cell(label)).join(',')
  const rows = papers.map((paper) =>
    COLUMNS.map(([, read]) => cell(read(paper))).join(',')
  )
  return `﻿${[header, ...rows].join('\r\n')}\r\n`
}

/**
 * The citations as RIS, with the decision trail in the notes field.
 *
 * RIS has no escape mechanism at all - a tag is recognised by being at the start of a
 * line - so every value is flattened to one line first. A stray newline in an abstract
 * would otherwise end the record early and take the rest of the export with it.
 */
export function toRis(papers) {
  const records = papers.map((paper) => {
    const lines = [['TY', 'JOUR']]

    if (paper.title) lines.push(['TI', flatten(paper.title)])
    if (paper.journal) lines.push(['JO', flatten(paper.journal)])
    if (paper.year) lines.push(['PY', text(paper.year)])
    if (paper.abstract) lines.push(['AB', flatten(paper.abstract)])
    if (paper.pmid) {
      lines.push(['AN', text(paper.pmid)])
      lines.push(['UR', `${PUBMED_URL}/${paper.pmid}/`])
    }
    for (const type of paper.publication_types || []) lines.push(['KW', flatten(type)])

    // The screening record, in the one field every reference manager displays.
    const trail = [
      `EvidenceIQ: ${OUTCOME_LABELS[outcomeOf(paper)] ?? 'Not screened'}`,
      paper.confidence ? `confidence ${paper.confidence}` : null,
      paper.researcher_status
        ? `your decision: ${STATUS_LABELS[paper.researcher_status] ?? paper.researcher_status}`
        : 'not yet decided',
      flatten(paper.researcher_note) ? `your note: ${flatten(paper.researcher_note)}` : null,
      flatten(paper.verification_note) ? `verification: ${flatten(paper.verification_note)}` : null,
    ].filter(Boolean)
    lines.push(['N1', trail.join(' | ')])

    lines.push(['ER', ''])
    return lines.map(([tag, value]) => `${tag}  - ${value}`).join('\r\n')
  })

  return `${records.join('\r\n\r\n')}\r\n`
}

/** "evidenceiq-decisions-2026-09-21.csv", with the review's question if it has one. */
export function exportFilename(review, extension) {
  const slug = (review?.research_question || 'decisions')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
  const day = new Date().toISOString().slice(0, 10)
  return `evidenceiq-${slug || 'decisions'}-${day}.${extension}`
}

/**
 * Hand the file to the browser.
 *
 * Isolated here so the format functions above stay pure and testable: they build a
 * string, and only this touches the DOM.
 */
export function downloadFile(filename, mimeType, contents) {
  const blob = new Blob([contents], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoked on the next tick: revoking synchronously races the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Build and download one review's decisions. `format` is 'csv' or 'ris'. */
export function exportDecisions(papers, review, format) {
  if (format === 'ris') {
    downloadFile(exportFilename(review, 'ris'), 'application/x-research-info-systems', toRis(papers))
    return
  }
  downloadFile(exportFilename(review, 'csv'), 'text/csv', toCsv(papers))
}
