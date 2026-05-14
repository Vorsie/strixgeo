# DOV Import

DOV (Databank Ondergrond Vlaanderen) CPTs are imported via `POST /cpt/import-dov` with a WGS84 bounding box. No `pydov` dependency — direct WFS + async XML downloads + persistent on-disk cache.

**Pipeline (5 phases, all timed in logs):**

| Phase | What | Typical time (500 CPTs cold / warm cache) |
|---|---|---|
| 1+2 | WFS query + parallel download + stream-parse | 4–10 s / 0.2–0.5 s |
| 3 | Batch dedup (one IN-query for all test_ids) | <10 ms |
| 4 | Persist (one INSERT per CPT, no commit) | ~80 ms |
| 5 | Single transaction commit | ~300 ms |

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
   - HTTP/2 client (`httpx[http2]`, `follow_redirects=True`) multiplexes requests over one TLS connection.
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

**`DovXmlCache`** — filesystem cache at `~/.groundmodel/dov_cache/` (overridable via `DOV_CACHE_DIR` env var). One file per permkey, valid forever (DOV measurements are historical). Atomic writes (tempfile + rename). Cache failures are logged but never block the import — every operation falls through to the network path on disk error. Hit/miss rate is logged per import.

**API error mapping** — `POST /cpt/import-dov` translates httpx errors:
- `ConnectError` → 503 "Cannot reach DOV"
- `TimeoutException` → 504
- `HTTPStatusError` / other `RequestError` → 502 with upstream details

**Module layout** under `infrastructure/parsers/cpt/dov/`:
- `dov_constants.py` — all module-level constants (URLs, namespaces, parallelism, regexes, transformer)
- `dov_parser.py` — XML → `GEFParseResult`
- `dov_client.py` — async WFS + parallel XML downloads (with optional cache)
- `dov_xml_cache.py` — filesystem cache, atomic writes, permkey validation
- `__init__.py` — package marker (kept explicit for setuptools / mypy / pytest)
