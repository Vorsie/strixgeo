"""Repository for Borehole persistence."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class BoreholeRepository(GroundModelLogger):
    """Async CRUD operations for ``BoreholeOrm`` records.

    Mirrors the ``CptRepository`` access pattern: one ``AsyncSession`` per
    request, batch-friendly ``find_existing_test_ids`` for bulk dedup, no
    background queueing at this layer (see CptRepository docstring for the
    concurrency rationale).
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession``."""
        super().__init__(__name__)
        self._session = session

    async def save(self, borehole: BoreholeOrm, *, flush: bool = True) -> None:
        """Persist a new or updated borehole and its children.

        Parameters
        ----------
        borehole : BoreholeOrm
            The row to persist. Children attached via the ORM relationships
            (``drill_segments``, ``field_log_intervals``) are inserted in the
            same flush via SQLAlchemy's cascade.
        flush : bool
            When ``True`` (default), flush the INSERT to PostgreSQL immediately
            so the borehole id round-trips. Bulk callers (DOV bbox import) pass
            ``False`` and commit once at the end — flushing per-row burns one
            network round-trip per borehole.
        """
        self._session.add(borehole)
        if flush:
            await self._session.flush()
            self.success(f"Borehole saved: {borehole.id} — {borehole.name}")

    async def get_by_id(self, borehole_id: UUID) -> BoreholeOrm | None:
        """Return a borehole with all of its child collections loaded, or ``None``.

        Loads drill_segments, field_log_intervals, samples, and the
        observation tree (observation → layers → admixtures). Uses
        ``selectinload`` rather than ``joinedload`` so each collection comes
        back as one extra round-trip per type — keeps the parent row small
        and avoids a Cartesian explosion if a borehole has many of each. The
        observation chain uses nested selectinload, which still issues only
        three queries total for the whole tree (one per level), regardless of
        how many observations or layers exist.
        """
        stmt = (
            select(BoreholeOrm)
            .where(BoreholeOrm.id == borehole_id)
            .options(
                selectinload(BoreholeOrm.drill_segments),
                selectinload(BoreholeOrm.field_log_intervals),
                selectinload(BoreholeOrm.samples),
                selectinload(BoreholeOrm.observations)
                .selectinload(ObservationOrm.layers)
                .selectinload(ObservationLayerOrm.admixtures),
            )
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_all(self, app_project_id: UUID | None = None) -> list[BoreholeOrm]:
        """Return all boreholes without loading children.

        Parameters
        ----------
        app_project_id : UUID | None
            When provided, only return boreholes belonging to that project.
        """
        stmt = select(BoreholeOrm).order_by(BoreholeOrm.created_at)
        if app_project_id is not None:
            stmt = stmt.where(BoreholeOrm.app_project_id == app_project_id)
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def find_by_project_test(
        self, project_id: str, test_id: str, app_project_id: UUID | None = None
    ) -> BoreholeOrm | None:
        """Return the first borehole matching ``(project_id, test_id)``, or ``None``.

        Used by single-borehole imports to detect duplicates before insert.
        Scoped to ``app_project_id`` when provided so the same borehole can be
        imported into different app projects.
        """
        stmt = select(BoreholeOrm).where(
            BoreholeOrm.project_id == project_id, BoreholeOrm.test_id == test_id
        )
        if app_project_id is not None:
            stmt = stmt.where(BoreholeOrm.app_project_id == app_project_id)
        result = await self._session.execute(stmt.limit(1))
        return result.scalar_one_or_none()

    async def find_existing_test_ids(
        self, project_id: str, test_ids: list[str], app_project_id: UUID | None = None
    ) -> dict[str, UUID]:
        """Batch dedup: return ``{test_id: existing_borehole_id}`` for already-imported ids.

        One query for any number of ids — used by bulk imports (DOV bbox) so a
        500-borehole batch checks duplicates with a single round-trip instead
        of 500.
        """
        if not test_ids:
            return {}
        stmt = select(BoreholeOrm.test_id, BoreholeOrm.id).where(
            BoreholeOrm.project_id == project_id, BoreholeOrm.test_id.in_(test_ids)
        )
        if app_project_id is not None:
            stmt = stmt.where(BoreholeOrm.app_project_id == app_project_id)
        result = await self._session.execute(stmt)
        return {row.test_id: row.id for row in result}

    async def delete(self, borehole_id: UUID) -> None:
        """Delete a borehole and its children (cascade handles all child rows)."""
        borehole = await self.get_by_id(borehole_id)
        if borehole is not None:
            await self._session.delete(borehole)
            await self._session.flush()
            self.info(f"Borehole deleted: {borehole_id}")
