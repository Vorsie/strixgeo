"""Fetch DOV Virtuele Boring predictions for every investigation in a project.

The application-layer use case behind the desktop "Virtuele Boring
overlay" feature (CLAUDE.md debt #10, resolved 2026-05-14). For each
CPT + borehole in a project that has Lambert-72 coordinates, fan out
one ``doorprik`` call per requested model and assemble the result.

Design choices
--------------
* **Lambert 72 gate.** The Virtuele Boring API covers Flanders only,
  in EPSG:31370. Investigations with a different ``epsg`` are skipped
  with a per-row WARNING log so the user sees which points fell out
  (and why) without the whole sweep failing.
* **Per-investigation skip on per-call error.** One bad coordinate
  shouldn't blank the entire overlay. We catch
  ``VirtueleBoringFetchError`` per (investigation, model) pair, log
  the failure, and move on — the response surfaces whatever did
  succeed, and ``skipped`` says why each missing pair is missing.
* **DOV being slow is degraded, not a server error.** A transport
  failure (``httpx.TransportError``: connect / read timeout, reset,
  refused, protocol error) on one pair is skipped the same way
  (owner's dev log 2026-09-27/29: one ``ReadError`` of 63 escaped
  ``asyncio.gather`` and 500'd the whole overlay). Only when EVERY
  pair failed for a network reason is there nothing to return: one
  summary WARNING, then ``DovUnreachableError`` (the router's 503).
  Any other exception is a bug and propagates.
* **Bounded fan-out via ``asyncio.Semaphore``.** DOV's per-IP rate
  limit kicks in above ~50 concurrent during peak hours per
  CLAUDE.local.md; we mirror the same ceiling here as for the bulk
  XML download path.
* **No persistence.** Predictions are informative-only overlays per
  the user's 2026-05-14 scope decision — never written to the DB,
  never anchored as ``FormationContact`` rows. Read-only side effects
  only.
"""

from __future__ import annotations

import asyncio
from collections import Counter
from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from groundmodel.infrastructure.db.repositories.borehole_repository import (
    BoreholeRepository,
)
from groundmodel.infrastructure.db.repositories.cpt_repository import CptRepository
from groundmodel.infrastructure.parsers.dov.dov_http import make_dov_async_client
from groundmodel.infrastructure.parsers.dov.virtuele_boring_client import (
    VirtueleBoringClient,
    VirtueleBoringFetchError,
)
from groundmodel.infrastructure.parsers.dov.virtuele_boring_constants import (
    DOV_VIRTUELE_BORING_HORIZONTAL_EPSG,
    DOV_VIRTUELE_BORING_PARALLELISM,
)
from groundmodel.infrastructure.parsers.dov.virtuele_boring_result import (
    VirtueleBoringLayer,
)
from groundmodel.shared.exceptions import DovUnreachableError
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

# ``SkippedPrediction.reason`` values. ``dov_unreachable`` = the call never
# got an HTTP answer (transport error); ``dov_http_error`` = DOV answered
# with a non-2xx status.
SkipReason = Literal["dov_unreachable", "dov_http_error"]


@dataclass(frozen=True, slots=True)
class InvestigationPrediction:
    """Per-investigation aggregated overlay payload.

    Attributes
    ----------
    investigation_kind : str
        Either ``"cpt"`` or ``"borehole"``. Lets the frontend tell
        which icon / column type the overlay attaches to.
    investigation_id : UUID
        The CPT or Borehole row id. Frontend joins this against its
        in-memory investigation list to position the ghost columns.
    name : str
        Display label — ``cpt.test_id`` / ``borehole.test_id``.
        Mirrors how the rest of the desktop client refers to
        investigations in tooltips and lists.
    elevation_m_taw : float | None
        Surface elevation when known (lets the frontend convert
        absolute mTAW elevations to per-investigation depths for the
        ghost column). ``None`` when the investigation has no Z.
    predictions_by_model : dict[str, list[VirtueleBoringLayer]]
        One layer list per model code that was requested AND
        succeeded for this investigation. A model code with no entry
        means the fetch failed (logged at WARN) or the investigation
        was outside the model's coverage.
    """

    investigation_kind: Literal["cpt", "borehole"]
    investigation_id: UUID
    name: str
    elevation_m_taw: float | None
    predictions_by_model: dict[str, list[VirtueleBoringLayer]]


@dataclass(frozen=True, slots=True)
class SkippedPrediction:
    """One (investigation, model) fetch that returned nothing, and why.

    Attributes
    ----------
    investigation_kind : str
        ``"cpt"`` or ``"borehole"``.
    investigation_id : UUID
        The CPT or Borehole row id.
    name : str
        Display label of the investigation (its ``test_id``).
    model : str
        The DOV lagenmodel code whose fetch failed.
    reason : SkipReason
        ``"dov_unreachable"`` (no HTTP answer) or ``"dov_http_error"``
        (DOV answered with a non-2xx status).
    detail : str
        The transport-error class name (``"ReadTimeout"``) or
        ``"HTTP <status>"``.
    """

    investigation_kind: Literal["cpt", "borehole"]
    investigation_id: UUID
    name: str
    model: str
    reason: SkipReason
    detail: str


@dataclass(frozen=True, slots=True)
class VirtueleBoringPredictionsResult:
    """Aggregated overlay payload for a project.

    Attributes
    ----------
    models : list[str]
        The model codes that were requested, echoed back so the
        frontend can detect partial-completion (missing keys per
        investigation imply per-call failures).
    predictions : list[InvestigationPrediction]
        One entry per investigation that had a usable Lambert-72
        coordinate. Investigations skipped due to missing CRS / coords
        are omitted; their skip is logged but not surfaced to the
        client (no UI value in showing them — they wouldn't render).
    skipped_count : int
        How many investigations were dropped because their CRS wasn't
        Lambert 72 (or coordinates were missing). Surfaced in the
        response so the UI can show "12 investigations in this
        project don't sit in EPSG:31370 and have no overlay."
    skipped : list[SkippedPrediction]
        One entry per (investigation, model) fetch that failed, with
        the reason, in investigation-then-model order. Separate from
        ``skipped_count`` (the CRS / coordinate skips, which never
        reach the network). Empty when every fetch succeeded.
    """

    models: list[str]
    predictions: list[InvestigationPrediction]
    skipped_count: int
    skipped: list[SkippedPrediction] = field(default_factory=list)


class FetchVirtueleBoringPredictions(GroundModelLogger):
    """Use case: fetch per-investigation Virtuele Boring overlays.

    See module docstring for the design rationale. Construction takes
    an open AsyncSession; the HTTP client is built per-call so the
    connection pool is owned by the use case (closed on every exit
    path).
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialise with an active ``AsyncSession`` for DB reads."""
        super().__init__(__name__)
        self._session = session

    async def execute(
        self,
        project_id: UUID,
        models: list[str],
    ) -> VirtueleBoringPredictionsResult:
        """Fetch overlays for every investigation in a project.

        Parameters
        ----------
        project_id : UUID
            The app-project id. Used to scope CPT + borehole reads
            so we never leak data across projects.
        models : list[str]
            DOV lagenmodel codes to fetch per investigation
            (``g3dv3_F``, ``g3dv3_L``, ``hcovv2_H``, …). De-duplicated
            internally; empty list returns an empty predictions array
            with no network traffic.

        Returns
        -------
        VirtueleBoringPredictionsResult
            Aggregated payload — per-investigation predictions, the
            CRS skip count, and every failed fetch with its reason.

        Raises
        ------
        DovUnreachableError
            When EVERY (investigation, model) fetch failed with a
            transport error — DOV is down or unreachable, nothing to
            return. A partial failure never raises.
        """
        self.info(f"fetch_virtuele_boring_predictions: project={project_id} models={models}")

        # De-duplicate models while preserving caller order so the
        # frontend's "model A / model B" picker maps unchanged to the
        # response keys.
        seen: set[str] = set()
        unique_models: list[str] = []
        for m in models:
            if m and m not in seen:
                seen.add(m)
                unique_models.append(m)

        cpt_repo = CptRepository(self._session)
        borehole_repo = BoreholeRepository(self._session)
        cpts = await cpt_repo.list_all(app_project_id=project_id)
        boreholes = await borehole_repo.list_all(app_project_id=project_id)
        self.debug(
            f"loaded {len(cpts)} CPT(s) + {len(boreholes)} borehole(s) for project={project_id}"
        )

        # Collect (kind, id, name, x, y, elevation) for every
        # investigation with Lambert-72 coords. Anything else lands in
        # the skip count.
        usable: list[tuple[Literal["cpt", "borehole"], UUID, str, float, float, float | None]] = []
        skipped = 0
        for cpt in cpts:
            if cpt.epsg != DOV_VIRTUELE_BORING_HORIZONTAL_EPSG:
                skipped += 1
                self.trace(
                    f"skip CPT {cpt.id} ({cpt.test_id}) — epsg={cpt.epsg} != "
                    f"{DOV_VIRTUELE_BORING_HORIZONTAL_EPSG}"
                )
                continue
            if cpt.location_x is None or cpt.location_y is None:
                skipped += 1
                continue
            usable.append(
                (
                    "cpt",
                    cpt.id,
                    cpt.test_id or str(cpt.id),
                    cpt.location_x,
                    cpt.location_y,
                    cpt.elevation_m,
                )
            )
        for bh in boreholes:
            if bh.epsg != DOV_VIRTUELE_BORING_HORIZONTAL_EPSG:
                skipped += 1
                self.trace(
                    f"skip borehole {bh.id} ({bh.test_id}) — epsg={bh.epsg} != "
                    f"{DOV_VIRTUELE_BORING_HORIZONTAL_EPSG}"
                )
                continue
            if bh.location_x is None or bh.location_y is None:
                skipped += 1
                continue
            usable.append(
                (
                    "borehole",
                    bh.id,
                    bh.test_id or str(bh.id),
                    bh.location_x,
                    bh.location_y,
                    bh.elevation_m,
                )
            )

        if not usable or not unique_models:
            self.info(
                f"fetch_virtuele_boring_predictions: nothing to fetch "
                f"(usable={len(usable)}, models={len(unique_models)}, "
                f"skipped={skipped})"
            )
            return VirtueleBoringPredictionsResult(
                models=unique_models, predictions=[], skipped_count=skipped
            )

        # One bounded fan-out per (investigation, model) pair.
        # Semaphore keeps us under DOV's per-IP rate ceiling even on
        # large projects (50 CPTs × 3 models = 150 calls).
        semaphore = asyncio.Semaphore(DOV_VIRTUELE_BORING_PARALLELISM)
        per_inv_layers: dict[UUID, dict[str, list[VirtueleBoringLayer]]] = {
            inv_id: {} for (_, inv_id, _, _, _, _) in usable
        }
        # Keyed by (investigation, model) so the final list can be built
        # in a stable order regardless of completion order.
        failures: dict[tuple[UUID, str], SkippedPrediction] = {}

        async with make_dov_async_client() as http:
            client = VirtueleBoringClient(http)

            async def _one(
                kind: Literal["cpt", "borehole"],
                inv_id: UUID,
                name: str,
                x: float,
                y: float,
                model: str,
            ) -> None:
                async with semaphore:
                    try:
                        result = await client.fetch_doorprik(x, y, model=model)
                    except VirtueleBoringFetchError as err:
                        # Per-call failure — log and move on so the
                        # rest of the sweep still surfaces overlays.
                        self.warning(
                            f"Virtuele Boring fetch failed for {kind} {inv_id} "
                            f"({name}) model={model}: HTTP {err.status_code}"
                        )
                        failures[(inv_id, model)] = SkippedPrediction(
                            kind, inv_id, name, model, "dov_http_error", f"HTTP {err.status_code}"
                        )
                        return
                    except httpx.TransportError as err:
                        # DOV did not answer (timeout / reset / refused).
                        # Degraded, not a bug: skip this pair. The WARNING
                        # is deferred until the sweep ends so an offline
                        # machine logs ONE summary line, not one per pair.
                        self.debug(
                            f"Virtuele Boring transport error for {kind} {inv_id} "
                            f"({name}) model={model}: {type(err).__name__}: {err}"
                        )
                        failures[(inv_id, model)] = SkippedPrediction(
                            kind, inv_id, name, model, "dov_unreachable", type(err).__name__
                        )
                        return
                per_inv_layers[inv_id][model] = result.layers

            tasks = [
                _one(kind, inv_id, name, x, y, model)
                for (kind, inv_id, name, x, y, _) in usable
                for model in unique_models
            ]
            self.debug(
                f"dispatching {len(tasks)} Virtuele Boring fetches "
                f"(parallelism={DOV_VIRTUELE_BORING_PARALLELISM})"
            )
            await asyncio.gather(*tasks)

        skipped_fetches = [
            failures[(inv_id, model)]
            for (_, inv_id, _, _, _, _) in usable
            for model in unique_models
            if (inv_id, model) in failures
        ]
        unreachable = [s for s in skipped_fetches if s.reason == "dov_unreachable"]
        if unreachable and len(unreachable) == len(tasks):
            error_classes = dict(Counter(s.detail for s in unreachable))
            self.warning(
                f"fetch_virtuele_boring_predictions: project={project_id} DOV is "
                f"unreachable — all {len(tasks)} fetch(es) failed without an answer "
                f"({error_classes}); no predictions returned"
            )
            raise DovUnreachableError(len(tasks), error_classes)
        for s in unreachable:
            self.warning(
                f"Virtuele Boring fetch skipped for {s.investigation_kind} "
                f"{s.investigation_id} ({s.name}) model={s.model}: DOV did not "
                f"answer ({s.detail})"
            )

        # Build the final ordered list mirroring the usable[] order
        # (CPTs before boreholes, each in DB-insert order).
        predictions = [
            InvestigationPrediction(
                investigation_kind=kind,
                investigation_id=inv_id,
                name=name,
                elevation_m_taw=elevation,
                predictions_by_model=per_inv_layers.get(inv_id, {}),
            )
            for (kind, inv_id, name, _, _, elevation) in usable
        ]

        succeeded = sum(1 for p in predictions if p.predictions_by_model)
        self.success(
            f"fetch_virtuele_boring_predictions: project={project_id} "
            f"{succeeded}/{len(predictions)} investigation(s) returned data "
            f"({skipped} skipped, {len(skipped_fetches)} fetch(es) failed of which "
            f"{len(unreachable)} unreachable, {len(unique_models)} model(s))"
        )
        return VirtueleBoringPredictionsResult(
            models=unique_models,
            predictions=predictions,
            skipped_count=skipped,
            skipped=skipped_fetches,
        )
