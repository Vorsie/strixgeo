"""Integration: synthetic pinch-out contacts persist + feed the TIN.

Covers the novel integration risks of the pinch-out slice that unit
tests cannot reach (the pure crossing geometry is unit-tested in
``tests/unit/domain/test_pinch_out_geometry.py``):

1. the migrated ``formation_contact_anchor_xor`` CHECK accepts a
   synthetic-only row (no borehole, no CPT, synthetic_x/y/elev set);
2. ``RecomputeFormationSurface``'s synthetic-anchor branch turns those
   rows into ``ContactPoint3D`` and real Delaunay builds a surface.

Real DB (runs only via ``scripts/run-integration-tests.ps1`` against
the sibling ``_integration`` DB — the migration is applied there).
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.recompute_formation_surface import (
    RecomputeFormationSurface,
)
from groundmodel.infrastructure.db.models.formation_contact_orm import (
    FormationContactOrm,
)
from groundmodel.infrastructure.db.models.formation_surface_orm import (
    FormationSurfaceOrm,
)
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)

from ..conftest import make_project


@pytest.mark.asyncio
async def test_synthetic_contacts_pass_xor_and_build_tin(
    db_session: AsyncSession,
) -> None:
    """Synthetic-only contacts are accepted by the XOR constraint and a
    Delaunay surface is built from their absolute coordinates."""
    project = await make_project(db_session)
    model = GeologicalModelOrm(id=uuid7(), app_project_id=project.id, name="M", kind="geological")
    formation = GeologicalFormationOrm(
        id=uuid7(), app_project_id=project.id, name="Lid van Roubaix", color="#abc"
    )
    db_session.add_all([model, formation])
    await db_session.flush()

    # Three non-collinear synthetic contacts (pinch tip + twin + a real
    # control elsewhere) so Delaunay can triangulate. borehole_id and
    # cpt_id are NULL — only the synthetic triple is set. If the migrated
    # 3-term XOR constraint were wrong this commit would raise.
    pts = [(0.0, 0.0, 10.0), (10.0, 0.0, 9.0), (5.0, 10.0, 8.0)]
    for x, y, z in pts:
        db_session.add(
            FormationContactOrm(
                id=uuid7(),
                model_id=model.id,
                formation_id=formation.id,
                borehole_id=None,
                cpt_id=None,
                synthetic_x=x,
                synthetic_y=y,
                synthetic_elevation_m=z,
                depth_top_m=0.0,
                source="pinch_out_extrapolation",
                confidence="low",
            )
        )
    await db_session.commit()  # exercises formation_contact_anchor_xor

    built = await RecomputeFormationSurface(db_session).execute(model.id, formation.id)
    assert built is True

    surface = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(
                FormationSurfaceOrm.model_id == model.id,
                FormationSurfaceOrm.formation_id == formation.id,
            )
        )
    ).scalar_one()
    # The synthetic branch fed all three points into the TIN and real
    # Delaunay produced at least one triangle.
    assert len(surface.vertices) == 3
    assert len(surface.triangles) >= 1
    # Elevations round-tripped verbatim from synthetic_elevation_m.
    assert sorted(v[2] for v in surface.vertices) == [8.0, 9.0, 10.0]
