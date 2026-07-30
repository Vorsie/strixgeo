"""READ-ONLY: how many pinch-out points does each body have, and on how many sections?

A lens has a determinate footprint in plan view: the points where its 2-D extent
ends on each section it dies on. Two sections crossing give four such points, which
outline the body; the enclosing formation floods everything outside. A body carried
by only one section gives two points, which do not determine an outline on their own.

This counts which case each body actually falls into on the stored build, so the
footprint rules are chosen against the real distribution rather than a guess.

A body's extent on a section is sampled gap by gap. An end of a contiguous run is an
INTERIOR pinch when it falls strictly inside the section, and an OPEN end when the
run reaches the section's first or last column — an open end is not a pinch-out, it
is the body leaving the section's coverage.

Nothing is written to the database — SELECTs only, behind the same dev-DB guard as
``eval_strat_fidelity.py``.

Usage
-----
    uv run python scripts/diag_lens_footprints.py
    uv run python scripts/diag_lens_footprints.py --steps 400 --examples 12
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
from groundmodel.domain.services.voxel_litho.label_voxels import (  # noqa: E402
    _section_stack_at,
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
from scripts.eval_strat_fidelity import (  # noqa: E402
    _confirm_db_target,
    _load_formation_names,
)

_MIN_TH = 1e-4


def _runs_on_section(
    section, steps: int, formation_of: dict[str, str]
) -> dict[str, list[tuple[float, float, bool, bool]]]:
    """Where each body starts and stops along one section.

    Parameters
    ----------
    section : _Section
        A seated section from the stored build payload.
    steps : int
        Samples per gap between adjacent columns.
    formation_of : dict of str to str
        Body id to formation id, filled in as bodies are met. Sampling here rather
        than at gap midpoints is what catches the narrow single-section lenses, which
        are exactly the ones that never span a midpoint.

    Returns
    -------
    dict of str to list of tuple
        Per body id, one ``(start, end, start is interior, end is interior)`` per
        contiguous run, with positions as a global sample index along the section.
    """
    n_gaps = len(section.columns) - 1
    if n_gaps < 1:
        return {}
    present: dict[str, set[int]] = defaultdict(set)
    total = n_gaps * steps
    for gap in range(n_gaps):
        for k in range(steps):
            idx = gap * steps + k
            frac = k / (steps - 1) if steps > 1 else 0.0
            for e in _section_stack_at(section, gap, frac):
                if e.body_id is not None and e.top_elev - e.base_elev > _MIN_TH:
                    present[e.body_id].add(idx)
                    formation_of.setdefault(e.body_id, e.formation_id)

    runs: dict[str, list[tuple[float, float, bool, bool]]] = {}
    for body, hits in present.items():
        ordered = sorted(hits)
        out = []
        start = prev = ordered[0]
        for idx in ordered[1:]:
            if idx != prev + 1:
                out.append((start, prev, start > 0, prev < total - 1))
                start = idx
            prev = idx
        out.append((start, prev, start > 0, prev < total - 1))
        runs[body] = out
    return runs


def _section_point(section, steps: int, idx: float) -> tuple[float, float]:
    """Map a global sample index on a section back to world coordinates.

    Parameters
    ----------
    section : _Section
        The section the index belongs to.
    steps : int
        Samples per gap, matching the value used to build the runs.
    idx : float
        Global sample index along the section.

    Returns
    -------
    tuple of float
        World ``(x, y)`` of that position.
    """
    gap = min(int(idx) // steps, len(section.columns) - 2)
    frac = (idx - gap * steps) / max(steps - 1, 1)
    a, b = section.columns[gap], section.columns[gap + 1]
    return (
        a.world_x + (b.world_x - a.world_x) * frac,
        a.world_y + (b.world_y - a.world_y) * frac,
    )


async def main() -> None:
    """Report the pinch-point census for every body in the stored build."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--steps", type=int, default=200, help="samples per gap")
    ap.add_argument("--examples", type=int, default=8, help="bodies to print in detail")
    args = ap.parse_args()

    print("\n=== LENS FOOTPRINT CENSUS (READ-ONLY) ===\n")
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
    sections_of: dict[str, set[int]] = defaultdict(set)
    pinches_of: dict[str, list[tuple[float, float]]] = defaultdict(list)
    open_ends: Counter[str] = Counter()

    for s_idx, section in enumerate(seated):
        runs = _runs_on_section(section, args.steps, formation_of)
        for body, spans in runs.items():
            sections_of[body].add(s_idx)
            for start, end, start_interior, end_interior in spans:
                for idx, interior in ((start, start_interior), (end, end_interior)):
                    if interior:
                        pinches_of[body].append(_section_point(section, args.steps, idx))
                    else:
                        open_ends[body] += 1

    bodies = sorted(sections_of)
    print(f"  {len(bodies)} bodies across {len(seated)} sections\n")

    by_sections = Counter(len(sections_of[b]) for b in bodies)
    print("  bodies by how many sections carry them")
    for k in sorted(by_sections):
        print(f"      on {k:>2} section(s): {by_sections[k]:>4}")

    by_pinch = Counter(len(pinches_of[b]) for b in bodies)
    print("\n  bodies by how many INTERIOR pinch-out points they have")
    for k in sorted(by_pinch):
        note = ""
        if k == 0:
            note = "  (never pinches — open at every end)"
        elif k == 2:
            note = "  (a single section's lens — outline not determined)"
        elif k >= 4:
            note = "  (outline determined)"
        print(f"      {k:>2} points: {by_pinch[k]:>4}{note}")

    with_open = sum(1 for b in bodies if open_ends[b])
    only_open = sum(1 for b in bodies if open_ends[b] and not pinches_of[b])
    print(
        "\n  open ends (body still present at a section's first or last column —"
        "\n  not a pinch-out, just no information past that point)"
    )
    print(f"      total open ends:              {sum(open_ends.values())}")
    print(f"      bodies with at least one:     {with_open} of {len(bodies)}")
    print(f"      bodies that ONLY run off the edge: {only_open}")

    determined = sum(1 for b in bodies if len(pinches_of[b]) >= 4)
    single = sum(1 for b in bodies if len(pinches_of[b]) in (2, 3))
    never = sum(1 for b in bodies if not pinches_of[b])
    print(
        f"\n  outline determined by correlations: {determined}"
        f"  ·  needs a default shape: {single}"
        f"  ·  never pinches: {never}"
    )

    print(f"\n  {args.examples} widest single-section lenses (the default-shape cases)")
    twos = [b for b in bodies if len(pinches_of[b]) == 2]
    twos.sort(key=lambda b: -math.dist(pinches_of[b][0], pinches_of[b][1]))
    for body in twos[: args.examples]:
        pts = pinches_of[body]
        p, q = pts[0], pts[-1]
        print(
            f"      {names.get(formation_of.get(body, ''), '?'):<6} {body[:13]}  "
            f"{len(pts)} pts  span {math.dist(p, q):7.1f} m  "
            f"on section {sorted(sections_of[body])[0]}"
        )
    print()


if __name__ == "__main__":
    asyncio.run(main())
