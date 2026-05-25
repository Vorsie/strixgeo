"""Unit tests for the auto-correlate domain algorithm (#127).

Domain model context
--------------------
In the lithostratigraphic model each accepted CPT / borehole creates one
``geological_formation`` row per lithology layer at that investigation.
So two CPTs each with a ZAND layer produce TWO separate formation rows,
both with the same (parent_formation_id, litho_main_soil_code) group key.
The algorithm auto-correlates these different formation rows when their
contacts appear at matching depths.

Test coverage
-------------
- Two-investigation happy path (two separate formations, same group)
- Mutual-nearest-neighbour disambiguation (3 formations on A, 2 on B)
- Distance-aware threshold: 5 m → 2.05 m window, 500 m → 7 m window
- Cross-group rejection (different litho_main_soil_code → no candidate)
- Same-formation self-loop skip (fa_id == fb_id → no candidate)
- Idempotency
- Existing edges excluded from output
- Tertiary-less site: dip transfer only after min_edges_for_dip_transfer
- Confidence gate fallback (< 3 edges → naïve centre)
- Outlier resistance (Theil-Sen filters bad edge from poisoning dip)
- Cross-group dip transfer (slope from group 1 carries to group 2)
- Empty / degenerate inputs
- Pair beyond MAX_COLUMN_DISTANCE_M → excluded
- robust_slope_fit: edge cases + known values
- _mutual_nearest_neighbour: empty, single, non-mutual, disambiguation
"""

from __future__ import annotations

import uuid
from uuid import UUID

import pytest

from groundmodel.domain.services.auto_correlate import (
    AutoCorrelateParams,
    CorrelationCandidate,
    FormationContactRecord,
    _CandidatePair,
    auto_correlate_litho_bodies,
    robust_slope_fit,
)
from groundmodel.domain.services.auto_correlate import (
    _mutual_nearest_neighbour as mutual_nearest_neighbour,
)
from groundmodel.domain.services.auto_correlate_constants import AUTO_SOURCE

# ---------------------------------------------------------------------------
# Deterministic UUID helpers
# ---------------------------------------------------------------------------

_NS = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")


def _uid(seed: str) -> UUID:
    """Return a deterministic UUID5 for the given seed string."""
    return uuid.uuid5(_NS, seed)


# ---------------------------------------------------------------------------
# Test fixtures / builder helpers
# ---------------------------------------------------------------------------


def _inv(seed: str, x: float, y: float):  # noqa: ANN201
    """Build an InvestigationLocation."""
    from groundmodel.domain.services.auto_correlate import InvestigationLocation

    return InvestigationLocation(investigation_id=_uid(seed), x=x, y=y)


def _contact(
    seed: str,
    formation_seed: str,
    inv_seed: str,
    depth: float,
    parent_seed: str = "parent",
    litho: str = "ZAND",
) -> FormationContactRecord:
    """Build a FormationContactRecord."""
    return FormationContactRecord(
        contact_id=_uid(seed),
        formation_id=_uid(formation_seed),
        investigation_id=_uid(inv_seed),
        depth_top_m=depth,
        parent_formation_id=_uid(parent_seed),
        litho_main_soil_code=litho,
    )


# ---------------------------------------------------------------------------
# robust_slope_fit tests
# ---------------------------------------------------------------------------


class TestRobustSlopeFit:
    def test_less_than_two_returns_none(self) -> None:
        assert robust_slope_fit([]) is None
        assert robust_slope_fit([(1.0, 2.0)]) is None

    def test_two_points_exact_slope(self) -> None:
        # slope = (4 - 2) / (3 - 1) = 1.0
        result = robust_slope_fit([(1.0, 2.0), (3.0, 4.0)])
        assert result == pytest.approx(1.0)

    def test_three_points_odd_median(self) -> None:
        # All pairwise slopes = 1.0 → median = 1.0
        result = robust_slope_fit([(2.0, 4.0), (4.0, 6.0), (6.0, 8.0)])
        assert result == pytest.approx(1.0)

    def test_four_points_even_median(self) -> None:
        # All slopes = 2.0 → median of even count = average of two middle = 2.0
        result = robust_slope_fit([(0.0, 0.0), (1.0, 2.0), (2.0, 4.0), (3.0, 6.0)])
        assert result == pytest.approx(2.0)

    def test_outlier_resistance(self) -> None:
        """A single extreme outlier does not dominate the Theil-Sen estimate."""
        # 9 points on slope=1.0; one outlier with implied slope=100
        good = [(float(x), float(x)) for x in range(9)]  # slope 1 throughout
        bad_point = (0.5, 50.5)  # creates slope 100 against almost every point
        result = robust_slope_fit(good + [bad_point])
        # Median should remain close to 1.0
        assert result == pytest.approx(1.0, abs=0.5)

    def test_all_same_x_returns_none(self) -> None:
        """Vertical relationship — no valid pairwise slopes, returns None."""
        result = robust_slope_fit([(1.0, 2.0), (1.0, 4.0)])
        assert result is None

    def test_known_dip_value(self) -> None:
        """Theil-Sen recovers a known non-unit slope exactly.

        ``robust_slope_fit`` fits ``(depth_B_i − depth_B_j) / (depth_A_i − depth_A_j)``.
        For three edges whose depths at B increase twice as fast as at A, the
        slope is 2.0 (not 1.0).  That scenario represents a 2:1 depth-ratio
        relationship between two columns — an unusual but valid stratigraphic dip.
        """
        # depth_A: 1, 2, 3 → depth_B: 2, 4, 6 (slope = 2.0)
        pairs = [(1.0, 2.0), (2.0, 4.0), (3.0, 6.0)]
        result = robust_slope_fit(pairs)
        assert result == pytest.approx(2.0, rel=1e-6)


# ---------------------------------------------------------------------------
# _mutual_nearest_neighbour tests
# ---------------------------------------------------------------------------


class TestMutualNearestNeighbour:
    def _cand(
        self, fa_seed: str, fb_seed: str, depth_a: float, depth_b: float, res: float
    ) -> _CandidatePair:
        return _CandidatePair(
            formation_a_id=_uid(fa_seed),
            formation_b_id=_uid(fb_seed),
            depth_a=depth_a,
            depth_b=depth_b,
            residual=res,
        )

    def test_empty_candidates(self) -> None:
        assert mutual_nearest_neighbour([]) == []

    def test_single_mutual_pair(self) -> None:
        cand = self._cand("fa", "fb", 5.0, 5.1, 0.1)
        result = mutual_nearest_neighbour([cand])
        assert len(result) == 1
        assert result[0] == cand

    def test_non_mutual_rejected(self) -> None:
        """fa → fb (0.1) and fa → fc (0.05): fa picks fc; fb has no mutual match."""
        fa = _uid("fa")
        fb = _uid("fb")
        fc = _uid("fc")
        c1 = _CandidatePair(
            formation_a_id=fa, formation_b_id=fb, depth_a=5.0, depth_b=5.1, residual=0.1
        )
        c2 = _CandidatePair(
            formation_a_id=fa, formation_b_id=fc, depth_a=5.0, depth_b=5.05, residual=0.05
        )
        result = mutual_nearest_neighbour([c1, c2])
        # fa's best-B is fc (lower residual); fc's best-A is fa → mutual
        # fb has no mutual partner
        assert len(result) == 1
        assert result[0].formation_b_id == fc

    def test_three_on_two_disambiguation(self) -> None:
        """3 formations on A side, 2 on B side → correct 2 mutual pairs."""
        fa1, fa2, fa3 = _uid("mnn_fa1"), _uid("mnn_fa2"), _uid("mnn_fa3")
        fb1, fb2 = _uid("mnn_fb1"), _uid("mnn_fb2")
        # fa1↔fb1 (residual 0.05), fa2↔fb2 (residual 0.05), fa3 has no close partner
        candidates = [
            _CandidatePair(fa1, fb1, 1.0, 1.05, 0.05),
            _CandidatePair(fa1, fb2, 1.0, 5.05, 4.05),
            _CandidatePair(fa2, fb1, 5.0, 1.05, 4.05),
            _CandidatePair(fa2, fb2, 5.0, 5.05, 0.05),
            _CandidatePair(fa3, fb1, 9.0, 1.05, 7.95),
            _CandidatePair(fa3, fb2, 9.0, 5.05, 3.95),
        ]
        result = mutual_nearest_neighbour(candidates)
        result_a_ids = {r.formation_a_id for r in result}
        result_b_ids = {r.formation_b_id for r in result}
        assert fa1 in result_a_ids
        assert fa2 in result_a_ids
        assert fb1 in result_b_ids
        assert fb2 in result_b_ids
        assert len(result) == 2


# ---------------------------------------------------------------------------
# auto_correlate_litho_bodies tests
# ---------------------------------------------------------------------------


class TestAutoCorrelateLithoBodies:
    # ------------------------------------------------------------------
    # Empty / degenerate inputs
    # ------------------------------------------------------------------

    def test_no_contacts_returns_empty(self) -> None:
        i1 = _inv("i1", 0.0, 0.0)
        i2 = _inv("i2", 100.0, 0.0)
        result = auto_correlate_litho_bodies([], [i1, i2])
        assert result == []

    def test_single_investigation_returns_empty(self) -> None:
        i1 = _inv("i1", 0.0, 0.0)
        c = _contact("c1", "f1", "i1", 5.0)
        result = auto_correlate_litho_bodies([c], [i1])
        assert result == []

    def test_zero_investigations_returns_empty(self) -> None:
        c = _contact("c1", "f1", "i1", 5.0)
        result = auto_correlate_litho_bodies([c], [])
        assert result == []

    # ------------------------------------------------------------------
    # Happy path
    # ------------------------------------------------------------------

    def test_two_formation_happy_path(self) -> None:
        """Two columns, two sibling formations in the same group, matching depths → one edge."""
        i1 = _inv("hp_i1", 0.0, 0.0)
        i2 = _inv("hp_i2", 100.0, 0.0)
        # Two different formations in the same naming group
        c1 = _contact("hp_c1", "hp_f1", "hp_i1", 5.0, parent_seed="hp_parent", litho="KLEI")
        c2 = _contact("hp_c2", "hp_f2", "hp_i2", 5.1, parent_seed="hp_parent", litho="KLEI")
        result = auto_correlate_litho_bodies([c1, c2], [i1, i2])
        assert len(result) == 1
        assert result[0].source == AUTO_SOURCE
        # Canonical ordering
        fa = min(_uid("hp_f1"), _uid("hp_f2"))
        fb = max(_uid("hp_f1"), _uid("hp_f2"))
        assert result[0].formation_a_id == fa
        assert result[0].formation_b_id == fb

    def test_source_is_auto_on_all_candidates(self) -> None:
        """Every candidate has source='auto'."""
        i1 = _inv("src_i1", 0.0, 0.0)
        i2 = _inv("src_i2", 100.0, 0.0)
        contacts = [
            _contact("src_c1", "src_f1", "src_i1", 2.0, "src_p1", "KLEI"),
            _contact("src_c2", "src_f2", "src_i2", 2.0, "src_p1", "KLEI"),
            _contact("src_c3", "src_f3", "src_i1", 5.0, "src_p2", "ZAND"),
            _contact("src_c4", "src_f4", "src_i2", 5.0, "src_p2", "ZAND"),
        ]
        result = auto_correlate_litho_bodies(contacts, [i1, i2])
        assert all(r.source == AUTO_SOURCE for r in result)
        assert len(result) == 2

    # ------------------------------------------------------------------
    # Cross-group rejection
    # ------------------------------------------------------------------

    def test_different_litho_code_rejected(self) -> None:
        """KLEI at A and ZAND at B are in different groups → no candidate."""
        i1 = _inv("cg_i1", 0.0, 0.0)
        i2 = _inv("cg_i2", 50.0, 0.0)
        c1 = _contact("cg_c1", "cg_f1", "cg_i1", 3.0, "cg_p", "KLEI")
        c2 = _contact("cg_c2", "cg_f2", "cg_i2", 3.0, "cg_p", "ZAND")  # different code
        result = auto_correlate_litho_bodies([c1, c2], [i1, i2])
        assert result == []

    def test_different_parent_rejected(self) -> None:
        """Same litho code but different parent_formation_id → different group → no edge."""
        i1 = _inv("dp_i1", 0.0, 0.0)
        i2 = _inv("dp_i2", 50.0, 0.0)
        c1 = _contact("dp_c1", "dp_f1", "dp_i1", 3.0, "dp_p1", "ZAND")
        c2 = _contact("dp_c2", "dp_f2", "dp_i2", 3.0, "dp_p2", "ZAND")  # diff parent
        result = auto_correlate_litho_bodies([c1, c2], [i1, i2])
        assert result == []

    def test_same_formation_no_self_loop(self) -> None:
        """fa_id == fb_id must be skipped — a formation cannot be correlated with itself."""
        i1 = _inv("sl_i1", 0.0, 0.0)
        i2 = _inv("sl_i2", 50.0, 0.0)
        # Same formation_id at two different investigations
        c1 = _contact("sl_c1", "sl_f1", "sl_i1", 5.0, "sl_p", "ZAND")
        c2 = _contact("sl_c2", "sl_f1", "sl_i2", 5.0, "sl_p", "ZAND")  # same f1!
        result = auto_correlate_litho_bodies([c1, c2], [i1, i2])
        assert result == []

    # ------------------------------------------------------------------
    # Distance-aware threshold
    # ------------------------------------------------------------------

    def test_distance_threshold_5m_inside(self) -> None:
        """5 m apart → window = 2.05 m; depth diff 2.04 m → inside → edge created."""
        i1 = _inv("dt5_i1", 0.0, 0.0)
        i2 = _inv("dt5_i2", 5.0, 0.0)
        c1 = _contact("dt5_c1", "dt5_f1", "dt5_i1", 5.0, "dt5_p", "ZAND")
        c2 = _contact("dt5_c2", "dt5_f2", "dt5_i2", 7.04, "dt5_p", "ZAND")  # diff 2.04 < 2.05
        result = auto_correlate_litho_bodies([c1, c2], [i1, i2])
        assert len(result) == 1

    def test_distance_threshold_5m_outside(self) -> None:
        """5 m apart; depth diff 2.06 m → outside 2.05 m window → no edge."""
        i1 = _inv("dt5o_i1", 0.0, 0.0)
        i2 = _inv("dt5o_i2", 5.0, 0.0)
        c1 = _contact("dt5o_c1", "dt5o_f1", "dt5o_i1", 5.0, "dt5o_p", "ZAND")
        c2 = _contact("dt5o_c2", "dt5o_f2", "dt5o_i2", 7.06, "dt5o_p", "ZAND")  # diff 2.06 > 2.05
        result = auto_correlate_litho_bodies([c1, c2], [i1, i2])
        assert result == []

    def test_distance_threshold_500m_inside(self) -> None:
        """500 m apart → window = 7.0 m; diff 6.9 m → inside → edge."""
        i1 = _inv("dt500_i1", 0.0, 0.0)
        i2 = _inv("dt500_i2", 500.0, 0.0)
        c1 = _contact("dt500_c1", "dt500_f1", "dt500_i1", 5.0, "dt500_p", "ZAND")
        c2 = _contact("dt500_c2", "dt500_f2", "dt500_i2", 11.9, "dt500_p", "ZAND")  # diff 6.9 < 7.0
        result = auto_correlate_litho_bodies([c1, c2], [i1, i2])
        assert len(result) == 1

    def test_pair_beyond_max_distance_excluded(self) -> None:
        """501 m apart: beyond MAX_COLUMN_DISTANCE_M=500 → excluded."""
        i1 = _inv("far_i1", 0.0, 0.0)
        i2 = _inv("far_i2", 501.0, 0.0)
        c1 = _contact("far_c1", "far_f1", "far_i1", 5.0, "far_p", "ZAND")
        c2 = _contact("far_c2", "far_f2", "far_i2", 5.0, "far_p", "ZAND")
        result = auto_correlate_litho_bodies(
            [c1, c2],
            [i1, i2],
            params=AutoCorrelateParams(max_column_distance_m=500.0),
        )
        assert result == []

    # ------------------------------------------------------------------
    # Idempotency & existing edges
    # ------------------------------------------------------------------

    def test_idempotency(self) -> None:
        """Running the algorithm twice with identical inputs produces identical output."""
        i1 = _inv("idem_i1", 0.0, 0.0)
        i2 = _inv("idem_i2", 100.0, 0.0)
        c1 = _contact("idem_c1", "idem_f1", "idem_i1", 5.0, "idem_p", "ZAND")
        c2 = _contact("idem_c2", "idem_f2", "idem_i2", 5.0, "idem_p", "ZAND")
        r1 = auto_correlate_litho_bodies([c1, c2], [i1, i2])
        r2 = auto_correlate_litho_bodies([c1, c2], [i1, i2])
        assert len(r1) == len(r2) == 1
        assert r1[0].formation_a_id == r2[0].formation_a_id
        assert r1[0].formation_b_id == r2[0].formation_b_id

    def test_existing_edges_suppressed(self) -> None:
        """A candidate whose formation pair is in existing_edges is not re-emitted."""
        i1 = _inv("ee_i1", 0.0, 0.0)
        i2 = _inv("ee_i2", 100.0, 0.0)
        c1 = _contact("ee_c1", "ee_f1", "ee_i1", 4.0, "ee_p", "KLEI")
        c2 = _contact("ee_c2", "ee_f2", "ee_i2", 4.0, "ee_p", "KLEI")
        fa = min(_uid("ee_f1"), _uid("ee_f2"))
        fb = max(_uid("ee_f1"), _uid("ee_f2"))
        r = auto_correlate_litho_bodies([c1, c2], [i1, i2], existing_edges={(fa, fb)})
        assert r == []

    # ------------------------------------------------------------------
    # Tertiary-less site / confidence gate
    # ------------------------------------------------------------------

    def test_confidence_gate_below_threshold_uses_naive(self) -> None:
        """With < min_edges_for_dip_transfer edges, slope=None → naïve centre used.

        Group 1 (deepest) provides 2 edges, group 2 gets naïve window (gate=3).
        Contact at B is 1.5 m from A's depth — inside 2.0 m base threshold.
        """
        i1 = _inv("cg2_i1", 0.0, 0.0)
        i2 = _inv("cg2_i2", 100.0, 0.0)

        # Group 1 — deepest; 2 formation pairs at 10 m (two edges accumulated)
        contacts = [
            _contact("cg2_c1a", "cg2_f1a", "cg2_i1", 10.0, "cg2_p1", "ZAND"),
            _contact("cg2_c1b", "cg2_f1b", "cg2_i2", 10.0, "cg2_p1", "ZAND"),
            _contact("cg2_c2a", "cg2_f2a", "cg2_i1", 8.0, "cg2_p1", "ZAND"),
            _contact("cg2_c2b", "cg2_f2b", "cg2_i2", 8.0, "cg2_p1", "ZAND"),
        ]

        # Group 2 — shallower; depth diff 1.5 m → inside naïve 2.0 m window
        contacts += [
            _contact("cg2_c3a", "cg2_f3a", "cg2_i1", 4.0, "cg2_p2", "KLEI"),
            _contact("cg2_c3b", "cg2_f3b", "cg2_i2", 5.5, "cg2_p2", "KLEI"),  # diff 1.5 < 2.0
        ]

        result = auto_correlate_litho_bodies(
            contacts,
            [i1, i2],
            params=AutoCorrelateParams(min_edges_for_dip_transfer=3),
        )
        # All 3 pairs should correlate
        assert len(result) == 3

    def test_tertiary_less_site_graceful_degradation(self) -> None:
        """Quaternary-only site: algorithm runs and correlates without Tertiary base."""
        i1 = _inv("tl_i1", 0.0, 0.0)
        i2 = _inv("tl_i2", 150.0, 0.0)

        contacts = [
            # KLEI layer (deeper)
            _contact("tl_c1a", "tl_f1a", "tl_i1", 4.0, "tl_quat", "KLEI"),
            _contact("tl_c1b", "tl_f1b", "tl_i2", 4.1, "tl_quat", "KLEI"),
            # ZAND layer (shallower)
            _contact("tl_c2a", "tl_f2a", "tl_i1", 1.0, "tl_quat", "ZAND"),
            _contact("tl_c2b", "tl_f2b", "tl_i2", 1.05, "tl_quat", "ZAND"),
        ]
        result = auto_correlate_litho_bodies(contacts, [i1, i2])
        assert len(result) == 2

    # ------------------------------------------------------------------
    # Outlier resistance
    # ------------------------------------------------------------------

    def test_outlier_resistance_dip_estimate(self) -> None:
        """One bad edge with a wildly wrong depth at B doesn't poison shallower dip.

        Five formation groups processed deepest-first; one outlier pair with a
        massive depth mismatch. The shallowest formation should still correlate
        correctly because Theil-Sen ignores the outlier.
        """
        i1 = _inv("or_i1", 0.0, 0.0)
        i2 = _inv("or_i2", 200.0, 0.0)

        contacts = []
        # Groups 0–3: flat at 10, 8, 6, 4 m (slope=0)
        for k in range(4):
            depth = 10.0 - k * 2.0
            contacts.append(_contact(f"or_c{k}a", f"or_f{k}a", "or_i1", depth, "or_p", "ZAND"))
            contacts.append(_contact(f"or_c{k}b", f"or_f{k}b", "or_i2", depth, "or_p", "ZAND"))

        # Group 4: outlier — massive mismatch; still gets a candidate via wide window
        # (window = 2.0 + 0.01*200 = 4.0 m; diff = 100 m → outside → no edge)
        contacts.append(_contact("or_c4a", "or_f4a", "or_i1", 2.0, "or_p", "ZAND"))
        contacts.append(_contact("or_c4b", "or_f4b", "or_i2", 102.0, "or_p", "ZAND"))

        # Group 5: flat at 0.5 m — should correlate correctly despite the outlier
        contacts.append(_contact("or_c5a", "or_f5a", "or_i1", 0.5, "or_p2", "KLEI"))
        contacts.append(_contact("or_c5b", "or_f5b", "or_i2", 0.5, "or_p2", "KLEI"))

        result = auto_correlate_litho_bodies(
            contacts,
            [i1, i2],
            params=AutoCorrelateParams(min_edges_for_dip_transfer=3),
        )
        # Groups 0–3 (4 edges) + group 5 (1 edge) = 5; group 4 outlier too far
        result_fids = {r.formation_a_id for r in result} | {r.formation_b_id for r in result}
        assert _uid("or_f5a") in result_fids or _uid("or_f5b") in result_fids

    # ------------------------------------------------------------------
    # Cross-group dip transfer
    # ------------------------------------------------------------------

    def test_cross_group_dip_transfer(self) -> None:
        """Dip from deepest group carries to shallower group.

        Setup: 2 columns 200 m apart.
        - Group 1 (deepest, depth ~10 m): dip = (12-10)/200 = 0.01 m/m
          with min_edges_for_dip_transfer=1 → dip activates immediately for group 2
        - Group 2 (depth ~6 m at A, 8 m at B = 6 + 0.01*200 = 8 m → diff 0 → edge)
        - Without dip: centre at 6.0, B=8.0, diff=2.0 — just at the 2.0 m base threshold
          (window = 2 + 0.01*200 = 4.0 m so it would actually correlate either way here)
        Use a tight base threshold to make the dip matter.
        """
        i1 = _inv("dt_i1", 0.0, 0.0)
        i2 = _inv("dt_i2", 200.0, 0.0)

        contacts = [
            # Deep group (p_deep) — provides dip estimate 0.01 m/m
            _contact("dt_c1a", "dt_f1a", "dt_i1", 10.0, "dt_p_deep", "ZAND"),
            _contact("dt_c1b", "dt_f1b", "dt_i2", 12.0, "dt_p_deep", "ZAND"),
            # Shallow group (p_shallow) — 6 m at A, 8 m at B
            # window = 0.5 + 0.01*200 = 2.5 m (tight base = 0.5)
            # naïve centre at 6.0 → |8.0 - 6.0| = 2.0 < 2.5 → actually fine without dip
            # dip-shifted centre at 6.0 + 0.01*200 = 8.0 → |8.0 - 8.0| = 0.0 → even better
            _contact("dt_c2a", "dt_f2a", "dt_i1", 6.0, "dt_p_shallow", "KLEI"),
            _contact("dt_c2b", "dt_f2b", "dt_i2", 8.0, "dt_p_shallow", "KLEI"),
        ]

        result = auto_correlate_litho_bodies(
            contacts,
            [i1, i2],
            params=AutoCorrelateParams(
                base_depth_threshold_m=0.5,  # tighter base so naïve barely works
                min_edges_for_dip_transfer=1,
            ),
        )
        assert len(result) == 2
        fids = {r.formation_a_id for r in result} | {r.formation_b_id for r in result}
        assert _uid("dt_f1a") in fids
        assert _uid("dt_f2a") in fids

    # ------------------------------------------------------------------
    # Three sand layers disambiguation (MNN via algorithm)
    # ------------------------------------------------------------------

    def test_mutual_nn_three_layers_two_candidates(self) -> None:
        """3 sibling formations at A, 2 sibling formations at B → 2 edges via MNN.

        All 6 formations share the same naming group so they're candidates
        for pairwise correlation.  The algorithm must pick the 2 closest pairs
        and leave the 3rd A-formation unmatched.
        """
        i1 = _inv("mnn3_i1", 0.0, 0.0)
        i2 = _inv("mnn3_i2", 50.0, 0.0)

        contacts = [
            # 3 formations at A: depths 1.0, 5.0, 9.0
            _contact("mnn3_c1a", "mnn3_f1a", "mnn3_i1", 1.0, "mnn3_p", "ZAND"),
            _contact("mnn3_c2a", "mnn3_f2a", "mnn3_i1", 5.0, "mnn3_p", "ZAND"),
            _contact("mnn3_c3a", "mnn3_f3a", "mnn3_i1", 9.0, "mnn3_p", "ZAND"),
            # 2 formations at B: depths 1.05, 5.05
            _contact("mnn3_c1b", "mnn3_f1b", "mnn3_i2", 1.05, "mnn3_p", "ZAND"),
            _contact("mnn3_c2b", "mnn3_f2b", "mnn3_i2", 5.05, "mnn3_p", "ZAND"),
        ]

        result = auto_correlate_litho_bodies(contacts, [i1, i2])
        # Expect exactly 2 edges: f1a↔f1b and f2a↔f2b
        assert len(result) == 2
        result_fids_a = {r.formation_a_id for r in result}
        result_fids_b = {r.formation_b_id for r in result}
        all_result_fids = result_fids_a | result_fids_b
        # f3a (at 9.0 m) should NOT be in any result — no close match at B
        assert _uid("mnn3_f3a") not in all_result_fids

    # ------------------------------------------------------------------
    # Degenerate / edge cases
    # ------------------------------------------------------------------

    def test_only_one_investigation_in_corridor(self) -> None:
        """Only one unique investigation location → < 2 participating → no output."""
        i1 = _inv("one_i1", 0.0, 0.0)
        c1 = _contact("one_c1", "one_f1", "one_i1", 5.0, "one_p", "ZAND")
        c2 = _contact("one_c2", "one_f2", "one_i1", 5.0, "one_p", "ZAND")
        result = auto_correlate_litho_bodies([c1, c2], [i1])
        assert result == []

    def test_no_matching_depths_across_groups(self) -> None:
        """Contacts at wildly different depths → all outside window → no edges."""
        i1 = _inv("nm_i1", 0.0, 0.0)
        i2 = _inv("nm_i2", 50.0, 0.0)
        c1 = _contact("nm_c1", "nm_f1", "nm_i1", 0.5, "nm_p", "ZAND")
        c2 = _contact("nm_c2", "nm_f2", "nm_i2", 50.0, "nm_p", "ZAND")  # 49.5 m apart
        result = auto_correlate_litho_bodies([c1, c2], [i1, i2])
        assert result == []

    def test_formation_not_in_investigation_list_skipped(self) -> None:
        """A contact whose investigation_id is not in the investigations list is skipped."""
        i1 = _inv("unk_i1", 0.0, 0.0)
        i2 = _inv("unk_i2", 50.0, 0.0)
        # c3 belongs to an investigation not in the corridor
        c1 = _contact("unk_c1", "unk_f1", "unk_i1", 5.0, "unk_p", "ZAND")
        c2 = _contact("unk_c2", "unk_f2", "unk_i2", 5.0, "unk_p", "ZAND")
        c3 = _contact("unk_c3", "unk_f3", "unk_i3", 5.0, "unk_p", "ZAND")  # i3 not in list
        result = auto_correlate_litho_bodies([c1, c2, c3], [i1, i2])
        # c3 is ignored; f1↔f2 should still correlate
        assert len(result) == 1
        all_fids = {r.formation_a_id for r in result} | {r.formation_b_id for r in result}
        assert _uid("unk_f3") not in all_fids
