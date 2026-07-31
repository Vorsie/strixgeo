"""READ-ONLY: is each body one connected piece of ground, or several?

A body id is a connected component of the CORRELATION graph. That is not the same
as being one connected piece of ground: two lenses far apart can share a body id if
each is correlated to something that ties them, and a body that merely pinches out
in two places is one piece despite having two separate termination zones.

Clustering pinch-out points by distance cannot tell those apart — it splits the
POINTS, not the body. This tests the body itself: take every run of the body along
every section, and join two runs when they come within ``--touch`` metres of each
other, which is what happens where sections cross. A body whose runs fall into more
than one group is genuinely two or more pieces of ground under one id.

Nothing is written to the database — SELECTs only, behind the same dev-DB guard as
``eval_strat_fidelity.py``. This reports; it never alters body identity.

Usage
-----
    uv run python scripts/diag_body_geometric_connectivity.py
    uv run python scripts/diag_body_geometric_connectivity.py --touch 10 --body SILT-02
"""

from __future__ import annotations

import argparse
import asyncio
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
from scripts.diag_lens_footprints import _runs_on_section, _section_point  # noqa: E402
from scripts.eval_strat_fidelity import (  # noqa: E402
    _confirm_db_target,
    _load_formation_names,
)

_SAMPLES_PER_RUN = 24


def _run_samples(section, steps: int, start: float, end: float) -> list[tuple[float, float]]:
    """Points spread along one run of a body, in world coordinates.

    Parameters
    ----------
    section : _Section
        The section the run lies on.
    steps : int
        Samples per gap, matching the value the runs were built with.
    start, end : float
        Global sample indices bounding the run.

    Returns
    -------
    list of tuple of float
        ``_SAMPLES_PER_RUN`` world positions from one end of the run to the other.
    """
    if end <= start:
        return [_section_point(section, steps, start)]
    return [
        _section_point(section, steps, start + (end - start) * k / (_SAMPLES_PER_RUN - 1))
        for k in range(_SAMPLES_PER_RUN)
    ]


def _components(runs: list[list[tuple[float, float]]], touch: float) -> list[list[int]]:
    """Group runs that come within ``touch`` metres of each other.

    Parameters
    ----------
    runs : list of list of tuple of float
        Sampled world positions, one list per run.
    touch : float
        Two runs join when any pair of their samples is closer than this.

    Returns
    -------
    list of list of int
        Run indices, one list per connected group, largest first.
    """
    parent = list(range(len(runs)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(runs)):
        for j in range(i + 1, len(runs)):
            if find(i) == find(j):
                continue
            if any(math.dist(p, q) <= touch for p in runs[i] for q in runs[j]):
                parent[find(i)] = find(j)
    grouped: dict[int, list[int]] = defaultdict(list)
    for i in range(len(runs)):
        grouped[find(i)].append(i)
    return sorted(grouped.values(), key=len, reverse=True)


async def main() -> None:
    """Report how many separate pieces of ground each body id covers."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--steps", type=int, default=200, help="samples per gap")
    ap.add_argument("--touch", type=float, default=8.0, help="runs join when this close, metres")
    ap.add_argument("--body", default=None, help="report one label in detail, e.g. SILT-02")
    args = ap.parse_args()

    print("\n=== BODY GEOMETRIC CONNECTIVITY (READ-ONLY) ===\n")
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

    aliases = dict(gen.body_aliases or {})
    seated, _moved, _shift = apply_true_column_positions(
        apply_body_aliases(_sections_from_payload(gen.payload), aliases),
        _apply_aliases_to_columns(_investigation_columns_from_picks(picks), aliases),
    )

    formation_of: dict[str, str] = {}
    runs_of: dict[str, list[tuple[int, list[tuple[float, float]]]]] = defaultdict(list)
    pinch_count: Counter[str] = Counter()

    for s_idx, section in enumerate(seated):
        for body, spans in _runs_on_section(section, args.steps, formation_of).items():
            for start, end, start_interior, end_interior in spans:
                runs_of[body].append((s_idx, _run_samples(section, args.steps, start, end)))
                pinch_count[body] += int(start_interior) + int(end_interior)

    # Label bodies exactly as the footprint dump does, so the two reports agree.
    seq: Counter[str] = Counter()
    label_of: dict[str, str] = {}
    for body in sorted(runs_of, key=lambda b: -pinch_count[b]):
        formation = names.get(formation_of.get(body, ""), "?")
        seq[formation] += 1
        label_of[body] = f"{formation}-{seq[formation]:02d}"

    split = []
    for body, entries in runs_of.items():
        groups = _components([pts for _s, pts in entries], args.touch)
        if len(groups) > 1:
            split.append((label_of[body], body, entries, groups))

    print(f"  {len(runs_of)} bodies, joining runs that pass within {args.touch:.0f} m\n")
    print(f"  one connected piece of ground:  {len(runs_of) - len(split)}")
    print(f"  more than one piece:            {len(split)}")

    if split:
        print("\n  bodies covering separate pieces of ground under one id")
        for label, _body, entries, groups in sorted(split, key=lambda p: -len(p[3])):
            secs = [sorted({entries[i][0] for i in g}) for g in groups]
            far = min(
                math.dist(p, q)
                for a in range(len(groups))
                for b in range(a + 1, len(groups))
                for p in [pt for i in groups[a] for pt in entries[i][1]]
                for q in [pt for i in groups[b] for pt in entries[i][1]]
            )
            print(
                f"      {label:<8} {len(entries):>3} runs -> {len(groups)} pieces, "
                f"nearest approach {far:6.1f} m, sections per piece {secs}"
            )

    if args.body:
        match = [b for b, lab in label_of.items() if lab == args.body]
        if not match:
            raise SystemExit(f"ABORT: no body labelled {args.body}.")
        entries = runs_of[match[0]]
        groups = _components([pts for _s, pts in entries], args.touch)
        print(f"\n  {args.body} in detail — {len(entries)} runs, {len(groups)} piece(s)")
        for n, g in enumerate(groups, 1):
            print(f"      piece {n}: runs on sections {sorted(entries[i][0] for i in g)}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
