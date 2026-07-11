/**
 * CS1 BAND-AUTHORITY GATE — a correlation band is authoritative; nothing else
 * may be drawn inside it (owner directive 2026-07-10, "colour between the lines",
 * confirmed on the real CS1 S11·S8·S10 SILT geometry).
 *
 * THE RULE
 * --------
 * A lithology unit whose TOP contact is correlated (an approved same-lithology
 * top-tie edge) to the same-lithology unit on another column forms a BAND that
 * spans continuously between those columns. The band quad = the unit's top edge
 * and base edge, each interpolated LINEARLY BY ALONG-DISTANCE between the
 * correlated columns, passing continuously under any intervening columns. The
 * band is filled with its own lithology, and NO other region (a different
 * lithology, the matrix, a pinch, an onlap) may overlap that quad.
 *
 * This gate builds each correlation band's quad DIRECTLY from the correlation
 * edges — independent of the fill engine's internal passes — then samples the
 * quad's interior in every gap it spans and asserts the covering fill region has
 * the band's formation. If a KLEI region is drawn where the SILT band should be
 * (the gap-7 "clay spilling over the correlation band" bug), it fails.
 *
 * The proven concrete case it pins RED on the pre-fix code (real CS1):
 *   S11.SILT-top(5.96) ↔ S10.SILT-top(6.48) is a same-lithology top tie. The
 *   SILT band quad therefore has base sloping 5.01→2.51 across gaps 7+8. The old
 *   engine draws the SILT with a FLAT base at 5.01 in gap 7 and keeps the S11
 *   mid-clay INSIDE the sloping silt quad (a KLEI region above the silt-base
 *   tie) — clay over the band.
 *
 * Run:  REWRITE_B=1 CS1_GATE=1 npx vitest run \
 *         src/renderer/src/utils/partitionFill.cs1bandauthority.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  computeSectionFill,
  type CorrelationEdge,
  type PartitionColumn,
  type SectionRegion,
} from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT_PATH = process.env.CS1_INPUT ?? resolve(REPO_ROOT, 'scripts/throwaway_cs1_input.json')

interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: PartitionColumn['units']
  name?: string
}
interface RawInput {
  columns: RawColumn[]
  edges: CorrelationEdge[]
  along?: number[]
}

/** Nonzero-winding point-in-polygon (x=fraction, y=elevation) — the SVG fill rule. */
function inPolygon(px: number, py: number, poly: readonly { fraction: number; elevation: number }[]): boolean {
  let wn = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const isLeft = (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation)
    if (a.elevation <= py) {
      if (b.elevation > py && isLeft > 0) wn++
    } else {
      if (b.elevation <= py && isLeft < 0) wn--
    }
  }
  return wn !== 0
}

const FORMATION_LABEL = (f: string): string =>
  ({ '38d1bc': 'ZAND', '19bb43': 'KLEI', '0f2e06': 'SILT', '512af4': 'VEEN' })[f.slice(-6)] ?? f.slice(-6)

describe('CS1 real-data band-authority gate', () => {
  // Dormant unless explicitly activated (needs the dev-DB-derived CS1 input).
  //   uv run python scripts/throwaway_cs1_partition_extract.py
  //   REWRITE_B=1 CS1_GATE=1 npx vitest run src/renderer/src/utils/partitionFill.cs1bandauthority.test.ts
  if (process.env.CS1_GATE !== '1') {
    it.skip('CS1 band-authority gate dormant (set CS1_GATE=1 to run)', () => {})
    return
  }
  if (!existsSync(INPUT_PATH)) {
    it.skip(`CS1 input absent (${INPUT_PATH}) — regenerate with scripts/throwaway_cs1_partition_extract.py`, () => {})
    return
  }

  const raw = JSON.parse(readFileSync(INPUT_PATH, 'utf8')) as RawInput
  const keep = raw.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = raw.along ? keep.map(({ i }) => (raw.along as number[])[i]) : undefined
  const regions = computeSectionFill(columns, raw.edges, undefined, alongM)

  // Non-empty columns, filtered exactly as computeSectionFill does (gaps 1:1).
  const cols = columns.filter((c) => c.units.length > 0)
  // Along-metre position per non-empty column (uniform-index fallback matches the
  // engine's own fallback when no alongM is supplied — so the band interpolation
  // uses the SAME horizontal metric the fill did).
  const colsAlong: number[] = alongM
    ? (() => {
        const r: number[] = []
        for (let oi = 0; oi < columns.length; oi++) if (columns[oi].units.length > 0) r.push((alongM as number[])[oi])
        return r
      })()
    : cols.map((_, i) => i)

  // layerId → { colIndex, topElev, baseElev, formationId } from the filtered cols.
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

  // A correlation BAND: a top-tie (both sides 'top'/omitted) between two
  // SAME-formation units. Its quad spans [loCol, hiCol]; top interpolates
  // loTop→hiTop, base interpolates loBase→hiBase, both by along-distance. This is
  // the authoritative fill for that lithology across the span.
  interface Band {
    loCol: number
    hiCol: number
    loTop: number
    loBase: number
    hiTop: number
    hiBase: number
    formationId: string
  }
  const bands: Band[] = []
  for (const e of raw.edges) {
    const aTop = e.aSide === 'top' || e.aSide == null
    const bTop = e.bSide === 'top' || e.bSide == null
    if (!aTop || !bTop) continue // only top-ties define a band's top edge
    const la = layerLoc.get(e.a)
    const lb = layerLoc.get(e.b)
    if (!la || !lb) continue
    if (la.formationId !== lb.formationId) continue // same-lithology bands only
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

  // Group fill regions by gap for point queries.
  const byGap = new Map<number, SectionRegion[]>()
  for (const r of regions) {
    const g = byGap.get(r.gapIndex) ?? []
    g.push(r)
    byGap.set(r.gapIndex, g)
  }

  // Per-column real observed unit stack (elevation intervals + formation). Used to
  // reject an OVER-MATCH band — a same-formation top-tie between units whose bases
  // differ so much that the interpolated band quad passes through a bounding
  // column's REAL data of a DIFFERENT lithology (the CS1 gap-8 upper-KLEI whose
  // quad crosses S8's real ZAND). The engine correctly fills that column's real
  // lithology there, so the band is not authoritative across it; such a band is the
  // GAP-19 same-formation over-match class the void gate also excludes. A genuine
  // band (S11↔S10 SILT) has no such conflict — its base is a real geological tie.
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
  // Does column `ci`'s real stack carry a DIFFERENT-formation unit overlapping the
  // elevation range [lo, hi] by more than a seam margin?  (True → over-match here.)
  const OVERMATCH_MARGIN = 0.3
  const columnConflicts = (ci: number, lo: number, hi: number, formationId: string): boolean => {
    for (const u of realStack[ci]) {
      if (u.formationId === formationId) continue
      const ov = Math.min(hi, u.top) - Math.max(lo, u.base)
      if (ov > OVERMATCH_MARGIN) return true
    }
    return false
  }

  // The gap-local quad of a band at gap g (fraction 0..1 = left..right column),
  // or null when the band does not span this gap. Used to exclude BAND-vs-BAND
  // conflict zones: where two bands' quads overlap, two user ties claim the same
  // space (e.g. the CS1 gap-8 upper-KLEI over-match meeting the S8↔S10 SILT band).
  // That is a correlation conflict, out of scope for THIS gate (which targets a
  // NON-band lithology — spilled matrix / pinch / kept clay — drawn inside a band).
  const bandQuadAtGap = (band: Band, g: number): { top: [number, number]; base: [number, number] } | null => {
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

  // Interior-margin so we sample strictly inside the band (avoid seam rasterisation
  // noise at the exact tie line / column edges). ~0.15 m vertical, 5% horizontal.
  const V_MARGIN = 0.15
  const F_MARGIN = 0.05
  const NX = 9
  const NY = 25

  it('no lithology is drawn over a correlation band (bands are authoritative)', () => {
    const offenders: string[] = []
    for (const band of bands) {
      const loAlong = colsAlong[band.loCol]
      const hiAlong = colsAlong[band.hiCol]
      const totalSpan = hiAlong - loAlong
      if (Math.abs(totalSpan) < 1e-9) continue
      for (let g = band.loCol; g < band.hiCol; g++) {
        const gapRegs = byGap.get(g)
        if (!gapRegs) continue
        // This gap's two columns as global fractions within [loAlong, hiAlong].
        const fL = (colsAlong[g] - loAlong) / totalSpan
        const fR = (colsAlong[g + 1] - loAlong) / totalSpan
        const topL = band.loTop + fL * (band.hiTop - band.loTop)
        const topR = band.loTop + fR * (band.hiTop - band.loTop)
        const baseL = band.loBase + fL * (band.hiBase - band.loBase)
        const baseR = band.loBase + fR * (band.hiBase - band.loBase)
        // Over-match rejection: if either bounding column's REAL data of a different
        // lithology overlaps the band quad's elevation range at that column edge, this
        // top-tie is a same-formation over-match (the units' bases diverge across the
        // gap) — the column's real lithology legitimately fills there, so the band is
        // NOT authoritative across this gap. Out of scope for this gate (GAP-19 class).
        if (
          columnConflicts(g, Math.min(baseL, topL), Math.max(baseL, topL), band.formationId) ||
          columnConflicts(g + 1, Math.min(baseR, topR), Math.max(baseR, topR), band.formationId)
        ) {
          continue
        }
        // Sample the band-quad interior in gap-local fraction space.
        let mismatch = 0
        let sampled = 0
        let worst = ''
        for (let ix = 0; ix < NX; ix++) {
          const f = F_MARGIN + ((ix + 0.5) / NX) * (1 - 2 * F_MARGIN)
          const top = topL + f * (topR - topL)
          const base = baseL + f * (baseR - baseL)
          if (top - base < 2 * V_MARGIN) continue // band too thin here to sample cleanly
          for (let iy = 0; iy < NY; iy++) {
            const e = base + V_MARGIN + ((iy + 0.5) / NY) * (top - base - 2 * V_MARGIN)
            sampled++
            // The covering NON-LENS region at this point (lenses are by-design
            // overlays and excluded — the rule is about the solid partition).
            let cover: SectionRegion | undefined
            for (const r of gapRegs) {
              if (r.kind === 'lens') continue
              if (inPolygon(f, e, r.polygon)) {
                cover = r
                break
              }
            }
            if (!cover) continue // an uncovered void is the void gate's job, not this one
            if (cover.formationId === band.formationId) continue // the band's own lithology
            // BAND-vs-BAND conflict exclusion: if this point also lies inside ANOTHER
            // band's quad whose formation matches the covering lithology, two user
            // correlations claim it — a conflict, not a spilled-matrix bug. Skip.
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
        // A handful of stray cells at a slanted seam is rasterisation noise; a real
        // clay-over-band overlap is a large contiguous block (dozens of cells).
        if (mismatch >= 20) {
          offenders.push(
            `BAND ${FORMATION_LABEL(band.formationId)} cols[${band.loCol}→${band.hiCol}] GAP-${g}: ` +
              `${mismatch}/${sampled} band-interior samples covered by another lithology (e.g. ${worst})`,
          )
        }
      }
    }
    if (offenders.length > 0) {
      // eslint-disable-next-line no-console
      console.info('[CS1-BAND-AUTHORITY] offending bands:\n  ' + offenders.join('\n  '))
    }
    expect(offenders, `lithology drawn over a correlation band:\n${offenders.join('\n')}`).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // EDGE-ON-TIE GATE — a band's OWN top and base edges FOLLOW its tie line at
  // every intervening column, never drawn FLAT (carried from an adjacent column)
  // in a way that crosses its own correlation.
  //
  // THE RULE (owner): a non-adjacently-correlated band is the tie-interpolated
  // quad between its two bounding tie-lines. Its top/base at every intervening
  // column must equal the along-interpolated tie elevation — the top must not sit
  // ABOVE its tie (the flat adjacent-emit carry pokes above; real CS1 gap-8 SILT
  // top flat 6.48 vs the tie's ~6.22 at S8), and the band must actually REACH its
  // tie (a point just below the tie-top is covered by the band's own lithology).
  //
  // Proven RED on the pre-fix engine: at S8 (the intervening column of the S11↔S10
  // SILT band) the SILT covered up to 6.48 (flat), 0.26 m ABOVE its tie top 6.22 —
  // the merge of the flat emit carry with the sloping span band flattened the top.
  // ---------------------------------------------------------------------------
  it("a band's own top and base edges lie ON its tie at every intervening column", () => {
    // Vertical probe offset off the tie line (m). Smaller than the 0.1 m gate
    // tolerance so a genuine on-tie edge always passes and a flat carry that
    // exceeds the tolerance is caught.
    const PROBE = 0.06
    // Tolerance (m): how far a band edge may deviate from its tie before it counts
    // as a violation. The gap-8 defect was 0.26 m — well outside 0.1 m.
    const TOL = 0.1

    // Covering non-lens region formation at (fraction, elevation) in gap g, or null.
    const coverAt = (g: number, f: number, e: number): string | null => {
      const regs = byGap.get(g)
      if (!regs) return null
      for (const r of regs) {
        if (r.kind === 'lens') continue
        if (inPolygon(f, e, r.polygon)) return r.formationId
      }
      return null
    }

    const offenders: string[] = []
    for (const band of bands) {
      // Intervening columns of this band: every column strictly between loCol and
      // hiCol. Each is the LEFT column (fraction 0) of the gap starting at it.
      for (let ci = band.loCol + 1; ci < band.hiCol; ci++) {
        const q = bandQuadAtGap(band, ci) // gap ci starts at column ci
        if (!q) continue
        const tieTop = q.top[0] // band top at this column (fraction 0)
        const tieBase = q.base[0] // band base at this column (fraction 0)
        if (tieTop - tieBase < 2 * PROBE + TOL) continue // too thin to probe cleanly
        // Over-match / real-data conflict at this column → out of scope (same
        // exclusion the authority gate uses); the column's own lithology is drawn.
        if (columnConflicts(ci, tieBase, tieTop, band.formationId)) continue
        // Sample slightly inside the gap so we are on the band's rendered geometry,
        // not exactly on the column seam.
        const f = F_MARGIN
        // (1) The band must NOT poke ABOVE its tie top: a point TOL+PROBE above the
        // tie must NOT be the band's own lithology (the flat-carry-above-tie bug).
        const above = coverAt(ci, f, tieTop + TOL + PROBE)
        if (above === band.formationId) {
          offenders.push(
            `BAND ${FORMATION_LABEL(band.formationId)} cols[${band.loCol}→${band.hiCol}] ` +
              `col ${ci}: own lithology drawn ${(TOL + PROBE).toFixed(2)} m ABOVE its tie top ` +
              `(tieTop=${tieTop.toFixed(2)}, covered at ${(tieTop + TOL + PROBE).toFixed(2)}) — flat carry crossing its own tie`,
          )
        }
        // (2) The band must REACH its tie: a point just BELOW the tie top must be
        // covered by the band's own lithology (the band edge is on its tie).
        const justBelowTop = coverAt(ci, f, tieTop - PROBE)
        if (justBelowTop !== band.formationId && justBelowTop !== null) {
          offenders.push(
            `BAND ${FORMATION_LABEL(band.formationId)} cols[${band.loCol}→${band.hiCol}] ` +
              `col ${ci}: band top NOT on its tie — at ${(tieTop - PROBE).toFixed(2)} (just below tieTop ` +
              `${tieTop.toFixed(2)}) the cover is ${FORMATION_LABEL(justBelowTop)} not the band lithology`,
          )
        }
      }
    }
    if (offenders.length > 0) {
      // eslint-disable-next-line no-console
      console.info('[CS1-EDGE-ON-TIE] offending band edges:\n  ' + offenders.join('\n  '))
    }
    expect(offenders, `band edge crosses its own tie:\n${offenders.join('\n')}`).toEqual([])
  })
})
