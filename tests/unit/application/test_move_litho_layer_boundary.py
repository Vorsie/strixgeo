"""Unit tests for MoveLithoLayerBoundary validation branches (audit #8).

The boundary-drag write path is the sole entry point for moving the shared
contact between two adjacent litho layers, and had no unit coverage. These
tests exercise the four validation branches that raise ``BoundaryMoveError``
BEFORE any commit, using a mocked repository so no DB is needed.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.move_litho_layer_boundary import (
    BoundaryMoveError,
    MoveLithoLayerBoundary,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm


@pytest.fixture(autouse=True)
def _neutralize_body_partition_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    """Neutralise the body-partition advisory lock for these mocked-session tests.

    These predate the lock and mock the session, which has nothing to answer the
    lock's real DB calls (``pg_advisory_xact_lock`` + the sibling-geotech SELECT).
    The lock is infrastructure orthogonal to what they assert; its
    order-of-acquisition invariant is pinned separately in
    ``test_litho_write_lock_order.py`` (BP-4).
    """

    async def _noop_lock(*_a: object, **_k: object) -> None:
        return None

    async def _noop_siblings(*_a: object, **_k: object) -> list:
        return []

    monkeypatch.setattr(
        "groundmodel.application.move_litho_layer_boundary.lock_body_partition", _noop_lock
    )
    monkeypatch.setattr(
        "groundmodel.application.move_litho_layer_boundary.lock_sibling_geotech_partitions",
        _noop_siblings,
    )


def _layer(
    *,
    layer_id,
    depth_top_m: float,
    depth_base_m: float,
    borehole_id=None,
    cpt_id=None,
    model_id=None,
) -> LithoLayerOrm:
    """Build an in-memory LithoLayerOrm (no session) with the read fields set."""
    return LithoLayerOrm(
        id=layer_id,
        model_id=model_id or uuid4(),
        formation_id=uuid4(),
        borehole_id=borehole_id,
        cpt_id=cpt_id,
        depth_top_m=depth_top_m,
        depth_base_m=depth_base_m,
        status="accepted",
        source="manual",
        confidence="medium",
    )


def _use_case_with_rows(rows: list[LithoLayerOrm]) -> MoveLithoLayerBoundary:
    """Return a use case whose repo returns ``rows`` and a stubbed session."""
    uc = MoveLithoLayerBoundary(MagicMock())
    uc._repo = MagicMock()
    uc._repo.list_layers_by_ids = AsyncMock(return_value=rows)
    uc._repo.mark_litho_solids_stale = AsyncMock()
    # Awaited only on the coupled-contact path; stubbed for every case so a test that
    # does not care about geological staleness is not the one that discovers it.
    uc._repo.mark_geo_surfaces_stale = AsyncMock()
    return uc


async def test_missing_layer_raises() -> None:
    """A layer id not returned by the repo is rejected as not-found."""
    upper_id, lower_id = uuid4(), uuid4()
    bh = uuid4()
    upper = _layer(layer_id=upper_id, depth_top_m=0.0, depth_base_m=2.0, borehole_id=bh)
    # Repo only returns the upper layer → lower is missing.
    uc = _use_case_with_rows([upper])
    with pytest.raises(BoundaryMoveError, match="not found"):
        await uc.execute(upper_id, lower_id, 1.0)


async def test_mismatched_anchor_raises() -> None:
    """Upper and lower on different anchors is rejected."""
    upper_id, lower_id = uuid4(), uuid4()
    upper = _layer(layer_id=upper_id, depth_top_m=0.0, depth_base_m=2.0, borehole_id=uuid4())
    lower = _layer(layer_id=lower_id, depth_top_m=2.0, depth_base_m=4.0, cpt_id=uuid4())
    uc = _use_case_with_rows([upper, lower])
    with pytest.raises(BoundaryMoveError, match="same anchor"):
        await uc.execute(upper_id, lower_id, 1.0)


async def test_non_adjacent_raises() -> None:
    """upper.depth_base_m must equal lower.depth_top_m (within tolerance)."""
    upper_id, lower_id = uuid4(), uuid4()
    bh = uuid4()
    upper = _layer(layer_id=upper_id, depth_top_m=0.0, depth_base_m=2.0, borehole_id=bh)
    # lower.top = 3.0 != upper.base = 2.0 → non-adjacent.
    lower = _layer(layer_id=lower_id, depth_top_m=3.0, depth_base_m=5.0, borehole_id=bh)
    uc = _use_case_with_rows([upper, lower])
    with pytest.raises(BoundaryMoveError, match="must equal"):
        await uc.execute(upper_id, lower_id, 1.0)


async def test_new_depth_below_min_thickness_raises() -> None:
    """A new boundary that collapses either layer below the min thickness is rejected."""
    upper_id, lower_id = uuid4(), uuid4()
    bh = uuid4()
    upper = _layer(layer_id=upper_id, depth_top_m=0.0, depth_base_m=2.0, borehole_id=bh)
    lower = _layer(layer_id=lower_id, depth_top_m=2.0, depth_base_m=4.0, borehole_id=bh)
    uc = _use_case_with_rows([upper, lower])
    # new_depth == upper.top → upper layer would be zero-thickness.
    with pytest.raises(BoundaryMoveError, match="thick"):
        await uc.execute(upper_id, lower_id, 0.0)


async def test_adjacency_tolerance_allows_tiny_float_gap() -> None:
    """A sub-1e-6 mismatch from a prior drag does not reject (validation passes).

    The repo commit is stubbed, so reaching the apply step (no BoundaryMoveError
    on the adjacency check) is what this asserts.
    """
    upper_id, lower_id = uuid4(), uuid4()
    bh = uuid4()
    upper = _layer(layer_id=upper_id, depth_top_m=0.0, depth_base_m=2.0000000001, borehole_id=bh)
    lower = _layer(layer_id=lower_id, depth_top_m=2.0, depth_base_m=4.0, borehole_id=bh)
    uc = _use_case_with_rows([upper, lower])
    uc._session.flush = AsyncMock()
    uc._session.commit = AsyncMock()
    uc._session.refresh = AsyncMock()
    result = await uc.execute(upper_id, lower_id, 1.0)
    assert result.upper.depth_base_m == 1.0
    assert result.lower.depth_top_m == 1.0


# ---------------------------------------------------------------------------
# The coupled geological contact (design §3)
# ---------------------------------------------------------------------------
#
# A third of this model's litho layers are derived from a geological contact and
# carry ``parent_geo_contact_id``. When such a boundary moves, the geological
# contact IS that boundary — leaving it behind splits one physical surface into
# two records that disagree, and the disagreement is invisible until something
# downstream reconciles them.
#
# The design's words: the geological contact moves "in the same transaction, so
# the coupling can never be left half-applied". A second write after the commit
# does not satisfy that — anything between the two (a cancel, a failed request,
# a crash) leaves exactly the half-applied state the sentence forbids.


async def test_coupled_geo_contact_moves_with_the_boundary() -> None:
    """A moved boundary carries its parent geological contact to the new depth."""
    upper_id, lower_id = uuid4(), uuid4()
    bh, geo_contact_id = uuid4(), uuid4()
    upper = _layer(layer_id=upper_id, depth_top_m=0.0, depth_base_m=2.0, borehole_id=bh)
    lower = _layer(layer_id=lower_id, depth_top_m=2.0, depth_base_m=4.0, borehole_id=bh)
    # The boundary IS the lower layer's top, so the coupling that matters is the
    # LOWER row's: the upper layer's parent describes its own top, metres away.
    lower.parent_geo_contact_id = geo_contact_id
    uc = _use_case_with_rows([upper, lower])
    geo = MagicMock()
    geo.id = geo_contact_id
    geo.depth_top_m = 2.0
    uc._repo.get_formation_contact = AsyncMock(return_value=geo)
    uc._session.flush = AsyncMock()
    uc._session.commit = AsyncMock()
    uc._session.refresh = AsyncMock()

    await uc.execute(upper_id, lower_id, 3.0)

    assert geo.depth_top_m == 3.0, "the coupled geological contact must follow the boundary"
    # Same transaction: the geological row is mutated BEFORE the single commit, so
    # there is no window in which the two models disagree.
    assert uc._session.commit.await_count == 1


async def test_uncoupled_boundary_touches_no_geological_contact() -> None:
    """A layer with no parent geological contact triggers no geological read."""
    upper_id, lower_id = uuid4(), uuid4()
    bh = uuid4()
    upper = _layer(layer_id=upper_id, depth_top_m=0.0, depth_base_m=2.0, borehole_id=bh)
    lower = _layer(layer_id=lower_id, depth_top_m=2.0, depth_base_m=4.0, borehole_id=bh)
    lower.parent_geo_contact_id = None
    uc = _use_case_with_rows([upper, lower])
    uc._repo.get_formation_contact = AsyncMock()
    uc._session.flush = AsyncMock()
    uc._session.commit = AsyncMock()
    uc._session.refresh = AsyncMock()

    await uc.execute(upper_id, lower_id, 3.0)

    uc._repo.get_formation_contact.assert_not_awaited()


async def test_coupled_geo_move_marks_its_surface_stale() -> None:
    """Carrying the geological contact invalidates the TIN built from it.

    The surface was interpolated through the contact at its OLD depth; moving the
    contact and leaving the surface fresh leaves the 3-D model showing a boundary
    the 2-D section no longer agrees with, with nothing on screen saying so. Every
    other contact-mutating use case stales here, and this one is a contact mutation
    wearing a boundary-move's clothes.
    """
    upper_id, lower_id = uuid4(), uuid4()
    bh, geo_contact_id = uuid4(), uuid4()
    upper = _layer(layer_id=upper_id, depth_top_m=0.0, depth_base_m=2.0, borehole_id=bh)
    lower = _layer(layer_id=lower_id, depth_top_m=2.0, depth_base_m=4.0, borehole_id=bh)
    lower.parent_geo_contact_id = geo_contact_id
    uc = _use_case_with_rows([upper, lower])
    geo = MagicMock()
    geo.id = geo_contact_id
    geo.depth_top_m = 2.0
    geo.model_id = uuid4()
    geo.formation_id = uuid4()
    uc._repo.get_formation_contact = AsyncMock(return_value=geo)
    uc._repo.mark_geo_surfaces_stale = AsyncMock()
    uc._session.flush = AsyncMock()
    uc._session.commit = AsyncMock()
    uc._session.refresh = AsyncMock()

    await uc.execute(upper_id, lower_id, 3.0)

    uc._repo.mark_geo_surfaces_stale.assert_awaited_once_with([(geo.model_id, geo.formation_id)])
