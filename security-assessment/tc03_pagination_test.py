"""TC-03 - Pagination and max_results handling.

Calls the real retrieve_pubmed_papers() against live PubMed (8 small requests, no
login, no database) and checks two promises the API makes:
  * max_results = "Maximum number of papers to retrieve"
  * page_size   = "Number of papers per page"

Run from the backend folder:

    cd D:/SliitProject/IWRA/EvidenceIQ/backend
    ./venv/Scripts/python.exe ../security-assessment/tc03_pagination_test.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.getcwd())
from app.services.pubmed_service import retrieve_pubmed_papers  # noqa: E402

QUERY = "DASH diet hypertension randomized controlled trial"


async def fetch(page, page_size, max_results):
    total, papers = await retrieve_pubmed_papers(
        query=QUERY, max_results=max_results, year_from=2015, year_to=2024,
        page=page, page_size=page_size)
    await asyncio.sleep(0.6)  # stay well under NCBI's 3 requests/second
    return total, [p["pmid"] for p in papers]


async def main():
    print("TC-03  Pagination and max_results handling (live PubMed)")
    print("=" * 72)
    print(f"query: {QUERY!r}, years 2015-2024")
    print()

    # Test A: does max_results cap the whole result set?
    print("Test A - max_results=20, page_size=10, pages 1 to 3")
    print("-" * 72)
    all_pmids = []
    for page in (1, 2, 3):
        total, pmids = await fetch(page, 10, 20)
        all_pmids += pmids
        print(f"page {page}: {len(pmids):2} papers  first={pmids[0] if pmids else '-'}  last={pmids[-1] if pmids else '-'}")
    distinct = len(set(all_pmids))
    print(f"PubMed total_found      : {total}")
    print(f"distinct papers returned: {distinct}   (max_results said 20)")
    print(f"duplicates across pages : {len(all_pmids) - distinct}")
    print("RESULT:", "FAIL - more papers than max_results were retrieved" if distinct > 20
          else "PASS - max_results respected")
    print()

    # Test B: is the requested page_size honoured?
    print("Test B - max_results=5, page_size=50, page 1")
    print("-" * 72)
    total, pmids = await fetch(1, 50, 5)
    print(f"requested page_size     : 50")
    print(f"papers actually returned: {len(pmids)}")
    print("the API response still echoes page_size=50 (routers/retrieval.py returns request.page_size)")
    print("RESULT:", "FAIL - page_size silently reduced to max_results" if len(pmids) < 50 and total >= 50
          else "PASS - page_size honoured")
    print()
    print("code: effective_page_size = min(page_size, max_results)")
    print("      retstart = (page - 1) * effective_page_size   <- no upper bound from max_results")


asyncio.run(main())
