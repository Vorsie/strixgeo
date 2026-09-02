"""Schema integrity hardening — debt #107.

Pins the CHECK constraints + partial-unique indexes added by migrations
``a1c2d3e4f5a6`` (domain-invariant CHECKs), ``b2d3e4f5a6b7`` (kind/parent
NULL-discriminated invariant), and ``c3e4f5a6b7c8`` (partial-unique dedup
indexes on cpt + borehole).

Wave 3 (2026-09-02) adds direct negative pins for the body-pair ruling tables
introduced after 2026-06-01 — ``body_union`` (``b5c6d7e8f9a0``),
``body_separation`` (``f3d0a1b2c4e5``) and ``body_geometry_fact``
(``c4d5e6f7a8b9``). Each carries a canonical-order CHECK
(``layer_a_id < layer_b_id``) + a per-model unique on the ordered pair; the
FK-and-index sweep (debt #107) found both already declared in migration AND
ORM, so these pins are GUARDS against a future edit dropping them, not
red-first tests for new constraints.

Setup uses ORM helpers so Python-side defaults (``excluded_borehole_ids``,
``pre_drill_m``, etc) get applied. The constraint-violating mutation is
the raw SQL — that's the only behaviour under test.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.body_geometry_fact_orm import BodyGeometryFactOrm
from groundmodel.infrastructure.db.models.body_separation_orm import BodySeparationOrm
from groundmodel.infrastructure.db.models.body_union_orm import BodyUnionOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import (
    GeologicalModelOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# The body-pair pins reuse the proven two-layer litho scene builder from the
# bodies-recompute suite (already imported cross-module by test_bundle_geometry_facts)
# so their FK targets (model + two accepted litho_layer rows) are real rows.
from tests.integration.api.test_recompute_bodies import _build_scene, _canonical_fact_pair


@pytest_asyncio.fixture
async def project(db_session: AsyncSession) -> ProjectOrm:
    """A bare project row for tests that need a parent project."""
    p = ProjectOrm(id=uuid7(), name="schema-invariants", status="active")
    db_session.add(p)
    await db_session.flush()
    return p


@pytest_asyncio.fixture
async def geo_model(db_session: AsyncSession, project: ProjectOrm) -> GeologicalModelOrm:
    """A geological model (parent-kind) under the project."""
    m = GeologicalModelOrm(id=uuid7(), app_project_id=project.id, name="m", kind="geological")
    db_session.add(m)
    await db_session.flush()
    return m


@pytest_asyncio.fixture
async def formation(db_session: AsyncSession, project: ProjectOrm) -> GeologicalFormationOrm:
    """A project-scoped formation for body fixtures."""
    f = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="F",
        display_order=0,
        color="#ffffff",
    )
    db_session.add(f)
    await db_session.flush()
    return f


# ---------------------------------------------------------------------------
# Migration a1c2d3e4f5a6 — domain-invariant CHECKs
# ---------------------------------------------------------------------------


async def test_geological_model_kind_invalid_rejected(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """``kind='invalid'`` violates ``ck_geological_model_kind_*``.

    An invalid ``kind`` also fails the ``kind_parent_null`` CHECK (because
    neither branch of its expression matches), so EITHER constraint name
    is a valid rejection signature; PG picks whichever it evaluates first.
    """
    bad = GeologicalModelOrm(id=uuid7(), app_project_id=project.id, name="bad-kind", kind="invalid")
    db_session.add(bad)
    with pytest.raises(IntegrityError, match=r"ck_geological_model_kind_"):
        await db_session.flush()


async def test_geological_model_kind_all_three_valid(
    db_session: AsyncSession, project: ProjectOrm, geo_model: GeologicalModelOrm
) -> None:
    """Each of the three documented kinds inserts cleanly."""
    db_session.add(
        GeologicalModelOrm(
            id=uuid7(),
            app_project_id=project.id,
            name="litho",
            kind="lithostratigraphic",
            parent_model_id=geo_model.id,
        )
    )
    db_session.add(
        GeologicalModelOrm(
            id=uuid7(),
            app_project_id=project.id,
            name="gt",
            kind="geotechnical",
            parent_model_id=geo_model.id,
        )
    )
    await db_session.flush()


async def test_body_ordinal_negative_rejected(
    db_session: AsyncSession,
    project: ProjectOrm,
    geo_model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
) -> None:
    """``body_ordinal = -1`` violates ``ck_body_ordinal_non_negative``."""
    with pytest.raises(IntegrityError, match="ck_body_ordinal_non_negative"):
        await db_session.execute(
            text(
                "INSERT INTO body (id, app_project_id, model_id, formation_id,"
                " body_ordinal, source_investigation_id)"
                " VALUES (:id, :pid, :mid, :fid, -1, :inv)"
            ),
            {
                "id": uuid7(),
                "pid": project.id,
                "mid": geo_model.id,
                "fid": formation.id,
                "inv": uuid7(),
            },
        )
        await db_session.flush()


# ---------------------------------------------------------------------------
# Migration b2d3e4f5a6b7 — kind / parent_model_id NULL invariant
# ---------------------------------------------------------------------------


async def test_geological_model_with_parent_rejected(
    db_session: AsyncSession, project: ProjectOrm, geo_model: GeologicalModelOrm
) -> None:
    """``kind='geological'`` MUST have ``parent_model_id IS NULL``."""
    bad = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="g-with-parent",
        kind="geological",
        parent_model_id=geo_model.id,
    )
    db_session.add(bad)
    with pytest.raises(IntegrityError, match="ck_geological_model_kind_parent_null"):
        await db_session.flush()


async def test_litho_model_without_parent_rejected(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """``kind='lithostratigraphic'`` MUST have a non-NULL parent."""
    bad = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="orphan-litho",
        kind="lithostratigraphic",
    )
    db_session.add(bad)
    with pytest.raises(IntegrityError, match="ck_geological_model_kind_parent_null"):
        await db_session.flush()


async def test_geotech_model_without_parent_rejected(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """``kind='geotechnical'`` MUST have a non-NULL parent."""
    bad = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="orphan-gt",
        kind="geotechnical",
    )
    db_session.add(bad)
    with pytest.raises(IntegrityError, match="ck_geological_model_kind_parent_null"):
        await db_session.flush()


# ---------------------------------------------------------------------------
# Migration c3e4f5a6b7c8 — partial-unique dedup indexes
# ---------------------------------------------------------------------------


async def test_cpt_dedup_partial_unique(db_session: AsyncSession, project: ProjectOrm) -> None:
    """Two CPTs with the same (app_project_id, project_id, test_id) → 2nd raises."""
    db_session.add(
        CptOrm(
            id=uuid7(),
            name="one",
            cpt_type="CPTU",
            app_project_id=project.id,
            project_id="P1",
            test_id="T1",
            location_x=0.0,
            location_y=0.0,
        )
    )
    await db_session.flush()

    db_session.add(
        CptOrm(
            id=uuid7(),
            name="two",
            cpt_type="CPTU",
            app_project_id=project.id,
            project_id="P1",
            test_id="T1",
            location_x=0.0,
            location_y=0.0,
        )
    )
    with pytest.raises(IntegrityError, match="uq_cpt_app_project_source_test"):
        await db_session.flush()


# ---------------------------------------------------------------------------
# Migration t4u5v6w7x8y9 — is_active partial UNIQUE per (app_project_id, kind)
# ---------------------------------------------------------------------------


async def test_two_active_geological_models_same_project_rejected(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """Two is_active=True geological models in the same project raises IntegrityError.

    Invariant: at most one active model per (app_project_id, kind).
    The partial unique uq_geological_model_one_active_per_kind enforces this at the DB level.
    """
    db_session.add(
        GeologicalModelOrm(
            id=uuid7(),
            app_project_id=project.id,
            name="G1",
            kind="geological",
            is_active=True,
        )
    )
    await db_session.flush()

    db_session.add(
        GeologicalModelOrm(
            id=uuid7(),
            app_project_id=project.id,
            name="G2",
            kind="geological",
            is_active=True,
        )
    )
    with pytest.raises(IntegrityError, match="uq_geological_model_one_active_per_kind"):
        await db_session.flush()


async def test_active_geological_and_active_litho_same_project_accepted(
    db_session: AsyncSession, project: ProjectOrm, geo_model: GeologicalModelOrm
) -> None:
    """One active geological + one active lithostratigraphic in the same project is allowed.

    Different kinds have independent active pointers (CLAUDE.md three-level hierarchy).
    The partial unique covers (app_project_id, kind) — same project but different kind
    means no conflict.
    """
    # Activate the geo_model fixture.
    geo_model.is_active = True
    await db_session.flush()

    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project.id,
        name="Litho refinement",
        kind="lithostratigraphic",
        is_active=True,
        parent_model_id=geo_model.id,
    )
    db_session.add(litho)
    await db_session.flush()  # must not raise — different kinds


async def test_inactive_models_not_constrained(
    db_session: AsyncSession, project: ProjectOrm
) -> None:
    """Multiple INACTIVE models of the same kind in the same project is allowed.

    The partial unique applies only WHERE is_active = TRUE.
    """
    for i in range(3):
        db_session.add(
            GeologicalModelOrm(
                id=uuid7(),
                app_project_id=project.id,
                name=f"inactive-{i}",
                kind="geological",
                is_active=False,
            )
        )
    await db_session.flush()  # must not raise — all inactive


async def test_cpt_dedup_partial_unique_ignores_null_project(
    db_session: AsyncSession,
) -> None:
    """Partial-unique excludes ``app_project_id IS NULL``; legacy duplicates allowed."""
    db_session.add(
        CptOrm(
            id=uuid7(),
            name="one",
            cpt_type="CPTU",
            app_project_id=None,
            project_id="P1",
            test_id="T1",
            location_x=0.0,
            location_y=0.0,
        )
    )
    db_session.add(
        CptOrm(
            id=uuid7(),
            name="two",
            cpt_type="CPTU",
            app_project_id=None,
            project_id="P1",
            test_id="T1",
            location_x=0.0,
            location_y=0.0,
        )
    )
    await db_session.flush()


# ---------------------------------------------------------------------------
# Wave 3 — body-pair ruling tables (canonical-order CHECK + per-model unique)
#
# Migrations b5c6d7e8f9a0 (body_union), f3d0a1b2c4e5 (body_separation),
# c4d5e6f7a8b9 (body_geometry_fact). Each stores a layer pair in canonical
# (min, max) order and is unique per (model, ordered pair). GUARD pins: the
# constraints already exist in migration AND ORM — these fail loudly if a
# future edit drops either. ``_build_scene`` gives two real accepted litho
# layers so the pair's FK targets are genuine rows and the CHECK is what the
# insert actually trips (not a dangling FK).
# ---------------------------------------------------------------------------


async def test_body_union_canonical_order_rejected(db_session: AsyncSession) -> None:
    """A descending (a > b) pair violates ``ck_body_union_canonical_order``."""
    scene = await _build_scene(db_session)
    a, b = _canonical_fact_pair(scene.layer_a_id, scene.layer_b_id)
    # Insert the pair the WRONG way round (b, a): b > a fails layer_a_id < layer_b_id.
    db_session.add(BodyUnionOrm(id=uuid7(), model_id=scene.model_id, layer_a_id=b, layer_b_id=a))
    with pytest.raises(IntegrityError, match="ck_body_union_canonical_order"):
        await db_session.flush()


async def test_body_union_pair_unique(db_session: AsyncSession) -> None:
    """Re-asserting the same (model, ordered pair) union violates ``uq_body_union_pair``."""
    scene = await _build_scene(db_session)
    a, b = _canonical_fact_pair(scene.layer_a_id, scene.layer_b_id)
    db_session.add(BodyUnionOrm(id=uuid7(), model_id=scene.model_id, layer_a_id=a, layer_b_id=b))
    await db_session.flush()
    db_session.add(BodyUnionOrm(id=uuid7(), model_id=scene.model_id, layer_a_id=a, layer_b_id=b))
    with pytest.raises(IntegrityError, match="uq_body_union_pair"):
        await db_session.flush()


async def test_body_separation_canonical_order_rejected(db_session: AsyncSession) -> None:
    """A descending (a > b) pair violates ``ck_body_separation_canonical_order``."""
    scene = await _build_scene(db_session)
    a, b = _canonical_fact_pair(scene.layer_a_id, scene.layer_b_id)
    db_session.add(
        BodySeparationOrm(id=uuid7(), model_id=scene.model_id, layer_a_id=b, layer_b_id=a)
    )
    with pytest.raises(IntegrityError, match="ck_body_separation_canonical_order"):
        await db_session.flush()


async def test_body_separation_pair_unique(db_session: AsyncSession) -> None:
    """Re-asserting the same separation pair violates ``uq_body_separation_pair``."""
    scene = await _build_scene(db_session)
    a, b = _canonical_fact_pair(scene.layer_a_id, scene.layer_b_id)
    db_session.add(
        BodySeparationOrm(id=uuid7(), model_id=scene.model_id, layer_a_id=a, layer_b_id=b)
    )
    await db_session.flush()
    db_session.add(
        BodySeparationOrm(id=uuid7(), model_id=scene.model_id, layer_a_id=a, layer_b_id=b)
    )
    with pytest.raises(IntegrityError, match="uq_body_separation_pair"):
        await db_session.flush()


async def test_body_geometry_fact_canonical_order_rejected(db_session: AsyncSession) -> None:
    """A descending (a > b) pair violates ``ck_body_geometry_fact_canonical_order``."""
    scene = await _build_scene(db_session)
    a, b = _canonical_fact_pair(scene.layer_a_id, scene.layer_b_id)
    db_session.add(
        BodyGeometryFactOrm(id=uuid7(), model_id=scene.model_id, layer_a_id=b, layer_b_id=a)
    )
    with pytest.raises(IntegrityError, match="ck_body_geometry_fact_canonical_order"):
        await db_session.flush()


async def test_body_geometry_fact_pair_unique(db_session: AsyncSession) -> None:
    """Re-asserting the same geometry-fact pair violates ``uq_body_geometry_fact_pair``."""
    scene = await _build_scene(db_session)
    a, b = _canonical_fact_pair(scene.layer_a_id, scene.layer_b_id)
    db_session.add(
        BodyGeometryFactOrm(id=uuid7(), model_id=scene.model_id, layer_a_id=a, layer_b_id=b)
    )
    await db_session.flush()
    db_session.add(
        BodyGeometryFactOrm(id=uuid7(), model_id=scene.model_id, layer_a_id=a, layer_b_id=b)
    )
    with pytest.raises(IntegrityError, match="uq_body_geometry_fact_pair"):
        await db_session.flush()
