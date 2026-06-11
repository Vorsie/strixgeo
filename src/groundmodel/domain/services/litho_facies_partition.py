"""Partition a shared body's footprint among the units competing above/below it.

Where different bodies occupy the space directly above (or below) one shared body
in different lateral regions, they must be divided by a facies boundary or they
overlap. This module labels the shared body's footprint by the competitor at each
hole and subdivides the footprint triangulation at midpoint (2-way) / circumcenter
(3-way Voronoi) boundaries into a shared-vertex planar partition. Pure: no I/O.
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
    """
    out: dict[str, str] = {}
    for inv, spans in columns.items():
        for i, s in enumerate(spans):
            if s.body_id == body_id and i + 1 < len(spans):
                out[inv] = spans[i + 1].body_id
    return out
