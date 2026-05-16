"""Unit tests for UpdateFormationContact (debt #38).

Locks the stale-pair propagation rule that the pre-commit unit suite
was blind to: the post-update (model, formation) surface is always
flagged stale; the PRE-update formation is *also* flagged only when
the patch moved the contact to a different formation within the same
model (a re-anchor — the old surface just lost a contact).

Session mocked at the ``get`` / ``commit`` / ``refresh`` boundary;
repo swapped for an ``AsyncMock``.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from groundmodel.application.update_formation_contact import (
    UpdateFormationContact,
)

MODEL = uuid4()
F_OLD = uuid4()
F_NEW = uuid4()
CONTACT = uuid4()


def _use_case(session: AsyncMock) -> UpdateFormationContact:
    uc = UpdateFormationContact(session)
    uc._repo = AsyncMock()
    return uc


@pytest.mark.asyncio
async def test_returns_none_when_row_vanished_pre_update() -> None:
    """Row gone before the update (TOCTOU) → None, no repo call."""
    session = AsyncMock()
    session.get = AsyncMock(return_value=None)
    uc = _use_case(session)

    result = await uc.execute(CONTACT, {"depth_top_m": 3.0})

    assert result is None
    uc._repo.update_contact.assert_not_awaited()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_within_formation_edit_flips_one_pair() -> None:
    """A depth-only edit flips just the contact's own (model, formation)."""
    pre = SimpleNamespace(model_id=MODEL, formation_id=F_OLD)
    updated = SimpleNamespace(model_id=MODEL, formation_id=F_OLD)
    session = AsyncMock()
    session.get = AsyncMock(return_value=pre)
    uc = _use_case(session)
    uc._repo.update_contact = AsyncMock(return_value=updated)

    result = await uc.execute(CONTACT, {"depth_top_m": 3.0})

    assert result is updated
    uc._repo.mark_surfaces_stale.assert_awaited_once_with([(MODEL, F_OLD)])
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_reanchor_to_new_formation_flips_both_pairs() -> None:
    """Moving the contact to a new formation flips new then old pair."""
    pre = SimpleNamespace(model_id=MODEL, formation_id=F_OLD)
    updated = SimpleNamespace(model_id=MODEL, formation_id=F_NEW)
    session = AsyncMock()
    session.get = AsyncMock(return_value=pre)
    uc = _use_case(session)
    uc._repo.update_contact = AsyncMock(return_value=updated)

    await uc.execute(CONTACT, {"formation_id": str(F_NEW)})

    # New formation first, then the old one that just lost a contact.
    uc._repo.mark_surfaces_stale.assert_awaited_once_with([(MODEL, F_NEW), (MODEL, F_OLD)])


@pytest.mark.asyncio
async def test_returns_none_when_row_vanished_mid_update() -> None:
    """Row gone mid-update (repo returns None) → None, no stale flip."""
    pre = SimpleNamespace(model_id=MODEL, formation_id=F_OLD)
    session = AsyncMock()
    session.get = AsyncMock(return_value=pre)
    uc = _use_case(session)
    uc._repo.update_contact = AsyncMock(return_value=None)

    result = await uc.execute(CONTACT, {"depth_top_m": 3.0})

    assert result is None
    uc._repo.mark_surfaces_stale.assert_not_awaited()
    session.commit.assert_not_awaited()
