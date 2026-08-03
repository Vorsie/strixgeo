"""How many voxels one build is allowed to ask for, and what to say when it asks for more.

WHY THIS EXISTS
---------------
Nothing bounded the voxel count.  The grid came straight from the domain's hull
bounding box and the requested spacings, and the only validation on either side
was positivity — ``grid_spacing_m: Field(gt=0.0)`` on the request, and a Settings
dialog offering 0.5-20.0 m horizontal and 0.25-10.0 m vertical.  Neither end ever
multiplied the three axes out.

What that costs on a shape the product is sold for: a 2 km linear alignment (road,
dike, quay; ~40 CPTs) has a hull bounding box of roughly 2000 x 400 m over 40 m of
elevation.  At the 0.5 m horizontal the dialog itself offers, that is 4000 x 800
map columns x 160 levels — the ``int32`` label array alone is 2 GB, and the mesher
then allocates seven more full-grid boolean arrays PER BODY.  Labelling is
per-column Python against every section, so it is also ~250x the owner's own 62 s
benchmark.  The build either exhausts memory and kills the backend or runs for
hours; either way there is no progress, no cancel and no partial result.

THE RULE
--------
Refuse before allocating, and say what to change.  A refusal that only says "too
big" leaves the engineer halving numbers until the app stops hanging; this one
names the grid the request resolved to and the horizontal spacing at which the
SAME model fits, so the retry is one edit.

Pure domain module — no I/O, no framework imports.  It computes and raises; it
does not act, so nothing inherits ``GroundModelLogger``.
"""

from __future__ import annotations

import math

from groundmodel.shared.exceptions import VoxelGridTooLargeError

__all__ = ["MAX_VOXEL_CELLS", "check_voxel_grid_budget"]

MAX_VOXEL_CELLS: int = 50_000_000
"""Largest grid a single build may resolve to, in voxels.

The arithmetic behind the number, at the peak of the pipeline: the ``int32``
label array is 4 bytes per cell (200 MB here), and ``extract_body_solids``
allocates a padded copy plus six face masks as ``bool`` — seven more full-grid
arrays at 1 byte per cell (350 MB), one body at a time.  So the budget is roughly
a 550 MB peak, which a customer laptop survives while the next power of two does
not.  For scale, the owner's own 58-investigation model at the default 2.0 m /
0.25 m resolves to 297 x 326 x 107 = 10.4 M cells — a fifth of the budget.

⚠ This reasons about ONE build.  ``BuildVoxelLithoModel`` enforces that with
``_BUILD_CPU_LOCK``, so a second Build waits rather than running alongside the
first.  If concurrent builds are ever allowed, divide this constant by the
permitted concurrency — the peak above is per build, not per process.
"""


def check_voxel_grid_budget(
    *, nx: int, ny: int, nz: int, horizontal_m: float, vertical_m: float
) -> None:
    """Refuse a grid over :data:`MAX_VOXEL_CELLS`, naming a spacing that would fit.

    Parameters
    ----------
    nx, ny, nz : int
        The resolved grid node counts along X, Y and Z.
    horizontal_m : float
        The horizontal (X/Y) voxel edge length the build asked for, in metres.
    vertical_m : float
        The vertical (Z) voxel edge length the build asked for, in metres.

    Raises
    ------
    VoxelGridTooLargeError
        When ``nx * ny * nz`` exceeds the budget.  The message names the resolved
        grid, the total, the budget and the horizontal spacing that would fit;
        ``suggested_horizontal_m`` carries that spacing as a number.
    """
    cells = nx * ny * nz
    if cells <= MAX_VOXEL_CELLS:
        return
    # Only the two HORIZONTAL axes are scaled: the vertical spacing is what
    # resolves thin layers, and coarsening it is a modelling loss the engineer did
    # not ask for.  Cell count falls with the square of the horizontal spacing, so
    # the factor is a square root; round UP to a whole centimetre so the suggested
    # value is never a hair under the budget it is supposed to clear.
    scale = math.sqrt(cells / MAX_VOXEL_CELLS)
    suggested = math.ceil(horizontal_m * scale * 100.0) / 100.0
    raise VoxelGridTooLargeError(
        f"this build resolves to a {nx} x {ny} x {nz} voxel grid "
        f"({cells:,} cells) at {horizontal_m} m horizontal / {vertical_m} m vertical "
        f"spacing, over the {MAX_VOXEL_CELLS:,}-cell budget. "
        f"Use a horizontal spacing of at least {suggested} m, "
        "or draw the sections over a smaller area.",
        suggested_horizontal_m=suggested,
    )
