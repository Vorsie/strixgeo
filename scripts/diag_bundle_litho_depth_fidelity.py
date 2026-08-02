"""READ-ONLY: does the ``.strix`` bundle carry litho-layer depths bit-exactly?

The re-anchor measurement verified that a bundle round-trip preserved the geotech
BANDS and the accepted ties — its OUTPUT.  It never checked the litho layer
depths, which are the segmenter's dominant INPUT (they set every geo-bounded
segment window).  A depth rounded or re-formatted by the bundle would make a
restored copy rebuild differently for a reason that has nothing to do with the
segmenter.

This script builds the production bundle from the dev DB (``build_project_bundle``
is a pure reader), serialises it to JSON and parses it back — exactly what a
``.strix`` on disk goes through — then compares every litho layer's
``depth_top_m`` / ``depth_base_m`` against the value the database holds, as raw
doubles.  Nothing is written anywhere.

Usage
-----
    uv run python scripts/diag_bundle_litho_depth_fidelity.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm  # noqa: E402
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm  # noqa: E402
from groundmodel.infrastructure.db.repositories.project_bundle import (  # noqa: E402
    build_project_bundle,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402


def _walk_litho_layers(node: Any) -> list[dict[str, Any]]:
    """Collect every dict in *node* that looks like a serialised litho layer.

    Parameters
    ----------
    node : Any
        Any part of the bundle structure.

    Returns
    -------
    list[dict[str, Any]]
        Dicts carrying an ``id`` plus both depth keys.
    """
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        if "depth_top_m" in node and "depth_base_m" in node and "id" in node:
            found.append(node)
        for value in node.values():
            found.extend(_walk_litho_layers(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(_walk_litho_layers(item))
    return found


async def main() -> None:
    """Compare bundle-carried litho depths against the database's own doubles."""
    print("\n=== .strix BUNDLE LITHO-DEPTH FIDELITY (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        project = (await session.execute(select(ProjectOrm))).scalars().first()
        if project is None:
            raise SystemExit("ABORT: no project in the dev DB.")
        print(f"  project {project.id} ({project.name})")

        bundle = await build_project_bundle(session, project, include_solids=False)
        # JSON round-trip: what actually lands on disk and comes back.
        reparsed = json.loads(json.dumps(bundle, default=str))

        db_rows = (
            await session.execute(
                select(LithoLayerOrm.id, LithoLayerOrm.depth_top_m, LithoLayerOrm.depth_base_m)
            )
        ).all()
        db_by_id = {str(r.id): (r.depth_top_m, r.depth_base_m) for r in db_rows}
        print(f"  litho_layer rows in the DB (all models): {len(db_by_id)}")

    carried = _walk_litho_layers(reparsed)
    seen = {str(d["id"]): (d["depth_top_m"], d["depth_base_m"]) for d in carried}
    print(f"  litho-layer-shaped dicts in the round-tripped bundle: {len(seen)}")

    missing = [lid for lid in db_by_id if lid not in seen]
    drifted: list[tuple[str, tuple[float, float], tuple[float, float]]] = []
    for lid, (top, base) in seen.items():
        ref = db_by_id.get(lid)
        if ref is None:
            continue
        if repr(float(top)) != repr(ref[0]) or repr(float(base)) != repr(ref[1]):
            drifted.append((lid, (float(top), float(base)), ref))

    print(f"  layers present in the DB but absent from the bundle: {len(missing)}")
    print(f"  layers whose depth changed through the round-trip  : {len(drifted)}")
    for lid, got, ref in drifted[:20]:
        print(f"    {lid}: bundle {got!r} vs db {ref!r}")
    if not drifted and not missing:
        print("\n  VERDICT: the bundle carries every litho depth bit-exactly.")


if __name__ == "__main__":
    asyncio.run(main())
