"""How far a grid-cell centre may sit outside the hull and still count as inside.

One rule, two independent readers that must agree on the same footprint: the
voxel labeller (:func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`,
which gates every grid column) and the gapless-gate clause-7 reconciliation
(:mod:`~groundmodel.domain.services.voxel_litho.section_reconciliation`, which
must ask the SAME "is this inside the model?" question at the same sample
points the labeller answered, or the two would disagree about what "inside"
meant and clause 7 would compare two different footprints instead of the same
one from two directions).

Pure domain module — no I/O, no framework imports.  It computes; it does not
act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

import math

__all__ = ["footprint_tolerance_m"]


def footprint_tolerance_m(horizontal_spacing_m: float) -> float:
    """Half a grid cell's diagonal, in metres — the boundary inclusion tolerance.

    Strict point-in-polygon parity is numerically unstable for a cell centre
    that lands exactly on (or a hair outside) a hull edge — roughly half of
    the on-boundary nodes flip to "outside" even though the cell itself
    overlaps the data footprint.  Passing this value as
    :meth:`~groundmodel.domain.services.model_domain.ModelDomain.contains`'s
    ``tol`` admits any node whose cell touches the footprint, while a node
    farther than a full cell away stays void.

    Parameters
    ----------
    horizontal_spacing_m : float
        The grid's horizontal (X/Y) voxel edge length in metres.

    Returns
    -------
    float
        ``0.5 * horizontal_spacing_m * sqrt(2)`` — half the cell's diagonal.
    """
    return 0.5 * horizontal_spacing_m * math.sqrt(2.0)
