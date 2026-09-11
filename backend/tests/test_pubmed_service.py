import pytest

from app.services.pubmed_service import (
    PubMedServiceError,
    build_pubmed_query,
    parse_pubmed_xml,
)


SAMPLE_PUBMED_XML = """
<PubmedArticleSet>
    <PubmedArticle>
        <MedlineCitation>
            <PMID>12345678</PMID>

            <Article>
                <ArticleTitle>
                    Diabetes Treatment Research
                </ArticleTitle>

                <Abstract>
                    <AbstractText Label="BACKGROUND">
                        Diabetes is a common chronic condition.
                    </AbstractText>

                    <AbstractText Label="METHODS">
                        This study evaluates a new treatment.
                    </AbstractText>
                </Abstract>

                <AuthorList>
                    <Author>
                        <LastName>Smith</LastName>
                        <ForeName>John</ForeName>
                        <Initials>J</Initials>
                    </Author>

                    <Author>
                        <CollectiveName>
                            Diabetes Research Group
                        </CollectiveName>
                    </Author>
                </AuthorList>

                <Journal>
                    <Title>Journal of Diabetes Research</Title>

                    <JournalIssue>
                        <PubDate>
                            <Year>2024</Year>
                        </PubDate>
                    </JournalIssue>
                </Journal>
            </Article>
        </MedlineCitation>

        <PubmedData>
            <ArticleIdList>
                <ArticleId IdType="pubmed">
                    12345678
                </ArticleId>

                <ArticleId IdType="doi">
                    10.1000/example-doi
                </ArticleId>
            </ArticleIdList>
        </PubmedData>
    </PubmedArticle>
</PubmedArticleSet>
"""


def test_parse_pubmed_xml_extracts_paper_metadata():
    papers = parse_pubmed_xml(SAMPLE_PUBMED_XML)

    assert len(papers) == 1

    paper = papers[0]

    assert paper["pmid"] == "12345678"
    assert paper["title"] == "Diabetes Treatment Research"

    assert paper["authors"] == [
        "John Smith",
        "Diabetes Research Group",
    ]

    assert paper["journal"] == "Journal of Diabetes Research"
    assert paper["publication_year"] == 2024
    assert paper["doi"] == "10.1000/example-doi"
    assert paper["source"] == "PubMed"

    assert paper["source_url"] == (
        "https://pubmed.ncbi.nlm.nih.gov/12345678/"
    )

    assert "BACKGROUND:" in paper["abstract"]
    assert "METHODS:" in paper["abstract"]


def test_parse_pubmed_xml_rejects_invalid_xml():
    invalid_xml = "<PubmedArticleSet><broken>"

    with pytest.raises(
        PubMedServiceError,
        match="PubMed returned invalid XML data",
    ):
        parse_pubmed_xml(invalid_xml)


def test_parse_pubmed_xml_handles_empty_results():
    papers = parse_pubmed_xml(
        "<PubmedArticleSet></PubmedArticleSet>"
    )

    assert papers == []


def test_build_pubmed_query_without_year_filter():
    result = build_pubmed_query(
        query="diabetes treatment",
        year_from=None,
        year_to=None,
    )

    assert result == "diabetes treatment"


def test_build_pubmed_query_with_year_filter():
    result = build_pubmed_query(
        query="diabetes treatment",
        year_from=2020,
        year_to=2026,
    )

    assert result == (
        "diabetes treatment "
        "AND 2020:2026[Date - Publication]"
    )


def test_build_pubmed_query_with_only_start_year():
    result = build_pubmed_query(
        query="diabetes treatment",
        year_from=2020,
        year_to=None,
    )

    assert result == (
        "diabetes treatment "
        "AND 2020:2100[Date - Publication]"
    )