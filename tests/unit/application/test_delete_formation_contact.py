"""Unit tests for DeleteFormationContact (debt #38).

Covers the stale-flip branch the pre-commit unit suite was blind to:
the (model, formation) surface is flagged stale ONLY when a row was
actually removed AND the pre-image existed; an already-absent contact
is an idempotent no-op (returns False, no stale flip).

Session mocked at the ``get`` / ``commit`` boundary; repo swapped for
an ``AsyncMock``.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from groundmodel.application.delete_formation_contact import (
    DeleteFormationContact,
)

MODEL = uuid4()
FORMATION = uuid4()
CONTACT = uuid4()


def _use_case(session: AsyncMock) -> DeleteFormationContact:
    uc = DeleteFormationContact(session)
    uc._repo = AsyncMock()
    return uc


@pytest.mark.asyncio
async def test_delete_flips_surface_stale_for_preimage_pair() -> None:
    """A real delete flips the pre-image (model, formation) stale."""
    pre = SimpleNamespace(model_id=MODEL, formation_id=FORMATION)
    session = AsyncMock()
    session.get = AsyncMock(return_value=pre)
    uc = _use_case(session)
    uc._repo.delete_contact = AsyncMock(return_value=True)

    ok = await uc.execute(CONTACT)

    assert ok is True
    uc._repo.mark_surfaces_stale.assert_awaited_once_with([(MODEL, FORMATION)])
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_already_absent_is_idempotent_no_stale_flip() -> None:
    """An already-gone contact → False, no stale flip (idempotent)."""
    pre = SimpleNamespace(model_id=MODEL, formation_id=FORMATION)
    session = AsyncMock()
    session.get = AsyncMock(return_value=pre)
    uc = _use_case(session)
    # Row already gone — repo reports no deletion.
    uc._repo.delete_contact = AsyncMock(return_value=False)

    ok = await uc.execute(CONTACT)

    assert ok is False
    uc._repo.mark_surfaces_stale.assert_not_awaited()
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_no_preimage_skips_stale_flip() -> None:
    """ok True but no pre-image → nothing to flip stale."""
    session = AsyncMock()
    session.get = AsyncMock(return_value=None)
    uc = _use_case(session)
    uc._repo.delete_contact = AsyncMock(return_value=True)

    ok = await uc.execute(CONTACT)

    assert ok is True
    # ok True but pre is None → nothing to flip.
    uc._repo.mark_surfaces_stale.assert_not_awaited()
