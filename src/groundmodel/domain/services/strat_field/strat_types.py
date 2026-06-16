"""Frozen value objects shared across all stages of the implicit stratigraphic builder.

These are pure data containers — no I/O, no logging, no framework dependencies.
All classes use ``@dataclass(frozen=True)`` so their fields cannot be rebound.
The tuple-only value objects (every class except :class:`ContactSurface`) are
therefore fully hashable and immutable.  :class:`ContactSurface` intentionally
carries its mesh as ``list`` fields — matching the established
:class:`~groundmodel.domain.value_objects.litho_body_mesh.LithoBodyMesh`
convention for large extracted geometry — so it is not hashable and its lists
are mutable; treat it as a frozen *handle* to mesh data, not a value key.

Notes
-----
The approved exception to "one class per file" applies here: all seven value
objects are grouped in this single module because they form a single cohesive
vocabulary (analogous to ``shared/exceptions.py``).  Constants (if needed
later) go in a sibling ``strat_constants.py``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from groundmodel.domain.services.tin_surface import evaluate_tin_at
from groundmodel.domain.value_objects.tin_surface import TinSurface


@dataclass(frozen=True)
class SurfaceBound:
    """A curved (TIN) bound for a :class:`Block` — a geological band surface.

    Wraps a triangulated surface's mesh and answers "what is the bounding
    elevation at this (x, y)" queries.  Used as a :class:`Block`'s curved top
    or base so the implicit field is confined to a single geological band:
    the geological surfaces are the band's HARD top/base (owner directive
    2026-06-11: "geology prevails — litho interfingers ONLY within each
    geological unit").

    Like :class:`ContactSurface`, this carries its mesh as ``list`` fields,
    so it is NOT hashable and its lists are mutable — treat it as a frozen
    *handle* to mesh data, not a value key.  The lists mirror the
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

        Stage 8 lifts the parent geological model's formation-surface TINs
        into :class:`SurfaceBound` band surfaces; this classmethod is the
        single place that unpacks ``tin.vertices`` / ``tin.triangles`` so no
        caller has to.

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
        # Off-footprint: nearest-vertex elevation (squared distance — no sqrt
        # needed for the arg-min).  Matches eval_geo_bounded_cycles.band_index.
        nearest = min(self.vertices, key=lambda v: (v[0] - x) ** 2 + (v[1] - y) ** 2)
        return nearest[2]


@dataclass(frozen=True)
class Horizon:
    """A single contact surface in the stratigraphic column.

    A horizon separates the formation directly above it from the formation
    directly below it.  The topmost horizon has ``above_formation=None``
    (it is the top surface of the uppermost unit); the bottommost has
    ``below_formation=None`` when the model is open at depth.

    Parameters
    ----------
    rank : int
        Zero-based position in the stratigraphic column from top to bottom.
        Rank 0 is the shallowest (youngest) contact surface.
    iso_value : float
        The scalar iso-value of this horizon in the potential field.
        Monotonically increasing with depth (rank 0 → smallest iso_value).
    above_formation : str or None
        ``formation_id`` of the unit ABOVE (younger / shallower) this horizon.
        ``None`` for the topmost horizon (no unit above it within the model).
    below_formation : str or None
        ``formation_id`` of the unit BELOW (older / deeper) this horizon.
        ``None`` for the bottommost horizon (open base).
    contact_ids : tuple of str
        Ordered sequence of ``formation_contact.id`` values on accepted
        lithostratigraphic contacts that constrain this horizon.  At least
        one entry is required for the horizon to be solvable.
    """

    rank: int
    iso_value: float
    above_formation: str | None
    below_formation: str | None
    contact_ids: tuple[str, ...]


@dataclass(frozen=True)
class StratColumn:
    """Ordered sequence of :class:`Horizon` objects defining the stratigraphic column.

    The horizons are ordered top-down (ascending rank).  The ordering is
    established by Stage 1 (topo-sort on the geological age / formation
    nesting) and is carried forward unchanged into every downstream stage.

    Parameters
    ----------
    horizons : tuple of Horizon
        All contact surfaces in the model, ordered by ascending ``rank``
        (rank 0 = shallowest).
    """

    horizons: tuple[Horizon, ...]

    def iso_value(self, rank: int) -> float:
        """Return the scalar iso-value of the horizon at ``rank``.

        The iso-value is the constant the potential field equals on that
        horizon's isosurface (``F = iso_value(rank)`` everywhere on the
        contact).  Stages 3–6 reference horizons by rank and need their
        iso-value to evaluate / extract the field; this accessor is the
        single source of truth for that lookup.

        Parameters
        ----------
        rank : int
            The :attr:`Horizon.rank` to look up.

        Returns
        -------
        float
            The :attr:`Horizon.iso_value` of the horizon whose ``rank``
            equals the argument.

        Raises
        ------
        ValueError
            If no horizon in the column has the requested ``rank``.
        """
        # Linear scan is the right trade-off: a typical column has < 20 horizons
        # and this is called once per control point at fit time.  A prebuilt dict
        # would need a non-frozen field or cached_property, both of which clash
        # with frozen=True — not worth it at this N.
        for horizon in self.horizons:
            if horizon.rank == rank:
                return horizon.iso_value
        raise ValueError(
            f"no horizon with rank {rank!r} in this StratColumn "
            f"(ranks present: {sorted(h.rank for h in self.horizons)!r})"
        )


@dataclass(frozen=True)
class ControlPoint:
    """A hard constraint: the scalar field must equal its horizon's iso-value here.

    Derived from an accepted lithostratigraphic contact at a specific
    investigation location.  Coordinates are in the project CRS
    (Lambert-72 eastings/northings for BE/NL projects) with elevation
    referenced to the project vertical datum (TAW / NAP).

    Parameters
    ----------
    x : float
        Easting in metres (project CRS).
    y : float
        Northing in metres (project CRS).
    z : float
        Elevation in metres (positive upward, project vertical datum).
    horizon_rank : int
        The :attr:`Horizon.rank` this point constrains.  The potential-field
        solver sets ``field(x, y, z) = iso_value_of_horizon[rank]``.
    """

    x: float
    y: float
    z: float
    horizon_rank: int


@dataclass(frozen=True)
class OrientationConstraint:
    """A soft gradient-direction constraint at a point in space.

    Encodes a local dip / strike measurement (e.g. from a borehole
    interpretation or a manually drawn contact attitude) as a unit-length
    gradient vector.  The solver penalises departures from this direction
    without hard-enforcing it.

    Parameters
    ----------
    x : float
        Easting in metres (project CRS).
    y : float
        Northing in metres (project CRS).
    z : float
        Elevation in metres (project vertical datum, positive upward).
    gx : float
        X-component of the gradient direction unit vector (∂field/∂x direction).
    gy : float
        Y-component of the gradient direction unit vector (∂field/∂y direction).
    gz : float
        Z-component of the gradient direction unit vector (∂field/∂z direction).
        Positive gz → field increases upward (horizon dips away from vertical).
    """

    x: float
    y: float
    z: float
    gx: float
    gy: float
    gz: float


@dataclass(frozen=True)
class StratControlData:
    """All control information for a single implicit field solve.

    Bundles control points, orientation constraints, and the stratigraphic
    column together so each solver stage receives a single, self-contained
    input object.

    Parameters
    ----------
    points : tuple of ControlPoint
        Hard-constraint locations, one per accepted contact pick.
    orientations : tuple of OrientationConstraint
        Soft gradient-direction constraints (may be empty when no attitude
        data is available).
    column : StratColumn
        The ordered stratigraphic column with iso-value assignments.
    """

    points: tuple[ControlPoint, ...]
    orientations: tuple[OrientationConstraint, ...]
    column: StratColumn


@dataclass(frozen=True)
class Block:
    """The spatial domain (a prism) in which the potential field is evaluated.

    Version 1: one block per model build = the alpha-hull prism of all
    investigation locations, extended vertically between ``z_min`` and
    ``z_max``.  Future versions may subdivide the model domain into
    geological sub-blocks (one per formation band from the geo-bounding step).

    Parameters
    ----------
    polygon : tuple of (float, float)
        Horizontal footprint as an (x, y) polygon in metres (project CRS).
        The polygon is closed implicitly (last vertex connects back to first).
        Must have at least 3 vertices.
    z_min : float
        Bottom elevation of the prism in metres (project vertical datum).
        Typically the deepest accepted pick minus a margin.  When
        ``base_surface`` is set this is the *flat fallback* for the outermost
        (open) deepest band only.
    z_max : float
        Top elevation of the prism in metres (project vertical datum).
        Typically the DEM surface elevation plus a margin.  When
        ``top_surface`` is set this is the *flat fallback* for the outermost
        (open) shallowest band only.
    top_surface : SurfaceBound or None, optional
        Curved top bound (the geological surface above the band).  ``None``
        (the default) → the flat ``z_max`` applies, preserving the v1
        single-block behaviour unchanged.  The shallowest geological band's
        top stays ``None`` (open above → DEM / ``z_max``).
    base_surface : SurfaceBound or None, optional
        Curved base bound (the geological surface below the band).  ``None``
        (the default) → the flat ``z_min`` applies.  The deepest geological
        band's base stays ``None`` (open below → ``z_min``).

    Notes
    -----
    Adjacent geological bands SHARE their dividing surface: the
    ``base_surface`` of band *k* and the ``top_surface`` of band *k+1* are the
    same geological surface, so the surface-bounded caps assembled in the
    per-band build loop stitch exactly.
    """

    polygon: tuple[tuple[float, float], ...]
    z_min: float
    z_max: float
    top_surface: SurfaceBound | None = None
    base_surface: SurfaceBound | None = None


@dataclass(frozen=True)
class ContactSurface:
    """A triangulated contact surface extracted from the potential field.

    The surface corresponds to a single :class:`Horizon` and is the output
    of the marching-cubes extraction step (Stage 4).  Vertices are in
    project CRS + vertical datum, matching the coordinate system of
    :class:`ControlPoint`.

    The winding order follows the outward-normal convention: normals point
    upward (from below_formation toward above_formation), consistent with
    the :class:`~groundmodel.domain.value_objects.litho_body_mesh.LithoBodyMesh`
    winding used by the existing loft builder.

    Parameters
    ----------
    horizon_rank : int
        The :attr:`Horizon.rank` this surface represents.
    vertices : list of (float, float, float)
        ``(x_m, y_m, elevation_m)`` triples in project CRS.
    triangles : list of (int, int, int)
        Vertex-index triples (outward-facing / upward-normal winding).
    """

    horizon_rank: int
    vertices: list[tuple[float, float, float]]
    triangles: list[tuple[int, int, int]]
