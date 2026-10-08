"""TC-03 - Pagination completeness and max_results handling.

Calls the real retrieve_pubmed_papers() against live PubMed (about 10 small requests,
no login, no database) and checks what the API promises:

  Test A  max_results = "Maximum number of papers to retrieve" - does it cap the total?
  Test B  page_size   = "Number of papers per page" - is it honoured?
  Test C  paging twice through the same pages - is every paper returned exactly once,
          and do the same pages give the same papers?

The output is printed and also saved to evidence/EV-03-pagination-test.txt.

Run from the backend folder of the build you are testing (assessed build = baseline;
the current development code has the team's paging changes):

    cd D:/SliitProject/IWRA/EvidenceIQ-baseline/backend
    D:/SliitProject/IWRA/EvidenceIQ/backend/venv/Scripts/python.exe ../../EvidenceIQ/security-assessment/tc03_pagination_test.py
"""
import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, os.getcwd())
from app.services.pubmed_service import PubMedServiceError, retrieve_pubmed_papers  # noqa: E402

QUERY = "DASH diet hypertension randomized controlled trial"
EVIDENCE = Path(__file__).resolve().parent / "evidence" / "EV-03-pagination-test.txt"

lines = []
results = {}


def out(text=""):
    print(text)
    lines.append(text)


async def fetch(page, page_size, max_results, tries=4):
    for attempt in range(1, tries + 1):
        try:
            total, papers = await retrieve_pubmed_papers(
                query=QUERY, max_results=max_results, year_from=2015, year_to=2024,
                page=page, page_size=page_size)
            break
        except PubMedServiceError:
            # NCBI throttles anonymous callers and sometimes drops a connection.
            if attempt == tries:
                raise
            print(f"  (PubMed did not answer; retrying in {2 * attempt}s)")
            await asyncio.sleep(2 * attempt)
    await asyncio.sleep(0.6)  # stay well under NCBI's 3 requests/second
    return total, [p["pmid"] for p in papers]


async def test_a():
    out("Test A - max_results=20, page_size=10, pages 1 to 3")
    out("-" * 78)
    all_pmids, total = [], 0
    for page in (1, 2, 3):
        total, pmids = await fetch(page, 10, 20)
        all_pmids += pmids
        out(f"  page {page}: {len(pmids):2} papers  first={pmids[0] if pmids else '-'}  "
            f"last={pmids[-1] if pmids else '-'}")
    distinct = len(set(all_pmids))
    out(f"  PubMed total_found      : {total}")
    out(f"  distinct papers returned: {distinct}   (max_results said 20)")
    results["A"] = distinct <= 20
    out("  RESULT: " + ("PASS - max_results respected" if results["A"]
                        else f"FAIL - {distinct} papers retrieved although max_results was 20"))
    out()


async def test_b():
    out("Test B - max_results=5, page_size=50, page 1")
    out("-" * 78)
    total, pmids = await fetch(1, 50, 5)
    out("  requested page_size     : 50")
    out(f"  papers actually returned: {len(pmids)}   (PubMed has {total})")
    out("  the API response echoes the REQUESTED page_size (routers/retrieval.py returns")
    out("  page_size=request.page_size), so the caller is told 50 when 5 were used")
    results["B"] = not (len(pmids) < 50 <= total)
    out("  RESULT: " + ("PASS - page_size honoured" if results["B"]
                        else "FAIL - page_size silently reduced to max_results"))
    out()


async def test_c():
    out("Test C - pages 1 to 3 (page_size=10) fetched twice: each paper exactly once?")
    out("-" * 78)
    runs = []
    for run in (1, 2):
        pages = []
        for page in (1, 2, 3):
            _, pmids = await fetch(page, 10, 100)
            pages.append(pmids)
        runs.append(pages)
        flat = [p for pg in pages for p in pg]
        out(f"  run {run}: {len(flat)} papers, {len(set(flat))} distinct, "
            f"{len(flat) - len(set(flat))} repeated across pages")
    first, second = runs
    differences = [(n + 1, sorted(set(a) - set(b)), sorted(set(b) - set(a)))
                   for n, (a, b) in enumerate(zip(first, second)) if set(a) != set(b)]
    for page, only1, only2 in differences:
        out(f"  page {page} changed between runs: only run 1 {only1}, only run 2 {only2}")
    lost = set(p for pg in first for p in pg) - set(p for pg in second for p in pg)
    if lost:
        out(f"  papers seen in run 1 but missing from run 2 entirely: {sorted(lost)}")
    no_repeats = all(len(set(p for pg in r for p in pg)) == sum(len(pg) for pg in r) for r in runs)
    stable = not differences
    results["C"] = no_repeats and stable
    out("  RESULT: " + ("PASS - every paper once, and the same pages gave the same papers"
                        if results["C"] else
                        "FAIL - " + ("papers repeated across pages; " if not no_repeats else "")
                        + ("the same pages returned different papers, so a paper can be skipped "
                           "or seen twice while paging (each page is a fresh search; PubMed's "
                           "History Server is not used)" if not stable else "")))
    out()


async def main():
    out("TC-03  Pagination completeness and max_results handling (live PubMed)")
    out("=" * 78)
    out(f"captured: {datetime.now():%Y-%m-%d %H:%M:%S} (local time) | code: {Path.cwd()}")
    out(f"query   : {QUERY!r}, years 2015-2024")
    out()
    await test_a()
    await test_b()
    await test_c()
    out("code: effective_page_size = min(page_size, max_results)")
    out("      retstart = (page - 1) * effective_page_size   <- no upper bound from max_results")
    out()
    failed = [k for k, ok in results.items() if not ok]
    out("OVERALL: " + ("PASS" if not failed else f"FAIL - tests {', '.join(failed)} failed"))
    EVIDENCE.parent.mkdir(exist_ok=True)
    EVIDENCE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n(saved to {EVIDENCE})")


asyncio.run(main())
