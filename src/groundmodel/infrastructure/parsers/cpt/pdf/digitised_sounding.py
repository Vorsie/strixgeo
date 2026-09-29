"""DigitisedSounding: every curve of one sounding plus its calibration."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import polars as pl

from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    DEFAULT_RESAMPLE_STEP_M,
    STORED_COLUMN_BY_KIND,
)
from groundmodel.infrastructure.parsers.cpt.pdf.series_resampling import (
    depth_grid,
    nearest_flag,
    resample,
)

_COLUMN = STORED_COLUMN_BY_KIND


@dataclass(frozen=True, eq=False)
class DigitisedSounding:
    """The digitised curves of one sounding (one page or a page + continuation).

    Parameters
    ----------
    sounding_id : str or None
        The id printed on the sheet.
    page_numbers : tuple of int
        1-based pages the curves were read from.
    calibrations : tuple of PageCalibration
        The calibration of each page (the overlay a UI would show).
    curves : dict
        PanelKind -> DigitisedCurve.
    annotations : tuple of tuple
        ``(depth_m, text)`` of values printed inside the frame (the arrow
        labels of a clipped qc, e.g. "32.53").
    """

    sounding_id: str | None
    page_numbers: tuple[int, ...]
    calibrations: tuple[PageCalibration, ...]
    curves: dict[PanelKind, DigitisedCurve]
    annotations: tuple[tuple[float, str], ...] = field(default_factory=tuple)

    def to_frame(self, step_m: float = DEFAULT_RESAMPLE_STEP_M) -> pl.DataFrame:
        """Resample every curve onto one regular depth grid.

        Parameters
        ----------
        step_m : float
            Grid step (m); 0.02 m by default, the GEF scan step.

        Returns
        -------
        polars.DataFrame
            ``depth_m`` plus one column per curve (``qc_mpa``, ``fs_mpa``,
            ``rf_pct``, ``u2_mpa``) and a ``<name>_clipped`` flag column per
            curve. NaN where a curve does not reach.
        """
        stored = [c for k, c in self.curves.items() if k in _COLUMN and len(c) >= 2]
        if not stored:
            return pl.DataFrame({"depth_m": []}, schema={"depth_m": pl.Float64})
        lo = min(float(c.depth_m[0]) for c in stored)
        hi = max(float(c.depth_m[-1]) for c in stored)
        grid = depth_grid(lo, hi, step_m)
        columns: dict[str, np.ndarray] = {"depth_m": grid}
        for curve in stored:
            name = _COLUMN[curve.kind]
            # A raster trace has gaps where no pixel matched; keep them as
            # gaps instead of bridging them with a straight line.
            max_gap = None if curve.source.value == "vector" else 5 * step_m
            columns[name] = resample(curve.depth_m, curve.value, grid, max_gap)
            columns[f"{name.split('_')[0]}_clipped"] = nearest_flag(
                curve.depth_m, curve.clipped, grid
            )
        return pl.DataFrame(columns)

    def write_csv(self, path: Path, step_m: float = DEFAULT_RESAMPLE_STEP_M) -> Path:
        """Write the resampled table as CSV.

        Parameters
        ----------
        path : pathlib.Path
            Target file.
        step_m : float
            Grid step (m).

        Returns
        -------
        pathlib.Path
            The written path.
        """
        self.to_frame(step_m).write_csv(path, float_precision=4)
        return path
