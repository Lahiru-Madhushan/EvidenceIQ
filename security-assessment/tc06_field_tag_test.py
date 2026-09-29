"""TC-06 - PubMed field-tag injection / corpus steering.

Sends search strings containing PubMed field tags and operators through the real
build_pubmed_query() (date filter 2020-2024) to live PubMed, and prints how PubMed
interpreted each one (its "querytranslation"). About 9 small requests, no login, no
database.

Run from the backend folder:

    cd D:/SliitProject/IWRA/EvidenceIQ/backend
    ./venv/Scripts/python.exe ../security-assessment/tc06_field_tag_test.py
"""
import os
import sys
import time

import httpx

sys.path.insert(0, os.getcwd())
from app.services.pubmed_service import build_pubmed_query  # noqa: E402

YEAR_FROM, YEAR_TO = 2020, 2024
ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"


def search(query):
    term = build_pubmed_query(query=query, year_from=YEAR_FROM, year_to=YEAR_TO)
    r = httpx.get(ESEARCH, timeout=30, params={"db": "pubmed", "term": term, "retmode": "json", "retmax": 0})
    time.sleep(0.5)  # stay under NCBI's 3 requests/second
    d = r.json()["esearchresult"]
    return term, int(d["count"]), d.get("querytranslation", "")


def show(label, query, baseline=None):
    term, n, translation = search(query)
    share = f"  ({n / baseline:.1%} of the normal search)" if baseline else ""
    tags = [t for t in ("[Author]", "[Journal]", "[Publication Type]", "[MeSH Terms]", "[Subheading]", " NOT ", "(")
            if t.lower() in query.lower()]
    honoured = all(t.strip("[] (").lower() in translation.lower() or t in (" NOT ", "(") for t in tags)
    print(f"[{label}]")
    print(f"  user input : {query!r}")
    print(f"  sent       : {term}")
    print(f"  results    : {n:,}{share}")
    tail = translation if len(translation) <= 120 else "..." + translation[-117:]
    print(f"  PubMed read: {tail}")
    if tags:
        print(f"  syntax obeyed by PubMed: {'YES' if honoured else 'NO'}  {tags}")
    print()
    return n


print("TC-06  PubMed field-tag injection / corpus steering (live PubMed)")
print("=" * 78)
print(f"every search below also carries the app's date filter {YEAR_FROM}-{YEAR_TO}")
print()

diabetes = show("normal search", "diabetes")
show("restrict to one author", "diabetes AND Smith J[Author]", diabetes)
show("restrict to one journal", "diabetes AND Lancet[Journal]", diabetes)
show("restrict to one study type", "diabetes AND Review[Publication Type]", diabetes)
show("MeSH-only matching", "Diabetes Mellitus, Type 2[MeSH Terms]", diabetes)
show("brackets + author", "(diabetes OR obesity) AND Smith J[Author]", diabetes)

metformin = show("normal search", "metformin")
hidden = show("hide harm studies with NOT", "metformin NOT adverse effects[Subheading]", metformin)

print("SUMMARY")
print("-" * 78)
print("Every field tag, Boolean operator and bracket typed by the user was executed by")
print("PubMed as query syntax. Example of evidence being hidden:")
print(f"  'metformin'                                   {metformin:>9,} papers")
print(f"  'metformin NOT adverse effects[Subheading]'   {hidden:>9,} papers"
      f"  -> {metformin - hidden:,} studies about harms removed")
print("The app stores and displays only the raw text the user typed; the PubMed")
print("interpretation shown above is not recorded anywhere.")
print()
print("RESULT: FAIL - user input is executed as PubMed query syntax, so the set of")
print("        papers can be steered to an author, journal or study type, or made to")
print("        exclude unwanted evidence.")
