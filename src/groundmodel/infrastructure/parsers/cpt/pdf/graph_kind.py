"""GraphKind enum."""

from __future__ import annotations

from enum import StrEnum


class GraphKind(StrEnum):
    """How the curves of a CPT graph page are stored in the PDF.

    Members
    -------
    VECTOR
        Drawing commands: the polyline vertices are read exactly.
    RASTER
        Pixels (a scan or a pasted image): rendered and traced.
    """

    VECTOR = "vector"
    RASTER = "raster"
