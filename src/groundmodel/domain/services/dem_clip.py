"""DEM clip rule — clamp TIN vertices to the ground surface.

Pure domain function.  No I/O, no DB, no framework dependencies.  The
caller (the application use case ``BuildGroundSurface``) samples the DEM
grid and passes the results here; this module only does arithmetic and
emits ``GapIssue`` records when data conflicts are detected.

Rule (per §11.3 of ``docs/geology-stage-architecture.md``)
----------------------------------------------------------
**No formation surface z may exceed the ground-surface z at the same (x, y).**

* Clamp applied at surface *build*, not only at render — each TIN vertex's
  z is replaced by ``min(vertex_z, dem_z)`` when a DEM sample is available.
* A contact whose surveyed top sits ABOVE the DEM is a data conflict: emit a
  ``GapIssue`` with ``kind="contact_above_dem"`` (record, don't raise —
  Data Integrity Rule §5).  The clamp still applies so the rendered model
  stays geologically valid.
* A vertex that lands on a DEM cell whose value is ``None`` (NoData —
  outside coverage, or a water body returning its surface rather than the
  bed) is similarly flagged: ``kind="dem_cell_low_confidence"``.  The vertex
  z is left unchanged in this case because we have no reliable clamp target.

The two ``GapIssue`` kinds reuse the existing domain value object rather than
introducing a new type — they carry geologically meaningful information and
the same API schema (``GapIssueResponse``) serialises them identically.

Unit-testable contract
----------------------
* Input: a ``TinSurface`` + a callable ``dem_z(x, y) -> float | None``
* Output: a clamped ``TinSurface`` + a list of ``GapIssue``

The callable is a thin adapter over ``DemZGrid.sample_at``; passing a
callable (not the grid object) keeps the domain pure — it never imports from
``infrastructure/``.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from groundmodel.domain.services.tin_surface import TinSurface
from groundmodel.domain.value_objects.gap_issue import GapIssue

# Kind constants — stable identifiers that the API schema and UI copy
# key off.  New kinds follow the same naming convention (snake_case).
KIND_CONTACT_ABOVE_DEM = "contact_above_dem"
KIND_DEM_CELL_LOW_CONFIDENCE = "dem_cell_low_confidence"


@dataclass(frozen=True)
class ClipResult:
    """Output of ``clip_tin_to_dem``.

    Attributes
    ----------
    surface : TinSurface
        The clamped TIN.  When no DEM data is available for a vertex the
        vertex is returned unchanged.  Triangle indices are unchanged.
    issues : list[GapIssue]
        Zero or more validation findings.  Empty list = clean clip.
    clamp_count : int
        Number of vertices that were actually lowered.
    """

    surface: TinSurface
    issues: list[GapIssue]
    clamp_count: int


def clip_tin_to_dem(
    surface: TinSurface,
    dem_sample: Callable[[float, float], float | None],
    *,
    formation_name: str = "",
) -> ClipResult:
    """Clamp every TIN vertex to the DEM elevation at the same (x, y).

    Parameters
    ----------
    surface : TinSurface
        The formation's un-clamped surface from Delaunay triangulation.
    dem_sample : Callable[[float, float], float | None]
        Function that accepts ``(x, y)`` in the project CRS and returns the
        DEM elevation in metres, or ``None`` when the cell is NoData /
        outside coverage.  Typically ``DemZGrid.sample_at`` — passed as a
        callable to keep this module import-free from infrastructure.
    formation_name : str, optional
        Human-readable name used in ``GapIssue.detail`` messages.  Empty
        string is fine for tests.

    Returns
    -------
    ClipResult
        Clamped surface + validation issues + clamp count.

    Notes
    -----
    * Vertices in a surface without triangles (degenerate TIN — fewer than
      3 non-collinear contacts) are still clamped.  The caller may render
      them as dots; the clamp ensures dots also honour the terrain.
    * Triangle indices are UNCHANGED — clamping only mutates z values,
      never removes vertices or reorders them.
    """
    if not surface.vertices:
        return ClipResult(surface=surface, issues=[], clamp_count=0)

    clamped_vertices: list[tuple[float, float, float]] = []
    issues: list[GapIssue] = []
    clamp_count = 0

    for x, y, z in surface.vertices:
        dem_z = dem_sample(x, y)

        if dem_z is None:
            # NoData cell — could be outside coverage or a water body.
            # Leave vertex z unchanged; flag as low-confidence.
            clamped_vertices.append((x, y, z))
            issues.append(
                GapIssue(
                    kind=KIND_DEM_CELL_LOW_CONFIDENCE,
                    detail=(
                        f"DEM cell at ({x:.1f}, {y:.1f}) is NoData — "
                        "may be outside coverage or over a water body "
                        f"(formation: {formation_name!r}). "
                        "Ground-surface clip not applied at this vertex."
                    ),
                    depth_m=None,
                )
            )
            continue

        if z > dem_z:
            # Formation top overshoots the terrain.  Clamp and flag.
            clamp_count += 1
            clamped_vertices.append((x, y, dem_z))
            if z - dem_z > 0.05:
                # Only emit a contact-above-DEM issue when the overshoot
                # is > 5 cm — rounding at the survey / model boundary means
                # tiny differences are expected and not actionable.
                issues.append(
                    GapIssue(
                        kind=KIND_CONTACT_ABOVE_DEM,
                        detail=(
                            f"Vertex at ({x:.1f}, {y:.1f}) z={z:.3f} m is "
                            f"{z - dem_z:.3f} m above DEM ({dem_z:.3f} m) — "
                            f"clamped to terrain (formation: {formation_name!r}). "
                            "Check contact elevation or DEM accuracy."
                        ),
                        depth_m=round(z - dem_z, 3),
                    )
                )
        else:
            clamped_vertices.append((x, y, z))

    clamped_surface = TinSurface(
        vertices=clamped_vertices,
        triangles=surface.triangles,
    )
    return ClipResult(
        surface=clamped_surface,
        issues=issues,
        clamp_count=clamp_count,
    )


def build_ground_surface_tin(
    dem_sample: Callable[[float, float], float | None],
    hull_points: list[tuple[float, float]],
    grid_spacing_m: float = 10.0,
) -> TinSurface:
    """Build a TIN surface representing the terrain over the model's hull.

    Samples the DEM on a regular grid over the axis-aligned bounding box of
    ``hull_points`` (the model's investigation locations), then triangulates
    the valid samples into a ``TinSurface``.  This TIN is rendered as the
    scene base in ``Geology3DViewer`` in place of the flat ellipsoid.

    The function is pure (callable-in / TinSurface-out) — no I/O.

    Parameters
    ----------
    dem_sample : Callable[[float, float], float | None]
        DEM sampler; same contract as in ``clip_tin_to_dem``.
    hull_points : list[tuple[float, float]]
        (x, y) locations of all investigations in the project.  Used to
        derive the bounding box to cover.
    grid_spacing_m : float, optional
        Spacing between sample grid nodes in metres, default 10 m.  Coarser
        than the DEM native resolution but fine enough for a visual terrain
        mesh at typical project extents (a few km²).  The caller may pass a
        tighter spacing for small projects.

    Returns
    -------
    TinSurface
        Terrain TIN from sampled DEM nodes.  May be empty (no triangles) if
        fewer than 3 valid DEM samples exist (e.g. project entirely outside
        coverage).

    Notes
    -----
    Uses ``compute_tin`` from ``tin_surface.py`` for the Delaunay step so the
    terrain TIN shares the same degenerate-input handling as formation TINs.
    """
    from groundmodel.domain.services.tin_surface import ContactPoint3D, compute_tin

    if not hull_points:
        return TinSurface(vertices=[], triangles=[])

    xs = [p[0] for p in hull_points]
    ys = [p[1] for p in hull_points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    # Extend the bbox by one grid step so the mesh covers all investigation
    # locations even when they sit exactly on the boundary.
    min_x -= grid_spacing_m
    min_y -= grid_spacing_m
    max_x += grid_spacing_m
    max_y += grid_spacing_m

    # Sample on a regular grid.
    contacts: list[ContactPoint3D] = []
    x = min_x
    idx = 0
    while x <= max_x + 1e-6:
        y = min_y
        while y <= max_y + 1e-6:
            z = dem_sample(x, y)
            if z is not None:
                contacts.append(
                    ContactPoint3D(
                        contact_id=f"_dem_{idx}",
                        x_m=x,
                        y_m=y,
                        elevation_m=z,
                    )
                )
                idx += 1
            y += grid_spacing_m
        x += grid_spacing_m

    return compute_tin(contacts)
