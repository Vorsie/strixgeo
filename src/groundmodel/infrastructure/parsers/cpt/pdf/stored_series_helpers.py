"""Pure helpers: lay a digitised sounding out as the one table a CPT stores.

A stored CPT has ONE depth array shared by qc, fs, Rf and u2. Owner
2026-09-30: "vector sheets store the vertices as the scans (no resampling);
raster traces are resampled to 0.02 m". On a vector sheet the qc polyline's
vertices are the scans, so they are the depth array; the other curves are read
at those depths (their own vertex where one sits on the same scan, a straight
line between their neighbouring vertices otherwise). A raster trace has no
scans, only pixel rows, so every curve goes onto the 0.02 m grid.
"""

from __future__ import annotations

import numpy as np
import polars as pl

from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_sounding import DigitisedSounding
from groundmodel.infrastructure.parsers.cpt.pdf.graph_kind import GraphKind
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    DEFAULT_RESAMPLE_STEP_M,
    SAMPLING_RASTER,
    SAMPLING_VECTOR,
    STORED_COLUMN_BY_KIND,
    VERTEX_MATCH_TOLERANCE_M,
)
from groundmodel.infrastructure.parsers.cpt.pdf.series_resampling import nearest_flag

# Depths are stored to 0.1 mm: enough to keep every printed scan apart, and it
# drops the float noise of a point -> metre conversion (1.0199999 -> 1.02).
_DEPTH_DECIMALS = 4


def clipped_column(value_column: str) -> str:
    """Return the flag column of a stored value column ("qc_mpa" -> "qc_clipped")."""
    return f"{value_column.split('_')[0]}_clipped"


def is_vector(sounding: DigitisedSounding) -> bool:
    """Return whether every curve of the sounding was read from vector paths."""
    return bool(sounding.curves) and all(
        c.source is GraphKind.VECTOR for c in sounding.curves.values()
    )


def read_at(curve: DigitisedCurve, grid: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Return a curve's values and clipped flags at the depths of ``grid``.

    Parameters
    ----------
    curve : DigitisedCurve
        A curve with strictly increasing depths.
    grid : numpy.ndarray
        The depths to read at (the qc scans).

    Returns
    -------
    tuple of numpy.ndarray
        ``(values, clipped)``: the curve's own vertex value where one lies
        within ``VERTEX_MATCH_TOLERANCE_M`` of a grid depth, a straight line
        between its neighbouring vertices elsewhere, NaN outside its depth
        range.
    """
    d, v = curve.depth_m, curve.value
    if len(d) == 0:
        return np.full(len(grid), np.nan), np.zeros(len(grid), dtype=bool)
    values = np.interp(grid, d, v, left=np.nan, right=np.nan)
    idx = np.clip(np.searchsorted(d, grid), 1, max(len(d) - 1, 1))
    lower = np.clip(idx - 1, 0, len(d) - 1)
    upper = np.clip(idx, 0, len(d) - 1)
    near = np.where(np.abs(d[lower] - grid) <= np.abs(d[upper] - grid), lower, upper)
    exact = np.abs(d[near] - grid) <= VERTEX_MATCH_TOLERANCE_M
    values[exact] = v[near[exact]]
    return values, nearest_flag(d, curve.clipped, grid)


def stored_table(sounding: DigitisedSounding) -> tuple[pl.DataFrame, str, int]:
    """Return the sounding as the stored table and how it was sampled.

    Parameters
    ----------
    sounding : DigitisedSounding
        The digitised sounding (continuation sheets already merged).

    Returns
    -------
    tuple
        ``(frame, sampling, above_ground)``: ``depth_m`` plus ``qc_mpa`` and whichever of
        ``fs_mpa`` / ``rf_pct`` / ``u2_mpa`` were read, each with a
        ``<name>_clipped`` flag column; rows without qc dropped, missing
        values null. ``sampling`` is ``SAMPLING_VECTOR`` or ``SAMPLING_RASTER``;
        ``above_ground`` counts the points plotted above ground level
        (negative depth), which are not scans and are dropped: a plotter
        starts its line a few millimetres above the surface (CAMZ-001 110
        at -0.005 m), where no GEF has a row.

    Raises
    ------
    ValueError
        When no qc curve was read (every stored CPT needs qc).
    """
    qc = sounding.curves.get(PanelKind.QC)
    if qc is None or len(qc) == 0:
        raise ValueError(
            f"sounding {sounding.sounding_id or '?'}: no qc curve read, nothing to store"
        )
    if is_vector(sounding):
        columns: dict[str, np.ndarray] = {
            "depth_m": np.round(qc.depth_m, _DEPTH_DECIMALS),
            "qc_mpa": qc.value.astype(float),
            "qc_clipped": qc.clipped.astype(bool),
        }
        for kind, name in STORED_COLUMN_BY_KIND.items():
            curve = sounding.curves.get(kind)
            if kind is PanelKind.QC or curve is None or len(curve) == 0:
                continue
            values, flags = read_at(curve, qc.depth_m)
            columns[name] = values
            columns[clipped_column(name)] = flags
        frame = pl.DataFrame(columns)
        sampling = SAMPLING_VECTOR
    else:
        frame = sounding.to_frame(DEFAULT_RESAMPLE_STEP_M).with_columns(
            pl.col("depth_m").round(_DEPTH_DECIMALS)
        )
        sampling = SAMPLING_RASTER
    frame = frame.fill_nan(None).filter(pl.col("qc_mpa").is_not_null())
    above_ground = frame.filter(pl.col("depth_m") < 0).height
    return frame.filter(pl.col("depth_m") >= 0), sampling, above_ground


def clipped_intervals(depth: list[float], flags: list[bool]) -> list[list[float]]:
    """Return the depth runs ``[top, base]`` over which a curve is clipped.

    Parameters
    ----------
    depth : list of float
        Depth per row.
    flags : list of bool
        Clipped flag per row.

    Returns
    -------
    list of [float, float]
        One ``[first depth, last depth]`` per run of consecutive flagged rows.
    """
    runs: list[list[float]] = []
    start: float | None = None
    last = 0.0
    for d, f in zip(depth, flags, strict=True):
        if f and start is None:
            start = d
        elif not f and start is not None:
            runs.append([start, last])
            start = None
        last = d
    if start is not None:
        runs.append([start, last])
    return runs
