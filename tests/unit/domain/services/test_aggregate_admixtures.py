"""Unit pins for ``_aggregate_admixtures`` — debt #66 resolution.

The aggregator decides which admixtures from contributing observation
layers should survive into the merged run's representation, using a
two-threshold rule plus a dominant-amount selection per soil_code.
"""

from __future__ import annotations

from groundmodel.domain.services.litho_segmentation import (
    ADMIXTURE_MAJORITY_THRESHOLD,
    ADMIXTURE_PRESENCE_FLOOR,
    ADMIXTURE_SECONDARY_THRESHOLD,
    _aggregate_admixtures,
)
from groundmodel.domain.value_objects.admixture import Admixture


def _adm(soil_code: str, amount: str = "M", locally: bool = False) -> Admixture:
    """Build a sentinel Admixture with sensible defaults."""
    return Admixture(soil_code=soil_code, amount=amount, locally=locally)


# ---------------------------------------------------------------------------
# A1 — primary threshold: thickness > 50% of run → included.
# ---------------------------------------------------------------------------


def test_a1_primary_threshold_above_50_percent_included() -> None:
    """An admixture spanning > 50% of the run's total thickness is included."""
    # Three layers of 1m each (total 3m). "Siltig" present in 2 layers
    # → total 2m → 66% > 50%, passes primary.
    layers: list[list[Admixture]] = [[_adm("Z")], [_adm("Z")], []]
    thicknesses = [1.0, 1.0, 1.0]
    out = _aggregate_admixtures(layers, thicknesses, 0, 3)
    assert len(out) == 1
    assert out[0].soil_code == "Z"


def test_a1b_primary_threshold_at_exactly_50_percent_excluded() -> None:
    """At exactly 50% the strict ``>`` rule rejects — only majority counts.

    Boundary semantics matter for thin interbedded layers that just
    barely tie — the secondary threshold catches those when they ALSO
    have wide presence.
    """
    # Two equal layers, "Z" in one only → 50% exactly, fails primary
    # AND fails secondary (only 1 contributing layer, below floor of 3).
    layers: list[list[Admixture]] = [[_adm("Z")], []]
    thicknesses = [1.0, 1.0]
    out = _aggregate_admixtures(layers, thicknesses, 0, 2)
    assert out == ()


# ---------------------------------------------------------------------------
# A2 — below both thresholds: excluded.
# ---------------------------------------------------------------------------


def test_a2_below_secondary_threshold_excluded() -> None:
    """An admixture below 25% AND below the presence floor is dropped."""
    # 10 layers of 1m each (total 10m). "Z" in 2 layers → 2m / 10m = 20%
    # → fails primary (20% < 50%), fails secondary (20% < 25% OR only 2
    # contributing layers — also short of floor).
    layers: list[list[Admixture]] = [[_adm("Z")], [_adm("Z")]] + [[] for _ in range(8)]
    thicknesses = [1.0] * 10
    out = _aggregate_admixtures(layers, thicknesses, 0, 10)
    assert out == ()


# ---------------------------------------------------------------------------
# A3 — secondary threshold: 25%-50% thickness AND >= 3 layers → included.
# ---------------------------------------------------------------------------


def test_a3_secondary_threshold_pervasive_interbedded_included() -> None:
    """The 'thin interbedded' case: 30% thickness across 3 layers passes.

    This is the geological scenario the resolution was designed to
    capture — a secondary signal that IS pervasive even when no single
    layer dominates the run.
    """
    # 6 layers of 1m each (total 6m). "Z" present in 3 layers, each
    # contributing 1m → total 3m → 50% of run.
    # Wait that's at the 50% boundary. Let's use 4 layers contributing.
    # 10 layers of 1m → total 10m. "Z" in 3 layers → 3m → 30%.
    # 30% > 25% AND 3 layers >= floor → passes secondary.
    layers: list[list[Admixture]] = [[_adm("Z")]] * 3 + [[] for _ in range(7)]
    thicknesses = [1.0] * 10
    out = _aggregate_admixtures(layers, thicknesses, 0, 10)
    assert len(out) == 1
    assert out[0].soil_code == "Z"


# ---------------------------------------------------------------------------
# A4 — 25%-50% thickness but < presence floor: excluded.
# ---------------------------------------------------------------------------


def test_a4_secondary_threshold_concentrated_under_presence_floor_excluded() -> None:
    """30% thickness in only 2 layers → fails the presence floor → excluded.

    Distinguishes "pervasive secondary" (kept) from "concentrated in a
    couple of fat layers" (dropped — the primary threshold's job is to
    catch dominant signals; a fat-but-localised signal is neither).
    """
    # 10 layers of 1m each. "Z" in 2 layers at 1.5m each → 3m / 10m = 30%
    # but only 2 contributing layers < floor of 3.
    # We can't make two layers 1.5m AND total still 10m without
    # adjusting other layers — simpler: 2 layers of 1.5m + 7 layers of 1m → total 10m.
    layers: list[list[Admixture]] = [[_adm("Z")], [_adm("Z")]] + [[] for _ in range(7)]
    thicknesses = [1.5, 1.5] + [1.0] * 7  # total 10m
    out = _aggregate_admixtures(layers, thicknesses, 0, 9)
    # 3m / 10m = 30% > 25% but layer_count = 2 < floor of 3 → excluded.
    assert out == ()


# ---------------------------------------------------------------------------
# A5 — dominant amount selection across mixed strengths.
# ---------------------------------------------------------------------------


def test_a5_dominant_amount_selected_by_thickness() -> None:
    """When the same soil_code appears with different amounts, the dominant amount wins."""
    # 4 layers: 3 with "Z" amount="zwak" (1m each), 1 with "Z" amount="sterk" (1m).
    # All four pass primary together (Z thickness = 4m / 4m = 100%).
    # zwak total = 3m vs sterk total = 1m → dominant amount is "zwak".
    layers: list[list[Admixture]] = [
        [_adm("Z", amount="zwak")],
        [_adm("Z", amount="zwak")],
        [_adm("Z", amount="zwak")],
        [_adm("Z", amount="sterk")],
    ]
    thicknesses = [1.0, 1.0, 1.0, 1.0]
    out = _aggregate_admixtures(layers, thicknesses, 0, 4)
    assert len(out) == 1
    assert out[0].soil_code == "Z"
    assert out[0].amount == "zwak"


# ---------------------------------------------------------------------------
# A6 — locally inversion: global wins over local.
# ---------------------------------------------------------------------------


def test_a6_locally_global_when_any_contributing_layer_is_global() -> None:
    """Any contributing layer with a global admixture (locally=False) makes the result global."""
    # 3 layers all with "Z": layer 0 locally=True, layers 1+2 locally=False.
    # Any global → result global.
    layers: list[list[Admixture]] = [
        [_adm("Z", locally=True)],
        [_adm("Z", locally=False)],
        [_adm("Z", locally=False)],
    ]
    thicknesses = [1.0, 1.0, 1.0]
    out = _aggregate_admixtures(layers, thicknesses, 0, 3)
    assert len(out) == 1
    assert out[0].locally is False


def test_a6b_locally_true_only_when_every_contributing_layer_is_local() -> None:
    """All contributing layers report locally=True → result is locally=True."""
    layers: list[list[Admixture]] = [
        [_adm("Z", locally=True)],
        [_adm("Z", locally=True)],
        [_adm("Z", locally=True)],
    ]
    thicknesses = [1.0, 1.0, 1.0]
    out = _aggregate_admixtures(layers, thicknesses, 0, 3)
    assert len(out) == 1
    assert out[0].locally is True


# ---------------------------------------------------------------------------
# Constants sanity — pinned so the resolution's thresholds can't drift.
# ---------------------------------------------------------------------------


def test_constants_default_values_unchanged() -> None:
    """The owner-tunable defaults stay at the resolution values."""
    assert ADMIXTURE_MAJORITY_THRESHOLD == 0.5
    assert ADMIXTURE_SECONDARY_THRESHOLD == 0.25
    assert ADMIXTURE_PRESENCE_FLOOR == 3
