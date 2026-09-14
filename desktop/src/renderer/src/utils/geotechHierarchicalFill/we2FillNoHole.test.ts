/**
 * we2FillNoHole.test.ts — owner finding on installer #36 (Cross-section 2, geotech axis):
 * *"why is there a hole here on cs2 between s1 and s2, the litho doesn't have a hole there?"*
 *
 * The rule, in his words: the litho frame has no hole there, so the geotech axis has none either.
 * The litho partition merged S1's shallow and deep SILT units into ONE region (a ZAND lens carved
 * between them) but named the region after the shallow piece only; the deep SILT unit (its own 0-tie
 * litho lens, carrying its own NAD-15 packing band) fell into a coverless singleton family, so its
 * band was never painted and a 19.5 m² triangle went unfilled directly under the correlation band.
 *
 * This gate loads Cross-section 2 of the owner's new worked example (``we2_cross_section_2.json``,
 * saved 2026-09-13) and overlays the litho frame rings with every painted geotech region in one
 * planar arrangement — the same geometric audit as ``geotechHoles.diag`` — asserting NO litho face
 * is left unpainted. A crack of any width above snap debris is a face, and a face is covered or it
 * is a hole. See docs/design/geotech-stage.md.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { deriveSectionApexOverrides } from '../buildVoxelRequest'
import { frameAlignedColumns } from '../frameAlignedPartition'
import { computeSectionFillActive } from '../partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../sectionPartition'
import { computeHierarchicalGeotechFill } from './index'
import { NEEDLE_WIDTH_M } from './dropNeedleSpurs'
import { overlayFaces, pointInRing } from './frameClipGeometry'
import { buildPackingClassOf } from './packingClassOf'

const HERE = dirname(fileURLToPath(import.meta.url))

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; investigationName?: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawArm { columns: RawCol[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[]; alongM: number[] }
interface RawSection extends RawArm { name: string; geotech: RawArm }
interface Fixture {
  sections: RawSection[]
  formationNames: Record<string, string>
  refinementBundle: { nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }> }
}

function assemble(arm: RawArm) {
  const paired = arm.columns
    .map((c, i) => ({ c, a: arm.alongM[i] }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    .sort((p, q) => p.a - q.a)
  return {
    columns: paired.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
    })) as PartitionColumn[],
    alongM: paired.map(({ a }) => a),
    edges: arm.edges.map((e) => ({
      a: e.a,
      b: e.b,
      aSide: (e.aSide ?? 'top') as 'top' | 'base',
      bSide: (e.bSide ?? 'top') as 'top' | 'base',
    })) as CorrelationEdge[],
  }
}

function ringArea(ring: readonly { fraction: number; elevation: number }[]): number {
  let twice = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    twice += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return Math.abs(twice) / 2
}

/** Distance from a point to a ring's boundary — the audit's grazing tolerance. */
function distanceToRing(
  x: number,
  y: number,
  ring: readonly { fraction: number; elevation: number }[],
): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b.fraction - a.fraction
    const dy = b.elevation - a.elevation
    const len = dx * dx + dy * dy
    if (len < 1e-18) continue
    let t = ((x - a.fraction) * dx + (y - a.elevation) * dy) / len
    t = Math.max(0, Math.min(1, t))
    best = Math.min(best, Math.hypot(x - (a.fraction + t * dx), y - (a.elevation + t * dy)))
  }
  return best
}

/** A point within 3 mm of a painted region's boundary counts as covered (audit EDGE_TOL). */
const EDGE_TOL = 3e-3

describe('geotech fill leaves no hole on the owner worked-example CS2', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(HERE, '__fixtures__', 'we2_cross_section_2.json'), 'utf8'),
  ) as Fixture
  const packingClassOf = buildPackingClassOf(Object.entries(fixture.refinementBundle.nadMeta))

  it('the litho frame has no hole, so the geotech axis has none either', () => {
    const sec = fixture.sections.find((s) => s.name === 'Cross-section 2')!
    const L = assemble(sec)
    const G = assemble(sec.geotech)
    const lithoRegions = computeSectionFillActive(
      L.columns,
      L.edges,
      deriveSectionApexOverrides(L.columns, L.edges, L.alongM, new Map()),
      L.alongM,
    )
    const out = computeHierarchicalGeotechFill({
      lithoColumns: L.columns,
      lithoEdges: L.edges,
      lithoRegions,
      geotechColumns: frameAlignedColumns(
        L.columns,
        new Map(G.columns.map((c) => [c.investigationId, c])),
      ),
      geotechEdges: G.edges,
      alongM: L.alongM,
      packingClassOf,
    })

    const byGap = <T extends SectionRegion>(rs: readonly T[], gap: number): T[] =>
      rs.filter((r) => r.gapIndex === gap)
    const holes: { gap: number; areaM2: number; sample: string }[] = []
    for (let gap = 0; gap + 1 < L.alongM.length; gap++) {
      const frame = byGap(lithoRegions, gap)
      if (frame.length === 0) continue
      const painted = [...byGap(out.regions, gap), ...byGap(out.lithoFallback, gap)]
      const widthM = Math.abs(L.alongM[gap + 1] - L.alongM[gap])
      const faces = overlayFaces(
        [...frame.map((r) => r.polygon), ...painted.map((r) => r.polygon)],
        `we2-${gap}`,
      )
      for (const face of faces) {
        const area = ringArea(face.ring)
        if (area <= 1e-6) continue
        // Snap-debris / needle filter, matching the engine + geotechHoles.diag: a face thinner than
        // the needle width is a hairline the engine deliberately drops, not a hole.
        let longestM = 0
        let twiceAreaM = 0
        for (let i = 0; i < face.ring.length; i++) {
          const a = face.ring[i]
          const b = face.ring[(i + 1) % face.ring.length]
          const ax = a.fraction * widthM
          const bx = b.fraction * widthM
          longestM = Math.max(longestM, Math.hypot(bx - ax, b.elevation - a.elevation))
          twiceAreaM += ax * b.elevation - bx * a.elevation
        }
        if (longestM > 0 && Math.abs(twiceAreaM) / longestM <= NEEDLE_WIDTH_M) continue
        const { fraction, elevation } = face.sample
        if (!frame.some((r) => pointInRing(fraction, elevation, r.polygon))) continue
        // Covered = inside a painted region OR grazing its boundary within EDGE_TOL,
        // the authoritative geometric-audit definition (geotechHoles.diag) — so a
        // snap sliver on a shared edge is not miscounted as a hole.
        if (
          painted.some(
            (r) =>
              pointInRing(fraction, elevation, r.polygon) ||
              distanceToRing(fraction, elevation, r.polygon) <= EDGE_TOL,
          )
        )
          continue
        holes.push({ gap, areaM2: area * widthM, sample: `(${fraction.toFixed(3)},${elevation.toFixed(2)})` })
      }
    }
    expect(
      holes,
      `geotech fill left ${holes.length} unpainted litho face(s): ${JSON.stringify(holes)}`,
    ).toEqual([])
  })
})
