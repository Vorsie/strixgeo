"""Unit tests for CrossSectionRepository seeded-array pruning.

The explicit-content invariant unions contact ids into
``cross_section.seeded_formation_contact_ids`` on every contact create, but
nothing removed them again — deleting a contact (or clearing a litho model)
left its id seeded forever, so the array grew unbounded across
suggest→accept→delete cycles (a live oudenaarde section carried 11,960 seeded
ids of which 11,836 referenced already-deleted contacts).

These tests pin the two removal paths that close that leak:

P1  ``remove_seeded_contact_ids`` drops exactly the requested ids from a
    section and reports how many entries it removed.
P2  ``remove_seeded_contact_ids`` removes the id from EVERY section that
    carried it (a contact can be seeded on more than one section).
P3  ``remove_seeded_contact_ids`` is a no-op when the id is absent — no write,
    returns 0.
P4  ``prune_orphan_seeded_ids`` drops every seeded id that no longer
    references a live contact — this is the "clean slate on clear" rule that
    sweeps the historical 11,836 stale ids.
P5  ``prune_orphan_seeded_ids`` KEEPS ids that still reference a live contact
    (including live geological contacts) — it removes debris only.
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


def _section(seeded: list) -> SimpleNamespace:
    """Minimal section ORM stand-in carrying a seeded id list."""
    return SimpleNamespace(
        id=uuid4(),
        app_project_id=PROJECT_ID,
        seeded_formation_contact_ids=list(seeded),
    )


def _repo_over(sections: list) -> CrossSectionRepository:
    """Build a repo whose list_all / update are controlled mocks.

    ``update`` mutates the stand-in in place so a test can read the
    post-prune seeded list straight off the section object.
    """
    repo = CrossSectionRepository(AsyncMock())
    repo.list_all = AsyncMock(return_value=sections)

    async def _update(section_id, patch):
        for s in sections:
            if s.id == section_id:
                for k, v in patch.items():
                    setattr(s, k, v)
                return s
        return None

    repo.update = AsyncMock(side_effect=_update)
    return repo


# ---------------------------------------------------------------------------
# P1 — targeted removal from one section
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_remove_drops_requested_id() -> None:
    """P1: the deleted contact id is removed; the rest of the set is intact."""
    a, b, c = uuid4(), uuid4(), uuid4()
    section = _section([a, b, c])
    repo = _repo_over([section])

    removed = await repo.remove_seeded_contact_ids(PROJECT_ID, {b})

    assert removed == 1
    assert set(section.seeded_formation_contact_ids) == {a, c}


# ---------------------------------------------------------------------------
# P2 — the id is removed from every section that carried it
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_remove_spans_all_sections() -> None:
    """P2: a contact seeded on two sections is unseeded from both."""
    shared = uuid4()
    other = uuid4()
    s1 = _section([shared, other])
    s2 = _section([shared])
    repo = _repo_over([s1, s2])

    removed = await repo.remove_seeded_contact_ids(PROJECT_ID, {shared})

    assert removed == 2
    assert shared not in s1.seeded_formation_contact_ids
    assert shared not in s2.seeded_formation_contact_ids
    assert other in s1.seeded_formation_contact_ids


# ---------------------------------------------------------------------------
# P3 — absent id is a no-op
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_remove_absent_id_is_noop() -> None:
    """P3: removing an id that is not seeded does not write and returns 0."""
    a = uuid4()
    section = _section([a])
    repo = _repo_over([section])

    removed = await repo.remove_seeded_contact_ids(PROJECT_ID, {uuid4()})

    assert removed == 0
    repo.update.assert_not_awaited()
    assert section.seeded_formation_contact_ids == [a]


# ---------------------------------------------------------------------------
# P4 — orphan GC sweeps stale ids (the 11,836 cleanup)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prune_orphans_drops_stale_ids() -> None:
    """P4: seeded ids with no live contact are removed on prune."""
    live1 = uuid4()
    dead1, dead2 = uuid4(), uuid4()
    section = _section([live1, dead1, dead2])
    repo = _repo_over([section])
    repo._live_contact_ids = AsyncMock(return_value={live1})

    pruned = await repo.prune_orphan_seeded_ids(PROJECT_ID)

    assert pruned == 2
    assert section.seeded_formation_contact_ids == [live1]


# ---------------------------------------------------------------------------
# P5 — orphan GC keeps ids that still reference a live contact
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prune_keeps_live_ids() -> None:
    """P5: live (incl. geological) contact ids survive the prune; debris only."""
    geo_live = uuid4()
    litho_live = uuid4()
    dead = uuid4()
    section = _section([geo_live, dead, litho_live])
    repo = _repo_over([section])
    repo._live_contact_ids = AsyncMock(return_value={geo_live, litho_live})

    pruned = await repo.prune_orphan_seeded_ids(PROJECT_ID)

    assert pruned == 1
    assert set(section.seeded_formation_contact_ids) == {geo_live, litho_live}
