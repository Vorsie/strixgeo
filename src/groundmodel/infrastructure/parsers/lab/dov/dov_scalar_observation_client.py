"""Async DOV WFS client — fetches scalar lab-test observations (Phase C4).

Same ``monster:observaties`` WFS layer as ``DovGrainSizeClient`` but with two
critical differences:

1. **Server-side filter on ``parameter`` (not just ``parametergroep``).** DOV's
   ``Bodem_chemisch`` parametergroep contains both CaCO3 and organic-carbon
   measurements (and pH, Kalkgehalte_beschrijvend, ...), so filtering on the
   group alone would catch the wrong rows. We accept either a single
   parameter string or a list of strings (CQL ``IN (...)``).
2. **No per-observation XML download.** The WFS row carries ``resultaat``
   directly — that's all the scalar tests need. So this client returns
   ``ScalarObservationWfsRow`` instances; the orchestrator maps them
   straight into ORM rows without a separate parse phase.

Pipeline
--------
1. Lambert72 bbox transform.
2. Recursive WFS bbox query (``count`` then ``GetFeature``) with the parameter
   CQL filter, auto-splitting on > ``DOV_WFS_FEATURE_LIMIT`` features.
3. Optional ``parent_permkeys`` filter — drop rows whose parent sample isn't
   in the set the orchestrator just persisted.

Why no shared base class with the other 4 DOV WFS clients (yet)
---------------------------------------------------------------
The recursive bbox-split + count pattern is now duplicated across five
clients (boring, interpretation, sample, grain-size, scalar). That's clearly
abstraction-worthy. Per CLAUDE.md "feel the pain, then abstract" we'll
extract the shared base in a follow-up refactor — keeping this phase
focused on the new functionality.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from datetime import date
from typing import Any

import httpx

from groundmodel.infrastructure.parsers.dov.dov_common import (
    DOV_HORIZONTAL_EPSG,
    DOV_WFS_FEATURE_LIMIT,
    DOV_WFS_MAX_SPLIT_DEPTH,
    DOV_WFS_NUMBER_MATCHED_RE,
    DOV_WFS_URL,
    DOV_WGS84_TO_LAMBERT72,
)
from groundmodel.infrastructure.parsers.lab.dov.dov_constants import (
    DOV_OBSERVATIE_WFS_DETECTIECONDITIE_PROP,
    DOV_OBSERVATIE_WFS_EENHEID_PROP,
    DOV_OBSERVATIE_WFS_FENOMEENTIJD_PROP,
    DOV_OBSERVATIE_WFS_METHODE_PROP,
    DOV_OBSERVATIE_WFS_OBSERVATION_LINK_PROP,
    DOV_OBSERVATIE_WFS_PARAMETER_PROP,
    DOV_OBSERVATIE_WFS_PARENT_LINK_PROP,
    DOV_OBSERVATIE_WFS_RESULTAAT_PROP,
    DOV_WFS_OBSERVATIES_LAYER,
)
from groundmodel.infrastructure.parsers.lab.dov.scalar_observation_wfs_row import (
    ScalarObservationWfsRow,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class DovScalarObservationClient(GroundModelLogger):
    """Fetch scalar lab-test observation rows from ``monster:observaties``.

    Parameters
    ----------
    http : httpx.AsyncClient
        Shared async HTTP client. ``follow_redirects=True`` is enforced by
        the parent orchestrator but doesn't matter here — WFS returns JSON
        directly, no redirects.
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
        parameters: str | Sequence[str],
        parent_permkeys: set[str] | None = None,
    ) -> list[ScalarObservationWfsRow]:
        """Return all matching scalar observations in *bbox*.

        Parameters
        ----------
        west, south, east, north : float
            Bounding box corners in WGS84 decimal degrees.
        parameters : str | Sequence[str]
            One parameter string (single CQL ``=`` filter) OR a sequence of
            strings (CQL ``IN`` filter). The Atterberg phase passes a
            two-element list (LL + PL); CaCO3 / organic / water-content
            phases each pass a single string.
        parent_permkeys : set[str] | None
            When provided, drop observations whose parent sample isn't in
            the set. Mirrors the C3 grain-size client's filter semantics.

        Returns
        -------
        list[ScalarObservationWfsRow]
            One row per matching observation. May be empty.
        """
        x1, y1 = DOV_WGS84_TO_LAMBERT72.transform(west, south)
        x2, y2 = DOV_WGS84_TO_LAMBERT72.transform(east, north)
        params_label = parameters if isinstance(parameters, str) else f"[{len(parameters)} params]"
        self.debug(
            f"DOV scalar-observation bbox WGS84: "
            f"W={west:.4f} S={south:.4f} E={east:.4f} N={north:.4f}  "
            f"filter={params_label}"
        )

        cql_filter = self._build_cql_filter(parameters)
        rows = await self._collect_rows(cql_filter, params_label, x1, y1, x2, y2, depth=0)
        self.info(
            f"DOV scalar-observation WFS: {len(rows)} observations in bbox (filter={params_label})"
        )

        if parent_permkeys is not None:
            before = len(rows)
            rows = [r for r in rows if r.parent_sample_permkey in parent_permkeys]
            self.debug(
                f"DOV scalar-observation WFS: filtered {before} → {len(rows)} rows "
                f"by parent sample (limit set: {len(parent_permkeys)} samples)"
            )
        return rows

    # ------------------------------------------------------------------
    # CQL construction
    # ------------------------------------------------------------------

    @staticmethod
    def _build_cql_filter(parameters: str | Sequence[str]) -> str:
        """Build a CQL filter for the given parameter constraint.

        Single string → ``parameter='X'``; sequence → ``parameter IN ('X','Y')``.
        Single-quoting is intentional — DOV's parameter strings frequently
        contain spaces and parentheses, which CQL handles inside single quotes.
        We assume parameter values don't contain a single-quote character
        themselves (verified live: every probed parameter is plain text).
        """
        if isinstance(parameters, str):
            return f"{DOV_OBSERVATIE_WFS_PARAMETER_PROP}='{parameters}'"
        quoted = ",".join(f"'{p}'" for p in parameters)
        return f"{DOV_OBSERVATIE_WFS_PARAMETER_PROP} IN ({quoted})"

    # ------------------------------------------------------------------
    # Recursive WFS bbox query
    # ------------------------------------------------------------------

    async def _collect_rows(
        self,
        cql_filter: str,
        params_label: str,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        depth: int,
    ) -> list[ScalarObservationWfsRow]:
        """Return rows for this Lambert72 bbox, splitting if dense."""
        count = await self._wfs_count(cql_filter, x1, y1, x2, y2)

        if count == 0:
            self.trace(
                f"DOV scalar-observation WFS: 0 features at depth={depth} "
                f"({x1:.0f},{y1:.0f})→({x2:.0f},{y2:.0f}) filter={params_label}"
            )
            return []

        if count <= DOV_WFS_FEATURE_LIMIT or depth >= DOV_WFS_MAX_SPLIT_DEPTH:
            if count > DOV_WFS_FEATURE_LIMIT:
                self.warning(
                    f"DOV scalar-observation WFS: bbox at max recursion "
                    f"depth={depth} still has {count} features "
                    f"(> {DOV_WFS_FEATURE_LIMIT}) — some observations may be missed"
                )
            self.debug(f"DOV scalar-observation WFS: fetching {count} features (depth={depth})")
            return await self._wfs_features(cql_filter, x1, y1, x2, y2)

        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        self.debug(
            f"DOV scalar-observation WFS: {count} features > limit at depth={depth}, "
            f"splitting into 4 quadrants"
        )
        quadrants = [
            (x1, y1, mx, my),
            (mx, y1, x2, my),
            (x1, my, mx, y2),
            (mx, my, x2, y2),
        ]
        results = await asyncio.gather(
            *[
                self._collect_rows(cql_filter, params_label, qx1, qy1, qx2, qy2, depth + 1)
                for qx1, qy1, qx2, qy2 in quadrants
            ]
        )
        seen: set[str] = set()
        merged: list[ScalarObservationWfsRow] = []
        for chunk in results:
            for row in chunk:
                if row.permkey not in seen:
                    seen.add(row.permkey)
                    merged.append(row)
        return merged

    async def _wfs_count(self, cql_filter: str, x1: float, y1: float, x2: float, y2: float) -> int:
        """Return the number of observations matching the filter in this bbox."""
        params = self._common_params(cql_filter, x1, y1, x2, y2)
        params["resultType"] = "hits"
        try:
            resp = await self._http.get(DOV_WFS_URL, params=params)
        except httpx.RequestError as exc:
            self.error(f"DOV scalar-observation WFS count request failed: {exc}")
            raise
        if not resp.is_success:
            self.error(
                f"DOV scalar-observation WFS count returned HTTP {resp.status_code}  "
                f"body: {resp.text[:500]!r}"
            )
            resp.raise_for_status()
        match = DOV_WFS_NUMBER_MATCHED_RE.search(resp.text)
        if match is None:
            self.error(
                f"DOV scalar-observation WFS count: 'numberMatched' not found in "
                f"response head: {resp.text[:300]!r}"
            )
            return 0
        return int(match.group(1))

    async def _wfs_features(
        self, cql_filter: str, x1: float, y1: float, x2: float, y2: float
    ) -> list[ScalarObservationWfsRow]:
        """Fetch up to DOV_WFS_FEATURE_LIMIT scalar observation rows."""
        params = self._common_params(cql_filter, x1, y1, x2, y2)
        params["outputFormat"] = "application/json"
        params["count"] = str(DOV_WFS_FEATURE_LIMIT)
        try:
            resp = await self._http.get(DOV_WFS_URL, params=params)
        except httpx.RequestError as exc:
            self.error(f"DOV scalar-observation WFS features request failed: {exc}")
            raise
        if not resp.is_success:
            self.error(
                f"DOV scalar-observation WFS features returned HTTP {resp.status_code}  "
                f"body: {resp.text[:500]!r}"
            )
            resp.raise_for_status()

        data = resp.json()
        features = data.get("features", [])
        self.debug(f"DOV scalar-observation WFS: {len(features)} features in response")
        if features:
            first_props = list(features[0].get("properties", {}).keys())
            self.trace(f"DOV scalar-observation WFS feature properties: {first_props}")

        rows: list[ScalarObservationWfsRow] = []
        skipped_no_parent = 0
        for feat in features:
            props: dict[str, Any] = feat.get("properties", {})
            row = _build_row(props)
            if row is None:
                skipped_no_parent += 1
                continue
            rows.append(row)

        if skipped_no_parent:
            available = list(features[0].get("properties", {}).keys()) if features else "(none)"
            self.warning(
                f"DOV scalar-observation WFS: skipped {skipped_no_parent} rows with no "
                f"parent sample link. Available properties: {available}"
            )
        return rows

    @staticmethod
    def _common_params(
        cql_filter: str, x1: float, y1: float, x2: float, y2: float
    ) -> dict[str, str]:
        """Build the WFS query-parameter dict shared by count + features queries."""
        bbox = f"{x1},{y1},{x2},{y2},EPSG:{DOV_HORIZONTAL_EPSG}"
        return {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": DOV_WFS_OBSERVATIES_LAYER,
            "BBOX": bbox,
            "CQL_FILTER": cql_filter,
        }


# ---------------------------------------------------------------------------
# Module helpers — pure, no logging, easy to unit-test
# ---------------------------------------------------------------------------


def _build_row(props: dict[str, Any]) -> ScalarObservationWfsRow | None:
    """Build a ``ScalarObservationWfsRow`` from a WFS feature ``properties`` dict.

    Returns ``None`` when the feature lacks a parent-sample link
    (``gekoppeld_aan_link``) or its own observation URL — both required to
    establish a stable identity. Rows where ``resultaat`` is null but a
    ``detectieconditie`` is set (e.g. ``"NM"`` for non-plastic) ARE kept;
    the mapper handles the null-with-condition case downstream.
    """
    obs_url: str = props.get(DOV_OBSERVATIE_WFS_OBSERVATION_LINK_PROP) or ""
    if not obs_url:
        return None
    parent_link: str = props.get(DOV_OBSERVATIE_WFS_PARENT_LINK_PROP) or ""
    if not parent_link:
        return None
    parent_permkey = _last_path_segment(parent_link)
    if not parent_permkey:
        return None

    permkey = _last_path_segment(obs_url)
    return ScalarObservationWfsRow(
        permkey=permkey,
        parent_sample_permkey=parent_permkey,
        parameter=props.get(DOV_OBSERVATIE_WFS_PARAMETER_PROP) or "",
        resultaat=props.get(DOV_OBSERVATIE_WFS_RESULTAAT_PROP) or None,
        eenheid=props.get(DOV_OBSERVATIE_WFS_EENHEID_PROP) or None,
        methode=props.get(DOV_OBSERVATIE_WFS_METHODE_PROP) or None,
        fenomeentijd=_optional_date(props.get(DOV_OBSERVATIE_WFS_FENOMEENTIJD_PROP)),
        detectieconditie=props.get(DOV_OBSERVATIE_WFS_DETECTIECONDITIE_PROP) or None,
    )


def _last_path_segment(url: str) -> str:
    """Return the last path segment of *url*, ignoring any trailing slash."""
    return url.rstrip("/").rsplit("/", 1)[-1]


def _optional_date(value: Any) -> date | None:
    """Return ``date.fromisoformat(value)`` or None when value is None / unparseable."""
    if not value:
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None
