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
    silt = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="SILT",
        color="#c2b280",
        display_order=2,
        litho_main_soil_code="SILT",
    )
    db_session.add_all([zand, klei, silt])
    await db_session.commit()

    return {"project": proj, "litho": litho, "zand": zand, "klei": klei, "silt": silt}


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
# Enclosed-lens seed: KLEI / SILT / KLEI with both KLEIs in ONE body
# ---------------------------------------------------------------------------


async def _seed_enclosed_lens(db_session: AsyncSession, scene: dict):
    """Seed a KLEI/SILT/KLEI enclosed-lens stack across 3 non-collinear boreholes.

    The over-merge signature from ``test.strix``: the host KLEI is recorded BOTH
    above AND below the SILT minority under ONE ``body_id``.  Achieved by
    correlating each borehole's top KLEI directly to its OWN bottom KLEI (a
    vertical same-lithology edge) PLUS the usual horizontal peer edges, so the
    resolver's connected-components put all six KLEI layers in a single body that
    brackets the SILT.  A single global iso-order cannot place the bracketed SILT
    (``klei → silt`` above, ``silt → klei`` below = a 2-cycle), so the assembler
    classifies the SILT as a lens, orders only the KLEI matrix, and the carve step
    puts the SILT back as an enclosed lens prism.

    The SILT layers are correlated A↔B↔C horizontally so they collapse to one lens
    body (one ``lens:`` storage solid), not three.

    A ZAND cap (0-2 m) tops the stack so the MATRIX backbone (after the SILT is
    removed as a lens) has TWO instances — ZAND over KLEI — and therefore an
    internal ZAND/KLEI contact.  Without it the matrix would be KLEI-only (one
    instance, no internal horizon, no control point) and ``fit_potential_field``
    has nothing to interpolate.  The real ``test.strix`` matrix has ~96 instances,
    so an internal contact is the realistic case; the minimal seed mirrors it.

    Returns the authored columns (for ``assert_model_matches_columns``).
    """
    proj = scene["project"]
    litho = scene["litho"]
    zand = scene["zand"]
    klei = scene["klei"]
    silt = scene["silt"]
    section_id = await _seed_section(db_session, proj.id)

    # A TIGHT 4-hole cluster (4 m spacing) with a DEEP floor (12 m) — the sparse
    # cubic RBF dips a flat contact several metres between widely-spaced holes (the
    # documented Stage-3 limitation), which would swallow the 2 m lens band.  A
    # tight cluster keeps the matrix contact near its picks AT the lens footprint so
    # the lens carves cleanly; the deep KLEI floor leaves room below the lens for
    # the host-lower piece.  (Elevations still drift a few metres off the picks — a
    # pre-existing field-fit limit — so this case asserts ORDER + no-overlap +
    # coverage, NOT exact elevations; see the test.)
    coords = [("A", 0.0, 0.0), ("B", 4.0, 0.0), ("C", 0.0, 4.0), ("D", 4.0, 4.0)]
    boreholes = [_borehole(proj.id, suffix=s, x=x, y=y, total_depth_m=12.0) for s, x, y in coords]
    db_session.add_all(boreholes)
    await db_session.flush()

    # ZAND 0-2 (matrix cap), KLEI 2-4 (host above), SILT 4-6 (lens), KLEI 6-12
    # (host below) per borehole.
    cap_layers: list[LithoLayerOrm] = []
    top_layers: list[LithoLayerOrm] = []
    mid_layers: list[LithoLayerOrm] = []
    bot_layers: list[LithoLayerOrm] = []
    for bh in boreholes:
        cap_layers.append(_layer(litho, zand, bh, top=0.0, base=2.0))
        top_layers.append(_layer(litho, klei, bh, top=2.0, base=4.0))
        mid_layers.append(_layer(litho, silt, bh, top=4.0, base=6.0))
        bot_layers.append(_layer(litho, klei, bh, top=6.0, base=12.0))
    db_session.add_all(cap_layers + top_layers + mid_layers + bot_layers)
    await db_session.flush()

    edges = []
    # Horizontal peer edges chaining EVERY adjacent hole per level (A-B-C-D), so
    # each level collapses to ONE body across all four holes.
    for level in (cap_layers, top_layers, mid_layers, bot_layers):
        for a, b in zip(level, level[1:], strict=False):
            edges.append(_edge(litho, a, b, section_id))
    # Vertical top-KLEI ↔ bottom-KLEI per borehole — the over-merge: both KLEIs
    # join one resolver body that brackets the SILT (the test.strix signature).
    for t, b in zip(top_layers, bot_layers, strict=True):
        edges.append(_edge(litho, t, b, section_id))
    db_session.add_all(edges)
    await db_session.commit()

    # Authored stack (top→bottom): ZAND / KLEI / SILT / KLEI.  Elevations are the
    # AUTHORED ideal; the field-fit drifts them a few metres, so the test asserts
    # the ORDER of these formations + coverage, not the exact base elevations.
    columns = [
        AuthoredColumn(
            x=x,
            y=y,
            units=(
                AuthoredUnit(formation_id=str(zand.id), top_elev_m=0.0, base_elev_m=-2.0),
                AuthoredUnit(formation_id=str(klei.id), top_elev_m=-2.0, base_elev_m=-4.0),
                AuthoredUnit(formation_id=str(silt.id), top_elev_m=-4.0, base_elev_m=-6.0),
                AuthoredUnit(formation_id=str(klei.id), top_elev_m=-6.0, base_elev_m=-12.0),
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

        # Round-trip dtype invariant: JSONB always deserialises as list[list[number]].
        # Vertex coords must be floats; triangle indices must be ints.  A dtype slip
        # (e.g. numpy int64 sneaking into triangles) would make json.dumps write an
        # unserializable object and raise at upsert time — but catching it here as a
        # type assertion is cheaper than diagnosing a DB error.
        first_vert = solid.vertices[0]
        assert isinstance(first_vert, list), (
            f"Solid {solid.body_id}: JSONB vertices must deserialise as list[list], "
            f"got {type(first_vert)}"
        )
        assert all(isinstance(c, float) for c in first_vert), (
            f"Solid {solid.body_id}: vertex coords must be float, "
            f"got {[type(c).__name__ for c in first_vert]}"
        )
        first_tri = solid.triangles[0]
        assert isinstance(first_tri, list), (
            f"Solid {solid.body_id}: JSONB triangles must deserialise as list[list], "
            f"got {type(first_tri)}"
        )
        assert all(isinstance(i, int) for i in first_tri), (
            f"Solid {solid.body_id}: triangle indices must be int, "
            f"got {[type(i).__name__ for i in first_tri]}"
        )

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
# RSS-4: enclosed-lens model builds (matrix carved + lens prism present)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_enclosed_lens_model_builds_with_lens_solid(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """A KLEI/SILT/KLEI over-merge builds: matrix carved, lens prism persisted.

    The two KLEIs share one body that brackets the SILT (a 2-cycle on a single
    global iso-order).  The assembler classifies the SILT as a lens and orders
    only the KLEI matrix; Task 5b carves the SILT lens back into the host and
    merges the two host pieces under one ``body_id``.  This pins the whole wired
    path end to end: every solid real (not flagged), the lens body present with a
    ``lens:`` storage id, NO inter-body overlap (the watertight tiling), full
    coverage, the correct top→bottom formation ORDER (ZAND / KLEI / SILT / KLEI),
    then checksum skip + a pick-mutation rebuild.

    Why ORDER, not exact elevations: the sparse cubic RBF drifts the matrix
    contacts a few metres off the picks (the documented Stage-3 limit), so this
    case asserts the carved lens is present, enclosed (right order), and tiles
    without overlap — NOT the absolute base elevations (RSS-1 pins those on a
    conformable stack).
    """
    await _seed_enclosed_lens(db_session, scene)
    proj = scene["project"]
    litho = scene["litho"]

    # A finer grid (0.5 m) keeps the matrix contact near its picks at the lens
    # footprint so the 2 m lens carves cleanly (at 1 m the sparse-RBF dip can
    # swallow it).  Set on the project view-state the recompute reads.
    project = await db_session.get(ProjectOrm, proj.id)
    assert project is not None
    view_state = dict(project.view_state or {})
    seg = dict(view_state.get("litho_segmenter") or {})
    seg["strat_grid_spacing_m"] = 0.5
    view_state["litho_segmenter"] = seg
    project.view_state = view_state
    await db_session.commit()

    outcome = await RecomputeLithoSolids(db_session).execute(litho.id, force=True)

    # The over-merge is now BUILDABLE (the old single-iso-order would flag all).
    assert outcome.bodies_built >= 2, (
        f"Expected ≥2 bodies (KLEI host + SILT lens); got {outcome.bodies_built}"
    )
    assert outcome.bodies_flagged == 0, (
        f"Enclosed-lens model must build, not flag; got {outcome.bodies_flagged}"
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
    for solid in rows:
        assert solid.is_flagged is False, f"Solid {solid.body_id} must not be flagged"
        assert len(solid.vertices) > 0, f"Solid {solid.body_id} must have vertices"
        assert len(solid.triangles) > 0, f"Solid {solid.body_id} must have triangles"

    # The lens body has a solid: its synthetic ``lens:`` token maps to a storage
    # UUID via uuid5 — recompute that id and assert a row carries it.  (The carve
    # emits the lens prism with body_id ``lens:{host}:{tail}``.)
    from groundmodel.application.recompute_litho_solids import _storage_body_id
    from groundmodel.infrastructure.db.repositories.litho_layer_repository import (
        LithoLayerRepository,
    )

    picks = await LithoLayerRepository(db_session).load_body_picks(litho.id)
    zand = scene["zand"]
    klei = scene["klei"]
    silt = scene["silt"]
    klei_body_ids = {p.body_id for p in picks if p.formation_id == str(klei.id)}
    silt_body_ids = {p.body_id for p in picks if p.formation_id == str(silt.id)}
    # Over-merge: both KLEIs are ONE body; the SILT is ONE lens body.
    assert len(klei_body_ids) == 1, f"Both KLEIs must share one body; got {klei_body_ids}"
    assert len(silt_body_ids) == 1, f"SILT must be one correlated lens body; got {silt_body_ids}"
    host_body_id = next(iter(klei_body_ids))
    silt_body_id = next(iter(silt_body_ids))
    lens_token = f"lens:{host_body_id}:{silt_body_id[-6:]}"
    lens_storage_id = _storage_body_id(lens_token)
    persisted_ids = {str(r.body_id) for r in rows}
    assert str(lens_storage_id) in persisted_ids, (
        f"Lens solid {lens_token} (→ {lens_storage_id}) not persisted; have {persisted_ids}"
    )

    meshes = [
        _MeshView(
            body_id=str(s.body_id),
            formation_id=str(s.formation_id),
            vertices=[tuple(v) for v in s.vertices],
            triangles=[tuple(t) for t in s.triangles],
        )
        for s in rows
    ]

    from tests.unit.domain.services.strat_field.strat_invariants import (
        _is_subsequence,
        assert_no_overlap_sampled,
        vertical_ray_intervals,
    )

    # (1) STRICT no inter-body overlap — the carve must tile host/lens with no
    # interpenetration (the anti-loft invariant).  Sample a grid of interior points
    # across the cluster footprint.
    samples = [(float(x), float(y)) for x in (1.0, 2.0, 3.0) for y in (1.0, 2.0, 3.0)]
    assert_no_overlap_sampled(meshes, samples)

    # (2) The carved column reads the authored ORDER top→bottom: ZAND / KLEI / SILT
    # / KLEI.  Recover the formation stack at the cluster centroid by ray-cast and
    # assert the authored sequence is a subsequence (the field-fit may thin a band
    # to nothing at a single column, but the lens must sit BETWEEN the two KLEIs).
    cx, cy = 2.0, 2.0  # centroid of the 0..4 m cluster
    stack: list[tuple[float, str]] = []
    for m in meshes:
        for base, top in vertical_ray_intervals(m.vertices, m.triangles, cx, cy):
            stack.append((top, m.formation_id))
    stack.sort(key=lambda e: -e[0])  # top → bottom
    formation_order = [fm for _top, fm in stack]
    authored = [str(zand.id), str(klei.id), str(silt.id), str(klei.id)]
    assert _is_subsequence(authored, formation_order), (
        f"Centroid stack {formation_order} is not the authored ZAND/KLEI/SILT/KLEI order; "
        f"the lens must sit enclosed between the two KLEIs"
    )

    # (3) Coverage — every interior sample is covered by ≥1 body, so a "built
    # nothing" outcome cannot read as a vacuous pass.  The authored columns sit on
    # the hull corners (no interior grid cell there, by the all-corners-inside cell
    # rule), so coverage is checked at the interior samples, not the corner holes.
    for sx, sy in samples:
        hit = any(vertical_ray_intervals(m.vertices, m.triangles, sx, sy) for m in meshes)
        assert hit, f"Interior sample ({sx}, {sy}) is not covered by any built body"

    # Unchanged picks → checksum skip.
    skip = await RecomputeLithoSolids(db_session).execute(litho.id)
    assert skip.bodies_built == 0, f"Unchanged picks must skip; got {skip.bodies_built}"
    assert skip.bodies_skipped_checksum >= 1

    # Mutate a pick's geometry (nudge borehole B's location) → the pick digest
    # changes → a rebuild fires.  Nudging the x stays non-collinear with A and C
    # so the domain is still buildable.  (Mutating a layer's depth_base directly
    # would be re-derived by the FC↔LL contiguity trigger; moving the borehole is
    # a clean pick-geometry change the trigger does not touch.)
    bh_b = (
        (await db_session.execute(select(BoreholeOrm).where(BoreholeOrm.name == "BH-RSS-B")))
        .scalars()
        .one()
    )
    bh_b.location_x = bh_b.location_x + 1.0
    await db_session.commit()
    rebuilt = await RecomputeLithoSolids(db_session).execute(litho.id)
    assert rebuilt.bodies_built >= 1, (
        f"A pick mutation must force a rebuild; got {rebuilt.bodies_built}"
    )
    assert rebuilt.bodies_skipped_checksum == 0, "A busted checksum must not skip any body"


# ---------------------------------------------------------------------------
# RSS-5: batch-upsert PK stability — rebuild preserves existing row ids
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rebuild_preserves_solid_primary_keys(
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """A forced rebuild with unchanged picks must reuse the SAME row ids.

    The batched multi-row upsert uses ``ON CONFLICT (model_id, body_id) DO
    UPDATE`` on the unique constraint — the UPDATE path leaves the existing
    row's primary key (``id``) untouched even though a fresh ``uuid7()`` is
    proposed in the ``VALUES`` clause (that proposed ``id`` is discarded on
    conflict).  This test pins that invariant: a second ``force=True`` rebuild
    must produce rows with identical UUIDs to the first build, so foreign
    references (e.g. 3-D viewer caches) remain stable across rebuilds.
    """
    await _seed_interbedded(db_session, scene)
    litho = scene["litho"]

    # First build — persist initial solid rows.
    first = await RecomputeLithoSolids(db_session).execute(litho.id, force=True)
    assert first.bodies_built >= 1, "First build must produce solids"

    rows_after_first = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    # Record the (body_id → row id) mapping from the first build.
    ids_by_body_after_first = {str(r.body_id): r.id for r in rows_after_first}
    assert ids_by_body_after_first, "Must have at least one solid row after first build"

    # Second force-rebuild with the SAME picks — the conflict path fires for
    # every existing row and the row ids must remain identical.
    second = await RecomputeLithoSolids(db_session).execute(litho.id, force=True)
    assert second.bodies_built >= 1, "Force rebuild must re-upsert solids"

    rows_after_second = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    ids_by_body_after_second = {str(r.body_id): r.id for r in rows_after_second}

    # Same set of body_ids persisted both times.
    assert set(ids_by_body_after_first) == set(ids_by_body_after_second), (
        "Rebuild must produce the same set of body_ids as the first build; "
        f"first={set(ids_by_body_after_first)} second={set(ids_by_body_after_second)}"
    )
    # EACH body's row id is identical — the ON CONFLICT UPDATE path kept the PK.
    for body_id_str, row_id in ids_by_body_after_first.items():
        assert ids_by_body_after_second[body_id_str] == row_id, (
            f"body_id={body_id_str}: row id changed from {row_id} "
            f"to {ids_by_body_after_second[body_id_str]} on rebuild — "
            "the batched upsert must NOT replace PKs on conflict"
        )

    # Sanity: row count matches the built-mesh count.
    assert len(rows_after_second) == second.bodies_built, (
        f"Row count {len(rows_after_second)} must match bodies_built={second.bodies_built}"
    )

    # Confirm the checksum-skip path still works after a force rebuild (the
    # stored digest equals the current digest → no-op on the next non-force pass).
    skip = await RecomputeLithoSolids(db_session).execute(litho.id)
    assert skip.bodies_built == 0, (
        f"Non-force pass after force rebuild must skip; got bodies_built={skip.bodies_built}"
    )
    assert skip.bodies_skipped_checksum >= 1


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
