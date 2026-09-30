# KonMari — Dead Modules category (debt #275)

Worktree `wt-restore` @ develop `6663d4259`. Agent scope: dead modules /
functions / hooks / callbacks / i18n keys / orphan tests. Only clearly-dead
items deleted; everything uncertain is a JUDGEMENT CALL. No commits/stages.

## Counts

| Outcome | Count |
|---|---|
| DELETED (things removed) | 6 items across 11 files, net **−521 lines** (5 ins / 526 del) |
| JUDGEMENT CALL (met (a), not clearly (b) / risk) | 6 |
| KEPT-ON-PURPOSE (looks dead, is not) | 9 groups |

Deletion criterion (owner): delete THIS round only when BOTH (a) zero
references outside the thing + its own tests, proven by the exact commands,
AND (b) a written note says superseded/retired/dormant/no-caller OR it is
provably unreachable from every entry point.

---

## Gate baselines (BEFORE any deletion)

| Gate | Result |
|---|---|
| `uv run pytest tests/unit -q` | **3356 passed**, 50 warnings, exit 0 |
| `npx vitest run --retry=1` (plain) | **736 files / 6250 tests passed, 79 skipped**, exit 0 |
| `tsc -p tsconfig.{web,node,e2e}.json` | all exit 0 |
| armed `CS1_GATE=1 HIER_COV=1 GEOTECH_210=1 npx vitest run` | see AFTER section — my changes are all orthogonal to the fill engine, so the armed baseline is the 6 documented designed-red specs (clayBaseFollowsCursorHeterogeneous ×2, collapseSnapback §97, flushSideGrabConfined §113 c/d) plus the GEOTECH_210 stale baseline |

## Gate results (AFTER deletions)

| Gate | Result |
|---|---|
| `uv run pytest tests/unit -q` | **3348 passed**, exit 0 — baseline 3356 − 8 = the removed `clip_tin_to_dem` tests. No regressions. |
| `npx vitest run --retry=1` (plain) | **735 files / 6245 tests passed, 79 skipped**, exit 0 — baseline 736/6250 − 1 file (`geoFormationNames.test.ts`) − 5 tests (4 geoFormationNames + 1 litho U4). No regressions. |
| `tsc -p tsconfig.{web,node,e2e}.json` | **web 0 / node 0 / e2e 0** |
| armed `CS1_GATE=1 HIER_COV=1 GEOTECH_210=1 npx vitest run --retry=1` | **exit 1: 5 failed / 6264 passed / 55 skipped** — the 5 failures are EXACTLY the documented designed-red specs: `clayBaseFollowsCursorHeterogeneous` ×2 (both "ACCEPTANCE (RED today)"), `collapseSnapback §97`, `flushSideGrabConfined §113 (c)` and `(d)`. Verified none of the 3 failing files reference any deleted symbol (`git grep` empty). Zero NEW reds. (GEOTECH_210's stale nospan rows stayed dormant — their `GEOTECH_AXIS_INPUT` fixture is absent in this worktree, so that diag skipped rather than failed.) |

---

## DELETED (with evidence)

### D1. i18n keys `sections.header.{formal,informal}StratigraphyShort` + `geotechnicalCodingShort`
- **Files:** `en/sections.ts`, `nl/sections.ts` (2 keys + 1 key each), `localeParity.test.ts` (dropped from INTENTIONALLY_IDENTICAL).
- **(a)** `git grep -n 'sections.header.<key>' -- desktop/src desktop/tests` → only the en/nl definitions + the parity test. Nothing else.
- **(b)** Provably unreachable: `SectionHeader.tsx:60-61` hard-codes `label: 'F-Strat'`/`'I-Strat'` and uses only the FULL keys (`…formalStratigraphy`) for tooltips; `git grep -nE 'header\.\$\{|Short\`'` → no dynamic key build. Also the brief's own note. `sections.axis.geoShort` KEPT (used by `SectionsAxisPill.tsx:95`).

### D2. `desktop/src/renderer/src/utils/sourceLithoNames.ts` (whole module)
- **(a)** `git grep -n 'buildSourceLithoNameMap\|sourceLithoNameOf' -- desktop/src desktop/tests` → only the module itself. Zero importers (no test even). Analyzer inbound=0.
- **(b)** Provably unreachable + superseded: `GeotechnicalUnitRoster.tsx:105-108` resolves the source-litho name inline via `lithoUnitNameById` instead. No feature gap.

### D3. `desktop/src/renderer/src/utils/geoFormationNames.ts` + `geoFormationNames.test.ts`
- **(a)** `git grep -n 'buildGeoFormationNamesByUnit'` → only the module + its own test.
- **(b)** Superseded: `GeotechnicalUnitRoster.tsx:121` folds `b.geo_formations` inline. No feature gap.

### D4. `lithoFenceExportCallback` dead export-bridge — `LithologyCanvas.tsx` (+ its test)
- **(a)** `git grep -n 'lithoFenceExportCallback' -- desktop/**` → only `LithologyCanvas.tsx` (self) + `LithologyCanvas.test.tsx` (its own U4 test). No external importer since the Export hub replaced the toolbar "Export fence" button.
- **(b)** Written note: CLAUDE.local "10 dead refs … after the export hub replaced the toolbar hooks". Removed: the exported ref, `ownedFenceExport` useRef, the per-render assignment, the guarded cleanup branch, the now-unused `exportFenceDxf` import, and the test's U4 block + import. `fencePanels`/`lithoFormations`/`activeLithoModel` stay (used by the 3D viewer). tsc green.

### D5. `geotechFenceExportCallback` dead export-bridge — `GeotechnicalCanvas.tsx`
- **(a)** `git grep -n 'geotechFenceExportCallback' -- desktop/**` → only `GeotechnicalCanvas.tsx` (self). No test even imports it.
- **(b)** Same note as D4. Removed the same 5 pieces + the unused `exportFenceDxf` import. `nadFormations` stays (viewer `formations={nadFormations}` at line 374). tsc green.

### D6. `clip_tin_to_dem` + `ClipResult` (dead function) — `dem_clip.py` (+ clip tests in `test_dem_clip.py`)
- **(a)** `git grep -n 'clip_tin_to_dem\|ClipResult' -- src tests` → the function + dataclass are referenced only inside `dem_clip.py` and `test_dem_clip.py`. The live functions `GroundPoint`/`build_ground_surface_tin`/`assess_ground_coverage` (imported by `build_ground_surface.py`) stay; `clip_tin_to_dem` and `ClipResult` are NOT imported by them.
- **(b)** Written note: CLAUDE.local "clip_tin_to_dem … had no production caller once clip_tin_by_ground_surface shipped" (that replacement is live in `recompute_formation_surface.py`). `dem_clip.py` stays in `native_compile_manifest.py` (module still live). Removed the now-unused `KIND_CONTACT_ABOVE_DEM` import both sides; ruff clean.

---

## JUDGEMENT CALL (met (a); NOT deleted — needs owner / carries risk)

### J1. `scripts/eval_voxel_geo_bands.py` (orphan script)
- **(a)** Not imported by anything; asserts the OPPOSITE of the shipped ruling ("sideways fill ≥ 1.5× un-bounded", "NEVER relax").
- **Why not deleted:** debt.md (§ near the `_stack_at` decoupling) says deleting it "waits on owner acceptance." Explicit owner gate. **Recommend delete** — its assertion contradicts the shipped decoupling ruling.

### J2. `src/groundmodel/application/run_interpretation.py` (Phase-5 stub)
- **(a)** `git grep -n run_interpretation -- src tests scripts alembic` → zero references anywhere.
- **Why not deleted:** its own docstring says it is a deliberate Phase-5 placeholder ("class identity … already in place"). That is a keep-note, not a supersede-note. **Recommend delete** (CLAUDE.md "Never design a layer you haven't needed yet"; a 39-line stub is trivially re-createable in Phase 5) — but owner call.

### J3. `src/groundmodel/domain/models/lab/scalar_lab_test.py` (`class ScalarLabTest`)
- **(a)** `git grep 'models.lab.scalar_lab_test\|from .scalar_lab_test import'` → zero importers of the DOMAIN model (the live `ScalarLabTestResponse` schema and the DOV-import counters are a different layer).
- **Why not deleted:** documented catch-all family (`memory/project_scalar_lab_test_catchall.md`, docs/domain-model.md). A domain model with zero importers may be superseded by the ORM, or wired dynamically. **Recommend the session main verify against docs/domain-model.md** whether the domain `ScalarLabTest` is still the family's entity before deleting.

### J4. `geotechHierarchicalFill/constructive/coverStatedEdges.ts` + `onlapClosure.ts` (fill-engine internals)
- **(a)** imported only by their own tests + `geotechGapWeld.diag.test.ts`; unreached from production roots (import-graph analysis).
- **Why not deleted:** `onlapClosure.ts` is a deliberate INVARIANT TRIPWIRE ("makes the sixth [bug] report impossible to ship silently"); both are exercised by the armed conformance/invariant suites. No supersede note; passing tests. Armed-gate risk. **Recommend KEEP** — leaning to KEPT below; listed here because they are technically production-unreachable.

### J5. `overlay_tier` wire field / `parent_geo_contact_id` (schema/wire)
- Backwards-compat is RE-ARMED (bundle v4, `.strix` v3). CLAUDE.local flags both as future drops at the "next voxel-contract touch". **Never delete this round** (brief rule: wire/schema fields are inventory-only). Not investigated further.

### J6. The 48 `*.diag.test.ts` files (coordinator lead 1)
- **Total: 48 files, 14,660 lines.** Every one is ENV-GATED and DORMANT by default — the pattern is `if (process.env.XXX !== '1') { it.skip('dormant (set XXX=1)') }` (verified on `geotechHierarchicalCoverage.diag.test.ts` HIER_COV, `partitionFillV2.conformance.diag.test.ts` SHAPE_AUDIT = "Pure reporter — never fails"). So they do **NOT** run in a normal `vitest run` — they skip; execution cost ≈ 0 (collection/transform overhead only). Several back ACTIVE armed gates the session main arms during dogfeed (CS1_GATE, HIER_COV, GEOTECH_210, SHAPE_AUDIT, GEOTECH_HOLES, …).
- **Why not deleted (per coordinator):** a test has no "callers", so criterion (a) cannot be proven; none is clear-dead.
- **Per-file recommendation:** KEEP the whole suite this round — it is a deliberate armed-diagnostics harness, near-zero gate cost. A future dedicated pass (with the owner) could prune probes tied to permanently-closed bugs, but that needs owner input, not a static rule. Full env-flag map recorded in the appendix.

---

## KEPT-ON-PURPOSE (looks dead, is not)

| Item | Why it stays |
|---|---|
| `reviewFlagPrefs.ts` | design note **partition-engine-v2.md §10**: "the persisted `view_state.review_flags` field and its `reviewFlagPrefs` read/write helpers are LEFT INTACT (backwards-compat — an old `.gmproj` … still loads cleanly); nothing renders from them now." Deliberate retention of a persisted-field helper. |
| Alembic migrations (~120) | Loaded by Alembic directory scan, never imported by dotted path; brief rule = never delete a migration. My detector false-positived all of them. |
| API routers (`api/routers/**`) + Pydantic schemas (`api/schemas/**`) | Reached via relative-import barrels + `app.include_router`; my dotted-path detector missed the relative edges. Live. |
| `project_bundle/bundle_build.py`, `bundle_restore_litho.py` | Relative-imported (`from .bundle_build import …`) in the bundle package; on the `.strix`/`.gmproj` backwards-compat path. |
| `sheet/main.tsx`, `SheetMap.tsx`, `mapExtent.ts`, `sheetMapProjection.ts` | Live second HTML entry (`src/renderer/sheet.html` → `sheet/main.tsx`, wired in `electron.vite.config.ts` renderer inputs). |
| `cesiumBaseUrl.ts` | Side-effect import in `main.tsx` (`import './cesiumBaseUrl'`) — must be first before any cesium module. |
| Fill-engine conformance/oracle/invariant harness (`oracle210.ts`, `partitionFillV2.conformance.classify.ts`, `.parityCoverage.ts`, `.cs1BandAuthority.ts`, `partitionOverlapCheck.ts`, `terminationRules.ts`, `geotech210Conformance.audit.ts`/`.coverReads.ts`, `cs1GoldenMaster/*`, `constructive/coverStatedEdges.ts`, `constructive/onlapClosure.ts`) | "test-only imported" but they ARE the armed gates / oracles / invariant tripwires. Active machinery, armed-gate risk, no supersede note. |
| Test infrastructure (`__fixtures__/*`, `test/cesiumMock.ts`, `test/setup.ts`, `test/fixtures/borehole.ts`, `lib/streaflet/test/renderInMap.tsx`, `scene.test-helpers.ts`, `partitionFillSampling.testutil.ts`, `geotechPreviewTestFixtures.ts`, `bodyTestFixtures.ts`) | Imported by many live tests; serve the suite. |
| Watertight loft (`litho_solid_builder.py`) + strat_field + `geo_bands.py`/`load_geo_surfaces.py`/`surface_bound.py` + `refineLithoPartition.ts`/`geotechHierarchicalFill/` old dir | **Already deleted** by prior campaigns (debt #206, #237.1, #270). Verified GONE on disk; nothing left to keep or delete. |

---

## Method / evidence commands

- TS reachability: import-graph BFS from product roots (`main.tsx`, `sheet/main.tsx`, `main/index.ts`, `preload/index.ts`, `electron.vite.config.ts`) + e2e roots, resolving `@/*`→`src/renderer/src/*`, `.ts/.tsx/.js/.mjs/.jsx`, `/index.*`, AND side-effect imports (`import './x'`). 857 non-test source files, 28 unreached (list below). Script: scratchpad `ts_reach.mjs`.
- Python: dotted-path inbound-reference scan over src/tests/scripts/alembic + `native_compile_manifest.py` string check (196 "0-src-ref" candidates, dominated by relative-import barrels + migrations → verified individually). Script: scratchpad `py_reach.py`.
- Every deletion verified with `git grep -n '<symbol>' -- src tests` / `-- desktop/src desktop/tests` from the repo root (a `-- 'desktop/src'` pathspec run from `desktop/` cwd silently matches nothing — a trap I hit and corrected).

---

## Findings that belong to ANOTHER category (named, not acted on)

- **Duplication / DRY (reuse agent):** `sourceLithoNames.ts` and `geoFormationNames.ts` were "extract in one place" helpers that the roster re-inlined — the roster now duplicates the fold logic inline (I deleted the orphan helpers, but the inline duplication is a reuse-category call if a 3rd consumer appears).
- **Stale docs (docs owner):** `LithologyStage`/`GeotechnicalToolbar` "Export fence" toolbar-button docstrings on the (now-removed) fence callbacks were stale (export hub replaced them). The removed docstrings named a button that no longer exists. `localeParity.test.ts` comment "Abbreviations shown on space-constrained chrome" was stale for the `*Short` keys (they were hard-coded in `SectionHeader.tsx`).
- **God components (#201 agent):** `en/sections.ts` (925→919 lines) and `nl/sections.ts` (991 lines) trip the >500-line desktop hook warning; `LithologyCanvas.tsx`/`GeotechnicalCanvas.tsx` are large hook-heavy canvases.

---

## Appendix — the 48 `*.diag.test.ts` env-flag map (all dormant-by-default)

Each file skips unless its flag(s) are set. Grouped by arming flag:

- **CS1_GATE:** freeDrawIdentity.phase0, freeDrawRepair.phase0, partitionGhostHandles, partitionFillV2.allSectionsReshape, partitionFillV2.cs1gates, partitionFillV2.reshapeMap
- **SHAPE_AUDIT:** partitionFillV2.{conformance, boundaryLensClosingLeg, lensAudit, lensCrushRelease, lineStageDiff, rawUnitTerm, reachScan, seedGate, s58col18, ts7klei, f1gate, f5gate}
- **GEOTECH_210 / GEOTECH_LAW / GEOTECH_LITHO_CONSISTENCY / GEOTECH_HOLES / GEOTECH_EDGE_REACH / OWN_EDGE / GAP_WELD / HIER_COV / HIER_DUMP:** geotech210Conformance, geotechLawOracle, geotechLithoConsistency, geotechHoles, geotechEdgeReach, geotechOwnColumnEdge, geotechGapWeld, geotechHierarchicalCoverage, hierDump
- **Other single-purpose probes** (BODY_DIAG, CURVE_PROBE, GAP9_DIAG, COVER_DIFF, HATCH_DELTA, DIVIDE_DUMP, PROBE, GAPLESS_GATE, CONSTRUCT_PROBE, GAP_DIAG, SECTION_DUMP, GEOTECH_3D, LEDGER_OUT, LOOP_SCENES, TONE_DIAG, CROSSGAP_DIAG, HOLES_DIAG, CS1_FLIP, S68_REAL, VOXEL_REGEN): bodyEvidence, curveProbe, clipGap9, coverDiffShape, cs1HatchDelta, dividePartitionDump, fixtureFaithful, gaplessGate, geotechConstructProbe, geotechFillGap, geotechSectionDump, geotechVoxelPayload, lithoLedger, loopClosureScenes, partitionFillTone, partitionFillV2.{crossgap_overlap, holes_overlaps, cs1flip_walkthrough, groundTruth, s68realcontact, voxelPayloadRegen}

Pattern confirmed on two files: `if (process.env.HIER_COV !== '1' || !existsSync(INPUT)) { it.skip('dormant (set HIER_COV=1)', () => {}) }` and `SHAPE_AUDIT=1 … Pure reporter — never fails`.
