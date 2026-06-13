"""Frozen value objects shared across all stages of the implicit stratigraphic builder.

These are pure data containers — no I/O, no logging, no framework dependencies.
All classes use ``@dataclass(frozen=True)`` so they are hashable and
immutable by construction.

Notes
-----
The approved exception to "one class per file" applies here: all seven value
objects are grouped in this single module because they form a single cohesive
vocabulary (analogous to ``shared/exceptions.py``).  Constants (if needed
later) go in a sibling ``strat_constants.py``.
"""

from __future__ import annotations

from dataclasses import dataclass


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
        Typically the deepest accepted pick minus a margin.
    z_max : float
        Top elevation of the prism in metres (project vertical datum).
        Typically the DEM surface elevation plus a margin.
    """

    polygon: tuple[tuple[float, float], ...]
    z_min: float
    z_max: float


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
