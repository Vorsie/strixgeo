"""Async DOV WFS client — fetches interpretation rows + XMLs across 8 streams.

Phase C2 companion to ``DovBoreholeClient``. Where ``DovBoreholeClient`` queries
one WFS layer (``dov-pub:Boringen``) for borehole headers, this client queries
all eight ``interpretaties:*`` layers in parallel and downloads every per-
interpretation XML in one shared parallel-download pool.

Design summary
--------------
* **Per-stream WFS bbox query.** Each of the 8 layers
  (``DOV_WFS_INTERPRETATION_LAYERS``) is queried independently inside the
  same ``asyncio.gather`` so all eight ``count`` + ``GetFeature`` HTTP calls
  fly in parallel over HTTP/2.
* **Per-stream recursive bbox split.** When a stream returns more than
  ``DOV_WFS_FEATURE_LIMIT`` features, the bbox splits into four quadrants
  (max recursion ``DOV_WFS_MAX_SPLIT_DEPTH``). Each stream's split is
  independent — a sparse stream doesn't split unnecessarily.
* **Single shared download semaphore.** All XMLs across all streams share
  one ``asyncio.Semaphore(DOV_DOWNLOAD_PARALLELISM)`` so a dense
  stratigraphy stream can't starve a sparse hydrogeology stream of slots.
* **Cache + stream-parse.** Same cache lookup before semaphore acquire,
  same in-task parse callback as the borehole client, so parse work
  overlaps the freed slot starting the next download.
* **Proxy-direct URLs.** ``fiche`` URLs are 302-rewrites of the proxy URL;
  hitting the proxy directly (``DOV_INTERPRETATION_PROXY_URL_PREFIX``) cuts
  one round-trip per download.

Why a separate client (not a refactor of DovBoreholeClient)
-----------------------------------------------------------
The two clients differ in two ways that are uncomfortable to share:

1. ``DovBoreholeClient`` queries a single layer; this one queries 8.
2. The row types carry different fields (the eight stream flags + the
   drill-method summary live on the borehole row but make no sense on an
   interpretation row, which carries ``observation_type``).

A future refactor that extracts a generic WFS-bbox helper (``count``,
``features``, recursive split) is easy when a third caller appears. Until
then, per CLAUDE.md "Never design a layer you haven't needed yet" we keep
this self-contained and well-tested.

Constants live in ``dov_constants.py`` per project convention.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from functools import partial
from typing import Any, TypeVar

import httpx

from groundmodel.domain.value_objects.observation_type import ObservationType
from groundmodel.infrastructure.parsers.borehole.dov.dov_constants import (
    DOV_INTERP_WFS_FICHE_PROP,
    DOV_INTERP_WFS_PROEFNUMMER_PROP,
    DOV_INTERPRETATION_PROXY_URL_PREFIX,
    DOV_INTERPRETATION_URL_PREFIX,
    DOV_WFS_INTERPRETATION_LAYERS,
    DOV_WGS84_TO_LAMBERT72,
)
from groundmodel.infrastructure.parsers.borehole.dov.interpretation_wfs_row import (
    InterpretationWfsRow,
)
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.dov.dov_common import DOV_DOWNLOAD_PARALLELISM
from groundmodel.infrastructure.parsers.dov.dov_http_retry import DovRateLimitState
from groundmodel.infrastructure.parsers.dov.dov_wfs_bbox import (
    collect_wfs_features_recursive,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_download import (
    parallel_download_and_process,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_helpers import last_path_segment
from groundmodel.infrastructure.parsers.dov.dov_wfs_request import (
    wfs_count,
    wfs_features_json,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

_T = TypeVar("_T")
ProcessFn = Callable[[InterpretationWfsRow, bytes], _T]


class DovInterpretationClient(GroundModelLogger):
    """Fetch DOV interpretation rows + XMLs across all eight streams.

    Parameters
    ----------
    http : httpx.AsyncClient
        Shared async HTTP client. Caller must set ``follow_redirects=True``
        so the rare proxy-prefix-mismatch case (where we fall back to the
        public ``fiche`` URL + ``.xml``) still works.
    cache : DovXmlCache | None
        Optional persistent cache for interpretation XMLs. Pass a cache
        rooted under the ``interpretatie/`` subdirectory so permkeys never
        collide with sondering / boring / observation permkeys (DOV's
        ``YYYY-NNNNNN`` permkey format isn't unique across resource types).
    backoff : DovRateLimitState | None
        Optional per-import rate-limit state shared with the other borehole
        sub-clients. When supplied, the per-stream WFS discovery honours it and
        the download phase runs at ``backoff.parallelism`` slots, so a 429 seen
        anywhere in the import halves this phase's concurrency once. ``None``
        keeps the retry with a fixed ``DOV_DOWNLOAD_PARALLELISM``.
    """

    def __init__(
        self,
        http: httpx.AsyncClient,
        cache: DovXmlCache | None = None,
        backoff: DovRateLimitState | None = None,
    ) -> None:
        """Initialise with the shared async HTTP client and optional cache."""
        super().__init__(__name__)
        self._http = http
        self._cache = cache
        self._backoff = backoff

    async def fetch_bbox_processed(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        process: ProcessFn[_T],
        test_ids: set[str] | None = None,
    ) -> list[tuple[InterpretationWfsRow, _T]]:
        """Stream-parse all interpretations in *bbox* across the 8 streams.

        For each stream layer, queries the WFS for features inside the bbox
        (auto-splitting when above ``DOV_WFS_FEATURE_LIMIT``), then downloads
        the per-interpretation XMLs in parallel and runs *process* on each.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.
        process : ProcessFn[_T]
            Callable invoked as ``process(row, xml_bytes)``. The orchestrator
            wires the parser through a closure that resolves the parent
            borehole UUID from the row's ``test_id`` before calling the
            ``DovInterpretationParser``.
        test_ids : set[str] | None
            Optional filter — when provided, rows whose ``test_id`` isn't in
            the set are dropped before download. Used by the orchestrator to
            avoid downloading interpretations for boreholes the caller
            doesn't already have. ``None`` means "process every row".

        Returns
        -------
        list[tuple[InterpretationWfsRow, _T]]
            ``(row, process_result)`` pairs — one per interpretation that
            both downloaded successfully and survived ``process()``. Per-row
            failures are logged at ERROR and dropped from the result.
        """
        x1, y1 = DOV_WGS84_TO_LAMBERT72.transform(west, south)
        x2, y2 = DOV_WGS84_TO_LAMBERT72.transform(east, north)
        self.debug(
            f"DOV interpretation bbox WGS84: W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}"
        )
        self.debug(
            f"DOV interpretation bbox Lambert72: x=[{x1:.0f},{x2:.0f}] y=[{y1:.0f},{y2:.0f}]"
        )

        # Phase 1 — kick off all 8 WFS bbox-collects in parallel. Each runs
        # its own recursive split; total wall time = max(per-stream time).
        # ``functools.partial`` binds (layer) for the count callable and
        # (layer, obs_type) for the features callable, leaving the 4 bbox
        # floats for ``collect_wfs_features_recursive`` to drive recursion.
        rows_per_stream = await asyncio.gather(
            *[
                collect_wfs_features_recursive(
                    fetch_count=partial(self._wfs_count, layer),
                    fetch_features=partial(self._wfs_features, layer, obs_type),
                    row_permkey=lambda r: r.permkey,
                    x1=x1,
                    y1=y1,
                    x2=x2,
                    y2=y2,
                    label=f"DOV WFS interpretation '{layer}'",
                    logger=self,
                )
                for obs_type, layer in DOV_WFS_INTERPRETATION_LAYERS.items()
            ]
        )
        rows: list[InterpretationWfsRow] = [r for chunk in rows_per_stream for r in chunk]
        self.info(f"DOV interpretation WFS: {len(rows)} interpretations across 8 streams in bbox")

        if test_ids is not None:
            before = len(rows)
            rows = [r for r in rows if r.test_id in test_ids]
            self.debug(
                f"DOV interpretation WFS: filtered {before} → {len(rows)} rows by test_id "
                f"(limit set: {len(test_ids)} boreholes)"
            )
        # Effective parallelism reflects any 429 seen during the 8-stream WFS
        # discovery (above) — a rate-limited import backs off its own concurrency.
        effective_parallelism = (
            self._backoff.parallelism if self._backoff is not None else DOV_DOWNLOAD_PARALLELISM
        )
        # Phase 2 — parallel download + inline process across the union
        # of streams. The shared helper owns the semaphore, cache, error
        # logging, and progress reporting.
        return await parallel_download_and_process(
            http=self._http,
            cache=self._cache,
            rows=rows,
            xml_url_of=lambda r: r.xml_url,
            permkey_of=lambda r: r.permkey,
            process=process,
            label="DOV interpretation",
            logger=self,
            error_id_of=lambda r: (
                f"'{r.permkey}' ({r.observation_type.value}, borehole '{r.test_id}')"
            ),
            parallelism=effective_parallelism,
            backoff=self._backoff,
        )

    # ------------------------------------------------------------------
    # WFS request layer (count + features) — per stream. Recursive split is
    # delegated to ``dov_wfs_bbox.collect_wfs_features_recursive`` from the
    # 8-stream parallel gather in ``fetch_bbox_processed``.
    # ------------------------------------------------------------------

    async def _wfs_count(self, layer: str, x1: float, y1: float, x2: float, y2: float) -> int:
        """Return the feature count for *layer* in the Lambert72 bbox."""
        return await wfs_count(
            self._http,
            self,
            layer=layer,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            label=f"interpretation '{layer}'",
            backoff=self._backoff,
        )

    async def _wfs_features(
        self,
        layer: str,
        observation_type: ObservationType,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
    ) -> list[InterpretationWfsRow]:
        """Fetch up to DOV_WFS_FEATURE_LIMIT features and shape them as rows."""
        features = await wfs_features_json(
            self._http,
            self,
            layer=layer,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            label=f"interpretation '{layer}'",
            backoff=self._backoff,
        )
        if features:
            first_props = list(features[0].get("properties", {}).keys())
            self.trace(f"DOV WFS interpretation '{layer}' feature properties: {first_props}")

        rows: list[InterpretationWfsRow] = []
        missing_url = 0
        missing_proefnummer = 0
        for feat in features:
            props: dict[str, Any] = feat.get("properties", {})
            row = self._build_wfs_row(props, observation_type)
            if row is None:
                # Decide which counter to bump from the props themselves so
                # the warning surfaces the actual gap, not a generic count.
                if not props.get(DOV_INTERP_WFS_FICHE_PROP):
                    missing_url += 1
                else:
                    missing_proefnummer += 1
                continue
            rows.append(row)

        if missing_url or missing_proefnummer:
            available = list(features[0].get("properties", {}).keys()) if features else "(none)"
            self.warning(
                f"DOV WFS interpretation '{layer}': skipped {missing_url} rows with no "
                f"fiche URL and {missing_proefnummer} rows with no Proefnummer. "
                f"Available properties: {available}"
            )
        return rows

    def _build_wfs_row(
        self, props: dict[str, Any], observation_type: ObservationType
    ) -> InterpretationWfsRow | None:
        """Build an InterpretationWfsRow from the WFS feature ``properties``.

        Returns ``None`` when the row lacks a ``fiche`` URL (no XML to fetch)
        or a ``Proefnummer`` (no parent borehole to attach to).
        """
        fiche_url: str = props.get(DOV_INTERP_WFS_FICHE_PROP) or ""
        if not fiche_url:
            return None

        proefnummer: str = props.get(DOV_INTERP_WFS_PROEFNUMMER_PROP) or ""
        if not proefnummer:
            return None

        permkey = last_path_segment(fiche_url)
        # Hit the proxy directly to skip the 302; same trick as boring/sondering.
        xml_url = (
            fiche_url.replace(DOV_INTERPRETATION_URL_PREFIX, DOV_INTERPRETATION_PROXY_URL_PREFIX, 1)
            if DOV_INTERPRETATION_URL_PREFIX in fiche_url
            else fiche_url.rstrip("/") + ".xml"
        )
        return InterpretationWfsRow(
            permkey=permkey,
            test_id=proefnummer,
            observation_type=observation_type,
            fiche_url=fiche_url,
            xml_url=xml_url,
        )
