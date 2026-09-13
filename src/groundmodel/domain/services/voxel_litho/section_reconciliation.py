"""Clause 7 of the gapless gate: per-section swept-area 2-D↔3-D reconciliation.

A naive area-vs-volume comparison between the 2-D section fill and the 3-D
label grid is dimensionally wobbly — an area in square metres has no
defensible width to become a volume — so the honest check instead compares
two AREAS: the classed area of the 2-D fill and the labelled area of the 3-D
grid, both swept along the SAME vertical plane (the section's own column
fence), in square metres.

Algorithm, per section, per gap between consecutive columns
-------------------------------------------------------------
1. The gap's world length ``L`` is the straight-line distance between its two
   columns' TRUE world positions (``hypot(dx, dy)``).
2. It is sampled at ``n = max(1, ceil(L / h))`` points (``h`` = the grid's
   horizontal spacing), cell-centred at fractions ``f_i = (i + 0.5) / n`` so no
   sample sits exactly on a column (no double counting between adjacent gaps)
   and every sample is strictly interior to the gap.  Each sample represents
   ``step = L / n`` metres of section line.
3. The 2-D side slices every region of that gap at ``f_i`` (the same scanline
   :func:`~groundmodel.domain.services.voxel_litho.label_voxels.slice_region_intervals`
   the labeller itself uses), then takes the UNION of the resulting intervals
   across every region — union, not a plain sum, because the fill is MEANT to
   be disjoint but the measurement must not assume the thing it is measuring.
   ``h2`` is the union's total length; ``runs_2d`` is its interval count.
4. The 3-D side evaluates the world point on the fence.  A point the model
   footprint does not reach is excluded from BOTH sides (counted, never
   folded into the divergence) — otherwise it would compare "unknown" against
   "unknown" and call that agreement.  Otherwise the nearest grid column is
   read: ``h3 = count(labels[i, j, :] >= 0) * v`` (``v`` = the grid's vertical
   spacing).
5. Each sample accumulates ``swept_2d_m2 += h2 * step``,
   ``swept_3d_m2 += h3 * step``, and the derived quantisation budget
   ``budget_m2 += runs_2d * v * step``.

Sections are read in the RE-SEATED payload — the same ``sections`` list handed
to :func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`,
after
:func:`~groundmodel.domain.services.voxel_litho.true_column_positions.apply_true_column_positions`
— never the payload as drawn.  Re-seating moves columns a median 11 m (max
65 m) on the owner's real build, and the labeller ranks sections by
perpendicular distance in that re-seated space; reconciling against a
different set of column positions would silently compare two different
models.

On a section's OWN fence (perpendicular distance 0 to that section, some
positive distance to its nearest neighbour) the blend weight
:func:`~groundmodel.domain.services.voxel_litho.label_voxels._stack_at`
computes is ``w1 = d2 / (d1 + d2) = 1.0`` — VERIFIED by reading the function,
not assumed: with ``d1 = 0`` the denominator equals ``d2`` exactly.  At
``w1 = 1.0`` the blend keeps every one of the fence section's own bodies at
their own thickness (``th(e1) * 1.0``) and drops every one of the OTHER
section's one-sided bodies to zero thickness (``th(e2) * (1 - w1) = 0``,
under both the ``reach_to_evidence`` and midline pinch formulas, which
coincide at this boundary), so the model at a section's own fence is,
compositionally, that section's own stack — the reconciliation's 3-D side is
therefore checking the right section's material there, modulo the same
grid-quantisation and off-fence grid-node slack the tolerance already
accounts for (:mod:`section_reconciliation_constants`).

Pure domain module — numpy + the value objects only, no session, no logging
class: it is a pure function, not a service, so nothing here inherits
``GroundModelLogger``.
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np

from groundmodel.domain.services.model_domain import ModelDomain
from groundmodel.domain.services.voxel_litho.footprint_tolerance import footprint_tolerance_m
from groundmodel.domain.services.voxel_litho.label_voxels import slice_region_intervals
from groundmodel.domain.services.voxel_litho.section_reconciliation_constants import (
    RECONCILE_RELATIVE_TOLERANCE,
)
from groundmodel.domain.services.voxel_litho.voxel_types import (
    SectionPartitionInput,
    SectionReconciliation,
)

__all__ = ["reconcile_sections"]

_EPS: float = 1e-9


def _clip_intervals_to_bed(
    intervals: list[tuple[float, float]], cap: float
) -> list[tuple[float, float]]:
    """Dredge every ``(base, top)`` interval to a bed cap, dropping what sits above.

    A bed override voids everything ABOVE the dredged bed level, so the 2-D
    reference must be dredged the same way the 3-D voxel model was
    (:func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`
    voids ``labels[..., gz > cap]`` inside a bed polygon).  An interval whose base
    is at or above the cap is entirely dredged away.

    Parameters
    ----------
    intervals : list of (float, float)
        The ``(base, top)`` elevation intervals of the 2-D fill at one sample.
    cap : float
        The bed level; nothing above it survives.

    Returns
    -------
    list of (float, float)
        The dredged intervals; an interval entirely above the cap is dropped.
    """
    out: list[tuple[float, float]] = []
    for base, top in intervals:
        clipped_top = min(top, cap)
        if clipped_top - base > _EPS:
            out.append((base, clipped_top))
    return out


def _union_length(intervals: list[tuple[float, float]]) -> tuple[float, int]:
    """Union a list of ``(base, top)`` elevation intervals.

    Parameters
    ----------
    intervals : list of (float, float)
        Elevation intervals, in any order; ``base`` below ``top`` in each.

    Returns
    -------
    tuple[float, int]
        ``(total_length, run_count)`` of the merged, non-overlapping union —
        touching or overlapping intervals merge into one run.
    """
    if not intervals:
        return 0.0, 0
    ordered = sorted(intervals)
    merged: list[list[float]] = [list(ordered[0])]
    for base, top in ordered[1:]:
        last = merged[-1]
        if base <= last[1] + _EPS:
            last[1] = max(last[1], top)
        else:
            merged.append([base, top])
    return sum(top - base for base, top in merged), len(merged)


def reconcile_sections(
    sections: list[SectionPartitionInput],
    domain: ModelDomain,
    gx: np.ndarray,
    gy: np.ndarray,
    labels: np.ndarray,
    horizontal_spacing_m: float,
    vertical_spacing_m: float,
    *,
    bed_top_at: Callable[[float, float], float | None] | None = None,
) -> tuple[SectionReconciliation, ...]:
    """Reconcile every section's 2-D fill against the labelled 3-D grid.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The RE-SEATED section partitions — the exact list handed to
        :func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`
        (post-alias, post-``apply_true_column_positions``), never the payload
        as drawn.
    domain : ModelDomain
        The model footprint — the SAME gate the labeller used.
    gx, gy : numpy.ndarray
        The label grid's X and Y axis coordinates.
    labels : numpy.ndarray
        The labelled ``(nx, ny, nz)`` grid (``-1`` = void).
    horizontal_spacing_m : float
        The grid's horizontal (X/Y) voxel edge length — the sampling pitch
        and the footprint-tolerance basis.
    vertical_spacing_m : float
        The grid's vertical (Z) voxel edge length — one labelled voxel's
        height contribution.
    bed_top_at : callable or None, optional
        ``(x, y) -> bed level or None`` — the SAME dredged-bed cap
        :func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`
        applied to the 3-D grid.  When a sample sits inside a bed polygon the
        2-D reference is dredged to that level too, so the check compares the
        same bed-capped model from both directions and the dredged cut is not
        counted as ground the 3-D model failed to hold.  ``None`` (no override
        on the project) leaves the 2-D reference untouched — byte-identical to a
        build with no bed overrides.

    Returns
    -------
    tuple of SectionReconciliation
        One entry per section that has at least 2 columns (a single-column
        section has no gap to sample); ``()`` when no section qualifies.
    """
    tol = footprint_tolerance_m(horizontal_spacing_m)
    out: list[SectionReconciliation] = []
    for index, section in enumerate(sections):
        cols = section.columns
        if len(cols) < 2:
            continue

        swept_2d = 0.0
        swept_3d = 0.0
        budget = 0.0
        outside = 0
        total_samples = 0
        worst_along: float | None = None
        worst_divergence = 0.0
        fence_along = 0.0

        for gap_index in range(len(cols) - 1):
            left = cols[gap_index]
            right = cols[gap_index + 1]
            dx = right.world_x - left.world_x
            dy = right.world_y - left.world_y
            length = math.hypot(dx, dy)
            if length <= _EPS:
                continue  # coincident columns — no gap to sample
            n = max(1, math.ceil(length / horizontal_spacing_m))
            step = length / n
            gap_regions = [r for r in section.regions if r.gap_index == gap_index]

            for i in range(n):
                f = (i + 0.5) / n
                total_samples += 1
                x = left.world_x + f * dx
                y = left.world_y + f * dy
                along = fence_along + f * length

                intervals: list[tuple[float, float]] = []
                for region in gap_regions:
                    intervals.extend(slice_region_intervals(region.polygon, f))
                # Dredge the 2-D reference to the same bed cap the 3-D grid was
                # given, so a dredged-bed cut is not read as missing 3-D ground.
                if bed_top_at is not None:
                    cap = bed_top_at(x, y)
                    if cap is not None:
                        intervals = _clip_intervals_to_bed(intervals, cap)
                h2, runs_2d = _union_length(intervals)

                if not domain.contains(x, y, tol=tol):
                    # Excluded from BOTH sides — never let an out-of-footprint
                    # sample pollute the divergence in either direction.
                    outside += 1
                    continue

                gi = int(np.argmin(np.abs(gx - x)))
                gj = int(np.argmin(np.abs(gy - y)))
                h3 = float(np.count_nonzero(labels[gi, gj, :] >= 0)) * vertical_spacing_m

                swept_2d += h2 * step
                swept_3d += h3 * step
                budget += runs_2d * vertical_spacing_m * step

                divergence_here = abs(h2 - h3)
                if divergence_here > worst_divergence:
                    worst_divergence = divergence_here
                    worst_along = along

            fence_along += length

        divergence = abs(swept_2d - swept_3d)
        allowance = budget + RECONCILE_RELATIVE_TOLERANCE * swept_2d
        out.append(
            SectionReconciliation(
                section_index=index,
                start_x=section.start_x,
                start_y=section.start_y,
                end_x=section.end_x,
                end_y=section.end_y,
                swept_2d_m2=swept_2d,
                swept_3d_m2=swept_3d,
                budget_m2=budget,
                divergence_m2=divergence,
                allowance_m2=allowance,
                violated=divergence > allowance,
                worst_sample_along_m=worst_along,
                worst_sample_divergence_m=worst_divergence,
                samples_outside_footprint=outside,
                samples_total=total_samples,
            )
        )
    return tuple(out)
