"""Integration tests for ClaimBodyExtent.

Coverage:
1. Creates body row when none exists; sets the side; round-trips.
2. Updates existing body, replaces NULL extent on the claimed side.
3. Refuses to overwrite a to_target extent without explicit clear.
4. Replacing one user-claim with a different user-claim is allowed.
5. Validates neighbour_inv_id != source_investigation_id.
6. kind='pinch_out_halfway' requires neighbour_inv_id.
7. kind='extrapolated' requires neighbour_inv_id.
8. kind='open' stores NULL for neighbour_inv_id (ignores any supplied value).
9. Invalid side raises ValueError.
10. Invalid kind raises ValueError (e.g. 'to_target' rejected).
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.claim_body_extent import ClaimBodyExtent
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.shared.constants.extent_kind import (
    EXTENT_KIND_EXTRAPOLATED,
    EXTENT_KIND_OPEN,
    EXTENT_KIND_PINCH_OUT_HALFWAY,
    EXTENT_KIND_TO_TARGET,
)

# ---------------------------------------------------------------------------
# Private fixture helpers (copied from test_detect_bodies.py — project hasn't
# centralised these into a shared conftest yet)
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
# Test 1: creates a body row when none exists; sets the claimed side
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_creates_body_row_when_none_exists(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """ClaimBodyExtent creates a BodyOrm row when none exists for the
    (model, formation, ordinal) triple, and sets the requested side +
    kind correctly.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t1")
    formation = _formation(project, parent, name="KLEI body t1", ordinal=0)
    bh_source = _borehole(project.id, suffix="S01", x=150000.0)
    bh_neighbour = _borehole(project.id, suffix="N01", x=150300.0)

    db_session.add_all([geo, litho, parent, formation, bh_source, bh_neighbour])
    await db_session.commit()

    body = await ClaimBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        source_investigation_id=bh_source.id,
        side="left",
        kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
        neighbour_inv_id=bh_neighbour.id,
    )

    # Row persisted with correct identity.
    assert body.id is not None
    assert body.app_project_id == project.id
    assert body.model_id == litho.id
    assert body.formation_id == formation.id
    assert body.body_ordinal == 0
    assert body.source_investigation_id == bh_source.id

    # Left side claimed correctly.
    assert body.extent_left_kind == EXTENT_KIND_PINCH_OUT_HALFWAY
    assert body.extent_left_neighbour_inv_id == bh_neighbour.id
    assert body.extent_left_target_contact_id is None

    # Right side untouched (NULL).
    assert body.extent_right_kind is None

    # Re-read to confirm DB round-trip.
    re_read = await db_session.get(BodyOrm, body.id)
    assert re_read is not None
    assert re_read.extent_left_kind == EXTENT_KIND_PINCH_OUT_HALFWAY


# ---------------------------------------------------------------------------
# Test 2: updates existing body, replaces NULL extent on the claimed side
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_updates_existing_body_null_extent(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """When a body row already exists with a NULL extent on the target side,
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

    # Pre-insert a body row with both extent sides NULL.
    existing_body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=bh_source.id,
    )
    db_session.add(existing_body)
    await db_session.commit()

    # Claim the right side.
    updated_body = await ClaimBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        source_investigation_id=bh_source.id,
        side="right",
        kind=EXTENT_KIND_EXTRAPOLATED,
        neighbour_inv_id=bh_neighbour.id,
    )

    assert updated_body.id == existing_body.id, (
        "Must update the pre-existing row, not create a new one"
    )
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
    """Attempting to claim a side that already has a detector-set 'to_target'
    extent must raise ValueError (provenance rule §5.2).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t3")
    formation = _formation(project, parent, name="KLEI body t3", ordinal=0)
    bh_source = _borehole(project.id, suffix="S03", x=152000.0)
    bh_neighbour = _borehole(project.id, suffix="N03", x=152300.0)

    db_session.add_all([geo, litho, parent, formation, bh_source, bh_neighbour])
    await db_session.flush()

    # Pre-insert a body row with the left side already as 'to_target'
    # (simulating a detector-set extent).
    existing_body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=bh_source.id,
        extent_left_kind=EXTENT_KIND_TO_TARGET,
        extent_left_neighbour_inv_id=bh_neighbour.id,
    )
    db_session.add(existing_body)
    await db_session.commit()

    with pytest.raises(ValueError, match="to_target"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            formation_id=formation.id,
            source_investigation_id=bh_source.id,
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
    """A side already carrying a user-claimed kind can be updated to a
    different user-claimed kind — the user is explicitly changing their mind.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t4")
    formation = _formation(project, parent, name="KLEI body t4", ordinal=0)
    bh_source = _borehole(project.id, suffix="S04", x=153000.0)
    bh_neighbour = _borehole(project.id, suffix="N04", x=153300.0)

    db_session.add_all([geo, litho, parent, formation, bh_source, bh_neighbour])
    await db_session.flush()

    # Pre-insert body with left side as 'pinch_out_halfway'.
    existing_body = BodyOrm(
        id=uuid7(),
        app_project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        body_ordinal=0,
        source_investigation_id=bh_source.id,
        extent_left_kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
        extent_left_neighbour_inv_id=bh_neighbour.id,
    )
    db_session.add(existing_body)
    await db_session.commit()

    # Replace the user-claim with 'open' (no neighbour required).
    updated_body = await ClaimBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        source_investigation_id=bh_source.id,
        side="left",
        kind=EXTENT_KIND_OPEN,
    )

    assert updated_body.id == existing_body.id
    assert updated_body.extent_left_kind == EXTENT_KIND_OPEN
    # neighbour_inv_id must be cleared when kind changes to 'open'.
    assert updated_body.extent_left_neighbour_inv_id is None


# ---------------------------------------------------------------------------
# Test 5: neighbour_inv_id == source_investigation_id raises ValueError
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_neighbour_equal_to_source_raises(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Passing neighbour_inv_id == source_investigation_id must raise ValueError
    for pinch_out_halfway and extrapolated kinds.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t5")
    formation = _formation(project, parent, name="KLEI body t5", ordinal=0)
    bh_source = _borehole(project.id, suffix="S05", x=154000.0)

    db_session.add_all([geo, litho, parent, formation, bh_source])
    await db_session.commit()

    with pytest.raises(ValueError, match="neighbour_inv_id must not equal source_investigation_id"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            formation_id=formation.id,
            source_investigation_id=bh_source.id,
            side="right",
            kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
            neighbour_inv_id=bh_source.id,  # same as source → invalid
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
    await db_session.commit()

    with pytest.raises(ValueError, match="neighbour_inv_id is required"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            formation_id=formation.id,
            source_investigation_id=bh_source.id,
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
    await db_session.commit()

    with pytest.raises(ValueError, match="neighbour_inv_id is required"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            formation_id=formation.id,
            source_investigation_id=bh_source.id,
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
    await db_session.commit()

    # 'open' does not use neighbour_inv_id — passing it anyway must be silently
    # cleared (the spec says "ignored for open").
    body = await ClaimBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        source_investigation_id=bh_source.id,
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
    """Passing a side value that is not 'left' or 'right' must raise ValueError
    before any DB access.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t9")
    formation = _formation(project, parent, name="KLEI body t9", ordinal=0)
    bh_source = _borehole(project.id, suffix="S09", x=158000.0)

    db_session.add_all([geo, litho, parent, formation, bh_source])
    await db_session.commit()

    with pytest.raises(ValueError, match="side must be 'left' or 'right'"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            formation_id=formation.id,
            source_investigation_id=bh_source.id,
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
    """Passing kind='to_target' (detector-only) or any unknown string must raise
    ValueError before any DB access.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t10")
    formation = _formation(project, parent, name="KLEI body t10", ordinal=0)
    bh_source = _borehole(project.id, suffix="S10", x=159000.0)

    db_session.add_all([geo, litho, parent, formation, bh_source])
    await db_session.commit()

    # 'to_target' is a detector-only kind; the user endpoint must reject it.
    with pytest.raises(ValueError, match="to_target"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            formation_id=formation.id,
            source_investigation_id=bh_source.id,
            side="left",
            kind=EXTENT_KIND_TO_TARGET,  # detector-only — must be rejected
        )

    # Unknown string also rejected.
    with pytest.raises(ValueError, match="kind must be one of"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            formation_id=formation.id,
            source_investigation_id=bh_source.id,
            side="left",
            kind="banana",
        )


# ---------------------------------------------------------------------------
# Test 11 (S2 audit): source_investigation_id from a different project raises
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_source_investigation_id_from_different_project_raises(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """S2 audit: ClaimBodyExtent must reject a source_investigation_id that
    belongs to a different project (cross-project investigation scope guard).

    A malicious client could plant a foreign investigation UUID in the body
    row, leaking cross-project geometry pointers.  The use case must catch
    this before any INSERT.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t11")
    formation = _formation(project, parent, name="KLEI body t11", ordinal=0)
    bh_in_project = _borehole(project.id, suffix="S11", x=160000.0)

    # A second project with its own borehole — the attacker's investigation.
    other_project = ProjectOrm(id=uuid7(), name="other-project-t11", status="active")
    db_session.add(other_project)
    bh_foreign = BoreholeOrm(
        id=uuid7(),
        name="BH-FOREIGN-11",
        app_project_id=other_project.id,
        project_id="OTHER",
        test_id="BH-OTHER-11",
        location_x=999000.0,
        location_y=999000.0,
        epsg=31370,
        total_depth_m=10.0,
    )
    db_session.add(bh_foreign)

    db_session.add_all([geo, litho, parent, formation, bh_in_project])
    await db_session.commit()

    # Claim using a source_investigation_id that belongs to other_project.
    with pytest.raises(ValueError, match="source_investigation_id"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            formation_id=formation.id,
            source_investigation_id=bh_foreign.id,  # cross-project — must be rejected
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
    """S2 audit: ClaimBodyExtent must reject a neighbour_inv_id that belongs
    to a different project (kind=pinch_out_halfway).

    A foreign neighbour UUID in the body row would cause the renderer to
    attempt a cross-project neighbour lookup silently.
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
    await db_session.commit()

    # source is valid; neighbour is from a different project.
    with pytest.raises(ValueError, match="neighbour_inv_id"):
        await ClaimBodyExtent(db_session).execute(
            project_id=project.id,
            model_id=litho.id,
            formation_id=formation.id,
            source_investigation_id=bh_source.id,
            side="right",
            kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
            neighbour_inv_id=bh_foreign_neighbour.id,  # cross-project — must be rejected
        )


# ---------------------------------------------------------------------------
# Test 13 (S2 audit): valid in-project ids succeed (regression guard)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_valid_in_project_investigations_succeed(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """S2 audit: ClaimBodyExtent must accept source + neighbour ids that both
    belong to the same project (regression guard — the happy path still works
    after the scope-guard addition).
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    parent = _geo_parent(project, name="Quat-CBE-t13")
    formation = _formation(project, parent, name="KLEI body t13", ordinal=0)
    bh_source = _borehole(project.id, suffix="S13", x=162000.0)
    bh_neighbour = _borehole(project.id, suffix="N13", x=162300.0)

    db_session.add_all([geo, litho, parent, formation, bh_source, bh_neighbour])
    await db_session.commit()

    # Both investigations are in-project — must succeed without raising.
    body = await ClaimBodyExtent(db_session).execute(
        project_id=project.id,
        model_id=litho.id,
        formation_id=formation.id,
        source_investigation_id=bh_source.id,
        side="left",
        kind=EXTENT_KIND_PINCH_OUT_HALFWAY,
        neighbour_inv_id=bh_neighbour.id,
    )

    assert body.id is not None
    assert body.source_investigation_id == bh_source.id
    assert body.extent_left_kind == EXTENT_KIND_PINCH_OUT_HALFWAY
    assert body.extent_left_neighbour_inv_id == bh_neighbour.id
