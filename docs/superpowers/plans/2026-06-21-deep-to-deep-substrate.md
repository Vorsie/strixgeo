# Deep-to-deep substrate pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below a shallow test's TD, fill the section with the deep stratigraphy drawn as straight lines from one deep test to the next (sand owns its space, no clay-over-sand), replacing the bridge/gap-fill/floor-carry tangle with ONE dedicated, tiling substrate pass.

**Architecture:** Reuse the validated `emitGap` between the two bracketing deep anchors of each shallow run, and slice its output per intervening shallow column. Cap the normal per-gap fill at the shallow TD; the new pass owns everything below. The 2-D `computeSectionFill` is the single source of truth (the 3-D voxel builder inherits the corrected partition on the next Build).

**Tech Stack:** React/TypeScript + Vitest (`partitionFill.ts`); the dev DB + the real-data CS1 gate for validation.

**Spec:** `docs/superpowers/specs/2026-06-21-deep-to-deep-substrate-design.md` — read it first.

**Canonical bug image (the target to eliminate):** `C:\Users\robin\Downloads\Schermafbeelding 2026-06-21 095444.png` — the green-circled **clay blob overlaid on sand** below the S7a/S7/S6 columns of CS1. When this plan is done, that blob is gone and the sand runs straight behind the shallow tests.

---

## ⚠ GET IT RIGHT THIS TIME — non-negotiable guardrails

These exist because two days were burned on whack-a-mole here, and twice this session a fix went green on synthetic tests while real CS1 stayed broken.

1. **The real-data CS1 gate is THE arbiter — NOT synthetic tests.** A synthetic unit test passing means nothing until the real-data gate is green. The real bug is edge-driven and multi-column; synthetic 2-column cases cannot reproduce it. Always run the real gate (Task 1) after every change.
2. **Regenerate the real input first, every session:**
   `uv run python scripts/throwaway_cs1_partition_extract.py` (needs the dev DB up: `docker start strix-db-1`). Without it the gate skips and you are flying blind.
3. **No whack-a-mole.** If a change makes one gap's overlap shrink but another's grow, or relocates an overlap, STOP — that is the trap. The dedicated pass REPLACES the tangle; it does not patch it. Revert and reconsider before continuing.
4. **Keep the above-TD partition byte-identical.** Capping (Task 4) must not change anything above the shallow TD. Snapshot before, diff after.
5. **Run ALL of these after each task:** `npx vitest run src/renderer/src/utils/partitionFill.test.ts` (full file, not `-t` filtered), `npx tsc --noEmit -p tsconfig.web.json`, and the real gate. Green on all three or the task is not done.
6. **Commit per file, Conventional Commits, do NOT `git push`.** End commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
7. **Node 22 only** (`node --version` → 22.x); use `uv run python` / `py`, never bare `python`.

---

## Standing rules

Desktop checks from `desktop/`. Every `react-hooks/exhaustive-deps` disable carries a `// reason:`. JSDoc on public TS. English only. The dev DB is docker container `strix-db-1` (host port 5433, db `groundmodel`).

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `desktop/src/renderer/src/utils/partitionFill.cs1void.test.ts` | real-data CS1 gate — add the cross-formation-overlap check (the missing arbiter) | Modify |
| `desktop/src/renderer/src/utils/partitionFill.ts` | add along-position input; the `computeBracketSubstrate` pass; cap `emitGap` at shallow TD; wire the pass; remove dead sub-TD code | Modify |
| `desktop/src/renderer/src/utils/partitionFill.test.ts` | synthetic behaviour tests (with edges): 2-consecutive-shallow run, facies seam, one-sided sideways | Modify |
| `desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx` | pass along positions into `computeSectionFill` | Modify |
| `desktop/src/renderer/src/utils/buildVoxelRequest.ts` | pass along positions (so the 3-D voxel inherits the same geometry) | Modify |

---

## PHASE 1 — Make the real-data gate a true arbiter

### Task 1: Add the cross-formation-overlap check to the CS1 gate

**Why:** the existing CS1 gate (`partitionFill.cs1void.test.ts`) checks interior voids + lithology + **quad-on-quad** overlap of the same gap. It MISSES clay-quad-over-sand-pinch (the actual bug). Add a check that fails on ANY two non-lens regions of DIFFERENT `formationId` covering the same point.

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.cs1void.test.ts`

- [ ] **Step 1: Add the cross-formation-overlap test** inside the `describe('CS1 real-data partition void gate', …)` block (it already loads `regions`, `byGap`, `inPolygon`, `CELL_THRESHOLD`). Append:

```ts
  it('has no cross-formation overlap in any gap (true partition, one lithology per point)', () => {
    const offenders: string[] = []
    for (const [gap, regs] of [...byGap.entries()].sort((a, b) => a[0] - b[0])) {
      const nonLens = regs.filter((r) => r.kind !== 'lens')
      let minE = Infinity
      let maxE = -Infinity
      for (const r of nonLens) for (const p of r.polygon) {
        if (p.elevation < minE) minE = p.elevation
        if (p.elevation > maxE) maxE = p.elevation
      }
      if (!Number.isFinite(minE) || maxE - minE < 1e-6) continue
      const NX = 120
      const NY = 320
      const seen = new Map<string, number>() // "formA+formB" -> cell count
      for (let iy = 0; iy < NY; iy++) {
        const py = maxE - ((iy + 0.5) / NY) * (maxE - minE)
        for (let ix = 0; ix < NX; ix++) {
          const px = (ix + 0.5) / NX
          const forms = [...new Set(nonLens.filter((r) => inPolygon(px, py, r.polygon)).map((r) => r.formationId))]
          if (forms.length >= 2) {
            const key = forms.sort().join('+')
            seen.set(key, (seen.get(key) ?? 0) + 1)
          }
        }
      }
      for (const [key, cells] of seen) {
        if (cells >= CELL_THRESHOLD) offenders.push(`GAP-${gap} ${key}: ${cells} cells`)
      }
    }
    if (offenders.length > 0) {
      // eslint-disable-next-line no-console
      console.info('[CS1-XFORM] cross-formation overlaps:\n  ' + offenders.join('\n  '))
    }
    expect(offenders, `cross-formation overlaps found:\n${offenders.join('\n')}`).toEqual([])
  })
```

- [ ] **Step 2: Regenerate the real input + run the gate, verify it FAILS on current code.**

Run:
```
docker start strix-db-1
uv run python scripts/throwaway_cs1_partition_extract.py
cd desktop && CS1_GATE=1 npx vitest run src/renderer/src/utils/partitionFill.cs1void.test.ts
```
Expected: the new test FAILS, listing ~9 gaps with KLEI+ZAND / KLEI+SILT overlaps (this is the bug; it is the RED we will drive to green).

- [ ] **Step 3: Commit** — `git add desktop/src/renderer/src/utils/partitionFill.cs1void.test.ts` then `git commit -m "test(section-fill): CS1 gate fails on cross-formation overlap (the real arbiter)"`.

---

## PHASE 2 — Along positions into the engine (needed to slice between non-adjacent anchors)

### Task 2: Add an optional along-position array to `computeSectionFill`

**Why:** slicing the L→R deep-anchor partition at an intervening shallow column needs that column's along-section fraction between L and R. `computeSectionFill` currently works only in per-gap `[0,1]` space. Add an optional `alongM: number[]` (one per non-empty column, same order). When absent, fall back to uniform spacing (current behaviour — backwards compatible).

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts`
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

- [ ] **Step 1: Write the failing test** (the param exists and uniform fallback is byte-identical to today):

```ts
it('computeSectionFill accepts alongM and is unchanged under uniform spacing', () => {
  const a = col('A', 0, [{ top: 0, base: 5, f: 'CLAY', b: 'c' }])
  const b = col('B', 0, [{ top: 0, base: 5, f: 'CLAY', b: 'c' }])
  const withAlong = computeSectionFill([a, b], [], undefined, [0, 100])
  const without = computeSectionFill([a, b], [])
  expect(withAlong).toEqual(without)
})
```

- [ ] **Step 2: Run → FAIL** (the 4th positional param does not exist yet).
Run: `cd desktop && npx vitest run src/renderer/src/utils/partitionFill.test.ts -t "accepts alongM"`

- [ ] **Step 3: Add the parameter.** In `computeSectionFill`'s signature add a trailing optional `alongM?: readonly number[]`. Do NOT use it yet beyond storing it; the substrate pass (Task 5) consumes it. Keep `lensApexOverrides` as the 3rd param so existing callers are unaffected.

```ts
export function computeSectionFill(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): SectionRegion[] {
```

- [ ] **Step 4: Run → PASS** + full file green + `npx tsc --noEmit -p tsconfig.web.json`.
- [ ] **Step 5: Commit** — `git commit -m "feat(section-fill): optional along-position input (uniform fallback)"`.

---

## PHASE 3 — The dedicated substrate pass (pure, tested in isolation first)

### Task 3: `computeBracketSubstrate` — deep-anchor detection + emitGap(L,R) + slice

**Why:** this is the new pass. It is a PURE function so it is unit-testable without rendering, and it reuses `emitGap` so it inherits straight bands + facies seams + tiling.

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts` (new exported helper)
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

**Definitions** (add JSDoc):
- A column is a **deep anchor for elevation `e`** iff its data reaches `e` (its TD elevation ≤ `e`).
- A **shallow run** is a maximal sequence of consecutive columns each shallower (higher TD) than at least one bracketing neighbour.
- The **bracket** of a run is `(L, R)` = nearest column on each side reaching below the run's shallowest TD; `null` on a side with no deeper neighbour (open).

- [ ] **Step 1: Write failing tests** (behaviour-shaped, via the file-local `coverAt`):

```ts
describe('computeBracketSubstrate (deep-to-deep substrate)', () => {
  // RUN-2: two consecutive shallow tests between two deep anchors → the deep sand
  // runs STRAIGHT behind both (no step, no clay flood).
  it('draws a deep band straight behind a run of 2 shallow tests', () => {
    const L = col('L', 0, [{ top: 0, base: 3, f: 'CLAY', b: 'c' }, { top: 3, base: 15, f: 'SAND', b: 's' }])
    const M1 = col('M1', 0, [{ top: 0, base: 4, f: 'CLAY', b: 'c1' }]) // TD -4, shallow
    const M2 = col('M2', 0, [{ top: 0, base: 4, f: 'CLAY', b: 'c2' }]) // TD -4, shallow
    const R = col('R', 0, [{ top: 0, base: 3, f: 'CLAY', b: 'c' }, { top: 3, base: 15, f: 'SAND', b: 's' }])
    const regions = computeSectionFill([L, M1, M2, R], [], undefined, [0, 100, 200, 300])
    // Below each shallow TD (-4), at the sand's own depth, the cover is SAND only —
    // never CLAY (the deep sand owns the space behind the shallow run).
    for (const gap of [0, 1, 2]) {
      expect(coverAt(regions.filter((r) => r.gapIndex === gap), 0.5, -8)).toEqual(['SAND'])
    }
  })

  // FACIES: deep anchors disagree (SAND left, SILT right) → a facies seam, no overlap.
  it('meets at a facies seam where the bracketing anchors differ', () => {
    const L = col('L', 0, [{ top: 0, base: 3, f: 'CLAY', b: 'c' }, { top: 3, base: 15, f: 'SAND', b: 's' }])
    const M = col('M', 0, [{ top: 0, base: 4, f: 'CLAY', b: 'c1' }])
    const R = col('R', 0, [{ top: 0, base: 3, f: 'CLAY', b: 'c' }, { top: 3, base: 15, f: 'SILT', b: 't' }])
    const regions = computeSectionFill([L, M, R], [], undefined, [0, 100, 200])
    // No point below the shallow TD is covered by BOTH SAND and SILT.
    const sub = regions.filter((r) => r.gapIndex <= 1)
    for (let f = 0.1; f <= 0.9; f += 0.1) {
      const cov = new Set(coverAt(sub, f, -8))
      expect(cov.has('SAND') && cov.has('SILT'), `overlap at f=${f}`).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run → FAIL** (`-t "computeBracketSubstrate"`). On current code the shallow runs are filled by the floor-carry tangle, so the assertions fail (clay present below TD, or overlap).

- [ ] **Step 3: Implement `computeBracketSubstrate`.** Signature + algorithm:

```ts
/**
 * Fill the region below each shallow column's TD with the deep stratigraphy drawn
 * straight from one deep anchor to the next, sliced per intervening shallow column.
 *
 * For each maximal run of consecutive shallow columns bracketed by deep anchors
 * (L, R): run emitGap(L, R) (the validated tiling primitive — straight bands,
 * facies seams, pinch-outs, correlation→litho→facies matching) over the substrate
 * elevation band, then slice that L→R partition at each shallow column's along
 * fraction f = (alongM[ci] − alongM[L]) / (alongM[R] − alongM[L]) to produce that
 * column's substrate regions (sloped quads continuing the straight band). Open
 * brackets (run at a section end) continue sideways flat to the edge.
 *
 * Pure — no rendering. Returns SectionRegion[] tagged with the shallow column's
 * gapIndex so the overlay maps each with the correct screen X.
 */
export function computeBracketSubstrate(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM: readonly number[],
  // the side-edge lookups already built in computeSectionFill (correlated, baseTied,
  // mixedTiedTopToBase) — pass them so emitGap(L,R) matches identically:
  ctx: { correlated: Correlated; baseTied?: Correlated; mixedTiedTopToBase: ReadonlyMap<string, string>; allEdgedLayerIds: ReadonlySet<string> },
): SectionRegion[] { /* … */ }
```

Implementation notes for the engineer (each is a discovery the FAIL/gate forces — do not skip the gate between sub-steps):
- TD elevation of column `c` = `c.surfaceElevM − max(u.baseDepthM)`.
- Detect shallow runs: walk columns; a column `ci` is shallow relative to a neighbour if its TD elevation is higher (shallower) than that neighbour's by > `EPS`.
- For a run `[a..b]` with bracket `(L, R)`: call `emitGap(reducedL, reducedR, …, ctx)` — reuse the SAME reduce/match/floor machinery `computeSectionFill` already runs for an adjacent gap, but on the non-adjacent `L, R`. Restrict the emitted regions to elevations below the run's shallowest TD (clip the polygons at that elevation).
- Slice: for shallow column `ci`, compute its left-edge and right-edge along-fractions within `[L, R]`; sample the L→R region stack at those two fractions to build each region's sloped quad spanning `ci`'s screen-edge fractions (mapped back to the gap-local `[0,1]` of `ci`'s own gaps for the overlay).
- Open bracket: emit the deep side's stack flat (sideways) to the section edge, reusing the existing open-extent length (`view_state.litho_segmenter.open_extent_length_m` is already read for ghost extents; for the partition use the section edge).

- [ ] **Step 4: Run → the two new tests PASS, full file green, tsc clean.**
- [ ] **Step 5: Commit** — `git commit -m "feat(section-fill): computeBracketSubstrate — deep-to-deep sub-TD fill"`.

---

## PHASE 4 — Cutover: cap the old fill, wire the new pass

### Task 4: Cap `emitGap`'s emission at the shallow TD (above-TD byte-identical)

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts`
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts`

- [ ] **Step 1: Snapshot the above-TD output.** Add a temporary throwaway dump (or reuse `partitionFill.cs1render.test.ts`) that writes, for every gap, the regions whose polygon lies ENTIRELY at-or-above `min(TD_left, TD_right)`. Save it to `scripts/throwaway_aboveTD_before.json`. This is the byte-identical baseline.

- [ ] **Step 2: Cap the floor walk.** In `emitGap`, in the floor-interval emission, stop emitting any region geometry BELOW `min(leftFloorElev, rightFloorElev)` (the shallow TD of this gap). Matched bands and mixed-tie risings that sit above the shallow TD stay; the bridge/gap-fill/floor-carry that currently fills below it is dropped (the substrate pass owns it). **DISCOVERY:** the floor walk interleaves above-TD and sub-TD emission — use Step 1's baseline to confirm the above-TD output is unchanged after the cap.

- [ ] **Step 3: Run → above-TD baseline byte-identical.** Re-dump to `scripts/throwaway_aboveTD_after.json` and `diff` against `_before.json`. Expected: identical. The sub-TD region is now EMPTY (voids) — that is expected at this step; the CS1 gate's void test will be RED until Task 5.

- [ ] **Step 4: Commit** — `git commit -m "refactor(section-fill): cap emitGap fill at the shallow TD"`.

### Task 5: Wire `computeBracketSubstrate` into `computeSectionFill`

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts`

- [ ] **Step 1: Call the pass** at the end of `computeSectionFill`, after the per-gap loop, appending its regions:

```ts
  if (alongM && alongM.length === cols.length) {
    out.push(...computeBracketSubstrate(columns, edges, alongM, {
      correlated, baseTied, mixedTiedTopToBase, allEdgedLayerIds,
    }))
  }
```

- [ ] **Step 2: Run the REAL gate.**
```
uv run python scripts/throwaway_cs1_partition_extract.py
cd desktop && CS1_GATE=1 npx vitest run src/renderer/src/utils/partitionFill.cs1void.test.ts
```
Expected: **cross-formation overlap = 0, interior void = 0, lithology correct.** This is the moment of truth. If any gap still overlaps, do NOT patch emitGap — diagnose whether the substrate pass mis-bracketed or mis-sliced that gap (instrument `computeBracketSubstrate`), and fix the PASS.

- [ ] **Step 3: Full file green + tsc clean + the synthetic GAP-18 gate still green.**
- [ ] **Step 4: Commit** — `git commit -m "feat(section-fill): substrate pass replaces sub-TD floor-carry"`.

---

## PHASE 5 — Remove the dead tangle + wire callers

### Task 6: Delete the now-dead sub-TD bridge / gap-fill / floor-carry code

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts`

- [ ] **Step 1: Identify dead code.** With the cap (Task 4) + pass (Task 5) in place, the bridge-injection (`bridge:` units), gap-fill injection (`gapfill:` units), and `injectVirtualUnits` are no longer reached for the sub-TD region. Grep each and confirm no live caller for the sub-TD path.
- [ ] **Step 2: Remove it**, one mechanism per commit. After EACH removal: full file green + real gate still 0/0 + tsc clean. If a removal turns the gate red, that mechanism still served the above-TD region — keep it and note why.
- [ ] **Step 3: Commit each** — e.g. `git commit -m "refactor(section-fill): drop dead bridge injection (substrate pass owns sub-TD)"`.

### Task 7: Pass along positions from the overlay + voxel builder

**Files:**
- Modify: `desktop/src/renderer/src/components/sections/PartitionFillOverlay.tsx`
- Modify: `desktop/src/renderer/src/utils/buildVoxelRequest.ts`

- [ ] **Step 1: Overlay** — find the `computeSectionFill(orderedColumns, contactEdges)` call; add the along-positions array (the overlay already has `along_m` per column from the section data). Run `strix-section-geometry-check` skill (along-section coordinate change). Vitest overlay tests green.
- [ ] **Step 2: Voxel builder** — `buildVoxelRequest.ts` sends `computeSectionFill` regions to the backend; pass the same along positions so the 3-D model inherits the corrected geometry. Unit test green.
- [ ] **Step 3: Commit each file** — `git commit -m "feat(sections): pass along positions to the substrate pass"` / `…(voxel): …`.

---

## PHASE 6 — Validation (the load-bearing check — DO it, don't assert it)

### Task 8: End-to-end + real-data + visual

- [ ] **Step 1: Real gate 0/0/correct** — `CS1_GATE=1 npx vitest run src/renderer/src/utils/partitionFill.cs1void.test.ts` → all green.
- [ ] **Step 2: Full suites** — `npx vitest run` (whole desktop suite) + `npx tsc --noEmit -p tsconfig.web.json`. Green.
- [ ] **Step 3: Visual** — regenerate the real-CS1 render (`scripts/throwaway_cs1_render_filled.py` / the `cs1render` harness) and confirm in the browser the green-circled clay blob is GONE and the sand runs straight behind S7a/S7/S6. Compare against the canonical bug image.
- [ ] **Step 4: e2e** — close the dev app first, then `.\scripts\run-e2e.ps1 flow_correlate` + section flows. Green.
- [ ] **Step 5: Owner dogfeed handoff** — open `test.strix`, eyeball CS1/CS2/CS3 Fill bands, then re-Build the 3-D model and confirm the slice is truthful (the 2-D reflects immediately; the 3-D needs the Build).

---

## Out of scope (do NOT implement here)
- The 3-D voxel labeller (inherits the corrected partition).
- Auto-correlate, geological-model bounding.
- Two-sided lens authoring / body admixture below TD (Phase 5).

---

## Self-review notes (author check)
- **Spec coverage:** §3 rule 1 (deep-to-deep) → Task 3; rule 2 (matching/facies) → Task 3 (reuses emitGap); rule 3 (one-sided sideways) → Task 3 open-bracket; rule 4 (2+ shallow) → Task 3 RUN-2 test; rule 5 (bottom-tie boundary) → substrate elevation clip; rule 6 (no overlap) → Task 1 gate; §4 architecture → Tasks 2–5; §5 removal → Task 6; §6 gates → Tasks 1 + 8; §7 risk (disentangle) → Task 4 cap-with-baseline.
- **Real-gate-is-arbiter** enforced at Task 1 (before any fix), Task 5 (cutover), Task 8 (final) — never synthetic-only.
- **Honest unknowns flagged, not hidden:** Task 4 (cap boundary) + Task 3 (slice/bracket geometry) are TDD/gate-driven discoveries with a concrete first test and the real gate forcing the finding — not vague TODOs.
