/**
 * REAL-DATA arbiters for the one-gesture-per-side / 2-1-0 tie model
 * (owner-locked 2026-07-07), on the committed anonymised CS1 fixture.
 *
 * Synthetic cases (partitionFill.oneGesture.test.ts) are necessary but NOT
 * sufficient — the real bugs need real-CS1 ingredients (bridge injection from
 * jump edges, closeColumnGaps, the surface interval). Twice before, a fix went
 * green on synthetic fixtures while real CS1 stayed broken; these tests pin the
 * two 2026-07-07 dogfeed artifacts on the frozen real data:
 *
 *   CS1-OG-A (gap 16, B2→S7A): the silt has top↔top AND base↔TD (mixed) ties
 *     = 2 correlated contacts → BAND. No clay may wedge between the tied top
 *     and base lines (the owner's arrow: a clay sliver inside the gap).
 *   CS1-OG-B (gap 7, S11→S8): S8 has ZERO edges toward S11 → its sand + silt
 *     terminate at their OWN elevation toward the left (lens), never rising
 *     into the unit above / the surface (the rising-pinch double gesture).
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { computeSectionFill, type CorrelationEdge, type PartitionColumn } from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(HERE, './__fixtures__/cs1_geotech_frozen.json')

interface Frozen {
  columns: Array<{ investigationId: string; surfaceElevM: number | null; units: PartitionColumn['units'] }>
  edges: CorrelationEdge[]
  lithoSoil: Record<string, string>
}

const frozen: Frozen = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
const columns: PartitionColumn[] = frozen.columns
  .filter((c) => c.surfaceElevM != null)
  .map((c) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
const regions = computeSectionFill(columns, frozen.edges)

// Soil code per formation id (SILT / KLEI / ZAND / VEEN).
const soilOf = (formationId: string): string => frozen.lithoSoil[formationId] ?? '?'

/** Nonzero-winding point-in-polygon in (fraction, elevation) space. */
function inPoly(
  px: number,
  py: number,
  poly: readonly { fraction: number; elevation: number }[],
): boolean {
  let wn = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const isLeft =
      (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation)
    if (a.elevation <= py) {
      if (b.elevation > py && isLeft > 0) wn++
    } else {
      if (b.elevation <= py && isLeft < 0) wn--
    }
  }
  return wn !== 0
}

describe('CS1 one-gesture arbiters (real frozen data)', () => {
  // KNOWN-RED (documented open defect, 2026-07-07 — `it.fails` keeps the suite
  // green while pinning the defect; fixing it flips this test and forces the
  // marker's removal). The 2-tie silt band IS matched, but the per-gap CAP
  // (shallow-TD) clips its below-cap half and the tie-blind SUBSTRATE refills
  // that space from deep-to-deep stratigraphy — placing KLEI above the
  // interpolated silt, inside the declared band. A first fix attempt
  // (cap-exempt TD-tied bands + substrate carve) regressed 4 gate checks and
  // was reverted; the real fix must teach the cap/substrate contract that a
  // TD-tie pins the band's base line AT the shallow column. See
  // memory/project_partition_one_gesture_2_1_0.md for the full design notes.
  it.fails('CS1-OG-A — gap 16 (B2→S7A): 2-tie silt bands; no clay wedge between the tie lines', () => {
    // col-16 (B2): SILT elev [-4.74 .. -2.74]. col-17 (S7A): SILT [-2.37 .. -1.33].
    // Ties: top↔top (silt tops) + S7A-silt base (TD) ↔ B2 lower clay top (= the
    // B2 silt's base contact). Band lines:
    //   top:  (f=0, -2.74) → (f=1, -1.33)
    //   base: (f=0, -4.74) → (f=1, -2.37)
    // Sample the band interior at 3 heights per fraction; every covering
    // non-lens region must be SILT — a KLEI hit is the dogfeed clay wedge.
    const gapRegs = regions.filter((r) => r.gapIndex === 16)
    expect(gapRegs.length).toBeGreaterThan(0)
    const topAt = (f: number): number => -2.74 + f * (-1.33 - -2.74)
    const baseAt = (f: number): number => -4.74 + f * (-2.37 - -4.74)
    const MARGIN = 0.12 // stay clear of the exact tie lines (shared-edge noise)
    const offenders: string[] = []
    for (let k = 1; k <= 9; k++) {
      const f = k / 10
      const t = topAt(f) - MARGIN
      const b = baseAt(f) + MARGIN
      if (t <= b) continue
      for (const h of [0.25, 0.5, 0.75]) {
        const elev = b + h * (t - b)
        for (const r of gapRegs) {
          if (r.kind === 'lens') continue
          if (soilOf(r.formationId) === 'SILT') continue
          if (inPoly(f, elev, r.polygon)) {
            offenders.push(
              `${soilOf(r.formationId)} inside the 2-tie silt band at f=${f} elev=${elev.toFixed(2)}`,
            )
          }
        }
      }
    }
    expect(offenders, `matrix wedged into the banded silt:\n${offenders.join('\n')}`).toEqual([])
  })

  // KNOWN-RED (documented owner spec, 2026-07-07 dogfeed — `it.fails` keeps the
  // suite green; implementing the spec flips this test and forces the marker's
  // removal). Current engine: the silt is extracted as an onlap and the SAND
  // ABSORBS its span (`above.ownBaseDepth = u.ownBaseDepth` in the onlap-base
  // branch), so the sand's gesture extends below its own base and wedges over
  // both levels. Owner spec: BOTH 0-tie units are LENSES at their own
  // elevation; S11's clay floods the interval over them.
  // ⚠ IMPLEMENTATION CONFLICT (why this is not a quick fix): a strict
  // tie-count implementation (0-tie → lens + matrix flood) was built and
  // CONTRADICTED six previously-pinned owner behaviours — CT2 ("an unmatched
  // bed still pinches"), SEC3 (deep package connects), VOID-A /
  // sideways-under-shallow-TD, T-MIXED-OVER-PINCH, the substrate sideways
  // continuation, and OG1's onlap. Those pins encode earlier owner directives
  // (geometry-tier banding, sideways data-void rule) that the strict 2/1/0
  // model overrides in places. Reconciling WHICH old behaviours yield to the
  // new model is an owner decision list — see
  // memory/project_partition_one_gesture_2_1_0.md.
  it.fails('CS1-OG-B — gap 7 (S11→S8): 0 ties leftward → S8 units LENS at their own level, clay floods the gap', () => {
    // col-08 (S8): ZAND elev [-2.94 .. -1.52], SILT [-3.50 .. -2.94]. There are
    // NO correlation edges between col-07 and col-08 → toward the left both
    // units are 0-tie → LENS (owner 2/1/0 model, re-confirmed on dogfeed
    // 2026-07-07: "both layers on that test should just pinch out into a
    // lens"). S11 is clay through that whole interval, so away from S8's
    // column the gap is CLAY — not a sand wedge tapering to mid-gap, not a
    // silt onlap absorbed into it.
    const gapRegs = regions.filter((r) => r.gapIndex === 7)
    expect(gapRegs.length).toBeGreaterThan(0)
    const TOL = 0.3
    const offenders: string[] = []
    for (const r of gapRegs) {
      const soil = soilOf(r.formationId)
      if (soil !== 'SILT' && soil !== 'ZAND') continue
      let maxE = -Infinity
      let minF = Infinity
      for (const p of r.polygon) {
        if (p.elevation > maxE) maxE = p.elevation
        if (p.fraction < minF) minF = p.fraction
      }
      // Only S8's OWN units are gesture-checked: their zone is above S8's TD
      // (elev −3.50). S11's deep silt/sand bands below that are full-width
      // substrate stratigraphy and correct as-is.
      if (maxE <= -3.4) continue
      let minE = Infinity
      for (const p of r.polygon) if (p.elevation < minE) minE = p.elevation
      const ownTop = soil === 'SILT' ? -2.94 : -1.52
      const ownBase = soil === 'SILT' ? -3.5 : -2.94
      // One gesture, own elevation: never above the unit's own top…
      if (maxE > ownTop + TOL) {
        offenders.push(`${soil} ${r.kind} rose to ${maxE.toFixed(2)} above its own top ${ownTop}`)
      }
      // …and never below its own base (the sand absorbing the silt's span and
      // wedging over BOTH levels was the dogfeed screenshot).
      if (minE < ownBase - TOL) {
        offenders.push(`${soil} ${r.kind} extends to ${minE.toFixed(2)} below its own base ${ownBase}`)
      }
      // Lens gesture: anchored at S8's edge (f=1), reaching left a bounded
      // distance — never spanning toward S11's half of the gap.
      if (minF < 0.35) {
        offenders.push(
          `${soil} ${r.kind} reaches to f=${minF.toFixed(2)} — a gap-spanning wedge, not a lens`,
        )
      }
    }
    // One gesture per unit also means one unit per LEVEL: the sand may never
    // cover the silt's own elevation band away from the column (the absorbed-
    // silt wedge in the dogfeed screenshot covered [−3.5..apex] at full height).
    for (const f of [0.6, 0.75, 0.9]) {
      const atSiltLevel = gapRegs.filter((r) => inPoly(f, -3.2, r.polygon))
      const soils = [...new Set(atSiltLevel.map((r) => soilOf(r.formationId)))]
      if (soils.includes('ZAND')) {
        offenders.push(`ZAND covers the SILT level at (f=${f}, −3.2) — absorbed-silt wedge`)
      }
    }
    // The matrix at mid-gap is S11's CLAY (topmost cover — overlays included,
    // since a lens reaching past its bound would wrongly own the point), at
    // both the sand and silt levels, left of the lens reach (LENS_PINCH_FRACTION
    // = 0.45 from S8's edge → lenses live at f ≥ 0.55).
    for (const [label, elev] of [
      ['sand level', -2.2],
      ['silt level', -3.2],
    ] as const) {
      const covering = gapRegs.filter((r) => inPoly(0.45, elev, r.polygon))
      const soils = [...new Set(covering.map((r) => soilOf(r.formationId)))]
      if (soils.some((s) => s === 'ZAND' || s === 'SILT') || !soils.includes('KLEI')) {
        offenders.push(
          `left of lens reach @${label} (f=0.45, ${elev}): covered by [${soils.join(',')}] — expected KLEI only`,
        )
      }
    }
    expect(offenders, `gap-7 gesture violations:\n${offenders.join('\n')}`).toEqual([])
  })
})
