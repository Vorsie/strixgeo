"""Unit tests for EditLithoLayerComposition (installer #21: "Edit composition").

Pins the owner's rule in its own words — "an accepted silt can be made a sand
without deleting it" — plus the not-found scope guard, using mocked
collaborators so no DB is needed.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.edit_litho_layer_composition import EditLithoLayerComposition
from groundmodel.domain.value_objects.admixture import Admixture
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm


def _accepted_silt(*, layer_id, model_id, silt_formation_id, cpt_id) -> LithoLayerOrm:
    return LithoLayerOrm(
        id=layer_id,
        model_id=model_id,
        formation_id=silt_formation_id,
        borehole_id=None,
        cpt_id=cpt_id,
        depth_top_m=10.41,
        depth_base_m=16.72,
        status="accepted",
        source="segmenter",
        confidence="high",
    )


async def test_accepted_silt_can_be_made_a_sand_without_deleting_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Repointing an accepted SILT to ZAND resolves the sand unit and PATCHes the layer.

    The owner's rule: "an accepted silt can be made a sand without deleting it."
    The use case must resolve the ZAND unit (find-or-create) and repoint the
    layer's ``formation_id`` through the layer PATCH — never delete + recreate —
    leaving depths, anchor and status untouched.
    """
    model_id, cpt_id = uuid4(), uuid4()
    silt_id, sand_id = uuid4(), uuid4()
    layer_id = uuid4()
    pre = _accepted_silt(
        layer_id=layer_id, model_id=model_id, silt_formation_id=silt_id, cpt_id=cpt_id
    )

    # resolve_litho_formation returns the (new) ZAND unit for the target composition.
    sand_formation = MagicMock()
    sand_formation.id = sand_id
    monkeypatch.setattr(
        "groundmodel.application.edit_litho_layer_composition.resolve_litho_formation",
        AsyncMock(return_value=(sand_formation, True)),
    )

    # UpdateLithoLayer applies the PATCH; capture what it was asked to write.
    updated = _accepted_silt(
        layer_id=layer_id, model_id=model_id, silt_formation_id=sand_id, cpt_id=cpt_id
    )
    patch_calls: list[dict] = []

    class _FakeUpdate:
        def __init__(self, _session: object) -> None:
            pass

        async def execute(self, lid, patch, model_id=None):  # noqa: ANN001, D102
            patch_calls.append(patch)
            return updated

    monkeypatch.setattr(
        "groundmodel.application.edit_litho_layer_composition.UpdateLithoLayer", _FakeUpdate
    )
    fake_resolver = MagicMock()
    fake_resolver.return_value.execute = AsyncMock()
    monkeypatch.setattr(
        "groundmodel.application.edit_litho_layer_composition.ResolveLithoInstances", fake_resolver
    )

    uc = EditLithoLayerComposition(MagicMock())
    uc._session = MagicMock()
    uc._session.get = AsyncMock(return_value=pre)
    uc._session.refresh = AsyncMock()

    result = await uc.execute(
        project_id=uuid4(),
        model_id=model_id,
        layer_id=layer_id,
        litho_main_soil_code="ZAND",
        admixtures=(),
    )

    assert result is not None, "the layer must be repointed, never deleted"
    assert result.formation_id == sand_id
    # The PATCH repointed ONLY the formation — depths / anchor / status untouched.
    assert patch_calls == [{"formation_id": sand_id}]
    assert result.depth_top_m == 10.41 and result.depth_base_m == 16.72


async def test_missing_or_foreign_layer_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """A layer that does not exist / is not in the URL model is not-found (→ 404)."""
    pre = _accepted_silt(
        layer_id=uuid4(), model_id=uuid4(), silt_formation_id=uuid4(), cpt_id=uuid4()
    )
    resolve_spy = AsyncMock()
    monkeypatch.setattr(
        "groundmodel.application.edit_litho_layer_composition.resolve_litho_formation", resolve_spy
    )

    uc = EditLithoLayerComposition(MagicMock())
    uc._session = MagicMock()
    uc._session.get = AsyncMock(return_value=pre)

    # URL model id differs from the layer's own model → out of scope.
    result = await uc.execute(
        project_id=uuid4(),
        model_id=uuid4(),
        layer_id=pre.id,
        litho_main_soil_code="ZAND",
        admixtures=(Admixture(soil_code="KL", amount="Z", locally=False),),
    )
    assert result is None
    # Never mints a formation for a layer we cannot repoint.
    resolve_spy.assert_not_awaited()
