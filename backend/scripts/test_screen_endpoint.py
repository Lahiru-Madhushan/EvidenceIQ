"""Quick real HTTP test of the /api/screen endpoint, bypassing real login.

Uses FastAPI's TestClient with the auth dependency overridden - a standard
testing pattern, not a security bypass in the real running app.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.core.security import get_current_user  # noqa: E402
from app.main import app  # noqa: E402

# Override auth just for this test script - pretend we're a logged-in user.
app.dependency_overrides[get_current_user] = lambda: {"sub": "test-user-123", "email": "test@example.com"}

client = TestClient(app)

payload = {
    "paper": {
        "pmid": "38221190",
        "title": (
            "Effects of a 12-week aerobic exercise program on glycemic control "
            "in adults with type 2 diabetes"
        ),
        "abstract": (
            "We enrolled 120 adults (age 45-65) with type 2 diabetes in a randomized "
            "controlled trial of 12 weeks of supervised aerobic exercise versus usual "
            "care. HbA1c decreased significantly in the exercise group (p<0.01)."
        ),
        "year": 2024,
        "journal": "Diabetes Care",
        "publication_types": ["Randomized Controlled Trial"],
    },
    "protocol": {
        "population": "adults (18+)",
        "condition": "type 2 diabetes only",
        "intervention": "aerobic exercise",
        "date_range": {"from": 2015, "to": 2026},
        "excludes": ["animal studies", "type 1 diabetes", "review articles"],
    },
}

response = client.post("/api/screen", json=payload)

print(f"Status code: {response.status_code}")
print(f"Response body: {response.json()}")