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
async def test_skips_no_lcs_when_classes_are_disjoint_on_a_bridged_pair() -> None:
    """A BRIDGED pair with no common NAD class → no LCS, no edge.

    Only bridged jump pairs keep the class-equality requirement FOR THE
    ALIGNER — their litho contact ties are restated packing-agnostic by the
    contact walk (BR1), so what stays class-gated is the interior packing
    proposals only: a direct
    litho tie now always restates its topmost pair (owner ruling 2026-08-13,
    the test below), but a bridged pair was inferred, not drawn — nothing
    licenses a cross-class connection there.
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
            "inv-A": [(0.0, 10.0, uuid4(), uuid4(), 5)],  # class 5
            "inv-B": [(0.0, 10.0, uuid4(), uuid4(), 8)],  # class 8 — disjoint
        },
        seen_layer_pairs=set(),
        direct_litho_pairs=set(),  # the pair came from the bridge
    )
    assert counts.skipped_no_lcs == 1
    assert counts.edges_emitted == 0
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_a_direct_pair_with_cross_class_tops_still_restates() -> None:
    """Owner ruling 2026-08-13: "you have to start from the exact litho
    geometries" — the litho tie's restatement exists even when the two
    topmost bands differ in NAD class.

    The real case: S10's clay is one FF band (23); S6's clay leads with an MF
    crust (22) over FF (23). The old class-matched LCS could only produce
    23↔23 — tying the litho CONTACT to a band one step deeper, which let the
    sand reach below the litho clay top in the fill. The restatement is the
    TOPS, cross-class, born accepted. The 23↔23 FF-body pair still appears —
    as the interior PENDING proposal it really is (owner 2026-08-14: the
    ghost the engineer judges), not as the contact restatement.
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    ff_a = uuid4()  # left: single FF band (23)
    mf_b, ff_b = uuid4(), uuid4()  # right: MF crust (22) over FF (23)
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, ff_a, uuid4(), 23)],
            "inv-B": [(0.0, 1.0, mf_b, uuid4(), 22), (1.0, 10.0, ff_b, uuid4(), 23)],
        },
        seen_layer_pairs=set(),
    )
    assert counts.edges_accepted == 1
    assert counts.edges_proposed == 1
    by_pair = {
        frozenset((c.args[0].layer_a_id, c.args[0].layer_b_id)): c.args[0]
        for c in session.add.call_args_list
    }
    restatement = by_pair[frozenset((ff_a, mf_b))]
    assert restatement.user_approved is True, (
        "the restatement joins the two TOPMOST bands — the contact surfaces the engineer tied"
    )
    interior = by_pair[frozenset((ff_a, ff_b))]
    assert interior.user_approved is False, (
        "the FF-body pair is an interior machine claim — a pending ghost, never the restatement"
    )


@pytest.mark.asyncio
async def test_the_absurd_deep_shallow_class_match_is_not_proposed() -> None:
    """[14] vs [13, 14]: the old whole-stack LCS proposed the left top against
    the DEEP right 14 (the owner's DB holds one tying 12 m to 6 m elevation).
    With the forced top the only emission is the topmost restatement.
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    sliver_a = uuid4()  # left: one thin 14 sliver at the top
    big_b, deep_b = uuid4(), uuid4()  # right: big 13, then a deep 14
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 1.0), lb: ("inv-B", 0.0, 6.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 1.0, sliver_a, uuid4(), 14)],
            "inv-B": [(0.0, 5.5, big_b, uuid4(), 13), (5.5, 6.0, deep_b, uuid4(), 14)],
        },
        seen_layer_pairs=set(),
    )
    assert counts.edges_emitted == 1
    edge = session.add.call_args.args[0]
    assert {edge.layer_a_id, edge.layer_b_id} == {sliver_a, big_b}
    assert deep_b not in {edge.layer_a_id, edge.layer_b_id}, (
        "the deep class-match must not be proposed — it was the absurd pair"
    )


@pytest.mark.asyncio
async def test_a_litho_bottom_tie_restates_as_a_base_base_geotech_edge() -> None:
    """A litho base↔base tie joins the two units' BASE contacts, so its
    restatement joins the two DEEPEST bands with base sides — the only path
    by which a column's deepest band can ever reach a tied base (the fill's
    tie counter reads base↔base edges for exactly that, and the sub-TD
    substrate follows the bottom tie).
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    top_a, deep_a = uuid4(), uuid4()
    top_b, deep_b = uuid4(), uuid4()
    pair = (min(la, lb), max(la, lb))
    seen_base: set[tuple[UUID, UUID]] = set()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={pair},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 4.0, top_a, uuid4(), 22), (4.0, 10.0, deep_a, uuid4(), 23)],
            "inv-B": [(0.0, 6.0, top_b, uuid4(), 22), (6.0, 10.0, deep_b, uuid4(), 23)],
        },
        seen_layer_pairs=set(),
        litho_sided_edges={(pair[0], pair[1], "top", "top"), (pair[0], pair[1], "base", "base")},
        seen_sided_edges=seen_base,
    )
    # 22↔22 restatement + 23↔23 interior proposal + 23↔23 base↔base restatement.
    assert counts.edges_emitted == 3
    assert counts.edges_accepted == 2
    base_edges = [
        c.args[0]
        for c in session.add.call_args_list
        if c.args[0].layer_a_side == "base" and c.args[0].layer_b_side == "base"
    ]
    assert len(base_edges) == 1
    base_edge = base_edges[0]
    assert {base_edge.layer_a_id, base_edge.layer_b_id} == {deep_a, deep_b}
    assert base_edge.user_approved is True
    assert seen_base == {(min(deep_a, deep_b), max(deep_a, deep_b), "base", "base")}


@pytest.mark.asyncio
async def test_a_single_band_unit_carries_both_its_top_and_base_restatement() -> None:
    """One band per side + a litho tie that is both top- and bottom-tied →
    TWO rows on the SAME layer pair: top↔top and base↔base. The pair-only
    dedup must not let the first suppress the second (the DB unique
    constraint includes the sides, so both rows are legal).
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    ga, gb = uuid4(), uuid4()
    pair = (min(la, lb), max(la, lb))
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={pair},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, ga, uuid4(), 23)],
            "inv-B": [(0.0, 10.0, gb, uuid4(), 23)],
        },
        seen_layer_pairs=set(),
        litho_sided_edges={(pair[0], pair[1], "top", "top"), (pair[0], pair[1], "base", "base")},
        seen_sided_edges=set(),
    )
    assert counts.edges_emitted == 2
    assert counts.edges_accepted == 2
    sides = sorted(
        (c.args[0].layer_a_side, c.args[0].layer_b_side) for c in session.add.call_args_list
    )
    assert sides == [("base", "base"), ("top", "top")]


@pytest.mark.asyncio
async def test_an_existing_base_pair_suppresses_the_base_restatement() -> None:
    """A base↔base row already persisted for the pair → no duplicate."""
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    ga, gb = uuid4(), uuid4()
    pair = (min(la, lb), max(la, lb))
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={pair},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, ga, uuid4(), 23)],
            "inv-B": [(0.0, 10.0, gb, uuid4(), 23)],
        },
        seen_layer_pairs={(min(ga, gb), max(ga, gb))},  # top row exists too
        litho_sided_edges={(pair[0], pair[1], "top", "top"), (pair[0], pair[1], "base", "base")},
        seen_sided_edges={(min(ga, gb), max(ga, gb), "base", "base")},
    )
    assert counts.edges_emitted == 0
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_a_skeleton_deepest_band_blocks_the_base_restatement() -> None:
    """A None-class (skeleton) deepest band never auto-ties (spec §8) — the
    base restatement is skipped, not emitted against a skeleton."""
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    ga, skel_b = uuid4(), uuid4()
    pair = (min(la, lb), max(la, lb))
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={pair},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, ga, uuid4(), 23)],
            "inv-B": [(0.0, 10.0, skel_b, uuid4(), None)],
        },
        seen_layer_pairs=set(),
        litho_sided_edges={(pair[0], pair[1], "top", "top"), (pair[0], pair[1], "base", "base")},
        seen_sided_edges=set(),
    )
    base_edges = [c.args[0] for c in session.add.call_args_list if c.args[0].layer_a_side == "base"]
    assert base_edges == []
    assert counts.edges_emitted == 0


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
async def test_a_tie_restating_the_litho_tie_is_born_accepted_with_auto_provenance() -> None:
    """RE-PINNED (owner refinement of ruling A, 2026-08-06): only RESTATEMENTS
    are born accepted — "all ties are born unaccepted except those that are
    already ties in the litho model".

    An unsubdivided litho pair (one packing band each side) derives exactly
    one tie, joining the same contact surfaces the engineer tied at the litho
    level — the litho tie restated. That one is born accepted.

    What did NOT change, and must never: provenance. ``source`` stays
    ``'auto'`` so hand and machine work remain distinguishable — the
    2026-08-01 bug was stamping 217 derived ties as hand-made, and a rebuild
    destroyed both.
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    ga, gb = uuid4(), uuid4()
    await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, ga, uuid4(), 5)],
            "inv-B": [(0.0, 10.0, gb, uuid4(), 5)],
        },
        seen_layer_pairs=set(),
    )
    edge = session.add.call_args.args[0]
    assert edge.user_approved is True, (
        "a tie that restates the approved litho tie is born accepted — the "
        "litho approval already vouches for exactly this connection"
    )
    assert edge.source == "auto", (
        "a tie the program derived must carry the program's provenance, not "
        "'manual' — 'manual' is what the engineer's own gesture writes"
    )


@pytest.mark.asyncio
async def test_packing_density_ties_inside_the_body_are_born_pending() -> None:
    """Owner (dogfeed 2026-08-06): "the new ties (within one litho body, a
    packing density tie) should be a ghost".

    Subdivision split both sides into loose+dense. The loose↔loose pair at the
    shared litho contact restates the litho tie → accepted; the dense↔dense
    pair at the machine-invented packing boundary is a NEW claim → pending.
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    loose_a, dense_a, loose_b, dense_b = uuid4(), uuid4(), uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 4.0, loose_a, uuid4(), 5), (4.0, 10.0, dense_a, uuid4(), 9)],
            "inv-B": [(0.0, 6.0, loose_b, uuid4(), 5), (6.0, 10.0, dense_b, uuid4(), 9)],
        },
        seen_layer_pairs=set(),
    )
    assert counts.edges_emitted == 2
    assert counts.edges_accepted == 1
    assert counts.edges_proposed == 1
    approvals = {
        frozenset((c.args[0].layer_a_id, c.args[0].layer_b_id)): c.args[0].user_approved
        for c in session.add.call_args_list
    }
    assert approvals[frozenset((loose_a, loose_b))] is True, (
        "the top pair joins the litho-tied contact surfaces — restated, accepted"
    )
    assert approvals[frozenset((dense_a, dense_b))] is False, (
        "the interior pair sits on a packing boundary the machine invented — "
        "a new claim, a ghost the engineer accepts or rejects"
    )


@pytest.mark.asyncio
async def test_a_skeleton_top_band_blocks_restatement_acceptance() -> None:
    """A None-class (skeleton) TOP band means no pair joins the litho-tied
    contact surfaces — the aligned pair below it is an interior claim and must
    arrive pending, never masquerade as the restatement.
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    skel_a, mid_a, gb = uuid4(), uuid4(), uuid4()
    await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            # Left top band is a skeleton (no qc → class None): unpairable.
            "inv-A": [(0.0, 3.0, skel_a, uuid4(), None), (3.0, 10.0, mid_a, uuid4(), 5)],
            "inv-B": [(0.0, 10.0, gb, uuid4(), 5)],
        },
        seen_layer_pairs=set(),
    )
    edge = session.add.call_args.args[0]
    assert edge.user_approved is False, (
        "the 5-band pair does not sit at the litho-tied top surfaces (a "
        "skeleton band does) — it is an interior claim, pending"
    )


@pytest.mark.asyncio
async def test_bridged_jump_pairs_are_born_pending_even_at_the_top() -> None:
    """A bridged pair is NOT "already a tie in the litho model" — it was
    inferred by walking a chain of litho edges across a bandless column, so
    even its top pairing arrives as a proposal.
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    ga, gb = uuid4(), uuid4()
    pair = (min(la, lb), max(la, lb))
    await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={pair},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, ga, uuid4(), 5)],
            "inv-B": [(0.0, 10.0, gb, uuid4(), 5)],
        },
        seen_layer_pairs=set(),
        # The caller's DIRECT set excludes the pair: it came from the bridge.
        direct_litho_pairs=set(),
    )
    edge = session.add.call_args.args[0]
    assert edge.user_approved is False
    assert edge.source == "auto"


@pytest.mark.asyncio
async def test_a_pair_skipped_because_it_already_exists_is_counted() -> None:
    """A candidate suppressed by the seen-set is counted, so the verb can toast it."""
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    ga, gb = uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, ga, uuid4(), 5)],
            "inv-B": [(0.0, 10.0, gb, uuid4(), 5)],
        },
        seen_layer_pairs={(min(ga, gb), max(ga, gb))},
    )
    assert counts.skipped_existing_pair == 1
    assert counts.edges_emitted == 0


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


@pytest.mark.asyncio
async def test_same_pair_on_two_sections_needs_per_section_seen_sets() -> None:
    """The SAME layer pair on two sections must yield an edge on EACH section.

    Geotech edges are section-scoped in the DB (per-section uniqueness on the
    layer pair), so a pair ``(A, B)`` emitted on section 1 must NOT suppress the
    legitimate ``(A, B)`` edge on section 2.  This pins the invariant the caller
    (DivideBoreholes Phase 8.5) relies on: pass a per-section ``seen_layer_pairs``
    set, never one shared across sections.

    A single shared set would let section 1's emit poison section 2 → the
    external review's "missing band in section 2" bug; the per-section version
    emits on both.
    """
    la, lb = uuid4(), uuid4()
    ga, gb = uuid4(), uuid4()
    geotech_model_id = uuid4()
    section_1, section_2 = uuid4(), uuid4()
    edges = {(min(la, lb), max(la, lb))}
    depths = {la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)}
    bands = {
        "inv-A": [(0.0, 10.0, ga, uuid4(), 5)],
        "inv-B": [(0.0, 10.0, gb, uuid4(), 5)],
    }

    async def _run(section_id: UUID, seen: set[tuple[UUID, UUID]]) -> tuple[int, MagicMock]:
        session = _mock_session()
        counts = await derive_geotech_edges_from_litho(
            session,
            _logger(),
            geotech_model_id=geotech_model_id,
            section_id=section_id,
            litho_approved_edges=edges,
            litho_layer_depths=depths,
            geotech_layer_by_inv_depth=bands,
            seen_layer_pairs=seen,
        )
        return counts.edges_emitted, session.add

    # BUG shape (a single shared set): section 2 is suppressed.
    shared: set[tuple[UUID, UUID]] = set()
    emitted_1, _ = await _run(section_1, shared)
    emitted_2_shared, _ = await _run(section_2, shared)
    assert emitted_1 == 1
    assert emitted_2_shared == 0, "shared set suppresses the second section (the bug)"

    # FIX shape (per-section sets): both sections emit their own edge.
    emitted_1b, add_1 = await _run(section_1, set())
    emitted_2b, add_2 = await _run(section_2, set())
    assert emitted_1b == 1
    assert emitted_2b == 1, "per-section set must emit the same pair on section 2"
    add_1.assert_called_once()
    add_2.assert_called_once()


# ---------------------------------------------------------------------------
# Side-aware restatement (owner ruling 2026-08-14: "litho consistency should
# be 100%" — the onlap ties carry down too, sides preserved)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_mixed_litho_tie_restates_with_its_sides_preserved() -> None:
    """A litho top↔base tie (the onlap declaration) joins unit A's TOP contact
    to unit B's BASE contact. Its restatement is A's topmost band ↔ B's
    deepest band with sides top/base — restating it top↔top (what the
    side-blind loader did) asserted a connection the engineer never drew.
    """
    session = _mock_session()
    la, lb = sorted((uuid4(), uuid4()))
    top_a, deep_a = uuid4(), uuid4()
    top_b, deep_b = uuid4(), uuid4()
    pair = (la, lb)
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={pair},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 4.0, top_a, uuid4(), 13), (4.0, 10.0, deep_a, uuid4(), 14)],
            "inv-B": [(0.0, 6.0, top_b, uuid4(), 13), (6.0, 10.0, deep_b, uuid4(), 14)],
        },
        seen_layer_pairs=set(),
        litho_sided_edges={(la, lb, "top", "base")},
        seen_sided_edges=set(),
    )
    sided = [
        c.args[0]
        for c in session.add.call_args_list
        if (c.args[0].layer_a_side, c.args[0].layer_b_side) != ("top", "top")
    ]
    assert len(sided) == 1
    edge = sided[0]
    endpoint_sides = {
        edge.layer_a_id: edge.layer_a_side,
        edge.layer_b_id: edge.layer_b_side,
    }
    assert endpoint_sides == {top_a: "top", deep_b: "base"}, (
        "the tie joins A's topmost band (its top contact) to B's deepest "
        "band (its base contact), sides travelling with their endpoints"
    )
    assert edge.user_approved is True
    assert counts.edges_accepted >= 1


@pytest.mark.asyncio
async def test_a_mixed_only_pair_gets_no_forced_top_restatement() -> None:
    """A pair whose ONLY litho tie is mixed (top↔base) must NOT receive a
    forced topmost↔topmost accepted edge — no litho tie joins the tops, so
    forcing one would invent an approval. Interior class matches still
    arrive as pending proposals.
    """
    session = _mock_session()
    la, lb = sorted((uuid4(), uuid4()))
    top_a, top_b = uuid4(), uuid4()
    pair = (la, lb)
    await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={pair},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, top_a, uuid4(), 13)],
            "inv-B": [(0.0, 10.0, top_b, uuid4(), 14)],
        },
        seen_layer_pairs=set(),
        litho_sided_edges={(la, lb, "top", "base")},
        seen_sided_edges=set(),
    )
    top_top = [
        c.args[0]
        for c in session.add.call_args_list
        if (c.args[0].layer_a_side, c.args[0].layer_b_side) == ("top", "top")
    ]
    assert top_top == [], (
        "no litho tie joins the tops (13 vs 14, mixed tie only) — a forced "
        "top↔top pair would be an invented approval"
    )
    # The mixed restatement itself: A's topmost = its only band = also its
    # deepest; B's deepest likewise. One sided accepted edge.
    sided = [c.args[0] for c in session.add.call_args_list]
    assert len(sided) == 1
    assert (sided[0].layer_a_side, sided[0].layer_b_side) != ("top", "top")
    assert sided[0].user_approved is True


@pytest.mark.asyncio
async def test_sided_canonicalisation_swaps_the_sides_with_the_ids() -> None:
    """When the two mapped geotech bands land in swapped canonical order, the
    sides must travel with their endpoints — else the row claims a different
    pair of surfaces correlate."""
    session = _mock_session()
    la, lb = sorted((uuid4(), uuid4()))
    # Force the geotech ids so B's deepest band sorts BEFORE A's topmost.
    top_a = UUID("ffffffff-0000-0000-0000-000000000001")
    deep_b = UUID("00000000-0000-0000-0000-000000000001")
    pair = (la, lb)
    await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={pair},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, top_a, uuid4(), 13)],
            "inv-B": [(0.0, 10.0, deep_b, uuid4(), 14)],
        },
        seen_layer_pairs=set(),
        litho_sided_edges={(la, lb, "top", "base")},
        seen_sided_edges=set(),
    )
    edge = session.add.call_args.args[0]
    assert edge.layer_a_id == deep_b
    assert edge.layer_a_side == "base", "B's endpoint keeps its base side in slot a"
    assert edge.layer_b_id == top_a
    assert edge.layer_b_side == "top"


@pytest.mark.asyncio
async def test_the_interior_body_pair_is_proposed_pending_beside_the_restatement() -> None:
    """CS1 gap 3 in miniature (owner ruling 2026-08-14, "auto correlate is
    fine, its just a tool"): B4's silt = thin n14 crust over a big n13 body;
    S13's silt = big n13 over n16. The restatement ties the crust to S13's
    top (accepted); the big n13 BODIES must arrive as a PENDING proposal -
    the 287 m2 hole was exactly this pair never being proposed."""
    session = _mock_session()
    la, lb = sorted((uuid4(), uuid4()))
    crust14, body13_l, deep13_l = uuid4(), uuid4(), uuid4()
    body13_r, n16_r = uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(la, lb)},
        litho_layer_depths={la: ("inv-A", 0.0, 5.6), lb: ("inv-B", 1.4, 8.2)},
        geotech_layer_by_inv_depth={
            "inv-A": [
                (0.0, 0.6, crust14, uuid4(), 14),
                (0.6, 5.1, body13_l, uuid4(), 13),
                (5.1, 5.6, deep13_l, uuid4(), 13),
            ],
            "inv-B": [
                (1.4, 6.7, body13_r, uuid4(), 13),
                (6.7, 8.2, n16_r, uuid4(), 16),
            ],
        },
        seen_layer_pairs=set(),
        litho_sided_edges={(la, lb, "top", "top")},
        seen_sided_edges=set(),
    )
    by_pair = {
        frozenset((c.args[0].layer_a_id, c.args[0].layer_b_id)): c.args[0]
        for c in session.add.call_args_list
    }
    restatement = by_pair.get(frozenset((crust14, body13_r)))
    assert restatement is not None and restatement.user_approved is True
    interior = by_pair.get(frozenset((body13_l, body13_r)))
    assert interior is not None, (
        "the big same-class bodies must be PROPOSED - the engineer should "
        "judge a ghost, not hunt the pair by hand"
    )
    assert interior.user_approved is False, (
        "an interior body pair is a machine claim - pending, per ruling A"
    )
    assert counts.edges_proposed >= 1


# ---------------------------------------------------------------------------
# Crossing guard (owner dogfeed 2026-08-15: pressing step 2 put "1 crossing
# correlation tie - resolve to restore bands" on the section and the bands
# refused to draw on that gap). A crossing is a HARD CONFLICT by the owner's
# own S8 Q4 ruling - neither side bands - so the derivation must not propose
# one. The rule, in the section's terms: two ties in one gap cross when their
# endpoint order is inverted between the two columns.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_xd1_a_proposal_that_would_cross_an_accepted_restatement_is_refused() -> None:
    """The owner's scene: a unit carrying BOTH a top-to-top litho tie and a
    mixed onlap declaration. The mixed restatement runs from the DEEPEST band's
    base on the left to the TOPMOST band's top on the right, so it passes under
    every deeper pair the aligner then proposes - and the deeper proposal
    crosses it. The approval stands; the proposal must never be born.
    """
    session = _mock_session()
    la, lb = sorted((uuid4(), uuid4()))
    shallow_a, deep_a = uuid4(), uuid4()
    shallow_b, deep_b = uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(la, lb)},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [
                (0.0, 4.0, shallow_a, uuid4(), 13),
                (4.0, 10.0, deep_a, uuid4(), 14),
            ],
            "inv-B": [
                (0.0, 3.0, shallow_b, uuid4(), 13),
                (3.0, 10.0, deep_b, uuid4(), 14),
            ],
        },
        seen_layer_pairs=set(),
        litho_sided_edges={(la, lb, "top", "top"), (la, lb, "base", "top")},
        seen_sided_edges=set(),
    )
    emitted = {
        frozenset((c.args[0].layer_a_id, c.args[0].layer_b_id)) for c in session.add.call_args_list
    }
    # The mixed restatement (deepest left band's base to topmost right band's
    # top) and the topmost pair both stand - they share the right endpoint, so
    # they fan rather than cross.
    assert frozenset((deep_a, shallow_b)) in emitted
    assert frozenset((shallow_a, shallow_b)) in emitted
    # The deep-to-deep pair inverts its order against the restatement and must
    # be refused rather than shipped as a conflict the engineer has to clear.
    assert frozenset((deep_a, deep_b)) not in emitted
    assert counts.skipped_crossing_tie == 1


@pytest.mark.asyncio
async def test_xd2_without_the_mixed_declaration_the_same_deep_pair_is_proposed() -> None:
    """Negative control for XD1: the ONLY thing that made the deep pair cross
    was the mixed restatement running under it. Drop the mixed declaration and
    the very same scene must propose the deep pair as it always did - the guard
    may not become a blanket "propose less".
    """
    session = _mock_session()
    la, lb = sorted((uuid4(), uuid4()))
    shallow_a, deep_a = uuid4(), uuid4()
    shallow_b, deep_b = uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(la, lb)},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [
                (0.0, 4.0, shallow_a, uuid4(), 13),
                (4.0, 10.0, deep_a, uuid4(), 14),
            ],
            "inv-B": [
                (0.0, 3.0, shallow_b, uuid4(), 13),
                (3.0, 10.0, deep_b, uuid4(), 14),
            ],
        },
        seen_layer_pairs=set(),
        litho_sided_edges={(la, lb, "top", "top")},
        seen_sided_edges=set(),
    )
    emitted = {
        frozenset((c.args[0].layer_a_id, c.args[0].layer_b_id)) for c in session.add.call_args_list
    }
    assert frozenset((shallow_a, shallow_b)) in emitted
    assert frozenset((deep_a, deep_b)) in emitted
    assert counts.skipped_crossing_tie == 0


@pytest.mark.asyncio
async def test_xd3_an_edge_already_accepted_in_the_database_blocks_the_crossing_proposal() -> None:
    """The owner's banner appeared the INSTANT he pressed step 2, which means
    the tie it crossed was already in the model - a hand-drawn tie, an earlier
    accept-all, or a Divide-boreholes restatement. An approval the run did not
    emit itself still outranks a fresh proposal.
    """
    session = _mock_session()
    la, lb = sorted((uuid4(), uuid4()))
    a_top, a_mid, a_deep = uuid4(), uuid4(), uuid4()
    b_top, b_mid, b_deep = uuid4(), uuid4(), uuid4()
    # The engineer's own tie: the left column's TOP band down to the right
    # column's DEEP band. Anything running the other way inverts against it.
    hand_drawn = (a_top, b_deep, "top", "top") if a_top < b_deep else (b_deep, a_top, "top", "top")
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(la, lb)},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [
                (0.0, 3.0, a_top, uuid4(), 13),
                (3.0, 6.0, a_mid, uuid4(), 14),
                (6.0, 10.0, a_deep, uuid4(), 15),
            ],
            "inv-B": [
                (0.0, 2.0, b_top, uuid4(), 13),
                (2.0, 5.0, b_mid, uuid4(), 14),
                (5.0, 10.0, b_deep, uuid4(), 15),
            ],
        },
        seen_layer_pairs=set(),
        litho_sided_edges={(la, lb, "top", "top")},
        seen_sided_edges=set(),
        existing_accepted_sided_edges={hand_drawn},
    )
    emitted = {
        frozenset((c.args[0].layer_a_id, c.args[0].layer_b_id)) for c in session.add.call_args_list
    }
    assert frozenset((a_mid, b_mid)) not in emitted, (
        "the middle pair rises to the right while the engineer's own tie falls "
        "to the right - the two invert between the columns"
    )
    # The pairs that keep their order beside the hand-drawn tie still arrive.
    assert frozenset((a_top, b_top)) in emitted
    assert frozenset((a_deep, b_deep)) in emitted
    assert counts.skipped_crossing_tie == 1


@pytest.mark.asyncio
async def test_ba1_divide_boreholes_hops_are_born_accepted() -> None:
    """Owner ruling 2026-08-15, after dogfeeding the two-press loop:
    *"subdivision hops should be born accepted"*.

    The hops "4 · Divide boreholes" writes are not the machine guessing at a
    correlation the engineer has not made — they re-express, through the
    borehole it just divided, the correlations he already drew. Asking him to
    accept them turns one press into press-accept-press, and a second press
    only manufactures more of them ("click a second time on 4 generated even
    more new ties to accept").

    Same scene as ``test_packing_density_ties_inside_the_body_are_born_pending``
    — which stays as the negative control for step 2, where a proposal IS a
    machine claim and must stay a ghost.
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    loose_a, dense_a, loose_b, dense_b = uuid4(), uuid4(), uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 4.0, loose_a, uuid4(), 5), (4.0, 10.0, dense_a, uuid4(), 9)],
            "inv-B": [(0.0, 6.0, loose_b, uuid4(), 5), (6.0, 10.0, dense_b, uuid4(), 9)],
        },
        seen_layer_pairs=set(),
        born_accepted=True,
    )
    assert counts.edges_emitted == 2
    assert counts.edges_accepted == 2
    assert counts.edges_proposed == 0
    approvals = {
        frozenset((c.args[0].layer_a_id, c.args[0].layer_b_id)): c.args[0].user_approved
        for c in session.add.call_args_list
    }
    assert approvals[frozenset((loose_a, loose_b))] is True
    assert approvals[frozenset((dense_a, dense_b))] is True, (
        "the interior packing hop through a divided borehole carries the "
        "engineer's own correlation — it is not his to re-approve"
    )


@pytest.mark.asyncio
async def test_ba2_a_bridged_jump_pair_is_born_accepted_too() -> None:
    """A pair bridged over a column the press deliberately left undivided is
    still part of the same re-expression, so the ruling reaches it as well.

    ``test_bridged_jump_pairs_are_born_pending_even_at_the_top`` keeps pinning
    the step-2 default.
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    band_a, band_b = uuid4(), uuid4()
    await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 5.0), lb: ("inv-B", 0.0, 5.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 5.0, band_a, uuid4(), 7)],
            "inv-B": [(0.0, 5.0, band_b, uuid4(), 7)],
        },
        seen_layer_pairs=set(),
        # Not a direct litho pair — the bridged case.
        direct_litho_pairs=set(),
        born_accepted=True,
    )
    edge = session.add.call_args_list[0].args[0]
    assert edge.user_approved is True


@pytest.mark.asyncio
async def test_td1_a_tombstoned_pair_is_never_restated() -> None:
    """Owner, 2026-08-17: *"A tie i delete stays deleted"*.

    The bands are rebuilt by every subdivide — new rows, new ids — so the
    deletion is remembered as a PLACE and consulted here, at the single gate
    every emit passes.  The gate receives the candidate's two (column, depth)
    ends; the closure the caller builds does the xyz translation.
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    band_a, band_b = uuid4(), uuid4()

    def tombstoned(inv_a: str, depth_a: float, inv_b: str, depth_b: float) -> bool:
        ends = sorted([(inv_a, round(depth_a, 3)), (inv_b, round(depth_b, 3))])
        return ends == [("inv-A", 0.0), ("inv-B", 0.0)]

    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, band_a, uuid4(), 23)],
            "inv-B": [(0.0, 10.0, band_b, uuid4(), 23)],
        },
        seen_layer_pairs=set(),
        tie_tombstoned=tombstoned,
    )
    assert counts.edges_emitted == 0
    assert counts.skipped_tombstoned == 1
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_td2_a_different_depth_on_the_same_columns_still_emits() -> None:
    """The deletion covers ONE tie, not the gap — its neighbours still band."""
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    band_a, band_b = uuid4(), uuid4()

    def tombstoned(inv_a: str, depth_a: float, inv_b: str, depth_b: float) -> bool:
        # A deletion recorded two metres deeper — must not match the top pair.
        ends = sorted([(inv_a, round(depth_a, 3)), (inv_b, round(depth_b, 3))])
        return ends == [("inv-A", 2.0), ("inv-B", 2.0)]

    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 10.0, band_a, uuid4(), 23)],
            "inv-B": [(0.0, 10.0, band_b, uuid4(), 23)],
        },
        seen_layer_pairs=set(),
        tie_tombstoned=tombstoned,
    )
    assert counts.edges_emitted == 1
    assert counts.skipped_tombstoned == 0


@pytest.mark.asyncio
async def test_bl8_no_proposal_lands_below_a_lens() -> None:
    """Owner rule 2026-08-17: the below-lens repeat gets no machine proposal.

    His S13↔S12 scene: one silt beside a [silt, denser silt, silt] sandwich.
    The restatement ties the tops (accepted); the machine used to ALSO propose
    the single silt onto the below-lens repeat — a fan from an already-tied
    contact that the merge step makes redundant.  The lens band itself stays
    proposable: it is new information.
    """
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    s13_silt = uuid4()
    s12_top, s12_lens, s12_below = uuid4(), uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 6.0), lb: ("inv-B", 0.0, 6.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [(0.0, 6.0, s13_silt, uuid4(), 13)],
            "inv-B": [
                (0.0, 2.0, s12_top, uuid4(), 13),
                (2.0, 3.5, s12_lens, uuid4(), 15),
                (3.5, 6.0, s12_below, uuid4(), 13),
            ],
        },
        seen_layer_pairs=set(),
    )
    emitted = {
        frozenset((e.layer_a_id, e.layer_b_id)): e.user_approved
        for e in session.add.call_args_list
        for e in [e.args[0]]
    }
    assert emitted.get(frozenset((s13_silt, s12_top))) is True, "the restatement stands"
    assert frozenset((s13_silt, s12_below)) not in emitted, (
        "the below-lens repeat must not be proposed"
    )
    assert counts.skipped_below_lens >= 1


@pytest.mark.asyncio
async def test_bl9_a_sandwich_on_both_columns_still_gets_no_below_lens_proposal() -> None:
    """His rule is per column and unconditional — the merge owns the repeat."""
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    a_top, a_lens, a_below = uuid4(), uuid4(), uuid4()
    b_top, b_lens, b_below = uuid4(), uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 6.0), lb: ("inv-B", 0.0, 6.0)},
        geotech_layer_by_inv_depth={
            "inv-A": [
                (0.0, 2.0, a_top, uuid4(), 13),
                (2.0, 3.5, a_lens, uuid4(), 15),
                (3.5, 6.0, a_below, uuid4(), 13),
            ],
            "inv-B": [
                (0.0, 2.0, b_top, uuid4(), 13),
                (2.0, 3.6, b_lens, uuid4(), 15),
                (3.6, 6.0, b_below, uuid4(), 13),
            ],
        },
        seen_layer_pairs=set(),
    )
    emitted = {
        frozenset((e.layer_a_id, e.layer_b_id)): e.user_approved
        for e in session.add.call_args_list
        for e in [e.args[0]]
    }
    assert frozenset((a_below, b_below)) not in emitted
    # The lenses themselves are new information and may still pair.
    assert frozenset((a_lens, b_lens)) in emitted
    assert counts.skipped_below_lens >= 1


@pytest.mark.asyncio
async def test_br1_a_chained_litho_tie_restates_whatever_the_classes_are() -> None:
    """Owner, 2026-08-17: *"litho ties are packing agnostic ... you are not
    emitting the litho ties but are interpreting and emitting ties based on
    packing"*.

    His red line: the sand top S6 9.82 ↔ S13 9.69, chained S6↔B6↔B4↔S13
    through two bandless boreholes.  One side reads D, the other MD — the
    class-matched aligner dropped it, and no restatement path covered bridged
    pairs at all.  The chain must arrive as a direct connection between the
    bands owning the two contacts, classes never consulted, PENDING (a chained
    statement is derived, not one he drew — step 3 is his review).
    """
    session = _mock_session()
    s6_sand, b6_mid, b4_mid, s13_sand = uuid4(), uuid4(), uuid4(), uuid4()
    s6_band, s13_band = uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        # The layer-pair bridge the callers pass already contains the chained
        # pair; the contact walk is what turns it into a restatement.
        litho_approved_edges={
            (min(s6_sand, b6_mid), max(s6_sand, b6_mid)),
            (min(b6_mid, b4_mid), max(b6_mid, b4_mid)),
            (min(b4_mid, s13_sand), max(b4_mid, s13_sand)),
            (min(s6_sand, s13_sand), max(s6_sand, s13_sand)),
        },
        litho_layer_depths={
            s6_sand: ("inv-S6", 9.82, 12.42),
            b6_mid: ("inv-B6", 9.50, 12.59),
            b4_mid: ("inv-B4", 6.00, 12.52),
            s13_sand: ("inv-S13", 9.69, 12.90),
        },
        geotech_layer_by_inv_depth={
            # D on one side, MD on the other — the classes must not matter.
            "inv-S6": [(9.82, 12.42, s6_band, uuid4(), 7)],
            "inv-S13": [(9.69, 12.90, s13_band, uuid4(), 6)],
        },
        seen_layer_pairs=set(),
        direct_litho_pairs={
            (min(s6_sand, b6_mid), max(s6_sand, b6_mid)),
            (min(b6_mid, b4_mid), max(b6_mid, b4_mid)),
            (min(b4_mid, s13_sand), max(b4_mid, s13_sand)),
        },
        litho_sided_edges={
            (s6_sand, b6_mid, "top", "top"),
            (b6_mid, b4_mid, "top", "top"),
            (b4_mid, s13_sand, "top", "top"),
        },
        seen_sided_edges=set(),
    )
    emitted = [e.args[0] for e in session.add.call_args_list]
    chained = [e for e in emitted if {e.layer_a_id, e.layer_b_id} == {s6_band, s13_band}]
    assert len(chained) == 1, (
        f"the chained contact must restate exactly once, got {len(chained)} "
        f"of {len(emitted)} emitted"
    )
    assert chained[0].user_approved is False
    assert chained[0].layer_a_side == "top" and chained[0].layer_b_side == "top"
    assert counts.edges_proposed >= 1


@pytest.mark.asyncio
async def test_br2_a_same_class_chain_does_not_double_emit_with_the_aligner() -> None:
    """When the classes DO match, the aligner would find the same top pair —
    the model must still hold exactly one row for it."""
    session = _mock_session()
    s6_sand, b6_mid, s13_sand = uuid4(), uuid4(), uuid4()
    s6_band, s13_band = uuid4(), uuid4()
    await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={
            (min(s6_sand, b6_mid), max(s6_sand, b6_mid)),
            (min(b6_mid, s13_sand), max(b6_mid, s13_sand)),
            (min(s6_sand, s13_sand), max(s6_sand, s13_sand)),
        },
        litho_layer_depths={
            s6_sand: ("inv-S6", 9.82, 12.42),
            b6_mid: ("inv-B6", 9.50, 12.59),
            s13_sand: ("inv-S13", 9.69, 12.90),
        },
        geotech_layer_by_inv_depth={
            "inv-S6": [(9.82, 12.42, s6_band, uuid4(), 6)],
            "inv-S13": [(9.69, 12.90, s13_band, uuid4(), 6)],
        },
        seen_layer_pairs=set(),
        direct_litho_pairs={
            (min(s6_sand, b6_mid), max(s6_sand, b6_mid)),
            (min(b6_mid, s13_sand), max(b6_mid, s13_sand)),
        },
        litho_sided_edges={
            (s6_sand, b6_mid, "top", "top"),
            (b6_mid, s13_sand, "top", "top"),
        },
        seen_sided_edges=set(),
    )
    emitted = [e.args[0] for e in session.add.call_args_list]
    rows = [e for e in emitted if {e.layer_a_id, e.layer_b_id} == {s6_band, s13_band}]
    assert len(rows) == 1, f"one statement, one row — got {len(rows)}"


@pytest.mark.asyncio
async def test_de1_an_interior_pair_with_disjoint_extents_is_not_proposed() -> None:
    """DE1 (owner deletions, 2026-08-18): the machine tied S9's DEEP D band
    (fractions 0.79-1.0 of its unit) to a SHALLOW D band on S10 (0.13-0.18) —
    a 5 m diagonal he deleted on sight. Class match alone is not
    correspondence: an interior pair must OVERLAP in its litho window, or the
    machine stays silent and the engineer draws it himself."""
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    left_top, left_deep7 = uuid4(), uuid4()
    right_top, right_shallow7, right_8 = uuid4(), uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            # Left: MD to 9 m, D only at the very bottom (0.9-1.0).
            "inv-A": [(0.0, 9.0, left_top, uuid4(), 6), (9.0, 10.0, left_deep7, uuid4(), 7)],
            # Right: MD sliver, D sliver near the TOP (0.1-0.2), then VD.
            "inv-B": [
                (0.0, 1.0, right_top, uuid4(), 6),
                (1.0, 2.0, right_shallow7, uuid4(), 7),
                (2.0, 10.0, right_8, uuid4(), 8),
            ],
        },
        seen_layer_pairs=set(),
    )
    # The forced topmost restatement is the ONLY emission; the deep-left-7 ↔
    # shallow-right-7 class match never overlaps and is withheld.
    assert counts.edges_emitted == 1
    assert counts.skipped_disjoint_extent == 1
    edge = session.add.call_args.args[0]
    assert {edge.layer_a_id, edge.layer_b_id} == {left_top, right_top}


@pytest.mark.asyncio
async def test_de2_an_overlapping_interior_pair_is_still_proposed() -> None:
    """DE2: a genuinely dipping band whose extents overlap keeps its
    proposal — the gate kills class-match-without-correspondence, not
    dipping geology."""
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    left_top, left_7 = uuid4(), uuid4()
    right_top, right_7 = uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            # Left D at 0.30-0.50 of the unit, right D at 0.45-0.65: offset
            # but overlapping — a dipping sheet.
            "inv-A": [(0.0, 3.0, left_top, uuid4(), 6), (3.0, 5.0, left_7, uuid4(), 7)],
            "inv-B": [(0.0, 4.5, right_top, uuid4(), 6), (4.5, 6.5, right_7, uuid4(), 7)],
        },
        seen_layer_pairs=set(),
    )
    assert counts.edges_emitted == 2
    assert counts.skipped_disjoint_extent == 0
    emitted_pairs = [
        {call.args[0].layer_a_id, call.args[0].layer_b_id} for call in session.add.call_args_list
    ]
    assert {left_7, right_7} in emitted_pairs


@pytest.mark.asyncio
async def test_de3_a_near_miss_within_one_band_thickness_stays_proposed() -> None:
    """DE3: a band may dip by about its own thickness and still be one sheet
    — the extents miss by 0.05 of the unit against a 0.25-thick band, so the
    proposal stands. The gate kills jumps, not dips."""
    session = _mock_session()
    la, lb = uuid4(), uuid4()
    left_top, left_7 = uuid4(), uuid4()
    right_top, right_7 = uuid4(), uuid4()
    counts = await derive_geotech_edges_from_litho(
        session,
        _logger(),
        geotech_model_id=uuid4(),
        section_id=uuid4(),
        litho_approved_edges={(min(la, lb), max(la, lb))},
        litho_layer_depths={la: ("inv-A", 0.0, 10.0), lb: ("inv-B", 0.0, 10.0)},
        geotech_layer_by_inv_depth={
            # Left D at 0.30-0.50, right D at 0.55-0.80: a 0.05 miss.
            "inv-A": [(0.0, 3.0, left_top, uuid4(), 6), (3.0, 5.0, left_7, uuid4(), 7)],
            "inv-B": [(0.0, 5.5, right_top, uuid4(), 6), (5.5, 8.0, right_7, uuid4(), 7)],
        },
        seen_layer_pairs=set(),
    )
    assert counts.skipped_disjoint_extent == 0
    emitted_pairs = [
        {call.args[0].layer_a_id, call.args[0].layer_b_id} for call in session.add.call_args_list
    ]
    assert {left_7, right_7} in emitted_pairs
