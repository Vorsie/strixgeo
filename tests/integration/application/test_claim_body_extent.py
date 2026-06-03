"""Integration tests for ClaimBodyExtent (Task 5 — body_id addressing).

ClaimBodyExtent now addresses its target body directly by ``body_id``
(the resolver owns body creation; there is no create branch). Coverage:

1. Headline: with two stacked same-formation instances on one column,
   the claim targets the FRAMED instance (the deep body, ordinal 1) — not
   the shallowest — because the body_id disambiguates what
   ``(formation, source_investigation)`` cannot.
2. Updates an existing body, replaces NULL extent on the claimed side.
3. Refuses to overwrite a to_target extent without explicit clear (409).
4. Replacing one user-claim with a different user-claim is allowed.
5. neighbour_inv_id == body source raises ValueError.
6. kind='pinch_out_halfway' requires neighbour_inv_id.
7. kind='extrapolated' requires neighbour_inv_id.
8. kind='open' stores NULL for neighbour_inv_id.
9. Invalid side raises ValueError.
10. Invalid kind raises ValueError (e.g. 'to_target' rejected).
11. Unknown body_id raises ValueError.
12. neighbour_inv_id from a different project raises ValueError.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.claim_body_extent import ClaimBodyExtent
from groundmodel.application.resolve_litho_instances_use_case import ResolveLithoInstances
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_EXTRAPOLATED,
    EXTENT_KIND_OPEN,
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_TO_TARGET,
)

# ---------------------------------------------------------------------------
# Private fixture helpers
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float) -> BoreholeOrm:
    """Return an unsaved BoreholeOrm with minimal required fields."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project_id,
        project_id="CBE",
        test_id=f"BH-CBE-{suffix}",
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
        name="Geo-CBE",
        kind="geological",
    )


def _litho_model(project: ProjectOrm, geo: GeologicalModelOrm) -> GeologicalModelOrm:
    """Return an unsaved lithostratigraphic GeologicalModelOrm."""
    return GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho-CBE",
        kind="lithostratigraphic",
        parent_geological_model_id=geo.id,
    )


def _geo_parent(project: ProjectOrm, *, name: str = "Quaternary-CBE") -> GeologicalFormationOrm:
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
    ordinal: int | None = 0,
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
        instance_ordinal=ordinal,
    )


def _section(project: ProjectOrm, *, name: str = "S-CBE") -> CrossSectionOrm:
    """Return an unsaved CrossSectionOrm for primary_section_id tests."""
    return CrossSectionOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        start_x=0.0,
        start_y=0.0,
        end_x=100.0,
        end_y=0.0,
        epsg=31370,
        projection_buffer_m=50.0,
    )


def _body(
    project: ProjectOrm,
    litho: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    source: BoreholeOrm,
    *,
    ordinal: int = 0,
    **extent_kwargs: object,
) -> BodyOrm:
    """Return an unsaved BodyOrm (the resolver normally creates these)."""
    return BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=ordinal,
        source_investigation_id=source.id,
        **extent_kwargs,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# Shared project fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare active project for ClaimBodyExtent tests."""
    proj = ProjectOrm(id=uuid7(), name="claim body extent test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


# ---------------------------------------------------------------------------
# Headline fixture: two uncorrelated SAND instances on one column
# ---------------------------------------------------------------------------


@dataclass
class _TwoStackedCtx:
    """Ids exposed by the two-stacked-instance fixture."""

    project_id: UUID
    model_id: UUID
    formation_id: UUID
    source_inv_id: UUID
    section_id: UUID


@pytest_asyncio.fixture
async def two_stacked_same_formation_instances(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> _TwoStackedCtx:
    """Seed two accepted, uncorrelated SAND layers sharing ONE formation row.

    Both sit on the same borehole at different depths with NO correlation
    edge — so ResolveLithoInstances reconciles two distinct bodies
    (ordinal 0 = shallow @ 2.0 m, ordinal 1 = deep @ 10.0 m).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    section = _section(project, name="S-stacked")
    parent = _geo_parent(project, name="Quat-stacked")
    formation = _formation(project, parent, name="ZAND stacked", soil_code="ZAND", ordinal=0)
    source = _borehole(project.id, suffix="STK", x=150000.0)

    db_session.add_all([geo, litho, section, parent, formation, source])
    await db_session.flush()

    layer_shallow = LithoLayerOrm(
        id=uuid7(),
        model_id=litho.id,
        formation_id=formation.id,
        borehole_id=source.id,
        depth_top_m=2.0,
        depth_base_m=4.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    layer_deep = LithoLayerOrm(
        id=uuid7(),
        model_id=litho.id,
        formation_id=formation.id,
        borehole_id=source.id,
        depth_top_m=10.0,
        depth_base_m=12.0,
        status="accepted",
        source="manual",
        confidence="medium",
    )
    db_session.add_all([layer_shallow, layer_deep])
    await db_session.commit()

    return _TwoStackedCtx(
        project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        source_inv_id=source.id,
        section_id=section.id,
    )


# ---------------------------------------------------------------------------
# Test 1 (headline): claim targets the framed instance, not the shallowest
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_claim_targets_the_framed_instance_not_the_shallowest(
    db_session: AsyncSession,
    two_stacked_same_formation_instances: _TwoStackedCtx,
) -> None:
    """With two same-formation instances, claiming by body_id hits the exact
    body (the deep one, ordinal 1) — the disambiguation
    ``(formation, source_investigation)`` could not provide.
    """
    ctx = two_stacked_same_formation_instances
    await ResolveLithoInstances(db_session).execute(model_id=ctx.model_id)

    # The resolver creates two bodies; pick the DEEP one (ordinal 1).
    deep_body = (
        await db_session.execute(
            select(BodyOrm).where(
                BodyOrm.model_id == ctx.model_id,
                BodyOrm.body_ordinal == 1,
            )
        )
    ).scalar_one()

    body = await ClaimBodyExtent(db_session).execute(
        project_id=ctx.project_id,
        model_id=ctx.model_id,
        body_id=deep_body.id,
        side="left",
        kind=EXTENT_KIND_OPEN,
        neighbour_inv_id=None,
        primary_section_id=ctx.section_id,
    )

    assert body.id == deep_body.id
    assert body.body_ordinal == 1
    assert body.extent_left_kind == EXTENT_KIND_OPEN
    assert body.primary_section_id == ctx.section_id

    # The shallow body (ordinal 0) must be untouched.
    shallow_body = (
        await db_session.execute(
            select(BodyOrm).where(
                BodyOrm.model_id == ctx.model_id,
                BodyOrm.body_ordinal == 0,
            )
        )
    ).scalar_one()
    assert shallow_body.extent_left_kind is None


# ---------------------------------------------------------------------------
# Test 2: updates existing body, replaces NULL extent on the claimed side
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_updates_existing_body_null_extent(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """When a body row exists with a NULL extent on the target side,
    ClaimBodyExtent sets the new kind and neighbour without error.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t2")
    formation = _formation(project, parent, name="KLEI body t2", ordinal=0)
    bh_source = _borehole(project.id, suffix="S02", x=151000.0)
    bh_neighbour = _borehole(project.id, suffix="N02", x=151300.0)

    db_session.add_all([geo, litho, parent, formation, bh_source, bh_neighbour])
    await db_session.flush()
    body_row = _body(project, litho, formation, bh_source)
    db_session.add(body_row)
    await db_session.commit()

    updated_body = await ClaimBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        body_id=body_row.id,
        side="right",
        kind=EXTENT_KIND_EXTRAPOLATED,
        neighbour_inv_id=bh_neighbour.id,
    )

    assert updated_body.id == body_row.id
    assert updated_body.extent_right_kind == EXTENT_KIND_EXTRAPOLATED
    assert updated_body.extent_right_neighbour_inv_id == bh_neighbour.id
    # Left side must remain untouched.
    assert updated_body.extent_left_kind is None


# ---------------------------------------------------------------------------
# Test 3: refuses to overwrite a to_target extent without explicit clear
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_provenance_violation_raises_on_to_target(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Claiming a side that already has a detector-set 'to_target' extent
    must raise ValueError (provenance rule §5.2).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t3")
    formation = _formation(project, parent, name="KLEI body t3", ordinal=0)
    bh_source = _borehole(project.id, suffix="S03", x=152000.0)
    bh_neighbour = _borehole(project.id, suffix="N03", x=152300.0)

    db_session.add_all([geo, litho, parent, formation, bh_source, bh_neighbour])
    await db_session.flush()
    body_row = _body(
        project,
        litho,
        formation,
        bh_source,
        extent_left_kind=EXTENT_KIND_TO_TARGET,
        extent_left_neighbour_inv_id=bh_neighbour.id,
    )
    db_session.add(body_row)
    await db_session.commit()

    with pytest.raises(ValueError, match="to_target"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            body_id=body_row.id,
            side="left",
            kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
            neighbour_inv_id=bh_neighbour.id,
        )


# ---------------------------------------------------------------------------
# Test 4: replacing one user-claim with a different user-claim is allowed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_replacing_user_claim_with_different_kind_is_allowed(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """A side carrying a user-claimed kind can be updated to a different
    user-claimed kind — the user is explicitly changing their mind.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t4")
    formation = _formation(project, parent, name="KLEI body t4", ordinal=0)
    bh_source = _borehole(project.id, suffix="S04", x=153000.0)
    bh_neighbour = _borehole(project.id, suffix="N04", x=153300.0)

    db_session.add_all([geo, litho, parent, formation, bh_source, bh_neighbour])
    await db_session.flush()
    body_row = _body(
        project,
        litho,
        formation,
        bh_source,
        extent_left_kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
        extent_left_neighbour_inv_id=bh_neighbour.id,
    )
    db_session.add(body_row)
    await db_session.commit()

    updated_body = await ClaimBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        body_id=body_row.id,
        side="left",
        kind=EXTENT_KIND_OPEN,
    )

    assert updated_body.id == body_row.id
    assert updated_body.extent_left_kind == EXTENT_KIND_OPEN
    # neighbour_inv_id must be cleared when kind changes to 'open'.
    assert updated_body.extent_left_neighbour_inv_id is None


# ---------------------------------------------------------------------------
# Test 5: neighbour_inv_id == body source raises ValueError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_neighbour_equal_to_source_raises(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """neighbour_inv_id equal to the body's source investigation must raise
    ValueError for pinch_out_halfway and extrapolated kinds.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t5")
    formation = _formation(project, parent, name="KLEI body t5", ordinal=0)
    bh_source = _borehole(project.id, suffix="S05", x=154000.0)

    db_session.add_all([geo, litho, parent, formation, bh_source])
    await db_session.flush()
    body_row = _body(project, litho, formation, bh_source)
    db_session.add(body_row)
    await db_session.commit()

    with pytest.raises(ValueError, match="neighbour_inv_id must not equal source_investigation_id"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            body_id=body_row.id,
            side="right",
            kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
            neighbour_inv_id=bh_source.id,  # == body source → invalid
        )


# ---------------------------------------------------------------------------
# Test 6: pinch_out_halfway requires neighbour_inv_id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pinch_out_halfway_requires_neighbour_inv_id(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Omitting neighbour_inv_id when kind='pinch_out_halfway' must raise ValueError."""
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t6")
    formation = _formation(project, parent, name="KLEI body t6", ordinal=0)
    bh_source = _borehole(project.id, suffix="S06", x=155000.0)

    db_session.add_all([geo, litho, parent, formation, bh_source])
    await db_session.flush()
    body_row = _body(project, litho, formation, bh_source)
    db_session.add(body_row)
    await db_session.commit()

    with pytest.raises(ValueError, match="neighbour_inv_id is required"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            body_id=body_row.id,
            side="left",
            kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
            neighbour_inv_id=None,  # missing — must raise
        )


# ---------------------------------------------------------------------------
# Test 7: extrapolated requires neighbour_inv_id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_extrapolated_requires_neighbour_inv_id(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Omitting neighbour_inv_id when kind='extrapolated' must raise ValueError."""
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t7")
    formation = _formation(project, parent, name="KLEI body t7", ordinal=0)
    bh_source = _borehole(project.id, suffix="S07", x=156000.0)

    db_session.add_all([geo, litho, parent, formation, bh_source])
    await db_session.flush()
    body_row = _body(project, litho, formation, bh_source)
    db_session.add(body_row)
    await db_session.commit()

    with pytest.raises(ValueError, match="neighbour_inv_id is required"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            body_id=body_row.id,
            side="right",
            kind=EXTENT_KIND_EXTRAPOLATED,
            # neighbour_inv_id omitted → uses default None
        )


# ---------------------------------------------------------------------------
# Test 8: open stores NULL for neighbour_inv_id
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_open_stores_null_neighbour_inv_id(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """kind='open' does not require neighbour_inv_id and stores it as NULL
    even when a value is passed (the renderer extends to the section boundary).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t8")
    formation = _formation(project, parent, name="KLEI body t8", ordinal=0)
    bh_source = _borehole(project.id, suffix="S08", x=157000.0)
    bh_irrelevant = _borehole(project.id, suffix="N08", x=157300.0)

    db_session.add_all([geo, litho, parent, formation, bh_source, bh_irrelevant])
    await db_session.flush()
    body_row = _body(project, litho, formation, bh_source)
    db_session.add(body_row)
    await db_session.commit()

    # 'open' does not use neighbour_inv_id — passing it anyway must be cleared.
    body = await ClaimBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        body_id=body_row.id,
        side="right",
        kind=EXTENT_KIND_OPEN,
        neighbour_inv_id=bh_irrelevant.id,  # should be ignored / stored as NULL
    )

    assert body.extent_right_kind == EXTENT_KIND_OPEN
    assert body.extent_right_neighbour_inv_id is None, (
        "neighbour_inv_id must be NULL for kind='open' even when a value was passed"
    )
    assert body.extent_right_target_contact_id is None


# ---------------------------------------------------------------------------
# Test 9: invalid side raises ValueError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invalid_side_raises(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """A side that is not 'left' or 'right' must raise ValueError before DB access."""
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t9")
    formation = _formation(project, parent, name="KLEI body t9", ordinal=0)
    bh_source = _borehole(project.id, suffix="S09", x=158000.0)

    db_session.add_all([geo, litho, parent, formation, bh_source])
    await db_session.flush()
    body_row = _body(project, litho, formation, bh_source)
    db_session.add(body_row)
    await db_session.commit()

    with pytest.raises(ValueError, match="side must be 'left' or 'right'"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            body_id=body_row.id,
            side="centre",  # invalid
            kind=EXTENT_KIND_OPEN,
        )


# ---------------------------------------------------------------------------
# Test 10: invalid kind raises ValueError (including 'to_target')
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invalid_kind_raises(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """kind='to_target' (detector-only) or any unknown string must raise
    ValueError before any DB write.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t10")
    formation = _formation(project, parent, name="KLEI body t10", ordinal=0)
    bh_source = _borehole(project.id, suffix="S10", x=159000.0)

    db_session.add_all([geo, litho, parent, formation, bh_source])
    await db_session.flush()
    body_row = _body(project, litho, formation, bh_source)
    db_session.add(body_row)
    await db_session.commit()

    with pytest.raises(ValueError, match="to_target"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            body_id=body_row.id,
            side="left",
            kind=EXTENT_KIND_TO_TARGET,  # detector-only — must be rejected
        )

    with pytest.raises(ValueError, match="kind must be one of"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            body_id=body_row.id,
            side="left",
            kind="banana",
        )


# ---------------------------------------------------------------------------
# Test 11: unknown / wrong-model body_id raises ValueError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_body_id_raises(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """A body_id that does not exist in the model must raise ValueError —
    there is no create branch (the resolver owns body creation).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t11")
    formation = _formation(project, parent, name="KLEI body t11", ordinal=0)
    bh_source = _borehole(project.id, suffix="S11", x=160000.0)

    db_session.add_all([geo, litho, parent, formation, bh_source])
    await db_session.commit()

    with pytest.raises(ValueError, match="not found in model"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            body_id=uuid7(),  # no such body
            side="left",
            kind=EXTENT_KIND_OPEN,
        )


# ---------------------------------------------------------------------------
# Test 12 (S2 audit): neighbour_inv_id from a different project raises
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_neighbour_inv_id_from_different_project_raises(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """ClaimBodyExtent must reject a neighbour_inv_id that belongs to a
    different project (cross-project investigation scope guard).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t12")
    formation = _formation(project, parent, name="KLEI body t12", ordinal=0)
    bh_source = _borehole(project.id, suffix="S12", x=161000.0)

    other_project = ProjectOrm(id=uuid7(), name="other-project-t12", status="active")
    db_session.add(other_project)
    bh_foreign_neighbour = BoreholeOrm(
        id=uuid7(),
        name="BH-FOREIGN-NBR-12",
        app_project_id=other_project.id,
        project_id="OTHER",
        test_id="BH-OTHER-NBR-12",
        location_x=999100.0,
        location_y=999000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add(bh_foreign_neighbour)

    db_session.add_all([geo, litho, parent, formation, bh_source])
    await db_session.flush()
    body_row = _body(project, litho, formation, bh_source)
    db_session.add(body_row)
    await db_session.commit()

    with pytest.raises(ValueError, match="neighbour_inv_id"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            body_id=body_row.id,
            side="right",
            kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
            neighbour_inv_id=bh_foreign_neighbour.id,  # cross-project — rejected
        )


@pytest.mark.asyncio
async def test_claim_does_not_drag_source_on_second_claim(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """A second claim (other side, different column) must NOT move the source.

    A body's left and right caps can be claimed on different columns; one
    ``source`` field can't hold both, so re-anchoring on the second claim would
    drag the whole body to that column (dogfeed 2026-06-03). The source stays
    put once set; framing each cap from its own band end is the separate fix.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project)
    formation = _formation(project, parent, name="KLEI-CBE-anchor")
    bh_source = _borehole(project.id, suffix="SRC", x=150000.0)
    bh_other = _borehole(project.id, suffix="OTH", x=150300.0)
    db_session.add_all([geo, litho, parent, formation, bh_source, bh_other])
    await db_session.flush()
    # Body already carries a left extent + a source (a prior claim / detect).
    body = _body(
        project,
        litho,
        formation,
        bh_source,
        extent_left_kind=EXTENT_KIND_OPEN,
    )
    db_session.add(body)
    await db_session.commit()

    # Now claim the RIGHT side on a different column.
    updated = await ClaimBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        body_id=body.id,
        source_investigation_id=bh_other.id,  # different column
        side="right",
        kind=EXTENT_KIND_OPEN,
        neighbour_inv_id=None,
    )

    # Source must NOT have moved to bh_other — that would drag the body.
    assert updated.source_investigation_id == bh_source.id
