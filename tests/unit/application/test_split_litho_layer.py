"""Unit tests for SplitLithoLayer (installer #21: "Split here").

Pins the owner's rule in its own words — "an accepted layer can be split at a
depth into two layers that keep the composition" — plus the min-thickness guard
and the not-found scope guard, using a mocked repository/session so no DB is
needed (mirrors ``test_move_litho_layer_boundary.py``).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.split_litho_layer import (
    SplitError,
    SplitLithoLayer,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm


@pytest.fixture(autouse=True)
def _neutralize_lock_and_resolver(monkeypatch: pytest.MonkeyPatch) -> None:
    """Neutralise the partition lock + instance resolver for the mocked-session tests.

    The advisory lock has nothing to answer against a mocked session, and
    ResolveLithoInstances is exercised by its own suite; both are orthogonal to
    the split's own arithmetic + atomicity, which is what these assert.
    """

    async def _noop(*_a: object, **_k: object) -> None:
        return None

    async def _noop_siblings(*_a: object, **_k: object) -> list:
        return []

    monkeypatch.setattr("groundmodel.application.split_litho_layer.lock_body_partition", _noop)
    monkeypatch.setattr(
        "groundmodel.application.split_litho_layer.lock_sibling_geotech_partitions",
        _noop_siblings,
    )
    fake_resolver = MagicMock()
    fake_resolver.return_value.execute = AsyncMock()
    monkeypatch.setattr(
        "groundmodel.application.split_litho_layer.ResolveLithoInstances", fake_resolver
    )


def _layer(
    *,
    layer_id,
    depth_top_m: float,
    depth_base_m: float,
    formation_id=None,
    model_id=None,
    cpt_id=None,
) -> LithoLayerOrm:
    """Build an in-memory accepted LithoLayerOrm (no session)."""
    return LithoLayerOrm(
        id=layer_id,
        model_id=model_id or uuid4(),
        formation_id=formation_id or uuid4(),
        borehole_id=None,
        cpt_id=cpt_id or uuid4(),
        depth_top_m=depth_top_m,
        depth_base_m=depth_base_m,
        status="accepted",
        source="segmenter",
        confidence="high",
    )


def _use_case_for(pre: LithoLayerOrm) -> SplitLithoLayer:
    """Return a SplitLithoLayer whose session/repo are stubbed around ``pre``."""
    uc = SplitLithoLayer(MagicMock())
    uc._session = MagicMock()
    uc._session.get = AsyncMock(return_value=pre)
    uc._session.commit = AsyncMock()
    uc._session.refresh = AsyncMock()
    uc._repo = MagicMock()
    uc._repo.mark_litho_solids_stale = AsyncMock()

    async def _create_layer(**kwargs: object) -> LithoLayerOrm:
        # Reflect the kwargs so the returned bottom row carries what the use case
        # asked for — the "keeps composition" assertion reads it back.
        return LithoLayerOrm(id=uuid4(), **kwargs)

    uc._repo.create_layer = AsyncMock(side_effect=_create_layer)
    return uc


async def test_split_produces_two_layers_that_keep_the_composition() -> None:
    """An accepted layer split at a depth becomes two layers with the SAME formation.

    The rule in the owner's words: "an accepted layer can be split at a depth into
    two layers that keep the composition." Top keeps the original row (base shrunk
    to the split depth); bottom is a fresh row [depth, original_base]; both carry
    the original ``formation_id``.
    """
    model_id, cpt_id, formation_id = uuid4(), uuid4(), uuid4()
    pre = _layer(
        layer_id=uuid4(),
        depth_top_m=10.41,
        depth_base_m=16.94,
        formation_id=formation_id,
        model_id=model_id,
        cpt_id=cpt_id,
    )
    uc = _use_case_for(pre)

    result = await uc.execute(project_id=uuid4(), model_id=model_id, layer_id=pre.id, depth_m=16.72)

    assert result is not None
    # Top half: original row, base moved to the split depth.
    assert result.top.depth_top_m == 10.41
    assert result.top.depth_base_m == 16.72
    # Bottom half: a NEW row from the split depth to the original base.
    assert result.bottom.depth_top_m == 16.72
    assert result.bottom.depth_base_m == 16.94
    # Composition kept: both layers share the original formation + anchor.
    assert result.top.formation_id == formation_id
    assert result.bottom.formation_id == formation_id
    assert result.bottom.cpt_id == cpt_id
    assert result.bottom.status == "accepted"
    # Atomic: one commit for the shrink + the insert.
    assert uc._session.commit.await_count == 1


async def test_split_depth_below_min_thickness_raises() -> None:
    """A split that would leave a hair-thin half is rejected (router → 422)."""
    model_id = uuid4()
    pre = _layer(layer_id=uuid4(), depth_top_m=10.0, depth_base_m=16.0, model_id=model_id)
    uc = _use_case_for(pre)
    # A split 0.0001 m below the top leaves the top half far below the 1 mm floor.
    with pytest.raises(SplitError, match="thick"):
        await uc.execute(project_id=uuid4(), model_id=model_id, layer_id=pre.id, depth_m=10.0001)
    uc._session.commit.assert_not_awaited()


async def test_split_missing_or_foreign_layer_returns_none() -> None:
    """A layer that does not exist / is not in the URL model is not-found (→ 404)."""
    pre = _layer(layer_id=uuid4(), depth_top_m=0.0, depth_base_m=5.0, model_id=uuid4())
    uc = _use_case_for(pre)
    # The URL model id differs from the layer's own model → out of scope.
    result = await uc.execute(project_id=uuid4(), model_id=uuid4(), layer_id=pre.id, depth_m=2.0)
    assert result is None
    uc._session.commit.assert_not_awaited()
