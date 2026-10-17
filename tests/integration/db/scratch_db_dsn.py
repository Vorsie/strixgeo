"""Which PostgreSQL server the migration-parity test builds its scratch DB on.

``test_migration_upgrade_from_empty.py`` creates, migrates and drops a
throwaway database. The server it uses comes from ``DATABASE_URL`` when that
is set (CI names its PostGIS service there; the integration wrapper names the
local ``groundmodel_integration`` DB) and falls back to the docker-compose
server otherwise. The database named in the URL serves only as the maintenance
connection that issues ``CREATE`` / ``DROP DATABASE``.

Pure: reads the mapping it is given, never ``os.environ`` itself, so the unit
tests can pin it (``tests/unit/test_scratch_db_dsn.py``).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from sqlalchemy.engine import URL, make_url

# The docker-compose server (strix-db-1 publishes 127.0.0.1:5433 with
# groundmodel/groundmodel; verified against docker-compose.yml). The
# always-present ``groundmodel`` DB is the maintenance connection there.
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5433
DEFAULT_USER = "groundmodel"
DEFAULT_PASSWORD = "groundmodel"
DEFAULT_MAINTENANCE_DB = "groundmodel"

# psycopg2 drives the maintenance and reflection connections; asyncpg is the
# driver alembic's env.py runs the upgrade with.
SYNC_DRIVERNAME = "postgresql"
ASYNC_DRIVERNAME = "postgresql+asyncpg"


@dataclass(frozen=True)
class ScratchServer:
    """The PostgreSQL server a scratch database is created on.

    Attributes
    ----------
    host : str
        Server host name or address.
    port : int
        Server port.
    user : str
        Role used for every connection.
    password : str
        That role's password, decoded (no percent-encoding).
    maintenance_db : str
        Existing database the CREATE / DROP DATABASE statements run on.
    """

    host: str
    port: int
    user: str
    password: str
    maintenance_db: str

    def _dsn(self, drivername: str, database: str) -> str:
        """Render a DSN for ``database`` on this server with ``drivername``."""
        url = URL.create(
            drivername,
            username=self.user,
            password=self.password,
            host=self.host,
            port=self.port,
            database=database,
        )
        return url.render_as_string(hide_password=False)

    def maintenance_dsn(self) -> str:
        """Return the psycopg2 DSN of the maintenance database.

        Returns
        -------
        str
            ``postgresql://user:password@host:port/<maintenance_db>``.
        """
        return self._dsn(SYNC_DRIVERNAME, self.maintenance_db)

    def scratch_sync_dsn(self, scratch_db: str) -> str:
        """Return the psycopg2 DSN of the scratch database.

        Parameters
        ----------
        scratch_db : str
            Name of the throwaway database.

        Returns
        -------
        str
            ``postgresql://user:password@host:port/<scratch_db>``.
        """
        return self._dsn(SYNC_DRIVERNAME, scratch_db)

    def scratch_async_dsn(self, scratch_db: str) -> str:
        """Return the asyncpg DSN of the scratch database (for alembic's env.py).

        Parameters
        ----------
        scratch_db : str
            Name of the throwaway database.

        Returns
        -------
        str
            ``postgresql+asyncpg://user:password@host:port/<scratch_db>``.
        """
        return self._dsn(ASYNC_DRIVERNAME, scratch_db)


def scratch_server_from_env(env: Mapping[str, str]) -> ScratchServer:
    """Return the server named by ``DATABASE_URL``, or the docker-compose one.

    A part the URL leaves out (no port, no password) falls back to the
    docker-compose default for that part.

    Parameters
    ----------
    env : Mapping[str, str]
        The process environment, or a stand-in in tests.

    Returns
    -------
    ScratchServer
        The server to create the scratch database on.

    Raises
    ------
    sqlalchemy.exc.ArgumentError
        When ``DATABASE_URL`` is set but is not a parseable URL.
    """
    raw = env.get("DATABASE_URL", "").strip()
    if not raw:
        return ScratchServer(
            host=DEFAULT_HOST,
            port=DEFAULT_PORT,
            user=DEFAULT_USER,
            password=DEFAULT_PASSWORD,
            maintenance_db=DEFAULT_MAINTENANCE_DB,
        )
    url = make_url(raw)
    return ScratchServer(
        host=url.host or DEFAULT_HOST,
        port=url.port or DEFAULT_PORT,
        user=url.username or DEFAULT_USER,
        password=url.password if url.password is not None else DEFAULT_PASSWORD,
        maintenance_db=url.database or DEFAULT_MAINTENANCE_DB,
    )


def unreachable_server_is_fatal(env: Mapping[str, str]) -> bool:
    """Return True when an unreachable server must FAIL the test, not skip it.

    GitHub Actions sets ``CI``. There the PostGIS service is part of the job,
    so a server that does not answer is a misconfiguration that must turn the
    job red; on a developer machine it only means Docker is down.

    Parameters
    ----------
    env : Mapping[str, str]
        The process environment, or a stand-in in tests.

    Returns
    -------
    bool
        True when ``CI`` is set to a non-empty value.
    """
    return bool(env.get("CI", "").strip())
