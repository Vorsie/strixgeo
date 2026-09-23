"""Integration tests for RebuildModelSurfaces — debt #116.

Seven cases:

RS1. Happy path — geological model with N contacts across two formations →
     N surface rows rebuilt, all is_stale=False, RebuildOutcome.formations_rebuilt > 0.

RS2. Empty model — no contacts, no stale orphan surfaces → no-op (0 rebuilt, 0 considered).

RS3. Staleness cleared — create contacts + surface with is_stale=True, run rebuild →
     is_stale flipped to False on every surface row.

RS4. Orphan stale surface — delete the contact that seeded a surface but leave the
     is_stale=True surface row behind (simulates "last contact deleted" path) →
     rebuild clears the orphan surface.

RS5. Age-reorder (geological model) — three formations created in reverse age order →
     after rebuild their display_order is reassigned to match the data-driven
     youngest-on-top ordering.

RS6. Litho model kind-scope guard — _reorder_by_age MUST NOT reorder a
     lithostratigraphic model's formations (debt #69 regression guard).

RS7. Idempotent rebuild — two consecutive rebuild calls on the same model produce
     the same RebuildOutcome.formations_rebuilt; the surface geometry is stable.

RS9. Membership (owner ruling 2026-09-23, "only don't use tests not on sections
     for the model"): a test no cross-section draws does not feed the TIN — its
     pick stays, its contribution stops (RS9a); a test excluded from the only
     section that reaches it is off-section (RS9b); a project with no section
     builds an empty surface from every pick (RS9c).

Every ordinary scene carries a ``covering_section`` — in the product a pick can
only be made on a section, so a scene without one is not a scene the app can
produce.
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.rebuild_model_surfaces import RebuildModelSurfaces
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.investigation_review_orm import InvestigationReviewOrm
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
from tests.integration._section_builders import covering_section, section_through

# ---------------------------------------------------------------------------
# Private fixture helpers
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float, y: float = 200_000.0) -> BoreholeOrm:
    """Minimal borehole with a known location + elevation (needed for TIN points)."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-{suffix}",
        app_project_id=project_id,
        project_id="REBUILD_TESTS",
        test_id=f"BH-REBUILD-{suffix}",
        location_x=x,
        location_y=y,
        elevation_m=5.0,
        epsg=31370,
        total_depth_m=20.0,
    )


def _formation(
    project: ProjectOrm,
    *,
    name: str,
    display_order: int = 0,
    pinned_order: bool = False,
) -> GeologicalFormationOrm:
    """Unsaved geological-level GeologicalFormationOrm (no parent → geo-level)."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        color="#aabbcc",
        display_order=display_order,
        pinned_order=pinned_order,
    )


def _litho_formation(
    project: ProjectOrm,
    parent: GeologicalFormationOrm,
    *,
    name: str,
    display_order: int = 0,
) -> GeologicalFormationOrm:
    """Unsaved litho-level GeologicalFormationOrm (has parent → litho-level)."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name=name,
        color="#ccddee",
        display_order=display_order,
        parent_formation_id=parent.id,
        litho_main_soil_code="ZAND",
    )


def _hidden_review(project: ProjectOrm, borehole: BoreholeOrm) -> InvestigationReviewOrm:
    """Unsaved investigation_review row marking a borehole removed from the project.

    ``is_hidden=True`` is exactly what the desktop "remove from project" action
    writes (project-local hide) — the borehole row and its contacts survive.
    """
    return InvestigationReviewOrm(
        id=uuid7(),
        app_project_id=project.id,
        target_kind="borehole",
        target_id=borehole.id,
        review_status="unreviewed",
        is_hidden=True,
    )


def _stale_surface(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    *,
    is_stale: bool = True,
) -> FormationSurfaceOrm:
    """Unsaved FormationSurfaceOrm with empty geometry (tests staleness logic)."""
    return FormationSurfaceOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        method="tin",
        vertices=[],
        triangles=[],
        source_contact_count=0,
        source_contact_checksum=b"stale_seed",
        is_stale=is_stale,
    )


# ---------------------------------------------------------------------------
# Shared project fixture
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """Bare active project for rebuild-surfaces tests."""
    proj = ProjectOrm(id=uuid7(), name="rebuild surfaces test", status="active")
    db_session.add(proj)
    await db_session.commit()
    return proj


@pytest_asyncio.fixture
async def covering(db_session: AsyncSession, project: ProjectOrm) -> None:
    """A section whose corridor draws every test of the scene.

    Only tests a cross-section draws feed the model (owner 2026-09-23). The
    scenes below pick contacts as the product would — on a section — without
    each one drawing its own line.
    """
    db_session.add(covering_section(project.id))
    await db_session.commit()


# ---------------------------------------------------------------------------
# RS1: happy path — contacts on two formations → both surfaces rebuilt
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_happy_path_rebuilds_all_formations_with_contacts(
    db_session: AsyncSession,
    project: ProjectOrm,
    covering: None,
) -> None:
    """A geological model with contacts on two formations rebuilds both surfaces.

    - RebuildOutcome.formations_considered == 2
    - RebuildOutcome.formations_rebuilt >= 1  (force=True always re-triangulates)
    - Both FormationSurface rows exist with is_stale=False after rebuild.
    """
    model = _geo_model(project)
    f1 = _formation(project, name="RS1-Formation-A", display_order=0)
    f2 = _formation(project, name="RS1-Formation-B", display_order=1)
    # Three boreholes spread in X to give the TIN enough distinct (x,y) points.
    bh1 = _borehole(project.id, suffix="RS1-BH1", x=150_000.0)
    bh2 = _borehole(project.id, suffix="RS1-BH2", x=150_200.0)
    bh3 = _borehole(project.id, suffix="RS1-BH3", x=150_100.0, y=200_200.0)

    db_session.add_all([model, f1, f2, bh1, bh2, bh3])
    await db_session.flush()

    # Three contacts per formation → non-degenerate TIN triangulation possible.
    contacts = [
        _contact(model, f1, bh1, depth=3.0),
        _contact(model, f1, bh2, depth=3.5),
        _contact(model, f1, bh3, depth=3.2),
        _contact(model, f2, bh1, depth=8.0),
        _contact(model, f2, bh2, depth=8.5),
        _contact(model, f2, bh3, depth=8.2),
    ]
    db_session.add_all(contacts)
    await db_session.commit()

    outcome = await RebuildModelSurfaces(db_session).execute(model.id)

    assert outcome.formations_considered == 2, (
        f"RS1: expected 2 formations considered; got {outcome.formations_considered}"
    )
    assert outcome.formations_rebuilt >= 1, (
        f"RS1: expected at least 1 formation rebuilt; got {outcome.formations_rebuilt}"
    )

    surfaces = (
        (
            await db_session.execute(
                select(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == model.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(surfaces) == 2, f"RS1: expected 2 surface rows; got {len(surfaces)}"
    for s in surfaces:
        assert s.is_stale is False, (
            f"RS1: surface for formation {s.formation_id} must have is_stale=False after rebuild"
        )


# ---------------------------------------------------------------------------
# RS2: empty model → no-op
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_model_is_noop(
    db_session: AsyncSession,
    project: ProjectOrm,
    covering: None,
) -> None:
    """A model with no contacts and no stale surfaces returns a zero-count outcome."""
    model = _geo_model(project)
    db_session.add(model)
    await db_session.commit()

    outcome = await RebuildModelSurfaces(db_session).execute(model.id)

    assert outcome.formations_considered == 0, (
        f"RS2: expected 0 formations considered on empty model; got {outcome.formations_considered}"
    )
    assert outcome.formations_rebuilt == 0, (
        f"RS2: expected 0 formations rebuilt on empty model; got {outcome.formations_rebuilt}"
    )


# ---------------------------------------------------------------------------
# RS3: pre-existing stale surface → is_stale cleared by rebuild
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stale_flag_is_cleared_after_rebuild(
    db_session: AsyncSession,
    project: ProjectOrm,
    covering: None,
) -> None:
    """A surface row with is_stale=True must have is_stale=False after a rebuild.

    Simulates the scenario where a contact mutation (PATCH depth) flipped
    is_stale=True on the cached surface, and the user clicks "Build 3D model".
    The rebuild should always produce is_stale=False regardless of whether
    the geometry changed.
    """
    model = _geo_model(project)
    f1 = _formation(project, name="RS3-Formation-Stale", display_order=0)
    bh1 = _borehole(project.id, suffix="RS3-BH1", x=155_000.0)
    bh2 = _borehole(project.id, suffix="RS3-BH2", x=155_200.0)
    bh3 = _borehole(project.id, suffix="RS3-BH3", x=155_100.0, y=200_200.0)

    db_session.add_all([model, f1, bh1, bh2, bh3])
    await db_session.flush()

    contacts = [
        _contact(model, f1, bh1, depth=4.0),
        _contact(model, f1, bh2, depth=4.5),
        _contact(model, f1, bh3, depth=4.2),
    ]
    db_session.add_all(contacts)

    # Plant a stale surface row (simulates a contact mutation that ran
    # mark_surfaces_stale but the user hasn't clicked Build yet).
    stale = _stale_surface(model, f1, is_stale=True)
    db_session.add(stale)
    await db_session.commit()

    # Pre-condition: surface is stale.
    pre_surface = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(FormationSurfaceOrm.id == stale.id)
        )
    ).scalar_one()
    assert pre_surface.is_stale is True, "RS3 pre-condition: surface must be stale before rebuild"

    await RebuildModelSurfaces(db_session).execute(model.id)
    await db_session.refresh(stale)

    assert stale.is_stale is False, (
        f"RS3: is_stale must be False after rebuild; got {stale.is_stale!r}"
    )


# ---------------------------------------------------------------------------
# RS4: orphan stale surface (contact deleted, surface row survives) → cleared
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_orphan_stale_surface_is_cleared(
    db_session: AsyncSession,
    project: ProjectOrm,
    covering: None,
) -> None:
    """After deleting the last contact on a formation, a rebuild clears the
    orphan surface row (sets is_stale=False or removes it).

    The use-case docstring documents this as the "orphan stale surface" path:
    the contact-based query misses formations whose last contact was deleted,
    but the stale-surface query picks them up so the "N unbuilt edits" badge
    doesn't stick forever.
    """
    model = _geo_model(project)
    f_orphan = _formation(project, name="RS4-Orphan", display_order=0)
    bh1 = _borehole(project.id, suffix="RS4-BH1", x=156_000.0)

    db_session.add_all([model, f_orphan, bh1])
    await db_session.flush()

    # Insert a stale surface row with NO matching contact — simulates the
    # state after a contact delete that called mark_surfaces_stale but left
    # the surface row behind with is_stale=True.
    orphan_surface = _stale_surface(model, f_orphan, is_stale=True)
    db_session.add(orphan_surface)
    await db_session.commit()

    outcome = await RebuildModelSurfaces(db_session).execute(model.id)

    # The orphan formation must have been picked up.
    assert outcome.formations_considered >= 1, (
        f"RS4: orphan stale formation must be considered; got {outcome.formations_considered}"
    )

    # After rebuild, the orphan surface row must have is_stale=False.
    await db_session.refresh(orphan_surface)
    assert orphan_surface.is_stale is False, (
        f"RS4: orphan surface must have is_stale=False after rebuild; "
        f"got {orphan_surface.is_stale!r}"
    )


# ---------------------------------------------------------------------------
# RS5: age-reorder — display_order corrected by contact data
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_age_reorder_assigns_display_order_from_contact_depths(
    db_session: AsyncSession,
    project: ProjectOrm,
    covering: None,
) -> None:
    """_reorder_by_age assigns display_order so younger (shallower) formations
    receive a HIGHER display_order than older (deeper) ones, matching the
    CLAUDE.md convention "lower display_order = older formation."

    Setup: three formations created with display_orders INVERTED vs. their
    contact depths (youngest given the LOWEST display_order, oldest given
    the HIGHEST). Contacts place formation A at depth ~2 m, B at ~5 m, C
    at ~10 m. After correct rebuild:
    - Formation A (shallowest / youngest) → HIGHEST display_order.
    - Formation C (deepest / oldest)     → LOWEST display_order.

    Regression guard for debt #177 (age-reorder direction inversion,
    resolved 2026-06-01).
    """
    model = _geo_model(project)
    # Intentionally create with display_orders INVERTED vs. contact depths.
    # The rebuild must flip them to match the CLAUDE.md convention.
    f_young = _formation(
        project, name="RS5-Young-A", display_order=0
    )  # shallowest, should END UP highest
    f_mid = _formation(project, name="RS5-Mid-B", display_order=1)  # middle depth
    f_old = _formation(project, name="RS5-Old-C", display_order=2)  # deepest, should END UP lowest
    bh1 = _borehole(project.id, suffix="RS5-BH1", x=157_000.0)
    bh2 = _borehole(project.id, suffix="RS5-BH2", x=157_200.0)
    bh3 = _borehole(project.id, suffix="RS5-BH3", x=157_100.0, y=200_200.0)

    db_session.add_all([model, f_young, f_mid, f_old, bh1, bh2, bh3])
    await db_session.flush()

    # Contacts: younger (A) shallower than mid (B) shallower than older (C).
    contacts = [
        _contact(model, f_young, bh1, depth=2.0),
        _contact(model, f_young, bh2, depth=2.2),
        _contact(model, f_young, bh3, depth=2.1),
        _contact(model, f_mid, bh1, depth=5.0),
        _contact(model, f_mid, bh2, depth=5.2),
        _contact(model, f_mid, bh3, depth=5.1),
        _contact(model, f_old, bh1, depth=10.0),
        _contact(model, f_old, bh2, depth=10.2),
        _contact(model, f_old, bh3, depth=10.1),
    ]
    db_session.add_all(contacts)
    await db_session.commit()

    outcome = await RebuildModelSurfaces(db_session).execute(model.id)

    # At least one formation got reordered (we deliberately started wrong).
    reordered = outcome.formations_reordered
    assert reordered >= 1, (
        f"RS5: expected at least one reorder; got formations_reordered={reordered}"
    )

    await db_session.refresh(f_young)
    await db_session.refresh(f_mid)
    await db_session.refresh(f_old)

    # Younger (shallower) must have HIGHER display_order than older (deeper).
    assert f_young.display_order > f_old.display_order, (
        f"RS5: younger formation must have higher display_order than older; "
        f"got f_young={f_young.display_order}, f_old={f_old.display_order}"
    )
    assert f_mid.display_order > f_old.display_order, (
        f"RS5: mid formation must have higher display_order than older; "
        f"got f_mid={f_mid.display_order}, f_old={f_old.display_order}"
    )
    assert f_young.display_order > f_mid.display_order, (
        f"RS5: younger formation must have higher display_order than mid; "
        f"got f_young={f_young.display_order}, f_mid={f_mid.display_order}"
    )


# ---------------------------------------------------------------------------
# RS6: litho model kind-scope guard — _reorder_by_age skips litho models
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_litho_model_reorder_is_skipped(
    db_session: AsyncSession,
    project: ProjectOrm,
    covering: None,
) -> None:
    """Debt #69 regression: rebuilding a lithostratigraphic model MUST NOT
    trigger _reorder_by_age (which would clobber per-instance ordinal
    display_orders that AcceptLithoSuggestions._recompute_litho_display_orders
    just set).

    Verify that formations_reordered == 0 when the model kind is
    'lithostratigraphic', even when the contact data would imply a different
    age ordering.
    """
    geo = _geo_model(project)
    litho = _litho_model(project, geo)
    geo_parent = _formation(project, name="RS6-Geo-Parent", display_order=0)
    # Two litho units with intentionally wrong display_orders.
    f_a = _litho_formation(project, geo_parent, name="RS6-Litho-A", display_order=5)
    f_b = _litho_formation(project, geo_parent, name="RS6-Litho-B", display_order=1)
    bh1 = _borehole(project.id, suffix="RS6-BH1", x=158_000.0)
    bh2 = _borehole(project.id, suffix="RS6-BH2", x=158_200.0)
    bh3 = _borehole(project.id, suffix="RS6-BH3", x=158_100.0, y=200_200.0)

    db_session.add_all([geo, litho, geo_parent, f_a, f_b, bh1, bh2, bh3])
    await db_session.flush()

    contacts = [
        _contact(litho, f_a, bh1, depth=2.0),
        _contact(litho, f_a, bh2, depth=2.2),
        _contact(litho, f_a, bh3, depth=2.1),
        _contact(litho, f_b, bh1, depth=6.0),
        _contact(litho, f_b, bh2, depth=6.2),
        _contact(litho, f_b, bh3, depth=6.1),
    ]
    db_session.add_all(contacts)
    await db_session.commit()

    original_order_a = f_a.display_order
    original_order_b = f_b.display_order

    outcome = await RebuildModelSurfaces(db_session).execute(litho.id)

    # Age-reorder must be skipped for litho models.
    assert outcome.formations_reordered == 0, (
        f"RS6: lithostratigraphic rebuild MUST NOT reorder formations; "
        f"got formations_reordered={outcome.formations_reordered}"
    )

    await db_session.refresh(f_a)
    await db_session.refresh(f_b)

    # display_orders must be untouched.
    assert f_a.display_order == original_order_a, (
        f"RS6: f_a.display_order changed from {original_order_a} to {f_a.display_order}"
    )
    assert f_b.display_order == original_order_b, (
        f"RS6: f_b.display_order changed from {original_order_b} to {f_b.display_order}"
    )


# ---------------------------------------------------------------------------
# RS7: idempotent rebuild — second call produces same rebuilt count
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_idempotent_rebuild(
    db_session: AsyncSession,
    project: ProjectOrm,
    covering: None,
) -> None:
    """Two consecutive rebuilds on an unchanged model produce the same
    formations_rebuilt count.

    RebuildModelSurfaces always uses force=True so both runs re-triangulate.
    The first run builds the surfaces; the second run rebuilds them from the
    same input → identical output, stable is_stale=False state.
    """
    model = _geo_model(project)
    f1 = _formation(project, name="RS7-Formation-A", display_order=0)
    bh1 = _borehole(project.id, suffix="RS7-BH1", x=159_000.0)
    bh2 = _borehole(project.id, suffix="RS7-BH2", x=159_200.0)
    bh3 = _borehole(project.id, suffix="RS7-BH3", x=159_100.0, y=200_200.0)

    db_session.add_all([model, f1, bh1, bh2, bh3])
    await db_session.flush()

    contacts = [
        _contact(model, f1, bh1, depth=3.0),
        _contact(model, f1, bh2, depth=3.5),
        _contact(model, f1, bh3, depth=3.2),
    ]
    db_session.add_all(contacts)
    await db_session.commit()

    outcome1 = await RebuildModelSurfaces(db_session).execute(model.id)
    outcome2 = await RebuildModelSurfaces(db_session).execute(model.id)

    # Both runs must rebuild (force=True bypasses the checksum short-circuit).
    rebuilt1 = outcome1.formations_rebuilt
    assert rebuilt1 >= 1, (
        f"RS7: first rebuild should produce formations_rebuilt >= 1; got {rebuilt1}"
    )
    rebuilt2 = outcome2.formations_rebuilt
    assert rebuilt2 == rebuilt1, (
        f"RS7: second rebuild must produce same count as first; got {rebuilt2} != {rebuilt1}"
    )

    surfaces = (
        (
            await db_session.execute(
                select(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == model.id)
            )
        )
        .scalars()
        .all()
    )
    for s in surfaces:
        assert s.is_stale is False, (
            f"RS7: all surfaces must have is_stale=False after second rebuild; "
            f"formation_id={s.formation_id}"
        )


# ---------------------------------------------------------------------------
# RS8: a test removed from the project stops feeding the stratigraphic model
# (owner ruling 2026-09-06)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_removed_test_is_dropped_but_surface_survives_above_three(
    db_session: AsyncSession,
    project: ProjectOrm,
    covering: None,
) -> None:
    """RS8a: a contact on a test removed from the project (is_hidden) is NOT a
    model input — the rebuild ignores it. With four contacts and one test
    removed, three remain, so the surface is rebuilt WITHOUT the removed test's
    point (source_contact_count drops from 4 to 3).
    """
    model = _geo_model(project)
    f1 = _formation(project, name="RS8a-Formation", display_order=0)
    bh1 = _borehole(project.id, suffix="RS8a-BH1", x=160_000.0)
    bh2 = _borehole(project.id, suffix="RS8a-BH2", x=160_200.0)
    bh3 = _borehole(project.id, suffix="RS8a-BH3", x=160_100.0, y=200_200.0)
    bh4 = _borehole(project.id, suffix="RS8a-BH4", x=160_050.0, y=200_100.0)

    db_session.add_all([model, f1, bh1, bh2, bh3, bh4])
    await db_session.flush()

    db_session.add_all(
        [
            _contact(model, f1, bh1, depth=3.0),
            _contact(model, f1, bh2, depth=3.5),
            _contact(model, f1, bh3, depth=3.2),
            _contact(model, f1, bh4, depth=3.4),
        ]
    )
    # bh4 is removed from the project (project-local hide).
    db_session.add(_hidden_review(project, bh4))
    await db_session.flush()  # the API route commits the hide before any rebuild
    await db_session.commit()

    await RebuildModelSurfaces(db_session).execute(model.id)

    surface = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == model.id)
        )
    ).scalar_one()
    assert surface.source_contact_count == 3, (
        "RS8a: the removed test's contact must not feed the TIN — expected 3 "
        f"contributing contacts, got {surface.source_contact_count}"
    )
    assert surface.is_stale is False


@pytest.mark.asyncio
async def test_removing_a_test_below_three_contacts_empties_the_surface(
    db_session: AsyncSession,
    project: ProjectOrm,
    covering: None,
) -> None:
    """RS8b: removing a test that drops a formation below three contacts leaves
    an EMPTY, non-rendering surface — the removed test's TIN disappears.

    A formation with three contacts builds a real surface; removing one test
    from the project leaves two, so the next rebuild re-triangulates to an
    empty surface (0 triangles, source_contact_count == 2). The two remaining
    contacts cannot form a TIN, so nothing draws — which is what makes the
    owner's dredged-away Vlierzele / Pleistoceen polygon vanish. (The row is
    kept rather than deleted so the on-click-build "cache is fresh" contract in
    ``test_geology.test_build_after_contact_create_materialises_surface`` still
    holds; see the report's Ruling 1 note.)
    """
    model = _geo_model(project)
    f1 = _formation(project, name="RS8b-Formation", display_order=0)
    bh1 = _borehole(project.id, suffix="RS8b-BH1", x=161_000.0)
    bh2 = _borehole(project.id, suffix="RS8b-BH2", x=161_200.0)
    bh3 = _borehole(project.id, suffix="RS8b-BH3", x=161_100.0, y=200_200.0)

    db_session.add_all([model, f1, bh1, bh2, bh3])
    await db_session.flush()
    db_session.add_all(
        [
            _contact(model, f1, bh1, depth=4.0),
            _contact(model, f1, bh2, depth=4.5),
            _contact(model, f1, bh3, depth=4.2),
        ]
    )
    await db_session.commit()

    # First build: a real 3-contact surface with triangles.
    await RebuildModelSurfaces(db_session).execute(model.id)
    built = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == model.id)
        )
    ).scalar_one()
    assert built.triangles, "RS8b pre-condition: the 3-contact surface must triangulate"

    # Remove one test from the project, then rebuild → 2 contacts remain.
    db_session.add(_hidden_review(project, bh3))
    await db_session.flush()  # the API route commits the hide before any rebuild
    await db_session.commit()
    await RebuildModelSurfaces(db_session).execute(model.id)

    # The first read left the surface row in the identity map; the rebuild
    # rewrote it in SQL, so expire that one stale object before reading it
    # back (expiring everything would lazy-load ``model.id`` synchronously).
    db_session.expire(built)
    surface = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == model.id)
        )
    ).scalar_one()
    assert surface.source_contact_count == 2, (
        "RS8b: the removed test's contact must not feed the TIN — expected 2 "
        f"remaining contacts, got {surface.source_contact_count}"
    )
    assert surface.triangles == [], (
        "RS8b: two contacts cannot triangulate — the surface must be empty so nothing renders"
    )


# ---------------------------------------------------------------------------
# RS9: model membership — only tests a cross-section draws feed the TIN
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rs9a_a_test_on_no_section_does_not_feed_the_surface(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """Four boreholes with picks; the section draws three of them. The fourth
    keeps its pick (the row is untouched) but the TIN is built from three —
    "only don't use tests not on sections for the model" (owner 2026-09-23).
    """
    model = _geo_model(project)
    f1 = _formation(project, name="RS9a-Formation", display_order=0)
    bh1 = _borehole(project.id, suffix="RS9a-BH1", x=170_000.0)
    bh2 = _borehole(project.id, suffix="RS9a-BH2", x=170_200.0)
    bh3 = _borehole(project.id, suffix="RS9a-BH3", x=170_100.0, y=200_150.0)
    # 400 m north of the line: outside the 200 m corridor, on no section.
    bh4 = _borehole(project.id, suffix="RS9a-BH4", x=170_100.0, y=200_400.0)
    section = section_through(
        project.id,
        name="RS9a-Section",
        start=(169_900.0, 200_000.0),
        end=(170_300.0, 200_000.0),
        buffer_m=200.0,
    )
    db_session.add_all([model, f1, bh1, bh2, bh3, bh4, section])
    await db_session.flush()
    contacts = [
        _contact(model, f1, bh1, depth=3.0),
        _contact(model, f1, bh2, depth=3.5),
        _contact(model, f1, bh3, depth=3.2),
        _contact(model, f1, bh4, depth=3.4),
    ]
    db_session.add_all(contacts)
    await db_session.commit()

    await RebuildModelSurfaces(db_session).execute(model.id)

    surface = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == model.id)
        )
    ).scalar_one()
    assert surface.source_contact_count == 3, (
        "RS9a: the off-section test's pick must not feed the TIN — expected 3 "
        f"contributing contacts, got {surface.source_contact_count}"
    )
    assert surface.is_stale is False
    # The pick itself survives: nothing was dropped from the test.
    remaining = (
        (
            await db_session.execute(
                select(FormationContactOrm.id).where(FormationContactOrm.model_id == model.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(remaining) == 4, "RS9a: the off-section pick must stay on the test"


@pytest.mark.asyncio
async def test_rs9b_a_test_excluded_from_its_only_section_is_off_section(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """In the corridor but on the section's exclusion list = not drawn there;
    with no other section reaching it, the test is off-section and its pick
    does not feed the TIN (the geotech membership rule, verbatim)."""
    model = _geo_model(project)
    f1 = _formation(project, name="RS9b-Formation", display_order=0)
    bh1 = _borehole(project.id, suffix="RS9b-BH1", x=171_000.0)
    bh2 = _borehole(project.id, suffix="RS9b-BH2", x=171_200.0)
    bh3 = _borehole(project.id, suffix="RS9b-BH3", x=171_100.0, y=200_150.0)
    bh4 = _borehole(project.id, suffix="RS9b-BH4", x=171_050.0, y=200_100.0)
    section = section_through(
        project.id,
        name="RS9b-Section",
        start=(170_900.0, 200_000.0),
        end=(171_300.0, 200_000.0),
        buffer_m=200.0,
        excluded_borehole_ids=[bh4.id],
    )
    db_session.add_all([model, f1, bh1, bh2, bh3, bh4, section])
    await db_session.flush()
    db_session.add_all(
        [
            _contact(model, f1, bh1, depth=3.0),
            _contact(model, f1, bh2, depth=3.5),
            _contact(model, f1, bh3, depth=3.2),
            _contact(model, f1, bh4, depth=3.4),
        ]
    )
    await db_session.commit()

    await RebuildModelSurfaces(db_session).execute(model.id)

    surface = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == model.id)
        )
    ).scalar_one()
    assert surface.source_contact_count == 3, (
        "RS9b: a test excluded from its only section is off-section — expected 3 "
        f"contributing contacts, got {surface.source_contact_count}"
    )


@pytest.mark.asyncio
async def test_rs9c_a_project_without_sections_builds_from_no_pick(
    db_session: AsyncSession,
    project: ProjectOrm,
) -> None:
    """No section → nothing is on a section → every anchored pick is dropped
    and the surface rebuilds EMPTY (0 triangles, 0 contributing contacts), the
    same shape a formation takes when it falls below three tests (RS8b)."""
    model = _geo_model(project)
    f1 = _formation(project, name="RS9c-Formation", display_order=0)
    bh1 = _borehole(project.id, suffix="RS9c-BH1", x=172_000.0)
    bh2 = _borehole(project.id, suffix="RS9c-BH2", x=172_200.0)
    bh3 = _borehole(project.id, suffix="RS9c-BH3", x=172_100.0, y=200_200.0)
    db_session.add_all([model, f1, bh1, bh2, bh3])
    await db_session.flush()
    db_session.add_all(
        [
            _contact(model, f1, bh1, depth=3.0),
            _contact(model, f1, bh2, depth=3.5),
            _contact(model, f1, bh3, depth=3.2),
        ]
    )
    await db_session.commit()

    await RebuildModelSurfaces(db_session).execute(model.id)

    surface = (
        await db_session.execute(
            select(FormationSurfaceOrm).where(FormationSurfaceOrm.model_id == model.id)
        )
    ).scalar_one()
    assert surface.source_contact_count == 0, (
        "RS9c: with no section nothing is on a section — expected 0 contributing "
        f"contacts, got {surface.source_contact_count}"
    )
    assert surface.triangles == [], "RS9c: the surface must be empty, not drawn"
    assert surface.is_stale is False
