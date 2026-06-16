"""Read-only: SHA-256 of the real ``test.strix`` voxel LABEL grid.

Runs ``label_voxels`` on the real inputs (oracle section partitions + the dev
DB's parent geo surfaces + the model's honored picks) and prints a SHA-256 of
the dense ``labels`` array plus the body-id ordering. Used to prove a refactor
(e.g. the per-column geo-surface-elevation cache) is BYTE-IDENTICAL on the REAL
model, not just on a synthetic fixture — run it at the same commit before and
after the change and compare the hash.

Labels only — no mesh extraction, no persist, no integration DB. The DB read is
guarded (dev ``groundmodel`` only).

Usage
-----
    uv run python scripts/label_grid_checksum.py
    uv run python scripts/label_grid_checksum.py --horizontal 2 --vertical 1.0
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import sys
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402

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
    """ABORT when the DSN is not the dev ``groundmodel`` DB."""
    url = settings.database_url
    print(f"  DB target: {url}")
    if "groundmodel" not in url:
        raise SystemExit(f"ABORT: DSN does not contain 'groundmodel' ({url!r}).")
    if url.rstrip("/").endswith(("_integration", "_test")):
        raise SystemExit(f"ABORT: DSN names an integration/test DB ({url!r}).")


async def _load_inputs(model_id: UUID):
    """Load sections, geo surfaces, and honored investigation columns."""
    sections, _h = _load_sections(_FIXTURE)
    domain = build_domain_from_sections(sections)
    async with AsyncSessionFactory() as session:
        model = await session.get(GeologicalModelOrm, model_id)
        parent_id = model.parent_geological_model_id if model is not None else None
        geo_surfaces = await load_geo_surfaces(session, parent_id) if parent_id else ()
        picks = await LithoLayerRepository(session).load_body_picks(model_id)
    return sections, domain, geo_surfaces, _investigation_columns_from_picks(picks)


def main() -> None:
    """Print the SHA-256 of the real-model voxel label grid."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--horizontal", type=float, default=2.0)
    ap.add_argument("--vertical", type=float, default=1.0)
    args = ap.parse_args()

    print("\n=== LABEL GRID CHECKSUM (READ-ONLY) ===\n")
    _confirm_db_target()
    sections, domain, geo_surfaces, inv_columns = asyncio.run(_load_inputs(args.model_id))
    vertical = None if args.vertical == args.horizontal else args.vertical
    grid = label_voxels(
        domain,
        args.horizontal,
        sections,
        investigation_columns=inv_columns,
        geo_surfaces=geo_surfaces,
        vertical_spacing_m=vertical,
    )

    labels_hash = hashlib.sha256(np.ascontiguousarray(grid.labels).tobytes()).hexdigest()
    body_hash = hashlib.sha256("\n".join(grid.body_id_by_index).encode()).hexdigest()
    n_void = int((grid.labels < 0).sum())
    n_filled = int((grid.labels >= 0).sum())
    print(
        f"  grid {len(grid.gx)}x{len(grid.gy)}x{len(grid.gz)} | "
        f"{len(grid.body_id_by_index)} body slots | filled={n_filled:,} void={n_void:,}"
    )
    print(f"  LABELS  sha256: {labels_hash}")
    print(f"  BODYIDS sha256: {body_hash}")


if __name__ == "__main__":
    main()
