"""Explain WHERE a borehole's planned packing bands come from.

Read-only.  Runs the REAL ``DivideBoreholes.plan`` against the dev database and
prints, per borehole column: the planned bands, and for each of them the mode
(flank-interpolated / single donor / nearest fallback / conservative fill), the
donor CPT(s) with their along- and map-distances, and the section the donors
were read along.

Born 2026-08-04 from the owner's dogfeed question "I'd expect the dense sand to
be higher at 1411-GEO-23/126-B4".  It was: the planner blended an ordinal
transition surface out of every CPT in the body group — up to ten different
class pairs, over CPTs as far as 777 m away.  The owner's ruling replaced that
with the two CPTs flanking the borehole on the cross section; this script is
how that claim is checked against the real model.

Usage::

    uv run python scripts/diag_divide_borehole_explain.py "126-B4"
    uv run python scripts/diag_divide_borehole_explain.py --all

The first form takes a case-insensitive substring of the borehole name.
``--all`` prints the per-mode census over every borehole in the model instead.
"""

from __future__ import annotations

import asyncio
import sys
from collections import Counter
from uuid import UUID

from sqlalchemy import select

sys.path.insert(0, "src")

from groundmodel.application.divide_boreholes import (  # noqa: E402
    DivideBoreholePlan,
    DivideBoreholes,
    PlannedBand,
)
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm  # noqa: E402
from groundmodel.infrastructure.db.models.geological_model_orm import (  # noqa: E402
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.session import AsyncSessionFactory  # noqa: E402


def _describe(band: PlannedBand, surface_elev: float) -> str:
    """Render one planned band as a single provenance line.

    Parameters
    ----------
    band : PlannedBand
        The band to describe.
    surface_elev : float
        The borehole's collar elevation (m), so depths read as elevations too.

    Returns
    -------
    str
        Depths, elevations, NAD class, mode, section and donors.
    """
    donors = (
        " ".join(
            f"{donor.side}={donor.name}"
            f"(along={'-' if donor.along_distance_m is None else f'{donor.along_distance_m:.0f}m'},"
            f"map={donor.map_distance_m:.0f}m)"
            for donor in band.donors
        )
        or "-"
    )
    return (
        f"{band.depth_top_m:6.2f}-{band.depth_base_m:6.2f} m "
        f"(elev {surface_elev - band.depth_top_m:6.2f}..{surface_elev - band.depth_base_m:6.2f}) "
        f"NAD {band.nad_class:<3} {band.mode or band.source:<18} "
        f"section={band.section_name or '-':<12} {donors}"
    )


async def _load_models(session: object, project_id: UUID) -> tuple[UUID | None, UUID | None]:
    """Return ``(litho_model_id, geotech_model_id)`` for a project.

    Parameters
    ----------
    session : object
        Active ``AsyncSession``.
    project_id : UUID
        Owning project.

    Returns
    -------
    tuple[UUID | None, UUID | None]
        The lithostratigraphic and geotechnical model ids, either possibly
        ``None`` when that model does not exist.
    """
    rows = (
        await session.execute(  # type: ignore[attr-defined]
            select(GeologicalModelOrm.id, GeologicalModelOrm.kind).where(
                GeologicalModelOrm.app_project_id == project_id,
                GeologicalModelOrm.kind.in_(["lithostratigraphic", "geotechnical"]),
            )
        )
    ).all()
    litho = next((r.id for r in rows if r.kind == "lithostratigraphic"), None)
    geotech = next((r.id for r in rows if r.kind == "geotechnical"), None)
    return litho, geotech


def _census(plan: DivideBoreholePlan) -> None:
    """Print the per-mode band and borehole census for a whole plan.

    Parameters
    ----------
    plan : DivideBoreholePlan
        The plan to summarise.
    """
    band_modes: Counter[str] = Counter()
    borehole_modes: dict[str, set[str]] = {}
    for column in plan.columns():
        for band in column.bands:
            mode = band.mode or band.source
            band_modes[mode] += 1
            borehole_modes.setdefault(column.name, set()).add(mode)

    print(f"\nboreholes with bands: {len(borehole_modes)}   bands: {plan.layer_count}")
    print("\nbands per mode:")
    for mode, count in band_modes.most_common():
        print(f"  {mode:<20} {count}")
    print("\nboreholes whose CPT-derived bands used each mode (a column can use several):")
    donor_modes = ("flank_interpolated", "single_donor", "nearest_fallback")
    for mode in donor_modes:
        names = sorted(name for name, modes in borehole_modes.items() if mode in modes)
        print(f"  {mode:<20} {len(names)}  {', '.join(names) if names else '-'}")
    conservative_only = sorted(
        name for name, modes in borehole_modes.items() if not modes.intersection(donor_modes)
    )
    print(
        f"  {'conservative only':<20} {len(conservative_only)}  "
        f"{', '.join(conservative_only) if conservative_only else '-'}"
    )


async def main(argument: str) -> None:
    """Explain one borehole, or census the whole model with ``--all``.

    Parameters
    ----------
    argument : str
        A case-insensitive substring of a borehole name, or ``--all``.
    """
    async with AsyncSessionFactory() as session:
        if argument == "--all":
            project_id = (
                await session.execute(select(BoreholeOrm.app_project_id).limit(1))
            ).scalar_one_or_none()
            if project_id is None:
                print("no boreholes in the database")
                return
            surface_elev = 0.0
            target_id: UUID | None = None
        else:
            row = (
                await session.execute(
                    select(
                        BoreholeOrm.id,
                        BoreholeOrm.name,
                        BoreholeOrm.location_x,
                        BoreholeOrm.location_y,
                        BoreholeOrm.elevation_m,
                        BoreholeOrm.app_project_id,
                    ).where(BoreholeOrm.name.ilike(f"%{argument}%"))
                )
            ).first()
            if row is None:
                print(f"no borehole matching {argument!r}")
                return
            target_id, name, x, y, surface_elev, project_id = row
            print(f"borehole {name} ({target_id})  xy=({x:.1f},{y:.1f})  surf={surface_elev:.2f} m")

        litho_id, geotech_id = await _load_models(session, project_id)
        if litho_id is None or geotech_id is None:
            print(f"missing models: litho={litho_id} geotech={geotech_id}")
            return

        plan = await DivideBoreholes(session).plan(project_id=project_id, litho_model_id=litho_id)

        if target_id is None:
            _census(plan)
            return

        for column in plan.columns():
            if column.borehole_id != target_id:
                continue
            print(f"\nplanned bands ({len(column.bands)}):")
            for band in column.bands:
                print("  " + _describe(band, surface_elev))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "126-B4"))
