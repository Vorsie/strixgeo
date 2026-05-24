"""Section-local wedge-tip geometry for litho lens pinch-outs (#101 Slice 2).

Pure 2D geometry — no I/O, no ORM, no logger.  Every function takes
plain sequences of numbers and returns a dataclass or raises a typed
exception.  The use-case layer (Slice 3) owns all side effects.

The algorithm computes where a pinching lithology's top surface meets
the underlying target lithology's top surface, using only the contacts
already projected onto the section line in (along_m, elevation_m) space.
This is the "section-local at mark-time" design locked in docs/debt.md
#101 — no TIN, no deferred resolve, no revisit after Build.

See ``lens_pinch_out_geometry_constants.py`` for tuning values.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from groundmodel.domain.services.lens_pinch_out_geometry_constants import (
    MIN_CONTACT_DELTA_ALONG_M,
    PARALLEL_GRADIENT_EPSILON,
)

# ---------------------------------------------------------------------------
# Public data types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LensPinchTip:
    """The computed wedge tip for one pinch-out side of a lens.

    All coordinates are in section-2D space: ``along_m`` is the scalar
    distance from the section start point, ``elevation_m`` is the
    vertical coordinate in project CRS (metres above datum).

    Parameters
    ----------
    along_m : float
        Scalar distance from the section start at which the wedge tip
        lands (metres along the section line).
    elevation_m : float
        Elevation of the wedge tip at ``along_m`` (metres above datum).
    """

    along_m: float
    elevation_m: float


class LensPinchGeometryError(Exception):
    """Raised when the wedge-tip geometry cannot be computed.

    Callers should present the message to the user verbatim — it is
    written to be actionable (e.g. "Add a contact closer to the absent
    column, or check that the target lithology is present on this
    section.").
    """


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _interp_elevation(polyline: list[tuple[float, float]], along_m: float) -> float | None:
    """Linearly interpolate ``elevation_m`` from a sorted polyline at ``along_m``.

    Parameters
    ----------
    polyline : list[tuple[float, float]]
        List of ``(along_m, elevation_m)`` points sorted ascending by ``along_m``.
    along_m : float
        The query position along the section line.

    Returns
    -------
    float or None
        Interpolated elevation, or ``None`` when ``along_m`` is outside
        the polyline's extent (extrapolation is not performed).
    """
    if not polyline:
        return None
    if len(polyline) == 1:
        # Single point: exact match only, no interpolation range.
        if math.isclose(polyline[0][0], along_m, abs_tol=1e-9):
            return polyline[0][1]
        return None

    # Walk segments — linear interpolation inside [first, last].
    for i in range(len(polyline) - 1):
        a0, e0 = polyline[i]
        a1, e1 = polyline[i + 1]
        if a0 <= along_m <= a1:
            if math.isclose(a0, a1, abs_tol=1e-12):
                return e0
            t = (along_m - a0) / (a1 - a0)
            return e0 + t * (e1 - e0)

    return None  # outside extent


def _gradient_from_two_points(
    p_near: tuple[float, float],
    p_far: tuple[float, float],
) -> float:
    """Compute the dip (Δelevation / Δalong) from two (along, elevation) points.

    The sign convention matches the standard section-2D slope: positive
    = rising to the right, negative = dipping to the right.

    Parameters
    ----------
    p_near : tuple[float, float]
        The contact closer to the absent column: ``(along_m, elevation_m)``.
    p_far : tuple[float, float]
        The contact further from the absent column: ``(along_m, elevation_m)``.

    Returns
    -------
    float
        Gradient in m/m.

    Raises
    ------
    LensPinchGeometryError
        When the two contacts are coincident (Δalong < MIN_CONTACT_DELTA_ALONG_M).
    """
    delta_along = p_near[0] - p_far[0]
    if abs(delta_along) < MIN_CONTACT_DELTA_ALONG_M:
        raise LensPinchGeometryError(
            "Two pinching contacts are coincident in along-section space "
            f"(Δalong = {abs(delta_along):.4f} m < {MIN_CONTACT_DELTA_ALONG_M} m). "
            "Check for duplicate contacts at the same anchor investigation."
        )
    return (p_near[1] - p_far[1]) / delta_along


def _target_gradient_at(
    target_pts: list[tuple[float, float]],
    along_m: float,
    direction: Literal["left", "right"],
) -> float:
    """Estimate the target polyline's local gradient near ``along_m``.

    Used as the single-contact fallback dip when the pinching side has
    only one contact: the pinching surface is assumed to roughly parallel
    the target surface (geologically reasonable — the pinching unit drapes
    over the underlying unit at a similar angle).

    Picks the target segment that brackets ``along_m`` on the correct
    side.  Falls back to the nearest endpoint segment when ``along_m``
    is outside the target's extent.

    Parameters
    ----------
    target_pts : list[tuple[float, float]]
        Target polyline points sorted ascending by along_m.
    along_m : float
        Section position of the absent column.
    direction : {'left', 'right'}
        Wedge approach direction (same as the outer call).

    Returns
    -------
    float
        Estimated gradient in m/m.

    Raises
    ------
    LensPinchGeometryError
        When the target polyline has fewer than 2 points (no segment to
        measure a gradient from).
    """
    if len(target_pts) < 2:
        raise LensPinchGeometryError(
            "Cannot estimate a fallback dip: the target lithology has "
            "fewer than 2 contacts on this section and no gradient is "
            "computable. Add a second target contact, or provide a pinching "
            "contact closer to the absent column."
        )

    # Find the bracketing segment.  If outside extent, use the nearest end segment.
    if along_m <= target_pts[0][0]:
        seg_a, seg_b = target_pts[0], target_pts[1]
    elif along_m >= target_pts[-1][0]:
        seg_a, seg_b = target_pts[-2], target_pts[-1]
    else:
        for i in range(len(target_pts) - 1):
            if target_pts[i][0] <= along_m <= target_pts[i + 1][0]:
                seg_a, seg_b = target_pts[i], target_pts[i + 1]
                break
        else:
            seg_a, seg_b = target_pts[-2], target_pts[-1]

    delta_along = seg_b[0] - seg_a[0]
    if abs(delta_along) < MIN_CONTACT_DELTA_ALONG_M:
        raise LensPinchGeometryError(
            "Target polyline has two coincident contacts — cannot estimate "
            "gradient for the single-contact fallback path."
        )
    return (seg_b[1] - seg_a[1]) / delta_along


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compute_lens_pinch_tip(
    *,
    pinching_polyline: Sequence[tuple[float, float]],
    target_polyline: Sequence[tuple[float, float]],
    absent_along_m: float,
    direction: Literal["left", "right"],
) -> LensPinchTip:
    """Compute where a pinching lithology's top wedges into a deeper target lithology.

    All geometry is 2D in section space: ``(along_m, elevation_m)`` where
    ``along_m`` is the scalar distance from the section start and
    ``elevation_m`` is the vertical coordinate in project CRS.

    The algorithm:

    1. Locate the two nearest present contacts on the pinching side
       (contacts whose ``along_m`` is on the opposite side of
       ``absent_along_m`` from the wedge direction).
    2. Compute the local dip of the pinching surface from those two contacts.
    3. Extrapolate a linear ray from the nearer contact toward ``absent_along_m``.
    4. Find where the ray intersects the target polyline (piecewise-linear)
       by solving the two-line system algebraically.
    5. Validate that the intersection lies between the ray origin and
       ``absent_along_m`` (wedge tip must be INSIDE the data bracket, not
       outside it).

    Single-contact fallback (corridor-edge case): when only one pinching
    contact is available on the relevant side, the dip is estimated from
    the target polyline's local gradient (the pinching surface roughly
    parallels the underlying formation — geologically defensible as a
    first approximation).

    Parameters
    ----------
    pinching_polyline : Sequence[tuple[float, float]]
        Present-column contacts for the pinching lithology on this section,
        each as ``(along_m, elevation_m)``, sorted ascending by ``along_m``.
        Must contain at least 1 point.
    target_polyline : Sequence[tuple[float, float]]
        Present-column contacts for the deeper target lithology (the
        underlying surface the pinching layer wedges into), each as
        ``(along_m, elevation_m)``, sorted ascending by ``along_m``.
        Must contain at least 2 points for interpolation.
    absent_along_m : float
        Section position (along_m) of the absent column — the scalar
        distance from the section start at which the investigation that
        lacks this lithology sits.
    direction : {'left', 'right'}
        Which side of ``absent_along_m`` the wedge approaches from.
        ``'right'`` means the wedge approaches from the LEFT (present contacts
        have ``along_m < absent_along_m``).
        ``'left'`` means the wedge approaches from the RIGHT (present contacts
        have ``along_m > absent_along_m``).
        Matches the convention used by ``ExtrapolatePinchOut``.

    Returns
    -------
    LensPinchTip
        The wedge tip in section-2D coordinates.

    Raises
    ------
    LensPinchGeometryError
        In any of the following situations:

        * ``pinching_polyline`` is empty.
        * ``target_polyline`` has fewer than 2 points (no interpolation possible).
        * No pinching contacts exist on the relevant side of ``absent_along_m``.
        * The dip extrapolation diverges from the target (lines parallel or moving apart).
        * The computed intersection lies past ``absent_along_m`` in the wrong direction
          (wedge body is wider than the absent column brackets it — geometry inconsistency).
        * Coincident pinching contacts (degenerate input).
    ValueError
        When ``direction`` is not ``'left'`` or ``'right'``.
    """
    if direction not in ("left", "right"):
        raise ValueError(f"direction must be 'left' or 'right', got {direction!r}")

    pinch_pts = sorted(pinching_polyline, key=lambda p: p[0])
    target_pts = sorted(target_polyline, key=lambda p: p[0])

    if not pinch_pts:
        raise LensPinchGeometryError(
            "pinching_polyline is empty — no contacts for the pinching "
            "lithology are present on this section."
        )
    if len(target_pts) < 2:
        raise LensPinchGeometryError(
            "Target lithology has no contacts on this section (need at least "
            "2 points for piecewise-linear interpolation). Seed the target "
            "lithology contacts before marking this unit as a lens."
        )

    # ------------------------------------------------------------------
    # 1. Select the two nearest contacts on the pinching side.
    #
    # Convention from the brief:
    #   direction='right' → wedge approaches from LEFT
    #                     → pinching contacts are LEFT of absent_along_m
    #                     → filter to along_m < absent_along_m
    #   direction='left'  → wedge approaches from RIGHT
    #                     → pinching contacts are RIGHT of absent_along_m
    #                     → filter to along_m > absent_along_m
    # ------------------------------------------------------------------
    if direction == "right":
        side_pts = [p for p in pinch_pts if p[0] < absent_along_m]
        # nearest two = rightmost (last two in ascending sort)
        side_pts_ordered = side_pts[-2:] if len(side_pts) >= 2 else side_pts
        # p_near is the one closest to absent_along_m
        if side_pts_ordered:
            p_near = side_pts_ordered[-1]
            p_far = side_pts_ordered[0] if len(side_pts_ordered) == 2 else None
        else:
            p_near = None
            p_far = None
    else:  # direction == "left"
        side_pts = [p for p in pinch_pts if p[0] > absent_along_m]
        # nearest two = leftmost (first two in ascending sort)
        side_pts_ordered = side_pts[:2] if len(side_pts) >= 2 else side_pts
        if side_pts_ordered:
            p_near = side_pts_ordered[0]
            p_far = side_pts_ordered[1] if len(side_pts_ordered) == 2 else None
        else:
            p_near = None
            p_far = None

    if p_near is None:
        raise LensPinchGeometryError(
            f"No pinching contacts found on the {'left' if direction == 'right' else 'right'} "
            f"side of the absent column at along_m={absent_along_m:.2f} m. "
            "The absent column must have at least one present contact on the "
            "approach side."
        )

    # ------------------------------------------------------------------
    # 2. Compute the local dip of the pinching surface.
    # ------------------------------------------------------------------
    if p_far is not None:
        # Happy path: two contacts → reliable dip.
        gradient = _gradient_from_two_points(p_near, p_far)
    else:
        # Single-contact fallback: use the target gradient at absent_along_m.
        # Geologically: the pinching surface roughly parallels the underlying
        # surface at the corridor edge.
        gradient = _target_gradient_at(target_pts, absent_along_m, direction)

    # ------------------------------------------------------------------
    # 3 & 4. Find where the extrapolated pinching ray meets the target.
    #
    # The pinching ray: elevation = p_near[1] + gradient * (along - p_near[0])
    # The target polyline: piecewise linear between target_pts.
    #
    # For each target segment (t_a, e_a) → (t_b, e_b), the intersection
    # with the ray is:
    #
    #   ray:    e = e_near + g * (a - a_near)
    #   target: e = e_a + s * (e_b - e_a)   where s = (a - t_a)/(t_b - t_a)
    #
    # Eliminating e and solving for a:
    #   e_near + g*(a - a_near) = e_a + [(a - t_a)/(t_b - t_a)]*(e_b - e_a)
    #
    # Let:
    #   g_target = (e_b - e_a) / (t_b - t_a)   (segment gradient)
    #   d_grad   = g - g_target                  (gradient difference)
    #
    # If d_grad ≈ 0: lines are parallel → no intersection in this segment.
    # Otherwise:
    #   a = a_near + (e_a + g_target*(a_near - t_a) - e_near) / d_grad
    # ------------------------------------------------------------------

    # Walk target segments in the direction of extrapolation (toward absent_along_m).
    if direction == "right":
        # Ray fires rightward from p_near toward larger along_m.
        segments = [
            (target_pts[i], target_pts[i + 1])
            for i in range(len(target_pts) - 1)
            if target_pts[i + 1][0] >= p_near[0]
        ]
    else:
        # Ray fires leftward from p_near toward smaller along_m.
        segments = [
            (target_pts[i], target_pts[i + 1])
            for i in range(len(target_pts) - 1)
            if target_pts[i][0] <= p_near[0]
        ]
        # Walk right-to-left.
        segments = list(reversed(segments))

    if not segments:
        raise LensPinchGeometryError(
            "The target lithology has no contacts in the extrapolation zone "
            f"(between along_m={p_near[0]:.2f} m and along_m={absent_along_m:.2f} m). "
            "Add target contacts in the corridor between the present and absent columns."
        )

    a_near, e_near = p_near

    for (t_a, e_a), (t_b, e_b) in segments:
        delta_t = t_b - t_a
        if abs(delta_t) < MIN_CONTACT_DELTA_ALONG_M:
            # Degenerate target segment — skip.
            continue
        g_target = (e_b - e_a) / delta_t
        d_grad = gradient - g_target

        if abs(d_grad) < PARALLEL_GRADIENT_EPSILON:
            # Parallel or near-parallel in this segment — no intersection.
            continue

        # Algebraic intersection:
        # a = a_near + (e_a + g_target*(a_near - t_a) - e_near) / d_grad
        numerator = e_a + g_target * (a_near - t_a) - e_near
        a_cross = a_near + numerator / d_grad

        # Intersection must lie within the target segment's along range.
        a_lo, a_hi = min(t_a, t_b), max(t_a, t_b)
        if not (a_lo - 1e-9 <= a_cross <= a_hi + 1e-9):
            continue

        # ------------------------------------------------------------------
        # 5. Validate direction and placement against absent_along_m.
        # ------------------------------------------------------------------
        if direction == "right" and a_cross < a_near - 1e-9:
            # Intersection is BEHIND the ray origin — wrong direction.
            continue
        if direction == "left" and a_cross > a_near + 1e-9:
            continue

        # The wedge tip must land BEFORE absent_along_m (the pinch-out
        # body is present between p_near and the tip, absent past it).
        if direction == "right" and a_cross > absent_along_m + 1e-9:
            raise LensPinchGeometryError(
                f"Wedge tip at along_m={a_cross:.2f} m would land PAST the absent "
                f"column at {absent_along_m:.2f} m. The lens body is wider than "
                "the declared absent column — check the absent-column assignment or "
                "add a present contact closer to the absent column."
            )
        if direction == "left" and a_cross < absent_along_m - 1e-9:
            raise LensPinchGeometryError(
                f"Wedge tip at along_m={a_cross:.2f} m would land PAST the absent "
                f"column at {absent_along_m:.2f} m. The lens body is wider than "
                "the declared absent column — check the absent-column assignment or "
                "add a present contact closer to the absent column."
            )

        # Interpolate elevation from the target polyline at the crossing.
        e_cross = e_a + g_target * (a_cross - t_a)
        return LensPinchTip(along_m=a_cross, elevation_m=e_cross)

    # Walked all segments without finding a crossing.
    raise LensPinchGeometryError(
        "The extrapolated pinching surface does not intersect the target "
        "lithology surface in the corridor between the present and absent "
        "columns. The two surfaces may be diverging (pinching formation is "
        "above the target at the absent column). "
        "Check the dip direction or add a contact closer to the absent column."
    )


def project_along_to_world(
    section_start: tuple[float, float],
    section_end: tuple[float, float],
    along_m: float,
) -> tuple[float, float]:
    """Project a scalar along-section distance back to world (x, y) coordinates.

    Computes the world-space position that is ``along_m`` metres from
    ``section_start`` along the straight line to ``section_end``.  Both
    inputs and the return value are in the project CRS (e.g. EPSG:31370
    Lambert72 in metres).

    Parameters
    ----------
    section_start : tuple[float, float]
        World (x, y) coordinates of the section start point.
    section_end : tuple[float, float]
        World (x, y) coordinates of the section end point.
    along_m : float
        Scalar distance from ``section_start`` along the section line
        (metres).  May be 0 (returns ``section_start``) or equal to the
        section length (returns ``section_end``).

    Returns
    -------
    tuple[float, float]
        World (x, y) coordinates of the projected point.

    Raises
    ------
    ValueError
        When ``section_start`` and ``section_end`` are coincident (zero-length
        section — cannot define a direction vector).
    """
    dx = section_end[0] - section_start[0]
    dy = section_end[1] - section_start[1]
    section_length = math.hypot(dx, dy)
    if section_length < 1e-9:
        raise ValueError(
            "section_start and section_end are coincident — cannot project "
            "along a zero-length section line."
        )
    # Unit direction vector along the section.
    ux = dx / section_length
    uy = dy / section_length
    return (
        section_start[0] + along_m * ux,
        section_start[1] + along_m * uy,
    )
