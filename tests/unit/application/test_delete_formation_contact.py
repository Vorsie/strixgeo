"""Unit tests for DeleteFormationContact.

Covers:
- stale-flip branch: (model, formation) surface is flagged stale ONLY when a
  row was actually removed AND the pre-image existed.
- idempotent no-op: already-absent contact returns False, no stale flip.
- litho cascade: when the model is ``kind='lithostratigraphic'``, the resolver
  and lens-detector are called after the delete.
- geological model: resolver + detector are NOT called for non-litho contacts.

Session mocked at the ``get`` / ``commit`` boundary; repo and sub-use-cases
swapped for ``AsyncMock``/``MagicMock``.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from groundmodel.application.delete_formation_contact import (
    DeleteFormationContact,
)

PROJECT = uuid4()
MODEL = uuid4()
FORMATION = uuid4()
CONTACT = uuid4()


def _pre_contact(model_id=MODEL, formation_id=FORMATION):
    """Minimal FormationContactOrm stand-in."""
    return SimpleNamespace(model_id=model_id, formation_id=formation_id)


def _geo_model(kind: str = "geological"):
    """Minimal GeologicalModelOrm stand-in."""
    return SimpleNamespace(kind=kind)


def _mock_session() -> AsyncMock:
    """An AsyncMock session whose ``execute()`` Result is synchronous.

    ``DeleteFormationContact`` takes the body-partition lock, which does
    ``(await session.execute(...)).scalar_one()``. On a bare ``AsyncMock()`` the
    awaited ``execute`` result is itself an AsyncMock, so ``.scalar_one()`` — a
    SYNC ``Result`` method — hands back an un-awaited coroutine ("coroutine was
    never awaited"). Wiring ``execute`` to return a ``MagicMock`` keeps the sync
    Result methods synchronous. ``execute`` itself stays an AsyncMock (awaitable).
    """
    session = AsyncMock()
    session.execute = AsyncMock(return_value=MagicMock())
    return session


def _use_case(session: AsyncMock) -> DeleteFormationContact:
    uc = DeleteFormationContact(session)
    uc._repo = AsyncMock()
    uc._sections = AsyncMock()
    return uc


# ---------------------------------------------------------------------------
# Stale-flip branch
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_flips_surface_stale_for_preimage_pair() -> None:
    """A real delete on a geological contact flips the pre-image stale."""
    session = _mock_session()
    # First get → FormationContactOrm; second get → GeologicalModelOrm (geological).
    session.get = AsyncMock(side_effect=[_pre_contact(), _geo_model("geological")])
    uc = _use_case(session)
    uc._repo.delete_contact = AsyncMock(return_value=True)

    ok = await uc.execute(CONTACT, project_id=PROJECT, model_id=MODEL)

    assert ok is True
    uc._repo.mark_surfaces_stale.assert_awaited_once_with([(MODEL, FORMATION)])
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_unseeds_contact_from_sections() -> None:
    """A real delete removes the contact id from every section's seeded set.

    Closes the seeded-array leak: the deleted contact must no longer be
    seeded on any section, in the SAME transaction (before commit) so the
    unseed is atomic with the delete.
    """
    session = _mock_session()
    session.get = AsyncMock(side_effect=[_pre_contact(), _geo_model("geological")])
    uc = _use_case(session)
    uc._repo.delete_contact = AsyncMock(return_value=True)

    ok = await uc.execute(CONTACT, project_id=PROJECT, model_id=MODEL)

    assert ok is True
    uc._sections.remove_seeded_contact_ids.assert_awaited_once_with(PROJECT, {CONTACT})
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_idempotent_delete_does_not_unseed() -> None:
    """An already-gone contact does not touch any section's seeded set."""
    session = _mock_session()
    session.get = AsyncMock(return_value=_pre_contact())
    uc = _use_case(session)
    uc._repo.delete_contact = AsyncMock(return_value=False)

    ok = await uc.execute(CONTACT, project_id=PROJECT, model_id=MODEL)

    assert ok is False
    uc._sections.remove_seeded_contact_ids.assert_not_awaited()


@pytest.mark.asyncio
async def test_already_absent_is_idempotent_no_stale_flip() -> None:
    """An already-gone contact → False, no stale flip (idempotent)."""
    session = _mock_session()
    session.get = AsyncMock(return_value=_pre_contact())
    uc = _use_case(session)
    # Row already gone — repo reports no deletion.
    uc._repo.delete_contact = AsyncMock(return_value=False)

    ok = await uc.execute(CONTACT, project_id=PROJECT, model_id=MODEL)

    assert ok is False
    uc._repo.mark_surfaces_stale.assert_not_awaited()
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_no_preimage_skips_stale_flip() -> None:
    """ok True but no pre-image → nothing to flip stale."""
    session = _mock_session()
    # First get → None (contact not found for stale-flip pre-image).
    # When ok is True and pre is None we reach the cascade branch, which
    # does a second get for the GeologicalModelOrm; return geological so
    # the cascade is skipped.
    session.get = AsyncMock(side_effect=[None, _geo_model("geological")])
    uc = _use_case(session)
    uc._repo.delete_contact = AsyncMock(return_value=True)

    ok = await uc.execute(CONTACT, project_id=PROJECT, model_id=MODEL)

    assert ok is True
    # ok True but pre is None → nothing to flip.
    uc._repo.mark_surfaces_stale.assert_not_awaited()


# ---------------------------------------------------------------------------
# Litho cascade
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_litho_cascade_runs_resolver_only() -> None:
    """For lithostratigraphic contacts, the resolver runs in the same
    transaction so instance ordinals stay coherent.  Lens detection is
    NOT called here — owner directive 2026-05-31 made it an explicit
    verb (``POST .../lenses/detect``).
    """
    session = _mock_session()
    session.get = AsyncMock(side_effect=[_pre_contact(), _geo_model("lithostratigraphic")])
    uc = _use_case(session)
    uc._repo.delete_contact = AsyncMock(return_value=True)

    with patch(
        "groundmodel.application.delete_formation_contact.ResolveLithoInstances"
    ) as MockResolver:
        resolver_instance = AsyncMock()
        MockResolver.return_value = resolver_instance

        ok = await uc.execute(CONTACT, project_id=PROJECT, model_id=MODEL)

    assert ok is True
    MockResolver.assert_called_once_with(session)
    resolver_instance.execute.assert_awaited_once_with(model_id=MODEL, commit=False)
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_geological_contact_skips_cascade() -> None:
    """Resolver is NOT called for geological contacts (no correlation edges)."""
    session = _mock_session()
    session.get = AsyncMock(side_effect=[_pre_contact(), _geo_model("geological")])
    uc = _use_case(session)
    uc._repo.delete_contact = AsyncMock(return_value=True)

    with patch(
        "groundmodel.application.delete_formation_contact.ResolveLithoInstances"
    ) as MockResolver:
        ok = await uc.execute(CONTACT, project_id=PROJECT, model_id=MODEL)

    assert ok is True
    MockResolver.assert_not_called()
