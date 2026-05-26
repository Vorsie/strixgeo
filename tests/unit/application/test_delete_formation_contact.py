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
from unittest.mock import AsyncMock, patch
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


def _use_case(session: AsyncMock) -> DeleteFormationContact:
    uc = DeleteFormationContact(session)
    uc._repo = AsyncMock()
    return uc


# ---------------------------------------------------------------------------
# Stale-flip branch
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_flips_surface_stale_for_preimage_pair() -> None:
    """A real delete on a geological contact flips the pre-image stale."""
    session = AsyncMock()
    # First get → FormationContactOrm; second get → GeologicalModelOrm (geological).
    session.get = AsyncMock(side_effect=[_pre_contact(), _geo_model("geological")])
    uc = _use_case(session)
    uc._repo.delete_contact = AsyncMock(return_value=True)

    ok = await uc.execute(CONTACT, project_id=PROJECT, model_id=MODEL)

    assert ok is True
    uc._repo.mark_surfaces_stale.assert_awaited_once_with([(MODEL, FORMATION)])
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_already_absent_is_idempotent_no_stale_flip() -> None:
    """An already-gone contact → False, no stale flip (idempotent)."""
    session = AsyncMock()
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
    session = AsyncMock()
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
async def test_litho_cascade_runs_resolver_and_lens_detector() -> None:
    """For lithostratigraphic contacts, resolver + lens detector are called."""
    session = AsyncMock()
    session.get = AsyncMock(side_effect=[_pre_contact(), _geo_model("lithostratigraphic")])
    uc = _use_case(session)
    uc._repo.delete_contact = AsyncMock(return_value=True)

    with (
        patch(
            "groundmodel.application.delete_formation_contact.ResolveLithoInstances"
        ) as MockResolver,
        patch("groundmodel.application.delete_formation_contact.DetectLithoLenses") as MockDetector,
    ):
        resolver_instance = AsyncMock()
        MockResolver.return_value = resolver_instance
        detector_instance = AsyncMock()
        MockDetector.return_value = detector_instance

        ok = await uc.execute(CONTACT, project_id=PROJECT, model_id=MODEL)

    assert ok is True
    MockResolver.assert_called_once_with(session)
    resolver_instance.execute.assert_awaited_once_with(model_id=MODEL, commit=False)
    MockDetector.assert_called_once_with(session)
    detector_instance.execute.assert_awaited_once_with(
        project_id=PROJECT,
        model_id=MODEL,
        prefer_section_id=None,
    )
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_geological_contact_skips_cascade() -> None:
    """Resolver + lens detector are NOT called for geological contacts."""
    session = AsyncMock()
    session.get = AsyncMock(side_effect=[_pre_contact(), _geo_model("geological")])
    uc = _use_case(session)
    uc._repo.delete_contact = AsyncMock(return_value=True)

    with (
        patch(
            "groundmodel.application.delete_formation_contact.ResolveLithoInstances"
        ) as MockResolver,
        patch("groundmodel.application.delete_formation_contact.DetectLithoLenses") as MockDetector,
    ):
        ok = await uc.execute(CONTACT, project_id=PROJECT, model_id=MODEL)

    assert ok is True
    MockResolver.assert_not_called()
    MockDetector.assert_not_called()
