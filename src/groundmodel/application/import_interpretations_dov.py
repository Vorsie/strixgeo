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

from groundmodel.application.dov_interpretation_dedup import interpretation_dedup_verdict
from groundmodel.application.dov_interpretation_verdict import DovInterpretationVerdict
from groundmodel.application.dov_wfs_fetch import fetch_wfs_or_raise
from groundmodel.application.import_interpretations_dov_result import (
    ImportInterpretationsDovResult,
)
from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.db.models.admixture_orm import AdmixtureOrm
from groundmodel.infrastructure.db.models.observation_layer_orm import ObservationLayerOrm
from groundmodel.infrastructure.db.models.observation_orm import ObservationOrm
from groundmodel.infrastructure.db.repositories.dov_dedup import (
    deleted_dov_permkeys,
    existing_dov_permkeys,
)
from groundmodel.infrastructure.parsers.borehole.dov.borehole_wfs_row import BoreholeWfsRow
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
from groundmodel.infrastructure.parsers.dov.dov_http_retry import DovRateLimitState
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.timing import ms_since

# Map each Boringen-WFS availability flag to the ObservationType the
# corresponding ``interpretaties:*`` WFS layer carries. Source of
# truth for the gap-detection cross-check below. The Boringen WFS
# row's ``has_<type>`` flags are authoritative (they come from DOV's
# main DB); the per-stream interpretation WFS layers occasionally lag
# behind — that's the GitHub issue #6 scenario.
_FLAG_TO_TYPE: dict[str, ObservationType] = {
    "has_coded_lithology": ObservationType.CODED_LITHOLOGY,
    "has_geotechnical_coding": ObservationType.GEOTECHNICAL_CODING,
    "has_lithological_description": ObservationType.LITHOLOGICAL_DESCRIPTION,
    "has_informal_stratigraphy": ObservationType.INFORMAL_STRATIGRAPHY,
    "has_formal_stratigraphy": ObservationType.FORMAL_STRATIGRAPHY,
    "has_quaternary_stratigraphy": ObservationType.QUATERNARY_STRATIGRAPHY,
    "has_hydrogeological_stratigraphy": ObservationType.HYDROGEOLOGICAL_STRATIGRAPHY,
    "has_informal_hydrogeological_stratigraphy": (
        ObservationType.INFORMAL_HYDROGEOLOGICAL_STRATIGRAPHY
    ),
}


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
        *,
        wfs_row_map: dict[str, BoreholeWfsRow] | None = None,
        backoff: DovRateLimitState | None = None,
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
        backoff : DovRateLimitState | None
            The import-wide rate-limit state shared with the parent borehole
            phase and the sample phase, so a 429 seen anywhere halves the
            download parallelism once for the phases that still run.

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

        t_fetch = time.perf_counter()
        client = DovInterpretationClient(http, cache=cache, backoff=backoff)
        parsed = await fetch_wfs_or_raise(
            client.fetch_bbox_processed(
                west,
                south,
                east,
                north,
                _process,
                test_ids=set(test_id_to_borehole_id),
            ),
            label="interpretation",
            logger=self,
        )
        self.info(
            f"DOV interpretation phase 1+2 (WFS + download + parse): "
            f"{ms_since(t_fetch)} ms — {len(parsed)} interpretations ready"
        )

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
        # interpretations on it persist. A stored track is never
        # overwritten, so a hand edit on it survives the re-import; a track
        # the user DELETED is remembered on its borehole and skipped too
        # (owner dogfeed 2026-10-01: "a deleted track stays deleted").
        existing_permkeys = await existing_dov_permkeys(
            self._session,
            ObservationOrm,
            "borehole_id",
            test_id_to_borehole_id.values(),
        )
        user_deleted = await deleted_dov_permkeys(self._session, test_id_to_borehole_id.values())
        self.info(
            f"DOV interpretation phase 3 (dedup): {len(existing_permkeys)} permkey(s) "
            f"already held, {len(user_deleted)} deleted by the user"
        )

        t_persist = time.perf_counter()
        total = len(parsed)
        for i, (row, parse_result) in enumerate(parsed, 1):
            verdict = interpretation_dedup_verdict(
                row.permkey, stored=existing_permkeys, deleted_by_user=user_deleted
            )
            if verdict is DovInterpretationVerdict.ALREADY_PRESENT:
                # Already stored under this borehole — skip silently. The
                # parent debug log already reports the in-scope set.
                result.skipped_already_present += 1
                continue
            if verdict is DovInterpretationVerdict.DELETED_BY_USER:
                result.skipped_deleted_by_user += 1
                self.debug(
                    f"DOV interpretation [{i}/{total}]: '{row.permkey}' "
                    f"({row.observation_type.value}) was deleted by the user on "
                    f"'{row.test_id}' — not re-attached"
                )
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

        # Phase 4 — WFS gap cross-check. The Boringen WFS publishes a
        # ``has_<type>`` flag per interpretation stream that is the
        # authoritative signal (it comes from DOV's main DB). The
        # per-stream ``interpretaties:*`` WFS layers occasionally lag
        # behind — a borehole with ``has_formal_stratigraphy=True``
        # might still have zero rows when we query
        # ``interpretaties:formele_stratigrafie`` by Proefnummer
        # (GitHub issue #6, confirmed live with permkey 2024-216503).
        #
        # We don't have a public DOV API to discover the missing
        # interpretation permkey from the boring permkey alone, so the
        # fallback is "log a WARNING with the boring's DOV URL and
        # move on" — engineers can verify what's missing by hand.
        # Re-rendering with whatever was fetched is unchanged; the
        # cross-check is observational, not blocking.
        if wfs_row_map:
            fetched_per_test_id: dict[str, set[ObservationType]] = {}
            for row, _ in parsed:
                fetched_per_test_id.setdefault(row.test_id, set()).add(row.observation_type)
            for test_id, wfs_row in wfs_row_map.items():
                got = fetched_per_test_id.get(test_id, set())
                for flag_name, obs_type in _FLAG_TO_TYPE.items():
                    if getattr(wfs_row, flag_name) and obs_type not in got:
                        result.wfs_gaps += 1
                        self.warning(
                            f"DOV WFS gap: borehole '{test_id}' "
                            f"(permkey {wfs_row.permkey}) has "
                            f"{flag_name}=True but no row in the "
                            f"interpretaties WFS — see "
                            f"https://www.dov.vlaanderen.be/data/boring/"
                            f"{wfs_row.permkey}. Skipping; engineers can "
                            f"verify by hand."
                        )

        self.success(
            f"DOV interpretation import done in {ms_since(t_total)} ms: "
            f"fetched={result.fetched} attached={result.attached} "
            f"skipped_already_present={result.skipped_already_present} "
            f"skipped_deleted_by_user={result.skipped_deleted_by_user} "
            f"skipped_no_borehole={result.skipped_no_borehole} "
            f"failed={result.failed} wfs_gaps={result.wfs_gaps}  "
            f"per-stream={result.per_stream}"
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
