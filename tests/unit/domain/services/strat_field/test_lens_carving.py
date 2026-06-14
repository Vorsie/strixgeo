"""Task-4 lens-carving tests — the watertight enclosed-lens gate.

These tests are the objective definition of "done" for the lens-carving stage: a
lens must sit VERTICALLY ENCLOSED inside its matrix host (KLEI / SILT / KLEI down
a column through the lens), with host + lens TILING — no overlap, no gap — and
every emitted :class:`LithoBodyMesh` a closed 2-manifold.

The fixtures are REAL-DATA-SHAPED, not layer-cake: the lens is strictly interior
to a host band (host present ABOVE and BELOW it) over a sub-footprint of the
domain, exactly the over-merge signature (``klei_silt_klei_columns``) that breaks
the single-field stratigraphic order on ``test.strix``.

The lens vertical extent (``z_top`` / ``z_base`` height arrays + footprint over
the shared grid) is authored ANALYTICALLY here — the carver is a pure geometry
assembler that takes those surfaces as input.  Task 5 (the wiring) is what
populates the lens geometry from the lens's real picks.
"""

from __future__ import annotations

import numpy as np
import pytest

from groundmodel.domain.services.strat_field.body_assembly import (
    build_shared_grid,
    emit_prism_bodies,
)
from groundmodel.domain.services.strat_field.lens_carving import (
    LensCarveInput,
    carve_lenses,
    merge_meshes_by_body_id,
)
from groundmodel.domain.services.strat_field.strat_types import Block
from groundmodel.domain.value_objects.litho_body_mesh import LithoBodyMesh
from tests.unit.domain.services.strat_field.strat_invariants import (
    AuthoredColumn,
    AuthoredUnit,
    assert_closed_manifold,
    assert_model_matches_columns,
    assert_no_overlap_sampled,
)

# A 30 m square domain, host KLEI band spanning the full vertical block; the lens
# sits in a central x/y sub-footprint, strictly interior in z.
_X_MIN = 0.0
_X_MAX = 30.0
_Y_MIN = 0.0
_Y_MAX = 30.0
_Z_MIN = -10.0
_Z_MAX = 10.0
_GRID_SPACING_M = 1.0

# Host band: KLEI fills the whole block (top cap = z_max, base cap = z_min).
_HOST_BODY_ID = "strat:0-1"

# Central lens footprint (a square well inside the domain so the host surrounds it).
_LENS_X_LO = 10.0
_LENS_X_HI = 20.0
_LENS_Y_LO = 10.0
_LENS_Y_HI = 20.0

# Lens vertical extent (strictly interior: -10 < z_base < z_top < +10).
_LENS_TOP_Z = 3.0
_LENS_BASE_Z = -3.0

# Inner ZAND lens (lens-in-lens): a smaller footprint + thinner slab inside the SILT.
_INNER_X_LO = 13.0
_INNER_X_HI = 17.0
_INNER_Y_LO = 13.0
_INNER_Y_HI = 17.0
_INNER_TOP_Z = 1.0
_INNER_BASE_Z = -1.0


def _domain() -> Block:
    """Return the 30 m square / 20 m tall analytic domain block."""
    polygon = (
        (_X_MIN, _Y_MIN),
        (_X_MAX, _Y_MIN),
        (_X_MAX, _Y_MAX),
        (_X_MIN, _Y_MAX),
    )
    return Block(polygon=polygon, z_min=_Z_MIN, z_max=_Z_MAX)


def _grid_samples(domain: Block, n: int) -> list[tuple[float, float]]:
    """Return ``n × n`` interior ``(x, y)`` samples, inset from the perimeter."""
    xs = [vx for vx, _ in domain.polygon]
    ys = [vy for _, vy in domain.polygon]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    ix = 0.05 * (x_max - x_min)
    iy = 0.05 * (y_max - y_min)
    sx = np.linspace(x_min + ix, x_max - ix, n)
    sy = np.linspace(y_min + iy, y_max - iy, n)
    return [(float(x), float(y)) for x in sx for y in sy]


def _footprint_mask(
    gx: np.ndarray,
    gy: np.ndarray,
    x_lo: float,
    x_hi: float,
    y_lo: float,
    y_hi: float,
) -> np.ndarray:
    """Return an ``(nx, ny)`` bool node mask: True where the node is in the box.

    The box is inclusive of its edges; the carver only treats a CELL as inside
    the lens when all four of its corner nodes are inside, so an inclusive node
    box gives a clean lens-cell footprint.
    """
    nx, ny = len(gx), len(gy)
    mask = np.zeros((nx, ny), dtype=bool)
    for i in range(nx):
        for j in range(ny):
            if x_lo <= gx[i] <= x_hi and y_lo <= gy[j] <= y_hi:
                mask[i, j] = True
    return mask


def _flat(value: float, nx: int, ny: int) -> np.ndarray:
    """Return an ``(nx, ny)`` array filled with ``value`` (a flat height field)."""
    return np.full((nx, ny), value, dtype=float)


def _host_matrix_meshes(
    gx: np.ndarray, gy: np.ndarray, node_inside: np.ndarray
) -> list[LithoBodyMesh]:
    """Build the single KLEI host band over the whole domain (top cap → base cap)."""
    nx, ny = len(gx), len(gy)
    top = _flat(_Z_MAX, nx, ny)
    bottom = _flat(_Z_MIN, nx, ny)
    return emit_prism_bodies(
        top=top,
        bottom=bottom,
        formation_id="KLEI",
        body_id=_HOST_BODY_ID,
        gx=gx,
        gy=gy,
        node_inside=node_inside,
    )


def _build_enclosed_lens_model() -> list[LithoBodyMesh]:
    """Carve a SILT lens into a KLEI host band → KLEI / SILT / KLEI at the centre."""
    gx, gy, node_inside = build_shared_grid(_domain(), _GRID_SPACING_M)
    nx, ny = len(gx), len(gy)
    matrix = _host_matrix_meshes(gx, gy, node_inside)

    lens = LensCarveInput(
        host_body_id=_HOST_BODY_ID,
        host_formation_id="KLEI",
        lens_body_id="silt-lens-0001",
        lens_formation_id="SILT",
        z_top=_flat(_LENS_TOP_Z, nx, ny),
        z_base=_flat(_LENS_BASE_Z, nx, ny),
        footprint=_footprint_mask(gx, gy, _LENS_X_LO, _LENS_X_HI, _LENS_Y_LO, _LENS_Y_HI),
        nesting_depth=1,
    )
    return carve_lenses([lens], matrix, gx, gy, node_inside)


def _enclosed_lens_columns() -> list[AuthoredColumn]:
    """Author the KLEI / SILT / KLEI stack at a column through the lens centre."""
    cx = (_LENS_X_LO + _LENS_X_HI) / 2.0
    cy = (_LENS_Y_LO + _LENS_Y_HI) / 2.0
    return [
        AuthoredColumn(
            x=cx,
            y=cy,
            units=(
                AuthoredUnit("KLEI", top_elev_m=_Z_MAX, base_elev_m=_LENS_TOP_Z),
                AuthoredUnit("SILT", top_elev_m=_LENS_TOP_Z, base_elev_m=_LENS_BASE_Z),
                AuthoredUnit("KLEI", top_elev_m=_LENS_BASE_Z, base_elev_m=_Z_MIN),
            ),
        )
    ]


def _build_lens_in_lens_model() -> list[LithoBodyMesh]:
    """Carve SILT in KLEI, then ZAND inside the SILT → KLEI/SILT/ZAND/SILT/KLEI."""
    gx, gy, node_inside = build_shared_grid(_domain(), _GRID_SPACING_M)
    nx, ny = len(gx), len(gy)
    matrix = _host_matrix_meshes(gx, gy, node_inside)

    silt = LensCarveInput(
        host_body_id=_HOST_BODY_ID,
        host_formation_id="KLEI",
        lens_body_id="silt-lens-0001",
        lens_formation_id="SILT",
        z_top=_flat(_LENS_TOP_Z, nx, ny),
        z_base=_flat(_LENS_BASE_Z, nx, ny),
        footprint=_footprint_mask(gx, gy, _LENS_X_LO, _LENS_X_HI, _LENS_Y_LO, _LENS_Y_HI),
        nesting_depth=1,
    )
    # The inner ZAND lens's host is the SILT lens body.  Its host id is the SILT
    # lens's emitted body_id — the deterministic ``lens:{host}:{tail}`` scheme.
    silt_emitted_id = f"lens:{_HOST_BODY_ID}:{silt.lens_body_id[-6:]}"
    zand = LensCarveInput(
        host_body_id=silt_emitted_id,
        host_formation_id="SILT",
        lens_body_id="zand-lens-0002",
        lens_formation_id="ZAND",
        z_top=_flat(_INNER_TOP_Z, nx, ny),
        z_base=_flat(_INNER_BASE_Z, nx, ny),
        footprint=_footprint_mask(gx, gy, _INNER_X_LO, _INNER_X_HI, _INNER_Y_LO, _INNER_Y_HI),
        nesting_depth=2,
    )
    return carve_lenses([silt, zand], matrix, gx, gy, node_inside)


def _lens_in_lens_columns() -> list[AuthoredColumn]:
    """Author the KLEI / SILT / ZAND / SILT / KLEI stack at the inner-lens centre."""
    cx = (_INNER_X_LO + _INNER_X_HI) / 2.0
    cy = (_INNER_Y_LO + _INNER_Y_HI) / 2.0
    return [
        AuthoredColumn(
            x=cx,
            y=cy,
            units=(
                AuthoredUnit("KLEI", top_elev_m=_Z_MAX, base_elev_m=_LENS_TOP_Z),
                AuthoredUnit("SILT", top_elev_m=_LENS_TOP_Z, base_elev_m=_INNER_TOP_Z),
                AuthoredUnit("ZAND", top_elev_m=_INNER_TOP_Z, base_elev_m=_INNER_BASE_Z),
                AuthoredUnit("SILT", top_elev_m=_INNER_BASE_Z, base_elev_m=_LENS_BASE_Z),
                AuthoredUnit("KLEI", top_elev_m=_LENS_BASE_Z, base_elev_m=_Z_MIN),
            ),
        )
    ]


# ---------------------------------------------------------------------------
# Gate tests
# ---------------------------------------------------------------------------


def test_lens_sits_inside_host_no_overlap_no_gap() -> None:
    """A SILT lens carved into a KLEI host sits vertically enclosed: KLEI/SILT/KLEI."""
    bodies = _build_enclosed_lens_model()
    klei = [b for b in bodies if b.formation_id == "KLEI"]
    silt = next(b for b in bodies if b.formation_id == "SILT")
    assert klei, "no KLEI host pieces emitted"
    assert silt is not None
    # Host pieces + lens are all closed manifolds.
    for b in bodies:
        assert b.is_flagged is False
        assert_closed_manifold(b.vertices, b.triangles)
    # STRICT no-overlap (TOL=1e-6): the two host pieces share a body_id and may
    # stack; the lens must not interpenetrate either host piece.
    assert_no_overlap_sampled(bodies, _grid_samples(_domain(), n=30))
    # The lens sits vertically inside the host at a column through the lens centre.
    assert_model_matches_columns(bodies, _enclosed_lens_columns(), tol_m=0.5)


def test_lens_in_lens_carves_recursively() -> None:
    """A ZAND lens inside a SILT lens inside a KLEI host → KLEI/SILT/ZAND/SILT/KLEI."""
    bodies = _build_lens_in_lens_model()
    for b in bodies:
        assert b.is_flagged is False
        assert_closed_manifold(b.vertices, b.triangles)
    assert_no_overlap_sampled(bodies, _grid_samples(_domain(), n=30))
    assert_model_matches_columns(bodies, _lens_in_lens_columns(), tol_m=0.5)


def test_unknown_host_body_id_raises_value_error() -> None:
    """A lens naming a host not in the working set raises ValueError, not KeyError."""
    # Build the shared grid + the matrix host meshes exactly as the happy-path
    # test does, then a lens whose host_body_id matches no matrix mesh body_id.
    gx, gy, node_inside = build_shared_grid(_domain(), _GRID_SPACING_M)
    nx, ny = len(gx), len(gy)
    matrix = _host_matrix_meshes(gx, gy, node_inside)

    bad_lens = LensCarveInput(
        host_body_id="strat:does-not-exist",
        host_formation_id="KLEI",
        lens_body_id="silt-lens-0001",
        lens_formation_id="SILT",
        z_top=_flat(_LENS_TOP_Z, nx, ny),
        z_base=_flat(_LENS_BASE_Z, nx, ny),
        footprint=_footprint_mask(gx, gy, _LENS_X_LO, _LENS_X_HI, _LENS_Y_LO, _LENS_Y_HI),
        nesting_depth=1,
    )

    # The unknown host id must hit the explicit ValueError branch in carve_lenses,
    # not a downstream KeyError or array-shape error.
    with pytest.raises(ValueError, match="not in the carve working set"):
        carve_lenses([bad_lens], matrix, gx, gy, node_inside)


def test_lens_surfaces_poking_outside_host_are_clamped_strictly_interior() -> None:
    """A lens whose input surfaces poke OUTSIDE the host is clamped + still tiles.

    Task 5a's lens surfaces are resampled from the lens's own picks over the shared
    grid, NOT clamped to the host — so the RBF can extrapolate a lens top ABOVE the
    host top and a lens base BELOW the host base near the footprint edge.  Without
    the strict-interior clamp that builds an inverted / zero-thickness host slab and
    breaks the watertight tiling.  Here the lens top is authored ABOVE ``z_max`` and
    the base BELOW ``z_min`` over the whole footprint; after clamping the result
    must STILL be a clean enclosure: closed manifolds, strict no-overlap, and
    HOST / LENS / HOST down a column through the lens.
    """
    gx, gy, node_inside = build_shared_grid(_domain(), _GRID_SPACING_M)
    nx, ny = len(gx), len(gy)
    matrix = _host_matrix_meshes(gx, gy, node_inside)

    # Lens surfaces deliberately OUTSIDE the host band: top above z_max, base below
    # z_min.  The clamp must pull them strictly inside (host_top - margin /
    # host_base + margin) so the host pieces stay non-degenerate.
    poke_top = _Z_MAX + 5.0
    poke_base = _Z_MIN - 5.0
    lens = LensCarveInput(
        host_body_id=_HOST_BODY_ID,
        host_formation_id="KLEI",
        lens_body_id="silt-lens-0001",
        lens_formation_id="SILT",
        z_top=_flat(poke_top, nx, ny),
        z_base=_flat(poke_base, nx, ny),
        footprint=_footprint_mask(gx, gy, _LENS_X_LO, _LENS_X_HI, _LENS_Y_LO, _LENS_Y_HI),
        nesting_depth=1,
    )
    bodies = carve_lenses([lens], matrix, gx, gy, node_inside)

    klei = [b for b in bodies if b.formation_id == "KLEI"]
    silt = next(b for b in bodies if b.formation_id == "SILT")
    assert klei, "no KLEI host pieces emitted after clamp"
    assert silt is not None
    for b in bodies:
        assert b.is_flagged is False
        assert_closed_manifold(b.vertices, b.triangles)
    assert_no_overlap_sampled(bodies, _grid_samples(_domain(), n=30))

    # The clamped lens sits strictly inside the host: a column through its centre
    # reads KLEI / SILT / KLEI.  The clamp pulls the SILT top to ``z_max - margin``
    # and base to ``z_min + margin`` (margin = 0.10 m), so the host slivers are thin
    # but present; a generous tolerance absorbs the clamp offset + discretisation.
    margin = 0.10
    columns = [
        AuthoredColumn(
            x=(_LENS_X_LO + _LENS_X_HI) / 2.0,
            y=(_LENS_Y_LO + _LENS_Y_HI) / 2.0,
            units=(
                AuthoredUnit("KLEI", top_elev_m=_Z_MAX, base_elev_m=_Z_MAX - margin),
                AuthoredUnit("SILT", top_elev_m=_Z_MAX - margin, base_elev_m=_Z_MIN + margin),
                AuthoredUnit("KLEI", top_elev_m=_Z_MIN + margin, base_elev_m=_Z_MIN),
            ),
        )
    ]
    assert_model_matches_columns(bodies, columns, tol_m=0.5)


def test_merge_meshes_by_body_id_concatenates_host_pieces() -> None:
    """The two carved host pieces (one body_id) merge into ONE valid closed mesh.

    Persistence keys one row per body_id, so the host-upper-plus-outer +
    host-lower pieces (same id) must merge before upsert or one is silently lost.
    The merged mesh of two disjoint closed components is still a valid closed
    manifold and still ray-casts to two intervals (KLEI above / KLEI below).
    """
    bodies = _build_enclosed_lens_model()
    klei_pieces = [b for b in bodies if b.formation_id == "KLEI"]
    assert len(klei_pieces) == 2, "carve must emit two host pieces sharing one body_id"
    assert klei_pieces[0].body_id == klei_pieces[1].body_id

    merged = merge_meshes_by_body_id(bodies)
    # One row per body_id now: the SILT lens + the single merged KLEI host.
    by_id = {m.body_id for m in merged}
    assert len(merged) == len(by_id), "merge must collapse to one mesh per body_id"
    klei_merged = next(m for m in merged if m.formation_id == "KLEI")
    # Vertices + triangles are the concatenation of both pieces.
    assert len(klei_merged.vertices) == sum(len(p.vertices) for p in klei_pieces)
    assert len(klei_merged.triangles) == sum(len(p.triangles) for p in klei_pieces)
    # The merged disjoint-component mesh is still a closed manifold.
    assert_closed_manifold(klei_merged.vertices, klei_merged.triangles)
    # Single-mesh group passes through unchanged.
    silt_merged = next(m for m in merged if m.formation_id == "SILT")
    silt_orig = next(b for b in bodies if b.formation_id == "SILT")
    assert silt_merged.vertices == silt_orig.vertices
    assert silt_merged.triangles == silt_orig.triangles
