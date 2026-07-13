"""Read-only profiler: isolate the ``label_voxels`` hotspot on real ``test.strix``.

The voxel build's wall-time is dominated by the LABELLING phase
(:func:`~groundmodel.domain.services.voxel_litho.label_voxels.label_voxels`),
not the meshing or the DB write (measured: ~84 % of build time). This script
loads the real inputs (the captured oracle section partitions + the dev DB's
parent geo surfaces + the model's honored-borehole picks), then runs
``label_voxels`` under ``cProfile`` so the per-function hotspot is visible — the
profile-before-optimising gate (``memory/feedback_profile_before_optimizing``).

It does NOT extract meshes, NOT persist, NOT touch the integration DB. The DB
read is guarded (dev ``groundmodel`` only). Run it ALONE — a concurrent voxel
build doubles the memory + CPU load.

Usage
-----
    uv run python scripts/profile_voxel_label.py
    uv run python scripts/profile_voxel_label.py --horizontal 2 --vertical 1.0
    uv run python scripts/profile_voxel_label.py --top 30
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

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _investigation_columns_from_picks,
)
from groundmodel.application.load_geo_surfaces import load_geo_surfaces  # noqa: E402
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels  # noqa: E402
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from groundmodel.shared.config import settings  # noqa: E402
from scripts.eval_voxel_label import _load_sections  # noqa: E402

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")
_FIXTURE = _REPO_ROOT / "tests" / "fixtures" / "voxel" / "teststrix_partitions.json"


def _confirm_db_target() -> None:
    """Print the DB DSN and ABORT when it is not the dev ``groundmodel`` DB."""
    url = settings.database_url
    print(f"  DB target: {url}")
    if "groundmodel" not in url:
        raise SystemExit(f"ABORT: DSN does not contain 'groundmodel' ({url!r}).")
    if url.rstrip("/").endswith(("_integration", "_test")):
        raise SystemExit(f"ABORT: DSN names an integration/test DB ({url!r}).")


async def _load_inputs(model_id: UUID):
    """Load the sections, geo surfaces, and honored investigation columns.

    Parameters
    ----------
    model_id : UUID
        The lithostratigraphic model to profile.

    Returns
    -------
    tuple
        ``(sections, domain, geo_surfaces, investigation_columns, snap_tol)``.
    """
    sections, _h = _load_sections(_FIXTURE)
    domain = build_domain_from_sections(sections)
    async with AsyncSessionFactory() as session:
        model = await session.get(GeologicalModelOrm, model_id)
        parent_id = model.parent_model_id if model is not None else None
        geo_surfaces = await load_geo_surfaces(session, parent_id) if parent_id is not None else ()
        picks = await LithoLayerRepository(session).load_body_picks(model_id)
    investigation_columns = _investigation_columns_from_picks(picks)
    return sections, domain, geo_surfaces, investigation_columns


def main() -> None:
    """Profile ``label_voxels`` on the real model and print the hotspot table."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--horizontal", type=float, default=2.0)
    ap.add_argument("--vertical", type=float, default=1.0)
    ap.add_argument("--top", type=int, default=30, help="rows of the hotspot table")
    args = ap.parse_args()

    print("\n=== PROFILE label_voxels (READ-ONLY) ===\n")
    _confirm_db_target()

    sections, domain, geo_surfaces, investigation_columns = asyncio.run(_load_inputs(args.model_id))
    print(
        f"  loaded {len(sections)} sections, {len(geo_surfaces)} geo surface(s), "
        f"{len(investigation_columns)} honored column(s)"
    )
    vertical = None if args.vertical == args.horizontal else args.vertical
    print(f"  spacing: horizontal={args.horizontal} m, vertical={args.vertical} m\n")

    prof = cProfile.Profile()
    t0 = time.perf_counter()
    grid = prof.runcall(
        label_voxels,
        domain,
        args.horizontal,
        sections,
        investigation_columns=investigation_columns,
        geo_surfaces=geo_surfaces,
        vertical_spacing_m=vertical,
    )
    elapsed = time.perf_counter() - t0

    print(
        f"  labelled {len(grid.gx)}x{len(grid.gy)}x{len(grid.gz)} grid, "
        f"{len(grid.body_id_by_index)} body slots in {elapsed:.1f} s\n"
    )

    buf = StringIO()
    stats = pstats.Stats(prof, stream=buf)
    print("  --- by CUMULATIVE time (callers) ---")
    stats.sort_stats("cumulative").print_stats(args.top)
    print(buf.getvalue())

    buf2 = StringIO()
    stats2 = pstats.Stats(prof, stream=buf2)
    print("  --- by TOTAL (self) time (the hot leaves) ---")
    stats2.sort_stats("tottime").print_stats(args.top)
    print(buf2.getvalue())


if __name__ == "__main__":
    main()
