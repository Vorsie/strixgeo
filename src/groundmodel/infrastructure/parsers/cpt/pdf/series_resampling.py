"""Pure helpers: order a digitised depth series and resample it to a grid."""

from __future__ import annotations

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import CLIP_CROSSING_STEP_SHARE


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
    keep = monotonic_keep(d, v)
    return d[keep], v[keep], f[keep]


def monotonic_keep(depth: np.ndarray, value: np.ndarray) -> np.ndarray:
    """Return the mask of the vertices ``monotonic_depth`` keeps.

    Parameters
    ----------
    depth : numpy.ndarray
        Depth per vertex, drawing order.
    value : numpy.ndarray
        Value per vertex.

    Returns
    -------
    numpy.ndarray
        Boolean per vertex: finite, and deeper than every kept vertex before it.
    """
    d = np.asarray(depth, dtype=float)
    v = np.asarray(value, dtype=float)
    keep = np.zeros(len(d), dtype=bool)
    last = -np.inf
    for i, di in enumerate(d):
        if np.isfinite(di) and np.isfinite(v[i]) and di > last:
            keep[i] = True
            last = di
    return keep


def drop_clip_crossings(
    depth: np.ndarray, value: np.ndarray, clipped: np.ndarray
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Drop the vertices a plotter inserts where the curve crosses the clip edge.

    Where the curve runs from a scan inside the panel to one beyond the axis
    maximum (or back), the plotting program adds a vertex between the two
    scans. It is no measurement: the GEF has no row there (CAMZ-001 sounding
    66 at 30.964 m, 77b at 32.436 m). Such a vertex sits next to a clipped
    vertex, squeezed between two neighbours that are themselves only about one
    scan step apart.

    Parameters
    ----------
    depth : numpy.ndarray
        Strictly increasing depths.
    value : numpy.ndarray
        Values.
    clipped : numpy.ndarray
        Clip flags.

    Returns
    -------
    tuple of numpy.ndarray
        ``(depth, value, clipped)`` without the inserted vertices.
    """
    keep = clip_crossing_keep(depth, clipped)
    return depth[keep], value[keep], clipped[keep]


def clip_crossing_keep(depth: np.ndarray, clipped: np.ndarray) -> np.ndarray:
    """Return the mask of the vertices ``drop_clip_crossings`` keeps.

    Parameters
    ----------
    depth : numpy.ndarray
        Strictly increasing depths.
    clipped : numpy.ndarray
        Clip flags.

    Returns
    -------
    numpy.ndarray
        Boolean per vertex: False for a vertex the plotter inserted at a clip edge.
    """
    n = len(depth)
    keep = np.ones(n, dtype=bool)
    if n < 5:
        return keep
    step = float(np.median(np.diff(depth)))
    for i in range(1, n - 1):
        squeezed = depth[i + 1] - depth[i - 1] <= CLIP_CROSSING_STEP_SHARE * step
        near_clip = clipped[i - 1] or clipped[i] or clipped[i + 1]
        if squeezed and near_clip and keep[i - 1]:
            keep[i] = False
    return keep


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
    depth: np.ndarray,
    value: np.ndarray,
    grid: np.ndarray,
    max_gap_m: float | None = None,
    no_bridge: np.ndarray | None = None,
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
        Grid points lying between two consecutive source vertices more than
        this far apart become NaN (a gap in the curve stays a gap, including
        next to its edges); None interpolates everywhere inside the source
        range.
    no_bridge : numpy.ndarray or None
        Boolean per source interval (``len(depth) - 1``): True where the two
        vertices must not be joined (a drilled stretch where the pen was
        lifted); grid points strictly between them become NaN.

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
    if (max_gap_m is not None or no_bridge is not None) and inside.any():
        idx = np.clip(np.searchsorted(depth, grid[inside]), 1, len(depth) - 1)
        blank = np.zeros(len(idx), dtype=bool)
        if max_gap_m is not None:
            blank |= (depth[idx] - depth[idx - 1]) > max_gap_m
        if no_bridge is not None:
            blank |= np.asarray(no_bridge, dtype=bool)[idx - 1]
        on_vertex = np.isclose(grid[inside], depth[idx - 1]) | np.isclose(grid[inside], depth[idx])
        vals = out[inside]
        vals[blank & ~on_vertex] = np.nan
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


def pen_up_after(depth: np.ndarray, chain: np.ndarray, min_gap_m: float) -> np.ndarray:
    """Return, per interval between consecutive vertices, whether the pen was lifted there.

    A plotting program draws one push of the cone as one connected stroke and
    lifts the pen over a drilled stretch, so a drilled stretch is where the
    stroke (chain) changes AND the depth jumps by more than ``min_gap_m``. A
    distance alone cannot tell: a thinned polyline joins vertices up to
    0.34 m apart within one stroke (CAMZ-005).

    Parameters
    ----------
    depth : numpy.ndarray
        Strictly increasing vertex depths.
    chain : numpy.ndarray
        Stroke id per vertex (equal ids = one connected stroke).
    min_gap_m : float
        The smallest depth jump at a pen lift that counts as drilled.

    Returns
    -------
    numpy.ndarray
        Boolean per interval (``len(depth) - 1``).
    """
    d = np.asarray(depth, dtype=float)
    c = np.asarray(chain)
    if len(d) < 2:
        return np.zeros(0, dtype=bool)
    lifted: np.ndarray = (c[1:] != c[:-1]) & (np.diff(d) > min_gap_m)
    return lifted


def gap_intervals(depth: np.ndarray, no_bridge: np.ndarray) -> list[tuple[float, float]]:
    """Return the ``(top, base)`` stretches between vertices that are not joined.

    Parameters
    ----------
    depth : numpy.ndarray
        Strictly increasing vertex depths.
    no_bridge : numpy.ndarray
        Boolean per interval (``len(depth) - 1``), from ``pen_up_after``.

    Returns
    -------
    list of tuple of float
        The last vertex above each stretch and the first below, top first.
    """
    d = np.asarray(depth, dtype=float)
    return [(float(d[i]), float(d[i + 1])) for i in np.flatnonzero(no_bridge)]


def merge_intervals(intervals: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Return the union of depth intervals: overlapping or touching ones merged.

    Parameters
    ----------
    intervals : list of tuple of float
        ``(top, base)`` intervals in any order.

    Returns
    -------
    list of tuple of float
        Disjoint ``(top, base)`` intervals, top first.
    """
    merged: list[tuple[float, float]] = []
    for top, base in sorted(intervals):
        if merged and top <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], base))
        else:
            merged.append((top, base))
    return merged
