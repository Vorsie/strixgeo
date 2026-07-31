"""READ-ONLY A/B: the assumed midline pinch vs the measured one.

Both arms run the FULL pipeline (``build_domain_from_sections`` → ``label_voxels`` →
``extract_body_solids``) on IDENTICAL inputs — the same stored partition payload, the
same picks, the same surfaces, the same grid — and differ in exactly one thing:

* ``BEFORE`` — a one-sided body thins by ``max(0, 2w - 1)``, reaching zero at the
  equidistance midline, which is what the builder assumed before #256.
* ``AFTER``  — it thins toward where the 2-D partition MEASURES it to end.

BEFORE is produced by making ``body_terminations`` return nothing, which is exactly
the fallback ``_blend_stacks`` keeps for a body measured to die nowhere. So the two
arms differ only in the evidence available, not in the code path.

Each arm is scored with ``eval_strat_fidelity``'s own functions, so the verdicts are
directly comparable to the acceptance gate's numbers.

Nothing is persisted: the meshes stay in memory and the DB is only read.

Usage
-----
    uv run python scripts/diag_pinch_ab.py
    uv run python scripts/diag_pinch_ab.py --vertical 0.25
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

from sqlalchemy import select  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _apply_aliases_to_columns,
    _investigation_columns_from_picks,
)
from groundmodel.domain.services.voxel_litho import label_voxels as label_module  # noqa: E402
from groundmodel.domain.services.voxel_litho.build_domain_from_sections import (  # noqa: E402
    build_domain_from_sections,
)
from groundmodel.domain.services.voxel_litho.extract_body_solids import (  # noqa: E402
    extract_body_solids,
)
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (  # noqa: E402
    apply_body_aliases,
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
from scripts.diag_voxel_fidelity_delta import _score, _summarise  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _authored_columns,
    _confirm_db_target,
    _load_formation_names,
)

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")


async def main() -> None:
    """Run both arms on identical inputs and print the fidelity delta."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--horizontal", type=float, default=None)
    ap.add_argument("--vertical", type=float, default=None)
    args = ap.parse_args()

    print("\n=== PINCH A/B — assumed midline vs measured end (READ-ONLY) ===\n")
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
        await _load_formation_names(session, args.model_id)
        picks = await LithoLayerRepository(session).load_body_picks(args.model_id)
    # Take the grid and honour settings from the STORED GENERATION, not from
    # view_state: the generation records what the build actually ran with, and a
    # harness that guesses them is not reproducing the build it claims to A/B.
    h = args.horizontal if args.horizontal is not None else float(gen.horizontal_spacing_m)
    v = args.vertical if args.vertical is not None else float(gen.vertical_spacing_m)
    honor_radius = float(gen.honor_radius_m)

    aliases = dict(gen.body_aliases or {})
    inv_columns = _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases)
    # The builder measures the FOOTPRINT from the sections as drawn and LABELS from
    # the re-seated ones. Using the seated sections for both moved the grid from
    # 326 to 305 cells in y, which is a different build.
    sections_as_drawn = apply_body_aliases(_sections_from_payload(gen.payload), aliases)
    sections, _moved, _shift = apply_true_column_positions(sections_as_drawn, inv_columns)
    columns = _authored_columns(picks)
    classified = sum(1 for s in sections for r in s.regions if r.kind is not None)
    total_regions = sum(len(s.regions) for s in sections)
    # No geo surfaces: #254 decoupled geology, and build_voxel_litho_model passes
    # none. Loading them here would send both arms down the dead geo-bounded path
    # (_column_stack_geo), which never calls _stack_at — the two arms then come out
    # byte-identical and the A/B silently measures nothing.
    print(
        f"  generation {gen.created_at} | {len(sections)} sections | "
        f"{classified}/{total_regions} regions classified | grid {h} m / {v} m | "
        f"honor {honor_radius} m"
    )
    print(
        f"  the stored build recorded {gen.grid_nx}x{gen.grid_ny}x{gen.grid_nz}, "
        f"{gen.bodies_built} bodies, {gen.triangles:,} triangles — BEFORE must match it"
    )
    if classified == 0:
        raise SystemExit(
            "ABORT: the stored payload carries no classification, so both arms would "
            "be identical. Rebuild from the app first."
        )

    positions = tuple((c.investigation_id, c.world_x, c.world_y) for c in inv_columns)
    real_terminations = label_module.body_terminations

    results: dict[str, dict] = {}
    for name in ("BEFORE", "AFTER"):
        # BEFORE takes the fallback path _blend_stacks keeps for a body measured to
        # die nowhere, so the arms differ only in the evidence, not in the code.
        label_module.body_terminations = (lambda _s: {}) if name == "BEFORE" else real_terminations
        try:
            t0 = time.perf_counter()
            domain = build_domain_from_sections(
                sections_as_drawn, investigation_positions=positions
            )
            grid = label_voxels_arm = label_module.label_voxels(
                domain,
                h,
                sections,
                vertical_spacing_m=v,
                investigation_columns=inv_columns,
                honor_radius_m=honor_radius,
            )
            meshes = [m for m in extract_body_solids(grid) if m.vertices and m.triangles]
            res = _score(columns, meshes)
            res["bodies"] = len(meshes)
            res["tris"] = sum(len(m.triangles) for m in meshes)
            results[name] = res
            _summarise(
                name,
                res,
                time.perf_counter() - t0,
                (len(label_voxels_arm.gx), len(label_voxels_arm.gy), len(label_voxels_arm.gz)),
            )
            print(f"    bodies={len(meshes)}  triangles={res['tris']:,}")
        finally:
            label_module.body_terminations = real_terminations

    b, a = results["BEFORE"], results["AFTER"]
    print("\n  === DELTA (AFTER - BEFORE) ===")
    for key in ("covered", "uncovered", "exact", "subsequence", "wrong"):
        print(f"    {key:22s}: {b[key]:3d} -> {a[key]:3d}   ({a[key] - b[key]:+d})")
    print(f"    {'bodies':22s}: {b['bodies']:3d} -> {a['bodies']:3d}")
    print(f"    {'triangles':22s}: {b['tris']:,} -> {a['tris']:,}")
    print(f"    still uncovered AFTER : {a['uncovered_ids']}")
    print(f"    still wrong AFTER     : {a['wrong_ids']}")

    print("\n=== A/B COMPLETE ===\n")


if __name__ == "__main__":
    asyncio.run(main())
