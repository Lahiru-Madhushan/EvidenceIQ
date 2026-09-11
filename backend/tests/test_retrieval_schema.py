import pytest
from pydantic import ValidationError

from app.schemas.retrieval import RetrievalRequest


def test_valid_retrieval_request():
    request = RetrievalRequest(
        query="type 2 diabetes treatment",
        max_results=10,
        page=1,
        page_size=5,
        year_from=2020,
        year_to=2026,
    )

    assert request.query == "type 2 diabetes treatment"
    assert request.max_results == 10
    assert request.page == 1
    assert request.page_size == 5
    assert request.year_from == 2020
    assert request.year_to == 2026


def test_query_must_have_at_least_three_characters():
    with pytest.raises(ValidationError):
        RetrievalRequest(query="ab")


def test_query_cannot_exceed_500_characters():
    with pytest.raises(ValidationError):
        RetrievalRequest(query="a" * 501)


def test_page_must_be_at_least_one():
    with pytest.raises(ValidationError):
        RetrievalRequest(
            query="diabetes treatment",
            page=0,
        )


def test_page_size_cannot_exceed_50():
    with pytest.raises(ValidationError):
        RetrievalRequest(
            query="diabetes treatment",
            page_size=51,
        )


def test_page_size_must_be_at_least_one():
    with pytest.raises(ValidationError):
        RetrievalRequest(
            query="diabetes treatment",
            page_size=0,
        )


def test_start_year_cannot_be_greater_than_end_year():
    with pytest.raises(
        ValidationError,
        match="year_from must be less than or equal to year_to",
    ):
        RetrievalRequest(
            query="diabetes treatment",
            year_from=2026,
            year_to=2020,
        )


def test_default_pagination_values():
    request = RetrievalRequest(
        query="diabetes treatment",
    )

    assert request.page == 1
    assert request.page_size == 10
    assert request.max_results == 20