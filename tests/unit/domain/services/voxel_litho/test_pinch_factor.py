"""How much of a body survives at a point, from where it is measured to die.

The first version of this file was written after the formula and confirmed it. Every
case placed the apex BEYOND the query, collinear — the geometry that occurs in 8-13 %
of real occurrences — so a hard floor at 0.5 shipped with green tests. The rule these
cases encode instead:

* an apex on the body's OWN section says where it ends ALONG that section, which the
  2-D slice already honours. It says nothing about how far the body reaches AWAY from
  it, so it must not be treated as a measurement of that;
* an apex on ANOTHER section does measure that, and the body must reach zero there;
* with no such apex there is no evidence, and the caller must fall back rather than
  invent a pinch.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.voxel_litho.pinch_terminations import (
    Termination,
    pinch_factor,
)

_OWN, _OTHER = 0, 1


def _apex(x: float, y: float, section: int) -> Termination:
    """A termination at a world position on a given section."""
    return Termination(body_id="b", world_x=x, world_y=y, kind="lens", section_index=section)


def test_an_apex_on_the_bodys_own_section_measures_nothing_about_reach() -> None:
    """The bug that shipped: an apex on the very fence the distance is measured to.

    ``distance_to_section`` is the MINIMUM distance to that fence, so the distance to
    any point on it can never be shorter — the old formula was pinned at exactly 0.5
    and no body tapered to nothing anywhere. The apex is real, but it bounds the body
    along the section, not away from it, so it is not evidence here.
    """
    for distance in (1.0, 10.0, 50.0, 200.0):
        assert (
            pinch_factor((0.0, distance), distance, [_apex(0.0, 0.0, _OWN)], own_section_index=_OWN)
            is None
        )


def test_on_its_own_section_the_body_is_at_full_thickness() -> None:
    """Standing on the section that carries it, nothing has thinned yet."""
    factor = pinch_factor((0.0, 0.0), 0.0, [_apex(0.0, 100.0, _OTHER)], own_section_index=_OWN)

    assert factor == 1.0


def test_at_the_apex_on_another_section_the_body_is_gone() -> None:
    """Where a different section measures it to end, none of it is left."""
    factor = pinch_factor((0.0, 100.0), 100.0, [_apex(0.0, 100.0, _OTHER)], own_section_index=_OWN)

    assert factor == 0.0


def test_halfway_to_that_apex_it_is_half_thick() -> None:
    """50 m from its section and 50 m from the apex leaves half."""
    factor = pinch_factor((0.0, 50.0), 50.0, [_apex(0.0, 100.0, _OTHER)], own_section_index=_OWN)

    assert math.isclose(factor, 0.5)


def test_own_section_apexes_are_ignored_even_when_they_are_nearer() -> None:
    """A near apex on the body's own section must not out-vote a far one that counts.

    This is the shipped bug in its most direct form: the own-section apex is 1 m away
    and the real evidence 100 m away, and using the nearer one pins the answer at 0.5
    forever.
    """
    factor = pinch_factor(
        (0.0, 20.0),
        20.0,
        [_apex(0.0, 21.0, _OWN), _apex(0.0, 100.0, _OTHER)],
        own_section_index=_OWN,
    )

    assert math.isclose(factor, 80.0 / 100.0)


def test_the_nearest_apex_that_counts_governs() -> None:
    """Among apexes on other sections, the closest one decides."""
    near, far = _apex(0.0, 60.0, _OTHER), _apex(0.0, 500.0, 2)

    assert math.isclose(
        pinch_factor((0.0, 20.0), 20.0, [far, near], own_section_index=_OWN),
        pinch_factor((0.0, 20.0), 20.0, [near], own_section_index=_OWN),
    )


def test_a_body_measured_to_die_nowhere_gets_no_answer() -> None:
    """No apex at all means no evidence, so the caller keeps the old rule."""
    assert pinch_factor((10.0, 0.0), 10.0, [], own_section_index=_OWN) is None
