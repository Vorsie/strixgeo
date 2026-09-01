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
    _COUNT_GROUPS_SQL,
    _COUNT_LOSERS_SQL,
    _NAME_DIFF_SQL,
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
_T2 = datetime(2026, 3, 1, tzinfo=UTC)


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


def _contact(
    model_id, formation_id, borehole_id, depth: float, created_at=None
) -> FormationContactOrm:
    """Build a borehole-anchored formation_contact row.

    ``created_at`` is explicit so the dedup tie-break between two LOSER contacts
    (both is_survivor=false) is deterministic — the migration keeps the oldest.
    """
    kwargs = {} if created_at is None else {"created_at": created_at}
    return FormationContactOrm(
        id=uuid7(),
        model_id=model_id,
        formation_id=formation_id,
        borehole_id=borehole_id,
        depth_top_m=depth,
        source="manual_pick",
        confidence="medium",
        **kwargs,
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
    geo3 = _formation(project.id, "Geo Neogene")
    geo_a = _formation(project.id, "Geo A")
    geo_b = _formation(project.id, "Geo B")
    geo_c = _formation(project.id, "Geo C")
    s.geo_c_id = geo_c.id

    # Classified twin group — THREE members (1 survivor + 2 losers), the shape
    # the real dev data averages (~2.5 losers/group). This exercises paths a
    # 2-member group never reaches: loser-vs-loser unique-key dedup (both
    # colliding rows is_survivor=false) and colour adoption picking the OLDEST of
    # several losers (ORDER BY created_at, id LIMIT 1 now has >1 candidate).
    # The survivor F1 has no colour; the OLDEST loser F2 does; a NEWER loser F3
    # carries a different colour that must NOT win.
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
        color_override="#abcdef",  # oldest loser's colour — this one is adopted
        created_at=_T1,
    )
    f3 = _formation(
        project.id,
        "SAND (NAD 5) DUP2",
        nad_class=5,
        source_litho_formation_id=litho_parent.id,
        source_geo_formation_id=geo3.id,
        color_override="#bbbbbb",  # newer loser's colour — must NOT be adopted
        created_at=_T2,
    )
    s.f1_id, s.f2_id, s.f3_id = f1.id, f2.id, f3.id

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

    # Bodies — the classified group sets up a THREE-way ordinal-0 collision
    # (all body_ordinal=0 under different twins) so the renumber must resolve to
    # 0/1/2; the skeleton group sets up a 2-way collision.
    body_f1 = _body(project.id, model.id, f1.id, 0, bh.id, _T0)
    body_f2 = _body(project.id, model.id, f2.id, 0, bh.id, _T1)
    body_f3 = _body(project.id, model.id, f3.id, 0, bh.id, _T2)
    body_s1 = _body(project.id, model.id, sk1.id, 0, bh.id, _T0)
    body_s2 = _body(project.id, model.id, sk2.id, 0, bh.id, _T1)
    body_n = _body(project.id, model.id, ctrl.id, 0, bh.id, _T0)
    s.body_f1_id, s.body_f2_id, s.body_f3_id = body_f1.id, body_f2.id, body_f3.id
    s.body_s1_id, s.body_s2_id = body_s1.id, body_s2.id
    s.body_n_id = body_n.id

    # Contacts:
    # * survivor-vs-loser at depth 0.0 — survivor fc_f1 kept, loser fc_f2_dup dropped.
    # * loser-vs-loser at depth 3.0 — NO survivor there; two losers collide after
    #   re-point, the OLDER (fc_f2_ll, _T1) is kept, the newer (fc_f3_ll, _T2) dropped.
    # * fc_f2_keep at 5.0 — no collision, re-points onto the survivor.
    fc_f1 = _contact(model.id, f1.id, bh.id, 0.0)
    fc_f2_dup = _contact(model.id, f2.id, bh.id, 0.0)
    fc_f2_ll = _contact(model.id, f2.id, bh.id, 3.0, created_at=_T1)
    fc_f3_ll = _contact(model.id, f3.id, bh.id, 3.0, created_at=_T2)
    fc_f2_keep = _contact(model.id, f2.id, bh.id, 5.0)
    s.fc_f1_id, s.fc_f2_dup_id, s.fc_f2_keep_id = fc_f1.id, fc_f2_dup.id, fc_f2_keep.id
    s.fc_f2_ll_id, s.fc_f3_ll_id = fc_f2_ll.id, fc_f3_ll.id

    # Absences (unique on formation, kind, investigation):
    # * survivor-vs-loser at inv=bh — survivor abs_f1 kept, loser abs_f2_dup dropped.
    # * loser-vs-loser at inv=inv_ll — NO survivor there; older loser (abs_f2_ll,
    #   _T1) kept, newer (abs_f3_ll, _T2) dropped.
    # * abs_f2_keep at inv=bh2 — no collision, re-points onto the survivor.
    inv_ll = uuid7()
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
    abs_f2_ll = FormationAbsenceOrm(
        id=uuid7(),
        formation_id=f2.id,
        investigation_id=inv_ll,
        investigation_kind="borehole",
        source="manual",
        created_at=_T1,
    )
    abs_f3_ll = FormationAbsenceOrm(
        id=uuid7(),
        formation_id=f3.id,
        investigation_id=inv_ll,
        investigation_kind="borehole",
        source="inferred",
        created_at=_T2,
    )
    abs_f2_keep = FormationAbsenceOrm(
        id=uuid7(),
        formation_id=f2.id,
        investigation_id=bh2.id,
        investigation_kind="borehole",
        source="manual",
    )
    s.abs_f1_id, s.abs_f2_dup_id, s.abs_f2_keep_id = abs_f1.id, abs_f2_dup.id, abs_f2_keep.id
    s.abs_f2_ll_id, s.abs_f3_ll_id = abs_f2_ll.id, abs_f3_ll.id

    # Surfaces — loser-vs-loser on (model, formation): the survivor has NO
    # surface, so the two losers collide after re-point and the OLDER (surf_f2_ll,
    # _T1) is kept on the survivor, the newer (surf_f3_ll, _T2) dropped.
    surf_f2_ll = FormationSurfaceOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=f2.id,
        method="tin",
        vertices=[[1.0, 1.0, 1.0]],
        triangles=[],
        source_contact_count=1,
        source_contact_checksum=b"f2",
        created_at=_T1,
    )
    surf_f3_ll = FormationSurfaceOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=f3.id,
        method="tin",
        vertices=[[2.0, 2.0, 2.0]],
        triangles=[],
        source_contact_count=1,
        source_contact_checksum=b"f3",
        created_at=_T2,
    )
    s.surf_f2_ll_id, s.surf_f3_ll_id = surf_f2_ll.id, surf_f3_ll.id

    # Solids — both losers' solids re-point (unique key is (model, body), so a
    # formation move never collides).
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
    solid_f3 = LithoBodySolidOrm(
        id=uuid7(),
        model_id=model.id,
        body_id=uuid7(),
        formation_id=f3.id,
        method="tin",
        vertices=[[0.0, 0.0, 0.0]],
        triangles=[],
        source_pick_count=1,
        source_pick_checksum=b"s3",
    )
    s.solid_f2_id, s.solid_f3_id = solid_f2.id, solid_f3.id

    # Bands on contiguous columns per anchor so the deferred contiguity
    # constraint passes: bh -> F1[0,2] F2[2,4] F3[4,6]; bh2 -> S1[0,2] S2[2,4];
    # bh3 -> N[0,2].
    ll_f1 = _accepted_layer(model.id, f1.id, bh.id, 0.0, 2.0)
    ll_f2 = _accepted_layer(model.id, f2.id, bh.id, 2.0, 4.0)
    ll_f3 = _accepted_layer(model.id, f3.id, bh.id, 4.0, 6.0)
    ll_s1 = _accepted_layer(model.id, sk1.id, bh2.id, 0.0, 2.0)
    ll_s2 = _accepted_layer(model.id, sk2.id, bh2.id, 2.0, 4.0)
    ll_n = _accepted_layer(model.id, ctrl.id, bh3.id, 0.0, 2.0)
    s.ll_f1_id, s.ll_f2_id, s.ll_f3_id = ll_f1.id, ll_f2.id, ll_f3.id
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
            geo3,
            geo_a,
            geo_b,
            geo_c,
            f1,
            f2,
            f3,
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
            body_f3,
            body_s1,
            body_s2,
            body_n,
            fc_f1,
            fc_f2_dup,
            fc_f2_ll,
            fc_f3_ll,
            fc_f2_keep,
            abs_f1,
            abs_f2_dup,
            abs_f2_ll,
            abs_f3_ll,
            abs_f2_keep,
            surf_f2_ll,
            surf_f3_ll,
            solid_f2,
            solid_f3,
            ll_f1,
            ll_f2,
            ll_f3,
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
    # Both losers of the 3-member classified group are gone.
    assert not await _exists(db_session, "geological_formation", seed.f2_id)
    assert not await _exists(db_session, "geological_formation", seed.f3_id)
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
    # Adopted from the OLDEST loser (F2, #abcdef) — NOT the newer loser F3
    # (#bbbbbb). The 3-member group is what gives this assertion teeth.
    assert f1_color == "#abcdef"
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

    # Layers of ALL THREE classified members re-point to the survivor.
    assert await _formation_of("litho_layer", seed.ll_f1_id) == seed.f1_id
    assert await _formation_of("litho_layer", seed.ll_f2_id) == seed.f1_id
    assert await _formation_of("litho_layer", seed.ll_f3_id) == seed.f1_id
    assert await _formation_of("litho_layer", seed.ll_s1_id) == seed.sk_survivor_id
    assert await _formation_of("litho_layer", seed.ll_s2_id) == seed.sk_survivor_id
    # Control layer untouched.
    assert await _formation_of("litho_layer", seed.ll_n_id) == seed.ctrl_id
    # Both losers' solids re-point (unique key (model, body) untouched by a move).
    assert await _formation_of("litho_body_solid", seed.solid_f2_id) == seed.f1_id
    assert await _formation_of("litho_body_solid", seed.solid_f3_id) == seed.f1_id


@pytest.mark.asyncio
async def test_unique_collisions_deduped(db_session: AsyncSession, seed: _Seed) -> None:
    """Colliding loser contact/absence/surface deleted; non-colliding ones re-point."""
    await _run_migration(db_session)

    async def _fc_formation(row_id) -> object:
        return await _scalar(
            db_session, "SELECT formation_id FROM formation_contact WHERE id = :id", id=row_id
        )

    # Contact — survivor-vs-loser at depth 0.0: survivor kept, loser deleted.
    assert await _exists(db_session, "formation_contact", seed.fc_f1_id)
    assert not await _exists(db_session, "formation_contact", seed.fc_f2_dup_id)
    # Contact — loser-vs-loser at depth 3.0: the OLDER loser is kept (now on the
    # survivor), the newer one deleted. This is the tie-break a 2-member group
    # never reaches (both colliding rows is_survivor=false).
    assert await _exists(db_session, "formation_contact", seed.fc_f2_ll_id)
    assert not await _exists(db_session, "formation_contact", seed.fc_f3_ll_id)
    assert await _fc_formation(seed.fc_f2_ll_id) == seed.f1_id
    # Contact — non-colliding loser at depth 5.0 re-points onto the survivor.
    assert await _exists(db_session, "formation_contact", seed.fc_f2_keep_id)
    assert await _fc_formation(seed.fc_f2_keep_id) == seed.f1_id

    # Absence — survivor-vs-loser kept survivor; loser-vs-loser kept the older loser.
    assert await _exists(db_session, "formation_absence", seed.abs_f1_id)
    assert not await _exists(db_session, "formation_absence", seed.abs_f2_dup_id)
    assert await _exists(db_session, "formation_absence", seed.abs_f2_ll_id)
    assert not await _exists(db_session, "formation_absence", seed.abs_f3_ll_id)
    assert await _exists(db_session, "formation_absence", seed.abs_f2_keep_id)

    # Surface — loser-vs-loser on (model, formation): the older loser survives
    # (re-pointed onto the survivor), the newer is deleted.
    assert await _exists(db_session, "formation_surface", seed.surf_f2_ll_id)
    assert not await _exists(db_session, "formation_surface", seed.surf_f3_ll_id)
    surf_formation = await _scalar(
        db_session,
        "SELECT formation_id FROM formation_surface WHERE id = :id",
        id=seed.surf_f2_ll_id,
    )
    assert surf_formation == seed.f1_id


@pytest.mark.asyncio
async def test_body_ordinals_dense_and_no_row_deleted(
    db_session: AsyncSession, seed: _Seed
) -> None:
    """Body ordinals renumber dense + unique with NO body row deleted."""
    await _run_migration(db_session)

    # No body row was deleted — all six survive.
    for body_id in (
        seed.body_f1_id,
        seed.body_f2_id,
        seed.body_f3_id,
        seed.body_s1_id,
        seed.body_s2_id,
        seed.body_n_id,
    ):
        assert await _exists(db_session, "body", body_id)

    async def _ordinal(row_id) -> int:
        return await _scalar(db_session, "SELECT body_ordinal FROM body WHERE id = :id", id=row_id)

    async def _formation(row_id) -> object:
        return await _scalar(db_session, "SELECT formation_id FROM body WHERE id = :id", id=row_id)

    # Classified survivor: all THREE bodies land under F1 (a 3-way ordinal-0
    # collision) and renumber dense 0/1/2 by created_at.
    assert await _formation(seed.body_f1_id) == seed.f1_id
    assert await _formation(seed.body_f2_id) == seed.f1_id
    assert await _formation(seed.body_f3_id) == seed.f1_id
    assert await _ordinal(seed.body_f1_id) == 0
    assert await _ordinal(seed.body_f2_id) == 1
    assert await _ordinal(seed.body_f3_id) == 2

    # Skeleton survivor (decided by the id tie-break): both bodies land on it,
    # ordinals dense 0/1 by the bodies' own created_at.
    assert await _formation(seed.body_s1_id) == seed.sk_survivor_id
    assert await _formation(seed.body_s2_id) == seed.sk_survivor_id
    assert await _ordinal(seed.body_s1_id) == 0
    assert await _ordinal(seed.body_s2_id) == 1

    # Control body untouched: same formation, ordinal still 0.
    assert await _formation(seed.body_n_id) == seed.ctrl_id
    assert await _ordinal(seed.body_n_id) == 0


@pytest.mark.asyncio
async def test_preflight_report_queries_run(db_session: AsyncSession, seed: _Seed) -> None:
    """upgrade()'s own read-only report SQL runs against the seeded state.

    Executing the exact queries the migration prints from means a typo in one
    surfaces here, not first during the real run. Two twin groups (classified
    {F1,F2,F3} + skeleton {sk1,sk2}); three losers (F2, F3, one skeleton); three
    differing loser names.
    """
    groups = await _scalar(db_session, _COUNT_GROUPS_SQL)
    losers = await _scalar(db_session, _COUNT_LOSERS_SQL)
    assert groups == 2
    assert losers == 3

    name_rows = (await db_session.execute(text(_NAME_DIFF_SQL))).fetchall()
    assert len(name_rows) == 3
