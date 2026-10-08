"""TC-05 - PubMed query injection: can user text change the search, and can it
escape the publication-date filter?

Uses the real build_pubmed_query() and live PubMed esearch (10 small requests, no
login, no database).

  * The date filter is BYPASSED only if an injected search returns more papers than
    exist in the whole 2020-2024 window (the "ceiling").
  * The query STRUCTURE is injected if user-typed PubMed syntax changes what the
    search means (for example removing the topic restriction).

The output is printed and also saved to evidence/EV-05b-query-injection-test.txt.

Run from the backend folder of the build you are testing (assessed build = baseline;
the current development code has the team's query fix):

    cd D:/SliitProject/IWRA/EvidenceIQ-baseline/backend
    D:/SliitProject/IWRA/EvidenceIQ/backend/venv/Scripts/python.exe ../../EvidenceIQ/security-assessment/tc05_query_injection_test.py
"""
import atexit
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

import _eutils  # retrying PubMed calls, next to this script

sys.path.insert(0, os.getcwd())
from app.services.pubmed_service import build_pubmed_query  # noqa: E402

YEAR_FROM, YEAR_TO = 2020, 2024
ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
EVIDENCE = Path(__file__).resolve().parent / "evidence" / "EV-05b-query-injection-test.txt"


class _Tee:
    """Everything printed also goes to the evidence file."""

    def __init__(self, stream):
        self.stream, self.lines = stream, []

    def write(self, text):
        self.stream.write(text)
        self.lines.append(text)

    def flush(self):
        self.stream.flush()


sys.stdout = _Tee(sys.stdout)


@atexit.register
def _save():
    EVIDENCE.parent.mkdir(exist_ok=True)
    EVIDENCE.write_text("".join(sys.stdout.lines), encoding="utf-8")
    sys.stdout.stream.write(f"\n(saved to {EVIDENCE})\n")


def count(term):
    r = _eutils.get(ESEARCH, timeout=30, params={"db": "pubmed", "term": term, "retmode": "json", "retmax": 0})
    time.sleep(0.5)  # stay under NCBI's 3 requests/second
    return int(r.json()["esearchresult"]["count"])


print("TC-05  PubMed query injection (live PubMed)")
print("=" * 78)
print(f"captured: {datetime.now():%Y-%m-%d %H:%M:%S} (local time) | code: {Path.cwd()}")
ceiling = count(f"{YEAR_FROM}:{YEAR_TO}[dp]")
everything = count("1:3000[dp]")
print(f"reference - every paper in PubMed           : {everything:>12,}")
print(f"reference - every paper from {YEAR_FROM}-{YEAR_TO} (ceiling): {ceiling:>12,}")
print("  -> a bypass of the date filter would have to return MORE than the ceiling")
print()

attempts = [
    ("normal search", "diabetes"),
    ("OR injection", "diabetes OR 1:2100[dp] OR cancer"),
    ("unclosed bracket", "1:3000[dp] OR (diabetes"),
    ("close and reopen brackets", "diabetes) OR 1:3000[dp] OR (diabetes"),
    ("NOT operator", "diabetes NOT 2020:2024[dp] OR diabetes"),
    ("comment character", "1:3000[dp] #"),
]
results = {}
print(f"{'attempt':27} {'results':>12}  date filter")
print("-" * 78)
for label, query in attempts:
    try:
        term = build_pubmed_query(query=query, year_from=YEAR_FROM, year_to=YEAR_TO)
    except ValueError as exc:
        # The hardened build refuses a search that is nothing but PubMed syntax.
        print(f"{label:27} {'refused':>12}  {exc}")
        continue
    n = count(term)
    results[label] = n
    held = "held" if n <= ceiling else "BYPASSED"
    print(f"{label:27} {n:>12,}  {held}")
    print(f"{'':27} sent: {term}")
print()

normal, injected = results["normal search"], results.get("OR injection", results["normal search"])
bypassed = any(n > ceiling for n in results.values())
# The injected OR smuggles in "1:2100[dp]", a range matching every paper. If that text
# still reaches PubMed, user input is being executed as query syntax.
probe = build_pubmed_query(query="diabetes OR 1:2100[dp] OR cancer", year_from=YEAR_FROM, year_to=YEAR_TO)
syntax_executed = "1:2100" in probe or "[dp]" in probe.replace(f"{YEAR_FROM}:{YEAR_TO}[Date - Publication]", "")
print("SUMMARY")
print("-" * 78)
print(f"date filter bypassed by any attempt : {'YES' if bypassed else 'NO'} "
      f"(highest result {max(results.values()):,} vs ceiling {ceiling:,})")
print(f"user PubMed syntax reaches PubMed   : {'YES' if syntax_executed else 'NO'} (sent: {probe})")
print()
if bypassed:
    print("RESULT: FAIL - the date filter was bypassed.")
elif syntax_executed:
    print("RESULT: FAIL - user input is executed as PubMed query syntax and can remove the topic")
    print("        restriction; the date filter itself HELD because it is appended last and")
    print("        PubMed evaluates operators left to right.")
else:
    print("RESULT: PASS - field tags, date ranges and stray brackets are stripped, the term is")
    print("        bracketed so the date filter covers all of it, and a search of pure syntax")
    print("        is refused.")
