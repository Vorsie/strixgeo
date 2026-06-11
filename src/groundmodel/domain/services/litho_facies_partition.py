"""Label each investigation hole by the competitor body directly above/below the shared body.

This module extracts the per-hole labels that mark which competing body sits
immediately above or below a shared body at each investigation.  These labels are
the input to the facies-boundary subdivision step, which will divide the shared
body's footprint triangulation at midpoint (2-way) / circumcenter (3-way Voronoi)
boundaries into a shared-vertex planar partition.  That subdivision machinery lands
in later commits; only the label-extraction helpers are present here.  Pure: no I/O.
"""

from __future__ import annotations

from groundmodel.domain.services.litho_contact_surfaces import LayerSpan


def competitor_labels_above(body_id: str, columns: dict[str, list[LayerSpan]]) -> dict[str, str]:
    """Label each shared-body hole by the body directly ABOVE it there.

    Parameters
    ----------
    body_id : str
        The shared body whose footprint is being labelled.
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans, shallowest-first (largest ``top_elev`` first).

    Returns
    -------
    dict[str, str]
        ``inv_id -> upper_body_id`` for every hole where ``body_id`` has a body
        directly above it. Holes where it reaches the surface (nothing above) are
        omitted (no competitor there).

    Notes
    -----
    A body is assumed to occur at most once per investigation in the facies context.
    A body that appears both above and below a thin unit (same ``body_id`` bracketing
    a thin layer) is an enclosed-lens / matrix case handled by the lens path, not
    here.  If a body does occur more than once in a column the loop records each
    match in turn, so the **deepest** occurrence's upper neighbour is what survives
    in the output dict.
    """
    out: dict[str, str] = {}
    for inv, spans in columns.items():
        for i, s in enumerate(spans):
            if s.body_id == body_id and i > 0:
                out[inv] = spans[i - 1].body_id
    return out


def competitor_labels_below(body_id: str, columns: dict[str, list[LayerSpan]]) -> dict[str, str]:
    """Label each shared-body hole by the body directly BELOW it there.

    Mirror of :func:`competitor_labels_above`; omits holes where the body is the
    deepest (nothing below).

    Parameters
    ----------
    body_id : str
        The shared body whose footprint is being labelled.
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans, shallowest-first (largest ``top_elev`` first).

    Returns
    -------
    dict[str, str]
        ``inv_id -> lower_body_id`` for every hole where ``body_id`` has a body
        directly below it. Holes where the shared body is the deepest span are
        omitted (no competitor there).

    Notes
    -----
    Same single-occurrence assumption as :func:`competitor_labels_above`: a body
    that brackets a thin unit (same ``body_id`` above and below) is an enclosed-lens
    / matrix case, not a facies case.  When a body does appear more than once, the
    deepest occurrence's lower neighbour survives in the output dict.
    """
    out: dict[str, str] = {}
    for inv, spans in columns.items():
        for i, s in enumerate(spans):
            if s.body_id == body_id and i + 1 < len(spans):
                out[inv] = spans[i + 1].body_id
    return out


def circumcenter(
    a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]
) -> tuple[float, float]:
    """Return the triangle's circumcenter, clamped inside if it falls outside.

    The circumcenter is equidistant from all three vertices — the true Voronoi
    point — so the three perpendicular bisectors (each crossing its edge at the
    midpoint) meet there, consistent with the 2-way midpoint rule. For an obtuse
    triangle the circumcenter lies outside; we clamp it to the triangle via
    barycentric coordinates so the partition stays inside and non-overlapping.

    Parameters
    ----------
    a, b, c : tuple[float, float]
        Triangle vertices ``(x, y)``.

    Returns
    -------
    tuple[float, float]
        The (possibly clamped) junction point.
    """
    ax, ay = a
    bx, by = b
    cx, cy = c
    d = 2.0 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-12:  # degenerate / collinear -> centroid fallback
        # d = 4 × signed_area, so the threshold is ~signed_area < 2.5e-13 m²,
        # unreachable for real geotech coordinates (d is typically 1e3–1e10).
        return ((ax + bx + cx) / 3.0, (ay + by + cy) / 3.0)
    a2 = ax * ax + ay * ay
    b2 = bx * bx + by * by
    c2 = cx * cx + cy * cy
    ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    l1 = ((by - cy) * (ux - cx) + (cx - bx) * (uy - cy)) / det
    l2 = ((cy - ay) * (ux - cx) + (ax - cx) * (uy - cy)) / det
    l3 = 1.0 - l1 - l2
    if min(l1, l2, l3) >= 0.0:
        return (ux, uy)
    l1, l2, l3 = (max(0.0, l1), max(0.0, l2), max(0.0, l3))
    s = l1 + l2 + l3
    l1, l2, l3 = l1 / s, l2 / s, l3 / s
    return (l1 * ax + l2 * bx + l3 * cx, l1 * ay + l2 * by + l3 * cy)
