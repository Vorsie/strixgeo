"""How far a gap-local fraction has to move to clear the 2-D engine's snap grid.

The frontend partition engine snaps every polygon coordinate to a 1 mm grid in
**metres**.  The backend reads those polygons in **gap-local fraction** space
(0 = the gap's left column, 1 = its right column), so one snap cell is a
different fraction on every gap: 8.9e-5 across an 11 m gap but 3e-6 across a
333 m one.  A region drawn all the way across a gap therefore lands at
0.999909…, not at 1.0, and any fixed fraction tolerance is wrong on some gap.

Debt #259 is what that costs.  Measured on the owner's real build payload: 33 of
69 gaps carry no polygon vertex within 1e-6 of fraction 1, and 15 of 69 none at
fraction 0 — while all 69 are non-empty at fraction 0.5.  A fixed 1e-6 nudge in
:func:`~groundmodel.domain.services.voxel_litho.label_voxels._section_stack_at`
landed BEYOND the last region's edge and the scanline found nothing, so the
build quietly dropped a whole section's contribution.

The margin lives here, in one place, because it is one rule with two consumers
that must agree — the scanline nudge in ``label_voxels`` and the "does this
region reach the column?" test in ``merge_bodies_across_sections``.  The second
one was written before #259 was found and kept the fixed 1e-6, so the same
snapped band that ``label_voxels`` reads as reaching the column,
``merge_bodies_across_sections`` read as stopping short.

Pure domain module — no I/O, no framework imports.  It computes; it does not
act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

from groundmodel.domain.services.voxel_litho.snap_grid_constants import (
    FRACTION_EPS,
    SNAP_GRID_M,
    SNAP_MARGIN_CELLS,
)

__all__ = [
    "gap_edge_fraction_margin",
]


def gap_edge_fraction_margin(width_m: float) -> float:
    """The gap-local fraction that covers one snap cell on a gap this wide.

    Parameters
    ----------
    width_m : float
        The gap's width in metres — the distance between its two columns' TRUE
        world positions, not their ``along_m`` (a section whose columns were
        re-seated onto their drilled positions has the two disagree).

    Returns
    -------
    float
        A margin in ``(0, 0.5)``.  Never below :data:`FRACTION_EPS` (a very wide
        gap must still clear the slicer's own resolution) and never at or above
        0.5: a degenerate gap — two columns at the same map position, or the
        1-3 mm apart a paired station can be — would otherwise produce a margin
        past the gap's own midpoint, and clamping a fraction between ``margin``
        and ``1 - margin`` would invert to a NEGATIVE fraction and silently drop
        the section's stack there.  That is #259's own signature, and it is
        reachable through #259's own fix.
    """
    if width_m <= 0.0:
        return FRACTION_EPS
    margin = max(FRACTION_EPS, SNAP_MARGIN_CELLS * SNAP_GRID_M / width_m)
    # Half the gap minus a slicer epsilon: at exactly 0.5 the two clamps meet and
    # a slice line has zero room; below it the clamped fraction stays ordered.
    return min(margin, 0.5 - FRACTION_EPS)
