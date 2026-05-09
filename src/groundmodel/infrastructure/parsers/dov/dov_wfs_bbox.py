"""Shared async helper for DOV WFS bbox-split + recursion (Phase C4 refactor).

Five DOV WFS clients
(`DovClient` for sondering, `DovBoreholeClient`, `DovInterpretationClient`,
`DovSampleClient`, `DovGrainSizeClient`, `DovScalarObservationClient`) all
duplicate the same `count → split into 4 quadrants → recurse → dedup` pattern
for handling DOV's per-bbox feature cap (`DOV_WFS_FEATURE_LIMIT`, default 500).
We extract that pattern here so each client only owns:

* the layer name,
* the optional `CQL_FILTER`,
* the per-row builder + per-row warning logic,
* the WFS count + features HTTP calls (kept in the client because the
  request-shape differs slightly: query params, error wording, log labels).

What this helper does
---------------------
* Recursive 4-quadrant bbox split when count > `DOV_WFS_FEATURE_LIMIT`.
* Recursion depth-limited at `DOV_WFS_MAX_SPLIT_DEPTH` (a saturated bbox
  emits a WARNING and returns the truncated set).
* Quadrant results merged with permkey-based dedup (a feature near a split
  boundary can appear in multiple sub-bboxes).
* Logs at TRACE/DEBUG/WARNING via the caller-supplied logger so module-name
  attribution stays correct.

What this helper does NOT do
----------------------------
* WFS HTTP. Each client owns `fetch_count` / `fetch_features` so request
  shape, error messages, and feature-property warnings remain client-specific.
* CRS transformation. Callers transform WGS84 → Lambert72 before invoking.
* Per-row dedup against an external set (e.g. `parent_permkeys`). Callers
  apply that filter after the helper returns the merged row list.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_WFS_FEATURE_LIMIT,
    DOV_WFS_MAX_SPLIT_DEPTH,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger

T = TypeVar("T")

CountFn = Callable[[float, float, float, float], Awaitable[int]]
FeaturesFn = Callable[[float, float, float, float], Awaitable[list[T]]]
PermkeyFn = Callable[[T], str]


async def collect_wfs_features_recursive(
    *,
    fetch_count: CountFn,
    fetch_features: FeaturesFn[T],
    row_permkey: PermkeyFn[T],
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    label: str,
    logger: GroundModelLogger,
    depth: int = 0,
) -> list[T]:
    """Recursively fetch all features in the Lambert72 bbox, auto-splitting if dense.

    Parameters
    ----------
    fetch_count : CountFn
        Async callable ``(x1, y1, x2, y2) -> int`` returning DOV's
        ``numberMatched`` for the bbox. Caller-supplied so layer-name + any
        ``CQL_FILTER`` stay encapsulated.
    fetch_features : FeaturesFn[T]
        Async callable ``(x1, y1, x2, y2) -> list[T]`` returning typed rows
        for the bbox. Same encapsulation rationale.
    row_permkey : PermkeyFn[T]
        Pure callable ``(T) -> str`` extracting a stable permkey from a row.
        Used to dedup rows that appear near quadrant split boundaries.
    x1, y1, x2, y2 : float
        Bbox corners in the WFS's native CRS (Lambert72 for DOV).
    label : str
        Short string used in log messages (e.g. ``"DOV WFS boreholes"``)
        so a multi-client run is greppable in logs.
    logger : GroundModelLogger
        Caller's logger. Lets log lines retain the calling module's name
        rather than being attributed to this helper.
    depth : int
        Internal recursion depth — callers should leave at 0.

    Returns
    -------
    list[T]
        Deduplicated rows for the entire bbox. May be empty.
    """
    count = await fetch_count(x1, y1, x2, y2)

    if count == 0:
        logger.trace(
            f"{label}: 0 features at depth={depth} ({x1:.0f},{y1:.0f})→({x2:.0f},{y2:.0f})"
        )
        return []

    if count <= DOV_WFS_FEATURE_LIMIT or depth >= DOV_WFS_MAX_SPLIT_DEPTH:
        if count > DOV_WFS_FEATURE_LIMIT:
            # Hit recursion cap before count fell below the per-bbox cap —
            # we will silently miss the overflow features. Surfaced as a
            # WARNING so dense-bbox imports flag this in the operator log.
            logger.warning(
                f"{label}: bbox at max recursion depth={depth} still has "
                f"{count} features (> {DOV_WFS_FEATURE_LIMIT}) — some rows "
                f"may be missed"
            )
        logger.debug(f"{label}: fetching {count} features (depth={depth})")
        return await fetch_features(x1, y1, x2, y2)

    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    logger.debug(f"{label}: {count} features > limit at depth={depth}, splitting into 4 quadrants")
    quadrants = [
        (x1, y1, mx, my),
        (mx, y1, x2, my),
        (x1, my, mx, y2),
        (mx, my, x2, y2),
    ]
    results = await asyncio.gather(
        *[
            collect_wfs_features_recursive(
                fetch_count=fetch_count,
                fetch_features=fetch_features,
                row_permkey=row_permkey,
                x1=qx1,
                y1=qy1,
                x2=qx2,
                y2=qy2,
                label=label,
                logger=logger,
                depth=depth + 1,
            )
            for qx1, qy1, qx2, qy2 in quadrants
        ]
    )

    # Merge child results, dedup by permkey. A feature close to a quadrant
    # boundary appears in multiple sub-bboxes — without dedup we'd persist
    # duplicates.
    seen: set[str] = set()
    merged: list[T] = []
    for chunk in results:
        for row in chunk:
            key = row_permkey(row)
            if key not in seen:
                seen.add(key)
                merged.append(row)
    logger.debug(f"{label}: depth={depth} quadrants merged → {len(merged)} unique rows")
    return merged
