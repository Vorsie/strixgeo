"""A curved (TIN) geological band-surface bound — ``SurfaceBound``.

Frozen value object wrapping a triangulated geological band surface, answering
"what is the bounding elevation at this (x, y)" queries.  Consumed by the voxel
litho builder (``voxel_litho/``) to bound the labelled voxel grid by the parent
geological model's band surfaces, and loaded from the DB by
:func:`~groundmodel.application.load_geo_surfaces.load_geo_surfaces`.

Pure data + geometry — no I/O, no logging, no framework dependencies.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.domain.services.tin_surface import evaluate_tin_at, nearest_vertex_elevation
from groundmodel.domain.value_objects.tin_surface import TinSurface


@dataclass(frozen=True)
class SurfaceBound:
    """A curved (TIN) bound — a geological band surface.

    Wraps a triangulated surface's mesh and answers "what is the bounding
    elevation at this (x, y)" queries.  Used as a curved top or base so a
    build is confined to a single geological band: the geological surfaces
    are the band's HARD top/base (owner directive 2026-06-11: "geology
    prevails — litho interfingers ONLY within each geological unit").

    This carries its mesh as ``list`` fields, so it is NOT hashable and its
    lists are mutable — treat it as a frozen *handle* to mesh data, not a
    value key.  The lists mirror the
    :class:`~groundmodel.domain.value_objects.tin_surface.TinSurface`
    convention so a band surface can be lifted straight from a cached
    formation-surface TIN.

    Parameters
    ----------
    vertices : list of (float, float, float)
        ``(x_m, y_m, elevation_m)`` triples in project CRS + vertical datum.
    triangles : list of (int, int, int)
        Vertex-index triples (one Delaunay cell each).

    Notes
    -----
    :meth:`evaluate` samples via
    :func:`~groundmodel.domain.services.tin_surface.evaluate_tin_at`; a point
    outside the TIN footprint falls back to the nearest vertex's elevation,
    matching the band-assignment convention in
    ``scripts/eval_geo_bounded_cycles.py``.
    """

    vertices: list[tuple[float, float, float]]
    triangles: list[tuple[int, int, int]]
    #: Prebuilt TIN view over the mesh lists, set once in __post_init__ /
    #: from_tin (init=False so it is not a constructor argument or value key).
    _tin: TinSurface = field(init=False, repr=False, compare=False)

    @classmethod
    def from_tin(cls, tin: TinSurface) -> SurfaceBound:
        """Lift a cached formation-surface :class:`TinSurface` into a bound.

        The parent geological model's formation-surface TINs are lifted into
        :class:`SurfaceBound` band surfaces; this classmethod is the single
        place that unpacks ``tin.vertices`` / ``tin.triangles`` so no caller
        has to.

        Parameters
        ----------
        tin : TinSurface
            The cached interpolated surface to wrap.

        Returns
        -------
        SurfaceBound
            A bound over the same mesh lists (the prebuilt ``tin`` is reused
            as the evaluation surface — no copy, no re-triangulation).
        """
        bound = cls(vertices=tin.vertices, triangles=tin.triangles)
        # Reuse the caller's prebuilt TIN directly (identical mesh) instead of
        # keeping the equivalent one __post_init__ already built.
        object.__setattr__(bound, "_tin", tin)
        return bound

    def __post_init__(self) -> None:
        """Build the :class:`TinSurface` view ONCE so :meth:`evaluate` reuses it.

        The frozen dataclass stores the prebuilt TIN in a private ``_tin``
        field via ``object.__setattr__`` (the only way to mutate a frozen
        instance).  Before this cache, ``evaluate`` rebuilt a new
        ``TinSurface`` on every call — wasteful in the band-assignment hot
        loop where every surface is sampled per investigation.
        """
        object.__setattr__(
            self,
            "_tin",
            TinSurface(vertices=self.vertices, triangles=self.triangles),
        )

    def evaluate(self, x: float, y: float) -> float:
        """Return the bounding elevation at horizontal point ``(x, y)``.

        Parameters
        ----------
        x : float
            Easting in metres (project CRS).
        y : float
            Northing in metres (project CRS).

        Returns
        -------
        float
            Interpolated elevation inside the TIN footprint; the nearest
            vertex's elevation when ``(x, y)`` falls outside every triangle
            (or the surface has no triangles).

        Raises
        ------
        ValueError
            If the surface has no vertices (cannot supply a fallback).
        """
        # Reuse the TinSurface view built once in __post_init__ / from_tin so
        # the established barycentric interpolation is not re-derived per call.
        elevation = evaluate_tin_at(self._tin, x, y)
        if elevation is not None:
            return elevation
        if not self.vertices:
            raise ValueError("SurfaceBound has no vertices to sample")
        # Off-footprint: nearest-vertex elevation (shared fallback helper).
        # Matches eval_geo_bounded_cycles.band_index.
        return nearest_vertex_elevation(self.vertices, x, y)
