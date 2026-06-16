"""Cycle-density analysis of the strat-builder instance order on real data.

The real-data eval (``eval_strat_builder.py``) found that ``test.strix`` is
non-conformable: its 102-instance stratigraphic order contains a directed cycle,
so the v1 implicit builder flags every body.  This script quantifies HOW
non-conformable the model is — is it one bad correlation (cleanable) or pervasive
interbedding (a fundamental v1 limitation)?

It rebuilds the SAME instance precedence DAG that ``build_stratigraphic_order``
builds (an edge ``A -> B`` for every "instance A directly above instance B" in
any investigation column), then reports the strongly-connected-component
structure (Tarjan via networkx): the number of non-trivial SCCs (cycles), the
total instances trapped in cycles, and the bidirectional edge pairs (the direct
A-over-B-here / B-over-A-there contradictions).

Read-only: it makes NO DB writes.
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

from groundmodel.application.resolve_litho_instances_use_case import (  # noqa: E402
    ResolveLithoInstances,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402

_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")


async def main() -> None:
    """Build the instance DAG from the real picks and report its cycle structure."""
    async with AsyncSessionFactory() as session:
        await ResolveLithoInstances(session).execute(model_id=_MODEL_ID, commit=False)
        picks = await LithoLayerRepository(session).load_body_picks(_MODEL_ID)
        litho_name, inv_name = await _load_names(session, picks)

    # Group per investigation, top -> bottom (ascending depth), like the assembler.
    by_inv: dict[str, list] = defaultdict(list)
    for p in picks:
        by_inv[p.investigation_id].append(p)
    for inv in by_inv.values():
        inv.sort(key=lambda x: x.top_depth_m)

    formation_of: dict[str, str] = {p.body_id: p.formation_id for p in picks}

    # Directed edges: above_instance -> below_instance, with the column count + the
    # investigations that support each direction (so a contradiction can be named).
    edge_cols: dict[tuple[str, str], int] = Counter()
    edge_invs: dict[tuple[str, str], list[str]] = defaultdict(list)
    for inv_id, inv_picks in by_inv.items():
        for a, b in zip(inv_picks, inv_picks[1:]):
            if a.body_id != b.body_id:
                edge_cols[(a.body_id, b.body_id)] += 1
                edge_invs[(a.body_id, b.body_id)].append(inv_id)

    g = nx.DiGraph()
    g.add_nodes_from(formation_of.keys())
    for a, b in edge_cols:
        g.add_edge(a, b)

    sccs = [c for c in nx.strongly_connected_components(g) if len(c) > 1]
    in_cycles = set().union(*sccs) if sccs else set()

    # Bidirectional edge pairs: A->B AND B->A both observed (the direct contradictions).
    bidir: list[tuple[str, str, int, int]] = []
    seen: set[frozenset[str]] = set()
    for (a, b), n_ab in edge_cols.items():
        key = frozenset((a, b))
        if key in seen:
            continue
        n_ba = edge_cols.get((b, a), 0)
        if n_ba > 0:
            seen.add(key)
            bidir.append((a, b, n_ab, n_ba))

    print("=" * 70)
    print("STRAT INSTANCE DAG — CYCLE DENSITY")
    print("=" * 70)
    print(f"instances (nodes)          : {g.number_of_nodes()}")
    print(f"precedence edges           : {g.number_of_edges()}")
    print(f"is a DAG (conformable)     : {nx.is_directed_acyclic_graph(g)}")
    print(f"non-trivial SCCs (cycles)  : {len(sccs)}")
    if sccs:
        sizes = sorted((len(c) for c in sccs), reverse=True)
        print(f"  SCC sizes                : {sizes}")
        print(f"  instances trapped in cycles: {len(in_cycles)} / {g.number_of_nodes()}")
        fcount = Counter(formation_of[n] for n in in_cycles)
        print(f"  formations of cycle nodes  : {dict(fcount)}")
    print(f"bidirectional edge pairs   : {len(bidir)}  (A-over-B here, B-over-A there)")
    for a, b, n_ab, n_ba in bidir[:20]:
        fa, fb = formation_of[a], formation_of[b]
        print(f"    {fa[:8]}({n_ab})  <->  {fb[:8]}({n_ba})")
    # Formation-pair tally over ALL bidirectional contradictions.
    pair_tally: Counter[frozenset[str]] = Counter()
    for a, b, _n_ab, _n_ba in bidir:
        pair_tally[frozenset((formation_of[a], formation_of[b]))] += 1
    print("bidirectional contradictions by formation pair:")
    for pair, n in pair_tally.most_common():
        labels = sorted(litho_name.get(p, p[:8]) for p in pair)
        print(f"    {labels}: {n} instance-pair(s)")

    # --- The 8 instances, per cycle, with names + the contradicting edges ------
    layers_of: dict[str, list] = defaultdict(list)
    for p in picks:
        layers_of[p.body_id].append(p)

    def lab(bid: str) -> str:
        return f"{litho_name.get(formation_of[bid], '?')}#{bid[-6:]}"

    for ci, scc in enumerate(sorted(sccs, key=len, reverse=True), start=1):
        print()
        print(
            f"### CYCLE {ci} — {len(scc)} instances "
            f"({Counter(litho_name.get(formation_of[n], '?') for n in scc)})"
        )
        for bid in sorted(scc, key=lambda b: litho_name.get(formation_of[b], "")):
            ls = sorted(layers_of[bid], key=lambda x: x.top_depth_m)
            invs = sorted({inv_name.get(p.investigation_id, p.investigation_id[:6]) for p in ls})
            dmin = min(p.top_depth_m for p in ls)
            dmax = max(p.base_depth_m for p in ls)
            print(
                f"  {lab(bid):>16}  — {len(ls)} layer(s), depth {dmin:.1f}–{dmax:.1f} m, "
                f"in: {', '.join(invs)}"
            )
        # The contradicting adjacencies inside this SCC (named by investigation).
        print("  contradictions (who is ABOVE whom, and where):")
        members = set(scc)
        for (a, b), n in edge_cols.items():
            if a in members and b in members:
                where = sorted({inv_name.get(i, i[:6]) for i in edge_invs[(a, b)]})
                print(f"    {lab(a)} ABOVE {lab(b)}  in: {', '.join(where)}")
    print("=" * 70)


async def _load_names(session, picks):
    """Return (formation_id -> lithology name, investigation_id -> human code) maps."""
    from sqlalchemy import text  # local import; this is a one-off diagnostic

    fids = sorted({p.formation_id for p in picks})
    iids = sorted({p.investigation_id for p in picks})
    litho_name: dict[str, str] = {}
    inv_name: dict[str, str] = {}
    if fids:
        rows = (
            await session.execute(
                text("SELECT id::text, name FROM geological_formation WHERE id = ANY(:ids)"),
                {"ids": fids},
            )
        ).all()
        litho_name = {r[0]: r[1] for r in rows}
    if iids:
        for tbl, col in (("borehole", "name"), ("cpt", "test_id")):
            rows = (
                await session.execute(
                    text(f"SELECT id::text, {col} FROM {tbl} WHERE id = ANY(:ids)"),
                    {"ids": iids},
                )
            ).all()
            inv_name.update({r[0]: r[1] for r in rows if r[1]})
    return litho_name, inv_name


if __name__ == "__main__":
    asyncio.run(main())
