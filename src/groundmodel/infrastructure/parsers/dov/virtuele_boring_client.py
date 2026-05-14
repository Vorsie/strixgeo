"""Async client for the DOV Virtuele Boring (virtual borehole) REST API.

Two surfaces:

* :meth:`fetch_doorprik` — single-point pick at a Lambert-72 (x, y) for
  one model code. Returns the merged per-layer stack with top/base/
  thickness elevations + inline catalogue metadata (Dutch name,
  beschrijving, color, NCS link). The dominant entry point.
* :meth:`fetch_lagenmodel_catalog` — list every available
  ``lagenmodel`` (12 today). Used by the desktop client to populate
  the model-picker dropdown so a new DOV model auto-surfaces without
  a frontend release.

Both wrap a caller-provided ``httpx.AsyncClient`` so the connection
pool is shared across many concurrent doorprik calls — the typical
"50 investigations × 2 models" fan-out reuses one HTTP/2 connection.
The Virtuele Boring server reports as Spring Boot with Dutch error
messages; we treat any non-200 as a fetch failure and log the body
(truncated to 500 chars per the project's external-call logging rule).
"""

from __future__ import annotations

from typing import Any

import httpx

from groundmodel.infrastructure.parsers.dov.virtuele_boring_constants import (
    DOV_VIRTUELE_BORING_BASE_URL,
    DOV_VIRTUELE_BORING_DEFAULT_MODEL,
    DOV_VIRTUELE_BORING_DOORPRIK_PATH,
    DOV_VIRTUELE_BORING_LAGENMODEL_PATH,
)
from groundmodel.infrastructure.parsers.dov.virtuele_boring_result import (
    VirtueleBoringLayer,
    VirtueleBoringResult,
)
from groundmodel.shared.logging.ground_model_logger import GroundModelLogger


class VirtueleBoringFetchError(RuntimeError):
    """Raised when DOV's Virtuele Boring API returns a non-200 response.

    Carries the HTTP status + a (truncated) body so the caller can log
    enough context to triage without re-running. The application layer
    catches this and converts to a per-investigation skip — one bad
    point shouldn't fail the whole fetch sweep.
    """

    def __init__(self, status_code: int, body: str, url: str) -> None:
        super().__init__(f"Virtuele Boring fetch failed: HTTP {status_code} on {url}: {body}")
        self.status_code = status_code
        self.body = body
        self.url = url


class VirtueleBoringClient(GroundModelLogger):
    """HTTP client around DOV's Virtuele Boring REST API.

    Stateless — the only instance state is the injected
    ``httpx.AsyncClient`` (which owns the connection pool) and the
    logger. Safe to share across coroutines as long as the underlying
    client is not closed.
    """

    def __init__(self, http: httpx.AsyncClient) -> None:
        """Initialise with a connected async HTTP client.

        Parameters
        ----------
        http : httpx.AsyncClient
            Caller owns the lifecycle. Typically built by
            ``make_dov_async_client()`` and shared across an entire
            fetch sweep so the HTTP/2 connection stays warm.
        """
        super().__init__(__name__)
        self._http = http

    async def fetch_doorprik(
        self,
        x_lambert72: float,
        y_lambert72: float,
        model: str = DOV_VIRTUELE_BORING_DEFAULT_MODEL,
    ) -> VirtueleBoringResult:
        """Fetch the per-layer stack at a single (x, y) point.

        Parameters
        ----------
        x_lambert72 : float
        y_lambert72 : float
            Coordinates in Belgian Lambert 72 (EPSG:31370). Other CRS
            values are not transformed here — gate at the call site.
        model : str
            DOV lagenmodel code (``g3dv3_F``, ``g3dv3_L``, ``hcovv2_H``,
            ``OMAv1.1``, …). Defaults to G3D v3.1 formations.

        Returns
        -------
        VirtueleBoringResult
            Echoes the query + the merged per-layer list (top/base/
            thickness + inline catalog metadata). Out-of-Flanders
            coordinates may return an empty layer list rather than an
            error.

        Raises
        ------
        VirtueleBoringFetchError
            On non-2xx response. Caller can catch + skip the
            investigation; one bad point shouldn't abort the sweep.
        """
        url = f"{DOV_VIRTUELE_BORING_BASE_URL}{DOV_VIRTUELE_BORING_DOORPRIK_PATH}/{model}"
        params = {"x": x_lambert72, "y": y_lambert72}
        self.trace(f"GET {url} params={params}")

        response = await self._http.get(url, params=params)
        body_preview = response.text[:500] if response.text else "(empty body)"
        self.trace(f"GET {url} -> HTTP {response.status_code} ({len(response.content)} bytes)")

        if response.status_code != 200:
            self.warning(
                f"Virtuele Boring doorprik failed: HTTP {response.status_code} "
                f"on {url} params={params} body={body_preview}"
            )
            raise VirtueleBoringFetchError(response.status_code, body_preview, url)

        payload = response.json()
        layers = _parse_doorprik_payload(payload)
        self.debug(
            f"doorprik model={model} ({x_lambert72:.1f}, {y_lambert72:.1f}) "
            f"-> {len(layers)} layer(s)"
        )
        return VirtueleBoringResult(
            model_code=model,
            x_lambert72=x_lambert72,
            y_lambert72=y_lambert72,
            layers=layers,
        )

    async def fetch_lagenmodel_catalog(self) -> list[dict[str, Any]]:
        """Return DOV's list of available lagenmodels.

        Each entry is a dict ``{code, beschrijving, resoluties}`` —
        we pass the raw shape through to the desktop client so a new
        model added by DOV surfaces in the picker without a frontend
        change. Caller is the catalogue endpoint; the response is
        cached on the frontend for the session.

        Raises
        ------
        VirtueleBoringFetchError
            On non-2xx response.
        """
        url = f"{DOV_VIRTUELE_BORING_BASE_URL}{DOV_VIRTUELE_BORING_LAGENMODEL_PATH}"
        self.trace(f"GET {url}")
        response = await self._http.get(url)
        body_preview = response.text[:500] if response.text else "(empty body)"
        self.trace(f"GET {url} -> HTTP {response.status_code} ({len(response.content)} bytes)")

        if response.status_code != 200:
            self.warning(
                f"Virtuele Boring catalog fetch failed: HTTP {response.status_code} "
                f"body={body_preview}"
            )
            raise VirtueleBoringFetchError(response.status_code, body_preview, url)

        catalog = response.json()
        if not isinstance(catalog, list):
            self.warning(
                f"Virtuele Boring catalog response is not a list "
                f"(type={type(catalog).__name__}) — returning empty"
            )
            return []
        self.debug(f"lagenmodel catalog -> {len(catalog)} model(s)")
        return catalog


def _parse_doorprik_payload(payload: dict[str, Any]) -> list[VirtueleBoringLayer]:
    """Merge the API's ``data`` + ``layers`` arrays into a flat layer list.

    The API ships two parallel collections:

    * ``data[]`` — per-layer ``{name, top, base, thickness}`` rows for
      the queried point. Only layers that are actually present at the
      point appear here.
    * ``layers[]`` — the model's full unit catalogue, with name,
      beschrijving, color, and optional NCS link per entry.

    We build a ``code -> catalogue entry`` dict from ``layers`` and
    join it to each ``data`` row so the consumer gets self-describing
    rows without a second lookup table.

    A layer present in ``data`` but absent in ``layers`` is rare in
    practice (would indicate an API bug); we still emit a row with
    blank metadata + a warning-level log entry so the data point is
    visible.
    """
    raw_layers: list[dict[str, Any]] = list(payload.get("layers", []) or [])
    raw_data: list[dict[str, Any]] = list(payload.get("data", []) or [])

    catalog_by_code: dict[str, dict[str, Any]] = {}
    for entry in raw_layers:
        code = entry.get("code")
        if isinstance(code, str):
            catalog_by_code[code] = entry

    result: list[VirtueleBoringLayer] = []
    for row in raw_data:
        code = str(row.get("name", "") or "")
        catalog = catalog_by_code.get(code, {})
        # NCS link discovery: layers[].links is a list of {text, link}
        # objects. Pick the first link if present; the formation pages
        # ship at most one and members typically ship none.
        links = catalog.get("links")
        ncs_link: str | None = None
        if isinstance(links, list) and links:
            first = links[0]
            if isinstance(first, dict):
                candidate = first.get("link")
                if isinstance(candidate, str):
                    ncs_link = candidate
        # The API ships ``dovlayercolor`` always — even when null we
        # tolerate any non-string by treating it as missing.
        color_raw = catalog.get("dovlayercolor")
        color_hex = color_raw if isinstance(color_raw, str) and color_raw else None
        result.append(
            VirtueleBoringLayer(
                code=code,
                name=str(catalog.get("name", "") or ""),
                beschrijving=str(catalog.get("beschrijving", "") or ""),
                top_m_taw=float(row.get("top", 0.0) or 0.0),
                base_m_taw=float(row.get("base", 0.0) or 0.0),
                thickness_m=float(row.get("thickness", 0.0) or 0.0),
                color_hex=color_hex,
                ncs_link=ncs_link,
            )
        )
    return result
