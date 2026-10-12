"""PdfSoundingView: one sounding as the calibration overlay shows it."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import polars as pl

from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.report_sounding import ReportSounding


@dataclass(frozen=True, eq=False)
class PdfSoundingView:
    """A sounding read through its (possibly user-edited) calibration.

    Parameters
    ----------
    listed : ReportSounding
        What the triage listed (header, warnings).
    sounding : DigitisedSounding
        The curves and the calibration of every page.
    table : polars.DataFrame or None
        The rows a CPT would store; None while no qc curve is read (a raster
        page awaiting the user's tick values).
    sampling : str or None
        How ``table`` was sampled (vector vertices / raster 0.02 m).
    overlays : dict
        Page number -> the overlay PNG (page + frames + orange curve).
    overlay_dpi : float
        Resolution of the overlays.
    graph : DigitisedSounding or None
        A printed-table sounding's graph sheet read through its calibration
        (the overlays draw it); None for every other sounding.
    graph_table : polars.DataFrame or None
        The rows the graph reading would store; None while no qc is read.
    comparison : dict or None
        Picture qc vs printed qc (``qc_comparison``) when both exist.
    """

    listed: ReportSounding
    sounding: DigitisedSounding
    table: pl.DataFrame | None
    sampling: str | None
    overlays: dict[int, bytes]
    overlay_dpi: float
    graph: DigitisedSounding | None = None
    graph_table: pl.DataFrame | None = None
    comparison: dict[str, Any] | None = None
