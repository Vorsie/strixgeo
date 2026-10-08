"""DigitisedSounding: every curve of one sounding plus its calibration."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

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
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Interval ends are reported to the millimetre: enough for a drilled stretch,
# and it drops the float noise of a point -> metre conversion.
_INTERVAL_DECIMALS = 3

# Two interval ends within half a millimetre are the same vertex (both are
# rounded to the millimetre before they are compared).
_SAME_DEPTH_M = 0.0005

_COLUMN = STORED_COLUMN_BY_KIND

# Sources whose points ARE the scans (vector vertices, printed table rows):
# never bridged across a stroke change, never resampled for storage.
_EXACT_SOURCES = (GraphKind.VECTOR, GraphKind.TABLE)


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
        One ``(D1, D2)`` pair per sheet join, top first, read from the
        PRINTED DEPTH AXES (owner direction 2026-10-07): D1 is where the
        upper sheet's depth axis ends, D2 where the continuation sheet's
        starts. D2 <= D1 when the sheets overlap. Empty for a one-sheet
        sounding, and for a join whose axes were not read.
    seam_gaps_m : tuple of tuple of float
        The qc gaps the joins themselves made: ``(top_m, base_m)`` from the
        last qc vertex of the upper sheet to the next kept vertex of the
        continuation, where no sheet leaves that stretch undrawn inside its
        own printed axis. A plotting artefact, never drilled. Empty for a
        one-sheet sounding.
    sheet_axis_gaps_m : tuple of tuple of float
        ``(D1, D2)`` per join whose axes leave a stretch uncovered (D2 > D1):
        no sheet could draw it, so it is unknown, never drilled.
    printed_pre_drill_m : float or None
        A pre-drill depth the sheet PRINTS ("voorgeduwd ... tot een diepte van
        1 m"); the stored provenance takes it over the first row's depth.
    effective_pre_drill_m : float or None
        A printed table's first real row: below the printed pre-drill when
        rows printing the floor qc follow it (no reading, owner 2026-10-09).
        None for a digitised graph.
    printed_cpt_type : str or None
        The CPT classification the sheet prints ("CPTE", "CPTM"); the stored
        type takes it over the one guessed from the curves read.
    table_provenance : dict or None
        A printed-table sounding's own provenance (``printed_table`` in the
        stored provenance); None for a digitised graph.
    issues : tuple of ValidationIssue
        Findings of the reading itself (a printed Rf its own fs and qc cannot
        give, a malformed row), carried into the parse result.
    """

    sounding_id: str | None
    page_numbers: tuple[int, ...]
    calibrations: tuple[PageCalibration, ...]
    curves: dict[PanelKind, DigitisedCurve]
    annotations: tuple[tuple[float, str], ...] = field(default_factory=tuple)
    sheet_joins_m: tuple[tuple[float, float], ...] = field(default_factory=tuple)
    seam_gaps_m: tuple[tuple[float, float], ...] = field(default_factory=tuple)
    sheet_axis_gaps_m: tuple[tuple[float, float], ...] = field(default_factory=tuple)
    printed_pre_drill_m: float | None = None
    effective_pre_drill_m: float | None = None
    printed_cpt_type: str | None = None
    table_provenance: dict[str, Any] | None = None
    issues: tuple[ValidationIssue, ...] = field(default_factory=tuple)

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
            if curve.source in _EXACT_SOURCES:
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

        A drilled stretch (rods added, "overboring" between two pushes) shows
        on a vector sheet as a pen lift in the qc curve: the stroke changes
        and the depth jumps by more than ``VECTOR_DRILL_GAP_M`` (owner ruling
        "a", 2026-10-04). Only the qc curve says so: the fs curve also lifts
        its pen where it leaves its panel (CAMZ-001 sounding 25 at 40.3 m),
        where the GEF has data. A pen lift in another curve still leaves that
        curve empty, it is only not called drilled. A raster trace is left
        out: it has no strokes.

        A gap at a sheet join is read from the printed depth axes (owner
        direction 2026-10-07: "look at start-depth on page 1 and end depth on
        page 2 based on the axes"). Where the sheets' axes overlap or abut,
        the gap the two drawings leave between them is a plotting artefact
        (CAMZ-001 2.3, soundings 68 and 69 at ~33.5 m: sheet 1 is drawn to
        its axis end). Where they leave a stretch uncovered it is unknown,
        not drilled (``sheet_axis_gaps_m``). Those ``seam_gaps_m`` are left
        out. A pen lift INSIDE one sheet's own axis range stays drilled: the
        curve stops while its axis runs on (sounding 80), or the
        continuation lifts its own pen (76b). The values across the seam
        are not changed: ``to_frame`` still bridges nothing.

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
        if qc is None or qc.source not in _EXACT_SOURCES or no_bridge is None:
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

    def sheet_axis_gaps(self) -> list[tuple[int, float, float]]:
        """Return each stretch no printed axis covers, with the sheet it follows.

        Returns
        -------
        list of tuple
            ``(sheet, d1_m, d2_m)``: sheet ``sheet`` (1-based) ends at D1,
            sheet ``sheet + 1`` starts at D2, top first.
        """
        return [
            (i + 1, d1, d2)
            for i, (d1, d2) in enumerate(self.sheet_joins_m)
            if (d1, d2) in self.sheet_axis_gaps_m
        ]

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
