"""READ-ONLY: how often a terminating body has a tie that does NOT carry it.

Owner ruling 2026-07-31 (docs/debt.md #256): *a tie that does not carry the body is
evidence of ABSENCE — never carry the edge across one.* The owner caught this on a SILT
whose extrapolated pinch-out edge ran over six ties that lack the body.

The shipped ``pinch_factor`` predates that ruling and implements none of it: it takes the
nearest termination on any other section and thins radially toward it. It cannot refuse
to cross an absence tie, because it has no notion of one.

This measures how much that matters — for every body the partition measures to terminate,
how many ties carry it and how many stand as evidence of absence. A body carried by every
tie is one the radial rule can get right by luck; a body with absence ties is one it
cannot.

Read-only, dev-DB guarded, reuses the helpers of ``dump_tie_pinch_vs_midline.py``.
"""

from __future__ import annotations

import asyncio
import math
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (  # noqa: E402
    apply_body_aliases,
)
from groundmodel.domain.services.voxel_litho.true_column_positions import (  # noqa: E402
    apply_true_column_positions,
)
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm  # noqa: E402
from groundmodel.infrastructure.db.models.litho_build_generation_orm import (  # noqa: E402
    LithoBuildGenerationOrm,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.diag_build_generations import _sections_from_payload  # noqa: E402
from scripts.dump_tie_pinch_vs_midline import (  # noqa: E402
    _apply_aliases_to_columns,
    _bodies_on,
    _confirm_db_target,
    _investigation_columns_from_picks,
    _load_formation_names,
    _name_sections,
    _terminations,
)

STEPS = 200


async def main() -> None:
    """Report, per terminating body, how many ties carry it and how many do not."""
    print("\n=== ABSENCE TIES PER TERMINATING BODY (READ-ONLY) ===\n")
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
        names = await _load_formation_names(session, gen.model_id)
        stored = (await session.execute(select(CrossSectionOrm))).scalars().all()

    aliases = dict(gen.body_aliases or {})
    seated, _m, _s = apply_true_column_positions(
        apply_body_aliases(_sections_from_payload(gen.payload), aliases),
        _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases),
    )
    section_names = _name_sections(seated, list(stored))
    ties = [i for i, n in enumerate(section_names) if n.lower().startswith("tie")]
    present = {i: _bodies_on(seated[i], STEPS) for i in range(len(seated))}
    ends = {i: _terminations(seated[i], STEPS) for i in range(len(seated))}

    formation_of: dict[str, str] = {}
    for i, sec in enumerate(gen.payload["sections"]):
        for r in sec["regions"]:
            if r["body_id"]:
                formation_of.setdefault(r["body_id"], names.get(r["formation_id"], "?"))

    terminating = sorted({b for i in ties for b in ends.get(i, {})})
    print(f"  {len(ties)} tie-sections; {len(terminating)} bodies terminate on at least one\n")

    rows = []
    for body in terminating:
        carried = [i for i in ties if body in present.get(i, set())]
        absent = [i for i in ties if body not in present.get(i, set())]
        rows.append((body, formation_of.get(body, "?"), len(carried), len(absent)))

    with_absence = [r for r in rows if r[3] > 0]
    print(f"{'body':<16} {'formation':<10} {'ties carrying':>14} {'ties ABSENT':>12}")
    for body, form, c, a in sorted(rows, key=lambda r: -r[3])[:16]:
        flag = "  <-- edge must not cross these" if a else ""
        print(f"{body[:14]:<16} {form:<10} {c:>14} {a:>12}{flag}")

    print(
        f"\n  {len(with_absence)} of {len(rows)} terminating bodies "
        f"({100.0 * len(with_absence) / max(1, len(rows)):.0f} %) have at least one "
        "absence tie"
    )
    total_absent = sum(r[3] for r in rows)
    total_carry = sum(r[2] for r in rows)
    print(f"  across all of them: {total_carry} carrying tie-occurrences, {total_absent} absent")
    print(
        "\n  The shipped pinch_factor consults NONE of this: it takes the nearest\n"
        "  termination on any other section, so an absence tie between the query and\n"
        "  that termination cannot stop it.\n"
    )

    # Does an absence tie ever sit BETWEEN two carrying ties?  The rulings say to
    # interpolate between carrying ties and never to cross an absence tie; a body present
    # either side of a tie that lacks it satisfies neither, and would be a question for
    # the owner rather than something to settle by picking a rule.
    print("  --- absence ties BETWEEN two carrying ties (unruled if any) ---")
    ordered = _ties_in_spatial_order(seated, ties)
    two_plus = [r for r in rows if r[2] >= 2]
    sandwiched = []
    for body, form, _c, _a in two_plus:
        carried = [i for i in ordered if body in present.get(i, set())]
        first, last = ordered.index(carried[0]), ordered.index(carried[-1])
        between = [i for i in ordered[first : last + 1] if body not in present.get(i, set())]
        if between:
            sandwiched.append((body, form, len(carried), len(between)))

    if not sandwiched:
        print(
            f"    NONE — of the {len(two_plus)} bodies carried by two or more ties, every\n"
            "    carrying tie is contiguous in spatial order. The three rulings cover the\n"
            "    real geometry; no further owner question is needed to build the edge.\n"
        )
    else:
        print(f"    {len(sandwiched)} bodies — UNRULED, ask the owner:")
        for body, form, carried, between in sandwiched:
            print(
                f"      {body[:14]:<16} {form:<8} carried by {carried} ties, "
                f"absent on {between} lying between them"
            )
        print()


def _ties_in_spatial_order(seated: list, ties: list[int]) -> list[int]:
    """The tie indices ordered along the trend the ties themselves are spaced on.

    Ties run between the cross-sections, so they are spaced along the cross-section
    direction. Ordering them by the projection of their midpoints onto the first
    principal direction of those midpoints is parameter-free — it reads the trend off
    the data instead of assuming a compass axis.

    Parameters
    ----------
    seated : list
        All sections, positioned at their true column coordinates.
    ties : list of int
        Indices of the tie-sections within ``seated``.

    Returns
    -------
    list of int
        The same indices, ordered along their own trend.
    """
    mids = {}
    for i in ties:
        xs = [c.world_x for c in seated[i].columns]
        ys = [c.world_y for c in seated[i].columns]
        mids[i] = (sum(xs) / len(xs), sum(ys) / len(ys))
    cx = sum(m[0] for m in mids.values()) / len(mids)
    cy = sum(m[1] for m in mids.values()) / len(mids)
    sxx = sum((m[0] - cx) ** 2 for m in mids.values())
    syy = sum((m[1] - cy) ** 2 for m in mids.values())
    sxy = sum((m[0] - cx) * (m[1] - cy) for m in mids.values())
    # Principal direction of a 2x2 covariance, without pulling numpy into a diag.
    theta = 0.5 * math.atan2(2.0 * sxy, sxx - syy)
    ux, uy = math.cos(theta), math.sin(theta)
    return sorted(ties, key=lambda i: (mids[i][0] - cx) * ux + (mids[i][1] - cy) * uy)


if __name__ == "__main__":
    asyncio.run(main())
