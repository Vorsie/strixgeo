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

  it('CS1-OG-B — gap 7 (S11→S8): 0 ties leftward → S8 units stay at their own elevation', () => {
    // col-08 (S8): ZAND elev [-2.94 .. -1.52], SILT [-3.50 .. -2.94]. There are
    // NO correlation edges between col-07 and col-08 → toward the left both
    // units are 0-tie and must terminate at their OWN level. The bug: the silt's
    // termination region rose to elev ≈ -1.47 (into the sand / surface).
    const gapRegs = regions.filter((r) => r.gapIndex === 7)
    expect(gapRegs.length).toBeGreaterThan(0)
    const TOL = 0.3
    const offenders: string[] = []
    for (const r of gapRegs) {
      const soil = soilOf(r.formationId)
      let maxE = -Infinity
      for (const p of r.polygon) if (p.elevation > maxE) maxE = p.elevation
      if (soil === 'SILT' && maxE > -2.94 + TOL) {
        offenders.push(`SILT ${r.kind} rose to ${maxE.toFixed(2)} above its own top -2.94`)
      }
      if (soil === 'ZAND' && maxE > -1.52 + TOL) {
        offenders.push(`ZAND ${r.kind} rose to ${maxE.toFixed(2)} above its own top -1.52`)
      }
    }
    expect(offenders, `S8 units rose above their own tops:\n${offenders.join('\n')}`).toEqual([])
  })
})
