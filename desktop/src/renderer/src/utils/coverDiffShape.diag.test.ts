/**
 * COVER-DIFF SHAPE — what IS the clause-1 difference, physically?
 *
 * Clause 1 answers whether any ground is missing. It cannot say what a
 * difference IS, and the owner's question on 2026-08-31 was exactly that:
 * *"i still don't understand how these mini gaps appear, everything on every
 * section is fully connected so there shouldn't be any gaps"*. This arm
 * decomposes each difference into its pieces and measures them, so the
 * mechanism names itself instead of being argued about.
 *
 * DIRECTION MATTERS and symmetric difference throws it away, so the two halves
 * are kept apart: ``geotech - litho`` is paint outside the frame,
 * ``litho - geotech`` is unpainted ground.
 *
 * WIDTH is the load-bearing measurement, not area. A long thin filament and a
 * real hole can have the same area and mean opposite things, so each piece is
 * eroded down a ladder of radii and reported by the largest radius it survives
 * — its true half-width. What this found on the owner's model: every piece is a
 * hairline no more than 0.5 mm across, and the gaps needing no rounding read
 * EXACTLY zero, which is what identified independent snap-rounding (debt #277)
 * rather than any modelling defect.
 *
 * It is the acceptance instrument for debt #277: a fix that works drives the
 * widest patch to zero on every section in the dump.
 *
 * INPUT   scripts/geofill_live_dump.json (untracked ``__GEOFILL_SAVE()`` capture)
 * REPORT  scripts/throwaway_cover_diff.txt
 * Dormant unless COVER_DIFF=1.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import ArrayList from 'jsts/java/util/ArrayList.js'
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js'
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import CascadedPolygonUnion from 'jsts/org/locationtech/jts/operation/union/CascadedPolygonUnion.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import BufferOp from 'jsts/org/locationtech/jts/operation/buffer/BufferOp.js'

import {
  computeHierarchicalGeotechFill,
  type HierarchicalGeotechFillInput,
} from './geotechHierarchicalFill'
import type { SectionRegion } from './sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const DUMP = resolve(REPO_ROOT, 'scripts/geofill_live_dump.json')
const REPORT = resolve(REPO_ROOT, 'scripts/throwaway_cover_diff.txt')

interface LiveEntry {
  inputs: Omit<HierarchicalGeotechFillInput, 'packingClassOf'> & {
    packingClassOf: [string, string][]
  }
  regions: SectionRegion[]
}

const gf = new GeometryFactory()

function cover(regions: readonly SectionRegion[], widthM: number, factory: any = gf) {
  const list = new ArrayList([])
  for (const region of regions) {
    if (region.polygon.length < 3) continue
    const cs = region.polygon.map(
      (p) => new Coordinate(p.fraction * Math.abs(widthM), p.elevation),
    )
    cs.push(cs[0])
    list.add(factory.createPolygon(cs))
  }
  return list.isEmpty() ? factory.createPolygon() : CascadedPolygonUnion.union(list)
}

interface Piece {
  area: number
  w: number
  h: number
  x: number
  y: number
  side: 'extra' | 'missing'
}

function pieces(geom: any, side: 'extra' | 'missing'): Piece[] {
  const out: Piece[] = []
  const n = geom.getNumGeometries ? geom.getNumGeometries() : 1
  for (let i = 0; i < n; i++) {
    const g = geom.getNumGeometries ? geom.getGeometryN(i) : geom
    const a = g.getArea()
    if (a === 0) continue
    const e = g.getEnvelopeInternal()
    out.push({ area: a, w: e.getWidth(), h: e.getHeight(), x: e.getMinX(), y: e.getMinY(), side })
  }
  return out
}

/** Name the shape from its aspect ratio and how much of its bbox it fills. */
function shapeOf(p: Piece): string {
  const fill = p.area / (p.w * p.h || Number.MIN_VALUE)
  if (p.h < 1e-12) return 'degenerate (float residue)'
  const aspect = p.w / (p.h || Number.MIN_VALUE)
  if (aspect > 1000 && fill > 0.7) return `ribbon h=${(p.h * 1000).toFixed(4)} mm`
  if (aspect > 1000) return `sliver h=${(p.h * 1000).toFixed(4)} mm fill=${fill.toFixed(2)}`
  if (fill > 0.45 && fill < 0.6) return 'triangle/lens'
  return `blob fill=${fill.toFixed(2)}`
}

describe('cover-diff shape', () => {
  if (process.env.COVER_DIFF !== '1' || !existsSync(DUMP)) {
    it.skip('dormant (set COVER_DIFF=1 with scripts/geofill_live_dump.json present)', () => {})
    return
  }

  it('decomposes every clause-1 difference into its pieces', () => {
    const NL = String.fromCharCode(10)
    const dump = JSON.parse(readFileSync(DUMP, 'utf8')) as Record<string, LiveEntry>
    const lines: string[] = []

    for (const key of Object.keys(dump)) {
      const entry = dump[key]
      const classOf = new Map(entry.inputs.packingClassOf)
      const h = computeHierarchicalGeotechFill({ ...entry.inputs, packingClassOf: classOf })
      const alongM = entry.inputs.alongM
      const lithoRegions = entry.inputs.lithoRegions

      const gapIndices = new Set<number>(
        [...h.regions, ...h.lithoFallback, ...lithoRegions].map((r) => r.gapIndex),
      )
      lines.push(`########## ${key}`)
      let totalMissing = 0
      let totalExtra = 0
      let worstHalfMm = 0

      for (const gapIndex of [...gapIndices].sort((a, b) => a - b)) {
        const width = alongM[gapIndex + 1] - alongM[gapIndex]
        if (!Number.isFinite(width)) continue
        const painted = [...h.regions, ...h.lithoFallback].filter((r) => r.gapIndex === gapIndex)
        const frame = lithoRegions.filter((r) => r.gapIndex === gapIndex)
        const g = cover(painted, width)
        const l = cover(frame, width)
        const extra = OverlayOp.difference(g, l)
        const missing = OverlayOp.difference(l, g)
        const total = extra.getArea() + missing.getArea()
        if (total === 0) {
          lines.push(`  gap ${gapIndex}: EXACT (width ${width.toFixed(1)} m, ${painted.length} painted / ${frame.length} litho)`)
          continue
        }
        // SNAP-DISPLACEMENT TEST. If every difference is the two engines'
        // grids disagreeing, the two cover BOUNDARIES never separate by more
        // than half a grid cell. Half a cell is 0.5 mm in elevation; in x the
        // geotech grid is 1 mm on ``fraction * FRACTION_SCALE``, i.e. 1e-5 of
        // a gap, so half a cell is 5e-6 * width metres. A real hole or a real
        // overpaint separates the boundaries by far more than that.
        // HOW WIDE is the widest unpainted patch, really? Walk a ladder of
        // erosion radii and report the largest at which anything survives:
        // that IS the half-width of the fattest piece, measured without
        // reference to any threshold the clause uses.
        const LADDER = [0.5, 0.25, 0.1, 0.05, 0.025, 0.01, 0.005, 0.001, 0.0005]
        let widestHalfMm = 0
        for (const mm of LADDER) {
          let alive = false
          try {
            alive = !BufferOp.bufferOp(missing, -(mm / 1000)).isEmpty()
          } catch {
            alive = true
          }
          if (alive) {
            widestHalfMm = mm
            break
          }
        }
        totalMissing += missing.getArea()
        totalExtra += extra.getArea()
        if (widestHalfMm > worstHalfMm) worstHalfMm = widestHalfMm
        lines.push(
          `      WIDEST unpainted patch: half-width ${
            widestHalfMm === 0 ? '< 0.0005' : `~${widestHalfMm}`
          } mm  (missing ${missing.getArea().toExponential(3)} m2 of litho ${l.getArea().toFixed(2)} m2)`,
        )
        const all = [...pieces(extra, 'extra'), ...pieces(missing, 'missing')].sort(
          (a, b) => b.area - a.area,
        )
        lines.push(
          `  gap ${gapIndex}: width ${width.toFixed(1)} m | extra ${extra.getArea().toExponential(3)} ` +
            `missing ${missing.getArea().toExponential(3)} | ${all.length} pieces ` +
            `(${painted.length} painted / ${frame.length} litho)`,
        )
        for (const p of all.slice(0, 6)) {
          lines.push(
            `      ${p.side.padEnd(7)} area=${p.area.toExponential(3)} bbox ${p.w.toFixed(4)} x ` +
              `${p.h.toExponential(3)} m at (${p.x.toFixed(3)}, ${p.y.toFixed(3)}) -> ${shapeOf(p)}`,
          )
        }
        if (all.length > 6) lines.push(`      ... ${all.length - 6} more pieces`)
        // EDGE READOUT: where do the two covers START and STOP in fraction
        // space? A ribbon at fraction 0 or 1 means one cover reaches the
        // column and the other does not, which is an anchoring difference,
        // not a shape difference.
        const fr = (rs: readonly SectionRegion[]) => {
          let lo = Infinity
          let hi = -Infinity
          for (const r of rs) for (const p of r.polygon) {
            if (p.fraction < lo) lo = p.fraction
            if (p.fraction > hi) hi = p.fraction
          }
          return [lo, hi] as const
        }
        const [pl, ph] = fr(painted)
        const [ll, lh] = fr(frame)
        if (pl !== ll || ph !== lh) {
          lines.push(
            `      EDGE geotech f=[${pl}, ${ph}]  litho f=[${ll}, ${lh}]  ` +
              `dLeft=${((pl - ll) * width).toExponential(3)} m dRight=${((ph - lh) * width).toExponential(3)} m`,
          )
        }
      }
      lines.push(
        `  >>> SECTION TOTAL: missing ${totalMissing.toFixed(6)} m2, extra ` +
          `${totalExtra.toFixed(6)} m2, widest unpainted patch half-width ` +
          `${worstHalfMm === 0 ? '< 0.0005' : worstHalfMm} mm`,
      )
    }

    writeFileSync(REPORT, lines.join(NL) + NL, 'utf8')
    console.info(lines.join(NL))
    expect(lines.length).toBeGreaterThan(0)
  })
})
