"""The migration-parity test reaches the server CI names, and fails loudly under CI.

``tests/integration/db/test_migration_upgrade_from_empty.py`` builds its scratch
database on a PostgreSQL server. The ruling (open-source CI follow-up,
2026-10-17): take the server from ``DATABASE_URL`` when it is set, fall back to
the docker-compose server otherwise, and when ``CI`` is set an unreachable
server FAILS the test instead of skipping it, so a misconfigured CI service
never passes silently.
"""

from __future__ import annotations

from tests.integration.db.scratch_db_dsn import (
    ScratchServer,
    scratch_server_from_env,
    unreachable_server_is_fatal,
)


def test_without_database_url_the_docker_compose_server_is_used() -> None:
    """No ``DATABASE_URL``: 127.0.0.1:5433, groundmodel/groundmodel, maintenance db groundmodel."""
    server = scratch_server_from_env({})
    assert server == ScratchServer(
        host="127.0.0.1",
        port=5433,
        user="groundmodel",
        password="groundmodel",
        maintenance_db="groundmodel",
    )


def test_database_url_names_host_port_user_password_and_maintenance_db() -> None:
    """Every part of the server comes from ``DATABASE_URL`` when it is set."""
    env = {
        "DATABASE_URL": "postgresql+asyncpg://ci_user:s3cret@db.example:6543/groundmodel_integration"
    }
    server = scratch_server_from_env(env)
    assert server == ScratchServer(
        host="db.example",
        port=6543,
        user="ci_user",
        password="s3cret",
        maintenance_db="groundmodel_integration",
    )


def test_dsns_point_the_scratch_db_at_the_same_server() -> None:
    """The maintenance DSN keeps the URL's db; the scratch DSNs swap in the scratch db."""
    server = scratch_server_from_env(
        {"DATABASE_URL": "postgresql+asyncpg://u:p@h:1234/groundmodel_integration"}
    )
    assert server.maintenance_dsn() == "postgresql://u:p@h:1234/groundmodel_integration"
    assert server.scratch_sync_dsn("scratch_test") == "postgresql://u:p@h:1234/scratch_test"
    assert (
        server.scratch_async_dsn("scratch_test") == "postgresql+asyncpg://u:p@h:1234/scratch_test"
    )


def test_a_password_with_reserved_characters_survives_the_round_trip() -> None:
    """A percent-encoded password is decoded once and re-encoded in the DSNs."""
    server = scratch_server_from_env({"DATABASE_URL": "postgresql://u:p%40ss@h:5432/db_test"})
    assert server.password == "p@ss"
    assert server.maintenance_dsn() == "postgresql://u:p%40ss@h:5432/db_test"


def test_under_ci_an_unreachable_server_fails_the_test() -> None:
    """``CI`` set: an unreachable PostgreSQL is fatal, never a silent skip."""
    assert unreachable_server_is_fatal({"CI": "true"}) is True


def test_locally_an_unreachable_server_skips() -> None:
    """``CI`` unset (or empty): the test skips, so an offline laptop stays green."""
    assert unreachable_server_is_fatal({}) is False
    assert unreachable_server_is_fatal({"CI": ""}) is False
