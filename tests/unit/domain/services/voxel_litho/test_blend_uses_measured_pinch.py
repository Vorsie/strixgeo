"""The blend must thin a one-sided body to where it is MEASURED to end.

``_blend_stacks`` thinned every one-sided body with ``max(0, 2w - 1)``, which reaches
zero at the equidistance midline — an assumption, and on the dev model it disagrees
with the measured end by a median of 0.166 m of thickness over 1,240 occurrences.

Phrased in the ground's vocabulary: where the partition says a body ends, the blend
must use that; where it says nothing, the old rule stands, because inventing a pinch
is the failure being replaced.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.voxel_litho.label_voxels import _blend_stacks, _Entry


def _one_sided() -> tuple[list[_Entry], list[_Entry]]:
    """Two stacks sharing a band, with a 4 m body present on the first only."""
    stack1 = [
        _Entry("shared", "ZAND", 10.0, 6.0, "quad"),
        _Entry("alone", "SILT", 6.0, 2.0, "lens"),
    ]
    stack2 = [_Entry("shared", "ZAND", 10.0, 6.0, "quad")]
    return stack1, stack2


def _thickness_of(stack: list[_Entry], body: str) -> float:
    """Total metres of one body in a blended stack."""
    return sum(e.top_elev - e.base_elev for e in stack if e.body_id == body)


def test_without_a_measurement_the_old_midline_rule_stands() -> None:
    """No evidence, no change: the body still thins by ``max(0, 2w - 1)``.

    Falling back matters — 0 of 1,240 occurrences on the dev model need it, but a
    body measured to die nowhere must not be pinched on a guess.
    """
    stack1, stack2 = _one_sided()
    w1 = 0.8

    blended = _blend_stacks(stack1, stack2, w1)

    assert math.isclose(_thickness_of(blended, "alone"), 4.0 * max(0.0, 2 * w1 - 1), abs_tol=1e-9)


def test_a_measured_end_replaces_the_midline_for_that_body() -> None:
    """Given a factor for the body, the blend uses it instead of the midline."""
    stack1, stack2 = _one_sided()

    blended = _blend_stacks(stack1, stack2, 0.8, pinch1={"alone": 0.25})

    assert math.isclose(_thickness_of(blended, "alone"), 4.0 * 0.25, abs_tol=1e-9)


def test_a_body_with_no_factor_keeps_the_midline_even_when_others_have_one() -> None:
    """The substitution is per body, not per call — one measured body does not
    re-rule its neighbours."""
    stack1 = [
        _Entry("shared", "ZAND", 10.0, 6.0, "quad"),
        _Entry("measured", "SILT", 6.0, 4.0, "lens"),
        _Entry("unmeasured", "KLEI", 4.0, 2.0, "lens"),
    ]
    stack2 = [_Entry("shared", "ZAND", 10.0, 6.0, "quad")]
    w1 = 0.7

    blended = _blend_stacks(stack1, stack2, w1, pinch1={"measured": 1.0})

    assert math.isclose(_thickness_of(blended, "measured"), 2.0, abs_tol=1e-9)
    assert math.isclose(
        _thickness_of(blended, "unmeasured"), 2.0 * max(0.0, 2 * w1 - 1), abs_tol=1e-9
    )


def test_the_body_the_two_sections_share_is_untouched() -> None:
    """Only one-sided bodies are pinched; a band blends on thickness as before."""
    stack1, stack2 = _one_sided()

    blended = _blend_stacks(stack1, stack2, 0.8, pinch1={"alone": 0.25})

    assert math.isclose(_thickness_of(blended, "shared"), 4.0, abs_tol=1e-9)
