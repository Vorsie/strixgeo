"""READ-ONLY: cluster the points where the 3-D model contradicts the 2-D partition.

``diag_partition_vs_voxel.py`` reports HOW MUCH the built model disagrees with the
Fill-bands partition it was labelled from (97.8 % agreement on the dev model, 2 %
genuine disagreement). This script asks WHERE and WHY, by recording every
disagreeing sample with its context and then aggregating it several ways:

* which lithology became which — a dominant transition points at one mechanism;
* which section and which gap — is it spread evenly or concentrated?
* how far the sample sits from the nearest 2-D contact — near-contact points are
  discretisation, far-from-contact points are not;
* how far it sits from the nearest investigation — a defect that clusters AT the
  honored corridors is a different bug from one that clusters mid-gap;
* where in the gap it sits — column edge versus middle.

The inputs come from the stored build generation, so this reports on the build the
owner actually looked at rather than on a hand-captured payload.

Nothing is written. Reads only, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/diag_cluster_partition_disagreements.py
    uv run python scripts/diag_cluster_partition_disagreements.py --step-fraction 0.05
"""

from __future__ import annotations

import argparse
import asyncio
import math
import sys
from collections import Counter, defaultdict
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
from groundmodel.application.load_geo_surfaces import load_geo_surfaces  # noqa: E402
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
from groundmodel.domain.services.voxel_litho.true_column_positions import (  # noqa: E402
    apply_true_column_positions,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (  # noqa: E402
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_build_generations import _sections_from_payload  # noqa: E402
from scripts.diag_partition_vs_voxel import (  # noqa: E402
    _distance_to_formation,
    _distance_to_nearest_contact,
    _point_in_region,
)
from scripts.eval_strat_fidelity import (  # noqa: E402
    _compute_model_stack,
    _confirm_db_target,
    _load_formation_names,
)


def _bucket(value: float, edges: tuple[float, ...]) -> str:
    """Label ``value`` by the first edge it falls under."""
    for edge in edges:
        if value < edge:
            return f"<{edge:g}"
    return f">={edges[-1]:g}"


async def main() -> None:
    """Rebuild the stored generation, then cluster every disagreeing sample."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--generation", type=UUID, default=None)
    # Sampling steps along the gap in METRES, not in gap-local fraction.
    # Stepping by fraction gives every gap the same number of samples whatever
    # its width, so a 0.4 m pair gap is sampled as densely as a 100 m span and
    # dominates any percentage by orders of magnitude per unit area. That bias
    # produced a confident and wrong conclusion once already.
    ap.add_argument("--step-m", type=float, default=1.0)
    ap.add_argument("--step-elev", type=float, default=0.5)
    args = ap.parse_args()

    print("\n=== CLUSTERING THE PARTITION/MODEL DISAGREEMENTS (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        stmt = select(LithoBuildGenerationOrm).order_by(LithoBuildGenerationOrm.created_at.desc())
        if args.generation:
            stmt = stmt.where(LithoBuildGenerationOrm.id == args.generation)
        generation = (await session.execute(stmt)).scalars().first()
        if generation is None:
            raise SystemExit("ABORT: no build generation stored — click Build once.")

        model = await session.get(GeologicalModelOrm, generation.model_id)
        names = await _load_formation_names(session, generation.model_id)
        picks = await LithoLayerRepository(session).load_body_picks(generation.model_id)
        geo_surfaces: tuple = ()
        if model is not None and model.parent_model_id is not None:
            geo_surfaces = await load_geo_surfaces(session, model.parent_model_id)

        inv_name: dict[str, str] = {}
        inv_xy: list[tuple[str, float, float]] = []
        for orm in (CptOrm, BoreholeOrm):
            for r in (
                await session.execute(
                    select(orm.id, orm.name, orm.location_x, orm.location_y).where(
                        orm.app_project_id == model.app_project_id
                    )
                )
            ).all():
                inv_name[str(r.id)] = r.name
                if r.location_x is not None:
                    inv_xy.append((r.name, float(r.location_x), float(r.location_y)))

        section_names: dict[tuple[int, int], str] = {}
        for r in (
            await session.execute(
                select(
                    CrossSectionOrm.name,
                    CrossSectionOrm.start_x,
                    CrossSectionOrm.start_y,
                ).where(CrossSectionOrm.app_project_id == model.app_project_id)
            )
        ).all():
            section_names[(round(float(r.start_x)), round(float(r.start_y)))] = r.name

    print(f"  generation {generation.id}  {generation.created_at:%Y-%m-%d %H:%M}")
    print(
        f"  {generation.horizontal_spacing_m} m / {generation.vertical_spacing_m} m, "
        f"honor {generation.honor_radius_m} m\n"
    )

    received = _sections_from_payload(generation.payload)
    aliases = dict(generation.body_aliases or {})
    aliased = apply_body_aliases(received, aliases)
    columns = _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases)
    seated, _moved, _shift = apply_true_column_positions(aliased, columns)
    domain = build_domain_from_sections(
        aliased,
        investigation_positions=tuple((c.investigation_id, c.world_x, c.world_y) for c in columns),
    )
    grid = label_voxels(
        domain,
        generation.horizontal_spacing_m,
        seated,
        vertical_spacing_m=generation.vertical_spacing_m,
        investigation_columns=columns,
        geo_surfaces=geo_surfaces,
        litho_snap_tolerance_m=generation.litho_snap_tolerance_m,
        honor_radius_m=generation.honor_radius_m,
    )
    active = [
        (m.body_id, m.formation_id, m.vertices, m.triangles)
        for m in extract_body_solids(grid)
        if m.vertices and m.triangles
    ]
    print(f"  rebuilt {len(active)} bodies; sampling…\n")

    blocky_tol = generation.vertical_spacing_m / 2.0
    by_transition: Counter[str] = Counter()
    by_section: Counter[str] = Counter()
    by_gap: Counter[str] = Counter()
    by_contact_dist: Counter[str] = Counter()
    by_inv_dist: Counter[str] = Counter()
    by_fraction: Counter[str] = Counter()
    # The decisive one: how WIDE is the gap the sample sits in, measured in
    # voxels?  A gap between two investigations closer than the grid can resolve
    # has no room to hold the 2-D geometry drawn across it.
    by_gap_width: Counter[str] = Counter()
    total_compared = 0
    examples: dict[str, list[str]] = defaultdict(list)

    for section in seated:
        sec_label = section_names.get((round(section.start_x), round(section.start_y)), "section?")
        for gap in range(len(section.columns) - 1):
            regions = [r for r in section.regions if r.gap_index == gap]
            if not regions:
                continue
            left = section.columns[gap]
            right = section.columns[gap + 1]
            left_name = inv_name.get(left.investigation_id, "?")
            right_name = inv_name.get(right.investigation_id, "?")
            gap_width_m = math.hypot(
                right.world_x - left.world_x, right.world_y - left.world_y
            )
            width_label = (
                f"<1 voxel ({generation.horizontal_spacing_m} m)"
                if gap_width_m < generation.horizontal_spacing_m
                else "1-2 voxels"
                if gap_width_m < 2 * generation.horizontal_spacing_m
                else "2-5 voxels"
                if gap_width_m < 5 * generation.horizontal_spacing_m
                else ">=5 voxels"
            )
            elevs = [e for r in regions for _f, e in r.polygon]
            lo, hi = min(elevs), max(elevs)

            gap_m = math.hypot(right.world_x - left.world_x, right.world_y - left.world_y)
            steps = max(1, int(round(gap_m / args.step_m)))
            frac_step = 1.0 / steps
            frac = frac_step / 2.0
            while frac < 1.0:
                x = left.world_x + (right.world_x - left.world_x) * frac
                y = left.world_y + (right.world_y - left.world_y) * frac
                stack = _compute_model_stack(x, y, active)
                nearest_inv = min((math.hypot(ix - x, iy - y), nm) for nm, ix, iy in inv_xy)
                elevation = lo + args.step_elev / 2.0
                while elevation < hi:
                    twod = next(
                        (r.formation_id for r in regions if _point_in_region(r, frac, elevation)),
                        None,
                    )
                    if twod is not None:
                        total_compared += 1
                        threed = next(
                            (f for f, base, top in stack if base <= elevation < top), None
                        )
                        contact_d = _distance_to_nearest_contact(regions, frac, elevation)
                        # Blockiness is judged against the DISPUTED formation:
                        # the 3-D's answer must genuinely exist within half a
                        # voxel, or it is invention (see _distance_to_formation).
                        own_d = (
                            _distance_to_formation(regions, frac, elevation, threed)
                            if threed is not None
                            else float("inf")
                        )
                        if threed is not None and threed != twod and own_d > blocky_tol:
                            a = names.get(twod, twod[:6])
                            b = names.get(threed, threed[:6])
                            by_transition[f"{a} -> {b}"] += 1
                            by_section[sec_label] += 1
                            key = f"{sec_label}: {left_name} .. {right_name}"
                            by_gap[key] += 1
                            by_contact_dist[_bucket(contact_d, (0.25, 0.5, 1.0, 2.0))] += 1
                            by_inv_dist[_bucket(nearest_inv[0], (2.0, 5.0, 10.0, 25.0))] += 1
                            by_fraction[
                                "column edge (<0.15 or >0.85)"
                                if frac < 0.15 or frac > 0.85
                                else "mid-gap"
                            ] += 1
                            by_gap_width[width_label] += 1
                            if len(examples[f"{a} -> {b}"]) < 3:
                                examples[f"{a} -> {b}"].append(
                                    f"{key} f={frac:.2f} elev={elevation:.2f} "
                                    f"contact {contact_d:.2f} m, nearest test "
                                    f"{nearest_inv[1]} {nearest_inv[0]:.1f} m"
                                )
                    elevation += args.step_elev
                frac += frac_step

    total_bad = sum(by_transition.values())
    print(
        f"  {total_bad:,} disagreeing samples out of {total_compared:,} compared "
        f"({100.0 * total_bad / max(total_compared, 1):.1f} %)\n"
    )

    def _show(title: str, counter: Counter[str], limit: int = 8) -> None:
        print(f"  --- {title} ---")
        for key, n in counter.most_common(limit):
            print(f"      {n:>6,}  ({100.0 * n / max(total_bad, 1):5.1f} %)  {key}")
        print()

    _show("which lithology became which", by_transition)
    _show("distance to the nearest 2-D contact", by_contact_dist, 6)
    _show("distance to the nearest investigation", by_inv_dist, 6)
    _show("position within the gap", by_fraction, 4)
    _show("WIDTH OF THE GAP THE SAMPLE SITS IN", by_gap_width, 6)
    _show("by section", by_section)
    _show("worst gaps", by_gap, 10)

    print("  --- examples of the top transitions ---")
    for transition, _n in by_transition.most_common(3):
        print(f"      {transition}")
        for line in examples[transition]:
            print(f"          {line}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
