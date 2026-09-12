import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from app.core.database import get_db
from app.core.security import get_current_user
from app.main import app
from app.services.paper_database_service import (
    ReviewAccessError,
)
from app.services.pubmed_service import PubMedServiceError


TEST_REVIEW_ID = (
    "11111111-1111-1111-1111-111111111111"
)


class FakeDatabase:
    def __init__(self):
        self.rollback_called = False

    def rollback(self):
        self.rollback_called = True


fake_database = FakeDatabase()
client = TestClient(app)


def fake_authenticated_user():
    return {
        "sub": "22222222-2222-2222-2222-222222222222",
        "email": "test@example.com",
        "aud": "authenticated",
    }


def fake_get_db():
    yield fake_database


@pytest.fixture
def authenticated_client():
    fake_database.rollback_called = False

    app.dependency_overrides[get_current_user] = (
        fake_authenticated_user
    )

    app.dependency_overrides[get_db] = fake_get_db

    yield client

    app.dependency_overrides.clear()


def valid_request():
    return {
        "review_id": TEST_REVIEW_ID,
        "query": "diabetes treatment",
        "max_results": 5,
        "page": 1,
        "page_size": 5,
    }


def sample_paper():
    return {
        "pmid": "12345678",
        "title": "Diabetes Treatment Research",
        "authors": ["John Smith"],
        "journal": "Journal of Diabetes Research",
        "publication_year": 2024,
        "publication_types": ["Journal Article"],
        "abstract": "A study about diabetes treatment.",
        "doi": "10.1000/example",
        "rank": 1,
        "relevance_score": 0.95,
        "source": "PubMed",
        "source_url": (
            "https://pubmed.ncbi.nlm.nih.gov/12345678/"
        ),
    }


def test_search_rejects_unauthenticated_request():
    response = client.post(
        "/api/retrieval/search",
        json=valid_request(),
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_search_rejects_invalid_request(
    authenticated_client,
):
    request_data = valid_request()
    request_data["query"] = "ab"
    request_data["page"] = 0
    request_data["page_size"] = 51

    response = authenticated_client.post(
        "/api/retrieval/search",
        json=request_data,
    )

    assert response.status_code == 422


def test_authenticated_search_saves_and_returns_papers(
    authenticated_client,
    monkeypatch,
):
    async def fake_retrieve_pubmed_papers(**kwargs):
        assert kwargs["query"] == "diabetes treatment"
        assert kwargs["page"] == 2
        assert kwargs["page_size"] == 5

        return 100, [sample_paper()]

    def fake_save_retrieved_papers(
        db,
        review_id,
        owner_id,
        papers,
    ):
        assert db is fake_database
        assert str(review_id) == TEST_REVIEW_ID
        assert owner_id == (
            "22222222-2222-2222-2222-222222222222"
        )
        assert len(papers) == 1

        return 1

    monkeypatch.setattr(
        "app.routers.retrieval.retrieve_pubmed_papers",
        fake_retrieve_pubmed_papers,
    )

    monkeypatch.setattr(
        "app.routers.retrieval.save_retrieved_papers",
        fake_save_retrieved_papers,
    )

    request_data = valid_request()
    request_data["page"] = 2

    response = authenticated_client.post(
        "/api/retrieval/search",
        json=request_data,
    )

    assert response.status_code == 200

    data = response.json()

    assert data["review_id"] == TEST_REVIEW_ID
    assert data["query"] == "diabetes treatment"
    assert data["saved_count"] == 1
    assert data["total_found"] == 100
    assert data["returned_count"] == 1
    assert data["page"] == 2
    assert data["page_size"] == 5
    assert len(data["papers"]) == 1
    assert data["papers"][0]["pmid"] == "12345678"


def test_authenticated_search_handles_no_results(
    authenticated_client,
    monkeypatch,
):
    async def fake_empty_retrieval(**kwargs):
        return 0, []

    monkeypatch.setattr(
        "app.routers.retrieval.retrieve_pubmed_papers",
        fake_empty_retrieval,
    )

    response = authenticated_client.post(
        "/api/retrieval/search",
        json=valid_request(),
    )

    assert response.status_code == 200

    data = response.json()

    assert data["review_id"] == TEST_REVIEW_ID
    assert data["saved_count"] == 0
    assert data["total_found"] == 0
    assert data["returned_count"] == 0
    assert data["papers"] == []


def test_search_rejects_inaccessible_review(
    authenticated_client,
    monkeypatch,
):
    async def fake_retrieval(**kwargs):
        return 1, [sample_paper()]

    def fake_save(**kwargs):
        raise ReviewAccessError(
            "Review not found or you do not have access to it."
        )

    monkeypatch.setattr(
        "app.routers.retrieval.retrieve_pubmed_papers",
        fake_retrieval,
    )

    monkeypatch.setattr(
        "app.routers.retrieval.save_retrieved_papers",
        fake_save,
    )

    response = authenticated_client.post(
        "/api/retrieval/search",
        json=valid_request(),
    )

    assert response.status_code == 404
    assert response.json()["detail"] == (
        "Review not found or you do not have access to it."
    )
    assert fake_database.rollback_called is True


def test_search_handles_database_failure(
    authenticated_client,
    monkeypatch,
):
    async def fake_retrieval(**kwargs):
        return 1, [sample_paper()]

    def fake_save(**kwargs):
        raise SQLAlchemyError(
            "Simulated database failure"
        )

    monkeypatch.setattr(
        "app.routers.retrieval.retrieve_pubmed_papers",
        fake_retrieval,
    )

    monkeypatch.setattr(
        "app.routers.retrieval.save_retrieved_papers",
        fake_save,
    )

    response = authenticated_client.post(
        "/api/retrieval/search",
        json=valid_request(),
    )

    assert response.status_code == 500
    assert fake_database.rollback_called is True


def test_search_handles_pubmed_service_failure(
    authenticated_client,
    monkeypatch,
):
    async def fake_failed_retrieval(**kwargs):
        raise PubMedServiceError(
            "Simulated PubMed failure"
        )

    monkeypatch.setattr(
        "app.routers.retrieval.retrieve_pubmed_papers",
        fake_failed_retrieval,
    )

    response = authenticated_client.post(
        "/api/retrieval/search",
        json=valid_request(),
    )

    assert response.status_code == 502
    assert response.json()["detail"] == (
        "The paper service is temporarily unavailable. "
        "Please try again."
    )