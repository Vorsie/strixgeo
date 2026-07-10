/**
 * ALWAYS-ON real-data watertightness gate for the geotech fraction-space
 * refinement (owner-locked, 2026-07-06).
 *
 * Loads the committed anonymised CS1 slice (litho partition input + geotech NAD
 * sub-band columns, snapshot 2026-07-06 from the dev DB via
 * ``scripts/throwaway_freeze_geotech_fixture.mjs``), runs the PRODUCTION
 * ``refineLithoPartition`` on the real ``computeSectionFill`` output, projects
 * to detector space with the fixture's real along-positions, and asserts the
 * refinement's core invariant: **zero genuine polygon overlaps** (by-design
 * opaque overlays excluded). This mirrors ``partitionFill.cs1frozen.test.ts``
 * — no env gate, no dev-DB dependency, runs on every ``npm test``.
 *
 * The env-gated live companion (``refineLithoPartition.cs1gate.test.ts``,
 * ``CS1_GATE=1``) adds the substrate pass + the full render on live dev-DB
 * data; this frozen file is the clean-checkout safety net.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { computeSectionFill, type CorrelationEdge, type PartitionColumn } from './partitionFill'
import {
  refineLithoPartition,
  type GeotechColumn,
  type NadFormationMeta,
  type RefinedPolygon,
} from './refineLithoPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(HERE, './__fixtures__/cs1_geotech_frozen.json')

interface Frozen {
  alongM: Record<string, number>
  columns: Array<{ investigationId: string; surfaceElevM: number | null; units: PartitionColumn['units'] }>
  edges: CorrelationEdge[]
  geotechColumns: GeotechColumn[]
  nadFormations: Record<string, NadFormationMeta>
  lithoSoil: Record<string, string>
}

const frozen: Frozen = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))

// ---------------------------------------------------------------------------
// Rebuild the inputs the renderer would pass, in section (along) order.
// ---------------------------------------------------------------------------

const columns: PartitionColumn[] = frozen.columns
  .filter((c) => c.surfaceElevM != null)
  .map((c) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
const columnOrder = columns.map((c) => c.investigationId)

const geotechColumns = new Map(frozen.geotechColumns.map((c) => [c.investigationId, c]))
const nadMeta = new Map(Object.entries(frozen.nadFormations))
const lithoSoil = new Map<string, string | null>(Object.entries(frozen.lithoSoil))

// Pass the REAL along-section spacing (the fixture already carries it, keyed by
// investigation). Without it computeSectionFill uses uniform spacing and the
// deep-to-deep substrate geometry diverges from the live render — the same gap
// that hid the S8 second-pinch. alongM must align 1:1 with ``columns``.
const alongM = columns.map((c) => frozen.alongM[c.investigationId] ?? 0)
const regions = computeSectionFill(columns, frozen.edges, undefined, alongM)
const refined = refineLithoPartition(regions, columnOrder, geotechColumns, nadMeta, lithoSoil)

// A refined polygon's packing identity, for the "one class per point" gate.
// The soil code AND the NAD class both matter: a sand region may never show a
// clay class at a point, and a sand region may never show two sand classes at
// one point.
const identityOf = (p: RefinedPolygon): string => {
  const m = nadMeta.get(p.formationId)
  if (m) return `${m.soilCode ?? '?'}:${m.nadClass ?? '?'}`
  return `litho:${lithoSoil.get(p.formationId) ?? '?'}` // fallback fill
}

// Even-odd point-in-polygon in (fraction, elevation) space.
function inPoly(px: number, pe: number, pts: readonly { fraction: number; elevation: number }[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (
      a.elevation > pe !== b.elevation > pe &&
      px < a.fraction + ((pe - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    )
      inside = !inside
  }
  return inside
}

const byGap = new Map<number, RefinedPolygon[]>()
for (const p of refined) {
  const l = byGap.get(p.gapIndex) ?? []
  l.push(p)
  byGap.set(p.gapIndex, l)
}
// A handful of cells on a shared edge get sampled as "inside both" by any grid
// point-in-polygon (the boundary is inclusive on both sides) — exactly the
// rasterisation-noise the litho gate absorbs with its own CELL_THRESHOLD. A
// genuine cross-class overlap is a solid patch of dozens of cells.
const CROSS_CLASS_CELL_THRESHOLD = 12

describe('CS1 frozen geotech-refinement gate (always-on)', () => {
  it('fixture: 24 litho columns + 24 geotech columns, edges present', () => {
    expect(frozen.columns).toHaveLength(24)
    expect(frozen.geotechColumns).toHaveLength(24)
    expect(frozen.edges.length).toBeGreaterThan(0)
  })

  it('refinement emits polygons across the section (no vacuous pass)', () => {
    // Teeth: an empty refinement would make the overlap assertion vacuously
    // green. The real CS1 has NAD sub-bands in almost every gap.
    expect(refined.length).toBeGreaterThan(100)
    const gaps = new Set(refined.map((p) => p.gapIndex))
    expect(gaps.size).toBeGreaterThanOrEqual(15)
  })

  it('the pinch/lens single-fill covers every non-quad region with exactly one class', () => {
    // A pinch/lens region is filled with its single dominant class (no internal
    // stratification) — so it contributes exactly one refined polygon and no
    // cross-class overlap can arise inside it. A `pinch` is a disjoint wedge
    // (`band`); a `lens` is an opaque overlay (`hlens`) — both are single-fill.
    const nonQuad = refined.filter((p) => p.regionKind !== 'quad')
    expect(nonQuad.length).toBeGreaterThan(0)
    for (const p of nonQuad)
      expect(p.tag === 'band' || p.tag === 'fallback' || p.tag === 'hlens').toBe(true)
  })

  it('no refined polygon escapes its litho region envelope (boundaries invariant)', () => {
    // Every non-fallback refined polygon is carved inside a region of the same
    // gap; its elevation range must sit within that gap's regions' union range.
    // (A byte-exact envelope check happens per-slice inside emitBand via the
    // material-space clip; this is the cheap outer guard.)
    const gapElev = new Map<number, { lo: number; hi: number }>()
    for (const r of regions) {
      const cur = gapElev.get(r.gapIndex) ?? { lo: Infinity, hi: -Infinity }
      for (const p of r.polygon) {
        if (p.elevation < cur.lo) cur.lo = p.elevation
        if (p.elevation > cur.hi) cur.hi = p.elevation
      }
      gapElev.set(r.gapIndex, cur)
    }
    const escapes: string[] = []
    for (const p of refined) {
      if (p.tag === 'fallback') continue
      const g = gapElev.get(p.gapIndex)
      if (!g) continue
      for (const q of p.points) {
        if (q.elevation < g.lo - 0.15 || q.elevation > g.hi + 0.15) {
          escapes.push(`${p.tag}#g${p.gapIndex} elev ${q.elevation.toFixed(2)} outside [${g.lo.toFixed(2)}..${g.hi.toFixed(2)}]`)
          break
        }
      }
    }
    expect(escapes, `envelope escapes:\n${escapes.slice(0, 10).join('\n')}`).toEqual([])
  })

  it('has ZERO cross-class overlap: one packing class per point (the partition invariant)', () => {
    interface Boxed { p: RefinedPolygon; x0: number; x1: number; e0: number; e1: number; id: string }
    // THE watertightness invariant (owner-locked 2026-07-06), stated as the
    // property that actually matters and mirrors the litho gate's own "one
    // lithology per point": no point may show two DIFFERENT packing identities
    // (different soil, or different NAD class). A same-class self-overlap is
    // geometrically harmless — the point still renders one class — and is
    // excluded (it is present in the owner-accepted rev-8 reference too). Lens
    // OVERLAYS (hlens / enclens) are by-design opaque overlays and excluded.
    const offenders: string[] = []
    for (const [gap, regs] of [...byGap.entries()].sort((a, b) => a[0] - b[0])) {
      const boxed: Boxed[] = regs
        .filter((p) => p.tag !== 'hlens' && p.tag !== 'enclens')
        .map((p) => {
          let x0 = Infinity, x1 = -Infinity, e0 = Infinity, e1 = -Infinity
          for (const q of p.points) {
            if (q.fraction < x0) x0 = q.fraction
            if (q.fraction > x1) x1 = q.fraction
            if (q.elevation < e0) e0 = q.elevation
            if (q.elevation > e1) e1 = q.elevation
          }
          return { p, x0, x1, e0, e1, id: identityOf(p) }
        })
      let minE = Infinity
      let maxE = -Infinity
      for (const b of boxed) {
        if (b.e0 < minE) minE = b.e0
        if (b.e1 > maxE) maxE = b.e1
      }
      if (!Number.isFinite(minE) || maxE - minE < 1e-6) continue
      const NX = 160
      const NY = 280
      const seen = new Map<string, number>()
      for (let iy = 0; iy < NY; iy++) {
        const pe = maxE - ((iy + 0.5) / NY) * (maxE - minE)
        const row = boxed.filter((b) => pe >= b.e0 && pe <= b.e1)
        if (row.length < 2) continue
        for (let ix = 0; ix < NX; ix++) {
          const px = (ix + 0.5) / NX
          const ids = new Set<string>()
          for (const b of row) if (px >= b.x0 && px <= b.x1 && inPoly(px, pe, b.p.points)) ids.add(b.id)
          if (ids.size >= 2) {
            const key = [...ids].sort().join(' x ')
            seen.set(key, (seen.get(key) ?? 0) + 1)
          }
        }
      }
      for (const [key, cells] of seen) {
        if (cells >= CROSS_CLASS_CELL_THRESHOLD) offenders.push(`GAP-${gap} ${key}: ${cells} cells`)
      }
    }
    expect(offenders, `cross-class overlaps found:\n${offenders.join('\n')}`).toEqual([])
  }, 30000)
})
