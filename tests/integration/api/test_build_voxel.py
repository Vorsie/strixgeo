"""Integration tests for ``POST .../litho-solids/build-voxel`` (voxel litho builder).

These pin Task-6's wiring of the voxel pipeline
(``build_domain_from_sections`` → ``label_voxels`` → ``extract_body_solids`` →
``litho_body_solid`` upsert) into the application + API layer.  Unlike the strat
builder (``test_recompute_strat_solids.py``), the voxel build takes the
frontend's validated 2-D section partitions AS THE PAYLOAD — there are no DB
picks / correlation edges to seed; the section partitions are hand-authored in
the snake_case API shape and POSTed directly.

The seed is a small INTERBEDDED model: two cross-sections forming an L over
three non-collinear investigation columns (so the domain hull builds), each
section gap carrying a ZAND / KLEI / ZAND interbedded stack plus a SILT lens
that pinches inside the KLEI on one section — exactly the interfingering the
implicit field could not represent and the voxel labelling can.

Cases
-----
BV-1  Happy path — every persisted ``litho_body_solid`` row is
      ``is_flagged=False`` with non-empty vertices + triangles + ``method='voxel'``;
      no two bodies overlap over a footprint sample; the per-section partition is
      reproduced (sample a region's interior ``(x, y, z)``, ray-cast the built
      solids, confirm the covering body's formation matches the payload region).
BV-2  Checksum skip — a second build with ``force=false`` and the unchanged
      payload skips the rebuild (``bodies_built=0``, ``bodies_skipped_checksum>0``).
BV-3  Payload mutation rebuilds — changing a region's lithology (a real partition
      change) with ``force=false`` busts the checksum and forces a rebuild.
BV-4  Scope guard — a model in another project 404s.
BV-5  Anisotropic spacing — a payload with ``horizontal_spacing_m`` ≠
      ``vertical_spacing_m`` (coarse X/Y, fine Z) builds real watertight,
      non-flagged ``method='voxel'`` solids (the thin-layer path).

Run via the wrapper:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_build_voxel.py
"""

from __future__ import annotations

import copy
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from tests.unit.domain.services.voxel_litho.strat_invariants import (
    assert_no_overlap_sampled,
    vertical_ray_intervals,
)

# ---------------------------------------------------------------------------
# Scene seed: project + geo + litho model + ZAND / KLEI / SILT formations
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def scene(db_session: AsyncSession) -> dict:
    """Project + geological + lithostratigraphic model + 3 formations.

    Returns a dict with keys: project, geo, litho, zand, klei, silt.  The
    formations are real ``geological_formation`` rows because
    ``litho_body_solid.formation_id`` is an FK (``body_id`` is NOT, so the
    payload's body ids can be arbitrary UUIDs).
    """
    proj = ProjectOrm(id=uuid7(), name="BV test", status="active")
    db_session.add(proj)
    await db_session.flush()

    geo = GeologicalModelOrm(id=uuid7(), app_project_id=proj.id, name="Geo", kind="geological")
    litho = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=proj.id,
        name="Litho",
        kind="lithostratigraphic",
        parent_model_id=geo.id,
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

    return {"project": proj, "geo": geo, "litho": litho, "zand": zand, "klei": klei, "silt": silt}


# ---------------------------------------------------------------------------
# Hand-authored voxel payload (snake_case API shape)
# ---------------------------------------------------------------------------


def _full_gap_region(
    formation_id: str, body_id: str, top: float, base: float, gap_index: int = 0
) -> dict:
    """A full-width rectangular region spanning the gap from ``top`` to ``base``.

    The polygon is the gap-local ``(fraction, elevation)`` rectangle
    ``[(0, top), (1, top), (1, base), (0, base)]`` — a band that fills the whole
    column pair at this depth interval.
    """
    return {
        "formation_id": formation_id,
        "body_id": body_id,
        "polygon": [[0.0, top], [1.0, top], [1.0, base], [0.0, base]],
        "gap_index": gap_index,
    }


def _lens_region(
    formation_id: str, body_id: str, top: float, base: float, gap_index: int = 0
) -> dict:
    """A lens region pinching out within the gap (apex at the right column edge).

    A trapezoid that is full thickness at the left column and pinches to zero at
    fraction 1 — the interfingering shape the voxel labeller represents and the
    implicit field could not.
    """
    return {
        "formation_id": formation_id,
        "body_id": body_id,
        "polygon": [[0.0, top], [1.0, (top + base) / 2.0], [0.0, base]],
        "gap_index": gap_index,
    }


def _build_payload(scene: dict, *, grid_spacing_m: float = 1.0) -> dict:
    """Build a two-section interbedded + lens voxel payload over 3 columns.

    Three non-collinear investigation columns A/B/C (so the domain hull builds):

    * Section 0 (A→B): ZAND band (elev 0..-3), KLEI band (-3..-7), ZAND band
      (-7..-10), with a SILT LENS inside the KLEI band on this section.
    * Section 1 (B→C): the same ZAND / KLEI / ZAND interbedded stack (no lens),
      so the two sections share the KLEI + ZAND bodies and the SILT pinches out
      between them.

    Body ids are stable UUIDs per (lithology, level) so a body persists across
    sections; the SILT lens has its own body id present on one section only.
    """
    zand = str(scene["zand"].id)
    klei = str(scene["klei"].id)
    silt = str(scene["silt"].id)

    # Stable body ids per (lithology, level) — shared across sections so the
    # resolver-equivalent identity holds.
    b_zand_top = str(uuid4())
    b_klei = str(uuid4())
    b_zand_bot = str(uuid4())
    b_silt_lens = str(uuid4())

    # Three columns: A=(0,0), B=(20,0), C=(10,20) — non-collinear.
    col_a = {"investigation_id": str(uuid4()), "along_m": 0.0, "world_x": 0.0, "world_y": 0.0}
    col_b = {"investigation_id": str(uuid4()), "along_m": 20.0, "world_x": 20.0, "world_y": 0.0}
    col_c = {"investigation_id": str(uuid4()), "along_m": 22.4, "world_x": 10.0, "world_y": 20.0}

    section0 = {
        "start_x": 0.0,
        "start_y": 0.0,
        "end_x": 20.0,
        "end_y": 0.0,
        "columns": [col_a, col_b],
        "regions": [
            _full_gap_region(zand, b_zand_top, 0.0, -3.0),
            _full_gap_region(klei, b_klei, -3.0, -7.0),
            _lens_region(silt, b_silt_lens, -4.0, -6.0),
            _full_gap_region(zand, b_zand_bot, -7.0, -10.0),
        ],
    }
    section1 = {
        "start_x": 20.0,
        "start_y": 0.0,
        "end_x": 10.0,
        "end_y": 20.0,
        "columns": [col_b, col_c],
        "regions": [
            _full_gap_region(zand, b_zand_top, 0.0, -3.0),
            _full_gap_region(klei, b_klei, -3.0, -7.0),
            _full_gap_region(zand, b_zand_bot, -7.0, -10.0),
        ],
    }
    return {"sections": [section0, section1], "grid_spacing_m": grid_spacing_m}


def _url(project_id: UUID, model_id: UUID) -> str:
    """The build-voxel endpoint URL for a (project, model)."""
    return f"/projects/{project_id}/geology/models/{model_id}/litho-solids/build-voxel"


# ---------------------------------------------------------------------------
# BV-1: happy path — watertight solids, no overlap, partition reproduced
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_voxel_happy_path(
    async_client: AsyncClient,
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """A POST builds real watertight voxel solids that reproduce the partition.

    Every persisted row must be a real, non-flagged ``method='voxel'`` solid; no
    two bodies overlap; and a ray-cast of the built solids at a payload region's
    interior must read the SAME formation the payload region carries (the
    labelling-faithful-by-construction guarantee).
    """
    proj = scene["project"]
    litho = scene["litho"]
    payload = _build_payload(scene, grid_spacing_m=1.0)

    resp = await async_client.post(_url(proj.id, litho.id), json=payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["bodies_built"] >= 2, f"Expected ≥2 bodies built; got {body['bodies_built']}"
    assert body["bodies_flagged"] == 0, f"Voxel build must not flag; got {body['bodies_flagged']}"
    assert body["marked_test_ids"] == []
    assert len(body["solids"]) == body["bodies_built"], "Response solids must match bodies_built"

    # Every returned solid is a real watertight voxel solid.
    for solid in body["solids"]:
        assert solid["is_flagged"] is False
        assert solid["method"] == "voxel"
        assert len(solid["vertices"]) > 0
        assert len(solid["triangles"]) > 0
        assert solid["is_stale"] is False

    # The persisted rows match the response (DB is the source of truth).
    rows = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == body["bodies_built"]
    for row in rows:
        assert row.is_flagged is False
        assert row.method == "voxel"
        assert len(row.vertices) > 0 and len(row.triangles) > 0

    # Build duck-typed mesh views for the geometry invariants.
    meshes = [
        _MeshView(
            body_id=str(r.body_id),
            formation_id=str(r.formation_id),
            vertices=[tuple(v) for v in r.vertices],
            triangles=[tuple(t) for t in r.triangles],
        )
        for r in rows
    ]

    # (1) STRICT no inter-body overlap over a footprint sample — the watertight
    # tiling (the anti-overlap invariant the prior 3-D attempts failed).
    samples = [(float(x), float(y)) for x in (2.0, 8.0, 14.0) for y in (1.0, 5.0)]
    assert_no_overlap_sampled(meshes, samples)

    # (2) Partition reproduced: at the section-0 KLEI band interior the solids
    # must read the KLEI formation.  Sample on the A→B section line at the band's
    # mid elevation, away from the lens apex (fraction ~0.2 so the lens is thin
    # there but the KLEI host still dominates the broader band ray).
    klei_id = str(scene["klei"].id)
    # On the section-0 line (A=(0,0)→B=(20,0)) at fraction 0.85, world ≈ (17, 0):
    # past the lens taper, deep in the KLEI band (elev -6.5, below the lens base).
    wx, wy, wz = 17.0, 0.0, -6.5
    covering = _formation_covering(meshes, wx, wy, wz)
    assert covering == klei_id, (
        f"At ({wx},{wy},{wz}) the built solids must read KLEI ({klei_id}); got {covering}"
    )

    # (3) The SILT lens body is present (interfingering represented) — its
    # formation appears among the persisted rows.
    silt_id = str(scene["silt"].id)
    persisted_formations = {str(r.formation_id) for r in rows}
    assert silt_id in persisted_formations, (
        f"The SILT lens must persist a body; have formations {persisted_formations}"
    )


# ---------------------------------------------------------------------------
# BV-2: checksum skip on unchanged payload (force=false)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_voxel_checksum_skip_on_unchanged_payload(
    async_client: AsyncClient,
    scene: dict,
) -> None:
    """A second build (force=false) with the unchanged payload skips the rebuild.

    The endpoint defaults to ``force=true`` (on-click Build), so the checksum
    skip is exercised by passing ``?force=false`` explicitly on the second call.
    """
    proj = scene["project"]
    litho = scene["litho"]
    payload = _build_payload(scene, grid_spacing_m=1.0)

    first = await async_client.post(_url(proj.id, litho.id), json=payload)
    assert first.status_code == 200, first.text
    assert first.json()["bodies_built"] >= 2

    second = await async_client.post(
        _url(proj.id, litho.id), json=payload, params={"force": "false"}
    )
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["bodies_built"] == 0, (
        f"Unchanged payload (force=false) must skip; got bodies_built={body['bodies_built']}"
    )
    assert body["bodies_skipped_checksum"] >= 1, (
        f"Expected ≥1 checksum skip; got {body['bodies_skipped_checksum']}"
    )
    # The skip still returns the full solid list (no round-trip needed).
    assert len(body["solids"]) >= 2


# ---------------------------------------------------------------------------
# BV-3: payload mutation busts the checksum → rebuild
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_voxel_payload_mutation_forces_rebuild(
    async_client: AsyncClient,
    scene: dict,
) -> None:
    """Changing a region's lithology busts the checksum → a rebuild fires.

    Confirms the checksum digests the partition CONTENT (a region's
    ``formation_id``), not just the section count: a real partition change with
    ``force=false`` must rebuild, not skip.
    """
    proj = scene["project"]
    litho = scene["litho"]
    payload = _build_payload(scene, grid_spacing_m=1.0)

    first = await async_client.post(_url(proj.id, litho.id), json=payload)
    assert first.status_code == 200, first.text
    assert first.json()["bodies_built"] >= 2

    # Precondition: an unchanged force=false pass skips.
    skip = await async_client.post(_url(proj.id, litho.id), json=payload, params={"force": "false"})
    assert skip.json()["bodies_built"] == 0, "Precondition: unchanged payload skips"

    # Mutate section 1's bottom ZAND band → SILT (a real lithology change).  This
    # changes a region's formation_id, which the partition checksum digests.
    mutated = copy.deepcopy(payload)
    silt_id = str(scene["silt"].id)
    mutated["sections"][1]["regions"][-1]["formation_id"] = silt_id

    rebuilt = await async_client.post(
        _url(proj.id, litho.id), json=mutated, params={"force": "false"}
    )
    assert rebuilt.status_code == 200, rebuilt.text
    body = rebuilt.json()
    assert body["bodies_built"] >= 1, (
        f"A partition change (force=false) must rebuild; got bodies_built={body['bodies_built']}"
    )
    assert body["bodies_skipped_checksum"] == 0, "A busted checksum must not skip any body"


# ---------------------------------------------------------------------------
# BV-4: scope guard — model in another project 404s
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_voxel_scope_guard_404(
    async_client: AsyncClient,
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """A litho model that does not belong to the path project returns 404."""
    litho = scene["litho"]

    # A second, unrelated project.
    other = ProjectOrm(id=uuid7(), name="BV other", status="active")
    db_session.add(other)
    await db_session.commit()

    payload = _build_payload(scene, grid_spacing_m=1.0)
    resp = await async_client.post(_url(other.id, litho.id), json=payload)
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# BV-4b: a spacing that resolves to too many voxels is refused, retryably
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_voxel_over_budget_names_a_spacing_that_fits(
    async_client: AsyncClient,
    scene: dict,
) -> None:
    """Asking for more voxels than one build may allocate is refused with a NUMBER.

    The engineer typed a spacing, not a bug, so the answer has to be one he can
    act on: which spacing would fit. Leaving that inside a sentence forces the
    client to parse it back out of prose before it can offer the retry, so the
    refusal carries it as a field.
    """
    proj = scene["project"]
    litho = scene["litho"]
    payload = _build_payload(scene, grid_spacing_m=0.001)

    resp = await async_client.post(_url(proj.id, litho.id), json=payload)

    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "voxel_grid_too_large"
    assert isinstance(detail["suggested_horizontal_m"], (int, float))
    assert detail["suggested_horizontal_m"] > 0.001
    assert detail["message"]


# ---------------------------------------------------------------------------
# BV-5: anisotropic spacing — coarse X/Y, fine Z (the thin-layer path)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_build_voxel_anisotropic_spacing_builds(
    async_client: AsyncClient,
    db_session: AsyncSession,
    scene: dict,
) -> None:
    """An anisotropic payload (coarse X/Y, fine Z) builds watertight voxel solids.

    The Task-4 thin-layer path: ``horizontal_spacing_m`` (2 m) ≠
    ``vertical_spacing_m`` (0.5 m) samples the geology finely in elevation
    without exploding the X/Y voxel count.  The build must still produce real,
    non-flagged ``method='voxel'`` solids that reproduce the partition with no
    inter-body overlap — exactly the cubic guarantees, at a non-cubic grid.
    """
    proj = scene["project"]
    litho = scene["litho"]
    payload = _build_payload(scene, grid_spacing_m=2.0)
    # Override the cubic spacing with an anisotropic pair (fine Z, coarse X/Y).
    payload["horizontal_spacing_m"] = 2.0
    payload["vertical_spacing_m"] = 0.5

    resp = await async_client.post(_url(proj.id, litho.id), json=payload)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["bodies_built"] >= 2, f"Expected ≥2 bodies built; got {body['bodies_built']}"
    assert body["bodies_flagged"] == 0, f"Voxel build must not flag; got {body['bodies_flagged']}"
    for solid in body["solids"]:
        assert solid["is_flagged"] is False
        assert solid["method"] == "voxel"
        assert len(solid["vertices"]) > 0
        assert len(solid["triangles"]) > 0

    rows = (
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == litho.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == body["bodies_built"]
    meshes = [
        _MeshView(
            body_id=str(r.body_id),
            formation_id=str(r.formation_id),
            vertices=[tuple(v) for v in r.vertices],
            triangles=[tuple(t) for t in r.triangles],
        )
        for r in rows
    ]
    # No inter-body overlap over a footprint sample — the anti-overlap invariant
    # must hold at an anisotropic grid as it does at the cubic one.
    samples = [(float(x), float(y)) for x in (2.0, 8.0, 14.0) for y in (1.0, 5.0)]
    assert_no_overlap_sampled(meshes, samples)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _formation_covering(meshes: list, x: float, y: float, elev: float) -> str | None:
    """Ray-cast the meshes at ``(x, y)`` and return the formation covering ``elev``.

    Returns the ``formation_id`` of the first body whose vertical interval at
    ``(x, y)`` contains ``elev`` (small inclusive tolerance), or ``None``.
    """
    for m in meshes:
        for base, top in vertical_ray_intervals(m.vertices, m.triangles, x, y):
            if base - 1e-6 <= elev <= top + 1e-6:
                return m.formation_id
    return None


class _MeshView:
    """Minimal ``body_id`` / ``formation_id`` / ``vertices`` / ``triangles`` view.

    The strat-invariant helpers duck-type on these four attributes; the persisted
    JSONB rows are read back into this so the geometry checks run against the
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
