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
* **Formation contact investigation anchor** — ``contacts[].cpt_id`` pointing
  at project B's CPT (valid formation_id, valid model) → dropped by the
  ``valid_inv_ids`` guard in ``_restore_geological_models`` (TB-FC-INV1 — FIX 1).
  Positive case: a contact with a same-bundle CPT still restores (TB-FC-INV2).
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
* **Review target kind** — ``investigation_reviews[].target_kind`` set to an
  unknown value → dropped by the allow-list guard BEFORE the id-scope check,
  instead of crashing (TB-IR-KIND — FIX 4).
* **Formation absence investigation** —
  ``formation_absences[].investigation_id`` pointing at project B's CPT
  (valid formation_id) → dropped by the ``valid_inv_ids`` guard in
  ``_restore_formation_absences`` (TB-AB-INV — FIX 2).
* **Litho solid size cap** — ``litho_solids[].vertices`` exceeding
  ``_MAX_TIN_ARRAY_LEN`` → geometry blanked + ``is_stale`` forced instead of
  OOMing the asyncio worker (TB-SOL-CAP — FIX 3).

All guards are independent of the URL-project-id override (TB-2 / TB-5).

**How to verify each test has teeth:**

* TB-3 / TB-4: comment out ``bundle_restore_litho.py`` formation_id guard in
  the contacts loop inside ``_restore_geological_models``
* TB-FC-INV1: comment out the ``valid_inv_ids`` guard on ``bh_id``/``cpt_id``
  in the contacts loop inside ``_restore_geological_models``
* TB-S1: comment out the surface-loop formation_id guard in
  ``bundle_restore_litho.py``
* TB-BD1: comment out the model_id guard in
  ``bundle_restore_litho.py::_restore_bodies``
* TB-CE1: comment out the model_id guard in
  ``bundle_restore_litho.py::_restore_contact_edges``
* TB-IR1: comment out the ``if target_id not in valid_targets:`` block in
  ``bundle_restore_core.py::_restore_investigation_reviews``
* TB-IR-KIND: comment out the ``if target_kind not in ("cpt", "borehole"):``
  block in ``bundle_restore_core.py::_restore_investigation_reviews``
* TB-AB-INV: comment out the ``valid_inv_ids`` guard in
  ``bundle_restore_litho.py::_restore_formation_absences``
* TB-SOL-CAP: comment out the size-cap + blank block in
  ``bundle_restore_litho.py::_restore_litho_solids``

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
from groundmodel.infrastructure.db.models.formation_absence_orm import FormationAbsenceOrm
from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.formation_surface_orm import FormationSurfaceOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.investigation_review_orm import InvestigationReviewOrm
from groundmodel.infrastructure.db.models.litho_body_solid_orm import LithoBodySolidOrm
from groundmodel.infrastructure.db.models.litho_contact_correlation_edge_orm import (
    LithoContactCorrelationEdgeOrm,
)
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm
from groundmodel.infrastructure.db.repositories.project_bundle.bundle_serialization import (
    _MAX_TIN_ARRAY_LEN,
)

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
            "layer_a_id": str(uuid7()),
            "layer_b_id": str(uuid7()),
            "layer_a_side": "top",
            "layer_b_side": "top",
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


def _contact_foreign_cpt_bundle(
    project_b_id: UUID,
    cpt_b_id: UUID,
    model_id: UUID,
) -> dict:
    """Bundle with a contact anchored at project B's CPT (FIX 1 regression).

    The contact's ``formation_id`` references a valid local formation but its
    ``cpt_id`` points at project B's CPT — a cross-project investigation anchor.

    Pre-fix: ``_restore_geological_models`` validated only ``formation_id``,
    so the DB FK on ``cpt_id`` was satisfied (cpt_B exists) and the row
    was silently inserted under project A.

    Post-fix: the ``valid_inv_ids`` guard in the contacts loop drops the row.

    Parameters
    ----------
    project_b_id : UUID
        Project B's id (project-level IDOR probe).
    cpt_b_id : UUID
        Project B's CPT id — injected as the contact's ``cpt_id``.
    model_id : UUID
        Fresh UUID for the injected model (belongs to project A in the bundle).

    Returns
    -------
    dict
        Bundle payload for ``json=`` in httpx.
    """
    bundle = _base_bundle(project_b_id)
    local_formation_id = str(uuid7())
    bundle["geological_formations"] = [
        {
            "id": local_formation_id,
            "name": "A-ZAND",
            "color": "#f0d0a0",
            "display_order": 0,
            "litho_main_soil_code": "ZAND",
        }
    ]
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
                    "formation_id": local_formation_id,  # valid local formation
                    "cpt_id": str(cpt_b_id),  # cross-project CPT! (FIX 1 target)
                    "depth_top_m": 5.0,
                    "source": "manual_pick",
                    "confidence": "medium",
                }
            ],
            "surfaces": [],
            "litho_layers": [],
        }
    ]
    return bundle


def _contact_local_cpt_bundle(
    project_b_id: UUID,
    model_id: UUID,
    local_cpt_id: UUID,
) -> dict:
    """Bundle with a contact anchored at a same-bundle CPT (FIX 1 positive case).

    The contact's ``cpt_id`` references a CPT included in this bundle's
    ``cpts`` array (project A's own investigation).  This must still be
    inserted after FIX 1 — the ``valid_inv_ids`` set includes payload CPT ids.

    Parameters
    ----------
    project_b_id : UUID
        Project B's id (project-level IDOR probe).
    model_id : UUID
        Fresh UUID for the model (belongs to project A in the bundle).
    local_cpt_id : UUID
        Fresh UUID for the local CPT (also in the bundle's ``cpts`` array).

    Returns
    -------
    dict
        Bundle payload for ``json=`` in httpx.
    """
    bundle = _base_bundle(project_b_id)
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
    bundle["cpts"] = [
        {
            "id": str(local_cpt_id),
            "name": "A-CPT-001",
            "cpt_type": "CPTU",
            "project_id": "A-proj",
            "test_id": "A-cpt-001",
            "location_x": 150000.0,
            "location_y": 210000.0,
            "epsg": 31370,
        }
    ]
    bundle["geological_models"] = [
        {
            "id": str(model_id),
            "name": "Local Model",
            "kind": "geological",
            "is_active": False,
            "excluded_borehole_ids": [],
            "contacts": [
                {
                    "id": str(uuid7()),
                    "formation_id": local_formation_id,  # valid local formation
                    "cpt_id": str(local_cpt_id),  # local CPT (in this bundle)
                    "depth_top_m": 5.0,
                    "source": "manual_pick",
                    "confidence": "medium",
                }
            ],
            "surfaces": [],
            "litho_layers": [],
        }
    ]
    return bundle


def _absence_foreign_investigation_bundle(
    project_b_id: UUID,
    cpt_b_id: UUID,
) -> dict:
    """Bundle with a formation absence referencing project B's CPT (FIX 2 regression).

    The absence's ``formation_id`` references a valid local formation but its
    ``investigation_id`` (a polymorphic UUID with no DB FK) points at project
    B's CPT.  Pre-fix: the DB accepted this silently because
    ``FormationAbsenceOrm.investigation_id`` has no FK constraint.

    Post-fix: the ``valid_inv_ids`` guard in ``_restore_formation_absences``
    drops the row.

    Parameters
    ----------
    project_b_id : UUID
        Project B's id (project-level IDOR probe).
    cpt_b_id : UUID
        Project B's CPT id — injected as ``investigation_id``.

    Returns
    -------
    dict
        Bundle payload for ``json=`` in httpx.
    """
    bundle = _base_bundle(project_b_id)
    local_formation_id = str(uuid7())
    bundle["geological_formations"] = [
        {
            "id": local_formation_id,
            "name": "A-VEEN",
            "color": "#4a3728",
            "display_order": 0,
            "litho_main_soil_code": "VEEN",
        }
    ]
    bundle["formation_absences"] = [
        {
            "id": str(uuid7()),
            "formation_id": local_formation_id,  # valid local formation
            "investigation_id": str(cpt_b_id),  # cross-project CPT! (FIX 2 target)
            "investigation_kind": "cpt",
            "source": "inferred",
        }
    ]
    return bundle


def _oversized_solid_bundle(
    project_b_id: UUID,
    model_id: UUID,
) -> dict:
    """Bundle with a litho solid whose vertices array exceeds the size cap (FIX 3).

    Pre-fix: ``_restore_litho_solids`` had no size guard — the oversized JSONB
    array was inserted verbatim, potentially OOMing the asyncio worker.

    Post-fix: vertices + triangles are blanked to ``[]`` and ``is_stale`` is
    forced to ``True`` (same pattern as ``_restore_geological_models`` for
    FormationSurface). The solid ROW is still inserted so the formation keeps
    its metadata; only the runaway geometry is dropped.

    Parameters
    ----------
    project_b_id : UUID
        Project B's id (project-level IDOR probe — also exercises the URL guard).
    model_id : UUID
        Fresh UUID for the lithostratigraphic model that owns the solid.

    Returns
    -------
    dict
        Bundle payload for ``json=`` in httpx.
    """
    bundle = _base_bundle(project_b_id)
    local_formation_id = str(uuid7())
    bundle["geological_formations"] = [
        {
            "id": local_formation_id,
            "name": "A-SILT",
            "color": "#c8b89a",
            "display_order": 0,
            "litho_main_soil_code": "SILT",
        }
    ]
    bundle["geological_models"] = [
        {
            # 'geological' (not 'lithostratigraphic'): a litho/geotech model
            # requires a non-null parent_model_id (CHECK
            # ck_geological_model_kind_parent_null), and this fixture exercises
            # the litho-SOLID size cap, which is indifferent to model kind — it
            # only needs model_id to land in valid_model_ids. Matches every
            # other model fixture in this file.
            "id": str(model_id),
            "name": "Litho Model",
            "kind": "geological",
            "is_active": True,
            "excluded_borehole_ids": [],
            "contacts": [],
            "surfaces": [],
            "litho_layers": [],
        }
    ]
    # One vertex over the cap so the blanking logic fires.
    oversized_vertices = [[0, 0, 0]] * (_MAX_TIN_ARRAY_LEN + 1)
    bundle["litho_solids"] = [
        {
            "id": str(uuid7()),
            "model_id": str(model_id),
            "body_id": str(uuid7()),
            "formation_id": local_formation_id,
            "method": "voxel",
            "vertices": oversized_vertices,
            "triangles": [],
            # is_stale = False in the bundle; the cap forces True on restore.
            "is_stale": False,
            "is_flagged": False,
            "source_pick_count": 0,
            # LargeBinary serialised as hex string (see bundle_serialization._to_json).
            "source_pick_checksum": "00",
        }
    ]
    return bundle


def _garbage_kind_review_bundle(
    project_b_id: UUID,
    local_borehole_id: UUID,
) -> dict:
    """Bundle with a review whose target_kind is not 'cpt' or 'borehole' (FIX 4).

    Pre-fix: ``_restore_investigation_reviews`` dispatched to
    ``valid_bh_ids`` for any target_kind that wasn't 'cpt' (the else
    branch), so a garbage kind with a valid local borehole id passed the
    id-scope check and the INSERT hit the DB CHECK constraint, crashing
    the whole restore with a 500 instead of cleanly dropping the bad row.

    Post-fix: an explicit allow-list rejects unrecognised kinds BEFORE the
    id-scope check — the restore returns 200 and the garbage row is absent.

    Parameters
    ----------
    project_b_id : UUID
        Project B's id (project-level IDOR probe).
    local_borehole_id : UUID
        A borehole included in this bundle's ``boreholes`` array so the
        id-scope check would otherwise PASS (confirming the allow-list is
        the actual guard, not the id check).

    Returns
    -------
    dict
        Bundle payload for ``json=`` in httpx.
    """
    bundle = _base_bundle(project_b_id)
    bundle["boreholes"] = [
        {
            "id": str(local_borehole_id),
            "name": "A-BH-001",
            "project_id": "A-proj",
            "test_id": "A-bh-001",
            "location_x": 155000.0,
            "location_y": 215000.0,
            "epsg": 31370,
            "drill_segments": [],
            "field_log_intervals": [],
            "observations": [],
            "samples": [],
        }
    ]
    bundle["investigation_reviews"] = [
        {
            "id": str(uuid7()),
            "target_kind": "not_a_real_kind",  # garbage kind! (FIX 4 target)
            "target_id": str(local_borehole_id),  # valid local borehole
            "review_status": "reviewed",
            "review_notes": None,
            "is_hidden": False,
        }
    ]
    return bundle


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


# ---------------------------------------------------------------------------
# Tests — FIX 1: FormationContactOrm investigation anchor unguarded
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_foreign_cpt_contact_is_dropped(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-FC-INV1: a contact anchored at project B's CPT is dropped (FIX 1).

    The contact's ``formation_id`` is valid (a local project-A formation in the
    bundle), but its ``cpt_id`` points at project B's CPT.  Pre-fix,
    ``_restore_geological_models`` only validated ``formation_id`` — the DB FK
    on ``cpt_id`` was satisfied by cpt_B's existence, so the row was inserted
    silently under project A, giving A's model a contact anchored at B's data.

    Post-fix: the ``valid_inv_ids`` guard in the contacts loop checks both
    ``borehole_id`` and ``cpt_id``; a non-null id that is not in the project's
    valid investigation set causes the contact to be dropped.

    Teeth: remove the ``cpt_id``/``borehole_id`` guard from the contacts loop
    in ``_restore_geological_models`` (bundle_restore_litho.py).  The contact
    would be inserted, failing the assertion below.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    cpt_b: CptOrm = scene["cpt_b"]
    injected_model_id: UUID = scene["injected_model_id"]

    payload = _contact_foreign_cpt_bundle(
        project_b_id=scene["project_b"].id,
        cpt_b_id=cpt_b.id,
        model_id=injected_model_id,
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    assert resp.status_code == 200, f"restore returned {resp.status_code}: {resp.text}"

    # TB-FC-INV1: no FormationContactOrm row anchored at cpt_B exists.
    cross_contacts = list(
        (
            await db_session.execute(
                select(FormationContactOrm).where(FormationContactOrm.cpt_id == cpt_b.id)
            )
        )
        .scalars()
        .all()
    )
    assert cross_contacts == [], (
        f"Found {len(cross_contacts)} FormationContactOrm row(s) with "
        f"cpt_id == project B's CPT {cpt_b.id} — investigation-anchor guard is broken. "
        "Teeth check: remove the cpt_id/borehole_id guard from the contacts loop "
        "in _restore_geological_models (bundle_restore_litho.py) to see this fail."
    )


@pytest.mark.asyncio
async def test_local_cpt_contact_is_preserved(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-FC-INV2: a contact anchored at a same-bundle CPT is still inserted (FIX 1 positive).

    The ``valid_inv_ids`` set includes the ids of all CPTs + boreholes in the
    bundle payload (not yet flushed when the guard runs).  A contact whose
    ``cpt_id`` references a CPT in the same bundle must NOT be dropped by the
    investigation-anchor guard.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    injected_model_id: UUID = scene["injected_model_id"]
    local_cpt_id = uuid7()

    payload = _contact_local_cpt_bundle(
        project_b_id=scene["project_b"].id,
        model_id=injected_model_id,
        local_cpt_id=local_cpt_id,
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    assert resp.status_code == 200, f"restore returned {resp.status_code}: {resp.text}"

    # TB-FC-INV2: the contact anchored at the local CPT IS present.
    contacts = list(
        (
            await db_session.execute(
                select(FormationContactOrm).where(FormationContactOrm.cpt_id == local_cpt_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(contacts) == 1, (
        f"Expected 1 FormationContactOrm for same-bundle CPT {local_cpt_id}, "
        f"got {len(contacts)} — the investigation-anchor guard incorrectly dropped a valid contact."
    )
    assert contacts[0].cpt_id == local_cpt_id


# ---------------------------------------------------------------------------
# Tests — FIX 2: FormationAbsenceOrm investigation_id unguarded
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_foreign_investigation_absence_is_dropped(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-AB-INV: a formation absence referencing project B's CPT is dropped (FIX 2).

    ``FormationAbsenceOrm.investigation_id`` is a polymorphic UUID with NO DB
    FK — the DB accepts any UUID, so a cross-project injection is only caught
    at the application layer.  Pre-fix: ``_restore_formation_absences`` checked
    only ``formation_id`` (a real FK), leaving ``investigation_id`` unguarded.

    Post-fix: the ``valid_inv_ids`` guard checks ``investigation_id``; a value
    not in the project's CPT+borehole set causes the absence to be dropped.

    Teeth: remove the ``investigation_id`` guard from ``_restore_formation_absences``
    (bundle_restore_litho.py).  The absence would be inserted, failing the
    assertion below.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    cpt_b: CptOrm = scene["cpt_b"]

    payload = _absence_foreign_investigation_bundle(
        project_b_id=scene["project_b"].id,
        cpt_b_id=cpt_b.id,
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    assert resp.status_code == 200, f"restore returned {resp.status_code}: {resp.text}"

    # TB-AB-INV: no FormationAbsenceOrm row references cpt_B's id.
    cross_absences = list(
        (
            await db_session.execute(
                select(FormationAbsenceOrm).where(FormationAbsenceOrm.investigation_id == cpt_b.id)
            )
        )
        .scalars()
        .all()
    )
    assert cross_absences == [], (
        f"Found {len(cross_absences)} FormationAbsenceOrm row(s) with "
        f"investigation_id == project B's CPT {cpt_b.id} — "
        "investigation_id guard is broken (no DB FK on this column). "
        "Teeth check: remove the investigation_id guard from "
        "_restore_formation_absences (bundle_restore_litho.py) to see this fail."
    )


# ---------------------------------------------------------------------------
# Tests — FIX 3: LithoBodySolidOrm vertices/triangles no size cap
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_oversized_litho_solid_is_blanked(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-SOL-CAP: a litho solid with oversized vertices is inserted blanked (FIX 3).

    Pre-fix: ``_restore_litho_solids`` had no size guard — a bundle that
    carried a malicious/corrupted solid with hundreds of thousands of vertices
    would be inserted verbatim into the JSONB column, potentially OOMing the
    asyncio worker on deserialise or the Postgres worker on JSONB write.

    Post-fix: vertices/triangles exceeding ``_MAX_TIN_ARRAY_LEN`` are set to
    ``[]`` and ``is_stale`` is forced to ``True`` (same pattern as the
    ``FormationSurface`` size-cap guard).  The solid ROW is still inserted so
    the 3-D viewer can display "stale — rebuild required" rather than "missing".

    Teeth: comment out the size-cap block in ``_restore_litho_solids``
    (bundle_restore_litho.py).  The solid would be inserted with
    ``is_stale = False`` (as sent in the bundle), failing the assertions below.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    injected_model_id: UUID = scene["injected_model_id"]

    payload = _oversized_solid_bundle(
        project_b_id=scene["project_b"].id,
        model_id=injected_model_id,
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    assert resp.status_code == 200, f"restore returned {resp.status_code}: {resp.text}"

    # TB-SOL-CAP: the solid row IS inserted (not rejected) but with blanked geometry.
    solids = list(
        (
            await db_session.execute(
                select(LithoBodySolidOrm).where(LithoBodySolidOrm.model_id == injected_model_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(solids) == 1, (
        f"Expected 1 LithoBodySolidOrm for model {injected_model_id}, "
        f"got {len(solids)} — solid was either rejected or duplicated."
    )
    solid = solids[0]
    assert solid.is_stale is True, (
        "LithoBodySolidOrm.is_stale must be True when the size cap fires "
        "(bundle sent is_stale=False; the cap forces it True). "
        "Teeth check: comment out the size-cap block in _restore_litho_solids "
        "(bundle_restore_litho.py) to see is_stale=False here."
    )
    assert solid.vertices == [], (
        f"LithoBodySolidOrm.vertices must be [] after blanking, "
        f"got {len(solid.vertices)} items — the size-cap geometry blank did not fire."
    )


# ---------------------------------------------------------------------------
# Tests — FIX 4: _restore_investigation_reviews target_kind not allow-listed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_garbage_target_kind_review_is_dropped(
    db_session: AsyncSession,
    idor_scene: dict,
    async_client: AsyncClient,
) -> None:
    """TB-IR-KIND: a review with unknown target_kind is dropped cleanly (FIX 4).

    Pre-fix: ``_restore_investigation_reviews`` treated any non-'cpt' value
    as 'borehole' (the else branch in ``valid_targets`` dispatch).  A review
    with target_kind='not_a_real_kind' and a valid local borehole id would
    PASS the id-scope check (id IS in valid_bh_ids) and reach the INSERT —
    which then hit the DB CHECK constraint ``target_kind IN ('cpt', 'borehole')``,
    crashing the entire restore with a 500 IntegrityError.

    Post-fix: an explicit allow-list rejects the unknown kind BEFORE the id-
    scope check, the row is dropped with a WARNING, and the restore returns 200.
    The local borehole itself is still inserted successfully (the allow-list
    guard affects only the review row, not the borehole).

    Teeth: comment out the ``if target_kind not in ('cpt', 'borehole'):`` block
    in ``_restore_investigation_reviews`` (bundle_restore_core.py).  The restore
    would return 500 (DB CHECK violation), failing the status-code assertion below.
    """
    scene = idor_scene
    project_a_id: UUID = scene["project_a_id"]
    local_borehole_id = uuid7()

    payload = _garbage_kind_review_bundle(
        project_b_id=scene["project_b"].id,
        local_borehole_id=local_borehole_id,
    )

    resp = await async_client.post(
        f"/projects/{project_a_id}/restore",
        json=payload,
    )
    # TB-IR-KIND: the restore must succeed (200), not crash (500).
    assert resp.status_code == 200, (
        f"restore returned {resp.status_code}: {resp.text}. "
        "Expected 200 — the garbage-kind review should be dropped cleanly, "
        "not crash the whole restore via the DB CHECK violation. "
        "Teeth check: comment out the allow-list guard in "
        "_restore_investigation_reviews (bundle_restore_core.py)."
    )

    # The garbage-kind review must not appear in the DB.
    reviews_with_garbage_kind = list(
        (
            await db_session.execute(
                select(InvestigationReviewOrm).where(
                    InvestigationReviewOrm.target_id == local_borehole_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert reviews_with_garbage_kind == [], (
        f"Found {len(reviews_with_garbage_kind)} InvestigationReviewOrm row(s) "
        f"for the local borehole — the garbage-kind review was inserted despite the guard."
    )

    # The local borehole IS inserted (the review guard doesn't affect the borehole phase).
    from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm

    borehole = (
        await db_session.execute(select(BoreholeOrm).where(BoreholeOrm.id == local_borehole_id))
    ).scalar_one_or_none()
    assert borehole is not None, (
        f"Local borehole {local_borehole_id} was NOT inserted — "
        "the review guard incorrectly blocked the borehole too."
    )
