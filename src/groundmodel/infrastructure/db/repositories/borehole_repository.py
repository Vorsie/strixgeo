"""Repository for Borehole persistence."""

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value
from sqlalchemy.orm.interfaces import LoaderOption

from groundmodel.domain.services.elevation_rollback import (
    ElevationState,
    resolve_elevation_change,
)
from groundmodel.infrastructure.codelists.vertical_crs import default_vertical_epsg
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.lab_test_family_constants import (
    LAB_TEST_RELATIONSHIP_NAMES,
)
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# Names of the lab-test relationships on ``SampleOrm`` — used by the
# scoped ``get_by_id`` path (debt #2) to decide which selectinload
# chains to attach and which to stamp with empty lists. Derived from
# the shared LAB_TEST_FAMILIES registry (single source of truth for
# the family list); order is the canonical display order so the
# route's query-parameter validation can surface a stable "valid
# values" message. The name is re-exported here because the borehole
# router + its tests import it from this module.
LAB_TEST_RELATIONSHIPS: tuple[str, ...] = LAB_TEST_RELATIONSHIP_NAMES


def borehole_full_tree_options(include_set: set[str] | None = None) -> list[LoaderOption]:
    """Build the selectinload option list for the full borehole detail tree.

    Single source of truth for the borehole eager-load chain
    (drill_segments, field_log_intervals, observations → layers →
    admixtures, samples → the six lab-test families). Shared by
    :meth:`BoreholeRepository.get_by_id` / :meth:`get_many` (dynamic
    ``include_lab_tests`` variant), ``ProjectRepository.duplicate`` and
    the bundle build — previously each carried its own byte-identical
    copy, so adding a seventh lab-test family needed edits in four
    places.

    Uses ``selectinload`` rather than ``joinedload`` so each collection
    comes back as one extra round-trip per type — keeps the parent row
    small and avoids a Cartesian explosion, and each child query
    receives the parent ids in a single ``IN (...)`` so the count is
    constant in the number of boreholes.

    Parameters
    ----------
    include_set : set[str] | None
        ``None`` (default) loads all six lab-test families. Otherwise
        only the named families get a selectinload chain — the bare
        ``samples`` collection is always loaded so excluded families
        still have samples to stamp empty on.

    Returns
    -------
    list[LoaderOption]
        Loader options ready for ``select(BoreholeOrm).options(*...)``.
    """
    options: list[LoaderOption] = [
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
    return options


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

    @staticmethod
    def _validated_include_set(include_lab_tests: Iterable[str] | None) -> set[str] | None:
        """Validate ``include_lab_tests`` against the known family names.

        Parameters
        ----------
        include_lab_tests : Iterable[str] | None
            Caller-supplied family names, or ``None`` for "all".

        Returns
        -------
        set[str] | None
            The validated set, or ``None`` when all families are wanted.

        Raises
        ------
        ValueError
            When a name isn't in ``LAB_TEST_RELATIONSHIPS``. Defensive —
            callers should validate input before reaching here, but a
            hard error beats a silent mis-load.
        """
        if include_lab_tests is None:
            return None
        include_set = set(include_lab_tests)
        unknown = include_set - set(LAB_TEST_RELATIONSHIPS)
        if unknown:
            raise ValueError(
                f"Unknown lab-test relationship(s): {sorted(unknown)!r}. "
                f"Valid: {LAB_TEST_RELATIONSHIPS!r}",
            )
        return include_set

    @staticmethod
    def _stamp_excluded_families(
        boreholes: Iterable[BoreholeOrm], include_set: set[str] | None
    ) -> None:
        """Stamp excluded lab-test families empty on every sample.

        For excluded families, an empty list is written on every sample
        so Pydantic's ``model_validate`` sees ``[]`` rather than
        triggering a lazy load (which fails with ``MissingGreenlet``
        under async SQLAlchemy because Pydantic's attribute walk runs
        without an active greenlet). ``set_committed_value`` writes the
        attribute WITHOUT marking the relationship dirty — no spurious
        UPDATE on the next flush.

        Parameters
        ----------
        boreholes : Iterable[BoreholeOrm]
            Loaded boreholes whose samples get stamped.
        include_set : set[str] | None
            The loaded families; ``None`` (all loaded) is a no-op.
        """
        if include_set is None:
            return
        excluded = [r for r in LAB_TEST_RELATIONSHIPS if r not in include_set]
        for borehole in boreholes:
            for sample in borehole.samples:
                for rel_name in excluded:
                    set_committed_value(sample, rel_name, [])

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
            # Id at SUCCESS, name at DEBUG: a borehole name carries the site
            # code — client-identifying text that must not sit on an always-on
            # line in the unredacted ``backend.log``.
            self.success(f"Borehole saved: {borehole.id}")
            self.debug(f"Borehole saved: {borehole.id} — name {borehole.name!r}")

    async def get_by_id(
        self,
        borehole_id: UUID,
        *,
        include_lab_tests: Iterable[str] | None = None,
        app_project_id: UUID | None = None,
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
        app_project_id : UUID | None
            When provided, the project-scope predicate is fused into the
            single fetch query so a cross-project id returns ``None``
            (→ 404 at the router) WITHOUT a second round-trip. This is the
            IDOR scope guard (debt #4 / VULN-6): doing it in the WHERE
            clause keeps the section-open hot path one query per borehole
            (cf. debt #39) instead of adding a pre-check SELECT.

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
        include_set = self._validated_include_set(include_lab_tests)

        stmt = select(BoreholeOrm).where(BoreholeOrm.id == borehole_id)
        if app_project_id is not None:
            # IDOR scope guard fused into the fetch — see app_project_id docstring.
            stmt = stmt.where(BoreholeOrm.app_project_id == app_project_id)
        stmt = stmt.options(*borehole_full_tree_options(include_set))
        result = await self._session.execute(stmt)
        borehole = result.scalar_one_or_none()
        if borehole is None:
            return None

        self._stamp_excluded_families([borehole], include_set)
        return borehole

    async def get_many(
        self,
        borehole_ids: list[UUID],
        *,
        include_lab_tests: Iterable[str] | None = None,
        app_project_id: UUID | None = None,
    ) -> list[BoreholeOrm]:
        """Fetch many borehole detail trees in one query (debt #39).

        Used by ``POST /borehole/detail-batch`` to fold N per-borehole
        round-trips on section open into one DB query. Same eager-load
        + ``include_lab_tests`` discipline as :meth:`get_by_id`; the
        only structural difference is the ``IN (...)`` predicate
        instead of ``id == :id``. SQLAlchemy's ``selectinload`` then
        issues ONE batched child query per relationship for ALL N
        parent borehole ids — count is constant in N, not 12 * N.

        Order of the returned list is not guaranteed to match
        ``borehole_ids``; the caller (cross-section panel) indexes
        results by borehole id (same convention as
        ``CptRepository.get_many_with_series``).

        Parameters
        ----------
        borehole_ids
            Borehole row ids the caller wants detail for.
        include_lab_tests
            Same semantics as :meth:`get_by_id` — ``None`` loads every
            lab-test family; an iterable of family names loads only
            those (the rest stamped as ``[]`` via
            ``set_committed_value`` so Pydantic's attribute walk does
            not lazy-load under async).
        app_project_id
            Project scope guard (debt #4 / VULN-6): when supplied, the
            IN predicate is fused with the project predicate so a
            crafted batch can't pull a foreign-project borehole by
            guessing its UUID. ``None`` is for tests / admin tools.

        Returns
        -------
        list[BoreholeOrm]
            Boreholes whose id is in ``borehole_ids`` AND (when
            ``app_project_id`` is given) belong to that project.
            Unknown ids drop silently.

        Raises
        ------
        ValueError
            When ``include_lab_tests`` contains a name that isn't in
            ``LAB_TEST_RELATIONSHIPS``.
        """
        if not borehole_ids:
            return []

        include_set = self._validated_include_set(include_lab_tests)

        stmt = select(BoreholeOrm).where(BoreholeOrm.id.in_(borehole_ids))
        if app_project_id is not None:
            stmt = stmt.where(BoreholeOrm.app_project_id == app_project_id)
        stmt = stmt.options(*borehole_full_tree_options(include_set))
        result = await self._session.execute(stmt)
        boreholes = list(result.scalars().all())

        self._stamp_excluded_families(boreholes, include_set)
        return boreholes

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

        ALWAYS scoped to ``app_project_id``: to the given project, or — when
        ``None`` — to the null-project scope (``app_project_id IS NULL``), never
        "any project". The DOV ``project_id`` + ``test_id`` pair is public to
        anyone holding the record, so an UNSCOPED lookup would let an import that
        omits ``app_project_id`` match — and, on the refresh-on-duplicate path,
        overwrite — a borehole that belongs to a different app project (audit
        C2b, mirroring the CPT fix). The same DOV record can still be imported
        into different projects because each import only ever sees its own
        project's rows.
        """
        stmt = select(BoreholeOrm).where(
            BoreholeOrm.project_id == project_id, BoreholeOrm.test_id == test_id
        )
        if app_project_id is not None:
            stmt = stmt.where(BoreholeOrm.app_project_id == app_project_id)
        else:
            stmt = stmt.where(BoreholeOrm.app_project_id.is_(None))
        result = await self._session.execute(stmt.limit(1))
        return result.scalar_one_or_none()

    async def find_existing_test_ids(
        self, project_id: str, test_ids: list[str], app_project_id: UUID | None = None
    ) -> dict[str, UUID]:
        """Batch dedup: return ``{test_id: existing_borehole_id}`` for already-imported ids.

        One query for any number of ids — used by bulk imports (DOV bbox) so a
        500-borehole batch checks duplicates with a single round-trip instead
        of 500.

        Scoped to ``app_project_id`` the same way as ``find_by_project_test``:
        to the given project, or the null-project scope when ``None`` — never
        across every project (audit C2b). The DOV bulk callers always pass a
        real project, so this is a no-op for them and closes the same
        cross-project match by construction.
        """
        if not test_ids:
            return {}
        stmt = select(BoreholeOrm.test_id, BoreholeOrm.id).where(
            BoreholeOrm.project_id == project_id, BoreholeOrm.test_id.in_(test_ids)
        )
        if app_project_id is not None:
            stmt = stmt.where(BoreholeOrm.app_project_id == app_project_id)
        else:
            stmt = stmt.where(BoreholeOrm.app_project_id.is_(None))
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

        Setting a value stamps ``MANUAL``. The first manual override of an
        imported (DOV/GEF) Z snapshots that upstream triple; clearing then
        restores the surveyed Z instead of nulling the row (debt #21), via
        the shared pure ``resolve_elevation_change`` (same logic as CPT).

        Loads the row WITHOUT the heavy child collections — the patch handler
        only needs the header columns to return a list-item-compatible
        response. Returns ``None`` when the id does not exist.
        """
        stmt = select(BoreholeOrm).where(BoreholeOrm.id == borehole_id)
        result = await self._session.execute(stmt)
        borehole = result.scalar_one_or_none()
        if borehole is None:
            return None
        new_state = resolve_elevation_change(
            ElevationState(
                elevation_m=borehole.elevation_m,
                z_epsg=borehole.z_epsg,
                source=borehole.elevation_source,
                original_elevation_m=borehole.original_elevation_m,
                original_z_epsg=borehole.original_z_epsg,
                original_source=borehole.original_elevation_source,
            ),
            new_elevation_m=elevation_m,
            new_z_epsg=z_epsg,
            default_z_epsg=default_vertical_epsg(borehole.epsg),
        )
        borehole.elevation_m = new_state.elevation_m
        borehole.z_epsg = new_state.z_epsg
        borehole.elevation_source = new_state.source
        borehole.original_elevation_m = new_state.original_elevation_m
        borehole.original_z_epsg = new_state.original_z_epsg
        borehole.original_elevation_source = new_state.original_source
        await self._session.flush()
        self.success(
            f"Borehole {borehole_id} elevation updated to {new_state.elevation_m} "
            f"({new_state.z_epsg}) source={new_state.source}"
        )
        return borehole
