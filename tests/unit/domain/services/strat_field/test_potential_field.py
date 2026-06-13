"""Stage-3 tests: the implicit potential field F(x, y, z) and its monotonicity gate.

The HARD GATE is :func:`test_field_is_monotonic_down_every_borehole` — F evaluated
DOWN every borehole must be non-decreasing across the known contacts and must cross
each horizon's iso-value at (approximately) the observed contact depth.  This pins
the central invariant of an implicit stratigraphic field: a single smooth scalar
whose isosurfaces ARE the litho contacts, stacked in order with no "bubbling".

The dip test pins that the field reproduces a dipping horizon (deeper on the
down-dip side); the interbedding tests pin that a repeated lithology gets two
distinct isosurfaces at its two ranks.  All assertions are phrased in the field /
isosurface / contact / dip / monotonic vocabulary, not the interpolation
implementation.
"""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.strat_field.potential_field import (
    PotentialField,
    fit_potential_field,
)
from tests.unit.domain.services.strat_field.fixtures import (
    BoreholeProbe,
    dipping_block,
    dipping_control_with_holes,
    interbedded_block,
    interbedded_control_with_holes,
)

# ---------------------------------------------------------------------------
# Test helpers — sample the field along a vertical line to locate an isosurface
# ---------------------------------------------------------------------------


def _isosurface_depth(
    field: PotentialField,
    iso: float,
    x: float,
    y: float,
    surface: float,
    *,
    z_bottom: float,
    step: float = 0.1,
) -> float:
    """Return the DEPTH (surface − z) where F crosses ``iso`` on the vertical at (x, y).

    Samples F down a vertical line from ``surface`` to ``z_bottom`` and finds the
    z where the field first reaches ``iso``, linearly interpolating between the
    two bracketing samples.  A larger returned depth means the isosurface lies
    deeper at that map position.

    Parameters
    ----------
    field : PotentialField
        The fitted potential field.
    iso : float
        The iso-value whose crossing depth is sought.
    x, y : float
        Map position of the vertical line (project CRS).
    surface : float
        Top elevation of the line (depth datum: depth = surface − z).
    z_bottom : float
        Bottom elevation of the sampled line.
    step : float, optional
        Vertical sample spacing in metres.  Default 0.1 m.

    Returns
    -------
    float
        The depth (metres below ``surface``) of the F == ``iso`` crossing.

    Raises
    ------
    AssertionError
        If the field never reaches ``iso`` on the sampled line (the bracket is
        missing — a fixture/tolerance problem the test should surface).
    """
    zs = np.arange(surface, z_bottom - step, -step)
    vals = field.evaluate([(x, y, float(z)) for z in zs])
    for i in range(len(zs) - 1):
        v0, v1 = vals[i], vals[i + 1]
        # F increases with depth, so going DOWN (i → i+1) v should rise through iso.
        if (v0 - iso) <= 0.0 <= (v1 - iso) or (v0 - iso) >= 0.0 >= (v1 - iso):
            frac = 0.0 if v1 == v0 else (iso - v0) / (v1 - v0)
            z_cross = zs[i] + frac * (zs[i + 1] - zs[i])
            return surface - z_cross
    raise AssertionError(
        f"field never crossed iso={iso} on the vertical at ({x}, {y}); "
        f"value range was [{vals.min()}, {vals.max()}]"
    )


# ---------------------------------------------------------------------------
# THE HARD GATE — monotonicity down every borehole
# ---------------------------------------------------------------------------


def test_field_is_monotonic_down_every_borehole() -> None:
    """F evaluated DOWN a borehole is non-decreasing across the known contacts,
    and crosses each iso-value at (approx) the observed contact depth."""
    control, order, holes = interbedded_control_with_holes()
    field = fit_potential_field(control, blocks=[interbedded_block()])

    for hole in holes:
        vals = field.evaluate(hole.xyz_descending)
        # The field never decreases as we go down the hole — no bubbling.
        assert all(b >= a - 1e-6 for a, b in zip(vals, vals[1:])), (
            f"field bubbled (decreased) down hole {hole.investigation_id}: {vals}"
        )
        # Each observed contact sits where the field equals that horizon's iso-value.
        for rank, depth in hole.observed_contacts:
            z = hole.surface - depth
            got = field.evaluate([(hole.x, hole.y, z)])[0]
            assert abs(got - order.iso_value(rank)) < 0.25, (
                f"hole {hole.investigation_id} contact rank {rank} at depth {depth} m: "
                f"F={got}, expected iso={order.iso_value(rank)}"
            )


def test_dip_is_reproduced() -> None:
    """The deeper-on-one-side contact reads back as a deeper isosurface there.

    The dipping fixture's rank-1 internal horizon (ZAND/VEEN in this column)
    descends west→east; sampling the field on the up-dip (west) vs down-dip
    (east) verticals must put the isosurface DEEPER down-dip.
    """
    control, order, holes = dipping_control_with_holes()
    field = fit_potential_field(control, blocks=[dipping_block()])

    # Order the probes by their internal-contact depth: shallowest = up-dip,
    # deepest = down-dip.  Use the deepest internal horizon (the one that dips).
    dipping_rank = max(rank for h in holes for rank, _ in h.observed_contacts)

    def deepest_contact_depth(hole: BoreholeProbe) -> float:
        return max(d for r, d in hole.observed_contacts if r == dipping_rank)

    up_dip = min(holes, key=deepest_contact_depth)
    down_dip = max(holes, key=deepest_contact_depth)

    block = dipping_block()
    iso = order.iso_value(dipping_rank)

    depth_up = _isosurface_depth(
        field, iso, up_dip.x, up_dip.y, up_dip.surface, z_bottom=block.z_min
    )
    depth_down = _isosurface_depth(
        field, iso, down_dip.x, down_dip.y, down_dip.surface, z_bottom=block.z_min
    )
    # The c1 isosurface is DEEPER on the down-dip side than the up-dip side.
    assert depth_down > depth_up, (
        f"dip not reproduced: isosurface depth up-dip={depth_up}, down-dip={depth_down}"
    )


# ---------------------------------------------------------------------------
# Behavioural tests in the field / contact / isosurface vocabulary
# ---------------------------------------------------------------------------


def test_evaluate_returns_1d_float_ndarray_of_matching_length() -> None:
    """``evaluate`` is vectorised: N query points → a length-N 1-D float ndarray."""
    control, _order, _holes = interbedded_control_with_holes()
    field = fit_potential_field(control, blocks=[interbedded_block()])

    query = [(200_000.0, 200_000.0, 4.0), (200_200.0, 200_000.0, 1.0), (200_400.0, 200_000.0, -2.0)]
    out = field.evaluate(query)

    assert isinstance(out, np.ndarray)
    assert out.ndim == 1
    assert out.shape == (3,)
    assert np.issubdtype(out.dtype, np.floating)


def test_field_equals_iso_value_at_a_control_point() -> None:
    """At an observed contact location the field reads back that contact's iso-value.

    The contact at rank 1 in column A sits at z = surface − depth; the field
    must equal ``order.iso_value(1)`` there to within the smoothing tolerance.
    """
    control, order, holes = interbedded_control_with_holes()
    field = fit_potential_field(control, blocks=[interbedded_block()])

    hole = holes[0]
    rank, depth = hole.observed_contacts[0]
    z = hole.surface - depth
    got = field.evaluate([(hole.x, hole.y, z)])[0]
    assert abs(got - order.iso_value(rank)) < 0.25


def test_interbedded_repeated_lithology_has_two_distinct_isosurfaces() -> None:
    """A lithology that repeats (ZAND at two ranks) yields two distinct isosurfaces.

    The interbedded column has ZAND at rank 0 (upper, surface — not a control
    point) and ZAND again as a lower body whose top is an internal contact.  The
    upper SILT (rank 1) and lower ZAND (rank 2) are distinct horizons; their
    isosurfaces must sit at different depths down the same hole (the field does
    not collapse the repeated lithology onto one surface).
    """
    control, order, holes = interbedded_control_with_holes()
    field = fit_potential_field(control, blocks=[interbedded_block()])
    block = interbedded_block()

    hole = holes[0]
    ranks = sorted({rank for rank, _ in hole.observed_contacts})
    # Need at least the first two internal horizons to compare.
    assert len(ranks) >= 2

    depths = [
        _isosurface_depth(
            field,
            order.iso_value(rank),
            hole.x,
            hole.y,
            hole.surface,
            z_bottom=block.z_min,
        )
        for rank in ranks
    ]
    # Deeper rank → deeper isosurface, strictly increasing depth with rank.
    assert all(b > a for a, b in zip(depths, depths[1:])), (
        f"repeated-lithology isosurfaces not distinct/ordered: ranks={ranks}, depths={depths}"
    )


def test_single_block_masks_to_the_block_domain() -> None:
    """v1 runs one block; evaluating inside that block returns finite field values."""
    control, _order, _holes = interbedded_control_with_holes()
    block = interbedded_block()
    field = fit_potential_field(control, blocks=[block])

    cx = sum(p[0] for p in block.polygon) / len(block.polygon)
    cy = sum(p[1] for p in block.polygon) / len(block.polygon)
    cz = 0.5 * (block.z_min + block.z_max)
    out = field.evaluate([(cx, cy, cz)])
    assert np.all(np.isfinite(out))
