"""How much of a body survives at a point, taken from where it is measured to die.

``max(0, 2w - 1)`` already tapers a one-sided body to nothing — but at the
equidistance midline, because that is all the builder knew. With ``w = d2/(d1+d2)``
it reaches zero exactly where the two sections are equally near. So the measured
edge is a drop-in for the assumed one: same shape of formula, a different anchor.

Phrased in the ground's vocabulary: at the section that carries the body it is at
full thickness, at the place it is measured to die it is gone, and it thins between
the two.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.voxel_litho.pinch_terminations import (
    Termination,
    pinch_factor,
)


def _at(x: float, y: float) -> Termination:
    """A termination at a world position; its classification is irrelevant here."""
    return Termination(body_id="b", world_x=x, world_y=y, kind="lens", section_index=0)


def test_on_the_section_that_carries_it_the_body_is_at_full_thickness() -> None:
    """Standing on the section, nothing has thinned yet."""
    assert pinch_factor((0.0, 0.0), 0.0, [_at(50.0, 0.0)]) == 1.0


def test_where_it_is_measured_to_die_the_body_is_gone() -> None:
    """Standing on the measured termination, none of it is left."""
    assert pinch_factor((50.0, 0.0), 50.0, [_at(50.0, 0.0)]) == 0.0


def test_halfway_between_the_two_it_is_half_thick() -> None:
    """25 m from the section and 25 m from the termination leaves half."""
    assert math.isclose(pinch_factor((25.0, 0.0), 25.0, [_at(50.0, 0.0)]), 0.5)


def test_the_nearest_measurement_governs() -> None:
    """A body dying in several places thins toward whichever is closest."""
    near, far = _at(10.0, 0.0), _at(500.0, 0.0)

    assert math.isclose(
        pinch_factor((5.0, 0.0), 5.0, [far, near]),
        pinch_factor((5.0, 0.0), 5.0, [near]),
    )


def test_it_reproduces_the_old_midline_rule_when_the_edge_IS_the_midline() -> None:
    """The drop-in check: an edge at the midline gives back ``max(0, 2w - 1)``.

    Two sections 100 m apart, the body on the first. At 30 m out the old rule has
    w = 70/100 and yields 0.4. If the body is measured to die at the midline — 50 m —
    the new rule must agree, or this is a different formula wearing the same name.
    """
    d1, d2 = 30.0, 70.0
    old = max(0.0, 2.0 * (d2 / (d1 + d2)) - 1.0)

    new = pinch_factor((30.0, 0.0), d1, [_at(50.0, 0.0)])

    assert math.isclose(new, old, abs_tol=1e-9)


def test_a_body_measured_to_die_nowhere_gets_no_answer() -> None:
    """No termination means no evidence, so the caller must keep the old rule.

    Returning a number here would invent a pinch where nothing was measured, which
    is the whole failure this replaces.
    """
    assert pinch_factor((10.0, 0.0), 10.0, []) is None
