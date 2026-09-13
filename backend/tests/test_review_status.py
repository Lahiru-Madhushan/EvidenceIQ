"""A review's status has to describe where the review actually is.

It used to mean "Agent 1 finished": set to `screening` the moment a protocol existed,
and never written again, so a review with nothing retrieved and a review the researcher
had finished carried the same label. These pin the derivation rules that replaced that.
"""

from __future__ import annotations

import pytest

from app.models.review import Review
from app.routers.reviews import derive_status

PROTOCOL = {"population": "adults", "condition": "type 2 diabetes"}


def review(status, protocol=PROTOCOL):
    return Review(status=status, protocol=protocol, research_question="q")


def test_finished_when_every_paper_has_been_decided():
    assert derive_status(review("screening"), total=12, decided=12) == "complete"


def test_not_finished_while_one_paper_is_undecided():
    assert derive_status(review("screening"), total=12, decided=11) == "screening"


def test_an_empty_review_is_not_complete():
    """Zero papers decided out of zero is vacuously 'all of them' - and meaningless."""
    assert derive_status(review("screening"), total=0, decided=0) == "screening"


def test_reopens_when_a_decision_is_undone():
    """Recomputed, not advanced: a finished review can go back to screening."""
    assert derive_status(review("complete"), total=5, decided=4) == "screening"


@pytest.mark.parametrize("current", ["draft", "awaiting_clarification"])
def test_leaves_agent_1s_states_alone(current):
    """Only Agent 1 can decide the criteria are interpreted; paper counts cannot."""
    assert derive_status(review(current, protocol=None), total=0, decided=0) == current


def test_a_review_with_papers_but_no_protocol_stays_put():
    """Agent 2 does not require a protocol, so this combination really does happen."""
    assert derive_status(review("draft", protocol=None), total=10, decided=0) == "draft"
