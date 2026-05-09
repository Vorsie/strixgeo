"""Async DOV WFS client — fetches sample metadata for the ``boringen:grondmonsters`` layer.

Phase C3 companion to ``DovBoreholeClient`` (boreholes) and
``DovInterpretationClient`` (interpretations). Where those two need a
download phase (per-feature XML body), this one is WFS-only: every field
the Sample entity needs lives in the WFS row itself, so we skip the XML
fetch entirely.

Pipeline
--------
1. Lambert72 bbox transform.
2. Recursive WFS bbox query (``count`` then ``GetFeature``), with auto-
   split on > ``DOV_WFS_FEATURE_LIMIT`` features.
3. Build a ``SampleWfsRow`` per feature, parsing optional fields
   defensively (date parse / float parse / int parse all return None on
   failure rather than raising).
4. Optional ``parent_permkeys`` filter — the orchestrator passes the set
   of borehole permkeys it just persisted so we drop samples for
   boreholes the caller doesn't have in this batch.

Why no separate cache / parse phase
-----------------------------------
A WFS-only client has nothing to cache: we issue exactly one bbox
``GetFeature`` per quadrant and use the response directly. The on-disk
DOV cache (``DovXmlCache``) is keyed by permkey and stores per-resource
XML bodies — not WFS responses — so it doesn't apply here.

Constants live in ``dov_constants.py`` per project convention.
"""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Any

import httpx

from groundmodel.infrastructure.parsers.borehole.dov.dov_constants import (
    DOV_GRONDMONSTER_WFS_COMPOSITION_PROP,
    DOV_GRONDMONSTER_WFS_DEPTH_BASE_PROP,
    DOV_GRONDMONSTER_WFS_DEPTH_TOP_PROP,
    DOV_GRONDMONSTER_WFS_INSTRUMENT_PROP,
    DOV_GRONDMONSTER_WFS_MONSTER_LINK_PROP,
    DOV_GRONDMONSTER_WFS_OBSERVATION_COUNT_PROP,
    DOV_GRONDMONSTER_WFS_PARENT_LINK_PROP,
    DOV_GRONDMONSTER_WFS_PERMKEY_PROP,
    DOV_GRONDMONSTER_WFS_SAMPLE_NUMBER_PROP,
    DOV_GRONDMONSTER_WFS_SAMPLE_TYPE_PROP,
    DOV_GRONDMONSTER_WFS_SAMPLING_DATE_PROP,
    DOV_HORIZONTAL_EPSG,
    DOV_WFS_FEATURE_LIMIT,
    DOV_WFS_GRONDMONSTERS_LAYER,
    DOV_WFS_MAX_SPLIT_DEPTH,
    DOV_WFS_NUMBER_MATCHED_RE,
    DOV_WFS_URL,
    DOV_WGS84_TO_LAMBERT72,
)
from groundmodel.infrastructure.parsers.borehole.dov.sample_wfs_row import SampleWfsRow
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DovSampleClient(GroundModelLogger):
    """Fetch DOV sample (``boringen:grondmonsters``) headers for a bbox.

    Parameters
    ----------
    http : httpx.AsyncClient
        Shared async HTTP client. ``follow_redirects=True`` is enforced
        by the parent orchestrator, but this client doesn't trigger
        redirects (WFS responds with the JSON directly).
    """

    def __init__(self, http: httpx.AsyncClient) -> None:
        """Initialise with the shared HTTP client."""
        super().__init__(__name__)
        self._http = http

    async def fetch_bbox(
        self,
        west: float,
        south: float,
        east: float,
        north: float,
        parent_permkeys: set[str] | None = None,
    ) -> list[SampleWfsRow]:
        """Return all sample WFS rows in *bbox*, optionally filtered by parent.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.
        parent_permkeys : set[str] | None
            When provided, drop samples whose ``parent_borehole_permkey``
            isn't in the set. Used by the orchestrator to skip samples
            for boreholes that weren't newly imported (those are
            duplicates, and the parent C2 idempotency rule applies here
            too).

        Returns
        -------
        list[SampleWfsRow]
            One row per sample inside the bbox (and inside the filter,
            if provided). May be empty.
        """
        x1, y1 = DOV_WGS84_TO_LAMBERT72.transform(west, south)
        x2, y2 = DOV_WGS84_TO_LAMBERT72.transform(east, north)
        self.debug(f"DOV sample bbox WGS84: W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}")
        self.debug(f"DOV sample bbox Lambert72: x=[{x1:.0f},{x2:.0f}] y=[{y1:.0f},{y2:.0f}]")

        rows = await self._collect_rows(x1, y1, x2, y2, depth=0)
        self.info(f"DOV sample WFS: {len(rows)} samples in bbox")

        if parent_permkeys is not None:
            before = len(rows)
            rows = [r for r in rows if r.parent_borehole_permkey in parent_permkeys]
            self.debug(
                f"DOV sample WFS: filtered {before} → {len(rows)} samples by parent permkey "
                f"(limit set: {len(parent_permkeys)} boreholes)"
            )
        return rows

    # ------------------------------------------------------------------
    # Recursive WFS bbox query (mirrors DovBoreholeClient pattern)
    # ------------------------------------------------------------------

    async def _collect_rows(
        self, x1: float, y1: float, x2: float, y2: float, depth: int
    ) -> list[SampleWfsRow]:
        """Return SampleWfsRow per sample in this Lambert72 bbox, splitting if dense."""
        count = await self._wfs_count(x1, y1, x2, y2)

        if count == 0:
            self.trace(
                f"DOV sample WFS: 0 features at depth={depth} "
                f"({x1:.0f},{y1:.0f})→({x2:.0f},{y2:.0f})"
            )
            return []

        if count <= DOV_WFS_FEATURE_LIMIT or depth >= DOV_WFS_MAX_SPLIT_DEPTH:
            if count > DOV_WFS_FEATURE_LIMIT:
                self.warning(
                    f"DOV sample WFS: bbox at max recursion depth={depth} still has "
                    f"{count} features (> {DOV_WFS_FEATURE_LIMIT}) — "
                    f"some samples may be missed"
                )
            self.debug(f"DOV sample WFS: fetching {count} features (depth={depth})")
            return await self._wfs_features(x1, y1, x2, y2)

        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        self.debug(
            f"DOV sample WFS: {count} features > limit at depth={depth}, splitting into 4 quadrants"
        )
        quadrants = [
            (x1, y1, mx, my),
            (mx, y1, x2, my),
            (x1, my, mx, y2),
            (mx, my, x2, y2),
        ]
        results = await asyncio.gather(
            *[self._collect_rows(qx1, qy1, qx2, qy2, depth + 1) for qx1, qy1, qx2, qy2 in quadrants]
        )

        seen: set[str] = set()
        merged: list[SampleWfsRow] = []
        for chunk in results:
            for row in chunk:
                if row.permkey not in seen:
                    seen.add(row.permkey)
                    merged.append(row)
        self.debug(f"DOV sample WFS: depth={depth} quadrants merged → {len(merged)} unique samples")
        return merged

    async def _wfs_count(self, x1: float, y1: float, x2: float, y2: float) -> int:
        """Return the number of samples in the Lambert72 bbox."""
        bbox = f"{x1},{y1},{x2},{y2},EPSG:{DOV_HORIZONTAL_EPSG}"
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": DOV_WFS_GRONDMONSTERS_LAYER,
            "resultType": "hits",
            "BBOX": bbox,
        }
        self.trace(f"DOV sample WFS count request: BBOX={bbox}")

        try:
            resp = await self._http.get(DOV_WFS_URL, params=params)
        except httpx.RequestError as exc:
            self.error(f"DOV sample WFS count request failed: {exc}")
            raise

        if not resp.is_success:
            self.error(
                f"DOV sample WFS count returned HTTP {resp.status_code}  body: {resp.text[:500]!r}"
            )
            resp.raise_for_status()

        match = DOV_WFS_NUMBER_MATCHED_RE.search(resp.text)
        if match is None:
            self.error(
                f"DOV sample WFS count: 'numberMatched' not found in response head: "
                f"{resp.text[:300]!r}"
            )
            return 0

        return int(match.group(1))

    async def _wfs_features(self, x1: float, y1: float, x2: float, y2: float) -> list[SampleWfsRow]:
        """Fetch up to DOV_WFS_FEATURE_LIMIT samples for this bbox."""
        bbox = f"{x1},{y1},{x2},{y2},EPSG:{DOV_HORIZONTAL_EPSG}"
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": DOV_WFS_GRONDMONSTERS_LAYER,
            "outputFormat": "application/json",
            "count": str(DOV_WFS_FEATURE_LIMIT),
            "BBOX": bbox,
        }
        self.trace(f"DOV sample WFS features request: BBOX={bbox}")

        try:
            resp = await self._http.get(DOV_WFS_URL, params=params)
        except httpx.RequestError as exc:
            self.error(f"DOV sample WFS features request failed: {exc}")
            raise

        if not resp.is_success:
            self.error(
                f"DOV sample WFS features returned HTTP {resp.status_code}  "
                f"body: {resp.text[:500]!r}"
            )
            resp.raise_for_status()

        data = resp.json()
        features = data.get("features", [])
        self.debug(f"DOV sample WFS: {len(features)} features in response (bbox={bbox})")
        if features:
            first_props = list(features[0].get("properties", {}).keys())
            self.trace(f"DOV sample WFS feature properties: {first_props}")

        rows: list[SampleWfsRow] = []
        skipped_no_permkey = 0
        skipped_no_parent = 0
        for feat in features:
            props: dict[str, Any] = feat.get("properties", {})
            row = _build_row(props)
            if row is None:
                # Decide which counter to bump for the diagnostic warning.
                if not props.get(DOV_GRONDMONSTER_WFS_PERMKEY_PROP):
                    skipped_no_permkey += 1
                else:
                    skipped_no_parent += 1
                continue
            rows.append(row)

        if skipped_no_permkey or skipped_no_parent:
            available = list(features[0].get("properties", {}).keys()) if features else "(none)"
            self.warning(
                f"DOV sample WFS: skipped {skipped_no_permkey} rows without permkey and "
                f"{skipped_no_parent} rows without parent borehole link. "
                f"Available properties: {available}"
            )
        return rows


# ---------------------------------------------------------------------------
# Module helpers — pure, no logging, easy to unit-test
# ---------------------------------------------------------------------------


def _build_row(props: dict[str, Any]) -> SampleWfsRow | None:
    """Build a ``SampleWfsRow`` from a WFS feature ``properties`` dict.

    Returns ``None`` when the feature lacks either the sample's own permkey
    (no stable identity) or the parent-borehole link (can't attach to any
    borehole). Both are mandatory; the rest is best-effort.
    """
    permkey = props.get(DOV_GRONDMONSTER_WFS_PERMKEY_PROP) or ""
    if not permkey:
        return None

    parent_link: str = props.get(DOV_GRONDMONSTER_WFS_PARENT_LINK_PROP) or ""
    if not parent_link:
        return None
    parent_permkey = _last_path_segment(parent_link)
    if not parent_permkey:
        return None

    return SampleWfsRow(
        permkey=permkey,
        parent_borehole_permkey=parent_permkey,
        monster_xml_url=props.get(DOV_GRONDMONSTER_WFS_MONSTER_LINK_PROP) or "",
        depth_top_m=_optional_float(props.get(DOV_GRONDMONSTER_WFS_DEPTH_TOP_PROP)),
        depth_base_m=_optional_float(props.get(DOV_GRONDMONSTER_WFS_DEPTH_BASE_PROP)),
        sample_number=props.get(DOV_GRONDMONSTER_WFS_SAMPLE_NUMBER_PROP) or None,
        sample_type=props.get(DOV_GRONDMONSTER_WFS_SAMPLE_TYPE_PROP) or None,
        composition=props.get(DOV_GRONDMONSTER_WFS_COMPOSITION_PROP) or None,
        instrument=props.get(DOV_GRONDMONSTER_WFS_INSTRUMENT_PROP) or None,
        sampling_date=_optional_date(props.get(DOV_GRONDMONSTER_WFS_SAMPLING_DATE_PROP)),
        observation_count=_optional_int(props.get(DOV_GRONDMONSTER_WFS_OBSERVATION_COUNT_PROP)),
    )


def _last_path_segment(url: str) -> str:
    """Return the last path segment of *url* (e.g. ``"2017-137886"``)."""
    return url.rstrip("/").rsplit("/", 1)[-1]


def _optional_float(value: Any) -> float | None:
    """Return float(value) or None when value is None / non-numeric."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _optional_int(value: Any) -> int | None:
    """Return int(value) or None when value is None / non-numeric."""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _optional_date(value: Any) -> date | None:
    """Return ``date.fromisoformat(value)`` or None when value is None / unparseable."""
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None
