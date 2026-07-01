"""T-B: cross-project IDOR-via-restore security integration test.

The ``POST /projects/{project_id}/restore`` endpoint is the highest-trust-
from-disk input in the system — it materialises an entire project tree from a
``.strix`` bundle.  A crafted bundle could try to:

1. Override WHICH project gets populated — by shipping a different project id
   in ``payload.project.id`` than the URL's ``project_id``.
2. Inject rows that reference entities owned by a DIFFERENT project — by
   shipping foreign ids that exist in the DB (FK-satisfying) but belong to a
   different project's scope.

Attack surfaces covered by this file
-------------------------------------
* **Formation contact** — ``contacts[].formation_id`` pointing at project B's
  formation → dropped by the ``valid_formation_ids`` guard in
  ``_restore_geological_models`` (TB-3, TB-4).
* **Geotech unit** — ``geotechnical_units[].geological_formation_id`` pointing
  at project B's formation → dropped by the ``valid_formation_ids`` guard in
  ``_restore_geotech_units`` (TB-G1 — **security fix**, was missing).
* **Surface** — ``surfaces[].formation_id`` pointing at project B's formation
  → dropped by the ``valid_formation_ids`` guard in ``_restore_geological_models``
  (TB-S1).
* **Body (lens)** — ``bodies[].model_id`` pointing at project B's model →
  dropped by the ``valid_model_ids`` guard in ``_restore_bodies`` (TB-BD1).
* **Litho contact edge** — ``litho_contact_correlation_edges[].model_id``
  pointing at project B's model → dropped by the ``valid_model_ids`` guard in
  ``_restore_contact_edges`` (TB-CE1).
* **Investigation review** — ``investigation_reviews[].target_id`` pointing at
  project B's CPT → dropped by the target-scope guard in
  ``_restore_investigation_reviews`` (TB-IR1).

All guards are independent of the URL-project-id override (TB-2 / TB-5).

**How to verify each test has teeth:**

* TB-3 / TB-4: comment out ``bundle_restore_litho.py ~line 160``
  ``if fid is None or fid not in valid_formation_ids: continue``
* TB-G1: comment out the ``if fid not in valid_formation_ids:`` block in
  ``bundle_restore_core.py::_restore_geotech_units``
* TB-S1: comment out ``bundle_restore_litho.py ~line 182``
  ``if fid is None or fid not in valid_formation_ids: continue`` (surface loop)
* TB-BD1: comment out ``bundle_restore_litho.py ~line 454``
  ``if model_id not in valid_model_ids:``
* TB-CE1: comment out ``bundle_restore_litho.py ~line 731``
  ``if ce_model_id not in valid_model_ids:``
* TB-IR1: comment out ``bundle_restore_core.py ~line 597``
  ``if target_id not in valid_targets:``

Run via:
    .\\scripts\\run-integration-tests.ps1 tests/integration/api/test_restore_project_idor.py
"""

from __future__ import annotations

from uuid import UUID

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.infrastructure.db.models.body_orm import BodyOrm
from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.geotechnical_unit_orm import GeotechnicalUnitOrm
from groundmodel.infrastructure.db.models.investigation_review_orm import InvestigationReviewOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def idor_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Seed project B with a formation, model, and CPT; create project A shell.

    Returns
    -------
    dict
        Keys:
        * project_a_id (UUID) — the restore target
        * project_b (ProjectOrm)
        * formation_b (GeologicalFormationOrm) — formation in project B
        * model_b (GeologicalModelOrm) — geological model in project B
        * cpt_b (CptOrm) — CPT in project B
        * injected_model_id (UUID) — fresh UUID used in malicious bundle models
    """
    # --- Project B: seed directly into the DB (no API involved) ---
    project_b = ProjectOrm(id=uuid7(), name="Project-B (victim)", status="active")
    db_session.add(project_b)
    await db_session.flush()

    formation_b = GeologicalFormationOrm(
        id=uuid7(),
        app_project_id=project_b.id,
        name="B-ZAND",
        color="#f0d0a0",
        display_order=0,
        litho_main_soil_code="ZAND",
    )
    db_session.add(formation_b)
    await db_session.flush()

    model_b = GeologicalModelOrm(
        id=uuid7(),
        app_project_id=project_b.id,
        name="B-Model",
        kind="geological",
    )
    db_session.add(model_b)
    await db_session.flush()

    cpt_b = CptOrm(
        id=uuid7(),
        name="B-CPT-001",
        cpt_type="CPTU",
        app_project_id=project_b.id,
        project_id="B-proj",
        test_id="B-cpt-1",
        location_x=100000.0,
        location_y=200000.0,
        epsg=31370,
    )
    db_session.add(cpt_b)
    # Commit so the async_client (separate engine) can see all B rows.
    await db_session.commit()

    # --- Project A: create via API (gets its own UUID from the server) ---
    resp = await async_client.post("/projects/", json={"name": "Project-A (attacker target)"})
    assert resp.status_code == 201, f"Project-A creation failed: {resp.text}"
    project_a_id = UUID(resp.json()["id"])

    # UUID for the model injected into the malicious bundle (belongs to A
    # in the bundle context, so it passes the model-level restore but lets
    # nested rows be tested independently).
    injected_model_id = uuid7()

    return {
        "project_a_id": project_a_id,
        "project_b": project_b,
        "formation_b": formation_b,
        "model_b": model_b,
        "cpt_b": cpt_b,
        "injected_model_id": injected_model_id,
    }


# ---------------------------------------------------------------------------
# Bundle builders
# ---------------------------------------------------------------------------


def _base_bundle(project_b_id: UUID) -> dict:
    """Minimal well-formed bundle skeleton with no payload rows.

    Parameters
    ----------
    project_b_id : UUID
        Project B id placed in ``project.id`` to exercise the project-id
        override guard.

    Returns
    -------
    dict
        Empty bundle skeleton ready for per-test injection.
    """
    return {
        "format_version": 4,
        "project": {
            "id": str(project_b_id),
            "name": "INJECTED by attacker",
            "status": "active",
        },
        "geological_formations": [],
        "geological_models": [],
        "cpts": [],
        "boreholes": [],
        "cross_sections": [],
        "investigation_reviews": [],
        "geotechnical_units": [],
        "bodies": [],
        "formation_absences": [],
        "litho_contact_correlation_edges": [],
        "body_boundary_shapes": [],
        "body_boundary_nodes": [],
        "litho_solids": [],
    }


def _malicious_bundle(project_b_id: UUID, formation_b_id: UUID, model_id: UUID) -> dict:
    """Bundle with a contact referencing project B's formation.

    Parameters
    ----------
    project_b_id : UUID
        Project B's id — placed in ``project.id`` to attempt project-level IDOR.
    formation_b_id : UUID
        Project B's formation id — referenced as the contact's ``formation_id``.
    model_id : UUID
        Fresh UUID for the injected geological model row.

    Returns
    -------
    dict
        A ``ProjectBundleRequest``-shaped payload ready for ``json=`` in httpx.
    """
    bundle = _base_bundle(project_b_id)
    bundle["geological_models"] = [
        {
            "id": str(model_id),
            "name": "Injected Model",
            "kind": "geological",
            "is_active": False,
            "excluded_borehole_ids": [],
            "contacts": [
                {
                    "id": str(uuid7()),
                    "formation_id": str(formation_b_id),
                    "synthetic_x": 100000.0,
                    "synthetic_y": 200000.0,
                    "synthetic_elevation_m": -5.0,
                    "depth_top_m": 0.0,
                    "source": "manual_pick",
                    "confidence": "medium",
                }
            ],
            "surfaces": [],
            "litho_layers": [],
        }
    ]
    return bundle


def _geotech_unit_bundle(project_b_id: UUID, formation_b_id: UUID) -> dict:
    """Bundle with a geotech unit referencing project B's formation (TB-G1).

    The ``geological_formations`` list is empty — formation_b_id is NOT a
    valid payload formation.  The unit's ``geological_formation_id`` points
    at project B's formation directly.

    Parameters
    ----------
    project_b_id : UUID
        Project B's id (project-level IDOR probe).
    formation_b_id : UUID
        Project B's formation id — injected as the unit's FK target.

    Returns
    -------
    dict
        Bundle payload for ``json=`` in httpx.
    """
    bundle = _base_bundle(project_b_id)
    bundle["geotechnical_units"] = [
        {
            "id": str(uuid7()),
            "geological_formation_id": str(formation_b_id),
            "name": "Injected Geotech Unit",
            "color": "#aabbcc",
            "display_order": 0,
        }
    ]
    return bundle


def _surface_bundle(project_b_id: UUID, formation_b_id: UUID, model_id: UUID) -> dict:
    """Bundle with a surface referencing project B's formation (TB-S1).

    A valid local formation is included in ``geological_formations`` so the
    model itself passes the model phase, but the surface's ``formation_id``
    points at project B's formation — the surface-level guard must drop it.

    Parameters
    ----------
    project_b_id : UUID
        Project B's id (project-level IDOR probe).
    formation_b_id : UUID
        Project B's formation id — injected as the surface's FK target.
    model_id : UUID
        Fresh UUID for the injected model (belongs to project A in the bundle).

    Returns
    -------
    dict
        Bundle payload for ``json=`` in httpx.
    """
    bundle = _base_bundle(project_b_id)
    # A valid local formation so the model phase passes.
    local_formation_id = str(uuid7())
    bundle["geological_formations"] = [
        {
            "id": local_formation_id,
            "name": "A-KLEI",
            "color": "#a0785a",
            "display_order": 0,
            "litho_main_soil_code": "KLEI",
        }
    ]
    bundle["geological_models"] = [
        {
            "id": str(model_id),
            "name": "Injected Model",
            "kind": "geological",
            "is_active": False,
            "excluded_borehole_ids": [],
            "contacts": [],
            "surfaces": [
                {
                    "id": str(uuid7()),
                    "formation_id": str(formation_b_id),  # cross-project!
                    "method": "tin",
                    "vertices": [],
                    "triangles": [],
                    "is_stale": True,
                    "source_contact_count": 0,
                }
            ],
            "litho_layers": [],
        }
    ]
    return bundle


def _body_bundle(project_b_id: UUID, model_b_id: UUID, formation_b_id: UUID) -> dict:
    """Bundle with a body referencing project B's model (TB-BD1).

    The body's ``model_id`` points at project B's geological model — the
    ``valid_model_ids`` guard must drop it before the FK is ever evaluated.

    Parameters
    ----------
    project_b_id : UUID
        Project B's id (project-level IDOR probe).
    model_b_id : UUID
        Project B's model id — injected as the body's ``model_id``.
    formation_b_id : UUID
        Project B's formation id — used as the body's ``formation_id``
        (the model guard fires first; this is just to keep the payload
        internally consistent from the attacker's perspective).

    Returns
    -------
    dict
        Bundle payload for ``json=`` in httpx.
    """
    bundle = _base_bundle(project_b_id)
    bundle["bodies"] = [
        {
            "id": str(uuid7()),
            "model_id": str(model_b_id),  # cross-project!
            "formation_id": str(formation_b_id),
            "body_ordinal": 0,
            "source_investigation_id": str(uuid7()),
            "name": None,
        }
    ]
    return bundle


def _contact_edge_bundle(project_b_id: UUID, model_b_id: UUID) -> dict:
    """Bundle with a litho contact edge referencing project B's model (TB-CE1).

    The edge's ``model_id`` points at project B's model — the ``valid_model_ids``
    guard must drop it before the contact-endpoint guard is even reached.

    Parameters
    ----------
    project_b_id : UUID
        Project B's id (project-level IDOR probe).
    model_b_id : UUID
        Project B's model id — injected as the edge's ``model_id``.

    Returns
    -------
    dict
        Bundle payload for ``json=`` in httpx.
    """
    bundle = _base_bundle(project_b_id)
    bundle["litho_contact_correlation_edges"] = [
        {
            "id": str(uuid7()),
            "model_id": str(model_b_id),  # cross-project!
            "section_id": str(uuid7()),
            "contact_a_id": str(uuid7()),
            "contact_b_id": str(uuid7()),
            "contact_a_side": "top",
            "contact_b_side": "top",
            "user_approved": False,
        }
    ]
    return bundle


def _review_bundle(project_b_id: UUID, cpt_b_id: UUID) -> dict:
    """Bundle with an investigation review targeting project B's CPT (TB-IR1).

    The review's ``target_id`` points at project B's CPT — the target-scope
    guard in ``_restore_investigation_reviews`` must drop it.

    Parameters
    ----------
    project_b_id : UUID
        Project B's id (project-level IDOR probe).
    cpt_b_id : UUID
        Project B's CPT id — injected as the review's ``target_id``.

    Returns
    -------
    dict
        Bundle payload for ``json=`` in httpx.
    """
    bundle = _base_bundle(project_b_id)
    bundle["investigation_reviews"] = [
        {
            "id": str(uuid7()),
            "app_project_id": str(project_b_id),
            "target_kind": "cpt",
            "target_id": str(cpt_b_id),  # cross-project!
            "status": "approved",
            "notes": None,
        }
    ]
    return bundle


# ---------------------------------------------------------------------------
# Tests — original TB set (contact-level IDOR)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_url_project_id_overrides_payload_project_id(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-1: the URL's project_id (A) wins over the payload's project.id (B).

    If the restore endpoint used the payload's project.id instead of the URL
    project_id, every inserted row would carry project B's id — silently
    populating B instead of A.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    formation_b: GeologicalFormationOrm = scene["formation_b"]
    injected_model_id: UUID = scene["injected_model_id"]

    payload = _malicious_bundle(
        project_b_id=scene["project_b"].id,
        formation_b_id=formation_b.id,
        model_id=injected_model_id,
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    # TB-1: restore succeeds (the guard drops the foreign contact, not the whole call).
    assert resp.status_code == 200, f"restore returned {resp.status_code}: {resp.text}"

    # TB-2: the response project id is A, not B.
    response_id = UUID(resp.json()["id"])
    assert response_id == project_a_id, (
        f"URL project_id (A={project_a_id}) must win over payload project.id "
        f"(B={scene['project_b'].id}); got {response_id}"
    )


@pytest.mark.asyncio
async def test_foreign_formation_contact_is_dropped(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-3 + TB-4: a contact referencing a foreign-project formation is silently dropped.

    The _build_valid_formation_ids helper scopes the DB lookup to the URL
    project_id (A). Project B's formation is not in A's formation set AND not
    in the bundle's geological_formations list, so it never enters the valid
    set. The FK-guard in _restore_geological_models drops the contact.

    TB-3: no FormationContactOrm rows with formation_id == B's formation exist
          anywhere in the DB after the restore (not under A, not under B).
    TB-4: the injected model itself IS inserted (under project A), but it has
          zero contacts — the model row is harmless without the contact.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    formation_b: GeologicalFormationOrm = scene["formation_b"]
    injected_model_id: UUID = scene["injected_model_id"]

    payload = _malicious_bundle(
        project_b_id=scene["project_b"].id,
        formation_b_id=formation_b.id,
        model_id=injected_model_id,
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    assert resp.status_code == 200, f"restore returned {resp.status_code}: {resp.text}"

    # Re-query from the test session (separate connection; uses read-committed).
    # TB-3: no contact references formation_b anywhere.
    cross_contacts = list(
        (
            await db_session.execute(
                select(FormationContactOrm).where(
                    FormationContactOrm.formation_id == formation_b.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert cross_contacts == [], (
        f"Found {len(cross_contacts)} FormationContactOrm rows referencing "
        f"project B's formation {formation_b.id} — FK guard is broken. "
        "Teeth check: remove the 'if fid not in valid_formation_ids: continue' "
        "guard in bundle_restore_litho.py to see this assertion fail."
    )

    # TB-4: the model WAS inserted under project A (no contacts = harmless).
    injected_model = (
        await db_session.execute(
            select(GeologicalModelOrm).where(GeologicalModelOrm.id == injected_model_id)
        )
    ).scalar_one_or_none()

    assert injected_model is not None, (
        f"Model {injected_model_id} was not inserted — expected it to be inserted "
        "under project A with zero contacts (the model itself is harmless)"
    )
    assert injected_model.app_project_id == project_a_id, (
        f"Injected model has app_project_id={injected_model.app_project_id} "
        f"but expected project A {project_a_id} — URL project_id guard failed"
    )


@pytest.mark.asyncio
async def test_project_b_formation_untouched(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-5: project B's formation row is untouched by the malicious restore.

    The restore must NOT modify, move, or delete project B's data.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    formation_b: GeologicalFormationOrm = scene["formation_b"]

    payload = _malicious_bundle(
        project_b_id=scene["project_b"].id,
        formation_b_id=formation_b.id,
        model_id=scene["injected_model_id"],
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    assert resp.status_code == 200, f"restore returned {resp.status_code}: {resp.text}"

    # TB-5: B's formation still exists, scoped to project B.
    # Expire the in-session cache so we re-read from DB.
    await db_session.refresh(formation_b)

    assert formation_b.app_project_id == scene["project_b"].id, (
        f"formation_b.app_project_id changed to {formation_b.app_project_id} — "
        "the restore mutated project B's data"
    )
    assert formation_b.name == "B-ZAND", (
        f"formation_b.name changed to {formation_b.name!r} — the restore mutated project B's data"
    )


# ---------------------------------------------------------------------------
# Tests — FIX 1: geotech unit cross-project FK (was unguarded before this fix)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_foreign_formation_geotech_unit_is_dropped(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-G1: a geotech unit whose geological_formation_id = project B's formation is dropped.

    This is the FIX 1 regression test.  Before the fix, ``_restore_geotech_units``
    delegated to ``_restore_flat_rows`` with no formation-scope guard — any unit
    payload row was inserted regardless of which project owned the referenced
    formation.  A bundle restored into project A carrying a unit with
    ``geological_formation_id = formation_B.id`` was silently persisted (the DB FK
    accepted it because formation_B exists).

    The fix adds an explicit ``valid_formation_ids`` guard (mirroring the litho
    restore guards) that drops any unit whose formation does NOT belong to
    project A's valid formation set.

    Teeth: comment out the ``if fid not in valid_formation_ids:`` block in
    ``bundle_restore_core.py::_restore_geotech_units``.  The
    ``GeotechnicalUnitOrm`` row would be inserted with
    ``geological_formation_id = formation_B.id``, failing the assertion below.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    formation_b: GeologicalFormationOrm = scene["formation_b"]

    payload = _geotech_unit_bundle(
        project_b_id=scene["project_b"].id,
        formation_b_id=formation_b.id,
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    assert resp.status_code == 200, f"restore returned {resp.status_code}: {resp.text}"

    # TB-G1: no GeotechnicalUnitOrm row anywhere references formation_b.
    cross_units = list(
        (
            await db_session.execute(
                select(GeotechnicalUnitOrm).where(
                    GeotechnicalUnitOrm.geological_formation_id == formation_b.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert cross_units == [], (
        f"Found {len(cross_units)} GeotechnicalUnitOrm row(s) referencing "
        f"project B's formation {formation_b.id} — formation-scope guard is broken. "
        "Teeth check: remove the 'if fid not in valid_formation_ids:' block in "
        "_restore_geotech_units (bundle_restore_core.py) to see this fail."
    )


# ---------------------------------------------------------------------------
# Tests — FIX 2: verify guards exist for surfaces, bodies, edges, reviews
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_foreign_formation_surface_is_dropped(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-S1: a surface whose formation_id = project B's formation is dropped.

    The surface-level ``valid_formation_ids`` guard in
    ``_restore_geological_models`` (the ``if fid is None or fid not in
    valid_formation_ids: continue`` on the surfaces loop) must fire.

    Teeth: comment out that guard for the surfaces loop in
    ``bundle_restore_litho.py``.  The surface would be inserted under
    the injected model with ``formation_id = formation_B.id``.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    formation_b: GeologicalFormationOrm = scene["formation_b"]
    injected_model_id: UUID = scene["injected_model_id"]

    payload = _surface_bundle(
        project_b_id=scene["project_b"].id,
        formation_b_id=formation_b.id,
        model_id=injected_model_id,
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    assert resp.status_code == 200, f"restore returned {resp.status_code}: {resp.text}"

    # TB-S1: no FormationSurfaceOrm references formation_b anywhere.
    cross_surfaces = list(
        (
            await db_session.execute(
                select(FormationSurfaceOrm).where(
                    FormationSurfaceOrm.formation_id == formation_b.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert cross_surfaces == [], (
        f"Found {len(cross_surfaces)} FormationSurfaceOrm row(s) referencing "
        f"project B's formation {formation_b.id} — surface FK guard is broken. "
        "Teeth check: remove the surface-loop guard in _restore_geological_models "
        "(bundle_restore_litho.py) to see this fail."
    )


@pytest.mark.asyncio
async def test_foreign_model_body_is_dropped(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-BD1: a body whose model_id = project B's model is dropped.

    The ``valid_model_ids`` guard in ``_restore_bodies`` must fire before
    the FK is evaluated (``if model_id not in valid_model_ids: ... dropped``).

    Teeth: comment out that guard in ``bundle_restore_litho.py::_restore_bodies``
    (~line 454).  The body would be inserted under project A with
    ``model_id = model_B.id`` — the DB FK accepts it (model_B exists) but the
    row leaks across the project boundary.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    model_b: GeologicalModelOrm = scene["model_b"]
    formation_b: GeologicalFormationOrm = scene["formation_b"]

    payload = _body_bundle(
        project_b_id=scene["project_b"].id,
        model_b_id=model_b.id,
        formation_b_id=formation_b.id,
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    assert resp.status_code == 200, f"restore returned {resp.status_code}: {resp.text}"

    # TB-BD1: no BodyOrm references model_b anywhere.
    cross_bodies = list(
        (await db_session.execute(select(BodyOrm).where(BodyOrm.model_id == model_b.id)))
        .scalars()
        .all()
    )
    assert cross_bodies == [], (
        f"Found {len(cross_bodies)} BodyOrm row(s) referencing "
        f"project B's model {model_b.id} — body model-scope guard is broken. "
        "Teeth check: comment out 'if model_id not in valid_model_ids' in "
        "_restore_bodies (bundle_restore_litho.py) to see this fail."
    )


@pytest.mark.asyncio
async def test_foreign_model_contact_edge_is_dropped(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-CE1: a litho contact edge whose model_id = project B's model is dropped.

    The ``valid_model_ids`` guard in ``_restore_contact_edges`` must fire
    before the contact-endpoint guard (``if ce_model_id not in valid_model_ids:
    ... dropped`` at ~line 731 of bundle_restore_litho.py).

    Teeth: comment out that guard.  The edge would be inserted under project A
    with ``model_id = model_B.id``.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    model_b: GeologicalModelOrm = scene["model_b"]

    payload = _contact_edge_bundle(
        project_b_id=scene["project_b"].id,
        model_b_id=model_b.id,
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    assert resp.status_code == 200, f"restore returned {resp.status_code}: {resp.text}"

    # TB-CE1: no LithoContactCorrelationEdgeOrm references model_b.
    cross_edges = list(
        (
            await db_session.execute(
                select(LithoContactCorrelationEdgeOrm).where(
                    LithoContactCorrelationEdgeOrm.model_id == model_b.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert cross_edges == [], (
        f"Found {len(cross_edges)} LithoContactCorrelationEdgeOrm row(s) referencing "
        f"project B's model {model_b.id} — edge model-scope guard is broken. "
        "Teeth check: comment out 'if ce_model_id not in valid_model_ids' in "
        "_restore_contact_edges (bundle_restore_litho.py) to see this fail."
    )


@pytest.mark.asyncio
async def test_foreign_project_investigation_review_is_dropped(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-IR1: a review targeting project B's CPT is dropped.

    ``_restore_investigation_reviews`` builds ``valid_cpt_ids`` scoped to
    project A.  Project B's CPT id is not in that set, so the review is
    dropped with a WARNING before any row is inserted.

    Teeth: comment out the ``if target_id not in valid_targets:`` block in
    ``bundle_restore_core.py::_restore_investigation_reviews`` (~line 597).
    The review would be inserted under project A with ``target_id = cpt_B.id``.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    cpt_b: CptOrm = scene["cpt_b"]

    payload = _review_bundle(
        project_b_id=scene["project_b"].id,
        cpt_b_id=cpt_b.id,
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    assert resp.status_code == 200, f"restore returned {resp.status_code}: {resp.text}"

    # TB-IR1: no InvestigationReviewOrm targets cpt_b anywhere.
    cross_reviews = list(
        (
            await db_session.execute(
                select(InvestigationReviewOrm).where(InvestigationReviewOrm.target_id == cpt_b.id)
            )
        )
        .scalars()
        .all()
    )
    assert cross_reviews == [], (
        f"Found {len(cross_reviews)} InvestigationReviewOrm row(s) referencing "
        f"project B's CPT {cpt_b.id} — review target-scope guard is broken. "
        "Teeth check: comment out 'if target_id not in valid_targets:' in "
        "_restore_investigation_reviews (bundle_restore_core.py) to see this fail."
    )
