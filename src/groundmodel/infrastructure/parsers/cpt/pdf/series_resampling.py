"""Pure helpers: order a digitised depth series and resample it to a grid."""

from __future__ import annotations

import numpy as np


def monotonic_depth(
    depth: np.ndarray, value: np.ndarray, flags: np.ndarray | None = None
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Keep the vertices whose depth grows strictly, in drawing order.

    A CPT curve is drawn top to bottom, one vertex per scan. A vertex that
    does not go deeper than the last kept one is a horizontal excursion drawn
    back on itself (or a duplicate where two paths join) and is dropped, so
    ``numpy.interp`` sees a strictly increasing abscissa.

    Parameters
    ----------
    depth : numpy.ndarray
        Depth per vertex, drawing order.
    value : numpy.ndarray
        Value per vertex.
    flags : numpy.ndarray or None
        Optional boolean per vertex (e.g. clipped), filtered alongside.

    Returns
    -------
    tuple of numpy.ndarray
        ``(depth, value, flags)`` of the kept vertices; ``flags`` is all
        False when none was given.
    """
    d = np.asarray(depth, dtype=float)
    v = np.asarray(value, dtype=float)
    f = np.zeros(len(d), dtype=bool) if flags is None else np.asarray(flags, dtype=bool)
    keep = np.zeros(len(d), dtype=bool)
    last = -np.inf
    for i, di in enumerate(d):
        if np.isfinite(di) and np.isfinite(v[i]) and di > last:
            keep[i] = True
            last = di
    return d[keep], v[keep], f[keep]


def depth_grid(depth_min: float, depth_max: float, step_m: float) -> np.ndarray:
    """Return the regular grid of multiples of ``step_m`` inside a range.

    Parameters
    ----------
    depth_min, depth_max : float
        The covered depth range.
    step_m : float
        Grid step.

    Returns
    -------
    numpy.ndarray
        Grid depths, rounded to the step's precision so a digitised series
        and a GEF on the same step share their rows exactly.
    """
    first = np.ceil(depth_min / step_m - 1e-9)
    last = np.floor(depth_max / step_m + 1e-9)
    if last < first:
        return np.array([], dtype=float)
    return np.round(np.arange(first, last + 1) * step_m, 6)


def resample(
    depth: np.ndarray, value: np.ndarray, grid: np.ndarray, max_gap_m: float | None = None
) -> np.ndarray:
    """Linearly interpolate a series onto a depth grid.

    Parameters
    ----------
    depth : numpy.ndarray
        Strictly increasing source depths.
    value : numpy.ndarray
        Source values.
    grid : numpy.ndarray
        Target depths.
    max_gap_m : float or None
        Grid points further than this from the nearest source vertex become
        NaN (a gap in the curve stays a gap); None interpolates everywhere
        inside the source range.

    Returns
    -------
    numpy.ndarray
        Values on the grid; NaN outside the source range.
    """
    out = np.full(len(grid), np.nan)
    if len(depth) < 2:
        return out
    inside = (grid >= depth[0]) & (grid <= depth[-1])
    out[inside] = np.interp(grid[inside], depth, value)
    if max_gap_m is not None and inside.any():
        idx = np.clip(np.searchsorted(depth, grid[inside]), 1, len(depth) - 1)
        nearest = np.minimum(
            np.abs(grid[inside] - depth[idx - 1]), np.abs(depth[idx] - grid[inside])
        )
        vals = out[inside]
        vals[nearest > max_gap_m] = np.nan
        out[inside] = vals
    return out


def nearest_flag(depth: np.ndarray, flags: np.ndarray, grid: np.ndarray) -> np.ndarray:
    """Carry a per-vertex boolean onto a grid by nearest vertex.

    Parameters
    ----------
    depth : numpy.ndarray
        Strictly increasing source depths.
    flags : numpy.ndarray
        Boolean per source vertex.
    grid : numpy.ndarray
        Target depths.

    Returns
    -------
    numpy.ndarray
        Boolean per grid point (False outside the source range).
    """
    out = np.zeros(len(grid), dtype=bool)
    if len(depth) == 0:
        return out
    idx = np.clip(np.searchsorted(depth, grid), 1, max(len(depth) - 1, 1))
    left = np.clip(idx - 1, 0, len(depth) - 1)
    right = np.clip(idx, 0, len(depth) - 1)
    choose = np.where(np.abs(grid - depth[left]) <= np.abs(depth[right] - grid), left, right)
    inside = (grid >= depth[0]) & (grid <= depth[-1])
    out[inside] = flags[choose[inside]]
    return out
