"""Pure helpers: match vector stroke colours by hue family, not exact RGB."""

from __future__ import annotations

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import (
    DARK_STROKE_MAX_VALUE,
    GREY_STROKE_MAX_SATURATION,
    STROKE_HUE_TOLERANCE_DEG,
    STROKE_MIN_SATURATION,
)


def hue_sat_val(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return hue (degrees), saturation and value (0..1) of RGB rows (0..1).

    Parameters
    ----------
    rgb : numpy.ndarray
        ``(n, 3)`` colours in 0..1.

    Returns
    -------
    tuple of numpy.ndarray
        Hue 0..360, saturation 0..1, value 0..1.
    """
    c = np.atleast_2d(np.asarray(rgb, dtype=float))
    mx = c.max(axis=1)
    mn = c.min(axis=1)
    delta = mx - mn
    hue = np.zeros(len(c))
    safe = delta > 1e-9
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    rmax = safe & (mx == r)
    gmax = safe & (mx == g) & ~rmax
    bmax = safe & ~rmax & ~gmax
    hue[rmax] = (60.0 * ((g - b)[rmax] / delta[rmax])) % 360.0
    hue[gmax] = 60.0 * ((b - r)[gmax] / delta[gmax]) + 120.0
    hue[bmax] = 60.0 * ((r - g)[bmax] / delta[bmax]) + 240.0
    sat = np.where(mx > 1e-9, delta / np.maximum(mx, 1e-9), 0.0)
    return hue, sat, mx


def matches_colour(rgb: np.ndarray, target: tuple[float, float, float]) -> np.ndarray:
    """Return which stroke colours belong to the target's colour family.

    Print drivers convert colours (CMYK -> RGB), so the same company's blue
    comes out as (0, 0, 1) in one report and (0.17, 0.31, 0.64) in another.
    A chromatic target matches on hue; a black target matches dark, grey
    strokes.

    Parameters
    ----------
    rgb : numpy.ndarray
        ``(n, 3)`` stroke colours in 0..1.
    target : tuple of float
        The profile colour.

    Returns
    -------
    numpy.ndarray
        Boolean per row.
    """
    hue, sat, val = hue_sat_val(rgb)
    t_hue, t_sat, t_val = (float(x[0]) for x in hue_sat_val(np.asarray([target])))
    if t_sat <= GREY_STROKE_MAX_SATURATION:
        return (sat <= GREY_STROKE_MAX_SATURATION) & (val <= DARK_STROKE_MAX_VALUE)
    diff = np.abs(hue - t_hue)
    diff = np.minimum(diff, 360.0 - diff)
    return (diff <= STROKE_HUE_TOLERANCE_DEG) & (sat >= STROKE_MIN_SATURATION)
