"""READ-ONLY: does the 3-D voxel model reproduce the 2-D Fill-bands partition?

Owner, 2026-07-29: *"the voxel should almost be the same as the zones in the fill
bands tool no? Can't you check that (only a bit more blocky)"* — yes, and this is
the check.

The 2-D section partition (``computeSectionFill``, what Fill bands draws) is the
SOURCE the voxel labeller works from. So sampling the built model along a section
must return the same lithology the partition shows at that point, and the only
legitimate difference is voxel blockiness: a contact can only land on a voxel
face, so points within half a voxel of a 2-D contact may fall on the other side.

This is a far stronger instrument than the per-column fidelity gate, which only
looks at 58 investigation columns and says nothing about the area between them —
where every defect this campaign has chased actually lived.

Method
------
For every gap of every section, sample a grid in (gap-local fraction, elevation).
At each sample:

* the 2-D answer is the region whose polygon contains the point;
* the 3-D answer is the model interval containing that elevation at the sample's
  world position, interpolated between the gap's two column positions.

Points are then bucketed:

``agree``            both say the same formation
``blocky``           they differ, but the sample sits within half a voxel of a
                     2-D contact — the expected discretisation
``disagree``         they differ well away from any contact — a real divergence
``model void``       the partition fills it but the model has nothing there
``outside``          the partition has no region there (nothing to compare)

The inputs come from the STORED BUILD GENERATION, so this reports on the build
the owner actually looked at. It used to read a hand-captured payload file, which
silently described a different model whenever the live build had moved on (14
sections against the file's 16).

Nothing is written. Reads only, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/diag_partition_vs_voxel.py
    uv run python scripts/diag_partition_vs_voxel.py --step-fraction 0.05 --step-elev 0.5
"""

from __future__ import annotations

import argparse
import asyncio
import math
import sys
from collections import Counter
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
from groundmodel.domain.services.voxel_litho.voxel_types import RegionInput  # noqa: E402
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
from scripts.eval_strat_fidelity import (  # noqa: E402
    _compute_model_stack,
    _confirm_db_target,
)

_DEFAULT_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")


def _point_in_region(region: RegionInput, fraction: float, elevation: float) -> bool:
    """Even-odd point-in-polygon over a region's ``(fraction, elevation)`` ring."""
    inside = False
    poly = region.polygon
    n = len(poly)
    for i in range(n):
        f_a, e_a = poly[i]
        f_b, e_b = poly[(i - 1) % n]
        if (e_a > elevation) != (e_b > elevation) and fraction < (f_b - f_a) * (elevation - e_a) / (
            e_b - e_a
        ) + f_a:
            inside = not inside
    return inside


def _spans_at_fraction(region: RegionInput, fraction: float) -> list[tuple[float, float]]:
    """Elevation intervals a region covers on the vertical line at ``fraction``.

    Even-odd pairing of the ring's crossings, exact for a simple ring.
    """
    crossings: list[float] = []
    poly = region.polygon
    for i in range(len(poly)):
        f_a, e_a = poly[i]
        f_b, e_b = poly[(i + 1) % len(poly)]
        if f_a == f_b:
            continue
        lo, hi = (f_a, f_b) if f_a < f_b else (f_b, f_a)
        if not (lo <= fraction < hi):
            continue
        crossings.append(e_a + (e_b - e_a) * ((fraction - f_a) / (f_b - f_a)))
    crossings.sort()
    return [
        (crossings[i], crossings[i + 1])
        for i in range(0, len(crossings) - 1, 2)
        if crossings[i + 1] > crossings[i]
    ]


def _distance_to_formation(
    regions: list[RegionInput], fraction: float, elevation: float, formation_id: str
) -> float:
    """Vertical distance to the nearest region of ``formation_id`` at ``fraction``.

    THE blockiness test. When the 2-D says A and the 3-D says B at a point, the
    difference is discretisation only if B genuinely exists within half a voxel
    vertically — that is a contact landing one voxel off. If the nearest B is
    further than that, the 3-D put B somewhere the partition has no B at all,
    which is invention, not blockiness.

    The previous test measured distance to the nearest edge of ANY region in the
    gap. With a dozen regions stacked in one span, contacts are everywhere and
    almost every wrong voxel sat within 12.5 cm of SOME line, so it forgave 160
    of 167 real disagreements in a single gap and reported the model as 0.2 %
    wrong. A metric that excuses almost everything is worse than none.

    Returns ``inf`` when the gap contains no region of that formation at all.
    """
    best = float("inf")
    for region in regions:
        if region.formation_id != formation_id:
            continue
        for low, high in _spans_at_fraction(region, fraction):
            if low <= elevation <= high:
                return 0.0
            best = min(best, low - elevation if elevation < low else elevation - high)
    return best


def _distance_to_nearest_contact(
    regions: list[RegionInput], fraction: float, elevation: float
) -> float:
    """Vertical distance to the nearest 2-D region boundary at this fraction.

    Only the vertical distance matters for the blockiness allowance: a voxel
    discretises a contact in elevation, so a sample near a horizontal boundary is
    the one that can legitimately land on the other side.
    """
    best = float("inf")
    for region in regions:
        poly = region.polygon
        n = len(poly)
        for i in range(n):
            f_a, e_a = poly[i]
            f_b, e_b = poly[(i + 1) % n]
            lo, hi = (f_a, f_b) if f_a < f_b else (f_b, f_a)
            if not (lo <= fraction <= hi) or f_a == f_b:
                continue
            edge_elev = e_a + (e_b - e_a) * ((fraction - f_a) / (f_b - f_a))
            best = min(best, abs(edge_elev - elevation))
    return best


async def main() -> None:
    """Sample every section gap and compare the 2-D partition to the 3-D model."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=_DEFAULT_MODEL_ID)
    ap.add_argument("--generation", type=UUID, default=None)
    # Sampling steps along the gap in METRES, not in gap-local fraction.
    # Stepping by fraction gives every gap the same number of samples whatever
    # its width, so a 0.4 m pair gap is sampled as densely as a 100 m span and
    # dominates any percentage by orders of magnitude per unit area. That bias
    # produced a confident and wrong conclusion once already.
    ap.add_argument("--step-m", type=float, default=1.0)
    ap.add_argument("--step-elev", type=float, default=0.5)
    args = ap.parse_args()

    print("\n=== 2-D PARTITION vs 3-D VOXEL MODEL (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        model = await session.get(GeologicalModelOrm, args.model_id)
        if model is None:
            raise SystemExit(f"ABORT: model {args.model_id} not found.")
        picks = await LithoLayerRepository(session).load_body_picks(args.model_id)
        geo_surfaces: tuple = ()
        if model.parent_model_id is not None:
            geo_surfaces = await load_geo_surfaces(session, model.parent_model_id)

        gen_stmt = select(LithoBuildGenerationOrm).order_by(
            LithoBuildGenerationOrm.created_at.desc()
        )
        if args.generation:
            gen_stmt = gen_stmt.where(LithoBuildGenerationOrm.id == args.generation)
        generation = (await session.execute(gen_stmt)).scalars().first()
        if generation is None:
            raise SystemExit("ABORT: no build generation stored — click Build once.")

    # Settings from the GENERATION, not the live view-state: the point is to
    # measure the build that was made, not one made with today's preferences.
    snap = generation.litho_snap_tolerance_m
    horizontal = generation.horizontal_spacing_m
    vertical = generation.vertical_spacing_m
    honor_radius = generation.honor_radius_m

    raw = _sections_from_payload(generation.payload)
    aliases = dict(generation.body_aliases or {})
    aliased = apply_body_aliases(raw, aliases)
    columns = _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases)
    seated, moved, _shift = apply_true_column_positions(aliased, columns)
    print(
        f"  spacing {horizontal} m / {vertical} m   honor radius {honor_radius} m   "
        f"{moved} column(s) re-seated\n"
    )

    domain = build_domain_from_sections(
        aliased,
        investigation_positions=tuple((c.investigation_id, c.world_x, c.world_y) for c in columns),
    )
    grid = label_voxels(
        domain,
        horizontal,
        seated,
        vertical_spacing_m=vertical,
        investigation_columns=columns,
        geo_surfaces=geo_surfaces,
        litho_snap_tolerance_m=snap,
        honor_radius_m=honor_radius,
    )
    active = [
        (m.body_id, m.formation_id, m.vertices, m.triangles)
        for m in extract_body_solids(grid)
        if m.vertices and m.triangles
    ]
    print(f"  model rebuilt in memory: {len(active)} bodies\n")

    # Half a voxel is the honest blockiness allowance: a contact can only land on
    # a voxel face, so a sample nearer than that to a 2-D contact may legitimately
    # fall on the other side of it.
    blocky_tol = vertical / 2.0

    totals: Counter[str] = Counter()
    worst: list[tuple[int, int, str]] = []

    for si, section in enumerate(seated):
        sec_counts: Counter[str] = Counter()
        for gap in range(len(section.columns) - 1):
            regions = [r for r in section.regions if r.gap_index == gap]
            if not regions:
                continue
            left = section.columns[gap]
            right = section.columns[gap + 1]
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
                elevation = lo + args.step_elev / 2.0
                while elevation < hi:
                    twod = next(
                        (r.formation_id for r in regions if _point_in_region(r, frac, elevation)),
                        None,
                    )
                    if twod is None:
                        sec_counts["outside"] += 1
                    else:
                        threed = next(
                            (f for f, base, top in stack if base <= elevation < top), None
                        )
                        if threed is None:
                            sec_counts["model void"] += 1
                        elif threed == twod:
                            sec_counts["agree"] += 1
                        elif (
                            _distance_to_formation(regions, frac, elevation, threed)
                            <= blocky_tol
                        ):
                            sec_counts["blocky"] += 1
                        else:
                            sec_counts["disagree"] += 1
                    elevation += args.step_elev
                frac += frac_step

        totals.update(sec_counts)
        compared = sum(sec_counts[k] for k in ("agree", "blocky", "disagree", "model void"))
        if compared:
            bad = sec_counts["disagree"] + sec_counts["model void"]
            worst.append((bad, compared, f"section #{si} ({len(section.columns)} columns)"))

    compared = sum(totals[k] for k in ("agree", "blocky", "disagree", "model void"))
    print("  --- all sections ---")
    for key in ("agree", "blocky", "disagree", "model void"):
        pct = 100.0 * totals[key] / compared if compared else 0.0
        print(f"      {key:<12} {totals[key]:>8,}  ({pct:5.1f} %)")
    print(f"      {'outside':<12} {totals['outside']:>8,}  (no 2-D region — not compared)")
    good = totals["agree"] + totals["blocky"]
    print(
        f"\n  The model reproduces Fill bands at {good:,}/{compared:,} "
        f"({100.0 * good / compared if compared else 0:.1f} %) of sampled points, "
        f"counting a contact within {blocky_tol} m as blockiness."
    )
    print("\n  worst sections by (disagree + void) share:")
    for bad, tot, label in sorted(worst, key=lambda w: -w[0] / max(w[1], 1))[:6]:
        print(f"      {100.0 * bad / tot:5.1f} %   {bad:>6,}/{tot:<7,}  {label}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
