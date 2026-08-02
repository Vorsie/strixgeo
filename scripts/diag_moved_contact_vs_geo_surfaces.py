"""READ-ONLY: are the moved litho contacts geological-surface elevations?

The contacts that moved under the two stale geotech columns sit off the CPT
sample grid at sub-millimetre precision — the signature of a TIN evaluation, not
of a suggestion (sample depth) or a hand drag (millimetre).  This script
evaluates every parent geological surface at each column's (x, y), converts to
depth below that column's surface elevation, and prints the distance to each
moved contact.

Only SELECTs are issued, behind the dev-DB guard.

Usage
-----
    uv run python scripts/diag_moved_contact_vs_geo_surfaces.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.application.subdivide_all_bodies import SubdivideAllBodies  # noqa: E402
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_formation_orm import (  # noqa: E402
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402

#: ``CPT name substring -> the contact depths of interest (old and new)``.
_CANDIDATES: dict[str, list[float]] = {
    "GEO-23/125-S17": [5.097907, 6.948372, 16.974479, 6.15, 6.51],
    "GEO-23/125-S9": [18.214173, 17.64],
}


async def main() -> None:
    """Print each geological surface's depth at the column next to the contacts."""
    print("\n=== MOVED CONTACTS vs GEOLOGICAL SURFACES (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        geotech = (
            (
                await session.execute(
                    select(GeologicalModelOrm).where(GeologicalModelOrm.kind == "geotechnical")
                )
            )
            .scalars()
            .one()
        )
        litho_model = await session.get(GeologicalModelOrm, geotech.parent_model_id)
        assert litho_model is not None

        use_case = SubdivideAllBodies(session)
        surfaces = await use_case._load_geo_surfaces_with_formation(litho_model.parent_model_id)
        names = {
            f.id: f.name
            for f in (await session.execute(select(GeologicalFormationOrm))).scalars().all()
        }

        cpts = (await session.execute(select(CptOrm))).scalars().all()
        for pattern, depths in _CANDIDATES.items():
            cpt = next((c for c in cpts if pattern in c.name), None)
            if cpt is None or cpt.elevation_m is None:
                continue
            print(f"--- {cpt.name}  surface elev {cpt.elevation_m}")
            for surf in surfaces:
                elev = use_case._evaluate(surf, cpt.location_x, cpt.location_y)
                depth = cpt.elevation_m - elev
                nearest = min(depths, key=lambda d: abs(d - depth))
                print(
                    f"    geo formation {str(names.get(surf.formation_id)):28s} "
                    f"elev {elev:10.6f}  depth {depth:11.6f}  "
                    f"nearest listed contact {nearest:10.6f} "
                    f"(delta {abs(nearest - depth) * 1000:9.4f} mm)"
                )
            print()


if __name__ == "__main__":
    asyncio.run(main())
