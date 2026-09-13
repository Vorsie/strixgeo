"""Behavioural tests for ``reconcile_sections`` — clause 7 of the gapless gate.

Comments are phrased in the clause's own vocabulary (the ground the 2-D fill
classed vs. the ground the 3-D model holds) rather than in variable-name
terms, so a regression reads as a broken guarantee, not a broken assertion.

Every fixture is a single E-W section with one gap 10 m wide, sampled at a
5 m horizontal grid pitch (2 samples/gap) so both sides of the comparison are
hand-computable. The 3-D "grid" is never produced by ``label_voxels`` — it is
built directly as a ``labels`` array, because clause 7 only reads the grid it
is handed; whether the grid was built faithfully is a different question the
labeller's own tests answer.
"""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.domain.services.model_domain import ModelDomain
from groundmodel.domain.services.voxel_litho.section_reconciliation import reconcile_sections
from groundmodel.domain.services.voxel_litho.voxel_types import (
    RegionInput,
    SectionColumnInput,
    SectionPartitionInput,
)

_H = 5.0  # horizontal grid pitch (m) — 2 samples across the 10 m gap
_V = 1.0  # vertical grid pitch (m)


def _rect_domain(xmin: float, xmax: float, ymin: float, ymax: float) -> ModelDomain:
    """A ``ModelDomain`` whose footprint is exactly this axis-aligned rectangle.

    Built directly (not via ``build_model_domain``) because clause 7 only ever
    calls ``.contains`` — the TIN surfaces ``top_at`` / ``deep_base_at`` are
    never read, so they are left empty.
    """
    return ModelDomain(
        polygon=[(xmin, ymin), (xmax, ymin), (xmax, ymax), (xmin, ymax)],
        top_surface_vertices=[],
        top_surface_triangles=[],
        base_surface_vertices=[],
        base_surface_triangles=[],
    )


def _section(top: float, base: float) -> SectionPartitionInput:
    """A single E-W section, one 10 m gap, one region filling ``[base, top]``."""
    return SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=10.0,
        end_y=0.0,
        columns=(
            SectionColumnInput(investigation_id="L", along_m=0.0, world_x=0.0, world_y=0.0),
            SectionColumnInput(investigation_id="R", along_m=10.0, world_x=10.0, world_y=0.0),
        ),
        regions=(
            RegionInput(
                formation_id="SAND",
                body_id="body-1",
                polygon=((0.0, top), (1.0, top), (1.0, base), (0.0, base)),
                gap_index=0,
            ),
        ),
    )


def _grid(nx: int = 3, labelled_per_column: int = 10) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """A ``(gx, gy, labels)`` grid with every in-range column carrying the same count.

    ``gx`` spans 0..10 at pitch ``_H`` (matching the section's gap so the two
    samples at x=2.5 and x=7.5 each resolve to their own nearest node);
    ``gy`` is a single node at y=0 (every sample sits on the section's own
    line). Every column's ``z`` axis has 10 nodes; the first
    ``labelled_per_column`` carry body index 0, the rest are void (-1).
    """
    gx = np.arange(0.0, 10.0 + _H / 2.0, _H)
    gy = np.array([0.0])
    nz = 10
    labels = np.full((len(gx), 1, nz), -1, dtype=np.int32)
    labels[:, :, :labelled_per_column] = 0
    return gx, gy, labels


def test_a_section_whose_3d_read_matches_its_2d_fill_passes() -> None:
    """10 m of 2-D fill against 10 labelled voxels (10 m at 1 m pitch): no divergence."""
    section = _section(top=10.0, base=0.0)
    domain = _rect_domain(-5.0, 15.0, -5.0, 5.0)
    gx, gy, labels = _grid(labelled_per_column=10)

    result = reconcile_sections([section], domain, gx, gy, labels, _H, _V)

    assert len(result) == 1
    r = result[0]
    assert r.violated is False
    assert r.divergence_m2 == pytest.approx(0.0)
    assert r.samples_outside_footprint == 0


def test_a_section_where_the_3d_model_holds_materially_less_ground_fails() -> None:
    """The 2-D fill classes 10 m; the 3-D model only holds 4 m — a real hole."""
    section = _section(top=10.0, base=0.0)
    domain = _rect_domain(-5.0, 15.0, -5.0, 5.0)
    gx, gy, labels = _grid(labelled_per_column=4)

    result = reconcile_sections([section], domain, gx, gy, labels, _H, _V)

    assert len(result) == 1
    r = result[0]
    assert r.violated is True
    # Every sample is short by the same 6 m, so the worst sample is the first one,
    # at the gap's first cell-centre (fraction 0.25 of the 10 m gap = 2.5 m along).
    assert r.worst_sample_divergence_m == pytest.approx(6.0)
    assert r.worst_sample_along_m == pytest.approx(2.5)
    # The section is named by its position in the payload plus its line
    # endpoints — never a guessed display name.
    assert r.section_index == 0
    assert (r.start_x, r.start_y, r.end_x, r.end_y) == (0.0, 0.0, 10.0, 0.0)


def test_a_sample_outside_the_footprint_is_counted_but_never_folds_into_the_divergence() -> None:
    """A footprint that only reaches half the gap excludes, rather than penalises.

    The 3-D grid is deliberately wrong (4 m instead of 10 m) everywhere — a
    mismatch that would fail the whole section if it were compared — but the
    footprint only reaches the LEFT half of the gap (x <= 5), so the sample at
    x=7.5 is excluded from both sides and the section is judged on the one
    sample the model actually covers, where the 2-D and 3-D sides still
    disagree (so this section still fails — the point under test is that the
    EXCLUDED sample's mismatch is not what causes it).
    """
    section = _section(top=10.0, base=0.0)
    # footprint_tolerance_m(5.0) = 0.5*5*sqrt(2) ≈ 3.54 m, so the right edge has
    # to sit farther than that from x=7.5 (else the tolerance would pull the
    # "outside" sample back in) while staying past x=2.5 (so that sample stays
    # in). x=3.0 clears both: 0.5 m past the kept sample, 4.5 m short of the
    # excluded one.
    domain = _rect_domain(-5.0, 3.0, -5.0, 5.0)
    gx, gy, labels = _grid(labelled_per_column=4)

    result = reconcile_sections([section], domain, gx, gy, labels, _H, _V)

    assert len(result) == 1
    r = result[0]
    assert r.samples_outside_footprint == 1
    assert r.samples_total == 2
    # Only the one in-footprint sample (x=2.5) contributes: 10 m * step(5 m) vs
    # 4 m * step(5 m) — not the two-sample total a naive sum would have used.
    assert r.swept_2d_m2 == pytest.approx(10.0 * 5.0)
    assert r.swept_3d_m2 == pytest.approx(4.0 * 5.0)


def test_the_quantisation_budget_absorbs_a_pure_rounding_difference() -> None:
    """A 2-D height that is not a whole multiple of the grid pitch still passes.

    10.3 m of 2-D fill sampled onto a 1 m vertical pitch can only be
    represented as 10 or 11 labelled voxels; 10 is what the grid holds, a
    0.3 m shortfall per sample that is PURELY the grid's quantisation — not a
    hole the gate should complain about. The derived budget (``runs * v``)
    covers it without needing the relative-tolerance term at all.
    """
    section = _section(top=10.3, base=0.0)
    domain = _rect_domain(-5.0, 15.0, -5.0, 5.0)
    gx, gy, labels = _grid(labelled_per_column=10)

    result = reconcile_sections([section], domain, gx, gy, labels, _H, _V)

    assert len(result) == 1
    r = result[0]
    # The quantisation budget ALONE (ignoring the relative-tolerance slack)
    # already covers the divergence — this is what "pure rounding" means here.
    assert r.divergence_m2 <= r.budget_m2
    assert r.violated is False


def test_a_bed_override_that_dredges_the_3d_top_must_dredge_the_2d_reference_too() -> None:
    """A dredged bed caps the 3-D model; the cut is not "missing ground".

    Owner finding (installer #35, project fhdh): a bed-override polygon caps the
    3-D voxel model at the dredged bed level, but the 2-D fill regions the check
    reads still reach the ground surface, so the reconciliation reported the
    dredged cut as ground the 3-D model failed to hold.  When a bed cap is in
    force at a sample, the 2-D reference must be capped at the SAME level, so the
    two sides compare the same dredged model and the cut is not a shortfall.
    """
    section = _section(top=10.0, base=0.0)
    domain = _rect_domain(-5.0, 15.0, -5.0, 5.0)
    # The 3-D grid holds only 4 labelled voxels per column — the bed cut has
    # already removed the top 6 m of the model (exactly the label a bed-capped
    # ``label_voxels`` would produce).
    gx, gy, labels = _grid(labelled_per_column=4)

    # The bed caps everything above +4 m TAW at every sample of this section.
    def bed_top_at(_x: float, _y: float) -> float:
        return 4.0

    result = reconcile_sections([section], domain, gx, gy, labels, _H, _V, bed_top_at=bed_top_at)

    assert len(result) == 1
    r = result[0]
    # The 2-D reference is dredged to +4 too, so both sides hold 4 m: no shortfall.
    assert r.violated is False
    assert r.divergence_m2 == pytest.approx(0.0)
    assert r.swept_2d_m2 == pytest.approx(4.0 * 10.0)  # 4 m over the whole 10 m gap


def test_a_real_hole_below_the_bed_cap_still_fails() -> None:
    """The bed cap forgives the dredged top, never a genuine hole beneath it.

    With the bed at +8 the 2-D reference keeps 8 m, but the 3-D model holds only
    4 m — a real 4 m hole below the dredged bed, which must still be reported.
    """
    section = _section(top=10.0, base=0.0)
    domain = _rect_domain(-5.0, 15.0, -5.0, 5.0)
    gx, gy, labels = _grid(labelled_per_column=4)

    def bed_top_at(_x: float, _y: float) -> float:
        return 8.0

    result = reconcile_sections([section], domain, gx, gy, labels, _H, _V, bed_top_at=bed_top_at)

    r = result[0]
    assert r.swept_2d_m2 == pytest.approx(8.0 * 10.0)  # capped at the bed, not the surface
    assert r.violated is True  # 8 m of reference against 4 m held is a real hole


def test_a_section_with_a_single_column_has_no_gap_to_sample() -> None:
    """A degenerate section (no gap) contributes nothing rather than raising."""
    section = SectionPartitionInput(
        start_x=0.0,
        start_y=0.0,
        end_x=0.0,
        end_y=0.0,
        columns=(SectionColumnInput(investigation_id="A", along_m=0.0, world_x=0.0, world_y=0.0),),
        regions=(),
    )
    domain = _rect_domain(-5.0, 5.0, -5.0, 5.0)
    gx, gy, labels = _grid()

    result = reconcile_sections([section], domain, gx, gy, labels, _H, _V)

    assert result == ()
