"""Unit tests for the `migrate.py` CLI shim — argument parsing + exit-code mapping.

`main()` is exercised with `DatabaseMigrator` monkeypatched to a fake so no
real event loop work or I/O happens; these tests pin the exit-code contract
documented in the module docstring, not the migration logic itself (that is
`test_database_migrator.py`'s job).
"""

from __future__ import annotations

import pytest

from groundmodel.infrastructure.db import migrate
from groundmodel.infrastructure.db.database_migrator import (
    DatabaseMigratorError,
    NewerDatabaseError,
)
from groundmodel.infrastructure.db.database_migrator_constants import (
    EXIT_CODE_BY_STAGE,
    EXIT_CODE_NEWER_DATABASE,
    EXIT_CODE_UNEXPECTED,
    STAGE_ALEMBIC,
    STAGE_BACKUP,
    STAGE_POSTGIS,
)


class _FakeMigrator:
    """Stand-in for `DatabaseMigrator` — records the call, raises what it's told to."""

    def __init__(self, *, error: Exception | None = None) -> None:
        self._error = error
        self.migrate_calls: list[tuple[str, float]] = []

    async def migrate(self, database_url: str, *, timeout_seconds: float) -> None:
        """Record the call and raise the configured error, if any."""
        self.migrate_calls.append((database_url, timeout_seconds))
        if self._error is not None:
            raise self._error


def _patch_migrator(monkeypatch: pytest.MonkeyPatch, fake: _FakeMigrator) -> None:
    """Point `migrate.DatabaseMigrator` at a factory returning `fake`."""
    monkeypatch.setattr(migrate, "DatabaseMigrator", lambda: fake)


def test_main_returns_zero_on_success(monkeypatch: pytest.MonkeyPatch):
    """A clean migration returns exit code 0 and passes the parsed args through."""
    fake = _FakeMigrator()
    _patch_migrator(monkeypatch, fake)

    exit_code = migrate.main(
        ["--database-url", "postgresql+asyncpg://u:p@h:1/db", "--timeout", "5"]
    )

    assert exit_code == 0
    assert fake.migrate_calls == [("postgresql+asyncpg://u:p@h:1/db", 5.0)]


@pytest.mark.parametrize("stage", [STAGE_POSTGIS, STAGE_ALEMBIC, STAGE_BACKUP])
def test_main_maps_each_named_stage_to_its_exit_code(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], stage: str
):
    """Each STAGE_* failure maps to its documented exit code and names the stage on stderr."""
    fake = _FakeMigrator(error=DatabaseMigratorError(stage, f"{stage} blew up"))
    _patch_migrator(monkeypatch, fake)

    exit_code = migrate.main(["--database-url", "postgresql+asyncpg://u:p@h:1/db"])

    assert exit_code == EXIT_CODE_BY_STAGE[stage]
    assert f"failed during {stage}" in capsys.readouterr().err


def test_main_maps_a_newer_database_to_its_own_exit_code(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    """A newer-database failure gets its own exit code + names the cause on stderr.

    The launcher branches on this code to show "install the current version;
    your data is intact" rather than a generic migration-failed dialog (H2c/M8).
    """
    fake = _FakeMigrator(
        error=NewerDatabaseError(
            "zz99notarealrevision",
            "This project's database was written by a newer version of StrixGeo — "
            "your data is intact.",
        )
    )
    _patch_migrator(monkeypatch, fake)

    exit_code = migrate.main(["--database-url", "postgresql+asyncpg://u:p@h:1/db"])

    assert exit_code == EXIT_CODE_NEWER_DATABASE
    err = capsys.readouterr().err
    assert "newer version of StrixGeo" in err
    assert "intact" in err


def test_main_returns_unexpected_code_on_a_non_migrator_error(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
):
    """An error outside the four named stages still exits non-zero, naming itself unexpected."""
    fake = _FakeMigrator(error=RuntimeError("something nobody planned for"))
    _patch_migrator(monkeypatch, fake)

    exit_code = migrate.main(["--database-url", "postgresql+asyncpg://u:p@h:1/db"])

    assert exit_code == EXIT_CODE_UNEXPECTED
    assert "unexpectedly" in capsys.readouterr().err
