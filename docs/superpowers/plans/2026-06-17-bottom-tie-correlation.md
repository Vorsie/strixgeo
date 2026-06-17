# Truthful 3D Litho Fill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the litho fill truthful — a unit observed at one test continues SIDEWAYS (flat, at its observed elevation) under a shallower neighbour that never reached it, instead of climbing up to fill that test; with explicit correlation ties (top↔top, base↔base, and top↔base mixed) as the override. The 2-D `computeSectionFill` is the fix site; the 3-D voxel model inherits it.

**Architecture:** The climb lives in the 2-D partition (`partitionFill.ts`), not the 3-D voxel labeller (measured: the labeller faithfully reproduces the 2-D partition). So all fill changes are in `partitionFill.ts` + the body grouping it reads + the section-editor gesture; the voxel builder is untouched and inherits the corrected partition on the next Build.

**Tech Stack:** React/TypeScript + Vitest (`partitionFill.ts`, section overlays), Python + pytest (body grouping / resolver if the split is backend-side), the dev DB + voxel eval scripts for real-data validation.

**Spec:** `docs/superpowers/specs/2026-06-17-bottom-tie-correlation-design.md` — read it first.

**Already built (do NOT redo — committed `8726b356`…`ae88b497`):** the per-endpoint `contact_a_side`/`contact_b_side` schema + migration (both DBs), the correlate/uncorrelate/list use case + router + bundle round-trip threading the sides, the desktop `LithoContactCorrelationEdge` type, and the overlay edge→`CorrelationEdge` `aSide`/`bSide` wiring. **The earlier `classifyTermination` base↔base honouring (`d78414ab`) is a STARTING POINT that this plan GENERALISES (Task 3) — it currently handles only `base↔base` and must cover all sides + the sideways default.**

---

## ⏱ Overnight run status (2026-06-18) — partition CORE done + real-data-validated; UI + 2 owner decisions remain

**DONE + reviewed (two-stage) + committed (unpushed):**
- **Task 1** body-split (`collapseAdjacentSameFormation` body_id gate) — `1604f09b`. *Review note:* a second merge site (`reduceColumn:550`) could also re-fuse, but real-data check proved it does NOT bite at S6 (the intervening SILT/KLEI are correlated → not pulled).
- **Task 2** sideways default (uncorrelated deep unit continues flat, no climb) — `a6c5edaf` + `de81e054` (fixed 2 review-found logic bugs: runAbove poison [defensive] + isLens false-trigger [real]).
- **Task 3** any-side ties (top↔top / base↔base / top↔base mixed) — `fb5ca0c3` + `ef64557d` + `9721162e` + `8513585a` + `15d47e16`. *Key fix:* the mixed-tie override was gated on `sideways`, so it was IGNORED for genuine-pinch units (reaching neighbour) — real-data proved the reviewer's "no impact" assumption wrong; widened so a tie always overrides (band > mixed-tie > sideways > pinch), + section-wide `layerBaseElevLookup` for non-adjacent ties.
- **Task 4** Python port (`section_partition.py`) — NOT mirrored (no production importer; documented divergence) — `bc117b7b`.
- **Task 5** confidence exclusion — verified NO-OP (confidence consumes only distance-to-investigation + TIN-triangle length; a tie is neither). No commit.

**REAL-DATA VALIDATION (CS1, dev model `019e934c…`, partition-level, autonomous):** the climb is KILLED — B2→S7a's +4.25→+10.42 band and S6→S5a's −5.87→+9.61 ramp are gone; an inserted mixed tie makes the sand reach S7a's TD (+10.42). Re-run with `scripts/throwaway_cs1_partition_extract.py` (untracked).

**⚠ TWO OWNER DECISIONS before finishing:**
1. **Un-tied geometry (geological judgment).** When a reaching uncorrelated neighbour exists *past* the shallow test, the un-tied deep sand is now a rising PINCH toward that neighbour (top rises +4.2→~+10.2 then tapers), NOT the flat-sideways you picked in the mockup (that applies only when NO neighbour reaches). The mixed tie lets you control it explicitly. Confirm the rising-pinch default is acceptable, or whether un-tied should stay flatter.
2. **Gesture interaction model (UX).** The existing correlate gesture (`useCorrelate.ts`) arms a whole formation BAND by click — it has no top-vs-base-vs-column-bottom handle concept. Task 6 needs that distinction; band-click vs discrete grab-handles is a UX-design choice to make WITH you (per `mirror-peer-feature-ux`), not a silent default. Held for your input.

**REMAINING:** Task 6 (gesture — held for the UX decision above), Task 7 (render ties dashed — depends on 6), Task 8 voxel rebuild + 3D-slice eyeball (needs the app/you). The partition that the 3D model inherits is fixed + validated; once you can draw ties, a re-Build makes the 3D model truthful.

---

**Standing rules:** commit per file/task (Conventional Commits); do NOT `git push`; desktop checks from `desktop/` (`npx tsc --noEmit -p tsconfig.web.json`, `npx vitest run`); backend `uv run pytest tests/unit -q` + integration via `.\scripts\run-integration-tests.ps1` (never the dev DB directly); every `react-hooks/exhaustive-deps` disable carries a `// reason:`; numpy docstrings on public Python, JSDoc on public TS; English only.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `desktop/src/renderer/src/utils/partitionFill.ts` | sideways-default for an uncorrelated unit facing a shallower un-reaching neighbour; honour all tie sides (top/base/mixed) | Modify |
| `desktop/src/renderer/src/utils/partitionFill.test.ts` | sideways-default + per-side tie cases (behaviour-shaped via `coverAt`) | Modify |
| the body-grouping site (resolver / `body_id` assignment that the partition reads — `src/groundmodel/application/resolve_litho_instances_use_case.py` or the layer→body mapping; LOCATE in Task 1) | split non-adjacent same-lithology occurrences into distinct bodies | Modify |
| `desktop/src/renderer/src/components/sections/` (ContactsLayer / correlate handler) | expose top + base + column-bottom grab handles; create an edge with the correct per-endpoint sides | Modify |
| `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx` | render base/mixed ties dashed/interpretive | Modify |
| `desktop/src/renderer/src/utils/distanceConfidence.ts` / `tinConfidence.ts` (+ the confidence input builder) | exclude base-side tie contacts | Modify |

---

## PHASE 1 — Body-split: non-adjacent same-lithology occurrences are distinct bodies

### Task 1: Split a shallow sliver from a deep body of the same lithology

**Files:**
- Locate + Modify: the body-id grouping the partition reads. Start at `src/groundmodel/application/resolve_litho_instances_use_case.py` (the resolver that assigns `body_id` from connected-components of correlation edges). Confirm whether two same-lithology layers at ONE investigation separated by a different lithology can land in the same `body_id` (they should NOT). If the merge is instead frontend-side (the partition's `collapseAdjacentSameFormation` or the `bodyId` passed in), locate there.
- Test: the matching unit/integration test for that module.

- [ ] **Step 1: Reproduce the merge.** Write a failing test with an S6-shaped single column: layers `[ZAND 0–0.8 (sliver), KLEI 0.8–6, ZAND 6–12 (deep), KLEI 12–19]`. Assert the two ZAND layers receive **different** `body_id`s (they are not adjacent — KLEI separates them — so they are distinct bodies). Run → expect FAIL if they currently merge (or PASS-and-skip if already distinct — then record "no split needed" and STOP Phase 1).

```python
# pseudo — adapt to the located module's API
def test_non_adjacent_same_litho_layers_are_distinct_bodies():
    layers = [zand(0,0.8), klei(0.8,6), zand(6,12), klei(12,19)]  # one investigation
    result = assign_bodies(layers, edges=[])  # no correlations
    zand_bodies = {l.body_id for l in result if l.formation==ZAND}
    assert len(zand_bodies) == 2  # sliver and deep body are NOT one body
```

- [ ] **Step 2: Run → confirm RED** (the two ZAND share a body) OR confirm already-correct and skip the phase.
- [ ] **Step 3: Implement the split.** In the located grouping: a `body_id` is shared only across CORRELATED layers (or genuinely-adjacent same-lithology within a column). Two same-lithology layers in one column separated by another lithology, with no correlation linking them, must stay separate components. (If the resolver already keys bodies by correlation connected-components, the bug is an over-merge to investigate; fix it minimally — do not touch adjacent-merge or other resolver duties.)
- [ ] **Step 4: Run → GREEN.** Full unit suite for the module green.
- [ ] **Step 5: Commit** — `git commit -m "fix(litho): split non-adjacent same-lithology layers into distinct bodies"`.

> **Carry-forward (review finding 2026-06-17, Task 1 `1604f09b`):** The Task 1 fix gated `collapseAdjacentSameFormation` on `body_id` — correct and safe. BUT a SECOND merge site, `reduceColumn` (~lines 550-552), merges the same-formation units flanking a pulled lens **unconditionally on body_id**. On the real S6 stack `[ZAND-sliver, KLEI, ZAND-deep, KLEI]`, if the intervening KLEI is pulled as a lens, `reduceColumn` re-fuses the two distinct-body ZANDs **before** `collapse` runs — re-creating the merge §9 wants to prevent. `reduceColumn:550` CANNOT simply take the same `body_id` gate: the legitimate enclosed-lens-split-matrix case there ALSO has different body_ids (tests MX2/PF7/PF-REAL-S1 rely on it), so the fix needs a rule that distinguishes a genuine thin enclosed-lens split (merge) from distinct same-lithology occurrences separated by a substantial unit (don't merge). **Task 3's real-data rebuild (Task 8 Step 3) MUST confirm the S6 deep-sand-top survives end-to-end; if it doesn't, a focused `reduceColumn:550` fix with that distinguishing rule is required before the S6 mixed tie works.**

---

## PHASE 2 — Partition: sideways default (the core climb fix)

### Task 2: A deep unit facing a shallower un-reaching neighbour continues flat (no climb)

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts`
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

- [ ] **Step 1: Write the failing test** (behaviour-shaped, via `col(...)` + `computeSectionFill` + the file-local `coverAt(regions, gapIndex, fraction, elevation)`). Model B2→S7a: a DEEP left column with sand low, and a SHALLOW right column that bottoms out ABOVE the sand and never observed it.

```ts
// SW-1: deep sand stays flat under a shallow neighbour; its top is NOT dragged up to the neighbour's TD.
it('an uncorrelated deep unit continues sideways under a shallower neighbour (no climb)', () => {
  const deep = col('B2', 13.0, [
    { top: 0, base: 8.8, f: 'CLAY', b: 'c1' },
    { top: 8.8, base: 17.5, f: 'SAND', b: 'sandDeep' }, // top elev +4.2, base -4.5
  ])
  const shallow = col('S7a', 13.0, [
    { top: 0, base: 2.65, f: 'CLAY', b: 'c2' },          // TD elev +10.4 — never reached the sand
  ])
  const regions = computeSectionFill([deep, shallow], /* no edges */ [])
  // mid-gap at the sand's OWN deep elevation (~ -1) must be SAND (it continues flat)...
  expect(coverAt(regions, 0, 0.5, -1)).toEqual(['SAND'])
  // ...and at the shallow neighbour's TD elevation (+9) the sand must NOT appear (it did not climb there).
  expect(coverAt(regions, 0, 0.9, 9)).not.toContain('SAND')
})
```

- [ ] **Step 2: Run → RED** (`cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts -t "sideways"`). Today the sand's top is dragged up toward the shallow TD, so `coverAt(...,0.9,9)` wrongly contains SAND. **Use the RED failure to LOCATE the up-drag**: instrument which path (the per-gap matching / interface interpolation in `emitGap`/`emitInterval`, or the `_blended`-style top interpolation) raises the deep unit's top toward the shallow neighbour. Document the exact function + lines in the commit body.
- [ ] **Step 3: Implement the sideways default.** Where the partition currently interpolates a deep unit's top toward a shallower neighbour that does NOT reach the unit's depth AND is uncorrelated to it, emit a **flat** continuation instead (the unit keeps its own top/base elevations extended under the neighbour; the neighbour's shallow stack sits above). The unreached test: the neighbour's deepest base elevation is ABOVE the unit's top elevation (the neighbour bottomed out before reaching the unit). Keep correlated and genuine-overlap cases unchanged.
- [ ] **Step 4: Run → GREEN** (SW-1) + the WHOLE file green (`npx vitest run src/renderer/src/utils/partitionFill.test.ts`) — existing correct gaps stay byte-identical (regression).
- [ ] **Step 5: tsc + commit** — `npx tsc --noEmit -p tsconfig.web.json`; `git commit -m "fix(section-fill): uncorrelated deep unit continues sideways under a shallow neighbour"`.

---

## PHASE 3 — Partition: ties drive continuation on any side

### Task 3: Generalise tie handling to top↔top, base↔base, and top↔base (mixed)

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts` (`classifyTermination`, `pairScore`/`matchColumns`, the `computeSectionFill` edge split)
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

- [ ] **Step 1: Write failing tests** for the three tie kinds. Build edges EXPLICITLY with per-endpoint sides (`{ a, b, aSide, bSide }`); the `col` helper assigns `layerId = `${id}#${index}``.

```ts
// T-BASE: a base↔base tie continues the unit's base across (bottom-tie).
it('base↔base tie continues the deepest unit base', () => { /* deep both sides, tie base#last↔base#last → band */ })
// T-MIXED: deep-unit-TOP ↔ shallow-test-BOTTOM raises the unit top to the tied test's TD and continues below.
it('top↔base mixed tie raises the unit top to the tied test TD', () => {
  // deep sand top +4.2 (B2#1) tied to shallow S7a column-bottom (S7a#last, side base)
  // assert the sand top at the shallow column reaches ~ the shallow TD elevation, not flat
})
// T-TOP: top↔top unchanged (regression).
it('top↔top tie still bands the top surface', () => { /* existing behaviour */ })
```

- [ ] **Step 2: Run → RED** for T-BASE/T-MIXED (the current code, post-Task-2, defaults sideways and only the old `base↔base` path exists).
- [ ] **Step 3: Implement.** In `computeSectionFill`, split edges by side into predicates the partition consumes: a contact (a unit's `layerId` + a side) is "correlated toward the neighbour" when an edge names that `layerId` with that side. `classifyTermination` / the continuation logic counts the unit's top-correlation (a `top`-side edge on its own layer) and base-correlation (a `base`-side edge on its own layer, incl. the deepest unit's column-bottom). A mixed tie correlates the named side on each end independently. The tie OVERRIDES the sideways default — when tied, continue per the tie (band / reach-to-TD) regardless of elevation gap. Generalise (do not just keep) the earlier `base↔base`-only handling.
- [ ] **Step 4: Run → GREEN** (all three) + the WHOLE file green (sideways default from Task 2 still holds when untied; existing gaps byte-identical).
- [ ] **Step 5: tsc + commit** — `git commit -m "feat(section-fill): ties drive continuation on any side (top/base/mixed)"`.

### Task 4: Mirror in the backend `section_partition` Python port (only if it touches golden paths)

- [ ] **Step 1: Check parity.** `uv run pytest tests/unit -q -k section_partition` (or the golden parity test). If green + goldens byte-identical, SKIP — record "no port change needed". If RED, the port must mirror the sideways-default + side-aware continuation identically; regenerate goldens deliberately (document the intended change) and keep TS↔Python parity.
- [ ] **Step 2: Commit** (if changed) — `git commit -m "feat(section-partition): mirror sideways-default + side-aware ties in the Python port"`.

---

## PHASE 4 — Confidence excludes interpretive ties

### Task 5: base-side / mixed tie contacts don't reduce the confidence fade

**Files:**
- Modify: the confidence-input builder feeding `distanceConfidence.ts` / `tinConfidence.ts`
- Test: the confidence util test

- [ ] **Step 1: Write the failing test** — adding a base-side tie contact does not change the confidence/distance result:

```ts
it('base-side tie contacts are excluded from the confidence distance calc', () => {
  expect(distanceConfidenceInputs([...observedOnly, baseTieContact]))
    .toEqual(distanceConfidenceInputs(observedOnly))
})
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — filter contacts/edges whose participating side is `base` (interpretive) out of the confidence inputs before the distance calc; leave observed `top` contacts untouched.
- [ ] **Step 4: Run → PASS.** **Step 5: tsc + commit** — `git commit -m "fix(confidence): exclude interpretive base-side tie contacts from the fade calc"`.

---

## PHASE 5 — Gesture: top / base / column-bottom handles + any-side tie

### Task 6: Expose top, base, and column-bottom grab handles; create the correctly-sided edge

**Files:**
- Modify: the section-editor contact-handle source + correlate handler under `desktop/src/renderer/src/components/sections/` (ContactsLayer / the correlate gesture).
- Test: a Vitest for the handle set / correlate payload.

- [ ] **Step 1: Write the failing test** — each unit yields top + base handles, each column yields a bottom (TD) handle, and a drag between two handles posts an edge with the matching per-endpoint sides:

```tsx
it('correlating a unit top to a column-bottom posts a top↔base mixed edge', async () => {
  // grab the deep unit's TOP handle on col A, drop on col B's column-BOTTOM handle
  // assert the correlate call carried contact_a_side==='top' && contact_b_side==='base'
})
it('correlating two column-bottoms posts a base↔base edge', async () => { /* base↔base */ })
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — surface a base handle on every unit and a column-bottom (TD) handle on each column (the deepest base, otherwise not addressable). The correlate gesture stamps each endpoint's side from which handle it grabbed (`top` for a unit-top handle, `base` for a unit-base or column-bottom handle). Reuse the existing correlate call (it already accepts the optional side params). Top↔top behaviour unchanged.
- [ ] **Step 4: Run → PASS.** **Step 5: tsc + commit** — `git commit -m "feat(sections): top/base/column-bottom grab handles + any-side tie gesture"`.

---

## PHASE 6 — Render interpretive ties

### Task 7: Render base/mixed ties dashed / interpretive

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/CorrelationEdgesOverlay.tsx`
- Test: the overlay test

- [ ] **Step 1: Write the failing test** — an edge with any `base` side renders dashed/interpretive; a pure top↔top edge stays solid:

```tsx
it('a base/mixed tie renders dashed/interpretive', () => {
  const { container } = renderOverlay({ edges: [mixedTie, topEdge] })
  expect(pathFor(container, mixedTie)).toHaveAttribute('stroke-dasharray')
  expect(pathFor(container, topEdge)).not.toHaveAttribute('stroke-dasharray')
})
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — branch the edge render on `aSide==='base' || bSide==='base'` → dashed + the interpretive colour (cyan `#4fc3f7`); base/column-bottom handle markers distinct from top handles. Keep spacing-aware X (`warpedXToScreen`) untouched (run `strix-section-geometry-check` if any along-section coordinate is touched).
- [ ] **Step 4: Run → PASS.** **Step 5: tsc + commit** — `git commit -m "feat(sections): render base/mixed ties dashed/interpretive"`.

---

## PHASE 7 — Integration + real-data rebuild-and-check

### Task 8: End-to-end + real-data validation (the load-bearing check — DO it, don't assert it)

- [ ] **Step 1: Full gates** — from `desktop/`: `npx tsc --noEmit -p tsconfig.web.json` + `npx vitest run` green. Backend: `uv run pytest tests/unit -q` + `.\scripts\run-integration-tests.ps1`.
- [ ] **Step 2: Real-data sideways check (no tie).** Reconstruct CS1 (dev model `019e934c…`); confirm via the partition (and a re-Build of the voxel model) that the deep sand **continues sideways** under S5a/S7a and **does not climb** (B2→S7a sand top no longer ramps to +10.42). Use the voxel eval scripts (`scripts/eval_voxel_label.py` against a refreshed `teststrix_partitions.json`, or sample `_stack_at` along CS1 as in the diagnosis) to confirm the slice is truthful.
- [ ] **Step 3: Real-data tie check.** Insert a mixed tie (deep-sand-top ↔ S7a column-bottom) and a base↔base tie; re-run the partition; confirm the sand reaches the tied TD / the base continues, as drawn. Confirm the S6 sliver/deep-body split (Task 1) makes the deep-sand-top tie-able in gap S6→S5a.
- [ ] **Step 4: No-regression.** CS2/CS3 spot-checked unchanged; auto-correlate ("suggest correlations") unaffected; `./scripts/run-e2e.ps1 flow_correlate` + section flows green (dev app closed).
- [ ] **Step 5: Owner dogfeed handoff** — note: draw the ties on CS1's deep sand, **re-Build** the model, and confirm the 3-D slice is truthful (the 2-D Fill bands reflect it immediately; the 3-D model needs the Build).

---

## Out of scope (do NOT implement here)

- Any change to the 3-D voxel labeller (`label_voxels.py`) — exonerated by measurement; it inherits the corrected partition.
- Any change to auto-correlate ("suggest correlations").
- Apex-cap / pinch geometry beyond the sideways default + tie-driven shapes.
- The Phase-5 automatic deepest-first geometric fill (`docs/debt.md` #221).

---

## Self-review notes (author check)

- **Spec coverage:** §5 rule 1 (sideways) → Task 2; rules 2-4 (mixed/base/top ties) → Task 3; §9 body-split → Task 1; §8 confidence → Task 5; §6 gesture → Task 6, render → Task 7; §10 voxel-inherits + §12 real-data → Task 8; §7 Python-port parity → Task 4.
- **Ordering:** body-split (1) precedes ties (3) since the S6 mixed tie needs distinct bodies; sideways default (2) is the standalone core fix and precedes ties (the tie overrides the default).
- **Honest unknowns flagged, not hidden:** Task 1 must LOCATE the grouping site (resolver vs frontend) and may no-op if already-correct; Task 2 uses the RED failure to locate the up-drag path; Task 4 is conditional on golden parity. These are TDD-driven discoveries, not vague TODOs — each has a concrete first test that forces the finding.
- **Carries forward:** schema/backend Tasks 1–4 (old plan) are committed; the base↔base partition code is generalised by Task 3, not duplicated.
