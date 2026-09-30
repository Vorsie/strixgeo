"""Shared HTTP layer for DOV WFS GetFeature requests.

Five DOV clients (boring, interpretation, sample, grain-size, scalar)
share the same request shape — only the layer name + optional CQL
filter + downstream row builder differ. Before this module each
client carried its own ``_wfs_count`` / ``_wfs_features`` /
``_common_params`` trio with copy-pasted error handling and logging.
A DOV-side rule change (e.g. the BBOX+CQL_FILTER mutual-exclusion that
broke us in 2026-05) had to be patched in five places.

The two functions here own the HTTP / JSON / error-logging boundary;
clients keep their per-layer row-building logic where it belongs.
``cql_filter`` is folded INTO the CQL string via ``cql_bbox_predicate``
when present, since DOV rejects requests that ship both a
``BBOX=`` query param and a ``CQL_FILTER=`` (verified live; the
upstream changed this behaviour without warning, so the helper carries
the lesson).
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_HORIZONTAL_EPSG,
    DOV_WFS_FEATURE_LIMIT,
    DOV_WFS_NUMBER_MATCHED_RE,
    DOV_WFS_URL,
    cql_bbox_predicate,
)
from groundmodel.infrastructure.parsers.dov.dov_http_retry import (
    DovRateLimitState,
    dov_get_with_retry,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger
from groundmodel.shared.timing import ms_since


async def wfs_count(
    http: httpx.AsyncClient,
    logger: GroundModelLogger,
    *,
    layer: str,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    cql_filter: str | None = None,
    label: str | None = None,
    backoff: DovRateLimitState | None = None,
) -> int:
    """Issue a WFS ``resultType=hits`` request and return numberMatched.

    Returns 0 (with an error log) when ``numberMatched`` isn't found in
    the response — defensive: the regex hasn't failed in production
    but a zero-result is preferable to crashing the recursive bbox
    split. Raises ``httpx.HTTPStatusError`` / ``httpx.RequestError``
    on network or HTTP errors so callers can surface them with their
    own context.

    Parameters
    ----------
    http
        Shared async HTTP client (HTTP/2-multiplexed by the DOV factory).
    logger
        ``GroundModelLogger`` from the calling client; receives the
        per-request trace / error lines so log scopes stay accurate.
    layer
        WFS ``typeNames`` value (e.g. ``"boringen:grondmonsters"``).
    x1, y1, x2, y2
        Bounding box corners in Lambert-72 (EPSG:31370) metres.
    cql_filter
        Optional attribute-level CQL predicate (e.g.
        ``"parametergroep='Onderkenningsproeven-korrelverdeling '"``).
        When provided, the bbox is folded into the CQL string and the
        standalone ``BBOX=`` query param is omitted.
    label
        Human-readable name used in log lines. Defaults to ``layer``.
    """
    label = label or layer
    params = _build_params(layer=layer, x1=x1, y1=y1, x2=x2, y2=y2, cql_filter=cql_filter)
    params["resultType"] = "hits"
    logger.trace(f"DOV {label} WFS count request: bbox=[{x1:.0f},{y1:.0f},{x2:.0f},{y2:.0f}]")

    t0 = time.perf_counter()
    try:
        resp = await dov_get_with_retry(
            http, DOV_WFS_URL, params=params, logger=logger, label=label, backoff=backoff
        )
    except httpx.RequestError as exc:
        logger.error(f"DOV {label} WFS count request failed: {exc}")
        raise

    if not resp.is_success:
        logger.error(
            f"DOV {label} WFS count returned HTTP {resp.status_code}  body: {resp.text[:500]!r}"
        )
        resp.raise_for_status()

    match = DOV_WFS_NUMBER_MATCHED_RE.search(resp.text)
    if match is None:
        logger.error(
            f"DOV {label} WFS count: 'numberMatched' not found in response head: "
            f"{resp.text[:300]!r}"
        )
        return 0

    count = int(match.group(1))
    # Response outcome: status + payload size + latency + the matched count.
    # DOV WFS is payload-size-bound (see CLAUDE.local.md), so size + latency are
    # the load-bearing "why was this import slow" signal; the count is what the
    # recursive bbox-split engine reacts to, so it belongs on the same line (0
    # matched also catches the valid empty-bbox case). DEBUG, not INFO — a
    # recursive split issues many of these per import.
    logger.debug(
        f"DOV {label} WFS count response: HTTP {resp.status_code} "
        f"{len(resp.content)}B {ms_since(t0)}ms — {count} matched"
    )
    return count


async def wfs_features_json(
    http: httpx.AsyncClient,
    logger: GroundModelLogger,
    *,
    layer: str,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    cql_filter: str | None = None,
    count: int = DOV_WFS_FEATURE_LIMIT,
    label: str | None = None,
    backoff: DovRateLimitState | None = None,
) -> list[dict[str, Any]]:
    """Issue a WFS GetFeature request and return the GeoJSON ``features`` list.

    Each entry is a feature dict with ``id``, ``geometry``, and
    ``properties`` keys. The caller is responsible for converting them
    into typed rows — that logic varies per client (different field
    names, different skip-reason counters) and stays in the client.

    Parameters mirror ``wfs_count``; ``count`` caps the response size
    (DOV's ``DOV_WFS_FEATURE_LIMIT``) so the recursive bbox-split
    helper can detect "result truncated, split further".
    """
    label = label or layer
    params = _build_params(layer=layer, x1=x1, y1=y1, x2=x2, y2=y2, cql_filter=cql_filter)
    logger.trace(f"DOV {label} WFS features request: bbox=[{x1:.0f},{y1:.0f},{x2:.0f},{y2:.0f}]")
    return await _get_features(http, logger, params, count=count, label=label, backoff=backoff)


async def wfs_features_by_attribute(
    http: httpx.AsyncClient,
    logger: GroundModelLogger,
    *,
    layer: str,
    cql_filter: str,
    count: int = DOV_WFS_FEATURE_LIMIT,
    label: str | None = None,
    backoff: DovRateLimitState | None = None,
) -> list[dict[str, Any]]:
    """Issue a WFS GetFeature filtered by an attribute predicate ONLY (no bbox).

    For a lookup by identity (one borehole by its ``boornummer``) there is no
    area to search: the whole layer is filtered by the CQL predicate. Verified
    live 2026-09-30 on ``dov-pub:Boringen`` (``boornummer LIKE '%GEO-19/122-B7'``
    answers in ~0.3 s over all of Flanders).

    Parameters
    ----------
    http : httpx.AsyncClient
        Shared async HTTP client.
    logger : GroundModelLogger
        The calling client's logger (request + response lines).
    layer : str
        WFS ``typeNames`` value.
    cql_filter : str
        The complete CQL predicate; the caller escapes its string literals.
    count : int
        Response size cap.
    label : str or None
        Log label (default ``layer``).
    backoff : DovRateLimitState or None
        Optional shared rate-limit state.

    Returns
    -------
    list[dict[str, Any]]
        The GeoJSON ``features`` list.

    Raises
    ------
    httpx.HTTPStatusError
        On a non-2xx answer (logged with the body first).
    httpx.RequestError
        On a network failure (logged first).
    """
    label = label or layer
    params: dict[str, str] = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": layer,
        "CQL_FILTER": cql_filter,
    }
    logger.debug(f"DOV {label} WFS attribute request: {cql_filter}")
    return await _get_features(http, logger, params, count=count, label=label, backoff=backoff)


async def _get_features(
    http: httpx.AsyncClient,
    logger: GroundModelLogger,
    params: dict[str, str],
    *,
    count: int,
    label: str,
    backoff: DovRateLimitState | None,
) -> list[dict[str, Any]]:
    """Send one GeoJSON GetFeature and return its ``features`` (shared tail)."""
    params["outputFormat"] = "application/json"
    params["count"] = str(count)

    t0 = time.perf_counter()
    try:
        resp = await dov_get_with_retry(
            http, DOV_WFS_URL, params=params, logger=logger, label=label, backoff=backoff
        )
    except httpx.RequestError as exc:
        logger.error(f"DOV {label} WFS features request failed: {exc}")
        raise

    if not resp.is_success:
        logger.error(
            f"DOV {label} WFS features returned HTTP {resp.status_code}  body: {resp.text[:500]!r}"
        )
        resp.raise_for_status()

    data = resp.json()
    features: list[dict[str, Any]] = data.get("features", [])
    # Response outcome: status + payload size + latency + feature count. Size +
    # latency are the load-bearing "why was this slow" signal (DOV WFS is
    # payload-size-bound); the count catches a truncated / empty result.
    logger.debug(
        f"DOV {label} WFS features response: HTTP {resp.status_code} "
        f"{len(resp.content)}B {ms_since(t0)}ms — {len(features)} features"
    )
    return features


def _build_params(
    *,
    layer: str,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    cql_filter: str | None,
) -> dict[str, str]:
    """Build the shared query-parameter dict.

    ``cql_filter`` and the spatial bbox are mutually exclusive in DOV's
    rules — when an attribute filter is supplied we fold the bbox into
    the CQL string via ``BBOX(geom, ...)`` and skip the ``BBOX=`` query
    param entirely. When no attribute filter is needed the standalone
    ``BBOX=`` form is the right shape (smaller URL, marginally faster
    server-side).

    Bbox corners are normalised so ``minX <= maxX`` and ``minY <= maxY``
    after the WGS84→Lambert-72 projection. Lambert Conformal Conic is
    not axis-aligned with latitude; for very thin rectangles where the
    WGS84 input has near-zero height, the projected south corner can
    land a few centimetres NORTH of the projected north corner, and
    DOV's WFS validator rejects the resulting bbox with HTTP 400
    (``illegal bbox, minY: ... is greater than maxY: ...``). Sorting
    once here covers both the ``BBOX=`` query param path and the
    ``BBOX(geom, ...)`` CQL spatial predicate path.
    """
    min_x, max_x = (x1, x2) if x1 <= x2 else (x2, x1)
    min_y, max_y = (y1, y2) if y1 <= y2 else (y2, y1)

    params: dict[str, str] = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": layer,
    }
    if cql_filter is None:
        params["BBOX"] = f"{min_x},{min_y},{max_x},{max_y},EPSG:{DOV_HORIZONTAL_EPSG}"
    else:
        params["CQL_FILTER"] = (
            f"({cql_filter}) AND {cql_bbox_predicate(min_x, min_y, max_x, max_y)}"
        )
    return params
