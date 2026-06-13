"""Integration tests for RecomputeLithoSolids built via the watertight loft.

Task 7 of the watertight-loft body builder (spec
``2026-06-12-watertight-loft-body-builder-design.md``).  These pin the wired
loft pipeline end to end against a real DB:

  LOFT-1  Watertight build — a model with two parallel sections, three tests
          each, accepted layers + approved correlation edges produces solid
          rows that are every one ``is_flagged=False`` with ``len(triangles)>0``
          (the union tiles by construction; no flagged disk markers).
  LOFT-2  Model-level checksum skip — a second ``execute`` with no input change
          (``force=False``) skips the whole rebuild: ``bodies_skipped_checksum``
          equals ``bodies_considered`` and ``bodies_built == 0``.
  LOFT-3  Geometry edit rebuilds — mutating one accepted layer's depth busts the
          model digest, so the next ``execute`` rebuilds (``bodies_built > 0``).
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.recompute_litho_solids import RecomputeLithoSolids
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
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

# ---------------------------------------------------------------------------
# Builder helpers
# ---------------------------------------------------------------------------


def _borehole(
    project_id: UUID, *, suffix: str, x: float, y: float, elev: float = 5.0
) -> BoreholeOrm:
    """Unsaved borehole with valid (x, y, elevation_m) so picks are loadable."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-LOFT-{suffix}",
        app_project_id=project_id,
        project_id="LOFT",
        test_id=f"BH-LOFT-{suffix}",
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
) -> LithoLayerOrm:
    """Unsaved accepted ``LithoLayerOrm`` anchored to *borehole*."""
    return LithoLayerOrm(
        id=uuid7(),
        model_id=model.id,
        formation_id=formation.id,
        borehole_id=borehole.id,
        depth_top_m=top,
        depth_base_m=base,
        status="accepted",
        source="manual",
        confidence="medium",
    )


def _edge(
    model: GeologicalModelOrm,
    layer_a: LithoLayerOrm,
    layer_b: LithoLayerOrm,
    section_id: UUID,
) -> LithoContactCorrelationEdgeOrm:
    """Approved correlation edge between two layers (canonical a < b)."""
    a, b = sorted([layer_a.id, layer_b.id])
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        section_id=section_id,
        contact_a_id=a,
        contact_b_id=b,
        source="manual",
        user_approved=True,
    )


def _section(
    project_id: UUID, *, name: str, sx: float, sy: float, ex: float, ey: float
) -> CrossSectionOrm:
    """Unsaved cross-section line with a generous projection buffer."""
    return CrossSectionOrm(
        id=uuid7(),
        app_project_id=project_id,
        name=name,
        start_x=sx,
        start_y=sy,
        end_x=ex,
        end_y=ey,
        epsg=31370,
        projection_buffer_m=200.0,
    )


# ---------------------------------------------------------------------------
# Scene: two parallel sections, three tests each, one correlated band per section
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def loft_scene(db_session: AsyncSession):
    """Project + litho model + 6 tests on 2 parallel sections + edges.

    Layout (Lambert72-ish metres):

        Section S1 (y = 200000): A(150000) — B(150100) — C(150200)
        Section S2 (y = 200100): D(150000) — E(150100) — F(150200)

    Every test carries ONE accepted ZAND layer (2 → 8 m).  On each section the
    three columns are correlated A↔B↔C and D↔E↔F (one connected band per
    section); the two sections share no edges, so the loft interpolates the band
    BETWEEN them.  Non-collinear (two distinct y rows) so the model domain's
    alpha hull + deep base triangulate.

    Returns a dict: project, litho, formation, layers (by suffix), sections.
    """
    proj = ProjectOrm(id=uuid7(), name="LOFT test", status="active")
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

    formation = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND",
        color="#f5deb3",
        display_order=1,
        litho_main_soil_code="ZAND",
    )
    db_session.add(formation)
    await db_session.flush()

    # Two parallel sections.
    s1 = _section(proj.id, name="S1", sx=149900.0, sy=200000.0, ex=150300.0, ey=200000.0)
    s2 = _section(proj.id, name="S2", sx=149900.0, sy=200100.0, ex=150300.0, ey=200100.0)
    db_session.add_all([s1, s2])
    await db_session.flush()

    # Tests: three on each section line.
    bh = {
        "A": _borehole(proj.id, suffix="A", x=150000.0, y=200000.0, elev=5.0),
        "B": _borehole(proj.id, suffix="B", x=150100.0, y=200000.0, elev=4.9),
        "C": _borehole(proj.id, suffix="C", x=150200.0, y=200000.0, elev=5.1),
        "D": _borehole(proj.id, suffix="D", x=150000.0, y=200100.0, elev=5.0),
        "E": _borehole(proj.id, suffix="E", x=150100.0, y=200100.0, elev=4.8),
        "F": _borehole(proj.id, suffix="F", x=150200.0, y=200100.0, elev=5.2),
    }
    db_session.add_all(list(bh.values()))
    await db_session.flush()

    layers = {k: _layer(litho, formation, v, top=2.0, base=8.0) for k, v in bh.items()}
    db_session.add_all(list(layers.values()))
    await db_session.flush()

    # One connected band per section.
    db_session.add_all(
        [
            _edge(litho, layers["A"], layers["B"], s1.id),
            _edge(litho, layers["B"], layers["C"], s1.id),
            _edge(litho, layers["D"], layers["E"], s2.id),
            _edge(litho, layers["E"], layers["F"], s2.id),
        ]
    )
    await db_session.commit()

    return {
        "project": proj,
        "litho": litho,
        "formation": formation,
        "layers": layers,
        "sections": [s1, s2],
    }


# ---------------------------------------------------------------------------
# LOFT-1: watertight build — every solid non-flagged with triangles
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_loft_builds_watertight_solids(
    db_session: AsyncSession,
    loft_scene: dict,
) -> None:
    """Two parallel sections + correlated bands must loft into real solids.

    Every persisted row is ``is_flagged=False`` with ``len(triangles) > 0`` —
    the loft tiles by construction, so there are no flagged disk-marker bodies.
    """
    litho = loft_scene["litho"]

    outcome = await RecomputeLithoSolids(db_session).execute(litho.id, force=True)

    assert outcome.bodies_built >= 1, (
        f"Expected ≥1 body built via the loft; got {outcome.bodies_built}"
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
    assert rows, "The loft must persist at least one solid row"
    for solid in rows:
        assert solid.is_flagged is False, (
            f"Loft solid {solid.body_id} must be watertight (not flagged); "
            f"the loft tiles by construction"
        )
        assert len(solid.triangles) > 0, f"Loft solid {solid.body_id} must have triangles"
        assert len(solid.vertices) > 0, f"Loft solid {solid.body_id} must have vertices"
        assert solid.is_stale is False, "A freshly built solid must not be stale"
        assert solid.method == "loft", "The loft path stamps method='loft'"


# ---------------------------------------------------------------------------
# LOFT-2: model-level checksum skip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_second_execute_skips_whole_model_on_unchanged_inputs(
    db_session: AsyncSession,
    loft_scene: dict,
) -> None:
    """A second ``execute`` with no input change skips the whole model.

    The loft is global, so the skip is all-or-nothing:
    ``bodies_skipped_checksum == bodies_considered`` and ``bodies_built == 0``.
    """
    litho = loft_scene["litho"]

    # First build (force so the digest is written).
    first = await RecomputeLithoSolids(db_session).execute(litho.id, force=True)
    assert first.bodies_built >= 1

    # Second build WITHOUT force — the model digest matches, so skip everything.
    second = await RecomputeLithoSolids(db_session).execute(litho.id, force=False)

    assert second.bodies_built == 0, (
        f"Unchanged inputs must not rebuild; got bodies_built={second.bodies_built}"
    )
    assert second.bodies_considered >= 1
    assert second.bodies_skipped_checksum == second.bodies_considered, (
        "The whole model must be skipped when the digest is unchanged; got "
        f"skipped={second.bodies_skipped_checksum} considered={second.bodies_considered}"
    )


# ---------------------------------------------------------------------------
# LOFT-3: geometry edit busts the digest → rebuild
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_layer_depth_edit_busts_digest_and_rebuilds(
    db_session: AsyncSession,
    loft_scene: dict,
) -> None:
    """Mutating one accepted layer's depth must rebuild on the next execute.

    The model-level digest folds in every pick's geometry, so a depth change
    busts it even with ``force=False``.
    """
    litho = loft_scene["litho"]
    layers = loft_scene["layers"]

    # Build once.
    await RecomputeLithoSolids(db_session).execute(litho.id, force=True)

    # Sanity: a no-change re-execute skips (precondition for the rebuild claim).
    skip = await RecomputeLithoSolids(db_session).execute(litho.id, force=False)
    assert skip.bodies_built == 0, "Precondition: unchanged inputs skip"

    # Move one layer's TOP deeper — directly on the row, bypassing the stale
    # cascade so the test isolates the DIGEST sensitivity (not the is_stale
    # path).  ``depth_top_m`` is edited (not base): the LL→FC mirror trigger
    # re-derives a layer's base from the next contact / total_depth, so a base
    # edit on a single-layer column would be reverted — a top edit sticks.
    target = await db_session.get(LithoLayerOrm, layers["B"].id)
    assert target is not None
    target.depth_top_m = 3.0
    await db_session.commit()

    rebuilt = await RecomputeLithoSolids(db_session).execute(litho.id, force=False)
    assert rebuilt.bodies_built > 0, (
        "A geometry change must bust the model digest and rebuild without force; "
        f"got bodies_built={rebuilt.bodies_built}"
    )
