"""READ-ONLY: where a tie-section says a body dies, versus where the builder assumes it.

A body on one cross-section and absent from the next has to die somewhere between
them. ``label_voxels`` assumes the equidistance midline — ``max(0, 2w - 1)`` reaches
zero exactly halfway — because it had no better information.

But the tie-sections run BETWEEN the cross-sections, so a body dying in that gap must
terminate somewhere ON a tie, and the 2-D partition already places that termination
and classifies it. That is a MEASURED pinch-out in the very direction the builder is
guessing at, and it is the owner's point: the halfway comes out of the model rather
than out of a formula.

This finds every such case on the stored build and reports, per case, the distance
between the two — the error the assumption costs. It writes
``blend_viewer/tiepinch.json`` for the plan-view companion.

Nothing is written to the database — SELECTs only, behind the same dev-DB guard as
``eval_strat_fidelity.py``.

Usage
-----
    uv run python scripts/dump_tie_pinch_vs_midline.py
    uv run python scripts/dump_tie_pinch_vs_midline.py --examples 20
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import sys
from collections import Counter, defaultdict
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
    _project_to_section_fence,
)
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
from scripts.diag_lens_footprints import _runs_on_section, _section_point  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _confirm_db_target,
    _load_formation_names,
)

_KIND_WORD = {"quad": "BAND", "pinch": "ONLAP", "lens": "LENS"}


def _name_sections(sections: list, named: list[CrossSectionOrm]) -> list[str]:
    """Match each payload section to its stored name by line endpoints.

    The payload carries the section line but not its name, and the name is what says
    whether a section is a cross-section or a tie.

    Parameters
    ----------
    sections : list of SectionPartitionInput
        The payload's sections, in payload order.
    named : list of CrossSectionOrm
        Every stored section, with names and endpoints.

    Returns
    -------
    list of str
        One name per payload section; ``'?'`` where no line matched within a metre.
    """
    out = []
    for sec in sections:
        best, best_d = "?", 1.0
        for row in named:
            d = min(
                math.dist((sec.start_x, sec.start_y), (row.start_x, row.start_y))
                + math.dist((sec.end_x, sec.end_y), (row.end_x, row.end_y)),
                math.dist((sec.start_x, sec.start_y), (row.end_x, row.end_y))
                + math.dist((sec.end_x, sec.end_y), (row.start_x, row.start_y)),
            )
            if d < best_d:
                best, best_d = row.name, d
        out.append(best)
    return out


def _terminations(section, steps: int) -> dict[str, list[tuple[float, float]]]:
    """Every interior pinch-out point of every body on one section, in world coordinates.

    Parameters
    ----------
    section : SectionPartitionInput
        A seated section.
    steps : int
        Samples per gap.

    Returns
    -------
    dict of str to list of tuple
        Body id to the world positions where its extent ends inside the section. An
        end at the section's first or last column is excluded — that is the evidence
        running out, not the body terminating.
    """
    out: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for body, spans in _runs_on_section(section, steps, {}).items():
        for start, end, start_interior, end_interior in spans:
            for idx, interior in ((start, start_interior), (end, end_interior)):
                if interior:
                    out[body].append(_section_point(section, steps, idx))
    return out


def _bodies_on(section, steps: int) -> set[str]:
    """Every body with extent anywhere on one section."""
    return set(_runs_on_section(section, steps, {}))


def _equidistant_point(tie, cross_a, cross_b, steps: int = 400) -> tuple[float, float] | None:
    """Where along a tie the two cross-sections are equally near — the builder's midline.

    ``max(0, 2w - 1)`` reaches zero exactly where the inverse-distance weight is 0.5,
    which is this point. Walking the tie and watching the sign of the distance
    difference finds it without assuming the tie is straight or centred.

    Parameters
    ----------
    tie : SectionPartitionInput
        The tie-section to walk.
    cross_a, cross_b : SectionPartitionInput
        The two cross-sections.
    steps : int
        Samples along the tie.

    Returns
    -------
    tuple of float or None
        World ``(x, y)`` of the crossover, or ``None`` when one cross-section is
        nearer along the tie's whole length.
    """
    pts = [(c.world_x, c.world_y) for c in tie.columns]
    if len(pts) < 2:
        return None
    total = sum(math.dist(a, b) for a, b in zip(pts, pts[1:], strict=False))
    if total <= 0:
        return None

    def at(t: float) -> tuple[float, float]:
        want = total * t
        for a, b in zip(pts, pts[1:], strict=False):
            seg = math.dist(a, b)
            if want <= seg or seg <= 0:
                f = 0.0 if seg <= 0 else want / seg
                return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
            want -= seg
        return pts[-1]

    prev = None
    for k in range(steps + 1):
        x, y = at(k / steps)
        diff = (
            _project_to_section_fence(cross_a, x, y)[2]
            - _project_to_section_fence(cross_b, x, y)[2]
        )
        if prev is not None and (prev <= 0 < diff or diff <= 0 < prev):
            return (x, y)
        prev = diff
    return None


async def main() -> None:
    """Report the tie-measured pinch-out against the builder's assumed midline."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--steps", type=int, default=200, help="samples per gap")
    ap.add_argument("--examples", type=int, default=14, help="cases to print")
    ap.add_argument("--out", default=str(_REPO_ROOT / "blend_viewer" / "tiepinch.json"))
    args = ap.parse_args()

    print("\n=== TIE-MEASURED PINCH vs ASSUMED MIDLINE (READ-ONLY) ===\n")
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
    seated, _moved, _shift = apply_true_column_positions(
        apply_body_aliases(_sections_from_payload(gen.payload), aliases),
        _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases),
    )
    section_names = _name_sections(seated, list(stored))
    crosses = [i for i, n in enumerate(section_names) if n.lower().startswith("cross")]
    ties = [i for i, n in enumerate(section_names) if n.lower().startswith("tie")]
    print(f"  {len(crosses)} cross-sections, {len(ties)} tie-sections\n")

    present = {i: _bodies_on(seated[i], args.steps) for i in range(len(seated))}
    ends = {i: _terminations(seated[i], args.steps) for i in range(len(seated))}
    formation_of: dict[str, str] = {}
    for sec in seated:
        _runs_on_section(sec, args.steps, formation_of)

    # The region classification, per body per section, from the payload itself.
    kind_of: dict[tuple[int, str], set[str]] = defaultdict(set)
    for i, sec in enumerate(gen.payload["sections"]):
        for r in sec["regions"]:
            if r["body_id"] and r.get("kind"):
                kind_of[(i, r["body_id"])].add(r["kind"])

    cases = []
    for a in crosses:
        for b in crosses:
            if a == b:
                continue
            for body in present[a] - present[b]:
                for t in ties:
                    if body not in present[t]:
                        continue
                    mid = _equidistant_point(seated[t], seated[a], seated[b])
                    if mid is None or not ends[t].get(body):
                        continue
                    # The termination on this tie nearest the assumed midline: the
                    # like-for-like comparison, since both answer "where does it die".
                    term = min(ends[t][body], key=lambda p: math.dist(p, mid))
                    cases.append(
                        {
                            "body": body,
                            "formation": names.get(formation_of.get(body, ""), "?"),
                            "from": section_names[a],
                            "absentOn": section_names[b],
                            "tie": section_names[t],
                            "measured": [round(term[0], 2), round(term[1], 2)],
                            "assumed": [round(mid[0], 2), round(mid[1], 2)],
                            "errorM": round(math.dist(term, mid), 2),
                            "kindOnTie": sorted(kind_of.get((t, body), set())),
                        }
                    )

    cases.sort(key=lambda c: -c["errorM"])
    errs = [c["errorM"] for c in cases]
    print(f"  {len(cases)} cases where a tie MEASURES a pinch the builder ASSUMES\n")
    if errs:
        errs_sorted = sorted(errs)
        print(f"      median error {errs_sorted[len(errs_sorted) // 2]:6.1f} m")
        print(f"      p90 error    {errs_sorted[int(len(errs_sorted) * 0.9)]:6.1f} m")
        print(f"      worst        {errs_sorted[-1]:6.1f} m")
        print(f"      within 5 m   {sum(1 for e in errs if e <= 5):>4} of {len(errs)}")
        print()
        print("  classification the tie gives the terminating body")
        tally: Counter[str] = Counter()
        for c in cases:
            for k in c["kindOnTie"] or ["(none)"]:
                tally[_KIND_WORD.get(k, k)] += 1
        for k, n in tally.most_common():
            print(f"      {k:<8} {n}")
        print(f"\n  worst {args.examples} cases")
        for c in cases[: args.examples]:
            kinds = "/".join(_KIND_WORD.get(k, k) for k in c["kindOnTie"]) or "-"
            print(
                f"      {c['formation']:<5} on {c['from']:<15} absent {c['absentOn']:<15} "
                f"via {c['tie']:<15} {kinds:<12} off by {c['errorM']:6.1f} m"
            )

    payload = {
        "sections": [
            {
                "name": section_names[i],
                "isTie": i in ties,
                "pts": [[c.world_x, c.world_y] for c in s.columns],
            }
            for i, s in enumerate(seated)
        ],
        "cases": cases,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload), encoding="utf-8")
    print(f"\n  wrote {out.name} — {out.stat().st_size / 1024:.0f} kB\n")


if __name__ == "__main__":
    asyncio.run(main())
