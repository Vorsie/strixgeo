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
