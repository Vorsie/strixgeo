"""Load a project's packing-class identity function for the 3-D voxel paint.

Debt #278: the geotech model keeps one ``geological_formation`` ROW per (NAD
packing class, litho parent, geological parent), so the same class exists under
several row ids wherever a litho unit spans a geological boundary.

The 3-D voxel PAINT build
(:class:`~groundmodel.application.build_voxel_litho_model.BuildVoxelLithoModel`)
compares the CLASS within one litho unit, not the row, so two same-class masses
of one unit paint as one voxel body — this is what prevents the invented-
lithology pinch (owner 2026-08-21, "yes one mass one body"). Two litho units
never collapse (owner 2026-10-03: ZAND and ZAND (SL:M) never weld).

NOTE the persisted body IDENTITY recompute
(:class:`~groundmodel.application.recompute_bodies.RecomputeBodies`) NO LONGER
uses this: it went permanently granular (owner 2026-09-01, "start totally
granular ... the user lumps them into groups"), keying on the raw formation row
so disconnected same-class masses stay distinct bodies. The paint-vs-identity
divergence is a decided ruling, not an oversight. This loader therefore has a
single caller today; it stays a named helper so the ORM query + projection has
one home should the identity path ever want a (different) key again.

It reads the ORM rows and hands the pure domain builder
(:func:`~groundmodel.domain.services.voxel_litho.packing_class_key.packing_class_key_of`)
plain triples, so the domain layer never sees an ORM type.
"""

from __future__ import annotations

from collections.abc import Callable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.domain.services.voxel_litho.packing_class_key import packing_class_key_of
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm


async def load_packing_class_key(session: AsyncSession, project_id: UUID) -> Callable[[str], str]:
    """Build the formation-id → packing-class-key function for one project.

    Parameters
    ----------
    session : AsyncSession
        Active SQLAlchemy async session used to read the project's formations.
    project_id : UUID
        The project whose ``geological_formation`` rows are read.

    Returns
    -------
    callable of (str) -> str
        Maps a region's ``formation_id`` to its ``"{litho_unit}|{soil}|{nad_class}"``
        class key when the row carries both a NAD class and a soil code, and to the id
        UNCHANGED otherwise. A litho model's rows carry no NAD class, so the key
        is the identity function there and any caller is byte-identical to a
        row-keyed merge.
    """
    rows = (
        await session.execute(
            select(
                GeologicalFormationOrm.id,
                GeologicalFormationOrm.nad_class,
                GeologicalFormationOrm.litho_main_soil_code,
                GeologicalFormationOrm.source_litho_formation_id,
            ).where(GeologicalFormationOrm.app_project_id == project_id)
        )
    ).all()
    return packing_class_key_of(
        (
            str(r.id),
            r.nad_class,
            r.litho_main_soil_code,
            None if r.source_litho_formation_id is None else str(r.source_litho_formation_id),
        )
        for r in rows
    )
