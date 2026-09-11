from typing import List, Optional

from pydantic import BaseModel, Field, model_validator


class RetrievalRequest(BaseModel):
    """
    Data received from the frontend.
    """

    query: str = Field(
        ...,
        min_length=3,
        max_length=500,
        description="Research topic or search query"
    )

    max_results: int = Field(
        default=20,
        ge=1,
        le=100,
        description="Maximum number of papers to retrieve"
    )

    page: int = Field(
        default=1,
        ge=1,
        description="Page number"
    )

    page_size: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Number of papers per page"
    )

    year_from: Optional[int] = Field(
        default=None,
        ge=1800,
        le=2100,
        description="Minimum publication year"
    )

    year_to: Optional[int] = Field(
        default=None,
        ge=1800,
        le=2100,
        description="Maximum publication year"
    )

    @model_validator(mode="after")
    def validate_year_range(self):
        if (
            self.year_from is not None
            and self.year_to is not None
            and self.year_from > self.year_to
        ):
            raise ValueError(
                "year_from must be less than or equal to year_to"
            )

        return self


class Paper(BaseModel):
    """
    Standard format for one research paper.
    """

    pmid: str = Field(
        ...,
        description="PubMed identifier"
    )

    title: str = Field(
        ...,
        min_length=1,
        description="Paper title"
    )

    authors: List[str] = Field(
        default_factory=list,
        description="List of authors"
    )

    journal: Optional[str] = None

    publication_year: Optional[int] = None

    abstract: str = Field(
        default="Abstract not available."
    )

    doi: Optional[str] = None


    # Ranking information
    rank: Optional[int] = Field(
        default=None,
        description="Ranking position of the paper"
    )

    relevance_score: Optional[float] = Field(
        default=None,
        ge=0,
        le=1,
        description="Relevance score between 0 and 1"
    )


    source: str = Field(
        default="PubMed"
    )

    source_url: str



class RetrievalResponse(BaseModel):
    """
    Response returned by the Retrieval Agent.
    """

    query: str

    total_found: int = Field(
        ge=0
    )

    returned_count: int = Field(
        ge=0
    )

    page: int = Field(
        ge=1,
        description="Current page number"
    )

    page_size: int = Field(
        ge=1,
        description="Number of papers per page"
    )

    papers: List[Paper] = Field(
        default_factory=list
    )

    message: Optional[str] = None