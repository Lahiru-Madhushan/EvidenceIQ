from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.review import Review
from app.schemas.retrieval import (
    RetrievalRequest,
    RetrievalResponse,
)
from app.services.paper_database_service import (
    ReviewAccessError,
    save_retrieved_papers,
)
from app.services.pubmed_service import (
    InvalidQueryError,
    PubMedServiceError,
    build_pubmed_query,
    neutralise_query,
    retrieve_pubmed_papers,
)


router = APIRouter(
    prefix="/api/retrieval",
    tags=["Retrieval"],
)


@router.post(
    "/search",
    response_model=RetrievalResponse,
)
async def search_papers(
    request: RetrievalRequest,
    user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RetrievalResponse:
    """
    Retrieve papers from PubMed and save them
    to the selected review in the database.
    """

    user_id = user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authenticated user ID is missing.",
        )

    # Ownership first. Checked after the search, a review id that is not the caller's
    # still cost a PubMed round trip against the shared NCBI allowance before being
    # refused. Same answer for "not yours" as for "not found".
    review = db.get(Review, request.review_id)
    if review is None or str(review.owner_id) != str(user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review not found or you do not have access to it.",
        )

    try:
        _, query_warnings = neutralise_query(request.query)
        executed_query = build_pubmed_query(
            query=request.query,
            year_from=request.year_from,
            year_to=request.year_to,
        )
    except InvalidQueryError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error

    # The page size actually used: it is capped at max_results, and the response used to
    # echo the requested value even when a different one had been applied.
    effective_page_size = min(request.page_size, request.max_results)

    try:
        total_found, papers = await retrieve_pubmed_papers(
            query=request.query,
            max_results=request.max_results,
            year_from=request.year_from,
            year_to=request.year_to,
            page=request.page,
            page_size=request.page_size,
        )

    except PubMedServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "The paper service is temporarily unavailable. "
                "Please try again."
            ),
        ) from error

    if not papers:
        return RetrievalResponse(
            review_id=request.review_id,
            query=request.query,
            saved_count=0,
            total_found=total_found,
            returned_count=0,
            page=request.page,
            page_size=effective_page_size,
            papers=[],
            message="No papers were found for this query.",
            executed_query=executed_query,
            query_warnings=query_warnings,
        )

    try:
        saved_count = save_retrieved_papers(
            db=db,
            review_id=request.review_id,
            owner_id=user_id,
            papers=papers,
        )

    except ReviewAccessError as error:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error

    except SQLAlchemyError as error:
        db.rollback()

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Papers were retrieved, but they could not "
                "be saved to the database."
            ),
        ) from error

    return RetrievalResponse(
        review_id=request.review_id,
        query=request.query,
        saved_count=saved_count,
        total_found=total_found,
        returned_count=len(papers),
        page=request.page,
        page_size=effective_page_size,
        papers=papers,
        message=(
            "Papers retrieved successfully from PubMed "
            "and saved to the database."
        ),
        executed_query=executed_query,
        query_warnings=query_warnings,
    )