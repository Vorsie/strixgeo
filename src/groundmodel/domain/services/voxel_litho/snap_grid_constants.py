"""The snap-grid tolerances the voxel labelling and cross-section merge share.

These three values pin how the backend reads the 2-D engine's 1 mm snap grid in
gap-local fraction space.  They live in one place because
:func:`~groundmodel.domain.services.voxel_litho.snap_grid.gap_edge_fraction_margin`
and its two consumers, the scanline nudge in ``label_voxels`` and the reach test
in ``merge_bodies_across_sections``, must agree on them; see
:mod:`~groundmodel.domain.services.voxel_litho.snap_grid` for the full debt-259
story the margin closes.

Pure constants module, no I/O, no framework imports.  It holds values; it does not
act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

__all__ = [
    "FRACTION_EPS",
    "SNAP_GRID_M",
    "SNAP_MARGIN_CELLS",
]

FRACTION_EPS: float = 1e-6
"""Floor for any fraction nudge — the slicer's own coordinate resolution.

Slicing a region polygon exactly on a column edge hits vertices and vertical
edges; nudging by at least this much makes every relevant edge strictly
straddle the slice line.
"""

SNAP_GRID_M: float = 0.001
"""The grid the 2-D engine snaps polygon coordinates to, in metres.

Mirrors ``SNAP_GRID_M`` in ``partitionFillV2``.
"""

SNAP_MARGIN_CELLS: float = 2.0
"""How many snap cells the margin must clear, so it lands INSIDE the last region.

Two rather than one: a coordinate can be snapped away from the column edge by up
to a full cell, and the scanline then has to land strictly inside what is left.
"""
