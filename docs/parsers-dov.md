# DOV Import

DOV (Databank Ondergrond Vlaanderen) CPTs are imported via `POST /cpt/import-dov` with a WGS84 bounding box. No `pydov` dependency — direct WFS + async XML downloads + persistent on-disk cache.

**Pipeline (5 phases, all timed in logs):**

| Phase | What | Typical time (316 deep CPTs cold / warm cache) |
|---|---|---|
| 1 | WFS index + bbox-split | ~1 s |
| 2 | Parallel download + stream-parse | ~50 s (payload-bound; see note) |
| 3 | Batch dedup (one IN-query for all test_ids) | ~20 ms |
| 4 | Persist (ORM map + session.add × N, no commit) | ~200 ms |
| 5 | Single transaction commit | ~300 ms |

**Performance note:** Wall-clock is dominated by Phase 2 and is
**payload-size-bound, not request-count-bound.** A typical deep CPT
(~1 000–1 600 rows, some 3 000+) decodes to ~0.5 MB of XML; ×316 CPTs ≈
~157 MB to pull and parse. Shallow-CPT bboxes run much faster (~6–10 ×
faster per CPT) because the payloads are smaller. The figure of "500
CPTs in 4–10 s" quoted in older notes was measured against a shallow-CPT
bbox and does not generalise to deep-CPT projects.

**HTTP/1.1 — HTTP/2 negotiation confirmed absent (live probe 2026-05-17).**
The client is configured with ``http2=True`` (``httpx[http2]``, ALPN
offered), but live probes against the real
``xdov/proxy/export/sondering/*`` and WFS endpoints both returned
``HTTP/1.1`` — DOV's front end does not offer h2. The ``http2=True``
setting is therefore a no-op and the old "HTTP/2 multiplexes fetches over
one TLS connection" bullet in earlier notes was incorrect. gzip is in
effect (``Content-Encoding: gzip`` / ``Vary: accept-encoding``) — wire
transfers are already compressed. The performance ceiling for cold deep-
CPT imports is set by DOV's HTTP/1.1 serving rate, not by anything
client-side.

**Frontend flow:**
1. User clicks "Import from DOV" → map switches to crosshair draw mode (`BboxDrawer`).
2. User drags a rectangle; `onBboxDrawn` fires `(west, south, east, north)` in WGS84.
3. `POST /cpt/import-dov` → `ImportCptDov.execute()`.
4. Frontend toast: `"X imported, Y already existed, Z failed"`. Markers refresh from a single `GET /cpt/?project_id=...` call (coordinates are in `CptListItem` so no per-CPT detail fetch).

**Backend pipeline (`ImportCptDov`):**
1. `DovClient.fetch_bbox_processed()`:
   - Transforms bbox to Lambert72 (EPSG:31370) via pyproj `always_xy=True`.
   - WFS `resultType=hits` count check; auto-splits into 4 quadrants if `> 500` features (recursive, max depth 5).
   - Streams: each XML download immediately runs the parse callback in the same async task — parse wall time is hidden inside download wait. Concurrency limited by `DOV_DOWNLOAD_PARALLELISM` (50, in `dov_constants.py`).
   - ``httpx.AsyncClient`` with ``http2=True`` + ``follow_redirects=True``. Note:
     DOV's endpoints are HTTP/1.1-only (no h2 negotiated — live probe 2026-05-17);
     the ``http2=True`` flag is configured in ``dov_http.py`` but is a no-op against
     this server. Connection pool is still kept warm via ``max_keepalive_connections=100``.
   - **Cache check first** — `DovXmlCache.get(permkey)` skips the network entirely on hit.
2. `_repo.find_existing_test_ids("DOV", test_ids, app_project_id)` — single batch IN-query.
3. For each non-duplicate: `ImportCpt.persist(result, name, app_project_id, commit=False, skip_duplicate_check=True)` — `add()` only, no per-row flush, no per-row commit.
4. `session.commit()` once at the end → one fsync for the whole batch.

**Reusing `ImportCpt.persist()`** — DovParser produces a `GEFParseResult`, the same type GEFParser produces. So all duplicate-detection, ORM mapping, and validation logic is shared. The `commit=False` and `skip_duplicate_check=True` kwargs let the bulk caller batch.

**Deduplication:** DOV CPTs use `project_id="DOV"` + `test_id=<sondeernummer>`, scoped to `app_project_id`. The same CPT can be imported into different projects but never twice into the same one.

**DOV WFS** — endpoint: `https://www.dov.vlaanderen.be/geoserver/ows`, feature type `dov-pub:Sonderingen` (plural). Properties: `fiche` (URL of the CPT record), `sondeernummer` (test name), `X_mL72` / `Y_mL72` / `Z_mTAW` (Lambert 72 coordinates).

**DOV XML structure** (namespace `http://kern.schemas.dov.vlaanderen.be`, plus GML for coordinates):
```
dov-schema/sondering/sondeernummer                            CPT ID
dov-schema/sondering/datum_aanvang                            ISO date
dov-schema/sondering/uitvoerder/naam                          Company
dov-schema/sondering/ligging/gml:Point/gml:pos                "X Y Z"  (EPSG:31370)
dov-schema/sondering/sondeonderzoek/sondeerapparaat/sondeerconus/conustype  E* / U* / M*
dov-schema/sondering/sondeonderzoek/sondeerapparaat/sondeerconus/net_area_ratio
dov-schema/sondering/sondeonderzoek/penetratietest/meetdata/{lengte,diepte,qc,fs,u,Qt,i}
```

Important schema quirk: only the `<dov-schema>` root is in the DOV namespace — its children (`<sondering>`, etc.) are unprefixed. GML elements ARE prefixed.

**Units in DOV XML:** `qc`, `Qt` are MPa; `fs` and `u` are kPa (DovParser divides by 1000). Depth: prefer `<diepte>` (vertical) over `<lengte>` (penetration distance).

**Coordinate-bounds check.** DOV positions are always Belgian Lambert 72 (EPSG:31370). Both DOV parsers (CPT `DovParser`, borehole `DovBoringParser`) run the shared `make_crs_bounds_issue` helper on the parsed `(x, y)`: a position that falls outside Belgium's coverage — a swapped X/Y or a coordinate copied from a foreign project — raises a **`COORDINATES_OUTSIDE_CRS_BOUNDS` WARNING** naming the system and the values, so it is caught at import instead of appearing as a dot in the sea. It is never an ERROR (the import proceeds) and is skipped for the `(0, 0)` null-island placeholder, which has its own `ZERO_COORDINATES` finding. The area comes from pyproj's `area_of_use`, projected once per EPSG and padded by a 500 m margin (`crs_bounds.py`). Each DOV batch import logs an INFO count of flagged tests (`import_cpt_dov` / `import_borehole_dov`).

**Watch (Lambert 2008).** DOV may migrate its horizontal CRS from Lambert 72 (EPSG:31370) to Lambert 2008 (EPSG:3812). The code pins the CRS in one place: `DOV_HORIZONTAL_EPSG` in `dov_common.py`. Changing that single value re-targets everything downstream: the `DOV_WGS84_TO_LAMBERT72` transformer is built from it (rename it if you flip the code), `cql_bbox_predicate` interpolates it into the WFS `BBOX`/`CQL_FILTER` EPSG string, and the coordinate-bounds check follows automatically because the parsers pass `DOV_HORIZONTAL_EPSG` into `make_crs_bounds_issue`, whose `classify_coordinates()` reads that EPSG's own pyproj `area_of_use`. Before flipping the code, confirm the DOV WFS still accepts `EPSG:3812` in the BBOX / CQL predicate. See the "Watch (Lambert 2008)" comment in `dov_common.py`.

**`DovXmlCache`** — filesystem cache at `~/.groundmodel/dov_cache/` (overridable via `DOV_CACHE_DIR` env var). One file per permkey, valid forever (DOV measurements are historical). Durable atomic writes: the temp file is **fsync'd before the rename**, so a crash between write and rename cannot publish a cache entry that points at unflushed (zero/garbage) bytes. A cached XML that fails to parse is treated as a poisoned entry — `delete()` unlinks it and the row is re-fetched **once** from the network (a fresh, network-side parse failure is a genuine bad XML and is not retried). Cache failures are logged but never block the import — every operation falls through to the network path on disk error. Hit/miss rate is logged per import.

**API error mapping** — `POST /cpt/import-dov` translates httpx errors:
- `ConnectError` → 503 "Cannot reach DOV"
- `TimeoutException` → 504
- `HTTPStatusError` / other `RequestError` → 502 with upstream details

**Import-scope guards + rate-limit back-off (current state).** Every DOV import request is bounded before it fans out:
- **Bbox validation** (shared `validate_wgs84_import_bbox`, applied by both the CPT and borehole `import-dov` request schemas): a reversed/degenerate box (`east<=west` or `north<=south`) → `422` naming the wrong corner; a box whose projected area exceeds `DOV_MAX_BBOX_AREA_KM2` (25 km × 25 km = **625 km²**, owner-tunable in `dov_common.py`) → `422` naming the limit.
- **Discovery ceiling**: after WFS discovery resolves the unique-feature count and **before any XML download**, an import that would discover more than `DOV_MAX_IMPORT_FEATURES` (**2000**, owner-tunable) is refused with `DovImportTooLargeError` → `422` (sync) / terminal SSE `error` event (`code="dov_import_too_large"`), naming the count and the limit. Enforced in `ImportCptDov.execute` (CPT) and `DovBoreholeClient.fetch_bbox_processed` (borehole).
- **Duplicate guard**: the import-stream POST refuses a second import of the same scope (resource-kind + bbox + project) while the first job is still running → `409` (`code="dov_import_already_running"`) echoing the running `job_id` so the client attaches to the existing stream. Keyed in the `JobRegistry`.
- **429/503 back-off**: WFS discovery and XML downloads route through `dov_get_with_retry`, which honours `Retry-After` and otherwise uses a bounded exponential back-off (`DOV_MAX_HTTP_ATTEMPTS` = 3, capped at `DOV_RETRY_MAX_DELAY_S` = 30 s) — a 429/503 is ridden out, not a hard failure. The first 429 also **halves the download parallelism** for the rest of that import (one-time, floored at 1) via a per-import `DovRateLimitState`, logged at WARNING. The parallelism-halving is wired end-to-end on the **CPT** path today; the retry + `Retry-After` applies to both CPT and borehole via the shared request/download helpers.

**Module layout** under `infrastructure/parsers/`:

```
parsers/
├── dov/                              Shared DOV HTTP + WFS infrastructure
│   ├── dov_http.py                   make_dov_async_client() — single factory for
│   │                                 all DOV callers; fixture-mode toggle
│   ├── dov_common.py                 Shared DOV-domain constants (base URLs, etc.)
│   ├── dov_http_retry.py             429/503 retry (honours Retry-After) +
│   │                                 DovRateLimitState (halves parallelism on 429)
│   ├── dov_fixture_transport.py      In-process httpx mock for integration tests
│   ├── dov_wfs_bbox.py               WFS bbox-split logic (recursive quadrant)
│   ├── dov_wfs_client_base.py        Async WFS base client
│   ├── dov_wfs_download.py           Parallel XML download orchestrator
│   ├── dov_wfs_helpers.py            WFS response helpers
│   ├── dov_wfs_request.py            WFS request builder
│   ├── dov_xml_helpers.py            ElementTree namespace helpers
│   ├── virtuele_boring_client.py     DOV Virtuele Boring doorprik REST client
│   ├── virtuele_boring_constants.py  VB API URLs + lagenmodel codes
│   └── virtuele_boring_result.py     VB parse result type
│
├── cpt/dov/                          CPT-specific DOV import
│   ├── dov_constants.py              CPT-specific constants (namespaces, parallelism,
│   │                                 regexes, transformer, WFS feature type)
│   ├── dov_parser.py                 CPT XML → GEFParseResult
│   ├── dov_client.py                 Async WFS + parallel XML downloads + cache
│   └── dov_xml_cache.py              Filesystem cache, atomic writes, permkey validation
│
├── borehole/dov/                     Borehole-specific DOV import
│   ├── dov_constants.py              Borehole WFS URLs, namespaces, parallelism
│   ├── dov_boring_parser.py          Core boring XML → BoreholeParseResult (header +
│   │                                 drill segments + field log intervals)
│   ├── dov_client.py                 WFS bbox fetch + parallel XML downloads
│   ├── dov_interpretation_client.py  Fetch + parse interpretation streams (8 types)
│   ├── dov_interpretation_parser.py  Interpretation XML → ObservationLayer rows
│   ├── dov_sample_client.py          Fetch sample WFS rows
│   ├── borehole_parse_result.py      BoreholeParseResult + ancillary types
│   ├── borehole_wfs_row.py           WFS row → lightweight header struct
│   ├── interpretation_parse_result.py
│   ├── interpretation_wfs_row.py
│   └── sample_wfs_row.py
│
└── lab/dov/                          Lab-test DOV import
    ├── dov_constants.py              Lab WFS URLs + parameter mappings
    ├── dov_grain_size_client.py      Grain-size (GrainSize) WFS + XML fetch
    ├── dov_grain_size_parser.py      XML → GrainSizeParseResult
    ├── dov_scalar_observation_client.py  Scalar lab tests (catch-all family)
    ├── grain_size_parse_result.py
    ├── grain_size_wfs_row.py
    └── scalar_observation_wfs_row.py
```

**Borehole DOV import pipeline** (`ImportBoreholeDov`):
Same 5-phase shape as the CPT pipeline. Phase 2 runs 8 parallel
interpretation-stream fetches + sample fetch per borehole. Measured wall-clock
on a real 168-borehole bbox: boreholes ~3.5 s · interpretations ~7.6 s ·
grain-size ~7.9 s (small payloads, no per-item XML → ~7× faster per item than
deep CPTs). Endpoint: ``POST /borehole/import-dov`` (sync) + ``POST
/borehole/import-dov/stream`` (SSE async).

**Virtuele Boring** (`virtuele_boring_client.py`):
DOV's per-point subsurface model API. ``GET /dov/virtuele-boring/lagenmodellen``
lists 12 available layered models (g3dv3_F, hcovv2_H/S/B, OMAv1.1, …).
``GET /projects/{pid}/virtuele-boring/predictions?models=A,B`` fetches one
``doorprik`` call per (investigation, model); informative-only overlay, no DB
writes. Results are ``predictions_by_model`` keyed by the requested model codes.
