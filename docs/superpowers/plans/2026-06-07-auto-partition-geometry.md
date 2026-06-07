# Auto-Partition Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the auto-derived partition fill geologically correct for all sites: (1) a lone interior pinch tapers to a tip at 50% on the interface dip instead of drooping to the neighbour; (2) a unit deeper than a too-shallow neighbour carries through at full thickness instead of pinching to it.

**Architecture:** Both changes live in the pure function `desktop/src/renderer/src/utils/partitionFill.ts`. Slice 1 replaces a lone interior pinch's full-gap triangle with three triangles that share an apex at fraction 0.5 (the unit + the two enclosing-matrix extensions), keeping the partition hole-free. Slice 2 detects, in the floor interval, units that lie entirely below the shallower column's floor and emits them as full-gap-width bands.

**Tech Stack:** TypeScript pure module; Vitest (`npx vitest run`, Node 22).

**Spec:** `docs/superpowers/specs/2026-06-07-auto-partition-geometry-design.md`

---

### Task 1: Slice 1 — halfway pinch (lone interior pinch → apex at 50%)

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts`
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

**Geometry.** A lone interior pinch's interval is a triangle/quad bounded by `topIface` (matched quad above) and `baseIface` (matched quad below); for a lone pinch the two interfaces converge on the far column (the unit is absent there). Place an apex at the pinch side's fraction `f` (0.5) at the mid-elevation of the interval, and split the interval into three triangles sharing that apex: the **unit** (left/right edge triangle), the **above-matrix extension**, and the **below-matrix extension**. Three triangles sharing one interior apex partition the interval exactly.

- [ ] **Step 1: Add the fraction constant**

In `partitionFill.ts`, next to `LENS_PINCH_FRACTION` (~line 99), add:

```typescript
/**
 * Fraction of the gap at which a lone interior pinch tapers to its tip
 * (owner directive 2026-06-07). 0.5 = halfway on the interface dip — the unit
 * thins to a point mid-gap and the enclosing matrix closes up beyond it,
 * instead of running to the neighbour (the "drooping" pinch). Reshaped
 * afterward via the freedraw apex handle.
 */
export const INTERIOR_PINCH_FRACTION = 0.5
```

- [ ] **Step 2: Write the failing test**

In `partitionFill.test.ts`, add inside `describe('computePartitionFill', ...)`:

```typescript
  // HP1 — a lone interior pinch tapers to an apex at fraction 0.5 (NOT to the
  // neighbour at fraction 1), with the enclosing matrix closing beyond it.
  it('HP1: lone interior pinch tips at 50%, matrix closes, tiles', () => {
    // left:  Clay-A 0-5 | Sand 5-9 (lone) | Clay-B 9-14
    // right: Clay-A 0-5 | Clay-B 5-14   (Sand absent → interfaces converge right)
    const left = col('L', 10, [
      { top: 0, base: 5, f: 'clayA', b: 'cA' },
      { top: 5, base: 9, f: 'sand', b: 'sand' },
      { top: 9, base: 14, f: 'clayB', b: 'cB' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 5, f: 'clayA', b: 'cA' },
      { top: 5, base: 14, f: 'clayB', b: 'cB' },
    ])
    const regions = computePartitionFill(left, right)

    const sand = regions.filter((r) => r.formationId === 'sand')
    expect(sand).toHaveLength(1)
    expect(sand[0].kind).toBe('pinch')
    // Apex is the deepest-into-the-gap vertex; it must sit at ~0.5, never 1.
    const maxFraction = Math.max(...sand[0].polygon.map((p) => p.fraction))
    expect(maxFraction).toBeCloseTo(0.5, 6)
    // The enclosing matrix extends INTO the interval: clayA and clayB each
    // appear in MORE THAN ONE region (the quad + the extension triangle).
    expect(regions.filter((r) => r.formationId === 'clayA').length).toBeGreaterThanOrEqual(2)
    expect(regions.filter((r) => r.formationId === 'clayB').length).toBeGreaterThanOrEqual(2)
    // Still a true partition.
    assertTiles(regions, left, right)
  })
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts -t HP1`
Expected: FAIL — today the lone pinch reaches fraction 1 (`maxFraction` ≈ 1, not 0.5) and there is only one `clayA`/`clayB` region each.

- [ ] **Step 4: Add the lone-interior-pinch emitter**

In `partitionFill.ts`, add this helper near `emitInterval` (it reuses the existing `ifaceElev`):

```typescript
/**
 * Emit a lone interior pinch as three apex-sharing triangles (Slice 1).
 *
 * The interval (bounded by ``topIface`` above and ``baseIface`` below) converges
 * on the column OPPOSITE ``pinch.side`` because the unit is absent there. An apex
 * is placed at fraction ``f`` (measured from the pinch side) at the interval's
 * mid-elevation, and the interval is split into the unit triangle + the
 * above-matrix and below-matrix extension triangles, all sharing the apex.
 *
 * Parameters mirror ``emitInterval`` plus the enclosing matrix identities.
 */
function emitLoneInteriorPinch(
  pinch: PinchUnit,
  topIface: Interface,
  baseIface: Interface,
  aboveFormationId: string,
  aboveBodyId: string | null,
  belowFormationId: string,
  belowBodyId: string | null,
  leftSurface: number,
  rightSurface: number,
  f: number,
): PartitionRegion[] {
  const apexFraction = pinch.side === 'left' ? f : 1 - f
  const apexElev =
    (ifaceElev(topIface, apexFraction, leftSurface, rightSurface) +
      ifaceElev(baseIface, apexFraction, leftSurface, rightSurface)) /
    2
  const apex: PartitionPoint = { fraction: apexFraction, elevation: apexElev }

  if (pinch.side === 'left') {
    const topLeft: PartitionPoint = { fraction: 0, elevation: leftSurface - topIface.leftDepth }
    const baseLeft: PartitionPoint = { fraction: 0, elevation: leftSurface - baseIface.leftDepth }
    // Convergence point on the right (interfaces meet — unit absent there).
    const conv: PartitionPoint = {
      fraction: 1,
      elevation: rightSurface - (topIface.rightDepth + baseIface.rightDepth) / 2,
    }
    return [
      { formationId: pinch.formationId, bodyId: pinch.bodyId, kind: 'pinch', polygon: [topLeft, apex, baseLeft] },
      { formationId: aboveFormationId, bodyId: aboveBodyId, kind: 'quad', polygon: [topLeft, conv, apex] },
      { formationId: belowFormationId, bodyId: belowBodyId, kind: 'quad', polygon: [baseLeft, apex, conv] },
    ]
  }
  const topRight: PartitionPoint = { fraction: 1, elevation: rightSurface - topIface.rightDepth }
  const baseRight: PartitionPoint = { fraction: 1, elevation: rightSurface - baseIface.rightDepth }
  const conv: PartitionPoint = {
    fraction: 0,
    elevation: leftSurface - (topIface.leftDepth + baseIface.leftDepth) / 2,
  }
  return [
    { formationId: pinch.formationId, bodyId: pinch.bodyId, kind: 'pinch', polygon: [topRight, apex, baseRight] },
    { formationId: aboveFormationId, bodyId: aboveBodyId, kind: 'quad', polygon: [topRight, conv, apex] },
    { formationId: belowFormationId, bodyId: belowBodyId, kind: 'quad', polygon: [baseRight, apex, conv] },
  ]
}
```

- [ ] **Step 5: Track the matrix identities + branch to the emitter**

In `computePartitionFill`, declare cursors for the previous quad's identity next to `prevQuadBase` (~line 717):

```typescript
  let prevQuadFormationId: string | null = null
  let prevQuadBodyId: string | null = null
```

Set them whenever a quad is emitted — in the quad-emission block (after `regions.push({ ... kind: 'quad' ... })`, where `prevQuadBase = quadBase` is set), add:

```typescript
        prevQuadFormationId = lu.formationId
        prevQuadBodyId = lu.bodyId
```

Then in the interval-emission block, replace the unconditional `emitInterval(...)` call:

```typescript
    const intervalTop = prevQuadBase
    const intervalRegions = emitInterval(pinches, intervalTop, intervalBase, leftSurface, rightSurface)
    regions.push(...intervalRegions)
```

with a branch that uses the lone-interior-pinch emitter when this interval is interior (a matched quad both above and below) and holds exactly one pinch:

```typescript
    const intervalTop = prevQuadBase
    const isInterior = prevMatchLi >= 0 && !isFloor && prevQuadFormationId !== null
    if (isInterior && pinches.length === 1) {
      const [mli] = matchedPairs[pairIdx]
      const below = leftUnits[mli]
      regions.push(
        ...emitLoneInteriorPinch(
          pinches[0],
          intervalTop,
          intervalBase,
          prevQuadFormationId!,
          prevQuadBodyId,
          below.formationId,
          below.bodyId,
          leftSurface,
          rightSurface,
          INTERIOR_PINCH_FRACTION,
        ),
      )
    } else {
      const intervalRegions = emitInterval(pinches, intervalTop, intervalBase, leftSurface, rightSurface)
      regions.push(...intervalRegions)
    }
```

(`isFloor`, `pinches`, `intervalBase`, `matchedPairs`, `pairIdx`, `prevMatchLi`, `leftUnits` are all in scope in this loop.)

- [ ] **Step 6: Run the tests to verify green**

Run: `cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts`
Expected: PASS (all, incl. HP1 — the existing PF* tiling tests must stay green, proving no regression to quad/lens/multi-pinch cases).

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep partitionFill`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/renderer/src/utils/partitionFill.ts
git commit -m "feat(sections): lone interior pinch tips at 50% on the dip, matrix closes"
git add desktop/src/renderer/src/utils/partitionFill.test.ts
git commit -m "test(sections): HP1 pins halfway interior pinch + matrix extensions"
```

---

### Task 2: Slice 2 — too-shallow carry-through

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts`
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

**Behaviour.** In the floor interval, a unit on the deeper column whose `topDepthM ≥ min(leftFloor, rightFloor)` lies entirely below the shallow column's deepest data — render it as a **full-gap-width band** (flat at the deep unit's own elevations), not a pinch. (Generic assertTiles assumes a floor interpolated between the two columns, which a carry-through deliberately overrides, so HP2 asserts region shapes directly rather than calling assertTiles.)

- [ ] **Step 1: Write the failing test**

In `partitionFill.test.ts`, add inside `describe('computePartitionFill', ...)`:

```typescript
  // CT1 — a unit below a too-shallow neighbour's floor carries THROUGH at full
  // width (fraction 0→1), not a pinch to the neighbour.
  it('CT1: deep unit below a shallow neighbour carries through full-width', () => {
    // left reaches 23 m; right (a shallow borehole) stops at 17 m.
    // left:  Clay 0-10 | Sand 10-17 | Silt 17-23
    // right: Clay 0-10 | Sand 10-17           (no data below 17)
    const left = col('L', 10, [
      { top: 0, base: 10, f: 'clay', b: 'clay' },
      { top: 10, base: 17, f: 'sand', b: 'sand' },
      { top: 17, base: 23, f: 'silt', b: 'silt' },
    ])
    const right = col('R', 10, [
      { top: 0, base: 10, f: 'clay', b: 'clay' },
      { top: 10, base: 17, f: 'sand', b: 'sand' },
    ])
    const regions = computePartitionFill(left, right)

    const silt = regions.filter((r) => r.formationId === 'silt')
    expect(silt).toHaveLength(1)
    // Carry-through spans the FULL gap width: fractions present at 0 AND 1.
    const fractions = silt[0].polygon.map((p) => p.fraction)
    expect(Math.min(...fractions)).toBeCloseTo(0, 6)
    expect(Math.max(...fractions)).toBeCloseTo(1, 6)
    // Flat band at the deep unit's own elevations (surface 10 → 17..23 → −7..−13).
    const elevs = silt[0].polygon.map((p) => p.elevation)
    expect(Math.max(...elevs)).toBeCloseTo(-7, 6)
    expect(Math.min(...elevs)).toBeCloseTo(-13, 6)
  })

  // CT2 — a same-depth extra bed (NOT below the neighbour's floor) still pinches.
  it('CT2: an unmatched bed within both columns depth still pinches', () => {
    // Both reach 14 m; left has an extra Silt bed 9-14 that genuinely thins out.
    const left = col('L', 10, [
      { top: 0, base: 9, f: 'clay', b: 'clay' },
      { top: 9, base: 14, f: 'silt', b: 'silt' },
    ])
    const right = col('R', 10, [{ top: 0, base: 14, f: 'clay', b: 'clay' }])
    const regions = computePartitionFill(left, right)
    const silt = regions.filter((r) => r.formationId === 'silt')
    expect(silt).toHaveLength(1)
    expect(silt[0].kind).toBe('pinch')
    // A pinch does NOT span the full width — it tapers, max fraction < 1 - eps
    // only if Slice 1 applies; here it is a floor pinch so it reaches the
    // neighbour. The key contrast vs CT1: it is NOT a full-width flat band.
    const fractions = silt[0].polygon.map((p) => p.fraction)
    const widthSpan = Math.max(...fractions) - Math.min(...fractions)
    const elevs = silt[0].polygon.map((p) => p.elevation)
    const flat = Math.abs(Math.max(...elevs) - Math.min(...elevs)) > 1e-6
    expect(widthSpan > 0 && flat).toBe(true) // a triangle, not a flat full band
  })
```

- [ ] **Step 2: Run to verify CT1 fails**

Run: `cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts -t CT1`
Expected: FAIL — today `silt` is a pinch triangle tapering toward the right column (max fraction ~1 but it is a triangle, not a full-width flat band; its elevations are not flat at −7..−13 across).

- [ ] **Step 3: Implement carry-through in the floor interval**

In `computePartitionFill`, inside the `for (pairIdx...)` loop, the floor branch is `isFloor === true`. Before collecting pinches for the floor interval, split out carry-through units. Replace the floor-interval emission so that, when `isFloor`, deep-below-shallow units are emitted as full-width bands and removed from the pinch set:

```typescript
    if (isFloor) {
      const shallowFloor = Math.min(leftFloor, rightFloor)
      const carry: PinchUnit[] = []
      const stillPinch: PinchUnit[] = []
      for (const p of pinches) {
        // A unit whose TOP is at/below the shallow column's deepest data lies
        // entirely in "no-neighbour-data" depth → carry through full width.
        if (p.ownTopDepth >= shallowFloor - EPS) carry.push(p)
        else stillPinch.push(p)
      }
      for (const p of carry) {
        const surface = p.side === 'left' ? leftSurface : rightSurface
        const top = surface - p.ownTopDepth
        const base = surface - p.ownBaseDepth
        regions.push({
          formationId: p.formationId,
          bodyId: p.bodyId,
          kind: 'quad',
          polygon: [
            { fraction: 0, elevation: top },
            { fraction: 1, elevation: top },
            { fraction: 1, elevation: base },
            { fraction: 0, elevation: base },
          ],
        })
      }
      regions.push(...emitInterval(stillPinch, intervalTop, intervalBase, leftSurface, rightSurface))
    } else if (isInterior && pinches.length === 1) {
      // ... the Slice 1 branch from Task 1 ...
    } else {
      regions.push(...emitInterval(pinches, intervalTop, intervalBase, leftSurface, rightSurface))
    }
```

Integrate this with the Task 1 branch (the `isFloor` case takes precedence — a floor interval is never the interior-lone-pinch case, since `isInterior` already requires `!isFloor`). The final structure is: `if (isFloor) {...carry-through...} else if (isInterior && pinches.length === 1) {...Slice 1...} else {...emitInterval...}`.

- [ ] **Step 4: Run the tests to verify green**

Run: `cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts`
Expected: PASS (CT1, CT2, HP1, and all existing PF* tests).

Run: `cd desktop && npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep partitionFill`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/renderer/src/utils/partitionFill.ts
git commit -m "feat(sections): deep units carry through a too-shallow neighbour full-width"
git add desktop/src/renderer/src/utils/partitionFill.test.ts
git commit -m "test(sections): CT1/CT2 pin carry-through vs genuine floor pinch"
```

---

### Task 3: Validate against real data + dogfeed

- [ ] **Step 1:** Re-seed the e2e/dev fixture if needed, restart the dev app, open `test.strix` **Section 2** (24 columns; boreholes end ~17–21 m, CPTs ~23–25 m).

- [ ] **Step 2:** Confirm visually: interior lone pinches taper to ~50% on the dip (no drooping to the neighbour); the deep CPT units below each borehole's bottom carry through full-thickness past the borehole rather than pinching to it. Use `strix-section-geometry-check` (all overlay geometry must use `warpedXToScreen`).

- [ ] **Step 3 (optional eval):** if Section 2 has hand-marked expectations, run `strix-suggestion-eval` to count divergences before/after.

---

## Notes for the implementer

- `EPS` is already defined in `partitionFill.ts` (`1e-9`). `PartitionPoint`, `PartitionRegion`, `PinchUnit`, `Interface`, `ifaceElev` are all existing module members.
- Node must be 22.x for Vitest (`node --version`); Node 24 segfaults the runner.
- Slice 1 keeps `emitInterval` for every non-lone / non-interior case — do NOT change `emitInterval`'s signature.
- The carry-through band is `kind: 'quad'` so it participates in normal rendering; it is intentionally full-width and flat (the shallow column has no contacts to dip toward).
- Out of scope (keep current behaviour, noted in the spec): stacked/multiple same-side interior pinches, straddle-the-floor units, too-shallow-at-top (surface interval).
