"""Pure domain helper — compute the dip-extrapolation endpoint for a
body's terminal wedge.

Given a body framed by two contacts (``above`` + ``below``) on a source
investigation, plus a neighbour investigation's surface elevation, this
helper projects the body's mid-line outward at its current dip until it
intersects the neighbour's elevation column. The resulting
``(along, elevation)`` is where the rendered wedge tapers to.

Returns ``None`` for degenerate geometry (collinear source contacts;
neighbour at the same along as the source; missing neighbour elevation).

NOTE: a separate helper (``pinch_out_geometry.compute_pinch_tip``) does
a related but distinct calculation — that one finds where a formation
top crosses a deeper formation surface (polyline-vs-polyline). The two
helpers have different signatures because they answer different
questions; slice 8 may consolidate if reuse becomes worthwhile.
"""

from __future__ import annotations


def compute_dip_extrapolation_endpoint(
    *,
    source_above_along: float,
    source_above_elevation: float,
    source_below_along: float,
    source_below_elevation: float,
    neighbour_along: float,
    neighbour_surface_elevation: float | None,
) -> tuple[float, float] | None:
    """Project the body's mid-line outward at the source's dip rate.

    Parameters
    ----------
    source_above_along : float
        The along-section position of the body's upper boundary on the
        source investigation.
    source_above_elevation : float
        The elevation of the body's upper boundary on the source
        investigation.
    source_below_along : float
        The along-section position of the body's lower boundary on the
        source investigation. For a single-investigation body these
        typically share ``source_above_along``.
    source_below_elevation : float
        The elevation of the body's lower boundary on the source
        investigation.
    neighbour_along : float
        The along-section position of the neighbour investigation we are
        extrapolating toward.
    neighbour_surface_elevation : float | None
        The neighbour's surface elevation at its along position.
        Required to constrain the projection's vertical landing.

    Returns
    -------
    tuple[float, float] | None
        ``(along, elevation)`` of the projected endpoint, or ``None`` if
        the geometry is degenerate.
    """
    if neighbour_surface_elevation is None:
        return None

    if abs(neighbour_along - source_above_along) < 1e-9:
        # No horizontal extrapolation distance → endpoint coincides with
        # source, which renders as a degenerate wedge. Bail.
        return None

    thickness = abs(source_above_elevation - source_below_elevation)
    if thickness < 1e-9:
        # Collinear source contacts — dip direction is undefined.
        return None

    # Body's mid-elevation on the source investigation.
    mid_source_elev = (source_above_elevation + source_below_elevation) / 2.0

    # v1 simplification: linear horizontal projection — body's mid-line
    # is carried at constant elevation to the neighbour's along. Slice
    # 8 / Phase 5 can refine to true dip-from-cross-section once
    # multi-section dip data is wired in.
    return (neighbour_along, mid_source_elev)
