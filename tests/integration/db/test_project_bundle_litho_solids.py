"""Integration tests for litho body solids in the .strix bundle round-trip.

These pin that a project carrying BUILT ``litho_body_solid`` rows serialises
them into the bundle under a top-level ``litho_solids`` array, and that a
fresh restore materialises the rows back byte-for-byte — so a freshly-opened
.strix can export geometry without paying the rebuild cost.

The scene seeds ``litho_body_solid`` rows directly (method ``voxel``) — the
bundle round-trip is the feature under test, not the builder; the voxel
build path has its own end-to-end coverage in ``test_build_voxel.py``.

Requires the Docker DB on localhost:5433 (run via
``scripts/run-integration-tests.ps1``).
"""

from __future__ import annotations

from uuid import UUID

import pytest_asyncio
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.cross_section_orm import CrossSectionOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import (
    GeologicalFormationOrm,
)
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_bundle import (
    build_project_bundle,
    restore_project_bundle,
)


def _solid(
    model_id: UUID,
    formation_id: UUID,
    *,
    z: float,
    checksum: bytes,
) -> LithoBodySolidOrm:
    """Unsaved cached solid row with a small distinct mesh at elevation ``z``."""
    return LithoBodySolidOrm(
        id=uuid7(),
        model_id=model_id,
        body_id=uuid7(),  # body_id is intentionally NOT an FK — any UUID rides
        formation_id=formation_id,
        method="voxel",
        vertices=[
            [150000.0, 200000.0, z],
            [150010.0, 200000.0, z],
            [150005.0, 200010.0, z],
            [150005.0, 200005.0, z - 2.0],
        ],
        triangles=[[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]],
        source_pick_count=3,
        source_pick_checksum=checksum,
        is_stale=False,
        is_flagged=False,
    )


@pytest_asyncio.fixture
async def built_solid_scene(db_session: AsyncSession) -> dict:
    """Project + litho model + two formations, with two seeded solid rows.

    The two ``litho_body_solid`` rows carry distinct meshes + checksums so
    the round-trip assertions can tell the rows apart byte-for-byte.
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

    zand = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="ZAND",
        color="#f5deb3",
        display_order=1,
        litho_main_soil_code="ZAND",
    )
    klei = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="KLEI",
        color="#a0785a",
        display_order=2,
        litho_main_soil_code="KLEI",
    )
    db_session.add_all([zand, klei])
    await db_session.flush()

    db_session.add_all(
        [
            _solid(litho.id, zand.id, z=5.0, checksum=b"\x01" * 16),
            _solid(litho.id, klei.id, z=1.0, checksum=b"\x02" * 16),
        ]
    )
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


async def test_bundle_omits_litho_solids_when_excluded(
    db_session: AsyncSession, built_solid_scene: dict
) -> None:
    """``include_solids=False`` emits an empty ``litho_solids`` despite built rows.

    Backs the File → Save fast-path: the .strix file never stores the meshes
    and nothing in the client reads them from the bundle, so the desktop
    fetches the bundle WITHOUT the ~10 MB of vertices/triangles. The key must
    still be present (an empty list) so the response model + file builder see
    a consistent shape.
    """
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

    bundle = await build_project_bundle(db_session, project, include_solids=False)

    assert "litho_solids" in bundle, "The key must still be present (consistent shape)"
    assert bundle["litho_solids"] == [], "Excluded solids must serialise to an empty list"


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
