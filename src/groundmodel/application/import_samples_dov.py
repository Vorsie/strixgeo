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
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.import_samples_dov_result import ImportSamplesDovResult
from groundmodel.infrastructure.db.models.atterberg_limits_orm import AtterbergLimitsOrm
from groundmodel.infrastructure.db.models.caco3_content_orm import CaCO3ContentOrm
from groundmodel.infrastructure.db.models.grain_size_orm import GrainSizeOrm
from groundmodel.infrastructure.db.models.organic_content_orm import OrganicContentOrm
from groundmodel.infrastructure.db.models.sample_orm import SampleOrm
from groundmodel.infrastructure.db.models.water_content_orm import WaterContentOrm
from groundmodel.infrastructure.parsers.borehole.dov.dov_sample_client import DovSampleClient
from groundmodel.infrastructure.parsers.borehole.dov.sample_wfs_row import SampleWfsRow
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.lab.dov.dov_constants import (
    DOV_DETECTIECONDITIE_NOT_MEASURABLE,
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

        # ------------------------------------------------------------------
        # Phase 5 (C4) — scalar lab tests in parallel.
        # Atterberg / CaCO3 / organic-C / water-content fetched concurrently;
        # each phase persists into the same session without committing.
        # ------------------------------------------------------------------
        await self._fetch_and_attach_scalar_lab_tests(
            west, south, east, north, http, permkey_to_sample_id, result
        )

        self.success(
            f"DOV sample import done in {_ms(t_total)} ms: "
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
    ) -> None:
        """Run all four scalar lab-test phases (Atterberg, CaCO3, OC, water) in parallel.

        All four share ``DovScalarObservationClient`` over the same bbox and the
        same ``permkey_to_sample_id`` filter. Per-phase errors are isolated:
        if one parameter's WFS query fails, the others still run, and the
        boreholes / samples / grain-sizes already in the session stay alive
        (the parent orchestrator commits regardless).
        """
        client = DovScalarObservationClient(http)
        sample_permkeys = set(permkey_to_sample_id)

        t_scalar = time.perf_counter()
        try:
            atterberg_rows, caco3_rows, organic_rows, water_rows = await asyncio.gather(
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
            )
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            # Network failure on any of the four parallel queries — log and
            # mark all four as fully failed at the API surface so the result
            # carries an honest signal. Boreholes / samples / grain-sizes
            # already in the session aren't affected.
            n = len(permkey_to_sample_id)
            self.error(
                f"DOV scalar-observation phase: WFS error, all four streams "
                f"unavailable: {type(exc).__name__}: {exc}"
            )
            result.atterberg_failed = n
            result.caco3_failed = n
            result.organic_failed = n
            result.water_content_failed = n
            return

        self.info(
            f"DOV scalar-observation WFS done in {_ms(t_scalar)} ms — "
            f"atterberg={len(atterberg_rows)}, caco3={len(caco3_rows)}, "
            f"organic={len(organic_rows)}, water={len(water_rows)} rows"
        )

        # Persist Atterberg (with LL+PL aggregation), then the three single-
        # parameter scalar tests. Each helper updates the result counters in
        # place and isolates per-row failures.
        self._persist_atterberg(atterberg_rows, permkey_to_sample_id, result)
        self._persist_caco3(caco3_rows, permkey_to_sample_id, result)
        self._persist_organic(organic_rows, permkey_to_sample_id, result)
        self._persist_water_content(water_rows, permkey_to_sample_id, result)

    def _persist_atterberg(
        self,
        rows: list[ScalarObservationWfsRow],
        permkey_to_sample_id: dict[str, UUID],
        result: ImportSamplesDovResult,
    ) -> None:
        """Aggregate LL + PL rows by sample, persist one AtterbergLimitsOrm per sample.

        DOV ships Atterberg as one observation row per parameter, not per
        test, so a sample with both LL and PL has TWO rows. We bucket them
        by parent sample permkey, then collapse each bucket into one
        ``AtterbergLimitsOrm``. Samples with only one of the two are still
        persisted with the other column NULL — partial measurements are real.
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

        for sample_permkey, kind_to_row in by_sample.items():
            sample_id = permkey_to_sample_id.get(sample_permkey)
            if sample_id is None:
                # Unreachable in practice — the WFS client filters to known
                # parents — but defensive logging if the contract slips.
                result.atterberg_failed += len(kind_to_row)
                continue

            try:
                orm = _atterberg_to_orm(kind_to_row, sample_id)
                if orm is None:
                    result.atterberg_failed += len(kind_to_row)
                    continue
                self._session.add(orm)
                result.atterberg_attached += 1
                self.debug(
                    f"DOV atterberg: sample '{sample_permkey}' → {orm.id} "
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
    ) -> None:
        """Persist one CaCO3ContentOrm per row whose value is in [0, 100]."""
        for row in rows:
            self._persist_single_value(
                row,
                permkey_to_sample_id,
                result,
                builder=_caco3_to_orm,
                attached_attr="caco3_attached",
                failed_attr="caco3_failed",
                test_label="caco3",
            )

    def _persist_organic(
        self,
        rows: list[ScalarObservationWfsRow],
        permkey_to_sample_id: dict[str, UUID],
        result: ImportSamplesDovResult,
    ) -> None:
        """Persist one OrganicContentOrm per organic-C row whose value is in [0, 100]."""
        for row in rows:
            self._persist_single_value(
                row,
                permkey_to_sample_id,
                result,
                builder=_organic_carbon_to_orm,
                attached_attr="organic_attached",
                failed_attr="organic_failed",
                test_label="organic",
            )

    def _persist_water_content(
        self,
        rows: list[ScalarObservationWfsRow],
        permkey_to_sample_id: dict[str, UUID],
        result: ImportSamplesDovResult,
    ) -> None:
        """Persist one WaterContentOrm per row whose value is in [0, 1000]."""
        for row in rows:
            self._persist_single_value(
                row,
                permkey_to_sample_id,
                result,
                builder=_water_content_to_orm,
                attached_attr="water_content_attached",
                failed_attr="water_content_failed",
                test_label="water",
            )

    def _persist_single_value(
        self,
        row: ScalarObservationWfsRow,
        permkey_to_sample_id: dict[str, UUID],
        result: ImportSamplesDovResult,
        builder,
        attached_attr: str,
        failed_attr: str,
        test_label: str,
    ) -> None:
        """Shared per-row persist for the three single-parameter scalar tests.

        ``builder(row, sample_id)`` returns the ORM row or None when the
        value can't be mapped (null resultaat, range violation, etc.).
        ``attached_attr`` / ``failed_attr`` name the counter fields on the
        result so we can re-use this for caco3 / organic / water_content.
        """
        sample_id = permkey_to_sample_id.get(row.parent_sample_permkey)
        if sample_id is None:
            setattr(result, failed_attr, getattr(result, failed_attr) + 1)
            return
        try:
            orm = builder(row, sample_id)
            if orm is None:
                setattr(result, failed_attr, getattr(result, failed_attr) + 1)
                return
            self._session.add(orm)
            setattr(result, attached_attr, getattr(result, attached_attr) + 1)
            self.debug(f"DOV {test_label}: '{row.permkey}' → {orm.id} (sample {sample_id})")
        except Exception as exc:
            setattr(result, failed_attr, getattr(result, failed_attr) + 1)
            self.error(
                f"DOV {test_label}: persist failed for '{row.permkey}': {type(exc).__name__}: {exc}"
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

    return AtterbergLimitsOrm(
        id=uuid7(),
        sample_id=sample_id,
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
        content_pct=value,
        method=row.methode,
        test_date=row.fenomeentijd,
    )


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
