"""Does modelling the enclosed minorities as LENSES make the order conformable?

The user's proposal: instead of splitting the over-merged matrix body, keep the
matrix whole and carve the enclosed minority (the SILT between two KLEI) out as a
LENS. The strat field then only orders the conformable MATRIX backbone; lenses
(and lens-in-lens) are carved into their hosts.

This script tests it: it finds the cyclic SCCs, treats the largest body in each
SCC (by layer count = the recurring matrix host) as the matrix and the rest as
lenses, REMOVES the lens nodes from the precedence DAG, and checks whether the
remaining backbone is acyclic (conformable). Read-only.
"""

from __future__ import annotations

import asyncio
import sys
from collections import Counter, defaultdict
from pathlib import Path
from uuid import UUID

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import networkx as nx  # noqa: E402
from sqlalchemy import text  # noqa: E402

from groundmodel.application.resolve_litho_instances_use_case import (  # noqa: E402
    ResolveLithoInstances,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402

_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")


async def main() -> None:
    """Lens out the enclosed minorities of each cycle; report backbone conformability."""
    async with AsyncSessionFactory() as session:
        await ResolveLithoInstances(session).execute(model_id=_MODEL_ID, commit=False)
        picks = await LithoLayerRepository(session).load_body_picks(_MODEL_ID)
        litho = dict(
            (
                await session.execute(
                    text("SELECT id::text, name FROM geological_formation WHERE id = ANY(:ids)"),
                    {"ids": sorted({p.formation_id for p in picks})},
                )
            ).all()
        )

    formation_of = {p.body_id: p.formation_id for p in picks}
    nlayers = Counter(p.body_id for p in picks)

    by_inv: dict[str, list] = defaultdict(list)
    for p in picks:
        by_inv[p.investigation_id].append(p)
    g = nx.DiGraph()
    g.add_nodes_from(formation_of)
    for inv in by_inv.values():
        inv.sort(key=lambda x: x.top_depth_m)
        for a, b in zip(inv, inv[1:]):
            if a.body_id != b.body_id:
                g.add_edge(a.body_id, b.body_id)

    sccs = [s for s in nx.strongly_connected_components(g) if len(s) > 1]

    def lab(bid: str) -> str:
        return f"{litho.get(formation_of[bid], '?')}#{bid[-6:]} ({nlayers[bid]} layers)"

    lensed: set[str] = set()
    print("=" * 70)
    print("LENS-OUT TEST — carve the enclosed minority of each cycle as a lens")
    print("=" * 70)
    for ci, scc in enumerate(sorted(sccs, key=len, reverse=True), start=1):
        matrix = max(scc, key=lambda b: nlayers[b])  # the recurring host
        minorities = scc - {matrix}
        lensed |= minorities
        print(f"  cycle {ci}: MATRIX kept = {lab(matrix)}")
        for m in sorted(minorities, key=lambda b: -nlayers[b]):
            print(f"           -> LENS    = {lab(m)}")

    backbone = g.copy()
    backbone.remove_nodes_from(lensed)
    ok = nx.is_directed_acyclic_graph(backbone)
    print("-" * 70)
    print(f"  bodies lensed out          : {len(lensed)}")
    print(f"  backbone bodies (the field): {backbone.number_of_nodes()}")
    print(f"  backbone is a DAG          : {ok}")
    print("=" * 70)
    if ok:
        print(
            "VERDICT: YES - lensing the enclosed minorities makes the matrix "
            "backbone conformable. The field models the matrix; lenses carve in."
        )
    else:
        remaining = [s for s in nx.strongly_connected_components(backbone) if len(s) > 1]
        print(
            f"VERDICT: backbone STILL cycles ({len(remaining)} SCC) - a deeper "
            "lens-in-lens / matrix choice is needed for those."
        )
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
