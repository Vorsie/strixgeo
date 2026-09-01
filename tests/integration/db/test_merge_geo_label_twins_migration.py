"""Pin the one-time geo-label twin merge migration (debt #278, R3).

Migration ``a4b5c6d7e8f9_merge_geo_label_twin_formations`` collapses the
geotech-minted "geo-label twin" ``geological_formation`` rows — two units that
share a project + litho parent + NAD class but were forked because they sat
under different geological formations — into their oldest survivor, re-pointing
every child reference and deleting the losers.

The wrapper (``scripts/run-integration-tests.ps1``) runs ``alembic upgrade head``
on the empty integration DB BEFORE pytest, so the migration itself is a no-op at
that point (no twins to merge).  This test therefore seeds a twin fixture and
invokes the migration's exact repair statements
(:func:`_repair_statements`) against the seeded rows — the same idiom the
sibling migration tests (``test_litho_layer_backfill``,
``test_delete_litho_formation_contacts``) use.

Covered:
* one survivor per group (oldest ``created_at``); the loser rows are deleted
* classified (``nad_class`` set) and skeleton (``nad_class IS NULL``) groups both
  merge, and stay SEPARATE from each other even under the same litho parent
* every child reference re-points: ``litho_layer`` / ``formation_contact`` /
  ``formation_absence`` / ``formation_surface`` / ``litho_body_solid`` / ``body``
* ``formation_contact`` / ``formation_absence`` / ``formation_surface`` unique
  collisions are deduped (loser copy deleted); non-colliding losers re-point
* body ordinals renumber dense + unique with NO body row deleted
* the survivor's ``source_geo_formation_id`` is cleared; its ``color_override``
  adopts the loser's; its ``name`` is kept
* a non-twin singleton is untouched (formation, geo id, colour, body ordinal)
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.migrations.versions.a4b5c6d7e8f9_merge_geo_label_twin_formations import (  # noqa: E501
    _repair_statements,
)
from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from tests.integration.conftest import make_project

# Deterministic created_at values so the oldest-survivor + body-renumber order
# are fixed, not clock-race dependent.
_T0 = datetime(2026, 1, 1, tzinfo=UTC)
_T1 = datetime(2026, 2, 1, tzinfo=UTC)


def _borehole(project_id, name: str) -> BoreholeOrm:
    """Build a minimal borehole anchor row."""
    return BoreholeOrm(
        id=uuid7(),
        name=name,
        app_project_id=project_id,
        project_id="TEST",
        test_id=name,
        location_x=150000.0,
        location_y=200000.0,
        epsg=31370,
        total_depth_m=10.0,
    )


def _formation(project_id, name: str, **kwargs) -> GeologicalFormationOrm:
    """Build a geological_formation row with sensible defaults."""
    return GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_id,
        name=name,
        color="#cccccc",
        **kwargs,
    )


def _accepted_layer(model_id, formation_id, borehole_id, top: float, base: float) -> LithoLayerOrm:
    """Build an accepted geotech band on a borehole anchor."""
    return LithoLayerOrm(
        id=uuid7(),
        model_id=model_id,
        formation_id=formation_id,
        borehole_id=borehole_id,
        depth_top_m=top,
        depth_base_m=base,
        status="accepted",
        source="segmenter",
        confidence="medium",
    )


def _contact(model_id, formation_id, borehole_id, depth: float) -> FormationContactOrm:
    """Build a borehole-anchored formation_contact row."""
    return FormationContactOrm(
        id=uuid7(),
        model_id=model_id,
        formation_id=formation_id,
        borehole_id=borehole_id,
        depth_top_m=depth,
        source="manual_pick",
        confidence="medium",
    )


def _body(project_id, model_id, formation_id, ordinal: int, inv_id, created_at) -> BodyOrm:
    """Build a body row under a formation."""
    return BodyOrm(
        id=uuid7(),
        app_project_id=project_id,
        model_id=model_id,
        formation_id=formation_id,
        body_ordinal=ordinal,
        source_investigation_id=inv_id,
        created_at=created_at,
    )


class _Seed:
    """Container for the seeded ids the assertions reach for."""


@pytest_asyncio.fixture
async def seed(db_session: AsyncSession) -> _Seed:
    """Seed one project with a classified twin, a skeleton twin, and a control.

    The two litho<->contact mirror triggers are disabled for the INSERT window so
    the fixture hand-authors the exact FC/LL pre-state without the LL->FC trigger
    fabricating mirrors; they are re-enabled before the commit.
    """
    project = await make_project(db_session)
    s = _Seed()
    s.project_id = project.id

    bh = _borehole(project.id, "BH-1")
    bh2 = _borehole(project.id, "BH-2")
    bh3 = _borehole(project.id, "BH-3")
    # A geotech model requires a parent (ck_geological_model_kind_parent_null):
    # geological -> litho -> geotech.
    geo_model = GeologicalModelOrm(
        id=uuid7(), app_project_id=project.id, name="Geo M", kind="geological"
    )
    litho_model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho M",
        kind="lithostratigraphic",
        parent_model_id=geo_model.id,
    )
    model = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Geotech M",
        kind="geotechnical",
        parent_model_id=litho_model.id,
    )
    s.model_id = model.id
    s.bh_id = bh.id
    s.bh2_id = bh2.id

    # Litho parent + geo-label formations (source targets).
    litho_parent = _formation(project.id, "SAND litho")
    geo1 = _formation(project.id, "Geo Quaternary")
    geo2 = _formation(project.id, "Geo Paleogene")
    geo_a = _formation(project.id, "Geo A")
    geo_b = _formation(project.id, "Geo B")
    geo_c = _formation(project.id, "Geo C")
    s.geo_c_id = geo_c.id

    # Classified twin group: same (project, nad=5, litho parent), different geo.
    f1 = _formation(
        project.id,
        "SAND (NAD 5)",
        nad_class=5,
        source_litho_formation_id=litho_parent.id,
        source_geo_formation_id=geo1.id,
        color_override=None,
        created_at=_T0,
    )
    f2 = _formation(
        project.id,
        "SAND (NAD 5) DUP",
        nad_class=5,
        source_litho_formation_id=litho_parent.id,
        source_geo_formation_id=geo2.id,
        color_override="#abcdef",
        created_at=_T1,
    )
    s.f1_id, s.f2_id = f1.id, f2.id

    # Skeleton twin group: same litho parent, nad_class NULL — a SEPARATE group.
    # IDENTICAL created_at on both, mirroring the real dev data (every twin was
    # minted in one recompute transaction) so the survivor is decided purely by
    # the id tie-break — the lowest id wins. Computed with Python min/max on the
    # UUIDs, which orders the same way Postgres orders the uuid column.
    sk1 = _formation(
        project.id,
        "SAND (skeleton)",
        nad_class=None,
        source_litho_formation_id=litho_parent.id,
        source_geo_formation_id=geo_a.id,
        created_at=_T0,
    )
    sk2 = _formation(
        project.id,
        "SAND (skeleton) DUP",
        nad_class=None,
        source_litho_formation_id=litho_parent.id,
        source_geo_formation_id=geo_b.id,
        created_at=_T0,
    )
    s.sk_survivor_id = min(sk1.id, sk2.id)
    s.sk_loser_id = max(sk1.id, sk2.id)

    # Non-twin control: unique (project, nad=7, litho parent) — a singleton.
    ctrl = _formation(
        project.id,
        "SAND (NAD 7)",
        nad_class=7,
        source_litho_formation_id=litho_parent.id,
        source_geo_formation_id=geo_c.id,
        color_override="#111111",
        created_at=_T0,
    )
    s.ctrl_id = ctrl.id

    # Bodies — classified + skeleton each set up an ordinal-0 collision.
    body_f1 = _body(project.id, model.id, f1.id, 0, bh.id, _T0)
    body_f2 = _body(project.id, model.id, f2.id, 0, bh.id, _T1)
    body_s1 = _body(project.id, model.id, sk1.id, 0, bh.id, _T0)
    body_s2 = _body(project.id, model.id, sk2.id, 0, bh.id, _T1)
    body_n = _body(project.id, model.id, ctrl.id, 0, bh.id, _T0)
    s.body_f1_id, s.body_f2_id = body_f1.id, body_f2.id
    s.body_s1_id, s.body_s2_id = body_s1.id, body_s2.id
    s.body_n_id = body_n.id

    # Contacts — a same-depth F1/F2 pair (deduped) + a distinct-depth loser (kept).
    fc_f1 = _contact(model.id, f1.id, bh.id, 0.0)
    fc_f2_dup = _contact(model.id, f2.id, bh.id, 0.0)
    fc_f2_keep = _contact(model.id, f2.id, bh.id, 5.0)
    s.fc_f1_id, s.fc_f2_dup_id, s.fc_f2_keep_id = fc_f1.id, fc_f2_dup.id, fc_f2_keep.id

    # Absences — a colliding F1/F2 pair (deduped) + a distinct-investigation loser.
    abs_f1 = FormationAbsenceOrm(
        id=uuid7(),
        formation_id=f1.id,
        investigation_id=bh.id,
        investigation_kind="borehole",
        source="manual",
    )
    abs_f2_dup = FormationAbsenceOrm(
        id=uuid7(),
        formation_id=f2.id,
        investigation_id=bh.id,
        investigation_kind="borehole",
        source="inferred",
    )
    abs_f2_keep = FormationAbsenceOrm(
        id=uuid7(),
        formation_id=f2.id,
        investigation_id=bh2.id,
        investigation_kind="borehole",
        source="manual",
    )
    s.abs_f1_id, s.abs_f2_dup_id, s.abs_f2_keep_id = abs_f1.id, abs_f2_dup.id, abs_f2_keep.id

    # Surfaces — a colliding F1/F2 pair on the same model (deduped).
    surf_f1 = FormationSurfaceOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=f1.id,
        method="tin",
        vertices=[[0.0, 0.0, 0.0]],
        triangles=[],
        source_contact_count=1,
        source_contact_checksum=b"f1",
    )
    surf_f2_dup = FormationSurfaceOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=f2.id,
        method="tin",
        vertices=[[1.0, 1.0, 1.0]],
        triangles=[],
        source_contact_count=1,
        source_contact_checksum=b"f2",
    )
    s.surf_f1_id, s.surf_f2_dup_id = surf_f1.id, surf_f2_dup.id

    # Solid — a loser solid re-points (its unique key is (model, body)).
    solid_f2 = LithoBodySolidOrm(
        id=uuid7(),
        model_id=model.id,
        body_id=uuid7(),
        formation_id=f2.id,
        method="tin",
        vertices=[[0.0, 0.0, 0.0]],
        triangles=[],
        source_pick_count=1,
        source_pick_checksum=b"s2",
    )
    s.solid_f2_id = solid_f2.id

    # Bands on contiguous columns per anchor so the deferred contiguity
    # constraint passes: bh -> F1[0,2] F2[2,4]; bh2 -> S1[0,2] S2[2,4]; bh3 -> N[0,2].
    ll_f1 = _accepted_layer(model.id, f1.id, bh.id, 0.0, 2.0)
    ll_f2 = _accepted_layer(model.id, f2.id, bh.id, 2.0, 4.0)
    ll_s1 = _accepted_layer(model.id, sk1.id, bh2.id, 0.0, 2.0)
    ll_s2 = _accepted_layer(model.id, sk2.id, bh2.id, 2.0, 4.0)
    ll_n = _accepted_layer(model.id, ctrl.id, bh3.id, 0.0, 2.0)
    s.ll_f1_id, s.ll_f2_id = ll_f1.id, ll_f2.id
    s.ll_s1_id, s.ll_s2_id = ll_s1.id, ll_s2.id
    s.ll_n_id = ll_n.id

    # Disable the mirror triggers for the hand-authored INSERT, then restore.
    await db_session.execute(
        text("ALTER TABLE litho_layer DISABLE TRIGGER trg_mirror_litho_layer_to_contact")
    )
    await db_session.execute(
        text("ALTER TABLE formation_contact DISABLE TRIGGER trg_mirror_litho_contact_to_layer")
    )
    # Staged flush: roots (boreholes, model, all formations) BEFORE the children
    # that FK-reference them. A single add_all + flush lets SQLAlchemy's
    # topological sort insert a body ahead of its formation because
    # geological_formation carries self-referential FKs, so flush the parents
    # first to make the FK targets present.
    db_session.add_all(
        [
            bh,
            bh2,
            bh3,
            geo_model,
            litho_model,
            model,
            litho_parent,
            geo1,
            geo2,
            geo_a,
            geo_b,
            geo_c,
            f1,
            f2,
            sk1,
            sk2,
            ctrl,
        ]
    )
    await db_session.flush()
    db_session.add_all(
        [
            body_f1,
            body_f2,
            body_s1,
            body_s2,
            body_n,
            fc_f1,
            fc_f2_dup,
            fc_f2_keep,
            abs_f1,
            abs_f2_dup,
            abs_f2_keep,
            surf_f1,
            surf_f2_dup,
            solid_f2,
            ll_f1,
            ll_f2,
            ll_s1,
            ll_s2,
            ll_n,
        ]
    )
    await db_session.flush()
    # Fire the DEFERRED contiguity constraint now: ALTER TABLE refuses while
    # litho_layer carries pending deferred trigger events from the inserts.
    await db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    await db_session.execute(
        text("ALTER TABLE litho_layer ENABLE TRIGGER trg_mirror_litho_layer_to_contact")
    )
    await db_session.execute(
        text("ALTER TABLE formation_contact ENABLE TRIGGER trg_mirror_litho_contact_to_layer")
    )
    await db_session.commit()
    return s


async def _run_migration(db_session: AsyncSession) -> None:
    """Run the migration's exact repair statements, then commit + expire caches."""
    for _label, sql in _repair_statements():
        await db_session.execute(text(sql))
    await db_session.commit()
    db_session.expire_all()


async def _exists(db_session: AsyncSession, table: str, row_id) -> bool:
    """SELECT 1 bypassing the identity map (expire_on_commit=False caches)."""
    result = await db_session.execute(text(f"SELECT 1 FROM {table} WHERE id = :id"), {"id": row_id})
    return result.first() is not None


async def _scalar(db_session: AsyncSession, sql: str, **params):
    """Fetch a single scalar from a raw SQL query."""
    return await db_session.scalar(text(sql), params)


@pytest.mark.asyncio
async def test_losers_deleted_survivors_kept(db_session: AsyncSession, seed: _Seed) -> None:
    """One survivor per group (oldest); losers gone; the singleton untouched."""
    await _run_migration(db_session)

    assert await _exists(db_session, "geological_formation", seed.f1_id)
    assert not await _exists(db_session, "geological_formation", seed.f2_id)
    assert await _exists(db_session, "geological_formation", seed.sk_survivor_id)
    assert not await _exists(db_session, "geological_formation", seed.sk_loser_id)
    # The non-twin control survives — classified/skeleton/control never cross-merge.
    assert await _exists(db_session, "geological_formation", seed.ctrl_id)


@pytest.mark.asyncio
async def test_survivor_geo_cleared_and_color_adopted(
    db_session: AsyncSession, seed: _Seed
) -> None:
    """Survivor geo id nulled + colour adopted; the control's stay untouched."""
    await _run_migration(db_session)

    f1_geo = await _scalar(
        db_session,
        "SELECT source_geo_formation_id FROM geological_formation WHERE id = :id",
        id=seed.f1_id,
    )
    assert f1_geo is None
    f1_color = await _scalar(
        db_session,
        "SELECT color_override FROM geological_formation WHERE id = :id",
        id=seed.f1_id,
    )
    assert f1_color == "#abcdef"  # adopted from the loser F2
    f1_name = await _scalar(
        db_session, "SELECT name FROM geological_formation WHERE id = :id", id=seed.f1_id
    )
    assert f1_name == "SAND (NAD 5)"  # survivor keeps its own name

    # Control singleton: geo id + colour untouched.
    ctrl_geo = await _scalar(
        db_session,
        "SELECT source_geo_formation_id FROM geological_formation WHERE id = :id",
        id=seed.ctrl_id,
    )
    assert ctrl_geo == seed.geo_c_id
    ctrl_color = await _scalar(
        db_session,
        "SELECT color_override FROM geological_formation WHERE id = :id",
        id=seed.ctrl_id,
    )
    assert ctrl_color == "#111111"


@pytest.mark.asyncio
async def test_all_child_references_repoint(db_session: AsyncSession, seed: _Seed) -> None:
    """litho_layer / litho_body_solid / re-pointed contacts + absences land on survivor."""
    await _run_migration(db_session)

    async def _formation_of(table: str, row_id) -> object:
        return await _scalar(
            db_session, f"SELECT formation_id FROM {table} WHERE id = :id", id=row_id
        )

    # Layers re-point to their survivor.
    assert await _formation_of("litho_layer", seed.ll_f1_id) == seed.f1_id
    assert await _formation_of("litho_layer", seed.ll_f2_id) == seed.f1_id
    assert await _formation_of("litho_layer", seed.ll_s1_id) == seed.sk_survivor_id
    assert await _formation_of("litho_layer", seed.ll_s2_id) == seed.sk_survivor_id
    # Control layer untouched.
    assert await _formation_of("litho_layer", seed.ll_n_id) == seed.ctrl_id
    # Solid re-points (unique key (model, body) untouched by a formation move).
    assert await _formation_of("litho_body_solid", seed.solid_f2_id) == seed.f1_id


@pytest.mark.asyncio
async def test_unique_collisions_deduped(db_session: AsyncSession, seed: _Seed) -> None:
    """Colliding loser contact/absence/surface deleted; non-colliding ones re-point."""
    await _run_migration(db_session)

    # Contact: survivor kept, colliding loser deleted, distinct-depth loser re-pointed.
    assert await _exists(db_session, "formation_contact", seed.fc_f1_id)
    assert not await _exists(db_session, "formation_contact", seed.fc_f2_dup_id)
    assert await _exists(db_session, "formation_contact", seed.fc_f2_keep_id)
    keep_formation = await _scalar(
        db_session,
        "SELECT formation_id FROM formation_contact WHERE id = :id",
        id=seed.fc_f2_keep_id,
    )
    assert keep_formation == seed.f1_id

    # Absence: same shape.
    assert await _exists(db_session, "formation_absence", seed.abs_f1_id)
    assert not await _exists(db_session, "formation_absence", seed.abs_f2_dup_id)
    assert await _exists(db_session, "formation_absence", seed.abs_f2_keep_id)

    # Surface: colliding loser deleted, survivor kept.
    assert await _exists(db_session, "formation_surface", seed.surf_f1_id)
    assert not await _exists(db_session, "formation_surface", seed.surf_f2_dup_id)


@pytest.mark.asyncio
async def test_body_ordinals_dense_and_no_row_deleted(
    db_session: AsyncSession, seed: _Seed
) -> None:
    """Body ordinals renumber dense + unique with NO body row deleted."""
    await _run_migration(db_session)

    # No body row was deleted — all five survive.
    for body_id in (
        seed.body_f1_id,
        seed.body_f2_id,
        seed.body_s1_id,
        seed.body_s2_id,
        seed.body_n_id,
    ):
        assert await _exists(db_session, "body", body_id)

    async def _ordinal(row_id) -> int:
        return await _scalar(db_session, "SELECT body_ordinal FROM body WHERE id = :id", id=row_id)

    async def _formation(row_id) -> object:
        return await _scalar(db_session, "SELECT formation_id FROM body WHERE id = :id", id=row_id)

    # Classified survivor: both bodies land under F1, ordinals dense 0/1 by created_at.
    assert await _formation(seed.body_f1_id) == seed.f1_id
    assert await _formation(seed.body_f2_id) == seed.f1_id
    assert await _ordinal(seed.body_f1_id) == 0
    assert await _ordinal(seed.body_f2_id) == 1

    # Skeleton survivor (decided by the id tie-break): both bodies land on it,
    # ordinals dense 0/1 by the bodies' own created_at.
    assert await _formation(seed.body_s1_id) == seed.sk_survivor_id
    assert await _formation(seed.body_s2_id) == seed.sk_survivor_id
    assert await _ordinal(seed.body_s1_id) == 0
    assert await _ordinal(seed.body_s2_id) == 1

    # Control body untouched: same formation, ordinal still 0.
    assert await _formation(seed.body_n_id) == seed.ctrl_id
    assert await _ordinal(seed.body_n_id) == 0
