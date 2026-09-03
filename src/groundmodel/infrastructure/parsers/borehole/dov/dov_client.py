"""Async DOV WFS client — fetches borehole metadata and XML files in parallel.

Mirrors ``cpt/dov/dov_client.py`` deliberately: same bbox-split + parallel-
download + cache pattern, same stream-parse trick (process callback runs
inside each download task so parse work overlaps with the next download
batch). Differences:

* WFS layer is ``dov-pub:Boringen`` (boreholes) instead of
  ``dov-pub:Sonderingen`` (CPTs).
* Each WFS row carries metadata absent from the boring XML — the
  ``methode`` summary, the eight boolean flags telling us which
  interpretation streams exist, ``Z_mTAW`` (a fallback for boreholes
  whose XML omits Z), and the borehole's ``boornummer``. We expose those
  via a typed ``BoreholeWfsRow`` so the orchestrator can enrich the
  parsed ``Borehole`` without re-querying.
* XML cache lives in a ``boring/`` subdirectory of the shared DOV cache
  so boring permkeys never collide with sondering / interpretation /
  observation permkeys.

XML download:
  The WFS feature ``fiche`` property points at
  ``https://www.dov.vlaanderen.be/data/boring/{permkey}`` which 302-
  redirects to the proxy. We hit the proxy directly to skip the redirect.

Constants live in ``dov_constants.py`` per the project convention.

Debugging:
  - Set log level to TRACE for per-feature property dumps.
  - On WFS count = 0 when you expect results, sanity-check Lambert72
    coords are inside Belgium (X ≈ 20–290k, Y ≈ 150–245k).
  - On 404 from XML downloads, the ``fiche`` URL prefix may have
    changed — see the property dump from ``_wfs_features``.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

import httpx

from groundmodel.infrastructure.parsers.borehole.dov.borehole_wfs_row import BoreholeWfsRow
from groundmodel.infrastructure.parsers.borehole.dov.dov_constants import (
    DOV_BORING_PROXY_URL_PREFIX,
    DOV_BORING_URL_PREFIX,
    DOV_VERTICAL_EPSG,
    DOV_WFS_BORINGEN_LAYER,
    DOV_WGS84_TO_LAMBERT72,
)
from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_DOWNLOAD_PARALLELISM,
    DOV_MAX_IMPORT_FEATURES,
)
from groundmodel.infrastructure.parsers.dov.dov_http_retry import DovRateLimitState
from groundmodel.infrastructure.parsers.dov.dov_wfs_bbox import (
    collect_wfs_features_recursive,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_client_base import DovWfsClientBase
from groundmodel.infrastructure.parsers.dov.dov_wfs_download import (
    parallel_download_and_process,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_helpers import (
    last_path_segment,
    optional_float,
)
from groundmodel.shared.exceptions import DovImportTooLargeError
from groundmodel.shared.progress import ProgressCallback, fire_progress

_T = TypeVar("_T")
ProcessFn = Callable[[bytes, str], _T]


class DovBoreholeClient(DovWfsClientBase[BoreholeWfsRow]):
    """Fetch DOV borehole metadata via WFS and download boring XMLs in parallel.

    Parameters
    ----------
    http : httpx.AsyncClient
        Shared async HTTP client. Caller must set ``follow_redirects=True``
        because the boring XML endpoint 302-redirects when the proxy-direct
        shortcut isn't applicable.
    cache : DovXmlCache | None
        Optional persistent cache for boring XMLs. When provided, downloads
        consult the cache first and store fresh downloads. Pass a cache
        rooted at the boring/ subdirectory so permkeys don't collide with
        sondering / interpretation / observation permkeys (DOV's permkey
        format YYYY-NNNNNN is shared across resource types).
    backoff : DovRateLimitState | None
        Optional per-import rate-limit state shared with the other borehole
        sub-clients. When supplied, WFS discovery honours it (via the base
        class) and the download phase runs at ``backoff.parallelism`` slots, so
        a 429 seen anywhere in the import halves this phase's concurrency once.
        ``None`` keeps the retry with a fixed ``DOV_DOWNLOAD_PARALLELISM``.
    """

    # Debt #15: layer + label declared as class constants so the base
    # class's inherited _wfs_count / _wfs_features pick them up.
    WFS_LAYER = DOV_WFS_BORINGEN_LAYER
    LAYER_LABEL = "borehole"

    def __init__(
        self,
        http: httpx.AsyncClient,
        cache: DovXmlCache | None = None,
        backoff: DovRateLimitState | None = None,
    ) -> None:
        super().__init__(http, backoff=backoff)
        self._cache = cache

    async def fetch_bbox_processed(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        process: ProcessFn[_T],
        *,
        progress_cb: ProgressCallback | None = None,
    ) -> tuple[int, list[tuple[BoreholeWfsRow, _T]]]:
        """Stream-parse: download every boring XML in the bbox and process inline.

        For each borehole inside the WGS84 bbox, downloads the boring XML
        (or reads from cache) and runs *process(xml_bytes, name)* on it.
        Failures from process() are caught per-borehole so one bad XML
        doesn't kill the batch.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.
        process : ProcessFn[_T]
            Callable invoked as ``process(xml_bytes, test_id)``. Typically
            ``DovBoringParser().parse``, returning a ``BoreholeParseResult``.
        progress_cb : ProgressCallback | None
            Optional progress callback.  Receives ``("wfs", total, total)``
            after WFS discovery and ``("download", done, total)`` periodically
            during the download phase.  Default ``None`` preserves the
            existing no-callback behaviour for all callers that don't opt in.

        Returns
        -------
        tuple[int, list[tuple[BoreholeWfsRow, _T]]]
            ``(discovered, pairs)`` where *discovered* is the raw WFS feature
            count and *pairs* are ``(wfs_row, process_result)`` tuples — one
            per borehole that was successfully downloaded and processed.
            ``discovered - len(pairs)`` is the count lost to download/parse
            failures.  The orchestrator uses ``wfs_row`` to enrich the parse
            result with WFS-only metadata (``drill_method``, the eight stream
            flags, Z fallback, etc.).
        """
        x1, y1 = DOV_WGS84_TO_LAMBERT72.transform(west, south)
        x2, y2 = DOV_WGS84_TO_LAMBERT72.transform(east, north)
        self.debug(f"DOV bbox WGS84: W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}")
        self.debug(
            f"DOV bbox Lambert72: x=[{x1:.0f},{x2:.0f}]  y=[{y1:.0f},{y2:.0f}]  "
            f"(valid range: x≈20k–290k, y≈150k–245k)"
        )

        rows = await collect_wfs_features_recursive(
            fetch_count=self._wfs_count,
            fetch_features=self._wfs_features,
            row_permkey=lambda r: r.permkey,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            label="DOV WFS boreholes",
            logger=self,
        )
        self.info(f"DOV WFS: {len(rows)} unique boreholes found in bbox")

        # Discovery ceiling — refuse a runaway import BEFORE the download phase
        # fans out to thousands of parallel XML GETs (mirrors the CPT use case's
        # guard; the CPT client separates discovery from download so its guard
        # lives in the use case, the borehole client resolves both here).
        if len(rows) > DOV_MAX_IMPORT_FEATURES:
            raise DovImportTooLargeError(len(rows), DOV_MAX_IMPORT_FEATURES)

        # Report WFS discovery complete so the UI can show "N boreholes found".
        await fire_progress(progress_cb, "wfs", len(rows), len(rows))

        # Effective parallelism reflects any 429 seen during WFS discovery
        # (which ran just above), so a rate-limited import backs off its own
        # concurrency instead of hammering DOV into more 429s.
        effective_parallelism = (
            self._backoff.parallelism if self._backoff is not None else DOV_DOWNLOAD_PARALLELISM
        )
        # ``parallel_download_and_process`` expects a ``(row, xml_bytes)``
        # callback; this client's existing ``ProcessFn`` is the legacy
        # ``(xml_bytes, test_id)`` shape (kept stable because the
        # orchestrator wires ``DovBoringParser().parse`` straight into it).
        # A one-line lambda bridges the two without rippling the change
        # outward.
        results = await parallel_download_and_process(
            http=self._http,
            cache=self._cache,
            rows=rows,
            xml_url_of=lambda r: r.xml_url,
            permkey_of=lambda r: r.permkey,
            process=lambda r, xml_bytes: process(xml_bytes, r.test_id),
            label="DOV",
            logger=self,
            error_id_of=lambda r: f"'{r.test_id}'",
            progress_cb=progress_cb,
            parallelism=effective_parallelism,
            backoff=self._backoff,
        )
        return len(rows), results

    # ------------------------------------------------------------------
    # DovWfsClientBase hooks — typed-row construction + per-client
    # diagnostic. _wfs_count + _wfs_features are inherited.
    # ------------------------------------------------------------------

    def _build_row(self, props: dict[str, Any]) -> BoreholeWfsRow | None:
        return self._build_wfs_row(props)

    def _emit_skip_warning(self, features: list[dict[str, Any]], state: int) -> None:
        # Override the default skip-warning wording (the borehole client
        # historically said "no usable 'fiche' URL" specifically — kept
        # so log-greps for the prior message keep matching). Also
        # piggybacks the vertical-EPSG trace, which the previous bespoke
        # _wfs_features emitted once per batch as a sanity check.
        self.trace(f"DOV WFS: vertical EPSG = {DOV_VERTICAL_EPSG} (mTAW)")
        if state <= 0:
            return
        available = list(features[0].get("properties", {}).keys()) if features else "(none)"
        self.warning(
            f"DOV WFS: {state} features had no usable 'fiche' URL — "
            f"skipped. Available properties: {available}"
        )

    def _build_wfs_row(self, props: dict[str, Any]) -> BoreholeWfsRow | None:
        """Build a BoreholeWfsRow from the WFS feature's ``properties`` dict.

        Returns ``None`` when the feature lacks a ``fiche`` URL — without
        that we can't fetch the boring XML and the row is unusable.
        """
        fiche_url: str = props.get("fiche") or ""
        if not fiche_url:
            return None

        permkey = last_path_segment(fiche_url)
        # Hit the proxy directly to skip the 302; fall back to fiche+'.xml'
        # (and the httpx client's follow_redirects) when the URL prefix
        # doesn't match what we expect.
        xml_url = (
            fiche_url.replace(DOV_BORING_URL_PREFIX, DOV_BORING_PROXY_URL_PREFIX, 1)
            if DOV_BORING_URL_PREFIX in fiche_url
            else fiche_url.rstrip("/") + ".xml"
        )
        # x/y/z are typed ``float | None`` because DOV could in theory ship a
        # null coordinate in a WFS row (the WFS schema allows it). The
        # orchestrator's ``_merge_wfs`` rejects rows that end up with no x/y
        # from either WFS or boring XML — we never persist a borehole that
        # can't be placed on a map. Z (surface elevation in mTAW) is allowed
        # to remain None: the parser flags NO_ELEVATION and the UI will
        # surface a manual-entry editor (Phase 4 / Layer 4 todo).
        # EPSG codes (Lambert 72 horizontal, mTAW vertical) are hardcoded
        # via ``DOV_HORIZONTAL_EPSG`` / ``DOV_VERTICAL_EPSG`` because this
        # is the DOV-only client — every other source brings its own
        # parser/client pair with its own CRS constants.
        return BoreholeWfsRow(
            permkey=permkey,
            test_id=props.get("boornummer") or permkey,
            fiche_url=fiche_url,
            xml_url=xml_url,
            x=optional_float(props.get("X_mL72")),
            y=optional_float(props.get("Y_mL72")),
            z=optional_float(props.get("Z_mTAW")),
            drill_method=props.get("methode") or None,
            municipality=props.get("gemeente") or None,
            executor=props.get("uitvoerder") or None,
            purpose=props.get("doel") or None,
            total_depth_m=optional_float(props.get("diepte_tot_m")),
            has_coded_lithology=bool(props.get("gecodeerde_lithologie")),
            has_geotechnical_coding=bool(props.get("geotechnische_codering")),
            has_lithological_description=bool(props.get("lithologische_beschrijving")),
            has_informal_stratigraphy=bool(props.get("informele_stratigrafie")),
            has_formal_stratigraphy=bool(props.get("formele_stratigrafie")),
            has_quaternary_stratigraphy=bool(props.get("quartaire_stratigrafie")),
            has_hydrogeological_stratigraphy=bool(props.get("hydrogeologische_stratigrafie")),
            has_informal_hydrogeological_stratigraphy=bool(
                props.get("informele_hydrostratigrafie")
            ),
        )
