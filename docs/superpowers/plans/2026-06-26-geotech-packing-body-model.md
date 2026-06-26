# Geotech Packing-Density Body Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the geotech per-CPT carve render with a body-centric model — geotech packing bodies built like litho bodies (connected by correlation, true 3D), so the bands render cleanly, contain lab tests, and group CPT data for analytics.

**Architecture:** Reuse the litho pipeline end-to-end. (1) Backend: change the geotech auto-edge rule from full-NAD-sequence-match to litho-correlation-seeded **same-class** connection, and divide boreholes at build time by the bodies' geometry. (2) Validate connectivity on real data. (3) Frontend: retire `subdivideRegionsByGeotech`, render the connected-body partition (`computeSectionFill` on geotech layers + edges). (4) Wire the 3D voxel builder to the geotech model.

**Tech Stack:** Python 3.11 + async SQLAlchemy (backend); React + TypeScript + Vitest (frontend); `uv run pytest` / `npx vitest run` / `npx tsc`.

**Spec:** `docs/superpowers/specs/2026-06-26-geotech-packing-body-model.md` — read it first.

---

## ⚠ Critical sequencing gate (do not reorder)

Both reviewing agents flagged this as the top risk: **the frontend render swap (Task 4) MUST NOT land until the backend connectivity (Task 1) is proven on real data (Task 2 gate).** Shipping the frontend on sparse edges regresses straight back to the "187-singleton" render. Order is: **Task 1 → Gate G1 → Task 3 → Task 4 → Task 5 → Gate G2.**

---

## File map

| File | Change |
|---|---|
| `src/groundmodel/domain/services/geotech_packing_edges.py` | Replace `aligned_same_sequence_pairs` with `same_class_pairs` |
| `src/groundmodel/application/subdivide_all_bodies.py` | `_derive_geotech_edges_from_litho` → same-class rule; add Phase 8c borehole division; remove Phase 8b nearest-CPT extrapolation |
| `src/groundmodel/domain/services/geotech_split_surface.py` | Reuse `interpolate_split_elevations` (no change) |
| `tests/unit/domain/services/test_geotech_packing_edges.py` | New unit tests for `same_class_pairs` |
| `tests/integration/api/test_subdivide_all_bodies.py` | Update SAB edge/borehole assertions |
| `desktop/src/renderer/src/utils/geotechSubdivide.ts` + `.test.ts` | **Delete** |
| `desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx` | Geotech axis → geotech layers + geotech edges as the partition source |
| `desktop/src/renderer/src/components/SectionPanel.tsx` | Drop carve props |
| `desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx` | Drop `geotechSubLayersByInv` / `geotechCptInvIds` / carve call |
| `desktop/src/renderer/src/utils/buildVoxelRequest.ts` + `sectionFenceData.ts` | Geotech-model voxel request path + NAD colour lookup |

---

## Task 1 — Backend: same-class auto-edge rule

**Why:** the current rule (`aligned_same_sequence_pairs`) only connects two tests when their *entire* NAD sequence is identical → on real data 79% of bodies were singletons. The new rule connects same-(non-null)-class bands within each litho-correlated unit. **Owner decision: a recurring class within one litho unit becomes ONE body** (connect every same-class pair; the resolver's connected-components unions them transitively; the engineer splits manually later). No depth-overlap gate — the one-body decision makes it redundant.

**Files:**
- Modify: `src/groundmodel/domain/services/geotech_packing_edges.py`
- Modify: `src/groundmodel/application/subdivide_all_bodies.py` (`_derive_geotech_edges_from_litho`, ~line 1015; and its import at line 127)
- Test: `tests/unit/domain/services/test_geotech_packing_edges.py` (new)

- [ ] **Step 1 — Write the failing unit test** for the new pure helper.

Create `tests/unit/domain/services/test_geotech_packing_edges.py`:

```python
"""Unit tests for same_class_pairs — the geotech same-class auto-edge helper."""

from groundmodel.domain.services.geotech_packing_edges import same_class_pairs


def test_same_class_pairs_connects_matching_classes_across_an_interbed():
    # S6 sand unit: [matig(6), dicht(7)].  S13 same unit: [matig(6), matig(6), dicht(7)].
    # Old full-sequence rule emitted 0 (counts differ). New rule ties every
    # same-class pair: matig→both matig, dicht→dicht.
    left = [("l_m", 6), ("l_d", 7)]
    right = [("r_m1", 6), ("r_m2", 6), ("r_d", 7)]
    pairs = set(same_class_pairs(left, right))
    assert pairs == {("l_m", "r_m1"), ("l_m", "r_m2"), ("l_d", "r_d")}


def test_same_class_pairs_skips_null_class():
    # A null nad_class (skeleton band) cannot auto-connect.
    left = [("l_a", None), ("l_b", 6)]
    right = [("r_a", None), ("r_b", 6)]
    assert set(same_class_pairs(left, right)) == {("l_b", "r_b")}


def test_same_class_pairs_never_crosses_class():
    # loose(5) must never tie to dense(7) — the SAB-7 guard.
    left = [("l", 5)]
    right = [("r", 7)]
    assert same_class_pairs(left, right) == []


def test_same_class_pairs_empty_when_either_side_empty():
    assert same_class_pairs([], [("r", 6)]) == []
    assert same_class_pairs([("l", 6)], []) == []
```

- [ ] **Step 2 — Run it, verify it fails** (helper not defined yet).

Run: `uv run pytest tests/unit/domain/services/test_geotech_packing_edges.py -q`
Expected: FAIL — `ImportError: cannot import name 'same_class_pairs'`.

- [ ] **Step 3 — Replace the helper.** In `geotech_packing_edges.py`, replace the whole `aligned_same_sequence_pairs` function (and update the module docstring) with:

```python
def same_class_pairs(
    left: list[tuple[str, int | None]],
    right: list[tuple[str, int | None]],
) -> list[tuple[str, str]]:
    """Return (left_layer_id, right_layer_id) pairs for every same-NAD-class band.

    Spec §5 (2026-06-26): within ONE correlated litho unit, connect each packing
    band on the left test to EVERY band on the right test that shares its
    (non-null) NAD class — regardless of count or order. The resolver's
    connected-components then unions a recurring class within the unit into ONE
    body (owner decision; the engineer splits manually). A ``None`` class
    (skeleton band) never auto-connects.

    Parameters
    ----------
    left, right : list[tuple[str, int | None]]
        Each test's packing sub-band stack as ``(layer_id, nad_class)`` for ONE
        litho unit on that test (order irrelevant).

    Returns
    -------
    list[tuple[str, str]]
        One pair per same-class (left, right) combination; ``[]`` when either
        side is empty.
    """
    out: list[tuple[str, str]] = []
    for la, ca in left:
        if ca is None:
            continue
        for rb, cb in right:
            if cb == ca:
                out.append((la, rb))
    return out
```

- [ ] **Step 4 — Run the unit test, verify PASS.**

Run: `uv run pytest tests/unit/domain/services/test_geotech_packing_edges.py -q`
Expected: 4 passed.

- [ ] **Step 5 — Rewire `_derive_geotech_edges_from_litho`** in `subdivide_all_bodies.py`. Change the import at line 127 from `aligned_same_sequence_pairs` to `same_class_pairs`. Then in the method (the loop at ~line 1101), replace the `aligned = aligned_same_sequence_pairs(...)` block + the `skipped_seq_mismatch` handling with:

```python
            # Spec §5: same-class connection (NOT full-sequence). Every same-class
            # pair becomes an edge; the resolver unions recurring classes into one
            # body. None-class bands are skipped inside same_class_pairs.
            aligned = same_class_pairs(left_stack, right_stack)
            if not aligned:
                if left_stack and right_stack:
                    skipped_no_class_match += 1
                continue
            nad_by_layer = dict(left_stack) | dict(right_stack)
```

Rename the counter `skipped_seq_mismatch` → `skipped_no_class_match` (declaration ~line 1081 and the final log line ~line 1153). Update the method docstring (lines 1024-1043) to describe the same-class rule. Keep the §8 null-skip loop (lines 1113-1145) **as-is** — it already dedups canonical pairs and skips null classes, which is still correct.

- [ ] **Step 6 — Run the SAB integration suite** (it pins the edge behaviour).

Run: `.\scripts\run-integration-tests.ps1 tests/integration/api/test_subdivide_all_bodies.py`
Expected: existing SAB-7 (no cross-class edge) still passes (the same-class filter satisfies it). **SAB tests asserting a sequence-mismatch produced 0 edges will now produce edges** — update those assertions to the same-class outcome (read each failing case; the new rule emits same-class edges where the old emitted none). SAB-10b's `geotech/litho ≥ 0.5` ratio still holds (likely higher now). Fix the fixture expected counts to the new (higher) edge counts; do NOT weaken SAB-7.

- [ ] **Step 7 — Commit** (one file per commit, Conventional Commits).

```bash
git add src/groundmodel/domain/services/geotech_packing_edges.py
git commit -m "feat(geotech): same-class auto-edge rule (replaces full-sequence match)"
git add tests/unit/domain/services/test_geotech_packing_edges.py
git commit -m "test(geotech): same_class_pairs unit cases"
git add src/groundmodel/application/subdivide_all_bodies.py
git commit -m "feat(geotech): derive geotech edges by same-class within litho units"
git add tests/integration/api/test_subdivide_all_bodies.py
git commit -m "test(geotech): update SAB edge assertions for the same-class rule"
```

---

## Task 2 — Backend: build-time borehole division (Phase 8c)

**Why (spec §6):** boreholes have no qc. Today they get a nearest-CPT class extrapolation (Phase 8b) that produces slivers in 2D. Replace it: after the CPT bodies + `body_id`s are resolved, materialise borehole geotech `litho_layer` rows by TIN-interpolating each body's packing-transition surface (from the CPTs) onto the borehole XY, clipped to the borehole's litho frame. This gives **persisted geometry** that lab containment + the 2D/3D render read.

**Files:**
- Modify: `src/groundmodel/application/subdivide_all_bodies.py` (remove `_extrapolate_borehole_sub_bodies` Phase 8b; add `_divide_boreholes_by_bodies` Phase 8c)
- Reuse: `src/groundmodel/domain/services/geotech_split_surface.py::interpolate_split_elevations(cpt_points: list[ColumnXY], cpt_elevations: list[float], all_columns: list[ColumnXY]) -> dict[inv_id, elev]`
- Test: `tests/integration/api/test_subdivide_all_bodies.py`

- [ ] **Step 1 — Read the current borehole path.** Read `_extrapolate_borehole_sub_bodies` (~line 885-1009), `_PendingBoreholeSubBody` (~line 257), and how Phase 8b is called (~line 640). Read `geotech_split_surface.py` in full (it's small — `ColumnXY` at line 28, the TIN with flat-mean fallback for <3 CPTs).

- [ ] **Step 2 — Write the failing integration test** (a 2-CPT + 1-borehole scene). Add to `test_subdivide_all_bodies.py` a case "SAB-BH1": two CPTs whose sand unit splits matig-over-dicht at different depths, a borehole between them with only a litho sand log (no qc). After `SubdivideAllBodies.execute`, assert the borehole has **two** geotech layers (matig, dicht) whose split elevation is the TIN/mean interpolation of the two CPTs' matig/dicht boundary, each carrying a non-null `body_id` equal to the corresponding CPT body. (Write the explicit asserts against the seeded fixture depths.)

Run: `.\scripts\run-integration-tests.ps1 tests/integration/api/test_subdivide_all_bodies.py -k SAB_BH1`
Expected: FAIL (today's extrapolation makes one band, not two).

- [ ] **Step 3 — Implement Phase 8c.** Remove the `_extrapolate_borehole_sub_bodies` call (Phase 8b) and the `_PendingBoreholeSubBody` skeleton-band materialisation for boreholes (boreholes contribute nothing in Pass 1). Add `_divide_boreholes_by_bodies` that runs **after** `ResolveLithoInstances` has stamped `body_id`s:
  - Group CPT geotech layers by `body_id`. For each body, build its packing-transition surfaces: the body's top/base boundary elevation at each CPT (`surface_elev - depth`), as `ColumnXY` control points + elevations.
  - For each borehole, for each litho unit it logs, find the bodies whose CPT extent overlaps that litho unit, call `interpolate_split_elevations` to get the body-boundary elevation at the borehole XY, convert to depth, **clamp to the borehole's litho-unit extent** (`group_segs` gives it), and INSERT one geotech `litho_layer` per resulting band with the body's `formation_id` + `body_id`.
  - Respect the no-overlap + contiguity constraint (clamp + snap adjacent bands, mirroring the CPT path).
  - **Do NOT also write the split FormationContacts directly** (the LL→FC mirror trigger handles that — see the SAB §"two structural traps" note in CLAUDE.md).

- [ ] **Step 4 — Run SAB-BH1, verify PASS**, then the whole SAB suite.

Run: `.\scripts\run-integration-tests.ps1 tests/integration/api/test_subdivide_all_bodies.py`
Expected: SAB-BH1 + all prior SAB pass. Update any test that asserted the old `extrapolated_borehole_count` (that field is gone or 0 now — adjust `SubdivideAllBodiesResult`).

- [ ] **Step 5 — Commit.**

```bash
git add src/groundmodel/application/subdivide_all_bodies.py
git commit -m "feat(geotech): divide boreholes by body geometry at build time (Phase 8c)"
git add tests/integration/api/test_subdivide_all_bodies.py
git commit -m "test(geotech): borehole geometric division integration case"
```

---

## ✅ GATE G1 — Real-data connectivity (go/no-go for the frontend)

**Do not start Task 3 until this passes.** This is the make-or-break: the engine has no "same-body, no-edge" fallback, so the same-class rule must actually connect.

- [ ] **Step 1 — Re-materialise the dev DB** geotech model (dev DB is `groundmodel` on docker `strix-db-1` :5433). Run the geotech subdivide eval:

Run: `uv run python scripts/eval_geotech_subdivision.py`  (regenerates the geotech model with the new rules)

- [ ] **Step 2 — Measure connectivity on the real section** `GEO-10/170-S6 → GEO-10/171-B6 → 1411-GEO-23/126-B4 → GEO-23/125-S13`. Query the geotech model's `body_count` and edge count from the DB (the `SubdivideAllBodiesResult` log line + a `litho_layer` body_id distinct count for those 4 investigations).

**Acceptance:**
- Connected bodies for that section **< 30** (vs today's 459 render fragments / 187 model-wide singletons). Model-wide `body_count` falls sharply.
- If it does **not** clear the bar → STOP. The litho correlations on that section are too sparse; the fix is more litho correlation or a connectivity refinement, NOT proceeding to the frontend. Report back to the owner.

---

## Task 3 — Frontend: render the connected-body partition (retire the carve)

**Why (spec §7/§9):** the 2D geotech render becomes `computeSectionFill(geotechLayers, geotechEdges)` — the body partition, clean *because the bodies now connect*. The per-CPT carve is deleted. This is an **axis-conditional data-source switch**, per agent review, not just a deletion.

**Files:**
- Delete: `desktop/src/renderer/src/utils/geotechSubdivide.ts` + `geotechSubdivide.test.ts`
- Modify: `SectionsCanvas.tsx`, `SectionPanel.tsx`, `PartitionFillOverlay.tsx`

- [ ] **Step 1 — Read the current wiring.** In `SectionsCanvas.tsx` read lines ~282-350 (the `activeSectionModelId = lithoModelId` hardcode + the `geotechSubLayersByInv` / `geotechCptInvIds` memos), and where `geotechPackingEdges` is fetched (~lines 480-575). In `PartitionFillOverlay.tsx` read the `computeSectionFill` call (~line 907) + the `subdivideRegionsByGeotech` call (~line 935) + the geotech props (~lines 159-171, 557-565).

- [ ] **Step 2 — Switch the geotech axis data source** in `SectionsCanvas.tsx`. When `isGeotech`: set the partition source to the **geotech** layers + **geotech** edges + NAD colour/label maps (instead of litho layers + a subdivider). Concretely: `activeSectionModelId = activeGeotechModel.id`, `sectionLayers = geotechLayers`, `correlationModelId = activeGeotechModel.id`, and feed `geotechPackingEdges` as the partition `contactEdges`. Remove the `geotechSubLayersByInv` + `geotechCptInvIds` memos. (The litho-frame invariant holds because the geotech layers are already litho-bounded by the build.)

- [ ] **Step 3 — Remove the carve from `PartitionFillOverlay.tsx`.** Delete the `subdivideRegionsByGeotech` import + call; the overlay's existing `computeSectionFill(orderedColumns, edges, …)` now renders the geotech layers + geotech edges it receives. Remove the `geotechSubLayersByInv` / `geotechCptInvIds` / `geotechEdges` carve props and the solid-overlay opacity special-case (the partition's normal lens opacity is fine — bodies connect now, so lenses are rare and real). Decide: keep `dominantNad` only if you still need a no-edge fallback colourer — otherwise delete with the file.

- [ ] **Step 4 — Remove the carve props from `SectionPanel.tsx`** (the `geotechCptInvIds` / `geotechSubLayersByInv` / `geotechEdges` pass-through).

- [ ] **Step 5 — Delete `geotechSubdivide.ts` + `geotechSubdivide.test.ts`.**

```bash
git rm desktop/src/renderer/src/utils/geotechSubdivide.ts desktop/src/renderer/src/utils/geotechSubdivide.test.ts
```

- [ ] **Step 6 — tsc + vitest + geometry-check.**

```
cd desktop && npx tsc --noEmit -p tsconfig.web.json
npx vitest run
```
Run `py .claude/skills/strix-section-geometry-check/check_section_geometry.py desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx` — expect exit 0.
Expected: tsc clean; suite green (fewer tests after the deletion).

- [ ] **Step 7 — Commit** (per file).

```bash
git add desktop/src/renderer/src/shell/stages/sections/SectionsCanvas.tsx
git commit -m "feat(geotech): render the connected-body partition on the geotech axis"
git add desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx
git commit -m "refactor(geotech): drop the per-CPT carve from PartitionFillOverlay"
git add desktop/src/renderer/src/components/SectionPanel.tsx
git commit -m "refactor(geotech): drop carve props from SectionPanel"
git add -A && git commit -m "chore(geotech): delete the retired subdivideRegionsByGeotech carve"
```

---

## Task 4 — Frontend: wire the 3D voxel build to the geotech model

**Why (spec §7):** the geotech body is a true 3D entity. The litho voxel builder parameterises on `model_id`; it needs a geotech-flavoured per-section request (geotech layers + geotech edges) + NAD colour lookup.

**Files:**
- Modify: `desktop/src/renderer/src/utils/buildVoxelRequest.ts` (+ `assembleLithoSectionInputs.ts` or a parallel assembler)
- Modify: `desktop/src/renderer/src/utils/sectionFenceData.ts` (NAD colour lookup)
- Backend: `src/groundmodel/application/build_voxel_litho_model.py::BuildVoxelLithoModel.execute(model_id, …)` already takes the geotech `model_id` — no change.

- [ ] **Step 1 — Read** `buildVoxelRequest.ts` + `assembleLithoSectionInputs.ts` to see how litho layers + litho edges are assembled per section for `computeSectionFill`.
- [ ] **Step 2 — Add a geotech path:** assemble geotech layers + geotech edges per section (the `PartitionUnit.layerId`s are geotech `litho_layer.id`s, so the LCS match must use geotech edges). Pass `activeGeotechModel.id` to the build endpoint.
- [ ] **Step 3 — NAD colour:** ensure `sectionFenceData.ts`'s formation-colour lookup resolves NAD formation names (reuse `nadClasses.ts::nadClassColor`).
- [ ] **Step 4 — tsc + vitest.** `cd desktop && npx tsc --noEmit -p tsconfig.web.json && npx vitest run` — green.
- [ ] **Step 5 — Commit** per file (`feat(geotech): assemble geotech voxel request`, `feat(geotech): NAD colours in the 3D fence`).

---

## ✅ GATE G2 — Final real-data acceptance (owner dogfeed)

- [ ] Re-seed/rebuild the dev DB geotech model. On the real `S6→B6→B4→S13` section: the 2D render shows **few clean connected bodies, 0 sub-resolution slivers** (re-run the region/sliver diagnostic — compare to the 459/130 baseline). Boreholes carry interpolated packing bands. Build the 3D model → bodies are watertight, coloured by NAD.
- [ ] Owner dogfeed: merge/drop/correlate gestures work on the geotech bodies (litho gestures on the geotech model). A lab-sample depth in a borehole resolves to the geologically correct body.
- [ ] Update `memory/project_geotech_stage_body_centric.md` + remove the retired-carve notes from CLAUDE.local.md.

---

## Out of scope (do NOT build here)

- The analytics grouping itself (`parameter_group`, lab/CPT-by-body queries) — **Slice 3**, waits for lab-test import.
- Auto-smoothing of packing oscillation — explicitly rejected; cleanup is the manual merge/drop.
- Cross-litho-body packing connections.

---

## Notes for the implementer

- Dev DB: `groundmodel` on docker `strix-db-1`, host port **:5433**. Integration tests use the wrapper `scripts\run-integration-tests.ps1` (never bare `pytest tests/integration` — it wipes the dev DB). Re-seed the e2e fixture after integration runs.
- Commit one file per commit, Conventional Commits, **do not push** (owner pushes).
- The CLAUDE.md "two structural traps" still apply: the LL→FC mirror trigger means you write geotech *layers* as source-of-truth, never the split contacts directly; geotech layers must satisfy per-(model,anchor) no-overlap + contiguity.
- `interpolate_split_elevations` needs ≥3 non-collinear CPTs for a TIN, else flat-mean fallback — fine for 1D sections.
