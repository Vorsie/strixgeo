"""Unit tests for UpdateFormationContact (debt #38).

Locks the stale-pair propagation rule that the pre-commit unit suite
was blind to: the post-update (model, formation) surface is always
flagged stale; the PRE-update formation is *also* flagged only when
the patch moved the contact to a different formation within the same
model (a re-anchor — the old surface just lost a contact).

Also covers cross-merge direction logic (Bug C regression suite):

* Drag UP   (new_depth < old_depth) — dragger survives; all peers in
  [new_depth, old_depth) are deleted.
* Drag DOWN (new_depth > old_depth) — formation above absorbs dragger;
  all peers in (old_depth, new_depth] are deleted AND dragger is deleted;
  execute returns None with absorbed=True.

Session mocked at the ``get`` / ``commit`` / ``refresh`` boundary;
repo swapped for an ``AsyncMock``.  The cross-merge path also mocks
``session.execute`` to return a controlled peer list without a DB.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.update_formation_contact import (
    UpdateFormationContact,
)

MODEL = uuid4()
F_OLD = uuid4()
F_NEW = uuid4()
CONTACT = uuid4()


def _mock_session() -> AsyncMock:
    """An AsyncMock session whose ``execute()`` Result is synchronous.

    ``UpdateFormationContact`` takes the body-partition lock, which does
    ``(await session.execute(...)).scalar_one()``. On a bare ``AsyncMock()`` the
    awaited ``execute`` result is itself an AsyncMock, so ``.scalar_one()`` — a
    SYNC ``Result`` method — hands back an un-awaited coroutine ("coroutine was
    never awaited"). Wiring ``execute`` to return a ``MagicMock`` keeps the sync
    Result methods synchronous. ``execute`` itself stays an AsyncMock (awaitable).
    """
    session = AsyncMock()
    session.execute = AsyncMock(return_value=MagicMock())
    return session


def _use_case(session: AsyncMock) -> UpdateFormationContact:
    uc = UpdateFormationContact(session)
    uc._repo = AsyncMock()
    return uc


@pytest.mark.asyncio
async def test_returns_none_when_row_vanished_pre_update() -> None:
    """Row gone before the update (TOCTOU) → None, no repo call."""
    session = _mock_session()
    session.get = AsyncMock(return_value=None)
    uc = _use_case(session)

    result = await uc.execute(CONTACT, {"depth_top_m": 3.0})

    assert result is None
    uc._repo.update_contact.assert_not_awaited()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_within_formation_edit_flips_one_pair() -> None:
    """A depth-only edit flips just the contact's own (model, formation)."""
    # borehole_id=None + cpt_id=None → synthetic contact; cross-merge skipped
    # (no anchor filter). depth_top_m is included so is_depth_only is True
    # but the anchor guard short-circuits before querying peers.
    pre = SimpleNamespace(
        model_id=MODEL,
        formation_id=F_OLD,
        id=CONTACT,
        depth_top_m=5.0,
        borehole_id=None,
        cpt_id=None,
    )
    updated = SimpleNamespace(model_id=MODEL, formation_id=F_OLD)
    session = _mock_session()
    session.get = AsyncMock(return_value=pre)
    uc = _use_case(session)
    uc._repo.update_contact = AsyncMock(return_value=updated)

    result = await uc.execute(CONTACT, {"depth_top_m": 3.0})

    # Use case now returns FormationContactResult (debt #106) not the ORM row;
    # the identity check is replaced with a non-None check + field probe.
    assert result is not None
    assert result.model_id == updated.model_id
    assert result.formation_id == updated.formation_id
    uc._repo.mark_surfaces_stale.assert_awaited_once_with([(MODEL, F_OLD)])
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_reanchor_to_new_formation_flips_both_pairs() -> None:
    """Moving the contact to a new formation flips new then old pair."""
    pre = SimpleNamespace(model_id=MODEL, formation_id=F_OLD)
    updated = SimpleNamespace(model_id=MODEL, formation_id=F_NEW)
    session = _mock_session()
    session.get = AsyncMock(return_value=pre)
    uc = _use_case(session)
    uc._repo.update_contact = AsyncMock(return_value=updated)

    await uc.execute(CONTACT, {"formation_id": str(F_NEW)})

    # New formation first, then the old one that just lost a contact.
    uc._repo.mark_surfaces_stale.assert_awaited_once_with([(MODEL, F_NEW), (MODEL, F_OLD)])


@pytest.mark.asyncio
async def test_returns_none_when_row_vanished_mid_update() -> None:
    """Row gone mid-update (repo returns None) → None, no stale flip."""
    # Synthetic anchor so cross-merge is skipped and we reach the repo call.
    pre = SimpleNamespace(
        model_id=MODEL,
        formation_id=F_OLD,
        id=CONTACT,
        depth_top_m=5.0,
        borehole_id=None,
        cpt_id=None,
    )
    session = _mock_session()
    session.get = AsyncMock(return_value=pre)
    uc = _use_case(session)
    uc._repo.update_contact = AsyncMock(return_value=None)

    result = await uc.execute(CONTACT, {"depth_top_m": 3.0})

    assert result is None
    uc._repo.mark_surfaces_stale.assert_not_awaited()
    session.commit.assert_not_awaited()


# ---------------------------------------------------------------------------
# Cross-merge direction tests (Bug C regression suite, dogfeed 2026-05-26).
#
# These lock the drag-UP / drag-DOWN branching logic in execute() so that a
# future refactor cannot silently invert the winner without failing tests.
# ---------------------------------------------------------------------------


def _make_peer_session(pre: SimpleNamespace, peers: list[SimpleNamespace]) -> AsyncMock:
    """Build an AsyncMock session where execute().scalars().all() returns peers.

    Parameters
    ----------
    pre : SimpleNamespace
        The contact row returned by session.get (the dragger).
    peers : list[SimpleNamespace]
        Peer contacts returned by the scalar query.

    Returns
    -------
    AsyncMock
        Configured session mock.
    """
    session = _mock_session()
    session.get = AsyncMock(return_value=pre)

    # session.execute() returns an object whose .scalars().all() returns peers.
    scalars_result = MagicMock()
    scalars_result.all.return_value = peers
    execute_result = MagicMock()
    execute_result.scalars.return_value = scalars_result
    session.execute = AsyncMock(return_value=execute_result)

    # session.get for the model (litho cascade check) must return a geological model
    # so the litho cascade is skipped — we only want to test direction logic here.
    geo_model = SimpleNamespace(kind="geological", app_project_id=uuid4())

    # Make session.get return `pre` for the contact id and `geo_model` for the
    # model id.  Use a side_effect that dispatches by positional arg.
    async def _get_dispatch(cls, pk, **_kwargs):  # type: ignore[override]
        # cls is the ORM class, pk is the primary key.
        from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
        from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm

        if cls is FormationContactOrm:
            return pre
        if cls is GeologicalModelOrm:
            return geo_model
        return None

    session.get = _get_dispatch  # type: ignore[assignment]
    return session


@pytest.mark.asyncio
async def test_drag_up_dragger_wins_crossed_peer_deleted() -> None:
    """Drag UP: new_depth < old_depth → dragger survives; crossed peer deleted.

    Scenario (Bug C regression):
      - SAND dragger at depth 10m is dragged UP to 2m.
      - SILT peer at depth 5m sits in [2, 10) → must be deleted.
      - Dragger is NOT deleted (absorbed=False).
      - update_contact is called with the new depth.
    """
    bh_id = uuid4()
    silt_id = uuid4()
    updated_contact = SimpleNamespace(model_id=MODEL, formation_id=F_OLD)

    pre = SimpleNamespace(
        model_id=MODEL,
        formation_id=F_OLD,
        id=CONTACT,
        depth_top_m=10.0,  # SAND dragger at 10m
        borehole_id=bh_id,
        cpt_id=None,
    )
    silt_peer = SimpleNamespace(
        model_id=MODEL,
        formation_id=uuid4(),
        id=silt_id,
        depth_top_m=5.0,  # SILT peer at 5m — sits in [2, 10)
        borehole_id=bh_id,
        cpt_id=None,
    )
    session = _make_peer_session(pre, [silt_peer])
    uc = _use_case(session)
    uc._repo.update_contact = AsyncMock(return_value=updated_contact)

    result = await uc.execute(CONTACT, {"depth_top_m": 2.0})

    # Dragger survives with the new depth.
    # Use case now returns FormationContactResult (debt #106) not the ORM row.
    assert result is not None
    assert result.model_id == updated_contact.model_id
    assert result.formation_id == updated_contact.formation_id
    assert uc.absorbed is False
    # SILT peer was deleted.
    session.delete.assert_awaited_once_with(silt_peer)
    # update_contact was called for the dragger (normal update path).
    uc._repo.update_contact.assert_awaited_once()
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_drag_down_formation_above_wins_dragger_absorbed() -> None:
    """Drag DOWN: new_depth > old_depth → formation above absorbs dragger.

    Scenario:
      - SILT dragger at depth 5m is dragged DOWN to 12m.
      - SAND peer at depth 10m sits in (5, 12] → must be deleted.
      - Dragger itself is also deleted (absorbed=True).
      - execute returns None.
    """
    bh_id = uuid4()
    sand_id = uuid4()

    pre = SimpleNamespace(
        model_id=MODEL,
        formation_id=F_OLD,
        id=CONTACT,
        depth_top_m=5.0,  # SILT dragger at 5m
        borehole_id=bh_id,
        cpt_id=None,
    )
    sand_peer = SimpleNamespace(
        model_id=MODEL,
        formation_id=uuid4(),
        id=sand_id,
        depth_top_m=10.0,  # SAND peer at 10m — sits in (5, 12]
        borehole_id=bh_id,
        cpt_id=None,
    )
    session = _make_peer_session(pre, [sand_peer])
    uc = _use_case(session)
    # update_contact must NOT be called on the absorbed path.

    result = await uc.execute(CONTACT, {"depth_top_m": 12.0})

    # Formation above absorbed the dragger → None returned.
    assert result is None
    assert uc.absorbed is True
    # Both the peer AND the dragger were deleted.
    deleted_ids = {call.args[0].id for call in session.delete.call_args_list}
    assert sand_id in deleted_ids
    assert CONTACT in deleted_ids
    # update_contact must NOT have been called.
    uc._repo.update_contact.assert_not_awaited()


# ---------------------------------------------------------------------------
# deleted_contact_ids reporting (installer #20 dogfeed, 2026-09-06).
#
# Owner ruling: "after a drag that crosses other boundaries, the crossed
# boundaries are gone from the section at once, and deleting them again is
# never offered."  The use case must RECORD every contact id it deletes so the
# router can name them and the renderer can prune them at once — otherwise the
# crossed peers linger in the section and a second delete of them 404s.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_drag_up_records_crossed_peer_in_deleted_contact_ids() -> None:
    """Drag UP naming: the crossed peer's id is reported in deleted_contact_ids.

    The dragger survives, and the boundary it crossed on the way up is named
    in ``deleted_contact_ids`` so the renderer can drop it from the section at
    once (never offering to delete it a second time).
    """
    bh_id = uuid4()
    silt_id = uuid4()
    updated_contact = SimpleNamespace(model_id=MODEL, formation_id=F_OLD)

    pre = SimpleNamespace(
        model_id=MODEL,
        formation_id=F_OLD,
        id=CONTACT,
        depth_top_m=10.0,
        borehole_id=bh_id,
        cpt_id=None,
    )
    silt_peer = SimpleNamespace(
        model_id=MODEL,
        formation_id=uuid4(),
        id=silt_id,
        depth_top_m=5.0,  # crossed on the way from 10m up to 2m
        borehole_id=bh_id,
        cpt_id=None,
    )
    session = _make_peer_session(pre, [silt_peer])
    uc = _use_case(session)
    uc._repo.update_contact = AsyncMock(return_value=updated_contact)

    result = await uc.execute(CONTACT, {"depth_top_m": 2.0})

    assert result is not None
    assert uc.absorbed is False
    # The crossed boundary is named so the section drops it at once.
    assert uc.deleted_contact_ids == [silt_id]


@pytest.mark.asyncio
async def test_drag_down_absorbed_reports_crossed_peers_not_the_dragger() -> None:
    """Drag DOWN absorbed: deleted_contact_ids names the crossed PEERS only.

    The absorbed dragger's own death is signalled by ``absorbed=True``; the
    ``deleted_contact_ids`` list carries the OTHER boundaries the drag crossed
    (the renderer already knows the dragger's id from the URL).
    """
    bh_id = uuid4()
    sand_id = uuid4()

    pre = SimpleNamespace(
        model_id=MODEL,
        formation_id=F_OLD,
        id=CONTACT,
        depth_top_m=5.0,
        borehole_id=bh_id,
        cpt_id=None,
    )
    sand_peer = SimpleNamespace(
        model_id=MODEL,
        formation_id=uuid4(),
        id=sand_id,
        depth_top_m=10.0,  # crossed on the way from 5m down to 12m
        borehole_id=bh_id,
        cpt_id=None,
    )
    session = _make_peer_session(pre, [sand_peer])
    uc = _use_case(session)

    result = await uc.execute(CONTACT, {"depth_top_m": 12.0})

    assert result is None
    assert uc.absorbed is True
    # Only the crossed peer is named; the dragger is NOT in the list.
    assert uc.deleted_contact_ids == [sand_id]
    assert CONTACT not in uc.deleted_contact_ids


@pytest.mark.asyncio
async def test_plain_update_reports_empty_deleted_contact_ids() -> None:
    """A depth edit that crosses nothing reports an empty deleted_contact_ids."""
    pre = SimpleNamespace(
        model_id=MODEL,
        formation_id=F_OLD,
        id=CONTACT,
        depth_top_m=5.0,
        borehole_id=None,
        cpt_id=None,
    )
    updated = SimpleNamespace(model_id=MODEL, formation_id=F_OLD)
    session = _mock_session()
    session.get = AsyncMock(return_value=pre)
    uc = _use_case(session)
    uc._repo.update_contact = AsyncMock(return_value=updated)

    result = await uc.execute(CONTACT, {"depth_top_m": 3.0})

    assert result is not None
    assert uc.deleted_contact_ids == []


@pytest.mark.asyncio
async def test_drag_up_no_peers_in_range_no_deletion() -> None:
    """Drag UP with no peers in range: dragger moves, nothing deleted."""
    bh_id = uuid4()
    updated_contact = SimpleNamespace(model_id=MODEL, formation_id=F_OLD)

    pre = SimpleNamespace(
        model_id=MODEL,
        formation_id=F_OLD,
        id=CONTACT,
        depth_top_m=10.0,
        borehole_id=bh_id,
        cpt_id=None,
    )
    # Peer ABOVE the new depth (0.5m) — not in [2, 10) so must NOT be deleted.
    peer_above = SimpleNamespace(
        model_id=MODEL,
        formation_id=uuid4(),
        id=uuid4(),
        depth_top_m=0.5,
        borehole_id=bh_id,
        cpt_id=None,
    )
    session = _make_peer_session(pre, [peer_above])
    uc = _use_case(session)
    uc._repo.update_contact = AsyncMock(return_value=updated_contact)

    result = await uc.execute(CONTACT, {"depth_top_m": 2.0})

    # Use case now returns FormationContactResult (debt #106) not the ORM row.
    assert result is not None
    assert result.model_id == updated_contact.model_id
    assert result.formation_id == updated_contact.formation_id
    assert uc.absorbed is False
    # No peer was in the crossed range — no delete call.
    session.delete.assert_not_awaited()
    uc._repo.update_contact.assert_awaited_once()
