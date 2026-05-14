"""TIN compute + slice performance benchmarks.

Run with::

    uv run pytest tests/benchmarks/bench_tin_surface.py --benchmark-enable -v

The TIN compute is the load-bearing path for the section editor's
"drag a contact and see the surface refresh" UX, so it has to stay
sub-render-frame even on dense projects. Bracketing scales:

* tiny   — 5 contacts (one borehole's stack on a small section).
* small  — 20 contacts (typical project section, 4–5 boreholes).
* medium — 100 contacts (a busy section across many investigations).
* large  — 500 contacts (project-wide aggregation; upper bound for
  what we'd plausibly hit with the Flanders G3Dv3 import landing).

Slice times are independent of compute times — slicing reads the
cached TIN and walks every triangle once, so it scales with the
TRIANGLE count (which is roughly 2 * vertex_count for Delaunay).

Baseline numbers will land in CLAUDE.local.md after a stable run.
"""

from __future__ import annotations

import math

import pytest

from groundmodel.domain.services.tin_surface import (
    ContactPoint3D,
    SectionLine2D,
    compute_tin,
    slice_tin,
)


def _grid_contacts(n: int) -> list[ContactPoint3D]:
    """Build ``n`` contacts on a roughly-square grid with smoothly
    varying elevation. Distribution shape mimics real projects more
    than uniform random would (which can produce slivers at the hull).
    """
    side = max(2, int(math.ceil(math.sqrt(n))))
    spacing = 50.0  # 50 m between picks — typical for a CPT grid
    pts: list[ContactPoint3D] = []
    for i in range(n):
        ix = i % side
        iy = i // side
        x = ix * spacing + (iy % 2) * 5.0  # offset rows so no collinear stacks
        y = iy * spacing
        # Smooth elevation: gentle dip + a bit of cross-shape variation
        z = 5.0 - 0.02 * x + 0.01 * y + math.sin(ix * 0.3) * 0.5
        pts.append(ContactPoint3D(contact_id=f"c-{i}", x_m=x, y_m=y, elevation_m=z))
    return pts


# ---------------------------------------------------------------------------
# compute_tin — Delaunay triangulation throughput
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "size, label",
    [
        (5, "tiny-5"),
        (20, "small-20"),
        (100, "medium-100"),
        (500, "large-500"),
    ],
    ids=["tiny", "small", "medium", "large"],
)
def test_bench_compute_tin(benchmark, size: int, label: str) -> None:
    """compute_tin scaling. Target: sub-millisecond for tiny/small,
    sub-10ms for medium, sub-100ms for large — anything slower
    breaks the interactive recompute-on-mutation flow.
    """
    contacts = _grid_contacts(size)
    surface = benchmark(compute_tin, contacts)
    # Sanity: more triangles than 2 for any size that produces a TIN.
    if size >= 3:
        assert len(surface.triangles) >= 1


# ---------------------------------------------------------------------------
# slice_tin — section-line slice throughput
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "size, label",
    [
        (20, "small-20"),
        (100, "medium-100"),
        (500, "large-500"),
    ],
    ids=["small", "medium", "large"],
)
def test_bench_slice_tin(benchmark, size: int, label: str) -> None:
    """slice_tin scaling. Section editor calls this once per visible
    formation per render frame, so per-call cost has to be cheap
    even on a busy section. Target: sub-millisecond for small,
    sub-10ms for large.
    """
    contacts = _grid_contacts(size)
    surface = compute_tin(contacts)
    # Section line cuts horizontally across the middle of the grid.
    side = max(2, int(math.ceil(math.sqrt(size))))
    spacing = 50.0
    line = SectionLine2D(
        start_x=-spacing,
        start_y=(side // 2) * spacing,
        end_x=side * spacing,
        end_y=(side // 2) * spacing,
    )
    poly = benchmark(slice_tin, surface, line)
    # Sanity: the line cuts ≥ a few triangles.
    if size >= 20:
        assert len(poly) > 0
