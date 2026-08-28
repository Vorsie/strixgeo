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

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from groundmodel.domain.services.dem_clip_constants import (
    KIND_CONTACT_ABOVE_DEM,
    KIND_DEM_CELL_LOW_CONFIDENCE,
)
from groundmodel.domain.services.tin_surface import ContactPoint3D, TinSurface, compute_tin
from groundmodel.domain.value_objects.gap_issue import GapIssue


@dataclass(frozen=True)
class GroundPoint:
    """One location whose ground elevation matters — an investigation collar.

    Attributes
    ----------
    label : str
        Human-readable investigation name, used verbatim in issue text so the
        user can find the test without looking up a UUID.
    x_m, y_m : float
        Location in the project's horizontal CRS (metres).
    surface_elevation_m : float | None
        The investigation's own surveyed collar elevation (m TAW), or ``None``
        when no Z was recorded for it.  When present it OUTRANKS the DEM at this
        location (owner ruling 2026-08-28).  ``0.0`` is a real surveyed value,
        distinct from ``None``.
    """

    label: str
    x_m: float
    y_m: float
    surface_elevation_m: float | None = None


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
    margin_m: float | None = None,
    *,
    surface_elevations: dict[tuple[float, float], float] | None = None,
) -> TinSurface:
    """Build a TIN surface representing the terrain over the model's hull.

    Samples the DEM on a regular grid over the axis-aligned bounding box of
    ``hull_points`` (the model's investigation locations) plus a margin, and
    ALSO at each investigation location itself, then triangulates the valid
    samples into a ``TinSurface``.  This TIN is rendered as the scene base in
    ``Geology3DViewer`` in place of the flat ellipsoid.

    Why the investigation locations are sampled on top of the grid: the
    surface exists so the user can read the vertical distance between the
    terrain and the interpreted model top AT A COLUMN.  A regular grid alone
    puts the nearest ground vertex up to half a grid step away, so the ground
    drawn directly above a test is an interpolation of its neighbours — on a
    1 m DEM with a 10 m grid a local dip or bund between nodes is averaged
    away, and the daylight the user reads is wrong by that amount.  Anchoring
    a vertex at each test makes the on-screen distance the measured one.

    The function is pure (callable-in / TinSurface-out) — no I/O.

    Parameters
    ----------
    dem_sample : Callable[[float, float], float | None]
        DEM sampler; same contract as in ``clip_tin_to_dem``.
    hull_points : list[tuple[float, float]]
        (x, y) locations of all investigations in the project.  Used both to
        derive the bounding box and as anchor vertices.
    grid_spacing_m : float, optional
        Spacing between sample grid nodes in metres, default 10 m.  Coarser
        than the DEM native resolution but fine enough for a visual terrain
        mesh at typical project extents (a few km²).  The caller may pass a
        tighter spacing for small projects.
    margin_m : float | None, optional
        How far the grid extends past the outermost investigation, in metres.
        ``None`` (default) keeps the historical behaviour of one grid step —
        just enough to cover a test sitting exactly on the boundary.  Callers
        that want the terrain to read as ground rather than as a slab pass
        ``GROUND_SURFACE_MARGIN_M``.
    surface_elevations : dict[tuple[float, float], float] | None, optional
        Surveyed collar elevation (m) keyed by investigation ``(x, y)``.  When
        a test's own location is present here, its anchor vertex is placed at
        the surveyed collar rather than at the DEM sample — the owner's ruling
        (2026-08-28): *"I trust surface elevation of a test more than a DEM we
        pulled off the web."*  The DEM stays the source for the ground BETWEEN
        tests (the regular grid).  A key is present ONLY when the test has a
        real elevation, so a collar of exactly ``0.0`` m TAW (ordinary on the
        Belgian coast) is a value that WINS over the DEM — it is not the same
        as an absent key, which falls back to the DEM.  ``None`` (default)
        keeps every anchor on the DEM.

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

    The investigation anchors are emitted BEFORE the regular grid, and a grid
    node that coincides with an anchor (to the millimetre) is skipped.  This
    ordering is what lets a surveyed collar win even for the tests that define
    the hull bounding box: the padding is a whole number of grid steps, so the
    min-x / min-y test lands exactly on a grid node — anchor-first-then-skip
    means its collar is the vertex there, not the DEM sample.  A surveyed
    collar likewise wins where the DEM is NoData at the test, so a test over
    water (a DEM hole) still contributes a real ground vertex.
    """
    if not hull_points:
        return TinSurface(vertices=[], triangles=[])

    xs = [p[0] for p in hull_points]
    ys = [p[1] for p in hull_points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    margin = grid_spacing_m if margin_m is None else margin_m
    min_x -= margin
    min_y -= margin
    max_x += margin
    max_y += margin

    collars = surface_elevations or {}
    contacts: list[ContactPoint3D] = []
    idx = 0

    def _emit(px: float, py: float, z: float) -> None:
        nonlocal idx
        contacts.append(
            ContactPoint3D(
                contact_id=f"_dem_{idx}",
                x_m=px,
                y_m=py,
                elevation_m=z,
            )
        )
        idx += 1

    # Anchor vertices at the investigations FIRST. A surveyed collar wins over
    # the DEM at the test's own location; ``is not None`` — never falsy — so a
    # collar of exactly 0.0 m TAW is used as a value, not treated as absent
    # (owner ruling 2026-08-28: ground level 0 is a real measurement, not "no
    # data"). A test with no collar and no DEM ground is dropped rather than
    # invented (the hole is reported by ``assess_ground_coverage``).
    #
    # Anchor positions are rounded to the millimetre so the grid pass below can
    # recognise a coincident node despite float-accumulation noise in the grid
    # walk — real project coordinates never reproduce a test's X/Y exactly.
    anchor_keys: set[tuple[float, float]] = set()
    for px, py in dict.fromkeys(hull_points):
        collar = collars.get((px, py))
        z = collar if collar is not None else dem_sample(px, py)
        if z is None:
            continue
        _emit(px, py, z)
        anchor_keys.add((round(px, 3), round(py, 3)))

    # Regular grid over the padded bbox — the ground BETWEEN tests, from the
    # DEM. Any node coinciding (to the mm) with an anchor is skipped so a test
    # never gets a second, DEM-valued vertex a hair away from its collar.
    x = min_x
    while x <= max_x + 1e-6:
        y = min_y
        while y <= max_y + 1e-6:
            if (round(x, 3), round(y, 3)) not in anchor_keys:
                z = dem_sample(x, y)
                if z is not None:
                    _emit(x, y, z)
            y += grid_spacing_m
        x += grid_spacing_m

    return compute_tin(contacts)


def assess_ground_coverage(
    dem_sample: Callable[[float, float], float | None],
    points: Sequence[GroundPoint],
) -> list[GapIssue]:
    """Report the investigations the DEM has no ground elevation for.

    The ground-surface TIN triangulates only the nodes the DEM could answer
    for, so a NoData region (outside coverage, or a water body whose cells the
    provider masks) is spanned by Delaunay rather than left as a hole — the
    rendered surface LOOKS complete over water.  This function is what says
    otherwise, per Data Integrity Rule §5: record the finding, don't raise.

    Scoped to the investigation locations rather than every grid node on
    purpose — one issue per test is actionable ("the ground under B7 is a
    guess"), whereas one per grid node would emit thousands of rows for a
    site beside a river and drown the signal.  Bed geometry for water bodies
    is out of G7's scope (debt #27); flagging the affected tests is the
    honest half we can ship.

    Parameters
    ----------
    dem_sample : Callable[[float, float], float | None]
        DEM sampler; same contract as in ``clip_tin_to_dem``.
    points : Sequence[GroundPoint]
        Investigation locations to check, each carrying a display label.

    Returns
    -------
    list[GapIssue]
        One ``dem_cell_low_confidence`` issue per uncovered location, naming
        the investigation.  Empty list = the DEM answered for every test.
    """
    issues: list[GapIssue] = []
    for point in points:
        if dem_sample(point.x_m, point.y_m) is None:
            issues.append(
                GapIssue(
                    kind=KIND_DEM_CELL_LOW_CONFIDENCE,
                    detail=(
                        f"No DEM ground elevation at {point.label} "
                        f"({point.x_m:.1f}, {point.y_m:.1f}) — the cell is NoData "
                        "(outside coverage, or a water body). The ground surface is "
                        "interpolated across this location; treat the terrain shown "
                        "above this test as unverified."
                    ),
                    depth_m=None,
                )
            )
    return issues
