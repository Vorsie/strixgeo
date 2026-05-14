# GEF Parser

Implemented in `infrastructure/parsers/cpt/gef/gef_parser.py`. Constants in `gef_constants.py`. Handles CPTU, CPTE, CPTM, and UNKNOWN types.

**Parsing flow:** header → data → CPT type detection → void masking → column rename → unit normalisation → depth column → Rf calculation → validation → `GEFParseResult`

**Unit normalisation:** MPa, kPa, bar, tf/m², Pa, kgf/cm² → MPa. kN (qty 128 totaalweerstand) is left as-is — for the standard 1000 mm² Belgian CPTM cone the numeric value equals MPa.

**Key quantity → column mappings (`QUANTITY_TO_COLUMN`):**
- qty 1 = `depth_m`, qty 2 = `qc_mpa`, qty 3 = `fs_mpa`, qty 4 = `rf_pct`
- qty 6 = `u2_mpa`, qty 11 = `length_m`
- qty 15 = `qt_mpa` (**CPTU only** — corrected cone resistance, qt = qc + u2(1-a))
- qty 128 = `q_total_mpa` (**CPTM only** — totaalweerstand: combined tip + sleeve force read in one go by a mechanical Begemann cone). Physically distinct from qty 15 — they share the historic "qt" symbol but are different quantities, and they're stored in separate columns to keep the data model honest.

**Validation checks (ValidationLevel: ERROR / WARNING / INFO):**
- `NO_COORDINATES` / `ZERO_COORDINATES` / `NO_EPSG` / `NO_ELEVATION`
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
