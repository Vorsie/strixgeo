"""READ-ONLY: the drilled-ground gate against a build made NOW, not the persisted one.

``eval_strat_fidelity.py`` scores the solids stored in the database, so it cannot see a
change to the builder until someone clicks Build. That makes it useless for deciding
whether a fix worked — the numbers it reports belong to the previous build.

This runs the production pipeline in memory (``build_domain_from_sections`` →
``label_voxels`` → ``extract_body_solids``) on the stored partition payload and applies
``eval_strat_fidelity``'s OWN drilled classifier, so the verdicts are directly comparable
to the acceptance gate's. Paired stations get their own category, per #258: a log whose
cell belongs to its partner cannot be scored against its own log.

Grid geometry, honour radius and the footprint source all come from the stored
generation, so the build reproduces what the app would make.

Nothing is written to the database — SELECTs only, behind the same dev-DB guard as
``eval_strat_fidelity.py``.

Usage
-----
    uv run python scripts/diag_drilled_gate_inmemory.py
    uv run python scripts/diag_drilled_gate_inmemory.py --measured-pinch
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import numpy as np  # noqa: E402
from sqlalchemy import select  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _apply_aliases_to_columns,
    _investigation_columns_from_picks,
)
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import (  # noqa: E402
    extract_body_solids,
)
from groundmodel.domain.services.voxel_litho.label_voxels import label_voxels  # noqa: E402
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (  # noqa: E402
    apply_body_aliases,
)
from groundmodel.domain.services.voxel_litho.paired_stations import (  # noqa: E402
    paired_station_losers,
)
from groundmodel.domain.services.voxel_litho.true_column_positions import (  # noqa: E402
    apply_true_column_positions,
)
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (  # noqa: E402
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_build_generations import _sections_from_payload  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _authored_columns,
    _classify_column_in_drilled_interval,
    _clip_to_drilled,
    _compute_model_stack,
    _confirm_db_target,
    _load_formation_names,
)

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")


async def main() -> None:
    """Build in memory and report the drilled-ground verdicts."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument(
        "--measured-pinch",
        action="store_true",
        help="build with the #256 measured pinch on instead of the midline rule",
    )
    args = ap.parse_args()

    print("\n=== DRILLED GATE, BUILT NOW (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        gen = (
            (
                await session.execute(
                    select(LithoBuildGenerationOrm)
                    .where(LithoBuildGenerationOrm.model_id == args.model_id)
                    .order_by(LithoBuildGenerationOrm.created_at.desc())
                )
            )
            .scalars()
            .first()
        )
        if gen is None:
            raise SystemExit("ABORT: no stored build generation — click Build once.")
        picks = await LithoLayerRepository(session).load_body_picks(args.model_id)
        names = await _load_formation_names(session, args.model_id)

    aliases = dict(gen.body_aliases or {})
    inv_columns = _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases)
    as_drawn = apply_body_aliases(_sections_from_payload(gen.payload), aliases)
    sections, _moved, _shift = apply_true_column_positions(as_drawn, inv_columns)
    columns = _authored_columns(picks)

    h = float(gen.horizontal_spacing_m)
    v = float(gen.vertical_spacing_m)
    honor = float(gen.honor_radius_m)
    gx = np.arange(gen.grid_origin_x, gen.grid_origin_x + gen.grid_nx * h, h)[: gen.grid_nx]
    gy = np.arange(gen.grid_origin_y, gen.grid_origin_y + gen.grid_ny * h, h)[: gen.grid_ny]
    paired = paired_station_losers(inv_columns, gx, gy, honor)

    print(f"  grid {h} m / {v} m | honour {honor} m | measured_pinch={args.measured_pinch}")
    t0 = time.perf_counter()
    domain = build_domain_from_sections(
        as_drawn,
        investigation_positions=tuple(
            (c.investigation_id, c.world_x, c.world_y) for c in inv_columns
        ),
    )
    grid = label_voxels(
        domain,
        h,
        sections,
        vertical_spacing_m=v,
        investigation_columns=inv_columns,
        honor_radius_m=honor,
        measured_pinch=args.measured_pinch,
    )
    meshes = [m for m in extract_body_solids(grid) if m.vertices and m.triangles]
    active = [(m.body_id, m.formation_id, m.vertices, m.triangles) for m in meshes]
    print(
        f"  built {len(meshes)} bodies, {sum(len(m.triangles) for m in meshes):,} triangles "
        f"in {time.perf_counter() - t0:.1f}s\n"
    )

    tally = {"exact": 0, "subsequence": 0, "wrong": 0}
    paired_n = 0
    uncovered = 0
    failures: list[tuple[str, str, list[str], list[str]]] = []
    for inv_id, x, y, authored in columns:
        stack = _compute_model_stack(x, y, active)
        if not stack:
            uncovered += 1
            continue
        verdict = _classify_column_in_drilled_interval(authored, stack)
        if inv_id in paired:
            paired_n += 1
            continue
        tally[verdict] += 1
        if verdict != "exact":
            failures.append(
                (
                    inv_id,
                    verdict,
                    [names.get(u[0], u[0][:6]) for u in authored],
                    [names.get(f, f[:6]) for f, _b, _t in _clip_to_drilled(authored, stack)],
                )
            )

    print("  within drilled ground:")
    print(f"    exact                  : {tally['exact']}")
    print(f"    subsequence (pinch)    : {tally['subsequence']}")
    print(f"    wrong (reorder/invent) : {tally['wrong']}")
    print(f"    paired station         : {paired_n}  (unscoreable)")
    print(f"    uncovered              : {uncovered}")
    for inv_id, verdict, authored, model in failures:
        print(f"\n    {verdict.upper()}  inv {inv_id}")
        print(f"      authored : {authored}")
        print(f"      model    : {model}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
