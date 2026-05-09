"""Use case: import DOV interpretations for an existing set of boreholes.

Phase C2 companion to ``ImportBoreholeDov``. The borehole orchestrator runs
first and produces a ``{test_id: borehole_id}`` map for boreholes the caller
will see (newly imported only — pre-existing duplicates are deliberately
skipped to keep "re-importing the same bbox" idempotent).

This orchestrator then takes that map and the same bbox, queries all eight
``interpretaties:*`` WFS layers, fetches every per-interpretation XML in
parallel, parses each into an ``Observation`` (with layers + admixtures),
and persists the union as ``ObservationOrm`` children of the matching
borehole rows.

Pipeline (mirrors ImportBoreholeDov)
------------------------------------
1. WFS bbox queries across 8 streams (parallel) — discover interpretations
   inside the bbox.
2. Filter to ``test_ids`` we care about (the boreholes we just imported).
3. Parallel download + inline parse, with cache and shared semaphore.
4. Per-row persist (``flush=False``) — failures isolated to per-row counter.
5. Caller commits once at the end of the parent ``ImportBoreholeDov`` run.

Why not commit here
-------------------
We persist into the SAME ``AsyncSession`` that the parent borehole
orchestrator opened — that way the boreholes-and-their-interpretations land
atomically in one transaction. ``ImportBoreholeDov`` is the commit point;
this orchestrator only ``add()``s without flushing. If we committed mid-
flow and then hit a network error during interpretation download, we'd be
left with boreholes-without-interpretations on disk and no way for the
caller to retry just the interpretation half.
"""

from __future__ import annotations

import time
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from uuid6 import uuid7

from groundmodel.application.import_interpretations_dov_result import (
    ImportInterpretationsDovResult,
)
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.repositories.dov_dedup import existing_dov_permkeys
from groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_client import (
    DovInterpretationClient,
)
from groundmodel.infrastructure.parsers.borehole.dov.dov_interpretation_parser import (
    DovInterpretationParser,
)
from groundmodel.infrastructure.parsers.borehole.dov.interpretation_parse_result import (
    InterpretationParseResult,
)
from groundmodel.infrastructure.parsers.borehole.dov.interpretation_wfs_row import (
    InterpretationWfsRow,
)
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.timing import ms_since


class ImportInterpretationsDov(GroundModelLogger):
    """Use case: query DOV interpretation streams in a bbox, attach to boreholes.

    Parameters
    ----------
    session : AsyncSession
        The same session the parent ``ImportBoreholeDov`` is using.
        ``add()`` calls do not flush; the parent commits once.
    cache_dir_root : str | None
        Optional override for the DOV cache root. Default behaviour is to
        let the caller pre-construct a cache rooted under ``interpretatie/``
        and pass it in via the alternate ``execute_with_cache`` constructor
        — kept simple for now: ``execute`` builds its own cache from
        ``settings.dov_cache_dir / "interpretatie"``.
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
        test_id_to_borehole_id: dict[str, UUID],
        cache: DovXmlCache,
        http: httpx.AsyncClient,
    ) -> ImportInterpretationsDovResult:
        """Fetch + persist all interpretations in *bbox* for known boreholes.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees — same bbox the
            parent borehole orchestrator queried.
        test_id_to_borehole_id : dict[str, UUID]
            Map from ``test_id`` (= DOV ``boornummer`` = WFS-row
            ``Proefnummer``) to the persisted borehole's UUID. Built by the
            parent orchestrator after Phase 4 (persist) and before commit.
        cache : DovXmlCache
            Cache for interpretation XMLs. Caller constructs this so the
            cache directory choice is centralised in the parent
            orchestrator (currently ``settings.dov_cache_dir / "interpretatie"``).
        http : httpx.AsyncClient
            Shared HTTP client opened by the parent orchestrator. Reusing
            it preserves the connection pool / HTTP/2 multiplexing benefit
            we already have for the borehole download phase.

        Returns
        -------
        ImportInterpretationsDovResult
            Summary the parent orchestrator can roll into the API response.
        """
        if not test_id_to_borehole_id:
            self.info("DOV interpretation import: no boreholes to attach to — skipping fetch")
            return ImportInterpretationsDovResult()

        self.info(
            f"DOV interpretation import started: "
            f"bbox W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}  "
            f"target boreholes={len(test_id_to_borehole_id)}"
        )

        t_total = time.perf_counter()

        # Phase 1+2 — WFS discovery (8 streams in parallel) + filtered download/parse.
        # The parser closure resolves borehole_id from the WFS row's test_id, then
        # invokes DovInterpretationParser with the right keyword args.
        parser = DovInterpretationParser()

        def _process(row: InterpretationWfsRow, xml_bytes: bytes) -> InterpretationParseResult:
            """Parse the XML for *row*, resolving borehole UUID from the test-id map.

            Raises ``KeyError`` when the row references a borehole we don't
            have — but this never fires in practice because the client is
            handed the same ``test_ids`` set we filter against on the
            client side. Defensive lookup here so the failure mode is
            obvious if the contract slips.
            """
            borehole_id = test_id_to_borehole_id[row.test_id]
            return parser.parse(
                xml_bytes,
                borehole_id=borehole_id,
                observation_type=row.observation_type,
                name=row.permkey,
            )

        try:
            t_fetch = time.perf_counter()
            client = DovInterpretationClient(http, cache=cache)
            parsed = await client.fetch_bbox_processed(
                west,
                south,
                east,
                north,
                _process,
                test_ids=set(test_id_to_borehole_id),
            )
            self.info(
                f"DOV interpretation phase 1+2 (WFS + download + parse): "
                f"{ms_since(t_fetch)} ms — {len(parsed)} interpretations ready"
            )
        except httpx.HTTPStatusError as exc:
            self.error(
                f"DOV interpretation WFS request failed with HTTP "
                f"{exc.response.status_code}: {exc}  "
                f"response body: {exc.response.text[:300]!r}"
            )
            raise
        except httpx.RequestError as exc:
            self.error(
                f"DOV interpretation network error during WFS/download phase: "
                f"{type(exc).__name__}: {exc}"
            )
            raise

        result = ImportInterpretationsDovResult(fetched=len(parsed))
        for row, parse_result in parsed:
            if parse_result.has_errors:
                self.warning(
                    f"DOV interpretation '{row.permkey}' "
                    f"({row.observation_type.value}) parsed with errors — "
                    + ", ".join(f"{iss.code}: {iss.message}" for iss in parse_result.issues)
                )

        # Phase 3 — per-row dedup against ``Observation.dov_permkey`` for
        # refresh-on-duplicate: when an existing borehole is in scope,
        # its already-stored interpretations skip; only NEW
        # interpretations on it persist.
        existing_permkeys = await existing_dov_permkeys(
            self._session,
            ObservationOrm,
            "borehole_id",
            test_id_to_borehole_id.values(),
        )

        t_persist = time.perf_counter()
        total = len(parsed)
        for i, (row, parse_result) in enumerate(parsed, 1):
            if row.permkey in existing_permkeys:
                # Already stored under this borehole — skip silently. The
                # parent debug log already reports the in-scope set.
                result.skipped_already_present += 1
                continue
            try:
                orm = self._build_orm(row, parse_result)
                if orm is None:
                    result.skipped_no_borehole += 1
                    continue
                self._session.add(orm)
                result.attached += 1
                key = row.observation_type.value
                result.per_stream[key] = result.per_stream.get(key, 0) + 1
                self.debug(
                    f"DOV interpretation [{i}/{total}]: '{row.permkey}' "
                    f"({key}) → {orm.id} (borehole {orm.borehole_id})"
                )
            except Exception as exc:
                result.failed += 1
                self.error(
                    f"DOV interpretation [{i}/{total}]: persist failed for "
                    f"'{row.permkey}' ({row.observation_type.value}): "
                    f"{type(exc).__name__}: {exc}"
                )

        self.info(
            f"DOV interpretation phase 3 (persist {result.attached} observations, "
            f"no commit): {ms_since(t_persist)} ms"
        )
        self.success(
            f"DOV interpretation import done in {ms_since(t_total)} ms: "
            f"fetched={result.fetched} attached={result.attached} "
            f"skipped_already_present={result.skipped_already_present} "
            f"skipped_no_borehole={result.skipped_no_borehole} "
            f"failed={result.failed}  per-stream={result.per_stream}"
        )
        return result

    # ------------------------------------------------------------------
    # Domain → ORM mapping
    # ------------------------------------------------------------------

    @staticmethod
    def _build_orm(
        row: InterpretationWfsRow, parse_result: InterpretationParseResult
    ) -> ObservationOrm | None:
        """Map a parsed Observation + its layers + admixtures into one ORM tree.

        Returns ``None`` when the parse result has no usable layers — empty
        observations are dropped at this boundary so consumers never see an
        ``Observation`` with zero layers in the DB.
        """
        observation = parse_result.observation
        if not observation.layers:
            return None

        return ObservationOrm(
            id=observation.id,
            borehole_id=observation.borehole_id,
            # WFS row's permkey for the interpretatie; stable upstream
            # identity used by re-import dedup (refresh-on-duplicate).
            dov_permkey=row.permkey,
            observation_type=_observation_type_value(observation.observation_type),
            author=observation.author,
            observation_date=observation.observation_date,
            reliability=observation.reliability,
            score_category=observation.score_category,
            drill_method_score=observation.drill_method_score,
            layers=[
                ObservationLayerOrm(
                    id=uuid7(),
                    top_m=layer.top_m,
                    base_m=layer.base_m,
                    color=layer.color,
                    main_soil_codes=list(layer.main_soil_codes),
                    description=layer.description,
                    layer_index=layer.layer_index,
                    admixtures=[
                        AdmixtureOrm(
                            id=uuid7(),
                            soil_code=adm.soil_code,
                            amount=adm.amount,
                            locally=adm.locally,
                        )
                        for adm in layer.admixtures
                    ],
                )
                for layer in observation.layers
            ],
        )


def _observation_type_value(observation_type: ObservationType) -> str:
    """Return the string value the ORM stores in ``observation.observation_type``.

    The ORM column is plain VARCHAR (per the model docstring — kept VARCHAR so
    a ninth interpretation type doesn't require an ENUM-evolution migration).
    The application-layer ``ObservationType`` enum is the authoritative
    allow-list; we serialise via ``.value`` so a single source of truth lives
    in the enum definition.
    """
    return observation_type.value
