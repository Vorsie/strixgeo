"""Integration tests for litho body solids in the .strix bundle round-trip.

Task 9 of the watertight-loft body builder (spec
``2026-06-12-watertight-loft-body-builder-design.md`` §7). These pin that a
project carrying BUILT ``litho_body_solid`` rows serialises them into the
bundle under a top-level ``litho_solids`` array, and that a fresh restore
materialises the rows back byte-for-byte — so a freshly-opened .strix can
export geometry without paying the rebuild cost.

The scene mirrors ``test_recompute_litho_solids_loft``'s ``loft_scene``:
two parallel sections, three tests each, one correlated ZAND band per
section. ``RecomputeLithoSolids`` lofts that into real solids before the
bundle is taken, so the round-trip carries genuine watertight meshes.

Requires the Docker DB on localhost:5433 (run via
``scripts/run-integration-tests.ps1``).
"""

from __future__ import annotations

from uuid import UUID

import pytest_asyncio
from sqlalchemy import delete, select
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
from groundmodel.infrastructure.db.repositories.project_bundle import (
    build_project_bundle,
    restore_project_bundle,
)


def _borehole(
    project_id: UUID, *, suffix: str, x: float, y: float, elev: float = 5.0
) -> BoreholeOrm:
    """Unsaved borehole with valid (x, y, elevation_m) so picks are loadable."""
    return BoreholeOrm(
        id=uuid7(),
        name=f"BH-SOLID-{suffix}",
        app_project_id=project_id,
        project_id="SOLID",
        test_id=f"BH-SOLID-{suffix}",
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


@pytest_asyncio.fixture
async def built_solid_scene(db_session: AsyncSession) -> dict:
    """Project + litho model + 6 tests on 2 parallel sections, solids BUILT.

    Same layout as ``test_recompute_litho_solids_loft.loft_scene``; after the
    rows are committed ``RecomputeLithoSolids`` is run so the project carries
    real ``litho_body_solid`` rows ready to ride in the bundle.
    """
    proj = ProjectOrm(id=uuid7(), name="Solid bundle source", status="active")
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

    s1 = _section(proj.id, name="S1", sx=149900.0, sy=200000.0, ex=150300.0, ey=200000.0)
    s2 = _section(proj.id, name="S2", sx=149900.0, sy=200100.0, ex=150300.0, ey=200100.0)
    db_session.add_all([s1, s2])
    await db_session.flush()

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

    db_session.add_all(
        [
            _edge(litho, layers["A"], layers["B"], s1.id),
            _edge(litho, layers["B"], layers["C"], s1.id),
            _edge(litho, layers["D"], layers["E"], s2.id),
            _edge(litho, layers["E"], layers["F"], s2.id),
        ]
    )
    await db_session.commit()

    # Build the solids so the project carries real litho_body_solid rows.
    outcome = await RecomputeLithoSolids(db_session).execute(litho.id, force=True)
    assert outcome.bodies_built >= 1
    await db_session.commit()

    return {"project": proj, "litho": litho}


async def test_bundle_carries_litho_solids(
    db_session: AsyncSession, built_solid_scene: dict
) -> None:
    """GET /bundle serialises every litho_body_solid row under ``litho_solids``."""
    project = built_solid_scene["project"]
    litho = built_solid_scene["litho"]

    db_rows = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert db_rows, "Precondition: the scene must have built solids"

    bundle = await build_project_bundle(db_session, project)

    assert "litho_solids" in bundle, "Bundle must carry a top-level litho_solids array"
    assert len(bundle["litho_solids"]) == len(db_rows)

    by_id = {str(r.id): r for r in db_rows}
    for payload in bundle["litho_solids"]:
        src = by_id[payload["id"]]
        # Every load-bearing column rides along.
        assert payload["model_id"] == str(src.model_id)
        assert payload["body_id"] == str(src.body_id)
        assert payload["formation_id"] == str(src.formation_id)
        assert payload["method"] == src.method
        assert payload["is_stale"] == src.is_stale
        assert payload["is_flagged"] == src.is_flagged
        # JSONB mesh arrays pass through verbatim (compared as lists).
        assert [list(v) for v in payload["vertices"]] == [list(v) for v in src.vertices]
        assert [list(t) for t in payload["triangles"]] == [list(t) for t in src.triangles]
        # The bytes checksum serialises to a hex string.
        assert payload["source_pick_checksum"] == src.source_pick_checksum.hex()


async def test_restore_recreates_litho_solids(
    db_session: AsyncSession, built_solid_scene: dict
) -> None:
    """Bundle → wipe → restore round-trips litho_body_solid rows exactly."""
    project = built_solid_scene["project"]
    litho = built_solid_scene["litho"]
    project_id = project.id
    model_id = litho.id

    bundle = await build_project_bundle(db_session, project)

    # Snapshot the original solids for post-restore comparison.
    original = {
        str(r.id): {
            "model_id": r.model_id,
            "body_id": r.body_id,
            "formation_id": r.formation_id,
            "method": r.method,
            "vertices": [list(v) for v in r.vertices],
            "triangles": [list(t) for t in r.triangles],
            "is_stale": r.is_stale,
            "is_flagged": r.is_flagged,
            "checksum": r.source_pick_checksum,
        }
        for r in (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == model_id)
            )
        )
        .scalars()
        .all()
    }
    assert original, "Precondition: solids must exist before wipe"

    # Simulate a DB wipe. Deleting the geological models CASCADEs the
    # litho_body_solid rows (model_id FK is ON DELETE CASCADE); the
    # project_id scope columns are plain UUIDs (no cascade) so CPTs /
    # boreholes / sections / models are dropped explicitly.
    await db_session.execute(
        delete(GeologicalModelOrm).where(
            GeologicalModelOrm.app_project_id == project_id,
            GeologicalModelOrm.kind == "lithostratigraphic",
        )
    )
    await db_session.execute(
        delete(GeologicalModelOrm).where(
            GeologicalModelOrm.app_project_id == project_id,
            GeologicalModelOrm.kind == "geological",
        )
    )
    await db_session.execute(
        delete(GeologicalFormationOrm).where(GeologicalFormationOrm.app_project_id == project_id)
    )
    await db_session.execute(
        delete(CrossSectionOrm).where(CrossSectionOrm.app_project_id == project_id)
    )
    await db_session.execute(delete(BoreholeOrm).where(BoreholeOrm.app_project_id == project_id))
    await db_session.delete(project)
    await db_session.commit()
    db_session.expunge_all()

    # Confirm the solids are gone.
    gone = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == model_id)
            )
        )
        .scalars()
        .all()
    )
    assert not gone, "Wipe must remove the solids before restore"

    await restore_project_bundle(
        db_session,
        project_id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
        bundle["geological_formations"],
        bundle["geological_models"],
        bundle["cross_sections"],
        bundle["investigation_reviews"],
        geotechnical_units_payload=bundle["geotechnical_units"],
        bodies_payload=bundle["bodies"],
        formation_absences_payload=bundle["formation_absences"],
        litho_contact_correlation_edges_payload=bundle["litho_contact_correlation_edges"],
        body_boundary_shapes_payload=bundle["body_boundary_shapes"],
        body_boundary_nodes_payload=bundle["body_boundary_nodes"],
        litho_solids_payload=bundle["litho_solids"],
    )
    await db_session.commit()

    restored = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == model_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(restored) == len(original)
    for row in restored:
        want = original[str(row.id)]
        assert row.model_id == want["model_id"]
        assert row.body_id == want["body_id"]
        assert row.formation_id == want["formation_id"]
        assert row.method == want["method"]
        assert [list(v) for v in row.vertices] == want["vertices"]
        assert [list(t) for t in row.triangles] == want["triangles"]
        assert row.is_stale == want["is_stale"]
        assert row.is_flagged == want["is_flagged"]
        assert row.source_pick_checksum == want["checksum"]


async def test_restore_tolerates_bundle_without_litho_solids(
    db_session: AsyncSession,
) -> None:
    """A legacy bundle with no ``litho_solids`` key restores without KeyError."""
    proj = ProjectOrm(id=uuid7(), name="Legacy no-solids", status="active")
    db_session.add(proj)
    await db_session.commit()
    project_id = proj.id

    bundle = await build_project_bundle(db_session, proj)
    # Simulate an OLD file that predates the litho_solids field.
    bundle.pop("litho_solids", None)

    await db_session.delete(proj)
    await db_session.commit()
    db_session.expunge_all()

    # Restore through the public wrapper WITHOUT passing litho_solids — the
    # restore must default the missing payload to empty, never raise.
    restored = await restore_project_bundle(
        db_session,
        project_id,
        bundle["project"],
        bundle["cpts"],
        bundle["boreholes"],
    )
    await db_session.commit()
    assert restored.id == project_id
