"""Lens-boundary geometry — pure domain helper (#163f Slice 2).

Turns a single lens boundary (upper or lower) — its hard anchor contacts plus
the user's interior control nodes — into the renderable polyline for a chosen
render style. Section-local coordinates ``(along_m, elevation_m)``.

No I/O, no ORM, no logging. The caller (a use case / API layer) loads the
anchors + nodes and persists; this module only computes geometry.

Render styles
-------------
``straight``
    Piecewise-linear polyline through the merged points, verbatim.
``blocky``
    Staircase: each segment gets a vertical step at its along-midpoint.
``rounded``
    Returns the merged points verbatim — the smooth curve is a *render* detail
    the frontend applies (Catmull-Rom), not a geometry detail, so the point
    list is identical to ``straight``.

See docs/superpowers/specs/2026-05-28-litho-suggestion-handles-and-lens-shaping-design.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

RenderStyle = Literal["straight", "blocky", "rounded"]


@dataclass(frozen=True)
class LensBoundaryNode:
    """One user-placed control node on a lens boundary (section-local).

    Attributes
    ----------
    along_m : float
        Distance along the section line, metres.
    elevation_m : float
        Absolute elevation (mTAW), metres.
    """

    along_m: float
    elevation_m: float


def _merge_points(
    anchor_contacts: list[tuple[float, float]],
    nodes: list[LensBoundaryNode],
) -> list[tuple[float, float]]:
    """Merge anchor endpoints + control nodes into one list sorted by along_m.

    Parameters
    ----------
    anchor_contacts : list[tuple[float, float]]
        Hard boundary endpoints ``(along_m, elevation_m)`` (e.g. the pinch
        point + the full-thickness contact).
    nodes : list[LensBoundaryNode]
        Interior control handles, any order.

    Returns
    -------
    list[tuple[float, float]]
        ``(along_m, elevation_m)`` points sorted ascending by ``along_m``.
    """
    merged = list(anchor_contacts) + [(n.along_m, n.elevation_m) for n in nodes]
    return sorted(merged, key=lambda p: p[0])


def _stepify(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Expand a polyline into a midpoint staircase (the ``blocky`` style).

    For each consecutive pair ``P_i, P_{i+1}`` a vertical step is inserted at
    the along-midpoint: ``P_i → (mid, e_i) → (mid, e_{i+1}) → P_{i+1}``.
    Shared vertices between segments are not duplicated.

    Parameters
    ----------
    points : list[tuple[float, float]]
        Sorted polyline points.

    Returns
    -------
    list[tuple[float, float]]
        The staircase polyline. A list of length < 2 is returned unchanged.
    """
    if len(points) < 2:
        return list(points)
    out: list[tuple[float, float]] = [points[0]]
    for (a0, e0), (a1, e1) in zip(points, points[1:]):
        mid = (a0 + a1) / 2.0
        out.append((mid, e0))
        out.append((mid, e1))
        out.append((a1, e1))
    return out


def compute_lens_boundary_polyline(
    *,
    anchor_contacts: list[tuple[float, float]],
    nodes: list[LensBoundaryNode],
    render_style: RenderStyle,
) -> list[tuple[float, float]]:
    """Compute the renderable polyline for one lens boundary.

    Parameters
    ----------
    anchor_contacts : list[tuple[float, float]]
        Hard boundary endpoints ``(along_m, elevation_m)`` — typically the
        pinch point and the full-thickness contact. At least one point.
    nodes : list[LensBoundaryNode]
        User control nodes (interior handles), any order.
    render_style : {'straight', 'blocky', 'rounded'}
        ``straight`` / ``rounded`` return the merged points verbatim (the
        rounded curve is applied frontend-side); ``blocky`` returns the
        midpoint staircase.

    Returns
    -------
    list[tuple[float, float]]
        Polyline points ``(along_m, elevation_m)`` ascending by ``along_m``.
    """
    merged = _merge_points(anchor_contacts, nodes)
    if render_style == "blocky":
        return _stepify(merged)
    return merged
