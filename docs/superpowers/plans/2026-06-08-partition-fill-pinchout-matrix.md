# Partition-fill pinch-outs + geometric matrix inference — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Between two tests, an uncorrelated minority lithology renders as a clean pinch-out (lens or onlap) and the surrounding matrix connects across as one band that floods all leftover space — replacing the "droopy" meeting-fraction seam — so the fill matches how a geologist draws the section.

**Architecture:** Pure-geometry change inside `utils/partitionFill.ts` (the source of truth for body shape; 3D ports it) plus its render overlay. Generalize the existing enclosed-lens extraction + interval emission from matching on `bodyId` to matching the **matrix by `formationId`** (the lithology proxy already on each unit), keep the `bodyId` LCS for explicit correlations, and add the onlap + midpoint-facies-seam cases. No resolver / `body_id` / DB changes.

**Tech Stack:** TypeScript + Vitest (Node 22). Pure module — no React/DB/IO in `partitionFill.ts`.

**Spec:** `docs/superpowers/specs/2026-06-08-partition-fill-pinchout-matrix-design.md`

**Key existing symbols (read before starting):** `PartitionUnit {topDepthM, baseDepthM, formationId, bodyId}`, `PartitionColumn {investigationId, surfaceElevM, units}`, `PartitionRegion {formationId, bodyId, kind:'quad'|'pinch'|'lens', polygon}`, `extractEnclosedLenses(units, otherIds, side)` (~242, keyed on `bodyId`), `lcsAlignment` (~316), `emitInterval(...)` (~683, `meetFraction = sumLeft/(sumLeft+sumRight)`), `computePartitionFill(...)` (~794), `assertTiles` (test helper — no gaps/overlaps). Vocabulary note: **"matrix lithology" = `formationId`** (in the real litho model one formation = one lithology, shared across tests; distinct formations correctly don't auto-connect).

---

## ⚠ IMPLEMENTATION FINDINGS — 2026-06-08 (partial; RESUME HERE in a fresh session)

**Branch:** `feat-partition-pinchout-matrix` (off `develop`). Working tree clean.

**Committed so far — MX1 (`6e46535b`):** `emitInterval` now connects a one-left + one-right **same-`formationId`** pinch pair into a single band quad (the clean uncorrelated-matrix case, no interspersed minorities). 16/16 partition tests green, **zero regressions** (incl. `PF-REAL-S1`, `LENS1`). Keep this — it is the correct **geometric-connectivity primitive** (step 2 below) for the trivial case.

**⚠ Two corrections to the tasks below — do NOT implement Task 2 as originally written:**

**(1) ORDER (owner, 2026-06-08): lenses/onlaps FIRST, then geometric connectivity.** The original directive is: pinch out the uncorrelated minority lithos first (→ lenses/onlaps by correlated-edge count: 0 = lens, 1 = onlap), THEN infer the matrix bodies by geometric connectivity (the leftover same-lithology background connects). Task 2's "generalize the pre-pass" framing inverts this / muddles it. Build step 1 (extract pinch-outs) THEN step 2 (MX1 already does the connect). After step-1 extraction the matrix is the single-unit-per-side case MX1 consumes.

**(2) The naive `extractEnclosedLenses` bodyId→formationId substitution is WRONG — proven, reverted.** It extracts the **matrix itself** as a "lens" whenever the matrix is bracketed by two same-`formationId` bands (MX1's sand sits between a KLEI band above + a KLEI band below → wrongly "enclosed by same formation" → extracted). 4 tests broke. The pre-pass runs *before* the LCS, so it cannot tell a **lens-in-matrix** (silt inside sand) from a **matrix-between-brackets** (sand between two clays).

**Correct mechanism = interval-scoped classification (reorder the algorithm):**
- Run the `bodyId` LCS first (matched/correlated bands — locked, unchanged). The existing `bodyId`-keyed pre-pass can STAY for the explicitly-correlated lens case.
- THEN, **per interval** (the span between two consecutive matched bands): classify each unmatched unit. A lithology (`formationId`) present on **one** side, enclosed by the interval's matrix, is a **lens/onlap** → pinch out (lens if enclosed by matrix above+below; onlap if it abuts one matched bracket — direction by which bracket). A lithology present (as the background) on **both** sides connects across as the **matrix band** (MX1's connect). Lens-vs-matrix is decidable here because the interval + the other side's units are known; it is NOT decidable in the pre-pass.
- "Non-overlapping same-litho → separate lenses" falls out (each is enclosed on its own side, not the shared matrix).
- **Tests that will flip `pinch`→`lens` (correct per the taxonomy — re-derive their lens apex geometry):** `LENS1`, `PF2`. `PF-REAL-S1` should stay green (its sand shares `bodyId` `dc5b80` → correlated path). A reverted fuller-case fixture (`MX2`: a silt lens inside an uncorrelated sand matrix bracketed by correlated clay) is the right next RED — re-add it.

Then Tasks 3 (onlap up/down), 4 (midpoint facies seam + `seamKind`), 5 (overlay wriggly), 6 (regression) proceed as written below.

---

### Task 1: Test fixtures — column-stack builders + the S2↔S1 case

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.test.ts` (add a fixtures block near the top; reuse existing `assertTiles` / column helpers if present — grep first)

- [ ] **Step 1: Add stack builders + the headline fixture**

Grep the test file for an existing `assertTiles` and any `makeColumn`/`col(` helper; reuse them. If none, add:

```typescript
import { computePartitionFill, type PartitionColumn, type PartitionUnit } from './partitionFill'

// u(top, base, formationId, bodyId) — one unit, depth-below-surface metres.
const u = (top: number, base: number, formationId: string, bodyId: string | null): PartitionUnit =>
  ({ topDepthM: top, baseDepthM: base, formationId, bodyId })

const col = (investigationId: string, units: PartitionUnit[]): PartitionColumn =>
  ({ investigationId, surfaceElevM: 0, units })

// The dogfeed S2↔S1 middle interval, distilled. Upper SAND band + bottom CLAY
// band are correlated (shared bodyId). The middle is uncorrelated: S2 has a
// silt then sand; S1 has clay/sand/silt/sand. Lithology = formationId.
const S2 = col('S2', [
  u(0, 5, 'SAND', 'sand-top'),   // upper sand band (correlated)
  u(5, 5.4, 'SILT', 's2-silt'),  // uncorrelated silt — should pinch (onlap to top of interval)
  u(5.4, 12, 'SAND', 's2-sand'), // uncorrelated sand — should become matrix
  u(12, 20, 'CLAY', 'clay-bot'), // bottom clay band (correlated)
])
const S1 = col('S1', [
  u(0, 5, 'SAND', 'sand-top'),   // correlated (same bodyId as S2)
  u(5, 6.5, 'CLAY', 's1-clay'),  // uncorrelated clay — should pinch (lens)
  u(6.5, 8, 'SAND', 's1-sand-a'),
  u(8, 8.6, 'SILT', 's1-silt'),  // uncorrelated silt — should pinch (lens)
  u(8.6, 12, 'SAND', 's1-sand-b'),
  u(12, 20, 'CLAY', 'clay-bot'), // correlated (same bodyId as S2)
])
```

- [ ] **Step 2: Commit the fixtures**

```bash
git add desktop/src/renderer/src/utils/partitionFill.test.ts
git commit -m "test(partition): S2-S1 middle-interval + stack-builder fixtures"
```

---

### Task 2: Matrix by lithology — generalize lens extraction + connect the matrix band

This is the core. After this task the S2↔S1 fixture renders one sand band with the silt/clay extracted as lenses, and `assertTiles` passes.

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts` — `extractEnclosedLenses` (~242), the id-set construction in `computePartitionFill` (~835), and the matrix-connect after LCS (~843+).
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('connects the matrix sand across an uncorrelated middle interval; silt/clay pinch', () => {
  const regions = computePartitionFill(S2, S1)
  // The matrix sand spans the interval as ONE body that reaches both columns.
  const sandQuads = regions.filter(r => r.formationId === 'SAND' && r.kind === 'quad')
  const spans = sandQuads.some(r => {
    const fr = r.polygon.map(p => p.fraction)
    return Math.min(...fr) < 0.01 && Math.max(...fr) > 0.99
  })
  expect(spans).toBe(true) // a sand quad reaches fraction 0 → 1 across the gap
  // The uncorrelated silt + clay are pinch-outs (lens or pinch), not full quads.
  expect(regions.some(r => r.formationId === 'SILT' && r.kind !== 'quad')).toBe(true)
  expect(regions.some(r => r.formationId === 'CLAY' && r.kind === 'lens')).toBe(true)
  // No droop seam: there is no SAND 'pinch' meeting-fraction sliver in the middle.
  // (the middle sand is a connected quad, not tiled pinches)
})

it('still tiles exactly (no gaps/overlaps) — partition invariant holds', () => {
  assertTiles(computePartitionFill(S2, S1)) // existing helper; excludes kind:'lens'
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts -t "connects the matrix"`
Expected: FAIL — today the middle interval tiles as `pinch` slivers at the meeting fraction; no spanning sand quad; clay/silt are pinches not lenses.

- [ ] **Step 3: Generalize the enclosing-matrix test to `formationId`**

In `extractEnclosedLenses` (~242) the lens conditions are (a) `U.bodyId` not in the other column, (b) units above+below share the same **`bodyId`**, (c) that matrix bodyId is on the other column. Change (b)+(c) to test **`formationId`** (the enclosing matrix is the same *lithology*), while keeping (a) as a guard against extracting an **explicitly correlated** unit:

- (a) keep: `U.bodyId` is NOT in `otherBodyIds` (don't extract a unit the user correlated across).
- (b) change: `units[i-1].formationId === units[i+1].formationId` (same-lithology enclosing matrix).
- (c) change: that enclosing `formationId` is present in the other column's formation set.

Add a parallel `otherFormationIds: Set<string>` parameter alongside `otherIds` (rename the existing `otherIds` usages to `otherBodyIds` for clarity). In `computePartitionFill` (~835) build both sets:

```typescript
const rightBodyIds = new Set(rightUnits.map(u => u.bodyId).filter((b): b is string => b !== null))
const leftBodyIds  = new Set(leftUnits.map(u => u.bodyId).filter((b): b is string => b !== null))
const rightFormIds = new Set(rightUnits.map(u => u.formationId))
const leftFormIds  = new Set(leftUnits.map(u => u.formationId))
const leftLenses  = extractEnclosedLenses(leftUnits,  rightBodyIds, rightFormIds, 'left')
const rightLenses = extractEnclosedLenses(rightUnits, leftBodyIds,  leftFormIds,  'right')
```

The merge-enclosing-neighbours behaviour the function already has now merges the **same-lithology** matrix (sand) into one contiguous unit per column once the silt/clay are pulled. (S2 silt at the top of the interval is enclosed by the upper sand band above + S2 sand below → both SAND → extracted; S1 clay + silt likewise.)

- [ ] **Step 4: Connect the post-extraction matrix by `formationId`**

After the `bodyId` LCS (`lcsAlignment`, ~843) and within each interval's emission, a matrix unit pair that is **the same `formationId` on both columns but unmatched by `bodyId`** must emit as a connected **`quad`** spanning the interval (inheriting the interval's top/base interfaces), not as opposing pinches. In `emitInterval` (~683): before the `meetFraction` tiling, check whether the interval reduces to **one left unit and one right unit of the same `formationId`** (after extraction this is the common case) → emit a single `quad` over `[topIface, baseIface]` across fraction 0→1, `bodyId: leftUnit.bodyId` (either; they're the same lithology). Only fall through to pinch/seam handling when that's not the case.

(Implementation detail derived via the test: the spanning quad polygon is `[{0, topElevLeft},{1, topElevRight},{1, baseElevRight},{0, baseElevLeft}]` using the existing `ifaceElev` helper. Use the existing interface-elevation machinery — don't hand-roll elevation math.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts`
Expected: the two new tests PASS; **existing partition-fill tests still PASS** (explicit `bodyId`-correlated bands + pre-existing enclosed lenses behave unchanged — the `bodyId` LCS still runs first and the (a) guard protects correlated units). Reconcile any test that asserted the old meeting-fraction tiling for an *uncorrelated same-lithology* interval — that case is now a band by design.

- [ ] **Step 6: tsc + commit**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json 2>&1 | rg partitionFill` → no output.

```bash
git add desktop/src/renderer/src/utils/partitionFill.ts desktop/src/renderer/src/utils/partitionFill.test.ts
git commit -m "feat(partition): connect matrix by lithology; extract minority lithos as lenses"
```

---

### Task 3: Onlap — a pinch-out abutting exactly one bracket laps against it (up/down)

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts` — `emitInterval` / the pinch-emission path (~683-760)
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

- [ ] **Step 1: Write the failing tests (both directions)**

```typescript
// Onlap against the TOP: a silt on the left whose TOP coincides with the top
// bracket and whose base is uncorrelated → base laps UP to the top; tip at the
// halfway fraction on the top interface.
const ON_TOP_L = col('L', [u(0,2,'SILT','l-silt'), u(2,10,'SAND','l-sand')])
const ON_TOP_R = col('R', [u(0,10,'SAND','r-sand')]) // sand correlated bracket below via shared body in a fuller fixture
it('onlap pinches against the top bracket when only the top contact is correlated', () => {
  const regions = computePartitionFill(ON_TOP_L, ON_TOP_R)
  const silt = regions.find(r => r.formationId === 'SILT')!
  expect(silt.kind).not.toBe('quad')
  // tip is on the TOP interface (shallowest elevation), at ~INTERIOR_PINCH_FRACTION
  const tip = silt.polygon.reduce((a, b) => (a.fraction > b.fraction ? a : b))
  expect(tip.fraction).toBeCloseTo(0.5, 1)
})
```

Add the mirror test `onlap pinches against the base bracket when only the base contact is correlated` (silt whose base coincides with the base bracket; tip laps DOWN to the base interface). Build the fixtures so exactly one bounding contact is shared.

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts -t "onlap"`
Expected: FAIL — current code emits a symmetric pinch triangle (apex mid-elevation), not a lap anchored to the correlated bracket.

- [ ] **Step 3: Implement onlap anchoring**

In the pinch-emission, when a one-sided unit has exactly one bounding interface that is a **correlated** bracket (matched contact) and the other is not: anchor the polygon's flat edge on the correlated interface (full width to the column) and taper the non-correlated edge to the tip at `INTERIOR_PINCH_FRACTION`. Direction follows which interface is correlated (top → tip on the top interface; base → tip on the base interface). Reuse `buildLeftPinchPolygon`/`buildRightPinchPolygon` shapes with the apex elevation set to the correlated interface (not the mid-elevation) — these already take `meetFraction`/interfaces.

- [ ] **Step 4: Run to verify passes**

Run: `cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts -t "onlap"` → PASS, plus the whole file still green.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/utils/partitionFill.ts desktop/src/renderer/src/utils/partitionFill.test.ts
git commit -m "feat(partition): onlap laps against its single correlated bracket (up/down)"
```

---

### Task 4: Mismatched matrix → vertical midpoint seam + facies flag

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts` — `emitInterval` (~683-710) + add a `seamKind` field to `PartitionRegion`
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// No shared matrix: sand fills the interval on the left, clay on the right.
const MM_L = col('L', [u(0,2,'SAND','top'), u(2,10,'SAND','l-sand'), u(10,12,'CLAY','bot')])
const MM_R = col('R', [u(0,2,'SAND','top'), u(2,10,'CLAY','r-clay'), u(10,12,'CLAY','bot')])
it('mismatched matrix splits at a vertical midpoint seam flagged as facies', () => {
  const regions = computePartitionFill(MM_L, MM_R)
  const sand = regions.find(r => r.formationId === 'SAND' && r.kind === 'quad' && r.polygon.some(p => p.fraction > 0.4 && p.fraction < 0.6))
  const clay = regions.find(r => r.formationId === 'CLAY' && r.kind === 'quad' && r.polygon.some(p => p.fraction > 0.4 && p.fraction < 0.6))
  // both meet at fraction 0.5 (midpoint), not a thickness-weighted f
  expect(sand!.polygon.map(p => p.fraction)).toContain(0.5)
  expect(clay!.polygon.map(p => p.fraction)).toContain(0.5)
  // the seam is flagged so the overlay draws it wriggly
  expect(sand!.seamKind === 'facies' || clay!.seamKind === 'facies').toBe(true)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts -t "mismatched matrix"`
Expected: FAIL — current code splits at `sumLeft/(sumLeft+sumRight)` (here 0.5 only by coincidence of equal thickness) and emits no `seamKind`.

- [ ] **Step 3: Implement**

Add `seamKind?: 'facies'` to the `PartitionRegion` interface (~141, optional so existing regions are unaffected). In `emitInterval`, detect the mismatched-matrix case: the interval's left matrix `formationId` ≠ the right matrix `formationId` (and neither is correlated/extractable). For that case force `meetFraction = 0.5` (not the weighted value) and tag both emitted quads with `seamKind: 'facies'`. The same-matrix case (Task 2) and the lens/onlap cases are unaffected.

- [ ] **Step 4: Run to verify passes + commit**

Run: `cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts` → all PASS.

```bash
git add desktop/src/renderer/src/utils/partitionFill.ts desktop/src/renderer/src/utils/partitionFill.test.ts
git commit -m "feat(partition): midpoint facies seam for mismatched matrix (flagged)"
```

---

### Task 5: Overlay — render onlap wedges + the wriggly facies seam

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx`
- Test: `desktop/src/renderer/src/components/sections/PartitionFillOverlay.test.tsx`

- [ ] **Step 1: Confirm current render path**

Run: `rg -n "polygon|points|kind|seamKind|path|polyline" desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx | head`
The overlay maps each region's `(fraction, elevation)` polygon → screen via `warpedXToScreen` + `levelToScreen` (the spacing-aware transforms — do NOT use raw `xToScreen`; see the strix-section-geometry-check skill). Onlap/lens polygons already render as filled shapes from their points, so Task 3/4 region polygons render with no overlay change for the *fill*.

- [ ] **Step 2: Write the failing test for the wriggly facies seam**

```typescript
it('draws a wavy stroke along a facies seam region edge', () => {
  // render the overlay with a region carrying seamKind:'facies'; assert a
  // <path> (the wiggle) is emitted along the seam fraction, not a straight <line>.
  // (mirror the existing PartitionFillOverlay test render harness)
})
```
Adapt to the file's existing test harness (grep for how it renders + queries SVG). Assert that a facies-flagged region produces a wavy seam path element (e.g. a `<path data-seam="facies">`).

- [ ] **Step 3: Implement the wriggly seam**

When a region has `seamKind === 'facies'`, additionally render its seam edge (the vertical edge at the shared fraction) as a small-amplitude sine/zig `<path>` (a helper `wavyPath(x, yTop, yBottom, amplitude=3, wavelength=10)`) stroked in the contact colour, `data-seam="facies"`, `pointerEvents:none`. The fill polygons are unchanged.

- [ ] **Step 4: tsc + vitest + commit**

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json 2>&1 | rg PartitionFillOverlay` → none.
Run: `cd desktop && npx vitest run src/renderer/src/components/sections/PartitionFillOverlay.test.tsx` → PASS.

```bash
git add desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx desktop/src/renderer/src/components/sections/PartitionFillOverlay.test.tsx
git commit -m "feat(sections): render wriggly facies seam for mismatched-matrix regions"
```

---

### Task 6: Non-overlapping same-litho regression + full verification

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.test.ts`

- [ ] **Step 1: Pin non-overlapping same-litho → separate lenses**

```typescript
// SILT high on the left, SILT low on the right (different positions), sand matrix.
const NL_L = col('L', [u(0,2,'SAND','t'), u(2,3,'SILT','l-silt'), u(3,10,'SAND','ls'), u(10,12,'CLAY','b')])
const NL_R = col('R', [u(0,2,'SAND','t'), u(2,8,'SAND','rs'), u(8,9,'SILT','r-silt'), u(9,10,'SAND','rs2'), u(10,12,'CLAY','b')])
it('non-overlapping same-lithology units stay separate pinch-outs (not one band)', () => {
  const regions = computePartitionFill(NL_L, NL_R)
  const silts = regions.filter(r => r.formationId === 'SILT')
  expect(silts.length).toBe(2)             // two separate lenses
  expect(silts.every(r => r.kind !== 'quad')).toBe(true) // neither spans
})
```

- [ ] **Step 2: Run the whole partition suite + tsc**

Run: `cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts src/renderer/src/components/sections/PartitionFillOverlay.test.tsx`
Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json` → clean.
Expected: all PASS, `assertTiles` green on every case.

- [ ] **Step 3: Commit**

```bash
git add desktop/src/renderer/src/utils/partitionFill.test.ts
git commit -m "test(partition): non-overlapping same-litho stay separate pinch-outs"
```

- [ ] **Step 4: Live dogfeed (owner)**

Reload the app on the test2 project, open the S2↔S1 section: the middle interval should show **one sand body** with the S2 silt as a top onlap and the S1 clay + silt as lenses floating in it — no droop, no open-ended layers. Look right (single column / no lenses) → one continuous sand body. Confirm no regressions on previously-correct sections (correlated bands unchanged).

---

## Notes for the implementer

- `partitionFill.ts` is a **pure** module: no `Date.now`/`Math.random`/IO. Geometry math goes through the existing `ifaceElev` / interface helpers — don't hand-roll elevation interpolation.
- The `assertTiles` invariant (no gaps/overlaps, excluding `kind:'lens'` overlays) guards every case — it's what keeps 2D→3D sound. Never weaken it.
- "Lithology" throughout = `formationId` (one formation = one lithology in the litho model). Explicit `bodyId` correlations still win (matched first, protected by the extraction guard).
- Node must be 22.x for Vitest.
- Out of scope (do NOT build): interfingering tongues, sloped/weighted seams, resolver/`body_id` changes, auto-creating correlation edges.
