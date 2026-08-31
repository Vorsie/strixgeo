/**
 * partitionFillV2.groundTruth.diag.test.ts — the GROUND-TRUTH (no-overpaint) HARD GATE.
 *
 * THE INVARIANT ("columns are ground truth", ruling 8k). A drilled unit MUST render its OWN
 * lithology at its OWN column edge. This is the data-loss invariant the 2/1/0 SHAPE conformance
 * gate only checks by PROXY: a shape rule (corr→lens/onlap/band) can be a false positive when the
 * geometry is correct (a dipping band, a sub-TD substrate wedge, a split band component), so the
 * shape gate cannot be driven to zero honestly without an INDEPENDENT check that no drilled litho
 * was actually replaced. This gate is that check — the thing we truly care about.
 *
 * METHOD. For every gap of all 14 real sections (flag-ON engine), sample each drilled unit of both
 * facing columns at 25/50/75 % of ITS OWN thickness (never at a contact, so a ≤snap-epsilon
 * boundary sample can never masquerade as overpaint) and assert the fill at that column edge
 * contains the drilled unit's formation. A hit here is genuine hidden data loss the holes/overlaps
 * gate cannot see (the space is filled — with the WRONG litho).
 *
 * Currently GREEN (0 overpaint across all sections). It goes RED the moment the engine floods a
 * drilled unit with a foreign formation — the exact regression class the safe-default repair pass
 * (`detectFloodedUnits`) and the conformance advisories are trusted to prevent. Flag-ON path.
 *
 * Runs unconditionally (no env gate) — this is a hard invariant, not an opt-in audit. Skips only
 * when the extracted real-section input is absent.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type PartitionPoint, type SectionRegion } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const INPUT = resolve(HERE, '../../../../..', 'scripts/diag_allsections_input.json')
const present = existsSync(INPUT)

/** Ray-cast point-in-polygon on the (fraction, elevation) plane. */
function pip(poly: readonly PartitionPoint[], f: number, e: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].fraction, yi = poly[i].elevation, xj = poly[j].fraction, yj = poly[j].elevation
    if (yi > e !== yj > e && f < ((xj - xi) * (e - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

interface Overpaint {
  section: string
  gap: number
  side: 'left' | 'right'
  investigation: string
  elev: number
  drilled: string
  fill: string
}

/** Collect every drilled-unit sample whose column-edge fill omits the drilled formation. */
function findOverpaint(raw: any): Overpaint[] {
  const nameOf = (id: string): string => raw.formationNames[id] ?? id.slice(-4)
  const out: Overpaint[] = []
  for (const sec of raw.sections) {
    const keep = sec.columns.filter((c: any) => c.surfaceElevM != null && c.units.length > 0)
    if (keep.length < 2) continue
    const columns: PartitionColumn[] = keep.map((c: any) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM,
      units: c.units,
    }))
    const alongM = sec.columns.map((_: any, i: number) => sec.alongM[i]).slice(0, keep.length)
    const edges: CorrelationEdge[] = sec.edges.map((e: any) => ({
      a: e.a,
      b: e.b,
      aSide: e.aSide ?? 'top',
      bSide: e.bSide ?? 'top',
    }))
    const prev = setTwoSidedTerminations(true)
    let regions: SectionRegion[]
    try {
      regions = computeSectionFillV2(columns, edges, undefined, alongM)
    } finally {
      setTwoSidedTerminations(prev)
    }
    for (let gi = 0; gi + 1 < keep.length; gi++) {
      const gr = regions.filter((r) => r.gapIndex === gi)
      if (gr.length === 0) continue
      for (const [side, c, f] of [
        ['left', keep[gi], 0.02] as const,
        ['right', keep[gi + 1], 0.98] as const,
      ]) {
        for (const u of c.units) {
          const top = c.surfaceElevM - u.topDepthM
          const base = c.surfaceElevM - u.baseDepthM
          const drilled = nameOf(u.formationId)
          for (const frac of [0.25, 0.5, 0.75]) {
            const e = top - frac * (top - base)
            const fillHere = gr.filter((r) => pip(r.polygon, f, e)).map((r) => nameOf(r.formationId))
            // Only a POSITIVE, wrong reading is overpaint. A sample that lands in a vacant sliver
            // (no fill at all) is a hole — that is the holes/overlaps gate's job, not this one.
            if (fillHere.length > 0 && !fillHere.includes(drilled)) {
              out.push({ section: sec.name, gap: gi, side, investigation: c.investigationId.slice(-4), elev: e, drilled, fill: fillHere.join(',') })
            }
          }
        }
      }
    }
  }
  return out
}

describe('ground-truth: no drilled unit is overpainted by a foreign litho (flag-ON, all sections)', () => {
  const maybe = present ? it : it.skip
  maybe('every drilled unit renders its own litho at its own column edge', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as any
    const bad = findOverpaint(raw)
    const report = bad
      .map((b) => `${b.section} g${b.gap} ${b.side}(${b.investigation}) e=${b.elev.toFixed(2)} drilled=${b.drilled} fill=${b.fill}`)
      .join('\n  ')
    expect(bad, `OVERPAINT — a drilled unit was replaced by a foreign litho (hidden data loss):\n  ${report}`).toEqual([])
  })
})
