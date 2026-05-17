"""Unit tests for the P2-E explicit-content seeding in ``create_contact``.

Owner directive 2026-05-17: when a ``section_id`` is provided in the
create-contact request body, the router appends the new contact's id to
that section's ``seeded_formation_contact_ids`` on a successful 201.

The 409 (DuplicateContactError) path must NOT touch the section — the
caller gets a 409 and no section mutation happens.

These tests exercise the router-level wiring via httpx + FastAPI's
``TestClient`` with every DB seam fully mocked so no real DB or network
I/O is required (matches the unit-test contract).
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from groundmodel.api.routers import geology as geology_module
from groundmodel.application.create_formation_contact import DuplicateContactError
from groundmodel.infrastructure.db.session import get_session

# ---------------------------------------------------------------------------
# Synthetic fixture data
# ---------------------------------------------------------------------------

PROJECT_ID = uuid4()
MODEL_ID = uuid4()
FORMATION_ID = uuid4()
BOREHOLE_ID = uuid4()
CONTACT_ID = uuid4()
SECTION_ID = uuid4()

_MODEL_ORM = SimpleNamespace(
    id=MODEL_ID,
    app_project_id=PROJECT_ID,
)

_CONTACT_ORM = SimpleNamespace(
    id=CONTACT_ID,
    model_id=MODEL_ID,
    formation_id=FORMATION_ID,
    borehole_id=BOREHOLE_ID,
    cpt_id=None,
    depth_top_m=3.5,
    source="manual_pick",
    confidence="medium",
    observation_id=None,
    observation_layer_id=None,
    notes=None,
    created_at="2026-01-01T00:00:00",
    updated_at="2026-01-01T00:00:00",
)

_SECTION_ORM = SimpleNamespace(
    id=SECTION_ID,
    app_project_id=PROJECT_ID,
    seeded_formation_contact_ids=[],
)


def _build_app() -> FastAPI:
    """Assemble a minimal FastAPI app with the geology aggregate router mounted.

    Uses the package-level ``geology.router`` (already carries the
    ``/projects/{project_id}/geology`` prefix) — the same shape as ``main.py``.
    """
    app = FastAPI()
    app.include_router(geology_module.router)
    return app


# ---------------------------------------------------------------------------
# P2-E happy path: 201 + section seeded
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_contact_with_section_id_seeds_section() -> None:
    """When section_id is provided and the contact is new (201), the router
    appends the contact id to the section's seeded_formation_contact_ids.
    """
    mock_session = AsyncMock()

    # session.get returns the model ORM on the scope-guard call.
    mock_session.get = AsyncMock(return_value=_MODEL_ORM)

    app = _build_app()
    app.dependency_overrides[get_session] = lambda: mock_session

    with (
        patch(
            "groundmodel.api.routers.geology.contacts.CreateFormationContact",
        ) as MockCreate,
        patch(
            "groundmodel.api.routers.geology.contacts.CrossSectionRepository",
        ) as MockSectionRepo,
    ):
        # CreateFormationContact.execute returns the new contact.
        mock_uc = MagicMock()
        mock_uc.execute = AsyncMock(return_value=_CONTACT_ORM)
        MockCreate.return_value = mock_uc

        # CrossSectionRepository.get returns a section owned by the project.
        # CrossSectionRepository.update returns the updated section.
        mock_section_repo = MagicMock()
        updated_section = SimpleNamespace(
            **{**vars(_SECTION_ORM), "seeded_formation_contact_ids": [CONTACT_ID]}
        )
        mock_section_repo.get = AsyncMock(return_value=_SECTION_ORM)
        mock_section_repo.update = AsyncMock(return_value=updated_section)
        MockSectionRepo.return_value = mock_section_repo

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/projects/{PROJECT_ID}/geology/models/{MODEL_ID}/contacts",
                json={
                    "formation_id": str(FORMATION_ID),
                    "depth_top_m": 3.5,
                    "borehole_id": str(BOREHOLE_ID),
                    "cpt_id": None,
                    "section_id": str(SECTION_ID),
                },
            )

        assert resp.status_code == 201, resp.text

        # The repo's update must have been called with the new contact id
        # merged into the seeded set.
        mock_section_repo.update.assert_awaited_once()
        call_args = mock_section_repo.update.await_args
        assert call_args is not None
        patched_section_id, patch_body = call_args.args
        assert patched_section_id == SECTION_ID
        assert CONTACT_ID in patch_body["seeded_formation_contact_ids"]

        # The session must have been committed after the section update.
        mock_session.commit.assert_awaited()


# ---------------------------------------------------------------------------
# P2-E 409 path: duplicate → section must NOT be touched
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_contact_409_does_not_seed_section() -> None:
    """On DuplicateContactError (409), the section is NOT seeded.

    The existing contact id is returned in the 409 body so the frontend
    can navigate to it; the section's seeded set is unchanged.
    """
    existing_id = uuid4()
    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=_MODEL_ORM)

    app = _build_app()
    app.dependency_overrides[get_session] = lambda: mock_session

    with (
        patch(
            "groundmodel.api.routers.geology.contacts.CreateFormationContact",
        ) as MockCreate,
        patch(
            "groundmodel.api.routers.geology.contacts.CrossSectionRepository",
        ) as MockSectionRepo,
    ):
        mock_uc = MagicMock()
        mock_uc.execute = AsyncMock(
            side_effect=DuplicateContactError(existing_contact_id=existing_id)
        )
        MockCreate.return_value = mock_uc

        mock_section_repo = MagicMock()
        mock_section_repo.get = AsyncMock(return_value=_SECTION_ORM)
        mock_section_repo.update = AsyncMock()
        MockSectionRepo.return_value = mock_section_repo

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/projects/{PROJECT_ID}/geology/models/{MODEL_ID}/contacts",
                json={
                    "formation_id": str(FORMATION_ID),
                    "depth_top_m": 3.5,
                    "borehole_id": str(BOREHOLE_ID),
                    "cpt_id": None,
                    "section_id": str(SECTION_ID),
                },
            )

        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["existing_contact_id"] == str(existing_id)

        # The 409 path exits before the seeding block — no update call.
        mock_section_repo.update.assert_not_awaited()


# ---------------------------------------------------------------------------
# P2-E no section_id: section repo not touched at all
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_contact_without_section_id_skips_section_repo() -> None:
    """When section_id is absent, the CrossSectionRepository is never called."""
    mock_session = AsyncMock()
    mock_session.get = AsyncMock(return_value=_MODEL_ORM)

    app = _build_app()
    app.dependency_overrides[get_session] = lambda: mock_session

    with (
        patch(
            "groundmodel.api.routers.geology.contacts.CreateFormationContact",
        ) as MockCreate,
        patch(
            "groundmodel.api.routers.geology.contacts.CrossSectionRepository",
        ) as MockSectionRepo,
    ):
        mock_uc = MagicMock()
        mock_uc.execute = AsyncMock(return_value=_CONTACT_ORM)
        MockCreate.return_value = mock_uc

        mock_section_repo = MagicMock()
        MockSectionRepo.return_value = mock_section_repo

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/projects/{PROJECT_ID}/geology/models/{MODEL_ID}/contacts",
                json={
                    "formation_id": str(FORMATION_ID),
                    "depth_top_m": 3.5,
                    "borehole_id": str(BOREHOLE_ID),
                    "cpt_id": None,
                    # section_id intentionally absent
                },
            )

        assert resp.status_code == 201, resp.text
        # No section_id → section repo constructor never called.
        MockSectionRepo.assert_not_called()
