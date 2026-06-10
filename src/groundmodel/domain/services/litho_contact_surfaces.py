"""Fit each litho contact ONCE and share it between the bodies above and below.

The litho column is gap-free (base of layer i == top of layer i+1), so at each
investigation the interface between the body directly above and directly below is
a single elevation. This module reconstructs those interfaces from the builder's
flat ``BodyLayerPick`` list, groups them into *patches* (a maximal set of holes
where the SAME ordered body pair is adjacent), and fits one TIN per patch — the
shared surface the assembler hands to both adjacent bodies. Pure: no I/O.
"""

from __future__ import annotations

from dataclasses import dataclass

from groundmodel.domain.services.litho_solid_builder import BodyLayerPick


@dataclass(frozen=True)
class LayerSpan:
    """One body's occupancy at one investigation, in absolute elevation.

    Parameters
    ----------
    body_id : str
        The body occupying this span.
    formation_id : str
        The body's lithology formation id.
    top_elev : float
        Span top elevation (shallower, larger value).
    base_elev : float
        Span base elevation (deeper, smaller value).
    """

    body_id: str
    formation_id: str
    top_elev: float
    base_elev: float


def build_columns(
    picks: list[BodyLayerPick],
) -> tuple[dict[str, list[LayerSpan]], dict[str, tuple[float, float]]]:
    """Reconstruct each investigation's litho column from flat picks.

    Parameters
    ----------
    picks : list[BodyLayerPick]
        All picks across the model (any order).

    Returns
    -------
    tuple[dict[str, list[LayerSpan]], dict[str, tuple[float, float]]]
        ``(columns, coords)`` where ``columns[inv]`` is the investigation's
        spans ordered shallowest-first and ``coords[inv]`` is its ``(x, y)``.
    """
    columns: dict[str, list[LayerSpan]] = {}
    coords: dict[str, tuple[float, float]] = {}
    for p in picks:
        coords[p.investigation_id] = (p.x_m, p.y_m)
        columns.setdefault(p.investigation_id, []).append(
            LayerSpan(
                body_id=p.body_id,
                formation_id=p.formation_id,
                top_elev=p.surface_elev_m - p.top_depth_m,
                base_elev=p.surface_elev_m - p.base_depth_m,
            )
        )
    for inv in columns:
        # Sort shallowest-first: shallower spans have a larger top_elev value
        columns[inv].sort(key=lambda s: s.top_elev, reverse=True)
    return columns, coords


@dataclass(frozen=True)
class ContactKey:
    """Ordered identity of a contact patch.

    Parameters
    ----------
    upper_body : str
        Body directly above the contact, or ``""`` for the free ground surface.
    lower_body : str
        Body directly below the contact, or ``""`` for the free model base.
    """

    upper_body: str
    lower_body: str


@dataclass(frozen=True)
class ContactPoint:
    """One contact observation at one investigation.

    Parameters
    ----------
    inv_id : str
        Investigation id.
    x : float
        World x.
    y : float
        World y.
    elev : float
        Contact elevation (mTAW).
    """

    inv_id: str
    x: float
    y: float
    elev: float


def enumerate_contacts(
    columns: dict[str, list[LayerSpan]],
    coords: dict[str, tuple[float, float]],
) -> dict[ContactKey, list[ContactPoint]]:
    """Group every contact observation by its ordered ``(upper, lower)`` pair.

    Parameters
    ----------
    columns : dict[str, list[LayerSpan]]
        Per-investigation spans, shallowest-first (from :func:`build_columns`).
    coords : dict[str, tuple[float, float]]
        Per-investigation ``(x, y)``.

    Returns
    -------
    dict[ContactKey, list[ContactPoint]]
        Contact points per ordered body pair. Includes the free ground surface
        (``upper=""``) and free model base (``lower=""``) of every column.
    """
    out: dict[ContactKey, list[ContactPoint]] = {}

    def add(key: ContactKey, inv: str, elev: float) -> None:
        x, y = coords[inv]
        out.setdefault(key, []).append(ContactPoint(inv, x, y, elev))

    for inv, spans in columns.items():
        if not spans:
            continue
        add(ContactKey("", spans[0].body_id), inv, spans[0].top_elev)  # ground
        for upper, lower in zip(spans, spans[1:]):
            add(ContactKey(upper.body_id, lower.body_id), inv, upper.base_elev)
        add(ContactKey(spans[-1].body_id, ""), inv, spans[-1].base_elev)  # base
    return out
