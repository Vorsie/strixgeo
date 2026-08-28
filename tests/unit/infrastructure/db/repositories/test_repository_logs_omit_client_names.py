"""An always-on repository log line names no client.

Security contract (owner directive: "no user data should ever leak"). The
backend's ``backend.log`` is not redacted on disk and can travel to support in
a crash bundle, so a line written at an always-on level (INFO / SUCCESS /
WARNING) must not carry client-identifying text — a project name, a CPT or
borehole name, a cross-section name that echoes a site. The stable id (a UUID)
is what a support engineer needs to ask "which record was it"; the
human-readable name belongs at DEBUG, which a shipped build suppresses.

These pins are phrased in the leak's own terms: "the saved-row log line names
no client". Pure — the AsyncSession is mocked, no DB.
"""

from __future__ import annotations

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from groundmodel.infrastructure.db.repositories.borehole_repository import BoreholeRepository
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.db.repositories.cross_section_repository import (
    CrossSectionRepository,
)
from groundmodel.infrastructure.db.repositories.geology_repository import GeologyRepository
from groundmodel.infrastructure.db.repositories.project_repository import ProjectRepository

# A name that names both the client (the employer) and the site — exactly the
# kind of string a consultancy cannot let leave the building.
CLIENT_NAME = "Kaai 42 — Acme Geotechniek NV"


def _mock_session() -> MagicMock:
    """An ``AsyncSession`` stand-in that assigns a PK on flush, like Postgres.

    The repositories under test call ``add`` then ``flush`` then log. A real
    flush is what populates a DB-side id; here the mock assigns one so the log
    line has an id to carry whether or not the ORM set it client-side.
    """
    session = MagicMock()
    added: list[object] = []

    def _add(obj: object) -> None:
        added.append(obj)

    async def _flush() -> None:
        for obj in added:
            if getattr(obj, "id", None) is None:
                obj.id = uuid4()

    session.add = MagicMock(side_effect=_add)
    session.flush = AsyncMock(side_effect=_flush)
    session.execute = AsyncMock()
    return session


def _always_on(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    """Records written at INFO or higher — what a shipped build keeps."""
    return [r for r in caplog.records if r.levelno >= logging.INFO]


def _debug(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    """Records written below INFO — suppressed in a shipped build."""
    return [r for r in caplog.records if r.levelno < logging.INFO]


def _assert_name_only_at_debug(caplog: pytest.LogCaptureFixture) -> None:
    """No always-on line carries the client name; a DEBUG line still does.

    The second half guards against "fixing" the leak by deleting the line —
    the name must remain recoverable at DEBUG (CLAUDE.md Definition of Done
    keeps per-item detail at DEBUG).
    """
    assert not any(CLIENT_NAME in r.getMessage() for r in _always_on(caplog)), (
        "an always-on log line named the client"
    )
    assert any(CLIENT_NAME in r.getMessage() for r in _debug(caplog)), (
        "the human-readable name was dropped entirely instead of demoted to DEBUG"
    )


@pytest.mark.asyncio
async def test_project_save_line_names_no_client(caplog: pytest.LogCaptureFixture) -> None:
    """A saved project's always-on line carries the id, not the project name."""
    repo = ProjectRepository(_mock_session())
    project = SimpleNamespace(id=uuid4(), name=CLIENT_NAME)

    with caplog.at_level(logging.DEBUG):
        await repo.save(project)  # type: ignore[arg-type]

    _assert_name_only_at_debug(caplog)


@pytest.mark.asyncio
async def test_cpt_save_line_names_no_client(caplog: pytest.LogCaptureFixture) -> None:
    """A saved CPT's always-on line carries the id, not the test_id name."""
    repo = CptRepository(_mock_session())
    cpt = SimpleNamespace(id=uuid4(), name=CLIENT_NAME)

    with caplog.at_level(logging.DEBUG):
        await repo.save(cpt)  # type: ignore[arg-type]

    _assert_name_only_at_debug(caplog)


@pytest.mark.asyncio
async def test_borehole_save_line_names_no_client(caplog: pytest.LogCaptureFixture) -> None:
    """A saved borehole's always-on line carries the id, not the name."""
    repo = BoreholeRepository(_mock_session())
    borehole = SimpleNamespace(id=uuid4(), name=CLIENT_NAME)

    with caplog.at_level(logging.DEBUG):
        await repo.save(borehole)  # type: ignore[arg-type]

    _assert_name_only_at_debug(caplog)


@pytest.mark.asyncio
async def test_formation_create_line_names_no_client(caplog: pytest.LogCaptureFixture) -> None:
    """A created formation's always-on line carries the id, not the name."""
    repo = GeologyRepository(_mock_session())

    with caplog.at_level(logging.DEBUG):
        await repo.create_formation(uuid4(), name=CLIENT_NAME, color="#abcdef")

    _assert_name_only_at_debug(caplog)


@pytest.mark.asyncio
async def test_model_create_line_names_no_client(caplog: pytest.LogCaptureFixture) -> None:
    """A created model's always-on line carries the id, not the name."""
    repo = GeologyRepository(_mock_session())

    with caplog.at_level(logging.DEBUG):
        await repo.create_model(uuid4(), name=CLIENT_NAME)

    _assert_name_only_at_debug(caplog)


@pytest.mark.asyncio
async def test_cross_section_create_line_names_no_client(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A created cross-section's always-on line carries the id, not the name."""
    repo = CrossSectionRepository(_mock_session())

    with caplog.at_level(logging.DEBUG):
        await repo.create(
            uuid4(),
            name=CLIENT_NAME,
            start_x=0.0,
            start_y=0.0,
            end_x=1.0,
            end_y=1.0,
            epsg=31370,
            projection_buffer_m=25.0,
        )

    _assert_name_only_at_debug(caplog)
