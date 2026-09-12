import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Loader2,
  Search,
} from 'lucide-react'

import { searchPapers } from '../lib/retrievalApi'

export default function PaperList() {
  const { reviewId } = useParams()

  const [query, setQuery] = useState('')
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const [yearFrom, setYearFrom] = useState('')
  const [yearTo, setYearTo] = useState('')

  const [papers, setPapers] = useState([])
  const [totalFound, setTotalFound] = useState(0)
  const [savedCount, setSavedCount] = useState(0)
  const [selectedPmids, setSelectedPmids] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const totalPages =
    totalFound > 0
      ? Math.ceil(totalFound / pageSize)
      : 0

  async function retrievePapers(targetPage) {
    const cleanedQuery = query.trim()

    if (!reviewId) {
      setError(
        'No review was selected. Open this page from a review.',
      )
      return
    }

    if (cleanedQuery.length < 3) {
      setError('Please enter at least 3 characters.')
      return
    }

    if (
      yearFrom &&
      yearTo &&
      Number(yearFrom) > Number(yearTo)
    ) {
      setError(
        'The starting year cannot be greater than the ending year.',
      )
      return
    }

    const requestData = {
      review_id: reviewId,
      query: cleanedQuery,
      max_results: Number(pageSize),
      page: targetPage,
      page_size: Number(pageSize),
    }

    if (yearFrom) {
      requestData.year_from = Number(yearFrom)
    }

    if (yearTo) {
      requestData.year_to = Number(yearTo)
    }

    setLoading(true)
    setError('')
    setMessage('')
    setSavedCount(0)
    setSelectedPmids([])

    try {
      const result = await searchPapers(requestData)

      setPapers(result.papers || [])
      setTotalFound(result.total_found || 0)
      setSavedCount(result.saved_count || 0)
      setPage(result.page || targetPage)
      setMessage(result.message || '')
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to retrieve papers.',
      )

      setPapers([])
      setTotalFound(0)
      setSavedCount(0)
    } finally {
      setLoading(false)
    }
  }

  async function handleSearch(event) {
    event.preventDefault()
    setPage(1)
    await retrievePapers(1)
  }

  async function changePage(targetPage) {
    if (
      targetPage < 1 ||
      targetPage > totalPages ||
      loading
    ) {
      return
    }

    await retrievePapers(targetPage)

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  function togglePaper(pmid) {
    setSelectedPmids((currentSelection) => {
      if (currentSelection.includes(pmid)) {
        return currentSelection.filter(
          (selectedPmid) => selectedPmid !== pmid,
        )
      }

      return [...currentSelection, pmid]
    })
  }

  function clearSearch() {
    setQuery('')
    setYearFrom('')
    setYearTo('')
    setPapers([])
    setTotalFound(0)
    setSavedCount(0)
    setSelectedPmids([])
    setError('')
    setMessage('')
    setPage(1)
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <img
            src="/logo.png"
            alt="EvidenceIQ"
            className="h-9 w-auto"
          />

          <a
            href="/dashboard"
            className="text-sm font-medium text-brand-blue"
          >
            Dashboard
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-7">
          <h1 className="text-3xl font-semibold text-brand-black">
            Research Paper Retrieval
          </h1>

          <p className="mt-2 text-neutral-600">
            Search PubMed and save relevant papers to your
            systematic review.
          </p>
        </div>

        {!reviewId && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800"
          >
            No review was selected. Open the Paper Retrieval page
            from an existing review.
          </div>
        )}

        <form
          onSubmit={handleSearch}
          className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
        >
          <label
            htmlFor="paper-query"
            className="mb-2 block text-sm font-medium text-brand-black"
          >
            Research topic
          </label>

          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="paper-query"
              type="text"
              value={query}
              onChange={(event) =>
                setQuery(event.target.value)
              }
              placeholder="Example: type 2 diabetes metformin treatment"
              maxLength={500}
              disabled={loading || !reviewId}
              className="flex-1 rounded-lg border border-neutral-300 px-4 py-3 outline-none transition focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 disabled:bg-neutral-100"
            />

            <button
              type="submit"
              disabled={loading || !reviewId}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-blue px-6 py-3 font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Search className="h-5 w-5" />
              )}

              {loading ? 'Searching...' : 'Search'}
            </button>

            <button
              type="button"
              onClick={clearSearch}
              disabled={loading}
              className="rounded-lg border border-neutral-300 px-6 py-3 font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Clear
            </button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <label
                htmlFor="year-from"
                className="mb-2 block text-sm font-medium"
              >
                From year
              </label>

              <input
                id="year-from"
                type="number"
                min="1800"
                max="2100"
                value={yearFrom}
                disabled={loading || !reviewId}
                onChange={(event) =>
                  setYearFrom(event.target.value)
                }
                placeholder="2020"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 disabled:bg-neutral-100"
              />
            </div>

            <div>
              <label
                htmlFor="year-to"
                className="mb-2 block text-sm font-medium"
              >
                To year
              </label>

              <input
                id="year-to"
                type="number"
                min="1800"
                max="2100"
                value={yearTo}
                disabled={loading || !reviewId}
                onChange={(event) =>
                  setYearTo(event.target.value)
                }
                placeholder="2026"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 disabled:bg-neutral-100"
              />
            </div>

            <div>
              <label
                htmlFor="page-size"
                className="mb-2 block text-sm font-medium"
              >
                Papers per page
              </label>

              <select
                id="page-size"
                value={pageSize}
                disabled={loading || !reviewId}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 disabled:bg-neutral-100"
              >
                <option value={5}>5 papers</option>
                <option value={10}>10 papers</option>
                <option value={20}>20 papers</option>
                <option value={50}>50 papers</option>
              </select>
            </div>
          </div>
        </form>

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700"
          >
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center gap-3 py-16 text-neutral-600">
            <Loader2 className="h-6 w-6 animate-spin text-brand-blue" />
            Searching PubMed and saving papers...
          </div>
        )}

        {!loading && papers.length > 0 && (
          <>
            <div className="my-6 flex flex-col justify-between gap-3 sm:flex-row">
              <div>
                <p className="text-neutral-600">
                  Found {totalFound.toLocaleString()} matching
                  papers. Showing {papers.length} on page {page}.
                </p>

                {message && (
                  <p className="mt-1 text-sm text-green-700">
                    {message}
                  </p>
                )}

                <p className="mt-1 text-sm text-neutral-500">
                  {savedCount} paper(s) saved or updated in the
                  database.
                </p>
              </div>

              <p className="font-medium text-brand-blue">
                {selectedPmids.length} selected
              </p>
            </div>

            <div className="space-y-4">
              {papers.map((paper) => (
                <article
                  key={paper.pmid}
                  className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
                >
                  <div className="flex items-start gap-4">
                    <input
                      type="checkbox"
                      checked={selectedPmids.includes(
                        paper.pmid,
                      )}
                      onChange={() =>
                        togglePaper(paper.pmid)
                      }
                      aria-label={`Select ${paper.title}`}
                      className="mt-2 h-5 w-5"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-start gap-3">
                          <FileText className="mt-1 h-5 w-5 shrink-0 text-brand-blue" />

                          <h2 className="text-lg font-semibold text-brand-black">
                            {paper.title}
                          </h2>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {paper.rank != null && (
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-brand-blue">
                              Rank #{paper.rank}
                            </span>
                          )}

                          {paper.relevance_score != null && (
                            <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                              {(
                                paper.relevance_score * 100
                              ).toFixed(0)}
                              % match
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="mt-3 text-sm text-neutral-600">
                        {paper.authors?.length
                          ? paper.authors.join(', ')
                          : 'Authors not available'}
                      </p>

                      <p className="mt-1 text-sm text-neutral-500">
                        {paper.journal ||
                          'Journal not available'}

                        {paper.publication_year
                          ? ` • ${paper.publication_year}`
                          : ''}
                      </p>

                      {paper.publication_types?.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {paper.publication_types.map(
                            (publicationType) => (
                              <span
                                key={publicationType}
                                className="rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600"
                              >
                                {publicationType}
                              </span>
                            ),
                          )}
                        </div>
                      )}

                      <p className="mt-4 line-clamp-4 text-sm leading-6 text-neutral-700">
                        {paper.abstract ||
                          'Abstract not available.'}
                      </p>

                      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
                        <span className="text-neutral-600">
                          PMID: {paper.pmid}
                        </span>

                        <span className="text-neutral-600">
                          DOI: {paper.doi || 'Not available'}
                        </span>

                        <a
                          href={paper.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-brand-blue hover:underline"
                        >
                          View on PubMed
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-8 flex flex-col items-center justify-between gap-4 rounded-xl border border-neutral-200 bg-white p-4 sm:flex-row">
                <button
                  type="button"
                  onClick={() => changePage(page - 1)}
                  disabled={page === 1 || loading}
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </button>

                <p className="text-sm text-neutral-600">
                  Page{' '}
                  <span className="font-semibold text-brand-black">
                    {page}
                  </span>{' '}
                  of{' '}
                  <span className="font-semibold text-brand-black">
                    {totalPages.toLocaleString()}
                  </span>
                </p>

                <button
                  type="button"
                  onClick={() => changePage(page + 1)}
                  disabled={
                    page >= totalPages || loading
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-4 py-2 font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}

            <div className="sticky bottom-5 mt-7 rounded-xl border border-neutral-200 bg-white p-4 shadow-lg">
              <button
                type="button"
                disabled={selectedPmids.length === 0}
                className="w-full rounded-lg bg-brand-blue px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send {selectedPmids.length} selected paper(s) for
                screening
              </button>
            </div>
          </>
        )}

        {!loading &&
          !error &&
          message &&
          papers.length === 0 && (
            <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-8 text-center text-neutral-600">
              {message}
            </div>
          )}
      </main>
    </div>
  )
}