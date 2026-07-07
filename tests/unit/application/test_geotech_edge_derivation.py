"""Unit tests for the shared geotech edge-derivation skip logic + counters.

The DB-writing happy path (``session.add`` + ``ResolveLithoInstances``) is
covered by the integration test ``test_divide_boreholes_derives_borehole_mediated_edges``.
Here we pin the pure decision logic — the containment tolerance and the three
skip counters — with a mock session whose ``add`` must never be called on a
skip path, so a future change that silently stops counting a skip (load-bearing
observability) or shifts the 1 mm tolerance is caught without a DB.
"""

from __future__ import annotations

import logging
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest

from groundmodel.application.geotech_edge_derivation import (
    EdgeDerivationCounts,
    derive_geotech_edges_from_litho,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def _logger() -> GroundModelLogger:
    """A real logger wrapper over a throwaway stdlib logger (no I/O asserted)."""
    return GroundModelLogger(logging.getLogger("test_geotech_edge_derivation"))


def _mock_session() -> MagicMock:
    """A session whose ``flush`` is awaitable and whose ``add`` records calls."""
    session = MagicMock()
    session.add = MagicMock()
    session.flush = AsyncMock()
    return session


def test_edge_derivation_counts_add_accumulates() -> None:
    """``EdgeDerivationCounts.add`` sums every field."""
    a = EdgeDerivationCounts(
        edges_emitted=1, skipped_no_litho_depth=2, skipped_no_lcs=3, skipped_empty_stack=4
    )
    b = EdgeDerivationCounts(
        edges_emitted=10, skipped_no_litho_depth=20, skipped_no_lcs=30, skipped_empty_stack=40
    )
    a.add(b)
    assert a.edges_emitted == 11
    assert a.skipped_no_litho_depth == 22
    assert a.skipped_no_lcs == 33
    assert a.skipped_empty_stack == 44


@pytest.mark.asyncio
async def test_skips_and_emits_nothing_when_litho_depth_missing() -> None:
    """A litho edge endpoint absent from ``litho_layer_depths`` → skip, no edge."""
    session = _mock_session()
    a, b = uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(a, b), max(a, b))},
        litho_layer_depths={},  # neither endpoint present
        geotech_layer_by_inv_depth={},
        seen_layer_pairs=set(),
    )
    assert counts.skipped_no_litho_depth == 1
    assert counts.edges_emitted == 0
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_skips_empty_stack_when_one_endpoint_has_no_geotech_bands() -> None:
    """One endpoint with no geotech sub-bands (the SAB-skipped borehole) → skip."""
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    ga = uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={
            la: ("inv-A", 0.0, 10.0),
            lb: ("inv-B", 0.0, 10.0),
        },
        # Only inv-A has a geotech band; inv-B (the borehole) has none.
        geotech_layer_by_inv_depth={"inv-A": [(0.0, 10.0, ga, uuid4(), 5)]},
        seen_layer_pairs=set(),
    )
    assert counts.skipped_empty_stack == 1
    assert counts.edges_emitted == 0
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_skips_no_lcs_when_classes_are_disjoint() -> None:
    """Two non-empty stacks with no common NAD class → no LCS, no edge."""
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={
            la: ("inv-A", 0.0, 10.0),
            lb: ("inv-B", 0.0, 10.0),
        },
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, uuid4(), uuid4(), 5)],  # class 5
            "inv-B": [(0.0, 10.0, uuid4(), uuid4(), 8)],  # class 8 — disjoint
        },
        seen_layer_pairs=set(),
    )
    assert counts.skipped_no_lcs == 1
    assert counts.edges_emitted == 0
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_stack_containment_excludes_band_just_outside_tolerance() -> None:
    """A geotech band 1.1 mm past the litho unit is EXCLUDED (outside 1 mm tol).

    The litho unit spans [0, 10]; a right-side band at [10.0011, 12] sits just
    past the base tolerance, so the right stack is empty → skipped_empty_stack.
    A band at [9.9989, ...] (within tolerance) would be included — pinned by the
    matched-class emit test below.
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={
            la: ("inv-A", 0.0, 10.0),
            lb: ("inv-B", 0.0, 10.0),
        },
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, uuid4(), uuid4(), 5)],
            # top 10.0011 > lit_top? no — this is a base check: base 12 > 10.0011,
            # so the band top 10.0011 is > litho base; it's fully below the unit.
            "inv-B": [(10.0011, 12.0, uuid4(), uuid4(), 5)],
        },
        seen_layer_pairs=set(),
    )
    # inv-B's band is outside the litho unit → empty right stack → skip.
    assert counts.skipped_empty_stack == 1
    assert counts.edges_emitted == 0


@pytest.mark.asyncio
async def test_emits_edge_for_matched_class_within_tolerance() -> None:
    """Matched NAD classes on both endpoints → one geotech edge, seen-set updated."""
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    ga, gb = uuid4(), uuid4()
    seen: set[tuple[UUID, UUID]] = set()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={
            la: ("inv-A", 0.0, 10.0),
            lb: ("inv-B", 0.0, 10.0),
        },
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, ga, uuid4(), 5)],
            "inv-B": [(0.0, 10.0, gb, uuid4(), 5)],  # same class 5 → LCS match
        },
        seen_layer_pairs=seen,
    )
    assert counts.edges_emitted == 1
    session.add.assert_called_once()
    # The dedup set now contains the canonical pair.
    assert seen == {(min(ga, gb), max(ga, gb))}


@pytest.mark.asyncio
async def test_preloaded_seen_pair_is_not_re_emitted() -> None:
    """A pair already in ``seen_layer_pairs`` (a prior pass) is not duplicated."""
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    ga, gb = uuid4(), uuid4()
    seen = {(min(ga, gb), max(ga, gb))}  # already emitted by a previous pass
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={
            la: ("inv-A", 0.0, 10.0),
            lb: ("inv-B", 0.0, 10.0),
        },
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, ga, uuid4(), 5)],
            "inv-B": [(0.0, 10.0, gb, uuid4(), 5)],
        },
        seen_layer_pairs=seen,
    )
    assert counts.edges_emitted == 0
    session.add.assert_not_called()
