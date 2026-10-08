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
    TABLE
        The sounding's own printed numeric table (depth, qc, fs, Rf rows):
        the values are read as printed, nothing is traced.
    """

    VECTOR = "vector"
    RASTER = "raster"
    TABLE = "printed-table"
