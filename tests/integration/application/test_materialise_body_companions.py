"""Integration tests for MaterialiseBodyCompanions — #133 Phase 2+3.

Four cases:
1. Gate-pass: LithoLens with primary section where every seeded contact
   has an approved edge → companion section created.
2. Gate-fail: One seeded contact has no approved edge →
   skipped_unfinished_section++; no companion created.
3. Null primary: LithoLens.primary_section_id is None →
   skipped_no_primary++.
4. Idempotent: second run produces zero new companions (NOT EXISTS guard
   in the use case detects the already-existing companion).
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.materialise_body_companions import MaterialiseBodyCompanions
from groundmodel.infrastructure.db.models.body_orm import (
    BodyOrm as LithoLensOrm,
)  # TODO: slice 2 — full rename
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Private fixture helpers (mirror test_accept_contact_correlations.py pattern)
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float) -> BoreholeOrm:
    """Return an unsaved BoreholeOrm with minimal required fields."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project_id,
        project_id="MATCOMP",
        test_id=f"BH-MATCOMP-{suffix}",
        location_x=x,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=20.0,
    )


def _geo_model(project: ProjectOrm) -> GeologicalModelOrm:
    """Return an unsaved geological GeologicalModelOrm."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geo-MATCOMP",
        kind="geological",
    )


def _litho_model(project: ProjectOrm, geo: GeologicalModelOrm) -> GeologicalModelOrm:
    """Return an unsaved lithostratigraphic GeologicalModelOrm."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-MATCOMP",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )


def _geo_parent(project: ProjectOrm, *, name: str = "Quaternary") -> GeologicalFormationOrm:
    """Return an unsaved geological-level GeologicalFormationOrm (no parent)."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        color="#cccccc",
        display_order=0,
    )


def _formation(
    project: ProjectOrm,
    parent: GeologicalFormationOrm,
    *,
    name: str,
    soil_code: str = "KLEI",
) -> GeologicalFormationOrm:
    """Return an unsaved litho-level GeologicalFormationOrm."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        color="#aabbcc",
        display_order=0,
        parent_formation_id=parent.id,
        litho_main_soil_code=soil_code,
    )


def _contact(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    borehole: BoreholeOrm,
    *,
    depth: float,
) -> FormationContactOrm:
    """Return an unsaved FormationContactOrm."""
    return FormationContactOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=depth,
        source="borehole_observation",
        confidence="medium",
    )


def _section(
    project: ProjectOrm,
    *,
    seeded_contact_ids: list[UUID] | None = None,
    name: str = "Section-MC",
    x_offset: float = 0.0,
) -> CrossSectionOrm:
    """Return an unsaved CrossSectionOrm with given seeded contact ids."""
    return CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        # Endpoints define a non-degenerate line so the perpendicular
        # algorithm in CreatePerpendicularCompanion has a valid direction.
        start_x=100000.0 + x_offset,
        start_y=200000.0,
        end_x=110000.0 + x_offset,
        end_y=200000.0,
        epsg=31370,
        projection_buffer_m=50.0,
        seeded_formation_contact_ids=seeded_contact_ids or [],
    )


def _approved_edge(
    model: GeologicalModelOrm,
    ca: FormationContactOrm,
    cb: FormationContactOrm,
) -> LithoContactCorrelationEdgeOrm:
    """Return an unsaved approved LithoContactCorrelationEdgeOrm."""
    a_id = min(ca.id, cb.id)
    b_id = max(ca.id, cb.id)
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        contact_a_id=a_id,
        contact_b_id=b_id,
        source="manual",
        user_approved=True,
    )


def _unapproved_edge(
    model: GeologicalModelOrm,
    ca: FormationContactOrm,
    cb: FormationContactOrm,
) -> LithoContactCorrelationEdgeOrm:
    """Return an unsaved unapproved LithoContactCorrelationEdgeOrm."""
    a_id = min(ca.id, cb.id)
    b_id = max(ca.id, cb.id)
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        contact_a_id=a_id,
        contact_b_id=b_id,
        source="auto",
        user_approved=False,
    )


def _lens(
    project: ProjectOrm,
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    source_investigation: BoreholeOrm,
    *,
    body_ordinal: int = 0,
    primary_section_id: UUID | None = None,
    name: str | None = None,
) -> LithoLensOrm:
    """Return an unsaved LithoLensOrm.

    Parameters
    ----------
    source_investigation : BoreholeOrm
        The investigation (borehole or CPT) that anchors this body in the
        correlation graph.  Required by the NOT NULL constraint on
        ``body.source_investigation_id``.
    """
    return LithoLensOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=model.id,
        formation_id=formation.id,
        body_ordinal=body_ordinal,
        source_investigation_id=source_investigation.id,
        primary_section_id=primary_section_id,
        name=name,
    )


# ---------------------------------------------------------------------------
# Shared project fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for MaterialiseBodyCompanions tests."""
    proj = ProjectOrm(id=uuid7(), name="materialise body companions test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# Test 1: gate-pass — companion created
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gate_pass_creates_companion(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """LithoLens with primary section where every seeded contact has an
    approved edge → companion section created; result counts correct.

    Topology:
    - bh_a (x=150000): contacts c_a1, c_a2
    - bh_b (x=150300): contact c_b
    - Approved edges: c_a1 ↔ c_b and c_a2 ↔ c_b
    - Primary section seeded with [c_a1.id, c_a2.id, c_b.id]
    - Gate: all three contacts appear in approved edges → pass
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-MC1")
    f_lens = _formation(project, parent, name="KLEI lens MC1")
    f_other = _formation(project, parent, name="ZAND cap MC1", soil_code="ZAND")

    bh_a = _borehole(project.id, suffix="MC1A", x=150000.0)
    bh_b = _borehole(project.id, suffix="MC1B", x=150300.0)

    db_session.add_all([geo, litho, parent, f_lens, f_other, bh_a, bh_b])
    await db_session.flush()

    c_a1 = _contact(litho, f_lens, bh_a, depth=4.0)
    c_a2 = _contact(litho, f_other, bh_a, depth=6.0)
    c_b = _contact(litho, f_other, bh_b, depth=5.0)
    db_session.add_all([c_a1, c_a2, c_b])
    await db_session.flush()

    # Both contacts on bh_a have an approved edge back to bh_b.
    e1 = _approved_edge(litho, c_a1, c_b)
    e2 = _approved_edge(litho, c_a2, c_b)
    db_session.add_all([e1, e2])
    await db_session.flush()

    # Primary section seeds all three contacts.
    sec = _section(
        project, seeded_contact_ids=[c_a1.id, c_a2.id, c_b.id], name="Sec-MC1", x_offset=0.0
    )
    db_session.add(sec)
    await db_session.flush()

    # Lens points at this section; body_ordinal=0 (resolver not needed here).
    the_lens = _lens(project, litho, f_lens, bh_a, body_ordinal=0, primary_section_id=sec.id)
    db_session.add(the_lens)
    await db_session.commit()

    result = await MaterialiseBodyCompanions(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    assert result.companion_sections_created == 1, (
        f"Expected 1 companion created; got {result.companion_sections_created}"
    )
    assert result.skipped_no_primary == 0
    assert result.skipped_unfinished_section == 0
    assert result.errored == 0

    # Verify companion row exists in the DB.
    companion_rows = (
        (
            await db_session.execute(
                select(CrossSectionOrm).where(CrossSectionOrm.companion_lens_id == the_lens.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(companion_rows) == 1, (
        f"Expected 1 companion CrossSectionOrm; got {len(companion_rows)}"
    )
    assert companion_rows[0].is_lens_companion is True


# ---------------------------------------------------------------------------
# Test 2: gate-fail — one uncorrelated contact → skipped
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gate_fail_skips_companion(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """One seeded contact has no approved edge → skipped_unfinished_section++;
    no companion section is created.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-MC2")
    f_lens = _formation(project, parent, name="KLEI lens MC2")
    f_other = _formation(project, parent, name="ZAND MC2", soil_code="ZAND")

    bh_a = _borehole(project.id, suffix="MC2A", x=151000.0)
    bh_b = _borehole(project.id, suffix="MC2B", x=151300.0)

    db_session.add_all([geo, litho, parent, f_lens, f_other, bh_a, bh_b])
    await db_session.flush()

    c_a = _contact(litho, f_lens, bh_a, depth=4.0)
    # c_orphan has no approved edge — it will trigger gate failure.
    c_orphan = _contact(litho, f_other, bh_a, depth=6.0)
    c_b = _contact(litho, f_other, bh_b, depth=5.0)
    db_session.add_all([c_a, c_orphan, c_b])
    await db_session.flush()

    # Only c_a ↔ c_b is approved; c_orphan is uncorrelated.
    e1 = _approved_edge(litho, c_a, c_b)
    db_session.add(e1)
    await db_session.flush()

    # Primary section seeds all three — c_orphan will fail the gate.
    sec = _section(
        project,
        seeded_contact_ids=[c_a.id, c_orphan.id, c_b.id],
        name="Sec-MC2",
        x_offset=1000.0,
    )
    db_session.add(sec)
    await db_session.flush()

    the_lens = _lens(project, litho, f_lens, bh_a, body_ordinal=0, primary_section_id=sec.id)
    db_session.add(the_lens)
    await db_session.commit()

    result = await MaterialiseBodyCompanions(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    assert result.skipped_unfinished_section == 1, (
        f"Expected 1 skipped_unfinished_section; got {result.skipped_unfinished_section}"
    )
    assert result.companion_sections_created == 0
    assert result.skipped_no_primary == 0
    assert result.errored == 0

    # No companion should exist.
    companion_rows = (
        (
            await db_session.execute(
                select(CrossSectionOrm).where(CrossSectionOrm.companion_lens_id == the_lens.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(companion_rows) == 0, (
        f"Expected no companion when gate failed; got {len(companion_rows)}"
    )


# ---------------------------------------------------------------------------
# Test 3: null primary → skipped_no_primary
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_null_primary_skipped(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """LithoLens with primary_section_id=None → skipped_no_primary++;
    no companion created, no error raised.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-MC3")
    f_lens = _formation(project, parent, name="KLEI lens MC3")
    bh_a = _borehole(project.id, suffix="MC3A", x=153000.0)

    db_session.add_all([geo, litho, parent, f_lens, bh_a])
    await db_session.flush()

    # Lens with no primary section (primary_section_id defaults to None).
    the_lens = _lens(project, litho, f_lens, bh_a, body_ordinal=0, primary_section_id=None)
    db_session.add(the_lens)
    await db_session.commit()

    result = await MaterialiseBodyCompanions(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )

    assert result.skipped_no_primary == 1, (
        f"Expected 1 skipped_no_primary; got {result.skipped_no_primary}"
    )
    assert result.companion_sections_created == 0
    assert result.skipped_unfinished_section == 0
    assert result.errored == 0


# ---------------------------------------------------------------------------
# Test 4: idempotent — second run creates no new companions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_idempotent(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Running MaterialiseBodyCompanions twice on the same qualifying lens
    creates exactly one companion section total (NOT EXISTS guard fires on
    the second pass).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-MC4")
    f_lens = _formation(project, parent, name="KLEI lens MC4")
    f_other = _formation(project, parent, name="ZAND MC4", soil_code="ZAND")

    bh_a = _borehole(project.id, suffix="MC4A", x=152000.0)
    bh_b = _borehole(project.id, suffix="MC4B", x=152300.0)

    db_session.add_all([geo, litho, parent, f_lens, f_other, bh_a, bh_b])
    await db_session.flush()

    c_a = _contact(litho, f_lens, bh_a, depth=4.0)
    c_b = _contact(litho, f_other, bh_b, depth=5.0)
    db_session.add_all([c_a, c_b])
    await db_session.flush()

    edge = _approved_edge(litho, c_a, c_b)
    db_session.add(edge)
    await db_session.flush()

    sec = _section(
        project,
        seeded_contact_ids=[c_a.id, c_b.id],
        name="Sec-MC4",
        x_offset=2000.0,
    )
    db_session.add(sec)
    await db_session.flush()

    the_lens = _lens(project, litho, f_lens, bh_a, body_ordinal=0, primary_section_id=sec.id)
    db_session.add(the_lens)
    await db_session.commit()

    # First run — should create 1 companion.
    result1 = await MaterialiseBodyCompanions(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    assert result1.companion_sections_created == 1, (
        f"First run: expected 1 companion; got {result1.companion_sections_created}"
    )

    # Second run — NOT EXISTS guard detects existing companion; zero new.
    result2 = await MaterialiseBodyCompanions(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
    )
    assert result2.companion_sections_created == 0, (
        f"Second run: expected 0 companions (idempotent); got {result2.companion_sections_created}"
    )
    assert result2.skipped_no_primary == 0
    assert result2.skipped_unfinished_section == 0
    assert result2.errored == 0

    # Exactly one companion section exists.
    companion_rows = (
        (
            await db_session.execute(
                select(CrossSectionOrm).where(CrossSectionOrm.companion_lens_id == the_lens.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(companion_rows) == 1, (
        f"Expected exactly 1 companion after two runs; got {len(companion_rows)}"
    )
