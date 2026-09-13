"""Real end-to-end test: Agent 1 -> Agent 2 -> Agent 3, using the actual
running server, a real database, and a REAL logged-in user's JWT token
(no dependency override - this is genuinely testing authentication too).

Requires the server to be running (uvicorn) in another terminal.

NOTE: the REAL_TOKEN below expires ~1 hour after it was issued (Supabase
access tokens are short-lived). If this script starts failing with 401
Unauthorized, log into the frontend again and copy a fresh token from
localStorage - see the steps you followed the first time.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

# Paste a fresh token here whenever the old one expires.
REAL_TOKEN = (
    "eyJhbGciOiJFUzI1NiIsImtpZCI6IjE4ZGU5YzkzLWNiY2QtNDk3Zi05NzgyLTVjNDI3Nj"
    "cyNDRhZiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL3Rrc2piemFoYXhzeW1uY2"
    "5oam51LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiJiMDU3ZTQ2Mi04NjBhLTRkMmU"
    "tOGU4Ny04MDg1Njc5ZWJjZTUiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzg5"
    "MjM4NjA2LCJpYXQiOjE3ODkyMzUwMDYsImVtYWlsIjoiaGlydW5pMTkyOTRAZ21haWwuY"
    "29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsIn"
    "Byb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6eyJlbWFpbCI6ImhpcnV"
    "uaTE5Mjk0QGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJmdWxsX25hbWUi"
    "OiJIaXJ1bmkgS3VtYXJhc2lyaSIsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiY"
    "jA1N2U0NjItODYwYS00ZDJlLThlODctODA4NTY3OWViY2U1In0sInJvbGUiOiJhdXRoZW"
    "50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoib3RwIiwidGltZXN"
    "0YW1wIjoxNzg5MjM1MDA2fV0sInNlc3Npb25faWQiOiI1ZWFhNjVhNy0xOTkyLTQ5M2Qt"
    "YmMzYi03OGY0NjM5ZDU3OTMiLCJpc19hbm9ueW1vdXMiOmZhbHNlfQ.9yk3jLnX0kas5-"
    "BeY62nLjiQqIP4WN1BlD7hIYxIRiRftBHj1emKXp7YzMQdFgBDFWNM3SumIj_8C_EkNwH"
    "UUA"
)

client = TestClient(app)
HEADERS = {"Authorization": f"Bearer {REAL_TOKEN}"}

print("=" * 70)
print("STEP 1: Agent 1 - Criteria Agent creates a review + protocol")
print("=" * 70)

criteria_response = client.post(
    "/api/criteria/submit",
    json={
        "research_question": "Does aerobic exercise improve glucose control in adults with type 2 diabetes?",
        "raw_criteria": (
            "Adults 18+, must have type 2 diabetes specifically, aerobic exercise "
            "as the intervention, published between 2015 and 2026. Exclude animal "
            "studies, type 1 diabetes, and review articles."
        ),
    },
    headers=HEADERS,
)
print(f"Status: {criteria_response.status_code}")
result = criteria_response.json()
print(result)

if criteria_response.status_code != 200 or result.get("status") == "clarification_needed":
    print("\nStopped: Agent 1 needs clarification or failed. Cannot continue chain.")
    sys.exit(1)

review_id = result["review_id"]
print(f"\nreview_id: {review_id}")

print("\n" + "=" * 70)
print("STEP 2: Agent 2 - Retrieval Agent searches PubMed and saves papers")
print("=" * 70)

retrieval_response = client.post(
    "/api/retrieval/search",
    json={
        "review_id": review_id,
        "query": "aerobic exercise type 2 diabetes glycemic control",
        "max_results": 5,
        "page": 1,
        "page_size": 5,
    },
    headers=HEADERS,
)
print(f"Status: {retrieval_response.status_code}")
retrieval_result = retrieval_response.json()
print(f"saved_count: {retrieval_result.get('saved_count')}")
print(f"total_found: {retrieval_result.get('total_found')}")

if retrieval_response.status_code != 200 or not retrieval_result.get("papers"):
    print("\nStopped: Agent 2 found no papers or failed. Cannot continue chain.")
    print(retrieval_result)
    sys.exit(1)

first_paper = retrieval_result["papers"][0]
print(f"\nFirst paper: {first_paper.get('title')}")

# We need the paper's real database ID, not just its pmid - fetch it directly.
from app.core.database import SessionLocal  # noqa: E402
from app.models.paper import Paper  # noqa: E402

db = SessionLocal()
paper_row = (
    db.query(Paper)
    .filter(Paper.review_id == review_id, Paper.pmid == first_paper["pmid"])
    .first()
)
db.close()

if paper_row is None:
    print("\nStopped: could not find the saved paper row in the database.")
    sys.exit(1)

paper_id = str(paper_row.id)
print(f"paper_id: {paper_id}")

print("\n" + "=" * 70)
print("STEP 3: Agent 3 - Screening Agent screens the real retrieved paper")
print("=" * 70)

screen_response = client.post(f"/api/screen/by-id/{paper_id}", headers=HEADERS)
print(f"Status: {screen_response.status_code}")
print(screen_response.json())

print("\n" + "=" * 70)
print("CHAIN COMPLETE" if screen_response.status_code == 200 else "CHAIN FAILED AT STEP 3")
print("=" * 70)
