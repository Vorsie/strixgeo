"""DigitisedCurve: one curve read off a CPT graph page."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind


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
    """

    kind: PanelKind
    depth_m: np.ndarray
    value: np.ndarray
    clipped: np.ndarray
    source: GraphKind
    colour: tuple[float, float, float] | None = None

    def __len__(self) -> int:
        """Return the number of points."""
        return len(self.depth_m)
