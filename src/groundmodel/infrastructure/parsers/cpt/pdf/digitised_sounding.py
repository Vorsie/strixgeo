"""DigitisedSounding: every curve of one sounding plus its calibration."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import polars as pl

from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    DEFAULT_RESAMPLE_STEP_M,
    STORED_COLUMN_BY_KIND,
)
from groundmodel.infrastructure.parsers.cpt.pdf.series_resampling import (
    depth_grid,
    gap_intervals,
    merge_intervals,
    nearest_flag,
    resample,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Interval ends are reported to the millimetre: enough for a drilled stretch,
# and it drops the float noise of a point -> metre conversion.
_INTERVAL_DECIMALS = 3

# Two interval ends within half a millimetre are the same vertex (both are
# rounded to the millimetre before they are compared).
_SAME_DEPTH_M = 0.0005

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
    sheet_joins_m : tuple of tuple of float
        One ``(upper_end_m, continuation_start_m)`` pair per sheet join, top
        first: the deepest point drawn on the sheet(s) above the join and the
        first point drawn on the continuation sheet. A continuation that
        repeats the last part of the sheet before starts above the upper end.
        Empty for a one-sheet sounding.
    seam_gaps_m : tuple of tuple of float
        The qc pen lifts the join itself made: ``(top_m, base_m)`` from the
        last qc vertex of the upper sheet to the next kept vertex of the
        continuation sheet, where the continuation sheet draws through that
        depth in one stroke. Never a drilled stretch (owner ruling "a",
        2026-10-07). Empty for a one-sheet sounding.
    """

    sounding_id: str | None
    page_numbers: tuple[int, ...]
    calibrations: tuple[PageCalibration, ...]
    curves: dict[PanelKind, DigitisedCurve]
    annotations: tuple[tuple[float, str], ...] = field(default_factory=tuple)
    sheet_joins_m: tuple[tuple[float, float], ...] = field(default_factory=tuple)
    seam_gaps_m: tuple[tuple[float, float], ...] = field(default_factory=tuple)

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
            curve. NaN where a curve does not reach, and across a gap in a
            curve: where a vector curve's pen was lifted over more than
            ``VECTOR_DRILL_GAP_M`` (a drilled stretch: its depth rows stay,
            their values are empty), and over a raster gap wider than five
            grid steps (no pixel matched).
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
            # Never bridge a gap with a straight line: a vector pen lift is a
            # drilled stretch (owner ruling "a", 2026-10-04); a raster trace
            # has gaps where no pixel matched.
            if curve.source is GraphKind.VECTOR:
                values = resample(curve.depth_m, curve.value, grid, no_bridge=curve.no_bridge())
            else:
                values = resample(curve.depth_m, curve.value, grid, 5 * step_m)
            columns[name] = values
            columns[f"{name.split('_')[0]}_clipped"] = nearest_flag(
                curve.depth_m, curve.clipped, grid
            )
        return pl.DataFrame(columns)

    def drilled_intervals(
        self, logger: GroundModelLogger | None = None
    ) -> list[tuple[float, float]]:
        """Return the drilled stretches of the sounding, top first.

        A drilled stretch (rods added, "voorboring" between two pushes) shows
        on a vector sheet as a pen lift in the qc curve: the stroke changes
        and the depth jumps by more than ``VECTOR_DRILL_GAP_M`` (owner ruling
        "a", 2026-10-04). Only the qc curve says so: the fs curve also lifts
        its pen where it leaves its panel (CAMZ-001 sounding 25 at 40.3 m),
        where the GEF has data. A pen lift in another curve still leaves that
        curve empty, it is only not called drilled. A raster trace is left
        out: it has no strokes.

        A gap at a sheet join is never drilled (owner ruling "a",
        2026-10-07): the continuation sheet is a new drawing, so the stroke
        change between the last vertex of one sheet and the next vertex of
        the other is a plotting artefact when the continuation sheet draws
        through that depth in one stroke (CAMZ-001 2.3, soundings 68 and 69
        at ~33.5 m: a sparse polyline, no pen lift on either sheet). Those
        ``seam_gaps_m`` are left out. A pen lift the continuation sheet
        draws itself, or a stretch neither sheet draws (the upper curve
        stops metres above the join), stays drilled: the 2.4 print of the
        same report shows those too. The values across the seam are not
        changed: ``to_frame`` still bridges nothing.

        Parameters
        ----------
        logger : GroundModelLogger or None
            Receives one DEBUG line per gap dropped at a sheet join.

        Returns
        -------
        list of tuple of float
            Disjoint ``(top_m, base_m)`` per stretch, to the millimetre: the
            last qc vertex above it and the first below.
        """
        qc = self.curves.get(PanelKind.QC)
        no_bridge = qc.no_bridge() if qc is not None else None
        if qc is None or qc.source is not GraphKind.VECTOR or no_bridge is None:
            return []
        kept: list[tuple[float, float]] = []
        for top, base in gap_intervals(qc.depth_m, no_bridge):
            if self._is_seam_gap(top, base):
                if logger is not None:
                    logger.debug(
                        "sounding %s: gap %.3f-%.3f m at a sheet join is a plotting "
                        "artefact, not drilled",
                        self.sounding_id,
                        top,
                        base,
                    )
                continue
            kept.append((top, base))
        return [
            (round(top, _INTERVAL_DECIMALS), round(base, _INTERVAL_DECIMALS))
            for top, base in merge_intervals(kept)
        ]

    def _is_seam_gap(self, top: float, base: float) -> bool:
        """Return whether the pen lift ``top``-``base`` is one the sheet join made."""
        t, b = round(top, _INTERVAL_DECIMALS), round(base, _INTERVAL_DECIMALS)
        return any(
            abs(t - seam_top) <= _SAME_DEPTH_M and abs(b - seam_base) <= _SAME_DEPTH_M
            for seam_top, seam_base in self.seam_gaps_m
        )

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
