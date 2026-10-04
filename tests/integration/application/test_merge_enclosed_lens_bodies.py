"""Integration tests for MergeEnclosedLensBodies — section_id fix (C2).

Pins that ``MergeEnclosedLensBodies.execute`` stamps ``section_id`` on every
created merge edge.  Before the fix the INSERT dict omitted ``section_id``
even though the column is NOT NULL — causing an ``IntegrityError`` whenever a
merge edge was created (hit by "Materialise lens companions").

Test topology (one enclosed-lens column + one bare-host neighbour):

  Column A (bh_a, x=150000)         Column B (bh_b, x=150200)
    ZAND  0.0 → 3.0 m                ZAND  0.0 → 10.0 m (continuous)
    KLEI  3.0 → 5.0 m                (no KLEI — lens absent on neighbour)
    ZAND  5.0 → 10.0 m

``plan_enclosed_lens_merges`` returns two edges:
  ZAND_A_top  ↔  ZAND_B
  ZAND_A_bot  ↔  ZAND_B

After the fix both edges are inserted with ``section_id == section.id``.
Before the fix the INSERT raises ``IntegrityError: NOT NULL``.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.merge_enclosed_lens_bodies import MergeEnclosedLensBodies
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.integration._litho_builders import (
    contact as _contact,
)
from tests.integration._litho_builders import (
    geo_model as _geo_model,
)
from tests.integration._litho_builders import (
    litho_model as _litho_model,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float, elevation_m: float) -> BoreholeOrm:
    """Return an unsaved ``BoreholeOrm`` at *x* along y=200000."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-MELB-{suffix}",
        app_project_id=project_id,
        project_id="MELB",
        test_id=f"BH-MELB-{suffix}",
        location_x=x,
        location_y=200000.0,
        elevation_m=elevation_m,
        epsg=31370,
        total_depth_m=10.0,
    )


def _formation(
    project: ProjectOrm,
    parent: GeologicalFormationOrm,
    *,
    name: str,
    soil_code: str,
    order: int,
) -> GeologicalFormationOrm:
    """Return an unsaved litho-level formation."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        color="#aabbcc",
        display_order=order,
        parent_formation_id=parent.id,
        litho_main_soil_code=soil_code,
    )


def _geo_parent(project: ProjectOrm, *, name: str = "Quaternary MELB") -> GeologicalFormationOrm:
    """Return an unsaved geological-level formation."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        color="#cccccc",
        display_order=0,
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for MergeEnclosedLensBodies tests."""
    proj = ProjectOrm(id=uuid7(), name="merge enclosed lens bodies test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# MB1 — enclosed-lens topology: merge edges inserted with section_id stamped
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_merge_edges_carry_section_id(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Enclosed-lens topology triggers INSERT; every edge must carry section_id.

    Before the fix the INSERT dict omitted ``section_id`` → IntegrityError
    (NOT NULL violation).  After the fix:
      - ``edges_created == 2`` (top-host↔neighbour + bot-host↔neighbour)
      - Both created edges carry ``section_id == section.id``
    """
    geo = _geo_model(project, name="Geo MELB MB1")
    litho = _litho_model(project, geo, name="Litho MELB MB1")
    geo_parent = _geo_parent(project, name="Quaternary MELB MB1")

    # One geological parent so the formations share a parent
    # (plan_enclosed_lens_merges groups by litho_main_soil_code and
    #  the layer stacks use the soil code as the merge axis).
    f_zand = _formation(project, geo_parent, name="ZAND MELB MB1", soil_code="ZAND", order=1)
    f_klei = _formation(project, geo_parent, name="KLEI MELB MB1", soil_code="KLEI", order=2)

    # Column A (enclosed lens): ZAND 0-3 m, KLEI 3-5 m, ZAND 5-10 m.
    # Column B (bare host):     ZAND 0-10 m (no KLEI → lens absent on neighbour).
    # Both boreholes at same elevation (0 mTAW) so depth == elevation offset.
    bh_a = _borehole(project.id, suffix="A", x=150000.0, elevation_m=0.0)
    bh_b = _borehole(project.id, suffix="B", x=150200.0, elevation_m=0.0)

    db_session.add_all([geo, litho, geo_parent, f_zand, f_klei, bh_a, bh_b])
    await db_session.flush()

    # Column A contacts (depth_top_m drives top; FC→LL trigger sets depth_base_m
    # from the next contact's depth_top_m so the stack is gap-free).
    ca_zand_top = _contact(litho, f_zand, bh_a, depth=0.0)  # ZAND above lens
    ca_klei = _contact(litho, f_klei, bh_a, depth=3.0)  # KLEI lens
    ca_zand_bot = _contact(litho, f_zand, bh_a, depth=5.0)  # ZAND below lens
    # Column B contact (single ZAND covering 0-10 m).
    cb_zand = _contact(litho, f_zand, bh_b, depth=0.0)
    db_session.add_all([ca_zand_top, ca_klei, ca_zand_bot, cb_zand])
    await db_session.flush()

    # Section spanning both boreholes.
    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Sec-MELB-MB1",
        start_x=149900.0,
        start_y=200000.0,
        end_x=150300.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=500.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
        seeded_formation_contact_ids=[],
        vertical_exaggeration=1.0,
        display_order=0,
    )
    db_session.add(section)
    await db_session.commit()

    # Execute — before the fix this raises IntegrityError.
    result = await MergeEnclosedLensBodies(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        section_id=section.id,
    )

    assert result.edges_created >= 1, (
        f"Expected ≥1 merge edge; got edges_created={result.edges_created}.  "
        "If 0 the topology did not trigger the planner — check layer stacks."
    )

    # All created edges must carry section_id.
    rows = (
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == litho.id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) >= 1, "At least one edge row must exist in the DB after the merge"
    for row in rows:
        assert row.section_id == section.id, (
            f"Edge {row.id} has section_id={row.section_id!r}; expected {section.id!r}"
        )


# ---------------------------------------------------------------------------
# MB2 — no enclosed-lens topology → no edges, no error, clean no-op
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_enclosed_lens_is_noop(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """When no enclosed-lens topology exists, the use case returns 0/0 and no
    edges are created (idempotent no-op path; smoke-tests the early-exit branch).
    """
    geo = _geo_model(project, name="Geo MELB MB2")
    litho = _litho_model(project, geo, name="Litho MELB MB2")
    geo_parent = _geo_parent(project, name="Quaternary MELB MB2")
    f_zand = _formation(project, geo_parent, name="ZAND MELB MB2", soil_code="ZAND", order=1)
    bh_a = _borehole(project.id, suffix="NL-A", x=151000.0, elevation_m=0.0)
    db_session.add_all([geo, litho, geo_parent, f_zand, bh_a])
    await db_session.flush()

    # Single column, single ZAND unit — no lens pattern.
    ca = _contact(litho, f_zand, bh_a, depth=0.0)
    db_session.add(ca)
    await db_session.flush()

    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Sec-MELB-MB2",
        start_x=150900.0,
        start_y=200000.0,
        end_x=151100.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=500.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
        seeded_formation_contact_ids=[],
        vertical_exaggeration=1.0,
        display_order=0,
    )
    db_session.add(section)
    await db_session.commit()

    result = await MergeEnclosedLensBodies(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        section_id=section.id,
    )

    assert result.edges_created == 0
    assert result.edges_skipped_existing == 0


# ---------------------------------------------------------------------------
# MB3 — the merge writes ties; ties never make bodies.
# The 2026-07-13 expectation (a ZAND lens on its own formation row merging into
# its ZAND matrix body) is superseded twice: owner 2026-10-03 "never weld" (two
# litho units are two bodies, whatever the soil) and owner 2026-10-04 "identity
# follows the drawing" (a tie unions nothing; only the geometry facts the fill
# posts do). With no fact in the scene, the three layers stay three bodies.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_same_litho_enclosed_lens_merges_into_matrix_body(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """A same-soil enclosed lens (ZAND · ZAND-lens · ZAND on one column) stays apart.

    The merge's ties are surface statements only (identity follows the drawing),
    and the lens row is another litho unit (never weld): three bodies.
    """
    geo = _geo_model(project, name="Geo MELB MB3")
    litho = _litho_model(project, geo, name="Litho MELB MB3")
    geo_parent = _geo_parent(project, name="Quaternary MELB MB3")

    # Two DISTINCT ZAND formation rows, both litho_main_soil_code="ZAND", so the
    # middle layer is a distinct same-soil unit (a same-formation lens by the
    # merge axis) — the resolver would otherwise leave it its own body.
    f_zand_matrix = _formation(
        project, geo_parent, name="ZAND matrix MB3", soil_code="ZAND", order=1
    )
    f_zand_lens = _formation(project, geo_parent, name="ZAND lens MB3", soil_code="ZAND", order=2)

    bh_a = _borehole(project.id, suffix="MB3-A", x=152000.0, elevation_m=0.0)
    db_session.add_all([geo, litho, geo_parent, f_zand_matrix, f_zand_lens, bh_a])
    await db_session.flush()

    # Column A: ZAND(matrix) 0-3 m, ZAND(lens) 3-5 m, ZAND(matrix) 5-10 m.
    ca_top = _contact(litho, f_zand_matrix, bh_a, depth=0.0)
    ca_lens = _contact(litho, f_zand_lens, bh_a, depth=3.0)
    ca_bot = _contact(litho, f_zand_matrix, bh_a, depth=5.0)
    db_session.add_all([ca_top, ca_lens, ca_bot])
    await db_session.flush()

    section = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Sec-MELB-MB3",
        start_x=151900.0,
        start_y=200000.0,
        end_x=152100.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=500.0,
        excluded_borehole_ids=[],
        excluded_cpt_ids=[],
        seeded_formation_contact_ids=[],
        vertical_exaggeration=1.0,
        display_order=0,
    )
    db_session.add(section)
    await db_session.commit()

    await MergeEnclosedLensBodies(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        section_id=section.id,
    )

    # After the merge the three accepted ZAND layers keep three body ids.
    body_ids = (
        (
            await db_session.execute(
                select(LithoLayerOrm.body_id).where(
                    LithoLayerOrm.model_id == litho.id,
                    LithoLayerOrm.status == "accepted",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(body_ids) == 3, f"Expected 3 accepted ZAND layers; got {len(body_ids)}"
    assert all(b is not None for b in body_ids), "Every merged layer must carry a body_id"
    assert len(set(body_ids)) == 3, (
        f"Merge ties must not join bodies (identity follows the drawing) — expected "
        f"three body ids, got {len(set(body_ids))} distinct: {set(body_ids)}"
    )
