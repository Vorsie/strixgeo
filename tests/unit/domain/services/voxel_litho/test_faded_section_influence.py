"""A section's influence fades with distance; it never switches on and off.

Owner instruction 2026-08-01 (docs/debt.md #260).  The builder picks the TWO nearest
sections and blends them by distance, or extrudes the nearest one alone when the query
sits beyond them.  Because exactly two sections are hard-selected, walking across the
model eventually swaps one section for another AT FULL STRENGTH, and the ground jumps in
a single step.  Measured on the owner's model: the worst jump in a shared body's roof is
7.70 m at (88 500.3, 164 925.3), and it is a PAIR CHANGE with both columns still in
``between`` mode — 5,530 of 74,775 adjacent pairs (7.4 %) change mode or section pair.

The instruction is to stop hard-picking two sections.  Every section gets a weight that
falls off with distance, so nothing ever swaps: a section's influence only grows and
shrinks, and the discontinuity is never created in the first place.  Detect-then-smooth
was rejected because the width of the smoothing window would be an invented constant.

Two rules bind the change:

* Fade the STACK — the contact elevations — never the voxel labels.  Averaging body ids
  or lithologies would invent material that is in no section.
* Honour still wins.  Where an investigation log fixes a contact the fade governs only
  the ground BETWEEN logs; it must not soften that contact.  Nothing here touches the
  honour path.

The reach ruling of 2026-07-31 is not replaced but generalised: a body's blended
thickness is ``sum_i w_i * th_i`` with ``th_i`` zero on a section that does not carry it,
which is exactly ``w_own`` for a one-sided body — whole at the section that draws it,
gone at the section that contradicts it.
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from groundmodel.domain.services.model_domain import DomainTest, build_model_domain
from groundmodel.domain.services.voxel_litho.label_voxels import (
    _blend_stacks,
    _blend_stacks_faded,
    _Entry,
    _stack_at,
    label_voxels,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

_SAND = "ZAND"
_CLAY = "KLEI"


# ---------------------------------------------------------------------------
# Section fixtures
# ---------------------------------------------------------------------------


def _band(formation: str, body: str, top: float, base: float) -> RegionInput:
    """One band spanning the whole of gap 0, from ``top`` down to ``base``."""
    return RegionInput(
        formation_id=formation,
        body_id=body,
        polygon=((0.0, top), (1.0, top), (1.0, base), (0.0, base)),
        gap_index=0,
    )


def _section(
    tag: str,
    ax: float,
    ay: float,
    bx: float,
    by: float,
    regions: tuple[RegionInput, ...],
) -> SectionPartitionInput:
    """A two-column section running ``(ax, ay)`` → ``(bx, by)`` carrying ``regions``."""
    return SectionPartitionInput(
        start_x=ax,
        start_y=ay,
        end_x=bx,
        end_y=by,
        columns=(
            SectionColumnInput(investigation_id=f"{tag}-L", along_m=0.0, world_x=ax, world_y=ay),
            SectionColumnInput(
                investigation_id=f"{tag}-R",
                along_m=math.hypot(bx - ax, by - ay),
                world_x=bx,
                world_y=by,
            ),
        ),
        regions=regions,
    )


def _pair_change_sections() -> list[SectionPartitionInput]:
    """Two long sections plus a short tie whose foot overtakes one of them.

    ``A`` and ``B`` run east-west 100 m apart; the query walks the line exactly halfway
    between them, so both stay 50 m away the whole walk.  The tie ``T`` crosses that line
    at x = 100, so its distance shrinks as the walk approaches it and it overtakes ``A``
    and ``B`` at x = 50.  That is the shape debt #260 measured as the worst real
    discontinuity: the nearest PAIR changes while every column is still in ``between``
    mode.  ``T`` draws the sand 20 m deeper and draws no clay at all, so the swap has
    something to jump by, and the clay ``A`` and ``B`` agree on goes from a body both the
    counted sections carry to a body only one of them carries, in one step.
    """
    a_and_b = (_band(_SAND, "shared", 10.0, 0.0), _band(_CLAY, "alone", 0.0, -4.0))
    return [
        _section("A", 0.0, 0.0, 200.0, 0.0, a_and_b),
        _section("B", 0.0, 100.0, 200.0, 100.0, a_and_b),
        _section("T", 100.0, 20.0, 100.0, 80.0, (_band(_SAND, "shared", 10.0, -20.0),)),
    ]


def _one_carrier_sections() -> list[SectionPartitionInput]:
    """Three parallel sections that disagree about what lies under the sand.

    ``A`` (y = 0) and ``B`` (y = 40) both draw a 4 m clay; ``C`` (y = 50) does not, so the
    clay must run out at ``C``.  ``A`` alone draws a 3 m peat below that clay, so a walk
    can also ask whether the far section still has a say at all.  The spacing is
    deliberately uneven: the two nearest sections change from ``A`` and ``B`` to ``B`` and
    ``C`` halfway between ``A`` and ``C``, which is where the two-nearest rule stops
    counting ``A`` at all.
    """
    return [
        _section(
            "A",
            0.0,
            0.0,
            200.0,
            0.0,
            (
                _band(_SAND, "shared", 10.0, 0.0),
                _band(_CLAY, "alone", 0.0, -4.0),
                _band("VEEN", "aonly", -4.0, -7.0),
            ),
        ),
        _section(
            "B",
            0.0,
            40.0,
            200.0,
            40.0,
            (_band(_SAND, "shared", 10.0, 0.0), _band(_CLAY, "alone", 0.0, -4.0)),
        ),
        _section("C", 0.0, 50.0, 200.0, 50.0, (_band(_SAND, "shared", 10.0, 0.0),)),
    ]


# ---------------------------------------------------------------------------
# Measurement helpers
# ---------------------------------------------------------------------------


def _deepest_base(stack: list[_Entry]) -> float:
    """How deep the modelled ground reaches at a point, in mTAW."""
    return min((e.base_elev for e in stack), default=math.nan)


def _thickness_of(stack: list[_Entry], body: str) -> float:
    """Total metres of one body in a stack."""
    return sum(e.top_elev - e.base_elev for e in stack if e.body_id == body)


def _sample_xs(first: float, last: float, step: float) -> list[float]:
    """Evenly spaced sample positions from ``first`` to ``last`` inclusive."""
    count = int(round((last - first) / step))
    return [first + i * step for i in range(count + 1)]


def _walk_deepest_base(
    sections: list[SectionPartitionInput], xs: list[float], *, fade: bool
) -> list[float]:
    """The modelled ground depth at each sample of an east-west walk at y = 50."""
    return [_deepest_base(_stack_at(sections, x, 50.0, None, True, fade_sections=fade)) for x in xs]


def _worst_step(values: list[float]) -> float:
    """The biggest change between neighbouring samples."""
    return max(abs(b - a) for a, b in zip(values, values[1:]))


# ---------------------------------------------------------------------------
# The column must change continuously as the query moves
# ---------------------------------------------------------------------------


def test_the_column_does_not_step_where_a_different_section_becomes_nearest() -> None:
    """Walk across the place where a different section becomes nearest; nothing jumps.

    Continuity is tested without inventing a tolerance: sample the same walk twice, once
    at a quarter of the step, and require the biggest change between neighbouring samples
    to shrink with the step.  A field that steps gives the SAME jump at every step size,
    because both walks straddle the same riser, so this can only pass if the riser is
    gone.
    """
    sections = _pair_change_sections()

    coarse = _worst_step(_walk_deepest_base(sections, _sample_xs(40.0, 60.0, 1.0), fade=True))
    fine = _worst_step(_walk_deepest_base(sections, _sample_xs(40.0, 60.0, 0.25), fade=True))

    assert fine < coarse / 2.0, f"worst step 1.0 m: {coarse:.4f} m; at 0.25 m: {fine:.4f} m"


def test_no_single_step_of_the_walk_moves_the_ground_by_metres() -> None:
    """The sections disagree by 20 m; crossing between them must not spend it at once.

    The same walk read directly rather than by refinement, so the size of the defect is
    visible in the failure message.
    """
    sections = _pair_change_sections()

    worst = _worst_step(_walk_deepest_base(sections, _sample_xs(40.0, 60.0, 0.25), fade=True))

    assert worst < 0.5, f"one 0.25 m step moved the modelled ground {worst:.4f} m"


def test_the_flag_off_still_steps_exactly_as_it_does_today() -> None:
    """Flag off is today's builder, defect and all — this is the control, not a wish.

    It is GREEN before the change and must stay green after: the point of the flag is
    that nothing moves while it is off.  The two-nearest rule spends most of the sections'
    20 m disagreement in one step, and refining the walk does not shrink it.
    """
    sections = _pair_change_sections()

    coarse = _worst_step(_walk_deepest_base(sections, _sample_xs(40.0, 60.0, 1.0), fade=False))
    fine = _worst_step(_walk_deepest_base(sections, _sample_xs(40.0, 60.0, 0.25), fade=False))

    assert coarse > 5.0
    assert fine > 5.0
    # And the clay both A and B draw halves in that same step, because the pair change
    # makes a two-sided body one-sided.
    assert _worst_step(_clay_walk_x(sections, _sample_xs(40.0, 60.0, 0.25), fade=False)) > 1.5


# ---------------------------------------------------------------------------
# The anchor: two sections must reproduce the reach ruling
# ---------------------------------------------------------------------------


def _reach_ruling_stacks() -> tuple[list[_Entry], list[_Entry]]:
    """Two stacks exercising every branch the reach ruling has.

    ``shared`` is drawn on both.  ``twice`` is drawn on both but cut into two intervals on
    the first and one on the second, so an occurrence is left over.  ``alone`` is drawn on
    the first only and ``theirs`` on the second only.  A never-correlated minority (body
    ``None``) rides on each.
    """
    stack1 = [
        _Entry("shared", _SAND, 12.0, 8.0, "quad"),
        _Entry("twice", _CLAY, 8.0, 6.5, "quad"),
        _Entry(None, "LEEM", 6.5, 5.9),
        _Entry("twice", _CLAY, 5.9, 3.0, "quad"),
        _Entry("alone", "VEEN", 3.0, -1.0, "pinch"),
    ]
    stack2 = [
        _Entry("shared", _SAND, 11.0, 7.0, "quad"),
        _Entry("twice", _CLAY, 7.0, 2.0, "quad"),
        _Entry("theirs", "GRIND", 2.0, -3.0, "pinch"),
        _Entry(None, "LEEM", -3.0, -4.2),
    ]
    return stack1, stack2


@pytest.mark.parametrize("w1", [0.0, 0.125, 0.25, 0.5, 0.75, 0.875, 1.0])
def test_with_two_sections_the_fade_reproduces_the_reach_ruling(w1: float) -> None:
    """Two sections in, today's answer out — the same numbers, not similar ones.

    This is the anchor.  The reach ruling says a one-sided body runs from its drawn apex
    until the section that contradicts it, which is the weight of the section that
    carries it.  Under the fade a body's thickness is ``sum_i w_i * th_i`` with ``th_i``
    zero where the body is absent, and for two sections that IS ``w_own``.  So the ruling
    survives the generalisation rather than being replaced by it, and the proof is
    equality.
    """
    stack1, stack2 = _reach_ruling_stacks()

    faded = _blend_stacks_faded([stack1, stack2], [w1, 1.0 - w1])
    today = _blend_stacks(stack1, stack2, w1, reach_to_evidence=True)

    assert faded == today


def test_two_sections_reproduce_the_reach_ruling_through_the_whole_column_stack() -> None:
    """The same equality where the builder actually calls it, not only in the blend.

    Inverse distance with power 1 is the weight the two-nearest rule already uses —
    ``d2 / (d1 + d2)`` — so with two sections and the query between them the faded column
    is the column today's builder produces.  Only the two expressions for that one weight
    differ, and only in float rounding, which is why this reads to the nanometre rather
    than by identity.
    """
    sections = [
        _section(
            "A",
            0.0,
            0.0,
            200.0,
            0.0,
            (_band(_SAND, "shared", 10.0, 2.0), _band(_CLAY, "alone", 2.0, -3.0)),
        ),
        _section(
            "B",
            0.0,
            100.0,
            200.0,
            100.0,
            (_band(_SAND, "shared", 8.0, 1.0), _band("GRIND", "theirs", 1.0, -6.0)),
        ),
    ]

    for y in (10.0, 25.0, 50.0, 70.0, 90.0):
        faded = _stack_at(sections, 100.0, y, None, True, fade_sections=True, fade_power=1.0)
        today = _stack_at(sections, 100.0, y, None, True)

        assert [(e.body_id, e.formation_id) for e in faded] == [
            (e.body_id, e.formation_id) for e in today
        ], f"at y={y}"
        for a, b in zip(faded, today):
            assert a.top_elev == pytest.approx(b.top_elev, abs=1e-9), f"at y={y}"
            assert a.base_elev == pytest.approx(b.base_elev, abs=1e-9), f"at y={y}"


# ---------------------------------------------------------------------------
# The reach ruling generalised to more than two sections
# ---------------------------------------------------------------------------


def _clay_walk(ys: list[float], *, fade: bool) -> list[float]:
    """Metres of the clay both ``A`` and ``B`` draw, along a north-south walk."""
    sections = _one_carrier_sections()
    return [
        _thickness_of(_stack_at(sections, 100.0, y, None, True, fade_sections=fade), "alone")
        for y in ys
    ]


def _clay_walk_x(
    sections: list[SectionPartitionInput], xs: list[float], *, fade: bool
) -> list[float]:
    """Metres of the clay ``A`` and ``B`` draw, along the east-west walk at y = 50."""
    return [
        _thickness_of(_stack_at(sections, x, 50.0, None, True, fade_sections=fade), "alone")
        for x in xs
    ]


def test_a_body_only_some_sections_carry_fades_out_toward_the_ones_that_lack_it() -> None:
    """The clay is whole where it is drawn and gone at the section that contradicts it.

    Between the two it thins the whole way — never stopping short, never surviving past
    the contradiction.  This is the reach ruling with a third section in the room.
    """
    walk = _clay_walk([40.0, 42.0, 45.0, 48.0, 49.5, 50.0], fade=True)

    assert walk[0] == pytest.approx(4.0)
    assert walk[-1] == pytest.approx(0.0, abs=1e-9)
    assert all(later < earlier for earlier, later in zip(walk, walk[1:])), walk


def test_the_clay_does_not_halve_where_the_counted_pair_changes() -> None:
    """A body is not one-sided one step and two-sided the next.

    On the pair-change walk ``A`` and ``B`` both draw the clay, so while they are the two
    counted sections it is whole; the moment the tie displaces ``B`` the same clay becomes
    one-sided and loses half of itself in one step.  Whether a body is contradicted is a
    fact about the ground, not about which two sections were counted, so it cannot change
    in a step.  Same refinement argument: the jump has to shrink with the step.
    """
    sections = _pair_change_sections()

    coarse = _worst_step(_clay_walk_x(sections, _sample_xs(40.0, 60.0, 1.0), fade=True))
    fine = _worst_step(_clay_walk_x(sections, _sample_xs(40.0, 60.0, 0.25), fade=True))

    assert fine < coarse / 2.0, f"worst step 1.0 m: {coarse:.4f} m; at 0.25 m: {fine:.4f} m"


def test_a_far_section_still_has_a_say_instead_of_being_switched_off() -> None:
    """The peat only ``A`` draws is thin far from ``A``, but it is not nothing.

    Under the two-nearest rule ``A`` is not one of the two nearest at y = 45, so its peat
    is absent outright — a section's say switches off.  Fading it means the say only ever
    shrinks, which is what makes the swap impossible.  The peat must stay a whisper of
    its drawn 3 m, not a layer.
    """
    sections = _one_carrier_sections()

    peat = _thickness_of(_stack_at(sections, 100.0, 45.0, None, True, fade_sections=True), "aonly")

    assert 0.0 < peat < 0.1, peat


# ---------------------------------------------------------------------------
# On a fence, and with the flag off
# ---------------------------------------------------------------------------


def test_a_query_sitting_on_a_fence_takes_that_sections_own_column() -> None:
    """Standing on a section, the column is that section's — nothing else gets a say."""
    sections = _one_carrier_sections()

    on_fence = _stack_at(sections, 100.0, 0.0, None, True, fade_sections=True)

    assert [(e.body_id, e.formation_id, e.top_elev, e.base_elev) for e in on_fence] == [
        ("shared", _SAND, 10.0, 0.0),
        ("alone", _CLAY, 0.0, -4.0),
        ("aonly", "VEEN", -4.0, -7.0),
    ]


def test_the_whole_labelled_grid_is_unchanged_while_the_flag_is_off() -> None:
    """Not one voxel moves — the built model is the same array, cell for cell.

    The walk tests read one column at a time; this one reads the deliverable.  While the
    flag is off the labeller must be the labeller it was, so the flag can be shipped
    before anyone has decided to turn it on.
    """
    sections = _pair_change_sections()
    domain = build_model_domain(
        [
            DomainTest("d0", 20.0, 10.0, 10.0, -25.0),
            DomainTest("d1", 180.0, 10.0, 10.0, -25.0),
            DomainTest("d2", 20.0, 90.0, 10.0, -25.0),
            DomainTest("d3", 180.0, 90.0, 10.0, -25.0),
        ]
    )

    default = label_voxels(domain, 10.0, sections)
    flag_off = label_voxels(domain, 10.0, sections, fade_sections=False)
    faded = label_voxels(domain, 10.0, sections, fade_sections=True)

    assert np.array_equal(default.labels, flag_off.labels)
    assert default.body_id_by_index == flag_off.body_id_by_index
    # And the flag is live, not inert: turning it on must move something, or the tests
    # above would be measuring a path the builder never takes.
    assert not np.array_equal(default.labels, faded.labels)


def test_the_fade_refuses_the_settings_it_has_no_answer_for() -> None:
    """A flag that would be silently ignored is refused instead.

    The measured pinch factor is defined between one section and the one that
    contradicts it; the equidistance midline is a property of a chosen pair; and the
    geology-bounded path still picks two reaching sections of its own.  None of the three
    survives the fade, so asking for them together is an error rather than a quiet no-op.
    """
    sections = _pair_change_sections()
    domain = build_model_domain(
        [
            DomainTest("d0", 20.0, 10.0, 10.0, -25.0),
            DomainTest("d1", 180.0, 10.0, 10.0, -25.0),
            DomainTest("d2", 20.0, 90.0, 10.0, -25.0),
            DomainTest("d3", 180.0, 90.0, 10.0, -25.0),
        ]
    )

    with pytest.raises(ValueError, match="measured_pinch"):
        label_voxels(domain, 10.0, sections, fade_sections=True, measured_pinch=True)
    with pytest.raises(ValueError, match="reach_to_evidence"):
        label_voxels(domain, 10.0, sections, fade_sections=True, reach_to_evidence=False)
    with pytest.raises(ValueError, match="fade_power"):
        label_voxels(domain, 10.0, sections, fade_sections=True, fade_power=0.0)


def test_the_flag_off_is_the_same_call_as_not_passing_it() -> None:
    """Passing the flag off changes nothing at all, at every point of a walk."""
    sections = _pair_change_sections()

    for x in _sample_xs(40.0, 60.0, 1.0):
        assert _stack_at(sections, x, 50.0, None, True, fade_sections=False) == _stack_at(
            sections, x, 50.0, None, True
        )
