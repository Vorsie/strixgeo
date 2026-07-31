"""READ-ONLY A/B: dying at the midline versus reaching the section that contradicts it.

Owner ruling 2026-07-31 (docs/debt.md #256): a body extends from its drawn apex until
something contradicts it — a station, or a crossing section, that does not carry it.
Nothing else sets the distance. That replaces ``max(0, 2w - 1)``, which killed a one-sided
body at the equidistance midline, a place where nothing was ever measured.

Bodies necessarily reach FURTHER under the ruling, so the question this answers is what
that costs. Both arms run in one process on the stored generation's own payload, grid,
honour radius and aliases, so nothing but the rule differs:

* the drilled gate — the columns the model must reproduce, since they are logged ground;
* contact-depth error against those logs, which is where reaching too far would show;
* the label grid itself, cell by cell — how much ground changed hands, and in which
  direction.

Nothing is written. Guarded to the dev DB like the other voxel diagnostics.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
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
    _compute_model_stack,
    _confirm_db_target,
)


def _contact_errors(authored, stack) -> list[float]:
    """Depth error at each logged contact, in metres.

    Each contact in the log is matched to the nearest contact the model puts in the same
    column. Reaching too far shows up here before it shows up in the ordering verdict:
    a body that overstays moves the contact below it without changing the sequence.

    Parameters
    ----------
    authored : sequence
        The log's ``(formation, top, base)`` intervals.
    stack : sequence
        The model's ``(formation, base, top)`` intervals at that position.

    Returns
    -------
    list of float
        One absolute error per logged contact; empty when either side has none.
    """
    if not authored or not stack:
        return []
    logged = sorted({round(float(a[2]), 3) for a in authored})
    modelled = sorted({round(float(s[1]), 3) for s in stack})
    if not logged or not modelled:
        return []
    return [min(abs(c - m) for m in modelled) for c in logged]


def _describe(name: str, res: dict) -> None:
    """Print one arm's tallies and contact-error distribution."""
    errs = sorted(res["errors"])
    print(f"\n  --- {name} ---  [{res['seconds']:.1f}s]")
    print(f"    exact / subsequence / wrong : {res['exact']} / {res['sub']} / {res['wrong']}")
    print(f"    paired (unscoreable)        : {res['paired']}")
    print(f"    uncovered                   : {res['uncovered']}")
    print(f"    bodies / triangles          : {res['bodies']} / {res['tris']:,}")
    if errs:
        print(
            f"    contact err  median={np.median(errs):.3f}  "
            f"p90={np.percentile(errs, 90):.3f}  max={errs[-1]:.3f}  (n={len(errs)})"
        )


async def main() -> None:
    """Run both rules on identical inputs and print the delta."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.parse_args()

    print("\n=== REACH A/B — midline vs reach-to-contradicting-evidence (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        gen = (
            (
                await session.execute(
                    select(LithoBuildGenerationOrm).order_by(
                        LithoBuildGenerationOrm.created_at.desc()
                    )
                )
            )
            .scalars()
            .first()
        )
        if gen is None:
            raise SystemExit("ABORT: no stored build generation — click Build once.")
        picks = await LithoLayerRepository(session).load_body_picks(gen.model_id)

    aliases = dict(gen.body_aliases or {})
    as_drawn = apply_body_aliases(_sections_from_payload(gen.payload), aliases)
    inv_columns = _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases)
    sections, _moved, _shift = apply_true_column_positions(as_drawn, inv_columns)
    columns = _authored_columns(picks)

    h = float(gen.horizontal_spacing_m)
    v = float(gen.vertical_spacing_m)
    honor = float(gen.honor_radius_m)
    gx = np.arange(gen.grid_origin_x, gen.grid_origin_x + gen.grid_nx * h, h)[: gen.grid_nx]
    gy = np.arange(gen.grid_origin_y, gen.grid_origin_y + gen.grid_ny * h, h)[: gen.grid_ny]
    paired = paired_station_losers(inv_columns, gx, gy, honor)

    print(f"  generation {gen.id}")
    print(f"  grid {h} m / {v} m | honour {honor} m | {len(sections)} sections")

    domain = build_domain_from_sections(
        sections,
        investigation_positions=tuple(
            (c.investigation_id, c.world_x, c.world_y) for c in inv_columns
        ),
    )

    results: dict[str, dict] = {}
    grids: dict[str, np.ndarray] = {}
    for name, reach in (("BEFORE  midline", False), ("AFTER   reach", True)):
        t0 = time.perf_counter()
        grid = label_voxels(
            domain,
            h,
            sections,
            vertical_spacing_m=v,
            investigation_columns=inv_columns,
            honor_radius_m=honor,
            reach_to_evidence=reach,
        )
        meshes = [m for m in extract_body_solids(grid) if m.vertices and m.triangles]
        active = [(m.body_id, m.formation_id, m.vertices, m.triangles) for m in meshes]

        res = {
            "exact": 0,
            "sub": 0,
            "wrong": 0,
            "paired": 0,
            "uncovered": 0,
            "errors": [],
            "bodies": len(meshes),
            "tris": sum(len(m.triangles) for m in meshes),
            "seconds": time.perf_counter() - t0,
        }
        for inv_id, x, y, authored in columns:
            stack = _compute_model_stack(x, y, active)
            if not stack:
                res["uncovered"] += 1
                continue
            if inv_id in paired:
                res["paired"] += 1
                continue
            verdict = _classify_column_in_drilled_interval(authored, stack)
            res[
                "exact" if verdict == "exact" else "sub" if verdict == "subsequence" else "wrong"
            ] += 1
            res["errors"].extend(_contact_errors(authored, stack))
        results[name] = res
        grids[name] = np.asarray(grid.labels)
        _describe(name, res)

    before, after = results["BEFORE  midline"], results["AFTER   reach"]
    gb, ga = grids["BEFORE  midline"], grids["AFTER   reach"]

    print("\n  === DELTA (after - before) ===")
    for key, label in (
        ("exact", "exact"),
        ("sub", "subsequence"),
        ("wrong", "wrong"),
        ("uncovered", "uncovered"),
    ):
        print(
            f"    {label:22s}: {before[key]:3d} -> {after[key]:3d}"
            f"   ({after[key] - before[key]:+d})"
        )
    print(f"    {'bodies':22s}: {before['bodies']} -> {after['bodies']}")
    print(
        f"    {'triangles':22s}: {before['tris']:,} -> {after['tris']:,}   "
        f"({100.0 * (after['tris'] - before['tris']) / max(before['tris'], 1):+.1f} %)"
    )
    eb, ea = sorted(before["errors"]), sorted(after["errors"])
    if eb and ea:
        print(
            f"    {'contact err p90':22s}: {np.percentile(eb, 90):.3f} -> "
            f"{np.percentile(ea, 90):.3f} m"
        )
        print(f"    {'contact err median':22s}: {np.median(eb):.3f} -> {np.median(ea):.3f} m")
        print(f"    {'contact err max':22s}: {eb[-1]:.3f} -> {ea[-1]:.3f} m")

    if gb.shape == ga.shape:
        cell = h * h * v
        void_b, void_a = gb < 0, ga < 0
        filled = int(np.count_nonzero(void_b & ~void_a))
        emptied = int(np.count_nonzero(~void_b & void_a))
        moved = int(np.count_nonzero(~void_b & ~void_a & (gb != ga)))
        print("\n  === GROUND THAT CHANGED HANDS ===")
        print(f"    void -> filled        : {filled:,} cells  ({filled * cell:,.0f} m3)")
        print(f"    filled -> void        : {emptied:,} cells  ({emptied * cell:,.0f} m3)")
        print(f"    changed body          : {moved:,} cells  ({moved * cell:,.0f} m3)")
        labelled = int(np.count_nonzero(~void_b))
        print(f"    as a share of labelled: {100.0 * moved / max(labelled, 1):.2f} %")
    else:
        print("\n  grids differ in shape — not comparable cell by cell")


if __name__ == "__main__":
    asyncio.run(main())
