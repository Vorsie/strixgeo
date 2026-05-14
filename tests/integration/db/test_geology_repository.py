"""Integration tests for the geology repository (formations / models / contacts).

Exercise the CRUD surface and the ``validate_no_gaps`` domain check
against a real PostgreSQL session. The migrations create the three
tables (geological_formation / geological_model / formation_contact),
the FK + CHECK constraints, and the indexes — those only run in
integration, so this is where they get exercised.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)


async def _make_project_with_borehole(
    db_session: AsyncSession,
    *,
    total_depth_m: float = 10.0,
) -> tuple[ProjectOrm, BoreholeOrm]:
    """Build a project + one borehole and commit. Returns both rows."""
    project = ProjectOrm(id=uuid7(), name="Geology test", status="active")
    db_session.add(project)
    await db_session.flush()
    borehole = BoreholeOrm(
        id=uuid7(),
        name="BH-1",
        app_project_id=project.id,
        project_id="DOV",
        test_id="BH-001",
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=total_depth_m,
    )
    db_session.add(borehole)
    await db_session.commit()
    return project, borehole


# ---------------------------------------------------------------------------
# Formations
# ---------------------------------------------------------------------------


async def test_formation_create_and_list(db_session: AsyncSession) -> None:
    """Two formations land under a project and come back in display order."""
    project, _ = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)

    await repo.create_formation(
        project.id,
        name="Boom Klei",
        code="Bm",
        color="#5a4a3a",
        display_order=1,
    )
    await repo.create_formation(
        project.id,
        name="Quaternary",
        code="Q",
        color="#d4b896",
        display_order=0,
    )
    await db_session.commit()

    formations = await repo.list_formations(project.id)
    assert [f.name for f in formations] == ["Quaternary", "Boom Klei"]


async def test_formation_update_and_delete(db_session: AsyncSession) -> None:
    """Updates apply only the fields in the patch; delete cascades to contacts."""
    project, _ = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)

    formation = await repo.create_formation(project.id, name="Original", color="#000000", code="X")
    await db_session.commit()

    # Update name only — code should stay "X".
    updated = await repo.update_formation(formation.id, {"name": "Renamed"})
    await db_session.commit()
    assert updated is not None
    assert updated.name == "Renamed"
    assert updated.code == "X"

    # Delete.
    ok = await repo.delete_formation(formation.id)
    await db_session.commit()
    assert ok is True
    assert await repo.get_formation(formation.id) is None


# ---------------------------------------------------------------------------
# Geotechnical units
# ---------------------------------------------------------------------------


async def test_unit_create_list_update_delete(db_session: AsyncSession) -> None:
    """Full CRUD round-trip for geotechnical units hanging off a formation."""
    project, _ = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)

    formation = await repo.create_formation(
        project.id, name="Boom Klei", code="Bm", color="#5a4a3a"
    )
    await db_session.commit()

    # Two units under the same formation, deliberately added in non-sort order
    # so list_units's ordering (display_order, then name) is exercised.
    crust = await repo.create_unit(
        app_project_id=project.id,
        geological_formation_id=formation.id,
        name="Weathered crust",
        code="BmK-wc",
        color="#a0805f",
        display_order=1,
    )
    undisturbed = await repo.create_unit(
        app_project_id=project.id,
        geological_formation_id=formation.id,
        name="Undisturbed",
        code="BmK-u",
        color="#5a4a3a",
        display_order=0,
    )
    await db_session.commit()

    units = await repo.list_units(geological_formation_id=formation.id)
    assert [u.name for u in units] == ["Undisturbed", "Weathered crust"]

    # Update name + display_order; code stays.
    updated = await repo.update_unit(crust.id, {"name": "Crust (weathered)", "display_order": 2})
    await db_session.commit()
    assert updated is not None
    assert updated.name == "Crust (weathered)"
    assert updated.display_order == 2
    assert updated.code == "BmK-wc"

    ok = await repo.delete_unit(undisturbed.id)
    await db_session.commit()
    assert ok is True
    assert await repo.get_unit(undisturbed.id) is None


async def test_unit_cascade_on_formation_delete(db_session: AsyncSession) -> None:
    """Dropping a formation removes every unit beneath it (DB-level CASCADE)."""
    project, _ = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)

    formation = await repo.create_formation(project.id, name="F", color="#aaa")
    await db_session.commit()
    unit = await repo.create_unit(
        app_project_id=project.id,
        geological_formation_id=formation.id,
        name="U",
        code=None,
        color="#bbb",
    )
    await db_session.commit()
    unit_id = unit.id

    await repo.delete_formation(formation.id)
    await db_session.commit()

    assert await repo.get_unit(unit_id) is None


async def test_unit_list_scoped_to_one_formation(db_session: AsyncSession) -> None:
    """Units under a sibling formation don't leak into the other's list."""
    project, _ = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)

    a = await repo.create_formation(project.id, name="A", color="#aaa")
    b = await repo.create_formation(project.id, name="B", color="#bbb")
    await db_session.commit()

    await repo.create_unit(
        app_project_id=project.id,
        geological_formation_id=a.id,
        name="A1",
        code=None,
        color="#a01",
    )
    await repo.create_unit(
        app_project_id=project.id,
        geological_formation_id=b.id,
        name="B1",
        code=None,
        color="#b01",
    )
    await db_session.commit()

    a_units = await repo.list_units(geological_formation_id=a.id)
    b_units = await repo.list_units(geological_formation_id=b.id)
    assert [u.name for u in a_units] == ["A1"]
    assert [u.name for u in b_units] == ["B1"]


# ---------------------------------------------------------------------------
# Models + activate
# ---------------------------------------------------------------------------


async def test_model_create_and_activate_clears_siblings(
    db_session: AsyncSession,
) -> None:
    """``set_active_model`` flags one model active and clears every sibling."""
    project, _ = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)

    a = await repo.create_model(project.id, name="A", is_active=True)
    b = await repo.create_model(project.id, name="B", is_active=False)
    c = await repo.create_model(project.id, name="C", is_active=False)
    await db_session.commit()

    activated = await repo.set_active_model(project.id, b.id)
    await db_session.commit()
    await db_session.refresh(activated)
    await db_session.refresh(a)
    await db_session.refresh(c)

    assert activated is not None
    assert activated.id == b.id
    assert activated.is_active is True
    assert a.is_active is False
    assert c.is_active is False


# ---------------------------------------------------------------------------
# Contacts — anchor XOR + persistence
# ---------------------------------------------------------------------------


async def test_contact_requires_exactly_one_anchor(
    db_session: AsyncSession,
) -> None:
    """ValueError when both anchors are set or both are None."""
    project, borehole = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)
    formation = await repo.create_formation(project.id, name="F", color="#aaa")
    model = await repo.create_model(project.id, name="M")
    await db_session.commit()

    # Both None.
    with pytest.raises(ValueError):
        await repo.create_contact(
            model_id=model.id,
            formation_id=formation.id,
            depth_top_m=1.0,
        )

    # Both set.
    with pytest.raises(ValueError):
        await repo.create_contact(
            model_id=model.id,
            formation_id=formation.id,
            depth_top_m=1.0,
            borehole_id=borehole.id,
            cpt_id=uuid7(),
        )


async def test_contact_create_list_update_delete(
    db_session: AsyncSession,
) -> None:
    """Full CRUD round-trip for borehole-anchored contacts."""
    project, borehole = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)
    quaternary = await repo.create_formation(project.id, name="Quaternary", color="#d4b896")
    boom = await repo.create_formation(project.id, name="Boom Klei", color="#5a4a3a")
    model = await repo.create_model(project.id, name="Main")
    await db_session.commit()

    c1 = await repo.create_contact(
        model_id=model.id,
        formation_id=quaternary.id,
        borehole_id=borehole.id,
        depth_top_m=0.0,
        source="manual_pick",
        confidence="high",
    )
    c2 = await repo.create_contact(
        model_id=model.id,
        formation_id=boom.id,
        borehole_id=borehole.id,
        depth_top_m=2.0,
        notes="Picked from coded lithology",
    )
    await db_session.commit()

    # list_contacts returns shallowest-first.
    listed = await repo.list_contacts(model.id, borehole_id=borehole.id)
    assert [c.id for c in listed] == [c1.id, c2.id]

    # Filter by formation.
    boom_only = await repo.list_contacts(model.id, formation_id=boom.id)
    assert [c.id for c in boom_only] == [c2.id]

    # Update depth + notes.
    updated = await repo.update_contact(c2.id, {"depth_top_m": 2.5, "notes": None})
    await db_session.commit()
    assert updated is not None
    assert updated.depth_top_m == 2.5
    assert updated.notes is None

    # Delete one.
    ok = await repo.delete_contact(c1.id)
    await db_session.commit()
    assert ok is True
    after_delete = await repo.list_contacts(model.id, borehole_id=borehole.id)
    assert [c.id for c in after_delete] == [c2.id]


async def test_cascade_delete_formation_drops_contacts(
    db_session: AsyncSession,
) -> None:
    """Deleting a formation removes every contact that referenced it."""
    project, borehole = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)
    f = await repo.create_formation(project.id, name="F", color="#aaa")
    model = await repo.create_model(project.id, name="M")
    await db_session.commit()
    contact = await repo.create_contact(
        model_id=model.id,
        formation_id=f.id,
        borehole_id=borehole.id,
        depth_top_m=1.0,
    )
    await db_session.commit()

    await repo.delete_formation(f.id)
    await db_session.commit()

    # Cascade ran — contact gone too.
    from groundmodel.infrastructure.db.models.formation_contact_orm import (
        FormationContactOrm,
    )

    remaining = await db_session.get(FormationContactOrm, contact.id)
    assert remaining is None


# ---------------------------------------------------------------------------
# Domain validation — no_gaps
# ---------------------------------------------------------------------------


async def test_validate_no_gaps_happy_path(db_session: AsyncSession) -> None:
    """Two contacts (surface + 2 m) on a 10 m borehole report no issues."""
    project, borehole = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)
    quaternary = await repo.create_formation(project.id, name="Quaternary", color="#d4b896")
    boom = await repo.create_formation(project.id, name="Boom Klei", color="#5a4a3a")
    model = await repo.create_model(project.id, name="M")
    await repo.create_contact(
        model_id=model.id,
        formation_id=quaternary.id,
        borehole_id=borehole.id,
        depth_top_m=0.0,
    )
    await repo.create_contact(
        model_id=model.id,
        formation_id=boom.id,
        borehole_id=borehole.id,
        depth_top_m=2.0,
    )
    await db_session.commit()

    assert await repo.validate_no_gaps(model.id, borehole.id) == []


async def test_validate_no_gaps_flags_missing_surface(
    db_session: AsyncSession,
) -> None:
    """A single contact at 3 m leaves the top of the hole unassigned."""
    project, borehole = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)
    f = await repo.create_formation(project.id, name="F", color="#aaa")
    model = await repo.create_model(project.id, name="M")
    await repo.create_contact(
        model_id=model.id,
        formation_id=f.id,
        borehole_id=borehole.id,
        depth_top_m=3.0,
    )
    await db_session.commit()

    issues = await repo.validate_no_gaps(model.id, borehole.id)
    kinds = [i.kind for i in issues]
    assert "missing_surface_contact" in kinds


async def test_validate_no_gaps_flags_duplicate_depth(
    db_session: AsyncSession,
) -> None:
    """Two contacts at the exact same depth get reported as ambiguous."""
    project, borehole = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)
    a = await repo.create_formation(project.id, name="A", color="#aaa")
    b = await repo.create_formation(project.id, name="B", color="#bbb")
    model = await repo.create_model(project.id, name="M")
    await repo.create_contact(
        model_id=model.id,
        formation_id=a.id,
        borehole_id=borehole.id,
        depth_top_m=0.0,
    )
    await repo.create_contact(
        model_id=model.id,
        formation_id=b.id,
        borehole_id=borehole.id,
        depth_top_m=0.0,
    )
    await db_session.commit()

    issues = await repo.validate_no_gaps(model.id, borehole.id)
    assert any(i.kind == "duplicate_depth" for i in issues)


async def test_validate_no_gaps_flags_contact_below_test(
    db_session: AsyncSession,
) -> None:
    """A contact deeper than the borehole's test depth is flagged."""
    project, borehole = await _make_project_with_borehole(db_session, total_depth_m=5.0)
    repo = GeologyRepository(db_session)
    # Two formations because the (model, formation, borehole) triple
    # is uniquely indexed — two tops of the SAME formation on one
    # borehole is geologically impossible. The validator's
    # ``contact_below_test`` check is per-contact, not per-formation,
    # so the assertion still exercises the same branch.
    f_top = await repo.create_formation(project.id, name="F-top", color="#aaa")
    f_below = await repo.create_formation(project.id, name="F-below", color="#bbb")
    model = await repo.create_model(project.id, name="M")
    await repo.create_contact(
        model_id=model.id,
        formation_id=f_top.id,
        borehole_id=borehole.id,
        depth_top_m=0.0,
    )
    await repo.create_contact(
        model_id=model.id,
        formation_id=f_below.id,
        borehole_id=borehole.id,
        depth_top_m=99.0,  # well below the 5 m test depth
    )
    await db_session.commit()

    issues = await repo.validate_no_gaps(model.id, borehole.id)
    assert any(i.kind == "contact_below_test" for i in issues)


async def test_validate_no_gaps_empty_returns_no_contacts(
    db_session: AsyncSession,
) -> None:
    """A model with zero contacts for the borehole reports the empty state."""
    project, borehole = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)
    model = await repo.create_model(project.id, name="M")
    await db_session.commit()

    issues = await repo.validate_no_gaps(model.id, borehole.id)
    assert [i.kind for i in issues] == ["no_contacts"]


# ---------------------------------------------------------------------------
# Anchor XOR enforced at the DB layer too (defence-in-depth)
# ---------------------------------------------------------------------------


async def test_anchor_xor_enforced_by_db_check_constraint(
    db_session: AsyncSession,
) -> None:
    """Bypassing the repo's ValueError still trips the CHECK constraint."""
    from sqlalchemy.exc import IntegrityError

    from groundmodel.infrastructure.db.models.formation_contact_orm import (
        FormationContactOrm,
    )

    project, borehole = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)
    f = await repo.create_formation(project.id, name="F", color="#aaa")
    model = await repo.create_model(project.id, name="M")
    await db_session.commit()

    # Direct insert with both anchors None — CHECK should reject.
    db_session.add(
        FormationContactOrm(
            id=uuid7(),
            model_id=model.id,
            formation_id=f.id,
            depth_top_m=1.0,
            source="manual_pick",
            confidence="medium",
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


# ---------------------------------------------------------------------------
# Project-scope leak test
# ---------------------------------------------------------------------------


async def test_list_formations_scoped_to_one_project(
    db_session: AsyncSession,
) -> None:
    """Formations in project A don't leak into a list for project B."""
    project_a, _ = await _make_project_with_borehole(db_session)
    project_b = ProjectOrm(id=uuid7(), name="Other project", status="active")
    db_session.add(project_b)
    await db_session.commit()

    repo = GeologyRepository(db_session)
    await repo.create_formation(project_a.id, name="A-only", color="#aaa")
    await repo.create_formation(project_b.id, name="B-only", color="#bbb")
    await db_session.commit()

    for_a = await repo.list_formations(project_a.id)
    for_b = await repo.list_formations(project_b.id)
    assert {f.name for f in for_a} == {"A-only"}
    assert {f.name for f in for_b} == {"B-only"}


async def test_formation_constraint_unused_variable_silenced() -> None:
    """Placeholder: ruff once flagged GeologicalFormationOrm as unused — keep imported here."""
    # The class is imported for the side-effect of registering it with
    # SQLAlchemy's metadata; without the import the integration suite's
    # ``__mapper__`` walks miss the table. This no-op test pins the
    # import so future cleanups don't drop it accidentally.
    assert GeologicalFormationOrm.__tablename__ == "geological_formation"
