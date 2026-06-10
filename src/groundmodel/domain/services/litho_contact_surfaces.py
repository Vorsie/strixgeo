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
