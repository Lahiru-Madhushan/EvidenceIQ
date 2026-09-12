from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


class ReviewAccessError(Exception):
    """Raised when the user does not own the requested review."""


def save_retrieved_papers(
    db: Session,
    review_id: UUID,
    owner_id: str,
    papers: list[dict[str, Any]],
) -> int:
    """
    Verify review ownership and insert/update retrieved papers.

    Duplicate papers are prevented by the database constraint:
    UNIQUE (review_id, pmid)
    """

    review = db.execute(
        text(
            """
            SELECT id
            FROM reviews
            WHERE id = CAST(:review_id AS uuid)
              AND owner_id = CAST(:owner_id AS uuid)
            """
        ),
        {
            "review_id": str(review_id),
            "owner_id": owner_id,
        },
    ).first()

    if review is None:
        raise ReviewAccessError(
            "Review not found or you do not have access to it."
        )

    saved_count = 0

    for paper in papers:
        db.execute(
            text(
                """
                INSERT INTO papers (
                    review_id,
                    pmid,
                    title,
                    abstract,
                    journal,
                    year,
                    publication_types
                )
                VALUES (
                    CAST(:review_id AS uuid),
                    :pmid,
                    :title,
                    :abstract,
                    :journal,
                    :year,
                    :publication_types
                )
                ON CONFLICT (review_id, pmid)
                DO UPDATE SET
                    title = EXCLUDED.title,
                    abstract = EXCLUDED.abstract,
                    journal = EXCLUDED.journal,
                    year = EXCLUDED.year,
                    publication_types = EXCLUDED.publication_types,
                    retrieved_at = now()
                """
            ),
            {
                "review_id": str(review_id),
                "pmid": paper["pmid"],
                "title": paper.get("title"),
                "abstract": paper.get("abstract"),
                "journal": paper.get("journal"),
                "year": paper.get("publication_year"),
                "publication_types": paper.get(
                    "publication_types",
                    [],
                ),
            },
        )

        saved_count += 1

    db.commit()

    return saved_count