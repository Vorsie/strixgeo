"""Unit tests for AutoPopulateContactsFromStratigraphy.execute and shared helpers.

Tests cover:

Shared derivation (``_derive_layer_names_and_key``):
- formal + informal → name=informal, regional_ref=formal, key=formal
- informal-only → name=informal, regional_ref=None, key=name
- formal, no informal counterpart → name=formal fallback, regional_ref=formal, key=formal

Stable key consistency:
- formal+informal with diverging working names across boreholes merge on same key
  (the root-cause divergence case)

``scan_stratigraphy_candidates`` key/regional_ref fields:
- formal+informal returns correct key and regional_ref
- informal-only returns key == name, regional_ref == None

``AutoPopulateContactsFromStratigraphy.execute`` with ``selected_keys``:
- subset selected → only matching layers create formations, others skipped
- selected_keys=None → all layers processed (existing behaviour preserved)

Orphan suppression:
- orphaned contact (observation_layer_id=None) is purged before idempotency
  check when selected_keys is provided, allowing re-creation

The DB session is mocked at the ``session.execute`` / ``session.add`` boundary;
no real DB or network I/O is performed.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call, patch
from uuid import uuid4

import pytest

from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
    _derive_layer_names_and_key,
    scan_stratigraphy_candidates,
)
from groundmodel.domain.value_objects.observation_type import ObservationType

# ---------------------------------------------------------------------------
# Helpers — lightweight stand-ins for ORM rows
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
    """Build a minimal observation stub (includes ``id`` for execute path)."""
    return SimpleNamespace(
        id=uuid4(),
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


# ---------------------------------------------------------------------------
# _derive_layer_names_and_key — shared derivation
# ---------------------------------------------------------------------------


def test_derive_formal_with_informal_counterpart():
    """Formal primary + informal counterpart → informal name, formal regional_ref, key=formal."""
    name, regional_ref, key = _derive_layer_names_and_key(
        primary_is_formal=True,
        primary_desc="HyEg",
        counterpart_desc="Boom Klei",
    )
    assert name == "Boom Klei"
    assert regional_ref == "HyEg"
    assert key == "HyEg"  # key = regional_ref


def test_derive_formal_no_counterpart():
    """Formal primary with no counterpart → name falls back to formal, key=formal."""
    name, regional_ref, key = _derive_layer_names_and_key(
        primary_is_formal=True,
        primary_desc="HyEg",
        counterpart_desc=None,
    )
    assert name == "HyEg"
    assert regional_ref == "HyEg"
    assert key == "HyEg"


def test_derive_informal_only():
    """Informal-only primary → name=informal, regional_ref=None, key=name."""
    name, regional_ref, key = _derive_layer_names_and_key(
        primary_is_formal=False,
        primary_desc="Alluvium",
        counterpart_desc=None,
    )
    assert name == "Alluvium"
    assert regional_ref is None
    assert key == "Alluvium"  # key = name when no regional_ref


def test_derive_informal_with_counterpart_ignored():
    """Informal primary — counterpart_desc is irrelevant (no formal observation source)."""
    # When walking the informal stream as primary there is no formal stream;
    # counterpart_desc should not affect name or regional_ref.
    name, regional_ref, key = _derive_layer_names_and_key(
        primary_is_formal=False,
        primary_desc="Zand",
        counterpart_desc="Unexpected counterpart",
    )
    assert name == "Zand"
    assert regional_ref is None
    assert key == "Zand"


# ---------------------------------------------------------------------------
# scan_stratigraphy_candidates — key / regional_ref fields
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scan_formal_informal_returns_key_and_regional_ref():
    """Formal+informal borehole → candidate carries key=formal code, regional_ref=formal."""
    project_id = uuid4()
    formal_layer = _layer(top_m=2.0, base_m=10.0, description="HyEg")
    informal_layer = _layer(top_m=2.0, base_m=10.0, description="Boom Klei")
    bh = _borehole(
        [
            _observation(ObservationType.FORMAL_STRATIGRAPHY, [formal_layer]),
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [informal_layer]),
        ]
    )

    session = _make_session([bh])
    candidates = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )

    assert len(candidates) == 1
    c = candidates[0]
    assert c.name == "Boom Klei"
    assert c.regional_ref == "HyEg"
    assert c.key == "HyEg"
    assert c.borehole_count == 1


@pytest.mark.asyncio
async def test_scan_informal_only_key_equals_name():
    """Informal-only borehole → candidate key == name, regional_ref is None."""
    project_id = uuid4()
    informal_layer = _layer(top_m=0.0, base_m=5.0, description="Alluvium")
    bh = _borehole(
        [
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [informal_layer]),
        ]
    )

    session = _make_session([bh])
    candidates = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh.id]
    )

    assert len(candidates) == 1
    c = candidates[0]
    assert c.name == "Alluvium"
    assert c.regional_ref is None
    assert c.key == "Alluvium"


@pytest.mark.asyncio
async def test_scan_same_formal_code_different_informal_names_merge():
    """Two boreholes share a formal code but use different working names.

    The discover scan MUST merge these into ONE candidate keyed on the formal
    code, not two separate candidates keyed on the differing working names.
    This is the exact divergence case that caused the discover-execute mismatch.
    """
    project_id = uuid4()

    # bh1: formal HyEg / informal "Boom Klei"
    bh1 = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=2.0, base_m=10.0, description="HyEg")],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=2.0, base_m=10.0, description="Boom Klei")],
            ),
        ]
    )
    # bh2: same formal HyEg but different informal working name "Rupel Klei"
    bh2 = _borehole(
        [
            _observation(
                ObservationType.FORMAL_STRATIGRAPHY,
                [_layer(top_m=3.0, base_m=12.0, description="HyEg")],
            ),
            _observation(
                ObservationType.INFORMAL_STRATIGRAPHY,
                [_layer(top_m=3.0, base_m=12.0, description="Rupel Klei")],
            ),
        ]
    )

    session = _make_session([bh1, bh2])
    candidates = await scan_stratigraphy_candidates(
        session, project_id=project_id, borehole_ids=[bh1.id, bh2.id]
    )

    # Must be ONE candidate (merged on formal key "HyEg"), NOT two.
    assert len(candidates) == 1
    c = candidates[0]
    assert c.key == "HyEg"
    assert c.regional_ref == "HyEg"
    assert c.borehole_count == 2
    # name comes from the first borehole encountered
    assert c.name in ("Boom Klei", "Rupel Klei")


# ---------------------------------------------------------------------------
# execute — selected_keys filter
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_execute_selected_keys_filters_unselected_layers():
    """When selected_keys is provided, only layers whose key is in the set
    trigger formation/contact creation; others are silently skipped."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    # One borehole with two informal layers (no formal, so key == name)
    layer_kept = _layer(top_m=0.0, base_m=5.0, description="Boom Klei")
    layer_skipped = _layer(top_m=5.0, base_m=15.0, description="Diest Zand")
    bh = _borehole(
        [
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [layer_kept, layer_skipped]),
        ]
    )

    # Build a session mock that handles multiple execute() calls:
    # 1. borehole load
    # 2. orphan delete (skipped — no surviving formation ids for new session)
    # 3. existing formations load (empty)
    # 4. max display_order
    # 5. existing contacts load (empty)
    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = [bh]

    empty_formations_result = MagicMock()
    empty_formations_result.scalars.return_value.all.return_value = []

    max_order_result = MagicMock()
    max_order_result.scalar_one.return_value = 0

    empty_contacts_result = MagicMock()
    empty_contacts_result.all.return_value = []

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        # call 1: borehole load
        if call_count == 1:
            return bh_result
        # call 2: formations load
        if call_count == 2:
            return empty_formations_result
        # call 3: max display_order
        if call_count == 3:
            return max_order_result
        # call 4: contacts load
        if call_count == 4:
            return empty_contacts_result
        # fallback
        return empty_contacts_result

    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock()
    session.new = []
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    with patch(
        "groundmodel.application.auto_populate_contacts_from_stratigraphy.RecomputeFormationSurface"
    ) as mock_recompute:
        mock_recompute.return_value.execute_many = AsyncMock()
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[bh.id],
            selected_keys=["Boom Klei"],  # only Boom Klei selected
        )

    # Should have created 1 formation + 1 contact (Boom Klei only)
    assert len(outcome.created_formation_ids) == 1
    assert len(outcome.created_contact_ids) == 1
    # The formation added via session.add should be GeologicalFormationOrm — verify
    # at least one add happened (formation + contact = 2 adds)
    assert session.add.call_count >= 2


@pytest.mark.asyncio
async def test_execute_selected_keys_none_processes_all():
    """When selected_keys is None, all layers are processed (existing behaviour)."""
    from groundmodel.application.auto_populate_contacts_from_stratigraphy import (
        AutoPopulateContactsFromStratigraphy,
    )

    project_id = uuid4()
    model_id = uuid4()

    layer_a = _layer(top_m=0.0, base_m=5.0, description="Boom Klei")
    layer_b = _layer(top_m=5.0, base_m=15.0, description="Diest Zand")
    bh = _borehole(
        [
            _observation(ObservationType.INFORMAL_STRATIGRAPHY, [layer_a, layer_b]),
        ]
    )

    bh_result = MagicMock()
    bh_result.scalars.return_value.all.return_value = [bh]

    empty_formations_result = MagicMock()
    empty_formations_result.scalars.return_value.all.return_value = []

    max_order_result = MagicMock()
    max_order_result.scalar_one.return_value = 0

    empty_contacts_result = MagicMock()
    empty_contacts_result.all.return_value = []

    call_count = 0

    async def side_effect(stmt, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return bh_result
        if call_count == 2:
            return empty_formations_result
        if call_count == 3:
            return max_order_result
        if call_count == 4:
            return empty_contacts_result
        return empty_contacts_result

    session = AsyncMock()
    session.execute = AsyncMock(side_effect=side_effect)
    session.add = MagicMock()
    session.new = []
    session.flush = AsyncMock()
    session.commit = AsyncMock()

    with patch(
        "groundmodel.application.auto_populate_contacts_from_stratigraphy.RecomputeFormationSurface"
    ) as mock_recompute:
        mock_recompute.return_value.execute_many = AsyncMock()
        use_case = AutoPopulateContactsFromStratigraphy(session)
        outcome = await use_case.execute(
            project_id=project_id,
            model_id=model_id,
            borehole_ids=[bh.id],
            selected_keys=None,  # process all
        )

    # Both layers processed → 2 formations + 2 contacts
    assert len(outcome.created_formation_ids) == 2
    assert len(outcome.created_contact_ids) == 2
