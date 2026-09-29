"""Local relevance ranking for one page of PubMed results.

Hardened after the security assessment showed the ranking could be inverted (V-03): a
keyword-stuffed decoy scored 1.0 and ranked first while a genuinely relevant trial scored
0.0. Four changes, each closing one mechanism behind that result:

1. Whole-token matching. `word in title` was substring matching, so "metformin" matched
   inside "metformin-free" - a paper about avoiding the drug. Text is now tokenised, and
   hyphenated compounds stay one token.
2. A stuffing penalty. A title that repeats the query phrase, or any query word three or
   more times, is written for the ranker rather than the reader; its title score is cut
   and the paper is flagged.
3. Recency is a tie-breaker, not a score. The 20% recency bonus is only paid to a paper
   that matches the topic at all, so an irrelevant recent paper no longer collects it.
4. PubMed's own order counts. PubMed ranks with MeSH expansion, which this scorer cannot
   do - it is why a paper saying "biguanide" is still relevant to "metformin". The order
   PubMed returned is kept as `pubmed_rank` and blended in as a prior.

Lexical scoring still cannot understand synonyms. The residual risk is recorded in the
assessment; the durable fix is to rank by PubMed's relevance order or a BM25/MeSH model.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import datetime

# A token is a run of letters/digits, with internal hyphens kept: "metformin-free" and
# "type-2" are single tokens, so they cannot satisfy a query for "metformin" or "type".
_TOKEN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")

# Weight of PubMed's own relevance order in the final sort. Small enough that the local
# score still decides clear cases; large enough to break ties the lexical score cannot.
PUBMED_PRIOR_WEIGHT = 0.2
# Title score multiplier for a stuffed title.
STUFFING_PENALTY = 0.25


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall((text or "").lower())


def _contains_phrase(tokens: list[str], phrase: list[str], times: int) -> bool:
    """True if `phrase` occurs at least `times` times as a contiguous run in `tokens`."""
    if not phrase or len(phrase) > len(tokens):
        return False
    size = len(phrase)
    count = sum(1 for i in range(len(tokens) - size + 1) if tokens[i : i + size] == phrase)
    return count >= times


def is_stuffed(query: str, title: str) -> bool:
    """A title that repeats the query instead of describing a study."""
    query_tokens = _tokens(query)
    title_tokens = _tokens(title)
    if not query_tokens or not title_tokens:
        return False
    if len(query_tokens) > 1 and _contains_phrase(title_tokens, query_tokens, 2):
        return True
    counts = Counter(title_tokens)
    return any(counts[word] >= 3 for word in set(query_tokens))


def calculate_relevance_score(
    query: str,
    paper: dict
) -> float:
    """
    Calculate a lexical relevance score between 0 and 1.

    Factors:
    - Title term coverage (50%), cut for a stuffed title
    - Abstract term coverage (30%)
    - Publication recency (20%), only for a paper that matches the topic
    """

    query_words = set(_tokens(query))
    if not query_words:
        return 0.0

    title = paper.get("title") or ""
    title_words = set(_tokens(title))
    abstract_words = set(_tokens(paper.get("abstract") or ""))

    title_coverage = len(query_words & title_words) / len(query_words)
    abstract_coverage = len(query_words & abstract_words) / len(query_words)

    title_score = title_coverage * 0.5
    if is_stuffed(query, title):
        title_score *= STUFFING_PENALTY

    score = title_score + abstract_coverage * 0.3

    # Recency only ranks among papers that are about the topic. Paid unconditionally, it
    # handed any recent paper a fifth of a perfect score for nothing.
    year = paper.get("publication_year")
    if year and score > 0:
        age = datetime.now().year - year
        if age <= 5:
            score += 0.2
        elif age <= 10:
            score += 0.1

    return round(min(score, 1.0), 2)


def rank_papers(
    query: str,
    papers: list[dict]
) -> list[dict]:
    """
    Rank papers based on relevance.

    `papers` arrives in PubMed's own relevance order, which is recorded as `pubmed_rank`
    before anything is reordered and blended into the sort as a prior.
    """

    total = len(papers)

    for position, paper in enumerate(papers):
        paper["pubmed_rank"] = position + 1
        paper["relevance_score"] = calculate_relevance_score(query, paper)
        flags = []
        if is_stuffed(query, paper.get("title") or ""):
            flags.append(
                "Title repeats the search terms unusually often; its ranking was reduced."
            )
        paper["ranking_flags"] = flags

    def sort_key(paper: dict) -> tuple[float, int]:
        prior = 1.0 - (paper["pubmed_rank"] - 1) / total if total else 0.0
        blended = (
            (1 - PUBMED_PRIOR_WEIGHT) * paper["relevance_score"]
            + PUBMED_PRIOR_WEIGHT * prior
        )
        # PubMed's order breaks any remaining tie.
        return (-blended, paper["pubmed_rank"])

    papers.sort(key=sort_key)

    for index, paper in enumerate(papers, start=1):
        paper["rank"] = index

    return papers
