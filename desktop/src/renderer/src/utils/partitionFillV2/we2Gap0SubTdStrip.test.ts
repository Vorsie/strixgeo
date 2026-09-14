/**
 * we2Gap0SubTdStrip.test.ts — the CS2 gap-0 "small black rectangle" (owner, installer #37).
 *
 * Owner's words: *"the small black rectangle is still there. it sits left of Sand(f)-D top
 * boundary between -4.4 mtaw and -4.8 mtaw"* on Cross-section 2, gap 0, between the shallow
 * borehole GEO-99/201-B1 (its terminal depth -4.32 mTAW) and the CPT GEO-25/021-S23.
 *
 * The strip -4.32..-4.69 mTAW was an UNFILLED HOLE in the litho partition: B1's deepest ZAND
 * ends at B1's TD (-4.32), and S23's deep ZAND(GL) substrate starts at -4.69 — but S23's ZAND
 * unit (-2.52..-4.69) STRADDLES B1's TD, so its sub-TD sliver (-4.32..-4.69) was owned by
 * neither the above-TD band (capped flat at the shallow TD) nor the sub-TD lens pass (which only
 * took units ENTIRELY below the TD). On the geotech axis the empty litho strip's frame drew as a
 * near-black rectangle; on the litho axis the strip itself was a hole.
 *
 * THE RULE (docs/design/section-fill.md sub-TD rules; owner's absolute "no holes in the model"):
 * below a shallow column's terminal depth the ground belongs to the substrate the deep column
 * shows there — a column that read nothing is not a boundary — so the deep sand continues under
 * B1's TD to meet the shallow column's base; it must never leave a strip.
 *
 * Real data: the committed decode of the owner's worked example (Cross-section 2 of
 * ``../geotechHierarchicalFill/__fixtures__/we2_cross_section_2.json``, 7 litho columns, B1 = col
 * 0, S23 = col 1). Run under the flag-ON product sweep (mirrors the app + the conformance gate).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'
import { computeSectionFillV2 } from './computeSectionFillV2'
import { lithoOutlineEdges } from '../lithoOutlineEdges'
import { setTwoSidedTerminations } from './tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = resolve(HERE, '../geotechHierarchicalFill/__fixtures__/we2_cross_section_2.json')
const raw = JSON.parse(readFileSync(FIX, 'utf8')) as {
  formationNames: Record<string, string>
  sections: {
    name: string
    columns: { investigationId: string; investigationName?: string; surfaceElevM: number; units: PartitionColumn['units'] }[]
    edges: { a: string; b: string; aSide?: string; bSide?: string }[]
    alongM: number[]
  }[]
}
const cs2 = raw.sections.find((s) => s.name.includes('Cross-section 2'))!
// The litho soil is the leading token of the litho formation's name ("ZAND", "ZAND (GL:|KL:)" →
// ZAND) — the fixture carries names, and the outline pass keys colour/dissolve on that soil.
const SOIL_RE = /^(ZAND|SILT|KLEI|VEEN|LEEM|GRIND)/
const soilByFormationId = new Map<string, string | null>(
  Object.entries(raw.formationNames).map(([fid, name]) => [fid, name.match(SOIL_RE)?.[1] ?? null]),
)

const columns: PartitionColumn[] = cs2.columns.map((c) => ({
  investigationId: c.investigationId,
  surfaceElevM: c.surfaceElevM,
  units: c.units,
}))
const alongM = cs2.alongM
const edges: CorrelationEdge[] = cs2.edges.map((e) => ({
  a: e.a,
  b: e.b,
  aSide: (e.aSide ?? 'top') as 'top' | 'base',
  bSide: (e.bSide ?? 'top') as 'top' | 'base',
}))

// B1 (col 0) terminal depth and S23 (col 1) deep-ZAND base — the strip is between them.
const B1_TD = -4.32 // GEO-99/201-B1 deepest ZAND base (collar 6.68, depth 11.00)
const S23_ZANDGL_TOP = -4.69 // GEO-25/021-S23 deep ZAND(GL) top (its ZAND unit's base)

/** Elevation intervals a vertical scan-line at ``frac`` crosses inside one region polygon. */
function crossAt(poly: { fraction: number; elevation: number }[], frac: number): [number, number][] {
  const ys: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    if (a.fraction === b.fraction) continue
    const lo = Math.min(a.fraction, b.fraction), hi = Math.max(a.fraction, b.fraction)
    if (frac < lo || frac > hi) continue
    const t = (frac - a.fraction) / (b.fraction - a.fraction)
    ys.push(a.elevation + t * (b.elevation - a.elevation))
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]])
  return out
}

/** The gap-0 regions of the flag-ON litho fill. */
function gap0(): SectionRegion[] {
  return computeSectionFillV2(columns, edges, undefined, alongM).filter((r) => r.gapIndex === 0)
}

beforeAll(() => setTwoSidedTerminations(true))
afterAll(() => setTwoSidedTerminations(false))

describe('CS2 gap 0 — no strip under B1 terminal depth (installer #37 black rectangle)', () => {
  it('the litho does not have a hole there: the strip -4.32..-4.69 is covered at every fraction', () => {
    const regs = gap0()
    // Sample a mid-strip elevation the owner points at (-4.5 mTAW, between B1's TD and S23's deep
    // ZAND(GL) top). Every scan-line across the gap must cover it — the substrate reaches the
    // shallow column, no strip.
    const midStrip = (B1_TD + S23_ZANDGL_TOP) / 2 // -4.505
    for (const f of [0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 0.9]) {
      const covered = regs.some((r) => crossAt(r.polygon, f).some(([lo, hi]) => lo - 1e-6 <= midStrip && midStrip <= hi + 1e-6))
      expect(covered, `strip elevation ${midStrip.toFixed(2)} mTAW must be covered at fraction ${f}`).toBe(true)
    }
  })

  it('the substrate reaches the shallow column: the strip is filled with the deep test SAND (ZAND), not a foreign litho', () => {
    const regs = gap0()
    const midStrip = (B1_TD + S23_ZANDGL_TOP) / 2
    // Near the B1 side (frac 0.05) the strip belongs to S23's ZAND continuing under B1's TD.
    const owner = regs.find((r) => crossAt(r.polygon, 0.05).some(([lo, hi]) => lo - 1e-6 <= midStrip && midStrip <= hi + 1e-6))
    expect(owner, 'a region covers the strip near the B1 column').toBeTruthy()
    expect(soilByFormationId.get(owner!.formationId), 'the strip is SAND (the deep test unit continuing), not silt/clay').toBe('ZAND')
  })

  it('the litho frame draws no closed black rectangle across gap 0 below B1 terminal depth', () => {
    const regs = gap0()
    const gapWidthM = (gi: number): number => Math.abs(alongM[gi + 1] - alongM[gi])
    const outline = lithoOutlineEdges(regs, soilByFormationId, gapWidthM).filter((s) => s.gapIndex === 0)
    // The rectangle's top (~-4.32) and base (~-4.69) were single-owner horizontal edges spanning
    // the gap (the empty strip's envelope). Once the strip is ZAND-filled — same soil as the band
    // above AND the ZAND(GL) below — both dissolve. Assert no near-horizontal outline segment sits
    // in the strip band spanning a real slice of the gap.
    const spanningHorizontalInStrip = outline.filter((s) => {
      const nearHorizontal = Math.abs(s.a.elevation - s.b.elevation) < 0.02
      const midElev = (s.a.elevation + s.b.elevation) / 2
      const inStripBand = midElev <= B1_TD + 0.05 && midElev >= S23_ZANDGL_TOP - 0.05
      const fracSpan = Math.abs(s.a.fraction - s.b.fraction)
      return nearHorizontal && inStripBand && fracSpan > 0.25
    })
    expect(
      spanningHorizontalInStrip.map((s) => `y=${((s.a.elevation + s.b.elevation) / 2).toFixed(2)} frac ${s.a.fraction.toFixed(2)}..${s.b.fraction.toFixed(2)}`),
      'no strip-framing horizontal outline in gap 0',
    ).toEqual([])
  })
})
