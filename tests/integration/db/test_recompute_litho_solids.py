"""Integration tests for RecomputeLithoSolids use case (Task 4, litho-3D).

Covers:
  RLS-1  Happy path — a body spanning ≥3 investigations produces one
         ``litho_body_solid`` row with triangles > 0 and ``is_stale=False``.
  RLS-2  Stale cascade — after calling ``mark_litho_solids_stale``, the
         row's ``is_stale`` becomes ``True``.
  RLS-3  Checksum short-circuit — a second execute with unchanged picks
         does NOT re-triangulate (``updated_at`` stays the same;
         ``bodies_skipped_checksum`` == 1).
  RLS-4  Flagged slab — a body with only 2 picks cannot form a valid
         solid and is emitted as a flagged slab (``is_flagged=True``,
         ``bodies_flagged`` == 1).
  RLS-5  No picks — if all layers have ``body_id=None``, the use case
         returns ``bodies_considered=0`` and writes no rows.
  RLS-6  Natural stale cascade — a geometry-only litho contact depth edit
         via ``UpdateFormationContact`` (no topology change, no cross-merge)
         must mark every solid for the model ``is_stale=True`` without
         the caller explicitly calling ``mark_litho_solids_stale``.
  RLS-7  Batch-path stale cascade — a geometry-only litho contact depth
         edit via ``UpdateFormationContactsBatch`` must mark every solid
         for the model ``is_stale=True``.  This is the multi-drag path
         which was missing the ``mark_litho_solids_stale`` call.
  RLS-9  Geology bounding — a straddling body is divided into two
         band-confined solids at the geological boundary; a too-shallow
         uncorrelated test is excluded and appears in ``marked_test_ids``.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.move_litho_layer_boundary import MoveLithoLayerBoundary
from groundmodel.application.recompute_litho_solids import RecomputeLithoSolids
from groundmodel.application.update_formation_contact import UpdateFormationContact
from groundmodel.application.update_formation_contacts_batch import UpdateFormationContactsBatch
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
    LithoLayerRepository,
)

# ---------------------------------------------------------------------------
# Private builder helpers
# ---------------------------------------------------------------------------


def _borehole(
    project_id: UUID, *, suffix: str, x: float, y: float = 200000.0, elev: float = 5.0
) -> BoreholeOrm:
    """Unsaved borehole with valid (x, y, elevation_m) so picks are loadable.

    ``y`` defaults to a constant — fine for the stale-cascade tests, which only
    need rows to exist regardless of solid shape. The happy-path test (RLS-1)
    overrides ``y`` per borehole so the three anchors are NOT collinear and
    ``compute_tin`` can fit a real (non-flagged) surface.
    """
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-RLS-{suffix}",
        app_project_id=project_id,
        project_id="RLS",
        test_id=f"BH-RLS-{suffix}",
        location_x=x,
        location_y=y,
        elevation_m=elev,
        epsg=31370,
        total_depth_m=20.0,
    )


def _layer(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    borehole: BoreholeOrm,
    *,
    top: float,
    base: float,
    status: str = "accepted",
) -> LithoLayerOrm:
    """Unsaved ``LithoLayerOrm`` anchored to *borehole*."""
    return LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=top,
        depth_base_m=base,
        status=status,
        source="manual",
        confidence="medium",
    )


def _edge(
    model: GeologicalModelOrm,
    layer_a: LithoLayerOrm,
    layer_b: LithoLayerOrm,
    section_id: UUID,
) -> LithoContactCorrelationEdgeOrm:
    """Approved correlation edge between two layers (same formation assumed by caller)."""
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        section_id=section_id,
        contact_a_id=layer_a.id,
        contact_b_id=layer_b.id,
        source="manual",
        user_approved=True,
    )


# ---------------------------------------------------------------------------
# Shared project + model fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession):
    """Project + geo + litho model + one geo formation + one litho formation.

    Returns a dict with keys: project, geo, litho, geo_parent, formation.
    The test functions add boreholes, layers, and edges as needed.
    """
    proj = ProjectOrm(id=uuid7(), name="RLS test", status="active")
    db_session.add(proj)
    await db_session.flush()

    geo = GeologicalModelOrm(id=uuid7(), app_project_id=proj.id, name="Geo", kind="geological")
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Litho",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )
    db_session.add_all([geo, litho])
    await db_session.flush()

    geo_parent = GeologicalFormationOrm(
        id=uuid7(), app_project_id=proj.id, name="Q", color="#ccc", display_order=0
    )
    db_session.add(geo_parent)
    await db_session.flush()

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND",
        color="#f5deb3",
        display_order=1,
        parent_formation_id=geo_parent.id,
        litho_main_soil_code="ZAND",
    )
    db_session.add(formation)
    await db_session.commit()

    return {
        "project": proj,
        "geo": geo,
        "litho": litho,
        "geo_parent": geo_parent,
        "formation": formation,
    }


# ---------------------------------------------------------------------------
# Helper: a minimal cross-section id (not a full section; just a UUID the
# edge foreign-key requires).
# ---------------------------------------------------------------------------


async def _seed_section(db_session: AsyncSession, project_id: UUID) -> UUID:
    """Insert a minimal cross-section row and return its id."""
    from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm

    sec = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="S-RLS",
        start_x=149000.0,
        start_y=200000.0,
        end_x=151000.0,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=200.0,
    )
    db_session.add(sec)
    await db_session.flush()
    return sec.id


# ---------------------------------------------------------------------------
# RLS-1: happy path — body spanning ≥3 investigations
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_three_investigation_body_produces_solid(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """A body assigned to 3 non-collinear boreholes must produce one solid row
    with triangles > 0 and ``is_stale=False`` after RecomputeLithoSolids.

    Seeding strategy: insert 3 boreholes with (x, y, elevation_m), create
    accepted litho layers, manually insert a body row, stamp body_id on
    the layers, then run the use case.  The resolver inside the use case
    is idempotent when body_ids are already consistent.
    """
    proj = scene["project"]
    litho = scene["litho"]
    f = scene["formation"]
    section_id = await _seed_section(db_session, proj.id)

    # Non-collinear anchors (y differs) so compute_tin fits a real surface —
    # a flagged slab would also satisfy triangles>0, so the spread is what
    # makes this a genuine watertight-solid test (asserted below).
    bh_a = _borehole(proj.id, suffix="1A", x=150000.0, y=200000.0, elev=5.0)
    bh_b = _borehole(proj.id, suffix="1B", x=150200.0, y=200000.0, elev=4.8)
    bh_c = _borehole(proj.id, suffix="1C", x=150100.0, y=200080.0, elev=5.2)
    db_session.add_all([bh_a, bh_b, bh_c])
    await db_session.flush()

    la = _layer(litho, f, bh_a, top=2.0, base=5.0)
    lb = _layer(litho, f, bh_b, top=2.1, base=5.1)
    lc = _layer(litho, f, bh_c, top=1.9, base=4.9)
    db_session.add_all([la, lb, lc])
    await db_session.flush()

    # Approved edges: a↔b and b↔c so the resolver creates one connected body.
    edge_ab = _edge(litho, la, lb, section_id)
    edge_bc = _edge(litho, lb, lc, section_id)
    db_session.add_all([edge_ab, edge_bc])
    await db_session.commit()

    outcome = await RecomputeLithoSolids(db_session).execute(litho.id)

    # The resolver should have created one body covering all 3 layers.
    assert outcome.bodies_considered >= 1, (
        f"Expected ≥1 body; got bodies_considered={outcome.bodies_considered}"
    )
    assert outcome.bodies_built >= 1, (
        f"Expected ≥1 body built; got bodies_built={outcome.bodies_built}"
    )

    rows = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) >= 1, f"Expected ≥1 solid row; got {len(rows)}"

    # The 3-point body must produce a REAL watertight solid, not a degenerate
    # flagged slab — is_flagged=False is the load-bearing assertion here (a
    # flagged slab also has triangles>0, so the count alone proves nothing).
    solid = rows[0]
    assert solid.is_stale is False, "Solid must be fresh after recompute"
    assert solid.is_flagged is False, (
        "Non-collinear 3-point body must fit a real surface, not a flagged slab"
    )
    assert len(solid.triangles) > 0, "Real solid must have triangles"
    assert len(solid.vertices) > 0, "Real solid must have vertices"


# ---------------------------------------------------------------------------
# RLS-2: stale cascade
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mark_litho_solids_stale_flips_flag(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """After calling mark_litho_solids_stale, every solid for the model
    must have ``is_stale=True``.
    """
    proj = scene["project"]
    litho = scene["litho"]
    f = scene["formation"]
    section_id = await _seed_section(db_session, proj.id)

    bh_a = _borehole(proj.id, suffix="2A", x=150000.0, elev=5.0)
    bh_b = _borehole(proj.id, suffix="2B", x=150200.0, elev=4.8)
    bh_c = _borehole(proj.id, suffix="2C", x=150100.0, elev=5.2)
    db_session.add_all([bh_a, bh_b, bh_c])
    await db_session.flush()

    la = _layer(litho, f, bh_a, top=2.0, base=5.0)
    lb = _layer(litho, f, bh_b, top=2.1, base=5.1)
    lc = _layer(litho, f, bh_c, top=1.9, base=4.9)
    db_session.add_all([la, lb, lc])
    await db_session.flush()

    edge_ab = _edge(litho, la, lb, section_id)
    edge_bc = _edge(litho, lb, lc, section_id)
    db_session.add_all([edge_ab, edge_bc])
    await db_session.commit()

    # Build solids first.
    await RecomputeLithoSolids(db_session).execute(litho.id)

    rows_after_build = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert rows_after_build, "Precondition: solids must exist after build"
    assert all(not r.is_stale for r in rows_after_build), "All must be fresh after build"

    # Now stale them.
    repo = LithoLayerRepository(db_session)
    flipped = await repo.mark_litho_solids_stale(litho.id)
    await db_session.commit()

    assert flipped == len(rows_after_build), (
        f"Expected {len(rows_after_build)} row(s) flipped; got {flipped}"
    )

    rows_after_stale = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert all(r.is_stale for r in rows_after_stale), "All solids must be stale after cascade"


# ---------------------------------------------------------------------------
# RLS-3: checksum short-circuit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_second_execute_skips_rebuild_when_picks_unchanged(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """A second execute with no pick changes must skip re-triangulation.

    ``bodies_skipped_checksum`` == 1 (the one body) and ``bodies_built`` == 0.
    """
    proj = scene["project"]
    litho = scene["litho"]
    f = scene["formation"]
    section_id = await _seed_section(db_session, proj.id)

    bh_a = _borehole(proj.id, suffix="3A", x=150000.0, elev=5.0)
    bh_b = _borehole(proj.id, suffix="3B", x=150200.0, elev=4.8)
    bh_c = _borehole(proj.id, suffix="3C", x=150100.0, elev=5.2)
    db_session.add_all([bh_a, bh_b, bh_c])
    await db_session.flush()

    la = _layer(litho, f, bh_a, top=2.0, base=5.0)
    lb = _layer(litho, f, bh_b, top=2.1, base=5.1)
    lc = _layer(litho, f, bh_c, top=1.9, base=4.9)
    db_session.add_all([la, lb, lc])
    await db_session.flush()

    edge_ab = _edge(litho, la, lb, section_id)
    edge_bc = _edge(litho, lb, lc, section_id)
    db_session.add_all([edge_ab, edge_bc])
    await db_session.commit()

    # First build.
    first = await RecomputeLithoSolids(db_session).execute(litho.id)
    assert first.bodies_built >= 1, "First execute must build"

    # Capture updated_at of the solid row.
    solid_after_first = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .first()
    )
    assert solid_after_first is not None
    updated_at_first: datetime = solid_after_first.updated_at

    # Second build — same picks, no stale flag.
    second = await RecomputeLithoSolids(db_session).execute(litho.id)

    assert second.bodies_built == 0, (
        f"Second execute must not rebuild; got bodies_built={second.bodies_built}"
    )
    assert second.bodies_skipped_checksum >= 1, (
        f"Expected ≥1 checksum skip; got bodies_skipped_checksum={second.bodies_skipped_checksum}"
    )

    solid_after_second = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .first()
    )
    assert solid_after_second is not None
    # updated_at must not have changed (no upsert fired).
    assert solid_after_second.updated_at == updated_at_first, (
        "updated_at must stay identical when checksum matches and solid is fresh"
    )


# ---------------------------------------------------------------------------
# RLS-4: flagged slab for under-constrained body
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_two_investigation_body_is_flagged(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """A body with exactly 2 investigations cannot form a valid TIN and must
    be emitted as a flagged slab (``is_flagged=True``, ``bodies_flagged==1``).
    """
    proj = scene["project"]
    litho = scene["litho"]
    f = scene["formation"]
    section_id = await _seed_section(db_session, proj.id)

    bh_a = _borehole(proj.id, suffix="4A", x=150000.0, elev=5.0)
    bh_b = _borehole(proj.id, suffix="4B", x=150200.0, elev=4.8)
    db_session.add_all([bh_a, bh_b])
    await db_session.flush()

    la = _layer(litho, f, bh_a, top=2.0, base=5.0)
    lb = _layer(litho, f, bh_b, top=2.1, base=5.1)
    db_session.add_all([la, lb])
    await db_session.flush()

    edge_ab = _edge(litho, la, lb, section_id)
    db_session.add(edge_ab)
    await db_session.commit()

    outcome = await RecomputeLithoSolids(db_session).execute(litho.id)

    assert outcome.bodies_flagged >= 1, (
        f"Expected ≥1 flagged body; got bodies_flagged={outcome.bodies_flagged}"
    )

    rows = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert rows, "A solid row must still be written for a flagged body"
    assert all(r.is_flagged for r in rows), "All rows for the 2-pick body must be flagged"


# ---------------------------------------------------------------------------
# RLS-5: no body-assigned layers → no rows written
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_accepted_layers_produces_no_solid_rows(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """When no accepted layers have a body_id, the use case must return
    ``bodies_considered=0`` and write zero ``litho_body_solid`` rows.
    """
    proj = scene["project"]
    litho = scene["litho"]
    f = scene["formation"]

    bh_a = _borehole(proj.id, suffix="5A", x=150000.0, elev=5.0)
    db_session.add(bh_a)
    await db_session.flush()

    # Pending (not accepted) layer — ignored by load_body_picks.
    la = _layer(litho, f, bh_a, top=2.0, base=5.0, status="pending")
    db_session.add(la)
    await db_session.commit()

    outcome = await RecomputeLithoSolids(db_session).execute(litho.id)

    assert outcome.bodies_considered == 0, (
        f"Expected bodies_considered=0; got {outcome.bodies_considered}"
    )

    rows = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert not rows, f"Expected 0 solid rows; got {len(rows)}"


# ---------------------------------------------------------------------------
# RLS-6: natural stale cascade via UpdateFormationContact (geometry-only edit)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_litho_contact_depth_edit_marks_solids_stale(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """A geometry-only litho contact depth edit via UpdateFormationContact
    must mark every solid for the model ``is_stale=True`` without the test
    explicitly calling ``mark_litho_solids_stale``.

    This is the natural cascade regression test for the Task-4 gap: the
    existing Task-4 hooks covered the resolver + three litho-specific use
    cases, but a pure depth-only ``UpdateFormationContact`` call on a litho
    contact went through ``mark_surfaces_stale`` WITHOUT touching
    ``mark_litho_solids_stale``, so the 3D solid cache silently diverged.
    """
    proj = scene["project"]
    litho = scene["litho"]
    f = scene["formation"]
    section_id = await _seed_section(db_session, proj.id)

    # Three boreholes for the solid body — same geometry as RLS-1.
    bh_a = _borehole(proj.id, suffix="6A", x=150000.0, elev=5.0)
    bh_b = _borehole(proj.id, suffix="6B", x=150200.0, elev=4.8)
    bh_c = _borehole(proj.id, suffix="6C", x=150100.0, elev=5.2)
    # A fourth borehole carries the formation contact under test.  It has NO
    # accepted litho layers, so the FC→LL mirror trigger fires on an empty
    # column and produces no constraint violations.
    bh_d = _borehole(proj.id, suffix="6D", x=150050.0, elev=4.9)
    db_session.add_all([bh_a, bh_b, bh_c, bh_d])
    await db_session.flush()

    la = _layer(litho, f, bh_a, top=2.0, base=5.0)
    lb = _layer(litho, f, bh_b, top=2.1, base=5.1)
    lc = _layer(litho, f, bh_c, top=1.9, base=4.9)
    db_session.add_all([la, lb, lc])
    await db_session.flush()

    edge_ab = _edge(litho, la, lb, section_id)
    edge_bc = _edge(litho, lb, lc, section_id)
    db_session.add_all([edge_ab, edge_bc])

    # Insert a litho FormationContact on bh_d (no accepted layers on that
    # anchor) so UpdateFormationContact has a target row on the litho model.
    # The FC→LL mirror trigger fires on bh_d but finds no existing accepted
    # layers to conflict with.
    litho_contact = FormationContactOrm(
        id=uuid7(),
        model_id=litho.id,
        formation_id=f.id,
        borehole_id=bh_d.id,
        depth_top_m=2.0,
        source="manual_pick",
    )
    db_session.add(litho_contact)
    await db_session.commit()

    # Build solids — precondition: solid exists and is fresh.
    await RecomputeLithoSolids(db_session).execute(litho.id)

    rows_after_build = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert rows_after_build, "Precondition: solid must exist after RecomputeLithoSolids"
    assert all(not r.is_stale for r in rows_after_build), (
        "Precondition: all solids must be fresh immediately after build"
    )

    # Geometry-only depth edit on the litho contact — move it 0.5 m deeper.
    # No cross-merge fires (depth 2.5 m is below 2.0 m but stays above 5.0 m
    # base, and litho cross-merge is disabled per owner directive 2026-05-27).
    # The session is in a fresh state (prior commit() closed the transaction).
    await UpdateFormationContact(db_session).execute(
        litho_contact.id,
        {"depth_top_m": 2.5},
    )

    # The use case committed. Re-query from the DB to pick up the stale flag.
    # Using a fresh model_id local variable avoids touching the expired litho
    # ORM proxy; the select() always issues a real DB round-trip.
    litho_model_id = litho.id
    rows_after_edit = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho_model_id)
            )
        )
        .scalars()
        .all()
    )
    assert rows_after_edit, "Solid rows must still exist after the depth edit"
    assert all(r.is_stale for r in rows_after_edit), (
        "All solids must be stale after a geometry-only litho contact depth edit — "
        "the natural cascade through UpdateFormationContact must fire mark_litho_solids_stale"
    )


# ---------------------------------------------------------------------------
# RLS-7: batch-path stale cascade via UpdateFormationContactsBatch
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_litho_contact_depth_edit_marks_solids_stale(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """A geometry-only litho contact depth edit via UpdateFormationContactsBatch
    (the multi-drag path) must mark every solid for the model ``is_stale=True``.

    This pins the missed cascade site: ``UpdateFormationContactsBatch`` called
    ``mark_surfaces_stale`` but never called ``mark_litho_solids_stale``, so
    the 3D solid cache silently diverged on multi-drag commits.
    """
    proj = scene["project"]
    litho = scene["litho"]
    f = scene["formation"]
    section_id = await _seed_section(db_session, proj.id)

    # Three boreholes for the solid body.
    bh_a = _borehole(proj.id, suffix="7A", x=150000.0, elev=5.0)
    bh_b = _borehole(proj.id, suffix="7B", x=150200.0, elev=4.8)
    bh_c = _borehole(proj.id, suffix="7C", x=150100.0, elev=5.2)
    # A fourth borehole carries the formation contact under test.
    bh_d = _borehole(proj.id, suffix="7D", x=150050.0, elev=4.9)
    db_session.add_all([bh_a, bh_b, bh_c, bh_d])
    await db_session.flush()

    la = _layer(litho, f, bh_a, top=2.0, base=5.0)
    lb = _layer(litho, f, bh_b, top=2.1, base=5.1)
    lc = _layer(litho, f, bh_c, top=1.9, base=4.9)
    db_session.add_all([la, lb, lc])
    await db_session.flush()

    edge_ab = _edge(litho, la, lb, section_id)
    edge_bc = _edge(litho, lb, lc, section_id)
    db_session.add_all([edge_ab, edge_bc])

    # A litho FormationContact on bh_d — batch path has a target row.
    litho_contact = FormationContactOrm(
        id=uuid7(),
        model_id=litho.id,
        formation_id=f.id,
        borehole_id=bh_d.id,
        depth_top_m=2.0,
        source="manual_pick",
    )
    db_session.add(litho_contact)
    await db_session.commit()

    # Build solids — precondition: solid exists and is fresh.
    await RecomputeLithoSolids(db_session).execute(litho.id)

    rows_after_build = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert rows_after_build, "Precondition: solid must exist after RecomputeLithoSolids"
    assert all(not r.is_stale for r in rows_after_build), (
        "Precondition: all solids must be fresh immediately after build"
    )

    # Geometry-only batch depth edit — move the contact 0.5 m deeper.
    result = await UpdateFormationContactsBatch(db_session).execute(
        litho.id,
        [(litho_contact.id, {"depth_top_m": 2.5})],
    )
    assert result is not None, "Batch update must succeed (not a scope-miss None)"

    litho_model_id = litho.id
    rows_after_edit = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho_model_id)
            )
        )
        .scalars()
        .all()
    )
    assert rows_after_edit, "Solid rows must still exist after the batch depth edit"
    assert all(r.is_stale for r in rows_after_edit), (
        "All solids must be stale after a geometry-only batch litho contact depth edit — "
        "UpdateFormationContactsBatch must call mark_litho_solids_stale"
    )


# ---------------------------------------------------------------------------
# RLS-8: layer-path stale cascade via MoveLithoLayerBoundary (geometry edit)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_move_litho_layer_boundary_marks_solids_stale(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """A boundary drag on an accepted litho layer via MoveLithoLayerBoundary
    must mark every solid for the model ``is_stale=True``.

    This pins the layer-path stale-cascade gap (same class as the contact-path
    fixes in RLS-6/RLS-7): MoveLithoLayerBoundary changes depth_top_m /
    depth_base_m of accepted layers, which alters the body-pick geometry, but
    the original code had no mark_litho_solids_stale call.
    """
    proj = scene["project"]
    litho = scene["litho"]
    f = scene["formation"]
    section_id = await _seed_section(db_session, proj.id)

    # Three non-collinear boreholes so the solid is real (matches RLS-1 geometry).
    bh_a = _borehole(proj.id, suffix="8A", x=150000.0, y=200000.0, elev=5.0)
    bh_b = _borehole(proj.id, suffix="8B", x=150200.0, y=200000.0, elev=4.8)
    bh_c = _borehole(proj.id, suffix="8C", x=150100.0, y=200080.0, elev=5.2)
    db_session.add_all([bh_a, bh_b, bh_c])
    await db_session.flush()

    # Two adjacent layers on bh_a: upper (2→5 m) + lower (5→8 m) so the
    # boundary move has a valid adjacent pair to operate on.
    la_upper = _layer(litho, f, bh_a, top=2.0, base=5.0)
    la_lower = _layer(litho, f, bh_a, top=5.0, base=8.0)
    lb = _layer(litho, f, bh_b, top=2.1, base=5.1)
    lc = _layer(litho, f, bh_c, top=1.9, base=4.9)
    db_session.add_all([la_upper, la_lower, lb, lc])
    await db_session.flush()

    # Correlate the upper bh_a layer with bh_b and bh_c to produce a body.
    edge_ab = _edge(litho, la_upper, lb, section_id)
    edge_bc = _edge(litho, lb, lc, section_id)
    db_session.add_all([edge_ab, edge_bc])
    await db_session.commit()

    # Build solids — precondition: solid exists and is fresh.
    await RecomputeLithoSolids(db_session).execute(litho.id)

    rows_after_build = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert rows_after_build, "Precondition: solid must exist after RecomputeLithoSolids"
    assert all(not r.is_stale for r in rows_after_build), (
        "Precondition: all solids must be fresh immediately after build"
    )

    # Move the shared boundary between la_upper and la_lower from 5.0 m to 5.5 m.
    # This changes la_upper.depth_base_m, which changes the body-pick geometry.
    await MoveLithoLayerBoundary(db_session).execute(
        upper_layer_id=la_upper.id,
        lower_layer_id=la_lower.id,
        new_depth_m=5.5,
    )

    litho_model_id = litho.id
    rows_after_move = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho_model_id)
            )
        )
        .scalars()
        .all()
    )
    assert rows_after_move, "Solid rows must still exist after the boundary move"
    assert all(r.is_stale for r in rows_after_move), (
        "All solids must be stale after a litho layer boundary move — "
        "MoveLithoLayerBoundary must call mark_litho_solids_stale"
    )


# ---------------------------------------------------------------------------
# RLS-9: geology bounding — straddling body splits; shallow test excluded
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_geology_bounding_splits_straddling_body_and_marks_shallow_test(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """Geology bounding divides a body that straddles a geological boundary.

    The LL↔FC bidirectional trigger (``trg_mirror_litho_layer_to_contact``) sets
    a layer's ``depth_base_m`` to ``COALESCE(next_contact_top_m, total_depth_m)``
    when the layer is the LAST (or only) layer on the borehole.  Consequently the
    effective layer depth is ``total_depth_m``, not the value passed to
    ``LithoLayerOrm(depth_base_m=...)``.  The fixture therefore controls layer
    depth via ``total_depth_m`` on each ``BoreholeOrm``:

    - BH-A and BH-B get ``total_depth_m=6.0`` → their single layer's
      ``depth_base_m`` becomes 6.0 after the trigger fires → elevation 0→-6,
      straddling the geological boundary at -3.0.
    - BH-SHALLOW gets ``total_depth_m=2.0`` → its single layer's
      ``depth_base_m`` becomes 2.0 → elevation 0→-2, entirely ABOVE -3.0.

    Setup:
    - One geological formation surface: flat TIN at elevation -3.0 m over
      a footprint that covers all borehole (x, y) positions.
    - BH-A (150000, 200000, elev=0): single layer depth 0→6, correlated with BH-B.
    - BH-B (150200, 200050, elev=0): single layer depth 0→6, correlated with BH-A.
      BH-A and BH-B form ONE body via a single approved edge.
    - BH-SHALLOW (150100, 200020, elev=0): single layer depth 0→2 (elevation 0→-2,
      above the -3.0 boundary). Uncorrelated → single-hole body.

    Expected outcome after ``RecomputeLithoSolids``:
    - The straddling clay body (BH-A + BH-B) is divided at -3.0 into an UPPER
      band and a LOWER band (each with a derived ``body_id``) → 2 solid rows.
    - BH-SHALLOW is above the lowest geological boundary (-3.0) and carries no
      lateral correlation → excluded entirely; its investigation id appears in
      ``outcome.marked_test_ids``.
    - Every solid vertex sits wholly above OR wholly below -3.0 (no solid
      crosses the boundary).

    The TIN is a horizontal quad at -3.0 tessellated into two triangles whose
    footprint encloses all three borehole (x, y) positions.
    ``evaluate_tin_at`` returns exactly -3.0 for any point inside the quad.
    """
    proj = scene["project"]
    geo = scene["geo"]
    litho = scene["litho"]
    f = scene["formation"]
    geo_parent = scene["geo_parent"]
    section_id = await _seed_section(db_session, proj.id)

    # ── Geological surface: flat TIN at elevation -3.0 ──────────────────────
    # Quad corners surround all three borehole positions with generous padding.
    # Two triangles: [0,1,2] and [0,2,3].
    xmin, xmax = 149500.0, 150700.0
    ymin, ymax = 199500.0, 200600.0
    flat_z = -3.0
    geo_surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=geo.id,
        formation_id=geo_parent.id,
        method="tin",
        vertices=[
            [xmin, ymin, flat_z],  # 0
            [xmax, ymin, flat_z],  # 1
            [xmax, ymax, flat_z],  # 2
            [xmin, ymax, flat_z],  # 3
        ],
        triangles=[[0, 1, 2], [0, 2, 3]],
        source_contact_count=4,
        # Dummy checksum — fixture row, not a live recompute product.
        source_contact_checksum=b"\x00" * 16,
        is_stale=False,
    )
    db_session.add(geo_surface)
    await db_session.flush()

    # ── Boreholes ────────────────────────────────────────────────────────────
    # Non-collinear (y differs on BH-A vs BH-B) so the 2-pick band bodies
    # can form a real TIN if there were 3+ picks — with 2 picks they are
    # flagged slabs, which is expected and asserted.
    #
    # IMPORTANT — total_depth_m controls the effective layer depth:
    # The LL→FC trigger (trg_mirror_litho_layer_to_contact) mirrors an
    # accepted LithoLayerOrm into formation_contact.  The FC→LL trigger
    # (trg_mirror_litho_contact_to_layer) then re-derives depth_base_m from
    # COALESCE(next_contact_top_m, total_depth_m).  For a single layer on the
    # borehole next_contact_top_m is NULL, so depth_base_m = total_depth_m.
    # Setting total_depth_m to the desired layer base depth is the only way
    # to get the intended depth into the pick that load_body_picks sees.
    bh_a = BoreholeOrm(
        id=uuid7(),
        name="BH-RLS-9A",
        app_project_id=proj.id,
        project_id="RLS9",
        test_id="BH-RLS-9A",
        location_x=150000.0,
        location_y=200000.0,
        elevation_m=0.0,  # surface at 0 m → depth = -elevation
        epsg=31370,
        total_depth_m=6.0,  # trigger sets layer depth_base_m → 6.0
    )
    bh_b = BoreholeOrm(
        id=uuid7(),
        name="BH-RLS-9B",
        app_project_id=proj.id,
        project_id="RLS9",
        test_id="BH-RLS-9B",
        location_x=150200.0,
        location_y=200050.0,
        elevation_m=0.0,
        epsg=31370,
        total_depth_m=6.0,  # trigger sets layer depth_base_m → 6.0
    )
    bh_shallow = BoreholeOrm(
        id=uuid7(),
        name="BH-RLS-9S",
        app_project_id=proj.id,
        project_id="RLS9",
        test_id="BH-RLS-9S",
        location_x=150100.0,
        location_y=200020.0,
        elevation_m=0.0,
        epsg=31370,
        total_depth_m=2.0,  # trigger sets layer depth_base_m → 2.0 (above -3.0)
    )
    db_session.add_all([bh_a, bh_b, bh_shallow])
    await db_session.flush()

    # ── Litho layers ─────────────────────────────────────────────────────────
    # depth_top_m=0 for all; depth_base_m written here will be overwritten by
    # the FC→LL trigger to total_depth_m (see borehole comments above).
    la = _layer(litho, f, bh_a, top=0.0, base=6.0)
    lb = _layer(litho, f, bh_b, top=0.0, base=6.0)
    # BH-SHALLOW: depth 0→2 (elevation 0→-2), stays above the -3.0 boundary.
    ls = _layer(litho, f, bh_shallow, top=0.0, base=2.0)
    db_session.add_all([la, lb, ls])
    await db_session.flush()

    # ── Correlation edge: BH-A ↔ BH-B only (BH-SHALLOW intentionally excluded)
    edge_ab = _edge(litho, la, lb, section_id)
    db_session.add(edge_ab)
    await db_session.commit()

    # ── Run the use case ──────────────────────────────────────────────────────
    outcome = await RecomputeLithoSolids(db_session).execute(litho.id, force=True)

    # ── Assertions ────────────────────────────────────────────────────────────

    # The straddling body (BH-A + BH-B, depth 0→6 → elevation 0→-6) must be
    # divided at the -3.0 geological boundary into an UPPER and a LOWER band,
    # each with a distinct derived body_id → exactly 2 solid rows.
    # BH-SHALLOW is above the floor (-2 > -3) with no lateral tie → excluded
    # entirely → no additional solid rows.
    rows = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 2, (
        f"Expected exactly 2 solid rows (upper + lower band-split); got {len(rows)}. "
        f"body_ids: {[str(r.body_id) for r in rows]}"
    )

    # Each solid must lie wholly above OR wholly below the geological boundary.
    # A solid that crosses -3.0 would prove the division did not happen.
    boundary_z = -3.0
    eps = 1e-4  # generous float-accumulation guard
    for solid in rows:
        zs = [v[2] for v in solid.vertices]
        wholly_above = min(zs) >= boundary_z - eps
        wholly_below = max(zs) <= boundary_z + eps
        assert wholly_above or wholly_below, (
            f"Solid {solid.body_id} vertices span the geological boundary at "
            f"{boundary_z}: min(z)={min(zs):.4f}  max(z)={max(zs):.4f}"
        )

    # BH-SHALLOW's investigation id (= str(bh_shallow.id)) must be reported
    # as a marked too-shallow test (its deepest point is above the boundary).
    shallow_inv_id = str(bh_shallow.id)
    assert shallow_inv_id in outcome.marked_test_ids, (
        f"Expected BH-SHALLOW ({shallow_inv_id}) in marked_test_ids; got {outcome.marked_test_ids}"
    )
