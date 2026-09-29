"""TC-04 - Silent record loss during XML parsing.

Feeds five hand-made PubMed records to the real parse_pubmed_xml() and shows which
ones survive. Run from the backend folder:

    cd D:/SliitProject/IWRA/EvidenceIQ/backend
    ./venv/Scripts/python.exe ../security-assessment/tc04_record_loss_test.py
"""
import os
import sys

sys.path.insert(0, os.getcwd())
from app.services.pubmed_service import parse_pubmed_xml  # noqa: E402


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

xml = "<PubmedArticleSet>" + "".join(article(p, t, a) for p, t, a, _ in RECORDS) + "</PubmedArticleSet>"
papers = parse_pubmed_xml(xml)
kept = {p["pmid"]: p for p in papers}

print("TC-04  Silent record loss during XML parsing")
print("=" * 72)
print(f"records sent in : {len(RECORDS)}")
print(f"records returned: {len(papers)}")
print()
print(f"{'PMID':6} {'case':18} result")
print("-" * 72)
seen = set()
for pmid, _, _, case in RECORDS:
    if pmid in kept and pmid not in seen:
        seen.add(pmid)
        print(f"{pmid or '(none)':6} {case:18} KEPT     abstract = {kept[pmid]['abstract']!r}")
    else:
        print(f"{pmid or '(none)':6} {case:18} DROPPED  (no warning, no counter)")
print()
print("response fields on a kept paper:", sorted(papers[0].keys()) if papers else [])
print("any field reporting dropped records? ",
      any(k in (papers[0] if papers else {}) for k in ("dropped", "warnings", "incomplete")))
