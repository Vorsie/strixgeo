/**
 * partitionFillV2.cs1BandAuthority.ts — the CS1 band-authority assertion, ported
 * VERBATIM from ``partitionFill.cs1bandauthority.test.ts`` and factored into a pure
 * helper so the v2 gate file stays under the 500-line budget (debt #201).
 *
 * A correlation band (a same-lithology top-tie between two columns) is authoritative:
 * its along-interpolated quad must be filled with its own lithology, and NO other
 * lithology may be drawn inside it. This helper builds each band directly from the
 * edges (engine-independent) and samples the band interior against the fill regions,
 * returning offender strings. The two v1 exclusions are preserved verbatim:
 * over-match columns (a bounding column's real data of a different lithology overlaps
 * the band) and band-vs-band conflict zones. Additionally checks the edge-on-tie rule
 * at intervening columns.
 *
 * Pure module — no React, no I/O.
 */

import { type PartitionPoint, type SectionRegion } from './sectionPartition'
import { inPolygon } from './partitionFillV2.parityCoverage'

interface BandUnit {
  topDepthM: number
  baseDepthM: number
  formationId: string
  layerId: string
}
interface BandColumn {
  surfaceElevM: number
  units: readonly BandUnit[]
}
interface BandEdge {
  a: string
  b: string
  aSide?: string
  bSide?: string
}

const FORMATION_LABEL = (f: string): string =>
  ({ '38d1bc': 'ZAND', '19bb43': 'KLEI', '0f2e06': 'SILT', '512af4': 'VEEN' })[f.slice(-6)] ?? f.slice(-6)

interface Band {
  loCol: number
  hiCol: number
  loTop: number
  loBase: number
  hiTop: number
  hiBase: number
  formationId: string
}

/**
 * Compute the band-authority + edge-on-tie offenders for one section's v2 output.
 *
 * Parameters
 * ----------
 * regions : readonly SectionRegion[]
 *     The v2 fill regions for this section.
 * cols : readonly BandColumn[]
 *     Non-empty columns (1:1 with the engine's internal gap indexing).
 * colsAlong : readonly number[]
 *     Along-metre position per non-empty column (index fallback matches the engine).
 * edges : readonly BandEdge[]
 *     Approved correlation edges.
 *
 * Returns
 * -------
 * { authority: string[]; edgeOnTie: string[] }
 *     Offender lists for the two band-authority checks (empty = clean).
 */
export function bandAuthorityOffenders(
  regions: readonly SectionRegion[],
  cols: readonly BandColumn[],
  colsAlong: readonly number[],
  edges: readonly BandEdge[],
): { authority: string[]; edgeOnTie: string[] } {
  interface LayerLoc {
    colIndex: number
    topElev: number
    baseElev: number
    formationId: string
  }
  const layerLoc = new Map<string, LayerLoc>()
  cols.forEach((c, ci) => {
    for (const u of c.units) {
      layerLoc.set(u.layerId, {
        colIndex: ci,
        topElev: c.surfaceElevM - u.topDepthM,
        baseElev: c.surfaceElevM - u.baseDepthM,
        formationId: u.formationId,
      })
    }
  })

  const bands: Band[] = []
  for (const e of edges) {
    const aTop = e.aSide === 'top' || e.aSide == null
    const bTop = e.bSide === 'top' || e.bSide == null
    if (!aTop || !bTop) continue
    const la = layerLoc.get(e.a)
    const lb = layerLoc.get(e.b)
    if (!la || !lb) continue
    if (la.formationId !== lb.formationId) continue
    const [lo, hi] = la.colIndex <= lb.colIndex ? [la, lb] : [lb, la]
    if (hi.colIndex === lo.colIndex) continue
    bands.push({
      loCol: lo.colIndex,
      hiCol: hi.colIndex,
      loTop: lo.topElev,
      loBase: lo.baseElev,
      hiTop: hi.topElev,
      hiBase: hi.baseElev,
      formationId: lo.formationId,
    })
  }

  const byGap = new Map<number, SectionRegion[]>()
  for (const r of regions) {
    const g = byGap.get(r.gapIndex) ?? []
    g.push(r)
    byGap.set(r.gapIndex, g)
  }

  interface RealUnit {
    top: number
    base: number
    formationId: string
  }
  const realStack: RealUnit[][] = cols.map((c) =>
    c.units.map((u) => ({
      top: c.surfaceElevM - u.topDepthM,
      base: c.surfaceElevM - u.baseDepthM,
      formationId: u.formationId,
    })),
  )
  const OVERMATCH_MARGIN = 0.3
  const columnConflicts = (ci: number, lo: number, hi: number, formationId: string): boolean => {
    for (const u of realStack[ci]) {
      if (u.formationId === formationId) continue
      const ov = Math.min(hi, u.top) - Math.max(lo, u.base)
      if (ov > OVERMATCH_MARGIN) return true
    }
    return false
  }
  const bandQuadAtGap = (
    band: Band,
    g: number,
  ): { top: [number, number]; base: [number, number] } | null => {
    if (g < band.loCol || g >= band.hiCol) return null
    const loAlong = colsAlong[band.loCol]
    const hiAlong = colsAlong[band.hiCol]
    const span = hiAlong - loAlong
    if (Math.abs(span) < 1e-9) return null
    const fL = (colsAlong[g] - loAlong) / span
    const fR = (colsAlong[g + 1] - loAlong) / span
    return {
      top: [band.loTop + fL * (band.hiTop - band.loTop), band.loTop + fR * (band.hiTop - band.loTop)],
      base: [band.loBase + fL * (band.hiBase - band.loBase), band.loBase + fR * (band.hiBase - band.loBase)],
    }
  }

  const V_MARGIN = 0.15
  const F_MARGIN = 0.05
  const NX = 9
  const NY = 25

  // ---- authority check ----
  const authority: string[] = []
  for (const band of bands) {
    const loAlong = colsAlong[band.loCol]
    const hiAlong = colsAlong[band.hiCol]
    const totalSpan = hiAlong - loAlong
    if (Math.abs(totalSpan) < 1e-9) continue
    for (let g = band.loCol; g < band.hiCol; g++) {
      const gapRegs = byGap.get(g)
      if (!gapRegs) continue
      const fL = (colsAlong[g] - loAlong) / totalSpan
      const fR = (colsAlong[g + 1] - loAlong) / totalSpan
      const topL = band.loTop + fL * (band.hiTop - band.loTop)
      const topR = band.loTop + fR * (band.hiTop - band.loTop)
      const baseL = band.loBase + fL * (band.hiBase - band.loBase)
      const baseR = band.loBase + fR * (band.hiBase - band.loBase)
      if (
        columnConflicts(g, Math.min(baseL, topL), Math.max(baseL, topL), band.formationId) ||
        columnConflicts(g + 1, Math.min(baseR, topR), Math.max(baseR, topR), band.formationId)
      ) {
        continue
      }
      let mismatch = 0
      let worst = ''
      for (let ix = 0; ix < NX; ix++) {
        const f = F_MARGIN + ((ix + 0.5) / NX) * (1 - 2 * F_MARGIN)
        const top = topL + f * (topR - topL)
        const base = baseL + f * (baseR - baseL)
        if (top - base < 2 * V_MARGIN) continue
        for (let iy = 0; iy < NY; iy++) {
          const e = base + V_MARGIN + ((iy + 0.5) / NY) * (top - base - 2 * V_MARGIN)
          let cover: SectionRegion | undefined
          for (const r of gapRegs) {
            if (r.kind === 'lens') continue
            if (inPolygon(f, e, r.polygon)) {
              cover = r
              break
            }
          }
          if (!cover) continue
          if (cover.formationId === band.formationId) continue
          let inCompetingBand = false
          for (const other of bands) {
            if (other === band || other.formationId !== cover.formationId) continue
            const q = bandQuadAtGap(other, g)
            if (!q) continue
            const oTop = q.top[0] + f * (q.top[1] - q.top[0])
            const oBase = q.base[0] + f * (q.base[1] - q.base[0])
            if (e <= oTop && e >= oBase) {
              inCompetingBand = true
              break
            }
          }
          if (inCompetingBand) continue
          mismatch++
          if (!worst) worst = `f=${f.toFixed(2)} e=${e.toFixed(2)} → ${FORMATION_LABEL(cover.formationId)}`
        }
      }
      if (mismatch >= 20) {
        authority.push(
          `BAND ${FORMATION_LABEL(band.formationId)} cols[${band.loCol}→${band.hiCol}] GAP-${g}: ` +
            `${mismatch} band-interior samples covered by another lithology (e.g. ${worst})`,
        )
      }
    }
  }

  // ---- edge-on-tie check ----
  const PROBE = 0.06
  const TOL = 0.1
  const coverAt = (g: number, f: number, e: number): string | null => {
    const regs = byGap.get(g)
    if (!regs) return null
    for (const r of regs) {
      if (r.kind === 'lens') continue
      if (inPolygon(f, e, r.polygon)) return r.formationId
    }
    return null
  }
  const edgeOnTie: string[] = []
  for (const band of bands) {
    for (let ci = band.loCol + 1; ci < band.hiCol; ci++) {
      const q = bandQuadAtGap(band, ci)
      if (!q) continue
      const tieTop = q.top[0]
      const tieBase = q.base[0]
      if (tieTop - tieBase < 2 * PROBE + TOL) continue
      if (columnConflicts(ci, tieBase, tieTop, band.formationId)) continue
      const f = F_MARGIN
      const above = coverAt(ci, f, tieTop + TOL + PROBE)
      if (above === band.formationId) {
        edgeOnTie.push(
          `BAND ${FORMATION_LABEL(band.formationId)} cols[${band.loCol}→${band.hiCol}] col ${ci}: ` +
            `own lithology drawn ${(TOL + PROBE).toFixed(2)} m ABOVE its tie top (tieTop=${tieTop.toFixed(2)})`,
        )
      }
      const justBelowTop = coverAt(ci, f, tieTop - PROBE)
      if (justBelowTop !== band.formationId && justBelowTop !== null) {
        edgeOnTie.push(
          `BAND ${FORMATION_LABEL(band.formationId)} cols[${band.loCol}→${band.hiCol}] col ${ci}: ` +
            `band top NOT on its tie — at ${(tieTop - PROBE).toFixed(2)} cover is ${FORMATION_LABEL(justBelowTop)}`,
        )
      }
    }
  }

  return { authority, edgeOnTie }
}

/** Along-metre position per non-empty column (index fallback matches the engine). */
export function nonEmptyAlong(
  columns: readonly { units: readonly unknown[] }[],
  alongM: readonly number[] | undefined,
  nonEmptyCount: number,
): number[] {
  if (!alongM) return Array.from({ length: nonEmptyCount }, (_, i) => i)
  const r: number[] = []
  for (let oi = 0; oi < columns.length; oi++) if (columns[oi].units.length > 0) r.push(alongM[oi])
  return r
}

export type { PartitionPoint }
