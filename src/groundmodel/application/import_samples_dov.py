"""Use case: import DOV samples + grain-size + scalar lab tests (Phase C3 + C4).

Companion to ``ImportBoreholeDov`` (C1) and ``ImportInterpretationsDov``
(C2). Runs against the SAME bbox and the SAME open ``AsyncSession`` as the
parent borehole orchestrator, persists nothing on its own — the parent
commits everything in one transaction (boreholes + interpretations +
samples + grain-sizes + Atterberg + CaCO3 + organic + water-content) at
the end of the flow.

Pipeline
--------
1. **Sample WFS query** — ``boringen:grondmonsters`` filtered to bbox,
   then narrowed to samples whose parent borehole is in the caller's
   ``permkey_to_borehole_id`` map.
2. **Sample persist (no commit)** — build the ``permkey_to_sample_id``
   map for downstream phases.
3. **Grain-size phase** (C3) — fetch observation XMLs in parallel,
   parse curves, persist ``GrainSizeOrm`` rows.
4. **Scalar lab tests phase** (C4) — four parallel WFS queries
   (Atterberg, CaCO3, organic-C, water-content), each filtered on
   ``parameter`` rather than ``parametergroep`` (Bodem_chemisch contains
   both CaCO3 and organic-C, so parameter-level scoping is required).
   Scalar tests carry ``resultaat`` directly in the WFS row — no XML
   fetch needed (verified live 2026-05-09).
5. Caller commits once.

Why samples + lab tests share an orchestrator
---------------------------------------------
The phases share the parent-permkey-map flow:

* C1 produces ``permkey_to_borehole_id`` → phase 1+2 here uses it →
  produces ``permkey_to_sample_id`` → phases 3+4 here use it.

A second class would force the parent to thread the sample-permkey map
back out and back in again with no benefit. The phases also share the
same network-error degradation contract — a transient lab-side outage
must not abort the boreholes.

Atterberg's two-row aggregation
-------------------------------
DOV ships Atterberg as two parameter rows per sample (liquid limit + plastic
limit). The orchestrator queries both via a CQL ``IN(...)`` filter,
groups rows by parent sample permkey, then collapses each group into one
``AtterbergLimitsOrm`` row. A plastic-limit observation with
``detectieconditie="NM"`` (Niet Meetbaar = not measurable) maps to
``non_plastic=True`` — DOV's convention for "soil cannot be rolled into a
3 mm thread".
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.dov_borehole_orm_builders import build_grain_size_orm
from groundmodel.application.dov_wfs_fetch import fetch_wfs_or_raise
from groundmodel.application.import_samples_dov_result import ImportSamplesDovResult
from groundmodel.infrastructure.db.models.atterberg_limits_orm import AtterbergLimitsOrm
from groundmodel.infrastructure.db.models.caco3_content_orm import CaCO3ContentOrm
from groundmodel.infrastructure.db.models.grain_size_orm import GrainSizeOrm
from groundmodel.infrastructure.db.models.organic_content_orm import OrganicContentOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.models.scalar_lab_test_orm import ScalarLabTestOrm
from groundmodel.infrastructure.db.models.water_content_orm import WaterContentOrm
from groundmodel.infrastructure.db.repositories.dov_dedup import (
    existing_dov_permkey_to_id,
    existing_dov_permkeys,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_sample_client import DovSampleClient
from groundmodel.infrastructure.parsers.borehole.dov.sample_wfs_row import SampleWfsRow
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.dov.dov_http_retry import DovRateLimitState
from groundmodel.infrastructure.parsers.lab.dov.dov_constants import (
    DOV_DETECTIECONDITIE_NOT_MEASURABLE,
    DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS,
    DOV_PARAMETER_ATTERBERG_LIQUID_LIMIT,
    DOV_PARAMETER_ATTERBERG_PLASTIC_LIMIT,
    DOV_PARAMETER_CACO3,
    DOV_PARAMETER_ORGANIC_CARBON,
    DOV_PARAMETER_WATER_CONTENT,
)
from groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_client import DovGrainSizeClient
from groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_parser import DovGrainSizeParser
from groundmodel.infrastructure.parsers.lab.dov.dov_scalar_observation_client import (
    DovScalarObservationClient,
)
from groundmodel.infrastructure.parsers.lab.dov.grain_size_parse_result import (
    GrainSizeParseResult,
)
from groundmodel.infrastructure.parsers.lab.dov.grain_size_wfs_row import GrainSizeWfsRow
from groundmodel.infrastructure.parsers.lab.dov.scalar_observation_wfs_row import (
    ScalarObservationWfsRow,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.timing import ms_since


class ImportSamplesDov(GroundModelLogger):
    """Use case: query DOV sample + grain-size streams in a bbox, attach to boreholes.

    Parameters
    ----------
    session : AsyncSession
        The same session the parent ``ImportBoreholeDov`` is using.
        ``add()`` calls do not flush; the parent commits once at the end.
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession`` shared with the parent."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        permkey_to_borehole_id: dict[str, UUID],
        sample_cache: DovXmlCache,
        grain_size_cache: DovXmlCache,
        http: httpx.AsyncClient,
        backoff: DovRateLimitState | None = None,
    ) -> ImportSamplesDovResult:
        """Fetch + persist all samples + grain-sizes in *bbox* for known boreholes.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees — same bbox the
            parent borehole orchestrator queried.
        permkey_to_borehole_id : dict[str, UUID]
            Map from borehole permkey (DOV's per-borehole permkey, i.e.
            the last path segment of the WFS row's ``fiche`` URL) to the
            persisted borehole UUID. The orchestrator builds this in
            ``ImportBoreholeDov`` after Phase 4 (persist) and before commit.
        sample_cache : DovXmlCache
            Per-sample cache, currently unused — Phase C3 reads everything
            from the WFS row, so no per-sample XML is fetched. Kept on
            the signature so a later phase can wire monster XMLs without
            changing this contract.
        grain_size_cache : DovXmlCache
            Cache for per-observation XMLs, rooted under
            ``observatie/`` to avoid permkey collisions with other DOV
            resource types.
        http : httpx.AsyncClient
            Shared HTTP client opened by the parent orchestrator.
        backoff : DovRateLimitState | None
            The import-wide rate-limit state shared with the borehole +
            interpretation phases, so a 429 seen anywhere halves the download
            parallelism once for the sample / grain-size / scalar phases too.

        Returns
        -------
        ImportSamplesDovResult
            Counts the parent rolls into the API response.
        """
        # Suppress unused-arg warning — see docstring for why.
        del sample_cache

        if not permkey_to_borehole_id:
            self.info("DOV sample import: no boreholes to attach to — skipping fetch")
            return ImportSamplesDovResult()

        self.info(
            f"DOV sample import started: "
            f"bbox W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}  "
            f"target boreholes={len(permkey_to_borehole_id)}"
        )

        t_total = time.perf_counter()
        result = ImportSamplesDovResult()

        # ------------------------------------------------------------------
        # Phase 1+2 — sample WFS + persist
        # ------------------------------------------------------------------
        permkey_to_sample_id: dict[str, UUID] = {}
        t_samples = time.perf_counter()
        sample_rows = await fetch_wfs_or_raise(
            DovSampleClient(http, backoff=backoff).fetch_bbox(
                west,
                south,
                east,
                north,
                parent_permkeys=set(permkey_to_borehole_id),
            ),
            label="sample",
            logger=self,
        )
        self.info(
            f"DOV sample phase 1 (WFS): {ms_since(t_samples)} ms — "
            f"{len(sample_rows)} samples for known boreholes"
        )

        # Refresh-on-duplicate: pre-load existing samples for the
        # in-scope boreholes BEFORE the empty-sample-rows early-exit
        # guard. Even when DOV has no new samples in this bbox, lab
        # tests on already-stored samples can still arrive and need
        # attaching. Keys go straight into ``permkey_to_sample_id`` so
        # downstream lab-test phases can attach NEW lab tests to
        # already-stored samples.
        existing_samples = await existing_dov_permkey_to_id(
            self._session,
            SampleOrm,
            "borehole_id",
            permkey_to_borehole_id.values(),
        )
        permkey_to_sample_id.update(existing_samples)
        if existing_samples:
            self.info(
                f"DOV sample dedup: {len(existing_samples)} samples already "
                f"present for these boreholes — skipping their re-persist"
            )

        if not sample_rows and not existing_samples:
            self.info(
                "DOV sample import: 0 matching samples in bbox AND no existing "
                "samples — nothing to attach"
            )
            return result

        # Persist NEW samples (no commit). Build the permkey→sample-UUID
        # map for the grain-size phase as we go.
        t_persist_samples = time.perf_counter()
        for i, sample_row in enumerate(sample_rows, 1):
            if sample_row.permkey in existing_samples:
                # Already stored under this borehole — skip silently.
                result.samples_skipped_already_present += 1
                continue
            borehole_id = permkey_to_borehole_id.get(sample_row.parent_borehole_permkey)
            if borehole_id is None:
                # Should be unreachable because of the WFS client's
                # ``parent_permkeys`` filter, but checked defensively so the
                # invariant is visible if the contract slips.
                result.samples_skipped_no_borehole += 1
                continue

            try:
                sample_orm = _sample_to_orm(sample_row, borehole_id)
                self._session.add(sample_orm)
                permkey_to_sample_id[sample_row.permkey] = sample_orm.id
                result.samples_attached += 1
                self.debug(
                    f"DOV sample [{i}/{len(sample_rows)}]: '{sample_row.permkey}' "
                    f"→ {sample_orm.id} "
                    f"(borehole {borehole_id})"
                )
            except Exception as exc:
                result.samples_failed += 1
                self.error(
                    f"DOV sample [{i}/{len(sample_rows)}]: persist failed for "
                    f"'{sample_row.permkey}': {type(exc).__name__}: {exc}"
                )
        self.info(
            f"DOV sample phase 2 (persist {result.samples_attached} samples, "
            f"no commit): {ms_since(t_persist_samples)} ms"
        )

        if not permkey_to_sample_id:
            self.info("DOV sample import: no samples in scope — skipping grain-size fetch")
            return result

        # ------------------------------------------------------------------
        # Phase 3+4 — grain-size WFS + download + parse + persist
        # ------------------------------------------------------------------
        parser = DovGrainSizeParser()

        def _process(row: GrainSizeWfsRow, xml_bytes: bytes) -> GrainSizeParseResult:
            """Parse the observation XML, resolving sample UUID from the row.

            Defensive ``KeyError`` if the contract slips — the client's
            ``parent_permkeys`` filter should guarantee a match.
            """
            sample_id = permkey_to_sample_id[row.parent_sample_permkey]
            parsed = parser.parse(xml_bytes, sample_id=sample_id, name=row.permkey)
            return _apply_grain_size_method_fallback(parsed, row)

        t_gs = time.perf_counter()
        client = DovGrainSizeClient(http, cache=grain_size_cache, backoff=backoff)
        parsed = await fetch_wfs_or_raise(
            client.fetch_bbox_processed(
                west,
                south,
                east,
                north,
                _process,
                parent_permkeys=set(permkey_to_sample_id),
            ),
            label="grain-size",
            logger=self,
        )
        self.info(
            f"DOV grain-size phase 3 (WFS + download + parse): "
            f"{ms_since(t_gs)} ms — {len(parsed)} grain-size results ready"
        )

        result.grain_sizes_fetched = len(parsed)
        for row, parse_result in parsed:
            if parse_result.has_errors:
                self.warning(
                    f"DOV grain-size '{row.permkey}' "
                    f"(sample '{row.parent_sample_permkey}') parsed with errors — "
                    + ", ".join(f"{iss.code}: {iss.message}" for iss in parse_result.issues)
                )

        # Refresh-on-duplicate dedup: existing grain-size permkeys for
        # any sample in scope. Skip the persist for already-stored
        # observations; only NEW grain-size analyses on existing
        # samples flow through.
        existing_gs_permkeys = await existing_dov_permkeys(
            self._session,
            GrainSizeOrm,
            "sample_id",
            permkey_to_sample_id.values(),
        )

        # Persist grain-sizes (no commit). Drop those with empty curves —
        # the parser already flagged INVALID_CURVE; persisting an empty
        # array would mislead the consumer.
        t_persist_gs = time.perf_counter()
        for i, (row, parse_result) in enumerate(parsed, 1):
            if row.permkey in existing_gs_permkeys:
                result.grain_sizes_skipped_already_present += 1
                continue
            if not parse_result.grain_size.diameters_mm:
                # Empty curves were a parse-level error; record as failed
                # so the API surfaces something countable. Log the per-row
                # reason (parser flagged INVALID_CURVE) so a non-zero failed
                # count is explainable without a re-run.
                result.grain_sizes_failed += 1
                # DEBUG, not WARNING — the phase-3 parse-error scan above already
                # WARNs once per has_errors record (INVALID_CURVE included). This
                # is the per-row breadcrumb explaining the failed count at the
                # persist branch; a second WARNING would double-alert per drop.
                self.debug(
                    f"DOV grain-size [{i}/{len(parsed)}]: '{row.permkey}' dropped — "
                    f"empty curve (parser flagged INVALID_CURVE); counted as failed"
                )
                continue
            sample_id = permkey_to_sample_id.get(row.parent_sample_permkey)
            if sample_id is None:
                # Defensive — same invariant as samples above.
                result.grain_sizes_skipped_no_sample += 1
                continue

            try:
                orm = build_grain_size_orm(parse_result, sample_id, row.permkey)
                self._session.add(orm)
                result.grain_sizes_attached += 1
                self.debug(
                    f"DOV grain-size [{i}/{len(parsed)}]: '{row.permkey}' → {orm.id} "
                    f"(sample {sample_id})"
                )
            except Exception as exc:
                result.grain_sizes_failed += 1
                self.error(
                    f"DOV grain-size [{i}/{len(parsed)}]: persist failed for "
                    f"'{row.permkey}': {type(exc).__name__}: {exc}"
                )
        self.info(
            f"DOV grain-size phase 4 (persist {result.grain_sizes_attached} grain-sizes, "
            f"no commit): {ms_since(t_persist_gs)} ms"
        )

        # ------------------------------------------------------------------
        # Phase 5 (C4) — scalar lab tests in parallel.
        # Atterberg / CaCO3 / organic-C / water-content fetched concurrently;
        # each phase persists into the same session without committing.
        # ------------------------------------------------------------------
        await self._fetch_and_attach_scalar_lab_tests(
            west, south, east, north, http, permkey_to_sample_id, result, backoff
        )

        self.success(
            f"DOV sample import done in {ms_since(t_total)} ms: "
            f"samples attached={result.samples_attached} failed={result.samples_failed}; "
            f"grain-sizes fetched={result.grain_sizes_fetched} "
            f"attached={result.grain_sizes_attached} failed={result.grain_sizes_failed}; "
            f"atterberg={result.atterberg_attached}/{result.atterberg_failed}; "
            f"caco3={result.caco3_attached}/{result.caco3_failed}; "
            f"organic={result.organic_attached}/{result.organic_failed}; "
            f"water={result.water_content_attached}/{result.water_content_failed}"
        )
        return result

    # ------------------------------------------------------------------
    # Phase 5 (C4) — scalar lab tests
    # ------------------------------------------------------------------

    async def _fetch_and_attach_scalar_lab_tests(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        http: httpx.AsyncClient,
        permkey_to_sample_id: dict[str, UUID],
        result: ImportSamplesDovResult,
        backoff: DovRateLimitState | None = None,
    ) -> None:
        """Run all four scalar lab-test phases (Atterberg, CaCO3, OC, water) in parallel.

        All four share ``DovScalarObservationClient`` over the same bbox and the
        same ``permkey_to_sample_id`` filter. Per-phase errors are isolated:
        if one parameter's WFS query fails, the others still run, and the
        boreholes / samples / grain-sizes already in the session stay alive
        (the parent orchestrator commits regardless).

        ``backoff`` is the import-wide rate-limit state; threaded into the
        scalar client so a 429 in this final phase still records on the shared
        state (and an earlier 429 keeps this phase's WFS at the reduced rate).
        """
        client = DovScalarObservationClient(http, backoff=backoff)
        sample_permkeys = set(permkey_to_sample_id)

        # Phase C5 extras: the catch-all parameters land in one parallel query
        # each, identical shape to the four typed phases above. Each row gets
        # persisted into ``scalar_lab_test`` (no per-parameter ORM).
        other_parameters = [p for _group, p in DOV_OTHER_SCALAR_LAB_TEST_PARAMETERS]

        t_scalar = time.perf_counter()
        try:
            (
                atterberg_rows,
                caco3_rows,
                organic_rows,
                water_rows,
                other_rows,
            ) = await asyncio.gather(
                client.fetch_bbox(
                    west,
                    south,
                    east,
                    north,
                    [
                        DOV_PARAMETER_ATTERBERG_LIQUID_LIMIT,
                        DOV_PARAMETER_ATTERBERG_PLASTIC_LIMIT,
                    ],
                    parent_permkeys=sample_permkeys,
                ),
                client.fetch_bbox(
                    west, south, east, north, DOV_PARAMETER_CACO3, parent_permkeys=sample_permkeys
                ),
                client.fetch_bbox(
                    west,
                    south,
                    east,
                    north,
                    DOV_PARAMETER_ORGANIC_CARBON,
                    parent_permkeys=sample_permkeys,
                ),
                client.fetch_bbox(
                    west,
                    south,
                    east,
                    north,
                    DOV_PARAMETER_WATER_CONTENT,
                    parent_permkeys=sample_permkeys,
                ),
                client.fetch_bbox(
                    west,
                    south,
                    east,
                    north,
                    other_parameters,
                    parent_permkeys=sample_permkeys,
                ),
            )
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            # Network failure on any of the parallel queries — log and mark
            # all streams as fully failed at the API surface so the result
            # carries an honest signal. Boreholes / samples / grain-sizes
            # already in the session aren't affected.
            n = len(permkey_to_sample_id)
            self.error(
                f"DOV scalar-observation phase: WFS error, all streams "
                f"unavailable: {type(exc).__name__}: {exc}"
            )
            result.atterberg_failed = n
            result.caco3_failed = n
            result.organic_failed = n
            result.water_content_failed = n
            result.scalar_lab_tests_failed = n
            return

        self.info(
            f"DOV scalar-observation WFS done in {ms_since(t_scalar)} ms — "
            f"atterberg={len(atterberg_rows)}, caco3={len(caco3_rows)}, "
            f"organic={len(organic_rows)}, water={len(water_rows)}, "
            f"other={len(other_rows)} rows"
        )

        # Refresh-on-duplicate: pre-fetch the set of already-stored
        # permkeys per lab-test family for any in-scope sample. Each
        # ``_persist_*`` method takes the corresponding skip-set so
        # already-stored rows are silently ignored.
        #
        # Sequential, NOT asyncio.gather: AsyncSession only handles one
        # task at a time, so concurrent execute() on the same session
        # raises ``InvalidRequestError: This session is provisioning a
        # new connection; concurrent operations are not permitted``.
        # Five fast IN-queries serialised cost ~25 ms vs. the multi-
        # second WFS phase that just preceded — invisible.
        sample_ids = list(permkey_to_sample_id.values())
        existing_atterberg = await existing_dov_permkeys(
            self._session, AtterbergLimitsOrm, "sample_id", sample_ids
        )
        existing_caco3 = await existing_dov_permkeys(
            self._session, CaCO3ContentOrm, "sample_id", sample_ids
        )
        existing_organic = await existing_dov_permkeys(
            self._session, OrganicContentOrm, "sample_id", sample_ids
        )
        existing_water = await existing_dov_permkeys(
            self._session, WaterContentOrm, "sample_id", sample_ids
        )
        existing_scalar = await existing_dov_permkeys(
            self._session, ScalarLabTestOrm, "sample_id", sample_ids
        )

        # Persist Atterberg (with LL+PL aggregation), the three typed single-
        # parameter scalar tests, and finally the catch-all ``ScalarLabTest``
        # rows. Each helper updates the result counters in place and isolates
        # per-row failures.
        self._persist_atterberg(atterberg_rows, permkey_to_sample_id, result, existing_atterberg)
        self._persist_caco3(caco3_rows, permkey_to_sample_id, result, existing_caco3)
        self._persist_organic(organic_rows, permkey_to_sample_id, result, existing_organic)
        self._persist_water_content(water_rows, permkey_to_sample_id, result, existing_water)
        self._persist_scalar_lab_tests(other_rows, permkey_to_sample_id, result, existing_scalar)

    def _persist_atterberg(
        self,
        rows: list[ScalarObservationWfsRow],
        permkey_to_sample_id: dict[str, UUID],
        result: ImportSamplesDovResult,
        existing_permkeys: set[str],
    ) -> None:
        """Aggregate LL + PL rows by sample, persist one AtterbergLimitsOrm per sample.

        DOV ships Atterberg as one observation row per parameter, not per
        test, so a sample with both LL and PL has TWO rows. We bucket them
        by parent sample permkey, then collapse each bucket into one
        ``AtterbergLimitsOrm``. Samples with only one of the two are still
        persisted with the other column NULL — partial measurements are real.

        Refresh-on-duplicate: skip aggregates whose canonical permkey
        (the LL row's, or the PL row's when only PL is present) is
        already stored under the sample.
        """
        by_sample: dict[str, dict[str, ScalarObservationWfsRow]] = {}
        for row in rows:
            kind = _atterberg_kind(row.parameter)
            if kind is None:
                # Defensive — the WFS filter limited us to LL/PL but a future
                # DOV schema change could leak in something unexpected.
                self.warning(
                    f"DOV atterberg: '{row.permkey}' has unrecognised parameter "
                    f"{row.parameter!r} — skipping"
                )
                result.atterberg_failed += 1
                continue
            by_sample.setdefault(row.parent_sample_permkey, {})[kind] = row

        total = len(by_sample)
        for i, (sample_permkey, kind_to_row) in enumerate(by_sample.items(), 1):
            sample_id = permkey_to_sample_id.get(sample_permkey)
            if sample_id is None:
                # Unreachable in practice — the WFS client filters to known
                # parents — but defensive logging if the contract slips.
                result.atterberg_failed += len(kind_to_row)
                continue

            # Canonical permkey matches what _atterberg_to_orm assigns.
            ll = kind_to_row.get("LL")
            pl = kind_to_row.get("PL")
            canonical_permkey = (ll.permkey if ll else None) or (pl.permkey if pl else None)
            if canonical_permkey and canonical_permkey in existing_permkeys:
                result.atterberg_skipped_already_present += 1
                continue

            try:
                orm = _atterberg_to_orm(kind_to_row, sample_id)
                if orm is None:
                    result.atterberg_failed += len(kind_to_row)
                    # Counted as failed — log why: no usable LL/PL value and no
                    # non-plastic flag (nothing to persist beyond metadata).
                    # ll / pl are already bound at the top of the loop body.
                    self.debug(
                        f"DOV atterberg [{i}/{total}]: sample '{sample_permkey}' dropped — "
                        f"no usable LL/PL value (LL={ll.resultaat if ll else None!r} "
                        f"PL={pl.resultaat if pl else None!r})"
                    )
                    continue
                self._session.add(orm)
                result.atterberg_attached += 1
                self.debug(
                    f"DOV atterberg [{i}/{total}]: sample '{sample_permkey}' → {orm.id} "
                    f"(LL={orm.liquid_limit_pct} PL={orm.plastic_limit_pct} "
                    f"non_plastic={orm.non_plastic})"
                )
            except Exception as exc:
                result.atterberg_failed += len(kind_to_row)
                self.error(
                    f"DOV atterberg: persist failed for sample '{sample_permkey}': "
                    f"{type(exc).__name__}: {exc}"
                )

    def _persist_caco3(
        self,
        rows: list[ScalarObservationWfsRow],
        permkey_to_sample_id: dict[str, UUID],
        result: ImportSamplesDovResult,
        existing_permkeys: set[str],
    ) -> None:
        """Persist one CaCO3ContentOrm per row whose value is in [0, 100]."""
        total = len(rows)
        for i, row in enumerate(rows, 1):
            self._persist_single_value(
                row,
                permkey_to_sample_id,
                result,
                builder=_caco3_to_orm,
                attached_attr="caco3_attached",
                failed_attr="caco3_failed",
                skipped_attr="caco3_skipped_already_present",
                existing_permkeys=existing_permkeys,
                test_label="caco3",
                index=i,
                total=total,
            )

    def _persist_organic(
        self,
        rows: list[ScalarObservationWfsRow],
        permkey_to_sample_id: dict[str, UUID],
        result: ImportSamplesDovResult,
        existing_permkeys: set[str],
    ) -> None:
        """Persist one OrganicContentOrm per organic-C row whose value is in [0, 100]."""
        total = len(rows)
        for i, row in enumerate(rows, 1):
            self._persist_single_value(
                row,
                permkey_to_sample_id,
                result,
                builder=_organic_carbon_to_orm,
                attached_attr="organic_attached",
                failed_attr="organic_failed",
                skipped_attr="organic_skipped_already_present",
                existing_permkeys=existing_permkeys,
                test_label="organic",
                index=i,
                total=total,
            )

    def _persist_water_content(
        self,
        rows: list[ScalarObservationWfsRow],
        permkey_to_sample_id: dict[str, UUID],
        result: ImportSamplesDovResult,
        existing_permkeys: set[str],
    ) -> None:
        """Persist one WaterContentOrm per row whose value is in [0, 1000]."""
        total = len(rows)
        for i, row in enumerate(rows, 1):
            self._persist_single_value(
                row,
                permkey_to_sample_id,
                result,
                builder=_water_content_to_orm,
                attached_attr="water_content_attached",
                failed_attr="water_content_failed",
                skipped_attr="water_content_skipped_already_present",
                existing_permkeys=existing_permkeys,
                test_label="water",
                index=i,
                total=total,
            )

    def _persist_scalar_lab_tests(
        self,
        rows: list[ScalarObservationWfsRow],
        permkey_to_sample_id: dict[str, UUID],
        result: ImportSamplesDovResult,
        existing_permkeys: set[str],
    ) -> None:
        """Persist one ``ScalarLabTestOrm`` per row into the catch-all table.

        Unlike the typed families, no value-range validation runs here —
        the catch-all is intentionally permissive about what it stores
        (numeric, text, null-with-condition all valid). Per-row failures
        only happen when the parent sample isn't in our just-imported set
        or the SQL insert raises.

        Refresh-on-duplicate: ``existing_permkeys`` are scalar-lab-test
        permkeys already stored under any sample in scope; rows whose
        ``permkey`` is in the set skip the persist step.
        """
        attached_before = result.scalar_lab_tests_attached
        failed_before = result.scalar_lab_tests_failed
        skipped_before = result.scalar_lab_tests_skipped_already_present
        total = len(rows)
        for index, row in enumerate(rows, start=1):
            # CLAUDE.md DoD: bulk loops carry an [i/total] prefix so an
            # operator scanning a long log can spot stalls / progress.
            prefix = f"[{index}/{total}]"
            if row.permkey in existing_permkeys:
                result.scalar_lab_tests_skipped_already_present += 1
                continue
            sample_id = permkey_to_sample_id.get(row.parent_sample_permkey)
            if sample_id is None:
                # Sample wasn't in the just-imported set — observation
                # belongs to a duplicate / pre-existing sample, skip.
                result.scalar_lab_tests_failed += 1
                self.debug(
                    f"DOV scalar-lab-test {prefix}: '{row.permkey}' has no parent in "
                    f"this import (sample '{row.parent_sample_permkey}'), skipping"
                )
                continue
            try:
                orm = _scalar_lab_test_to_orm(row, sample_id)
                self._session.add(orm)
                result.scalar_lab_tests_attached += 1
                self.debug(
                    f"DOV scalar-lab-test {prefix}: '{row.permkey}' [{row.parameter}] "
                    f"→ {orm.id} (sample {sample_id})"
                )
            except Exception as exc:
                result.scalar_lab_tests_failed += 1
                self.error(
                    f"DOV scalar-lab-test {prefix}: persist failed for '{row.permkey}' "
                    f"[{row.parameter}]: {type(exc).__name__}: {exc}"
                )
        # Phase-summary log so the operator can see catch-all activity at INFO
        # without enabling per-row DEBUG. Suppressed when nothing happened
        # so empty bboxes don't add noise.
        attached = result.scalar_lab_tests_attached - attached_before
        failed = result.scalar_lab_tests_failed - failed_before
        skipped = result.scalar_lab_tests_skipped_already_present - skipped_before
        if attached or failed or skipped:
            self.info(
                f"DOV scalar-lab-test catch-all: {attached} attached, "
                f"{skipped} skipped (already present), "
                f"{failed} failed (input: {len(rows)} rows)"
            )

    def _persist_single_value(
        self,
        row: ScalarObservationWfsRow,
        permkey_to_sample_id: dict[str, UUID],
        result: ImportSamplesDovResult,
        builder: Callable[
            [ScalarObservationWfsRow, UUID],
            CaCO3ContentOrm | OrganicContentOrm | WaterContentOrm | None,
        ],
        attached_attr: str,
        failed_attr: str,
        skipped_attr: str,
        existing_permkeys: set[str],
        test_label: str,
        index: int = 0,
        total: int = 0,
    ) -> None:
        """Shared per-row persist for the three single-parameter scalar tests.

        ``builder(row, sample_id)`` returns the ORM row or None when the
        value can't be mapped (null resultaat, range violation, etc.).
        ``attached_attr`` / ``failed_attr`` / ``skipped_attr`` name the
        counter fields on the result so we re-use this for caco3 /
        organic / water_content. ``existing_permkeys`` is the
        family-specific skip-set for refresh-on-duplicate.
        ``index`` and ``total`` are the 1-based loop position for the
        ``[i/total]`` DoD progress prefix on the per-row DEBUG log.
        """
        prefix = f"[{index}/{total}] " if total else ""
        if row.permkey in existing_permkeys:
            setattr(result, skipped_attr, getattr(result, skipped_attr) + 1)
            return
        sample_id = permkey_to_sample_id.get(row.parent_sample_permkey)
        if sample_id is None:
            setattr(result, failed_attr, getattr(result, failed_attr) + 1)
            # Counted as failed — log why (parent sample not in this import).
            self.debug(
                f"DOV {test_label} {prefix}'{row.permkey}' dropped — parent sample "
                f"'{row.parent_sample_permkey}' not in this import"
            )
            return
        try:
            orm = builder(row, sample_id)
            if orm is None:
                setattr(result, failed_attr, getattr(result, failed_attr) + 1)
                # The builder returns None for a null/unusable value (range
                # violation or null resultaat with no method/date metadata).
                # Log the raw value + detection condition so a low attached
                # count is explainable without a re-run (was silently counted
                # as failed with no per-value reason).
                self.debug(
                    f"DOV {test_label} {prefix}'{row.permkey}' dropped — no usable value "
                    f"(parameter={row.parameter!r} resultaat={row.resultaat!r} "
                    f"detectieconditie={row.detectieconditie!r})"
                )
                return
            self._session.add(orm)
            setattr(result, attached_attr, getattr(result, attached_attr) + 1)
            self.debug(f"DOV {test_label} {prefix}'{row.permkey}' → {orm.id} (sample {sample_id})")
        except Exception as exc:
            setattr(result, failed_attr, getattr(result, failed_attr) + 1)
            self.error(
                f"DOV {test_label} {prefix}persist failed for '{row.permkey}': "
                f"{type(exc).__name__}: {exc}"
            )


# ---------------------------------------------------------------------------
# Module helpers — pure mapping, no logging, easy to unit-test
# ---------------------------------------------------------------------------


def _sample_to_orm(row: SampleWfsRow, borehole_id: UUID) -> SampleOrm:
    """Map a SampleWfsRow + borehole UUID into a SampleOrm row.

    Top/base default to 0.0 when DOV omitted them — the column is NOT NULL
    and the domain Sample tolerates equal top == base for spot samples,
    so we treat "missing depth" as a spot sample at the surface. This is a
    rare DOV state; we log it through the orchestrator's per-row error
    counter when it happens because the SampleOrm's ``depth_top_m`` /
    ``depth_base_m`` columns can't be ``None``.
    """
    return SampleOrm(
        id=uuid7(),
        borehole_id=borehole_id,
        # ``permkey_monster`` from the WFS row; stable upstream identity
        # used by re-import dedup.
        dov_permkey=row.permkey,
        depth_top_m=row.depth_top_m if row.depth_top_m is not None else 0.0,
        depth_base_m=row.depth_base_m if row.depth_base_m is not None else 0.0,
        description="",
        sample_number=row.sample_number,
        sample_type=row.sample_type,
        composition=row.composition,
        instrument=row.instrument,
        sampling_date=row.sampling_date,
    )


# ---------------------------------------------------------------------------
# Phase C4 — scalar lab-test mappers (one per test type)
# ---------------------------------------------------------------------------


def _atterberg_kind(parameter: str) -> str | None:
    """Return ``"LL"`` / ``"PL"`` for the two Atterberg parameters, else ``None``.

    Used to bucket the per-parameter rows by test family so each sample's
    LL + PL rows collapse into one ``AtterbergLimitsOrm``. The exact DOV
    parameter strings (verified live 2026-05-09) double the token in
    parens; we compare on the full string for safety.
    """
    if parameter == DOV_PARAMETER_ATTERBERG_LIQUID_LIMIT:
        return "LL"
    if parameter == DOV_PARAMETER_ATTERBERG_PLASTIC_LIMIT:
        return "PL"
    return None


def _atterberg_to_orm(
    kind_to_row: dict[str, ScalarObservationWfsRow], sample_id: UUID
) -> AtterbergLimitsOrm | None:
    """Collapse a sample's LL/PL row dict into one ``AtterbergLimitsOrm``.

    Returns ``None`` when both rows are present but neither yields a
    usable value or non-plastic flag — there's nothing to persist beyond
    metadata, so we skip the row.

    Non-plastic mapping: a PL row with ``detectieconditie="NM"`` (Niet
    Meetbaar = not measurable) maps to ``non_plastic=True``. DOV uses
    this convention for "soil cannot be rolled into a 3 mm thread".
    Other detectiecondities (e.g. ``"<"`` = below detection limit) on the
    PL row produce a row with PL=None and ``non_plastic=None`` (we don't
    over-claim).

    Method/test-date come from whichever row has them populated; if both
    do (which is normal — labs run LL and PL together), we prefer the LL
    row since labs typically run LL first and conventions tend to surface
    method on it. Falls back to the PL row otherwise.
    """
    ll_row = kind_to_row.get("LL")
    pl_row = kind_to_row.get("PL")

    ll_value = _optional_pct(ll_row.resultaat) if ll_row else None
    pl_value = _optional_pct(pl_row.resultaat) if pl_row else None

    non_plastic: bool | None = None
    if pl_row and pl_row.detectieconditie == DOV_DETECTIECONDITIE_NOT_MEASURABLE:
        non_plastic = True

    # Validate domain ranges (0–1000 % per the AtterbergLimits domain entity).
    if ll_value is not None and not 0.0 <= ll_value <= 1000.0:
        ll_value = None
    if pl_value is not None and not 0.0 <= pl_value <= 1000.0:
        pl_value = None

    if ll_value is None and pl_value is None and non_plastic is None:
        return None

    method = (ll_row.methode if ll_row else None) or (pl_row.methode if pl_row else None)
    test_date = (ll_row.fenomeentijd if ll_row else None) or (
        pl_row.fenomeentijd if pl_row else None
    )

    # Use the LL row's permkey as the canonical Atterberg identity. PL's
    # permkey is not separately tracked because the orchestrator collapses
    # both into one ORM row. Falls back to PL's permkey when only PL is
    # present.
    canonical_permkey = (ll_row.permkey if ll_row else None) or (pl_row.permkey if pl_row else None)

    return AtterbergLimitsOrm(
        id=uuid7(),
        sample_id=sample_id,
        dov_permkey=canonical_permkey,
        liquid_limit_pct=ll_value,
        plastic_limit_pct=pl_value,
        non_plastic=non_plastic,
        method=method,
        test_date=test_date,
    )


def _caco3_to_orm(row: ScalarObservationWfsRow, sample_id: UUID) -> CaCO3ContentOrm | None:
    """Map a CaCO3 observation row into a CaCO3ContentOrm row.

    Returns ``None`` when the value isn't usable AND no method/date metadata
    is present — there's nothing meaningful to record. Range validation is
    [0, 100] % matching the domain entity.
    """
    value = _optional_pct(row.resultaat)
    if value is not None and not 0.0 <= value <= 100.0:
        value = None
    if value is None and row.methode is None and row.fenomeentijd is None:
        return None
    return CaCO3ContentOrm(
        id=uuid7(),
        sample_id=sample_id,
        dov_permkey=row.permkey,
        content_pct=value,
        method=row.methode,
        test_date=row.fenomeentijd,
    )


def _organic_carbon_to_orm(
    row: ScalarObservationWfsRow, sample_id: UUID
) -> OrganicContentOrm | None:
    """Map an organic-carbon observation row into an OrganicContentOrm row.

    Only ``carbon_pct`` is populated — DOV ships organic CARBON, not organic
    matter. ``matter_pct`` stays ``None``; callers needing OM apply the
    Van Bemmelen factor at presentation time per the domain entity's
    "don't auto-convert" rule.
    """
    value = _optional_pct(row.resultaat)
    if value is not None and not 0.0 <= value <= 100.0:
        value = None
    if value is None and row.methode is None and row.fenomeentijd is None:
        return None
    return OrganicContentOrm(
        id=uuid7(),
        sample_id=sample_id,
        dov_permkey=row.permkey,
        carbon_pct=value,
        matter_pct=None,
        method=row.methode,
        test_date=row.fenomeentijd,
    )


def _water_content_to_orm(row: ScalarObservationWfsRow, sample_id: UUID) -> WaterContentOrm | None:
    """Map a water-content observation row into a WaterContentOrm row.

    Range [0, 1000] %: peats / quick clays exceed 100 % so we don't clamp
    to 100. Outside [0, 1000] is non-physical.
    """
    value = _optional_pct(row.resultaat)
    if value is not None and not 0.0 <= value <= 1000.0:
        value = None
    if value is None and row.methode is None and row.fenomeentijd is None:
        return None
    return WaterContentOrm(
        id=uuid7(),
        sample_id=sample_id,
        dov_permkey=row.permkey,
        content_pct=value,
        method=row.methode,
        test_date=row.fenomeentijd,
    )


def _scalar_lab_test_to_orm(row: ScalarObservationWfsRow, sample_id: UUID) -> ScalarLabTestOrm:
    """Map a generic scalar observation row into a ``ScalarLabTestOrm`` row.

    Numeric source values land in ``value_numeric``; non-numeric (e.g.
    the ASTM classification codes ``"CL"`` / ``"SP"`` / ``"GW"``) land
    in ``value_text``. Both ``None`` only when the source ``resultaat``
    is null or empty (typically because ``detectieconditie`` is set).

    Unlike the typed family mappers, this never returns ``None`` — the
    catch-all stores the row even with a null value as long as it
    arrived from DOV; the metadata (parameter, method, date,
    detection_condition) is itself useful diagnostic information.
    """
    numeric = _optional_pct(row.resultaat)
    text = None
    if numeric is None and row.resultaat is not None:
        stripped = row.resultaat.strip()
        if stripped:
            text = stripped
    return ScalarLabTestOrm(
        id=uuid7(),
        sample_id=sample_id,
        dov_permkey=row.permkey,
        parameter_group=row.parametergroep,
        parameter=row.parameter,
        value_numeric=numeric,
        value_text=text,
        unit=row.eenheid,
        method=row.methode,
        test_date=row.fenomeentijd,
        detection_condition=row.detectieconditie,
    )


def _apply_grain_size_method_fallback(
    parsed: GrainSizeParseResult,
    row: GrainSizeWfsRow,
) -> GrainSizeParseResult:
    """If the parsed grain-size has no method, fall back to the WFS row's methode.

    DOV's per-observation XML for grain size is sometimes missing the
    ``<methode>`` element, leaving ``GrainSize.method = None`` after
    parsing. The WFS row itself carries the same info reliably (e.g.
    ``"Zeving op massa met grootte <= 2mm (fijnkorrelig)"``) — fall
    back to it so the chart legend always reads "sieving" /
    "hydrometer" / etc. instead of the placeholder "Method 1".

    Mutates the GrainSize in place (it's a regular ``@dataclass``, not
    frozen) and returns the same parse result for ergonomic chaining.
    """
    if parsed.grain_size is not None and parsed.grain_size.method is None and row.methode:
        parsed.grain_size.method = row.methode
    return parsed


def _optional_pct(raw: str | None) -> float | None:
    """Parse a DOV scalar value string (e.g. ``"0.000"``) into a float, or None.

    DOV ships values as strings even when ``observatietype`` is ``"Numeriek"``.
    Empty / null / non-numeric strings return None so the orchestrator can
    decide whether the row carries useful metadata anyway.
    """
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None
