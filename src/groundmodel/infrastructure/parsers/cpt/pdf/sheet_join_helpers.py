"""Pure helpers: read the seam between two sheets of one sounding from the printed axes.

Owner direction (2026-10-07): "you can just look at start-depth on page 1 and
end depth on page 2 based on the axes". The seam between two sheets is defined
by the PRINTED DEPTH AXES, never by the curve strokes: sheet 1's axis ends at
D1, sheet 2's axis starts at D2.

* D2 <= D1: the sheets overlap on [D2, D1]; the gap the two drawings leave
  between them there is a plotting artefact of the join, never drilled.
* D2 > D1: no axis covers [D1, D2]; that stretch is unknown, not drilled.
* A pen lift INSIDE one sheet's own axis range stays overboring (drilled),
  exactly as on a one-sheet sounding: the curve stops while its own axis runs
  on (CAMZ-001 sounding 80: 31.2 m against an axis to ~33 m), starts below its
  own axis top, or lifts its pen inside its own drawing.
"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np

from groundmodel.infrastructure.parsers.cpt.pdf.depth_conversion import to_depth_below_ground
from groundmodel.infrastructure.parsers.cpt.pdf.digitised_curve import DigitisedCurve
from groundmodel.infrastructure.parsers.cpt.pdf.page_calibration import PageCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_calibration import PanelCalibration
from groundmodel.infrastructure.parsers.cpt.pdf.panel_kind import PanelKind
from groundmodel.infrastructure.parsers.cpt.pdf.pdf_constants import VECTOR_DRILL_GAP_M
from groundmodel.infrastructure.parsers.cpt.pdf.series_resampling import gap_intervals

# Join and gap ends are kept to the millimetre, like the drilled intervals.
_DECIMALS = 3


def axis_depth_range(calibration: PageCalibration) -> tuple[float, float] | None:
    """Return the depth range one sheet's printed depth axis covers.

    The qc panel's axis is read first (the drilled rule reads the qc curve);
    any other panel with a depth scale stands in when the qc panel has none.

    Parameters
    ----------
    calibration : PageCalibration
        The sheet's calibration.

    Returns
    -------
    tuple of float or None
        ``(top_m, base_m)`` below ground at the frame's top and bottom edge,
        or None when no panel has a depth scale, or an elevation axis has no
        ground level to convert it.
    """
    panels = sorted(calibration.panels, key=lambda p: p.kind is not PanelKind.QC)
    panel: PanelCalibration | None = next((p for p in panels if p.depth_scale is not None), None)
    if panel is None or panel.depth_scale is None:
        return None
    vertical = panel.depth_scale.values_at(np.array([panel.frame.y0, panel.frame.y1]))
    try:
        depth = to_depth_below_ground(vertical, calibration)
    except ValueError:
        return None
    return float(depth.min()), float(depth.max())


def sheets_axis_range(calibrations: Iterable[PageCalibration]) -> tuple[float, float] | None:
    """Return the depth range the printed axes of one or more sheets cover together.

    Parameters
    ----------
    calibrations : iterable of PageCalibration
        The sheets' calibrations.

    Returns
    -------
    tuple of float or None
        ``(shallowest top, deepest base)``, or None when any sheet's axis is
        not known (a join is only read from axes that were all read).
    """
    ranges = [axis_depth_range(c) for c in calibrations]
    known = [r for r in ranges if r is not None]
    if not known or len(known) != len(ranges):
        return None
    return min(r[0] for r in known), max(r[1] for r in known)


def axis_pair(d1: float, d2: float) -> tuple[float, float]:
    """Return the join ``(D1, D2)`` to the millimetre."""
    return round(d1, _DECIMALS), round(d2, _DECIMALS)


def is_axis_gap(d1: float, d2: float) -> bool:
    """Return whether sheet 2's axis starts below sheet 1's axis end by a real stretch.

    A stretch shorter than ``VECTOR_DRILL_GAP_M`` is no gap, like a pen lift
    shorter than that: an exact abutment (D2 == D1) leaves none.

    Parameters
    ----------
    d1 : float
        Sheet 1's axis end (m).
    d2 : float
        Sheet 2's axis start (m).

    Returns
    -------
    bool
        True when [D1, D2] is a stretch no axis covers.
    """
    return round(d2 - d1, _DECIMALS) > VECTOR_DRILL_GAP_M


def join_gap(upper: DigitisedCurve, sheet: DigitisedCurve) -> tuple[float, float] | None:
    """Return the gap the join leaves between two drawings of the qc curve.

    After the join the last vertex of the upper sheet(s) is followed by the
    first finite vertex of the continuation sheet deeper than it, in another
    stroke.

    Parameters
    ----------
    upper : DigitisedCurve
        The qc curve above the join.
    sheet : DigitisedCurve
        The qc curve of the continuation sheet.

    Returns
    -------
    tuple of float or None
        ``(top_m, base_m)``, or None when the depth jump is no wider than
        ``VECTOR_DRILL_GAP_M`` (nothing would be called drilled) or the
        continuation draws nothing below the upper end.
    """
    if not len(upper) or not len(sheet):
        return None
    top = float(upper.depth_m[-1])
    below = sheet.depth_m[(sheet.depth_m > top) & np.isfinite(sheet.value)]
    if not len(below) or float(below[0]) - top <= VECTOR_DRILL_GAP_M:
        return None
    return top, float(below[0])


def in_sheet_gaps(
    upper: DigitisedCurve, sheet: DigitisedCurve, d1: float, d2: float
) -> list[tuple[float, float]]:
    """Return the stretches a sheet leaves undrawn INSIDE its own printed axis, near the join.

    These stay overboring (drilled): the upper curve stopping while its own
    axis runs on to D1, the continuation curve starting below its own axis
    top D2, and every pen lift the continuation draws itself.

    Parameters
    ----------
    upper : DigitisedCurve
        The qc curve above the join.
    sheet : DigitisedCurve
        The qc curve of the continuation sheet.
    d1 : float
        The upper sheet's axis end (m).
    d2 : float
        The continuation sheet's axis start (m).

    Returns
    -------
    list of tuple of float
        ``(top_m, base_m)`` stretches, each wider than ``VECTOR_DRILL_GAP_M``.
    """
    gaps: list[tuple[float, float]] = []
    upper_end = float(upper.depth_m[-1])
    if d1 - upper_end > VECTOR_DRILL_GAP_M:
        gaps.append((upper_end, d1))
    sheet_start = float(sheet.depth_m[0])
    if sheet_start - d2 > VECTOR_DRILL_GAP_M:
        gaps.append((d2, sheet_start))
    lifts = sheet.no_bridge()
    if lifts is not None:
        gaps.extend(gap_intervals(sheet.depth_m, lifts))
    return gaps


def overlaps(gap: tuple[float, float], stretches: list[tuple[float, float]]) -> bool:
    """Return whether ``gap`` shares more than a millimetre with any of ``stretches``."""
    top, base = gap
    return any(min(base, b) - max(top, t) > 10.0**-_DECIMALS for t, b in stretches)
