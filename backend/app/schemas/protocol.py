"""Input contract: the structured screening protocol produced by Agent 1.

Agent 4 does not build protocols - it only needs to know their shape in order to
verify a paper against one. Agent 1's implementation belongs to whoever owns it.
"""

from __future__ import annotations

import re

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.sanitize import neutralise_fences


def _defang(text: str) -> str:
    """Protocol text is written into every screening and verification prompt, inside a
    fenced <protocol> block. Text imitating those fence tags could close the block and
    write outside it, so the tags are neutralised here, where every protocol passes."""
    return neutralise_fences(text)[0]


_RANGE_STRING = re.compile(r"^\s*(\d{4})\s*(?:-|--|to)\s*(\d{4})\s*$", re.IGNORECASE)
_REVIEW_HINT = re.compile(r"\breviews?\b|\bmeta-?analys", re.IGNORECASE)


class DateRange(BaseModel):
    """Publication window. Accepts {"from": 2015, "to": 2026} or the string "2015-2026"."""

    model_config = ConfigDict(populate_by_name=True)

    from_year: int = Field(alias="from", ge=1800, le=2200)
    to_year: int = Field(alias="to", ge=1800, le=2200)

    @model_validator(mode="before")
    @classmethod
    def _accept_shorthand_string(cls, value):
        if isinstance(value, str):
            match = _RANGE_STRING.match(value)
            if match is None:
                raise ValueError(f"date_range string must look like '2015-2026', got {value!r}")
            return {"from": int(match.group(1)), "to": int(match.group(2))}
        return value

    @model_validator(mode="after")
    def _check_order(self):
        if self.from_year > self.to_year:
            raise ValueError("date_range 'from' must not be after 'to'")
        return self

    def contains(self, year: int) -> bool:
        return self.from_year <= year <= self.to_year

    def __str__(self) -> str:
        return f"{self.from_year}-{self.to_year}"


class Protocol(BaseModel):
    """The unambiguous rule set Agent 1 produced after clarifying with the researcher."""

    population: str = Field(default="", max_length=1000)
    condition: str = Field(default="", max_length=1000)
    intervention: str = Field(default="", max_length=1000)
    date_range: DateRange | None = None
    excludes: list[Annotated[str, Field(max_length=300)]] = Field(default_factory=list, max_length=30)
    additional_criteria: list[Annotated[str, Field(max_length=1000)]] = Field(
        default_factory=list, max_length=20
    )

    @field_validator("population", "condition", "intervention", mode="before")
    @classmethod
    def _text_field(cls, value):
        # A model that returns null for a field it could not fill should give a blank
        # criterion, not a crashed request.
        return _defang("" if value is None else str(value))

    @field_validator("excludes", "additional_criteria", mode="before")
    @classmethod
    def _text_list(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        return [_defang(str(item)) for item in value if item is not None]

    def inclusion_items(self) -> list[tuple[str, str]]:
        """Named inclusion rules in a stable order, skipping any the protocol left blank."""
        items: list[tuple[str, str]] = []
        for name in ("population", "condition", "intervention"):
            value = getattr(self, name).strip()
            if value:
                items.append((name, value))
        if self.date_range is not None:
            items.append(("publication_date", str(self.date_range)))
        for index, criterion in enumerate(self.additional_criteria, start=1):
            if criterion.strip():
                items.append((f"additional_{index}", criterion.strip()))
        return items

    def exclusion_items(self) -> list[tuple[str, str]]:
        """Exclusion rules, named so a check can be traced back to the rule that made it."""
        return [
            (f"exclude:{term.strip()}", term.strip())
            for term in self.excludes
            if term.strip()
        ]

    def excludes_review_articles(self) -> bool:
        return any(_REVIEW_HINT.search(term) for term in self.excludes)
