"""Turn an uploaded document into text, and find the parts a question is about.

Retrieval here is not an optimisation, it is a requirement. A full research paper is
around 40,000 characters, roughly 11,000 tokens, and the per-minute token budget for one
call is 8,000 - so a whole paper cannot be sent even once, let alone on every turn of a
conversation. Only the passages a question is actually about can travel with it.

The scoring is lexical and local. An embedding model would rank passages better, but it
costs a network round trip before every single answer and a second token quota to pay it
with; on one paper's worth of chunks, term overlap weighted by rarity gets the right
passages often enough that the round trip is not worth its latency.
"""

from __future__ import annotations

import io
import logging
import math
import re
from collections import Counter

logger = logging.getLogger(__name__)

# How much document text may accompany a question. Sized against the 8,000-token
# per-minute budget: ~3,400 tokens of context leaves room for the instructions, a few
# turns of history and the answer itself.
CONTEXT_BUDGET_CHARS = 12_000

# Chunks are a compromise: long enough that a passage keeps the sentence around it,
# short enough that several can travel together.
CHUNK_CHARS = 1_100
CHUNK_OVERLAP = 150

MAX_DOCUMENT_CHARS = 400_000

_WORD = re.compile(r"[a-z0-9][a-z0-9\-]{1,}")

# Words too common to say anything about which passage is relevant.
_STOPWORDS = frozenset(
    """a an and are as at be been but by can did do does for from had has have how
    i if in into is it its of on or that the their then there these they this to was
    were what when where which who why will with would you your about above after
    again all also am any because before being below between both each few further
    here more most no nor not only other our out over own same so some such than
    too under until up very we while""".split()
)


class DocumentError(ValueError):
    """The upload could not be turned into text worth answering from."""


def extract_text(data: bytes, filename: str) -> tuple[str, int | None]:
    """Return (text, page_count). Page count is None for anything but a PDF."""
    name = (filename or "").lower()

    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        return _extract_pdf(data)

    if name.endswith((".txt", ".md", ".text", ".csv")):
        return _decode(data), None

    raise DocumentError(
        "Only PDF and plain text files can be read. Export the paper as a PDF or paste "
        "its text into a .txt file."
    )


def _decode(data: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise DocumentError("That file is not readable as text.")


def _extract_pdf(data: bytes) -> tuple[str, int | None]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - a deployment problem, not a user one
        raise DocumentError("PDF reading is not available on this server.") from exc

    try:
        reader = PdfReader(io.BytesIO(data))
    except Exception as exc:
        raise DocumentError("That PDF could not be opened. It may be corrupt.") from exc

    if getattr(reader, "is_encrypted", False):
        try:
            reader.decrypt("")
        except Exception as exc:
            raise DocumentError(
                "That PDF is password protected, so its text cannot be read."
            ) from exc

    pages: list[str] = []
    for index, page in enumerate(reader.pages):
        try:
            pages.append(page.extract_text() or "")
        except Exception:
            # One unreadable page should not lose the other thirty.
            logger.info("Could not extract text from PDF page %d", index + 1)
            pages.append("")

    text = normalise("\n\n".join(pages))
    if not text.strip():
        raise DocumentError(
            "No text could be read from that PDF. It is probably a scan of a printed "
            "page, which needs OCR before it can be searched."
        )
    return text, len(reader.pages)


def normalise(text: str) -> str:
    """Tidy extracted text without changing a word of it.

    PDF extraction leaves hyphenated line breaks and hard wrapping mid-sentence. Both
    would break a verbatim quote check later, so they are repaired here - once, at
    upload - rather than worked around at every question.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t ]+", " ", text)
    # "inter-\nvention" is one word split by the typesetter.
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    # A single newline inside a sentence is wrapping; a blank line is a real break.
    text = re.sub(r"(?<![\n.!?:;])\n(?!\n)", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chunk(text: str) -> list[str]:
    """Split into overlapping passages, preferring paragraph boundaries.

    The overlap matters: a sentence that straddles a boundary would otherwise be
    unquotable, since neither chunk contains the whole of it.
    """
    text = text.strip()
    if not text:
        return []

    paragraphs = [part.strip() for part in text.split("\n\n") if part.strip()]
    chunks: list[str] = []
    current = ""

    for paragraph in paragraphs:
        if len(current) + len(paragraph) + 2 <= CHUNK_CHARS:
            current = f"{current}\n\n{paragraph}" if current else paragraph
            continue
        if current:
            chunks.append(current)
        # A single paragraph longer than a chunk is cut on length, with overlap.
        while len(paragraph) > CHUNK_CHARS:
            chunks.append(paragraph[:CHUNK_CHARS])
            paragraph = paragraph[CHUNK_CHARS - CHUNK_OVERLAP :]
        current = paragraph

    if current:
        chunks.append(current)
    return chunks


def _terms(text: str) -> list[str]:
    return [word for word in _WORD.findall(text.lower()) if word not in _STOPWORDS]


def select_context(text: str, question: str, budget: int = CONTEXT_BUDGET_CHARS) -> str:
    """The passages of `text` most likely to answer `question`, within `budget` chars.

    A document that already fits is returned whole: retrieval can only lose information,
    so it is used when it has to be, not when it can be.
    """
    text = text.strip()
    if len(text) <= budget:
        return text

    passages = chunk(text)
    if not passages:
        return text[:budget]

    query = set(_terms(question))
    if not query:
        # Nothing to match on - the opening of a paper is its abstract, which is the
        # best default answer to "tell me about this".
        return _join_within(passages, budget)

    # Inverse document frequency over this one document's chunks, so a term appearing
    # in every passage carries no weight and a rare one carries most.
    frequency = Counter()
    tokenised: list[list[str]] = []
    for passage in passages:
        terms = _terms(passage)
        tokenised.append(terms)
        frequency.update(set(terms))

    total = len(passages)
    scored: list[tuple[float, int]] = []
    for index, terms in enumerate(tokenised):
        counts = Counter(terms)
        score = 0.0
        for term in query:
            if term not in counts:
                continue
            idf = math.log(1 + total / (1 + frequency[term]))
            # Saturating term frequency: a passage that says a word ten times is not
            # ten times the answer.
            score += idf * (counts[term] / (counts[term] + 1.5))
        scored.append((score, index))

    scored.sort(key=lambda pair: (-pair[0], pair[1]))
    chosen = [index for score, index in scored if score > 0]
    if not chosen:
        return _join_within(passages, budget)

    # Reassembled in document order, so the model reads the paper's own sequence.
    kept: list[int] = []
    used = 0
    for index in chosen:
        size = len(passages[index]) + 2
        if used + size > budget:
            continue
        kept.append(index)
        used += size
        if used >= budget:
            break

    if not kept:
        kept = [chosen[0]]

    kept.sort()
    return "\n\n[...]\n\n".join(passages[index] for index in kept)


def _join_within(passages: list[str], budget: int) -> str:
    out: list[str] = []
    used = 0
    for passage in passages:
        if used + len(passage) + 2 > budget:
            break
        out.append(passage)
        used += len(passage) + 2
    return "\n\n".join(out) or passages[0][:budget]
