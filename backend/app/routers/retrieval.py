from fastapi import APIRouter, Depends, HTTPException, status

from app.core.security import get_current_user
from app.schemas.retrieval import (
    RetrievalRequest,
    RetrievalResponse,
)
from app.services.pubmed_service import (
    PubMedServiceError,
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
) -> RetrievalResponse:

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
            query=request.query,
            total_found=total_found,
            returned_count=0,
            page=request.page,
            page_size=request.page_size,
            papers=[],
            message="No papers were found for this query.",
        )

    return RetrievalResponse(
        query=request.query,
        total_found=total_found,
        returned_count=len(papers),
        page=request.page,
        page_size=request.page_size,
        papers=papers,
        message="Papers retrieved successfully from PubMed.",
    )