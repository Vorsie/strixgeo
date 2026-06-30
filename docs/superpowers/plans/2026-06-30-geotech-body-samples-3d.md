# Geotech Packing Bodies — Litho-Bounded Subdivision, Lab Samples, Watertight 3D — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make geotech packing strictly a within-litho-body subdivision, assign borehole lab samples to the density body they sit in, and produce a watertight 3-D model that honours boreholes as ground truth.

**Architecture:** Backend-first. The 2-D geotech partition (`SubdivideAllBodies` + `DivideBoreholes` + the resolver `body_id`) becomes lithology-confined; the existing voxel builder (`build_voxel_litho_model`, already honor-borehole + watertight) inherits the fix unchanged. A correlation guard enforces the invariant at the gesture. Samples gain a stored `geotech_body_id`. The real-data CS1 gate is the arbiter.

**Tech Stack:** Python 3.11 (FastAPI, async SQLAlchemy, Alembic, Polars), pytest/pytest-asyncio; Electron + React + TypeScript (Vitest). Dev DB = `groundmodel` on docker `strix-db-1` host port 5433. Geotech model id (dev) `019ef689-9a90-7a70-b0a9-97077c49a170`; litho model `019e934c-…`; CS1 `019e9330-e333-7357-95ac-c0c93fa1e523`.

**Read first:** `docs/superpowers/specs/2026-06-30-geotech-body-samples-3d-design.md` (the spec — the source of truth for every rule here). CLAUDE.md (logging via `GroundModelLogger`, one-class-per-file, constants file, DoD). `memory/project_geotech_stage_body_centric.md`. Integration tests run ONLY via `.\scripts\run-integration-tests.ps1 <path>` (PowerShell wrapper points `DATABASE_URL` at the sibling `_integration` DB; the wrapper exits 0 even on failure → READ the output). Never run bare `pytest tests/integration` (wipes the dev DB). Commit per-file, Conventional Commits, end the body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Do NOT `git push`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/groundmodel/application/subdivide_all_bodies.py` | per-body classification; CPT-null fix site (`_build_column_plans` / profile build) | modify |
| `src/groundmodel/domain/services/geotech_subdivision.py` | `suggest_geotech_subdivision` (per-segment packing split) | reference |
| `src/groundmodel/domain/services/geotech_packing_edges.py` | `aligned_same_sequence_pairs` auto-rule | reference (already within-body) |
| `src/groundmodel/domain/services/litho_body_guard.py` | **NEW** pure helper: are two contacts in the same litho body? | create |
| `src/groundmodel/application/correlate_litho_contacts.py` | edge-creation use case; guard hook | modify |
| `src/groundmodel/domain/services/borehole_packing_fill.py` | **NEW** pure: litho-confined clip + conservative cascade per litho-body extent | create |
| `src/groundmodel/application/divide_boreholes.py` | calls the new fill helper; assigns samples | modify |
| `src/groundmodel/domain/services/assign_sample_to_band.py` | **NEW** pure: sample midpoint → band → (body_id, nad, source) | create |
| `src/groundmodel/infrastructure/db/models/sample_orm.py` | + `geotech_body_id`, `geotech_nad_class`, `geotech_assignment_source` | modify |
| `src/groundmodel/infrastructure/db/migrations/versions/<rev>_sample_geotech_assignment.py` | **NEW** Alembic migration | create |
| `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` | `handleCreateGeotechPackingCorrelation` — surface guard rejection | modify |
| `desktop/src/renderer/src/components/sections/` (sample-points overlay) | **NEW** clickable sample points + body link | create |
| `scripts/throwaway_cs1_partition_extract.py` (pattern from deep-substrate gate) | regenerate CS1 inputs for the gate | reference/create |

---

## Task 1 — CPT-null classification drop (precondition fix)

**Spec §8.** A CPT band with healthy qc must never become the `nad_class=NULL` skeleton. Real case: `GEO-10/170-S10` sand 8.83–13.18 m (qc avg 8.73 MPa, 220 pts, 0 nulls) is skeleton while the same body classifies NAD 5/6/7 on ~20 other tests. The `None` enters at `subdivide_all_bodies.py` `_build_column_plans` via empty `profile.splits`; `suggest_geotech_subdivision` is documented "never empty", so the drop is upstream — one of: (i) series missing in `cpt_series` dict (line ~427-429), (ii) `soil_code not in BASE_LITHOLOGIES` (line ~431-433), (iii) the geo-division splitting the segment so a sub-segment has no qc in-window.

**Files:**
- Test: `tests/integration/api/test_subdivide_all_bodies.py` (add a case)
- Modify: `src/groundmodel/application/subdivide_all_bodies.py`

- [ ] **Step 1: Reproduce on real data with instrumentation.** Temporarily add a DEBUG log at each of the three candidate drop points in `subdivide_all_bodies.py`, each printing `investigation_id`, `soil_code`, `seg.top_depth_m`, `seg.base_depth_m`, `len(series.qc_mpa) if series else None`, and the count of qc samples inside `[seg.top, seg.base]`:

```python
# at the series-missing guard:
self.debug(f"SAB-NULL series-missing inv={seg.investigation_id} soil={soil_code}")
# at the soil_code guard:
self.debug(f"SAB-NULL soil-guard inv={seg.investigation_id} soil={soil_code}")
# in _build_column_plans, in the `if not sub_intervals:` branch:
self.debug(f"SAB-NULL empty-splits inv={seg.investigation_id} top={geo_top} base={geo_base} "
           f"splits={len(profile.splits) if profile else 'noprofile'}")
```

- [ ] **Step 2: Run the real subdivide and read which line fires for S10.** Re-materialise the dev geotech model (the app "Subdivide all bodies" verb, or a one-off script that calls `SubdivideAllBodies.execute` for litho model `019e934c…`) with log level DEBUG, and grep stdout for `SAB-NULL` lines whose `inv=` is `GEO-10/170-S10`'s id (`019e932e-7c35-7918-90c1-0c1382958b1a`). The firing line identifies the true cause. Expected: exactly one of the three.

- [ ] **Step 3: Write the failing regression test** in `tests/integration/api/test_subdivide_all_bodies.py` mirroring the cause. A CPT with continuous qc (e.g. constant 8.0 MPa) over a sand litho segment, in a body with ≥2 CPTs, must yield a CLASSIFIED band (nad_class not None) on every CPT:

```python
async def test_cpt_with_good_qc_never_skeleton(self, session, seeded_litho_model_with_sand_body):
    # body = 2 CPTs, both sand 8-13 m, qc ~8 MPa (medium dense) the whole way
    result = await SubdivideAllBodies(session).execute(project_id, litho_model_id)
    geo_layers = await _load_geotech_layers(session, result.geotech_model_id)
    cpt_bands = [l for l in geo_layers if l.cpt_id is not None]
    assert all(_formation_nad_class(session, l) is not None for l in cpt_bands), \
        "a CPT band with usable qc must classify, never skeleton"
```

- [ ] **Step 4: Run it, confirm RED.** `.\scripts\run-integration-tests.ps1 tests/integration/api/test_subdivide_all_bodies.py::TestSubdivideAllBodies::test_cpt_with_good_qc_never_skeleton` — expect FAIL (a skeleton band present). If it PASSES, the synthetic fixture doesn't trigger the real cause — tighten the fixture to match the Step-2 finding before continuing.

- [ ] **Step 5: Fix the identified cause.** Implement the minimal fix for whichever line fired:
  - if **series-missing**: ensure `all_cpt_ids` includes every CPT that has a segment (the set is built from `anchor_kind` "cpt" entries — verify the CPT is resolved as `cpt`, not dropped); load its series.
  - if **soil-guard**: the group's `soil_code` is hoisted from `group_segs[0]` — if a group mixes litho formations, derive `soil_code` per-segment from `seg.formation_id` instead of the group's first.
  - if **empty-splits clamp**: the geo-division produced a sub-segment whose qc window is empty after clamping — fall back to `suggest_geotech_subdivision` on the FULL litho-segment qc window (never leave a CPT sub-interval at `None`).

- [ ] **Step 6: Run the test, confirm GREEN**, then remove the Step-1 debug logs. Re-run.

- [ ] **Step 7: Commit** (one file per commit — test, then impl):
```bash
git add tests/integration/api/test_subdivide_all_bodies.py && git commit -F- <<'EOF'
test(geotech): a CPT band with usable qc must never become the skeleton
...Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
git add src/groundmodel/application/subdivide_all_bodies.py && git commit -F- <<'EOF'
fix(geotech): classify CPT sand band with good qc instead of skeleton (CPT-null drop)
...
EOF
```

---

## Task 2 — Correlation guard: packing ⊂ litho body

**Spec §2.** Hard-block a packing correlation whose two bands are in different litho bodies.

**Files:**
- Create: `src/groundmodel/domain/services/litho_body_guard.py`
- Test: `tests/unit/domain/services/test_litho_body_guard.py`
- Modify: `src/groundmodel/application/correlate_litho_contacts.py` (geotech-model path only)
- Modify (error mapping): the correlate endpoint router to map the new guard error → HTTP 422.

- [ ] **Step 1: Failing unit test** for the pure helper:

```python
# tests/unit/domain/services/test_litho_body_guard.py
from groundmodel.domain.services.litho_body_guard import same_litho_body

def test_same_litho_body_true_when_both_resolve_to_one_litho_body():
    # contact_a, contact_b → their geotech layers → source litho layers → same litho body_id
    assert same_litho_body(litho_body_of={"ca": "B1", "cb": "B1"}, contact_a="ca", contact_b="cb") is True

def test_same_litho_body_false_across_bodies():
    assert same_litho_body(litho_body_of={"ca": "B1", "cb": "B2"}, contact_a="ca", contact_b="cb") is False

def test_missing_mapping_is_blocked_conservatively():
    # an unmapped contact cannot be proven same-body → block
    assert same_litho_body(litho_body_of={"ca": "B1"}, contact_a="ca", contact_b="cb") is False
```

- [ ] **Step 2: Run, confirm RED.** `uv run pytest tests/unit/domain/services/test_litho_body_guard.py -v` → FAIL (module missing).

- [ ] **Step 3: Implement the pure helper** (one function, numpy docstring, no I/O):

```python
def same_litho_body(litho_body_of: dict[str, str | None], contact_a: str, contact_b: str) -> bool:
    """True iff both contacts resolve to the same (non-None) litho body id.
    Conservative: an unmapped or None-mapped contact returns False (block)."""
    a = litho_body_of.get(contact_a)
    b = litho_body_of.get(contact_b)
    return a is not None and a == b
```

- [ ] **Step 4: Run, confirm GREEN.**

- [ ] **Step 5: Wire the guard into the geotech correlate path.** In `correlate_litho_contacts.py`, ONLY when the target model is geotechnical, build `litho_body_of` (geotech contact → its geotech layer → `source_litho_formation_id` → that litho layer's litho `body_id`) and raise a domain error before edge insert when `not same_litho_body(...)`. Add a new exception in `shared/exceptions.py` (e.g. `CrossLithoBodyCorrelationError`) with message `"these bands are in different litho bodies — correlate the lithology first in the litho stage"`. Map it to HTTP 422 in the correlate router (mirror the existing 422 mapping pattern). Log at WARNING.

- [ ] **Step 6: Integration test** in `tests/integration/api/` (new file `test_geotech_correlation_guard.py`): correlating two geotech bands in the SAME litho body succeeds (201/200, edge created); two bands in DIFFERENT litho bodies returns 422 and creates NO edge. Run via the wrapper, confirm GREEN.

- [ ] **Step 7: Auto-rule check (no code, a test).** Add a unit test asserting `aligned_same_sequence_pairs` is only ever called within one body group (it already is — pin it so a future refactor can't break the invariant).

- [ ] **Step 8: Commit** per file (exception, helper+test, use-case, router, integration test).

---

## Task 3 — Litho-confined borehole fill (clip + conservative cascade)

**Spec §4.** Rewrite the borehole packing materialisation so each litho-body extent on a borehole is filled ONLY with same-lithology CPT packing, clipped by depth, remainder by the cascade, provenance-tagged.

**Files:**
- Create: `src/groundmodel/domain/services/borehole_packing_fill.py`
- Test: `tests/unit/domain/services/test_borehole_packing_fill.py`
- Modify: `src/groundmodel/application/divide_boreholes.py`
- Reference: `src/groundmodel/domain/services/geotech_borehole_materialiser.py`

- [ ] **Step 1: Failing unit tests** for the pure fill helper. Define the contract:

```python
# fill_borehole_litho_body_extent(extent_top, extent_base, cpt_packing_surfaces, body_min_class, litho_abs_min_class)
#   -> list[ FillBand(top, base, nad_class, source) ]
# source ∈ {"cpt_interpolated","body_min","absolute_min"}

def test_clip_not_rescale_crosscut():
    # sand extent 0-5 on borehole; CPT surfaces place loose/med at 3.5, med/dense at 7.5 (below clay)
    bands = fill_borehole_litho_body_extent(0.0, 5.0,
              cpt_packing_surfaces=[(3.5, 5, 6)],  # (depth, class_above, class_below): loose(5)|med(6) at 3.5
              body_min_class=5, litho_abs_min_class=5)
    # dense never appears; med fills to the clip at 5.0
    assert [(round(b.top,1), round(b.base,1), b.nad_class) for b in bands] == [(0.0,3.5,5),(3.5,5.0,6)]
    assert all(b.source == "cpt_interpolated" for b in bands)

def test_uncovered_remainder_fills_body_min_low_confidence():
    # CPT surface only covers 0-2; 2-5 has no reaching surface
    bands = fill_borehole_litho_body_extent(0.0, 5.0, cpt_packing_surfaces=[(2.0, 6, None)],
              body_min_class=6, litho_abs_min_class=5)
    tail = [b for b in bands if b.top >= 2.0][-1]
    assert tail.nad_class == 6 and tail.source == "body_min"

def test_body_with_no_cpt_uses_absolute_min():
    bands = fill_borehole_litho_body_extent(0.0, 5.0, cpt_packing_surfaces=[],
              body_min_class=None, litho_abs_min_class=5)
    assert bands == [FillBand(0.0, 5.0, 5, "absolute_min")]

def test_no_band_ever_exceeds_extent():
    bands = fill_borehole_litho_body_extent(2.0, 4.0, cpt_packing_surfaces=[(1.0,5,6),(7.0,6,7)],
              body_min_class=5, litho_abs_min_class=5)
    assert all(2.0 <= b.top and b.base <= 4.0 for b in bands)
```

- [ ] **Step 2: Run, confirm RED.** `uv run pytest tests/unit/domain/services/test_borehole_packing_fill.py -v`.

- [ ] **Step 3: Implement** `borehole_packing_fill.py` — a frozen `FillBand` dataclass + the pure function. Algorithm: project CPT packing surfaces into `[extent_top, extent_base]`, clip; emit bands between consecutive clipped surfaces tagged `cpt_interpolated`; any uncovered stretch of the extent → one band tagged `body_min` (class = `body_min_class`) or, if `body_min_class is None`, `absolute_min` (class = `litho_abs_min_class`). Never exceed the extent; never emit a `None` class. numpy docstrings; inherit no logger (pure).

- [ ] **Step 4: Run, confirm GREEN.**

- [ ] **Step 5: Add the absolute-min lookup constant** in the geotech constants file (`*_constants.py` next to the segmenter): `LITHO_ABSOLUTE_MIN_NAD = {"GRIND":1, "ZAND":5, "SILT":13, "KLEI":21, "VEEN":29}` with a comment that NAD numbering runs weak→strong within a lithology so min = weakest = conservative.

- [ ] **Step 6: Rewire `divide_boreholes.py`** to call the new helper per (borehole, litho-body-extent), replacing the lithology-blind TIN-class stamping. For each borehole, for each litho body it intersects: compute the body's CPT packing surfaces (same-lithology), `body_min_class` (min class among the body's CPT bands), `litho_abs_min_class` from the constant; call `fill_borehole_litho_body_extent`; write `LithoLayerOrm` rows with `source` + `confidence` set from the band's `source` (`cpt_interpolated`→high, `body_min`→low, `absolute_min`→lowest). The borehole's own litho contacts bound each extent (clay stays clay).

- [ ] **Step 7: Integration test** `tests/integration/api/test_divide_boreholes_litho_confined.py`: on a fixture mirroring the CS1 crosscut (borehole sand-over-clay between two sand CPTs), assert **0 bands where the band's formation NAD-class lithology ≠ the band's litho_main_soil_code**, and **0 NULL-class bands**. Run via wrapper, GREEN.

- [ ] **Step 8: Commit** per file.

---

## Task 4 — Sample → band → body (stored)

**Spec §5, §9.** Add the sample columns + migration + the assignment, computed during DivideBoreholes.

**Files:**
- Modify: `src/groundmodel/infrastructure/db/models/sample_orm.py`
- Create: `src/groundmodel/infrastructure/db/migrations/versions/<rev>_sample_geotech_assignment.py`
- Create: `src/groundmodel/domain/services/assign_sample_to_band.py` + `tests/unit/domain/services/test_assign_sample_to_band.py`
- Modify: `src/groundmodel/application/divide_boreholes.py`

- [ ] **Step 1: Failing unit test** for the pure assignment:

```python
# assign_sample_to_band(sample_top, sample_base, bands) -> (body_id, nad_class, source) | (None,None,"unresolved")
def test_sample_midpoint_picks_its_band():
    bands = [Band(0,3,"Bx",6,"cpt_interpolated"), Band(3,6,"By",21,"body_min")]
    assert assign_sample_to_band(2.5, 2.85, bands) == ("Bx", 6, "cpt_interpolated")  # mid 2.675 -> band0

def test_spanning_sample_uses_midpoint_and_flags():
    bands = [Band(0,3,"Bx",6,"cpt_interpolated"), Band(3,6,"By",21,"body_min")]
    body, nad, src = assign_sample_to_band(2.8, 3.4, bands)  # mid 3.1 -> band1
    assert (body, nad) == ("By", 21)

def test_sample_outside_all_bands_unresolved():
    assert assign_sample_to_band(9.0, 9.5, [Band(0,3,"Bx",6,"cpt_interpolated")]) == (None, None, "unresolved")
```

- [ ] **Step 2: Run RED → implement (midpoint containment) → GREEN.** numpy docstrings, pure.

- [ ] **Step 3: ORM columns.** Add to `SampleOrm`: `geotech_body_id: Mapped[uuid.UUID | None]`, `geotech_nad_class: Mapped[int | None]`, `geotech_assignment_source: Mapped[str | None]` (all nullable, indexed on `geotech_body_id`). Follow the existing column style in the file.

- [ ] **Step 4: Alembic migration.** Generate `uv run alembic revision -m "sample geotech assignment"` then hand-write the `op.add_column` × 3 + `op.create_index` on `geotech_body_id`, and the `downgrade` dropping them. Use a literal revision id (NEVER `Date.now`). Run `uv run alembic upgrade head` (no DATABASE_URL override → migrates the DEV DB; the integration wrapper migrates the sibling DB separately).

- [ ] **Step 5: Wire assignment into DivideBoreholes.** After writing a borehole's bands (Task 3), load that borehole's `sample` rows, call `assign_sample_to_band` per sample against the just-written bands, and UPDATE the three columns. Resolve `body_id` to the resolver value once edges are resolved (DivideBoreholes already runs the resolver; assign after `ResolveLithoInstances` so `body_id` is final). Log a phase summary (`assigned=N unresolved=M`).

- [ ] **Step 6: Integration test** `tests/integration/api/test_sample_geotech_assignment.py`: after DivideBoreholes on the crosscut fixture, a sample in the borehole's sand gets the sand body's class with `source="cpt_interpolated"` or `"body_min"`; a sample in the clay gets a clay class; none is litho-contradicting. Run via wrapper, GREEN.

- [ ] **Step 7: Commit** per file (ORM, migration, helper+test, use-case, integration test).

---

## Task 5 — Frontend: guard message, sample points, provenance

**Spec §2, §6b/c.**

**Files:**
- Modify: `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` (`handleCreateGeotechPackingCorrelation`)
- Create: a sample-points overlay under `desktop/src/renderer/src/components/sections/`
- Modify: the geotech inspector to show `source`/`confidence`
- Client: extend the sample client type (`borehole.ts` or a new geotech client) with the three new fields.

- [ ] **Step 1: Guard rejection UX (Vitest first).** Test that when the packing-correlate call returns 422 with the cross-litho-body message, the handler shows a toast with that message and does NOT add a local edge. Implement: catch the 422 in `handleCreateGeotechPackingCorrelation`, `toast('error', err.message)`. Run `npx vitest run` on the affected spec, GREEN. Run filtered `tsc`: `npx tsc --noEmit -p tsconfig.web.json`.

- [ ] **Step 2: Sample points overlay (Vitest first).** A pure helper maps `{sample, borehole along-x, surfaceElev}` → screen point via `warpedXToScreen` (RUN the section-geometry-check skill on the new overlay before claiming it renders right: `python .claude/skills/strix-section-geometry-check/check_section_geometry.py <file>`). Render a clickable dot per sample on the geotech axis; click → select its `geotech_body_id` (reuse the body-hover/selection store). Test the helper + a render smoke. GREEN + tsc.

- [ ] **Step 3: Provenance in the inspector.** Show each geotech band's confidence (high/low/lowest) as a small badge, and on a sample its `geotech_assignment_source`. Vitest a row render. GREEN + tsc.

- [ ] **Step 4: Commit** per file.

---

## Task 6 — Watertight 3D verification (clay as ground truth)

**Spec §7.** The voxel builder is reused unchanged; this task PROVES the inherited properties on the now-litho-confined partition.

**Files:**
- Test: `tests/integration/` (new `test_geotech_voxel_watertight.py`)
- Reference: `src/groundmodel/application/build_voxel_litho_model.py`, `domain/services/voxel_litho/label_voxels.py`

- [ ] **Step 1: Integration test.** Build the geotech voxel model on the crosscut fixture (borehole sand-over-clay, two sand CPTs with a deep dense sand body). Assert: `flagged == 0`, inter-body overlap `== 0` (reuse the litho voxel build's existing assertions), and the new check **no voxel labelled a packing-class-of-lithology-X lies inside a borehole column whose observed lithology at that depth is Y≠X** (the 3-D "zero litho≠class"). Confirm the deep dense-sand body is ONE connected solid and the borehole clay punches through as its own body.

- [ ] **Step 2: Run RED if the partition isn't yet litho-confined; with Tasks 1-3 done it should pass.** If a packing voxel sits in the clay column, the bug is upstream (Task 3 fill or the honor-borehole feed) — fix there, not in the builder.

- [ ] **Step 3: Commit** the test.

---

## Task 7 — CS1 real-data acceptance gate (the arbiter)

**Spec §11.** Synthetic fixtures are necessary-not-sufficient; the real CS1 data is the arbiter (mirrors the deep-substrate CS1 gate pattern).

**Files:**
- Create: `scripts/throwaway_cs1_geotech_gate_extract.py` (regenerates inputs from the dev DB, like `throwaway_cs1_partition_extract.py`)
- Create: a gated test (env `CS1_GEOTECH_GATE=1`) under `desktop/` or `tests/` that loads the extract and asserts the gate.

- [ ] **Step 1: Extract.** Script queries the dev DB (CS1 = `019e9330…`, geotech model `019ef689…`) for every in-corridor investigation's geotech bands + samples + body_ids + the boreholes' observed litho, writes a JSON the gate reads. (Project-onto-section logic is in `throwaway_cs1_brainstorm_render.py`.)

- [ ] **Step 2: The gate test asserts on the REAL extract:** `litho≠class == 0` on all bands; `null-class == 0` on CPT bands; **every sample assigned** with a non-null `geotech_assignment_source`; no sample litho-contradicts its body. Document that it must be regenerated after re-subdividing (the dev DB lags code).

- [ ] **Step 3: Run the full gate** after re-materialising the dev geotech model with all tasks landed. Record pass/fail counts in the commit body.

- [ ] **Step 4: Commit** the script + gate.

---

## Final review (after all tasks)

- [ ] Dispatch a final code-reviewer over the whole branch diff (senior-code-reviewer): architecture fit, the litho-body invariant held end-to-end, data-integrity provenance tags present, no `nad_class` ever crosses a lithology, tests pin behaviour not implementation.
- [ ] Re-materialise the dev geotech model + dogfeed: the geotech 2-D shows no grey/mismatch bands; samples carry density; the 3-D build is watertight with the clay honoured.
- [ ] Update `memory/project_geotech_stage_body_centric.md` + CLAUDE.md "Recently resolved" with the shipped scope.
- [ ] Use superpowers:finishing-a-development-branch.

---

## Self-review notes (plan author)

- **Spec coverage:** §2 guard → T2; §3 body-skips-columns → inherent in T3 per-extent fill + T2 guard (no separate task — the deep sand simply has no member on the clay extent); §4 fill → T3; §5 sample link → T4; §6 uses → aggregation/validation surfaced T5 (aggregation math itself is Phase-5 Parameters, out of scope here per §10); §7 3D → T6; §8 CPT-null → T1; §9 data model → T4; §11 testing + CS1 gate → T7. All covered.
- **Order:** T1 precondition first (clean inputs), then invariant (T2), then the fill that depends on it (T3), then samples on the bands (T4), then UI (T5), then 3D proof (T6), then the real-data arbiter (T7).
- **Type consistency:** `source` strings (`cpt_interpolated`/`body_min`/`absolute_min`/`unresolved`) are identical in T3, T4, T7. `FillBand`/`Band` are the band carriers in T3/T4. `same_litho_body`/`fill_borehole_litho_body_extent`/`assign_sample_to_band` names are stable across tasks.
