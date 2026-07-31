"""A body reaches from its drawn apex as far as the data permits.

Owner ruling 2026-07-31 (docs/debt.md #256), in the owner's words: a body extends until
something contradicts it — a station, or a crossing section, that does not carry it.
Nothing else sets the distance.

The builder used to thin a one-sided body by ``max(0, 2w - 1)``, which reaches zero at
the equidistance midline between the two sections. That midline is not evidence. Nothing
was measured there; it is halfway between two things, and the body was being killed at it
because the builder had no better anchor.

The section that does NOT carry the body is the evidence, and it is where the body must
run out — not halfway to it. So the survival factor is the weight of the section that
DOES carry it: full where that section stands, nothing where the contradicting one does,
thinning in between.

Along the section the pinch-out is already drawn — every terminating region tapers to
zero thickness at its own apex — so this rule is only ever about how far the body reaches
AWAY from the section that carries it.
"""

from __future__ import annotations

import math

from groundmodel.domain.services.voxel_litho.label_voxels import _blend_stacks, _Entry


def _one_sided() -> tuple[list[_Entry], list[_Entry]]:
    """Two stacks sharing a band, with a 4 m body drawn on the first only."""
    stack1 = [
        _Entry("shared", "ZAND", 10.0, 6.0, "quad"),
        _Entry("alone", "SILT", 6.0, 2.0, "quad"),
    ]
    stack2 = [_Entry("shared", "ZAND", 10.0, 6.0, "quad")]
    return stack1, stack2


def _thickness_of(stack: list[_Entry], body: str) -> float:
    """Total metres of one body in a blended stack."""
    return sum(e.top_elev - e.base_elev for e in stack if e.body_id == body)


def test_the_body_still_stands_at_the_section_that_draws_it() -> None:
    """Where the carrying section is, the body is whole. Nothing contradicts it there."""
    stack1, stack2 = _one_sided()

    blended = _blend_stacks(stack1, stack2, 1.0, reach_to_evidence=True)

    assert math.isclose(_thickness_of(blended, "alone"), 4.0, abs_tol=1e-9)


def test_the_body_runs_out_where_the_section_that_lacks_it_stands() -> None:
    """At the contradicting section the body is gone — that is what contradicts means."""
    stack1, stack2 = _one_sided()

    blended = _blend_stacks(stack1, stack2, 0.0, reach_to_evidence=True)

    assert math.isclose(_thickness_of(blended, "alone"), 0.0, abs_tol=1e-9)


def test_halfway_between_them_the_body_is_still_there() -> None:
    """The midline is not evidence, so the body must not die at it.

    This is the whole change: today the body is already gone halfway across, killed by
    ``max(0, 2 * 0.5 - 1) == 0``. Under the ruling it is half its drawn thickness and
    still going, because nothing has contradicted it yet.
    """
    stack1, stack2 = _one_sided()

    blended = _blend_stacks(stack1, stack2, 0.5, reach_to_evidence=True)

    assert math.isclose(_thickness_of(blended, "alone"), 2.0, abs_tol=1e-9)


def test_it_thins_the_whole_way_rather_than_stopping_short() -> None:
    """Three quarters of the way to the contradicting section, a quarter is left."""
    stack1, stack2 = _one_sided()

    blended = _blend_stacks(stack1, stack2, 0.25, reach_to_evidence=True)

    assert math.isclose(_thickness_of(blended, "alone"), 1.0, abs_tol=1e-9)


def test_the_body_the_other_section_draws_reaches_the_same_way() -> None:
    """The rule is about carrying and contradicting, not about which stack is first."""
    stack1 = [_Entry("shared", "ZAND", 10.0, 6.0, "quad")]
    stack2 = [
        _Entry("shared", "ZAND", 10.0, 6.0, "quad"),
        _Entry("alone", "SILT", 6.0, 2.0, "quad"),
    ]

    blended = _blend_stacks(stack1, stack2, 0.25, reach_to_evidence=True)

    assert math.isclose(_thickness_of(blended, "alone"), 3.0, abs_tol=1e-9)


def test_a_body_both_sections_draw_is_untouched() -> None:
    """The ruling is about one-sided bodies. A shared band interpolates as before."""
    stack1, stack2 = _one_sided()

    blended = _blend_stacks(stack1, stack2, 0.5, reach_to_evidence=True)

    assert math.isclose(_thickness_of(blended, "shared"), 4.0, abs_tol=1e-9)


def test_the_old_midline_is_still_what_happens_without_the_ruling() -> None:
    """Off by default until the A/B is in front of the owner: same call, old answer."""
    stack1, stack2 = _one_sided()

    blended = _blend_stacks(stack1, stack2, 0.5)

    assert math.isclose(_thickness_of(blended, "alone"), 0.0, abs_tol=1e-9)
