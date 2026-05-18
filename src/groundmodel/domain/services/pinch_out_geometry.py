"""Pure geometry for the formation pinch-out extrapolation tool.

No I/O, no ORM, no logger — a pure function that is fully unit-testable
in isolation. The use case (``ExtrapolatePinchOut``) owns all side effects.
"""

from __future__ import annotations

from collections.abc import Sequence


def compute_pinch_tip(
    *,
    pinching_polyline: Sequence[tuple[float, float]],
    target_polyline: Sequence[tuple[float, float]],
    direction: str,
    dip_override_m_per_m: float | None = None,
) -> tuple[float, float] | None:
    """Find where a formation pinches out against a deeper formation.

    The pinching formation's top (``pinching_polyline``) is extrapolated
    linearly in ``direction`` using the dip of its last segment, until
    it meets the target formation's top (``target_polyline``). The
    crossing point is the geological pinch-out tip.

    Polylines are slices of cached TIN surfaces — sequences of
    ``(along_m, elevation_m)`` points sorted by ``along_m`` from the
    section's start.

    Parameters
    ----------
    pinching_polyline : Sequence[tuple[float, float]]
        The formation whose thickness shrinks to zero.
        Each tuple is ``(along_m, elevation_m)``.
    target_polyline : Sequence[tuple[float, float]]
        The deeper formation that the pinching formation wedges into.
        Each tuple is ``(along_m, elevation_m)``.
    direction : str
        ``"left"`` or ``"right"`` along the section (the side toward
        which the pinching formation is thinning).
    dip_override_m_per_m : float | None
        When provided, overrides the computed gradient from the
        pinching polyline's last segment. Useful when the polyline has
        only one point (no segment to derive a gradient from).

    Returns
    -------
    tuple[float, float] | None
        ``(along_m, elevation_m)`` of the extrapolated crossing.
        Returns ``None`` when:

        * The gradient is uncomputable (fewer than 2 points in
          ``pinching_polyline``) AND no ``dip_override_m_per_m``
          was given.
        * The extrapolated ray never crosses the target polyline
          (diverging surfaces — the pinching formation is ABOVE the
          target at the tip end, i.e. the two converge in the wrong
          direction, or the target polyline has no segment in the
          extrapolation zone).

    Raises
    ------
    ValueError
        When ``direction`` is not ``"left"`` or ``"right"``.

    Notes
    -----
    The algorithm is:

    1. Determine the ray origin and gradient from the last segment of
       ``pinching_polyline`` toward ``direction``.
    2. Extend the ray to the outermost ``along_m`` of ``target_polyline``
       in that direction.
    3. Linearly interpolate ``target_polyline`` at each candidate
       ``along_m`` value and find the first crossing (sign change in
       ``ray_elevation - target_elevation``).

    The ray is exact-linear (no curve fitting). The target is walked
    segment-by-segment so degenerate targets (single-point, empty)
    return ``None`` rather than raising.
    """
    if direction not in ("left", "right"):
        raise ValueError(f"direction must be 'left' or 'right', got {direction!r}")

    # ------------------------------------------------------------------ #
    # 1. Determine ray origin and gradient from the pinching polyline.    #
    # ------------------------------------------------------------------ #
    pinch_pts = list(pinching_polyline)
    target_pts = list(target_polyline)

    if len(pinch_pts) < 2:
        if dip_override_m_per_m is None:
            # Cannot derive a gradient and none was supplied.
            return None
        # Use the single point (or its first point) as the ray origin
        # with the override gradient.
        origin_along, origin_elev = pinch_pts[0] if pinch_pts else (0.0, 0.0)
        gradient = dip_override_m_per_m
    else:
        # Use the segment closest to the extrapolation direction.
        if direction == "right":
            # Pinching toward larger along_m — last two points.
            p0 = pinch_pts[-2]
            p1 = pinch_pts[-1]
        else:
            # Pinching toward smaller along_m — first two points.
            p0 = pinch_pts[1]
            p1 = pinch_pts[0]

        dalpha = p1[0] - p0[0]
        if dalpha == 0.0:
            # Vertical segment — use override or return None.
            if dip_override_m_per_m is None:
                return None
            gradient = dip_override_m_per_m
        else:
            gradient = (p1[1] - p0[1]) / dalpha
            if dip_override_m_per_m is not None:
                gradient = dip_override_m_per_m

        # Ray fires from the outermost point in the direction.
        origin_along, origin_elev = pinch_pts[-1] if direction == "right" else pinch_pts[0]

    # ------------------------------------------------------------------ #
    # 2. Walk target segments to find the first ray–target crossing.     #
    # ------------------------------------------------------------------ #
    if len(target_pts) < 2:
        # Target has no segment — cannot intersect.
        return None

    # Filter target segments to only those in the extrapolation zone:
    # to the right of origin or to the left of origin, depending on direction.
    if direction == "right":
        # Segments where at least one endpoint is to the right of origin.
        segments = [
            (target_pts[i], target_pts[i + 1])
            for i in range(len(target_pts) - 1)
            if target_pts[i + 1][0] >= origin_along
        ]
    else:
        # Segments where at least one endpoint is to the left of origin.
        segments = [
            (target_pts[i], target_pts[i + 1])
            for i in range(len(target_pts) - 1)
            if target_pts[i][0] <= origin_along
        ]

    if not segments:
        return None

    # For each target segment, check if the ray crosses it.
    # Ray elevation at along = origin_elev + gradient * (along - origin_along).
    # Target elevation at along (linear between the two endpoints).
    last_idx = len(segments) - 1
    for seg_idx, ((ta, te_a), (tb, te_b)) in enumerate(segments):
        # Evaluate ray and target at both endpoints.
        ray_a = origin_elev + gradient * (ta - origin_along)
        ray_b = origin_elev + gradient * (tb - origin_along)
        diff_a = ray_a - te_a
        diff_b = ray_b - te_b

        if diff_a == 0.0:
            # Exact hit at the left endpoint.
            return (ta, te_a)
        if diff_b == 0.0:
            # Exact hit at the right endpoint. Normally we defer to the
            # NEXT segment's left endpoint to avoid double-counting the
            # shared junction — but on the LAST segment there is no next
            # segment, so deferring would lose a geometrically valid
            # crossing (the engineer's outermost target contact sits
            # exactly at the pinch tip). Return it here, honouring the
            # direction constraint.
            if seg_idx == last_idx:
                if direction == "right" and tb >= origin_along:
                    return (tb, te_b)
                if direction == "left" and tb <= origin_along:
                    return (tb, te_b)
            continue
        if diff_a * diff_b > 0.0:
            # Same sign — no crossing in this segment.
            continue

        # Sign change: find the parametric crossing position.
        t = diff_a / (diff_a - diff_b)  # in (0, 1)
        cross_along = ta + t * (tb - ta)
        cross_elev_target = te_a + t * (te_b - te_a)

        # Confirm direction constraint: crossing must be on the correct
        # side of the ray origin (not behind it).
        if direction == "right" and cross_along < origin_along:
            continue
        if direction == "left" and cross_along > origin_along:
            continue

        return (cross_along, cross_elev_target)

    return None
