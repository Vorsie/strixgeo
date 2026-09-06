"""Mock httpx transport for DOV HTTP traffic during e2e testing.

When ``STRIXGEO_DOV_FIXTURE_MODE=1`` is set, ``make_dov_async_client`` in
``dov_http.py`` wires this transport instead of the production network path.
All DOV HTTP calls (WFS + per-permkey XML downloads) are served from
on-disk fixture files — no live DOV network access occurs.

Route table
-----------
WFS count (resultType=hits):
  ``GET https://www.dov.vlaanderen.be/geoserver/ows?typeNames=<layer>&resultType=hits``
  → ``fixture_root/wfs/<layer_slug>_count.xml``

WFS features (outputFormat=application/json):
  ``GET https://www.dov.vlaanderen.be/geoserver/ows?typeNames=<layer>&...``
  → ``fixture_root/wfs/<layer_slug>_features.json``

Per-permkey CPT XML:
  ``GET https://www.dov.vlaanderen.be/xdov/proxy/export/sondering/<permkey>``
  → ``fixture_root/cpt/<permkey>``

Per-permkey borehole XML:
  ``GET https://www.dov.vlaanderen.be/xdov/proxy/export/boring/<permkey>``
  → ``fixture_root/borehole/<permkey>``

Per-permkey interpretation XML:
  ``GET https://www.dov.vlaanderen.be/xdov/proxy/export/interpretatie/<permkey>``
  → ``fixture_root/interpretatie/<permkey>``

Per-permkey observation XML (grain-size):
  ``GET https://www.dov.vlaanderen.be/xdov/proxy/export/observatie/<permkey>``
  → ``fixture_root/observatie/<permkey>``

Virtuele Boring lagenmodel catalogue (model-picker dropdown):
  ``GET https://services.dov.vlaanderen.be/virtueleboringserver/base/lagenmodel``
  → ``fixture_root/virtuele_boring/lagenmodel.json``
  (a different host than the WFS routes; serves a small deterministic catalogue
  so the offline harness populates the DOV model picker instead of 502-ing on
  the unreachable live catalogue).

Layer name → file-system slug mapping
--------------------------------------
The WFS ``typeNames`` parameter contains colons and hyphens that are
unsafe as raw filenames. We map them to slugs:

  ``dov-pub:Sonderingen``                                → ``sonderingen``
  ``dov-pub:Boringen``                                   → ``boringen``
  ``boringen:grondmonsters``                             → ``grondmonsters``
  ``interpretaties:gecodeerde_lithologie``               → ``interpretaties_gecodeerde_lithologie``
  (other interpretaties:* layers)                        → ``interpretaties_<rest>``
  ``monster:observaties`` (grain-size CQL)               → ``observaties_grain_size``
  ``monster:observaties`` (scalar / unknown CQL)         → ``observaties_scalar``

Unknown route handling
----------------------
An unmatched URL returns HTTP 404 with a descriptive body. This is
intentional: a missing fixture silences a test quietly; a 404 causes
the import pipeline to raise ``httpx.HTTPStatusError``, which surfaces
the test as a failure with a clear message.

Environment variables
---------------------
``STRIXGEO_DOV_FIXTURE_MODE`` : ``"1"``
    Enables fixture mode -- but only in a development backend. A packaged
    build runs as ``ENVIRONMENT=production`` and ignores this variable, so an
    end user cannot redirect the shipped app's DOV imports to on-disk
    synthetic fixtures. Any other value (or absent) uses the live network.
``STRIXGEO_DOV_FIXTURE_ROOT`` : path string
    Root directory for fixture files. Defaults to
    ``desktop/tests/e2e/fixtures/dov`` relative to the Python CWD (which is
    the repository root when running under uvicorn from the repo root).
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

from groundmodel.infrastructure.parsers.dov.virtuele_boring_constants import (
    DOV_VIRTUELE_BORING_BASE_URL,
    DOV_VIRTUELE_BORING_LAGENMODEL_PATH,
)
from groundmodel.shared.config import settings

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Env var that activates fixture mode.
DOV_FIXTURE_MODE_ENV = "STRIXGEO_DOV_FIXTURE_MODE"

# Env var that overrides the fixture root directory.
DOV_FIXTURE_ROOT_ENV = "STRIXGEO_DOV_FIXTURE_ROOT"

# Default fixture root — relative to the repo root (the process CWD when the
# backend is launched via ``uv run uvicorn ... --cwd <repo-root>``).
_DEFAULT_FIXTURE_ROOT = "desktop/tests/e2e/fixtures/dov"

# DOV WFS endpoint (all WFS requests go here).
_DOV_WFS_HOST = "www.dov.vlaanderen.be"

# Lambert-72 bounding box of every CPT + borehole fixture in this directory.
# A WFS request whose BBOX (or CQL_FILTER BBOX(...)) does not overlap this
# region returns the empty fixture instead of the matched one, so rejection-
# path tests (empty-bbox imports, North Sea bbox, etc.) get the imported=0
# behaviour they expect.
_FIXTURE_BBOX_L72_MIN_X = 148_900.0
_FIXTURE_BBOX_L72_MIN_Y = 191_900.0
_FIXTURE_BBOX_L72_MAX_X = 149_500.0
_FIXTURE_BBOX_L72_MAX_Y = 192_300.0

# Virtuele Boring lagenmodel catalogue: a DIFFERENT DOV host than the WFS /
# xdov proxy routes above (``services.dov.vlaanderen.be`` vs
# ``www.dov.vlaanderen.be``). Host + path are derived from the same constants
# the client builds its URL from (``virtuele_boring_client.fetch_lagenmodel_catalog``:
# ``f"{BASE_URL}{LAGENMODEL_PATH}"``), so a future DOV path change is picked up
# here without drift.
_VB_CATALOG_URL = urlparse(f"{DOV_VIRTUELE_BORING_BASE_URL}{DOV_VIRTUELE_BORING_LAGENMODEL_PATH}")
_DOV_VIRTUELE_BORING_HOST = _VB_CATALOG_URL.hostname  # "services.dov.vlaanderen.be"
_VB_LAGENMODEL_PATH = _VB_CATALOG_URL.path  # "/virtueleboringserver/base/lagenmodel"

# Per-resource proxy URL prefixes (path-only, without host).
_CPT_PATH_PREFIX = "/xdov/proxy/export/sondering/"
_BORING_PATH_PREFIX = "/xdov/proxy/export/boring/"
_INTERP_PATH_PREFIX = "/xdov/proxy/export/interpretatie/"
_OBS_PATH_PREFIX = "/xdov/proxy/export/observatie/"

# WFS layer slug map: typeNames value → directory basename / slug.
# The grain-size and scalar observation layers both use ``monster:observaties``
# but differ in their CQL_FILTER — the router disambiguates by inspecting the
# CQL_FILTER parameter.
_GRAIN_SIZE_CQL_MARKER = "Onderkenningsproeven-korrelverdeling"
_LAYER_TO_SLUG: dict[str, str] = {
    "dov-pub:Sonderingen": "sonderingen",
    "dov-pub:Boringen": "boringen",
    "boringen:grondmonsters": "grondmonsters",
}


def _extract_bbox_l72(bbox_param: str, cql_filter: str) -> tuple[float, float, float, float] | None:
    """Return the (min_x, min_y, max_x, max_y) of the request's L72 bbox, or None.

    The CPT WFS path emits ``BBOX=x1,y1,x2,y2,EPSG:31370`` as a query param.
    The borehole / sample / interpretation WFS paths embed the bbox inside
    ``CQL_FILTER`` as ``BBOX(geom, x1, y1, x2, y2, 'EPSG:31370')``. Both shapes
    are parsed here so the fixture transport can short-circuit any request
    whose bbox does not overlap the e2e fixture region.

    Parameters
    ----------
    bbox_param : str
        Value of the ``BBOX`` query param, or empty string.
    cql_filter : str
        Value of the ``CQL_FILTER`` query param, or empty string.

    Returns
    -------
    tuple of float or None
        ``(min_x, min_y, max_x, max_y)`` in Lambert-72 metres, or ``None`` if
        no bbox could be parsed from either source.
    """
    parts: list[str] | None = None
    if bbox_param:
        # ``x1,y1,x2,y2,EPSG:31370`` — drop the EPSG token if present.
        raw = bbox_param.split(",")
        if len(raw) >= 4:
            parts = raw[:4]
    if parts is None and cql_filter:
        # ``BBOX(geom, x1, y1, x2, y2, 'EPSG:31370')`` — slice between the
        # outermost parens.
        open_idx = cql_filter.upper().find("BBOX(")
        close_idx = cql_filter.find(")", open_idx) if open_idx != -1 else -1
        if open_idx != -1 and close_idx != -1:
            inside = cql_filter[open_idx + len("BBOX(") : close_idx]
            tokens = [t.strip().strip("'\"") for t in inside.split(",")]
            # Drop the first token (geometry column name) + trailing EPSG token.
            numeric = [t for t in tokens[1:] if t and not t.startswith("EPSG")]
            if len(numeric) >= 4:
                parts = numeric[:4]
    if parts is None:
        return None
    try:
        x1, y1, x2, y2 = (float(p) for p in parts)
    except ValueError:
        return None
    return (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))


def _bbox_overlaps_fixture(bbox: tuple[float, float, float, float]) -> bool:
    """Return True when *bbox* overlaps the fixture region in Lambert-72 metres."""
    min_x, min_y, max_x, max_y = bbox
    return not (
        max_x < _FIXTURE_BBOX_L72_MIN_X
        or min_x > _FIXTURE_BBOX_L72_MAX_X
        or max_y < _FIXTURE_BBOX_L72_MIN_Y
        or min_y > _FIXTURE_BBOX_L72_MAX_Y
    )


def _layer_slug(type_names: str, cql_filter: str) -> str:
    """Map a WFS ``typeNames`` + optional ``CQL_FILTER`` to a fixture slug.

    Parameters
    ----------
    type_names : str
        Value of the WFS ``typeNames`` query parameter (e.g.
        ``"dov-pub:Sonderingen"``).
    cql_filter : str
        Value of the ``CQL_FILTER`` parameter, or empty string. Used to
        distinguish grain-size from scalar queries for the unified
        ``monster:observaties`` layer.

    Returns
    -------
    str
        A filesystem-safe slug such as ``"sonderingen"`` or
        ``"interpretaties_gecodeerde_lithologie"``.
    """
    if type_names in _LAYER_TO_SLUG:
        return _LAYER_TO_SLUG[type_names]

    if type_names == "monster:observaties":
        # Grain-size queries carry the parametergroep in the CQL_FILTER.
        if _GRAIN_SIZE_CQL_MARKER in cql_filter:
            return "observaties_grain_size"
        # Every other CQL variant (scalar Atterberg / CaCO3 / etc.) maps
        # to a single "empty response" fixture so the import degrades
        # gracefully to 0 scalar results.
        return "observaties_scalar"

    if type_names.startswith("interpretaties:"):
        # ``interpretaties:gecodeerde_lithologie`` → ``interpretaties_gecodeerde_lithologie``
        suffix = type_names.split(":", 1)[1]
        return f"interpretaties_{suffix}"

    # Unknown layer — return a slug that won't match any fixture; the caller
    # will get a 404 and the import pipeline will surface it as an error.
    safe = type_names.replace(":", "_").replace("-", "_")
    return safe


def _build_fixture_transport(fixture_root: Path) -> httpx.MockTransport:
    """Return an httpx MockTransport serving DOV requests from on-disk fixtures.

    Parameters
    ----------
    fixture_root : Path
        Root directory containing ``wfs/``, ``cpt/``, ``borehole/``,
        ``interpretatie/``, and ``observatie/`` subdirectories.

    Returns
    -------
    httpx.MockTransport
        A transport that routes requests by URL and query parameters,
        reads the matching fixture file, and returns the contents with
        an appropriate ``Content-Type``.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        """Route the request to the correct on-disk fixture file.

        Parameters
        ----------
        request : httpx.Request
            The intercepted HTTP request.

        Returns
        -------
        httpx.Response
            The fixture file's contents with a 200 status, or a 404
            response when no matching fixture exists.
        """
        parsed = urlparse(str(request.url))
        path = parsed.path
        query = parse_qs(parsed.query, keep_blank_values=True)

        def _qs(key: str) -> str:
            """Return the first value for *key*, or empty string."""
            return (query.get(key) or [""])[0]

        # ------------------------------------------------------------------
        # Route 1: WFS requests (all go to the GeoServer OWS endpoint).
        # ------------------------------------------------------------------
        if parsed.hostname == _DOV_WFS_HOST and path == "/geoserver/ows":
            type_names = _qs("typeNames")
            cql_filter = _qs("CQL_FILTER")
            bbox_param = _qs("BBOX")
            result_type = _qs("resultType").lower()
            # outputFormat is not needed for routing — result_type determines
            # count vs features; slug routing is by typeNames + CQL_FILTER.

            slug = _layer_slug(type_names, cql_filter)

            # If the request carries a bbox that does not overlap the fixture
            # region, serve the empty fixture so rejection-path tests
            # (empty-bbox / North Sea bbox) see imported=0 instead of the full
            # matched feature list.
            bbox = _extract_bbox_l72(bbox_param, cql_filter)
            if bbox is not None and not _bbox_overlaps_fixture(bbox):
                slug = "empty"

            if result_type == "hits":
                # WFS count request → XML response with numberMatched.
                fixture_path = fixture_root / "wfs" / f"{slug}_count.xml"
                fallback_path = fixture_root / "wfs" / "empty_count.xml"
                content_type = "text/xml; charset=utf-8"
            else:
                # WFS features request → GeoJSON response.
                fixture_path = fixture_root / "wfs" / f"{slug}_features.json"
                fallback_path = fixture_root / "wfs" / "empty_features.json"
                content_type = "application/json"

            # Fall back to the empty fixture for layers without explicit fixture
            # files (e.g. the 7 interpretation layers that have no data in the
            # e2e bbox). The fallback exists so those WFS calls return cleanly
            # rather than 404-ing and aborting the import.
            if not fixture_path.exists() and fallback_path.exists():
                return _serve_fixture(fallback_path, content_type)
            return _serve_fixture(fixture_path, content_type)

        # ------------------------------------------------------------------
        # Route 2: per-permkey CPT XML (sondering proxy).
        # ------------------------------------------------------------------
        if path.startswith(_CPT_PATH_PREFIX):
            permkey = path[len(_CPT_PATH_PREFIX) :].rstrip("/")
            fixture_path = fixture_root / "cpt" / permkey
            return _serve_fixture(fixture_path, "text/xml; charset=utf-8")

        # ------------------------------------------------------------------
        # Route 3: per-permkey borehole XML (boring proxy).
        # ------------------------------------------------------------------
        if path.startswith(_BORING_PATH_PREFIX):
            permkey = path[len(_BORING_PATH_PREFIX) :].rstrip("/")
            fixture_path = fixture_root / "borehole" / permkey
            return _serve_fixture(fixture_path, "text/xml; charset=utf-8")

        # ------------------------------------------------------------------
        # Route 4: per-permkey interpretation XML.
        # ------------------------------------------------------------------
        if path.startswith(_INTERP_PATH_PREFIX):
            permkey = path[len(_INTERP_PATH_PREFIX) :].rstrip("/")
            fixture_path = fixture_root / "interpretatie" / permkey
            return _serve_fixture(fixture_path, "text/xml; charset=utf-8")

        # ------------------------------------------------------------------
        # Route 5: per-permkey observation XML (grain-size).
        # ------------------------------------------------------------------
        if path.startswith(_OBS_PATH_PREFIX):
            permkey = path[len(_OBS_PATH_PREFIX) :].rstrip("/")
            fixture_path = fixture_root / "observatie" / permkey
            return _serve_fixture(fixture_path, "text/xml; charset=utf-8")

        # ------------------------------------------------------------------
        # Route 6: Virtuele Boring lagenmodel catalogue (model-picker).
        # A different DOV host than the WFS / xdov routes above. Serving it
        # keeps the offline harness from 502-ing on the unreachable live DOV
        # catalogue (walker findings 1-9, 2026-09-06).
        # ------------------------------------------------------------------
        if parsed.hostname == _DOV_VIRTUELE_BORING_HOST and path == _VB_LAGENMODEL_PATH:
            fixture_path = fixture_root / "virtuele_boring" / "lagenmodel.json"
            return _serve_fixture(fixture_path, "application/json")

        # ------------------------------------------------------------------
        # Unmatched route — 404 so missing fixtures fail loudly.
        # ------------------------------------------------------------------
        return httpx.Response(
            404,
            content=f"DOV fixture transport: no route for {request.method} {request.url}".encode(),
        )

    return httpx.MockTransport(handler)


def _serve_fixture(fixture_path: Path, content_type: str) -> httpx.Response:
    """Read *fixture_path* and return a 200 response, or a 404 if absent.

    Parameters
    ----------
    fixture_path : Path
        Absolute or relative path to the fixture file.
    content_type : str
        ``Content-Type`` header value for the response.

    Returns
    -------
    httpx.Response
        200 with the file's contents, or 404 when the file doesn't exist.
    """
    if not fixture_path.exists():
        return httpx.Response(
            404,
            content=(
                f"DOV fixture transport: no fixture at {fixture_path}. "
                f"Create it or correct the test's bbox/permkey."
            ).encode(),
        )
    return httpx.Response(
        200,
        content=fixture_path.read_bytes(),
        headers={"content-type": content_type},
    )


def _fixture_mode_allowed(env_value: str | None, environment: str) -> bool:
    """Decide whether fixture mode may be honoured, given the raw inputs.

    Pure decision function (no environment access) so the production-refusal
    invariant is testable without mutating ``os.environ`` or the settings
    singleton. Fixture mode is a development / e2e-only convenience: an end
    user must never be able to redirect a packaged build's DOV imports to
    on-disk synthetic fixtures by exporting an env var, so the ``"1"`` flag is
    honoured only when the backend runs in development. Any other environment
    (``"production"``, which the packaged launcher sets, or ``"staging"`` / a
    coworker binary) refuses fixture mode outright.

    Parameters
    ----------
    env_value : str | None
        The raw value of ``STRIXGEO_DOV_FIXTURE_MODE`` (``None`` when absent).
    environment : str
        The resolved deployment environment (``settings.environment``).

    Returns
    -------
    bool
        ``True`` only when the env var is exactly ``"1"`` AND the environment
        is exactly ``"development"``.
    """
    return env_value == "1" and environment == "development"


def is_fixture_mode() -> bool:
    """Return True only when fixture mode is both requested and permitted.

    Fixture mode is requested via ``STRIXGEO_DOV_FIXTURE_MODE=1`` and permitted
    only in a development backend (see :func:`_fixture_mode_allowed`). A
    packaged build runs as ``ENVIRONMENT=production`` and therefore ignores the
    env var; the same flag that turns the interactive API docs off gates this
    test seam.

    Returns
    -------
    bool
        ``True`` if the env var is ``"1"`` and ``settings.environment`` is
        ``"development"``; ``False`` otherwise.
    """
    return _fixture_mode_allowed(os.environ.get(DOV_FIXTURE_MODE_ENV), settings.environment)


def fixture_root_path() -> Path:
    """Return the fixture root directory from env or the default.

    Returns
    -------
    Path
        Absolute or CWD-relative path to the fixture root.
    """
    return Path(os.environ.get(DOV_FIXTURE_ROOT_ENV, _DEFAULT_FIXTURE_ROOT))
