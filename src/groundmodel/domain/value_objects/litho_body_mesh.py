"""Value object: :class:`LithoBodyMesh` — closed 3-D mesh for one lithostratigraphic body."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LithoBodyMesh:
    """A body's watertight triangle mesh in project CRS + vertical datum.

    Parameters
    ----------
    body_id : str
        The ``body.id`` this mesh represents.
    formation_id : str
        The body's lithology formation id (drives colour).
    vertices : list[tuple[float, float, float]]
        ``(x_m, y_m, elevation_m)`` triples.
    triangles : list[tuple[int, int, int]]
        Vertex-index triples (outward-facing winding).
    is_flagged : bool
        ``True`` when the body could not form a real solid (<3 non-collinear
        control points) and was rendered as small disk markers (vertical
        cylinders at its investigations) — a unit with too little lateral
        spread to triangulate, surfaced as under-constrained in the UI.
        The mesh is non-empty: one closed cylinder per pick.
    """

    body_id: str
    formation_id: str
    vertices: list[tuple[float, float, float]]
    triangles: list[tuple[int, int, int]]
    is_flagged: bool
