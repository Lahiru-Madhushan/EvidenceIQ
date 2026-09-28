"""Viewing the uploaded document beside the chat.

The endpoint serves a stored upload back to the browser, so what matters is who can
fetch it and what type it is served as: only the owner, and never a type the uploader
chose, so a file cannot be made to render as a page.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.security import get_current_user
from app.main import app
from app.models.chat import ChatSession

OWNER = "22222222-2222-2222-2222-222222222222"
STRANGER = "33333333-3333-3333-3333-333333333333"


class FakeSession:
    def __init__(self, rows: dict):
        self._rows = rows
        self.commits = 0

    def get(self, model, key):
        return self._rows.get((model, str(key)))

    def commit(self):
        self.commits += 1


def _pdf(pages: int) -> bytes:
    from io import BytesIO

    from pypdf import PdfWriter

    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=200)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def _chat(**overrides) -> ChatSession:
    now = datetime.now(timezone.utc)
    values = dict(
        id=uuid.uuid4(),
        owner_id=uuid.UUID(OWNER),
        title="trial",
        document_name="trial report.pdf",
        document_text="Extracted text of the trial.",
        document_chars=28,
        document_pages=3,
        document_file=b"%PDF-1.4 original bytes",
        document_mime="application/pdf",
        created_at=now,
        updated_at=now,
    )
    values.update(overrides)
    return ChatSession(**values)


@pytest.fixture
def client_for():
    def build(row: ChatSession, user: str = OWNER) -> TestClient:
        db = FakeSession({(ChatSession, str(row.id)): row})
        app.dependency_overrides[get_current_user] = lambda: {"sub": user}
        app.dependency_overrides[get_db] = lambda: db
        return TestClient(app)

    yield build
    app.dependency_overrides.clear()


def test_the_original_pdf_is_served_inline(client_for):
    row = _chat()
    response = client_for(row).get(f"/api/quick-chat/sessions/{row.id}/document")

    assert response.status_code == 200
    assert response.content == b"%PDF-1.4 original bytes"
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"].startswith("inline;")
    assert response.headers["x-content-type-options"] == "nosniff"


def test_an_older_chat_falls_back_to_the_extracted_text(client_for):
    row = _chat(document_file=None, document_mime=None)
    response = client_for(row).get(f"/api/quick-chat/sessions/{row.id}/document")

    assert response.status_code == 200
    assert response.text == "Extracted text of the trial."
    assert response.headers["content-type"].startswith("text/plain")


def test_a_text_upload_is_served_as_plain_text(client_for):
    row = _chat(
        document_name="notes.html",
        document_pages=None,
        document_file=b"<script>alert(1)</script>",
        document_mime="text/plain",
        document_text="<script>alert(1)</script>",
    )
    response = client_for(row).get(f"/api/quick-chat/sessions/{row.id}/document")

    assert response.headers["content-type"].startswith("text/plain")


def _attach(client, row, data: bytes):
    return client.put(
        f"/api/quick-chat/sessions/{row.id}/document",
        files={"file": ("trial.pdf", data, "application/pdf")},
    )


def test_an_older_chat_can_get_its_original_pdf_back(client_for):
    row = _chat(document_file=None, document_mime=None, document_pages=3)
    client = client_for(row)

    response = _attach(client, row, _pdf(3))

    assert response.status_code == 200
    assert response.json()["has_original"] is True
    shown = client.get(f"/api/quick-chat/sessions/{row.id}/document")
    assert shown.headers["content-type"] == "application/pdf"


def test_a_different_pdf_is_not_attached(client_for):
    """Answers were quoted from the original; pairing them with another paper misleads."""
    row = _chat(document_file=None, document_mime=None, document_pages=3)
    response = _attach(client_for(row), row, _pdf(5))

    assert response.status_code == 422
    assert row.document_file is None


def test_only_a_pdf_can_be_attached(client_for):
    row = _chat(document_file=None, document_mime=None)
    response = _attach(client_for(row), row, b"<html>not a pdf</html>")

    assert response.status_code == 422


def test_someone_else_cannot_fetch_the_document(client_for):
    row = _chat()
    response = client_for(row, user=STRANGER).get(
        f"/api/quick-chat/sessions/{row.id}/document"
    )

    assert response.status_code == 404
