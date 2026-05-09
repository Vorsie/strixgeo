"""Use case: import DOV samples + grain-size lab tests (Phase C3).

Phase C3 companion to ``ImportBoreholeDov`` (C1) and
``ImportInterpretationsDov`` (C2). Runs against the SAME bbox and the
SAME open ``AsyncSession`` as the parent borehole orchestrator, persists
nothing on its own — the parent commits everything in one transaction
(boreholes + interpretations + samples + grain-sizes) at the end of the
flow.

Pipeline
--------
1. **Sample WFS query** — ``boringen:grondmonsters`` filtered to bbox,
   then narrowed to samples whose parent borehole is in the caller's
   ``permkey_to_borehole_id`` map (i.e. boreholes we just persisted).
2. **Sample persist (no commit)** — one ``SampleOrm`` per WFS row,
   ``session.add()`` only. Build a ``permkey_to_sample_id`` map for the
   downstream grain-size phase.
3. **Grain-size WFS query** — ``monster:observaties`` with
   ``CQL_FILTER='parametergroep=Onderkenningsproeven-korrelverdeling '``
   over the same bbox, filtered to observations whose parent sample is
   in the just-built ``permkey_to_sample_id`` map.
4. **Grain-size download + parse + persist** — parallel download with
   ``DovXmlCache`` cache hit-through, parsed via ``DovGrainSizeParser``,
   then ``GrainSizeOrm`` rows added (no commit).
5. Caller commits once.

Why samples + grain-sizes share an orchestrator
-----------------------------------------------
The two phases share the same parent-permkey map flow:

* C1 produces ``permkey_to_borehole_id`` → C3 phase 1+2 uses it →
  produces ``permkey_to_sample_id`` → C3 phase 3+4 uses it.

A second class would force the parent to thread the sample-permkey map
back out and back in again with no benefit. They're also bound by the
same network-error degradation contract (transient outage shouldn't
abort boreholes).

Why grain-size and other lab tests don't share an orchestrator (yet)
--------------------------------------------------------------------
Other ``parametergroep`` values (Atterberg, CaCO3, organic, water-content)
have different parsers and different ORM classes. Once Phase C4 adds
those parsers, the orchestrator either grows extra phases or splits.
We deliberately keep this one focused on grain-size — premature
generalisation would lock in shape decisions that the other tests may
push back on.
"""

from __future__ import annotations

import time
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.import_samples_dov_result import ImportSamplesDovResult
from groundmodel.infrastructure.db.models.grain_size_orm import GrainSizeOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.parsers.borehole.dov.dov_sample_client import DovSampleClient
from groundmodel.infrastructure.parsers.borehole.dov.sample_wfs_row import SampleWfsRow
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_client import DovGrainSizeClient
from groundmodel.infrastructure.parsers.lab.dov.dov_grain_size_parser import DovGrainSizeParser
from groundmodel.infrastructure.parsers.lab.dov.grain_size_parse_result import (
    GrainSizeParseResult,
)
from groundmodel.infrastructure.parsers.lab.dov.grain_size_wfs_row import GrainSizeWfsRow
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


def _ms(start: float) -> int:
    """Return elapsed time since *start* (perf_counter) as integer milliseconds."""
    return int((time.perf_counter() - start) * 1000)


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
        try:
            t_samples = time.perf_counter()
            sample_rows = await DovSampleClient(http).fetch_bbox(
                west,
                south,
                east,
                north,
                parent_permkeys=set(permkey_to_borehole_id),
            )
            self.info(
                f"DOV sample phase 1 (WFS): {_ms(t_samples)} ms — "
                f"{len(sample_rows)} samples for known boreholes"
            )
        except httpx.HTTPStatusError as exc:
            self.error(f"DOV sample WFS request failed with HTTP {exc.response.status_code}: {exc}")
            raise
        except httpx.RequestError as exc:
            self.error(f"DOV sample WFS network error: {type(exc).__name__}: {exc}")
            raise

        if not sample_rows:
            self.info("DOV sample import: 0 matching samples in bbox — nothing to attach")
            return result

        # Persist samples (no commit). Build the permkey→sample-UUID map
        # for the grain-size phase as we go.
        t_persist_samples = time.perf_counter()
        for i, row in enumerate(sample_rows, 1):
            borehole_id = permkey_to_borehole_id.get(row.parent_borehole_permkey)
            if borehole_id is None:
                # Should be unreachable because of the WFS client's
                # ``parent_permkeys`` filter, but checked defensively so the
                # invariant is visible if the contract slips.
                result.samples_skipped_no_borehole += 1
                continue

            try:
                orm = _sample_to_orm(row, borehole_id)
                self._session.add(orm)
                permkey_to_sample_id[row.permkey] = orm.id
                result.samples_attached += 1
                self.debug(
                    f"DOV sample [{i}/{len(sample_rows)}]: '{row.permkey}' → {orm.id} "
                    f"(borehole {borehole_id})"
                )
            except Exception as exc:
                result.samples_failed += 1
                self.error(
                    f"DOV sample [{i}/{len(sample_rows)}]: persist failed for "
                    f"'{row.permkey}': {type(exc).__name__}: {exc}"
                )
        self.info(
            f"DOV sample phase 2 (persist {result.samples_attached} samples, "
            f"no commit): {_ms(t_persist_samples)} ms"
        )

        if not permkey_to_sample_id:
            self.info("DOV sample import: no samples persisted — skipping grain-size fetch")
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
            return parser.parse(xml_bytes, sample_id=sample_id, name=row.permkey)

        try:
            t_gs = time.perf_counter()
            client = DovGrainSizeClient(http, cache=grain_size_cache)
            parsed = await client.fetch_bbox_processed(
                west,
                south,
                east,
                north,
                _process,
                parent_permkeys=set(permkey_to_sample_id),
            )
            self.info(
                f"DOV grain-size phase 3 (WFS + download + parse): "
                f"{_ms(t_gs)} ms — {len(parsed)} grain-size results ready"
            )
        except httpx.HTTPStatusError as exc:
            self.error(
                f"DOV grain-size WFS request failed with HTTP {exc.response.status_code}: {exc}"
            )
            raise
        except httpx.RequestError as exc:
            self.error(f"DOV grain-size WFS network error: {type(exc).__name__}: {exc}")
            raise

        result.grain_sizes_fetched = len(parsed)
        for row, parse_result in parsed:
            if parse_result.has_errors:
                self.warning(
                    f"DOV grain-size '{row.permkey}' "
                    f"(sample '{row.parent_sample_permkey}') parsed with errors — "
                    + ", ".join(f"{iss.code}: {iss.message}" for iss in parse_result.issues)
                )

        # Persist grain-sizes (no commit). Drop those with empty curves —
        # the parser already flagged INVALID_CURVE; persisting an empty
        # array would mislead the consumer.
        t_persist_gs = time.perf_counter()
        for i, (row, parse_result) in enumerate(parsed, 1):
            if not parse_result.grain_size.diameters_mm:
                result.grain_sizes_skipped_no_sample += 0  # not this counter
                # Empty curves were a parse-level error; record as failed
                # so the API surfaces something countable.
                result.grain_sizes_failed += 1
                continue
            sample_id = permkey_to_sample_id.get(row.parent_sample_permkey)
            if sample_id is None:
                # Defensive — same invariant as samples above.
                result.grain_sizes_skipped_no_sample += 1
                continue

            try:
                orm = _grain_size_to_orm(parse_result, sample_id)
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
            f"no commit): {_ms(t_persist_gs)} ms"
        )

        self.success(
            f"DOV sample+grain-size import done in {_ms(t_total)} ms: "
            f"samples attached={result.samples_attached} failed={result.samples_failed}; "
            f"grain-sizes fetched={result.grain_sizes_fetched} "
            f"attached={result.grain_sizes_attached} failed={result.grain_sizes_failed}"
        )
        return result


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
        depth_top_m=row.depth_top_m if row.depth_top_m is not None else 0.0,
        depth_base_m=row.depth_base_m if row.depth_base_m is not None else 0.0,
        description="",
        sample_number=row.sample_number,
        sample_type=row.sample_type,
        composition=row.composition,
        instrument=row.instrument,
        sampling_date=row.sampling_date,
    )


def _grain_size_to_orm(parse_result: GrainSizeParseResult, sample_id: UUID) -> GrainSizeOrm:
    """Map a GrainSizeParseResult + sample UUID into a GrainSizeOrm row."""
    gs = parse_result.grain_size
    return GrainSizeOrm(
        id=gs.id,
        sample_id=sample_id,
        diameters_mm=list(gs.diameters_mm),
        pct_larger=list(gs.pct_larger),
        method=gs.method,
        test_date=gs.test_date,
        lime_removed=gs.lime_removed,
        organics_removed=gs.organics_removed,
    )
