from datetime import datetime


def calculate_relevance_score(
    query: str,
    paper: dict
) -> float:
    """
    Calculate simple relevance score.

    Factors:
    - Title keyword match
    - Abstract keyword match
    - Publication year
    """

    score = 0.0

    query_words = set(
        query.lower().split()
    )


    title = paper.get(
        "title",
        ""
    ).lower()


    abstract = paper.get(
        "abstract",
        ""
    ).lower()


    # Title matching (50%)
    title_matches = sum(
        1
        for word in query_words
        if word in title
    )

    if query_words:
        score += (
            title_matches /
            len(query_words)
        ) * 0.5


    # Abstract matching (30%)
    abstract_matches = sum(
        1
        for word in query_words
        if word in abstract
    )

    if query_words:
        score += (
            abstract_matches /
            len(query_words)
        ) * 0.3


    # Recent publication bonus (20%)
    year = paper.get(
        "publication_year"
    )

    if year:

        current_year = datetime.now().year

        age = current_year - year

        if age <= 5:
            score += 0.2

        elif age <= 10:
            score += 0.1


    return round(
        min(score, 1.0),
        2
    )



def rank_papers(
    query: str,
    papers: list[dict]
) -> list[dict]:
    """
    Rank papers based on relevance.
    """


    for paper in papers:

        paper["relevance_score"] = (
            calculate_relevance_score(
                query,
                paper
            )
        )


    papers.sort(
        key=lambda x:
            x["relevance_score"],
        reverse=True
    )


    for index, paper in enumerate(
        papers,
        start=1
    ):

        paper["rank"] = index


    return papers