"""Repository for CPT persistence."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from groundmodel.domain.services.elevation_rollback import (
    ElevationState,
    resolve_elevation_change,
)
from groundmodel.domain.services.water_table_rollback import (
    WaterTableState,
    resolve_water_table_change,
)
from groundmodel.infrastructure.codelists.vertical_crs import default_vertical_epsg
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
            # Id at SUCCESS, name at DEBUG: the CPT name is its test_id, which
            # carries the project/site code — client-identifying text that must
            # not sit on an always-on line in the unredacted ``backend.log``.
            self.success(f"CPT saved: {cpt.id}")
            self.debug(f"CPT saved: {cpt.id} — name {cpt.name!r}")

    async def get_by_id(self, cpt_id: UUID) -> CptOrm | None:
        """Return a CPT with its series loaded, or None if not found."""
        result = await self._session.execute(
            select(CptOrm).where(CptOrm.id == cpt_id).options(selectinload(CptOrm.series))
        )
        return result.scalar_one_or_none()

    async def get_many_with_series(
        self,
        cpt_ids: list[UUID],
        app_project_id: UUID | None = None,
    ) -> list[CptOrm]:
        """Fetch many CPTs (with series eager-loaded) in one query.

        Used by ``POST /cpt/plot-batch`` to fold N per-CPT round-trips
        into one DB query. Order of the returned list isn't guaranteed
        to match ``cpt_ids``; the response indexer matches by row id
        rather than position. Unknown ids drop silently.

        Parameters
        ----------
        cpt_ids:
            CPT row ids the caller wants depth-series for.
        app_project_id:
            When provided, only return CPTs that belong to this project.
            This is the project-scope guard — without it, a caller in
            project A who knows or guesses a UUID from project B
            retrieves that foreign CPT's series. Always pass this from
            an API surface. The ``None`` default is for tests / admin
            tools that need cross-project reads.
        """
        if not cpt_ids:
            return []
        stmt = select(CptOrm).where(CptOrm.id.in_(cpt_ids)).options(selectinload(CptOrm.series))
        if app_project_id is not None:
            stmt = stmt.where(CptOrm.app_project_id == app_project_id)
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

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

    async def set_elevation(
        self, cpt_id: UUID, elevation_m: float | None, z_epsg: int | None
    ) -> CptOrm | None:
        """Update the manually-entered surface elevation for a CPT.

        When ``z_epsg`` is ``None`` and an elevation is being set, the canonical
        vertical CRS for the row's horizontal EPSG is used (e.g. 31370 → 5710
        mTAW for Belgium, 28992 → 5709 NAP for the Netherlands). Pass an
        explicit ``z_epsg`` to override.

        Setting a value stamps ``MANUAL``. The first manual override of an
        imported (DOV/GEF) Z snapshots that upstream triple; clearing then
        restores the surveyed Z instead of nulling the row (debt #21). The
        snapshot/restore decision is the shared pure
        ``resolve_elevation_change`` so CPT and borehole cannot drift.

        Returns the updated row (with ``series`` selectinload so callers can
        return a CptResponse without a second query), or ``None`` when the
        id does not exist.
        """
        cpt = await self.get_by_id(cpt_id)
        if cpt is None:
            return None
        new_state = resolve_elevation_change(
            ElevationState(
                elevation_m=cpt.elevation_m,
                z_epsg=cpt.z_epsg,
                source=cpt.elevation_source,
                original_elevation_m=cpt.original_elevation_m,
                original_z_epsg=cpt.original_z_epsg,
                original_source=cpt.original_elevation_source,
            ),
            new_elevation_m=elevation_m,
            new_z_epsg=z_epsg,
            default_z_epsg=default_vertical_epsg(cpt.epsg),
        )
        cpt.elevation_m = new_state.elevation_m
        cpt.z_epsg = new_state.z_epsg
        cpt.elevation_source = new_state.source
        cpt.original_elevation_m = new_state.original_elevation_m
        cpt.original_z_epsg = new_state.original_z_epsg
        cpt.original_elevation_source = new_state.original_source
        await self._session.flush()
        self.success(
            f"CPT {cpt_id} elevation updated to {new_state.elevation_m} "
            f"({new_state.z_epsg}) source={new_state.source}"
        )
        return cpt

    async def set_water_table(self, cpt_id: UUID, water_depth_m: float | None) -> CptOrm | None:
        """Set (or clear) the engineer's water-table depth for a CPT.

        Setting a value stamps ``WaterDepthSource.ENGINEER``, which outranks the
        file on a refresh-on-duplicate re-import.

        The FIRST override of a recorded depth snapshots it into
        ``original_water_depth_m`` / ``original_water_depth_source``, exactly as
        the collar keeps ``original_elevation_*`` (debt #21).  Passing ``None``
        then RESTORES that snapshot — the clear affordance's copy promises the
        file's value back, and this is what makes the promise true.  With no
        snapshot (a DOV CPT, or a depth the engineer invented) clearing returns
        the row to "nothing recorded": every consumer falls back to
        ``DEFAULT_GWT_DEPTH_M`` and labels the value assumed.

        The snapshot/restore decision is the shared pure
        ``resolve_water_table_change`` so this repository and the domain rule
        cannot drift.

        Parameters
        ----------
        cpt_id : UUID
            Primary key of the CPT row.
        water_depth_m : float | None
            Depth to groundwater below ground surface in metres (positive
            down), or ``None`` to clear.

        Returns
        -------
        CptOrm | None
            The updated row, or ``None`` when the id does not exist.
        """
        cpt = await self.get_by_id(cpt_id)
        if cpt is None:
            return None
        new_state = resolve_water_table_change(
            WaterTableState(
                water_depth_m=cpt.water_depth_m,
                source=cpt.water_depth_source,
                original_water_depth_m=cpt.original_water_depth_m,
                original_source=cpt.original_water_depth_source,
            ),
            new_water_depth_m=water_depth_m,
        )
        cpt.water_depth_m = new_state.water_depth_m
        cpt.water_depth_source = new_state.source
        cpt.original_water_depth_m = new_state.original_water_depth_m
        cpt.original_water_depth_source = new_state.original_source
        await self._session.flush()
        self.success(
            f"CPT {cpt_id} water table set to {cpt.water_depth_m} m "
            f"source={cpt.water_depth_source} "
            f"(rollback snapshot {cpt.original_water_depth_m})"
        )
        return cpt
