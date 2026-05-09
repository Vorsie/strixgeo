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
    DOV_WFS_NUMBER_MATCHED_RE,
    DOV_WFS_URL,
    DOV_WGS84_TO_LAMBERT72,
)
from groundmodel.infrastructure.parsers.borehole.dov.sample_wfs_row import SampleWfsRow
from groundmodel.infrastructure.parsers.dov.dov_wfs_bbox import (
    collect_wfs_features_recursive,
)
from groundmodel.infrastructure.parsers.dov.dov_wfs_helpers import (
    last_path_segment,
    optional_date,
    optional_float,
    optional_int,
)
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

        rows = await collect_wfs_features_recursive(
            fetch_count=self._wfs_count,
            fetch_features=self._wfs_features,
            row_permkey=lambda r: r.permkey,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            label="DOV sample WFS",
            logger=self,
        )
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
    # WFS request layer (count + features). Recursive split is delegated
    # to ``dov_wfs_bbox.collect_wfs_features_recursive`` from ``fetch_bbox``.
    # ------------------------------------------------------------------

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

    DOV's ``boringen:grondmonsters`` layer pipe-wraps multi-link fields
    (``gekoppeld_aan_link``, ``bemonsteringsinstrument``) — a sample can
    point at multiple parent boreholes / be taken with multiple
    instruments — so we strip the outer pipes before parsing. For now we
    take the FIRST parent borehole; multi-parent samples are rare and
    multi-attachment is a structural change for later.
    """
    permkey = props.get(DOV_GRONDMONSTER_WFS_PERMKEY_PROP) or ""
    if not permkey:
        return None

    parent_link_raw: str = props.get(DOV_GRONDMONSTER_WFS_PARENT_LINK_PROP) or ""
    parent_link = _first_pipe_segment(parent_link_raw)
    if not parent_link:
        return None
    parent_permkey = last_path_segment(parent_link)
    if not parent_permkey:
        return None

    return SampleWfsRow(
        permkey=permkey,
        parent_borehole_permkey=parent_permkey,
        monster_xml_url=props.get(DOV_GRONDMONSTER_WFS_MONSTER_LINK_PROP) or "",
        depth_top_m=optional_float(props.get(DOV_GRONDMONSTER_WFS_DEPTH_TOP_PROP)),
        depth_base_m=optional_float(props.get(DOV_GRONDMONSTER_WFS_DEPTH_BASE_PROP)),
        sample_number=props.get(DOV_GRONDMONSTER_WFS_SAMPLE_NUMBER_PROP) or None,
        sample_type=props.get(DOV_GRONDMONSTER_WFS_SAMPLE_TYPE_PROP) or None,
        composition=props.get(DOV_GRONDMONSTER_WFS_COMPOSITION_PROP) or None,
        instrument=_first_pipe_segment(props.get(DOV_GRONDMONSTER_WFS_INSTRUMENT_PROP) or "")
        or None,
        sampling_date=optional_date(props.get(DOV_GRONDMONSTER_WFS_SAMPLING_DATE_PROP)),
        observation_count=optional_int(props.get(DOV_GRONDMONSTER_WFS_OBSERVATION_COUNT_PROP)),
    )


def _first_pipe_segment(value: str) -> str:
    """Return the first non-empty entry of a pipe-wrapped DOV multi-link field.

    DOV encodes multi-valued grondmonster fields as ``|val1|val2|`` (pipes
    on either side, pipes between entries). Splitting on ``|`` yields
    leading/trailing empty strings around the real values; this helper
    returns the first non-empty entry, or empty string when the input is
    empty or contains only pipes.
    """
    if not value:
        return ""
    for entry in value.split("|"):
        stripped = entry.strip()
        if stripped:
            return stripped
    return ""
