"""Unit tests for the ``GetBodyGeoLabels`` use case (BE-API-18 / ARCH-05).

The use case derives each body's majority geological-formation label
from the litho members + parent-geological-model contacts. All DB
interaction is mocked at the ``session.get`` / ``session.execute``
boundary — the aggregation itself delegates to the pure domain
``majority_geo_formation``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from groundmodel.application.get_body_geo_labels import BodyGeoLabel, GetBodyGeoLabels

MODEL_ID: UUID = uuid4()
GEO_MODEL_ID: UUID = uuid4()
BODY_ID: UUID = uuid4()
INV_ID: UUID = uuid4()
GEO_FID: UUID = uuid4()


def _result_with_rows(rows: list) -> MagicMock:
    """Wrap ``rows`` in a mock ``Result`` whose ``.all()`` returns them."""
    result = MagicMock()
    result.all.return_value = rows
    return result


@pytest.mark.asyncio
async def test_happy_path_labels_body_with_majority_formation() -> None:
    """A body whose members sit inside one geo formation gets that label.

    One accepted member layer 0–5 m at INV; the parent geological model
    has a single contact (top 0.0 m → GEO_FID) named "Formatie van
    Gent" — the body's derived label is (GEO_FID, that name).
    """
    session = AsyncMock()
    litho_model = MagicMock()
    litho_model.parent_model_id = GEO_MODEL_ID
    session.get.return_value = litho_model
    session.execute.side_effect = [
        # Member rows: (body_id, investigation_id, top, base).
        _result_with_rows([(BODY_ID, INV_ID, 0.0, 5.0)]),
        # Geo contact rows: (investigation_id, depth_top_m, formation_id).
        _result_with_rows([(INV_ID, 0.0, GEO_FID)]),
        # Formation name rows: (id, name).
        _result_with_rows([(GEO_FID, "Formatie van Gent")]),
    ]

    labels = await GetBodyGeoLabels(session).execute(litho_model_id=MODEL_ID, body_ids=[BODY_ID])

    assert labels == {
        BODY_ID: BodyGeoLabel(GEO_FID, "Formatie van Gent", [(GEO_FID, "Formatie van Gent")])
    }


@pytest.mark.asyncio
async def test_empty_body_ids_returns_empty_map_without_queries() -> None:
    """No bodies → empty map, and the session is never queried."""
    session = AsyncMock()

    labels = await GetBodyGeoLabels(session).execute(litho_model_id=MODEL_ID, body_ids=[])

    assert labels == {}
    session.get.assert_not_awaited()
    session.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_no_parent_geological_model_returns_empty_map() -> None:
    """A litho model without a parent geological model has no labels."""
    session = AsyncMock()
    litho_model = MagicMock()
    litho_model.parent_model_id = None
    session.get.return_value = litho_model

    labels = await GetBodyGeoLabels(session).execute(litho_model_id=MODEL_ID, body_ids=[BODY_ID])

    assert labels == {}
    session.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_unresolvable_body_maps_to_none_none() -> None:
    """A body whose investigation has no geo contacts maps to (None, None)."""
    session = AsyncMock()
    litho_model = MagicMock()
    litho_model.parent_model_id = GEO_MODEL_ID
    session.get.return_value = litho_model
    session.execute.side_effect = [
        _result_with_rows([(BODY_ID, INV_ID, 0.0, 5.0)]),
        # No geological contacts anywhere in the parent model.
        _result_with_rows([]),
        # NOTE: no third execute — with zero geo formation ids the
        # name query is skipped entirely.
    ]

    labels = await GetBodyGeoLabels(session).execute(litho_model_id=MODEL_ID, body_ids=[BODY_ID])

    assert labels == {BODY_ID: BodyGeoLabel(None, None, [])}
    assert session.execute.await_count == 2


@pytest.mark.asyncio
async def test_label_carries_the_full_list_of_crossed_formations() -> None:
    """R2: a body crossing two geo formations lists both, shallowest first.

    Owner ruling 2026-08-31 — the derived label is a LIST (every formation the
    body crosses), not just the majority stamp. A body with a thin Quartair
    member at one investigation and a thicker Pleistoceen member at another
    lists ``[(Quartair), (Pleistoceen)]`` shallowest first, while the majority
    singular stays the thickness winner (Pleistoceen).
    """
    q_fid = uuid4()
    p_fid = uuid4()
    inv_a = uuid4()
    inv_b = uuid4()
    session = AsyncMock()
    litho_model = MagicMock()
    litho_model.parent_model_id = GEO_MODEL_ID
    session.get.return_value = litho_model
    session.execute.side_effect = [
        # Two members: thin in Quartair at inv_a, thicker in Pleistoceen at inv_b.
        _result_with_rows(
            [
                (BODY_ID, inv_a, 0.0, 4.0),  # mid 2 -> Quartair, thickness 4
                (BODY_ID, inv_b, 10.0, 20.0),  # mid 15 -> Pleistoceen, thickness 10
            ]
        ),
        # Contacts: inv_a all Quartair, inv_b all Pleistoceen.
        _result_with_rows([(inv_a, 0.0, q_fid), (inv_b, 0.0, p_fid)]),
        # Names for both formations.
        _result_with_rows([(q_fid, "Quartair"), (p_fid, "Pleistoceen")]),
    ]

    labels = await GetBodyGeoLabels(session).execute(litho_model_id=MODEL_ID, body_ids=[BODY_ID])

    label = labels[BODY_ID]
    # The full crossed-formation list, shallowest first.
    assert label.formations == [(q_fid, "Quartair"), (p_fid, "Pleistoceen")]
    # The additive singular majority stays the thickness winner.
    assert (label.formation_id, label.formation_name) == (p_fid, "Pleistoceen")
