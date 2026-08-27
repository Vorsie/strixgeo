"""Tolerance for clause 7 of the gapless gate (2-D↔3-D section reconciliation).

Pure constants module — no I/O, no framework imports.  It holds a value; it
does not act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

from typing import Final

__all__ = ["RECONCILE_RELATIVE_TOLERANCE"]

RECONCILE_RELATIVE_TOLERANCE: Final[float] = 0.05
"""Relative slack added on top of the exact vertical-quantisation budget.

The quantisation term computed alongside this one
(:class:`~groundmodel.domain.services.voxel_litho.voxel_types.SectionReconciliation.budget_m2`)
is DERIVED and exact: a contiguous run sampled on a grid of pitch ``v`` can
differ from its true height by at most ``v``, full stop.  This second term is
NOT derived — it is an allowance for three effects nobody has measured yet:
the horizontal offset between a sample point on the section fence and the
nearest grid node (up to half a cell diagonal), the honored-borehole cells
that legitimately override the section fill within one voxel of each
investigation (so the 3-D side there can differ from the 2-D fill on purpose),
and the two-section blend zone where a crossing section is nearly as close as
the one that drew the fill.

Five percent is a STARTING POINT, chosen so a clean model is expected to pass
comfortably — it is OWNER-CALIBRATION PENDING and must be re-set against the
first real build once one is available to measure against, not treated as a
settled figure.
"""
