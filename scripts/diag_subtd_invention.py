"""READ-ONLY: does the 3-D model invent material below a shallow test's TD?

Owner ruling, 2026-07-30: *"the voids below td are always filled through
correlations from other tests the left or right (as in fill bands) if that is not
the case then you leave it unkown"*.

The 2-D engine already obeys that rule. It is correlate-or-gap — uncapped
``emitGap``, no deep-to-deep substrate (reverted 2026-07-10 for flooding clay
across pinch-outs, deleted 2026-07-12, debt #237.5). So below a shallow column's
total depth the partition carries regions **only** where a tie reaches across;
otherwise it stops at the TD and the ground below is unknown.

This checks whether the 3-D model respects that. For every gap whose two columns
differ meaningfully in depth it asks two questions:

1. Does the 2-D partition reach below the shallow column's TD on that column's own
   side? If yes the material there is AUTHORED — a tie crosses, and the band
   follows it. Nothing to answer for.
2. If the partition stops at the TD, does the built model carry material below it
   anyway? That is INVENTED — the partition said unknown.

For every invented site it also reports the distance to the nearest section that
does author material at that depth and position, next to the distance of the
section whose own partition said unknown. "Some section somewhere has clay at that
depth" is not authorisation for material here; the import distance is the number
that decides whether it is a plausible interpolation or a fetch from across the
site.

The model is read from the PERSISTED body solids, so this reports on the build the
owner actually looked at — not on an offline re-label that may have drifted from it.

Nothing is written. Reads only, behind the usual dev-DB guard.

Usage
-----
    uv run python scripts/diag_subtd_invention.py
    uv run python scripts/diag_subtd_invention.py --min-depth-diff 2.0
    uv run python scripts/diag_subtd_invention.py --probe-fraction 0.3 --quiet
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
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
from groundmodel.domain.services.voxel_litho.label_voxels import (  # noqa: E402
    _project_to_section_fence,
    _section_stack_at,
)
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (  # noqa: E402
    apply_body_aliases,
)
from groundmodel.domain.services.voxel_litho.true_column_positions import (  # noqa: E402
    apply_true_column_positions,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
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
    _load_formation_names,
    _load_solids,
)

#: Elevation slack when deciding "the partition stops AT the TD" (m).  The 2-D
#: engine lands on the TD to the millimetre, so this only absorbs float noise.
_AT_TD_TOL_M = 0.05
#: Fractional tolerance for "this polygon vertex sits on the column edge".
_EDGE_FRAC_TOL = 0.02


def _shallow_side(partition_floor: float | None, shallow_td: float) -> str:
    """Classify one gap-side as authored-below-TD or stopping at the TD.

    Parameters
    ----------
    partition_floor : float or None
        Deepest 2-D partition elevation on the shallow column's own edge, or
        ``None`` when no region vertex sits on that edge.
    shallow_td : float
        The shallow column's deepest logged elevation (mTAW).

    Returns
    -------
    str
        ``"authored"`` when the partition reaches below the TD, ``"at-td"`` when
        it stops there, ``"no-edge"`` when the side could not be read.
    """
    if partition_floor is None:
        return "no-edge"
    return "at-td" if shallow_td - partition_floor <= _AT_TD_TOL_M else "authored"


async def main() -> None:
    """Report authored vs invented sub-TD material for the latest build."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model-id", type=UUID, default=None, help="litho model (default: latest)")
    ap.add_argument(
        "--min-depth-diff",
        type=float,
        default=1.0,
        help="only look at gaps whose two columns differ by at least this many metres",
    )
    ap.add_argument(
        "--probe-fraction",
        type=float,
        default=0.15,
        help="sample this far into the gap from the shallow column (0-1)",
    )
    ap.add_argument(
        "--min-report",
        type=float,
        default=0.25,
        help="ignore invented material thinner than this (m) — below it is a voxel edge",
    )
    ap.add_argument("--quiet", action="store_true", help="summary only, no per-site lines")
    args = ap.parse_args()

    print("\n=== SUB-TD INVENTION: DOES THE MODEL FILL WHAT THE PARTITION LEFT UNKNOWN? ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        query = select(LithoBuildGenerationOrm).order_by(LithoBuildGenerationOrm.created_at.desc())
        if args.model_id is not None:
            query = query.where(LithoBuildGenerationOrm.model_id == args.model_id)
        gen = (await session.execute(query)).scalars().first()
        if gen is None:
            raise SystemExit("ABORT: no stored build generation — click Build first.")

        picks = await LithoLayerRepository(session).load_body_picks(gen.model_id)
        names = await _load_formation_names(session, gen.model_id)
        solids = await _load_solids(session, gen.model_id)
        inv_names: dict[str, str] = {}
        for orm in (CptOrm, BoreholeOrm):
            for row in (await session.execute(select(orm.id, orm.name))).all():
                inv_names[str(row.id)] = row.name

    active = [(b, f, v, t) for b, f, v, t, flagged, _s in solids if v and t and not flagged]
    print(
        f"  generation {str(gen.id)[:18]}   model {str(gen.model_id)[:8]}   "
        f"{len(active)} active body solids\n"
    )

    # Each investigation's deepest logged elevation — its TD in mTAW.
    td: dict[str, float] = {}
    for pick in picks:
        base_elev = pick.surface_elev_m - pick.base_depth_m
        if pick.investigation_id not in td or base_elev < td[pick.investigation_id]:
            td[pick.investigation_id] = base_elev

    # Rebuild the exact geometry the labeller saw: body aliases, then the true
    # column positions (the solids live in true-position space, not as-drawn).
    aliased = apply_body_aliases(_sections_from_payload(gen.payload), dict(gen.body_aliases or {}))
    columns = _apply_aliases_to_columns(
        _investigation_columns_from_picks(picks), dict(gen.body_aliases or {})
    )
    seated, _moved, _shift = apply_true_column_positions(aliased, columns)

    authored = 0
    at_td = 0
    findings: list[tuple[float, str, str | None, float, list[str], float | None, float | None]] = []

    for section in seated:
        cols = section.columns
        for gap in range(len(cols) - 1):
            regions = [r for r in section.regions if r.gap_index == gap]
            if not regions:
                continue
            left, right = cols[gap], cols[gap + 1]
            left_td = td.get(left.investigation_id)
            right_td = td.get(right.investigation_id)
            if left_td is None or right_td is None:
                continue
            if abs(left_td - right_td) < args.min_depth_diff:
                continue

            shallow_is_left = left_td > right_td
            shallow = left if shallow_is_left else right
            shallow_td = left_td if shallow_is_left else right_td
            edge_frac = 0.0 if shallow_is_left else 1.0

            floor = None
            for region in regions:
                for frac, elev in region.polygon:
                    if abs(frac - edge_frac) < _EDGE_FRAC_TOL and (floor is None or elev < floor):
                        floor = elev
            verdict = _shallow_side(floor, shallow_td)
            if verdict == "no-edge":
                continue
            if verdict == "authored":
                authored += 1
                continue
            at_td += 1

            # The partition says unknown here.  Does the model agree?
            probe = args.probe_fraction if shallow_is_left else 1.0 - args.probe_fraction
            x = left.world_x + (right.world_x - left.world_x) * probe
            y = left.world_y + (right.world_y - left.world_y) * probe
            below = [
                base for _f, base, _t in _compute_model_stack(x, y, active) if base < shallow_td
            ]
            if not below:
                continue
            reach = shallow_td - min(below)
            if reach < args.min_report:
                continue
            lithos = sorted(
                {
                    names.get(f, "?")
                    for f, base, top in _compute_model_stack(x, y, active)
                    if base < shallow_td
                }
            )

            # Which section DOES author material this deep at this point, and how
            # far away is the nearest one?  Reported next to the distance of the
            # section that said unknown, which is normally 0.0 m.
            nearest_perp: float | None = None
            nearest_label: str | None = None
            own_perp: float | None = None
            for other in seated:
                other_gap, other_frac, perp, _fx, _fy = _project_to_section_fence(other, x, y)
                if other is section:
                    own_perp = perp
                stack = _section_stack_at(other, other_gap, other_frac)
                if not any(e.base_elev < shallow_td for e in stack):
                    continue
                if nearest_perp is not None and perp >= nearest_perp:
                    continue
                ids = [inv_names.get(c.investigation_id, "?") for c in other.columns]
                nearest_perp = perp
                nearest_label = (
                    f"{ids[other_gap]}..{ids[other_gap + 1]}"
                    if 0 <= other_gap < len(ids) - 1
                    else f"{len(ids)} cols"
                )

            findings.append(
                (
                    reach,
                    inv_names.get(shallow.investigation_id, "?"),
                    nearest_label,
                    shallow_td,
                    lithos,
                    nearest_perp,
                    own_perp,
                )
            )

    findings.sort(key=lambda f: -f[0])
    print(
        f"  {authored:>3} gap-side(s) where the partition REACHES below the shallow TD (authored)"
    )
    print(f"  {at_td:>3} gap-side(s) where the partition STOPS at the shallow TD (unknown)")
    print(
        f"  {len(findings):>3} of those carry model material below it — INVENTED "
        f"(probed {args.probe_fraction:.0%} into the gap, >= {args.min_report} m)\n"
    )

    if findings and not args.quiet:
        print(
            f"      {'shallow column':<22} {'TD':>9}  {'invented':>9}  {'import':>8}  "
            f"{'own sec':>8}   litho / nearest authorising section"
        )
        for reach, name, label, shallow_td, lithos, perp, own in findings:
            print(
                f"      {name:<22} {shallow_td:>9.3f}  {reach:>7.2f} m  "
                f"{('-' if perp is None else f'{perp:.1f} m'):>8}  "
                f"{('-' if own is None else f'{own:.1f} m'):>8}   "
                f"{', '.join(lithos):<12} {label or 'NO SECTION AUTHORS THIS'}"
            )

    if findings:
        depths = [f[0] for f in findings]
        imports = [f[5] for f in findings if f[5] is not None]
        print(
            f"\n      invented depth: mean {statistics.fmean(depths):.2f} m   "
            f"worst {max(depths):.2f} m"
        )
        if imports:
            print(
                f"      import distance: min {min(imports):.1f} m   "
                f"median {statistics.median(imports):.1f} m   max {max(imports):.1f} m"
            )
        orphans = sum(1 for f in findings if f[2] is None)
        print(f"      authored by NO section at that point: {orphans}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
