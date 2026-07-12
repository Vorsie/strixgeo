"""Integration tests for MaterializeWedgeTipsForFormation stale-tip cleanup (debt #231).

The rule being locked:
    Stale synthetic wedge-tip contacts are deleted ONCE for the whole
    (model, formation), and the deleted ids are pruned from EVERY
    section's ``seeded_formation_contact_ids`` array.

The 2026-07-12 audit (BE-APPLICATION-LITHO-01) found the stale-delete
running INSIDE the per-section loop with a query that is not
section-scoped: section k's iteration deleted all stale tips and pruned
only section k's seeded array, so every LATER section kept dangling
seeded UUIDs (and, when new tips were created, section k+1's pass
deleted the tips section k had just flushed). Single-section projects —
the common dogfeed case — never showed it.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.materialize_wedge_tips_for_formation import (
    MaterializeWedgeTipsForFormation,
)
from groundmodel.application.pinch_out_constants import PINCH_OUT_SOURCE
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

pytestmark = pytest.mark.asyncio


async def test_stale_tip_cleanup_prunes_every_sections_seeded_ids(
    db_session: AsyncSession,
) -> None:
    """WT1 — stale tips referenced by TWO sections: both seeded arrays are pruned.

    Fixture: two stale synthetic tips (source=pinch_out_extrapolation,
    no investigation anchor) whose ids sit in BOTH sections'
    ``seeded_formation_contact_ids``. No absences exist, so no new tips
    are created — the run is pure cleanup. Correct behaviour: the tips
    are deleted and BOTH arrays are emptied. The pre-#231 loop pruned
    only the first section's array (the second iteration's re-query
    found nothing left to delete), leaving section 2 with dangling ids.
    """
    project = ProjectOrm(
        id=uuid7(),
        name="Wedge-tip cleanup",
        default_horizontal_epsg=31370,
        default_vertical_epsg=5710,
        phase="design",
        status="active",
    )
    db_session.add(project)
    await db_session.flush()

    geo_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo",
        kind="geological",
    )
    db_session.add(geo_model)
    await db_session.flush()

    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho",
        kind="lithostratigraphic",
        parent_geological_model_id=geo_model.id,
    )
    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="ZAND A",
        color="#f4d03f",
        display_order=0,
    )
    db_session.add_all([model, formation])
    await db_session.flush()

    stale_a = FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        depth_top_m=2.0,
        source=PINCH_OUT_SOURCE,
        synthetic_x=150100.0,
        synthetic_y=200000.0,
        synthetic_elevation_m=3.0,
    )
    stale_b = FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        depth_top_m=3.5,
        source=PINCH_OUT_SOURCE,
        synthetic_x=150200.0,
        synthetic_y=200000.0,
        synthetic_elevation_m=1.5,
    )
    db_session.add_all([stale_a, stale_b])

    def _section(name: str, order: int) -> CrossSectionOrm:
        return CrossSectionOrm(
            id=uuid7(),
            app_project_id=project.id,
            name=name,
            start_x=150000.0,
            start_y=200000.0,
            end_x=150500.0,
            end_y=200000.0,
            epsg=31370,
            projection_buffer_m=25.0,
            display_order=order,
            seeded_formation_contact_ids=[stale_a.id, stale_b.id],
        )

    section_1 = _section("CS-1", 0)
    section_2 = _section("CS-2", 1)
    db_session.add_all([section_1, section_2])
    await db_session.commit()

    result = await MaterializeWedgeTipsForFormation(db_session).execute(
        project_id=project.id,
        model_id=model.id,
        formation_id=formation.id,
    )

    # The two stale tips are gone from the DB.
    remaining = (
        (
            await db_session.execute(
                select(FormationContactOrm.id).where(
                    FormationContactOrm.formation_id == formation.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert remaining == [], f"stale synthetic tips must be deleted, found {remaining}"
    assert result.old_contacts_deleted == 2

    # EVERY section's seeded array is pruned — not just the first one the
    # loop happened to visit (the dangling-ids half of the #231 bug).
    for section in (section_1, section_2):
        await db_session.refresh(section)
        dangling = set(section.seeded_formation_contact_ids) & {stale_a.id, stale_b.id}
        assert not dangling, (
            f"{section.name}: seeded_formation_contact_ids still references "
            f"deleted synthetic tips {sorted(map(str, dangling))} — the stale-tip "
            f"cleanup must prune every section's array, not only the first"
        )
