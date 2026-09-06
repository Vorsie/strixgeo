"""Section-line projection — backend mirror of the frontend's pure math.

The desktop renders sections by projecting each investigation onto
the section line in TypeScript (``utils/sectionProjection.ts``). For
server-side export work (DXF + future Plaxis-section) we need the
same math in Python so the backend doesn't have to receive pre-
projected coordinates from the frontend.

Two-method API mirrors the frontend exactly:

* ``project_point_onto_line`` — returns ``(along, offset)`` for one
  point or ``None`` when the section has zero length.
* ``section_length`` — Euclidean line length.

Conventions match the frontend exactly (same formula):

* ``along`` is the unit-vector dot product (positive when the point
  lies forward of the section's start along the line direction).
* ``offset`` is ``vx*uy - vy*ux`` — the 2D cross product of the
  point-from-start vector with the line's unit direction. The sign
  is consistent across the stack BY VIRTUE of using the same
  formula; what "left" vs "right" of the line means depends on the
  consumer's Y-axis convention (screen-Y-down on the frontend
  inverts the math-frame "left" / "right" labels for Lambert72
  world coords).
* The buffer filter only consults ``abs(offset)`` so callers don't
  need to reason about the sign — only the magnitude matters for
  inclusion / exclusion.

Coordinate system: section endpoints and investigation points are
both in the section's horizontal EPSG (Lambert 72 / RD New).
Distances are Euclidean in that CRS — fine because both supported
CRSes are conformal projections with negligible distortion at
typical site scale (<10 km).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Below this length the line is degenerate — caller should reject.
# Matches the frontend's 1e-9 threshold so cross-stack behaviour is
# identical for the same input.
_DEGENERATE_LENGTH_SQ = 1e-12

# Tolerance (metres) on the along-line span bounds in
# ``project_onto_section_corridor``. A test sitting EXACTLY at a section
# endpoint projects to along == 0 / along == length in exact math, but on real
# oblique coordinates the dot product and the sqrt round slightly differently,
# so the computed ``along`` can land ~1e-8 m outside [0, length]. A strict
# bound then drops the endpoint test — for a tie-section drawn through two
# tests that silently leaves it with one member ("Koppelprofiel 4 contains one
# test", owner ruling 2026-09-06). 1 micron is far above the float noise and
# far below any real "off the section" distance. Mirrors
# ``ENDPOINT_TOLERANCE_M`` in ``utils/sectionProjection.ts``.
_ENDPOINT_TOLERANCE_M = 1e-6


@dataclass(frozen=True)
class SectionEndpoints:
    """The four numbers needed to project against the section line."""

    start_x: float
    start_y: float
    end_x: float
    end_y: float


@dataclass(frozen=True)
class ProjectionResult:
    """Result of projecting one point onto a section line."""

    along: float
    """Distance along the line from start to projection foot, in metres."""

    offset: float
    """Signed perpendicular distance from the line, in metres.

    Positive = the point lies to the left of the line direction.
    """


def project_point_onto_line(
    section: SectionEndpoints, point_x: float, point_y: float
) -> ProjectionResult | None:
    """Project ``(point_x, point_y)`` onto the section line.

    Parameters
    ----------
    section : SectionEndpoints
        Section start + end in the section's CRS.
    point_x, point_y : float
        Point in the same CRS as ``section``.

    Returns
    -------
    ProjectionResult | None
        ``None`` when the section has zero length (defensive — the
        API rejects zero-length sections at create / update time).
    """
    dx = section.end_x - section.start_x
    dy = section.end_y - section.start_y
    length_sq = dx * dx + dy * dy
    if length_sq < _DEGENERATE_LENGTH_SQ:
        return None
    length = math.sqrt(length_sq)
    ux = dx / length
    uy = dy / length
    vx = point_x - section.start_x
    vy = point_y - section.start_y
    along = vx * ux + vy * uy
    # Signed offset: 2D cross product. Same sign convention as the
    # frontend — positive = left of the line direction.
    offset = vx * uy - vy * ux
    return ProjectionResult(along=along, offset=offset)


def section_length(section: SectionEndpoints) -> float:
    """Euclidean length of the section line in metres."""
    dx = section.end_x - section.start_x
    dy = section.end_y - section.start_y
    return math.sqrt(dx * dx + dy * dy)


def project_onto_section_corridor(
    section: SectionEndpoints,
    point_x: float,
    point_y: float,
    buffer_m: float,
) -> ProjectionResult | None:
    """Project a point and keep it only when it is ON the section.

    THE single definition of "this investigation is on this section": inside the
    lateral corridor AND between the two endpoints the engineer drew. Every
    backend consumer of that question must call this — a consumer that filters
    on lateral offset alone treats an investigation past the end of the line as
    one of the section's columns, so it can be auto-correlated or merged to a
    neighbour on a section where it is not drawn.

    Mirrors ``desktop/src/renderer/src/utils/sectionProjection.ts``
    (``investigationsOnSection``), which applies exactly these two filters to
    produce the columns the engineer sees.

    Parameters
    ----------
    section : SectionEndpoints
        Section start + end in the section's CRS.
    point_x, point_y : float
        Investigation location in the same CRS as ``section``.
    buffer_m : float
        Lateral corridor half-width in metres (``projection_buffer_m``).

    Returns
    -------
    ProjectionResult | None
        The projection when the point is on the section; ``None`` when the
        section is degenerate, the point projects off either end, or it lies
        further than ``buffer_m`` from the line.
    """
    res = project_point_onto_line(section, point_x, point_y)
    if res is None:
        return None
    # Inclusive of the endpoints, with a micron tolerance so a test sitting
    # exactly at an endpoint is not dropped by floating-point overshoot (see
    # ``_ENDPOINT_TOLERANCE_M``).
    if (
        res.along < -_ENDPOINT_TOLERANCE_M
        or res.along > section_length(section) + _ENDPOINT_TOLERANCE_M
    ):
        return None
    if abs(res.offset) > buffer_m:
        return None
    return res
