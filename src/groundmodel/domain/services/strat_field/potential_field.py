"""Stage 3 of the implicit stratigraphic field builder: the potential-field interpolation.

This module fits a single smooth scalar field ``F(x, y, z)`` through the Stage-2
control data so that each litho contact is an isosurface ``F = c_i`` (the
horizon's iso-value).  The field is the heart of the implicit builder: Stage 4
extracts each contact surface as a single shared isosurface of ``F``, and the
monotonic stacking of the iso-values means the surfaces are nested (no crossing,
no double walls) wherever the field is monotone down the column.

This module is purely functional compute — no I/O, no logging, no framework
dependencies.  It depends only on NumPy + SciPy's ``RBFInterpolator``.

Method (and why it is what it is)
---------------------------------
The field is a **cubic polyharmonic radial-basis interpolation** of the
on-contact control points: each contact pick contributes one equipotential
constraint ``F(x_i, y_i, z_i) = iso_value_i``.  ``cubic`` (phi(r) = r^3) is the
3D analogue of the 2D thin-plate spline the spec mentions and the standard kernel
for 3D implicit geological modelling; it runs with NO polynomial tail
(``degree = -1``), which keeps the solve well-posed even when the boreholes are
collinear in map view (a single cross-section line) — the case where a
thin-plate-spline's mandatory linear polynomial tail would be singular.

Coordinate normalisation — why the RBF is NOT fit on raw metres
---------------------------------------------------------------
On a real BE/NL project the control points sit at Lambert-72 magnitude
(x ≈ 150 000 m, y ≈ 200 000 m) with internal contacts only a few metres deep,
and boreholes are 100–200 m apart.  Fitting the cubic kernel directly on those
raw metres makes the field's magnitude grow with the project SPAN and EXPLODE
between widely-spaced holes (Task-8 integration measured ~190 000 — orders of
magnitude above the iso range), producing ZERO usable bodies.  So
:func:`fit_potential_field` NORMALISES the control coordinates to ~``[-1, 1]``
before fitting (centre at the centroid, divide all three axes by one
characteristic length — ISOTROPIC, so the x:y:z aspect ratio and therefore the
dip are preserved and collinear data degenerates gracefully), stores the
transform on the :class:`PotentialField`, and applies the SAME transform to query
points inside :meth:`PotentialField.evaluate` before calling the RBF.  The
iso-VALUES (the fit targets) are NOT scaled — only the spatial coordinates — so
the field still reproduces ``F = iso(rank)`` at each contact.  See
``potential_field_constants`` (``RBF_NORMALIZE``) for the isotropic-vs-anisotropic
decision and the collinear-explosion evidence.

Monotonicity — what holds and what does NOT
-------------------------------------------
The Stage-4 gate requires ``F`` to be non-decreasing DOWN every borehole and to
cross each ``c_i`` at the observed contact depth.  At the control depths
themselves the field equals the (rank-ordered, increasing) iso-values by
construction, so it crosses each contact correctly.  Strict *per-sample*
monotonicity BETWEEN and just below those control depths is, however, NOT
guaranteed by a scattered-data RBF: a steeper-dipping neighbour can pull the
field down enough to create a local vertical reversal.

An explicit vertical-drift term ``-k*z`` was investigated as a monotonicity
mechanism (per the spec's recommendation) and proven algebraically ineffective
with scipy's interpolating RBF (it cancels into the fit and does not constrain
the local vertical gradient — see ``potential_field_constants`` for the full
finding).  The only lever that measurably helps is the RBF ``smoothing``
(regularisation), applied here as a small mitigation.  This is documented as a
known limitation (DONE_WITH_CONCERNS): on the benign collinear fixtures the gate
passes cleanly; on steep / very sparse real data the field can still bubble
locally, and a future hard guarantee needs a genuine monotone formulation
(Lajaunie co-kriging with gradient covariances, or per-(x,y) monotone
reconstruction).

Blocks (v1: exactly one)
------------------------
The interface takes ``blocks: Sequence[Block]`` so that faulted models can later
fit one field per block.  v1 always passes a single whole-domain block; the field
masks its control points to the block and fits once.  Multi-block concatenation is
deliberately NOT implemented yet (YAGNI) — the class is structured so it drops in
later (one fitted RBF per block, dispatched by point-in-block at evaluate time).
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

# reason: scipy ships no type stubs; the rest of the domain (iso_surface,
# body_assembly, model_domain) uses the same narrow per-import ignore.
from scipy.interpolate import RBFInterpolator  # type: ignore[import-untyped]

from groundmodel.domain.services.strat_field.potential_field_constants import (
    RBF_DEGREE,
    RBF_KERNEL,
    RBF_NORMALIZE,
    RBF_SMOOTHING,
)
from groundmodel.domain.services.strat_field.strat_types import (
    Block,
    StratControlData,
)


class PotentialField:
    """A fitted implicit scalar field ``F(x, y, z)`` whose isosurfaces are the contacts.

    Wraps the SciPy RBF interpolator fit to the on-contact iso-values plus the
    block the field was fit on.  It is a domain object that holds a fitted model
    — NOT a frozen value object — so it is a plain class.  It performs I/O-free
    compute only.

    Construct via :func:`fit_potential_field`, not directly; the constructor
    takes the already-fitted interpolator AND the coordinate-normalisation
    transform (centre + scale) that was applied to the control points before the
    fit, so :meth:`evaluate` can map query points into the SAME normalised space.

    Parameters
    ----------
    interpolator : scipy.interpolate.RBFInterpolator
        The RBF fit to the on-contact iso-values at the NORMALISED control
        points.  Evaluated at normalised ``(x, y, z)`` to give ``F(x, y, z)``.
    block : Block
        The spatial block this field was fit on (v1: the whole domain).
    center : numpy.ndarray
        The 3-element ``(cx, cy, cz)`` translation subtracted from every
        coordinate before scaling (the control-point centroid).  Single source of
        truth for the transform, shared between fit and evaluate.
    scale : float
        The single characteristic length every coordinate axis is divided by
        after centring (isotropic — the max per-axis half-extent of the control
        points).  Always strictly positive.
    """

    def __init__(
        self,
        interpolator: RBFInterpolator,
        block: Block,
        center: np.ndarray,
        scale: float,
    ) -> None:
        self._interpolator = interpolator
        self._block = block
        # The fitted transform.  Stored so evaluate() maps query points into the
        # exact normalised space the RBF was fit in — a single source of truth.
        self._center = np.asarray(center, dtype=float).reshape(3)
        self._scale = float(scale)

    @property
    def block(self) -> Block:
        """Block: The spatial block this field was fit on."""
        return self._block

    def _normalize(self, points: np.ndarray) -> np.ndarray:
        """Map raw ``(N, 3)`` coordinates into the fitted normalised space.

        Applies the exact transform used at fit time —
        ``(point - center) / scale`` — so the RBF is always queried in the
        same coordinate frame it was solved in.  This is the single point where
        the stored transform is consumed at evaluate time.

        Parameters
        ----------
        points : numpy.ndarray
            An ``(N, 3)`` array of raw ``(x, y, z)`` coordinates in project CRS +
            vertical datum.

        Returns
        -------
        numpy.ndarray
            The same array centred and isotropically scaled to ~``[-1, 1]``.
        """
        normalized: np.ndarray = (points - self._center) / self._scale
        return normalized

    def evaluate(self, xyz: Sequence[tuple[float, float, float]]) -> np.ndarray:
        """Evaluate the potential field at a batch of points.

        Computes ``F(x, y, z)`` vectorised over all query points by evaluating
        the fitted RBF.

        Parameters
        ----------
        xyz : Sequence of (float, float, float)
            Query points as ``(x, y, z)`` triples in project CRS + vertical
            datum (z positive-up).  May be empty.

        Returns
        -------
        numpy.ndarray
            A 1-D float ndarray of length ``len(xyz)``: the field value ``F`` at
            each query point.  Returns an empty float array for empty input.

        Notes
        -----
        Points OUTSIDE the fit block are not checked; the RBF extrapolates them
        (no error, no NaN).  Stage 4 only samples the field on a grid inside the
        block, so this is safe; callers querying arbitrary points should clamp to
        :attr:`block` themselves if extrapolation is undesirable.
        """
        points = np.asarray(xyz, dtype=float)
        if points.size == 0:
            return np.empty((0,), dtype=float)
        # Reshape guards a single (x, y, z) passed without an outer sequence.
        points = points.reshape(-1, 3)
        # Map query points into the SAME normalised space the RBF was fit in
        # (the coordinate-spread fix); the interpolator never sees raw metres.
        field = self._interpolator(self._normalize(points))
        return np.asarray(field, dtype=float).ravel()


def fit_potential_field(
    control: StratControlData,
    blocks: Sequence[Block],
) -> PotentialField:
    """Fit the implicit potential field through the Stage-2 control data.

    Builds ``F(x, y, z)`` as a cubic-polyharmonic RBF interpolation of the
    on-contact iso-values: each contact pick is an equipotential constraint
    ``F(x_i, y_i, z_i) = iso_value(rank_i)``.

    Parameters
    ----------
    control : StratControlData
        The Stage-2 control data: contact points tagged with horizon rank, the
        orientation constraints (not used in v1 — see the module docstring on the
        abandoned drift term), and the stratigraphic column (provides each rank's
        iso-value).
    blocks : Sequence of Block
        The spatial blocks to fit over.  v1 requires EXACTLY ONE block (the whole
        domain); the parameter is plural so faulted multi-block models drop in
        later.  Control points are masked to the block before fitting.

    Returns
    -------
    PotentialField
        The fitted field, evaluable via :meth:`PotentialField.evaluate`.

    Raises
    ------
    ValueError
        If ``blocks`` does not contain exactly one block (v1 limitation), if the
        control data has no points to fit, or if no control point falls within
        the supplied block.
    """
    # v1 limitation: exactly one block.  The plural signature is forward-looking
    # (faults add blocks); building multi-block now would be speculative (YAGNI).
    if len(blocks) != 1:
        raise ValueError(f"v1 fit_potential_field requires exactly one block, got {len(blocks)}")
    block = blocks[0]

    points = control.points
    if not points:
        raise ValueError(
            "cannot fit a potential field with no control points "
            "(the stratigraphic column has no internal contacts)"
        )

    # Mask control points to the block.  v1 has one whole-domain block so the mask
    # keeps everything; the explicit mask is the seam multi-block fitting plugs
    # into later.
    masked = [p for p in points if _point_in_block(p.x, p.y, p.z, block)]
    if not masked:
        raise ValueError("no control points fall within the supplied block")

    xyz = np.array([(p.x, p.y, p.z) for p in masked], dtype=float)
    iso = np.array([control.column.iso_value(p.horizon_rank) for p in masked], dtype=float)

    # Normalise the control coordinates BEFORE fitting (the coordinate-spread
    # fix).  On raw Lambert-72 metres the cubic RBF magnitude grows with the
    # project span and explodes between widely-spaced holes; squeezing the cloud
    # to ~[-1, 1] keeps the field bounded and makes RBF_SMOOTHING a fixed fraction
    # of the problem scale.  Only the SPATIAL coordinates are scaled — the iso
    # targets are untouched, so the fit still passes through F = iso(rank).
    center, scale = _normalization_transform(xyz)
    xyz_fit = (xyz - center) / scale

    interpolator = RBFInterpolator(
        xyz_fit,
        iso,
        kernel=RBF_KERNEL,
        degree=RBF_DEGREE,
        smoothing=RBF_SMOOTHING,
    )

    return PotentialField(interpolator=interpolator, block=block, center=center, scale=scale)


def _normalization_transform(xyz: np.ndarray) -> tuple[np.ndarray, float]:
    """Derive the deterministic isotropic centre + scale for the control cloud.

    The centre is the control-point CENTROID (per-axis mean); the scale is ONE
    characteristic length — the maximum per-axis half-extent of the centred
    cloud — so dividing every axis by it brings the cloud into ~``[-1, 1]`` while
    PRESERVING the x:y:z aspect ratio (isotropic — no dip distortion).  See
    ``potential_field_constants.RBF_NORMALIZE`` for why isotropic is chosen over
    anisotropic (anisotropic explodes on collinear cross-section data).

    The result is fully deterministic (no random, no set ordering) so the build
    is reproducible — the checksum + bundle replay depend on it.

    Parameters
    ----------
    xyz : numpy.ndarray
        The ``(N, 3)`` raw control-point coordinates (at least one point).

    Returns
    -------
    (numpy.ndarray, float)
        ``(center, scale)``: a 3-element centroid and a strictly-positive scalar
        length.  When the cloud is a single point (or all coincident), the scale
        falls back to ``1.0`` so the transform stays well-defined (the degenerate
        no-spread case).

    Notes
    -----
    When ``RBF_NORMALIZE`` is ``False`` the identity transform (zero centre, unit
    scale) is returned, so the field is fit on raw coordinates — kept as an escape
    hatch for diagnostics, not used in production.
    """
    if not RBF_NORMALIZE:
        return np.zeros(3, dtype=float), 1.0
    center = xyz.mean(axis=0)
    # Max per-axis half-extent of the centred cloud — a SINGLE isotropic length.
    half_extent = float(np.max(np.abs(xyz - center)))
    # Degenerate guard: a single control point (or all coincident) has zero
    # extent; a unit scale keeps the transform finite and well-defined.
    scale = half_extent if half_extent > 0.0 else 1.0
    return center, scale


def _point_in_block(x: float, y: float, z: float, block: Block) -> bool:
    """Return whether ``(x, y, z)`` lies inside ``block``.

    Tests the z-range and the horizontal polygon (ray-casting / even-odd rule).
    The polygon is treated as closed (last vertex connects to first).

    Parameters
    ----------
    x, y, z : float
        The query point coordinates (project CRS + vertical datum).
    block : Block
        The prism to test against.

    Returns
    -------
    bool
        ``True`` if the point is within the block's z-range and horizontal
        polygon, ``False`` otherwise.
    """
    if not (block.z_min <= z <= block.z_max):
        return False
    return point_in_polygon(x, y, block.polygon)


def point_in_polygon(x: float, y: float, polygon: Sequence[tuple[float, float]]) -> bool:
    """Even-odd ray-casting point-in-polygon test.

    On-boundary behaviour is intentionally left undefined (the standard PIP
    convention): a point exactly on an edge may test either way and callers must
    not rely on it.  The strat-field callers mask control points against the
    whole-domain block, whose hull is built with a margin, so a control point
    never lands exactly on the boundary.

    Notes
    -----
    A distinct ``contains`` method on
    :class:`~groundmodel.domain.services.model_domain.ModelDomain` implements the
    same ray-cast using a strict ``<`` instead of ``<=`` on the crossing check —
    the boundary conventions intentionally differ, so the two are NOT unified.

    Parameters
    ----------
    x, y : float
        The query point.
    polygon : Sequence of (float, float)
        Polygon vertices; treated as closed (last connects to first).

    Returns
    -------
    bool
        ``True`` if the point is inside the polygon (boundary undefined).
    """
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        # Standard even-odd crossing test on the edge (j, i).
        if (yi > y) != (yj > y):
            x_cross = xi + (y - yi) / (yj - yi) * (xj - xi)
            if x <= x_cross:
                inside = not inside
        j = i
    return inside
