"""Does geology-bounding (Option B) resolve the strat-builder cycles on test.strix?

The single-field builder is blocked because the litho instance order has cycles
(``eval_strat_cycles.py``). Option B fits one field PER GEOLOGICAL BAND. For that
to break the cycles, splitting each over-merged body at the geological boundaries
must yield a conformable order WITHIN each band.

This script tests exactly that: it assigns each litho pick to a geological band
(by its mid-elevation vs the parent geological model's surfaces at that x,y),
uses ``(body_id, band)`` as the per-block instance identity, rebuilds the
precedence DAG INSIDE each band, and reports whether any band still cycles.

- All bands acyclic  -> Option B resolves test.strix (cross-band over-merge was
  the whole problem).
- A band still cycles -> that band has genuine within-band interbedding; B needs a
  within-band sub-strategy (occurrence-split / lens) there too.

Read-only.
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
from groundmodel.domain.services.tin_surface import evaluate_tin_at  # noqa: E402
from groundmodel.domain.value_objects.tin_surface import TinSurface  # noqa: E402
from groundmodel.infrastructure.db.repositories.geology_repository import (  # noqa: E402
    GeologyRepository,
)
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (  # noqa: E402
    LithoLayerRepository,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402

_MODEL_ID = UUID("019e934c-70fd-7d11-a44a-b2073f4063a2")


async def main() -> None:
    """Assign picks to geo bands, rebuild per-band DAGs, report per-band cycles."""
    async with AsyncSessionFactory() as session:
        await ResolveLithoInstances(session).execute(model_id=_MODEL_ID, commit=False)
        picks = await LithoLayerRepository(session).load_body_picks(_MODEL_ID)
        parent_id = (
            await session.execute(
                text("SELECT parent_geological_model_id FROM geological_model WHERE id = :m"),
                {"m": str(_MODEL_ID)},
            )
        ).scalar_one()
        surfaces = await GeologyRepository(session).list_surfaces(parent_id)
        litho_name = dict(
            (
                await session.execute(
                    text("SELECT id::text, name FROM geological_formation WHERE id = ANY(:ids)"),
                    {"ids": sorted({p.formation_id for p in picks})},
                )
            ).all()
        )

    # Geological band surfaces as TINs, with their formation name (band-below label).
    tins: list[tuple[str, TinSurface]] = [
        (
            str(s.formation_id),
            TinSurface(
                vertices=[tuple(v) for v in s.vertices],
                triangles=[tuple(t) for t in s.triangles],
            ),
        )
        for s in surfaces
    ]

    def band_index(x: float, y: float, mid_elev: float) -> int:
        """Band index = how many geological surfaces lie ABOVE this elevation at (x,y)."""
        n = 0
        for _fid, tin in tins:
            e = evaluate_tin_at(tin, x, y)
            if e is None:
                # Outside the TIN footprint: nearest-vertex fallback (as the builder does).
                e = min(tin.vertices, key=lambda v: (v[0] - x) ** 2 + (v[1] - y) ** 2)[2]
            if e > mid_elev:
                n += 1
        return n

    # Assign each pick to a band; instance identity = (body_id, band).
    by_band_inv: dict[tuple[int, str], list] = defaultdict(list)
    inst_band: dict[tuple[str, int], str] = {}  # (body_id,band) -> formation
    for p in picks:
        mid = p.surface_elev_m - 0.5 * (p.top_depth_m + p.base_depth_m)
        bi = band_index(p.x_m, p.y_m, mid)
        by_band_inv[(bi, p.investigation_id)].append(p)
        inst_band[(p.body_id, bi)] = p.formation_id

    # Per band: build the precedence DAG over (body_id) restricted to that band.
    bands = sorted({bi for bi, _ in by_band_inv})
    print("=" * 70)
    print("GEOLOGY-BOUNDED (per-band) CONFORMABILITY")
    print(f"parent geo model {parent_id} - {len(tins)} band surface(s)")
    print("=" * 70)
    total_cyclic_bands = 0
    for bi in bands:
        g = nx.DiGraph()
        for (b2, _inv), inv_picks in by_band_inv.items():
            if b2 != bi:
                continue
            inv_picks.sort(key=lambda x: x.top_depth_m)
            for a, c in zip(inv_picks, inv_picks[1:]):
                if a.body_id != c.body_id:
                    g.add_edge(a.body_id, c.body_id)
        sccs = [s for s in nx.strongly_connected_components(g) if len(s) > 1]
        formations = Counter(litho_name.get(inst_band.get((n, bi), ""), "?") for n in g.nodes)
        flag = "CYCLES" if sccs else "acyclic OK"
        print(
            f"  band {bi}: {g.number_of_nodes():3d} bodies, "
            f"{g.number_of_edges():3d} edges - {flag}"
            + (f"  SCCs={[len(s) for s in sccs]}" if sccs else "")
        )
        print(f"           lithologies: {dict(formations)}")
        if sccs:
            total_cyclic_bands += 1
            for scc in sccs:
                names = Counter(litho_name.get(inst_band.get((n, bi), ""), "?") for n in scc)
                print(f"           cycle members: {dict(names)}")
    print("=" * 70)
    if total_cyclic_bands == 0:
        print(
            "VERDICT: every geological band is acyclic -> Option B (per-band fit) "
            "RESOLVES the cycles. The cycles were cross-band over-merges."
        )
    else:
        print(
            f"VERDICT: {total_cyclic_bands} band(s) still cycle -> those bands have "
            "genuine within-band interbedding; B needs a within-band sub-strategy there."
        )
    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
