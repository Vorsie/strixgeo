"""Build the out-of-area coordinate ``ValidationIssue``, shared by all parsers.

The GEF parser and the two DOV parsers (CPT sondering, boring) each run the
same coordinate-bounds check and raise the same WARNING when it fails. This is
the single place that turns a :class:`CrsBoundsResult` into that issue, so the
code, severity and wording stay identical across the three import paths. The
geometry itself lives in :mod:`groundmodel.infrastructure.parsers.crs_bounds`;
this module only names the finding.
"""

from __future__ import annotations

from groundmodel.infrastructure.codelists.horizontal_crs import horizontal_crs_label
from groundmodel.infrastructure.parsers.crs_bounds import (
    CrsBoundsResult,
    classify_coordinates,
)
from groundmodel.infrastructure.parsers.crs_bounds_constants import (
    COORDINATES_OUTSIDE_CRS_BOUNDS_CODE,
)
from groundmodel.infrastructure.parsers.validation.validation_issue import ValidationIssue
from groundmodel.infrastructure.parsers.validation.validation_level import ValidationLevel


def make_crs_bounds_issue(
    epsg: int | None,
    x: float | None,
    y: float | None,
    *,
    prefix: str = "",
) -> ValidationIssue | None:
    """Return a WARNING when ``(x, y)`` lies outside *epsg*'s area, else ``None``.

    The message names the declared system (label + EPSG) and the offending
    values, so a swapped X/Y, a wrong EPSG, or a foreign position is legible in
    the import report without opening the file. Never an ERROR — an out-of-area
    coordinate is flagged, never a reason to refuse the import.

    Callers guard the "no coordinates" and "(0, 0)" cases themselves (those
    carry their own, more specific findings); passing them here is harmless —
    the classifier returns ``UNKNOWN``/``OUTSIDE`` and the caller's guard keeps
    the check from doubling a report.

    Parameters
    ----------
    epsg : int | None
        The declared horizontal EPSG code.
    x, y : float | None
        The projected coordinate in the system's units.
    prefix : str, optional
        Source identifier prepended to the message (e.g. ``"DOV boring
        'GEO-25/001-B1'"``). Empty for the GEF path, which needs none.

    Returns
    -------
    ValidationIssue | None
        A WARNING ``COORDINATES_OUTSIDE_CRS_BOUNDS`` issue when the coordinate
        is ``OUTSIDE`` the declared area; ``None`` when it is ``INSIDE`` or the
        system is ``UNKNOWN``.
    """
    if classify_coordinates(epsg, x, y) != CrsBoundsResult.OUTSIDE:
        return None

    label = horizontal_crs_label(epsg)
    body = (
        f"coordinates ({x:.0f}, {y:.0f}) fall outside the area covered by {label} — "
        "check for a swapped X/Y, a wrong coordinate system, or a foreign position"
    )
    message = f"{prefix}: {body}" if prefix else body
    return ValidationIssue(
        level=ValidationLevel.WARNING,
        code=COORDINATES_OUTSIDE_CRS_BOUNDS_CODE,
        message=message,
    )
