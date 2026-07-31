"""READ-ONLY: what tapering to the MEASURED end would change, before it is wired in.

``_stack_at`` currently thins a one-sided body with ``max(0, 2w - 1)``, which reaches
zero at the equidistance midline. :func:`pinch_factor` thins it toward the place the
2-D partition actually measures it to end. This samples the ground between sections
and reports, per one-sided body occurrence, how much thickness the two rules disagree
about — the prediction the wired-in change then has to match.

Nothing is written to the database — SELECTs only, behind the same dev-DB guard as
``eval_strat_fidelity.py``. It changes no behaviour; it only compares.

Usage
-----
    uv run python scripts/diag_pinch_factor_delta.py
    uv run python scripts/diag_pinch_factor_delta.py --spacing 10
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.application.build_voxel_litho_model import (  # noqa: E402
    _apply_aliases_to_columns,
    _investigation_columns_from_picks,
)
from groundmodel.domain.services.voxel_litho.label_voxels import (  # noqa: E402
    _EPS,
    _project_to_section_fence,
    _section_stack_at,
)
from groundmodel.domain.services.voxel_litho.merge_bodies_across_sections import (  # noqa: E402
    apply_body_aliases,
)
from groundmodel.domain.services.voxel_litho.pinch_terminations import (  # noqa: E402
    body_terminations,
    pinch_factor,
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
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402


def _quantiles(values: list[float]) -> tuple[float, float, float, float]:
    """Median, p90, max and mean of a list, ``(0, 0, 0, 0)`` when empty."""
    if not values:
        return 0.0, 0.0, 0.0, 0.0
    ordered = sorted(values)
    return (
        ordered[len(ordered) // 2],
        ordered[int(len(ordered) * 0.9)],
        ordered[-1],
        sum(ordered) / len(ordered),
    )


async def main() -> None:
    """Compare the midline rule against the measured-end rule over sampled ground."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--spacing", type=float, default=15.0, help="sample grid, metres")
    args = ap.parse_args()

    print("\n=== MIDLINE vs MEASURED END — PREDICTED CHANGE (READ-ONLY) ===\n")
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
    seated, _moved, _shift = apply_true_column_positions(
        apply_body_aliases(_sections_from_payload(gen.payload), aliases),
        _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases),
    )
    terminations = body_terminations(seated)

    xs = [c.world_x for s in seated for c in s.columns]
    ys = [c.world_y for s in seated for c in s.columns]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)

    sampled = 0
    one_sided = 0
    no_evidence = 0
    deltas: list[float] = []
    thicker: list[float] = []
    thinner: list[float] = []

    y = y0
    while y <= y1:
        x = x0
        while x <= x1:
            projs = sorted(
                ((s, *_project_to_section_fence(s, x, y)) for s in seated), key=lambda p: p[3]
            )
            if len(projs) < 2:
                x += args.spacing
                continue
            s1, g1, f1, d1, _a, _b = projs[0]
            s2, g2, f2, d2, _c, _d = projs[1]
            stack1 = _section_stack_at(s1, g1, f1)
            stack2 = _section_stack_at(s2, g2, f2)
            if not stack1 or not stack2:
                x += args.spacing
                continue
            sampled += 1
            theirs = {e.body_id for e in stack2 if e.body_id is not None}
            w1 = 0.5 if (d1 + d2) < _EPS else d2 / (d1 + d2)
            old = max(0.0, 2.0 * w1 - 1.0)
            for e in stack1:
                if e.body_id is None or e.body_id in theirs:
                    continue
                one_sided += 1
                new = pinch_factor((x, y), d1, terminations.get(e.body_id, ()))
                if new is None:
                    no_evidence += 1
                    continue
                th = e.top_elev - e.base_elev
                delta = (new - old) * th
                deltas.append(abs(delta))
                (thicker if delta > 0 else thinner).append(abs(delta))
            x += args.spacing
        y += args.spacing

    print(f"  {sampled:,} sampled points between sections, {args.spacing:.0f} m grid")
    print(f"  {one_sided:,} one-sided body occurrences")
    print(f"      measured to die somewhere : {one_sided - no_evidence:,}")
    print(f"      no measurement, rule kept : {no_evidence:,}")

    med, p90, mx, mean = _quantiles(deltas)
    print("\n  thickness the two rules disagree about, per occurrence")
    print(f"      median {med:6.3f} m    p90 {p90:6.3f} m    max {mx:6.3f} m    mean {mean:6.3f} m")
    print(
        f"      unchanged within 1 cm  {sum(1 for d in deltas if d <= 0.01):,} of {len(deltas):,}"
    )
    print(f"\n      the measured end keeps MORE material at {len(thicker):,} occurrences")
    print(f"      the measured end keeps LESS material at {len(thinner):,} occurrences")
    print()


if __name__ == "__main__":
    asyncio.run(main())
