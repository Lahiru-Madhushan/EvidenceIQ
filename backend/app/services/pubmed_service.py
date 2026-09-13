import re
import xml.etree.ElementTree as ET
from typing import Optional

import httpx

from app.services.ranking_service import rank_papers


ESEARCH_URL = (
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
)

EFETCH_URL = (
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
)


class PubMedServiceError(Exception):
    """Raised when PubMed cannot return usable results."""


def element_text(element: Optional[ET.Element]) -> str:
    """
    Extract all text from an XML element.
    """

    if element is None:
        return ""

    return " ".join(
        "".join(element.itertext()).split()
    )


def build_pubmed_query(
    query: str,
    year_from: Optional[int],
    year_to: Optional[int],
) -> str:
    """
    Add optional publication-year filtering.
    """

    cleaned_query = query.strip()

    if year_from is not None or year_to is not None:
        start_year = (
            year_from
            if year_from is not None
            else 1800
        )

        end_year = (
            year_to
            if year_to is not None
            else 2100
        )

        cleaned_query += (
            f" AND {start_year}:{end_year}[Date - Publication]"
        )

    return cleaned_query


def extract_publication_year(
    article: ET.Element,
) -> Optional[int]:
    """
    Extract publication year.
    """

    possible_values = [
        article.findtext(".//ArticleDate/Year"),
        article.findtext(".//JournalIssue/PubDate/Year"),
        article.findtext(".//JournalIssue/PubDate/MedlineDate"),
    ]

    for value in possible_values:
        if value:
            match = re.search(
                r"\b(18|19|20|21)\d{2}\b",
                value,
            )

            if match:
                return int(match.group())

    return None


def extract_publication_types(
    article: ET.Element,
) -> list[str]:
    """
    Extract PubMed publication types.

    Examples:
    - Journal Article
    - Review
    - Clinical Trial
    - Meta-Analysis
    """

    publication_types = []

    for publication_type in article.findall(
        ".//PublicationTypeList/PublicationType"
    ):
        value = element_text(publication_type)

        if value and value not in publication_types:
            publication_types.append(value)

    return publication_types


def extract_authors(
    article: ET.Element,
) -> list[str]:
    """
    Extract author names.
    """

    authors = []

    for author in article.findall(
        ".//AuthorList/Author"
    ):
        collective_name = author.findtext(
            "CollectiveName"
        )

        if collective_name:
            authors.append(
                collective_name.strip()
            )
            continue

        last_name = (
            author.findtext("LastName")
            or ""
        ).strip()

        fore_name = (
            author.findtext("ForeName")
            or ""
        ).strip()

        initials = (
            author.findtext("Initials")
            or ""
        ).strip()

        first_part = fore_name or initials

        full_name = " ".join(
            part
            for part in [
                first_part,
                last_name,
            ]
            if part
        )

        if full_name:
            authors.append(full_name)

    return authors


def extract_abstract(
    article: ET.Element,
) -> str:
    """
    Extract abstract sections.
    """

    sections = []

    for abstract_element in article.findall(
        ".//Abstract/AbstractText"
    ):
        content = element_text(
            abstract_element
        )

        label = abstract_element.attrib.get(
            "Label"
        )

        if content:
            if label:
                sections.append(
                    f"{label}: {content}"
                )
            else:
                sections.append(content)

    if not sections:
        return "Abstract not available."

    return " ".join(sections)


def extract_doi(
    article: ET.Element,
) -> Optional[str]:
    """
    Extract DOI.
    """

    for article_id in article.findall(
        ".//ArticleId"
    ):
        if article_id.attrib.get(
            "IdType"
        ) == "doi":
            doi = element_text(article_id)

            if doi:
                return doi

    for location_id in article.findall(
        ".//ELocationID"
    ):
        if location_id.attrib.get(
            "EIdType"
        ) == "doi":
            doi = element_text(location_id)

            if doi:
                return doi

    return None


def parse_pubmed_xml(
    xml_content: str,
) -> list[dict]:
    """
    Convert PubMed XML into paper dictionaries.
    """

    try:
        root = ET.fromstring(xml_content)

    except ET.ParseError as error:
        raise PubMedServiceError(
            "PubMed returned invalid XML data."
        ) from error

    papers = []
    seen_pmids = set()

    for article in root.findall(
        ".//PubmedArticle"
    ):
        pmid = (
            article.findtext(
                ".//MedlineCitation/PMID"
            )
            or ""
        ).strip()

        title = element_text(
            article.find(
                ".//Article/ArticleTitle"
            )
        )

        if (
            not pmid
            or not title
            or pmid in seen_pmids
        ):
            continue

        seen_pmids.add(pmid)

        journal = element_text(
            article.find(
                ".//Article/Journal/Title"
            )
        )

        papers.append(
            {
                "pmid": pmid,
                "title": title,
                "authors": extract_authors(article),
                "journal": journal or None,
                "publication_year":
                    extract_publication_year(article),
                "publication_types":
                    extract_publication_types(article),
                "abstract": extract_abstract(article),
                "doi": extract_doi(article),
                "source": "PubMed",
                "source_url": (
                    "https://pubmed.ncbi.nlm.nih.gov/"
                    f"{pmid}/"
                ),
            }
        )

    return papers


async def retrieve_pubmed_papers(
    query: str,
    max_results: int,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
    page: int = 1,
    page_size: int = 10,
) -> tuple[int, list[dict]]:
    """
    Search PubMed, paginate results,
    extract metadata and rank papers.
    """

    pubmed_query = build_pubmed_query(
        query=query,
        year_from=year_from,
        year_to=year_to,
    )

    effective_page_size = min(
        page_size,
        max_results,
    )

    timeout = httpx.Timeout(30.0)

    try:
        async with httpx.AsyncClient(
            timeout=timeout,
        ) as client:
            search_response = await client.get(
                ESEARCH_URL,
                params={
                    "db": "pubmed",
                    "term": pubmed_query,
                    "retstart": (
                        page - 1
                    ) * effective_page_size,
                    "retmax": effective_page_size,
                    "retmode": "json",
                    "sort": "relevance",
                },
            )

            search_response.raise_for_status()

            search_data = search_response.json()

            search_result = search_data.get(
                "esearchresult",
                {},
            )

            total_found = int(
                search_result.get(
                    "count",
                    0,
                )
            )

            pmids = search_result.get(
                "idlist",
                [],
            )

            if not pmids:
                return total_found, []

            fetch_response = await client.get(
                EFETCH_URL,
                params={
                    "db": "pubmed",
                    "id": ",".join(pmids),
                    "retmode": "xml",
                    "rettype": "abstract",
                },
            )

            fetch_response.raise_for_status()

    except (
        httpx.TimeoutException,
        httpx.NetworkError,
        httpx.HTTPStatusError,
        ValueError,
    ) as error:
        raise PubMedServiceError(
            "Unable to retrieve papers from PubMed."
        ) from error

    papers = parse_pubmed_xml(
        fetch_response.text
    )

    papers = rank_papers(
        query,
        papers,
    )

    return total_found, papers