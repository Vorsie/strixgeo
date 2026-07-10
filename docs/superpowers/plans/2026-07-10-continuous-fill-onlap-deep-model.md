# Continuous-fill deep model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Below shallow TDs, fill the section continuously using ONLY real correlations — every bridging band continues across intervening shallow columns, 1-tie units onlap, 0-tie units pinch and the matrix connects — with no interpolation/substrate.

**Architecture:** Rework the `rewriteB` deep-fill in `desktop/src/renderer/src/utils/partitionFill.ts`. A bridging correlation (`computeSpanningBands`) currently under-covers: the deep SILT correlated S10↔S11 (jumping S8) is drawn only on the S10 side, dropped on the S11 side → a void. Fix the bridging band to be continuous, then ensure non-bridging units pinch and the matrix (adjacent bridging band) connects. Keep the shipped cross-litho tie-line clip. Remove the reverted substrate dead code.

**Tech Stack:** TypeScript, Vitest. Node 22 LTS. Real-data gates run with `REWRITE_B=1 CS1_GATE=1` / `CS1_TIECROSS=1`.

**The debugging discipline:** this is a debug-then-fix task. Every fix is instrument → prove the cause on the real CS1 data → change code → re-run the three gates TOGETHER. Never change code on a hypothesis without proving it against `scripts/throwaway_cs1_input.json` first. The three gates are the arbiter; a green synthetic test is necessary-not-sufficient (a fix has twice gone green synthetically while real CS1 stayed broken).

**The three arbiter gates (run all three after every change):**
```
REWRITE_B=1 CS1_GATE=1 npx vitest run src/renderer/src/utils/partitionFill.cs1void.test.ts       # target: 0 voids
REWRITE_B=1 CS1_GATE=1 npx vitest run src/renderer/src/utils/partitionFill.cs1frozen.test.ts     # must stay green (no overlaps)
REWRITE_B=1 CS1_TIECROSS=1 npx vitest run src/renderer/src/utils/partitionFill.cs1tiecross.test.ts # must stay green (no clay spilling)
```
Plus the full synthetic suite must stay green on BOTH paths:
```
npx vitest run src/renderer/src/utils/partitionFill.test.ts src/renderer/src/utils/partitionFill.oneGesture.test.ts src/renderer/src/utils/partitionFill.oneGesture.cs1.test.ts
REWRITE_B=1 npx vitest run src/renderer/src/utils/partitionFill.test.ts src/renderer/src/utils/partitionFill.oneGesture.test.ts src/renderer/src/utils/partitionFill.oneGesture.cs1.test.ts
```

Spec: `docs/superpowers/specs/2026-07-10-continuous-fill-onlap-deep-model-design.md`.

**Process rule (owner):** pause `npm run dev` before editing `partitionFill.ts` — HMR hot-pushes intermediate states into the owner's live app. Commit per-file, Conventional Commits, co-author `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Do NOT push. Do NOT `--no-verify`.

---

### Task 1: Pin the bridging-band discontinuity with a synthetic RED test

A bridging band (deep unit correlated across a too-shallow middle column) must be ONE continuous body — present in BOTH gaps at the middle column, not just one side. `partitionFill.test.ts` CASE 1 already proves the deep sand *bands* across a shallow middle column, but only samples the LEFT gap. Add a continuity assertion that samples the middle column from BOTH gaps.

**Files:**
- Test: `desktop/src/renderer/src/utils/partitionFill.test.ts` (the `reduceColumn reach guard` describe block, next to CASE 1 near line 1814)

- [ ] **Step 1: Write the failing test** — add after CASE 1's `it(...)` block:

```typescript
  it('CASE 1b — a bridged deep band is CONTINUOUS: present at the middle column from BOTH gaps', () => {
    // Same L/M/R as CASE 1: deep SAND (body "deep") correlated L↔R across the
    // too-shallow middle column M (TD 3.5 m). Continuous fill (spec 2026-07-10):
    // the band must reach the middle column M from the LEFT gap (gap 0) AND the
    // RIGHT gap (gap 1) at the sand's mid-elevation (-10 m). A band that is drawn
    // on one side only leaves a void under M — the deep-silt bug on real CS1.
    const L = col('L', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'a' },
      { top: 2, base: 8, f: 'CLAY', b: 'mL' },
      { top: 8, base: 12, f: 'SAND', b: 'deep' },
      { top: 12, base: 20, f: 'CLAY', b: 'botL' },
    ])
    const M = col('M', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'a' },
      { top: 2, base: 3.5, f: 'CLAY', b: 'mM' },
    ])
    const R = col('R', 0, [
      { top: 0, base: 2, f: 'SAND', b: 'a' },
      { top: 2, base: 8, f: 'CLAY', b: 'mR' },
      { top: 8, base: 12, f: 'SAND', b: 'deep' },
      { top: 12, base: 20, f: 'CLAY', b: 'botR' },
    ])
    const regions = sf(L, M, R)
    // gap 0 = L→M, its RIGHT edge (fraction ~1) is column M. gap 1 = M→R, its
    // LEFT edge (fraction ~0) is column M. The deep SAND must cover BOTH at -10.
    expect(coverAt(regions, 0, 0.98, -10)).toContain('SAND') // M from the left gap
    expect(coverAt(regions, 1, 0.02, -10)).toContain('SAND') // M from the right gap
  })
```

- [ ] **Step 2: Run it on BOTH paths to see how it currently behaves**

Run:
```
cd desktop
REWRITE_B=1 npx vitest run src/renderer/src/utils/partitionFill.test.ts -t "CASE 1b"
npx vitest run src/renderer/src/utils/partitionFill.test.ts -t "CASE 1b"
```
Expected: identify which side fails. Record which `expect` is RED (the discontinuity side) in the commit message. If BOTH pass, the synthetic case does not reproduce the real-CS1 drop — proceed to Task 2 which reproduces on real data (the synthetic is necessary-not-sufficient).

- [ ] **Step 3: Commit the test (RED or documenting-the-gap)**

```
git add src/renderer/src/utils/partitionFill.test.ts
git commit -m "test(litho): pin bridging-band continuity — deep band present at middle col from both gaps"
```

---

### Task 2: Prove WHERE the real-CS1 bridging silt is dropped (instrument, don't guess)

The real defect: `computeSpanningBands` lists the deep SILT (S10 col9 ↔ S11 col7) as a valid span candidate, so it should emit a band in gap 7 AND gap 8 — but the final output has silt only in gap 8. Prove whether it is (a) never emitted by `computeSpanningBands` for gap 7, or (b) emitted then removed by a downstream carve (`exemptBandsByGap` final carve / `makeGapRegionsDisjoint` / overlay carve).

**Files:**
- Modify (temporary instrumentation): `desktop/src/renderer/src/utils/partitionFill.ts`
- Diagnostic harness (already present): `desktop/src/renderer/src/utils/partitionFill.dumpregions.throwaway.test.ts` (env `DUMP_REGIONS=1 GAPS=7,8`)

- [ ] **Step 1: Instrument `computeSpanningBands` emission**

In `computeSpanningBands`, immediately before `result.push(...)` (≈ line 3774), add an env-gated log:

```typescript
      if (typeof process !== 'undefined' && process.env?.SPAN_TRACE) {
        // eslint-disable-next-line no-console
        console.error(
          `SPAN emit gap${g} ${band.formationId.slice(-6)} elev[${Math.min(...clipped.map((p) => p.elevation)).toFixed(2)}..${Math.max(...clipped.map((p) => p.elevation)).toFixed(2)}]`,
        )
      }
```

- [ ] **Step 2: Run the emission trace on real CS1**

Run:
```
REWRITE_B=1 CS1_GATE=1 SPAN_TRACE=1 npx vitest run src/renderer/src/utils/partitionFill.cs1void.test.ts --disableConsoleIntercept 2>&1 | grep "SPAN emit gap7"
```
Expected: reveals whether a SILT band is emitted for gap 7. Record the finding:
- **If a SILT gap7 line appears** → the band IS emitted; the drop is downstream (a carve). Go to Step 3.
- **If NO SILT gap7 line appears** → the band is never emitted (a `computeSpanningBands` bug — likely the clip `clipPolyBelowElev(quad, shallowTd)` with `shallowTd` = the wrong floor, or the band dedup). Note it and skip to Task 3.

- [ ] **Step 3: If emitted-then-dropped — bisect the downstream carves**

The carves run in `computeSectionFill` after the spanning push: the overlay carve (≈4735), the `exemptBandsByGap` final carve (≈4818), `mergeSplitBodyRegions` (≈4835), `makeGapRegionsDisjoint` (≈4844). Add the env-gated final dump before `return out`:

```typescript
  if (typeof process !== 'undefined' && process.env?.SPAN_TRACE) {
    for (const r of out) {
      if (r.gapIndex === 7 && r.formationId.includes('0f2e06')) {
        // eslint-disable-next-line no-console
        console.error(`FINAL gap7 SILT src=${(r as { debugSrc?: string }).debugSrc}`)
      }
    }
  }
```
Run the same command; grep `FINAL gap7 SILT`. If the SPAN emit line exists but FINAL does not, temporarily comment each carve (guard with an env like `NO_CARVE`) one at a time and re-run to find which one removes it. **Prove the exact carve before fixing.**

- [ ] **Step 4: Commit the proven diagnosis (instrumentation stays env-gated)**

```
git add src/renderer/src/utils/partitionFill.ts
git commit -m "diag(litho): trace bridging-silt drop — prove emit vs carve on real CS1"
```

---

### Task 3: Fix bridging-band continuity so the deep silt spans both gaps

Apply the fix the Task-2 diagnosis proved. Two likely shapes — implement the one that matches the proven cause:

- **If never emitted (clip/floor bug):** in `computeSpanningBands`, the per-gap `shallowTd` clip drops the band on the S11 side. The band's below-cap portion must be kept for EVERY intervening gap. Verify `shallowTd = Math.max(leftFloorElev, rightFloorElev)` uses the intervening shallow column's floor, not the deep column's; the band at ~5 m elev must survive `clipPolyBelowElev(quad, 9.29)`. If the band is above the cap on the S11 side (both floors deep → cap very low), the clip wrongly discards it — the bridging band must NOT be cap-clipped at all where its own tied contacts define it; keep the band whole between its interpolated contacts.

- **If emitted-then-carved:** register the bridging span band so the offending carve skips it (same contract the tie-clip uses: mark it and exclude it as a carve minuend), OR reorder so the bridging band wins over the region that carves it.

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts` (`computeSpanningBands` and/or the carve site proven in Task 2)

- [ ] **Step 1: Apply the proven fix** (exact edit depends on Task 2 — the diagnosis names the file+line and the mechanism).

- [ ] **Step 2: Re-run the synthetic continuity test (Task 1)**

Run:
```
REWRITE_B=1 npx vitest run src/renderer/src/utils/partitionFill.test.ts -t "CASE 1b"
```
Expected: PASS (both `expect` green).

- [ ] **Step 3: Confirm on real CS1 — the deep silt now spans gap 7**

Run:
```
REWRITE_B=1 DUMP_REGIONS=1 GAPS=7,8 npx vitest run src/renderer/src/utils/partitionFill.dumpregions.throwaway.test.ts --disableConsoleIntercept
node -e 'const r=require("./../scripts/throwaway_dump_regions.json");console.log(r.filter(x=>x.gap===7&&x.formationId.includes("0f2e06")).length? "SILT in gap7 OK":"STILL MISSING")'
```
Expected: `SILT in gap7 OK`.

- [ ] **Step 4: Run all three gates + both synthetic paths**

Run the three arbiter gates and both synthetic suites (commands in the header). Expected: `cs1frozen` + `cs1tiecross` stay green; `cs1void` count DROPS (gap 7 deep-silt void gone); synthetic suites green on both paths. Record the `cs1void` before/after gap list.

- [ ] **Step 5: Commit**

```
git add src/renderer/src/utils/partitionFill.ts
git commit -m "fix(litho): bridging band continues across the intervening shallow column"
```

---

### Task 4: Onlap/pinch the non-bridging units so the matrix connects (drive cs1void → 0)

After Task 3, remaining `cs1void` voids are units below a shallow TD that do NOT bridge: they must pinch out (0 ties) toward the uncorrelated side and let the adjacent bridging band (the matrix) close over the vacated space — no interpolation. On CS1 this is the S11 upper-middle clay pinching toward S10 while the sand onlaps up.

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts` (the `rewriteB` deep-fill / spanning path)

- [ ] **Step 1: Instrument the remaining voids**

Run:
```
REWRITE_B=1 CS1_GATE=1 npx vitest run src/renderer/src/utils/partitionFill.cs1void.test.ts 2>&1 | grep GAP-
REWRITE_B=1 VOIDSCAN=1 GAPS=<offending-gap> npx vitest run src/renderer/src/utils/partitionFill.voidscan.throwaway.test.ts --disableConsoleIntercept
```
For each remaining void, prove from `throwaway_cs1_input.json` which real unit should occupy it and by which correlation (band vs onlap-of-the-matrix vs genuinely-uncorrelated). A genuinely-uncorrelated void is LEFT (spec: manual correlation later) — do NOT interpolate it; note it in the commit.

- [ ] **Step 2: Extend the matrix onlap so an adjacent bridging band closes over a pinched unit's vacated space**

The matrix band (e.g. the sand) must onlap up to the pinched unit's tied contact where the neighbour pinches. Reuse the existing onlap machinery (`emitGap` 1-tie onlap / the mixed-tie wedge) applied below the shallow TD. Implement the minimal change proven by Step 1; keep it `rewriteB`-only so the legacy substrate path stays byte-identical.

- [ ] **Step 3: Run all three gates + both synthetic paths**

Expected: `cs1void` → only genuinely-uncorrelated voids remain (ideally 0 on CS1); `cs1frozen` + `cs1tiecross` green; synthetic green on both paths. If a fix adds an overlap (frozen red) it reintroduced clay-spilling — revert and re-diagnose (do NOT ship voids-for-overlaps).

- [ ] **Step 4: Commit**

```
git add src/renderer/src/utils/partitionFill.ts
git commit -m "fix(litho): pinched units let the matrix band onlap over their vacated space"
```

---

### Task 5: Remove substrate dead code, final verification, clean up diagnostics

**Files:**
- Modify: `desktop/src/renderer/src/utils/partitionFill.ts`
- Delete: `desktop/src/renderer/src/utils/partitionFill.dumpregions.throwaway.test.ts` (throwaway)

- [ ] **Step 1: Remove the opt-in substrate-continuity path**

Delete the `SUBSTRATE_CONTINUITY` flag, the `if (SUBSTRATE_CONTINUITY ...)` substrate push under rewriteB, and the `SUBSTRATE_CONTINUITY` background-carve block. Keep the legacy `if (!rewriteB)` substrate (the non-rewriteB path is unchanged). Remove the Task-2 `SPAN_TRACE` instrumentation.

- [ ] **Step 2: Run the FULL desktop suite + tsc**

Run:
```
npx vitest run
npx tsc --noEmit -p tsconfig.web.json 2>&1 | grep partitionFill
```
Expected: full suite green, tsc clean for partitionFill.

- [ ] **Step 3: Run all three gates one final time**

Expected: `cs1void` at its target (0 or documented genuinely-uncorrelated remainder), `cs1frozen` + `cs1tiecross` green.

- [ ] **Step 4: Commit + remove throwaway**

```
git rm src/renderer/src/utils/partitionFill.dumpregions.throwaway.test.ts
git add src/renderer/src/utils/partitionFill.ts
git commit -m "refactor(litho): remove reverted substrate-continuity dead code"
```

- [ ] **Step 5: OWNER RENDER DOGFEED (the final arbiter)**

The gates are necessary, not sufficient. Ask the owner to dogfeed the live app on `test.strix` Cross-section 1 and confirm: the deep silt is ONE continuous band under S8 (no shift at S8), no clay below the correlation lines, no voids on zoom. Only after the owner confirms is the feature done. Any remaining hole the owner accepts is closed by manually drawing a correlation (spec: "walk over holes manually").

---

## Notes for the executor

- **The convergence case (owner spec addition):** when 2 contacts on one column both tie to a single point on the other, the band converges to a wedge/pinch at that point — the existing `taperWedgesToConvergence` / mixed-tie wedge shape. Do not treat it as a special case; the same interpolate-tied-contacts logic produces it.
- **Band continuity (owner spec addition):** a bridging band's tied contacts interpolate by along-distance across the intervening column, so it passes under the shallow column with no kink/shift. Verify the interpolation uses `colsAlong` (real metres), not column index, so it matches the warp-aware overlay render.
- **Never ship voids-for-overlaps.** Every prior wrong turn traded one for the other. `cs1void` and `cs1frozen` must both be satisfied by the SAME output.
