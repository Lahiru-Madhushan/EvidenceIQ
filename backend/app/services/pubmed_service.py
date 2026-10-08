import logging
import re
import xml.etree.ElementTree as ET
from typing import Optional

import httpx

from app.core.config import settings
from app.services.ranking_service import rank_papers

logger = logging.getLogger(__name__)


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


class InvalidQueryError(ValueError):
    """The search text was empty once PubMed query syntax was removed from it."""


# PubMed field tags: [Author], [Journal], [dp], [MeSH Terms], [Subheading], ...
_FIELD_TAG = re.compile(r"\[[^\]]*\]")
# Date ranges such as 1:2100 or 2020/01/01:2024/12/31, which only mean something next
# to a date tag and are how a search is widened to all of PubMed.
_DATE_RANGE = re.compile(r"\b\d{1,4}(?:/\d{1,2}){0,2}\s*:\s*\d{1,4}(?:/\d{1,2}){0,2}\b")
# History references (#1 AND #2) and stray comment characters.
_HASH = re.compile(r"#\d*")
_SPACES = re.compile(r"\s+")


def _brackets_nest(text: str) -> bool:
    """True when every ")" closes an earlier "(" and none is left open."""
    depth = 0
    for char in text:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def neutralise_query(query: str) -> tuple[str, list[str]]:
    """Turn the researcher's search text into a search term, not a query expression.

    The text used to be pasted into PubMed's query language unchanged, so it could
    restrict the corpus to one author or journal, drop studies about harms with NOT, or
    wipe out the topic with a date range that matches everything (V-02). Field tags,
    date ranges and history references are removed here, and unbalanced quotes or
    brackets are dropped so the text cannot open a group that swallows the filters.
    Plain AND / OR / NOT between free-text words are kept - they are an ordinary part
    of writing a search - and the whole term is bracketed by build_pubmed_query, so
    whatever they do stays inside the researcher's own topic.

    Returns the cleaned text and a list of what was removed, which the API reports back
    so a changed search is never silent.
    """
    warnings: list[str] = []
    text = query or ""

    if _FIELD_TAG.search(text):
        text = _FIELD_TAG.sub(" ", text)
        warnings.append("PubMed field tags such as [Author] or [Journal] were removed.")
    if _DATE_RANGE.search(text):
        text = _DATE_RANGE.sub(" ", text)
        warnings.append("Date ranges typed into the search were removed; use the year filters instead.")
    if _HASH.search(text):
        text = _HASH.sub(" ", text)
        warnings.append("PubMed history references (#) were removed.")
    if text.count('"') % 2:
        text = text.replace('"', " ")
        warnings.append("An unmatched quotation mark was removed.")
    if not _brackets_nest(text):
        # Counting is not enough: "a) OR (b" has one of each, and its ")" would close the
        # bracket build_pubmed_query wraps the term in, escaping it. The order has to be
        # valid all the way through.
        text = text.replace("(", " ").replace(")", " ")
        warnings.append("Unmatched brackets were removed.")

    text = _SPACES.sub(" ", text).strip()
    # Removing tags can leave operators side by side ("diabetes OR OR cancer") or
    # dangling at either end ("diabetes AND"); both are collapsed.
    text = re.sub(r"\b(AND|OR|NOT)(?:\s+(?:AND|OR|NOT)\b)+", r"\1", text)
    text = re.sub(r"\(\s*(?:(?:AND|OR|NOT)\s+)+", "(", text)
    text = re.sub(r"(?:\s+(?:AND|OR|NOT))+\s*\)", ")", text)
    text = re.sub(r"^(?:(?:AND|OR|NOT)\s+)+|(?:\s+(?:AND|OR|NOT))+$", "", text).strip()
    text = re.sub(r"\(\s*\)", " ", text)
    text = _SPACES.sub(" ", text).strip()

    if re.search(r"\bNOT\b", text):
        # Legitimate in a search strategy, and also the one operator that removes
        # evidence. It is kept, and said out loud, so it lands in the reported method.
        warnings.append(
            "This search uses NOT, which removes every matching paper from the results. "
            "Make sure the exclusion is part of your registered search strategy."
        )

    if not re.search(r"[A-Za-z0-9]", text):
        raise InvalidQueryError(
            "The search has no words left once PubMed search syntax is removed. "
            "Please enter the topic in plain words."
        )
    return text, warnings


def build_pubmed_query(
    query: str,
    year_from: Optional[int],
    year_to: Optional[int],
) -> str:
    """
    Turn the search text into a PubMed term, with optional publication-year filtering.

    The researcher's term is bracketed before any filter is added, so the filter always
    applies to the whole of it. PubMed happens to evaluate operators left to right,
    which is why the unbracketed version held in testing - but that is an accident of the
    filter being appended last, and a filter added anywhere else would have been escaped.
    """

    cleaned_query, _ = neutralise_query(query)

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

        return (
            f"({cleaned_query}) AND {start_year}:{end_year}[Date - Publication]"
        )

    return cleaned_query


# How deep into one search's results paging may reach. The review page keeps fetching
# pages until enough papers are accepted by both agents, so paging past one request's
# max_results is normal use - but not without end. PubMed itself refuses offsets past
# 9,999 without the history server, and a systematic review that has screened a
# thousand candidates for one query needs a better query, not page 101.
MAX_RETRIEVAL_DEPTH = 1000


def page_window(*, page: int, page_size: int, max_results: int) -> tuple[int, int] | None:
    """(retstart, retmax) for one page of results, or None when the page is out of range.

    `max_results` bounds ONE request: it is the most papers a single call returns, and
    the review page sends it equal to page_size and walks page 1, 2, 3 ... until its
    target is met. An earlier version of this fix read it as a cap on the whole search,
    which ended every run after its first page (V-04 retest). The depth limit above is
    what bounds the search as a whole.
    """
    size = min(page_size, max_results)
    retstart = (page - 1) * size
    if retstart >= MAX_RETRIEVAL_DEPTH:
        return None
    return retstart, min(size, MAX_RETRIEVAL_DEPTH - retstart)


def _ncbi_params() -> dict:
    """Identify this application to NCBI, as the E-utilities usage policy asks.

    With an API key the limit rises from 3 to 10 requests a second and heavy use is
    attributed to this key rather than throttled against the shared host address.
    """
    params = {"tool": settings.ncbi_tool}
    if settings.ncbi_email:
        params["email"] = settings.ncbi_email
    if settings.ncbi_api_key:
        params["api_key"] = settings.ncbi_api_key
    return params


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

    # PubMed's efetch output never declares entities. A document that does is either not
    # from PubMed or has been tampered with, and entity declarations are what billion-
    # laughs expansion and XXE file reads are built from. ElementTree already refuses to
    # expand them (TC-12, TC-13), but that is a library default; refusing the document
    # outright makes it a decision this code owns.
    head = xml_content[:4096] if isinstance(xml_content, str) else ""
    if "<!ENTITY" in head.upper():
        raise PubMedServiceError("PubMed returned invalid XML data.")

    try:
        root = ET.fromstring(xml_content)

    except ET.ParseError as error:
        raise PubMedServiceError(
            "PubMed returned invalid XML data."
        ) from error

    papers = []
    seen_pmids = set()
    dropped = {"no_pmid": 0, "bad_pmid": 0, "no_title": 0, "duplicate": 0}

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

        # Counted by reason instead of skipped silently (V-08): a malformed record, an
        # incomplete one and a duplicate are different situations, and the first two
        # mean the researcher's corpus is smaller than PubMed said it was.
        if not pmid:
            dropped["no_pmid"] += 1
            continue
        if not pmid.isdigit():
            # A PMID is a number. Anything else would be written into a source URL.
            dropped["bad_pmid"] += 1
            continue
        if not title:
            dropped["no_title"] += 1
            continue
        if pmid in seen_pmids:
            dropped["duplicate"] += 1
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

    lost = dropped["no_pmid"] + dropped["bad_pmid"] + dropped["no_title"]
    if lost:
        logger.warning(
            "PubMed parse dropped %d incomplete record(s): %s (kept %d)", lost, dropped, len(papers)
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

    window = page_window(page=page, page_size=page_size, max_results=max_results)
    if window is None:
        return 0, []
    retstart, retmax = window

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
                    "retstart": retstart,
                    "retmax": retmax,
                    "retmode": "json",
                    "sort": "relevance",
                    **_ncbi_params(),
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

            # Ids are sent back to PubMed and written into URLs, so only numeric ones pass.
            pmids = [str(pmid) for pmid in pmids if str(pmid).isdigit()]

            if not pmids:
                return total_found, []

            fetch_response = await client.get(
                EFETCH_URL,
                params={
                    "db": "pubmed",
                    "id": ",".join(pmids),
                    "retmode": "xml",
                    "rettype": "abstract",
                    **_ncbi_params(),
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