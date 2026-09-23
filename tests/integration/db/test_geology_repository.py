"""Integration tests for the geology repository (formations / models / contacts).

Exercise the CRUD surface and the ``validate_no_gaps`` domain check
against a real PostgreSQL session. The migrations create the three
tables (geological_formation / geological_model / formation_contact),
the FK + CHECK constraints, and the indexes — those only run in
integration, so this is where they get exercised.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
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
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.geology_repository import (
    GeologyRepository,
)
from tests.integration._section_builders import covering_section


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


# ---------------------------------------------------------------------------
# delete_model cascades — Fix 1 regression guard
# ---------------------------------------------------------------------------


async def test_delete_model_removes_project_formations(
    db_session: AsyncSession,
) -> None:
    """Deleting a model also removes the project's formations and their contacts.

    Formations are project-scoped (no FK to the model); ``delete_model``
    must issue the explicit formation delete before dropping the model row so
    the project is left in a clean state (no orphan formations).  This test
    guards against regression of the Fix-1 bug where model-delete left
    formations behind, causing re-Fill to match orphans and show a stale
    "0 formations" badge in the inspector.
    """
    project, borehole = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)

    # Create 3 formations, a model, and one contact per formation.
    f1 = await repo.create_formation(project.id, name="Quaternary", color="#d4b896")
    f2 = await repo.create_formation(project.id, name="Boom Klei", color="#5a4a3a")
    f3 = await repo.create_formation(project.id, name="Diest Zand", color="#c8a96e")
    model = await repo.create_model(project.id, name="Default")
    await db_session.commit()

    c1 = await repo.create_contact(
        model_id=model.id,
        formation_id=f1.id,
        borehole_id=borehole.id,
        depth_top_m=0.0,
    )
    c2 = await repo.create_contact(
        model_id=model.id,
        formation_id=f2.id,
        borehole_id=borehole.id,
        depth_top_m=2.0,
    )
    c3 = await repo.create_contact(
        model_id=model.id,
        formation_id=f3.id,
        borehole_id=borehole.id,
        depth_top_m=6.0,
    )
    await db_session.commit()

    # Sanity: all three formations exist.
    before = await repo.list_formations(project.id)
    assert len(before) == 3

    # Delete the model.
    ok = await repo.delete_model(model.id)
    await db_session.commit()

    assert ok is True

    # Formations are gone — no orphans left.
    after = await repo.list_formations(project.id)
    assert after == [], f"Expected 0 formations after delete_model, got {len(after)}"

    # Formation rows gone by primary key.
    from groundmodel.infrastructure.db.models.formation_contact_orm import (
        FormationContactOrm,
    )

    for fid in (f1.id, f2.id, f3.id):
        assert await repo.get_formation(fid) is None, f"Formation {fid} still present"

    # Contacts cascaded from the formations are gone too.
    for cid in (c1.id, c2.id, c3.id):
        remaining = await db_session.get(FormationContactOrm, cid)
        assert remaining is None, f"Contact {cid} still present after delete_model"


async def test_delete_model_is_model_aware_with_multiple_models(
    db_session: AsyncSession,
) -> None:
    """Deleting one model must NOT wipe another model's formations (debt #37).

    The pre-#37 behaviour deleted every project formation on any model
    delete. With two models that silently destroyed model B's data when
    the user deleted model A. New rule: only formations exclusively
    owned by the deleted model go; shared + other-model + (with siblings
    remaining) unplaced formations survive.
    """
    project, borehole = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)

    excl_a = await repo.create_formation(project.id, name="Excl-A", color="#a11")
    shared = await repo.create_formation(project.id, name="Shared", color="#1a1")
    excl_b = await repo.create_formation(project.id, name="Excl-B", color="#11a")
    # Orphan: created but never placed in any model (unplaced vocabulary).
    await repo.create_formation(project.id, name="Orphan", color="#999")
    model_a = await repo.create_model(project.id, name="Model A")
    model_b = await repo.create_model(project.id, name="Model B")
    await db_session.commit()

    # Excl-A only in A; Shared in A and B; Excl-B only in B; Orphan
    # placed nowhere.
    await repo.create_contact(
        model_id=model_a.id, formation_id=excl_a.id, borehole_id=borehole.id, depth_top_m=0.0
    )
    await repo.create_contact(
        model_id=model_a.id, formation_id=shared.id, borehole_id=borehole.id, depth_top_m=1.0
    )
    await repo.create_contact(
        model_id=model_b.id, formation_id=shared.id, borehole_id=borehole.id, depth_top_m=1.0
    )
    b_only_contact = await repo.create_contact(
        model_id=model_b.id, formation_id=excl_b.id, borehole_id=borehole.id, depth_top_m=2.0
    )
    await db_session.commit()

    ok = await repo.delete_model(model_a.id)
    await db_session.commit()
    assert ok is True

    surviving = {f.name for f in await repo.list_formations(project.id)}
    # Exclusively A's formation is gone...
    assert "Excl-A" not in surviving
    # ...everything else survives: shared (B needs it), B-only, and the
    # unplaced vocabulary (a sibling model still exists).
    assert surviving == {"Shared", "Excl-B", "Orphan"}

    # Model B and its contact are untouched.
    assert await db_session.get(GeologicalModelOrm, model_b.id) is not None
    assert await db_session.get(FormationContactOrm, b_only_contact.id) is not None


# ---------------------------------------------------------------------------
# stale_surfaces_for_investigation (debt #34)
# ---------------------------------------------------------------------------


async def _add_fresh_surface(
    db_session: AsyncSession, *, model_id, formation_id
) -> FormationSurfaceOrm:
    """Insert a built (is_stale=False) TIN surface for a (model, formation)."""
    surface = FormationSurfaceOrm(
        id=uuid7(),
        model_id=model_id,
        formation_id=formation_id,
        method="tin",
        vertices=[],
        triangles=[],
        source_contact_count=1,
        source_contact_checksum=b"",
        is_stale=False,
    )
    db_session.add(surface)
    await db_session.commit()
    return surface


async def test_stale_surfaces_for_investigation_flips_dependent_tin(
    db_session: AsyncSession,
) -> None:
    """Editing an investigation's elevation must stale every TIN that has
    a contact anchored there (debt #34)."""
    project, borehole = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)
    boom = await repo.create_formation(project.id, name="Boom Klei", color="#5a4a3a")
    other = await repo.create_formation(project.id, name="Diest Zand", color="#caa")
    model = await repo.create_model(project.id, name="Main")
    await db_session.commit()

    # Contact anchors Boom Klei at this borehole; Diest Zand has none here.
    await repo.create_contact(
        model_id=model.id,
        formation_id=boom.id,
        borehole_id=borehole.id,
        depth_top_m=2.0,
    )
    await db_session.commit()

    boom_surface = await _add_fresh_surface(db_session, model_id=model.id, formation_id=boom.id)
    other_surface = await _add_fresh_surface(db_session, model_id=model.id, formation_id=other.id)

    flipped = await repo.stale_surfaces_for_investigation(borehole_id=borehole.id)
    await db_session.commit()

    assert flipped == 1
    db_session.expunge_all()
    boom_after = await db_session.get(FormationSurfaceOrm, boom_surface.id)
    other_after = await db_session.get(FormationSurfaceOrm, other_surface.id)
    # The anchored formation's TIN is now stale...
    assert boom_after is not None and boom_after.is_stale is True
    # ...the unrelated formation's TIN is untouched.
    assert other_after is not None and other_after.is_stale is False


async def test_stale_surfaces_for_investigation_no_contacts_is_noop(
    db_session: AsyncSession,
) -> None:
    """An investigation with no contacts flips nothing (legal no-op)."""
    project, borehole = await _make_project_with_borehole(db_session)
    repo = GeologyRepository(db_session)
    assert await repo.stale_surfaces_for_investigation(borehole_id=borehole.id) == 0


async def test_stale_surfaces_for_investigation_requires_xor_anchor(
    db_session: AsyncSession,
) -> None:
    """Neither/both anchor ids is a programming error → ValueError."""
    repo = GeologyRepository(db_session)
    with pytest.raises(ValueError, match="exactly one"):
        await repo.stale_surfaces_for_investigation()
    with pytest.raises(ValueError, match="exactly one"):
        await repo.stale_surfaces_for_investigation(cpt_id=uuid7(), borehole_id=uuid7())


# ---------------------------------------------------------------------------
# RecomputeFormationSurface honours excluded_borehole_ids (debt #36)
# ---------------------------------------------------------------------------


async def _bh(
    db_session: AsyncSession,
    project_id,  # noqa: ANN001
    *,
    name: str,
    x: float,
    y: float,
    z: float,
) -> BoreholeOrm:
    """A borehole with a placeable (x, y, elevation) so it contributes a
    TIN point."""
    bh = BoreholeOrm(
        id=uuid7(),
        name=name,
        app_project_id=project_id,
        project_id="DOV",
        test_id=name,
        location_x=x,
        location_y=y,
        epsg=31370,
        elevation_m=z,
        total_depth_m=20.0,
    )
    db_session.add(bh)
    await db_session.commit()
    return bh


async def test_recompute_skips_contacts_on_excluded_boreholes(
    db_session: AsyncSession,
) -> None:
    """A borehole on the model's excluded list must not contribute its
    point to the TIN (debt #36) — but its contact row survives so
    un-excluding restores it."""
    from groundmodel.application.recompute_formation_surface import (
        RecomputeFormationSurface,
    )

    project = ProjectOrm(id=uuid7(), name="Excl test", status="active")
    db_session.add(project)
    await db_session.flush()
    # Only tests a cross-section draws feed the model (owner 2026-09-23): the
    # picks below are "made on" this section, as the product guarantees.
    db_session.add(covering_section(project.id))
    bh_keep = await _bh(db_session, project.id, name="KEEP", x=1000.0, y=1000.0, z=10.0)
    bh_drop = await _bh(db_session, project.id, name="DROP", x=2000.0, y=2000.0, z=12.0)

    repo = GeologyRepository(db_session)
    boom = await repo.create_formation(project.id, name="Boom Klei", color="#5a4a3a")
    model = await repo.create_model(project.id, name="Main")
    await db_session.commit()
    c_keep = await repo.create_contact(
        model_id=model.id, formation_id=boom.id, borehole_id=bh_keep.id, depth_top_m=2.0
    )
    c_drop = await repo.create_contact(
        model_id=model.id, formation_id=boom.id, borehole_id=bh_drop.id, depth_top_m=3.0
    )
    await db_session.commit()

    recompute = RecomputeFormationSurface(db_session)

    # No exclusion → both contacts contribute (source_contact_count == 2).
    await recompute.execute(model.id, boom.id)
    await db_session.commit()
    surface = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(
                FormationSurfaceOrm.model_id == model.id,
                FormationSurfaceOrm.formation_id == boom.id,
            )
        )
    ).scalar_one()
    assert surface.source_contact_count == 2
    checksum_all = surface.source_contact_checksum

    # Exclude bh_drop from the model, recompute → only bh_keep's point
    # remains (count drops to 1) and the checksum changes.
    model.excluded_borehole_ids = [bh_drop.id]
    await db_session.commit()
    db_session.expunge_all()
    await RecomputeFormationSurface(db_session).execute(model.id, boom.id)
    await db_session.commit()
    surface2 = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(
                FormationSurfaceOrm.model_id == model.id,
                FormationSurfaceOrm.formation_id == boom.id,
            )
        )
    ).scalar_one()
    assert surface2.source_contact_count == 1
    assert surface2.source_contact_checksum != checksum_all
    assert surface2.is_stale is False

    # Skip, never delete: BOTH contact rows still exist — un-excluding
    # the borehole would restore its contribution on the next recompute.
    for cid in (c_keep.id, c_drop.id):
        assert await db_session.get(FormationContactOrm, cid) is not None
