r"""Integration tests for ``RecomputeLithoSolids`` built via the implicit strat field.

These pin Task-8's wiring of the use case to the implicit-stratigraphic builder
(spec ``2026-06-13-implicit-stratigraphic-3d-builder-design.md``).  The seed is an
INTERBEDDED litho model (repeated lithology ZAND/KLEI/ZAND) correlated across
three non-collinear investigations, so the resolver produces multi-investigation
bodies and the strat field must reproduce the interbedded stack.

Cases
-----
RSS-1  Happy path — every persisted ``litho_body_solid`` row is
       ``is_flagged=False`` with non-empty vertices + triangles, the built model
       passes ``assert_model_matches_columns`` at the authored test columns (the
       anti-loft no-overlap + correct-order invariant), AND coverage holds (≥1
       body, every authored column covered) so "built nothing" cannot read as a
       vacuous pass.
RSS-2  Checksum skip — a second ``execute`` (no ``force``) with unchanged picks
       skips the rebuild (``bodies_skipped_checksum`` ≥ 1, ``bodies_built`` == 0).
RSS-3  Grid-pref change rebuilds — bumping ``strat_grid_spacing_m`` in the
       project view-state busts the checksum and forces a rebuild.

Run via the wrapper:
    .\scripts\run-integration-tests.ps1 tests/integration/api/test_recompute_strat_solids.py
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
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.litho_layer_orm import LithoLayerOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# The Task-7 section-column diff helper (the anti-loft assertion).
from tests.unit.domain.services.strat_field.strat_invariants import (
    AuthoredColumn,
    AuthoredUnit,
    assert_model_matches_columns,
)

# ---------------------------------------------------------------------------
# Seed builders
# ---------------------------------------------------------------------------


def _borehole(project_id: UUID, *, suffix: str, x: float, y: float, total_depth_m: float):
    """Borehole with a surface at 0 m (so elevation = -depth) + valid coords."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-RSS-{suffix}",
        app_project_id=project_id,
        project_id="RSS",
        test_id=f"BH-RSS-{suffix}",
        location_x=x,
        location_y=y,
        elevation_m=0.0,
        epsg=31370,
        total_depth_m=total_depth_m,
    )


def _layer(
    model: GeologicalModelOrm,
    formation: GeologicalFormationOrm,
    borehole: BoreholeOrm,
    *,
    top: float,
    base: float,
):
    """Accepted ``LithoLayerOrm`` anchored to *borehole*."""
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


def _edge(model: GeologicalModelOrm, a: LithoLayerOrm, b: LithoLayerOrm, section_id: UUID):
    """Approved correlation edge between two same-lithology layers."""
    return LithoContactCorrelationEdgeOrm(
        id=uuid7(),
        model_id=model.id,
        section_id=section_id,
        contact_a_id=a.id,
        contact_b_id=b.id,
        source="manual",
        user_approved=True,
    )


async def _seed_section(db_session: AsyncSession, project_id: UUID) -> UUID:
    """Insert a minimal cross-section (the correlation-edge FK requires one)."""
    sec = CrossSectionOrm(
        id=uuid7(),
        app_project_id=project_id,
        name="S-RSS",
        start_x=-100.0,
        start_y=0.0,
        end_x=200.0,
        end_y=0.0,
        epsg=31370,
        projection_buffer_m=200.0,
    )
    db_session.add(sec)
    await db_session.flush()
    return sec.id


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession):
    """Project + geo + litho model + ZAND/KLEI formations.

    Returns a dict with keys: project, litho, zand, klei.
    """
    proj = ProjectOrm(id=uuid7(), name="RSS test", status="active")
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

    zand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND",
        color="#f5deb3",
        display_order=0,
        litho_main_soil_code="ZAND",
    )
    klei = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="KLEI",
        color="#a0785a",
        display_order=1,
        litho_main_soil_code="KLEI",
    )
    db_session.add_all([zand, klei])
    await db_session.commit()

    return {"project": proj, "litho": litho, "zand": zand, "klei": klei}


# ---------------------------------------------------------------------------
# Interbedded seed: ZAND / KLEI / ZAND across 3 non-collinear boreholes
# ---------------------------------------------------------------------------


async def _seed_interbedded(db_session: AsyncSession, scene: dict):
    """Seed an interbedded ZAND/KLEI/ZAND stack across 3 non-collinear boreholes.

    Each borehole carries three accepted layers correlated to its peers, so the
    resolver produces three multi-investigation bodies (one ZAND-top, one KLEI,
    one ZAND-bottom).  The FC↔LL mirror trigger re-derives each non-last layer's
    base from the next contact and the LAST layer's base from ``total_depth_m``,
    so contacts at 0/3/6 m with ``total_depth_m=9`` yield layers 0-3 / 3-6 / 6-9.

    Returns the authored columns (for ``assert_model_matches_columns``).
    """
    proj = scene["project"]
    litho = scene["litho"]
    zand = scene["zand"]
    klei = scene["klei"]
    section_id = await _seed_section(db_session, proj.id)

    # Densely-spaced (~8 m) non-collinear investigations — the v1 RBF is
    # well-constrained between closely-spaced columns; widely-spaced picks
    # (hundreds of m) make the field extrapolate / bubble (the documented
    # Stage-3 limitation, see fixtures._build_strat_columns).  This is the same
    # compact configuration the full-pipeline unit fixture uses.
    coords = [("A", 0.0, 0.0), ("B", 8.0, 0.0), ("C", 4.0, 8.0)]
    boreholes = [_borehole(proj.id, suffix=s, x=x, y=y, total_depth_m=9.0) for s, x, y in coords]
    db_session.add_all(boreholes)
    await db_session.flush()

    # Three layers per borehole: ZAND 0-3, KLEI 3-6, ZAND 6-9.
    top_layers: list[LithoLayerOrm] = []
    mid_layers: list[LithoLayerOrm] = []
    bot_layers: list[LithoLayerOrm] = []
    for bh in boreholes:
        lt = _layer(litho, zand, bh, top=0.0, base=3.0)
        lm = _layer(litho, klei, bh, top=3.0, base=6.0)
        lb = _layer(litho, zand, bh, top=6.0, base=9.0)
        top_layers.append(lt)
        mid_layers.append(lm)
        bot_layers.append(lb)
    db_session.add_all(top_layers + mid_layers + bot_layers)
    await db_session.flush()

    # Correlate each layer A↔B and B↔C so the resolver makes one body per level.
    edges = []
    for level in (top_layers, mid_layers, bot_layers):
        edges.append(_edge(litho, level[0], level[1], section_id))
        edges.append(_edge(litho, level[1], level[2], section_id))
    db_session.add_all(edges)
    await db_session.commit()

    # Authored columns: surface at 0 m → elevations are negative depths.
    columns = [
        AuthoredColumn(
            x=x,
            y=y,
            units=(
                AuthoredUnit(formation_id=str(zand.id), top_elev_m=0.0, base_elev_m=-3.0),
                AuthoredUnit(formation_id=str(klei.id), top_elev_m=-3.0, base_elev_m=-6.0),
                AuthoredUnit(formation_id=str(zand.id), top_elev_m=-6.0, base_elev_m=-9.0),
            ),
        )
        for _s, x, y in coords
    ]
    return columns


# ---------------------------------------------------------------------------
# RSS-1: happy path — real watertight solids, no overlaps, coverage
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_interbedded_model_builds_watertight_no_overlap(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """The interbedded model builds real solids that reproduce the authored columns.

    The strat field is fit from ALL picks (no section-presence flagging on the
    strat path), so every persisted row must be a real, non-flagged solid; and
    the section-column diff (the test that would have caught the loft's 50-metre
    overlaps) must pass at every authored column with coverage.
    """
    columns = await _seed_interbedded(db_session, scene)
    litho = scene["litho"]

    outcome = await RecomputeLithoSolids(db_session).execute(litho.id, force=True)

    assert outcome.bodies_built >= 1, (
        f"Expected ≥1 body built; got bodies_built={outcome.bodies_built}"
    )
    # Strat path never flags on the happy path (no section-presence limitation).
    assert outcome.bodies_flagged == 0, (
        f"Strat path must not flag a conformable model; got {outcome.bodies_flagged}"
    )
    # Geology bounding is OUT of the litho model — no marked tests.
    assert outcome.marked_test_ids == [], (
        f"Strat path drops geology bounding; got {outcome.marked_test_ids}"
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
    assert rows, "Build must persist at least one solid row"

    # Every persisted row is a real watertight solid.
    for solid in rows:
        assert solid.is_flagged is False, f"Solid {solid.body_id} must not be flagged"
        assert len(solid.vertices) > 0, f"Solid {solid.body_id} must have vertices"
        assert len(solid.triangles) > 0, f"Solid {solid.body_id} must have triangles"
        assert solid.is_stale is False, f"Solid {solid.body_id} must be fresh"

    # Build duck-typed mesh objects for the section-column diff.
    meshes = [
        _MeshView(
            body_id=str(s.body_id),
            formation_id=str(s.formation_id),
            vertices=[tuple(v) for v in s.vertices],
            triangles=[tuple(t) for t in s.triangles],
        )
        for s in rows
    ]

    # The anti-loft assertion: no overlaps + correct formation order + base
    # elevations within tolerance at every authored column.  The grid spacing is
    # 1 m so a generous tolerance absorbs the height-field discretisation.
    assert_model_matches_columns(meshes, columns, tol_m=1.5)

    # Coverage: every authored column must be covered by ≥1 body interval, so a
    # "built nothing" outcome cannot read as a vacuous diff pass.
    from tests.unit.domain.services.strat_field.strat_invariants import vertical_ray_intervals

    for col in columns:
        hit = any(vertical_ray_intervals(m.vertices, m.triangles, col.x, col.y) for m in meshes)
        assert hit, f"Authored column ({col.x}, {col.y}) is not covered by any built body"


# ---------------------------------------------------------------------------
# RSS-2: checksum skip on unchanged picks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_second_execute_skips_when_unchanged(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """A second execute (no force) with unchanged picks skips the rebuild."""
    await _seed_interbedded(db_session, scene)
    litho = scene["litho"]

    first = await RecomputeLithoSolids(db_session).execute(litho.id, force=True)
    assert first.bodies_built >= 1, "First build must produce solids"

    second = await RecomputeLithoSolids(db_session).execute(litho.id)
    assert second.bodies_built == 0, (
        f"Unchanged picks must skip rebuild; got bodies_built={second.bodies_built}"
    )
    assert second.bodies_skipped_checksum >= 1, (
        f"Expected ≥1 checksum skip; got {second.bodies_skipped_checksum}"
    )


# ---------------------------------------------------------------------------
# RSS-3: grid-spacing pref change forces a rebuild
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_grid_pref_change_forces_rebuild(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """Bumping ``strat_grid_spacing_m`` busts the checksum → a rebuild fires."""
    await _seed_interbedded(db_session, scene)
    proj = scene["project"]
    litho = scene["litho"]

    first = await RecomputeLithoSolids(db_session).execute(litho.id, force=True)
    assert first.bodies_built >= 1

    # A no-change second pass would skip — confirm that first.
    skip = await RecomputeLithoSolids(db_session).execute(litho.id)
    assert skip.bodies_built == 0, "Precondition: unchanged picks skip"

    # Bump the grid-spacing pref in the project view-state.
    project = await db_session.get(ProjectOrm, proj.id)
    assert project is not None
    view_state = dict(project.view_state or {})
    seg = dict(view_state.get("litho_segmenter") or {})
    seg["strat_grid_spacing_m"] = 2.0
    view_state["litho_segmenter"] = seg
    project.view_state = view_state
    await db_session.commit()

    rebuilt = await RecomputeLithoSolids(db_session).execute(litho.id)
    assert rebuilt.bodies_built >= 1, (
        f"Grid-spacing change must force a rebuild; got bodies_built={rebuilt.bodies_built}"
    )
    assert rebuilt.bodies_skipped_checksum == 0, "A busted checksum must not skip any body"


# ---------------------------------------------------------------------------
# Duck-typed mesh view for the section-column diff helper
# ---------------------------------------------------------------------------


class _MeshView:
    """Minimal ``body_id`` / ``formation_id`` / ``vertices`` / ``triangles`` view.

    The Task-7 invariant helpers duck-type on these four attributes; the
    persisted JSONB rows are read back into this so the diff runs against the
    ACTUAL stored geometry (the round-trip the 3-D viewer / exporter consume).
    """

    def __init__(
        self,
        body_id: str,
        formation_id: str,
        vertices: list[tuple[float, float, float]],
        triangles: list[tuple[int, int, int]],
    ) -> None:
        self.body_id = body_id
        self.formation_id = formation_id
        self.vertices = vertices
        self.triangles = triangles
