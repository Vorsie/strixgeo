"""DigitisedCurve: one curve read off a CPT graph page."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import VECTOR_DRILL_GAP_M
from groundmodel.infrastructure.parsers.cpt.pdf.series_resampling import pen_up_after


@dataclass(frozen=True, eq=False)
class DigitisedCurve:
    """The vertices (vector) or row samples (raster) of one curve.

    Parameters
    ----------
    kind : PanelKind
        The quantity.
    depth_m : numpy.ndarray
        Depth below ground per point (m), strictly increasing.
    value : numpy.ndarray
        The value per point, in the stored unit (MPa, %, u2 in MPa).
    clipped : numpy.ndarray
        True where the curve sits on the panel's maximum edge: the true
        value is at least the axis maximum, not equal to it.
    source : GraphKind
        Read from vector paths or traced on pixels.
    colour : tuple of float or None
        The stroke / pixel colour traced (RGB 0..1).
    chain : numpy.ndarray or None
        Vector only: the id of the connected stroke each vertex was drawn in.
        Where the stroke changes and the depth jumps, the plotter lifted its
        pen over a drilled stretch (owner ruling "a", 2026-10-04). None for a
        raster trace, or when not known (one stroke).
    """

    kind: PanelKind
    depth_m: np.ndarray
    value: np.ndarray
    clipped: np.ndarray
    source: GraphKind
    colour: tuple[float, float, float] | None = None
    chain: np.ndarray | None = None

    def __len__(self) -> int:
        """Return the number of points."""
        return len(self.depth_m)

    def no_bridge(self) -> np.ndarray | None:
        """Return, per interval between consecutive points, whether it is a drilled stretch.

        Returns
        -------
        numpy.ndarray or None
            Boolean per interval (``len - 1``): True where the pen was lifted
            over more than ``VECTOR_DRILL_GAP_M``; None when the strokes are
            not known (raster).
        """
        if self.chain is None or len(self.chain) != len(self.depth_m):
            return None
        return pen_up_after(self.depth_m, self.chain, VECTOR_DRILL_GAP_M)
