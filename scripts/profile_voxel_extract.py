"""Read-only profiler: isolate the ``extract_body_solids`` hotspot on real data.

After the labelling optimization, mesh EXTRACTION is the #1 build phase (and the
memory-heavy one — it matters most for lower-spec machines). This script loads
the real inputs, runs ``label_voxels`` ONCE (timed, not profiled) to get the
grid, then runs ``extract_body_solids`` under ``cProfile`` so the per-function
hotspot is visible — the profile-before-optimising gate
(``memory/feedback_profile_before_optimizing``).

The cProfile *relative* breakdown (which function dominates) is independent of
background machine load, so it is valid even when the absolute time is inflated.

Read-only: no persist, no integration DB. Run it ALONE for a clean absolute time.

Usage
-----
    uv run python scripts/profile_voxel_extract.py
    uv run python scripts/profile_voxel_extract.py --horizontal 2 --vertical 1.0
"""

from __future__ import annotations

import argparse
import asyncio
import cProfile
import pstats
import sys
import time
from io import StringIO
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from groundmodel.domain.services.voxel_litho.extract_body_solids import (  # noqa: E402
    extract_body_solids,
)
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels  # noqa: E402
from scripts.label_grid_checksum import _confirm_db_target, _load_inputs  # noqa: E402

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")


def main() -> None:
    """Profile ``extract_body_solids`` on the real model and print the hotspot."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--horizontal", type=float, default=2.0)
    ap.add_argument("--vertical", type=float, default=1.0)
    ap.add_argument("--top", type=int, default=22)
    args = ap.parse_args()

    print("\n=== PROFILE extract_body_solids (READ-ONLY) ===\n")
    _confirm_db_target()
    sections, domain, geo_surfaces, inv_columns = asyncio.run(_load_inputs(args.model_id))
    vertical = None if args.vertical == args.horizontal else args.vertical

    t0 = time.perf_counter()
    grid = label_voxels(
        domain,
        args.horizontal,
        sections,
        investigation_columns=inv_columns,
        geo_surfaces=geo_surfaces,
        vertical_spacing_m=vertical,
    )
    print(
        f"  labelled {len(grid.gx)}x{len(grid.gy)}x{len(grid.gz)} in {time.perf_counter() - t0:.1f} s"
    )

    prof = cProfile.Profile()
    t1 = time.perf_counter()
    meshes = prof.runcall(extract_body_solids, grid)
    elapsed = time.perf_counter() - t1
    n_tris = sum(len(m.triangles) for m in meshes)
    print(f"  extracted {len(meshes)} meshes, {n_tris:,} tris in {elapsed:.1f} s\n")

    for sort_key, label in (
        ("tottime", "TOTAL (self) time — the hot leaves"),
        ("cumulative", "CUMULATIVE"),
    ):
        buf = StringIO()
        pstats.Stats(prof, stream=buf).sort_stats(sort_key).print_stats(args.top)
        print(f"  --- by {label} ---")
        print(buf.getvalue())


if __name__ == "__main__":
    main()
