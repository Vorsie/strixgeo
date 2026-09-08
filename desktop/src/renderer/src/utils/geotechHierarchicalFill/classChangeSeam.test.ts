/**
 * classChangeSeam.test.ts — owner ruling 2026-09-08 (installer #25 geotech dogfeed):
 *
 *   *"on S3 there are also no double correlation bands. It should emit a vertical seam in the middle
 *    because the packing class changes, this is an established rule."*
 *
 * On the geotech axis, a tie between the SAME lithology in two DIFFERENT NAD classes gives TWO bands
 * that meet at a VERTICAL SEAM at mid-gap, each class owning its own half — NOT one class flooding the
 * whole gap while the other draws nothing. Pinned against HIS two real cases, decoded from the geotech
 * axis extract into ``__fixtures__/class_change_seam_sections.json``:
 *   - Cross-section 3 gap 4: GEO-05/040-S3 VEEN class 29 (thin, +9.19..+8.26) vs GEO-10/117-B5 VEEN
 *     class 30 (thick, +9.00..+6.20). Both contacts tied, so both bands emit "nothing" (emitKernel);
 *     the quad PLUNGES below the thin unit's own base, and the thicker class used to flood the whole
 *     gap while the thin one drew nothing.
 *   - Tie-section 11 gap 0: 1411-GEO-23/126-B4 SILT class 16 (thin) vs GEO-23/125-S34 SILT class 15.
 *
 * The seam falls in the middle and the nearer test owns each half (``fillGap``'s ``constructOwner``
 * near-side rule). This is the geotech analog of the litho cross-lithology seam (ruling 5).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { auditedPartition, type RawSection } from '../geotech210Conformance.audit'
import { buildPackingClassOf } from './packingClassOf'
import type { SectionRegion } from '../sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = resolve(HERE, '__fixtures__/class_change_seam_sections.json')

const raw = JSON.parse(readFileSync(FIX, 'utf8')) as {
  nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
  sections: RawSection[]
}
const packingClassOf = buildPackingClassOf(Object.entries(raw.nadMeta))
const sectionOf = (name: string): RawSection => {
  const s = raw.sections.find((x) => x.name === name)
  if (!s) throw new Error(`fixture section missing: ${name}`)
  return s
}
const regionsFor = (name: string): SectionRegion[] => auditedPartition(sectionOf(name), packingClassOf, false).regions

/** Even-odd point-in-ring over (fraction, elevation). */
function inRegion(f: number, e: number, r: SectionRegion): boolean {
  const ring = r.polygon
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if (a.elevation > e !== b.elevation > e && f < a.fraction + ((e - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)) inside = !inside
  }
  return inside
}
const paintAt = (regs: readonly SectionRegion[], gap: number, f: number, e: number): SectionRegion | null => {
  let found: SectionRegion | null = null
  for (const r of regs) if (r.gapIndex === gap && inRegion(f, e, r)) found = r
  return found
}
const forLayer = (regs: readonly SectionRegion[], gap: number, suffix: string): SectionRegion[] =>
  regs.filter((r) => r.gapIndex === gap && (r.layerIds ?? []).some((l) => l.endsWith(suffix)))
const fracSpan = (r: SectionRegion): number => {
  const fs = r.polygon.map((p) => p.fraction)
  return Math.max(...fs) - Math.min(...fs)
}

describe('the packing class changes, so it emits a vertical seam in the middle (owner 2026-09-08)', () => {
  it('Cross-section 3 gap 4: the thin VEEN class 29 owns its half — it is not flooded out by class 30', () => {
    const regs = regionsFor('Cross-section 3')
    // The thin near class (S3 VEEN cls29, layer ...d7b566) is DRAWN — it does not stop dead at its column.
    const cls29 = forLayer(regs, 4, 'd7b566')
    expect(cls29.length, 'the thin VEEN class 29 is drawn in gap 4').toBeGreaterThan(0)
    // At a LEFT-half point in the plunging quad BELOW the thin unit's own flat base (+8.26) — exactly
    // where class 30 used to steal it — the paint is the near thin class, not the far flooding class.
    expect(paintAt(regs, 4, 0.3, 8.15)?.layerIds?.some((l) => l.endsWith('d7b566')), 'the left half below +8.26 is the near class 29').toBe(true)
    // The far class (B5 VEEN cls30, ...d3cb48) terminates at the seam — it does not flood full width.
    const cls30 = forLayer(regs, 4, 'd3cb48')
    expect(cls30.length, 'the far VEEN class 30 is drawn').toBeGreaterThan(0)
    expect(Math.max(...cls30.map(fracSpan)), 'class 30 terminates at the mid-gap seam, it does not flood full width').toBeLessThan(0.9)
  })

  it('Tie-section 11 gap 0: the thin SILT class 16 is drawn and class 15 does not flood the whole gap', () => {
    const regs = regionsFor('Tie-section 11')
    const cls16 = forLayer(regs, 0, '9b54e8')
    expect(cls16.length, 'the thin SILT class 16 is drawn in gap 0').toBeGreaterThan(0)
    const cls15 = forLayer(regs, 0, '79db31')
    expect(cls15.length, 'the SILT class 15 is drawn').toBeGreaterThan(0)
    expect(Math.max(...cls15.map(fracSpan)), 'class 15 terminates at the seam, it does not flood full width').toBeLessThan(0.9)
  })
})
