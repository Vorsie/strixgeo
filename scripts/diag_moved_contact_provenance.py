"""READ-ONLY: where do the moved litho contacts' depth values come from?

The two columns whose geotech bands went stale had litho contacts move to
values that are NOT millimetre-rounded (5.097907 m, 6.948372 m, 18.214173 m).
A hand drag lands on a millimetre; a suggestion lands on a CPT sample. This
script checks each candidate depth against the column's raw depth series and
reports the nearest sample, so the provenance of the edit is visible.

Only SELECTs are issued, behind the dev-DB guard.

Usage
-----
    uv run python scripts/diag_moved_contact_provenance.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from sqlalchemy import select  # noqa: E402

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm  # noqa: E402
from groundmodel.infrastructure.db.models.cpt_series_orm import CptSeriesOrm  # noqa: E402
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402
from scripts.eval_strat_fidelity import _confirm_db_target  # noqa: E402

#: ``CPT name substring -> depths to locate in that CPT's series``.
_CANDIDATES: dict[str, list[float]] = {
    "GEO-23/125-S17": [2.45, 5.097907, 6.15, 6.51, 6.948372, 9.10, 16.974479],
    "GEO-23/125-S9": [9.68, 17.64, 18.214173, 20.05],
}


async def main() -> None:
    """Report, per candidate depth, the nearest sample in the CPT's depth series."""
    print("\n=== MOVED-CONTACT DEPTH PROVENANCE (READ-ONLY) ===\n")
    _confirm_db_target()

    async with AsyncSessionFactory() as session:
        cpts = (await session.execute(select(CptOrm))).scalars().all()
        for pattern, depths in _CANDIDATES.items():
            cpt = next((c for c in cpts if pattern in c.name), None)
            if cpt is None:
                print(f"  ! no CPT matching {pattern!r}")
                continue
            series = (
                await session.execute(select(CptSeriesOrm).where(CptSeriesOrm.cpt_id == cpt.id))
            ).scalar_one()
            samples = list(series.depths_m)
            spacing = sorted(b - a for a, b in zip(samples, samples[1:]))
            print(f"--- {cpt.name}: {len(samples)} samples, {samples[0]} .. {samples[-1]}")
            print(
                f"    spacing min/median/max = {spacing[0]:.6f} / "
                f"{spacing[len(spacing) // 2]:.6f} / {spacing[-1]:.6f}"
            )
            for d in depths:
                nearest = min(samples, key=lambda s: abs(s - d))
                exact = abs(nearest - d) < 1e-9
                print(
                    f"    {d:12.6f}  nearest sample {nearest:12.6f}  "
                    f"delta {abs(nearest - d) * 1000:8.4f} mm  "
                    f"{'EXACT SAMPLE' if exact else ''}"
                )
            print()


if __name__ == "__main__":
    asyncio.run(main())
