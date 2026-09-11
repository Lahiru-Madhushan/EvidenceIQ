import pytest
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.main import app
from app.services.pubmed_service import PubMedServiceError


client = TestClient(app)


def fake_authenticated_user():
    return {
        "sub": "test-user-id",
        "email": "test@example.com",
        "aud": "authenticated",
    }


@pytest.fixture
def authenticated_client():
    app.dependency_overrides[get_current_user] = (
        fake_authenticated_user
    )

    yield client

    app.dependency_overrides.clear()


def test_search_rejects_unauthenticated_request():
    response = client.post(
        "/api/retrieval/search",
        json={
            "query": "diabetes treatment",
            "page": 1,
            "page_size": 5,
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"


def test_search_rejects_invalid_request(
    authenticated_client,
):
    response = authenticated_client.post(
        "/api/retrieval/search",
        json={
            "query": "ab",
            "page": 0,
            "page_size": 51,
        },
    )

    assert response.status_code == 422


def test_authenticated_search_returns_papers(
    authenticated_client,
    monkeypatch,
):
    async def fake_retrieve_pubmed_papers(**kwargs):
        assert kwargs["query"] == "diabetes treatment"
        assert kwargs["page"] == 2
        assert kwargs["page_size"] == 5

        return 100, [
            {
                "pmid": "12345678",
                "title": "Diabetes Treatment Research",
                "authors": ["John Smith"],
                "journal": "Journal of Diabetes Research",
                "publication_year": 2024,
                "abstract": "A study about diabetes treatment.",
                "doi": "10.1000/example",
                "rank": 1,
                "relevance_score": 0.95,
                "source": "PubMed",
                "source_url": (
                    "https://pubmed.ncbi.nlm.nih.gov/12345678/"
                ),
            }
        ]

    monkeypatch.setattr(
        "app.routers.retrieval.retrieve_pubmed_papers",
        fake_retrieve_pubmed_papers,
    )

    response = authenticated_client.post(
        "/api/retrieval/search",
        json={
            "query": "diabetes treatment",
            "max_results": 5,
            "page": 2,
            "page_size": 5,
            "year_from": 2020,
            "year_to": 2026,
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["query"] == "diabetes treatment"
    assert data["total_found"] == 100
    assert data["returned_count"] == 1
    assert data["page"] == 2
    assert data["page_size"] == 5
    assert len(data["papers"]) == 1

    paper = data["papers"][0]

    assert paper["pmid"] == "12345678"
    assert paper["rank"] == 1
    assert paper["relevance_score"] == 0.95


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
        json={
            "query": "query with no results",
            "page": 1,
            "page_size": 5,
        },
    )

    assert response.status_code == 200

    data = response.json()

    assert data["total_found"] == 0
    assert data["returned_count"] == 0
    assert data["papers"] == []
    assert data["message"] == (
        "No papers were found for this query."
    )


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
        json={
            "query": "diabetes treatment",
            "page": 1,
            "page_size": 5,
        },
    )

    assert response.status_code == 502
    assert response.json()["detail"] == (
        "The paper service is temporarily unavailable. "
        "Please try again."
    )