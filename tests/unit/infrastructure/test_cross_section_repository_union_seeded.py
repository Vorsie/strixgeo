"""Unit tests for CrossSectionRepository.union_seeded_contact_ids.

Covers the three contract guarantees of the extracted method:

R1 — happy union: contact ids are merged into the existing seeded set and
     the updated section is returned.
R2 — idempotent re-union: calling again with ids already in the seeded set
     does not grow the set (union, not append).
R3 — missing section (None): returns None without raising; the caller's
     primary operation is unaffected (non-fatal contract).
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)

PROJECT_ID = uuid4()
SECTION_ID = uuid4()
CONTACT_A = uuid4()
CONTACT_B = uuid4()
CONTACT_C = uuid4()


def _make_session() -> AsyncMock:
    """Return a minimal async session mock."""
    session = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.refresh = AsyncMock()
    return session


def _make_section(seeded: list) -> SimpleNamespace:
    """Return a minimal section ORM stand-in."""
    return SimpleNamespace(
        id=SECTION_ID,
        app_project_id=PROJECT_ID,
        seeded_formation_contact_ids=list(seeded),
    )


# ---------------------------------------------------------------------------
# R1 — happy union
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_union_seeded_contact_ids_happy_union() -> None:
    """R1: new ids are merged with existing ids; updated section is returned."""
    existing_id = uuid4()
    section = _make_section([existing_id])
    updated_section = _make_section([existing_id, CONTACT_A])

    session = _make_session()
    repo = CrossSectionRepository(session)
    # Replace get / update with controlled mocks so no real DB is needed.
    repo.get = AsyncMock(return_value=section)
    repo.update = AsyncMock(return_value=updated_section)

    result = await repo.union_seeded_contact_ids(
        SECTION_ID,
        PROJECT_ID,
        {CONTACT_A},
        operation="test_R1",
    )

    assert result is updated_section
    # update was called with the merged list containing both ids.
    repo.update.assert_awaited_once()
    _, patch_body = repo.update.await_args.args
    merged = patch_body["seeded_formation_contact_ids"]
    assert existing_id in merged
    assert CONTACT_A in merged
    # Commit fired once after the update.
    session.commit.assert_awaited_once()
    session.refresh.assert_awaited_once_with(updated_section)


# ---------------------------------------------------------------------------
# R2 — idempotent re-union: already-present ids do not grow the set
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_union_seeded_contact_ids_idempotent() -> None:
    """R2: re-unioning ids already in the seeded set is a no-op on the set size."""
    section = _make_section([CONTACT_A, CONTACT_B])
    updated_section = _make_section([CONTACT_A, CONTACT_B])

    session = _make_session()
    repo = CrossSectionRepository(session)
    repo.get = AsyncMock(return_value=section)
    repo.update = AsyncMock(return_value=updated_section)

    result = await repo.union_seeded_contact_ids(
        SECTION_ID,
        PROJECT_ID,
        {CONTACT_A},  # already in the seeded set
        operation="test_R2",
    )

    assert result is updated_section
    _, patch_body = repo.update.await_args.args
    merged = patch_body["seeded_formation_contact_ids"]
    # Set semantics: still exactly two ids, not three.
    assert set(merged) == {CONTACT_A, CONTACT_B}


# ---------------------------------------------------------------------------
# R3 — missing section: non-fatal, returns None
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_union_seeded_contact_ids_missing_section_returns_none() -> None:
    """R3: when the section is not found, returns None without raising."""
    session = _make_session()
    repo = CrossSectionRepository(session)
    repo.get = AsyncMock(return_value=None)
    repo.update = AsyncMock()

    result = await repo.union_seeded_contact_ids(
        SECTION_ID,
        PROJECT_ID,
        {CONTACT_C},
        operation="test_R3",
    )

    assert result is None
    # update and commit must NOT have been called.
    repo.update.assert_not_awaited()
    session.commit.assert_not_awaited()
