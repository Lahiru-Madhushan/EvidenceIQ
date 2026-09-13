"""One-time script to insert a test review + paper directly into the database,
so we can test Agent 3's /screen/by-id endpoint before Agents 1 and 2 exist.

Run once: python scripts/seed_test_data.py
Prints the review_id and paper_id you'll need for testing.
"""

from __future__ import annotations

import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal  # noqa: E402
from app.models.review import Review  # noqa: E402
from app.models.paper import Paper  # noqa: E402
from datetime import datetime, timezone

db = SessionLocal()

# A fake owner_id - in real use this would be a real Supabase auth.users id.
# We'll print it so you can also fake being that user in your auth override.
test_owner_id = uuid.UUID("ac19f277-ef3c-4dc8-9ac1-373585754642")

now = datetime.now(timezone.utc)

review = Review(
    id=uuid.uuid4(),
    owner_id=test_owner_id,
    research_question="Does aerobic exercise improve glucose control in adults with type 2 diabetes?",
    created_at=now,
    updated_at=now,
    protocol={
        "population": "adults (18+)",
        "condition": "type 2 diabetes only",
        "intervention": "aerobic exercise",
        "date_range": {"from": 2015, "to": 2026},
        "excludes": ["animal studies", "type 1 diabetes", "review articles"],
    },
    status="screening",
)
db.add(review)
db.flush()  # get review.id populated before using it below

paper = Paper(
    id=uuid.uuid4(),
    review_id=review.id,
    pmid="38221190",
    retrieved_at=now,
    needs_human_review=False,
    title=(
        "Effects of a 12-week aerobic exercise program on glycemic control in "
        "adults with type 2 diabetes"
    ),
    abstract=(
        "We enrolled 120 adults (age 45-65) with type 2 diabetes in a randomized "
        "controlled trial of 12 weeks of supervised aerobic exercise versus usual "
        "care. HbA1c decreased significantly in the exercise group (p<0.01)."
    ),
    journal="Diabetes Care",
    year=2024,
    publication_types=["Randomized Controlled Trial"],
)
db.add(paper)
db.commit()

print("Test data inserted successfully.")
print(f"owner_id (fake user): {test_owner_id}")
print(f"review_id: {review.id}")
print(f"paper_id: {paper.id}")

db.close()