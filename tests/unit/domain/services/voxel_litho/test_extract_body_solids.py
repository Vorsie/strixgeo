"""Behavioural tests for ``extract_body_solids`` — watertight per-body meshes.

These tests hand-build a :class:`LabelGrid` directly (not via ``label_voxels``)
so they can author the two stratigraphic shapes the implicit field could NOT
represent and that the voxel labelling can:

(a) an ENCLOSED LENS — a minority body fully wrapped (above, below, and on every
    lateral side) by a host body in 3-D, so a vertical ray through the lens
    column reads HOST / LENS / HOST top→bottom; and
(b) VERTICAL INTERFINGERING — a single body present in TWO disconnected z-spans
    at one ``(x, y)`` column (a body that wedges out, the host fills the gap,
    then the same body re-appears deeper), so its mesh ray-samples to two
    separate solid intervals there.

The load-bearing invariants (via the shared strat-field helpers):

* every extracted body is a closed 2-manifold (``assert_closed_manifold``);
* STRICT no-overlap between DIFFERENT bodies at every sampled ``(x, y)``
  (``assert_no_overlap_sampled`` at ``TOL`` = 1e-6 m) — the meshing of a
  labelling of space is a partition by construction, so no two bodies may share
  a vertical interval;
* the lens column reads HOST / LENS / HOST; and
* the interfingering body reads two intervals at its column.

Comments are phrased in geological terms (host, lens, wedge-out, re-appear)
rather than implementation-variable terms, so a regression reads as a clear
break of the stratigraphic behaviour the mesher must reproduce.
"""

from __future__ import annotations

import numpy as np

from groundmodel.domain.services.voxel_litho.extract_body_solids import extract_body_solids
from groundmodel.domain.services.voxel_litho.voxel_types import LabelGrid
from tests.unit.domain.services.strat_field.strat_invariants import (
    assert_closed_manifold,
    assert_no_overlap_sampled,
    vertical_ray_intervals,
)

# Body indices used in the hand-built label arrays below.  -1 is void.
_HOST = 0  # the enveloping / filling host (e.g. KLEI), body index 0
_LENS = 1  # the enclosed / re-appearing minority (e.g. SAND), body index 1


def _regular_axes(n: int, start: float, h: float) -> np.ndarray:
    """Return ``n`` ascending grid-node coordinates from ``start`` at spacing ``h``."""
    return start + h * np.arange(n, dtype=float)


def _enclosed_lens_grid() -> LabelGrid:
    """A 5x5x5 grid: a 1-voxel LENS fully wrapped by a HOST block.

    The host fills the whole 5x5x5 block; one interior voxel (the centre,
    ``(2, 2, 2)``) is re-labelled as the lens.  Because the lens voxel has a
    host voxel on all six sides, a vertical ray through the centre column reads
    HOST (above) / LENS / HOST (below) — the enclosed-lens signature.  Spacing
    is 1 m, axes start at the origin so the centre column sits at world
    ``(2.0, 2.0)``.
    """
    h = 1.0
    gx = _regular_axes(5, 0.0, h)
    gy = _regular_axes(5, 0.0, h)
    gz = _regular_axes(5, 0.0, h)
    labels = np.full((5, 5, 5), _HOST, dtype=np.int32)
    # Carve the single enclosed lens voxel out of the host's interior.
    labels[2, 2, 2] = _LENS
    return LabelGrid(
        gx=gx,
        gy=gy,
        gz=gz,
        labels=labels,
        body_id_by_index=("host", "lens"),
        formation_by_body={"host": "KLEI", "lens": "SAND"},
    )


def _vertical_interfingering_grid() -> LabelGrid:
    """A 3x3x5 grid where one body occupies TWO disconnected z-spans at a column.

    At the centre column ``(1, 1)`` the SAND body (``_LENS``) fills the bottom
    voxel (k=0) and the top voxel (k=4); the three middle voxels (k=1,2,3) are
    the FILL host.  So a vertical ray at that column passes through SAND, then
    FILL, then SAND again — the same body in two disconnected intervals, the
    vertical interfingering the implicit field's monotone clamp could not
    represent.  Every other column is solid FILL top→bottom (so SAND only ever
    appears at the centre column, never laterally adjacent in a way that would
    make it a single connected blob).
    """
    h = 1.0
    gx = _regular_axes(3, 0.0, h)
    gy = _regular_axes(3, 0.0, h)
    gz = _regular_axes(5, 0.0, h)
    # The FILL host is body index 0; the two-span SAND body is index 1.
    labels = np.full((3, 3, 5), _HOST, dtype=np.int32)
    # The same body re-appears at the centre column's bottom and top voxels.
    labels[1, 1, 0] = _LENS
    labels[1, 1, 4] = _LENS
    return LabelGrid(
        gx=gx,
        gy=gy,
        gz=gz,
        labels=labels,
        body_id_by_index=("fill", "sand_two_span"),
        formation_by_body={"fill": "KLEI", "sand_two_span": "SAND"},
    )


def _column_samples(grid: LabelGrid) -> list[tuple[float, float]]:
    """Return one ``(x, y)`` sample at the world centre of every voxel column."""
    return [(float(x), float(y)) for x in grid.gx for y in grid.gy]


def test_enclosed_lens_reads_host_lens_host() -> None:
    """A lens fully wrapped by its host reads HOST / LENS / HOST at its column."""
    grid = _enclosed_lens_grid()
    bodies = extract_body_solids(grid)

    by_id = {b.body_id: b for b in bodies}
    assert set(by_id) == {"host", "lens"}, "both the host and the enclosed lens mesh"

    # Every extracted body is a closed 2-manifold solid.
    for body in bodies:
        assert_closed_manifold(body.vertices, body.triangles)
        assert body.is_flagged is False

    # Two DIFFERENT bodies must never share a vertical interval anywhere.
    assert_no_overlap_sampled(bodies, _column_samples(grid))

    # The lens column sits at world (2.0, 2.0): one lens voxel spanning the
    # corner-lattice elevations [1.5, 2.5] (centre 2.0, spacing 1 m).
    lens_iv = vertical_ray_intervals(by_id["lens"].vertices, by_id["lens"].triangles, 2.0, 2.0)
    assert len(lens_iv) == 1, f"the enclosed lens is a single interval; got {lens_iv}"
    base, top = lens_iv[0]
    assert base == 1.5 and top == 2.5, f"lens spans [1.5, 2.5]; got [{base}, {top}]"

    # The host at the same column reads as TWO intervals — above and below the
    # lens (HOST / LENS / HOST top→bottom).
    host_iv = vertical_ray_intervals(by_id["host"].vertices, by_id["host"].triangles, 2.0, 2.0)
    assert len(host_iv) == 2, f"the host wraps the lens above and below; got {host_iv}"
    host_iv_sorted = sorted(host_iv)
    # Below the lens: the host floor up to the lens base (1.5).
    assert host_iv_sorted[0][1] == 1.5, "the host's lower interval tops out at the lens base"
    # Above the lens: from the lens top (2.5) up to the host ceiling.
    assert host_iv_sorted[1][0] == 2.5, "the host's upper interval starts at the lens top"


def test_vertical_interfingering_reads_two_intervals() -> None:
    """A body present in two disconnected z-spans at one column reads two intervals."""
    grid = _vertical_interfingering_grid()
    bodies = extract_body_solids(grid)

    by_id = {b.body_id: b for b in bodies}
    assert set(by_id) == {"fill", "sand_two_span"}

    for body in bodies:
        assert_closed_manifold(body.vertices, body.triangles)
        assert body.is_flagged is False

    assert_no_overlap_sampled(bodies, _column_samples(grid))

    # The centre column at world (1.0, 1.0): SAND fills the bottom voxel
    # [-0.5, 0.5] and the top voxel [3.5, 4.5], with FILL between — two
    # disconnected solid intervals of the SAME body, the vertical interfingering
    # the implicit field could not represent.
    sand = by_id["sand_two_span"]
    sand_iv = sorted(vertical_ray_intervals(sand.vertices, sand.triangles, 1.0, 1.0))
    assert len(sand_iv) == 2, f"the body re-appears in two z-spans; got {sand_iv}"
    assert sand_iv[0] == (-0.5, 0.5), f"lower span; got {sand_iv[0]}"
    assert sand_iv[1] == (3.5, 4.5), f"upper span; got {sand_iv[1]}"

    # The FILL host fills the three middle voxels at that column: [0.5, 3.5].
    fill = by_id["fill"]
    fill_iv = vertical_ray_intervals(fill.vertices, fill.triangles, 1.0, 1.0)
    assert len(fill_iv) == 1, f"the host is one connected interval at the column; got {fill_iv}"
    assert fill_iv[0] == (0.5, 3.5), f"host fills between the two SAND spans; got {fill_iv[0]}"


def test_empty_body_is_skipped() -> None:
    """A body index that labels no voxel produces no mesh (skipped, not empty)."""
    h = 1.0
    gx = _regular_axes(2, 0.0, h)
    gy = _regular_axes(2, 0.0, h)
    gz = _regular_axes(2, 0.0, h)
    # Body index 1 ("ghost") never appears in the labels.
    labels = np.full((2, 2, 2), _HOST, dtype=np.int32)
    grid = LabelGrid(
        gx=gx,
        gy=gy,
        gz=gz,
        labels=labels,
        body_id_by_index=("host", "ghost"),
        formation_by_body={"host": "KLEI", "ghost": "SAND"},
    )
    bodies = extract_body_solids(grid)
    assert [b.body_id for b in bodies] == ["host"], "the ghost body with no voxel is skipped"


def test_formation_id_carried_from_lookup() -> None:
    """Each mesh carries its body's formation_id from ``formation_by_body``."""
    grid = _enclosed_lens_grid()
    bodies = extract_body_solids(grid)
    by_id = {b.body_id: b for b in bodies}
    assert by_id["host"].formation_id == "KLEI"
    assert by_id["lens"].formation_id == "SAND"


def test_deterministic_output() -> None:
    """Two runs over the same grid produce identical vertices and triangles."""
    grid = _enclosed_lens_grid()
    first = extract_body_solids(grid)
    second = extract_body_solids(grid)
    assert [b.body_id for b in first] == [b.body_id for b in second]
    for a, b in zip(first, second):
        assert a.vertices == b.vertices
        assert a.triangles == b.triangles
