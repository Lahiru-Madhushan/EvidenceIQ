"""TC-04 - Silent record loss during XML parsing.

  Part 1  five hand-made PubMed records (complete, no abstract, empty title, duplicate,
          no PMID) fed to the real parse_pubmed_xml(): which survive, and is the loss
          reported anywhere?
  Part 2  the API contract: does RetrievalResponse have any field that could tell the
          researcher a record was dropped?
  Part 3  (--live) real PubMed records run through the same parser: how often do
          dropped records and "Abstract not available." placeholders actually occur?

No server, no login, no database. Output is printed and saved to
evidence/EV-04-record-loss-test.txt.

Run from the backend folder of the build you are testing (assessed build = baseline):

    cd D:/SliitProject/IWRA/EvidenceIQ-baseline/backend
    D:/SliitProject/IWRA/EvidenceIQ/backend/venv/Scripts/python.exe ../../EvidenceIQ/security-assessment/tc04_record_loss_test.py --live
"""
import argparse
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx

import _eutils  # retrying PubMed calls, next to this script

sys.path.insert(0, os.getcwd())
from app.schemas.retrieval import Paper, RetrievalResponse  # noqa: E402
from app.services.pubmed_service import parse_pubmed_xml  # noqa: E402

EVIDENCE = Path(__file__).resolve().parent / "evidence" / "EV-04-record-loss-test.txt"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
PLACEHOLDER = "Abstract not available."

lines = []


def out(text=""):
    print(text)
    lines.append(text)


def article(pmid, title, abstract):
    abstract_xml = f"<Abstract><AbstractText>{abstract}</AbstractText></Abstract>" if abstract else ""
    return (f"<PubmedArticle><MedlineCitation><PMID>{pmid}</PMID><Article>"
            f"<ArticleTitle>{title}</ArticleTitle>{abstract_xml}"
            f"</Article></MedlineCitation></PubmedArticle>")


RECORDS = [
    ("111", "Aerobic exercise and HbA1c in type 2 diabetes: an RCT", "Adults were randomised...", "complete record"),
    ("222", "Resistance training in older adults with diabetes", "", "no abstract"),
    ("333", "", "Abstract of a paper whose title field is empty.", "empty title"),
    ("111", "Aerobic exercise and HbA1c in type 2 diabetes: an RCT", "Adults were randomised...", "duplicate of 111"),
    ("", "A paper with no PMID", "Some abstract text.", "missing PMID"),
]


def part1():
    out("PART 1 - Five hand-made records through the real parser")
    out("-" * 78)
    xml = "<PubmedArticleSet>" + "".join(article(p, t, a) for p, t, a, _ in RECORDS) + "</PubmedArticleSet>"
    papers = parse_pubmed_xml(xml)
    kept = {p["pmid"]: p for p in papers}
    out(f"  records sent in : {len(RECORDS)}")
    out(f"  records returned: {len(papers)}")
    out()
    out(f"  {'PMID':6} {'case':18} result")
    seen, silent = set(), []
    for pmid, _, _, case in RECORDS:
        if pmid in kept and pmid not in seen:
            seen.add(pmid)
            out(f"  {pmid or '(none)':6} {case:18} KEPT     abstract = {kept[pmid]['abstract']!r}")
        else:
            out(f"  {pmid or '(none)':6} {case:18} DROPPED  (no warning, no counter)")
            if case != "duplicate of 111":
                silent.append(case)
    out()
    out(f"  a paper with NO abstract is kept, but its abstract becomes the text {PLACEHOLDER!r}")
    out("  - non-empty, so Agent 3 screens the placeholder as if it were the abstract")
    out()
    return silent


def part2():
    out("PART 2 - Can the API tell the researcher that records were dropped?")
    out("-" * 78)
    response_fields = sorted(RetrievalResponse.model_fields)
    paper_fields = sorted(Paper.model_fields)
    words = re.compile(r"drop|skip|incomplete|warning|missing|lost|excluded", re.I)
    reporting = [f for f in response_fields + paper_fields if words.search(f)]
    out(f"  RetrievalResponse fields: {response_fields}")
    out(f"  Paper fields            : {paper_fields}")
    out(f"  any field that reports dropped or incomplete records: {reporting or 'NONE'}")
    out()
    return not reporting


def part3():
    out("PART 3 - Real PubMed records through the same parser (live)")
    out("-" * 78)
    out(f"  {'query':44} {'fetched':>7} {'kept':>5} {'dropped':>7} {'no abstract':>12}")
    totals = [0, 0, 0]
    for query, n in (("DASH diet hypertension randomized controlled trial", 100),
                     ("type 2 diabetes", 200)):
        ids = _eutils.get(f"{EUTILS}/esearch.fcgi", timeout=30, params={
            "db": "pubmed", "term": query, "retmode": "json", "retmax": n, "sort": "relevance"}
        ).json()["esearchresult"]["idlist"]
        time.sleep(0.5)  # stay under NCBI's 3 requests/second
        xml = _eutils.post(f"{EUTILS}/efetch.fcgi", timeout=60, data={
            "db": "pubmed", "id": ",".join(ids), "retmode": "xml", "rettype": "abstract"}).text
        time.sleep(0.5)
        papers = parse_pubmed_xml(xml)
        no_abs = sum(1 for p in papers if p["abstract"] == PLACEHOLDER)
        dropped = len(ids) - len(papers)
        totals = [totals[0] + len(ids), totals[1] + dropped, totals[2] + no_abs]
        out(f"  {query[:44]:44} {len(ids):>7} {len(papers):>5} {dropped:>7} "
            f"{no_abs:>5} ({no_abs / max(len(papers), 1):.0%})")
    out()
    out(f"  overall: {totals[1]} of {totals[0]} real records dropped by the parser, "
        f"{totals[2]} kept with the placeholder abstract")
    out()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true", help="also measure real PubMed records")
    live = ap.parse_args().live

    out("TC-04  Silent record loss during XML parsing")
    out("=" * 78)
    out(f"captured: {datetime.now():%Y-%m-%d %H:%M:%S} (local time) | code: {Path.cwd()}")
    out()
    silent = part1()
    no_field = part2()
    if live:
        part3()
    else:
        out("(PART 3 skipped - re-run with --live to measure real PubMed records)")
        out()
    failed = bool(silent) and no_field
    out("RESULT: " + (f"FAIL - records dropped with no trace ({', '.join(silent)}), and the API "
                      "has no field to report it; abstract-less papers get placeholder text"
                      if failed else "PASS - dropped records are reported to the caller"))
    out("code: if not pmid or not title or pmid in seen_pmids: continue")
    EVIDENCE.parent.mkdir(exist_ok=True)
    EVIDENCE.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n(saved to {EVIDENCE})")


if __name__ == "__main__":
    main()
