"""Async DOV WFS client — fetches grain-size observation rows + XMLs.

Phase C3 companion to ``DovBoreholeClient`` (boreholes),
``DovInterpretationClient`` (interpretations), and ``DovSampleClient``
(samples). This client queries the unified ``monster:observaties`` WFS
layer with a ``CQL_FILTER`` on ``parametergroep`` so only grain-size
observations come back, then downloads each per-observation XML in
parallel for the parser.

Pipeline (mirrors DovInterpretationClient — count + recursive bbox split
+ shared download semaphore + cache)
--------------------------------------------------------------------------
1. WFS bbox query with ``CQL_FILTER='parametergroep=...'`` (server-side
   filter; see ``GrainSizeWfsRow`` docstring for why).
2. Recursive bbox split on > ``DOV_WFS_FEATURE_LIMIT`` features.
3. Optional ``parent_permkeys`` filter — drop observations whose parent
   sample isn't in the set the orchestrator just persisted.
4. Parallel XML download bounded by a semaphore of
   ``DOV_DOWNLOAD_PARALLELISM`` slots, with persistent on-disk cache
   (``DovXmlCache`` rooted at ``observatie/``).
5. Inline ``process(row, xml_bytes)`` callback so the parser runs while
   the freed slot starts the next download.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypeVar

import httpx

from groundmodel.infrastructure.parsers.cpt.dov.dov_xml_cache import DovXmlCache
from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_DOWNLOAD_PARALLELISM,
    DOV_WGS84_TO_LAMBERT72,
)
from groundmodel.infrastructure.parsers.dov.dov_http_retry import DovRateLimitState
from groundmodel.infrastructure.parsers.dov.dov_wfs_bbox import (
    collect_wfs_features_recursive,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_client_base import DovWfsClientBase
from groundmodel.infrastructure.parsers.dov.dov_wfs_download import (
    parallel_download_and_process,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_helpers import last_path_segment
from groundmodel.infrastructure.parsers.lab.dov.dov_constants import (
    DOV_OBSERVATIE_PROXY_URL_PREFIX,
    DOV_OBSERVATIE_URL_PREFIX,
    DOV_OBSERVATIE_WFS_METHODE_PROP,
    DOV_OBSERVATIE_WFS_OBSERVATION_LINK_PROP,
    DOV_OBSERVATIE_WFS_PARAMETERGROEP_PROP,
    DOV_OBSERVATIE_WFS_PARENT_LINK_PROP,
    DOV_PARAMETERGROEP_GRAIN_SIZE,
    DOV_WFS_OBSERVATIES_LAYER,
)
from groundmodel.infrastructure.parsers.lab.dov.grain_size_wfs_row import GrainSizeWfsRow

_T = TypeVar("_T")
ProcessFn = Callable[[GrainSizeWfsRow, bytes], _T]

# Server-side CQL filter selecting only grain-size observations from the
# unified ``monster:observaties`` WFS layer. The shared ``wfs_*`` helpers
# fold the bbox into this filter via ``BBOX(geom, …)`` because DOV
# rejects requests carrying both ``BBOX=`` and ``CQL_FILTER=``.
_GRAIN_SIZE_PARAMETERGROEP_FILTER = (
    f"{DOV_OBSERVATIE_WFS_PARAMETERGROEP_PROP}='{DOV_PARAMETERGROEP_GRAIN_SIZE}'"
)


class DovGrainSizeClient(DovWfsClientBase[GrainSizeWfsRow]):
    """Fetch DOV grain-size observation rows + XMLs across a bbox.

    Parameters
    ----------
    http : httpx.AsyncClient
        Shared async HTTP client. Caller must set ``follow_redirects=True``
        so the rare proxy-prefix-mismatch case still works.
    cache : DovXmlCache | None
        Optional persistent cache for observation XMLs. Pass a cache
        rooted under ``observatie/`` so permkeys never collide with
        sondering / boring / interpretation permkeys (DOV's
        ``YYYY-NNNNNN`` permkey format isn't unique across resource types).
    backoff : DovRateLimitState | None
        Optional per-import rate-limit state shared with the other borehole
        sub-clients. When supplied, WFS discovery honours it (via the base
        class) and the download phase runs at ``backoff.parallelism`` slots, so
        a 429 seen anywhere in the import halves this phase's concurrency once.
        ``None`` keeps the retry with a fixed ``DOV_DOWNLOAD_PARALLELISM``.
    """

    # Debt #15: WFS layer + label + CQL filter declared as class
    # constants so the base class's inherited _wfs_count / _wfs_features
    # pick them up. The CQL filter narrows the unified observaties
    # layer to the grain-size parametergroep.
    WFS_LAYER = DOV_WFS_OBSERVATIES_LAYER
    LAYER_LABEL = "grain-size"
    CQL_FILTER = _GRAIN_SIZE_PARAMETERGROEP_FILTER

    def __init__(
        self,
        http: httpx.AsyncClient,
        cache: DovXmlCache | None = None,
        backoff: DovRateLimitState | None = None,
    ) -> None:
        """Initialise with the shared HTTP client and optional cache."""
        super().__init__(http, backoff=backoff)
        self._cache = cache

    async def fetch_bbox_processed(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        process: ProcessFn[_T],
        parent_permkeys: set[str] | None = None,
    ) -> list[tuple[GrainSizeWfsRow, _T]]:
        """Stream-parse all grain-size observations in *bbox*.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.
        process : ProcessFn[_T]
            Callable invoked as ``process(row, xml_bytes)``. The
            orchestrator wires ``DovGrainSizeParser.parse`` through a
            closure that resolves the parent sample UUID from the row's
            ``parent_sample_permkey``.
        parent_permkeys : set[str] | None
            When provided, observations whose ``parent_sample_permkey``
            isn't in the set are dropped before download. The orchestrator
            uses this to skip observations belonging to samples it didn't
            just persist.

        Returns
        -------
        list[tuple[GrainSizeWfsRow, _T]]
            One ``(row, process_result)`` pair per observation that
            downloaded successfully and survived ``process()``.
        """
        x1, y1 = DOV_WGS84_TO_LAMBERT72.transform(west, south)
        x2, y2 = DOV_WGS84_TO_LAMBERT72.transform(east, north)
        self.debug(
            f"DOV grain-size bbox WGS84: W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}"
        )
        self.debug(f"DOV grain-size bbox Lambert72: x=[{x1:.0f},{x2:.0f}] y=[{y1:.0f},{y2:.0f}]")

        rows = await collect_wfs_features_recursive(
            fetch_count=self._wfs_count,
            fetch_features=self._wfs_features,
            row_permkey=lambda r: r.permkey,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            label="DOV grain-size WFS",
            logger=self,
        )
        self.info(f"DOV grain-size WFS: {len(rows)} grain-size observations in bbox")

        if parent_permkeys is not None:
            before = len(rows)
            rows = [r for r in rows if r.parent_sample_permkey in parent_permkeys]
            self.debug(
                f"DOV grain-size WFS: filtered {before} → {len(rows)} rows by parent sample "
                f"(limit set: {len(parent_permkeys)} samples)"
            )
        # Effective parallelism reflects any 429 seen during WFS discovery
        # (above) — a rate-limited import backs off its own concurrency.
        effective_parallelism = (
            self._backoff.parallelism if self._backoff is not None else DOV_DOWNLOAD_PARALLELISM
        )
        return await parallel_download_and_process(
            http=self._http,
            cache=self._cache,
            rows=rows,
            xml_url_of=lambda r: r.xml_url,
            permkey_of=lambda r: r.permkey,
            process=process,
            label="DOV grain-size",
            logger=self,
            error_id_of=lambda r: f"'{r.permkey}' (sample '{r.parent_sample_permkey}')",
            parallelism=effective_parallelism,
            backoff=self._backoff,
        )

    # ------------------------------------------------------------------
    # DovWfsClientBase hooks — typed-row construction + per-client
    # skip diagnostics. _wfs_count + _wfs_features are inherited.
    # ------------------------------------------------------------------

    def _build_row(self, props: dict[str, Any]) -> GrainSizeWfsRow | None:
        return _build_row(props)

    def _init_skip_state(self) -> dict[str, int]:
        """Two skip reasons: missing observation URL vs missing parent link."""
        return {"no_url": 0, "no_parent": 0}

    def _on_skipped_feature(self, props: dict[str, Any], state: dict[str, int]) -> dict[str, int]:
        if not props.get(DOV_OBSERVATIE_WFS_OBSERVATION_LINK_PROP):
            state["no_url"] += 1
        else:
            state["no_parent"] += 1
        return state

    def _emit_skip_warning(self, features: list[dict[str, Any]], state: dict[str, int]) -> None:
        if not state["no_url"] and not state["no_parent"]:
            return
        available = list(features[0].get("properties", {}).keys()) if features else "(none)"
        self.warning(
            f"DOV grain-size WFS: skipped {state['no_url']} rows without fiche URL and "
            f"{state['no_parent']} rows without parent sample link. "
            f"Available properties: {available}"
        )


# ---------------------------------------------------------------------------
# Module helpers — pure, no logging, easy to unit-test
# ---------------------------------------------------------------------------


def _build_row(props: dict[str, Any]) -> GrainSizeWfsRow | None:
    """Build a ``GrainSizeWfsRow`` from a WFS feature ``properties`` dict.

    Returns ``None`` when the feature lacks either the per-observation
    URL (no XML to fetch) or the ``gekoppeld_aan_link`` (can't attach
    to any sample).

    The per-observation URL lives in the ``observatie_link`` property
    (NOT ``fiche`` — that's the ``Boringen`` layer's convention; the
    ``monster:observaties`` layer uses ``observatie_link``). Verified
    live via DescribeFeatureType.
    """
    fiche_url: str = props.get(DOV_OBSERVATIE_WFS_OBSERVATION_LINK_PROP) or ""
    if not fiche_url:
        return None

    parent_link: str = props.get(DOV_OBSERVATIE_WFS_PARENT_LINK_PROP) or ""
    if not parent_link:
        return None
    parent_permkey = last_path_segment(parent_link)
    if not parent_permkey:
        return None

    permkey = last_path_segment(fiche_url)
    xml_url = (
        fiche_url.replace(DOV_OBSERVATIE_URL_PREFIX, DOV_OBSERVATIE_PROXY_URL_PREFIX, 1)
        if DOV_OBSERVATIE_URL_PREFIX in fiche_url
        else fiche_url.rstrip("/") + ".xml"
    )
    return GrainSizeWfsRow(
        permkey=permkey,
        parent_sample_permkey=parent_permkey,
        fiche_url=fiche_url,
        xml_url=xml_url,
        methode=props.get(DOV_OBSERVATIE_WFS_METHODE_PROP) or None,
    )
