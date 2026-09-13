"""Shared test helpers.

The virtual clock below exists because the obvious way to make these tests fast is a
trap, and it has now caught three separate test files.

Stubbing asyncio.sleep to do nothing looks like it removes the waiting. It does not:
the token buckets wait in a loop, re-checking their own clock until enough time has
passed to refill. With sleep stubbed out and the clock left real, a 30-second wait
becomes a 30-second busy-spin - the suite still takes the full time, it just burns CPU
doing it, and nothing in the failure says why.

A sleep has to move the clock. Always use install_virtual_clock, never a bare no-op.
"""

from __future__ import annotations

import asyncio
import time

import pytest


def install_virtual_clock(monkeypatch, target_module=None):
    """Make sleeping advance a fake clock instead of the wall.

    Returns a callable giving the seconds elapsed on that clock, so a test can assert on
    the delay a bucket actually imposed without sitting through it.
    """
    real_sleep = asyncio.sleep
    start = time.monotonic()
    now = start

    async def fake_sleep(delay, *args, **kwargs):
        nonlocal now
        now += max(0.0, float(delay))
        # Still yield, so concurrent tasks interleave as they would for real.
        await real_sleep(0)

    # asyncio and time are module singletons, so patching them here reaches every module
    # under test - the buckets in rate_limit as well as the retry loop in llm.
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(time, "monotonic", lambda: now)
    if target_module is not None:
        monkeypatch.setattr(target_module.asyncio, "sleep", fake_sleep)

    return lambda: now - start


@pytest.fixture
def virtual_clock(monkeypatch):
    """Fixture form of install_virtual_clock."""
    return install_virtual_clock(monkeypatch)
