/**
 * partitionFillV2.reachScan.diag.diag.test.ts — THROWAWAY (S46 Stage-A) flank-reach scan.
 *
 * Measures the apex fraction (reach ÷ gap) of every emitted lens flank on CS1, and specifically
 * classifies the named phantom-vs-genuine pairs from the S46 map. A phantom lens hugs the column
 * (reach ≈ 1-2% of the gap) with NO correlation art crossing its 0.45 wedge; a genuine hug has a
 * drawn tie / bridge / band contour crossing it. Gate: SHAPE_AUDIT=1. Pure reporter (never fails).
 *
 * Delete after Stage A lands.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn } from './sectionPartition'
import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { emitCurves, type ResolvedTie } from './partitionFillV2/emitCurves'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { type InputCurve } from './partitionFillV2/types'
import { interiorLensReachToTies } from './partitionFillV2/lensReach'
import { facingMatrixLabel } from './partitionFillV2/facingMatrix'
import { enclosingMatrixFid } from './partitionFillV2/emitLenses'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')
const NAMES = resolve(REPO_ROOT, 'scripts/diag_shape_audit_names.json')

interface RawUnit {
  layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null
}
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection {
  sectionId: string; name: string; columns: RawCol[]; alongM: number[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
}

const round = (x: number): number => Math.round(x * 1000) / 1000

function prepare(sec: RawSection, nameOf: (id: string) => string): {
  columns: PartitionColumn[]; alongM: number[]; edges: CorrelationEdge[]; colNames: string[]
} {
  const keep = sec.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const colNames = keep.map(({ c }) => nameOf(c.investigationId))
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({
    a: e.a, b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, alongM, edges, colNames }
}

function isLensFlankId(id: string): boolean {
  return id.startsWith('subtdlens') || id.startsWith('lens') || id.startsWith('term')
}

/** A tie's elev at along-x x (flat outside). */
function tieElevAt(t: ResolvedTie, x: number): number {
  const w = t.right.x - t.left.x
  if (Math.abs(w) < 1e-6) return t.left.y
  const f = (x - t.left.x) / w
  return t.left.y + f * (t.right.y - t.left.y)
}

describe('S46 Stage-A reach scan (throwaway)', () => {
  if (process.env.SHAPE_AUDIT !== '1') {
    it.skip('dormant (set SHAPE_AUDIT=1)', () => {})
    return
  }

  it('measure lens-flank apex fractions on CS1', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]; formationNames: Record<string, string>
    }
    const nameMap: Record<string, string> = existsSync(NAMES)
      ? (JSON.parse(readFileSync(NAMES, 'utf8')) as Record<string, string>)
      : {}
    const nameOf = (id: string): string => nameMap[id] ?? id.slice(0, 8)
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)

    const prev = setTwoSidedTerminations(true)
    try {
      for (const sec of raw.sections) {
        if (sec.name !== 'Cross-section 1') continue
        const { columns, alongM, edges, colNames } = prepare(sec, nameOf)
        if (columns.length < 2) continue
        const section = buildSectionInput(columns, edges, undefined, alongM)
        const { curves, activeTies } = emitCurves(section)
        const geom = section.columns
        const colX = geom.map((c) => c.x)

        // Group emitted lens flanks into pairs by (rounded apex point). Each flank is a
        // 2-point curve [corner -> apex]. The apex is the non-column endpoint.
        interface Flank { id: string; cornerX: number; cornerY: number; apexX: number; apexY: number }
        const flanks: Flank[] = []
        for (const c of curves as InputCurve[]) {
          if (!isLensFlankId(c.id)) continue
          if (c.points.length < 2) continue
          const a = c.points[0]
          const b = c.points[c.points.length - 1]
          // corner = the endpoint that sits exactly on a column x; apex = the other.
          const aOnCol = colX.some((cx) => Math.abs(a.x - cx) < 0.01)
          const corner = aOnCol ? a : b
          const apex = aOnCol ? b : a
          flanks.push({ id: c.id, cornerX: corner.x, cornerY: corner.y, apexX: apex.x, apexY: apex.y })
        }

        // Print flanks whose apex is close to a column (hugging) — reach < 5% of nearest gap.
        console.log(`\n===== ${sec.name}: ${flanks.length} lens flanks =====`)
        console.log(`columns: ${colNames.map((n, i) => `${i}:${n}@${round(colX[i])}`).join(' ')}`)
        for (const f of flanks) {
          // nearest column to the corner = own column
          let ownCi = 0
          let best = Infinity
          for (let i = 0; i < colX.length; i++) {
            const d = Math.abs(f.cornerX - colX[i])
            if (d < best) { best = d; ownCi = i }
          }
          const ownX = colX[ownCi]
          // facing = the column the apex heads toward
          const dir = Math.sign(f.apexX - ownX)
          const facingCi = ownCi + dir
          if (facingCi < 0 || facingCi >= colX.length) continue
          const gap = Math.abs(colX[facingCi] - ownX)
          const reach = Math.abs(f.apexX - ownX)
          const frac = gap > 1e-6 ? reach / gap : 0
          if (frac < 0.06) {
            // Which correlation art (tie/bridge/band edge) crosses this flank's 0.45 wedge?
            const gi = Math.min(ownCi, facingCi)
            const gapTies = activeTies.filter((t) => t.gapIndex === gi)
            const midY = f.cornerY // corner is top or base contact
            const colliders: string[] = []
            for (const t of gapTies) {
              // Does the tie pass through [apexY..cornerY] range within [ownX..apexX]?
              const yAtOwn = tieElevAt(t, ownX)
              const yAtApex = tieElevAt(t, f.apexX)
              const lo = Math.min(f.apexY, f.cornerY) - 0.05
              const hi = Math.max(f.apexY, f.cornerY) + 0.05
              if ((yAtOwn >= lo && yAtOwn <= hi) || (yAtApex >= lo && yAtApex <= hi)) {
                colliders.push(`${t.id}(L${round(t.left.y)}..R${round(t.right.y)} ${t.leftSide}/${t.rightSide})`)
              }
            }
            console.log(
              `  HUG col${ownCi}(${colNames[ownCi]}) ${dir > 0 ? 'R' : 'L'} ` +
              `corner(${round(f.cornerX)},${round(f.cornerY)}) apex(${round(f.apexX)},${round(f.apexY)}) ` +
              `gap=${round(gap)} reach=${round(reach)} frac=${round(frac)} ${f.id} ` +
              `art=[${colliders.join(' ') || 'NONE'}]`,
            )
          }
        }
      }
    } finally {
      setTwoSidedTerminations(prev)
    }
    expect(true).toBe(true)
  })

  it('diagnose col18 term25/26 collider (interior lens reach)', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]; formationNames: Record<string, string>
    }
    const nameMap: Record<string, string> = existsSync(NAMES)
      ? (JSON.parse(readFileSync(NAMES, 'utf8')) as Record<string, string>)
      : {}
    const nameOf = (id: string): string => nameMap[id] ?? id.slice(0, 8)
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)

    const prev = setTwoSidedTerminations(true)
    try {
      const sec = raw.sections.find((s) => s.name === 'Cross-section 1')!
      const { columns, alongM, edges } = prepare(sec, nameOf)
      const section = buildSectionInput(columns, edges, undefined, alongM)
      const { activeTies } = emitCurves(section)
      const geom = section.columns
      // col18 = S7 (facing right, gap18); col20 = S5A (facing LEFT to col19, gap19). Diagnose both.
      for (const [ci, dir] of [[18, +1], [20, -1]] as const) {
        const col = geom[ci]
        const facing = geom[ci + dir]
        const colX = col.x
        const facingX = facing.x
        const gi = Math.min(ci, ci + dir)
        console.log(`\n===== col${ci} (${nameOf(columns[ci].investigationId)}) terminations, facing col${ci + dir}, gap${gi} =====`)
        const gapTies = activeTies.filter((t) => t.gapIndex === gi)
        console.log(`gap${gi} ties: ${gapTies.map((t) => `${t.id}(L${round(t.left.y)}/${round(t.right.y)} ${t.leftSide}/${t.rightSide})`).join(' ')}`)
        for (let ui = 0; ui < col.units.length; ui++) {
          const u = col.units[ui]
          const mid = (u.topElev + u.baseElev) / 2
          const matrixFid = enclosingMatrixFid(col, u)
          const facingFid = facingMatrixLabel(facing, mid)?.formationId
          const reach = interiorLensReachToTies(u.topElev - u.baseElev, colX, facingX, mid, u.topElev, u.baseElev, gapTies)
          console.log(
            `  ui${ui} ${fname(u.formationId)} el[${round(u.baseElev)}..${round(u.topElev)}] mid=${round(mid)} ` +
              `matrixFid=${matrixFid ? fname(matrixFid) : 'null'} facingFid=${facingFid ? fname(facingFid) : 'null'} ` +
              `reach(lineArtOnly)=${round(reach)}`,
          )
        }
      }
    } finally {
      setTwoSidedTerminations(prev)
    }
    expect(true).toBe(true)
  })

  it('probe correlation line art (ties + band contours + bridges) crossing gap5 ZAND lens', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]; formationNames: Record<string, string>
    }
    const nameMap: Record<string, string> = existsSync(NAMES)
      ? (JSON.parse(readFileSync(NAMES, 'utf8')) as Record<string, string>)
      : {}
    const nameOf = (id: string): string => nameMap[id] ?? id.slice(0, 8)
    const prev = setTwoSidedTerminations(true)
    try {
      const sec = raw.sections.find((s) => s.name === 'Cross-section 1')!
      const { columns, alongM, edges } = prepare(sec, nameOf)
      const section = buildSectionInput(columns, edges, undefined, alongM)
      const { curves } = emitCurves(section)
      const geom = section.columns
      // gap5 ZAND lens: col5 ZAND el[5.73..6.44], own column x = geom[5].x, facing geom[6].x.
      const ownX = geom[5].x
      const facingX = geom[6].x
      const lo = 5.73
      const hi = 6.44
      console.log(`\n===== curves crossing gap5 ZAND lens [${lo}..${hi}] between x=${round(ownX)}..${round(facingX)} =====`)
      // Prefix histogram of ALL curves, then those whose polyline passes through the lens window.
      const byPrefix = new Map<string, number>()
      for (const c of curves as InputCurve[]) {
        const pre = c.id.replace(/[0-9].*$/, '')
        byPrefix.set(pre, (byPrefix.get(pre) ?? 0) + 1)
      }
      console.log('prefixes: ' + [...byPrefix].map(([p, n]) => `${p}:${n}`).join(' '))
      const xmin = Math.min(ownX, facingX)
      const xmax = Math.max(ownX, facingX)
      for (const c of curves as InputCurve[]) {
        for (const p of c.points) {
          if (p.x >= xmin - 1 && p.x <= xmax + 1 && p.y >= lo - 0.3 && p.y <= hi + 0.3) {
            console.log(`  ${c.id} (${c.kind}) touches (${round(p.x)},${round(p.y)})`)
            break
          }
        }
      }
    } finally {
      setTwoSidedTerminations(prev)
    }
    expect(true).toBe(true)
  })
})
