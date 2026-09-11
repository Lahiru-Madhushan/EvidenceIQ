from datetime import datetime

from app.services.ranking_service import (
    calculate_relevance_score,
    rank_papers,
)


def test_exact_query_match_receives_high_score():
    paper = {
        "title": "Diabetes Treatment",
        "abstract": "This paper discusses diabetes treatment.",
        "publication_year": datetime.now().year,
    }

    score = calculate_relevance_score(
        "diabetes treatment",
        paper,
    )

    assert score == 1.0


def test_irrelevant_paper_receives_zero_score():
    paper = {
        "title": "Marine Biology Research",
        "abstract": "This study investigates coral reefs.",
        "publication_year": 2000,
    }

    score = calculate_relevance_score(
        "diabetes treatment",
        paper,
    )

    assert score == 0.0


def test_relevance_score_stays_between_zero_and_one():
    paper = {
        "title": "Diabetes Treatment Diabetes Treatment",
        "abstract": "Diabetes treatment and diabetes treatment.",
        "publication_year": datetime.now().year,
    }

    score = calculate_relevance_score(
        "diabetes treatment",
        paper,
    )

    assert 0.0 <= score <= 1.0


def test_rank_papers_sorts_highest_score_first():
    papers = [
        {
            "pmid": "1",
            "title": "Marine Biology Research",
            "abstract": "This study investigates coral reefs.",
            "publication_year": 2000,
        },
        {
            "pmid": "2",
            "title": "Diabetes Treatment",
            "abstract": "Research about diabetes treatment.",
            "publication_year": datetime.now().year,
        },
        {
            "pmid": "3",
            "title": "Diabetes Research",
            "abstract": "Research involving diabetes.",
            "publication_year": 2000,
        },
    ]

    ranked_papers = rank_papers(
        "diabetes treatment",
        papers,
    )

    assert ranked_papers[0]["pmid"] == "2"
    assert ranked_papers[0]["rank"] == 1

    assert ranked_papers[1]["pmid"] == "3"
    assert ranked_papers[1]["rank"] == 2

    assert ranked_papers[2]["pmid"] == "1"
    assert ranked_papers[2]["rank"] == 3

    assert (
        ranked_papers[0]["relevance_score"]
        >= ranked_papers[1]["relevance_score"]
        >= ranked_papers[2]["relevance_score"]
    )


def test_rank_papers_handles_empty_list():
    ranked_papers = rank_papers(
        "diabetes treatment",
        [],
    )

    assert ranked_papers == []