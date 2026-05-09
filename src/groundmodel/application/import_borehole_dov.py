"""Use case: import boreholes from DOV within a WGS84 bounding box.

Phase C1 scope: borehole headers + drill segments + field log.
Phase C2 extension: also fetch and attach all eight interpretation streams
(``ObservationOrm`` rows with their layers and admixtures) for newly-
imported boreholes — see ``ImportInterpretationsDov`` for the per-stream
WFS pipeline.
Phase C3 extension: also fetch and attach lab samples (``SampleOrm``)
plus grain-size lab tests (``GrainSizeOrm``) — see ``ImportSamplesDov``.
All four child collections (drill segments, field log, observations,
samples + grain-sizes) land in one single transaction commit.
"""

from __future__ import annotations

import time
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.import_borehole_dov_result import ImportBoreholeDovResult
from groundmodel.application.import_interpretations_dov import ImportInterpretationsDov
from groundmodel.application.import_interpretations_dov_result import (
    ImportInterpretationsDovResult,
)
from groundmodel.application.import_samples_dov import ImportSamplesDov
from groundmodel.application.import_samples_dov_result import ImportSamplesDovResult
from groundmodel.domain.models.borehole.borehole import Borehole
from groundmodel.infrastructure.db.models.borehole_orm import BoreholeOrm
from groundmodel.infrastructure.db.models.drill_segment_orm import DrillSegmentOrm
from groundmodel.infrastructure.db.models.field_log_interval_orm import (
    FieldLogIntervalOrm,
)
from groundmodel.infrastructure.db.repositories.borehole_repository import (
    BoreholeRepository,
)
from groundmodel.infrastructure.parsers.borehole.dov.borehole_parse_result import (
    BoreholeParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.borehole_wfs_row import (
    BoreholeWfsRow,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_boring_parser import (
    DovBoringParser,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_client import (
    DovBoreholeClient,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_constants import (
    DOV_HORIZONTAL_EPSG,
    DOV_VERTICAL_EPSG,
)
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.dov.dov_common import DOV_PROJECT_ID
from groundmodel.infrastructure.parsers.dov.dov_http import make_dov_async_client
from groundmodel.shared.config import settings
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.timing import ms_since


class ImportBoreholeDov(GroundModelLogger):
    """Use case: query DOV WFS for a bbox, download borehole XMLs, persist them.

    Mirrors ``ImportCptDov`` deliberately — same five-phase split (WFS
    discovery → parallel download+parse → batch dedup → persist queue →
    single commit), same error-handling story, same network → 502/503/504
    HTTP error mapping at the API boundary.

    The borehole XML cache lives in a ``boring/`` subdirectory of the
    shared DOV cache so boring permkeys never collide with sondering /
    interpretation / observation permkeys (DOV's ``YYYY-NNNNNN`` permkey
    format isn't globally unique across resource types).

    Parameters
    ----------
    session : AsyncSession
        Database session. All borehole rows for one bbox import are
        persisted under a single transaction commit at the end of the
        run, so a parse failure on one borehole does NOT roll back the
        rest — failures are isolated and reported in the result.
    """

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(__name__)
        self._session = session
        self._repo = BoreholeRepository(session)
        # Persistent on-disk caches rooted under per-resource subdirs so
        # boring / interpretation / sondering / observation permkeys never
        # collide (DOV's YYYY-NNNNNN permkey format isn't unique across
        # resource types).
        self._boring_cache = DovXmlCache(settings.dov_cache_dir / "boring")
        self._interpretation_cache = DovXmlCache(settings.dov_cache_dir / "interpretatie")
        # Phase C3 caches. The monster cache is plumbed in for symmetry —
        # not currently hit because Phase C3 reads samples from the WFS
        # row directly (see SampleWfsRow docstring). The observation
        # cache backs grain-size XML downloads.
        self._monster_cache = DovXmlCache(settings.dov_cache_dir / "monster")
        self._observatie_cache = DovXmlCache(settings.dov_cache_dir / "observatie")

    async def execute(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        app_project_id: UUID | None = None,
    ) -> ImportBoreholeDovResult:
        """Fetch and persist all boreholes within the WGS84 bounding box.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.
        app_project_id : UUID | None
            Project scope for storage and duplicate detection. Same
            ``boornummer`` in different ``app_project_id`` namespaces is
            allowed (the DOV record imports independently into each).

        Returns
        -------
        ImportBoreholeDovResult
            Summary of imported / duplicates / failed counts plus the
            UUIDs of all boreholes the caller now sees (new + pre-existing).
        """
        self.info(
            f"DOV borehole import started: "
            f"bbox W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}  "
            f"project_id={app_project_id}"
        )

        t_total = time.perf_counter()

        # Open ONE HTTP client and reuse it across the borehole download
        # phase AND the interpretation + sample phases. This keeps the
        # HTTP/2 connection pool warm so later phases don't pay
        # connect-handshake latency. Tuning lives in
        # ``dov_http.make_dov_async_client``.
        async with make_dov_async_client() as http:
            parsed = await self._fetch_boreholes(http, west, south, east, north)

            total = len(parsed)
            if total == 0:
                self.info("DOV import: no boreholes found in bbox — nothing to persist")
                return ImportBoreholeDovResult(imported=0, duplicates=0, failed=0, borehole_ids=[])

            for wfs_row, result in parsed:
                if result.has_errors:
                    self.warning(
                        f"DOV import: '{wfs_row.test_id}' parsed with errors — "
                        + ", ".join(f"{iss.code}: {iss.message}" for iss in result.issues)
                    )

            # Phase 3 — batch dedup. One IN-query for all incoming test_ids.
            t_dedup = time.perf_counter()
            test_ids = [row.test_id for row, _ in parsed if row.test_id]
            existing = (
                await self._repo.find_existing_test_ids(DOV_PROJECT_ID, test_ids, app_project_id)
                if test_ids
                else {}
            )
            self.info(
                f"DOV phase 3 (dedup query): {ms_since(t_dedup)} ms — "
                f"{len(existing)} of {len(test_ids)} already in project"
            )

            # Phase 4 — persist non-duplicates without committing per-row.
            # Build TWO maps: test_id → UUID (used by the C2 interpretation
            # phase, since interpretation WFS rows reference parent boreholes
            # by Proefnummer = test_id) and borehole_permkey → UUID (used by
            # the C3 sample phase, since the boringen:grondmonsters WFS rows
            # reference parent boreholes by URL whose last segment is the
            # permkey). Both maps grow together and stay in sync.
            t_persist = time.perf_counter()
            imported = 0
            duplicates = 0
            failed = 0
            borehole_ids: list[UUID] = []
            new_borehole_map: dict[str, UUID] = {}
            new_permkey_map: dict[str, UUID] = {}

            for i, (wfs_row, result) in enumerate(parsed, 1):
                existing_id = existing.get(wfs_row.test_id)
                if existing_id is not None:
                    duplicates += 1
                    borehole_ids.append(existing_id)
                    self.debug(
                        f"DOV import [{i}/{total}]: '{wfs_row.test_id}' "
                        f"already exists ({existing_id})"
                    )
                    continue

                try:
                    borehole_orm = self._build_orm(wfs_row, result, app_project_id)
                    await self._repo.save(borehole_orm, flush=False)
                    imported += 1
                    borehole_ids.append(borehole_orm.id)
                    new_borehole_map[wfs_row.test_id] = borehole_orm.id
                    new_permkey_map[wfs_row.permkey] = borehole_orm.id
                    self.debug(f"DOV import [{i}/{total}]: '{wfs_row.test_id}' → {borehole_orm.id}")
                except Exception as exc:
                    failed += 1
                    self.error(
                        f"DOV import [{i}/{total}]: persist failed for "
                        f"'{wfs_row.test_id}': {type(exc).__name__}: {exc}"
                    )

            self.info(
                f"DOV phase 4 (persist {imported} boreholes, no commit): {ms_since(t_persist)} ms"
            )

            # Phase 4b — fetch + attach interpretations for newly-imported
            # boreholes only. Duplicates keep whatever interpretations they
            # already had (re-importing the same bbox stays idempotent).
            interp_result = await self._fetch_and_attach_interpretations(
                http, west, south, east, north, new_borehole_map
            )

            # Phase 4c — fetch + attach samples + grain-size lab tests, same
            # idempotency rule as interpretations. Uses the permkey map so a
            # sample whose parent borehole was a duplicate is skipped.
            samples_result = await self._fetch_and_attach_samples(
                http, west, south, east, north, new_permkey_map
            )

            # Phase 5 — single commit flushes the whole batch (boreholes +
            # observations + layers + admixtures + samples + grain-sizes,
            # all in one transaction).
            if imported > 0:
                t_commit = time.perf_counter()
                await self._session.commit()
                self.info(
                    f"DOV phase 5 (commit batch of {imported} boreholes + "
                    f"{interp_result.attached} observations + "
                    f"{samples_result.samples_attached} samples + "
                    f"{samples_result.grain_sizes_attached} grain-sizes): "
                    f"{ms_since(t_commit)} ms"
                )

        self.success(
            f"DOV borehole import done in {ms_since(t_total)} ms: "
            f"{imported} imported, {duplicates} duplicates, {failed} failed  "
            f"(total={total}); "
            f"interpretations: {interp_result.attached} attached, "
            f"{interp_result.failed} failed; "
            f"samples: {samples_result.samples_attached} attached, "
            f"{samples_result.samples_failed} failed; "
            f"grain-sizes: {samples_result.grain_sizes_attached} attached, "
            f"{samples_result.grain_sizes_failed} failed; "
            f"atterberg: {samples_result.atterberg_attached}/{samples_result.atterberg_failed}; "
            f"caco3: {samples_result.caco3_attached}/{samples_result.caco3_failed}; "
            f"organic: {samples_result.organic_attached}/{samples_result.organic_failed}; "
            f"water: {samples_result.water_content_attached}/"
            f"{samples_result.water_content_failed}"
        )
        return ImportBoreholeDovResult(
            imported=imported,
            duplicates=duplicates,
            failed=failed,
            interpretations_attached=interp_result.attached,
            interpretations_failed=interp_result.failed,
            samples_attached=samples_result.samples_attached,
            samples_failed=samples_result.samples_failed,
            grain_sizes_attached=samples_result.grain_sizes_attached,
            grain_sizes_failed=samples_result.grain_sizes_failed,
            atterberg_attached=samples_result.atterberg_attached,
            atterberg_failed=samples_result.atterberg_failed,
            caco3_attached=samples_result.caco3_attached,
            caco3_failed=samples_result.caco3_failed,
            organic_attached=samples_result.organic_attached,
            organic_failed=samples_result.organic_failed,
            water_content_attached=samples_result.water_content_attached,
            water_content_failed=samples_result.water_content_failed,
            borehole_ids=borehole_ids,
        )

    async def _fetch_boreholes(
        self,
        http: httpx.AsyncClient,
        west: float,
        south: float,
        east: float,
        north: float,
    ) -> list[tuple[BoreholeWfsRow, BoreholeParseResult]]:
        """Run Phase 1+2 — WFS discovery + parallel download + stream-parse."""
        parser = DovBoringParser()
        try:
            t_fetch = time.perf_counter()
            parsed = await DovBoreholeClient(http, cache=self._boring_cache).fetch_bbox_processed(
                west, south, east, north, parser.parse
            )
            self.info(
                f"DOV phase 1+2 (WFS + download + parse): {ms_since(t_fetch)} ms — "
                f"{len(parsed)} boreholes ready"
            )
            return parsed
        except httpx.HTTPStatusError as exc:
            self.error(
                f"DOV WFS request failed with HTTP "
                f"{exc.response.status_code}: {exc}  "
                f"response body: {exc.response.text[:300]!r}"
            )
            raise
        except httpx.RequestError as exc:
            self.error(f"DOV network error during WFS/download phase: {type(exc).__name__}: {exc}")
            raise

    async def _fetch_and_attach_interpretations(
        self,
        http: httpx.AsyncClient,
        west: float,
        south: float,
        east: float,
        north: float,
        new_borehole_map: dict[str, UUID],
    ) -> ImportInterpretationsDovResult:
        """Run Phase 4b — interpretation orchestrator over the same bbox.

        Network errors here do NOT roll back the borehole-side persist queue;
        we degrade gracefully so a transient interpretation outage still
        leaves the user with the boreholes they imported. The exception is
        logged and surfaced as ``failed=fetched`` in the result.
        """
        if not new_borehole_map:
            self.info("DOV phase 4b (interpretations): no new boreholes — skipping fetch")
            return ImportInterpretationsDovResult()

        try:
            return await ImportInterpretationsDov(self._session).execute(
                west,
                south,
                east,
                north,
                new_borehole_map,
                self._interpretation_cache,
                http,
            )
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            # Don't propagate — keep boreholes alive even when interpretations
            # can't be fetched. The result will show 0 attached and the
            # parent log carries the error code for diagnosis.
            self.error(
                f"DOV phase 4b (interpretations): fetch failed, continuing "
                f"with boreholes only: {type(exc).__name__}: {exc}"
            )
            return ImportInterpretationsDovResult(failed=len(new_borehole_map))

    async def _fetch_and_attach_samples(
        self,
        http: httpx.AsyncClient,
        west: float,
        south: float,
        east: float,
        north: float,
        new_permkey_map: dict[str, UUID],
    ) -> ImportSamplesDovResult:
        """Run Phase 4c — sample + grain-size orchestrator over the same bbox.

        Same graceful-degradation contract as the interpretation phase: a
        transient lab-side outage doesn't abort the parent borehole commit.
        The result reports a fail-count so the API surfaces the partial
        success instead of silently dropping the failure.
        """
        if not new_permkey_map:
            self.info("DOV phase 4c (samples + grain-sizes): no new boreholes — skipping fetch")
            return ImportSamplesDovResult()

        try:
            return await ImportSamplesDov(self._session).execute(
                west,
                south,
                east,
                north,
                new_permkey_map,
                self._monster_cache,
                self._observatie_cache,
                http,
            )
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            self.error(
                f"DOV phase 4c (samples + grain-sizes): fetch failed, continuing "
                f"with boreholes + interpretations only: "
                f"{type(exc).__name__}: {exc}"
            )
            # Mark the whole sample-side batch as failed at the API surface.
            return ImportSamplesDovResult(samples_failed=len(new_permkey_map))

    # ------------------------------------------------------------------
    # Domain → ORM mapping
    # ------------------------------------------------------------------

    def _build_orm(
        self,
        wfs_row: BoreholeWfsRow,
        result: BoreholeParseResult,
        app_project_id: UUID | None,
    ) -> BoreholeOrm:
        """Merge WFS-row metadata into the parsed Borehole, then build the ORM row.

        The boring XML omits a few fields that live on the WFS row
        (``methode`` summary, the eight stream flags, sometimes ``Z_mTAW``).
        This is the merge point: WFS values fill in any gaps the parser
        left ``None``, never overwriting fields the XML did populate.
        """
        bh = self._merge_wfs(result.borehole, wfs_row)
        return BoreholeOrm(
            id=uuid7(),
            name=bh.name,
            app_project_id=app_project_id,
            project_id=DOV_PROJECT_ID,
            test_id=wfs_row.test_id,
            location_x=bh.location_x,
            location_y=bh.location_y,
            elevation_m=bh.elevation_m,
            epsg=bh.epsg,
            z_epsg=bh.z_epsg,
            location=None,  # PostGIS point — wired in Phase C2 / when the GIS path lands
            start_date=bh.start_date,
            drill_method=bh.drill_method,
            borehole_type=bh.borehole_type,
            purpose=bh.purpose,
            municipality=bh.municipality,
            executor=bh.executor,
            total_depth_m=bh.total_depth_m,
            water_table_depth_m=bh.water_table_depth_m,
            n_drill_segments=len(result.drill_segments),
            n_field_log_intervals=len(result.field_log),
            drill_segments=[
                DrillSegmentOrm(
                    id=uuid7(),
                    top_m=seg.top_m,
                    base_m=seg.base_m,
                    method=seg.method,
                )
                for seg in result.drill_segments
            ],
            field_log_intervals=[
                FieldLogIntervalOrm(
                    id=uuid7(),
                    top_m=fl.top_m,
                    base_m=fl.base_m,
                    kind=fl.kind.value,
                    value=fl.value,
                )
                for fl in result.field_log
            ],
        )

    @staticmethod
    def _merge_wfs(borehole: Borehole, wfs_row: BoreholeWfsRow) -> Borehole:
        """Fill XML-side ``None`` fields from the WFS row.

        Order matters: XML wins when both have a value (the XML is the more
        detailed source), WFS fills only when the parser left a field empty.
        Z_mTAW from the WFS row is the canonical fallback when the boring
        XML omitted Z (NO_ELEVATION warning emitted by the parser).

        We assign in place (the parser's Borehole is already constructed
        and we don't have a structural-update copy method); same instance
        is returned for clarity.
        """
        if borehole.drill_method is None and wfs_row.drill_method is not None:
            borehole.drill_method = wfs_row.drill_method
        if borehole.municipality is None and wfs_row.municipality is not None:
            borehole.municipality = wfs_row.municipality
        if borehole.executor is None and wfs_row.executor is not None:
            borehole.executor = wfs_row.executor
        if borehole.purpose is None and wfs_row.purpose is not None:
            borehole.purpose = wfs_row.purpose
        if borehole.total_depth_m is None and wfs_row.total_depth_m is not None:
            borehole.total_depth_m = wfs_row.total_depth_m

        # Coordinate fallbacks. The boring XML's gml:Point matches the WFS
        # row exactly when both ship them, so this only matters for boreholes
        # whose XML had a NO_COORDINATES error — we fill from WFS so the row
        # is at least mappable.
        if borehole.location_x == 0.0 and borehole.location_y == 0.0:
            if wfs_row.x is not None and wfs_row.y is not None:
                borehole.location_x = wfs_row.x
                borehole.location_y = wfs_row.y
                borehole.epsg = DOV_HORIZONTAL_EPSG
            else:
                # Both XML and WFS are missing x/y. The borehole is unmappable
                # and not safe to persist — raising here pushes the row into
                # the per-row failed-counter path in execute() so the rest of
                # the batch still imports.
                raise ValueError(
                    f"borehole '{borehole.name}' has no usable coordinates "
                    f"(boring XML emitted NO_COORDINATES and WFS row's "
                    f"X_mL72/Y_mL72 are also null)"
                )

        # Z (surface elevation) fallback — the user-flagged NO_ELEVATION
        # case. WFS Z_mTAW fills the gap when the boring XML omits Z.
        if borehole.elevation_m is None and wfs_row.z is not None:
            borehole.elevation_m = wfs_row.z
            borehole.z_epsg = DOV_VERTICAL_EPSG

        return borehole
