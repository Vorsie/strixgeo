"""Repository for Borehole persistence."""

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value

from groundmodel.infrastructure.codelists.vertical_crs import default_vertical_epsg
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Names of the lab-test relationships on ``SampleOrm`` — used by the
# scoped ``get_by_id`` path (debt #2) to decide which selectinload
# chains to attach and which to stamp with empty lists. Order is the
# canonical display order so the route's query-parameter validation
# can surface a stable "valid values" message.
LAB_TEST_RELATIONSHIPS: tuple[str, ...] = (
    "grain_sizes",
    "atterberg_limits_tests",
    "caco3_content_tests",
    "organic_content_tests",
    "water_content_tests",
    "scalar_lab_tests",
)


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

    async def get_by_id(
        self,
        borehole_id: UUID,
        *,
        include_lab_tests: Iterable[str] | None = None,
    ) -> BoreholeOrm | None:
        """Return a borehole with all of its child collections loaded, or ``None``.

        Loads the full borehole detail tree:

        * drill_segments and field_log_intervals (Phase A1)
        * observations → layers → admixtures (Phase A2)
        * samples → grain_sizes / atterberg_limits_tests / caco3_content_tests
          / organic_content_tests / water_content_tests (Phase A3)

        Uses ``selectinload`` rather than ``joinedload`` so each collection
        comes back as one extra round-trip per type — keeps the parent row
        small and avoids a Cartesian explosion. Default (``include_lab_tests
        is None``) loads all six lab-test families = 12 round-trips for a
        fully-populated borehole. Each query receives the relevant parent ids
        in a single ``IN (...)``, so the count is constant in the borehole's
        size — a 100-sample borehole still issues 12 queries, not 100.

        Parameters
        ----------
        borehole_id : UUID
            Primary key.
        include_lab_tests : Iterable[str] | None
            When ``None`` (default), eager-load all six lab-test families —
            preserves the existing full-tree behaviour. When an iterable of
            relationship names (``"grain_sizes"``, ``"atterberg_limits_tests"``,
            ...) is supplied, ONLY those families are loaded; the others
            are stamped with empty lists via ``set_committed_value`` so
            Pydantic's ``model_validate`` walk doesn't trigger a
            ``MissingGreenlet`` lazy load from inside the attribute
            extractor (async SQLAlchemy has no greenlet there).
            Caller-side validation lives in the API router.

        Returns
        -------
        BoreholeOrm | None
            The borehole with its child tree, or ``None`` when the id
            doesn't exist.

        Raises
        ------
        ValueError
            When ``include_lab_tests`` contains a name that isn't in
            ``LAB_TEST_RELATIONSHIPS``. Defensive — callers should validate
            input before reaching here, but a hard error beats a silent
            mis-load.
        """
        include_set: set[str] | None
        if include_lab_tests is None:
            include_set = None
        else:
            include_set = set(include_lab_tests)
            unknown = include_set - set(LAB_TEST_RELATIONSHIPS)
            if unknown:
                raise ValueError(
                    f"Unknown lab-test relationship(s): {sorted(unknown)!r}. "
                    f"Valid: {LAB_TEST_RELATIONSHIPS!r}",
                )

        # Build the option list: always-loaded children + per-family
        # selectinload only for the requested set. The samples selectinload
        # itself is unconditional because every excluded family still needs
        # a sample to hang off; without it ``set_committed_value`` would
        # have nothing to stamp.
        options = [
            selectinload(BoreholeOrm.drill_segments),
            selectinload(BoreholeOrm.field_log_intervals),
            selectinload(BoreholeOrm.observations)
            .selectinload(ObservationOrm.layers)
            .selectinload(ObservationLayerOrm.admixtures),
            selectinload(BoreholeOrm.samples),
        ]
        for rel_name in LAB_TEST_RELATIONSHIPS:
            if include_set is None or rel_name in include_set:
                options.append(
                    selectinload(BoreholeOrm.samples).selectinload(getattr(SampleOrm, rel_name))
                )

        stmt = select(BoreholeOrm).where(BoreholeOrm.id == borehole_id).options(*options)
        result = await self._session.execute(stmt)
        borehole = result.scalar_one_or_none()
        if borehole is None:
            return None

        # For excluded families, stamp an empty list on every sample so
        # Pydantic's ``model_validate`` sees ``[]`` rather than triggering
        # a lazy load (which fails with ``MissingGreenlet`` under async
        # SQLAlchemy because Pydantic's attribute walk runs without an
        # active greenlet). ``set_committed_value`` writes the attribute
        # WITHOUT marking the relationship dirty — no spurious UPDATE on
        # the next flush.
        if include_set is not None:
            excluded = [r for r in LAB_TEST_RELATIONSHIPS if r not in include_set]
            for sample in borehole.samples:
                for rel_name in excluded:
                    set_committed_value(sample, rel_name, [])
        return borehole

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

    async def set_elevation(
        self, borehole_id: UUID, elevation_m: float | None, z_epsg: int | None
    ) -> BoreholeOrm | None:
        """Update the manually-entered surface elevation for a borehole.

        When ``z_epsg`` is ``None`` and an elevation is being set, the canonical
        vertical CRS for the row's horizontal EPSG is used (e.g. 31370 → 5710
        mTAW for Belgium, 28992 → 5709 NAP for the Netherlands).

        Loads the row WITHOUT the heavy child collections — the patch handler
        only needs the header columns to return a list-item-compatible
        response. Returns ``None`` when the id does not exist.
        """
        stmt = select(BoreholeOrm).where(BoreholeOrm.id == borehole_id)
        result = await self._session.execute(stmt)
        borehole = result.scalar_one_or_none()
        if borehole is None:
            return None
        borehole.elevation_m = elevation_m
        # Keep z_epsg paired with the elevation column. Clearing the value
        # clears the CRS too. Setting a value without an explicit CRS picks
        # the canonical pair for the row's horizontal EPSG.
        if elevation_m is None:
            borehole.z_epsg = None
        else:
            borehole.z_epsg = z_epsg if z_epsg is not None else default_vertical_epsg(borehole.epsg)
        await self._session.flush()
        self.success(
            f"Borehole {borehole_id} elevation updated to {elevation_m} ({borehole.z_epsg})"
        )
        return borehole
