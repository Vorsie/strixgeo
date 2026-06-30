# Whole-Codebase Observability + Testing Audit — 2026-06-30

Run by the `logging-reviewer` + `testing-reviewer` agents (newly added under `.claude/agents/`) across six subsystems. ~68 findings. This doc is the **prioritized backlog** — work it down with the two reviewer agents (and the `debugging-scientist` agent for any bug it surfaces). Geotech-feature logging (L1–L6) is already applied on branch `feat-geotech-body-samples-3d`; everything else is open.

**The #1 finding (a multiplier on everything below): integration tests run NOWHERE automatically.** The pre-commit hook runs `tests/unit` + desktop Vitest only; CI (`ci.yml`) *explicitly skips* integration ("needs a live Postgres"). Every watertight invariant, every full-importer round-trip, every bundle-restore security guard, and the geotech correctness all live in `tests/integration`, reachable only via the manual `scripts/run-integration-tests.ps1`. This is the structural reason a RED integration test (`BH1-2`) shipped. **Recommended fix:** a path-gated CI `integration` job — `on: pull_request` when `src/groundmodel/**` or `tests/integration/**` changed, using the digest-pinned `postgis` service container (PR-only + path-filtered respects the GH-Actions quota concern). Owner decision: CI job vs a `pre-push` hook vs a documented merge gate.

---

## A. Backend logging

### A1 — Geotech feature (APPLIED ✅ on this branch)
L1 CPT→skeleton reason (unusable soil_code / no qc series); L2 uncounted empty-stack litho edges + inv ids on the no-LCS path; L3 missing-XY `(0,0,0)` WARNING (silent TIN/nearest-CPT corruption); L4 zero-CPT-layers WARNING; L5 Phase-8 fill-band provenance tiers; L6 Phase-8 materialise summary + `sections_with_edges/total`.

### A2 — Data ingest (OPEN — 12 gaps)
- **The "0 failed" lie (HIGH).** `ImportCptDov`/`ImportBoreholeDov` compute `failed` only in the persist loop; download/parse losses are dropped in `DovClient` and `total=len(parsed)`. 316 imported→300 reads "0 failed". Add `download_failed = len(index) - len(parsed)` WARNING + fold into the result/success line (count conservation against the WFS index).
- WFS layer logs the request but not the response (no status/size/latency after a successful call) — `dov_wfs_request.py` `wfs_count`/`wfs_features_json`; shared by all five clients.
- `parallel_download_and_process` drops the per-item download-size TRACE (`dov_wfs_download.py`) — payload-size is the dominant cost.
- `_parse_cone_metadata` silently returns `(None,None)` on missing structure → routing-critical (qt_mpa vs q_total_mpa) decision with no trace.
- Scalar lab-test out-of-range values dropped as "failed" with no per-value reason (`import_samples_dov.py`); same for Atterberg None.
- Empty-curve grain-sizes counted failed without a per-row line; process-pool worker-parse failures not distinguished from network failures; WFS recursion-saturation WARNING omits the bbox corners; GEF decode-fallback (latin-1) success unlogged.

### A3 — Exporters / API / heavy builders (OPEN — 11 gaps)
- **Builders never self-time (HIGH).** `build_voxel_litho_model.py` + `recompute_litho_solids.py` are 40–54 s on-click Builds with `perf_counter` = 0 hits; phase logs report counts but no duration → a hung Build is undiagnosable (which phase?). Add a per-phase timing bracket (a shared `with self._phase("label"):` helper fixes both) + total wall-clock on the success line. Also add total triangle/vertex count (the watertight-health headline) — currently omitted; `bodies_flagged=0` is hardcoded (document it's structurally-zero, not a check).
- **`import_cpt_job` is fully silent** (`jobs.py`) — no entry, the unsupported-extension reject + the 500 on job failure log nothing server-side.
- **`restore_project` (highest-trust-from-disk input) logs no entry/completion/rejections** (`project.py`) — `format_version` reject, `BundleIntegrityError`→422, bad-shape→400 all raise with no server log. `get_project_bundle` (~10 MB export) + `duplicate_project` deep-clone also unlogged.
- DXF exporter silently drops contacts with no level / no formation (no tally on the success line); Plaxis empty-snapshot WARNING carries no project identity; Plaxis dropped boreholes are a script comment, not a log.

---

## B. Backend testing (OPEN — 12 + the process gap)
- **Partial-failure import counts untested** (the A2 "0 failed" lie — `test_download_parse_failure_is_counted_as_failed`, assert `imported+failed+duplicates == len(index)`).
- **The watertight flag detector is never proven to FIRE** — every voxel test asserts `flagged==0`; nothing feeds a non-watertight body and asserts `is_flagged is True` (the invariant rests on an untested oracle).
- **Cross-project IDOR-via-restore untested** — the security surface (only the self-inconsistent case is tested, not a bundle referencing another project's rows). Unsupported `format_version` reject untested.
- **qt_mpa vs q_total_mpa not pinned at the DB boundary** — parser-layer is strong, but no test checks the stored series column for a CPTM vs CPTU.
- No always-run real-data gate for the *Python* voxel builder (only the 2D TS gate exists, and it self-skips); no full double-`execute()` refresh-on-duplicate round-trip; Plaxis-3D no-surface-column dead branch untested + emits no skip count; three-level export gap (#104) unpinned across all 4 exporters.
- Weak: PDF exporter asserts only `%PDF` + size (no geometry); Numba equivalence test can't detect an object-mode fallback; watertight/overlap checks sample ~6 points (a between-samples overlap is invisible — raster the hull).

---

## C. Frontend logging (OPEN — 12 gaps)
The renderer HAS a good `log.ts` wrapper (`[ui LEVEL scope]`, mirrors backend; 382 calls / 39 files — well adopted). The gaps are **level violations + swallowed catches**:
- **Load-bearing breadcrumbs at `log.debug` are INVISIBLE on packaged builds (HIGH — the exact trap that bit the owner).** `log.ts` suppresses debug when `!IS_DEV`, and Chrome hides `console.debug` under "Default levels". Promote to `info`: the `ContactsLayer` drag-commit branch decisions (copy vs move vs snap), the `useShellState` stage/inspector transitions.
- `api/clients/shared.ts` error logs drop the server's `detail` message (the WHY) on the four mutating verbs — it's parsed for the toast but not logged. Add `detail.detail` to the `log.error`.
- `SectionsCanvas` litho↔geo snap/move handlers `catch`→toast with NO `log.error`; the geotech "Correlate packing" no-op guards (`!activeGeotechModel`, self-correlate) log nothing → the silent-gesture class; `partitionFill.ts`/`computeSectionFill` has ZERO logging (the "I correlated two bands and nothing drew" trace is unreconstructable).

---

## D. Frontend testing (OPEN — 12 gaps)
- **The real-data partition gate is OFF in CI (HIGH).** `partitionFill.cs1void/cs1render.test.ts` (CLAUDE.md's "ARBITER") are double-gated (`CS1_GATE=1` + a gitignored dev-DB-generated input) → the only always-on partition coverage is synthetic. Commit a frozen, redacted CS1 fixture + run the four invariants unconditionally.
- **No render-level warp-transform test** — `sectionWarp.test.ts` covers the inverse as pure math; the recurring "floats off its column at non-100% spacing" bug is the FORWARD `warpedXToScreen` inside overlays, and the one overlay test stubs it with `identity`. Add a packed-spacing render assertion for `PartitionFillOverlay` + `ContactsLayer` + `CorrelationEdgesOverlay`.
- **Five large hooks have zero tests** (~4,200 LOC): `useLithoSuggestions` (1790 — #149 root cause lives here; pin the admixture-sig find-or-create key + the sectionId/applyUpdatedSection #57 invariant), `useContactCrud` (1229 — the COPY/Alt-MOVE branch, multi-select shift, 422-rollback), `useInvestigationData` (872 — the stale-async scope guard), `useBoundaryDrag` (652), `useSectionCanvasGestures` (430 — Shift-marquee priority).
- Stage badges: pin each badge's count filter (the "101 counts wrong kind" bug — `GeologyStage` summary + `ExportStage`). `useDovImportStream` SSE error/abort untested. `SectionsCanvas` (2761 LOC, most reorder-prone) lacks a populated-state TDZ smoke.

---

## Suggested order
1. **Process fix** (integration in path-gated CI) — the multiplier.
2. **Frontend `debug`→`info` level promotions** (C, HIGH) — cheap, fixes the exact packaged-build-invisible trap.
3. **Import "0 failed" lie** (A2 + B) — log + count + the count-conservation test.
4. **Builder self-timing** (A3, HIGH) — shared `_phase` helper across the two on-click Builds.
5. **Real-data gates** (B voxel + D partition) — commit frozen fixtures so the arbiters run always-on.
6. The warp-transform render test (D) — highest-likelihood regression by history.
7. Work the rest down per subsystem with the reviewer agents.
