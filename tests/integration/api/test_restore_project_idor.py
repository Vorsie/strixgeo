"""T-B: cross-project IDOR-via-restore security integration test.

The ``POST /projects/{project_id}/restore`` endpoint is the highest-trust-
from-disk input in the system — it materialises an entire project tree from a
``.strix`` bundle.  A crafted bundle could try to:

1. Override WHICH project gets populated — by shipping a different project id
   in ``payload.project.id`` than the URL's ``project_id``.
2. Inject contacts that reference formation rows owned by a DIFFERENT project —
   by shipping ``contacts[].formation_id`` pointing at a foreign project's
   formation UUID (not included in the bundle's own ``geological_formations``
   list).

Both are prevented by two independent guards in the restore pipeline:

* **URL-project-id wins** — ``_restore_project_bundle_impl`` always injects
  ``app_project_id = URL project_id`` into every inserted row, ignoring the
  payload's ``project.id``.

* **Formation FK guard** — ``_build_valid_formation_ids`` scopes the DB lookup
  to ``app_project_id == URL project_id`` (not the payload's project id), so
  project B's formation IDs are NEVER in the valid set when restoring into
  project A.  Contacts whose ``formation_id`` is not in the valid set are
  silently dropped via the ``if fid not in valid_formation_ids: continue``
  guard in ``_restore_geological_models``.

**How to verify this test has teeth:**

Comment out the guard at ``bundle_restore_litho.py`` line ~160:
``if fid is None or fid not in valid_formation_ids: continue``

The assertions TB-3 and TB-4 would FAIL because the contact would be inserted
with a FK pointing at project B's formation row.  The url-project-id guard
(TB-2 / TB-5) is independent and would still hold.

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

from groundmodel.infrastructure.db.models.formation_contact_orm import FormationContactOrm
from groundmodel.infrastructure.db.models.geological_formation_orm import GeologicalFormationOrm
from groundmodel.infrastructure.db.models.geological_model_orm import GeologicalModelOrm
from groundmodel.infrastructure.db.models.project_orm import ProjectOrm

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def idor_scene(
    db_session: AsyncSession,
    async_client: AsyncClient,
) -> dict:
    """Seed project B with a formation; create project A shell via the API.

    Returns
    -------
    dict
        Keys: project_a_id (UUID), project_b (ProjectOrm), formation_b (GeologicalFormationOrm),
        model_payload_id (UUID) — the model id crafted into the malicious bundle.
    """
    # --- Project B: seed directly into the DB (no API involved) ----
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
    # Commit so the async_client (which uses a separate engine) can see these rows.
    await db_session.commit()

    # --- Project A: create via API (gets its own UUID from the server) ----
    resp = await async_client.post("/projects/", json={"name": "Project-A (attacker target)"})
    assert resp.status_code == 201, f"Project-A creation failed: {resp.text}"
    project_a_id = UUID(resp.json()["id"])

    # UUID for the model we will inject in the malicious bundle.
    injected_model_id = uuid7()

    return {
        "project_a_id": project_a_id,
        "project_b": project_b,
        "formation_b": formation_b,
        "injected_model_id": injected_model_id,
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _malicious_bundle(project_b_id: UUID, formation_b_id: UUID, model_id: UUID) -> dict:
    """Build a bundle that tries to cross-reference project B's formation.

    The payload's ``project.id`` names project B (an IDOR attempt on the project
    level). The ``geological_formations`` list is EMPTY — so formation_b_id does
    NOT appear in the payload's formation list (it's a foreign-project row).
    The contact inside the model references ``formation_b_id`` directly —
    a cross-project FK injection attempt.

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
    return {
        "format_version": 4,
        # Payload claims to be project B — the URL project_id (A) must win.
        "project": {
            "id": str(project_b_id),
            "name": "INJECTED by attacker",
            "status": "active",
        },
        # No formations in the bundle — formation_b_id is NOT a valid payload ID.
        "geological_formations": [],
        "geological_models": [
            {
                "id": str(model_id),
                "name": "Injected Model",
                "kind": "geological",
                "is_active": False,
                "excluded_borehole_ids": [],
                # A contact referencing project B's formation — the IDOR target.
                "contacts": [
                    {
                        "id": str(uuid7()),
                        "formation_id": str(formation_b_id),
                        # Synthetic anchor (no borehole / CPT needed in the test).
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
        ],
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


# ---------------------------------------------------------------------------
# Tests
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
        "This test has teeth: remove the 'if fid not in valid_formation_ids: continue' "
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
