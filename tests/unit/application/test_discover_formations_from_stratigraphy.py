"""Unit tests for the discover-from-stratigraphy scan logic.

Tests cover:
- happy path: formal + informal stratigraphy, borehole_count aggregation, sort order
- informal-only fallback: no formal observation → uses informal stream
- structural error: no stratigraphy on any borehole → empty result
- empty borehole list → empty result (early exit, no DB hit)
- layers with empty/blank description → skipped
- negative top_m layers → skipped (positive zero allowed)
- key and regional_ref fields on StratigraphyCandidate (added 2026-05-16)

The DB session is mocked at the ``session.execute`` boundary; no real DB or
network I/O is performed.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
    scan_stratigraphy_candidates,
)
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.shared.formation_key import normalize_formation_key

# ---------------------------------------------------------------------------
# Helpers — lightweight stand-ins for ObservationOrm / ObservationLayerOrm
# ---------------------------------------------------------------------------


def _layer(
    *,
    top_m: float,
    base_m: float,
    description: str | None = "Boom Klei",
) -> SimpleNamespace:
    """Build a minimal observation-layer stub."""
    return SimpleNamespace(
        id=uuid4(),
        top_m=top_m,
        base_m=base_m,
        description=description,
    )


def _observation(kind: ObservationType, layers: list) -> SimpleNamespace:
    """Build a minimal observation stub."""
    return SimpleNamespace(
        observation_type=kind.value,
        layers=layers,
    )


def _borehole(observations: list) -> SimpleNamespace:
    """Build a minimal borehole stub."""
    return SimpleNamespace(
        id=uuid4(),
        observations=observations,
    )


def _make_session(boreholes: list) -> AsyncMock:
    """Build a mock session whose ``execute`` returns the given boreholes."""
    result_mock = MagicMock()
    result_mock.scalars.return_value.all.return_value = boreholes

    session = AsyncMock()
    session.execute = AsyncMock(return_value=result_mock)
    return session


def _dual_stream_borehole(
    *,
    formal_code: str,
    informal_name: str,
    top_m: float = 2.0,
    base_m: float = 10.0,
) -> SimpleNamespace:
    """Build a dual-stream borehole: one formal + one informal layer that overlap.

    Mirrors a real DOV boring that carries BOTH a formal-stratigraphy code
    (``formal_code``) and an informal working name (``informal_name``) for the
    same depth interval — the pairing the fill dialog reads.
    """
    return _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=top_m, base_m=base_m, description=formal_code)],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=top_m, base_m=base_m, description=informal_name)],
            ),
        ]
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_happy_path_formal_and_informal():
    """Two boreholes share 'Boom Klei' — borehole_count should be 2.

    Synthetic non-DOV formal code: keeps this legacy test on derivation
    mechanics; real DOV codes resolve via the #59 lexicon (see the
    auto_populate C-series).
    """
    project_id = uuid4()

    formal_layer_1 = _layer(top_m=2.0, base_m=10.0, description="XxFm")
    informal_layer_1 = _layer(top_m=2.0, base_m=10.0, description="Boom Klei")
    bh1 = _borehole(
        [
            _observation(ObservationType.FORMAL_STRATIGRAPHY, [formal_layer_1]),
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [informal_layer_1]),
        ]
    )

    formal_layer_2 = _layer(top_m=3.0, base_m=12.0, description="XxFm")
    informal_layer_2 = _layer(top_m=3.0, base_m=12.0, description="Boom Klei")
    bh2 = _borehole(
        [
            _observation(ObservationType.FORMAL_STRATIGRAPHY, [formal_layer_2]),
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [informal_layer_2]),
        ]
    )

    session = _make_session([bh1, bh2])
    candidates, collisions = await scan_stratigraphy_candidates(
        session,
        project_id=project_id,
        borehole_ids=[bh1.id, bh2.id],
    )

    assert len(candidates) == 1
    assert collisions == []
    assert candidates[0].name == "Boom Klei"
    assert candidates[0].regional_ref == "XxFm"
    assert candidates[0].key == "xxfm"  # normalize_formation_key(regional_ref)
    assert candidates[0].borehole_count == 2


@pytest.mark.asyncio
async def test_informal_fallback_when_no_formal():
    """A borehole with informal-only stratigraphy contributes its informal name."""
    project_id = uuid4()
    informal_layer = _layer(top_m=0.0, base_m=5.0, description="Alluvium")
    bh = _borehole(
        [
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [informal_layer]),
        ]
    )

    session = _make_session([bh])
    candidates, collisions = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )

    assert len(candidates) == 1
    assert collisions == []
    assert candidates[0].name == "Alluvium"
    assert candidates[0].regional_ref is None
    assert candidates[0].key == "alluvium"  # normalize_formation_key(name)
    assert candidates[0].borehole_count == 1


@pytest.mark.asyncio
async def test_no_stratigraphy_returns_empty():
    """Borehole has no stratigraphy observation → empty result."""
    project_id = uuid4()
    bh = _borehole([])  # no observations at all

    session = _make_session([bh])
    candidates, collisions = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )

    assert candidates == []
    assert collisions == []


@pytest.mark.asyncio
async def test_empty_borehole_ids_returns_empty_without_db_hit():
    """Empty borehole_ids list → early exit, session.execute never called."""
    project_id = uuid4()
    session = AsyncMock()
    session.execute = AsyncMock()

    candidates, collisions = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[]
    )

    assert candidates == []
    assert collisions == []
    session.execute.assert_not_called()


@pytest.mark.asyncio
async def test_blank_description_layer_is_skipped():
    """Layers with empty or whitespace-only descriptions are not candidates."""
    project_id = uuid4()
    blank_layer = _layer(top_m=0.0, base_m=5.0, description="   ")
    none_layer = _layer(top_m=5.0, base_m=10.0, description=None)
    real_layer = _layer(top_m=10.0, base_m=20.0, description="Diest Zand")
    bh = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY, [blank_layer, none_layer, real_layer]
            ),
        ]
    )

    session = _make_session([bh])
    candidates, collisions = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )

    assert len(candidates) == 1
    assert collisions == []
    assert candidates[0].name == "Diest Zand"


@pytest.mark.asyncio
async def test_negative_top_m_layer_is_skipped():
    """Layers with top_m < 0 are invalid and must not appear as candidates."""
    project_id = uuid4()
    bad_layer = _layer(top_m=-1.0, base_m=5.0, description="Invalid")
    good_layer = _layer(top_m=0.0, base_m=5.0, description="Quaternary")
    bh = _borehole(
        [
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [bad_layer, good_layer]),
        ]
    )

    session = _make_session([bh])
    candidates, collisions = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )

    assert len(candidates) == 1
    assert collisions == []
    assert candidates[0].name == "Quaternary"


@pytest.mark.asyncio
async def test_sort_order_by_borehole_count_then_name():
    """Candidates are sorted borehole_count DESC, then name ASC."""
    project_id = uuid4()

    # bh1 and bh2 both have "Boom Klei" (count=2)
    # bh1 also has "Alluvium" (count=1)
    # bh2 also has "Zand" (count=1)
    bh1 = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [
                    _layer(top_m=0.0, base_m=2.0, description="Alluvium"),
                    _layer(top_m=2.0, base_m=10.0, description="Boom Klei"),
                ],
            ),
        ]
    )
    bh2 = _borehole(
        [
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [
                    _layer(top_m=0.0, base_m=2.0, description="Zand"),
                    _layer(top_m=2.0, base_m=10.0, description="Boom Klei"),
                ],
            ),
        ]
    )

    session = _make_session([bh1, bh2])
    candidates, collisions = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh1.id, bh2.id]
    )

    names = [c.name for c in candidates]
    # "Boom Klei" (count=2) first; then "Alluvium" and "Zand" (count=1) alphabetically
    assert names == ["Boom Klei", "Alluvium", "Zand"]
    assert collisions == []
    assert candidates[0].borehole_count == 2
    assert candidates[1].borehole_count == 1
    assert candidates[2].borehole_count == 1


@pytest.mark.asyncio
async def test_candidate_carries_dov_formal_codes_with_counts():
    """A candidate carries the DOV formal codes its boreholes pair it with, with counts.

    Owner dogfeed 2026-09-05: the fill dialog showed only the informal names, so the
    DOV formal code behind each candidate was invisible and the owner lumped units
    wrongly.  Here four boreholes each pair the informal name
    "Ieperiaan - Paniseliaan (P1)" with the DOV formal code GeVl (Lid van Vlierzele);
    the candidate must report GeVl paired with it, with a count of 4.
    """
    project_id = uuid4()
    informal = "Ieperiaan - Paniseliaan (P1)"
    boreholes = [
        _dual_stream_borehole(formal_code="GeVl", informal_name=informal) for _ in range(4)
    ]
    # The router builds this formal->informal bridge from the project's dual-stream
    # boreholes and passes it to the scan; do the same here so the effective key is
    # the informal name (the real fill-dialog behaviour).
    bridge = {normalize_formation_key("GeVl"): normalize_formation_key(informal)}
    session = _make_session(boreholes)
    candidates, _ = await scan_stratigraphy_candidates(
        session,
        project_id=project_id,
        borehole_ids=[b.id for b in boreholes],
        bridge=bridge,
    )

    assert len(candidates) == 1
    formal_codes = candidates[0].formal_codes
    assert [(fc.code, fc.count) for fc in formal_codes] == [("GeVl", 4)]
    # The DOV catalogue name is carried so the dialog can offer it as a target.
    assert formal_codes[0].catalog_name is not None
    assert "Vlierzele" in formal_codes[0].catalog_name


@pytest.mark.asyncio
async def test_candidate_lists_multiple_disagreeing_formal_codes_with_counts():
    """When a candidate maps to more than one formal code, each is listed with its count.

    Two boreholes log the same informal name but under two different DOV codes
    (GeVl and TtEg); the merged candidate must surface BOTH codes with their counts
    so the disagreement is visible in the dialog.
    """
    project_id = uuid4()
    informal = "Zandige laag"
    bh_a = _dual_stream_borehole(formal_code="GeVl", informal_name=informal)
    bh_b = _dual_stream_borehole(formal_code="TtEg", informal_name=informal)
    bridge = {
        normalize_formation_key("GeVl"): normalize_formation_key(informal),
        normalize_formation_key("TtEg"): normalize_formation_key(informal),
    }
    session = _make_session([bh_a, bh_b])
    candidates, _ = await scan_stratigraphy_candidates(
        session,
        project_id=project_id,
        borehole_ids=[bh_a.id, bh_b.id],
        bridge=bridge,
    )

    assert len(candidates) == 1
    codes = {(fc.code, fc.count) for fc in candidates[0].formal_codes}
    assert codes == {("GeVl", 1), ("TtEg", 1)}
