# GEF Parser

Implemented in `infrastructure/parsers/cpt/gef/gef_parser.py`. Constants in `gef_constants.py`. Handles CPTU, CPTE, CPTM, and UNKNOWN types.

**Parsing flow:** header → data → CPT type detection → void masking → column rename → unit normalisation → depth column → Rf calculation → validation → `GEFParseResult`

**Unit normalisation:** MPa, kPa, bar, tf/m², Pa, kgf/cm² → MPa. kN (qty 128 totaalweerstand) is left as-is — for the standard 1000 mm² Belgian CPTM cone the numeric value equals MPa.

**Key quantity → column mappings (`QUANTITY_TO_COLUMN`):**
- qty 1 = `length_m` (**sondeerlengte** — penetration length measured along the rod, so it includes the deviation from vertical), qty 2 = `qc_mpa`, qty 3 = `fs_mpa`, qty 4 = `rf_pct`
- qty 6 = `u2_mpa`, qty 11 = `depth_m` (**gecorrigeerde diepte** — inclination-corrected vertical depth; always ≤ the qty-1 length)
- A file with both keeps both; a file with only qty 1 falls back to it as `depth_m` **and raises `UNCORRECTED_DEPTH` (WARNING)** so the engineer knows the depths are along-rod. A file with only qty 11 needs no warning.
- Two columns declaring the same quantity → `ParseError` naming the quantity and the columns (the file does not say which channel is which).
- qty 15 = `qt_mpa` (**CPTU only** — corrected cone resistance, qt = qc + u2(1-a))
- qty 128 = `q_total_mpa` (**CPTM only** — totaalweerstand: combined tip + sleeve force read in one go by a mechanical Begemann cone). Physically distinct from qty 15 — they share the historic "qt" symbol but are different quantities, and they're stored in separate columns to keep the data model honest.

**Coordinate-system codes — `#XYID` / `#ZID` are GEF codes, not EPSG codes.**
`gef_crs_codes.py` is the single translation point: GEF 32000 → EPSG 31370 (Belgian Lambert 72), GEF 31000 → EPSG 28992 (Dutch RD); vertical GEF 32001 → EPSG 5710 (mTAW). A code that is already a supported EPSG passes through (no GEF code collides with one). Anything else translates to `None` — never a guess — which makes `ImportCpt` refuse the file rather than persist a wrong SRID. `GEFHeader` keeps both: `xy_code` / `z_code` are the raw source-format tokens, `epsg` / `z_epsg` the translations that every downstream consumer reads.

**Existing rows — CPTs imported before the translation landed.** The parse change fixes NEW imports only. A row stored earlier carries the raw GEF code where an EPSG code belongs (`epsg = 32000`, `z_epsg = 32001`), and its PostGIS `location` geometry carries that same value as its SRID, so every EPSG-keyed consumer treats it as a different coordinate system from an otherwise identical DOV-imported CPT — `fetch_virtuele_boring_predictions` skips anything that is not 31370. Two equivalent repairs:

- **Migration** `d7f3a91c2b45_translate_gef_crs_codes_to_epsg` re-stamps `cpt.epsg`, `cpt.z_epsg`, `cpt.original_z_epsg` and the `location` SRID by the same mapping. Backwards compatibility is suspended pre-ship, so this is a **dev/test-database repair**, not a supported upgrade path for external users (there are none yet); its `downgrade()` is a deliberate no-op because a repaired 31370 is indistinguishable from a DOV-native 31370.
- **Re-import the GEF files.** Equivalent by construction: nothing else about the stored row changes, so a re-import produces the same values the migration writes. The only other value this batch of parser changes moves is the depth column when a file carries both qty 1 (penetration length) and qty 11 (corrected depth) — the parser now reads qty 11, which is shallower by the inclination correction (a real DOV file: 20.212 m against 20.22 m). No migration can recover that from stored rows; it needs the re-import.

**Separators.** `#COLUMNSEPARATOR=` and `#RECORDSEPARATOR=` are honoured; the declared column separator is added to the historic `;`-plus-whitespace split, and a declared record separator terminates the record. The header parser does **not** treat `;` as an inline comment on these two lines (`#COLUMNSEPARATOR=;` is a real declaration DOV writes). **Both declarations are refused when honouring them would destroy data**: a separator drawn from `NUMERIC_CHARACTERS` (`-` would flip the sign of the `-9999.0` void), and — for the record separator only — a character that also splits values apart (a file declaring `#RECORDSEPARATOR=;` would truncate every line to its first value while the frame still came back full-width, padded with nulls). A refusal is logged at WARNING naming the declared value. Data lines that still fail to parse are counted, logged at WARNING, and reported as `SKIPPED_ROWS`; if none parse, the `ParseError` quotes the first offending line instead of claiming the file has no data.

**Validation checks (ValidationLevel: ERROR / WARNING / INFO):**
- `NO_COORDINATES` / `ZERO_COORDINATES` / `NO_EPSG` / `NO_ELEVATION`
- `UNKNOWN_CRS_CODE` — WARNING, `#XYID` code neither a known GEF code nor a supported EPSG (`NO_EPSG` is reserved for a genuinely absent code)
- `UNKNOWN_VERTICAL_CRS_CODE` — INFO, same for `#ZID`; elevations keep a bare `m` label
- `COORDINATES_OUTSIDE_CRS_BOUNDS` — WARNING, the `(x, y)` falls outside the area the declared horizontal EPSG covers (a swapped X/Y, a wrong EPSG, or a foreign position) — the message names the system and the offending values. Never an ERROR, and skipped when the CRS is unknown (`NO_EPSG` / `UNKNOWN_CRS_CODE`) or when coordinates are absent/`(0, 0)` so it never doubles a more specific finding. The area comes from pyproj's `area_of_use`, projected once per EPSG and padded by a 500 m margin (`crs_bounds.py` / `crs_bounds_constants.py`).
- `UNCORRECTED_DEPTH` — WARNING, `depth_m` is really the qty-1 penetration length
- `SKIPPED_ROWS` — WARNING, data lines dropped as unparseable
- `MISSING_COLUMN` — qc always required; fs + u2 required for CPTU; fs required for CPTE
- `DEPTH_NOT_MONOTONIC` — ERROR
- `NEGATIVE_VALUES` — qc, fs must be ≥ 0
- `NULL_VALUES` — after void masking
- `PRE_DRILL` — detected from MVAR 13, or inferred when first depth > 0.5 m
- `NO_NET_AREA_RATIO` — WARNING for CPTU without `a` coefficient (MVAR 3)
- `RF_OUT_OF_RANGE` — Rf outside 0.05–15 % is suspicious
- `QC_SPIKES` — flags outliers > 5× neighbouring values
- `HYBRID_METHOD` — depth increment changes significantly (electric → mechanical mid-test)
- `PARTIAL_U2` — u2 only available from a depth > 0 (CPTE → CPTU mid-test)

**Key MEASUREMENTVAR indices (GEF-CPT-Report standard):**
- 3 = net area ratio (a-value)
- 12 = cone type (0=electric, 1=mechanical)
- 13 = pre-drill depth
- 14 = groundwater depth
- 17 = stop criterion

**Import guard:** `ImportCpt.execute()` raises `ParseError` (→ HTTP 400) when XY coordinates or EPSG code are missing — a CPT without a CRS-tagged position cannot be placed on a map.

**`ImportCpt.persist(result, name, app_project_id)`** — public method that accepts any `GEFParseResult` (from GEFParser, DovParser, or future parsers) and handles coordinate validation, duplicate detection, ORM mapping, and commit. `execute()` wraps this: it parses the file then calls `persist()`. Other use cases (e.g. `ImportCptDov`) call `persist()` directly without going through a file.
