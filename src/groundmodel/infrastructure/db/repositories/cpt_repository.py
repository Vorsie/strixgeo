"""Repository for CPT persistence."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from groundmodel.infrastructure.db.models.cpt_orm import CptOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class CptRepository(GroundModelLogger):
    """Async CRUD operations for CptOrm records.

    Concurrent access is handled at two levels without a message broker:

    * **Connection pool** — SQLAlchemy keeps a pool of connections; each
      concurrent request gets its own ``AsyncSession`` and its own connection,
      so they never block each other at the Python layer.
    * **PostgreSQL MVCC** — the database uses Multi-Version Concurrency Control
      so reads never block writes and vice-versa.  Conflicting writes on the
      same row are serialised by PostgreSQL's row-level locking, not by us.

    A message broker (RabbitMQ, Redis Streams) belongs at the *application*
    layer when you need async task queuing — e.g. processing large batch imports
    in the background.  The ``TaskQueue`` abstraction in ``application/queue.py``
    is the hook for that.  The repository itself stays simple: one session, one
    unit of work.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active AsyncSession."""
        super().__init__(__name__)
        self._session = session

    async def save(self, cpt: CptOrm, *, flush: bool = True) -> None:
        """Persist a new or updated CPT (including its series).

        Parameters
        ----------
        flush : bool
            When True (default), flush the INSERT to PostgreSQL immediately so the
            CPT id round-trips to the DB. Bulk callers should pass False — flushing
            per-row burns one network round-trip per CPT (200 rows = 200 trips);
            batching with a single commit at the end sends them in one go.
        """
        self._session.add(cpt)
        if flush:
            await self._session.flush()
            self.success(f"CPT saved: {cpt.id} — {cpt.name}")

    async def get_by_id(self, cpt_id: UUID) -> CptOrm | None:
        """Return a CPT with its series loaded, or None if not found."""
        result = await self._session.execute(
            select(CptOrm).where(CptOrm.id == cpt_id).options(selectinload(CptOrm.series))
        )
        return result.scalar_one_or_none()

    async def list_all(self, app_project_id: UUID | None = None) -> list[CptOrm]:
        """Return all CPTs without loading series arrays.

        Parameters
        ----------
        app_project_id:
            When provided, only return CPTs belonging to that project.
            When None, return all CPTs (used by tests and admin tools).
        """
        stmt = select(CptOrm).order_by(CptOrm.created_at)
        if app_project_id is not None:
            stmt = stmt.where(CptOrm.app_project_id == app_project_id)
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def find_by_project_test(
        self, project_id: str, test_id: str, app_project_id: UUID | None = None
    ) -> CptOrm | None:
        """Return the first CPT matching (project_id, test_id) within the project, or None.

        Scoped to ``app_project_id`` when provided so the same GEF file may be
        imported into different app projects without triggering a duplicate error.
        Only called when both GEF identifiers are non-empty.
        """
        stmt = select(CptOrm).where(CptOrm.project_id == project_id, CptOrm.test_id == test_id)
        if app_project_id is not None:
            stmt = stmt.where(CptOrm.app_project_id == app_project_id)
        result = await self._session.execute(stmt.limit(1))
        return result.scalar_one_or_none()

    async def find_existing_test_ids(
        self, project_id: str, test_ids: list[str], app_project_id: UUID | None = None
    ) -> dict[str, UUID]:
        """Batch dedup: return ``{test_id: existing_cpt_id}`` for any test_id already imported.

        One query instead of N — used by bulk imports (e.g. DOV bbox) so a 200-CPT
        batch checks duplicates with one round-trip instead of 200.
        """
        if not test_ids:
            return {}
        stmt = select(CptOrm.test_id, CptOrm.id).where(
            CptOrm.project_id == project_id, CptOrm.test_id.in_(test_ids)
        )
        if app_project_id is not None:
            stmt = stmt.where(CptOrm.app_project_id == app_project_id)
        result = await self._session.execute(stmt)
        return {row.test_id: row.id for row in result}

    async def delete(self, cpt_id: UUID) -> None:
        """Delete a CPT and its series (cascade handles series row)."""
        cpt = await self.get_by_id(cpt_id)
        if cpt is not None:
            await self._session.delete(cpt)
            await self._session.flush()
            self.info(f"CPT deleted: {cpt_id}")
