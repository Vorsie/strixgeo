"""Unit tests for the honored-column radius — debt #249.

Owner, 2026-07-29: *"widen honor to the drawn column width"*, after asking
*"shouldn't we paint the whole width of a column with one voxel? what if a test
falls right on the bound of 2 voxels"*.

``label_voxels`` honored an investigation at its single NEAREST grid column
(``argmin |gx - world_x|``). Two consequences: a test sitting near a cell
boundary is honored up to half a voxel from where it is, and which side it lands
on depends on the grid phase — which moves whenever the footprint changes; and
the column the engineer sees drawn is wider than one voxel, so the cells beside
the honored one carry blended material rather than the log.

The drawn width is screen-space (``BARE_COLUMN_WIDTH_PX = 14``, scaled by zoom),
so there is no metre value to copy. The honored footprint is therefore a real
radius in metres, defaulting to one horizontal voxel.
"""

from __future__ import annotations

from groundmodel.domain.services.voxel_litho.label_voxels import _honored_cells


def test_zero_radius_honors_exactly_the_nearest_cell() -> None:
    """The previous behaviour is the radius-0 case and must be preserved."""
    gx = [0.0, 2.0, 4.0, 6.0]
    gy = [0.0, 2.0, 4.0]

    assert _honored_cells(gx, gy, 2.1, 2.0, 0.0) == [(1, 1)]


def test_a_test_on_a_cell_boundary_owns_both_cells() -> None:
    """The knife-edge case the owner asked about.

    At x = 1.0 the two cell centres (0.0 and 2.0) are equidistant, so which one
    wins is decided by float noise and grid phase. With a radius both are
    honored and the ambiguity disappears.
    """
    gx = [0.0, 2.0, 4.0]
    gy = [0.0]

    assert _honored_cells(gx, gy, 1.0, 0.0, 1.0) == [(0, 0), (1, 0)]


def test_a_radius_of_one_voxel_covers_the_cross_around_the_test() -> None:
    """One horizontal voxel reaches the four orthogonal neighbours, not the diagonals.

    A diagonal centre is ``sqrt(2) * spacing`` away, which is outside a radius of
    one spacing — so the honored footprint is a plus, not a 3x3 block.
    """
    gx = [0.0, 2.0, 4.0]
    gy = [0.0, 2.0, 4.0]

    cells = set(_honored_cells(gx, gy, 2.0, 2.0, 2.0))

    assert cells == {(1, 1), (0, 1), (2, 1), (1, 0), (1, 2)}


def test_the_nearest_cell_is_always_included() -> None:
    """Even with a radius far below the spacing, the test still owns a cell.

    Otherwise a small radius would silently stop honoring the log at all.
    """
    gx = [0.0, 10.0]
    gy = [0.0]

    assert _honored_cells(gx, gy, 4.0, 0.0, 0.001) == [(0, 0)]


def test_cells_are_returned_in_a_stable_order() -> None:
    """Deterministic output so two runs assign contention identically."""
    gx = [0.0, 2.0, 4.0]
    gy = [0.0, 2.0]

    assert _honored_cells(gx, gy, 2.0, 1.0, 2.5) == sorted(_honored_cells(gx, gy, 2.0, 1.0, 2.5))


def test_a_test_outside_the_grid_still_gets_its_closest_cell() -> None:
    """An investigation just off the grid edge clamps rather than vanishing."""
    gx = [0.0, 2.0]
    gy = [0.0, 2.0]

    assert _honored_cells(gx, gy, -5.0, -5.0, 0.0) == [(0, 0)]
