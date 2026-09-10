"""Real HTTP test of the /api/screen/by-id/{paper_id} endpoint, against real
database rows inserted by seed_test_data.py.

Bypasses real login using FastAPI's TestClient dependency override - a standard
testing pattern, not a security bypass in the real running app.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.core.security import get_current_user  # noqa: E402
from app.main import app  # noqa: E402

# Must match the owner_id used in seed_test_data.py, or the ownership check fails.
FAKE_OWNER_ID = "ac19f277-ef3c-4dc8-9ac1-373585754642"

# PASTE the paper_id printed by seed_test_data.py here:
PAPER_ID = "e9631c63-fc45-4b6e-9cdd-784ac7a448b6"

app.dependency_overrides[get_current_user] = lambda: {"sub": FAKE_OWNER_ID, "email": "test@example.com"}

client = TestClient(app)

response = client.post(f"/api/screen/by-id/{PAPER_ID}")

print(f"Status code: {response.status_code}")
print(f"Response body: {response.json()}")