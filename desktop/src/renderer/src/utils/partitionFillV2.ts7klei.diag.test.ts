/**
 * partitionFillV2.ts7klei.diag.test.ts — RED-FIRST gate for the SESSION-57 8m free-side
 * refinement (ruling 8k: "columns are ground truth — a picked unit's own interval may never
 * paint another litho").
 *
 * THE PREMISE (REWRITE_STATE.md §62, the sole S56 residual). Tie-section 7 gap 0:
 *   col0 = SILT(u0, top-band) / KLEI(u1) / 2af4(u2) / KLEI(u3, el 3.14..6.30) / SILT(u4)…
 *   col1 = SILT(u0, el 4.84..11.73, huge) / KLEI(u1, el 3.80..4.84)…
 * The surface SILT band (col0-u0 ↔ col1-u0, top-tied) is 8m-suppressed (same litho both
 * facings). With the 8l phantom SILT/KLEI separator gone AND that flank suppressed, ONE
 * multi-seed face x[0..62] el[3.14..11.73] carries col0-u0 SILT + col0-u3 KLEI and paints
 * SILT — the DRILLED KLEI(u3) renders as SILT (a ground-truth violation, ruling 8k).
 *
 * THE ASSERTION (must go RED on the S56 engine, GREEN after the refinement): sample the
 * interior of col0-u3 KLEI (fraction ~0, elevation ~4.7 mid-interval). The painted region
 * there MUST be KLEI (the unit's own picked litho), never SILT.
 *
 * Gate: SHAPE_AUDIT=1 (allowed audit env). Pure — deterministic. Delete at commit (throwaway).
 * Run (desktop/): SHAPE_AUDIT=1 npx vitest run src/renderer/src/utils/partitionFillV2.ts7klei.diag.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type PartitionColumn,
  type PartitionPoint,
  type SectionRegion,
} from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

const GATE = process.env.SHAPE_AUDIT === '1'

// TS7 formation ids (verified from diag_allsections_input.json).
const SILT = '019e940a-4b4e-7806-aa41-5831b60f2e06'
const KLEI = '019e940a-4b50-7f69-af85-2354e519bb43'

interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface RawCol {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
}
interface RawSection {
  sectionId: string
  name: string
  columns: RawCol[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}

/** Point-in-polygon (ray cast) in fraction×elevation space. */
function pointInPoly(poly: readonly PartitionPoint[], f: number, e: number): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].fraction
    const yi = poly[i].elevation
    const xj = poly[j].fraction
    const yj = poly[j].elevation
    const intersect = yi > e !== yj > e && f < ((xj - xi) * (e - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function prepare(sec: RawSection): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const keep = sec.columns.filter((c) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map((c) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = sec.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    .map(({ i }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, edges, alongM }
}

describe('TS7 gap0 drilled KLEI must paint KLEI (ruling 8k)', () => {
  it('col0-u3 KLEI interior is painted KLEI, not SILT', () => {
    if (!GATE) return
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const sec = raw.sections.find((s) => s.name === 'Tie-section 7')
    expect(sec, 'Tie-section 7 present').toBeTruthy()
    const { columns, edges, alongM } = prepare(sec!)
    const regions: SectionRegion[] = computeSectionFillV2(columns, edges, undefined, alongM)

    // (1) POINT PROBE — col0-u3 KLEI el[3.14..6.30] on the LEFT column (fraction 0) of gap 0.
    // Sample the mid-interval a hair inside the column; exclude lens overlays (the deliberate-
    // overlap layer) — the base paint is the quad/pinch beneath.
    const F = 0.02
    const E = 4.7
    const base = regions.filter((r) => r.gapIndex === 0 && r.kind !== 'lens' && pointInPoly(r.polygon, F, E))
    const paints = base.map((r) => r.formationId)
    // eslint-disable-next-line no-console
    console.log(`[TS7KLEI] gap0 @f${F} el${E}: base paints=${JSON.stringify(paints.map((p) => p.slice(-4)))}`)

    // (2) FULL-WIDTH INTRUSION SWEEP — across the KLEI band (interpolated col0 KLEI[3.14..6.30] →
    // col1 KLEI[3.80..4.84]): does ANY SILT region cover a point where the ground truth is KLEI?
    // §62 predicted the surface SILT swallows this band. Measured: 0 (the render is clean).
    let siltIntrusions = 0
    for (let fi = 0; fi <= 40; fi++) {
      const f = fi / 40
      const kTop = 6.3 + f * (4.84 - 6.3)
      const kBase = 3.14 + f * (3.8 - 3.14)
      for (let e = kBase + 0.1; e < kTop - 0.1; e += 0.25) {
        const here = regions.filter((r) => r.gapIndex === 0 && pointInPoly(r.polygon, f, e)).map((r) => r.formationId)
        if (here.includes(SILT) && !here.includes(KLEI)) siltIntrusions++
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[TS7KLEI] SILT-only intrusions into KLEI band: ${siltIntrusions}`)

    // (3) §62 EXACT-CLAIM CHECK — the claimed swallowing region "SILT frac[0..1] el[3.14..11.73]".
    const siltSpan = regions.filter((r) => {
      if (r.gapIndex !== 0 || r.formationId !== SILT) return false
      const es = r.polygon.map((p) => p.elevation)
      return Math.min(...es) < 3.5 && Math.max(...es) > 11.0
    })
    // eslint-disable-next-line no-console
    console.log(`[TS7KLEI] SILT regions spanning ~el[3.14..11.73]: ${siltSpan.length}`)

    // THE INVARIANT (ruling 8k): the drilled KLEI is the litho at its own interval. All three
    // measures agree in the current engine (S57): KLEI paints KLEI, 0 SILT intrusions, 0 swallow
    // region — the §62 "renders as SILT" premise does NOT reproduce against computeSectionFillV2.
    expect(paints, 'a base region covers the KLEI interval').not.toHaveLength(0)
    expect(paints, 'drilled KLEI(u3) must not paint SILT (ruling 8k ground truth)').not.toContain(SILT)
    expect(paints, 'drilled KLEI(u3) paints KLEI').toContain(KLEI)
    expect(siltIntrusions, 'no SILT region intrudes into the KLEI band').toBe(0)
    expect(siltSpan, 'no SILT region swallows el[3.14..11.73] (§62 claim)').toHaveLength(0)
  })
})
