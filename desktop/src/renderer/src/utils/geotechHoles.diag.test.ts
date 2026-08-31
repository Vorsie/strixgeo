/**
 * NO HOLES IN THE MODEL — the owner's absolute, measured GEOMETRICALLY.
 *
 * Owner, 2026-08-21 late night, on a pale near-vertical line in the B3|S9 gap:
 * *"it is all silted, the crack has a boundary at the bottom but not at the
 * top, it shouldn't be there, no holes in the model remember."*
 *
 * The coverage gate (``geotechHierarchicalCoverage.diag``) samples a 60×60
 * raster per gap, so on a 24 m section one cell is ~0.4 m — a 4 cm crack is
 * ten times smaller than the finest thing it can see, and it reported HOLE=0
 * while the crack was on screen. This gate never samples: it overlays the
 * litho frame rings with every painted region ring in one planar arrangement
 * and asks each traced FACE whether anything covers it. A crack of any width
 * above snap debris is a face, and a face is either covered or reported.
 *
 * Dormant unless GEOTECH_HOLES=1. Report: scripts/throwaway_geotech_holes.txt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { frameAlignedColumns } from './frameAlignedPartition'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { NEEDLE_WIDTH_M } from './geotechHierarchicalFill/dropNeedleSpurs'
import { overlayFaces, pointInRing } from './geotechHierarchicalFill/frameClipGeometry'
import { buildPackingClassOf } from './geotechHierarchicalFill/packingClassOf'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_holes.txt')

/**
 * Faces below this area are snap debris, not ground.
 *
 * In fraction × metre units; a gap is 1 wide, so 1e-6 is a strip a micrometre
 * of the gap width tall — orders of magnitude under the arrangement's own
 * 1 mm snap grid, and far under the ~4 cm crack this gate exists to catch.
 */
const DEBRIS_AREA = 1e-6

/**
 * How close to a painted region's boundary still counts as covered.
 *
 * A traced face's interior sample can land within float noise of an edge the
 * face SHARES with a painted region, and a strict point-in-ring then answers
 * "outside" for ground that is plainly painted — measured at 3.2e-4 on the
 * CS1 gap-8 clay, which this gate first reported as a 9.5 m² hole. The
 * arrangement snaps to a 1 mm grid, so 3 mm is generous at snap scale and
 * still an order of magnitude under the ~4 cm cracks the gate exists to see.
 */
const EDGE_TOL = 3e-3

/** Distance from a point to a ring's boundary, in ring units. */
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

/** Is this point painted — inside a region, or grazing one's boundary? */
function covered(
  x: number,
  y: number,
  regions: readonly SectionRegion[],
): boolean {
  return regions.some(
    (r) => pointInRing(x, y, r.polygon) || distanceToRing(x, y, r.polygon) <= EDGE_TOL,
  )
}

interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
}
interface RawArm {
  columns: RawColumn[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}
interface RawSection extends RawArm {
  name: string
  geotech: RawArm
}

function assemble(arm: RawArm): {
  columns: PartitionColumn[]
  alongM: number[]
  edges: CorrelationEdge[]
} {
  const paired = arm.columns
    .map((c, i) => ({ c, a: arm.alongM[i] }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    .sort((p, q) => p.a - q.a)
  return {
    columns: paired.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
    })),
    alongM: paired.map(({ a }) => a),
    edges: arm.edges.map((e) => ({
      a: e.a,
      b: e.b,
      aSide: (e.aSide ?? 'top') as 'top' | 'base',
      bSide: (e.bSide ?? 'top') as 'top' | 'base',
    })),
  }
}

/** Ring area in fraction × metre units. */
function ringArea(ring: readonly { fraction: number; elevation: number }[]): number {
  let twice = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    twice += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return Math.abs(twice) / 2
}

describe('no holes in the model (geometric)', () => {
  if (process.env.GEOTECH_HOLES !== '1' || !existsSync(INPUT)) {
    it.skip('dormant — set GEOTECH_HOLES=1 with the real dump present', () => {})
    return
  }
  it('every litho face is painted by a class or the correlate-me hatch', () => {
    const NL = String.fromCharCode(10)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      refinementBundle: {
        nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
      }
    }
    const packingClassOf = buildPackingClassOf(Object.entries(raw.refinementBundle.nadMeta))
    const lines: string[] = ['=== geometric hole audit (litho face not painted) ===']
    let worstAreaM2 = 0
    let totalHoles = 0

    for (const sec of raw.sections) {
      const L = assemble(sec)
      if (L.columns.length < 2) continue
      const G = assemble(sec.geotech)
      const empty = new Map<string, BodyBoundaryResponse>()
      const lithoRegions = computeSectionFillActive(
        L.columns,
        L.edges,
        deriveSectionApexOverrides(L.columns, L.edges, L.alongM, empty),
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
      let sectionHoles = 0
      let sectionAreaM2 = 0
      for (let gap = 0; gap + 1 < L.alongM.length; gap++) {
        const frame = byGap(lithoRegions, gap)
        if (frame.length === 0) continue
        const painted = [...byGap(out.regions, gap), ...byGap(out.lithoFallback, gap)]
        // NEGATIVE CONTROL (GEOTECH_HOLES_SABOTAGE=1): drop the biggest painted
        // region of every gap. A gate that reports zero holes must report them
        // when ground genuinely goes unpainted — otherwise "0" only means the
        // measurement is blind (which is exactly what the raster coverage gate
        // was doing at 60×60).
        if (process.env.GEOTECH_HOLES_SABOTAGE === '1' && painted.length > 1) {
          let worst = 0
          for (let i = 1; i < painted.length; i++) {
            if (ringArea(painted[i].polygon) > ringArea(painted[worst].polygon)) worst = i
          }
          painted.splice(worst, 1)
        }
        const widthM = Math.abs(L.alongM[gap + 1] - L.alongM[gap])
        // ONE arrangement of frame + paint: a crack between two painted
        // regions is a face of it, however thin, and needs no sampling.
        const faces = overlayFaces(
          [...frame.map((r) => r.polygon), ...painted.map((r) => r.polygon)],
          `holes-${gap}`,
        )
        for (const face of faces) {
          const area = ringArea(face.ring)
          if (area <= DEBRIS_AREA) continue
          // ONE definition of "thinner than ground", shared with the engine
          // (``dropNeedleSpurs``): a face narrower than the needle width is
          // snap debris on either side of the ledger — the engine drops such
          // slivers rather than painting hairlines, so the audit must not
          // then call the same geometry a hole. Measured in true metres,
          // matching the engine (2026-08-22): fraction alone is not a
          // distance, and this gate's own gap width is right above.
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
          if (covered(fraction, elevation, painted)) continue
          sectionHoles += 1
          const areaM2 = area * widthM
          sectionAreaM2 += areaM2
          worstAreaM2 = Math.max(worstAreaM2, areaM2)
          if (sectionHoles <= 12) {
            lines.push(
              `  ${sec.name} gap${gap} area=${areaM2.toFixed(4)} m² ` +
                `sample=(${fraction.toFixed(3)},${elevation.toFixed(3)}) ` +
                `ring=${face.ring
                  .map((p) => `(${p.fraction.toFixed(3)},${p.elevation.toFixed(2)})`)
                  .join('')}`,
            )
          }
        }
      }
      totalHoles += sectionHoles
      lines.push(
        `${sec.name.padEnd(18)} holes=${sectionHoles} area=${sectionAreaM2.toFixed(3)} m²`,
      )
    }

    lines.push(`TOTAL holes=${totalHoles} worst=${worstAreaM2.toFixed(4)} m²`)
    writeFileSync(OUT, lines.join(NL) + NL)
    // eslint-disable-next-line no-console
    console.log(lines.filter((l) => !l.startsWith('  ')).join(NL))
    // The owner's absolute, 2026-08-21: "no holes in the model remember."
    expect(totalHoles, `see ${OUT}`).toBe(0)
  })
})
